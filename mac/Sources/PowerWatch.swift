// Power out stopwatch for Minecraft mode (the developer, 4 Nov 2026, the developer's city has frequent power cuts: "under
// Minecraft mode, start a stopwatch of like power has been out for").
//
// How it works:
// - macOS tells PS when the power source changes (IOPSNotificationCreateRunLoopSource). No polling. The
//   notification run loop lives on PS's own "PS power" thread and the state lives on its own serial
//   queue, so nothing here ever runs on, or waits for, the main thread.
// - Mains goes (the Mac now runs on its battery or a UPS): the start time is kept in UserDefaults
//   (`power.since`), so the stopwatch carries on through a PS restart, an update and sleep.
// - Mains comes back: the outage (start, end, length) goes into a small local history (`power.history`,
//   newest first, the last 50). A blip under 10 s (a cable wiggle) is not kept.
// - PS was closed when mains came back: the next launch sees mains with a start time still stored, so it
//   keeps that outage with the launch as its end and marks it "approx".
// - Battery percent and time left are sent when macOS gives them (time left is -1 while it is still
//   working it out; that is sent as null).
//
// Bridge (the web side is src/views/minecraft/power-bridge.ts in web):
//   shell -> page: window.__psPower({type:"power:state", onBattery, hasBattery, since, batteryPct,
//                  minutesLeft, lastOutage, history})   on every change, and after power:get
//   page -> shell: {type:"power:get"}
// Times are milliseconds since 1970 (JavaScript's Date.now()). Only times and the battery level, nothing
// else, and nothing leaves this Mac.
//
// Test copies never read the real power source and never write UserDefaults: they keep a fictional
// outage in memory (for pictures). PS_SELFTEST_ONLY=power runs selfCheck() with a fake power source.
import Foundation
import AppKit
import IOKit.ps

/// One reading of the power source.
struct PowerReading: Equatable {
  var hasBattery: Bool
  var onBattery: Bool          // true while mains is out (running on the battery or a UPS)
  var pct: Int?                // 0 to 100
  var minutesLeft: Int?        // nil while macOS is still working it out, or on mains
}

/// One power cut. Seconds since 1970.
struct PowerOutage: Codable, Equatable {
  var start: Double
  var end: Double
  var approx: Bool?            // true: PS was closed when power came back, so `end` is when PS started again
  var duration: Double { max(0, end - start) }
}

/// Where the start time and the history are kept: UserDefaults for the live app, memory for tests.
final class PowerStore {
  private let getF: (String) -> Any?
  private let setF: (String, Any?) -> Void
  init(get: @escaping (String) -> Any?, set: @escaping (String, Any?) -> Void) { getF = get; setF = set }
  func get(_ k: String) -> Any? { getF(k) }
  func set(_ k: String, _ v: Any?) { setF(k, v) }
  static var defaults: PowerStore {
    PowerStore(get: { UserDefaults.standard.object(forKey: $0) },
               set: { k, v in if let v { UserDefaults.standard.set(v, forKey: k) } else { UserDefaults.standard.removeObject(forKey: k) } })
  }
  static func memory() -> PowerStore {
    let box = NSMutableDictionary()
    return PowerStore(get: { box[$0] }, set: { k, v in if let v { box[k] = v } else { box.removeObject(forKey: k) } })
  }
}

/// The stopwatch's rules, with no IOKit and no clock of its own (so the self test can drive it).
/// Not thread safe by itself: PowerWatch only touches it on its own queue.
final class PowerCore {
  static let keep = 50
  static let minOutage: Double = 10
  private let store: PowerStore
  private(set) var since: Double?
  private(set) var history: [PowerOutage] = []
  private(set) var reading: PowerReading?
  private var restored: Bool          // a start time was found at launch and no reading has come in yet

  init(store: PowerStore) {
    self.store = store
    since = (store.get("power.since") as? NSNumber)?.doubleValue
    if let d = store.get("power.history") as? Data, let h = try? JSONDecoder().decode([PowerOutage].self, from: d) {
      history = Array(h.prefix(PowerCore.keep))
    }
    restored = since != nil
  }

  var lastOutage: PowerOutage? { history.first }

  /// A new reading at `now` (seconds since 1970). True when the page should hear about it.
  @discardableResult
  func ingest(_ r: PowerReading, now: Double) -> Bool {
    let before = reading, beforeSince = since
    var added = false
    let first = restored
    restored = false
    if r.onBattery {
      if since == nil { since = now; store.set("power.since", now) }
    } else if let s = since {
      since = nil
      store.set("power.since", nil)
      if now - s >= PowerCore.minOutage {
        history.insert(PowerOutage(start: s, end: now, approx: first ? true : nil), at: 0)
        added = true
        if history.count > PowerCore.keep { history.removeLast(history.count - PowerCore.keep) }
        if let d = try? JSONEncoder().encode(history) { store.set("power.history", d) }
      }
    }
    reading = r
    return added || before != r || beforeSince != since
  }

  func clearHistory() {
    history = []
    store.set("power.history", nil)
  }

  /// The message for the page.
  func json() -> String {
    let ms = { (s: Double) in Int64((s * 1000).rounded()) }
    func out(_ o: PowerOutage) -> [String: Any] {
      var d: [String: Any] = ["start": ms(o.start), "end": ms(o.end), "duration": ms(o.duration)]
      if o.approx == true { d["approx"] = true }
      return d
    }
    let r = reading
    let d: [String: Any] = [
      "type": "power:state",
      "known": r != nil,
      "hasBattery": r?.hasBattery ?? false,
      "onBattery": r?.onBattery ?? false,
      "since": since.map { ms($0) as Any } ?? NSNull(),
      "batteryPct": r?.pct.map { $0 as Any } ?? NSNull(),
      "minutesLeft": (r?.onBattery == true ? r?.minutesLeft : nil).map { $0 as Any } ?? NSNull(),
      "lastOutage": history.first.map { out($0) as Any } ?? NSNull(),
      "history": history.map(out),
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: d), let s = String(data: data, encoding: .utf8) else { return "{\"type\":\"power:state\"}" }
    return s
  }
}

final class PowerWatch {
  static let shared = PowerWatch()
  /// Set by main.swift: hands the JSON to the pages. Always called on the main thread.
  var deliver: ((String) -> Void)?
  private let q = DispatchQueue(label: "com.cincee.ps.power", qos: .utility)
  private var core = PowerCore(store: .memory())   // replaced in start()
  private var thread: Thread?
  private var started = false
  /// For the self test: whether start() ever ran (never while Minecraft mode is off, MinecraftSwitch.swift).
  var isStarted: Bool { started }
  private(set) var realSource = false               // false in test copies: the real power source is never read

  func start(testDir: String?) {
    guard !started else { return }
    started = true
    if testDir != nil || IS_TEST_COPY {
      // FICTIONAL: the power went out 42 min 13 s ago, 63 percent left, two older cuts.
      q.async { [self] in
        let now = Date().timeIntervalSince1970
        let st = PowerStore.memory()
        let h = [PowerOutage(start: now - 86400 - 4320, end: now - 86400), PowerOutage(start: now - 2 * 86400 - 1500, end: now - 2 * 86400)]
        st.set("power.history", try? JSONEncoder().encode(h))
        core = PowerCore(store: st)
        core.ingest(PowerReading(hasBattery: true, onBattery: false, pct: 100, minutesLeft: nil), now: now - 2533)
        core.ingest(PowerReading(hasBattery: true, onBattery: true, pct: 63, minutesLeft: 214), now: now - 2533)
      }
      return
    }
    realSource = true
    q.sync { core = PowerCore(store: .defaults) }   // a few UserDefaults reads, before any notification
    let t = Thread { [weak self] in
      guard let self else { return }
      let ctx = Unmanaged.passUnretained(self).toOpaque()
      if let src = IOPSNotificationCreateRunLoopSource({ ctx in
        guard let ctx else { return }
        Unmanaged<PowerWatch>.fromOpaque(ctx).takeUnretainedValue().refresh()
      }, ctx)?.takeRetainedValue() {
        CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .defaultMode)
        self.refresh()
        CFRunLoopRun()
      } else {
        psLog("PS power: no power source notifications")
        self.refresh()
      }
    }
    t.name = "PS power"
    t.qualityOfService = .utility
    thread = t
    t.start()
    // After a wake, read once more (macOS sends the change too, this is only a safety net).
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: nil) { [weak self] _ in self?.refresh() }
  }

  /// The page asked (power:get): send what we have.
  func request() {
    q.async { [self] in let j = core.json(); DispatchQueue.main.async { self.deliver?(j) } }
  }

  /// Read the power source and tell the page if anything changed. Any thread; never the main one's time.
  private func refresh() {
    guard realSource else { return }
    let r = PowerWatch.readNow()
    q.async { [self] in
      guard core.ingest(r, now: Date().timeIntervalSince1970) else { return }
      let j = core.json()
      DispatchQueue.main.async { self.deliver?(j) }
    }
  }

  /// The current power source from IOKit (read only).
  static func readNow() -> PowerReading {
    guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue() else { return PowerReading(hasBattery: false, onBattery: false, pct: nil, minutesLeft: nil) }
    let providing = IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() as String? ?? kIOPSACPowerValue
    var hasBattery = false, pct: Int?, mins: Int?
    let list = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] ?? []
    for ps in list {
      guard let d = IOPSGetPowerSourceDescription(info, ps)?.takeUnretainedValue() as? [String: Any] else { continue }
      guard (d[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType || (d[kIOPSTypeKey] as? String) == kIOPSUPSType else { continue }
      if (d[kIOPSIsPresentKey] as? Bool) == false { continue }
      hasBattery = true
      if let cur = d[kIOPSCurrentCapacityKey] as? Int, let max = d[kIOPSMaxCapacityKey] as? Int, max > 0 {
        pct = Swift.max(0, Swift.min(100, Int((Double(cur) / Double(max) * 100).rounded())))
      }
      if let m = d[kIOPSTimeToEmptyKey] as? Int, m >= 0 { mins = m }
      if (d[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType { break }   // the Mac's own battery wins over a UPS
    }
    let onBattery = hasBattery && providing != kIOPSACPowerValue
    return PowerReading(hasBattery: hasBattery, onBattery: onBattery, pct: pct, minutesLeft: onBattery ? mins : nil)
  }

  /// PS_SELFTEST_ONLY=power (and the full run): the rules with a FAKE power source and a fake clock.
  static func selfCheck() -> String {
    var r: [(String, Bool)] = []
    let mains = PowerReading(hasBattery: true, onBattery: false, pct: 100, minutesLeft: nil)
    func batt(_ p: Int, _ m: Int?) -> PowerReading { PowerReading(hasBattery: true, onBattery: true, pct: p, minutesLeft: m) }
    func obj(_ c: PowerCore) -> [String: Any] { (try? JSONSerialization.jsonObject(with: Data(c.json().utf8))) as? [String: Any] ?? [:] }
    let t0 = 1_800_000_000.0
    let st = PowerStore.memory()
    var c = PowerCore(store: st)

    c.ingest(mains, now: t0)
    r.append(("mains-no-stopwatch", c.since == nil && obj(c)["onBattery"] as? Bool == false && obj(c)["since"] is NSNull && c.history.isEmpty))
    let changed = c.ingest(batt(97, nil), now: t0 + 60)
    r.append(("battery-starts", changed && c.since == t0 + 60 && (st.get("power.since") as? NSNumber)?.doubleValue == t0 + 60))
    let o = obj(c)
    r.append(("json-fields", o["type"] as? String == "power:state" && o["onBattery"] as? Bool == true && (o["since"] as? NSNumber)?.int64Value == Int64((t0 + 60) * 1000)
      && o["batteryPct"] as? Int == 97 && o["minutesLeft"] is NSNull && o["lastOutage"] is NSNull && (o["history"] as? [Any])?.isEmpty == true))
    c.ingest(batt(95, 180), now: t0 + 600)
    r.append(("pct-update-keeps-start", c.since == t0 + 60 && obj(c)["minutesLeft"] as? Int == 180 && obj(c)["batteryPct"] as? Int == 95))
    r.append(("same-reading-quiet", !c.ingest(batt(95, 180), now: t0 + 601)))

    // PS restarts in the middle of the cut: the start time survives.
    c = PowerCore(store: st)
    r.append(("restart-restores", c.since == t0 + 60))
    c.ingest(batt(90, 160), now: t0 + 900)
    r.append(("restart-keeps-start", c.since == t0 + 60))
    // The Mac sleeps two hours on battery: still the same cut, counted through sleep.
    c.ingest(batt(70, 120), now: t0 + 900 + 7200)
    r.append(("sleep-keeps-start", c.since == t0 + 60))

    // Mains comes back after 1 h 12 min 13 s.
    let back = t0 + 60 + 4333
    c.ingest(mains, now: back)
    let lo = obj(c)["lastOutage"] as? [String: Any]
    r.append(("back-records", c.since == nil && st.get("power.since") == nil && c.history.count == 1 && c.history[0].start == t0 + 60 && c.history[0].end == back
      && (lo?["duration"] as? NSNumber)?.int64Value == 4_333_000 && lo?["approx"] == nil && obj(c)["onBattery"] as? Bool == false && obj(c)["minutesLeft"] is NSNull))
    r.append(("history-persists", PowerCore(store: st).history.count == 1))

    // A blip of 3 s is not a power cut.
    c.ingest(batt(100, nil), now: back + 100)
    c.ingest(mains, now: back + 103)
    r.append(("blip-ignored", c.history.count == 1 && c.since == nil))

    // The cut ends while PS is closed: the next launch keeps it, marked approx.
    c.ingest(batt(99, nil), now: back + 1000)
    c = PowerCore(store: st)
    c.ingest(mains, now: back + 5000)
    r.append(("ended-while-closed", c.history.count == 2 && c.history[0].approx == true && c.history[0].start == back + 1000 && (obj(c)["lastOutage"] as? [String: Any])?["approx"] as? Bool == true))

    // Only the last 50, newest first.
    for i in 0..<60 { let s = back + 10_000 + Double(i) * 1000; c.ingest(batt(80, 100), now: s); c.ingest(mains, now: s + 30) }
    r.append(("keeps-50-newest-first", c.history.count == 50 && c.history[0].start > c.history[1].start && PowerCore(store: st).history.count == 50))

    // A Mac with no battery: never a power cut.
    let d = PowerCore(store: .memory())
    d.ingest(PowerReading(hasBattery: false, onBattery: false, pct: nil, minutesLeft: nil), now: t0)
    r.append(("desktop-no-battery", d.since == nil && obj(d)["hasBattery"] as? Bool == false))

    r.append(("test-copy-no-real-source", !IS_TEST_COPY || !PowerWatch.shared.realSource))
    let ok = r.allSatisfy { $0.1 }
    return "POWER CHECK: \(ok ? "ok" : "FAIL") " + r.map { "\($0.0)=\($0.1 ? "ok" : "FAIL")" }.joined(separator: " ")
  }
}

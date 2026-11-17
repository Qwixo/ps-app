// Audio priority (PS 1.65, feature "audio-priority", on by default, switch in Settings, Mac): the volume mixer's two
// ordered lists, Speakers and Microphones. Whenever a device connects or goes away, at launch and after the Mac wakes,
// PS makes the highest connected speaker the Mac's sound output (alerts too, as the sound menu does) and the highest
// connected microphone its input, each list on its own. The rules (the manual change rule, calls, first seen devices,
// a device whose id changed) are the pure part in AudioPriorityCore.swift.
//
// How: Core Audio property listeners (the device list, each device's alive state, the two defaults, and whether the
// default microphone is in use) call in on their own queue; every call only marks that something changed, and one
// look runs half a second later on this file's own queue (debounced: a Bluetooth connect fires many changes). A
// device that just connected gets 1.2 seconds before it is used, and every switch is read back and tried again a few
// times while a fresh device warms up. Nothing runs on the main thread except handing the state to the page.
// Nothing polls: no timers while nothing happens.
//
// Saved forever on this Mac (UserDefaults "audio.priority"), by Core Audio's device UID, never by name, so a rename
// or an update never loses the order. Moved over once from Headphones mode ("hpmode.prefs", "hpmode.mode"); the old
// keys stay as they were, so an older PS still reads them.
// GOLDEN RULE: 1Password and Signal are dropped at the first read (by name and id), never listed, saved or switched to.
// A self test copy runs on a fake Mac (FakeAP) and never reads or changes the real output or microphone.
import AppKit
import CoreAudio

enum APEvent { case devices, defaults, mic }

/// What Audio priority needs from the Mac (a self test copy swaps in a fake).
protocol APBackend: AnyObject {
  /// Real devices with streams on that side: no virtual or combined ones, never 1Password or Signal.
  func devices(_ side: APSide) -> [APDevice]
  func defaultUID(_ side: APSide) -> String?
  /// Any device with this id, virtual ones too, connected and awake.
  func isAlive(_ uid: String) -> Bool
  /// The default output also sets the system output (alerts) when `alerts`, as the sound menu does.
  func setDefault(_ side: APSide, _ uid: String, alerts: Bool) -> Bool
  /// Is any app using the default microphone right now? (Core Audio's "running somewhere", nothing is heard.)
  func micRunning() -> Bool
  func onEvent(_ f: @escaping (APEvent) -> Void)
}

final class AudioPriority {
  static let shared = AudioPriority()
  private let q = DispatchQueue(label: "PS audio priority", qos: .userInitiated)
  private var backend: APBackend?
  private var testDir: String?
  private var lists = APLists()
  private var holds: [APSide: APHold] = [:]
  private var expected: [APSide: (uid: String, until: Double)] = [:]
  private var lastDefault: [APSide: String] = [:]
  private var lastAlive: [APSide: Set<String>] = [:]
  private var newly: [APSide: [String: Double]] = [:]     // uid: when it connected
  private var waiting: Set<APSide> = []                  // a call is on: look again when it ends
  private var micSince: Double?
  private var gen: [APSide: Int] = [:]
  private var pendingWhy: APWhy?
  private var orderSides: Set<APSide> = []
  private var scheduled = false
  private var watchingWake = false
  private var on = false
  private let lock = NSLock()
  private var onSnap = false
  /// The volume mixer gets {type:"audioprio", ...} (main thread).
  var deliver: ((String) -> Void)?
  /// The feature switch (features.json "audio-priority"). Tests swap it.
  var isOn: () -> Bool = { Features.on("audio-priority") }
  var now: () -> Double = { Date().timeIntervalSince1970 }
  var debounce = 0.5
  var settle = 1.2                 // a device that just connected gets a moment before it is used
  var verifyDelays: [Double] = [0.4, 0.8, 1.6]
  var wakeDelay = 2.0
  var newWindow = 10.0             // how long a device counts as "just connected"
  var systemWindow = 3.0          // a default change this close to a device change is macOS's, not the person's
  private var lastChangeAt: Double = -1e9

  /// For other parts (HeadphonesMode.claims, any queue).
  var isOnNow: Bool { lock.lock(); defer { lock.unlock() }; return onSnap }

  func start(testDir: String?, backend: APBackend? = nil) {
    self.testDir = testDir
    q.async { [self] in
      if let b = backend { self.backend = b } else if testDir == nil { self.backend = CoreAudioAP() } else { return }   // a test copy waits for its fake
      guard let b = self.backend else { return }
      load()
      refreshOn()
      let t = now()
      for side in APSide.allCases {
        let devs = b.devices(side)
        lastAlive[side] = Set(devs.filter(\.alive).map(\.uid))
        if let d = b.defaultUID(side) { lastDefault[side] = d }
        lists[side] = APCore.merge(lists[side], devs, side: side, now: t, protected: Self.protected)
      }
      save()
      micSince = b.micRunning() ? t : nil
      b.onEvent { [weak self] e in self?.q.async { self?.event(e) } }
      if !watchingWake {
        watchingWake = true
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: nil) { [weak self] _ in
          self?.q.async { self?.woke() }
        }
        Features.observers.append { [weak self] in self?.q.async { self?.featuresChanged() } }
      }
      schedule(.launch, after: testDir == nil ? 1.0 : 0.1)
      push()
    }
  }

  static func protected(_ s: String) -> Bool { Protected.matches(s) }
  private func refreshOn() { on = isOn(); lock.lock(); onSnap = on; lock.unlock() }

  // ---------- saved on this Mac ----------
  private func load() {
    let d = UserDefaults.standard
    let data = testDir.map { try? Data(contentsOf: URL(fileURLWithPath: $0).appendingPathComponent("audiopriority.json")) } ?? d.data(forKey: "audio.priority")
    if let data, let l = try? JSONDecoder().decode(APLists.self, from: data) { lists = l; return }
    // First start: move over what Headphones mode had (APCore.migrate).
    let old = testDir.map { try? Data(contentsOf: URL(fileURLWithPath: $0).appendingPathComponent("hpmode.json")) } ?? d.data(forKey: "hpmode.prefs")
    let mode = testDir == nil ? d.string(forKey: "hpmode.mode") : nil
    lists = APCore.migrate(old.flatMap { try? JSONDecoder().decode(HPPrefs.self, from: $0) }, mode: mode)
    if old != nil { psLog("PS audio priority: moved over the Headphones mode lists") }
  }
  private func save() {
    guard let data = try? JSONEncoder().encode(lists) else { return }
    if let dir = testDir { try? data.write(to: URL(fileURLWithPath: dir).appendingPathComponent("audiopriority.json")); return }
    UserDefaults.standard.set(data, forKey: "audio.priority")
  }

  // ---------- something changed ----------
  private func event(_ e: APEvent) { schedule(.devices, after: debounce) }
  private func woke() {
    holds = [:]; newly = [:]                    // after sleep, the order decides again (Bluetooth reconnects follow)
    schedule(.wake, after: wakeDelay)
  }
  private func featuresChanged() {
    let was = on
    refreshOn()
    if on == was { return }
    psLog("PS audio priority: \(on ? "on" : "off")")
    if on { holds = [:]; schedule(.launch, after: 0.3) } else { for s in APSide.allCases { gen[s, default: 0] += 1 }; waiting = [] }
    push()
  }
  private func schedule(_ why: APWhy, after: Double) {
    // The stronger reason wins: launch and wake apply the order, devices only look.
    if pendingWhy == nil || why == .launch || why == .wake { pendingWhy = why }
    guard !scheduled else { return }
    scheduled = true
    q.asyncAfter(deadline: .now() + after) { [weak self] in self?.look() }
  }

  /// One look at everything: devices, defaults, the call; then what to do for each list. Own queue.
  private func look() {
    scheduled = false
    let why = pendingWhy ?? .devices
    pendingWhy = nil
    let ordered = orderSides
    orderSides = []
    guard let b = backend else { return }
    refreshOn()
    let t = now()
    let running = b.micRunning()
    if running { if micSince == nil { micSince = t } } else { micSince = nil }
    let inCall = APCore.isCall(micRunning: running, runningSince: micSince, now: t)
    var dirty = false
    // First both lists' devices, so a change on either counts as "devices came or went" for both defaults.
    var seen: [APSide: (devs: [APDevice], alive: Set<String>)] = [:]
    for side in APSide.allCases {
      let devs = b.devices(side)
      let alive = Set(devs.filter(\.alive).map(\.uid))
      let before = lastAlive[side] ?? []
      if alive != before { lastChangeAt = t }
      for u in alive.subtracting(before) { newly[side, default: [:]][u] = t }
      newly[side] = (newly[side] ?? [:]).filter { t - $0.value < newWindow && alive.contains($0.key) }
      lastAlive[side] = alive
      seen[side] = (devs, alive)
    }
    for side in APSide.allCases {
      let (devs, alive) = seen[side]!
      let merged = APCore.merge(lists[side], devs, side: side, now: t, protected: Self.protected)
      if merged != lists[side] { lists[side] = merged; dirty = true }
      let cur = b.defaultUID(side)
      if let cur, cur != lastDefault[side] {
        let prevGone = lastDefault[side].map { !b.isAlive($0) } ?? true
        // macOS moves the sound onto new headphones a moment after they appear: within systemWindow it is not a pick.
        let moment = t - lastChangeAt <= systemWindow || newly[side]?[cur] != nil
        switch APCore.who(newDefault: cur, expected: expected[side], devicesChanged: moment, previousGone: prevGone, now: t) {
        case .ps: expected[side] = nil
        case .person: holds[side] = APHold(uid: cur, at: t); psLog("PS audio priority: \(side.rawValue) picked by hand, left alone")
        case .system: break
        }
        lastDefault[side] = cur
      }
      if let h = holds[side], !alive.contains(h.uid) { holds[side] = nil }     // the picked device left: the order rules again
      guard on else { continue }
      let foreign = cur.map { u in !devs.contains { $0.uid == u } } ?? false
      let sideWhy: APWhy = ordered.contains(side) ? .order : (why == .devices && waiting.contains(side) && !inCall ? .callEnded : why)
      let d = APCore.decide(lists[side], alive: alive, current: cur, foreign: foreign, hold: holds[side], newly: Set((newly[side] ?? [:]).keys),
                            why: sideWhy, inCall: inCall, now: t)
      switch d {
      case .wait:
        if !waiting.contains(side) { psLog("PS audio priority: \(side.rawValue) waits for the call to end") }
        waiting.insert(side)
      case .stay: waiting.remove(side)
      case .set(let u):
        waiting.remove(side)
        if holds[side]?.uid != u { holds[side] = nil }     // a device that connected above the pick took over: the pick is done
        apply(side, u, connectedAt: newly[side]?[u])
      }
    }
    if dirty { save() }
    push()
  }

  /// Make a device the default, then read it back (tries again while a fresh device warms up). Own queue.
  private func apply(_ side: APSide, _ uid: String, connectedAt: Double?) {
    gen[side, default: 0] += 1
    let g = gen[side]!
    let wait = connectedAt.map { max(0, settle - (now() - $0)) } ?? 0
    q.asyncAfter(deadline: .now() + wait) { [weak self] in self?.try1(side, uid, attempt: 0, gen: g) }
  }
  private func try1(_ side: APSide, _ uid: String, attempt: Int, gen g: Int) {
    guard let b = backend, g == gen[side], on, lastAlive[side]?.contains(uid) == true else { return }
    let wait = verifyDelays.isEmpty ? 0.4 : verifyDelays[min(attempt, verifyDelays.count - 1)]
    expected[side] = (uid, now() + wait + 3)
    let took = b.setDefault(side, uid, alerts: true)
    q.asyncAfter(deadline: .now() + wait) { [self] in
      guard g == gen[side] else { return }
      if took && b.defaultUID(side) == uid {
        if lastDefault[side] != uid { lastDefault[side] = uid }
        psLog("PS audio priority: \(side.rawValue) set" + (attempt > 0 ? " (macOS took it on try \(attempt + 1))" : ""))
        push()
        return
      }
      if attempt + 1 < max(verifyDelays.count, 1), b.devices(side).contains(where: { $0.uid == uid && $0.alive }) {
        try1(side, uid, attempt: attempt + 1, gen: g); return
      }
      psLog("PS audio priority: macOS kept the \(side.rawValue) where they were after \(attempt + 1) tries")
      push()
    }
  }

  // ---------- the volume mixer ----------
  private func push() {
    let held: [String: Bool] = Dictionary(uniqueKeysWithValues: APSide.allCases.map { s in (s.rawValue, holds[s].map { lastAlive[s]?.contains($0.uid) == true } ?? false) })
    func rows(_ s: APSide) -> [[String: Any]] {
      lists[s].map { e in ["uid": e.uid, "name": e.name, "kind": e.kind.rawValue, "connected": lastAlive[s]?.contains(e.uid) == true, "using": lastDefault[s] == e.uid] }
    }
    let o: [String: Any] = ["type": "audioprio", "on": on, "speakers": rows(.speakers), "mics": rows(.mics), "held": held,
                            "waiting": waiting.map(\.rawValue).sorted()]
    guard let data = try? JSONSerialization.data(withJSONObject: o), let j = String(data: data, encoding: .utf8) else { return }
    DispatchQueue.main.async { self.deliver?(j) }
  }

  /// From the volume mixer (main.swift, type "audioprio"): get, order, forget, use. Returns at once; the work runs here.
  func handle(_ m: [String: Any]) {
    q.async { [self] in
      let op = m["op"] as? String ?? ""
      if op == "get" { push(); return }
      guard on, let s = (m["side"] as? String).flatMap(APSide.init(rawValue:)) else { return }
      switch op {
      case "order":
        guard let raw = m["order"] as? [Any] else { return }
        let order = raw.prefix(100).compactMap { $0 as? String }.filter(APCore.okUID)
        let next = APCore.reorder(lists[s], order)
        guard next != lists[s] else { push(); return }
        lists[s] = next; save()
        holds[s] = nil                             // a new order is the person asking: it applies now, even in a call
        orderSides.insert(s)
        psLog("PS audio priority: new \(s.rawValue) order")
        schedule(.devices, after: 0.05)
      case "forget":
        guard let u = m["uid"] as? String, APCore.okUID(u) else { return }
        let next = APCore.forget(lists[s], u, connected: lastAlive[s] ?? [])
        if next != lists[s] { lists[s] = next; save(); psLog("PS audio priority: forgot a \(s.rawValue) device") }
        push()
      case "use":                                  // a click on a connected device: use it now, and the order leaves it be
        guard let u = m["uid"] as? String, lastAlive[s]?.contains(u) == true, lists[s].contains(where: { $0.uid == u }) else { return }
        holds[s] = APHold(uid: u, at: now())
        apply(s, u, connectedAt: nil)
        push()
      default: break
      }
    }
  }

  /// Settings, Microphone (main.swift "mic:set"): the person picked one, so it is held like a pick in macOS.
  func notePick(_ side: APSide, _ uid: String) { q.async { [self] in holds[side] = APHold(uid: uid, at: now()) } }

  // Self test helpers.
  func syncForTest() { q.sync {} }
  var listsNow: APLists { q.sync { lists } }
  func holdNow(_ s: APSide) -> APHold? { q.sync { holds[s] } }
  var waitingNow: Set<APSide> { q.sync { waiting } }
  func wakeForTest() { q.sync { woke() } }
  func featuresChangedForTest() { q.sync { featuresChanged() } }
  func resetForTest() {
    q.sync {
      for s in APSide.allCases { gen[s, default: 0] += 1 }
      lists = APLists(); holds = [:]; expected = [:]; lastChangeAt = -1e9; lastDefault = [:]; lastAlive = [:]; newly = [:]; waiting = []; micSince = nil; backend = nil
    }
  }
}

// ---------- the real Mac: Core Audio ----------
final class CoreAudioAP: APBackend {
  private static let sys = AudioObjectID(kAudioObjectSystemObject)
  private let lq = DispatchQueue(label: "PS audio priority listen")
  private var f: ((APEvent) -> Void)?
  private var watched: Set<AudioObjectID> = []      // the listen queue only
  private var micWatched = AudioObjectID(kAudioObjectUnknown)
  private var micListened: Set<AudioObjectID> = []   // the listen queue only: devices that already have the running listener
  private func addr(_ s: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: s, mScope: scope, mElement: kAudioObjectPropertyElementMain)
  }
  private func string(_ o: AudioObjectID, _ s: AudioObjectPropertySelector) -> String {
    var a = addr(s); var v: Unmanaged<CFString>?; var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    return AudioObjectGetPropertyData(o, &a, 0, nil, &size, &v) == 0 ? (v?.takeRetainedValue() as String? ?? "") : ""
  }
  private func u32(_ o: AudioObjectID, _ s: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> UInt32 {
    var a = addr(s, scope); var v: UInt32 = 0; var size = UInt32(4)
    return AudioObjectGetPropertyData(o, &a, 0, nil, &size, &v) == 0 ? v : 0
  }
  private func allIDs() -> [AudioObjectID] {
    var a = addr(kAudioHardwarePropertyDevices); var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(Self.sys, &a, 0, nil, &size) == 0, size > 0 else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    return AudioObjectGetPropertyData(Self.sys, &a, 0, nil, &size, &ids) == 0 ? ids : []
  }
  private func hasStreams(_ d: AudioObjectID, _ scope: AudioObjectPropertyScope) -> Bool {
    var s = addr(kAudioDevicePropertyStreams, scope); var n: UInt32 = 0
    return AudioObjectGetPropertyDataSize(d, &s, 0, nil, &n) == 0 && n > 0
  }
  static func fourCC(_ s: String) -> UInt32 { s.utf8.reduce(0) { ($0 << 8) | UInt32($1) } }
  /// Core Audio's transport type in plain kinds; nil for virtual and combined devices (never in the lists).
  static func kind(transport t: UInt32, uid: String, name: String) -> APKind? {
    switch t {
    case kAudioDeviceTransportTypeVirtual, kAudioDeviceTransportTypeAggregate, kAudioDeviceTransportTypeAutoAggregate: return nil
    case kAudioDeviceTransportTypeBuiltIn:
      let u = uid.lowercased(), n = name.lowercased()
      return u.contains("headphone") || n.contains("headphone") || n.contains("external") ? .jack : .builtIn
    case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: return .bluetooth
    case kAudioDeviceTransportTypeUSB, kAudioDeviceTransportTypeFireWire, kAudioDeviceTransportTypeThunderbolt, kAudioDeviceTransportTypePCI: return .usb
    case kAudioDeviceTransportTypeHDMI, kAudioDeviceTransportTypeDisplayPort: return .display
    case kAudioDeviceTransportTypeAirPlay: return .airplay
    case fourCC("ccwd"), fourCC("ccwl"): return .phone        // Continuity: an iPhone's microphone or camera
    default: return .other
    }
  }
  private struct Raw { let id: AudioObjectID; let dev: APDevice }
  private func raw(_ side: APSide) -> [Raw] {
    let scope = side == .speakers ? kAudioObjectPropertyScopeOutput : kAudioObjectPropertyScopeInput
    return allIDs().compactMap { d in
      guard hasStreams(d, scope) else { return nil }
      let name = string(d, kAudioObjectPropertyName), uid = string(d, kAudioDevicePropertyDeviceUID)
      guard !uid.isEmpty, !uid.hasPrefix("ps-mixer-"), !Protected.matches(name), !Protected.matches(uid) else { return nil }
      guard let k = Self.kind(transport: u32(d, kAudioDevicePropertyTransportType), uid: uid, name: name) else { return nil }
      return Raw(id: d, dev: APDevice(uid: uid, name: name, kind: k, alive: u32(d, kAudioDevicePropertyDeviceIsAlive) != 0))
    }
  }
  func devices(_ side: APSide) -> [APDevice] {
    let r = raw(side)
    lq.async { [weak self] in self?.watch(r.map(\.id)) }
    return r.map(\.dev)
  }
  private func defaultID(_ side: APSide) -> AudioObjectID {
    u32(Self.sys, side == .speakers ? kAudioHardwarePropertyDefaultOutputDevice : kAudioHardwarePropertyDefaultInputDevice)
  }
  func defaultUID(_ side: APSide) -> String? { let id = defaultID(side); return id == 0 ? nil : string(id, kAudioDevicePropertyDeviceUID) }
  func isAlive(_ uid: String) -> Bool { allIDs().contains { string($0, kAudioDevicePropertyDeviceUID) == uid && u32($0, kAudioDevicePropertyDeviceIsAlive) != 0 } }
  func systemOutputUID() -> String? { let id = u32(Self.sys, kAudioHardwarePropertyDefaultSystemOutputDevice); return id == 0 ? nil : string(id, kAudioDevicePropertyDeviceUID) }
  private func setProp(_ s: AudioObjectPropertySelector, _ id: AudioObjectID) -> Bool {
    var a = addr(s); var v = id
    return AudioObjectSetPropertyData(Self.sys, &a, 0, nil, UInt32(MemoryLayout<AudioObjectID>.size), &v) == noErr
  }
  func setDefault(_ side: APSide, _ uid: String, alerts: Bool) -> Bool {
    guard let id = raw(side).first(where: { $0.dev.uid == uid })?.id else { return false }
    if side == .mics { return setProp(kAudioHardwarePropertyDefaultInputDevice, id) }
    let ok = setProp(kAudioHardwarePropertyDefaultOutputDevice, id)
    if alerts { _ = setProp(kAudioHardwarePropertyDefaultSystemOutputDevice, id) }
    return ok
  }
  /// Alerts back to a device the real device test found there (tests/audiopriority-real-test.swift).
  func setSystemOutput(_ uid: String) -> Bool {
    guard let id = raw(.speakers).first(where: { $0.dev.uid == uid })?.id else { return false }
    return setProp(kAudioHardwarePropertyDefaultSystemOutputDevice, id)
  }
  func micRunning() -> Bool { let id = defaultID(.mics); return id != 0 && u32(id, kAudioDevicePropertyDeviceIsRunningSomewhere) != 0 }
  func onEvent(_ f: @escaping (APEvent) -> Void) {
    lq.async { [self] in
      guard self.f == nil else { return }
      self.f = f
      for (s, e) in [(kAudioHardwarePropertyDevices, APEvent.devices), (kAudioHardwarePropertyDefaultOutputDevice, .defaults), (kAudioHardwarePropertyDefaultInputDevice, .defaults)] {
        var a = addr(s)
        AudioObjectAddPropertyListenerBlock(Self.sys, &a, lq) { [weak self] _, _ in
          if e == .defaults { self?.watchMic() }
          self?.f?(e)
        }
      }
      watch(allIDs())
      watchMic()
    }
  }
  /// Each device also says when it comes alive or goes to sleep (Bluetooth headphones can stay listed while away).
  private func watch(_ ids: [AudioObjectID]) {
    guard f != nil else { return }
    let all = Set(allIDs())
    watched.formIntersection(all)                      // gone devices take their listeners with them
    micListened.formIntersection(all)
    for d in ids where !watched.contains(d) {
      var a = addr(kAudioDevicePropertyDeviceIsAlive)
      if AudioObjectAddPropertyListenerBlock(d, &a, lq, { [weak self] _, _ in self?.f?(.devices) }) == noErr { watched.insert(d) }
    }
  }
  /// The default microphone says when an app starts or stops using it (a call). Only that it runs, never what it hears.
  private func watchMic() {
    let id = defaultID(.mics)
    guard id != 0, id != micWatched else { return }
    micWatched = id
    // One listener per device, ever: switching back to a microphone already watched (A, then B, then A) reuses it, so
    // listeners never pile up on a device as the default moves around (the block checks it is still the default).
    guard micListened.insert(id).inserted else { return }
    var a = addr(kAudioDevicePropertyDeviceIsRunningSomewhere)
    AudioObjectAddPropertyListenerBlock(id, &a, lq) { [weak self] _, _ in
      guard let self, self.micWatched == id else { return }
      self.f?(.mic)
    }
  }
}

// ---------- a test copy: a fake Mac, nothing real is read or changed ----------
final class FakeAP: APBackend {
  var outs: [APDevice] = []
  var ins: [APDevice] = []
  var out: String?
  var mic: String?
  var virtual: Set<String> = []                   // devices that exist but are virtual or combined (never listed)
  var micOn = false
  /// Like macOS: answers yes to this many switches but keeps the old default.
  var ignoreSets = 0
  private(set) var sets: [(APSide, String)] = []
  private var f: ((APEvent) -> Void)?
  func devices(_ side: APSide) -> [APDevice] { side == .speakers ? outs : ins }
  func defaultUID(_ side: APSide) -> String? { side == .speakers ? out : mic }
  func isAlive(_ uid: String) -> Bool { virtual.contains(uid) || (outs + ins).contains { $0.uid == uid && $0.alive } }
  func setDefault(_ side: APSide, _ uid: String, alerts: Bool) -> Bool {
    sets.append((side, uid))
    guard devices(side).contains(where: { $0.uid == uid }) else { return false }
    if ignoreSets > 0 { ignoreSets -= 1; return true }
    if side == .speakers { out = uid } else { mic = uid }
    f?(.defaults)
    return true
  }
  func micRunning() -> Bool { micOn }
  func onEvent(_ f: @escaping (APEvent) -> Void) { self.f = f }
  func fire(_ e: APEvent = .devices) { f?(e) }
  func clearSets() { sets = [] }
}

// Sentry mode in the helper (V1.48): the lid closed keep awake, and at the bottom the restart deadline. The
// decisions only. Pure: no IOKit, no files, no clock of its
// own, so tests/lid-core-test.swift checks every case. rebootd.swift feeds it what PS asks, the power source, the
// thermal state and what the kernel last accepted for its clamshell switch (closing the lid does not sleep the Mac
// while it is set; the switch itself cannot be read back), and carries out what it returns.
//
// The rules, all here:
//   - On only while genuine PS on the console keeps asking. PS renews every 30 s; no renewal for 90 s (PS quit,
//     crashed or hung) turns it off. Counted on the continuous clock, so time asleep counts too.
//   - Off at every helper start (and so at every boot), whatever it was before.
//   - Off at once when the battery is at or below PS's floor while on battery power (an unknown level on battery
//     counts as low), or when macOS says the Mac is seriously or critically hot. PS is told why.
//   - Once a session was stopped (a cutoff, the lease, PS's own off, a failure), a late renewal of that same
//     session never turns it on again: PS has to start a new one.
//   - Turning off is always allowed and idempotent. An off that did not take is tried again every check.
//   - If macOS sets it back to off while Sentry mode wants it on, it is set on again (and logged once).
//   - Log lines say on or off and why, nothing else.
import Foundation

/// The plain parts of the kernel call (rebootd.swift makes the call itself).
enum LidIO {
  /// The one scalar input of the clamshell switch: 1 keeps the Mac awake with the lid closed, 0 lets the lid sleep it.
  static func input(_ on: Bool) -> UInt64 { on ? 1 : 0 }

  /// An IOReturn as 0x hex with its name when it is a common one, eg "0xe00002e2 kIOReturnNotPermitted".
  static func describe(_ r: Int32) -> String {
    let names: [UInt32: String] = [
      0xe00002bc: "kIOReturnError", 0xe00002c0: "kIOReturnNoDevice", 0xe00002c1: "kIOReturnNotPrivileged",
      0xe00002c2: "kIOReturnBadArgument", 0xe00002c5: "kIOReturnExclusiveAccess", 0xe00002c7: "kIOReturnUnsupported",
      0xe00002cd: "kIOReturnNotOpen", 0xe00002d7: "kIOReturnOffline", 0xe00002d8: "kIOReturnNotReady",
      0xe00002e2: "kIOReturnNotPermitted", 0xe00002f0: "kIOReturnNotFound",
    ]
    let u = UInt32(bitPattern: r)
    let hex = "0x" + String(u, radix: 16).leftPad(8)
    return names[u].map { "\(hex) \($0)" } ?? hex
  }

  /// The one log line when the kernel refuses the switch.
  static func refusal(on: Bool, _ r: Int32) -> String {
    "lid keep awake: macOS refused to turn it \(on ? "on" : "off") (IOReturn \(describe(r)))"
  }
}

private extension String {
  func leftPad(_ n: Int) -> String { count >= n ? self : String(repeating: "0", count: n - count) + self }
}

/// Why lid closed keep awake is off. The raw value is what PS reads in the reply's `why`.
enum LidStop: String, Equatable {
  case battery, hot, lease, off, failed, notAllowed, safeMode, invalid

  var logText: String {
    switch self {
    case .battery: return "the battery is at or below Sentry mode's floor"
    case .hot: return "the Mac is too hot"
    case .lease: return "PS stopped renewing (quit, crashed or hung)"
    case .off: return "PS turned it off"
    case .failed: return "macOS did not take the setting"
    case .notAllowed: return "not the user on the console"
    case .safeMode: return "Safe Mode"
    case .invalid: return "the request was not valid"
    }
  }
}

/// One request from PS: {on: Bool, session: String, battery: Int}.
struct LidRequest: Equatable {
  let on: Bool
  let session: String
  let battery: Int

  static let batteryRange = 1...50
  /// nil for anything else (missing or extra kinds of value, a session that is not 8 to 64 letters, digits or
  /// dashes, a floor outside 1 to 50 percent).
  static func parse(_ j: [String: Any]) -> LidRequest? {
    guard j.count == 3, let on = j["on"] as? Bool, let s = j["session"] as? String,
          let b = j["battery"] as? Int, batteryRange.contains(b),
          (8...64).contains(s.utf8.count), s.utf8.allSatisfy({ ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90) || ($0 >= 97 && $0 <= 122) || $0 == 45 })
    else { return nil }
    // JSON true and false also read as Int 1 and 0 through NSNumber: refuse a Bool where the floor goes.
    if let n = j["battery"] as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() { return nil }
    if let n = j["on"] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() { return nil }
    return LidRequest(on: on, session: s, battery: b)
  }
}

/// What the Mac's power looks like right now. thermal: 0 nominal, 1 fair, 2 serious, 3 critical.
struct LidPower: Equatable {
  var onBattery: Bool
  var percent: Int?
  var thermal: Int
}

enum LidAction: Equatable {
  case set(Bool)          // write the kernel setting (and read it back)
  case log(String)
}

final class LidEngine {
  static let lease = 90.0

  /// Sentry mode wants it on and every check passed.
  private(set) var on = false
  /// The kernel setting may be on because of us (set by us and not yet seen off).
  private(set) var dirty = false
  private(set) var session: String?
  private(set) var renewedAt = -1e18
  private(set) var floor = 10
  /// Sessions that were stopped, newest last, with why: a late renewal of one gets that answer.
  private(set) var stopped: [(session: String, why: LidStop)] = []
  /// Logged once per stretch, not every 2 s.
  private var toldRetryOff = false, toldReassert = false

  static func cutoff(_ p: LidPower, floor: Int) -> LidStop? {
    if p.thermal >= 2 { return .hot }
    if p.onBattery { guard let pc = p.percent, pc > floor else { return .battery } }
    return nil
  }

  /// Helper start (and so every boot): off, whatever the kernel says.
  func start(actual: Bool?) -> [LidAction] {
    on = false; session = nil
    dirty = actual != false
    return [.set(false)] + (actual == true ? [.log("lid keep awake: was on when the helper started, turned off")] : [])
  }

  /// One request from PS. `allowed`: the caller is PS of the user on the console (and not Safe Mode).
  func request(_ r: LidRequest, now: Double, power: LidPower, allowed: Bool) -> (reply: [String: Any], actions: [LidAction]) {
    if !r.on {
      // Off from any genuine PS, whatever the session: it is only ever safer. XPC keeps one connection's
      // messages in order, so an off never overtakes the on that follows it.
      var acts: [LidAction] = []
      if on { acts += stop(.off) } else if dirty { acts.append(.set(false)) }
      latch(r.session, .off)
      return (["ok": true, "on": false], acts)
    }
    guard allowed else { return (["ok": false, "on": on, "why": LidStop.notAllowed.rawValue], []) }
    if let s = stopped.last(where: { $0.session == r.session }) {
      return (["ok": false, "on": false, "why": s.why.rawValue], [])
    }
    if let why = LidEngine.cutoff(power, floor: r.battery) {
      latch(r.session, why)
      var acts: [LidAction] = on ? stop(why) : [.log("lid keep awake: not turned on, \(why.logText)")]
      if !on && dirty { acts.append(.set(false)) }
      return (["ok": false, "on": false, "why": why.rawValue], acts)
    }
    session = r.session; floor = r.battery; renewedAt = now
    if on { return (["ok": true, "on": true], []) }
    on = true; dirty = true; toldReassert = false
    return (["ok": true, "on": true], [.set(true), .log("lid keep awake: on (Sentry mode, battery floor \(floor)%)")])
  }

  /// The kernel did not take `on`: off again, and that session is done.
  func applyFailed() -> [LidAction] {
    guard on else { return [] }
    return stop(.failed)
  }

  /// The reply PS gets right after a request, once the actions ran (a failed set changes it).
  var replyNow: [String: Any] {
    if on { return ["ok": true, "on": true] }
    if let s = session.flatMap({ s in stopped.last(where: { $0.session == s }) }) { return ["ok": false, "on": false, "why": s.why.rawValue] }
    return ["ok": true, "on": false]
  }

  /// Every 2 s. `actual`: the kernel setting now (nil when it could not be read).
  func tick(now: Double, power: LidPower, actual: Bool?) -> [LidAction] {
    if on {
      if now - renewedAt > LidEngine.lease { return stop(.lease) }
      if let why = LidEngine.cutoff(power, floor: floor) { return stop(why) }
      if actual == false {
        let first = !toldReassert; toldReassert = true
        return [.set(true)] + (first ? [.log("lid keep awake: macOS set it back to off, setting it on again")] : [])
      }
      toldReassert = false
      return []
    }
    if dirty {
      if actual == false { dirty = false; toldRetryOff = false; return [] }
      let first = !toldRetryOff; toldRetryOff = true
      return [.set(false)] + (first ? [.log("lid keep awake: still on after turning it off, trying again")] : [])
    }
    return []
  }

  /// The helper is stopping (switched off, removed, the Mac shutting down): off if we may have it on.
  func stopping() -> [LidAction] {
    let was = on
    on = false
    if let s = session { latch(s, .off) }
    return (was || dirty) ? [.set(false), .log("lid keep awake: off, the helper is stopping")] : []
  }

  private func stop(_ why: LidStop) -> [LidAction] {
    on = false
    if let s = session { latch(s, why) }
    return [.set(false), .log("lid keep awake: off, \(why.logText)")]
  }

  private func latch(_ s: String, _ why: LidStop) {
    if stopped.contains(where: { $0.session == s }) { return }
    stopped.append((s, why))
    if stopped.count > 16 { stopped.removeFirst(stopped.count - 16) }
  }
}

// MARK: Sentry mode's restart deadline (V1.48)
//
// The developer: if nobody unlocks Sentry mode within the set time (8 hours unless he changes it), the Mac restarts by itself,
// back to the FileVault password, so a Mac stolen in Sentry mode ends up locked down. Unlike the lid lease, PS does
// not have to keep asking: once armed, the deadline fires even if PS is killed, hangs or crashes. Only PS's cancel
// (after a real Touch ID or password unlock) clears it, a real macOS unlock seen by the helper, or a new boot.
//   - Kept on disk with the boot it was armed in and counted on the continuous clock (sleep counts). A deadline from
//     an earlier boot is dropped at once: after the restart there is nothing left to fire, so never a boot loop, and
//     never a restart from Before First Unlock.
//   - It fires only when the helper has seen someone signed in during this boot (the auto reboot's hard guard).
//   - 5 minutes to 7 days.

struct SentryDeadline: Codable, Equatable {
  var boot: String
  var at: Double          // continuous seconds since boot
  var armedWall: Double   // when it was armed, wall clock (for the log and the reply)
  var seconds: Double
}

enum SentryRestartRequest: Equatable {
  case arm(Double), cancel, read
  /// {op: "arm", seconds: N} | {op: "cancel"} | {op: "read"}; nil for anything else.
  static func parse(_ j: [String: Any]) -> SentryRestartRequest? {
    guard let op = j["op"] as? String else { return nil }
    switch op {
    case "arm":
      guard j.count == 2, let n = j["seconds"] as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
      let s = n.doubleValue
      return s.isFinite ? .arm(s) : nil
    case "cancel": return j.count == 1 ? .cancel : nil
    case "read": return j.count == 1 ? .read : nil
    default: return nil
    }
  }
}

enum SentryRestart {
  static let range = 300.0...(7 * 86400.0)

  enum Due: Equatable { case none, fire, drop(String) }

  /// A new deadline, or nil when the time is outside 5 minutes to 7 days.
  static func arm(seconds: Double, boot: String, now: Double, wall: Double) -> SentryDeadline? {
    guard range.contains(seconds), !boot.isEmpty else { return nil }
    return SentryDeadline(boot: boot, at: now + seconds, armedWall: wall, seconds: seconds)
  }

  /// At helper start: keep only a deadline of this very boot. `damaged`: the file is there but unreadable.
  static func loaded(_ d: SentryDeadline?, damaged: Bool, boot: String) -> (keep: SentryDeadline?, log: String?) {
    if damaged { return (nil, "Sentry restart: the saved deadline is unreadable, dropped") }
    guard let d else { return (nil, nil) }
    if d.boot != boot { return (nil, "Sentry restart: the deadline was from an earlier boot, cleared (no restart from Before First Unlock)") }
    return (d, "Sentry restart: deadline kept from before the helper restarted")
  }

  /// Every check. `signedIn`: the helper saw someone signed in and unlocked during this boot.
  static func due(_ d: SentryDeadline?, boot: String, now: Double, signedIn: Bool) -> Due {
    guard let d else { return .none }
    if d.boot != boot { return .drop("Sentry restart: the deadline was from an earlier boot, cleared") }
    guard now >= d.at else { return .none }
    if !signedIn { return .drop("Sentry restart: due, but no sign in is written down in this boot, so no restart (Before First Unlock)") }
    return .fire
  }

  /// A real unlock clears it by itself (the manager, for the developer): the console went from locked, or the login window, to
  /// unlocked. While Sentry mode is engaged macOS is unlocked under PS's cover, so only an unlock after a real macOS
  /// lock counts, and that needs the developer's Touch ID or password; a thief cannot make one. This covers a PS that crashed
  /// and was never opened again, so nothing else would cancel it.
  static func unlockCancels(previous: ConsoleSession?, now: ConsoleSession) -> Bool {
    guard let previous else { return false }
    return previous != .unlocked && now == .unlocked
  }

  /// The wall clock time to wake the Mac for it (whole seconds, at least 30 s ahead), worked out again before every
  /// sleep so a wall clock change cannot move it.
  static func wakeWall(_ d: SentryDeadline, now: Double, wall: Double) -> Double {
    (wall + max(d.at - now, 30)).rounded(.up)
  }

  /// What PS gets back: {ok, deadline?: wall seconds, left?: seconds, why?}.
  static func reply(_ d: SentryDeadline?, now: Double, wall: Double, ok: Bool = true, why: String? = nil) -> [String: Any] {
    var r: [String: Any] = ["ok": ok]
    if let d { r["deadline"] = (wall + (d.at - now)).rounded(); r["left"] = max(0, d.at - now).rounded() }
    if let why { r["why"] = why }
    return r
  }
}

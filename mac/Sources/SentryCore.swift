// Sentry mode's pure rules (V1.48; web src/core/sentry.ts has the page's half and the same numbers).
// The developer, 11 Nov 2026: lock the Mac but keep it fully awake so AI jobs keep running in the background, even unplugged.
// No AppKit, no clock of its own, nothing held: tests/sentry-test.sh checks these directly while the developer uses the Mac.
import Foundation

/// The plan from the page (core/sentry.ts SentryPlan), checked.
struct SentryPlanN: Equatable {
  var lowStop = true
  var lowPct = 10
  /// Keep awake with the lid closed (SentryLid.swift). V1.49: on by default (core/sentry.ts SENTRY_DEFAULTS.lid); the
  /// page always sends the person's own choice. Without the helper Sentry mode still engages (SentryLid says so).
  var lid = true
  /// Restart if not unlocked, hours after engaging (0 off; SentryRules.restartHours). Default 8. From Sleep mode's AI
  /// Sentry mode button the page sends its Sleep mode time here instead (V1.52, default 18).
  var restartH = 8

  static func parse(_ any: Any?) -> SentryPlanN {
    var p = SentryPlanN()
    guard let d = any as? [String: Any] else { return p }
    if let b = d["lowStop"] as? Bool { p.lowStop = b }
    if let n = (d["lowPct"] as? NSNumber)?.doubleValue, n.isFinite { p.lowPct = max(SentryRules.lowMin, min(SentryRules.lowMax, Int(n.rounded()))) }
    if let b = d["lid"] as? Bool { p.lid = b }
    if let n = (d["restartH"] as? NSNumber)?.intValue, SentryRules.restartHours.contains(n) { p.restartH = n }
    return p
  }
}

enum SentryRules {
  /// How often the battery is read, seconds (core/sentry.ts MAC.powerEveryS).
  static let powerEvery: Double = 30
  static let lowMin = 5, lowMax = 50
  /// Restart if not unlocked: the hours offered (0 is Off; core/sentry.ts RESTART_HOURS).
  /// V1.52: 18 added (the default under Sleep mode, core/sentry.ts restartSleepH).
  static let restartHours = [0, 1, 2, 4, 8, 12, 18, 24, 48, 72]
  // V1.52 (the developer): the Sentry screen never shows the restart time (no countdown line in any state), and there is no
  // Postpone anywhere (a thief could press it). The restart itself is unchanged: the helper holds the deadline.
  /// Which ends of Sentry mode cancel the restart: only a real unlock (Touch ID or the password, on the lock screen or
  /// the fallback sheet). Esc into the lock screen, the battery stop and a crash leave it armed.
  static func endCancelsRestart(_ why: String) -> Bool { why == "unlock" || why == "auth" }
  /// After engaging, how long PS waits to become the active app before it counts another app in front as a way past
  /// the cover (the click on the AI button and the Tab list going away settle first).
  static let settle: Double = 1.5
  /// How long PS waits for macOS to say the screen is locked after asking for the lock.
  static let lockWait: Double = 3
  /// The cover's backlight while dimmed (0 to 1), on screens whose brightness PS can set; never above the person's own.
  /// sentry-real-lock (the developer, 12 Nov 2026: "fully black ... no matter what computer PS is installed on"): 0, the backlight
  /// off, on every Mac, on top of the pure black cover. The person's own brightness is saved before (and into the flag
  /// for the guard and the next launch), so 0 never sticks. Screens PS cannot set stay pure black pixels.
  static let dimBright: Float = 0
  /// V1.49 (the developer, 12 Nov 2026): the cover no longer dims by itself. The pointer resting on the Dim Screen button dims
  /// every screen smoothly; the moment it leaves, the screens fade back. Seconds for each fade (core/sentry.ts MAC).
  /// sentry-real-lock (the developer: "completely dark ... the moment your mouse leaves the button I want the screen to light up
  /// again"): quicker both ways, and back is the quickest.
  static let dimFade: Double = 0.35
  static let undimFade: Double = 0.2
  /// Brightness steps in a fade (spread evenly over its seconds).
  static let fadeSteps = 15
  /// The cover's words and buttons while dimmed (opacity, 0 to 1). sentry-real-lock (the developer): 0, nothing lit at all. The
  /// Dim Screen button itself, the shield, Unlock and the pointer are hidden too: pure black pixels on every screen
  /// (mini LED zones switch off). The button's area stays live while invisible.
  static let dimContent: Float = 0
  /// The Sentry screen's words. The headline is always exactly "Protected by PS": never the app's name or a rename.
  static let title = "Protected by PS"
  static let dimButton = "Dim Screen"
  static let dimLine = "Battery saver, dims screen to save on battery life"

  /// Dim Screen (sentry-real-lock, the developer 12 Nov 2026): dark exactly while the pointer rests on the button's area. A key,
  /// a click or a scroll brings the screen back at once and it stays lit (woke) until the pointer leaves the area; coming
  /// back onto it darkens again.
  struct DimState: Equatable {
    var dark = false
    var woke = false
  }
  static func dimNext(_ s: DimState, onButton: Bool, input: Bool) -> DimState {
    guard onButton else { return DimState() }
    if input || s.woke { return DimState(dark: false, woke: true) }
    return DimState(dark: true, woke: false)
  }

  /// Engaging now would stop at once, or the battery reached the stop level while engaged.
  static func batteryStops(_ p: SentryPlanN, onBattery: Bool, pct: Int?) -> Bool {
    guard p.lowStop, onBattery, let pct else { return false }
    return pct <= p.lowPct
  }
  /// Why the page's start is refused (nil: go). Codes the page turns into words (core/sentry.ts noteFor).
  static func refusal(protectedFront: Bool, canLock: Bool, screens: Int, plan: SentryPlanN, onBattery: Bool, pct: Int?) -> String? {
    if protectedFront { return "protected" }
    if !canLock { return "nolock" }
    if screens < 1 { return "screen" }
    if batteryStops(plan, onBattery: onBattery, pct: pct) { return "battery" }
    return nil
  }

  /// The new brightness for a dimmed screen: low, never brighter than it was.
  static func dimmed(from b: Float) -> Float { min(b, dimBright) }
  /// Ease in and out (0 to 1), for the brightness fades.
  static func ease(_ t: Double) -> Double { let x = max(0, min(1, t)); return x * x * (3 - 2 * x) }
  /// Step i of n of a fade from a to b (the last step is exactly b, so the person's brightness comes back exactly).
  static func fadeStep(from a: Float, to b: Float, step i: Int, of n: Int) -> Float {
    guard n > 0, i < n else { return b }
    return a + (b - a) * Float(ease(Double(max(0, i)) / Double(n)))
  }

  /// "Engaged for 2 h 05" (the line on the lit cover).
  static func engagedFor(since: Double, now: Double) -> String {
    let m = max(0, Int(floor((now - since) / 60)))
    if m < 1 { return "Engaged just now" }
    let h = m / 60, mi = m % 60
    return h > 0 ? (mi > 0 ? "Engaged for \(h) h \(String(format: "%02d", mi))" : "Engaged for \(h) h") : "Engaged for \(mi) min"
  }
  static func powerLine(onBattery: Bool, pct: Int?) -> String {
    guard onBattery else { return "on power" }
    return pct.map { "on battery at \($0)%" } ?? "on battery"
  }

  /// The lid keep awake stopped by itself (SentryLid.StopReason as a code for the page and the log).
  static func lidCode(_ r: SentryLid.StopReason) -> String {
    switch r {
    case .batteryLow: return "batteryLow"
    case .tooHot: return "tooHot"
    case .helperMissing: return "helperMissing"
    case .refused: return "refused"
    case .other: return "other"
    }
  }
  // V1.54 (the developer): no lid text on the Sentry screen, ever. A stop during Sentry mode is logged, and its code goes to the
  // page with the end of Sentry mode, so the Tab list says it once after the unlock (core/sentry.ts noteFor).

  // MARK: crash safety (the "sentry active" flag)

  /// What the flag file holds while Sentry mode is engaged: who engaged it, when this Mac last started (a restart
  /// since means macOS asked for the password at login anyway), and the brightness to give back.
  struct Flag: Equatable {
    var pid: Int32
    var since: Double
    var boot: Double
    var bright: [UInt32: Float] = [:]
    /// Restart if not unlocked was armed: whoever finds this flag cancels it only after a real unlock.
    var restart = false
    func json() -> Data {
      let b = Dictionary(uniqueKeysWithValues: bright.map { (String($0.key), Double($0.value)) })
      let d: [String: Any] = ["pid": Int(pid), "since": since, "boot": boot, "bright": b, "restart": restart]
      return (try? JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])) ?? Data("{}".utf8)
    }
    static func parse(_ data: Data?) -> Flag? {
      guard let data, let d = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
            let pid = (d["pid"] as? NSNumber)?.int32Value, let since = (d["since"] as? NSNumber)?.doubleValue else { return nil }
      var f = Flag(pid: pid, since: since, boot: (d["boot"] as? NSNumber)?.doubleValue ?? 0)
      f.restart = d["restart"] as? Bool ?? false
      for (k, v) in (d["bright"] as? [String: Any]) ?? [:] {
        if let id = UInt32(k), let n = (v as? NSNumber)?.floatValue, n.isFinite, n >= 0, n <= 1 { f.bright[id] = n }
      }
      return f
    }
  }
  /// At PS's launch with a flag left behind (PS quit or crashed while engaged): lock the Mac at once unless it is
  /// already locked, or the Mac restarted since (then macOS already asked for the password at login).
  enum Recovery: Equatable { case nothing, lockNow, alreadySafe }
  static func recovery(flag: Flag?, bootNow: Double, screenLocked: Bool) -> Recovery {
    guard let flag else { return .nothing }
    if flag.boot > 0, bootNow > 0, abs(flag.boot - bootNow) > 2 { return .alreadySafe }   // restarted since
    return screenLocked ? .alreadySafe : .lockNow
  }
  /// The guard process (PS's own binary, `--ps-sentry-guard <pid> <flag>`) when its PS is gone: lock if the flag is
  /// still there (PS did not end Sentry mode itself), else just leave.
  static func guardActs(flagExists: Bool) -> Bool { flagExists }
}

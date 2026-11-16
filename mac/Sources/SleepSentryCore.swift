// AI Sentry mode from Sleep mode: the pure rules (V1.52; SleepSentry.swift draws it, web src/core/sentry.ts
// sleepSentry builds what the page sends). No AppKit, no clock of its own: tests/sleepsentry-test.sh checks these
// directly while the developer uses the Mac.
// The developer, 12 Nov 2026: "when you've engaged the sleep mode, on the left of your screen, and you can change this in the
// sleep settings, but by default have it on the left center of your screen, there's a little AI Sentry mode button and
// you can click that and then that button will turn into the Protected by PS shield symbol as well and then activate
// the AI Sentry mode with sleep mode engaged."
import Foundation
import CoreGraphics

/** The plan's `sentry` part (core/sentry.ts SleepSentry), checked. Nil: an older page sent none (no button then). */
struct SleepSentryN {
  /// The restart check, one line each so Turn on restart can drop its own line (core/sentry.ts SleepSentryCheck).
  struct Check: Equatable {
    var title: String
    var helper: String?, restartOff: String?, autoOff: String?
    var consequence: String
    /// sentry-real-lock: FileVault off (its line, nil when on or unknown), and the title once only FileVault is left.
    var fileVault: String? = nil
    var fileVaultTitle = "FileVault is off"
    var fixHelper: Bool
    var setUp: String, turnOn: String, anyway: String, cancel: String
  }
  /// restartH is the Sleep mode time (core/sentry.ts restartSleepH, default 18 h): the helper deadline is armed with it.
  var plan = SentryPlanN(restartH: SleepSentryRules.restartSleepDef)
  var check: Check?
  var words: [String: String] = [:]
  var restartOn = SleepSentryRules.restartOnHours
  /// PS 1.65: AI Sentry mode starts by itself when Sleep mode starts (on until the person turns it off in Sleep settings).
  var auto = true
  /// PS 1.65: the person switched "keep awake with the lid closed" on themselves (core/sentry.ts lidSet). Only then does a
  /// Sentry mode that started by itself keep a closed Mac awake; the default never does.
  var autoLid = false

  static func parse(_ any: Any?) -> SleepSentryN? {
    guard let d = any as? [String: Any] else { return nil }
    var s = SleepSentryN()
    s.plan = SentryPlanN.parse(d["plan"])
    if ((d["plan"] as? [String: Any])?["restartH"] as? NSNumber) == nil { s.plan.restartH = SleepSentryRules.restartSleepDef }
    let str = { (v: Any?, n: Int) -> String? in (v as? String).map { String($0.prefix(n)) } }
    if let c = d["check"] as? [String: Any], let t = str(c["title"], 120) {
      s.check = Check(title: t, helper: str(c["helper"], 300), restartOff: str(c["restartOff"], 300), autoOff: str(c["autoOff"], 300),
                      consequence: str(c["consequence"], 300) ?? "", fixHelper: c["fixHelper"] as? Bool ?? false,
                      setUp: str(c["setUp"], 40) ?? "Set up the helper", turnOn: str(c["turnOn"], 40) ?? "Turn on restart",
                      anyway: str(c["anyway"], 40) ?? "Engage anyway", cancel: str(c["cancel"], 40) ?? "Cancel")
      s.check?.fileVault = str(c["fileVault"], 300)
      if let t = str(c["fileVaultTitle"], 120), !t.isEmpty { s.check?.fileVaultTitle = t }
    }
    for (k, v) in (d["words"] as? [String: Any]) ?? [:] where SleepSentryRules.words[k] != nil { if let x = str(v, 300) { s.words[k] = x } }
    if let a = d["auto"] as? Bool { s.auto = a }
    if let a = d["autoLid"] as? Bool { s.autoLid = a }
    if let n = (d["restartOn"] as? NSNumber)?.intValue, n > 0, SentryRules.restartHours.contains(n) { s.restartOn = n }
    return s
  }
  func word(_ k: String) -> String { words[k].flatMap { $0.isEmpty ? nil : $0 } ?? SleepSentryRules.words[k] ?? "" }
}

enum SleepSentryRules {
  /// Where the button sits (core/sentry.ts SENTRY_SPOTS). Default: the left, half way up.
  static let spots = ["left", "right", "bottomLeft", "bottomRight", "hidden"]
  static let spotDef = "left"
  /// V1.52 (the developer): Restart if not unlocked during Sleep mode, default 18 h (plain Sentry mode keeps 8 h). "Turn on
  /// restart" on the sleep screen sets it back to this (core/sentry.ts RESTART_ON_SLEEP_HOURS).
  static let restartSleepDef = 18
  static let restartOnHours = restartSleepDef
  /// The words the sleep screen says (the page sends the same in the plan; core/sentry.ts SLEEP_SENTRY_WORDS).
  /// "on" is always exactly "Protected by PS", like the Sentry screen's headline (SentryRules.title).
  static let words: [String: String] = [
    "button": "AI Sentry mode",
    "on": SentryRules.title,
    "tip": "AI Sentry mode: keeps your Mac awake and protected while you sleep. Leaving opens your Mac's lock screen.",
    "hint": "Wake up and Esc open your Mac's lock screen. Touch ID or your password there ends Sleep mode and Sentry mode.",
    "batteryStop": "On battery. Sentry mode keeps your Mac awake and locks it at {pct}%.",
    "batteryOn": "On battery. Sentry mode keeps your Mac awake.",
    "refusedProtected": "Sentry mode did not start: a protected app is in front.",
    "refusedBattery": "Sentry mode did not start: the battery is under your stop level. Plug in first.",
    "refusedNolock": "Sentry mode did not start: this macOS has no way for PS app to lock it.",
    "refusedOther": "Sentry mode did not start.",
    // V1.54 (lid-notice-154): the lid row of the pop up before engaging (core/sentry.ts LID_WARN).
    "lidTitle": "Your Mac will sleep when the lid is closed",
    "lidHelper": "Keeping your Mac awake with the lid closed needs the restart helper, and it is not on.",
    "lidRefused": "macOS did not let the restart helper keep your Mac awake with the lid closed. Setting the helper up again usually fixes it.",
    "lidSetUp": "Set up the helper",
    "lidAnyway": "Engage anyway",
    "lidCancel": "Cancel",
  ]
  static func okSpot(_ s: String?) -> String { s.flatMap { spots.contains($0) ? $0 : nil } ?? spotDef }

  /// The button's frame for a spot on a W x H screen (y up, as AppKit). Nil: hidden. The left and right sit half way
  /// up; the bottom corners sit above the battery and hint lines, clear of Wake up in the middle.
  static let margin: Double = 28, bottomY: Double = 70
  static func frame(spot: String, width W: Double, height H: Double, size: CGSize) -> CGRect? {
    let w = Double(size.width), h = Double(size.height)
    switch okSpot(spot) {
    case "left": return CGRect(x: margin, y: ((H - h) / 2).rounded(), width: w, height: h)
    case "right": return CGRect(x: W - margin - w, y: ((H - h) / 2).rounded(), width: w, height: h)
    case "bottomLeft": return CGRect(x: margin, y: bottomY, width: w, height: h)
    case "bottomRight": return CGRect(x: W - margin - w, y: bottomY, width: w, height: h)
    default: return nil
    }
  }
  /// The spots at the left or right edge (half way up or in a bottom corner): the clock keeps room for them on both sides.
  static func edgeSpot(_ s: String) -> Bool { okSpot(s) != "hidden" }
  /// The button hugs the screen's edge: its pill and shield sit on the left for the left spots, on the right otherwise.
  static func hugsLeft(_ spot: String) -> Bool { okSpot(spot) == "left" || okSpot(spot) == "bottomLeft" }

  /// What pressing it does: the restart check first when the restart would not work (the same as the AI button), else
  /// engage at once. V1.52 (the developer): no heat and bag warning, ever.
  enum Step: Equatable { case check, engage }
  static func firstStep(_ s: SleepSentryN) -> Step {
    s.check != nil ? .check : .engage
  }
  /// The check's lines in order (core/sentry.ts sleepCheckLines): why, the main Auto reboot note, what it means, then
  /// FileVault (sentry-real-lock).
  static func lines(_ c: SleepSentryN.Check) -> [String] { [c.helper, c.restartOff, c.autoOff, c.consequence, c.fileVault].compactMap { $0.flatMap { $0.isEmpty ? nil : $0 } } }
  /// After Turn on restart: what is still missing (nil: nothing, so engage now, as the AI button does). Only FileVault
  /// left: its own title and line, none of the restart's.
  static func afterTurnOn(_ c: SleepSentryN.Check) -> SleepSentryN.Check? {
    var left = c; left.restartOff = nil
    if c.helper != nil { return left }
    guard c.fileVault != nil else { return nil }
    left.autoOff = nil; left.consequence = ""; left.title = c.fileVaultTitle
    return left
  }

  /// V1.54 (helper-check-154): the fresh helper check found it on and answering, so the page's helper line was from
  /// before (the developer pressed the button right after switching it on). What is still missing (nil: nothing, so engage now).
  /// Only FileVault left: its own title and line, none of the restart's.
  static func afterHelperOK(_ c: SleepSentryN.Check) -> SleepSentryN.Check? {
    var left = c; left.helper = nil; left.fixHelper = false
    if c.restartOff != nil { return left }
    guard c.fileVault != nil else { return nil }
    left.autoOff = nil; left.consequence = ""; left.title = c.fileVaultTitle
    return left
  }

  /// PS 1.65 (the developer's friend, 17 Nov 2026): AI Sentry mode turns on by itself whenever Sleep mode starts, unless the person
  /// opted out (Sleep settings) or hid the button (Hidden is a no). Once per sleep screen, a real Sleep mode only (not an
  /// alarm alone), nothing already protecting, busy or asking. It needs nothing from a person: it arms no restart and keeps
  /// no closed lid awake by default (autoPlan), so the restart check's pop up is not for it.
  static func autoGo(_ s: SleepSentryN?, spot: String, alarmOnly: Bool, tried: Bool, on: Bool, busy: Bool, panel: Bool) -> Bool {
    guard let s, s.auto, !tried, !alarmOnly, !on, !busy, !panel else { return false }
    return okSpot(spot) != "hidden"
  }
  /// PS 1.65 (security review 17 Nov 2026): the plan an AUTOMATIC start uses. Nobody pressed the button, so the stricter rule
  /// wins everywhere: Sleep mode's own battery stop (sleepStopPct, 20 percent) always holds (the stop is on and never
  /// lower than it); a closed lid keeps the Mac awake only when the person switched that on themselves (`autoLid`), never by
  /// default; the restart if not unlocked is not armed (unsaved work is never lost to a start nobody asked for). Pressing the
  /// button keeps the person's own Sentry settings.
  static func autoPlan(_ s: SleepSentryN) -> SentryPlanN {
    var q = s.plan
    q.lowStop = true
    q.lowPct = max(s.plan.lowStop ? s.plan.lowPct : 0, sleepStopPct)
    q.lid = s.plan.lid && s.autoLid
    q.restartH = 0
    return q
  }
  /// Leaving Sleep mode (Wake up, Customise, Settings, Esc, the page): while Sentry protects it, only through the real
  /// lock screen; otherwise Touch ID or the password (Sleep's own lock), or at once when that is switched off.
  enum Leave: Equatable { case lockScreen, touchID, now }
  static func leave(protected: Bool, lock: Bool) -> Leave { protected ? .lockScreen : lock ? .touchID : .now }
  /// The reason Sentry gets for the lock: Esc is Esc, everything else is the person leaving (Unlock).
  static func lockWhy(_ sleepWhy: String) -> String { sleepWhy == "esc" ? "esc" : "unlock" }
  /// Sleep's close once macOS says locked and nothing on the sleep screen asked (Sentry locked for its own reason:
  /// another screen's Unlock, its battery, PS losing the front).
  static func closeWhy(lockWhy w: String) -> String {
    switch w {
    case "unlock": return "wake"
    case "esc": return "esc"
    case "battery": return "sentryBattery"
    default: return "locked"
    }
  }
  /// Sleep's close when Sentry mode ended while the sleep screen was still up (Touch ID on the fallback, its battery).
  static func endWhy(_ sentryWhy: String) -> String {
    switch sentryWhy {
    case "unlock", "auth": return "wake"
    case "battery": return "sentryBattery"
    case "esc": return "esc"
    default: return "locked"
    }
  }
  /// After these PS locks too (the padlock), the same as Esc in Sleep mode.
  static func locksPS(_ sleepWhy: String) -> Bool { sleepWhy == "esc" || sleepWhy == "locked" }

  /// Sleep mode's own battery stop, percent (the same as SleepRules.stopPct in SleepScreen.swift; the test checks they match).
  static let sleepStopPct = 20
  /// Sleep's own battery rule (stop at 20 percent) is replaced by Sentry's own while protected.
  static func sleepStops(protected: Bool, onBattery: Bool, pct: Int?) -> Bool { !protected && onBattery && (pct ?? 100) <= sleepStopPct }
  /// The battery line while protected: the stop level of the plan Sentry runs on (`p`, an automatic start's own), or that it
  /// keeps the Mac awake. Nil: on mains.
  static func batteryLine(_ s: SleepSentryN, plan p: SentryPlanN? = nil, onBattery: Bool) -> String? {
    guard onBattery else { return nil }
    let p = p ?? s.plan
    return p.lowStop ? s.word("batteryStop").replacingOccurrences(of: "{pct}", with: String(p.lowPct)) : s.word("batteryOn")
  }
  /// The sentence for a refusal code from Sentry (SentryRules.refusal).
  static func refusedLine(_ s: SleepSentryN?, code: String) -> String {
    let k = ["protected": "refusedProtected", "battery": "refusedBattery", "nolock": "refusedNolock"][code] ?? "refusedOther"
    return s?.word(k) ?? words[k] ?? ""
  }

  // MARK: V1.54 the lid row (lid-notice-154, kept apart from the restart check's own rules)

  /// The pop up's lid row. Before engaging with "keep awake with the lid closed" on, the Mac checks it really works
  /// (SentryLid.probe: "helper" or "refused"). A gap adds its line under the restart check's lines when that shows,
  /// else it is a pop up of its own. Both are fixed by Set up the helper (it also starts a fresh helper after an
  /// update). Nil: no lid row (lid off, or it works).
  struct LidPanel: Equatable { var title: String; var lines: [String] }
  static func lidPanel(_ c: SleepSentryN.Check?, gap: String?, _ s: SleepSentryN) -> LidPanel? {
    guard s.plan.lid, let g = gap, g == "helper" || g == "refused" else { return nil }
    let line = s.word(g == "helper" ? "lidHelper" : "lidRefused")
    if let c { return LidPanel(title: c.title, lines: lines(c) + [line]) }
    return LidPanel(title: s.word("lidTitle"), lines: [line])
  }
  /// How long a lid check stands for one press (milliseconds): long enough to get through the pop up's buttons.
  static let lidCheckFor = 15_000.0
}

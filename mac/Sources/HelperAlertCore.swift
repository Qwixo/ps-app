// The restart helper pop up (V1.49, the developer 12 Nov 2026: "if for whatever reason the BFU timer/restart helper is NOT
// active, display it with a pop up immediately, the user HAS to be aware and reenable it, since it's been turned off
// multiple times without me even knowing."). The rules only, with no macOS calls, so tests/helper-alert-test.swift
// runs them offline. HelperAlert.swift reads AutoReboot, draws PS's own panel and takes Esc.
//
//  - Not active means: never set up, switched off under Allow in the Background, switched off by macOS after an
//    update, or switched on but not answering (several asks in a row; a helper that fails its own signature check
//    says so as the reason). A build with no helper inside, a self test copy and Safe Mode never count.
//  - It shows for every owner (public build too) while auto reboot is on or Sentry mode's restart if not unlocked is
//    on (the default, 8 hours). It replaces the V1.45 "switched off after the update" card: one pop up, never two.
//  - Never over 1Password or Signal (it waits until neither is in front), never over Sleep mode, Sentry mode or the
//    lock screen. Esc or its x closes it until the next check; Remind me in 1 hour, for an hour.
//  - When the helper is back it closes itself with a short "Restart helper is on".
//  - V1.51: a helper macOS lists as on that does not answer is first repaired by PS itself (HelperRepairCore.swift:
//    off and on, the way the developer fixed it by hand). The pop up waits for that and only asks when it did not help: then
//    it offers Try again, or says plainly when macOS wants the owner's OK again.
import Foundation

/// Why the restart helper is not active.
enum HelperProblem: String, Equatable, CaseIterable {
  case notSetUp       // never registered on this Mac
  case switchedOff    // switched off under Allow in the Background (System Settings)
  case offByUpdate    // it ran in an older build: macOS switched it off after the update
  case notAnswering   // macOS lists it as on, but it did not answer several times in a row
  case wrongPin       // not answering, and the helper inside this app fails its own signature check
  case approveAgain   // V1.51: PS repaired it (off and on), and macOS now wants the owner's OK again
}

/// What PS knows about the helper right now (AutoReboot).
struct HelperFacts: Equatable {
  var state: String            // AutoReboot.helperState: on, approve, off, missing, test
  var offBy: HelperOffBy? = nil
  var failures = 0             // asks in a row with no answer while macOS says on
  var safeMode = false         // the helper answered from Safe Mode (it does nothing there, on purpose)
  var pinOK: Bool? = nil       // the helper inside this app passes its signature check (nil: not checked)
  var repair: HelperRepairResult? = nil   // V1.51: what PS's own repair came to in this run
}

/// What the pop up remembers. `snoozeUntil` is saved (Remind me in 1 hour survives a PS restart).
struct HelperAlertMemo: Equatable {
  var snoozeUntil: Double = 0   // seconds since 1970
  var quietUntil: Double = 0    // Esc or its x: closed until the next check
}

enum HelperAlertStep: Equatable {
  case show(HelperProblem)
  case wait(String)    // a problem, but not now (1Password or Signal in front, Sleep mode, Sentry mode, locked)
  case hide(String)    // nothing to show
}

/// The words, in plain English (no em or en dashes; tests check).
struct HelperAlertText: Equatable {
  var title: String
  var line: String
  var reason: String
  var button: String
  var steps: [String]
  var later: String
  var retry = false   // V1.51: the Try again button (PS repairs it again)
}

enum HelperAlertCore {
  /// Asks in a row with no answer before "not answering" (PS asks again 15 s after a miss, so about 30 s).
  static let failLimit = 3
  /// How soon PS asks again after a miss while macOS says on.
  static let retryAfter: TimeInterval = 15
  /// Remind me in 1 hour.
  static let snooze: TimeInterval = 3600
  /// "The next check" after Esc or the x (PS reads macOS every minute, every 3 s while it waits for approval).
  static let checkEvery: TimeInterval = 60
  /// The "Restart helper is on" confirmation stays this long, then fades out by itself (a click or Esc closes it sooner).
  static let backOnFor: TimeInterval = 3
  /// Backstop for the panel: a confirmation still up this long, or a hidden panel still on screen this long, is
  /// taken away whatever else happened (ScreenGuard rule: no invisible window left covering anything).
  static let backOnMax: TimeInterval = 6
  static let hiddenGrace: TimeInterval = 1
  /// After the main button, the confirmation also shows when the pop up was closed meanwhile.
  static let fixWindow: TimeInterval = 15 * 60

  static func problem(_ f: HelperFacts) -> HelperProblem? {
    switch f.state {
    case "off": return .notSetUp
    case "approve":
      if f.repair == .needsApproval { return .approveAgain }
      return f.offBy == .update ? .offByUpdate : .switchedOff
    case "on":
      guard f.failures >= failLimit, !f.safeMode else { return nil }
      return f.pinOK == false ? .wrongPin : .notAnswering
    default: return nil   // "missing" (no helper in this build) and "test" (a self test copy)
    }
  }

  /// Whether anything depends on the helper: auto reboot on (Watch only or Active), or Sentry's restart on.
  static func wanted(mode: String, sentryRestartH: Int) -> Bool { mode != "off" || sentryRestartH > 0 }

  /// Security, "Remind me to set up the restart helper" (open source build; UserDefaults helperAlert.remind): on unless
  /// switched off. Nothing stored yet is on, so existing Macs see no change.
  static let remindKey = "helperAlert.remind"
  static func remindOn(_ stored: Any?) -> Bool { (stored as? Bool) ?? true }

  static func step(problem: HelperProblem?, wanted: Bool, now: Double, memo: HelperAlertMemo,
                   protectedFront: Bool, covered: String?, testCopy: Bool, repairing: Bool = false, remind: Bool = true) -> HelperAlertStep {
    if testCopy { return .hide("a self test copy") }
    guard let p = problem else { return .hide("the helper is on") }
    if !wanted { return .hide("auto reboot and Sentry mode's restart are both off") }
    if !remind { return .hide("Remind me to set up the restart helper is off") }
    if now < memo.snoozeUntil { return .hide("Remind me in 1 hour") }
    if now < memo.quietUntil { return .hide("closed, back on the next check") }
    // V1.51: PS first repairs it itself; the owner is asked only when that did not help.
    if repairing { return .wait("PS is repairing the helper") }
    if protectedFront { return .wait("1Password or Signal is in front") }
    if let covered { return .wait(covered) }
    return .show(p)
  }

  /// Esc or the x: back on the next check, not on the next 3 s poll.
  static func closed(_ m: HelperAlertMemo, now: Double) -> HelperAlertMemo {
    var m = m; m.quietUntil = now + checkEvery; return m
  }
  /// Remind me in 1 hour.
  static func later(_ m: HelperAlertMemo, now: Double) -> HelperAlertMemo {
    var m = m; m.snoozeUntil = now + snooze; m.quietUntil = 0; return m
  }
  /// The helper is on again: the next problem shows at once (no snooze carried over).
  static func cleared(_ m: HelperAlertMemo) -> HelperAlertMemo { HelperAlertMemo() }

  /// The helper came back: the short "Restart helper is on" shows if the pop up was up, or its main button was
  /// clicked in the last 15 minutes (the owner went to System Settings and switched it on).
  static func confirmBack(wasProblem: Bool, nowProblem: Bool, up: Bool, fixedAgo: Double?) -> Bool {
    guard wasProblem, !nowProblem else { return false }
    return up || (fixedAgo.map { $0 >= 0 && $0 <= fixWindow } ?? false)
  }

  // MARK: words

  static let title = "Your restart helper is off"
  static let later = "Remind me in 1 hour"
  static let backOn = "Restart helper is on"
  static func backOnSub(autoReboot: Bool, sentry: Bool) -> String {
    if autoReboot && sentry { return "Auto reboot and Sentry mode's restart protect this Mac again." }
    if sentry { return "Sentry mode's restart protects this Mac again." }
    return "Auto reboot protects this Mac again."
  }
  /// V1.52 (the developer): macOS sometimes needs the switch OFF and then ON again even when it already looks on, so every guide
  /// says so in these words.
  static let again = "If it already looks on, switch it off and then on again."
  static let waitingNote = "Waiting for you to switch it on. \(again) This closes by itself."

  static func line(autoReboot: Bool, sentry: Bool) -> String {
    if autoReboot && sentry { return "Auto reboot and Sentry mode's restart cannot protect this Mac until it is back on." }
    if sentry { return "Sentry mode's restart cannot protect this Mac until it is back on." }
    return "Auto reboot cannot protect this Mac until it is back on."
  }

  static func reason(_ p: HelperProblem, app: String, repaired: Bool = false) -> String {
    switch p {
    case .notSetUp: return "It is not set up on this Mac yet."
    case .switchedOff: return "It is switched off in System Settings."
    case .offByUpdate: return "macOS switched it off after the update."
    case .notAnswering:
      return repaired ? "macOS lists it as on, but it is still not answering after \(app) restarted it."
                      : "macOS lists it as on, but it is not answering."
    case .wrongPin: return "The helper inside this copy of \(app) does not pass its signature check."
    case .approveAgain: return "\(app) restarted the helper, and macOS now wants your OK again."
    }
  }

  static func button(_ p: HelperProblem) -> String {
    switch p {
    case .notSetUp: return "Set up the restart helper"
    case .switchedOff, .offByUpdate, .notAnswering, .approveAgain: return "Open System Settings"
    case .wrongPin: return "Check for Updates"
    }
  }

  static func steps(_ p: HelperProblem, app: String) -> [String] {
    switch p {
    case .notSetUp:
      return ["Click Set up the restart helper.", "Find \(app) under Allow in the Background.", "Switch \(app) on. \(again)"]
    case .switchedOff, .offByUpdate, .approveAgain:
      return ["Click Open System Settings.", "Find \(app) under Allow in the Background.", "Switch \(app) on. \(again)"]
    case .notAnswering:
      return ["Click Open System Settings.", "Find \(app) under Allow in the Background.", "It looks on, but it is not working. Switch \(app) off and then on again."]
    case .wrongPin:
      return ["Click Check for Updates.", "Install the newest \(app).", "If this stays, download \(app) again."]
    }
  }

  /// What the main button does: "setup" (register and open Login Items), "settings" (just open it) or "update".
  /// approveAgain only opens it: PS has just registered it, so registering again would change nothing.
  static func action(_ p: HelperProblem) -> String {
    switch p {
    case .notSetUp, .switchedOff, .offByUpdate: return "setup"
    case .notAnswering, .approveAgain: return "settings"
    case .wrongPin: return "update"
    }
  }

  /// V1.51: Try again (PS repairs it once more) only for a helper that is listed as on and does not answer.
  static func retry(_ p: HelperProblem) -> Bool { p == .notAnswering }

  static func text(_ p: HelperProblem, app: String, autoReboot: Bool, sentry: Bool, repaired: Bool = false) -> HelperAlertText {
    HelperAlertText(title: title, line: line(autoReboot: autoReboot, sentry: sentry), reason: reason(p, app: app, repaired: repaired),
                    button: button(p), steps: steps(p, app: app), later: later, retry: retry(p))
  }
}

extension HelperAlertCore {
  /// Every problem's steps (tests).
  static func allSteps(app: String = "PS") -> [[String]] { HelperProblem.allCases.map { steps($0, app: app) } }
}

/// The "Restart helper is on" confirmation's life (fix, the developer 12 Nov 2026: it stayed stuck on screen). It shows at most
/// once per stretch of the helper being off (never again for the same on state), only after a real off to on, and
/// it is due to go `backOnFor` seconds after it appeared.
struct HelperBackOn: Equatable {
  var episode = 0        // one per stretch of being off
  var confirmed = 0      // the last episode whose confirmation was claimed
  var shownAt: Double?   // on screen since (nil: not showing)

  /// The helper went from fine to a problem.
  mutating func wentOff() { episode += 1 }
  /// The helper is back: true once for this episode (the caller then shows it), false ever after.
  mutating func claim() -> Bool {
    guard episode > confirmed else { return false }
    confirmed = episode
    return true
  }
  mutating func appeared(_ now: Double) { shownAt = now }
  mutating func gone() { shownAt = nil }
  /// Time to fade out by itself.
  func due(_ now: Double) -> Bool { shownAt.map { now - $0 >= HelperAlertCore.backOnFor } ?? false }
  /// The backstop: up far too long, whatever the timers did.
  func overdue(_ now: Double) -> Bool { shownAt.map { now - $0 >= HelperAlertCore.backOnMax } ?? false }
}

extension HelperAlertCore {
  /// A panel still on screen although nothing should show (hidden for over `hiddenGrace`): remove it.
  static func staleWindow(onScreen: Bool, shouldShow: Bool, hiddenFor: Double?) -> Bool {
    onScreen && !shouldShow && (hiddenFor ?? .infinity) >= hiddenGrace
  }
}

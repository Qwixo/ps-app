// The restart helper repairs itself (V1.51; the developer, 12 Nov 2026: "PS app is still actually enabled in the security
// settings and to get it to support it again you have to unenable it and then re-enable it"). The rules only, with no
// macOS calls, so tests/helper-repair-test.swift runs them offline. AutoReboot.swift does the repair.
//
// The cause, read from the Mac's own log on 11 Nov 2026 (launchd, smd and backgroundtaskmanagementd):
//  - V1.48 changed the helper, so its code signature changed. launchd's job for it still carried the old helper's
//    launch rule ("have LWCR=true"), so the new helper was refused at launch ("Launch Constraint Violation"), and
//    macOS could not clean up its own record ("Unable to invalidate item": PS has no Apple team ID).
//  - From then on launchd kept a broken job: every few seconds "Could not find and/or execute program specified by
//    service: No such process: Contents/Resources/rebootd", while System Settings and SMAppService said enabled.
//    PS's asks went to that job and simply never got an answer ("no answer in 10 s").
//  - Set up (register) and switching PS app on again did not replace the broken job ("found existing item"). Only
//    switching it OFF removed it ("removing service: com.cincee.ps.rebootd"), and switching it ON submitted a fresh
//    one that started at once ("Successfully spawned rebootd").
//  - A plain update with the same pinned helper is fine: the helper restarts itself after the update and launchd
//    starts it again (seen after V1.50). The breakage stays from the last helper change until someone does off, on.
// So PS now does the off and on itself: SMAppService unregister (launchd drops the broken job) then register (a
// fresh job). Only for a helper macOS lists as on that does not answer, at most once per build by itself, plus the
// pop up's Try again with a growing wait. Never in a loop.
import Foundation

/// What the last repair came to.
enum HelperRepairResult: String, Equatable {
  case fixed          // registered again and it answers
  case needsApproval  // registered again, and macOS wants the owner's OK again in System Settings
  case stillDead      // registered again, macOS lists it as on, and it still does not answer
  case failed         // macOS refused to register it again (the error is in the log)
}

/// What AutoReboot knows when it decides whether to repair by itself.
struct HelperRepairFacts: Equatable {
  var state: String              // AutoReboot.helperState: on, approve, off, missing, test
  var failures = 0               // asks in a row with no answer while macOS says on
  var safeMode = false
  var pinOK: Bool? = nil         // the helper inside this app passes its signature check (nil: not checked yet)
  var testCopy = false
  var running = false            // a repair is under way
  var triedThisLaunch = false    // PS already repaired by itself in this run
  var lastAutoBuild = ""         // the build that last repaired by itself ("" never)
  var build = ""                 // this build (CFBundleVersion)
}

enum HelperRepairCore {
  /// The broken job: macOS lists the helper as on, and it did not answer HelperAlertCore.failLimit times in a row.
  /// Not in Safe Mode (the helper answers there and does nothing on purpose), and not for a helper that fails its
  /// own signature check (registering it again cannot help; only a fresh copy of PS can).
  static func broken(state: String, failures: Int, safeMode: Bool, pinOK: Bool?) -> Bool {
    state == "on" && failures >= HelperAlertCore.failLimit && !safeMode && pinOK != false
  }

  /// Repair by itself now? Once per build (kept across launches) and never twice in one run.
  static func shouldAuto(_ f: HelperRepairFacts) -> Bool {
    guard !f.testCopy, !f.running, !f.triedThisLaunch else { return false }
    guard broken(state: f.state, failures: f.failures, safeMode: f.safeMode, pinOK: f.pinOK) else { return false }
    return f.build.isEmpty || f.lastAutoBuild != f.build
  }

  /// How long Try again waits after the last repair: 30 s, then 2 minutes, then 10 minutes for every one after.
  /// `tries` counts the repairs PS made in this run (by itself and by Try again).
  static func manualWait(tries: Int) -> TimeInterval {
    switch tries {
    case ..<1: return 0
    case 1: return 30
    case 2: return 120
    default: return 600
    }
  }
  /// Seconds left before Try again works (0: now).
  static func waitLeft(running: Bool, tries: Int, lastEnded: Double?, now: Double) -> TimeInterval {
    if running { return .infinity }
    guard let lastEnded else { return 0 }
    return max(0, lastEnded + manualWait(tries: tries) - now)
  }

  /// What macOS and the helper said after register.
  static func outcome(state: String, answered: Bool, registerError: Bool) -> HelperRepairResult {
    if state == "approve" { return .needsApproval }
    if state == "on" { return answered ? .fixed : .stillDead }
    return registerError ? .failed : .stillDead
  }

  /// Set up for a helper that ran here before and now waits for approval: unregister first, so launchd drops a job it
  /// can no longer start, and the owner's switch on in System Settings starts a fresh one. On 11 Nov 2026 this was the
  /// V1.48 helper change, logged as "switched off by System Settings" (the old helper had answered the new build for a
  /// few minutes before it restarted itself and was refused), so it goes by "ran here before", not by the build.
  /// Never for a first set up, which has no old job to drop.
  static func cleanSetUp(wasOn: Bool, state: String) -> Bool { wasOn && state == "approve" }

  // MARK: words (no em or en dashes; tests check)

  static let retry = "Try again"
  static let retrying = "Restarting the helper"
  static func retryLabel(waitLeft: TimeInterval) -> String {
    guard waitLeft > 0, waitLeft.isFinite else { return waitLeft.isFinite ? retry : retrying }
    if waitLeft < 60 { return "Try again in \(Int(waitLeft.rounded(.up))) s" }
    return "Try again in \(Int((waitLeft / 60).rounded(.up))) min"
  }
}

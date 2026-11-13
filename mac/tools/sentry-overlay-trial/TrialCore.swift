// Sentry overlay trial: the pure rules (sentry-real-lock, the developer 12 Nov 2026, option d: "Protected by PS" shown ABOVE the
// real macOS lock screen). No AppKit, no clock of its own, nothing held, so tests/sentry-overlay-trial-test.sh checks it
// while the developer uses the Mac. main.swift next to it is the trial itself. Neither is part of PS.app (build.sh compiles
// Sources/ only).
//
// The rules that keep it from ever being a backdoor:
//  - It shows nothing until macOS itself says the screen is locked (never a cover over an unlocked Mac).
//  - Once shown, macOS saying unlocked ends it at once.
//  - Any touch, click or key (the system's input idle time, never the keys themselves) puts it aside so Apple's own
//    Touch ID or password prompt is what shows. It comes back only after a quiet spell.
//  - Anything it cannot read or do ends it: Apple's lock screen is simply there and the Mac stays locked.
import Foundation

enum TrialCore {
  struct Config: Equatable {
    /// Seconds to wait for macOS to say locked after asking for the lock (Sentry's own SentryRules.lockWait).
    var lockWait: Double = 3
    /// Quiet seconds after the lock before the PS screen first fades in (the click or key that started it settles).
    var firstIdle: Double = 2
    /// Quiet seconds after someone touched it before it comes back.
    var backIdle: Double = 10
    /// Input idle under this many seconds means someone just touched the Mac (it polls 5 times a second).
    var touched: Double = 0.6
    /// The trial ends by itself after this long, whatever happens (the Mac stays locked).
    var maxLife: Double = 600
  }

  enum Phase: Equatable {
    /// The lock was asked for; nothing is on screen.
    case waitingLock
    /// Locked, the PS screen is not showing (not yet, or put aside for Apple's prompt).
    case aside
    /// Locked, the PS screen shows above Apple's lock screen.
    case shown
  }

  enum Step: Equatable {
    case wait
    /// macOS said locked: from now on the PS screen may show.
    case locked
    case show
    case stepAside
    case quit(String)
  }

  /// Before locking anything: why the trial must not start (nil: go). It starts only from an unlocked Mac where it can
  /// read the input idle time and the SkyLight calls exist, so a missing piece never leaves a half done lock.
  static func refusal(lockedNow: Bool, idleReadable: Bool, skyLight: Bool, lockCall: Bool) -> String? {
    if lockedNow { return "the Mac is already locked" }
    if !lockCall { return "this macOS has no lock call" }
    if !idleReadable { return "cannot read the input idle time" }
    if !skyLight { return "the SkyLight calls are missing on this macOS" }
    return nil
  }

  /// One tick (5 times a second). idle: seconds since the last touch, click or key (nil: could not read it).
  static func step(_ p: Phase, everShown: Bool, locked: Bool, idle: Double?, sinceStart: Double, sinceLockAsked: Double,
                   c: Config = Config()) -> Step {
    if sinceStart >= c.maxLife { return .quit("the time limit") }
    guard let idle, idle.isFinite, idle >= 0 else { return .quit("could not read the input idle time") }
    switch p {
    case .waitingLock:
      if locked { return .locked }
      return sinceLockAsked >= c.lockWait ? .quit("macOS did not say locked in \(Int(c.lockWait)) s") : .wait
    case .aside:
      if !locked { return .quit("unlocked") }
      return idle >= (everShown ? c.backIdle : c.firstIdle) ? .show : .wait
    case .shown:
      if !locked { return .quit("unlocked") }
      return idle < c.touched ? .stepAside : .wait
    }
  }

  /// The phase after a step (a quit keeps it: the process ends).
  static func next(_ p: Phase, _ s: Step) -> Phase {
    switch s {
    case .locked: return .aside
    case .show: return .shown
    case .stepAside: return .aside
    case .wait, .quit: return p
    }
  }

  /// The watchdog on its own queue (it does not need the main thread): once it has seen the Mac locked, unlocked means
  /// end now; past the time limit (plus a margin), end now.
  static func watchdogQuits(sawLocked: Bool, lockedNow: Bool, sinceStart: Double, c: Config = Config()) -> Bool {
    (sawLocked && !lockedNow) || sinceStart >= c.maxLife + 5
  }

  /// The level macOS uses for Notification Center on the lock screen; the lock screen itself is 300
  /// (kSLSSpaceAbsoluteLevelNotificationCenterAtScreenLock, as Lakr233/SkyLightWindow lists it).
  static let spaceLevel: Int32 = 400
  static let screenLockLevel: Int32 = 300
}

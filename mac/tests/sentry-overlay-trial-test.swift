// Unit tests for the Sentry overlay trial (sentry-real-lock, option d). Run: bash tests/sentry-overlay-trial-test.sh
import Foundation

var passed = 0
func check(_ name: String, _ ok: Bool) {
  if ok { passed += 1; print("ok -", name) } else { print("FAIL -", name); exit(1) }
}
let dir = ProcessInfo.processInfo.environment["PS_MAC_DIR"] ?? FileManager.default.currentDirectoryPath
func read(_ f: String) -> String { (try? String(contentsOfFile: "\(dir)/\(f)", encoding: .utf8)) ?? "" }
typealias T = TrialCore
let c = T.Config()

// ---------- before locking anything ----------
check("starts only from an unlocked Mac with every piece there", T.refusal(lockedNow: false, idleReadable: true, skyLight: true, lockCall: true) == nil)
check("already locked: does not start", T.refusal(lockedNow: true, idleReadable: true, skyLight: true, lockCall: true) != nil)
check("no SkyLight, no idle time or no lock call: does not start (nothing half done)",
      T.refusal(lockedNow: false, idleReadable: true, skyLight: false, lockCall: true) != nil
      && T.refusal(lockedNow: false, idleReadable: false, skyLight: true, lockCall: true) != nil
      && T.refusal(lockedNow: false, idleReadable: true, skyLight: true, lockCall: false) != nil)

// ---------- never a cover over an unlocked Mac ----------
check("waiting for the lock: never shows, whatever the idle time", [0.0, 1, 5, 100].allSatisfy { T.step(.waitingLock, everShown: false, locked: false, idle: $0, sinceStart: 1, sinceLockAsked: 1) == .wait })
check("macOS says locked: only then may it show", T.step(.waitingLock, everShown: false, locked: true, idle: 9, sinceStart: 1, sinceLockAsked: 1) == .locked && T.next(.waitingLock, .locked) == .aside)
check("no lock in 3 s: ends without showing anything", { if case .quit = T.step(.waitingLock, everShown: false, locked: false, idle: 9, sinceStart: 3.1, sinceLockAsked: 3.1) { return true }; return false }())
check("unlocked while showing: ends at once", T.step(.shown, everShown: true, locked: false, idle: 30, sinceStart: 60, sinceLockAsked: 60) == .quit("unlocked"))
check("unlocked while aside: ends at once", T.step(.aside, everShown: true, locked: false, idle: 30, sinceStart: 60, sinceLockAsked: 60) == .quit("unlocked"))
check("the watchdog ends it on unlock after a lock was seen, and at the time limit", T.watchdogQuits(sawLocked: true, lockedNow: false, sinceStart: 5)
      && !T.watchdogQuits(sawLocked: false, lockedNow: false, sinceStart: 5) && !T.watchdogQuits(sawLocked: true, lockedNow: true, sinceStart: 5)
      && T.watchdogQuits(sawLocked: false, lockedNow: false, sinceStart: c.maxLife + 5))

// ---------- Apple's prompt always reachable ----------
check("first show waits for the starting click or key to settle", T.step(.aside, everShown: false, locked: true, idle: 1.9, sinceStart: 3, sinceLockAsked: 3) == .wait
      && T.step(.aside, everShown: false, locked: true, idle: 2, sinceStart: 3, sinceLockAsked: 3) == .show)
check("any touch, click or key while showing: steps aside", T.step(.shown, everShown: true, locked: true, idle: 0.1, sinceStart: 30, sinceLockAsked: 30) == .stepAside && T.next(.shown, .stepAside) == .aside)
check("quiet while showing: stays", T.step(.shown, everShown: true, locked: true, idle: 5, sinceStart: 30, sinceLockAsked: 30) == .wait)
check("after a touch it stays aside for 10 quiet seconds (typing a password keeps it away)", T.step(.aside, everShown: true, locked: true, idle: 9.9, sinceStart: 30, sinceLockAsked: 30) == .wait
      && T.step(.aside, everShown: true, locked: true, idle: 10, sinceStart: 30, sinceLockAsked: 30) == .show)
check("cannot read the idle time: ends (never a screen that cannot step aside)", { if case .quit = T.step(.shown, everShown: true, locked: true, idle: nil, sinceStart: 30, sinceLockAsked: 30) { return true }; return false }()
      && { if case .quit = T.step(.aside, everShown: true, locked: true, idle: .nan, sinceStart: 30, sinceLockAsked: 30) { return true }; return false }())
check("time limit: ends from any phase", [T.Phase.waitingLock, .aside, .shown].allSatisfy { T.step($0, everShown: true, locked: true, idle: 30, sinceStart: c.maxLife, sinceLockAsked: c.maxLife) == .quit("the time limit") })
check("the space sits one step above the lock screen", T.spaceLevel == 400 && T.screenLockLevel == 300)

// ---------- a whole run ----------
do {
  var p = T.Phase.waitingLock, shown = false, seen: [T.Step] = []
  // (locked, idle) every 0.2 s: lock arrives, settles, shows, a touch, typing, quiet, back, then Touch ID unlock
  let script: [(Bool, Double)] = [(false, 0.1), (true, 0.3), (true, 1), (true, 2.1), (true, 3), (true, 0.05), (true, 0.2), (true, 4), (true, 10.2), (true, 11), (false, 0.1)]
  for (i, (locked, idle)) in script.enumerated() {
    let s = T.step(p, everShown: shown, locked: locked, idle: idle, sinceStart: Double(i) * 0.2, sinceLockAsked: Double(i) * 0.2)
    if s == .show { shown = true }
    if s != .wait { seen.append(s) }
    p = T.next(p, s)
    if case .quit = s { break }
  }
  check("a whole run: locked, show, aside, show, then unlock ends it", seen == [.locked, .show, .stepAside, .show, .quit("unlocked")])
}

// ---------- the safety rules, read from the sources ----------
let main = read("tools/sentry-overlay-trial/main.swift"), core = read("tools/sentry-overlay-trial/TrialCore.swift"), run = read("tools/sentry-overlay-trial/run.sh")
check("decoration only: no password field, no Touch ID call, never the key window", !main.contains("LocalAuthentication") && !main.contains("LAContext")
      && !main.contains("NSSecureTextField") && !main.contains("makeKey") && main.contains("override var canBecomeKey: Bool { false }"))
check("never reads what was typed: only the idle time (no key monitor, no event tap)", !main.contains("addGlobalMonitorForEvents") && !main.contains("CGEvent.tapCreate")
      && !main.contains("override func keyDown") && main.contains("HIDIdleTime"))
check("aside means click through and invisible", main.contains("window.ignoresMouseEvents = !on") && main.contains("alphaValue = on ? 1 : 0"))
check("the lock is the same call PS uses", main.contains("SACLockScreenImmediate") && read("Sources/RemoteCommand.swift").contains("SACLockScreenImmediate"))
check("windows show only after macOS says locked (made then, or made invisible and click through)", main.contains("case .locked:") && main.contains("if covers.isEmpty { makeCovers() }")
      && main.contains("window.alphaValue = 0\n    window.ignoresMouseEvents = true"))
check("a watchdog off the main thread and the unlock notice both end it", main.contains("TrialCore.watchdogQuits") && main.contains("com.apple.screenIsUnlocked"))
check("macOS 27: SLSShowSpaces' result is logged, not trusted", main.contains("non zero is normal on macOS 27") && !main.contains("guard sh == 0"))
check("it changes no setting (no defaults, pmset, fdesetup, systemsetup)", ![main, run].contains { $0.contains("defaults write") || $0.contains("pmset") || $0.contains("fdesetup") || $0.contains("systemsetup") })
check("never in PS.app: build.sh compiles Sources/ only, and no shipping source uses SkyLight spaces",
      !read("build.sh").contains("sentry-overlay-trial") && read("build.sh").contains("\"$HERE\"/Sources/*.swift")
      && !(try! FileManager.default.contentsOfDirectory(atPath: "\(dir)/Sources")).contains { read("Sources/\($0)").contains("SLSSpace") })
check("run.sh waits for any other Swift build and can build without running", run.contains("pgrep -f 'swift-build|swiftc|xcodebuild'") && run.contains("--build-only"))
check("no em or en dashes", [main, core, run].allSatisfy { !$0.contains("\u{2014}") && !$0.contains("\u{2013}") })

print("\n\(passed) passed")

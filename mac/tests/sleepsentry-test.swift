// Unit tests for AI Sentry mode from Sleep mode (V1.52, Sources/SleepSentryCore.swift and the wiring around it).
// Nothing opens, locks, engages or is held, so it is safe while someone is using the Mac. Run: bash tests/sleepsentry-test.sh
import Foundation

var passed = 0
func check(_ name: String, _ ok: Bool) {
  if ok { passed += 1; print("ok -", name) } else { print("FAIL -", name); exit(1) }
}
let dir = ProcessInfo.processInfo.environment["PS_MAC_DIR"] ?? FileManager.default.currentDirectoryPath
func src(_ f: String) -> String { (try? String(contentsOfFile: "\(dir)/Sources/\(f)", encoding: .utf8)) ?? "" }
let sleep = src("SleepScreen.swift"), sentry = src("Sentry.swift"), ss = src("SleepSentry.swift"), core = src("SleepSentryCore.swift"), main = src("main.swift")

// ---------- the plan's part, as the page sends it (core/sentry.ts sleepSentry) ----------
let full: [String: Any] = [
  "plan": ["lowStop": true, "lowPct": 15, "lid": false, "restartH": 0],
  "check": ["title": "Auto restart is off", "helper": "The restart helper is not set up on this Mac.", "restartOff": "Restart if not unlocked is set to Off.",
            "autoOff": NSNull(), "consequence": "If this Mac is taken while in Sentry mode, it will not restart into its locked state.", "fixHelper": true,
            "setUp": "Set up the helper", "turnOn": "Turn on restart", "anyway": "Engage anyway", "cancel": "Cancel"],
  "words": ["button": "AI Sentry mode", "on": "Protected by PS", "junk": "x"],
  "restartOn": 18,
]
let s = SleepSentryN.parse(full)!
check("parse: the Sentry settings come with it", s.plan.lowPct == 15 && !s.plan.lid && s.plan.restartH == 0 && s.plan.lowStop)
check("parse: the restart check", s.check?.helper != nil && s.check?.restartOff != nil && s.check?.autoOff == nil && s.check?.fixHelper == true)
check("parse: unknown words are dropped, missing ones fall back", s.words["junk"] == nil && s.word("hint").hasPrefix("Wake up and Esc open your Mac's lock screen"))
check("parse: no part from an older page means no button", SleepSentryN.parse(nil) == nil && SleepSentryN.parse("x") == nil)
check("parse: a bare part has the Sentry defaults with the Sleep mode restart (18 h), no check", { let b = SleepSentryN.parse([:])!; return b.plan == SentryPlanN(restartH: 18) && b.check == nil && b.restartOn == 18 }())
check("the helper deadline under Sleep mode is the Sleep time the page sent (any offered time, 18 h included)", SleepSentryN.parse(["plan": ["restartH": 18]])!.plan.restartH == 18
      && SleepSentryN.parse(["plan": ["restartH": 0]])!.plan.restartH == 0 && SleepSentryN.parse(["plan": ["restartH": 12]])!.plan.restartH == 12)
check("18 h is a choice for plain Sentry mode too; plain stays 8 h by default", SentryRules.restartHours == [0, 1, 2, 4, 8, 12, 18, 24, 48, 72] && SentryPlanN.parse(["restartH": 18]).restartH == 18 && SentryPlanN.parse(nil).restartH == 8)
check("Turn on restart on the sleep screen sets 18 h", SleepSentryRules.restartOnHours == 18)
check("the shield's words are always exactly Protected by PS", SleepSentryRules.words["on"] == "Protected by PS" && SleepSentryRules.words["on"] == SentryRules.title)

// ---------- PS 1.65: it starts with Sleep mode by itself, opt out ----------
do {
  let on = SleepSentryN.parse([:])!
  let off = SleepSentryN.parse(["auto": false])!
  let gap = SleepSentryN.parse(full)!
  check("auto: on by default when the page says nothing", on.auto)
  check("auto: the page can switch it off", !off.auto && SleepSentryN.parse(["auto": true])!.auto)
  func go(_ n: SleepSentryN?, alarmOnly: Bool = false, tried: Bool = false, isOn: Bool = false, busy: Bool = false, panel: Bool = false) -> Bool {
    SleepSentryRules.autoGo(n, spot: "left", alarmOnly: alarmOnly, tried: tried, on: isOn, busy: busy, panel: panel)
  }
  check("auto: starts when Sleep mode is up and nothing is in the way", go(on))
  check("auto: never when switched off", !go(off))
  check("auto: never from an older page (no part)", !go(nil))
  check("auto: only once per sleep screen", !go(on, tried: true))
  check("auto: never for an alarm alone, when already protected, busy or with a pop up", !go(on, alarmOnly: true) && !go(on, isOn: true) && !go(on, busy: true) && !go(on, panel: true))
  check("auto: a restart gap means no pop up by itself, the button stays", !go(gap))
  check("auto: a helper gap found fresh stops it, a lid gap too, clean goes on",
        !SleepSentryRules.autoContinues(helperGap: true, lidGap: nil, lidOn: false)
        && !SleepSentryRules.autoContinues(helperGap: false, lidGap: "refused", lidOn: true)
        && SleepSentryRules.autoContinues(helperGap: false, lidGap: nil, lidOn: true))
  check("auto: the screen starts it once and quietly (source)", ss.contains("autoStartIfDue") && ss.contains("autoTried = true") && ss.contains("autoQuiet") && ss.contains("the button stays"))
}

// ---------- where it sits ----------
let sz = CGSize(width: 210, height: 92)
check("spot: the default is the left, half way up", SleepSentryRules.spotDef == "left" && SleepSentryRules.okSpot(nil) == "left" && SleepSentryRules.okSpot("middle") == "left")
check("spot: left centre", SleepSentryRules.frame(spot: "left", width: 1440, height: 900, size: sz) == CGRect(x: 28, y: 404, width: 210, height: 92))
check("spot: right centre hugs the right edge", SleepSentryRules.frame(spot: "right", width: 1440, height: 900, size: sz) == CGRect(x: 1440 - 28 - 210, y: 404, width: 210, height: 92))
check("spot: bottom corners sit above the battery and hint lines", SleepSentryRules.frame(spot: "bottomLeft", width: 1440, height: 900, size: sz)?.minY == 70
      && SleepSentryRules.frame(spot: "bottomRight", width: 1440, height: 900, size: sz)?.maxX == 1440 - 28)
check("spot: hidden has no frame", SleepSentryRules.frame(spot: "hidden", width: 1440, height: 900, size: sz) == nil)
check("spot: the left ones hug the left", SleepSentryRules.hugsLeft("left") && SleepSentryRules.hugsLeft("bottomLeft") && !SleepSentryRules.hugsLeft("right") && !SleepSentryRules.hugsLeft("bottomRight"))
check("spot: clear of Wake up in the middle on a 1280 point screen", { let f = SleepSentryRules.frame(spot: "bottomLeft", width: 1280, height: 800, size: sz)!; return f.maxX < (1280 - 460) / 2 }())

// ---------- pressing it: the same order as the AI button ----------
check("first press: the restart check when the restart would not work (no heat warning, ever)", SleepSentryRules.firstStep(s) == .check)
check("all fine: engages with no extra step", SleepSentryRules.firstStep(SleepSentryN.parse(["plan": [:]])!) == .engage)
check("V1.52 (the developer): no heat and bag warning anywhere on the sleep screen", !ss.contains("warnOK") && !ss.contains("showWarn") && !ss.contains("\\\"warned\\\"") && !core.contains("Warn:") && !ss.contains("very hot"))
check("check lines in order: why, then what it means", SleepSentryRules.lines(s.check!) == ["The restart helper is not set up on this Mac.", "Restart if not unlocked is set to Off.", "If this Mac is taken while in Sentry mode, it will not restart into its locked state."])
check("Turn on restart with the helper missing: the helper line stays", { let l = SleepSentryRules.afterTurnOn(s.check!); return l?.restartOff == nil && l?.helper != nil }())
check("Turn on restart was the last step: engage now", { var c = s.check!; c.helper = nil; c.fixHelper = false; return SleepSentryRules.afterTurnOn(c) == nil }())

// ---------- sentry-real-lock: FileVault off in the same check (read only; PS never changes it) ----------
let fvOnly = SleepSentryN.parse(["check": ["title": "FileVault is off", "helper": NSNull(), "restartOff": NSNull(), "autoOff": NSNull(), "consequence": "",
  "fileVault": "FileVault is off, so this Mac's disk is not encrypted. Someone who takes it could read your files without your password.",
  "fileVaultTitle": "FileVault is off", "fixHelper": false]])!
check("FileVault: parsed, and only its own line shows when the restart works", fvOnly.check?.fileVault != nil && SleepSentryRules.lines(fvOnly.check!) == [fvOnly.check!.fileVault!])
check("FileVault: it still stops at the check first", SleepSentryRules.firstStep(fvOnly) == .check)
check("FileVault: an older page with no FileVault field parses as before", s.check?.fileVault == nil && s.check?.fileVaultTitle == "FileVault is off")
check("FileVault: comes last in the lines", { var c = s.check!; c.fileVault = "FV"; return SleepSentryRules.lines(c).last == "FV" && SleepSentryRules.lines(c).count == 4 }())
check("FileVault: Turn on restart leaves only FileVault, with its own title and none of the restart lines", {
  var c = s.check!; c.helper = nil; c.fixHelper = false; c.autoOff = "Auto reboot in Security is off too."; c.fileVault = "FV"
  guard let l = SleepSentryRules.afterTurnOn(c) else { return false }
  return l.title == "FileVault is off" && SleepSentryRules.lines(l) == ["FV"]
}())
check("FileVault: with the helper still missing, Turn on restart keeps the helper and FileVault lines", {
  var c = s.check!; c.fileVault = "FV"
  guard let l = SleepSentryRules.afterTurnOn(c) else { return false }
  return l.restartOff == nil && l.helper != nil && l.fileVault == "FV" && l.title == c.title
}())
check("FileVault: the Tab list's button only opens System Settings there (never fdesetup enable or disable)", sentry.contains("case \"sentry:fileVault\": openFileVault()")
      && sentry.contains("x-apple.systempreferences:com.apple.preference.security?FileVault") && !sentry.contains("fdesetup") && !core.contains("fdesetup"))

// ---------- V1.54 (helper-check-154): the fresh helper check found it on, so the page's helper line was stale ----------
check("fresh check fine, restart also Off: only the restart line is left, no Set up button", {
  guard let l = SleepSentryRules.afterHelperOK(s.check!) else { return false }
  return l.helper == nil && !l.fixHelper && l.restartOff != nil && SleepSentryRules.lines(l).first == "Restart if not unlocked is set to Off."
}())
check("fresh check fine and the helper was the only gap: engage now (no warning)", { var c = s.check!; c.restartOff = nil; c.autoOff = nil; return SleepSentryRules.afterHelperOK(c) == nil }())
check("fresh check fine, FileVault off too: only FileVault, with its own title", {
  var c = s.check!; c.restartOff = nil; c.fileVault = "FV"
  guard let l = SleepSentryRules.afterHelperOK(c) else { return false }
  return l.title == "FileVault is off" && SleepSentryRules.lines(l) == ["FV"]
}())
check("fresh check: the sleep button asks before it decides, and shows busy meanwhile", ss.contains("AutoReboot.shared.check {") && ss.contains("self.helperOK = AutoReboot.shared.lastGap == nil"))

// ---------- leaving: only the real lock screen while protected ----------
check("protected: every leave goes through the lock screen, whatever Touch ID is set to", SleepSentryRules.leave(protected: true, lock: true) == .lockScreen && SleepSentryRules.leave(protected: true, lock: false) == .lockScreen)
check("not protected: Sleep mode's own rule", SleepSentryRules.leave(protected: false, lock: true) == .touchID && SleepSentryRules.leave(protected: false, lock: false) == .now)
check("Esc is Sentry's Esc, everything else is Unlock", SleepSentryRules.lockWhy("esc") == "esc" && ["wake", "customise", "settings", "page", "security"].allSatisfy { SleepSentryRules.lockWhy($0) == "unlock" })
check("locked for Sentry's own reasons: the sleep screen's close", SleepSentryRules.closeWhy(lockWhy: "unlock") == "wake" && SleepSentryRules.closeWhy(lockWhy: "esc") == "esc"
      && SleepSentryRules.closeWhy(lockWhy: "battery") == "sentryBattery" && SleepSentryRules.closeWhy(lockWhy: "another app came to the front") == "locked")
check("Sentry ended while the screen was up: Touch ID on the fallback is a wake", SleepSentryRules.endWhy("auth") == "wake" && SleepSentryRules.endWhy("unlock") == "wake" && SleepSentryRules.endWhy("battery") == "sentryBattery")
check("Esc and a lock Sentry made for its own reason lock PS too; a wake does not", SleepSentryRules.locksPS("esc") && SleepSentryRules.locksPS("locked") && !SleepSentryRules.locksPS("wake") && !SleepSentryRules.locksPS("sentryBattery"))
check("a Wake up through the lock screen still cancels the restart (a real unlock ends Sentry)", SentryRules.endCancelsRestart("unlock") && !SentryRules.endCancelsRestart("esc"))

// ---------- the battery rule swap ----------
check("not protected: Sleep stops at 20 percent on battery", SleepSentryRules.sleepStops(protected: false, onBattery: true, pct: 20) && !SleepSentryRules.sleepStops(protected: false, onBattery: true, pct: 21))
check("protected: Sleep's 20 percent stop is off (Sentry's own applies)", !SleepSentryRules.sleepStops(protected: true, onBattery: true, pct: 5))
check("protected: Sentry's stop level is the one that counts", SentryRules.batteryStops(s.plan, onBattery: true, pct: 15) && !SentryRules.batteryStops(s.plan, onBattery: true, pct: 16))
check("protected battery line: Sentry's level", SleepSentryRules.batteryLine(s, onBattery: true) == "On battery. Sentry mode keeps your Mac awake and locks it at 15%.")
check("protected battery line: no stop switched on", SleepSentryRules.batteryLine(SleepSentryN.parse(["plan": ["lowStop": false]])!, onBattery: true) == "On battery. Sentry mode keeps your Mac awake.")
check("protected battery line: nothing on mains", SleepSentryRules.batteryLine(s, onBattery: false) == nil)
check("refusals have their sentence", SleepSentryRules.refusedLine(s, code: "battery").contains("stop level") && SleepSentryRules.refusedLine(nil, code: "weird") == "Sentry mode did not start.")

// ---------- the words: no em or en dashes ----------
check("no em or en dashes in the words", SleepSentryRules.words.values.allSatisfy { !$0.contains("\u{2014}") && !$0.contains("\u{2013}") })

// ---------- the wiring (read from the sources) ----------
check("sources found", !sleep.isEmpty && !sentry.isEmpty && !ss.isEmpty && !main.isEmpty)
check("main.swift hands the sleep screen its guardian", main.contains("SleepScreen.shared.guardian = SleepSentry.shared"))
check("Wake up, Customise and Settings: protected goes to the lock screen before any Touch ID", { () -> Bool in
  guard let a = sleep.range(of: "if protected { stopRing(); guardian?.leave(why); return }"), let b = sleep.range(of: "behind(true)\n    DispatchQueue.main.asyncAfter(deadline: .now() + SleepScreen.authTimeout)") else { return false }
  return a.lowerBound < b.lowerBound }())
check("Wake up waits out the moment Sentry mode engages (never a Touch ID prompt as the protection lands); Esc does not", sleep.contains("if guardian?.isBusy == true {") && !sleep.contains("guardian?.isBusy == true { psLog(\"PS sleep: Esc"))
check("Esc: the panel first, then the lock screen while protected", sleep.contains("if guardian?.escape() == true { return }") && ss.contains("if panel != nil {") && ss.contains("if isOn { leave(\"esc\"); return true }"))
check("the page's stop never leaves the Mac open while protected", sleep.contains("if protected { psLog(\"PS sleep: the page asked to stop while protected"))
check("no close over an unlocked Mac while protected (only Sentry's own close gets through)", sleep.contains("if protected && !guardClosing {") && sleep.contains("guardClosing = true\n    close(why: why, woke: woke)"))
check("battery: Sleep's own stop only when not protected", sleep.contains("if !self.protected, SleepRules.batteryStops("))
check("Stop alarm still needs no Touch ID (unchanged)", sleep.contains("@objc private func stopTapped() { stopRing(); poke() }"))
check("one cover at a time: no Sentry cover on Sleep mode's screen, and Sleep keeps the keys", sentry.contains("let skip = underSleep ? hostDisplay?() : nil") && sentry.contains("if !test, !underSleep, let key ="))
check("under Sleep mode the Tab list call and the cover's fade stay out", sentry.contains("if !underSleep { onOpen?() }") && sentry.contains("if old.isEmpty && !underSleep {"))
check("Sentry tells Sleep mode: locked, ended, aside, let sleep", sentry.contains("host?(.locked(lockWhy))") && sentry.contains("h?(.ended(why))") && sentry.contains("host?(.aside(true))") && sentry.contains("host?(.aside(false))") && sentry.contains("host?(.letSleep)"))
check("the end clears the host so nothing stays tied to a gone screen", sentry.contains("host = nil; hostDisplay = nil; underSleep = false"))
check("leaving from Sleep mode only while covered, through lockMac", sentry.contains("guard underSleep, phase == .covered else { return }") && sentry.contains("lockMac(SleepSentryRules.lockWhy(sleepWhy))"))
check("the normal AI button still refuses while Sleep mode is up", sentry.contains("if sleep == nil, SleepScreen.shared.isUp {"))
check("the engage re-checks Sleep mode is still up after reading the power", sentry.contains("if let sleep, !SleepScreen.shared.isUp {"))
check("the flag and the guard are untouched by the sleep path (same engage)", sentry.contains("Sentry.writeFlag(flag, url)\n      let g = sys.spawnGuard(url)"))
check("protected means still covering (an alarm behind the lock screen is not held)", ss.contains("var isOn: Bool { Sentry.shared.underSleep && Sentry.shared.isUp }"))
check("ScreenGuard: the button and panel live inside the sleep window (no window of their own)", !ss.contains("NSWindow(") && !ss.contains("NSPanel(") && !ss.contains("orderFront"))
check("golden rule: nothing here reads another app", !ss.contains("frontmostApplication") && !ss.contains("bundleIdentifier") && !core.contains("bundleIdentifier"))
check("nothing blocks the main thread here (no sleeps, no waits)", !ss.contains("usleep") && !ss.contains("Thread.sleep") && !ss.contains(".wait(") && !core.contains("usleep"))
check("the shield folds in smoothly, and plainly with reduce motion", ss.contains("CASpringAnimation(keyPath: key)") && ss.contains("keyPath: \"strokeEnd\"") && ss.contains("if reduceMotion {"))
check("no em or en dashes in the new sources", [ss, core].allSatisfy { !$0.contains("\u{2014}") && !$0.contains("\u{2013}") })

print("\n\(passed) passed")

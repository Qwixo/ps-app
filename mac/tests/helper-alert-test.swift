// Offline test for Sources/HelperAlertCore.swift (the restart helper pop up, V1.49; the developer, 12 Nov 2026: "if for whatever
// reason the BFU timer/restart helper is NOT active, display it with a pop up immediately"). Run: tests/helper-alert-test.sh
import Foundation

var fails = 0, count = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { count += 1; print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty ? "" : " (\(info))")"); if !ok { fails += 1 } }
let here = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath

// ---------- what counts as not active ----------
check("not-set-up", HelperAlertCore.problem(HelperFacts(state: "off")) == .notSetUp)
check("switched-off-in-settings", HelperAlertCore.problem(HelperFacts(state: "approve")) == .switchedOff)
check("switched-off-same-build", HelperAlertCore.problem(HelperFacts(state: "approve", offBy: .settings)) == .switchedOff)
check("off-by-update", HelperAlertCore.problem(HelperFacts(state: "approve", offBy: .update)) == .offByUpdate)
check("on-and-answering", HelperAlertCore.problem(HelperFacts(state: "on")) == nil)
check("one-miss-is-not-enough", HelperAlertCore.problem(HelperFacts(state: "on", failures: 1)) == nil)
check("two-misses-not-yet", HelperAlertCore.problem(HelperFacts(state: "on", failures: HelperAlertCore.failLimit - 1)) == nil)
check("three-misses-not-answering", HelperAlertCore.problem(HelperFacts(state: "on", failures: HelperAlertCore.failLimit)) == .notAnswering)
check("not-answering-pin-unknown", HelperAlertCore.problem(HelperFacts(state: "on", failures: 5, pinOK: nil)) == .notAnswering)
check("not-answering-pin-ok", HelperAlertCore.problem(HelperFacts(state: "on", failures: 5, pinOK: true)) == .notAnswering)
check("wrong-pin", HelperAlertCore.problem(HelperFacts(state: "on", failures: 5, pinOK: false)) == .wrongPin)
check("wrong-pin-only-names-a-dead-helper", HelperAlertCore.problem(HelperFacts(state: "on", failures: 0, pinOK: false)) == nil)
check("wrong-pin-never-over-not-set-up", HelperAlertCore.problem(HelperFacts(state: "off", pinOK: false)) == .notSetUp)
check("safe-mode-never", HelperAlertCore.problem(HelperFacts(state: "on", failures: 9, safeMode: true)) == nil)
check("missing-build-never", HelperAlertCore.problem(HelperFacts(state: "missing")) == nil)
check("test-copy-state-never", HelperAlertCore.problem(HelperFacts(state: "test")) == nil)
check("retry-makes-it-quick", HelperAlertCore.retryAfter * Double(HelperAlertCore.failLimit - 1) <= 30)

// ---------- who needs it ----------
check("wanted-watch-only", HelperAlertCore.wanted(mode: "watch", sentryRestartH: 0))
check("wanted-active", HelperAlertCore.wanted(mode: "active", sentryRestartH: 0))
check("wanted-sentry-only", HelperAlertCore.wanted(mode: "off", sentryRestartH: 8))
check("wanted-defaults", HelperAlertCore.wanted(mode: "watch", sentryRestartH: 8))
check("not-wanted-both-off", !HelperAlertCore.wanted(mode: "off", sentryRestartH: 0))

// ---------- when it shows ----------
let now = 1_800_000_000.0
func step(_ p: HelperProblem?, wanted: Bool = true, memo: HelperAlertMemo = HelperAlertMemo(), prot: Bool = false, covered: String? = nil, test: Bool = false, at t: Double = now) -> HelperAlertStep {
  HelperAlertCore.step(problem: p, wanted: wanted, now: t, memo: memo, protectedFront: prot, covered: covered, testCopy: test)
}
for p in HelperProblem.allCases { check("shows-at-once-\(p.rawValue)", step(p) == .show(p)) }
check("nothing-when-fine", step(nil) == .hide("the helper is on"))
check("nothing-when-not-wanted", { if case .hide = step(.switchedOff, wanted: false) { return true }; return false }())
// Open source build: Security, "Remind me to set up the restart helper". On unless switched off; Off never shows it.
check("remind-default-on", HelperAlertCore.remindOn(nil) && HelperAlertCore.remindOn(true) && !HelperAlertCore.remindOn(false) && HelperAlertCore.remindOn("no"))
check("remind-key", HelperAlertCore.remindKey == "helperAlert.remind")
for p in HelperProblem.allCases {
  check("remind-off-hides-\(p.rawValue)", HelperAlertCore.step(problem: p, wanted: true, now: now, memo: HelperAlertMemo(), protectedFront: false, covered: nil, testCopy: false, remind: false) == .hide("Remind me to set up the restart helper is off"))
  check("remind-on-shows-\(p.rawValue)", HelperAlertCore.step(problem: p, wanted: true, now: now, memo: HelperAlertMemo(), protectedFront: false, covered: nil, testCopy: false, remind: true) == .show(p))
}
check("never-in-a-test-copy", step(.notSetUp, test: true) == .hide("a self test copy"))
check("waits-for-1password-or-signal", step(.switchedOff, prot: true) == .wait("1Password or Signal is in front"))
check("waits-for-sleep-mode", step(.switchedOff, covered: "Sleep mode is up") == .wait("Sleep mode is up"))
check("waits-for-sentry", step(.switchedOff, covered: "Sentry mode is up") == .wait("Sentry mode is up"))
check("waits-while-locked", step(.switchedOff, covered: "the Mac is locked") == .wait("the Mac is locked"))
check("protected-beats-covered", step(.switchedOff, prot: true, covered: "the Mac is locked") == .wait("1Password or Signal is in front"))

// Esc or the x: gone until the next check, then back while the helper is still off.
var m = HelperAlertCore.closed(HelperAlertMemo(), now: now)
check("closed-quiet-now", step(.switchedOff, memo: m) == .hide("closed, back on the next check"))
check("closed-quiet-on-the-3s-poll", step(.switchedOff, memo: m, at: now + 3) == .hide("closed, back on the next check"))
check("closed-back-on-the-next-check", step(.switchedOff, memo: m, at: now + HelperAlertCore.checkEvery) == .show(.switchedOff))
// Remind me in 1 hour.
m = HelperAlertCore.later(HelperAlertMemo(), now: now)
check("later-quiet-59-min", step(.notSetUp, memo: m, at: now + 59 * 60) == .hide("Remind me in 1 hour"))
check("later-back-after-an-hour", step(.notSetUp, memo: m, at: now + 3600) == .show(.notSetUp))
check("later-clears-a-close", HelperAlertCore.later(HelperAlertCore.closed(HelperAlertMemo(), now: now), now: now).quietUntil == 0)
check("later-is-an-hour", HelperAlertCore.snooze == 3600)
// Back on: the next problem shows at once.
check("back-on-clears-snooze", HelperAlertCore.cleared(m) == HelperAlertMemo())
check("back-on-then-off-again-shows", step(.switchedOff, memo: HelperAlertCore.cleared(m), at: now + 60) == .show(.switchedOff))

// "Restart helper is on".
check("confirm-when-up", HelperAlertCore.confirmBack(wasProblem: true, nowProblem: false, up: true, fixedAgo: nil))
check("confirm-after-fix-click", HelperAlertCore.confirmBack(wasProblem: true, nowProblem: false, up: false, fixedAgo: 120))
check("no-confirm-long-after-fix", !HelperAlertCore.confirmBack(wasProblem: true, nowProblem: false, up: false, fixedAgo: 3600))
check("no-confirm-never-shown", !HelperAlertCore.confirmBack(wasProblem: true, nowProblem: false, up: false, fixedAgo: nil))
check("no-confirm-still-off", !HelperAlertCore.confirmBack(wasProblem: true, nowProblem: true, up: true, fixedAgo: 1))
check("no-confirm-was-fine", !HelperAlertCore.confirmBack(wasProblem: false, nowProblem: false, up: true, fixedAgo: 1))

// ---------- the words ----------
check("title", HelperAlertCore.title == "Your restart helper is off")
check("later-label", HelperAlertCore.later == "Remind me in 1 hour")
check("back-on", HelperAlertCore.backOn == "Restart helper is on")
check("line-both", HelperAlertCore.line(autoReboot: true, sentry: true) == "Auto reboot and Sentry mode's restart cannot protect this Mac until it is back on.")
check("line-sentry", HelperAlertCore.line(autoReboot: false, sentry: true) == "Sentry mode's restart cannot protect this Mac until it is back on.")
check("line-auto", HelperAlertCore.line(autoReboot: true, sentry: false) == "Auto reboot cannot protect this Mac until it is back on.")
check("button-set-up", HelperAlertCore.button(.notSetUp) == "Set up the restart helper")
check("button-settings", HelperAlertCore.button(.switchedOff) == "Open System Settings" && HelperAlertCore.button(.offByUpdate) == "Open System Settings" && HelperAlertCore.button(.notAnswering) == "Open System Settings")
check("action-register-then-open", HelperAlertCore.action(.notSetUp) == "setup" && HelperAlertCore.action(.switchedOff) == "setup" && HelperAlertCore.action(.offByUpdate) == "setup")
check("action-open-only", HelperAlertCore.action(.notAnswering) == "settings")
check("action-update", HelperAlertCore.action(.wrongPin) == "update")
check("renamed-app-in-steps", HelperAlertCore.steps(.switchedOff, app: "My PS")[1] == "Find My PS under Allow in the Background." && HelperAlertCore.steps(.switchedOff, app: "My PS")[2] == "Switch My PS on. If it already looks on, switch it off and then on again.")
check("three-numbered-steps", HelperAlertCore.allSteps().allSatisfy { $0.count == 3 })
check("first-step-names-the-button", HelperProblem.allCases.allSatisfy { HelperAlertCore.steps($0, app: "PS")[0] == "Click \(HelperAlertCore.button($0))." })
var words = [HelperAlertCore.title, HelperAlertCore.later, HelperAlertCore.backOn, HelperAlertCore.waitingNote]
for a in [true, false] { for s in [true, false] where a || s { words += [HelperAlertCore.line(autoReboot: a, sentry: s), HelperAlertCore.backOnSub(autoReboot: a, sentry: s)] } }
for p in HelperProblem.allCases { words += [HelperAlertCore.reason(p, app: "PS"), HelperAlertCore.button(p)] + HelperAlertCore.steps(p, app: "PS") }
check("no-em-or-en-dashes-in-words", !words.contains { $0.contains("\u{2014}") || $0.contains("\u{2013}") })
for f in ["Sources/HelperAlertCore.swift", "Sources/HelperAlert.swift"] {
  let s = (try? String(contentsOfFile: "\(here)/\(f)", encoding: .utf8)) ?? ""
  check("no-dashes-\(f)", !s.isEmpty && !s.contains("\u{2014}") && !s.contains("\u{2013}"))
}
// The panel: PS's own, never an app modal alert, never the keyboard, above the Tab list.
let ui = (try? String(contentsOfFile: "\(here)/Sources/HelperAlert.swift", encoding: .utf8)) ?? ""
check("panel-not-nsalert", !ui.contains("NSAlert") && ui.contains("nonactivatingPanel") && ui.contains("canBecomeKey: Bool { false }"))
check("panel-above-tab-list", ui.contains("statusBar.rawValue + 1"))
check("panel-never-in-test-copy", ui.contains("guard !IS_TEST_COPY, !started"))
let mainSrc = (try? String(contentsOfFile: "\(here)/Sources/main.swift", encoding: .utf8)) ?? ""
check("esc-in-the-tap", mainSrc.contains("Soundboard.ringingNow || HelperAlert.upNow"))
check("esc-in-esckey", mainSrc.contains("if HelperAlert.shared.escape() { return }"))
check("golden-rule-wired", mainSrc.contains("HelperAlert.shared.protectedChanged()"))
check("sentry-prefs-wired", mainSrc.contains("case \"sentryPrefs\" where fromMain"))
let ar = (try? String(contentsOfFile: "\(here)/Sources/AutoReboot.swift", encoding: .utf8)) ?? ""
check("old-update-card-gone", !ar.contains("Toast.shared.showCard(") && !ar.contains("RebootHelperCore.showCard("))

// ---------- the confirmation: once per off to on, gone after 3 s (fix: it stayed stuck, the developer 12 Nov 2026) ----------
var b = HelperBackOn()
check("back-never-without-an-off", !b.claim())
b.wentOff()
check("back-after-a-real-off-to-on", b.claim())
check("back-never-twice-for-the-same-on", !b.claim() && !b.claim())
check("back-not-due-before-it-appears", !b.due(now + 100))
b.appeared(now)
check("back-stays-under-3s", !b.due(now + 2.9))
check("back-fades-at-3s", b.due(now + 3) && HelperAlertCore.backOnFor == 3)
check("back-backstop-at-6s", !b.overdue(now + 5.9) && b.overdue(now + 6))
b.gone()
check("back-gone-not-due", !b.due(now + 100) && !b.overdue(now + 100))
check("back-gone-still-once", !b.claim())
b.wentOff()
check("back-again-after-the-next-off", b.claim())
// Off then on twice before any check of the confirmation: still once per stretch.
var b2 = HelperBackOn(); b2.wentOff(); b2.wentOff()
check("back-once-for-a-double-off", b2.claim() && !b2.claim())
// The stuck case replayed: back on, a hide lands during the cross fade, the late swap is dropped (generation token).
var gen = 0, shown = false, timerArmed = false
func present() -> Int { gen += 1; return gen }
func swap(_ g: Int) { guard g == gen else { return }; shown = true; timerArmed = true }
func hideNow() { gen += 1; shown = false; timerArmed = false }
let g1 = present(); hideNow(); swap(g1)
check("stuck-race-swap-dropped", !shown && !timerArmed)
let g2 = present(); swap(g2)
check("normal-show-arms-its-timer", shown && timerArmed)
// A panel still on screen with nothing to show is removed after a second.
check("stale-removed", HelperAlertCore.staleWindow(onScreen: true, shouldShow: false, hiddenFor: 1.2))
check("stale-removed-unknown-hide", HelperAlertCore.staleWindow(onScreen: true, shouldShow: false, hiddenFor: nil))
check("stale-not-during-fade-out", !HelperAlertCore.staleWindow(onScreen: true, shouldShow: false, hiddenFor: 0.3))
check("stale-not-while-showing", !HelperAlertCore.staleWindow(onScreen: true, shouldShow: true, hiddenFor: 5))
check("stale-not-when-gone", !HelperAlertCore.staleWindow(onScreen: false, shouldShow: false, hiddenFor: 5))
// The panel code keeps to it.
check("ui-generation-token", ui.contains("guard let self, g == self.gen else { return }"))
check("ui-window-removed", ui.contains("panel?.close()") && ui.contains("panel = nil; host = nil"))
check("ui-click-closes-confirmation", ui.contains(".onTapGesture { m.act(\"close\") }"))
check("ui-backstop-tick", ui.contains("backOn.overdue(now)") && ui.contains("HelperAlertCore.staleWindow("))
check("ui-claims-once", ui.contains("backOn.claim()"))
check("ui-no-old-timers", !ui.contains("backWork") && !ui.contains("hideWork"))

print("helper-alert: \(count - fails) of \(count) ok")
exit(fails == 0 ? 0 : 1)

// Offline test for Sources/HelperRepairCore.swift and the V1.51 pop up rules in Sources/HelperAlertCore.swift (the developer,
// 12 Nov 2026: after an update the switch under Allow in the Background showed PS app on, but the helper only worked
// again once he switched it off and on). Asks macOS nothing. Run: tests/helper-repair-test.sh
import Foundation

var fails = 0, count = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { count += 1; print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty ? "" : " (\(info))")"); if !ok { fails += 1 } }
let here = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath
let limit = HelperAlertCore.failLimit
let dead = HelperRepairFacts(state: "on", failures: limit, build: "2611121200")

// ---------- when PS repairs by itself ----------
check("auto-when-on-and-dead", HelperRepairCore.shouldAuto(dead))
check("auto-not-before-the-limit", !HelperRepairCore.shouldAuto({ var f = dead; f.failures = limit - 1; return f }()))
check("auto-not-when-answering", !HelperRepairCore.shouldAuto({ var f = dead; f.failures = 0; return f }()))
check("auto-not-when-approve", !HelperRepairCore.shouldAuto({ var f = dead; f.state = "approve"; return f }()))
check("auto-not-when-off", !HelperRepairCore.shouldAuto({ var f = dead; f.state = "off"; return f }()))
check("auto-not-when-missing", !HelperRepairCore.shouldAuto({ var f = dead; f.state = "missing"; return f }()))
check("auto-not-in-safe-mode", !HelperRepairCore.shouldAuto({ var f = dead; f.safeMode = true; return f }()))
check("auto-not-for-wrong-pin", !HelperRepairCore.shouldAuto({ var f = dead; f.pinOK = false; return f }()))
check("auto-pin-unknown-ok", HelperRepairCore.shouldAuto({ var f = dead; f.pinOK = nil; return f }()))
check("auto-pin-good-ok", HelperRepairCore.shouldAuto({ var f = dead; f.pinOK = true; return f }()))
check("auto-never-in-a-test-copy", !HelperRepairCore.shouldAuto({ var f = dead; f.testCopy = true; return f }()))
check("auto-not-while-running", !HelperRepairCore.shouldAuto({ var f = dead; f.running = true; return f }()))
check("auto-once-per-launch", !HelperRepairCore.shouldAuto({ var f = dead; f.triedThisLaunch = true; return f }()))
check("auto-once-per-build", !HelperRepairCore.shouldAuto({ var f = dead; f.lastAutoBuild = f.build; return f }()))
check("auto-again-after-the-next-update", HelperRepairCore.shouldAuto({ var f = dead; f.lastAutoBuild = "2611111911"; return f }()))

// ---------- never a loop: a helper that stays dead for a day, failures counted over and over ----------
var f = dead, autoRuns = 0
for launch in 0..<3 {
  f.triedThisLaunch = false   // PS restarted (same build)
  for _ in 0..<500 {
    if HelperRepairCore.shouldAuto(f) { autoRuns += 1; f.triedThisLaunch = true; f.lastAutoBuild = f.build }
  }
  _ = launch
}
check("one-auto-repair-per-build-across-launches", autoRuns == 1, "\(autoRuns)")
f.build = "2611131200"; f.triedThisLaunch = false
check("next-build-gets-one-more", HelperRepairCore.shouldAuto(f))

// ---------- Try again waits longer each time ----------
let now = 1_800_000_000.0
check("try-again-first-at-once", HelperRepairCore.waitLeft(running: false, tries: 0, lastEnded: nil, now: now) == 0)
check("try-again-never-while-running", HelperRepairCore.waitLeft(running: true, tries: 0, lastEnded: nil, now: now) == .infinity)
check("try-again-30s-after-one", HelperRepairCore.waitLeft(running: false, tries: 1, lastEnded: now, now: now + 10) == 20)
check("try-again-ready-after-30s", HelperRepairCore.waitLeft(running: false, tries: 1, lastEnded: now, now: now + 30) == 0)
check("try-again-2min-after-two", HelperRepairCore.waitLeft(running: false, tries: 2, lastEnded: now, now: now + 60) == 60)
check("try-again-10min-after-three", HelperRepairCore.manualWait(tries: 3) == 600 && HelperRepairCore.manualWait(tries: 9) == 600)
check("try-again-grows", HelperRepairCore.manualWait(tries: 1) < HelperRepairCore.manualWait(tries: 2) && HelperRepairCore.manualWait(tries: 2) < HelperRepairCore.manualWait(tries: 3))
// A person clicking Try again as fast as they can for an hour: at most a handful of repairs.
var t = now, tries = 0, last: Double? = nil
while t < now + 3600 {
  if HelperRepairCore.waitLeft(running: false, tries: tries, lastEnded: last, now: t) == 0 { tries += 1; last = t + 40 }   // each takes about 40 s
  t += 1
}
check("try-again-hammered-for-an-hour", tries <= 8, "\(tries)")

// ---------- what a repair came to ----------
check("outcome-fixed", HelperRepairCore.outcome(state: "on", answered: true, registerError: false) == .fixed)
check("outcome-still-dead", HelperRepairCore.outcome(state: "on", answered: false, registerError: false) == .stillDead)
check("outcome-needs-approval", HelperRepairCore.outcome(state: "approve", answered: false, registerError: false) == .needsApproval)
check("outcome-needs-approval-even-with-error", HelperRepairCore.outcome(state: "approve", answered: false, registerError: true) == .needsApproval)
check("outcome-failed", HelperRepairCore.outcome(state: "off", answered: false, registerError: true) == .failed)

// ---------- Set up for a helper that ran here before: unregister first ----------
check("clean-set-up-after-it-ran", HelperRepairCore.cleanSetUp(wasOn: true, state: "approve"))
check("no-clean-first-set-up", !HelperRepairCore.cleanSetUp(wasOn: false, state: "approve"))
check("no-clean-not-registered", !HelperRepairCore.cleanSetUp(wasOn: true, state: "off"))
check("no-clean-when-on", !HelperRepairCore.cleanSetUp(wasOn: true, state: "on"))

// ---------- the pop up: waits for the repair, asks only when it did not help ----------
func step(_ p: HelperProblem?, repairing: Bool = false, prot: Bool = false) -> HelperAlertStep {
  HelperAlertCore.step(problem: p, wanted: true, now: now, memo: HelperAlertMemo(), protectedFront: prot, covered: nil, testCopy: false, repairing: repairing)
}
check("popup-waits-while-repairing", step(.notAnswering, repairing: true) == .wait("PS is repairing the helper"))
check("popup-shows-after-repair", step(.notAnswering) == .show(.notAnswering))
check("popup-repairing-still-hidden-when-fine", step(nil, repairing: true) == .hide("the helper is on"))
check("popup-snooze-beats-repairing", HelperAlertCore.step(problem: .notAnswering, wanted: true, now: now, memo: HelperAlertCore.later(HelperAlertMemo(), now: now), protectedFront: false, covered: nil, testCopy: false, repairing: true) == .hide("Remind me in 1 hour"))
check("popup-approve-again", HelperAlertCore.problem(HelperFacts(state: "approve", repair: .needsApproval)) == .approveAgain)
check("popup-approve-again-beats-update", HelperAlertCore.problem(HelperFacts(state: "approve", offBy: .update, repair: .needsApproval)) == .approveAgain)
check("popup-plain-approve-unchanged", HelperAlertCore.problem(HelperFacts(state: "approve", offBy: .update)) == .offByUpdate && HelperAlertCore.problem(HelperFacts(state: "approve", repair: .stillDead)) == .switchedOff)
check("popup-still-dead-is-not-answering", HelperAlertCore.problem(HelperFacts(state: "on", failures: limit, repair: .stillDead)) == .notAnswering)
check("popup-fixed-is-nothing", HelperAlertCore.problem(HelperFacts(state: "on", failures: 0, repair: .fixed)) == nil)

// ---------- the words (exact) ----------
check("reason-not-answering", HelperAlertCore.reason(.notAnswering, app: "PS app") == "macOS lists it as on, but it is not answering.")
check("reason-not-answering-after-repair", HelperAlertCore.reason(.notAnswering, app: "PS app", repaired: true) == "macOS lists it as on, but it is still not answering after PS app restarted it.")
check("reason-approve-again", HelperAlertCore.reason(.approveAgain, app: "PS app") == "PS app restarted the helper, and macOS now wants your OK again.")
check("button-approve-again", HelperAlertCore.button(.approveAgain) == "Open System Settings")
check("action-approve-again-opens-only", HelperAlertCore.action(.approveAgain) == "settings")
check("steps-approve-again", HelperAlertCore.steps(.approveAgain, app: "PS app") == ["Click Open System Settings.", "Find PS app under Allow in the Background.", "Switch PS app on. If it already looks on, switch it off and then on again."])
check("steps-not-answering", HelperAlertCore.steps(.notAnswering, app: "PS app") == ["Click Open System Settings.", "Find PS app under Allow in the Background.", "It looks on, but it is not working. Switch PS app off and then on again."])
check("every-guide-says-off-then-on", HelperProblem.allCases.filter { $0 != .wrongPin }.allSatisfy { HelperAlertCore.steps($0, app: "PS app")[2].contains("off and then on again") } && HelperAlertCore.waitingNote.contains(HelperAlertCore.again))
check("retry-only-not-answering", HelperProblem.allCases.allSatisfy { HelperAlertCore.retry($0) == ($0 == .notAnswering) })
check("text-carries-retry", HelperAlertCore.text(.notAnswering, app: "PS app", autoReboot: true, sentry: true, repaired: true).retry
      && !HelperAlertCore.text(.approveAgain, app: "PS app", autoReboot: true, sentry: true).retry)
check("text-repaired-reason", HelperAlertCore.text(.notAnswering, app: "PS app", autoReboot: true, sentry: true, repaired: true).reason.contains("after PS app restarted it"))
check("retry-label", HelperRepairCore.retryLabel(waitLeft: 0) == "Try again")
check("retry-label-busy", HelperRepairCore.retryLabel(waitLeft: .infinity) == "Restarting the helper")
check("retry-label-seconds", HelperRepairCore.retryLabel(waitLeft: 24.2) == "Try again in 25 s")
check("retry-label-minutes", HelperRepairCore.retryLabel(waitLeft: 61) == "Try again in 2 min" && HelperRepairCore.retryLabel(waitLeft: 600) == "Try again in 10 min")
var words = [HelperRepairCore.retry, HelperRepairCore.retrying, HelperRepairCore.retryLabel(waitLeft: 20), HelperRepairCore.retryLabel(waitLeft: 200)]
for p in HelperProblem.allCases { words += [HelperAlertCore.reason(p, app: "PS app"), HelperAlertCore.reason(p, app: "PS app", repaired: true), HelperAlertCore.button(p)] + HelperAlertCore.steps(p, app: "PS app") }
check("no-em-or-en-dashes-in-words", !words.contains { $0.contains("\u{2014}") || $0.contains("\u{2013}") })

// ---------- the code keeps to it ----------
func src(_ f: String) -> String { (try? String(contentsOfFile: "\(here)/\(f)", encoding: .utf8)) ?? "" }
let ar = src("Sources/AutoReboot.swift"), ui = src("Sources/HelperAlert.swift"), core = src("Sources/HelperRepairCore.swift")
for (n, s) in [("AutoReboot", ar), ("HelperAlert", ui), ("HelperRepairCore", core), ("HelperAlertCore", src("Sources/HelperAlertCore.swift"))] {
  check("no-dashes-\(n)", !s.isEmpty && !s.contains("\u{2014}") && !s.contains("\u{2013}"))
}
let body: String = {   // the repair function alone
  guard let a = ar.range(of: "func repair(manual: Bool) -> Bool"), let b = ar.range(of: "private func registeredAgain") else { return "" }
  return String(ar[a.lowerBound..<b.lowerBound])
}()
check("repair-found", !body.isEmpty)
check("repair-unregister-then-register", { guard let u = body.range(of: "svc.unregister"), let r = body.range(of: "svc.register()") else { return false }; return u.lowerBound < r.lowerBound }())
check("repair-off-the-main-thread", body.contains("DispatchQueue.global(qos: .userInitiated).async") && !body.contains("DispatchQueue.main.sync"))
check("repair-one-at-a-time", body.contains("guard !repairing else { return false }"))
check("repair-try-again-waits", body.contains("if manual && wait > 0"))
check("repair-once-per-build-kept", body.contains("lastAutoRepairBuild = AutoReboot.build") && ar.contains("\"reboot.repairAutoBuild\""))
check("repair-never-in-test-copy", body.contains("if IS_TEST_COPY { testDid.append(\"repair\")") && {
  guard let a = body.range(of: "if IS_TEST_COPY { testDid.append(\"repair\")"), let b = body.range(of: "svc.unregister") else { return false }
  return a.lowerBound < b.lowerBound }())
check("repair-has-a-watch", body.contains("asyncAfter(deadline: .now() + 90"))
check("repair-logs-clearly", body.contains("psLog(\"reboot: repair "))
check("repair-keeps-memory", !body.contains("memory = HelperMemory(wasOn: false"))
check("auto-only-from-the-last-miss", ar.contains("if repairPhase == .probing { finishRepair(.stillDead) } else { autoRepairIfDue() }"))
check("auto-goes-through-the-rules", ar.contains("if HelperRepairCore.shouldAuto(f) { repair(manual: false) }"))
check("only-two-register-calls", ar.components(separatedBy: "svc.register()").count - 1 == 2, "set up and repair")
check("misses-during-repair-ignored", ar.contains("if repairPhase == .working { changed(); return }"))
// V1.54: the answer's handling moved into heard(), which ask, push and the Sentry mode check all run.
check("probe-answer-ends-repair", ar.contains("if !s.isEmpty && repairPhase == .probing { finishRepair(.fixed) }") && ar.contains("self.heard(s)"))
check("set-up-clean-path", ar.contains("HelperRepairCore.cleanSetUp(wasOn: memory.wasOn, state: helperState)"))
check("ui-try-again-wired", ui.contains("case \"retry\":") && ui.contains("AutoReboot.shared.repair(manual: true)"))
check("ui-waits-for-repair", ui.contains("repairing: ar.repairing") && ui.contains("repair: ar.repairResult"))
check("ui-repaired-words", ui.contains("repaired: ar.repairs > 0"))
check("helper-untouched", !FileManager.default.fileExists(atPath: "\(here)/Helper/HelperRepairCore.swift"))

print("helper-repair: \(count - fails) of \(count) ok")
exit(fails == 0 ? 0 : 1)

// Offline test for Sources/HelperCheckCore.swift (V1.54, helper-check-154): the fresh restart helper check before
// Sentry mode engages. Replays what macOS and the helper say try by try (with the time each try takes) and checks what
// the check ends with, when, and that it never says off while macOS lists the helper as on. Then reads the sources for
// the wiring. Asks macOS nothing.
//   bash tests/helper-check-test.sh
import Foundation

var fails = 0
func check(_ name: String, _ ok: Bool) { print("\(name)=\(ok ? "ok" : "FAIL")"); if !ok { fails += 1 } }

typealias C = HelperCheckCore
/// One try: macOS's state and whether the helper answered (the last try repeats if the check goes on longer).
struct Try { var state: String; var answered: Bool }
/// Runs the check as AutoReboot.check does: try, decide, wait `every`, try again. A try that asks the helper and gets
/// no answer takes answerWait; any other try a few hundredths. Returns the gap, the seconds it took and the tries.
func run(_ script: [Try], ranBefore: Bool = true, old: Bool = false) -> (gap: String?, secs: Double, tries: Int, saidOffWhileOn: Bool) {
  var t = 0.0, i = 0, offWhileOn = false
  while true {
    let s = script[min(i, script.count - 1)]
    t += s.state == "on" && !s.answered ? C.answerWait : 0.03
    i += 1
    if C.next(state: s.state, answered: s.answered, ranBefore: ranBefore, elapsed: t) == .done {
      let g = C.gap(state: s.state, answered: s.answered, old: old)
      if s.state == "on" && (g == "needsOk" || g == "notSetUp") { offWhileOn = true }
      return (g, t, i, offWhileOn)
    }
    t += C.every
    if i > 100 { return (nil, t, i, offWhileOn) }   // never: the windows end it
  }
}
let onOK = Try(state: "on", answered: true), onSilent = Try(state: "on", answered: false)
let approve = Try(state: "approve", answered: false), off = Try(state: "off", answered: false)

// The developer's V1.53 case: switched on a moment ago, macOS says on, the helper answers: fine at once, no warning.
let red = run([onOK])
check("red-switched-on-fine", red.gap == nil && red.tries == 1 && red.secs < 0.5)
// Just starting: launchd is still starting it, it answers on the third try. Never off, never "not answering".
let starting = run([onSilent, onSilent, onOK])
check("starting-then-answers-fine", starting.gap == nil && starting.tries == 3)
check("starting-within-on-wait", starting.secs <= C.onWait + C.answerWait)
// On but never answering: "not answering" after the on window, never "off".
let dead = run([onSilent])
check("dead-says-not-answering", dead.gap == "notAnswering")
check("dead-never-says-off", !dead.saidOffWhileOn)
check("dead-tried-again-first", dead.tries >= 2)
check("dead-ends-in-time", dead.secs <= C.onWait + C.answerWait + C.every)
// macOS still catching up with the switch on: approve twice, then on and answering: fine.
let catchingUp = run([approve, approve, onOK])
check("catching-up-fine", catchingUp.gap == nil && catchingUp.tries == 3)
// Really switched off in System Settings: says so after a short wait (a few seconds, not at once, not forever).
let reallyOff = run([approve])
check("really-off-says-needs-ok", reallyOff.gap == "needsOk")
check("really-off-tried-again-first", reallyOff.tries >= 2)
check("really-off-a-few-seconds", reallyOff.secs >= C.offWait - C.every && reallyOff.secs <= C.offWait + C.every)
// Never set up on this Mac: says so at once (no wait for something that was never there).
let never = run([off], ranBefore: false)
check("never-set-up-at-once", never.gap == "notSetUp" && never.tries == 1)
// Not set up although it ran here before (unregistered for a moment by Set up or the repair): waits a little.
let unreg = run([off, off, onOK], ranBefore: true)
check("unregistered-moment-fine", unreg.gap == nil && unreg.tries == 3)
// macOS flips it to "needs the yes" during the check (a new helper after an update, seen 12 Nov 2026 at 09:26:53):
// the check reports the truth, not the stale "on".
let flipped = run([onSilent, approve])
check("flipped-to-approve-says-needs-ok", flipped.gap == "needsOk")
// Not in this build, a self test copy: at once.
check("missing-at-once", run([Try(state: "missing", answered: false)]).tries == 1 && run([Try(state: "missing", answered: false)]).gap == "missing")
check("test-copy-fine", run([Try(state: "test", answered: false)]).gap == nil)
// An older helper (waits for the next restart): its own line, as before.
check("old-helper-says-older", run([onOK], old: true).gap == "older")
// The page's own limit is always longer than the longest check here, so the page never decides before the Mac.
check("page-waits-longer", C.onWait + C.answerWait + C.every < C.pageWait && C.offWait + C.every < C.pageWait)
check("waits-are-a-few-seconds", C.onWait <= 8 && C.offWait <= 4 && C.every < 1.5 && C.answerWait <= 2)
// Every state and answer, at every moment: never off while macOS says on.
var neverOffWhileOn = true
for ans in [true, false] { for old in [true, false] {
  let g = C.gap(state: "on", answered: ans, old: old)
  if g == "needsOk" || g == "notSetUp" || g == "missing" { neverOffWhileOn = false }
} }
check("gap-never-off-while-on", neverOffWhileOn)
var alwaysEnds = true
for st in ["on", "approve", "off", "missing", "test"] { for ans in [true, false] { for rb in [true, false] {
  if C.next(state: st, answered: ans, ranBefore: rb, elapsed: C.onWait + 1) != .done { alwaysEnds = false }
} } }
check("always-ends-after-on-wait", alwaysEnds)

// The stale miss (the V1.53 bug itself): "not switched on" never outlives macOS saying on.
check("stale-not-on-cleared-when-on", C.errorAfter(state: "on", error: C.notOnError) == nil)
check("not-on-kept-while-approve", C.errorAfter(state: "approve", error: C.notOnError) == C.notOnError)
check("real-miss-kept-when-on", C.errorAfter(state: "on", error: "no answer in 10 s") == "no answer in 10 s")
check("no-error-stays-none", C.errorAfter(state: "on", error: nil) == nil)

// The wiring, read from the sources.
let dir = ProcessInfo.processInfo.environment["PS_MAC_DIR"] ?? "."
func src(_ f: String) -> String { (try? String(contentsOfFile: "\(dir)/\(f)", encoding: .utf8)) ?? "" }
let ar = src("Sources/AutoReboot.swift"), mainSrc = src("Sources/main.swift"), sleep = src("Sources/SleepSentry.swift")
func section(_ s: String, from a: String, to b: String) -> String {
  guard let r1 = s.range(of: a), let r2 = s.range(of: b, range: r1.upperBound..<s.endIndex) else { return "" }
  return String(s[r1.lowerBound..<r2.lowerBound])
}
check("took-clears-stale-miss", section(ar, from: "private func took(", to: "private func readState(").contains("HelperCheckCore.errorAfter(state: state, error: lastError)"))
check("push-answer-clears-miss", section(ar, from: "func push(testOnce", to: "var helperProto").contains("self.heard(s)"))
check("ask-answer-uses-heard", section(ar, from: "private func ask() {", to: "private func heard(").contains("self.heard(s)"))
check("proxy-uses-shared-words", ar.contains("fail(HelperCheckCore.notOnError)"))
let chk = section(ar, from: "func check(done:", to: "/// The helper did not answer")
check("check-reads-macos-off-main", chk.contains("statusQ.async") && chk.contains("DispatchQueue.main.async"))
check("check-asks-helper-fresh", chk.contains("p.status {") && chk.contains("HelperCheckCore.answerWait"))
check("check-uses-the-rule", chk.contains("HelperCheckCore.next(state:"))
check("check-waits-without-blocking", chk.contains("asyncAfter") && !chk.contains("Thread.sleep") && !chk.contains(".sync {") && !chk.contains("DispatchSemaphore") && !chk.contains("usleep"))
check("check-misses-not-counted-for-repair", !chk.contains("failures +=") && !chk.contains("autoRepairIfDue") && !chk.contains("repair(manual"))
check("check-never-opens-settings", !chk.contains("openSystemSettings") && !chk.contains("setUp(") && !chk.contains("register("))
check("status-says-checks", ar.contains("d[\"checks\"] = 1") && ar.contains("d[\"checked\"] = checkedId"))
check("main-handles-reboot-check", mainSrc.contains("case \"reboot:check\" where fromMain || fromOverlay:") && mainSrc.contains("AutoReboot.shared.checkFromPage("))
let tap = section(sleep, from: "private func tapped()", to: "private func step(")
check("sleep-button-checks-fresh", tap.contains("AutoReboot.shared.check {") && tap.contains("busy = true"))
check("sleep-button-uses-fresh-result", sleep.contains("SleepSentryRules.afterHelperOK(c)") && tap.contains("lastGap == nil"))

print(fails == 0 ? "ALL OK" : "\(fails) FAILED")
exit(fails == 0 ? 0 : 1)

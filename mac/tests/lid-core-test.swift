// Unit tests for Sentry mode's lid closed keep awake in the helper (Helper/LidCore.swift). Run: tests/lid-core-test.sh
// Pure logic only: no root, no IOKit, nothing on the Mac is changed.
import Foundation

var fails = 0, checks = 0
func check(_ ok: Bool, _ what: String, line: Int = #line) { checks += 1; if !ok { fails += 1; print("FAIL (line \(line)): \(what)") } }
func sets(_ a: [LidAction]) -> [Bool] { a.compactMap { if case .set(let b) = $0 { return b }; return nil } }
func logs(_ a: [LidAction]) -> [String] { a.compactMap { if case .log(let s) = $0 { return s }; return nil } }
func why(_ r: [String: Any]) -> String? { r["why"] as? String }

let cool = LidPower(onBattery: true, percent: 80, thermal: 0)
let mains = LidPower(onBattery: false, percent: 3, thermal: 1)
func req(_ on: Bool, _ s: String = "session-A1", _ b: Int = 10) -> LidRequest { LidRequest(on: on, session: s, battery: b) }

// Parsing: only exactly {on, session, battery} with sane values.
check(LidRequest.parse(["on": true, "session": "abcd-1234", "battery": 10]) == req(true, "abcd-1234"), "a good request parses")
check(LidRequest.parse(["on": false, "session": "ABCDEFGH", "battery": 50]) != nil, "upper case session and 50% parse")
check(LidRequest.parse(["on": true, "session": "short", "battery": 10]) == nil, "a session under 8 refused")
check(LidRequest.parse(["on": true, "session": String(repeating: "a", count: 65), "battery": 10]) == nil, "a session over 64 refused")
check(LidRequest.parse(["on": true, "session": "abcd 1234", "battery": 10]) == nil, "a space in the session refused")
check(LidRequest.parse(["on": true, "session": "abcd/../1", "battery": 10]) == nil, "a slash in the session refused")
check(LidRequest.parse(["on": true, "session": "abcd-1234", "battery": 0]) == nil, "a 0% floor refused")
check(LidRequest.parse(["on": true, "session": "abcd-1234", "battery": 51]) == nil, "a 51% floor refused")
check(LidRequest.parse(["on": true, "session": "abcd-1234"]) == nil, "no floor refused")
check(LidRequest.parse(["on": true, "session": "abcd-1234", "battery": 10, "cmd": "x"]) == nil, "an extra key refused")
check(LidRequest.parse(["on": "yes", "session": "abcd-1234", "battery": 10]) == nil, "on as a string refused")
// Through real JSON, as XPC delivers it.
func viaJSON(_ s: String) -> LidRequest? { (try? JSONSerialization.jsonObject(with: Data(s.utf8)) as? [String: Any]).flatMap { LidRequest.parse($0) } }
check(viaJSON(#"{"on":true,"session":"abcd-1234","battery":10}"#) == req(true, "abcd-1234"), "JSON request parses")
check(viaJSON(#"{"on":1,"session":"abcd-1234","battery":10}"#) == nil, "JSON on: 1 is not a Bool")
check(viaJSON(#"{"on":true,"session":"abcd-1234","battery":true}"#) == nil, "JSON battery: true is not a number")

// Cutoffs.
check(LidEngine.cutoff(cool, floor: 10) == nil, "80% on battery, cool: fine")
check(LidEngine.cutoff(LidPower(onBattery: true, percent: 10, thermal: 0), floor: 10) == .battery, "at the floor: off")
check(LidEngine.cutoff(LidPower(onBattery: true, percent: 11, thermal: 0), floor: 10) == nil, "one above the floor: fine")
check(LidEngine.cutoff(LidPower(onBattery: true, percent: nil, thermal: 0), floor: 10) == .battery, "unknown level on battery counts as low")
check(LidEngine.cutoff(mains, floor: 10) == nil, "3% but on mains power: fine (charging)")
check(LidEngine.cutoff(LidPower(onBattery: false, percent: nil, thermal: 0), floor: 10) == nil, "a desktop with no battery: fine")
check(LidEngine.cutoff(LidPower(onBattery: false, percent: 90, thermal: 2), floor: 10) == .hot, "serious heat: off")
check(LidEngine.cutoff(LidPower(onBattery: false, percent: 90, thermal: 3), floor: 10) == .hot, "critical heat: off")
check(LidEngine.cutoff(LidPower(onBattery: true, percent: 5, thermal: 3), floor: 10) == .hot, "hot wins over battery")

// Start: always off; a stale on is logged.
do {
  let e = LidEngine()
  let a = e.start(actual: true)
  check(sets(a) == [false] && logs(a).count == 1 && !e.on && e.dirty, "on at start: turned off and logged")
  check(sets(e.tick(now: 1, power: cool, actual: false)).isEmpty && !e.dirty, "seen off: clean")
  let b = LidEngine().start(actual: false)
  check(sets(b) == [false] && logs(b).isEmpty, "off at start: set off again (idempotent), no log")
  let c = LidEngine(); let ca = c.start(actual: nil)
  check(sets(ca) == [false] && c.dirty, "unreadable at start: set off, and checked again")
}

// On, renew, off.
do {
  let e = LidEngine(); _ = e.start(actual: false); _ = e.tick(now: 0, power: cool, actual: false)
  var r = e.request(req(true), now: 100, power: cool, allowed: true)
  check(sets(r.actions) == [true] && e.on && r.reply["on"] as? Bool == true && r.reply["ok"] as? Bool == true, "on")
  check(logs(r.actions).first?.contains("on") == true && !(logs(r.actions).first ?? "").contains("session-A1"), "on is logged without the session")
  r = e.request(req(true), now: 130, power: cool, allowed: true)
  check(sets(r.actions).isEmpty && logs(r.actions).isEmpty && e.renewedAt == 130, "a renewal sets nothing and logs nothing")
  check(e.tick(now: 219, power: cool, actual: true).isEmpty && e.on, "89 s after the renewal: still on")
  r = e.request(req(false), now: 220, power: cool, allowed: true)
  check(sets(r.actions) == [false] && !e.on && r.reply["ok"] as? Bool == true, "off")
  r = e.request(req(false), now: 221, power: cool, allowed: true)
  check(r.reply["ok"] as? Bool == true && r.reply["on"] as? Bool == false, "off again: fine (idempotent)")
  check(sets(r.actions) == [false], "off again while not yet seen off: set off again")
  _ = e.tick(now: 222, power: cool, actual: false)
  r = e.request(req(false), now: 223, power: cool, allowed: true)
  check(r.actions.isEmpty, "off a third time once seen off: nothing to do")
  r = e.request(req(true), now: 224, power: cool, allowed: true)
  check(!e.on && sets(r.actions).isEmpty && why(r.reply) == "off", "a late renewal of the session PS turned off does not turn it on")
  r = e.request(req(true, "session-B2"), now: 225, power: cool, allowed: true)
  check(e.on && sets(r.actions) == [true], "a new session turns it on")
}

// The lease: no renewal for 90 s turns it off.
do {
  let e = LidEngine(); _ = e.start(actual: false)
  _ = e.request(req(true), now: 1000, power: cool, allowed: true)
  check(e.tick(now: 1090, power: cool, actual: true).isEmpty && e.on, "exactly 90 s: still on")
  let a = e.tick(now: 1090.5, power: cool, actual: true)
  check(sets(a) == [false] && !e.on && logs(a).first?.contains("renewing") == true, "over 90 s: off, logged as the lease")
  let r = e.request(req(true), now: 1091, power: cool, allowed: true)
  check(!e.on && why(r.reply) == "lease", "PS renewing after the lease ran out is told why and stays off")
  // A long sleep counts (the continuous clock): the first check after waking turns it off.
  let f = LidEngine(); _ = f.start(actual: false)
  _ = f.request(req(true), now: 0, power: cool, allowed: true)
  check(sets(f.tick(now: 3600, power: cool, actual: true)) == [false], "an hour later: off")
}

// Cutoffs while on, and at the request.
do {
  let e = LidEngine(); _ = e.start(actual: false)
  _ = e.request(req(true, "session-A1", 20), now: 0, power: cool, allowed: true)
  var a = e.tick(now: 2, power: LidPower(onBattery: true, percent: 21, thermal: 1), actual: true)
  check(a.isEmpty && e.on, "21% with a 20% floor, fair heat: on")
  a = e.tick(now: 4, power: LidPower(onBattery: true, percent: 20, thermal: 0), actual: true)
  check(sets(a) == [false] && !e.on && logs(a).first?.contains("battery") == true, "20% with a 20% floor: off")
  var r = e.request(req(true, "session-A1", 20), now: 5, power: LidPower(onBattery: false, percent: 20, thermal: 0), allowed: true)
  check(!e.on && why(r.reply) == "battery", "plugged in after the cutoff: the same session stays off and is told battery")
  r = e.request(req(true, "session-C3", 20), now: 6, power: LidPower(onBattery: false, percent: 20, thermal: 0), allowed: true)
  check(e.on, "a new session while plugged in: on")
  a = e.tick(now: 8, power: LidPower(onBattery: false, percent: 20, thermal: 2), actual: true)
  check(sets(a) == [false] && !e.on && logs(a).first?.contains("hot") == true, "serious heat: off")
  r = e.request(req(true, "session-C3", 20), now: 9, power: cool, allowed: true)
  check(why(r.reply) == "hot" && !e.on, "renewal after heat cutoff: told hot")
  r = e.request(req(true, "session-D4", 10), now: 10, power: LidPower(onBattery: true, percent: 7, thermal: 0), allowed: true)
  check(!e.on && why(r.reply) == "battery" && r.reply["ok"] as? Bool == false && !sets(r.actions).contains(true), "turning on at 7%: refused, never set on")
  r = e.request(req(true, "session-D4", 10), now: 11, power: cool, allowed: true)
  check(!e.on && why(r.reply) == "battery", "that refused session never turns on later")
  r = e.request(req(true, "session-E5", 10), now: 12, power: LidPower(onBattery: false, percent: 90, thermal: 3), allowed: true)
  check(!e.on && why(r.reply) == "hot", "turning on while critically hot: refused")
}

// Only the console user's PS may turn it on; any genuine PS may turn it off.
do {
  let e = LidEngine(); _ = e.start(actual: false)
  var r = e.request(req(true), now: 0, power: cool, allowed: false)
  check(!e.on && r.actions.isEmpty && why(r.reply) == "notAllowed", "not the console user: not on")
  _ = e.request(req(true, "session-F6"), now: 1, power: cool, allowed: true)
  r = e.request(req(true, "session-F6"), now: 2, power: cool, allowed: false)
  check(e.on && why(r.reply) == "notAllowed", "a renewal from someone not on the console is refused (and the lease then runs out)")
  r = e.request(req(false, "session-F6"), now: 3, power: cool, allowed: false)
  check(!e.on && sets(r.actions) == [false], "off is always allowed")
}

// macOS setting it back, a failed set, and an off that did not take.
do {
  let e = LidEngine(); _ = e.start(actual: false); _ = e.tick(now: 0, power: cool, actual: false)
  _ = e.request(req(true), now: 0, power: cool, allowed: true)
  var a = e.tick(now: 2, power: cool, actual: false)
  check(sets(a) == [true] && logs(a).count == 1, "macOS set it off while wanted: on again, logged")
  a = e.tick(now: 4, power: cool, actual: false)
  check(sets(a) == [true] && logs(a).isEmpty, "again: on again, not logged twice")
  check(e.tick(now: 6, power: cool, actual: true).isEmpty, "took: nothing")
  check(e.tick(now: 8, power: cool, actual: nil).isEmpty && e.on, "unreadable while on: left alone")
  a = e.applyFailed()
  check(sets(a) == [false] && !e.on && logs(a).first?.contains("did not take") == true, "a failed on: off, logged")
  check(why(e.replyNow) == "failed" && e.replyNow["on"] as? Bool == false, "the reply after a failed on says failed")
  check(e.applyFailed().isEmpty, "a second failure report changes nothing")
  a = e.tick(now: 10, power: cool, actual: true)
  check(sets(a) == [false] && logs(a).count == 1, "still on after off: tried again, logged once")
  a = e.tick(now: 12, power: cool, actual: true)
  check(sets(a) == [false] && logs(a).isEmpty, "and again, quietly")
  a = e.tick(now: 14, power: cool, actual: nil)
  check(sets(a) == [false], "unreadable after off: set off again to be sure")
  check(e.tick(now: 16, power: cool, actual: false).isEmpty && !e.dirty, "off at last: clean, nothing more")
  check(e.tick(now: 18, power: cool, actual: true).isEmpty, "on again by someone else (the developer's own pmset) while we are clean: left alone")
}

// The helper stopping.
do {
  let e = LidEngine(); _ = e.start(actual: false); _ = e.tick(now: 0, power: cool, actual: false)
  check(e.stopping().isEmpty, "stopping while never on: nothing")
  _ = e.request(req(true), now: 0, power: cool, allowed: true)
  let a = e.stopping()
  check(sets(a) == [false] && !e.on, "stopping while on: off")
  check(why(e.request(req(true), now: 1, power: cool, allowed: true).reply) == "off", "that session stays off")
}

// The latch keeps the last 16 sessions.
do {
  let e = LidEngine(); _ = e.start(actual: false)
  for i in 0..<20 { _ = e.request(req(false, "session-\(1000 + i)"), now: Double(i), power: cool, allowed: true) }
  check(e.stopped.count == 16 && e.stopped.first?.session == "session-1004", "latch bounded at 16, oldest dropped")
}

// ===== Sentry restart deadline =====
func rq(_ j: String) -> SentryRestartRequest? { (try? JSONSerialization.jsonObject(with: Data(j.utf8)) as? [String: Any]).flatMap { SentryRestartRequest.parse($0) } }
check(rq(#"{"op":"arm","seconds":28800}"#) == .arm(28800), "arm parses")
check(rq(#"{"op":"arm","seconds":28800.5}"#) == .arm(28800.5), "arm with a fraction parses")
check(rq(#"{"op":"cancel"}"#) == .cancel && rq(#"{"op":"read"}"#) == .read, "cancel and read parse")
check(rq(#"{"op":"arm"}"#) == nil, "arm without seconds refused")
check(rq(#"{"op":"arm","seconds":"8h"}"#) == nil, "seconds as text refused")
check(rq(#"{"op":"arm","seconds":true}"#) == nil, "seconds as a Bool refused")
check(rq(#"{"op":"arm","seconds":600,"boot":"x"}"#) == nil, "an extra key refused")
check(rq(#"{"op":"cancel","now":1}"#) == nil, "cancel with extras refused")
check(rq(#"{"op":"restart"}"#) == nil && rq(#"{}"#) == nil, "unknown or missing op refused")

check(SentryRestart.arm(seconds: 299, boot: "B1", now: 0, wall: 0) == nil, "under 5 min refused")
check(SentryRestart.arm(seconds: 7 * 86400 + 1, boot: "B1", now: 0, wall: 0) == nil, "over 7 days refused")
check(SentryRestart.arm(seconds: 600, boot: "", now: 0, wall: 0) == nil, "no boot id: refused")
let d8 = SentryRestart.arm(seconds: 8 * 3600, boot: "B1", now: 100, wall: 1_000_000)!
check(d8.at == 100 + 28800 && d8.boot == "B1", "8 hours armed on the continuous clock, tied to this boot")

// Loading at helper start.
check(SentryRestart.loaded(d8, damaged: false, boot: "B1").keep == d8, "same boot: kept (a helper crash or update does not lose it)")
let other = SentryRestart.loaded(d8, damaged: false, boot: "B2")
check(other.keep == nil && other.log?.contains("earlier boot") == true, "another boot: cleared, so the restart it caused never repeats")
check(SentryRestart.loaded(nil, damaged: true, boot: "B1").keep == nil, "damaged file: dropped")
check(SentryRestart.loaded(nil, damaged: false, boot: "B1").keep == nil && SentryRestart.loaded(nil, damaged: false, boot: "B1").log == nil, "none: nothing, no log")

// Due.
check(SentryRestart.due(nil, boot: "B1", now: 1e9, signedIn: true) == .none, "nothing armed: nothing")
check(SentryRestart.due(d8, boot: "B1", now: 28899, signedIn: true) == .none, "a second early: nothing")
check(SentryRestart.due(d8, boot: "B1", now: 28900, signedIn: true) == .fire, "at the deadline: restart")
check(SentryRestart.due(d8, boot: "B1", now: 1e7, signedIn: true) == .fire, "long after (woke late): restart")
if case .drop = SentryRestart.due(d8, boot: "B2", now: 1e7, signedIn: true) {} else { check(false, "another boot never fires") }
if case .drop(let w) = SentryRestart.due(d8, boot: "B1", now: 28900, signedIn: false) { check(w.contains("Before First Unlock"), "no sign in seen: dropped, says why") }
else { check(false, "no sign in in this boot: never restart (Before First Unlock)") }

// Wake time and reply.
check(SentryRestart.wakeWall(d8, now: 100, wall: 1_000_000) == 1_028_800, "wake at the deadline in wall time")
check(SentryRestart.wakeWall(d8, now: 28890, wall: 2_000_000) == 2_000_030, "a deadline about to pass: wake at least 30 s ahead")
check(SentryRestart.wakeWall(d8, now: 100, wall: 1_000_000.2) == 1_028_801, "whole seconds, rounded up")
let rp = SentryRestart.reply(d8, now: 3700, wall: 5_000_000)
check(rp["ok"] as? Bool == true && rp["deadline"] as? Double == 5_025_200 && rp["left"] as? Double == 25200, "reply: deadline in wall time and seconds left")
check(SentryRestart.reply(nil, now: 0, wall: 0)["deadline"] == nil, "reply with none: no deadline")
check(SentryRestart.reply(d8, now: 1e6, wall: 0)["left"] as? Double == 0, "left never negative")
let rf = SentryRestart.reply(nil, now: 0, wall: 0, ok: false, why: "range")
check(rf["ok"] as? Bool == false && rf["why"] as? String == "range", "a refusal says why")

// A real unlock cancels the Sentry restart by itself: only locked or login window, then unlocked.
check(SentryRestart.unlockCancels(previous: .locked, now: .unlocked), "locked then unlocked: cancels")
check(SentryRestart.unlockCancels(previous: .noUser, now: .unlocked), "login window then signed in: cancels")
check(!SentryRestart.unlockCancels(previous: .unlocked, now: .unlocked), "unlocked all along (Sentry's own cover): never cancels")
check(!SentryRestart.unlockCancels(previous: .unlocked, now: .locked), "locking: not yet")
check(!SentryRestart.unlockCancels(previous: .locked, now: .locked), "still locked: no")
check(!SentryRestart.unlockCancels(previous: .locked, now: .noUser), "logged out: no")
check(!SentryRestart.unlockCancels(previous: nil, now: .unlocked), "nothing seen before: no (needs a real transition)")

// V1.53: the kernel call's plain parts. The clamshell switch takes one input, 1 on and 0 off; a refusal is logged
// once with its real IOReturn (V1.48 to V1.52's SleepDisabled write came back 0xe00002e2 on the developer's Mac).
check(LidIO.input(true) == 1 && LidIO.input(false) == 0, "the switch's input: 1 on, 0 off")
check(LidIO.describe(Int32(bitPattern: 0xe00002e2)) == "0xe00002e2 kIOReturnNotPermitted", "not permitted, by hex and name")
check(LidIO.describe(Int32(bitPattern: 0xe00002c2)) == "0xe00002c2 kIOReturnBadArgument", "bad argument, by hex and name")
check(LidIO.describe(Int32(bitPattern: 0xe00002c1)) == "0xe00002c1 kIOReturnNotPrivileged", "not privileged, by hex and name")
check(LidIO.describe(0) == "0x00000000", "success: eight hex digits, no name")
check(LidIO.describe(Int32(bitPattern: 0xe0000999)) == "0xe0000999", "an unknown code: hex only")
check(LidIO.describe(5) == "0x00000005", "a small kern_return_t: padded")
let refusalLine = LidIO.refusal(on: true, Int32(bitPattern: 0xe00002e2))
check(refusalLine == "lid keep awake: macOS refused to turn it on (IOReturn 0xe00002e2 kIOReturnNotPermitted)", "the refusal log line")
check(LidIO.refusal(on: false, Int32(bitPattern: 0xe00002bc)).contains("turn it off (IOReturn 0xe00002bc kIOReturnError)"), "a refused off says off")

// V1.53: the engine as rebootd now drives it. The switch cannot be read back, so `actual` is what the kernel last
// accepted (nil before the first and after a refusal), and while on the helper sends the switch again every 2 s.
// A fake kernel stands in for applyLid; runLid's logic is copied as rebootd.swift has it.
do {
  var kernelAccepts = true, kernel: Bool? = nil, calls: [Bool] = []
  let e = LidEngine()
  func run(_ acts: [LidAction]) -> Bool {
    var failedOn = false
    for a in acts { if case .set(let on) = a { calls.append(on); if kernelAccepts { kernel = on } else { kernel = nil; if on { failedOn = true } } } }
    if failedOn { _ = run(e.applyFailed()) }
    return failedOn
  }
  func tick(_ now: Double) { if e.on || e.dirty { _ = run(e.tick(now: now, power: cool, actual: kernel)) }; if e.on { _ = run([.set(true)]) } }
  _ = run(e.start(actual: kernel))
  check(calls == [false] && kernel == false && e.dirty, "helper start, nothing known: off sent, accepted")
  tick(2)
  check(!e.dirty && calls == [false], "first check after an accepted off: clean, nothing more sent")
  tick(4); check(calls == [false], "clean and off: the 2 s check sends nothing")
  let r = e.request(req(true), now: 10, power: cool, allowed: true)
  let failed = run(r.actions)
  check(!failed && e.on && kernel == true && calls == [false, true], "on: the switch set, accepted")
  tick(12); tick(14)
  check(calls == [false, true, true, true] && e.on, "while on: sent again every check (powerd may have cleared it)")
  check(sets(e.request(req(true), now: 40, power: cool, allowed: true).actions).isEmpty, "a renewal while on: nothing to send")
  kernelAccepts = false
  tick(42)
  check(!e.on && why(e.replyNow) == "failed" && calls.suffix(2) == [true, false], "the kernel refuses a resend: off, session failed")
  check(e.dirty && kernel == nil, "the off after a refusal was refused too: still marked, tried again")
  tick(44); check(calls.last == false, "off tried again on the next check")
  kernelAccepts = true
  tick(46); tick(48)
  check(!e.dirty && kernel == false, "off accepted at last: clean")
  let n = calls.count; tick(50); check(calls.count == n, "clean: nothing sent")
  let late = e.request(req(true), now: 52, power: cool, allowed: true)
  check(sets(late.actions).isEmpty && why(late.reply) == "failed", "a late renewal of the failed session never turns it on again")
}
do {
  // The first on is refused (V1.52's failure as PS saw it): PS gets "failed" in the same reply.
  var kernel: Bool? = nil
  let e = LidEngine()
  func run(_ acts: [LidAction], accept: Bool) -> Bool {
    var failedOn = false
    for a in acts { if case .set(let on) = a { if accept { kernel = on } else { kernel = nil; if on { failedOn = true } } } }
    if failedOn { _ = run(e.applyFailed(), accept: accept) }
    return failedOn
  }
  _ = run(e.start(actual: kernel), accept: true)
  let r = e.request(req(true, "session-B2"), now: 1, power: cool, allowed: true)
  let failed = run(r.actions, accept: false)
  let reply = failed ? e.replyNow : r.reply
  check(failed && why(reply) == "failed" && reply["on"] as? Bool == false && !e.on, "a refused first on: PS is told failed at once")
}

print(fails == 0 ? "LID CORE: all \(checks) checks ok" : "LID CORE: \(fails) of \(checks) checks FAILED")
exit(fails == 0 ? 0 : 1)

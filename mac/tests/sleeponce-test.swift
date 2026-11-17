// "Just tomorrow" on the Sleep screen (Sources/SleepOnceCore.swift), PS 1.65. Run: tests/sleeponce-test.sh. FICTIONAL values.
import Foundation

var n = 0
func ok(_ name: String, _ f: () -> Bool) { if f() { n += 1; print("ok - \(name)") } else { print("FAIL - \(name)"); exit(1) } }

let words: [String: Any] = ["title": "Just tomorrow", "skip": "Skip", "later": "Later", "pick": "Pick a time", "undo": "Undo", "save": "Save",
                            "reason": "change tomorrow's alarm", "undoReason": "undo the change",
                            "mins": [["mins": 30, "label": "30 min later"], ["mins": 60, "label": "1 h later"]]]
let full: [String: Any] = ["set": true, "skipped": false, "line": "Just tomorrow: 09:00", "usual": "08:00", "words": words]

ok("decode: a full once") {
  guard let p = SleepOnce.parse(full) else { return false }
  return p.set && !p.skipped && p.line == "Just tomorrow: 09:00" && p.usual == "08:00" && p.words.skip == "Skip" && p.words.pick == "Pick a time"
    && p.words.undo == "Undo" && p.words.save == "Save" && p.words.reason == "change tomorrow's alarm" && p.words.undoReason == "undo the change"
    && p.words.mins == [SleepOnce.Min(mins: 30, label: "30 min later"), SleepOnce.Min(mins: 60, label: "1 h later")]
}
ok("decode: no once means nothing is drawn") {
  SleepOnce.parse(nil) == nil && SleepOnce.parse("x") == nil && SleepOnce.parse([String: Any]()) == nil
}
ok("decode: a bad usual time or an empty line draws nothing") {
  var a = full; a["usual"] = "25:00"
  var b = full; b["line"] = "   "
  var c = full; c["usual"] = "9:00"
  return SleepOnce.parse(a) == nil && SleepOnce.parse(b) == nil && SleepOnce.parse(c) == nil
}
ok("decode: wrong types dropped, text and minutes capped") {
  var w = words; w["mins"] = [["mins": 0, "label": "zero"], ["mins": 5000, "label": "huge"], ["mins": 45, "label": ""], ["mins": "x", "label": "bad"], ["mins": 45, "label": "ok"]]
  w["reason"] = String(repeating: "r", count: 300)
  var d = full; d["words"] = w; d["set"] = "yes"; d["line"] = String(repeating: "l", count: 500)
  guard let p = SleepOnce.parse(d) else { return false }
  return p.words.mins == [SleepOnce.Min(mins: 45, label: "ok")] && p.words.reason.count == 80 && p.line.count == 160 && p.set == false
}
ok("every choice has its JSON") {
  SleepOnce.json(.skip) == "{\"once\":{\"act\":\"skip\"}}"
  && SleepOnce.json(.later(60)) == "{\"once\":{\"act\":\"later\",\"mins\":60}}"
  && SleepOnce.json(.pick("10:45")) == "{\"once\":{\"act\":\"pick\",\"at\":\"10:45\"}}"
  && SleepOnce.json(.undo) == "{\"once\":{\"act\":\"undo\"}}"
}
ok("a choice that is not valid has no JSON") {
  SleepOnce.json(.later(0)) == nil && SleepOnce.json(.later(1441)) == nil && SleepOnce.json(.pick("24:00")) == nil
  && SleepOnce.json(.pick("9:5")) == nil && SleepOnce.json(.pick("10:45\"}}")) == nil
}
ok("pick starts at the usual time plus an hour, across midnight too") {
  SleepOnce.pickStart(usual: "09:00") == "10:00" && SleepOnce.pickStart(usual: "23:30") == "00:30" && SleepOnce.pickStart(usual: "23:00") == "00:00"
  && SleepOnce.pickStart(usual: "00:15") == "01:15" && SleepOnce.pickStart(usual: "nope") == nil
}
ok("times: valid, minutes, clock") {
  SleepOnce.validTime("00:00") && SleepOnce.validTime("23:59") && !SleepOnce.validTime("24:00") && !SleepOnce.validTime("12:60") && !SleepOnce.validTime("")
  && SleepOnce.minutes("07:05") == 425 && SleepOnce.clock(1500) == "01:00" && SleepOnce.clock(-30) == "23:30"
}
ok("gate: not passed sends nothing, for every choice") {
  SleepOnce.gate(authPassed: false, .skip) == nil && SleepOnce.gate(authPassed: false, .later(60)) == nil
  && SleepOnce.gate(authPassed: false, .pick("10:45")) == nil && SleepOnce.gate(authPassed: false, .undo) == nil
}
ok("gate: passed sends the JSON") {
  SleepOnce.gate(authPassed: true, .skip) == "{\"once\":{\"act\":\"skip\"}}"
  && SleepOnce.gate(authPassed: true, .later(30)) == "{\"once\":{\"act\":\"later\",\"mins\":30}}"
  && SleepOnce.gate(authPassed: true, .pick("10:45")) == "{\"once\":{\"act\":\"pick\",\"at\":\"10:45\"}}"
  && SleepOnce.gate(authPassed: true, .undo) == "{\"once\":{\"act\":\"undo\"}}"
  && SleepOnce.gate(authPassed: true, .pick("bad")) == nil
}
ok("the sheet's reason: Undo has its own, never empty, at most 80") {
  guard let p = SleepOnce.parse(full) else { return false }
  var bare = p.words; bare.reason = ""; bare.undoReason = ""
  return SleepOnce.reason(for: .skip, words: p.words) == "change tomorrow's alarm" && SleepOnce.reason(for: .undo, words: p.words) == "undo the change"
    && SleepOnce.reason(for: .skip, words: bare) == "PS" && SleepOnce.cleanReason(String(repeating: "x", count: 200)).count == 80
}
ok("auth id: 1 to 24 letters, digits, underscore, hyphen") {
  SleepOnce.okAuthId("a") == "a" && SleepOnce.okAuthId("Ab_9-z") == "Ab_9-z" && SleepOnce.okAuthId(String(repeating: "a", count: 24)) != nil
  && SleepOnce.okAuthId("") == nil && SleepOnce.okAuthId(String(repeating: "a", count: 25)) == nil && SleepOnce.okAuthId("a b") == nil
  && SleepOnce.okAuthId("a\"}") == nil && SleepOnce.okAuthId("a\n") == nil && SleepOnce.okAuthId(7) == nil && SleepOnce.okAuthId(nil) == nil
}
ok("auth reply: ok, not ok, and a Mac that cannot ask") {
  SleepOnce.authReply(id: "k1", ok: true, none: false) == "{\"authId\":\"k1\",\"authOk\":true}"
  && SleepOnce.authReply(id: "k1", ok: false, none: false) == "{\"authId\":\"k1\",\"authOk\":false}"
  && SleepOnce.authReply(id: "k1", ok: false, none: true) == "{\"authId\":\"k1\",\"authNone\":true,\"authOk\":false}"
  && SleepOnce.authReply(id: "k1", ok: true, none: true) == "{\"authId\":\"k1\",\"authOk\":true}"
  && SleepOnce.authReply(id: "bad id", ok: true, none: false) == nil
  && (SleepOnce.authReply(id: "k1", ok: false, none: true).flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) } != nil)
}
ok("one sheet at a time: a second request is refused until the first ends") {
  var l = SleepOnce.Latch()
  let a = l.begin(), b = l.begin()
  l.end()
  let c = l.begin()
  return a && !b && c && l.busy
}
print("\(n) passed")

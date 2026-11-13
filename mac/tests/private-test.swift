// Unit tests for private mode's pure part (Sources/PrivateCore.swift, V1.57): the pill's words and which pop ups with
// windows of their own wait behind a pill. No window, nothing on screen. Run: bash tests/private-test.sh
import Foundation

var passed = 0
func ok(_ name: String, _ cond: Bool, _ more: String = "") {
  if cond { passed += 1; print("ok - \(name)") } else { print("FAIL - \(name) \(more)"); exit(1) }
}

ok("the pill's words", PrivateCore.title == "New notification" && PrivateCore.sub == "Private mode is on")
ok("a pop up's pill id and back", PrivateCore.cardId("rem:abc") == "pv:rem:abc" && PrivateCore.key(ofCard: "pv:rem:abc") == "rem:abc")
ok("other cards are not pills of a pop up", PrivateCore.key(ofCard: "c:abc") == nil && PrivateCore.key(ofCard: "pv:") == nil)
ok("a pill id stays within the stack's 40", PrivateCore.cardId(String(repeating: "x", count: 60)).count == 40)
ok("card sounds play only with private mode off", PrivateCore.cardSound(privateOn: false) && !PrivateCore.cardSound(privateOn: true))

var h = PrivateHolds()
ok("private mode off: a pop up shows", h.wants("rem:a").wait == false && h.waiting.isEmpty)
ok("turning it on lets nothing out", h.set(true).isEmpty && h.on)
let first = h.wants("rem:a")
ok("private mode on: it waits, with one new pill", first.wait && first.newPill)
let again = h.wants("rem:a")
ok("asking again (a re-place, a timer) makes no second pill", again.wait && !again.newPill && h.waiting == ["rem:a"])
_ = h.wants("update"); _ = h.wants("notes")
ok("several wait, oldest first", h.waiting == ["rem:a", "update", "notes"])
ok("its pill clicked: that one comes out", h.open("update") && h.waiting == ["rem:a", "notes"])
ok("once out it shows as itself while private mode stays on", h.wants("update").wait == false)
ok("a click on a pill that is not waiting does nothing", !h.open("helper"))
ok("a pop up that went takes its pill with it", h.gone("notes") && h.waiting == ["rem:a"])
ok("one that went and comes back later waits again", h.wants("notes").newPill)
ok("gone for one that was out: nothing to take", !h.gone("update"))
ok("after going, one that was out waits again next time", h.wants("update").wait)
let released = h.set(false)
ok("private mode off: every waiting pop up comes out, oldest first", released == ["rem:a", "notes", "update"], "\(released)")
ok("and nothing waits any more", h.waiting.isEmpty && !h.on)
ok("off again changes nothing", h.set(false).isEmpty)
_ = h.set(true)
ok("on again: one clicked out last time waits again", h.wants("update").wait)

print("\n\(passed) private mode checks passed")

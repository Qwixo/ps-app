// Unit tests for the trackpad phases the Tab list hears (Sources/PageSwipe.swift, V1.55). No window, no event, no
// web view: only the rule that turns a scroll event's phase into the page's one letter. Run: bash tests/pageswipe-test.sh
import AppKit

var passed = 0
func ok(_ name: String, _ cond: Bool) {
  if cond { passed += 1; print("ok - \(name)") } else { print("FAIL - \(name)"); exit(1) }
}
ok("fingers touch: b", PageSwipe.phaseLetter(.began, []) == "b" && PageSwipe.phaseLetter(.mayBegin, []) == "b")
ok("fingers lift or macOS cancels: e", PageSwipe.phaseLetter(.ended, []) == "e" && PageSwipe.phaseLetter(.cancelled, []) == "e")
ok("the glide starts: m", PageSwipe.phaseLetter([], .began) == "m")
ok("the moves in between and the glide's own steps say nothing", PageSwipe.phaseLetter(.changed, []) == nil && PageSwipe.phaseLetter([], .changed) == nil && PageSwipe.phaseLetter([], .ended) == nil)
ok("a mouse wheel (no phase at all) says nothing", PageSwipe.phaseLetter([], []) == nil)
print("\(passed) of \(passed) ok")

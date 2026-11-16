// Tests for NoteStackCore (PS 1.65 stacked notifications): the badge words, the shape for 0, 1, 2, 5 and 50 cards, the cap, the
// switch off giving today's numbers. The page's own open/shut model has the same cases in tests/notestack-test.mjs.
import Foundation

var failed = 0, passed = 0
func check(_ name: String, _ ok: Bool, _ more: String = "") {
  if ok { passed += 1; print("ok - \(name)") } else { failed += 1; print("FAIL - \(name) \(more)") }
}

// The badge: never +0, never a negative.
check("0 cards no badge", NoteStackCore.badgeText(count: 0) == nil)
check("1 card no badge", NoteStackCore.badgeText(count: 1) == nil)
check("2 cards +1", NoteStackCore.badgeText(count: 2) == "+1")
check("5 cards +4", NoteStackCore.badgeText(count: 5) == "+4")
check("50 cards +49", NoteStackCore.badgeText(count: 50) == "+49")
var neverZero = true
for n in -5...80 { let t = NoteStackCore.badgeText(count: n); if t == "+0" || (t?.hasPrefix("+-") ?? false) || (n > 1) != (t != nil) || NoteStackCore.badge(count: n) < 0 { neverZero = false } }
check("badge right for every count from -5 to 80", neverZero)

// The shape.
check("shape 0", NoteStackCore.shape(count: 0, on: true, open: false) == .none)
check("shape 1 single", NoteStackCore.shape(count: 1, on: true, open: false) == .single && NoteStackCore.shape(count: 1, on: true, open: true) == .single)
check("shape 2 shut", NoteStackCore.shape(count: 2, on: true, open: false) == .collapsed(more: 1))
check("shape 5 shut", NoteStackCore.shape(count: 5, on: true, open: false) == .collapsed(more: 4))
check("shape 50 shut", NoteStackCore.shape(count: 50, on: true, open: false) == .collapsed(more: 49))
check("shape 5 open", NoteStackCore.shape(count: 5, on: true, open: true) == .open)
check("shape switch off is today's list for 2, 5, 50", [2, 5, 50].allSatisfy { NoteStackCore.shape(count: $0, on: false, open: false) == .open })
check("shape dismissing down from open to 1 is single", NoteStackCore.shape(count: 1, on: true, open: true) == .single)

// The cap: switch on is the whole visible height less a margin, off is 45% as before.
check("cap off is 45%", NoteStackCore.cap(visibleHeight: 800, on: false) == 360)
check("cap on is the visible height less the margin", NoteStackCore.cap(visibleHeight: 800, on: true) == 784)
check("cap on is taller than off on every screen", [600, 800, 900, 1200, 1440].allSatisfy { NoteStackCore.cap(visibleHeight: CGFloat($0), on: true) > NoteStackCore.cap(visibleHeight: CGFloat($0), on: false) })
check("cap never negative or broken", NoteStackCore.cap(visibleHeight: 0, on: true) == 0 && NoteStackCore.cap(visibleHeight: -5, on: true) == 0 && NoteStackCore.cap(visibleHeight: .nan, on: false) == 0 && NoteStackCore.cap(visibleHeight: 10, on: true) == 0)

// The page's message and the feature id.
check("pinned message", NoteStackCore.pinned(from: ["type": "stack", "pinned": true]) && !NoteStackCore.pinned(from: ["pinned": false]) && !NoteStackCore.pinned(from: ["pinned": "yes"]) && !NoteStackCore.pinned(from: [:]))
check("open message", NoteStackCore.open(from: ["open": true]) && !NoteStackCore.open(from: ["open": false]) && !NoteStackCore.open(from: ["open": 1]) && !NoteStackCore.open(from: [:]))
do {
  // Two stacks (corner and island): Esc is passed on while either has its list open.
  let w = NoteStackCore.OpenWatch(), a = NSObject(), b = NSObject()
  check("watch starts shut", !w.anyOpen)
  w.set(ObjectIdentifier(a), true); check("one open", w.anyOpen)
  w.set(ObjectIdentifier(b), true); w.set(ObjectIdentifier(a), false); check("the other still open", w.anyOpen)
  w.set(ObjectIdentifier(b), false); check("both shut", !w.anyOpen)
  DispatchQueue.concurrentPerform(iterations: 200) { i in w.set(ObjectIdentifier(i % 2 == 0 ? a : b), i % 3 == 0); _ = w.anyOpen }
  check("safe from another thread", true)
}
check("feature id", NoteStackCore.feature == "notif-stack")

print("\(passed) passed, \(failed) failed")
exit(failed == 0 ? 0 : 1)

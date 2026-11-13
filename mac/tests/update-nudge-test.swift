// Offline test for Sources/UpdateNudge.swift (the update pop-up's rules, V1.40): once per update, Later for a day
// then one more time, waits for Do Not Disturb, 1Password or Signal and an install, kept across a restart.
//   mkdir -p build/nudge && cp tests/update-nudge-test.swift build/nudge/main.swift && swiftc build/nudge/main.swift Sources/UpdateNudge.swift -o build/nudge/test && build/nudge/test
import Foundation

var fails = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty ? "" : " (\(info))")"); if !ok { fails += 1 } }
let t0 = Date(timeIntervalSince1970: 1_800_000_000)
func at(_ h: Double) -> Date { t0.addingTimeInterval(h * 3600) }
func step(_ n: UpdateNudge, _ k: String, _ h: Double, dnd: Bool = false, prot: Bool = false, busy: Bool = false) -> UpdateNudge.Step {
  n.step(key: k, now: at(h), dnd: dnd, protectedFront: prot, busy: busy)
}

// Once per version.
var n = UpdateNudge()
check("new-update-shows", step(n, "a1", 0) == .show)
n.didShow(key: "a1")
check("not-on-the-next-check", step(n, "a1", 0.5) == .quiet("already shown"))
check("not-a-day-later-either", step(n, "a1", 30) == .quiet("already shown"))
check("a-newer-update-shows", step(n, "a2", 1) == .show)
n.didShow(key: "a2")
check("newer-update-counts-afresh", n.key == "a2" && n.shown == 1 && n.laterUntil == 0 && !n.answered)

// Later: a day of quiet, then once more, then never by itself.
n = UpdateNudge(); n.didShow(key: "a1"); n.later(now: at(0))
check("later-quiet-an-hour-on", step(n, "a1", 1) == .quiet("Later, until \(Int(at(24).timeIntervalSince1970))"))
check("later-quiet-just-before-a-day", { if case .quiet = step(n, "a1", 23.9) { return true }; return false }())
check("later-back-after-a-day", step(n, "a1", 24.1) == .show)
n.didShow(key: "a1")
check("second-show-not-again", step(n, "a1", 24.6) == .quiet("shown 2 times"))
n.later(now: at(25))
check("second-later-ends-it", n.answered && step(n, "a1", 80) == .quiet("answered"))
check("newer-update-after-two-laters", step(n, "a2", 81) == .show)

// Update now ends it (the card or the gear menu).
n = UpdateNudge(); n.didShow(key: "w1"); n.updateNow(key: "w1")
check("update-now-ends-it", step(n, "w1", 48) == .quiet("answered"))
n = UpdateNudge(); n.updateNow(key: "w9")   // started from the gear before it ever popped up
check("gear-update-never-pops-up", step(n, "w9", 1) == .quiet("answered"))

// Waits: Do Not Disturb, 1Password or Signal in front, an install running. Nothing is counted while it waits.
n = UpdateNudge()
check("waits-for-dnd", step(n, "a1", 0, dnd: true) == .wait("Do Not Disturb is on"))
check("waits-for-1password-or-signal", step(n, "a1", 0, prot: true) == .wait("1Password or Signal is in front"))
check("waits-for-an-install", step(n, "a1", 0, busy: true) == .wait("an install is running"))
check("waiting-counts-nothing", n == UpdateNudge())
check("shows-when-dnd-ends", step(n, "a1", 2) == .show)
n.didShow(key: "a1"); n.later(now: at(0))
check("snooze-over-but-dnd-waits", step(n, "a1", 25, dnd: true) == .wait("Do Not Disturb is on"))
check("already-shown-stays-quiet-in-dnd", { var m = UpdateNudge(); m.didShow(key: "a1"); return step(m, "a1", 1, dnd: true) == .quiet("already shown") }())
check("no-update-no-popup", step(UpdateNudge(), "", 0) == .quiet("no update"))

// Kept across a restart.
let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("ps-nudge-test-\(getpid())")
let file = dir.appendingPathComponent("nudge.json")
n = UpdateNudge(); n.didShow(key: "a7"); n.later(now: at(0)); n.save(file)
let back = UpdateNudge.load(file)
check("saved-and-read-back", back == n && step(back, "a7", 2) != .show)
check("missing-file-is-fresh", UpdateNudge.load(dir.appendingPathComponent("none.json")) == UpdateNudge())
try? "{not json".write(to: file, atomically: true, encoding: .utf8)
check("broken-file-is-fresh", UpdateNudge.load(file) == UpdateNudge())

// The setup offer after an update (G Squad): each generation once, only after an update, signed in.
var s = SetupOffer()
func sstep(_ s: SetupOffer, gen: Int, updated: Bool = true, signedIn: Bool = true, dnd: Bool = false, prot: Bool = false) -> UpdateNudge.Step {
  s.step(gen: gen, updated: updated, signedIn: signedIn, dnd: dnd, protectedFront: prot, busy: false)
}
check("setup-after-update", sstep(s, gen: 1) == .show)
check("setup-not-on-a-plain-launch", sstep(s, gen: 1, updated: false) == .quiet("not after an update"))
check("setup-not-without-a-menu", sstep(s, gen: 0) == .quiet("no setup menu"))
check("setup-waits-signed-out", sstep(s, gen: 1, signedIn: false) == .wait("signed out"))
check("setup-waits-dnd", sstep(s, gen: 1, dnd: true) == .wait("Do Not Disturb is on"))
check("setup-waits-protected", sstep(s, gen: 1, prot: true) == .wait("1Password or Signal is in front"))
s.didOffer(1)
check("setup-once-per-generation", sstep(s, gen: 1) == .quiet("generation 1 offered before"))
check("setup-new-generation-offers", sstep(s, gen: 2) == .show)
s.save(file)
check("setup-saved", SetupOffer.load(file) == s)
try? FileManager.default.removeItem(at: dir)

print(fails == 0 ? "UPDATE NUDGE: 0 FAIL" : "UPDATE NUDGE: \(fails) FAIL")
exit(fails == 0 ? 0 : 1)

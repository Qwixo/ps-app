// Unit tests for the setup island's rules (Sources/SetupIslandCore.swift): which step is now, done detection, ticks
// only for what was done right, skip, Esc, close, the island switched off, nudges, the final moment and loading.
// No window, no sound, no clock: every time is given.
import Foundation

var failed = 0, passed = 0
func check(_ ok: Bool, _ what: String, line: Int = #line) {
  if ok { passed += 1 } else { failed += 1; print("FAIL (line \(line)): \(what)") }
}
let t0 = Date(timeIntervalSince1970: 1_800_000_000)
func at(_ s: Double) -> Date { t0.addingTimeInterval(s) }

// MARK: starting

check(SetupIslandCore.shouldStart(psAlreadyInstalled: false, neverChoseStore: true, test: false, islandOff: false), "fresh Mac starts")
check(!SetupIslandCore.shouldStart(psAlreadyInstalled: true, neverChoseStore: true, test: false, islandOff: false), "PS already there: no guide")
check(!SetupIslandCore.shouldStart(psAlreadyInstalled: false, neverChoseStore: false, test: false, islandOff: false), "used before: no guide")
check(!SetupIslandCore.shouldStart(psAlreadyInstalled: false, neverChoseStore: true, test: true, islandOff: false), "test copy: no guide")
check(!SetupIslandCore.shouldStart(psAlreadyInstalled: false, neverChoseStore: true, test: false, islandOff: true), "island off: no guide")

var idle = SetupIslandGuide(saved: SetupIslandSaved())
check(idle.update(SetupIslandFacts(installer: true, page: "welcome"), now: t0).isEmpty, "not active: nothing at all")

// MARK: the install screen, a full happy path

var g = SetupIslandGuide.begin(now: t0, soundOff: false)
var f = SetupIslandFacts(installer: true, page: "welcome")
var e = g.update(f, now: at(0))
check(e == [.birth, .hint(.install)], "birth first, then the install hint: \(e)")
check(g.current == .install, "install is now")
check(g.update(f, now: at(1)).isEmpty, "nothing new, nothing happens")

f.page = "steps"
e = g.update(f, now: at(5))
check(e == [.tick(.install), .hideHint], "Install pressed: tick, then no hint while copying: \(e)")
check(g.current == nil, "no step while copying")

f.page = "perms"
e = g.update(f, now: at(20))
check(e == [.hint(.accessibility)], "permissions page: Accessibility hint: \(e)")
f.ax = true
e = g.update(f, now: at(30))
check(e == [.tick(.accessibility), .hint(.mixer)], "Accessibility on: tick, then the mixer: \(e)")
f.audio = true
e = g.update(f, now: at(40))
check(e == [.tick(.mixer), .hint(.open)], "mixer on: tick, then Open: \(e)")
f.page = "store"
e = g.update(f, now: at(42))
check(e == [.hint(.store)], "Open asked where the list lives: store hint: \(e)")
f.page = "done"
e = g.update(f, now: at(45))
check(e == [.tick(.store), .hideHint], "Open pressed: tick and the install screen is done: \(e)")
check(g.saved.isDone(.open) && g.saved.isDone(.store), "open and store are done")
check(g.running, "the guide goes on in the installed app")

// MARK: the installed app

var a = SetupIslandGuide(saved: g.saved)   // what the installed app loads
var af = SetupIslandFacts()
e = a.update(af, now: at(60))
check(e == [.hint(.signIn)], "no second birth; sign in hint: \(e)")
af.supabaseOpen = true
e = a.update(af, now: at(61))
check(e == [.hint(.supabase)], "own Supabase window open: its hint first: \(e)")
af.supabaseOpen = false
e = a.update(af, now: at(70))
check(e == [.hint(.signIn)], "window closed without linking: back to sign in, no tick: \(e)")
af.supabaseOpen = true
_ = a.update(af, now: at(71))
af.supabaseDone = true
e = a.update(af, now: at(90))
check(e.first == .tick(.supabase), "linked: tick: \(e)")
af.supabaseOpen = false
af.signedIn = true
e = a.update(af, now: at(100))
check(e.contains(.tick(.signIn)) || a.saved.isDone(.signIn), "signed in is done: \(e)")
check(a.current == .holdTab, "then Hold Tab: \(String(describing: a.current))")
af.listShown = true
e = a.update(af, now: at(110))
check(e == [.tick(.holdTab), .hideHint], "list shown: tick: \(e)")
e = a.update(af, now: at(112))
check(e.isEmpty, "waits a moment for the setup menu")
af.menuOpen = true
e = a.update(af, now: at(113))
check(e == [.hint(.setupMenu)], "setup menu opened: its hint: \(e)")
e = a.update(af, now: at(140))
check(e.isEmpty, "no finale while the menu is open")
af.menuOpen = false; af.menuClosed = true
e = a.update(af, now: at(150))
check(e == [.tick(.setupMenu), .finale], "menu closed: tick, then the final moment: \(e)")
check(a.saved.finished && !a.running, "finished")
check(a.update(af, now: at(151)).isEmpty, "nothing after the finale")

// MARK: no setup menu: the finale comes after the grace

var b = SetupIslandGuide(saved: g.saved)
var bf = SetupIslandFacts(signedIn: true)
_ = b.update(bf, now: at(0))
bf.listShown = true
_ = b.update(bf, now: at(1))
check(b.update(bf, now: at(1 + SetupIslandCore.menuGrace - 0.5)).isEmpty, "inside the grace: waits")
check(b.update(bf, now: at(1 + SetupIslandCore.menuGrace + 0.1)) == [.finale], "no menu came: finale")

// MARK: already done steps are passed quietly (no praise for nothing)

var q = SetupIslandGuide.begin(now: t0, soundOff: false)
var qf = SetupIslandFacts(installer: true, page: "welcome")
_ = q.update(qf, now: at(0))
qf.page = "perms"; qf.ax = true
e = q.update(qf, now: at(5))
check(!e.contains(.tick(.accessibility)), "Accessibility already on: no tick: \(e)")
check(q.saved.isDone(.accessibility), "but it counts as done")
check(q.current == .mixer, "straight to the mixer")

// MARK: the optional mixer is passed when the person moves on

qf.page = "done"
e = q.update(qf, now: at(9))
check(!e.contains(.tick(.mixer)), "mixer passed: no tick: \(e)")
check(q.saved.isSkipped(.mixer), "mixer counts as skipped")
check(e.contains(.tick(.open)) || q.saved.isDone(.open), "Open pressed counts: \(e)")

// MARK: skip, Esc, close

var s = SetupIslandGuide(saved: { var x = SetupIslandSaved(); x.active = true; x.born = true; x.started = t0.timeIntervalSince1970; return x }())
var sf = SetupIslandFacts()
check(s.update(sf, now: at(0)) == [.hint(.signIn)], "sign in hint")
e = s.skip(sf, now: at(2))
check(e == [.hint(.holdTab)], "Skip sign in: on to Hold Tab: \(e)")
check(s.saved.isSkipped(.signIn), "sign in skipped")
check(s.escape() == [.hideHint], "Esc hides the hint")
check(s.escape().isEmpty, "Esc twice: nothing more")
check(s.update(sf, now: at(200)).isEmpty, "a hidden hint never nudges")
sf.listShown = true
e = s.update(sf, now: at(210))
check(!e.contains(.tick(.holdTab)) || true, "list shown after Esc")
check(s.saved.isDone(.holdTab), "Hold Tab still counted after Esc")
var c = SetupIslandGuide(saved: g.saved)
_ = c.update(SetupIslandFacts(), now: at(0))
check(c.close() == [.stop], "Close stops the guide")
check(c.saved.off && !c.running, "and it stays off")
check(c.update(SetupIslandFacts(signedIn: true), now: at(5)).isEmpty, "nothing after Close")
check(c.close().isEmpty, "Close twice: nothing")

// MARK: the island switched off, and back on

var o = SetupIslandGuide(saved: g.saved)
_ = o.update(SetupIslandFacts(), now: at(0))
check(o.update(SetupIslandFacts(islandOff: true), now: at(1)) == [.stop], "island off: the guide goes")
check(o.update(SetupIslandFacts(islandOff: true), now: at(2)).isEmpty, "only once")
check(o.running, "it is not closed for good")
check(o.update(SetupIslandFacts(), now: at(3)) == [.hint(.signIn)], "island back on: the hint again")

// MARK: nudges: once at the start, then only after a quiet pause, a few times at most

var n = SetupIslandGuide(saved: g.saved)
let nf = SetupIslandFacts()
_ = n.update(nf, now: at(0))
check(n.update(nf, now: at(SetupIslandCore.nudgeAfter - 1)).isEmpty, "no nudge before the pause")
check(n.update(nf, now: at(SetupIslandCore.nudgeAfter + 0.5)) == [.nudge], "a nudge after the pause")
n.activity(now: at(SetupIslandCore.nudgeAfter + 10))
check(n.update(nf, now: at(SetupIslandCore.nudgeAfter * 2 + 1)).isEmpty, "activity starts the pause again")
var count = 1
for i in 2...20 { if n.update(nf, now: at(Double(i) * SetupIslandCore.nudgeAfter * 2)) == [.nudge] { count += 1 } }
check(count == SetupIslandCore.maxNudges, "at most \(SetupIslandCore.maxNudges) nudges per step, got \(count)")

// MARK: too old

var old = SetupIslandGuide(saved: g.saved)
check(old.update(SetupIslandFacts(), now: at(SetupIslandCore.maxAge + 10)) == [.stop], "a setup left for days stops")
check(old.saved.finished, "and is over")

// MARK: saved round trip

let enc = SetupIslandSaved.decode(g.saved.encoded())
check(enc == g.saved, "saved state round trips")
check(SetupIslandSaved.decode(Data("nonsense".utf8)) == SetupIslandSaved(), "bad data: a clean start")
check(SetupIslandSaved.decode(nil) == SetupIslandSaved(), "nothing saved: a clean start")

// MARK: words: plain, no dashes, the app's name filled in

for st in SetupIslandStep.allCases {
  let h = SetupIslandCore.hint(st, app: "PS app", axPane: "Accessibility", audioPane: "Screen & System Audio Recording")
  for w in [h.title, h.sub, SetupIslandCore.praise(st)] {
    check(!w.contains("\u{2014}") && !w.contains("\u{2013}") && !w.contains(" - "), "no dashes: \(w)")
    check(!w.contains("{app}"), "name filled in: \(w)")
    check(w.count <= 60, "short: \(w)")
  }
  check(h.title.count <= 34, "title fits the island: \(h.title)")
}
check(SetupIslandCore.hint(.signIn, app: "PS app", axPane: "", audioPane: "").title == "Sign in or create an account", "The developer's words for sign in")
check(SetupIslandCore.hint(.install, app: "My List", axPane: "", audioPane: "").sub.contains("My List"), "the chosen name")
check(SetupIslandCore.loadLabel(.database, app: "PS app") == "Loading database", "Loading database")

// MARK: loading: no flash, readable, never stuck

var l = SetupIslandLoading()
l.begin("db", "Loading database", now: at(0))
var st = l.state(now: at(0.1))
check(st.label == nil && st.recheck != nil, "a quick load does not show at once")
l.end("db")
st = l.state(now: at(0.2))
check(st.label == nil && st.recheck == nil, "a quick load never shows")
l.begin("db", "Loading database", now: at(1))
st = l.state(now: at(1.5))
check(st.label == "Loading database", "a slow load shows")
l.begin("sb", "Setting up Supabase", now: at(1.6))
check(l.state(now: at(1.7)).label == "Setting up Supabase", "the newest label shows")
l.end("sb")
check(l.state(now: at(1.8)).label == "Loading database", "back to the one still loading")
l.end("db")
st = l.state(now: at(1.9))
check(st.label == "Loading database" && (st.recheck ?? 0) > 0, "stays a moment to be read")
st = l.state(now: at(1.5 + SetupIslandLoading.minShow + 0.1))
check(st.label == nil && st.recheck == nil, "then morphs back")
l.begin("x", "Starting PS app", now: at(10))
check(l.state(now: at(11)).label != nil, "showing")
check(l.state(now: at(10 + SetupIslandLoading.maxShow + 1)).label == nil || l.state(now: at(10 + SetupIslandLoading.maxShow + 2)).label == nil, "a load nobody ended stops showing")

print("setup island: \(passed) passed, \(failed) failed")
exit(failed == 0 ? 0 : 1)

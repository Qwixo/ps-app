import Foundation
import AppKit
// Run: bash tests/island-bubble-test.sh. V1.59: the meeting bubble always shows its words whole (the developer: "16m le"), and
// the first stand-up asks once.
var n = 0, bad = 0
func ok(_ name: String, _ c: Bool) { n += 1; if c { print("ok - \(name)") } else { bad += 1; print("FAIL - \(name)") } }
let MIN = 60_000.0, T0 = 1_763_024_400_000.0
let M = BubbleFit.measure

/// The width each piece needs, the way it is drawn (what SwiftUI would make of it, fixed size).
func need(_ p: BubbleFit.Piece) -> CGFloat { ceil(M(p)) }
/// Does every piece fit whole inside a bubble of this size (the name may be shortened only when the size says so)?
func fits(_ ps: [BubbleFit.Piece], _ s: BubbleFit.Size) -> Bool {
  var used = 2 * BubbleFit.padX + BubbleFit.iconW
  for p in ps {
    if p.squeeze { if s.noName { continue }; used += BubbleFit.spacing + (s.nameW ?? need(p)); continue }
    used += BubbleFit.spacing + need(p)
  }
  return used <= s.width + 0.01
}
func meet(_ title: String, start: Double, end: Double, link: String? = nil) -> TMeet {
  TMeet(id: "m1", title: title, start: start, end: end, from: start - 15 * MIN, link: link)
}

// ---------- The developer's case: the meeting is on, "16m left" ----------
let on = meet("Design review", start: T0 - 14 * MIN, end: T0 + 16 * MIN)
let pNow = BubbleFit.pieces(.meet(mode: "now", m: on), now: T0)
ok("during a meeting: the time and 'left'", pNow.map { $0.text }.last == "left")
let sNow = BubbleFit.size(pNow, measure: M)
ok("16m left fits whole", fits(pNow, sNow))
ok("16m left: about 70 to 100 points (it was cut at about 65)", sNow.width > 65 && sNow.width < 110)
// the old island window left this much beside a centred 330 point pill; the bubble now has its own window
let oldRoom: CGFloat = 480 - (480 + 330) / 2 - 6 - 4
ok("this is why it was cut: wider than the old room beside the pill (\(Int(sNow.width)) > \(Int(oldRoom)))", sNow.width + 0 > oldRoom - 10)

// ---------- every length of time ----------
for (label, left) in [("1m", 1 * MIN), ("59m", 59 * MIN), ("1h 5m", 65 * MIN), ("10h 59m", 659 * MIN), ("45s", 45_000.0), ("0s", 0.0)] {
  let mt = meet("Standup", start: T0 - MIN, end: T0 + left)
  let ps = BubbleFit.pieces(.meet(mode: "now", m: mt), now: T0)
  let s = BubbleFit.size(ps, measure: M)
  ok("now, \(label) left: fits whole", fits(ps, s))
  // and every second after, until it ends, still fits in the width worked out now
  var t = T0, worst = true
  while t < T0 + left { let shown = TimersCore.shortLeft(T0 + left - t); var q = ps; q[0].text = shown; worst = worst && fits(q, s); t += left > 3600_000 ? 60_000 : 1_000 }
  ok("now, \(label) left: every later time fits the same width", worst)
}
for (label, left) in [("1m", 1 * MIN), ("15m", 15 * MIN), ("1h 5m", 65 * MIN)] {
  let mt = meet("Weekly sync", start: T0 + left, end: T0 + left + 30 * MIN)
  let ps = BubbleFit.pieces(.meet(mode: "soon", m: mt), now: T0)
  let s = BubbleFit.size(ps, measure: M)
  ok("soon, in \(label): name, 'in' and the time all whole", fits(ps, s) && s.nameW == nil && !s.noName)
  var t = T0, worst = true
  while t < T0 + left { var q = ps; q[2].text = TimersCore.shortLeft(T0 + left - t); worst = worst && fits(q, s); t += 1_000 }
  ok("soon, in \(label): the count down never outgrows it", worst)
}
let join = BubbleFit.pieces(.meet(mode: "join", m: meet("X", start: T0 + 90_000, end: T0 + 30 * MIN, link: "https://meet.google.com/abc")), now: T0)
ok("Join and its time fit whole", fits(join, BubbleFit.size(join, measure: M)))
let soonStand = BubbleFit.pieces(.standSoon(at: T0 + 9_000), now: T0)
ok("the stand-up tab keeps room for two digits", soonStand.first?.text.count == 2 && fits(soonStand, BubbleFit.size(soonStand, measure: M)))

ok("widest left: 1m becomes 59s, so room for 59s", BubbleFit.widestLeft(MIN) == "59s")
ok("widest left: 1h 5m becomes 59m and 1h 59m shapes, so room for 1h 59m", BubbleFit.widestLeft(65 * MIN) == "1h 59m")
ok("widest left: 5m keeps room for 59s", BubbleFit.widestLeft(5 * MIN) == "59s")
ok("widest left: 45s", BubbleFit.widestLeft(45_000) == "45s")

// ---------- short and long names ----------
let short = BubbleFit.pieces(.meet(mode: "soon", m: meet("1:1", start: T0 + 12 * MIN, end: T0 + 40 * MIN)), now: T0)
let sShort = BubbleFit.size(short, measure: M)
ok("a short name: whole, and a small bubble", sShort.nameW == nil && sShort.width < 120 && fits(short, sShort))
let long = BubbleFit.pieces(.meet(mode: "soon", m: meet("Quarterly planning with the whole design and engineering team about the roadmap", start: T0 + 12 * MIN, end: T0 + 40 * MIN)), now: T0)
let sLong = BubbleFit.size(long, measure: M)
ok("a long name: shortened with ... and the bubble stops at its longest", sLong.width == BubbleFit.maxW && sLong.nameW != nil && fits(long, sLong))
ok("a long name: 'in' and the time still whole", fits(Array(long.dropFirst()), BubbleFit.Size(width: sLong.width - (sLong.nameW ?? 0) - BubbleFit.spacing)))
let tight = BubbleFit.size(long, room: 90, measure: M)
ok("very little room: the name goes, 'in 12m' stays whole", tight.noName && fits(long, tight))
let mid = BubbleFit.size(long, room: 150, measure: M)
ok("some room: the name shortened to fit it", mid.width <= 150 && (mid.nameW ?? 0) >= BubbleFit.minName && fits(long, mid))

// ---------- which side ----------
let screen = CGRect(x: 0, y: 0, width: 1512, height: 982)
let centre = CGRect(x: 591, y: 940, width: 330, height: 34)
let r1 = BubbleFit.place(width: sNow.width, island: centre, y: 945, screen: screen)
ok("a centred island: beside its right side", r1.side == .right && r1.frame.minX == centre.maxX + BubbleFit.gap && r1.frame.width == sNow.width)
let rightEdge = CGRect(x: 1512 - 4 - 330, y: 940, width: 330, height: 34)
let r2 = BubbleFit.place(width: sNow.width, island: rightEdge, y: 945, screen: screen)
ok("an island in the top right corner: beside its left side, fully on screen", r2.side == .left && r2.frame.maxX == rightEdge.minX - BubbleFit.gap && r2.frame.minX >= 0)
let leftEdge = CGRect(x: 4, y: 940, width: 330, height: 34)
let r3 = BubbleFit.place(width: sNow.width, island: leftEdge, y: 945, screen: screen)
ok("an island in the top left corner: beside its right side", r3.side == .right && r3.frame.maxX <= screen.maxX)
let small = CGRect(x: 0, y: 0, width: 420, height: 300), wide = CGRect(x: 40, y: 260, width: 330, height: 34)
if let (s, spot) = BubbleFit.fit(.meet(mode: "soon", m: meet("Quarterly planning with everyone", start: T0 + 12 * MIN, end: T0 + 40 * MIN)), now: T0, island: wide, y: 265, screen: small, measure: M) {
  ok("a tiny screen with no room either side: just below the island, on screen, words whole", spot.side == .below && spot.frame.minX >= small.minX && spot.frame.maxX <= small.maxX && spot.frame.maxY < wide.minY && s.width == spot.frame.width)
} else { ok("a small screen: a bubble", false) }
let roomy = CGRect(x: 0, y: 0, width: 1024, height: 640), nearRight = CGRect(x: 1024 - 4 - 330, y: 600, width: 330, height: 34)
if let (s, spot) = BubbleFit.fit(.meet(mode: "soon", m: meet("Quarterly planning with the whole design and engineering team", start: T0 + 12 * MIN, end: T0 + 40 * MIN)), now: T0, island: nearRight, y: 605, screen: roomy, measure: M) {
  ok("a long name near the right edge: on the left, shortened, on screen", spot.side == .left && spot.frame.minX >= 0 && s.nameW != nil)
} else { ok("a long name near the right edge", false) }
ok("no bubble: nothing to place", BubbleFit.fit(.none, now: T0, island: centre, y: 0, screen: screen, measure: M) == nil)

// ---------- the first stand-up asks once ----------
let stand = TStand(at: T0, len: 2 * MIN, sound: true, test: false, ask: true)
let mid0 = TMiddle.stand(at: T0, endsAt: T0 + 2 * MIN)
ok("asks during the first real stand-up", StandAsk.due(TimersIn(stand: stand), middle: mid0, onScreen: true, askedThisRun: false))
var seen = stand; seen.ask = false
ok("never again once seen (the page stops sending ask)", !StandAsk.due(TimersIn(stand: seen), middle: mid0, onScreen: true, askedThisRun: false))
ok("never twice in one run, before the page's answer is back", !StandAsk.due(TimersIn(stand: stand), middle: mid0, onScreen: true, askedThisRun: true))
var tried = stand; tried.test = true
ok("not for Try it now", !StandAsk.due(TimersIn(stand: tried), middle: mid0, onScreen: true, askedThisRun: false))
ok("not while the island is off screen", !StandAsk.due(TimersIn(stand: stand), middle: mid0, onScreen: false, askedThisRun: false))
ok("not before the stand-up takes the island", !StandAsk.due(TimersIn(stand: stand), middle: .task, onScreen: true, askedThisRun: false))
ok("goes when the stand-up is over", StandAsk.over(middle: .back(id: "x", words: "Back to work")) && !StandAsk.over(middle: mid0))
let fromPage = TimersCore.from(["stand": ["at": T0, "len": 120_000.0, "sound": true, "ask": true]])
ok("the page's stand.ask is read", fromPage.stand?.ask == true)
ok("no ask from the page: never asks", TimersCore.from(["stand": ["at": T0, "len": 120_000.0, "sound": true]]).stand?.ask == false)
ok("the words", StandAsk.title == "Do you want to turn stand-up reminders off?" && StandAsk.turnOff == "Turn off" && StandAsk.seeSettings == "See settings" && StandAsk.keep == "Keep them on")
ok("See settings opens the Stand-up reminders tab", StandAsk.settingsJS.contains("'standup'"))
ok("answers the page knows", Set(["seen", "off", "settings", "keep"]) == Set([StandAsk.Answer.seen, .off, .settings, .keep].map { $0.rawValue }))
let noDash = [StandAsk.title, StandAsk.turnOff, StandAsk.seeSettings, StandAsk.keep, BubbleFit.wLeftWord, BubbleFit.wInWord].allSatisfy { !$0.contains("\u{2013}") && !$0.contains("\u{2014}") }
ok("no long dashes in any words", noDash)

print("\(n - bad) of \(n) passed")
exit(bad == 0 ? 0 : 1)

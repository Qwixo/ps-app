import Foundation
// Run: bash tests/island-queue-test.sh. The same cases as web tests/islandqueue.test.ts.
var n = 0, bad = 0
func ok(_ name: String, _ c: Bool) { n += 1; if c { print("ok - \(name)") } else { bad += 1; print("FAIL - \(name)") } }
let T0 = Date(timeIntervalSince1970: 1_763_024_400)
func at(_ s: Double) -> Date { T0.addingTimeInterval(s) }

// one at a time
var q = IslandQueueCore()
ok("the first card shows now", q.enqueue(id: "a", kind: "ai", priority: .low, now: at(0)) == .showNow)
ok("the second waits, first in line", q.enqueue(id: "b", kind: "update", priority: .normal, now: at(1)) == .wait(position: 1))
ok("only one is active", q.active?.id == "a" && q.waiting.count == 1)
ok("a more urgent card never interrupts", q.enqueue(id: "c", kind: "reminders", priority: .high, now: at(2)) == .wait(position: 1))
ok("it goes next, ahead of the earlier normal one", q.waiting.map { $0.id } == ["c", "b"])
ok("the same id is the same card", q.enqueue(id: "b", kind: "update", priority: .normal, now: at(3)) == .updated && q.count == 3)
ok("a repeat with a higher priority moves it up, and an equal one that came first goes first", q.enqueue(id: "b", kind: "update", priority: .high, now: at(3)) == .updated && q.waiting.map { $0.id } == ["b", "c"])
ok("same priority keeps arrival order", q.waiting[0].seq < q.waiting[1].seq)

// finishing and the breath
ok("finishing a waiting card removes it quietly", q.finish("b", now: at(4)) == false && !q.isWaiting("b"))
ok("finishing the active card says so", q.finish("a", now: at(5)) == true && q.active == nil)
var r = q.step(now: at(5.1), activeIsVisible: false)
ok("the next waits a short breath", r.promote == nil)
r = q.step(now: at(5.4), activeIsVisible: false)
ok("then it comes out", r.promote?.id == "c" && q.isActive("c"))
ok("a card arriving during the breath waits, never shows on the same frame",
   { var z = IslandQueueCore(); _ = z.enqueue(id: "x", kind: "k", priority: .low, now: at(0)); z.finish("x", now: at(1))
     return z.enqueue(id: "y", kind: "k", priority: .low, now: at(1.05)) == .wait(position: 1) }())

// Esc
ok("Esc closes the active card", q.escape(now: at(6)) == "c" && q.active == nil)
ok("Esc with nothing active does nothing", { var z = IslandQueueCore(); return z.escape(now: at(0)) == nil }())

// time to live
var t = IslandQueueCore()
_ = t.enqueue(id: "r", kind: "reminders", priority: .high, now: at(0))
_ = t.enqueue(id: "ai1", kind: "ai", priority: .low, ttl: 30, now: at(1))
_ = t.enqueue(id: "keep", kind: "update", priority: .low, now: at(1))
var s = t.step(now: at(40), activeIsVisible: true)
ok("a stale waiting card is dropped, never shown late", s.dropped.map { $0.id } == ["ai1"] && !t.isWaiting("ai1"))
ok("a card without a time to live keeps waiting", t.isWaiting("keep"))

// dead active card
var d = IslandQueueCore()
_ = d.enqueue(id: "ghost", kind: "x", priority: .normal, now: at(0))
_ = d.enqueue(id: "next", kind: "x", priority: .normal, now: at(0.5))
s = d.step(now: at(2), activeIsVisible: false)
ok("a window missing for a moment is not given up on yet", d.isActive("ghost") && s.promote == nil)
s = d.step(now: at(5), activeIsVisible: false)
ok("a window gone past the grace is let go", !d.isActive("ghost"))
s = d.step(now: at(5.5), activeIsVisible: false)
ok("and the next card takes over", s.promote?.id == "next")
var v = IslandQueueCore()
_ = v.enqueue(id: "long", kind: "x", priority: .normal, now: at(0))
_ = v.step(now: at(500), activeIsVisible: true)
ok("a card that stays visible is never let go, however long", v.isActive("long"))

// flood
var f = IslandQueueCore()
_ = f.enqueue(id: "first", kind: "x", priority: .low, now: at(0))
var refused = 0
for i in 0..<45 { if f.enqueue(id: "f\(i)", kind: "x", priority: .low, now: at(1)) == .dropped { refused += 1 } }
ok("a flood is capped", f.waiting.count == IslandQueueCore.maxWaiting && refused == 15)

// recheck
var rc = IslandQueueCore()
ok("nothing pending: no recheck", rc.recheck(now: at(0)) == nil)
_ = rc.enqueue(id: "a", kind: "x", priority: .low, now: at(0))
_ = rc.enqueue(id: "b", kind: "x", priority: .low, ttl: 2, now: at(0))
ok("a recheck never later than the next expiry", (rc.recheck(now: at(0)) ?? 99) <= 2.02)

// cancel then re-add the same id is a new card
var cc = IslandQueueCore()
_ = cc.enqueue(id: "a", kind: "x", priority: .low, now: at(0))
cc.finish("a", now: at(1))
ok("a finished id can come again later", cc.enqueue(id: "a", kind: "x", priority: .low, now: at(3)) == .showNow)

// motion
for m in IslandMoment.allCases {
  let st = IslandMotionCore.steps(m, reduceMotion: false)
  ok("\(m) ends at rest", st.last?.to == 0)
  ok("\(m) steps run in time order", zip(st, st.dropFirst()).allSatisfy { $0.at < $1.at })
  ok("\(m) has no steps under reduced motion", IslandMotionCore.steps(m, reduceMotion: true).isEmpty)
  ok("\(m) springs bounce (damping under 1) except the squeeze", st.dropFirst().allSatisfy { $0.damping < 0.8 })
}
for m in [IslandMoment.cardOut, .updateDone, .dbLoaded, .whatsNew] {
  let st = IslandMotionCore.steps(m, reduceMotion: false)
  ok("\(m) squeezes in a tiny bit before it grows", (st.first?.to ?? 0) < 0 && (st.first?.to ?? -9) > -0.5 && (st.dropFirst().first?.to ?? 0) > 0.5)
}
ok("the card waits for the squeeze", IslandMotionCore.cardDelay(reduceMotion: false) == IslandMotionCore.squeezeFor && IslandMotionCore.cardDelay(reduceMotion: true) == 0)
ok("chime at the big moments", IslandMotionCore.chimes(.dbLoaded, soundOn: true, dndMutesSounds: false) && IslandMotionCore.chimes(.updateDone, soundOn: true, dndMutesSounds: false) && IslandMotionCore.chimes(.whatsNew, soundOn: true, dndMutesSounds: false))
ok("no chime for a card coming out or back", !IslandMotionCore.chimes(.cardOut, soundOn: true, dndMutesSounds: false) && !IslandMotionCore.chimes(.cardBack, soundOn: true, dndMutesSounds: false))
ok("the sound switch silences it", !IslandMotionCore.chimes(.dbLoaded, soundOn: false, dndMutesSounds: false))
ok("Do Not Disturb silences it", !IslandMotionCore.chimes(.dbLoaded, soundOn: true, dndMutesSounds: true))
ok("a quick load gets no tick", !IslandMotionCore.showDbLoaded(loadingWasShown: false, islandOff: false, featureOn: true))
ok("a shown load gets the tick", IslandMotionCore.showDbLoaded(loadingWasShown: true, islandOff: false, featureOn: true))
ok("no tick with the island off or the feature off", !IslandMotionCore.showDbLoaded(loadingWasShown: true, islandOff: true, featureOn: true) && !IslandMotionCore.showDbLoaded(loadingWasShown: true, islandOff: false, featureOn: false))
ok("words", IslandMotionCore.dbLoadedWords == "Database loaded" && IslandMotionCore.whatsNewWords == "What's new" && IslandMotionCore.updatedWords(version: "V1.60") == "Updated to V1.60" && IslandMotionCore.updatedWords(version: nil) == "Updated")
ok("going back is quicker under reduced motion", IslandMotionCore.backDuration(reduceMotion: true) < IslandMotionCore.backDuration(reduceMotion: false))
ok("no dashes in the words", ![IslandMotionCore.dbLoadedWords, IslandMotionCore.whatsNewWords, IslandMotionCore.updatedWords(version: "V1.60")].contains { $0.contains("\u{2013}") || $0.contains("\u{2014}") })

print("\(n - bad)/\(n) passed")
exit(bad == 0 ? 0 : 1)

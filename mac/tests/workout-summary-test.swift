import Foundation
// Run: bash tests/workout-summary-test.sh
var n = 0, bad = 0
func ok(_ name: String, _ c: Bool) { n += 1; if c { print("ok - \(name)") } else { bad += 1; print("FAIL - \(name)") } }
let row = WorkoutRow(name: "Bench press", sets: 3, bestKg: 82.5, bestReps: 8, rir: "2", comment: "left knee felt off", trend: .up, daysAgo: 7)
func row2(_ r: WorkoutRow = row, name: String = "Squat", trend: WorkoutTrend = .down, daysAgo: Int? = 1, rir: String? = nil, comment: String? = nil) -> WorkoutRow {
  var x = r; x.name = name; x.trend = trend; x.daysAgo = daysAgo; x.rir = rir; x.comment = comment; return x
}
let sum = WorkoutSummaryIn(id: "w1", title: "Day 2", minutes: 65, sets: 7, rows: [row, row2(), row2(name: "Curl", trend: .new, daysAgo: nil)], more: 0)
func dec(_ s: WorkoutSummaryIn? = sum, shown: Set<String> = [], feature: Bool = true, island: Bool = true, idle: Double = 2, block: WelcomeBlock = WelcomeBlock()) -> WorkoutSummaryCore.Decision {
  WorkoutSummaryCore.decide(s, shownHere: shown, featureOn: feature, islandOn: island, idle: idle, block: block)
}

// ---------- from the page ----------
let page: [String: Any] = ["id": "w1", "title": "Day 2", "minutes": 65, "sets": 7, "more": 0, "rows": [
  ["name": "Bench press", "sets": 3, "bestKg": 82.5, "bestReps": 8, "rir": "2", "comment": "left knee felt off", "trend": "up", "daysAgo": 7],
  ["name": "Curl", "sets": 2, "bestKg": 20, "bestReps": 12, "trend": "new", "daysAgo": 3]]]
let p = WorkoutSummaryCore.parse(page)
ok("the page's summary is read", p?.id == "w1" && p?.rows.count == 2 && p?.minutes == 65 && p?.rows[0].bestKg == 82.5 && p?.rows[0].trend == .up && p?.rows[0].daysAgo == 7)
ok("a first time exercise has no days ago, whatever was sent", p?.rows[1].daysAgo == nil && p?.rows[1].trend == .new)
ok("nothing, junk or no id: nothing", WorkoutSummaryCore.parse(nil) == nil && WorkoutSummaryCore.parse("x") == nil && WorkoutSummaryCore.parse(["id": ""]) == nil && WorkoutSummaryCore.parse(["rows": []]) == nil)
ok("no rows: nothing to show", WorkoutSummaryCore.parse(["id": "a", "rows": []]) == nil && WorkoutSummaryCore.parse(["id": "a", "rows": [["sets": 1]]]) == nil)
ok("numbers are clamped", { let w = WorkoutSummaryCore.parse(["id": "a", "minutes": 99999, "sets": -4, "rows": [["name": "A", "sets": 500, "bestKg": 99999, "bestReps": -3, "trend": "up", "daysAgo": 99999]]])!; return w.minutes == 1440 && w.sets == 0 && w.rows[0].sets == 99 && w.rows[0].bestKg == 2000 && w.rows[0].bestReps == 0 && w.rows[0].daysAgo == 3650 }())
ok("an unknown trend counts as new", WorkoutSummaryCore.parse(["id": "a", "rows": [["name": "A", "trend": "sideways"]]])!.rows[0].trend == .new)
ok("at most six rows are read", WorkoutSummaryCore.parse(["id": "a", "rows": (0..<12).map { ["name": "E\($0)", "sets": 1] }])!.rows.count == 6)
ok("long text is cut and newlines flattened", { let w = WorkoutSummaryCore.parse(["id": "a", "title": String(repeating: "t", count: 90), "rows": [["name": String(repeating: "n", count: 90), "comment": "a\nb"]]])!; return w.title.count == 30 && w.rows[0].name.count == 40 && w.rows[0].comment == "a b" }())

// ---------- when it shows ----------
ok("back at the Mac and using it: show", dec() == .show)
ok("nothing waiting: nothing", dec(nil) == .skip(.featureOff))
ok("feature or island off: never", dec(feature: false) == .skip(.featureOff) && dec(island: false) == .skip(.featureOff))
ok("already shown on this Mac: never again", dec(shown: ["w1"]) == .skip(.alreadyShown))
ok("another workout's mark does not block this one", dec(shown: ["w0"]) == .show)
ok("not using the Mac yet (idle): wait, nothing is marked", dec(idle: 60) == .wait(.notUsing))
ok("exactly at the limit still counts as using it", dec(idle: WorkoutSummaryCore.usingWithin) == .show && dec(idle: WorkoutSummaryCore.usingWithin + 1) == .wait(.notUsing))
ok("a locked screen waits", dec(block: WelcomeBlock(screenLocked: true)) == .wait(.locked))
ok("screen sharing, full screen and Do Not Disturb wait (it stays pending, shown later)", dec(block: WelcomeBlock(screenSharing: true)) == .wait(.sharing) && dec(block: WelcomeBlock(fullScreen: true)) == .wait(.fullScreen) && dec(block: WelcomeBlock(dnd: true)) == .wait(.dnd))
ok("locked beats idle (a locked Mac is idle)", dec(idle: 999, block: WelcomeBlock(screenLocked: true)) == .wait(.locked))
// once per workout on this Mac, and across Macs through the page's mark
var list: [String] = []
list = WorkoutSummaryCore.remember("w1", in: list)
ok("remembered here after it showed", dec(shown: Set(list)) == .skip(.alreadyShown))
ok("remembering the same id twice keeps one", WorkoutSummaryCore.remember("w1", in: list) == ["w1"])
ok("the list is capped and keeps the newest", { var l: [String] = []; for i in 0..<100 { l = WorkoutSummaryCore.remember("w\(i)", in: l) }; return l.count == WorkoutSummaryCore.rememberLimit && l.last == "w99" && l.first == "w40" }())
// across Macs: Mac B is never sent the summary once Mac A marked it (web core), so its state has no workout
ok("another Mac whose page has the mark sends no workout: nothing to show", dec(WorkoutSummaryCore.parse(["id": "w1"] as [String: Any])) == .skip(.featureOff))

// ---------- the words ----------
ok("gym time", WorkoutSummaryCore.gymTime(0) == "" && WorkoutSummaryCore.gymTime(45) == "45 min" && WorkoutSummaryCore.gymTime(60) == "1 h" && WorkoutSummaryCore.gymTime(65) == "1 h 5 min" && WorkoutSummaryCore.gymTime(125) == "2 h 5 min")
ok("the totals line", WorkoutSummaryCore.summaryLine(sum) == "1 h 5 min in the gym, 7 sets" && WorkoutSummaryCore.summaryLine(WorkoutSummaryIn(id: "a", title: "", minutes: 0, sets: 1, rows: [row], more: 0)) == "1 set")
ok("best weight and reps", WorkoutSummaryCore.bestLine(row) == "82.5 kg x 8" && WorkoutSummaryCore.bestLine(row2(name: "x")) == "82.5 kg x 8")
ok("whole kilos have no decimals", WorkoutSummaryCore.kgText(80) == "80" && WorkoutSummaryCore.kgText(82.5) == "82.5" && WorkoutSummaryCore.kgText(82.50001) == "82.5")
ok("a bodyweight set (no kg) reads reps only", WorkoutSummaryCore.bestLine(WorkoutRow(name: "Pull up", sets: 3, bestKg: nil, bestReps: 10, rir: nil, comment: nil, trend: .new, daysAgo: nil)) == "x 10" || WorkoutSummaryCore.bestLine(WorkoutRow(name: "Pull up", sets: 3, bestKg: nil, bestReps: 10, rir: nil, comment: nil, trend: .new, daysAgo: nil)) == "x 10")
ok("up, same and down with how long ago", WorkoutSummaryCore.trendWords(row) == "Up, last time 7 days ago" && WorkoutSummaryCore.trendWords(row2()) == "Down, last time yesterday" && WorkoutSummaryCore.trendWords(row2(trend: .same, daysAgo: 0)) == "Same, last time today")
ok("first time", WorkoutSummaryCore.trendWords(row2(trend: .new, daysAgo: nil)) == "First time")
ok("how it felt: RIR and the person's own words", WorkoutSummaryCore.feltWords(row) == "2 in reserve, left knee felt off" && WorkoutSummaryCore.feltWords(row2(rir: "4+")) == "4 or more in reserve" && WorkoutSummaryCore.feltWords(row2(comment: "seat at 4")) == "seat at 4" && WorkoutSummaryCore.feltWords(row2()) == nil)
ok("the headline words", WorkoutSummaryCore.headline == "Workout complete" && WorkoutSummaryCore.congrats == "Nice work")
ok("no dashes in any words", ![WorkoutSummaryCore.headline, WorkoutSummaryCore.congrats, WorkoutSummaryCore.summaryLine(sum), WorkoutSummaryCore.trendWords(row), WorkoutSummaryCore.feltWords(row) ?? ""].contains { $0.contains("\u{2013}") || $0.contains("\u{2014}") })

// ---------- the layout ----------
ok("a row with how it felt is taller", WorkoutSummaryCore.rowHeight(row) > WorkoutSummaryCore.rowHeight(row2()))
ok("the panel grows with the exercises", WorkoutSummaryCore.panelH(sum) > WorkoutSummaryCore.panelH(WorkoutSummaryIn(id: "a", title: "", minutes: 1, sets: 1, rows: [row2()], more: 0)))
ok("the 'and more' line adds room", WorkoutSummaryCore.panelH(WorkoutSummaryIn(id: "a", title: "", minutes: 1, sets: 1, rows: [row], more: 2)) > WorkoutSummaryCore.panelH(WorkoutSummaryIn(id: "a", title: "", minutes: 1, sets: 1, rows: [row], more: 0)))
let six = WorkoutSummaryIn(id: "a", title: "", minutes: 1, sets: 1, rows: Array(repeating: row, count: 6), more: 3)
ok("six exercises with everything still fit a small panel (under 640 high)", WorkoutSummaryCore.panelH(six) < 640)
ok("the first part is only a little bigger than the island", WorkoutSummaryCore.announceSize.width < WorkoutSummaryCore.panelW && WorkoutSummaryCore.announceSize.height < 100)

// ---------- the timing and the sounds ----------
let t = WorkoutSummaryCore.timeline(reduceMotion: false), tr = WorkoutSummaryCore.timeline(reduceMotion: true)
ok("the parts come in order: announce, congratulation, grow, totals, rows", t.announceAt < t.congratsAt && t.congratsAt < t.growAt && t.growAt < t.totalsAt && t.totalsAt < t.rowsAt)
ok("rows come one after another", WorkoutSummaryCore.rowAt(0, t) == t.rowsAt && WorkoutSummaryCore.rowAt(2, t) == t.rowsAt + 2 * t.rowGap)
ok("reduced motion is quicker, in the same order", tr.growAt < t.growAt && tr.congratsAt < tr.growAt && tr.growAt < tr.totalsAt && tr.totalsAt < tr.rowsAt)
ok("everything is in well before it goes by itself", WorkoutSummaryCore.settledAt(rows: 6, t) < t.autoClose - 5)
let snd = WorkoutSummaryCore.sounds(rows: 3, soundOn: true, dnd: false, t)
ok("a chime first, then a soft sound for each part", snd.first?.kind == .chime && snd.first?.at == t.announceAt && snd.dropFirst().allSatisfy { $0.kind == .soft } && snd.count == 3 + 3)
ok("sounds are in time order", zip(snd, snd.dropFirst()).allSatisfy { $0.at <= $1.at })
ok("the soft sounds are one per part: congratulation, totals, each exercise", snd.filter { $0.kind == .soft }.count == 2 + 3)
ok("the switch off: silent", WorkoutSummaryCore.sounds(rows: 3, soundOn: false, dnd: false, t).isEmpty)
ok("Do Not Disturb: silent", WorkoutSummaryCore.sounds(rows: 3, soundOn: true, dnd: true, t).isEmpty)
let wd = IslandMotionCore.steps(.workoutDone, reduceMotion: false)
ok("workout complete: a squeeze, a big pop, rest", (wd.first?.to ?? 0) < 0 && (wd.dropFirst().first?.to ?? 0) > 1 && wd.last?.to == 0 && IslandMotionCore.steps(.workoutDone, reduceMotion: true).isEmpty)
ok("workout complete has the chime", IslandMotionCore.chimes(.workoutDone, soundOn: true, dndMutesSounds: false) && !IslandMotionCore.chimes(.workoutDone, soundOn: false, dndMutesSounds: false))
print(bad == 0 ? "ALL \(n) PASSED" : "\(bad) of \(n) FAILED")
exit(bad == 0 ? 0 : 1)

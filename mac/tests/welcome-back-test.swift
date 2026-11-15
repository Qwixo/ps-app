import Foundation
// Run: bash tests/welcome-back-test.sh
var n = 0, bad = 0
func ok(_ name: String, _ c: Bool) { n += 1; if c { print("ok - \(name)") } else { bad += 1; print("FAIL - \(name)") } }
let T0 = 1_763_024_400.0
let tasks = [WelcomeTask(id: "a", title: "Write the plan"), WelcomeTask(id: "b", title: "Call Sam")]
let input = WelcomeInput(on: true, minutes: 15, tasks: tasks)
func d(_ t: WelcomeTrigger = .unlock, away: Double = 20 * 60, input i: WelcomeInput = input, feature: Bool = true, island: Bool = true, block: WelcomeBlock = WelcomeBlock(), since: Double? = nil) -> WelcomeDecision {
  WelcomeBackCore.decide(trigger: t, away: away, input: i, featureOn: feature, islandOn: island, block: block, sinceLastShown: since)
}

// ---------- the away tracker ----------
var a = AwayTracker()
ok("nothing known yet: never away (no welcome at launch)", a.away(now: T0) == 0)
a.sample(now: T0, idle: 5, locked: false)
ok("the last input is the sample time less the idle time", a.lastInput == T0 - 5 && a.away(now: T0 + 100) == 105)
a.sample(now: T0 + 20, idle: 25, locked: false)
ok("sitting idle moves nothing forward: the last input stays", a.lastInput == T0 - 5 && a.away(now: T0 + 1000) == 1005)
a.sample(now: T0 + 40, idle: 0, locked: true)
ok("a locked screen is never time at the keys (the unlock keys must not count)", a.lastInput == T0 - 5)
a.sample(now: T0 + 60, idle: 0.2, locked: false)
ok("the person typing moves it to now", a.lastInput == T0 + 60 - 0.2)
var s = AwayTracker()
s.sample(now: T0, idle: 1, locked: false)
s.sample(now: T0 + 8 * 3600, idle: 0.1, locked: false)   // the Mac slept 8 hours, the first look is after the wake
ok("the first look after a long gap (sleep) is not trusted: the long away still reads", s.away(now: T0 + 8 * 3600 + 2) > 7.9 * 3600)
s.sample(now: T0 + 8 * 3600 + 20, idle: 0.1, locked: false)
ok("the next normal look counts again", s.away(now: T0 + 8 * 3600 + 21) < 2)
s.returned(now: T0 + 9 * 3600)
ok("returned starts a new stretch: a second trigger straight after is not away", s.away(now: T0 + 9 * 3600 + 3) == 3)
var back = AwayTracker()
back.sample(now: T0 + 100, idle: 10, locked: false)
back.sample(now: T0 + 50, idle: 0, locked: false)   // the clock went back
ok("a clock that goes backwards never gives a negative or huge away", back.away(now: T0) >= 0)
ok("away never negative for a future last input", AwayTracker().away(now: -5) == 0)

// ---------- the decision ----------
ok("after 20 minutes away, on unlock: show", d() == .show)
ok("on each of the four triggers", WelcomeTrigger.allCases.allSatisfy { d($0) == .show })
ok("exactly at the limit counts", d(away: 15 * 60) == .show)
ok("just under the limit does not", d(away: 15 * 60 - 1) == .skip(.notLongEnough))
ok("0 minutes away: no", d(away: 0) == .skip(.notLongEnough))
ok("a longer limit from Settings is kept", d(away: 40 * 60, input: WelcomeInput(on: true, minutes: 60, tasks: tasks)) == .skip(.notLongEnough) && d(away: 61 * 60, input: WelcomeInput(on: true, minutes: 60, tasks: tasks)) == .show)
ok("a 1 minute limit", d(away: 61, input: WelcomeInput(on: true, minutes: 1, tasks: tasks)) == .show)
ok("a silly limit is held between 1 and 720 minutes", d(away: 61, input: WelcomeInput(on: true, minutes: -5, tasks: tasks)) == .show && d(away: 721 * 60, input: WelcomeInput(on: true, minutes: 99999, tasks: tasks)) == .show && d(away: 700 * 60, input: WelcomeInput(on: true, minutes: 99999, tasks: tasks)) == .skip(.notLongEnough))
ok("the switch off in Settings", d(input: WelcomeInput(on: false, minutes: 15, tasks: tasks)) == .skip(.off))
ok("the feature off", d(feature: false) == .skip(.featureOff))
ok("the island off", d(island: false) == .skip(.featureOff))
ok("no tasks being worked on: nothing to tick, no panel", d(input: WelcomeInput(on: true, minutes: 15, tasks: [])) == .skip(.noTasks))
ok("never during screen sharing", d(block: WelcomeBlock(screenSharing: true)) == .skip(.sharing))
ok("never over a full screen app", d(block: WelcomeBlock(fullScreen: true)) == .skip(.fullScreen))
ok("never during Do Not Disturb", d(block: WelcomeBlock(dnd: true)) == .skip(.dnd))
ok("a wake that lands on the lock screen waits for the unlock", d(.wake, block: WelcomeBlock(screenLocked: true)) == .wait)
ok("sleep mode or sentry ending while locked also waits", d(.sleepModeEnded, block: WelcomeBlock(screenLocked: true)) == .wait && d(.sentryEnded, block: WelcomeBlock(screenLocked: true)) == .wait)
ok("an unlock cannot be locked: nothing shows", d(.unlock, block: WelcomeBlock(screenLocked: true)) != .show)
ok("wake then unlock a few seconds later: only the first shows", d(.unlock, since: 5) == .skip(.justShown))
ok("a second time much later is fine", d(since: WelcomeBackCore.againAfter + 1) == .show)
ok("a wait is not a skip (the stretch is not used up)", d(.wake, block: WelcomeBlock(screenLocked: true)) == .wait && d(.wake, block: WelcomeBlock(screenLocked: true)) != .skip(.notLongEnough))
ok("every block at once: screen sharing wins over the rest", d(block: WelcomeBlock(screenSharing: true, fullScreen: true, dnd: true)) == .skip(.sharing))
ok("WelcomeBlock.any", !WelcomeBlock().any && WelcomeBlock(dnd: true).any && !WelcomeBlock(screenLocked: true).any)

// ---------- from the page ----------
let p = WelcomeBackCore.parse(["on": true, "minutes": 30, "tasks": [["id": "a", "title": "One"], ["id": "b", "title": "Two\nlines"]]])
ok("the page's input is read", p.on && p.minutes == 30 && p.tasks.map { $0.id } == ["a", "b"] && p.tasks[1].title == "Two lines")
ok("nothing from the page: off, nothing to tick", WelcomeBackCore.parse(nil).on == false && WelcomeBackCore.parse(nil).tasks.isEmpty && WelcomeBackCore.parse("junk").on == false)
ok("minutes are clamped, junk is 15", WelcomeBackCore.parse(["minutes": 0]).minutes == 1 && WelcomeBackCore.parse(["minutes": 99999]).minutes == 720 && WelcomeBackCore.parse(["minutes": "x"]).minutes == 15)
ok("bad tasks are skipped, repeats once, an empty title is named", WelcomeBackCore.parse(["tasks": [["id": ""], ["title": "x"], ["id": "a", "title": ""], ["id": "a", "title": "again"], 5]]).tasks == [WelcomeTask(id: "a", title: "Untitled task")])
ok("at most six tasks", WelcomeBackCore.parse(["tasks": (0..<20).map { ["id": "t\($0)", "title": "T"] }]).tasks.count == 6)
ok("a long title is cut", WelcomeBackCore.parse(["tasks": [["id": "a", "title": String(repeating: "x", count: 400)]]]).tasks[0].title.count == 120)

// ---------- the tick list ----------
var marks = Set<String>()
marks = WelcomeBackCore.toggle(marks, id: "a", tasks: tasks)
ok("ticking a row", marks == ["a"])
marks = WelcomeBackCore.toggle(marks, id: "a", tasks: tasks)
ok("ticking it again unticks it", marks.isEmpty)
ok("an unknown id is ignored", WelcomeBackCore.toggle([], id: "zzz", tasks: tasks).isEmpty)
ok("ticked ids come back in the list's order", WelcomeBackCore.ticked(tasks, marks: ["b", "a"]) == ["a", "b"] && WelcomeBackCore.ticked(tasks, marks: ["q"]).isEmpty)
ok("Done sends a JSON list", WelcomeBackCore.doneJSON(["a", "b"]) == "[\"a\",\"b\"]" && WelcomeBackCore.doneJSON([]) == "[]")
ok("an id with quotes stays valid JSON", { let j = WelcomeBackCore.doneJSON(["a\"b"]); return (try? JSONSerialization.jsonObject(with: Data(j.utf8))) != nil }())
ok("words after Done", WelcomeBackCore.doneWords(ticks: 0) == nil && WelcomeBackCore.doneWords(ticks: 1) == "1 task done" && WelcomeBackCore.doneWords(ticks: 3) == "3 tasks done")

// ---------- the panel's size and words ----------
ok("the panel grows with the list, never past six rows", WelcomeBackCore.panelH(rows: 1) < WelcomeBackCore.panelH(rows: 3) && WelcomeBackCore.panelH(rows: 6) == WelcomeBackCore.panelH(rows: 40) && WelcomeBackCore.panelH(rows: 0) == WelcomeBackCore.panelH(rows: 1))
ok("six rows still make a small panel (under 420 high)", WelcomeBackCore.panelH(rows: 6) < 420)
ok("the words", WelcomeBackCore.title == "Welcome back" && WelcomeBackCore.sub == "Tick any tasks you've done" && WelcomeBackCore.done == "Done")
ok("the Face ID moment is a rounded square", WelcomeBackCore.faceSize == 132 && WelcomeBackCore.faceRadius > WelcomeBackCore.faceSize / 4 && WelcomeBackCore.faceRadius < WelcomeBackCore.faceSize / 2)
ok("no dashes in the words", ![WelcomeBackCore.title, WelcomeBackCore.sub, WelcomeBackCore.done].contains { $0.contains("\u{2013}") || $0.contains("\u{2014}") })

// ---------- the island's motion for it ----------
let wb = IslandMotionCore.steps(.welcomeBack, reduceMotion: false)
ok("welcome back: it shrinks a little first, deeper than a card's squeeze, then grows past full", (wb.first?.to ?? 0) < IslandMotionCore.squeeze && (wb.dropFirst().first?.to ?? 0) >= 1 && wb.last?.to == 0)
ok("welcome back: no motion at all under reduced motion", IslandMotionCore.steps(.welcomeBack, reduceMotion: true).isEmpty && IslandMotionCore.steps(.faceID, reduceMotion: true).isEmpty)
ok("the chime comes with the Face ID tick, never at the open", IslandMotionCore.chimes(.faceID, soundOn: true, dndMutesSounds: false) && !IslandMotionCore.chimes(.welcomeBack, soundOn: true, dndMutesSounds: false))
ok("the sound switch and Do Not Disturb silence the Face ID chime", !IslandMotionCore.chimes(.faceID, soundOn: false, dndMutesSounds: false) && !IslandMotionCore.chimes(.faceID, soundOn: true, dndMutesSounds: true))
ok("the grow starts after the squeeze has begun", WelcomeBackCore.growDelay > 0 && WelcomeBackCore.growDelay >= IslandMotionCore.steps(.welcomeBack, reduceMotion: false)[0].response)
ok("the words come in after the panel starts to grow", WelcomeBackCore.contentDelay > WelcomeBackCore.growDelay)
// ---------- screen sharing ----------
ok("Apple's Screen Sharing or Zoom's share helper running", ScreenShareCore.isSharing(processes: ["Finder", "screensharingd"], windowTitles: []) && ScreenShareCore.isSharing(processes: ["CptHost"], windowTitles: []))
ok("a conferencing app's 'you are sharing' window", ScreenShareCore.isSharing(processes: [], windowTitles: ["You are sharing your screen"]) && ScreenShareCore.isSharing(processes: [], windowTitles: ["Stop sharing"]))
ok("ordinary apps and windows are not sharing", !ScreenShareCore.isSharing(processes: ["Finder", "Safari", "Mail"], windowTitles: ["Inbox", "Weekly sync notes", ""]) && !ScreenShareCore.isSharing(processes: [], windowTitles: []))
print(bad == 0 ? "ALL \(n) PASSED" : "\(bad) of \(n) FAILED")
exit(bad == 0 ? 0 : 1)

// tests/reminders-test.sh: Sources/RemMath.swift with the numbers of web tests/remind.test.ts.
import Foundation
setvbuf(stdout, nil, _IONBF, 0)
var n = 0, bad = 0
func ok(_ name: String, _ c: Bool) { n += 1; if c { print("ok - \(name)") } else { bad += 1; print("FAIL - \(name)") } }
let iso = ISO8601DateFormatter()
func tb(_ day: String, _ hm: String) -> Date { iso.date(from: "\(day)T\(hm):00+04:00")! }
func item(_ f: (inout RemMath.Item) -> Void) -> RemMath.Item { var i = RemMath.Item(id: "abc"); i.tz = "Asia/Dubai"; f(&i); return i }
func st(_ i: RemMath.Item, _ d: Date, done: String = "", snooze: Double = 0) -> String { RemMath.status(i, done: done, snoozeUntil: snooze, now: d).rawValue }
let ms = { (d: Date) in d.timeIntervalSince1970 * 1000 }

let old = item { $0.at = "02:00"; $0.until = "06:00" }
ok("02:00 to 06:00 Dubai opens at 02:00 and closes at 06:00",
   st(old, tb("2026-11-10", "01:59")) == "closed" && st(old, tb("2026-11-10", "02:00")) == "show" && st(old, tb("2026-11-10", "05:59")) == "show" && st(old, tb("2026-11-10", "06:00")) == "closed")
ok("cycle day: before the start it is the day before's", RemMath.cycleDay(old, now: tb("2026-11-10", "01:30")) == "2026-11-09" && RemMath.cycleDay(old, now: tb("2026-11-10", "02:00")) == "2026-11-10")
let mon = item { $0.at = "22:00"; $0.until = "02:00"; $0.days = [1] }
ok("past midnight, Monday nights only", RemMath.weekday("2026-11-09") == 1 && st(mon, tb("2026-11-09", "21:59")) == "closed" && st(mon, tb("2026-11-09", "23:00")) == "show"
   && st(mon, tb("2026-11-10", "01:00")) == "show" && st(mon, tb("2026-11-10", "02:00")) == "closed" && st(mon, tb("2026-11-10", "23:00")) == "closed"
   && RemMath.openWindow(mon, now: tb("2026-11-10", "01:00"))?.day == "2026-11-09")
let wk = item { $0.at = "09:00"; $0.until = "21:00"; $0.days = [1, 2, 3, 4, 5] }
ok("weekdays: Saturday quiet, next start Monday 09:00", st(wk, tb("2026-11-14", "12:00")) == "closed" && st(wk, tb("2026-11-13", "12:00")) == "show"
   && RemMath.nextStart(wk, now: tb("2026-11-14", "12:00")) == tb("2026-11-16", "09:00"))
let fixed = item { $0.at = "18:00"; $0.until = "19:00" }
ok("a zone set counts wherever the Mac is", st(fixed, iso.date(from: "2026-11-10T09:30:00-05:00")!) == "show")
let ny = item { $0.tz = "America/New_York"; $0.at = "00:30"; $0.until = "03:00" }
let w = RemMath.window(ny, day: "2026-11-01")
ok("daylight saving: New York's 1 Nov night is 3.5 hours", iso.string(from: w.start) == "2026-11-01T04:30:00Z" && iso.string(from: w.end) == "2026-11-01T08:00:00Z")
ok("off and no days: never", st(item { $0.on = false }, tb("2026-11-10", "12:00")) == "off" && st(item { $0.days = [] }, tb("2026-11-10", "12:00")) == "closed"
   && RemMath.nextStart(item { $0.days = [] }, now: tb("2026-11-10", "12:00")) == nil)
ok("done for that window only", st(old, tb("2026-11-10", "04:00"), done: "2026-11-10") == "done" && st(old, tb("2026-11-11", "01:59"), done: "2026-11-10") == "done"
   && st(old, tb("2026-11-11", "02:00"), done: "2026-11-10") == "show")
let sz = ms(tb("2026-11-10", "03:15"))
ok("snooze: away, then back; past the window it does not come back", st(old, tb("2026-11-10", "03:14"), snooze: sz) == "snoozed" && st(old, tb("2026-11-10", "03:15"), snooze: sz) == "show"
   && st(old, tb("2026-11-10", "06:05"), snooze: ms(tb("2026-11-10", "06:10"))) == "closed")
ok("next wake: start, window end, snooze end", RemMath.nextWake(old, snoozeUntil: 0, now: tb("2026-11-10", "01:00")) == tb("2026-11-10", "02:00")
   && RemMath.nextWake(old, snoozeUntil: 0, now: tb("2026-11-10", "03:00")) == tb("2026-11-10", "06:00")
   && RemMath.nextWake(old, snoozeUntil: sz, now: tb("2026-11-10", "03:00")) == tb("2026-11-10", "03:15")
   && RemMath.nextWake(old, snoozeUntil: 0, now: tb("2026-11-10", "07:00")) == tb("2026-11-11", "02:00"))
ok("confirm: the word in any case, or one click", RemMath.confirms(item { $0.word = "Yes" }, "  yES ") && !RemMath.confirms(item { $0.word = "Yes" }, "yes please")
   && RemMath.confirms(item { $0.word = "I promise" }, "I PROMISE") && RemMath.confirms(item { $0.click = true }, ""))
let plan: [String: Any] = ["v": 1, "items": [["id": "a", "text": "Hi\u{7}", "at": "25:00", "until": "21:00", "days": [1, 1, 9], "snooze": 999, "vol": 3, "bg": "red", "accent": "#ABCDEF", "sound": "boom"],
                                             ["id": "a"], ["id": "BAD"], ["id": "b", "done": "2026-11-10", "snoozeUntil": 5, "stateAt": 7]]]
let its = RemMath.items(plan)
ok("plan: broken fields fall back, no id twice, bad ids left out", its.map(\.id) == ["a", "b"] && its[0].text == "Hi" && its[0].at == "09:00" && its[0].until == "21:00"
   && its[0].days == [1] && its[0].snooze == 240 && its[0].vol == 1 && its[0].bg == "#28121e" && its[0].accent == "#abcdef" && its[0].sound == "none"
   && its[1].done == "2026-11-10" && its[1].snoozeUntil == 5 && its[1].stateAt == 7)
let l = RemMath.legacy(prefs: try! JSONSerialization.data(withJSONObject: ["on": true, "at": "02:00", "until": "06:00", "text": ""]), doneFor: "2026-11-10", snoozeUntil: nil)
let r1 = RemMath.legacyItem(l, red: true)
ok("the old card on the developer's Mac: his words, Dubai, today's Yes", r1.id == "fu" && r1.text == "HAVE YOU RAN FOLLOW UP SYSTEM YET?" && r1.tz == "Asia/Dubai" && r1.done == "2026-11-10"
   && st(r1, tb("2026-11-10", "04:00"), done: r1.done) == "done" && l["doneFor"] as? String == "2026-11-10")
let l2 = RemMath.legacy(prefs: nil, doneFor: nil, snoozeUntil: Date(timeIntervalSince1970: 9))
let r2 = RemMath.legacyItem(l2, red: false)
ok("never touched: the old defaults, the neutral words, this Mac's zone", l2["on"] as? Bool == true && l2["at"] as? String == "02:00" && r2.text == "HAVE YOU DONE YOUR DAILY TASK YET?"
   && r2.tz == "" && l2["snoozeUntil"] as? Double == 9000)
let l3 = RemMath.legacy(prefs: try! JSONSerialization.data(withJSONObject: ["on": false, "at": "07:00", "until": "08:30", "text": "Did you stretch?"]), doneFor: nil, snoozeUntil: nil)
ok("edited: kept as edited", l3["on"] as? Bool == false && l3["until"] as? String == "08:30" && RemMath.legacyItem(l3, red: false).text == "Did you stretch?")
// ---------- V1.55: reminders on tasks (web tests/taskremind.test.ts) ----------
let once = item { $0.at = "09:00"; $0.until = "12:00"; $0.date = "2026-11-12"; $0.task = "0b7e6c1a-1111"; $0.days = [] }
ok("once: only on its day, never the week after", st(once, tb("2026-11-12", "10:00")) == "show" && st(once, tb("2026-11-19", "10:00")) == "closed"
   && RemMath.nextStart(once, now: tb("2026-11-12", "08:00")) == tb("2026-11-12", "09:00") && RemMath.nextStart(once, now: tb("2026-11-12", "10:00")) == nil)
let onceNight = item { $0.at = "23:00"; $0.until = "01:00"; $0.date = "2026-11-12"; $0.task = "t" }
ok("once past midnight: still that day's window after midnight", st(onceNight, tb("2026-11-13", "00:30")) == "show" && st(onceNight, tb("2026-11-13", "23:30")) == "closed")
ok("once and done for its day", st(once, tb("2026-11-12", "10:00"), done: "2026-11-12") == "done")
let tp = RemMath.items(["items": [
  ["id": "t1", "at": "09:00", "until": "12:00", "task": "0b7e6c1a-1111-4c2d", "date": "2026-11-12", "open": "Open task", "text": "Water the plants"],
  ["id": "t2", "at": "09:00", "until": "12:00", "task": "bad id!", "date": "2026-11-12", "open": "Open task"],
  ["id": "t3", "at": "09:00", "until": "12:00", "date": "2026-11-12"],
]])
ok("plan: a task's id, its day and Open task kept; a bad task id or a day without a task dropped",
   tp[0].task == "0b7e6c1a-1111-4c2d" && tp[0].date == "2026-11-12" && tp[0].open == "Open task"
   && tp[1].task == "" && tp[1].date == "" && tp[1].open == "" && tp[2].date == "")
ok("plan: room for the list's 20 and 60 on tasks", RemMath.items(["items": (0..<100).map { ["id": "x\($0)", "at": "09:00", "until": "10:00"] }]).count == 80)
ok("the json a Mac keeps carries the new fields back", RemMath.item(tp[0].json) == tp[0])

print("\n\(n - bad) of \(n) passed")
if bad > 0 { exit(1) }

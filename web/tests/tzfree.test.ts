// Am I free then? (core/tzfree.ts, V1.57): the window under Convert a time checked against meetings and PS tasks with
// a time. Overlaps, all day events, the window running past midnight, time zones and daylight saving.
import assert from "node:assert/strict";
import { calendarCovers, checkFree, clashName, dueMoment, eventBlocks, lenShort, lenWords, overlaps, taskBlocks, TASK_MIN } from "../src/core/tzfree.ts";
import type { CalEvent } from "../src/core/model.ts";
import type { Reminder } from "../src/core/remind.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const TB = "Asia/Dubai", PT = "America/Los_Angeles", UK = "Europe/London";
const at = (iso: string) => Date.parse(iso);
const ev = (id: string, title: string, start: string, end: string | null, more: Partial<CalEvent> = {}): CalEvent =>
  ({ id, title, start, end, allDay: false, attendees: [], ...more });
const rem = (more: Partial<Reminder>): Reminder => ({
  id: "r1", on: true, label: "", text: "", at: "15:00", until: "16:00", days: [0, 1, 2, 3, 4, 5, 6], tz: "", snooze: 15, later: "", yes: "", word: "",
  click: true, bg: "#000000", accent: "#ffffff", sound: "none", vol: 0.8, edited: 0, ...more,
});
const H = 60;

// ---------- overlaps ----------
ok("spans that share time clash; touching ends do not", () => {
  assert.equal(overlaps(0, 10, 5, 15), true);
  assert.equal(overlaps(5, 15, 0, 10), true);
  assert.equal(overlaps(0, 10, 10, 20), false);   // one ends as the other starts
  assert.equal(overlaps(10, 20, 0, 10), false);
  assert.equal(overlaps(0, 30, 10, 20), true);    // one inside the other
});

ok("a meeting inside, across the start, across the end, or around the window is in the way", () => {
  const s = at("2026-11-14T11:00:00Z");   // 15:00 Dubai
  const list = eventBlocks([
    ev("a", "Inside", "2026-11-14T11:15:00Z", "2026-11-14T11:45:00Z"),
    ev("b", "Starts before", "2026-11-14T10:30:00Z", "2026-11-14T11:30:00Z"),
    ev("c", "Ends after", "2026-11-14T11:50:00Z", "2026-11-14T13:00:00Z"),
    ev("d", "Around", "2026-11-14T09:00:00Z", "2026-11-14T14:00:00Z"),
    ev("e", "Ends right as it starts", "2026-11-14T10:00:00Z", "2026-11-14T11:00:00Z"),
    ev("f", "Starts right as it ends", "2026-11-14T12:00:00Z", "2026-11-14T13:00:00Z"),
  ], TB);
  const r = checkFree(s, H, list);
  assert.equal(r.free, false);
  assert.deepEqual(r.clashes.map((b) => b.title), ["Around", "Starts before", "Inside", "Ends after"]);
});

ok("nothing in the window: free; the length changes the answer", () => {
  const s = at("2026-11-14T11:00:00Z");
  const list = eventBlocks([ev("a", "Later call", "2026-11-14T12:15:00Z", "2026-11-14T13:00:00Z")], TB);
  assert.equal(checkFree(s, 30, list).free, true);
  assert.equal(checkFree(s, 60, list).free, true);
  assert.equal(checkFree(s, 120, list).free, false);
});

ok("a meeting with no end, or an end before its start, takes 30 minutes", () => {
  const list = eventBlocks([ev("a", "No end", "2026-11-14T11:00:00Z", null), ev("b", "Bad end", "2026-11-14T15:00:00Z", "2026-11-14T14:00:00Z")], TB);
  assert.equal(list[0].end - list[0].start, 30 * 60000);
  assert.equal(list[1].end - list[1].start, 30 * 60000);
  assert.equal(checkFree(at("2026-11-14T11:29:00Z"), 30, list).free, false);
  assert.equal(checkFree(at("2026-11-14T11:30:00Z"), 30, list).free, true);
});

ok("declined meetings, meetings taken off the panel and the same event twice", () => {
  const me = { email: "person9@x.com", self: true, rsvp: "declined" };
  const list = eventBlocks([
    ev("a", "Said no", "2026-11-14T11:00:00Z", "2026-11-14T12:00:00Z", { attendees: [me] }),
    ev("b", "Hidden", "2026-11-14T11:00:00Z", "2026-11-14T12:00:00Z"),
    ev("c", "Twice", "2026-11-14T11:00:00Z", "2026-11-14T12:00:00Z"),
    ev("c", "Twice", "2026-11-14T11:00:00Z", "2026-11-14T12:00:00Z"),
  ], TB, [{ key: "b2026-11-14T11:00:00Z", at: "2026-11-13T00:00:00Z", end: "2026-11-14T12:00:00Z" }]);
  assert.deepEqual(list.map((b) => b.title), ["Twice"]);
});

// ---------- all day events ----------
ok("an all day event is listed for that day but never makes you busy", () => {
  const list = eventBlocks([ev("h", "Holiday", "2026-11-14", "2026-11-15", { allDay: true })], TB);
  const r = checkFree(at("2026-11-14T11:00:00Z"), H, list);
  assert.equal(r.free, true);
  assert.deepEqual(r.allDay.map((b) => b.title), ["Holiday"]);
});

ok("an all day event runs midnight to midnight in your own zone", () => {
  const list = eventBlocks([ev("h", "Holiday", "2026-11-14", "2026-11-15", { allDay: true })], TB);
  assert.equal(list[0].start, at("2026-11-13T20:00:00Z"));   // 00:00 Dubai (UTC+4)
  assert.equal(list[0].end, at("2026-11-14T20:00:00Z"));
  // 23:30 on the 13th Dubai: not that day yet. 23:30 on the 14th: still that day.
  assert.equal(checkFree(at("2026-11-13T19:00:00Z"), 30, list).allDay.length, 0);
  assert.equal(checkFree(at("2026-11-14T19:30:00Z"), 30, list).allDay.length, 1);
});

ok("an all day event from the Mac (full timestamps) and one with no end", () => {
  const list = eventBlocks([
    ev("m", "Mac day", "2026-11-13T20:00:00Z", "2026-11-14T20:00:00Z", { allDay: true }),
    ev("g", "No end day", "2026-11-14", null, { allDay: true }),
  ], TB);
  assert.equal(list[0].end - list[0].start, 86400000);
  assert.equal(list[1].end - list[1].start, 86400000);
  assert.equal(checkFree(at("2026-11-14T11:00:00Z"), H, list).free, true);
});

// ---------- across midnight ----------
ok("a window that runs past midnight finds what is just after it, the next day", () => {
  // 23:30 Dubai on the 14th for 1 hour runs to 00:30 on the 15th.
  const s = at("2026-11-14T19:30:00Z");
  const list = eventBlocks([ev("a", "Early call", "2026-11-14T20:15:00Z", "2026-11-14T21:00:00Z")], TB);   // 00:15 on the 15th
  const r = checkFree(s, H, list);
  assert.equal(r.free, false);
  assert.equal(r.clashes[0].title, "Early call");
  assert.equal(checkFree(s, 30, list).free, true);
});

ok("a meeting that started yesterday evening and runs past midnight is in the way", () => {
  const list = eventBlocks([ev("a", "Late shoot", "2026-11-14T18:00:00Z", "2026-11-14T21:00:00Z")], TB);   // 22:00 to 01:00
  assert.equal(checkFree(at("2026-11-14T20:30:00Z"), 30, list).free, false);   // 00:30 on the 15th
});

ok("a task reminder on the days picked is found on the day after midnight too", () => {
  // Every Sunday at 00:15 Dubai. 15 Nov 2026 is a Sunday. The window: Saturday 23:30 for an hour.
  const tasks = [{ id: "t1", title: "Night stretch", due: null }];
  const list = taskBlocks(tasks, [rem({ task: "t1", at: "00:15", days: [0], tz: TB })], at("2026-11-14T19:30:00Z"), at("2026-11-14T20:30:00Z"), TB);
  assert.equal(list.length, 1);
  assert.equal(list[0].start, at("2026-11-14T20:15:00Z"));
  // Monday at 00:15 only: nothing that night.
  assert.equal(taskBlocks(tasks, [rem({ task: "t1", at: "00:15", days: [1], tz: TB })], at("2026-11-14T19:30:00Z"), at("2026-11-14T20:30:00Z"), TB).length, 0);
});

// ---------- tasks ----------
ok("a task due at a time is read in your own zone and takes 30 minutes", () => {
  assert.equal(dueMoment("2026-11-14T15:00", TB), at("2026-11-14T11:00:00Z"));
  assert.equal(dueMoment("2026-11-14T15:00", PT), at("2026-11-14T23:00:00Z"));
  assert.equal(dueMoment("2026-11-14T15:00:00Z", TB), at("2026-11-14T15:00:00Z"));   // a time with its own zone
  assert.equal(dueMoment("2026-11-14", TB), null);                                     // a day only: no time
  assert.equal(dueMoment(null, TB), null);
  const s = at("2026-11-14T10:45:00Z");
  const list = taskBlocks([{ id: "t1", title: "Send invoice", due: "2026-11-14T15:00" }], [], s, s + 60 * 60000, TB);
  assert.equal(list.length, 1);
  assert.equal(list[0].end - list[0].start, TASK_MIN * 60000);
  assert.equal(checkFree(s, H, list).clashes[0].title, "Send invoice");
});

ok("done, cleared and day only tasks never get in the way", () => {
  const s = at("2026-11-14T11:00:00Z");
  const list = taskBlocks([
    { id: "a", title: "Done", due: "2026-11-14T15:00", done: true },
    { id: "b", title: "Cleared", due: "2026-11-14T15:00", clearedAt: "2026-11-13T00:00:00Z" },
    { id: "c", title: "Day only", due: "2026-11-14" },
  ], [rem({ task: "a", date: "2026-11-14", at: "15:00", tz: TB })], s, s + 60 * 60000, TB);
  assert.equal(list.length, 0);
});

ok("a reminder on a task: once on its date, in its own zone; off reminders and plain reminders do not count", () => {
  const s = at("2026-11-14T11:00:00Z");   // 15:00 Dubai = 11:00 London
  const tasks = [{ id: "t1", title: "Call the bank", due: null }];
  const london = taskBlocks(tasks, [rem({ task: "t1", date: "2026-11-14", at: "11:00", tz: UK })], s, s + 60 * 60000, TB);
  assert.equal(london.length, 1);
  assert.equal(london[0].start, s);
  assert.equal(taskBlocks(tasks, [rem({ task: "t1", date: "2026-11-15", at: "11:00", tz: UK })], s, s + 60 * 60000, TB).length, 0);
  assert.equal(taskBlocks(tasks, [rem({ task: "t1", date: "2026-11-14", at: "11:00", tz: UK, on: false })], s, s + 60 * 60000, TB).length, 0);
  assert.equal(taskBlocks(tasks, [rem({ date: "2026-11-14", at: "15:00", tz: TB })], s, s + 60 * 60000, TB).length, 0);
  // No zone of its own: the device's zone.
  assert.equal(taskBlocks(tasks, [rem({ task: "t1", date: "2026-11-14", at: "11:00" })], s, s + 60 * 60000, TB, UK).length, 1);
});

ok("a task due and a reminder at the same moment are listed once", () => {
  const s = at("2026-11-14T11:00:00Z");
  const list = taskBlocks([{ id: "t1", title: "Pay rent", due: "2026-11-14T15:00" }], [rem({ task: "t1", date: "2026-11-14", at: "15:00", tz: TB })], s, s + 60 * 60000, TB);
  assert.equal(list.length, 1);
});

// ---------- time zones and daylight saving ----------
ok("a 1 hour window over the night the clocks go back in London is a real hour", () => {
  // 25 Oct 2026, 01:30 BST happens at 00:30Z; London goes back at 01:00Z.
  const s = at("2026-10-25T00:30:00Z");
  const list = eventBlocks([ev("a", "After the change", "2026-10-25T01:30:00Z", "2026-10-25T02:00:00Z")], UK);
  assert.equal(checkFree(s, H, list).free, true);    // the window ends 01:30Z
  assert.equal(checkFree(s, 120, list).free, false);
});

ok("an all day event on the day the clocks change is 25 hours long there", () => {
  const list = eventBlocks([ev("h", "Change day", "2026-10-25", "2026-10-26", { allDay: true })], UK);
  assert.equal(list[0].end - list[0].start, 25 * 3600000);
});

ok("the same meeting is found whatever zone the time was typed in", () => {
  // 7am Pacific on 14 Nov = 15:00Z = 19:00 Dubai.
  const list = eventBlocks([ev("a", "Standup", "2026-11-14T15:00:00Z", "2026-11-14T15:30:00Z")], TB);
  assert.equal(checkFree(at("2026-11-14T15:00:00Z"), H, list).free, false);
});

// ---------- words ----------
ok("lengths and names in words, private mode hides names", () => {
  assert.equal(lenWords(30), "30 minutes");
  assert.equal(lenWords(60), "1 hour");
  assert.equal(lenWords(120), "2 hours");
  assert.equal(lenShort(30), "30 min");
  assert.equal(lenShort(60), "1 h");
  assert.equal(clashName({ kind: "meeting", title: "Call with Alex" }, false), "Call with Alex");
  assert.equal(clashName({ kind: "meeting", title: "Call with Alex" }, true), "A meeting");
  assert.equal(clashName({ kind: "task", title: "Pay rent" }, true), "A task");
});

ok("did the calendar look that far ahead?", () => {
  const s = at("2026-11-20T10:00:00Z");
  assert.equal(calendarCovers([], s, s + 3600000), "none");
  assert.equal(calendarCovers([{ from: "2026-11-13T00:00:00Z", to: "2026-12-13T00:00:00Z" }], s, s + 3600000), "yes");
  assert.equal(calendarCovers([{ from: "2026-11-13T00:00:00Z", to: "2026-11-15T00:00:00Z" }], s, s + 3600000), "no");
  assert.equal(calendarCovers([{ from: null, to: null }], s, s + 3600000), "yes");
});

console.log(`\n${n} passed`);

// The Overdue card (core/overdue.ts): the 48 hour rule in the developer's zone, and tasks moving off the list
// onto Overdue and back.
import assert from "node:assert/strict";
import { OVERDUE_AFTER_MS, clearDuePatch, isOverdue, nextOverdueAt, overdueAt, overdueZone, splitOverdue } from "../src/core/overdue.ts";
import { tabLists } from "../src/core/groups.ts";
import type { Doc, Todo } from "../src/core/model.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const TB = "Asia/Dubai";
const at = (iso: string) => Date.parse(iso);
const task = (id: string, data: Partial<Todo>): Doc<Todo> =>
  ({ id, ws: null, kind: "todo", author: null, updatedAt: null, data: { title: id, type: "once", done: false, order: 0, ...data } }) as Doc<Todo>;

ok("48 hours is 48 hours", () => assert.equal(OVERDUE_AFTER_MS, 172_800_000));

ok("a date only: overdue 48 hours after the end of that day, Dubai time", () => {
  // Due Wed 4 Nov. The day ends at 00:00 on the 5th in the developer's city (20:00 on the 4th UTC); 48 h later is 20:00Z on the 6th.
  assert.equal(overdueAt("2026-11-04", TB), at("2026-11-06T20:00:00Z"));
  const t = { type: "once" as const, done: false, due: "2026-11-04" };
  assert.equal(isOverdue(t, at("2026-11-06T19:59:59Z"), TB), false, "one second before");
  assert.equal(isOverdue(t, at("2026-11-06T20:00:00Z"), TB), true, "on the dot");
  assert.equal(isOverdue(t, at("2026-11-05T12:00:00Z"), TB), false, "a day late is not overdue yet");
});

ok("a due with a time: overdue 48 hours after that time", () => {
  assert.equal(overdueAt("2026-11-04T15:00", TB), at("2026-11-06T11:00:00Z"));   // 15:00 Dubai = 11:00Z
  assert.equal(overdueAt("2026-11-04 15:30:00", TB), at("2026-11-06T11:30:00Z"));
  assert.equal(overdueAt("2026-11-04T15:00:00Z", TB), at("2026-11-06T15:00:00Z"), "a time with its own zone keeps it");
  assert.equal(overdueAt("2026-11-04T15:00:00+04:00", TB), at("2026-11-06T11:00:00Z"));
  const t = { type: "once" as const, done: false, due: "2026-11-04T15:00" };
  assert.equal(isOverdue(t, at("2026-11-06T10:59:00Z"), TB), false);
  assert.equal(isOverdue(t, at("2026-11-06T11:00:00Z"), TB), true);
});

ok("the zone matters, and a clock change in between is still 48 real hours", () => {
  // London: the 24th ends at 23:00Z (summer time); the clocks go back on the 25th; 48 h later is 23:00Z on the 26th.
  assert.equal(overdueAt("2026-10-24", "Europe/London"), at("2026-10-26T23:00:00Z"));
  assert.equal(overdueAt("2026-11-04", "America/New_York"), at("2026-11-07T05:00:00Z"));
});

ok("The developer's zone: his saved Tab list zone, else this device's", () => {
  assert.equal(overdueZone("Asia/Dubai"), "Asia/Dubai");
  assert.equal(overdueZone("Not/AZone"), overdueZone(null));
});

ok("never overdue: done, cleared, undated, unreadable, every day", () => {
  const now = at("2027-01-01T00:00:00Z");
  assert.equal(isOverdue({ type: "once", done: true, due: "2026-11-01" }, now, TB), false);
  assert.equal(isOverdue({ type: "once", done: false, due: "2026-11-01", clearedAt: "2026-11-02T00:00:00Z" }, now, TB), false);
  assert.equal(isOverdue({ type: "once", done: false, due: null }, now, TB), false);
  assert.equal(isOverdue({ type: "once", done: false, due: "soon" }, now, TB), false);
  assert.equal(isOverdue({ type: "daily", done: false, due: "2026-11-01", repeat: null }, now, TB), false, "every day has no real date");
});

ok("a longer repeat whose round was missed by 48 hours is overdue; ticked, it is not", () => {
  const weekly = { type: "daily" as const, done: false, due: "2026-11-01", repeat: { every: 1, unit: "week" as const, from: "2026-10-25" } };
  assert.equal(isOverdue(weekly, at("2026-11-04T12:00:00Z"), TB), true);
  assert.equal(isOverdue({ ...weekly, done: true }, at("2026-11-04T12:00:00Z"), TB), false);
});

const NOW = at("2026-11-04T12:00:00Z");   // 16:00 on Wed 4 Nov in the developer's city
const all = [
  task("late-once", { due: "2026-11-01", order: 2 }),
  task("later-once", { due: "2026-10-20", order: 5 }),
  task("yesterday", { due: "2026-11-03", order: 1 }),       // late, but not 48 hours yet: stays on the list
  task("no-date", { order: 3 }),
  task("done-late", { due: "2026-10-01", done: true, order: 4 }),
  task("weekly", { type: "daily", due: "2026-10-28", repeat: { every: 1, unit: "week", from: "2026-10-21" }, order: 6 }),
  task("gym", { type: "daily", order: 7 }),
];

ok("overdue tasks move off the list onto Overdue, never in both places, oldest first", () => {
  const { list, overdue } = splitOverdue(all, NOW, TB);
  assert.deepEqual(overdue.map((d) => d.id), ["later-once", "weekly", "late-once"]);
  assert.deepEqual(list.map((d) => d.id).sort(), ["done-late", "gym", "no-date", "yesterday"]);
  assert.equal(list.length + overdue.length, all.length);
});

ok("the Tab list's sections leave them out (and only when asked, so old callers see everything)", () => {
  const shown = tabLists(all, [], "2026-11-04", { now: NOW, tz: TB });
  const ids = [...shown.ranked, ...shown.daily].map((d) => d.id);
  assert.ok(!ids.includes("late-once") && !ids.includes("later-once") && !ids.includes("weekly"));
  assert.ok(ids.includes("yesterday") && ids.includes("no-date") && ids.includes("gym"));
  const every = tabLists(all, [], "2026-11-04");
  assert.ok([...every.ranked, ...every.daily].some((d) => d.id === "late-once"));
});

ok("a new future date moves it back to the list; ticking it takes it off Overdue", () => {
  const moved = all.map((d) => (d.id === "late-once" ? task(d.id, { ...d.data, due: "2026-11-10" }) : d));
  assert.ok(splitOverdue(moved, NOW, TB).list.some((d) => d.id === "late-once"));
  const today = all.map((d) => (d.id === "late-once" ? task(d.id, { ...d.data, due: "2026-11-04" }) : d));
  assert.ok(splitOverdue(today, NOW, TB).list.some((d) => d.id === "late-once"), "dragged onto the list: due today");
  const ticked = all.map((d) => (d.id === "late-once" ? task(d.id, { ...d.data, done: true }) : d));
  assert.ok(!splitOverdue(ticked, NOW, TB).overdue.some((d) => d.id === "late-once"));
});

ok("× takes a one-off's date off, and skips a repeat to its next round", () => {
  assert.deepEqual(clearDuePatch({ type: "once", repeat: null }, "2026-11-04"), { due: null });
  const weekly = { type: "daily" as const, repeat: { every: 1, unit: "week" as const, from: "2026-10-21" } };
  assert.deepEqual(clearDuePatch(weekly, "2026-11-04"), { due: "2026-11-04" }, "a Wednesday repeat: today's round");
  assert.deepEqual(clearDuePatch(weekly, "2026-11-05"), { due: "2026-11-11" });
  const after = splitOverdue([task("w", { ...weekly, due: clearDuePatch(weekly, "2026-11-05").due })], NOW, TB);
  assert.equal(after.overdue.length, 0);
});

ok("the next moment a task turns overdue (the card's live timer)", () => {
  // "yesterday" (due the 3rd) turns overdue at 00:00 on the 6th Dubai = 20:00Z on the 5th.
  assert.equal(nextOverdueAt(all, NOW, TB), at("2026-11-05T20:00:00Z"));
  assert.equal(nextOverdueAt([task("x", { due: null })], NOW, TB), null);
  assert.equal(nextOverdueAt(all, at("2026-11-05T20:00:00Z"), TB), null, "nothing else is coming");
});

console.log(`${n} passed`);

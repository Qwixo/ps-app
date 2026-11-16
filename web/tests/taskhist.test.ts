// Run: node --experimental-strip-types tests/taskhist.test.ts
// Fuller task history (PS 1.65, core/taskhist.ts): what a Reset records as missed, the added, deleted and Dimension X notes,
// the totals, and that a log from an older PS still reads and still takes new ticks.
process.env.TZ = "Asia/Dubai";
import assert from "node:assert/strict";
import { addToLog, type DayLog } from "../src/core/daylog.ts";
import { planReset } from "../src/core/resetplan.ts";
import { addEvent, capMissed, historyOn, planMissed, readDay, TH, totalsOf } from "../src/core/taskhist.ts";
import type { Doc, Todo } from "../src/core/model.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const TB = "Asia/Dubai";
const task = (id: string, data: Partial<Todo>): Doc<Todo> =>
  ({ id, ws: null, kind: "todo", author: null, updatedAt: null, data: { title: id, type: "once", done: false, order: 0, ...data } }) as Doc<Todo>;
const NOW = Date.parse("2026-11-10T10:00:00Z");
const DAY = "2026-11-10";

ok("a one-off still open is missed only when due that day or Priority 1", () => {
  const m = planMissed([
    task("due", { due: "2026-11-10" }), task("later", { due: "2026-11-12" }), task("earlier", { due: "2026-11-01" }), task("nodate", {}),
    task("p1", { p1: true }), task("done", { due: DAY, done: true, doneAt: "2026-11-10T01:00:00Z" }),
    task("gone", { due: DAY, clearedAt: "2026-11-09T00:00:00Z" }), task("ex", { due: DAY, example: true }),
  ], { day: DAY, nowMs: NOW });
  assert.deepEqual(m.map((x) => x.id).sort(), ["due", "p1"]);
  assert.equal(m.find((x) => x.id === "due")!.due, DAY);
  assert.equal(m[0].id, "p1", "Priority 1 first");
});
ok("every day and repeating tasks: not ticked is missed, a longer repeat only when it is due", () => {
  const m = planMissed([
    task("gym", { type: "daily" }), task("ticked", { type: "daily", done: true, doneAt: "2026-11-09T20:00:00Z" }),
    task("weekly-wait", { type: "daily", repeat: { every: 1, unit: "week", from: "2026-11-01" }, due: "2026-11-14" }),
    task("weekly-due", { type: "daily", repeat: { every: 1, unit: "week", from: "2026-11-01" }, due: "2026-11-10" }),
  ], { day: DAY, nowMs: NOW });
  assert.deepEqual(m.map((x) => x.id).sort(), ["gym", "weekly-due"]);
  assert.ok(m.every((x) => x.rep === 1));
});
ok("a task ticked then unticked counts as open again", () => {
  const m = planMissed([task("t", { due: DAY, done: false, doneAt: null })], { day: DAY, nowMs: NOW });
  assert.equal(m.length, 1);
});
ok("how long open, client id, trimmed title", () => {
  const [m] = planMissed([task("t", { due: DAY, createdAt: "2026-11-05T10:00:00Z", clientId: "c1", title: "  " + "x".repeat(200) + "\n  y" })], { day: DAY, nowMs: NOW });
  assert.equal(m.age, 5); assert.equal(m.c, "c1"); assert.equal(m.t.length, TH.title);
});
ok("a Priority 1 past its 24 hours records its start time, one inside the window does not", () => {
  const m = planMissed([task("late", { p1: true, p1At: "2026-11-08T10:00:00Z" }), task("fresh", { p1: true, p1At: "2026-11-10T02:00:00Z" })], { day: DAY, nowMs: NOW });
  assert.equal(m.find((x) => x.id === "late")!.s, "2026-11-08T10:00:00.000Z");
  assert.equal(m.find((x) => x.id === "fresh")!.s, undefined);
  assert.ok(m.every((x) => x.p1 === 1));
});
ok("at most 60 are kept, the counts stay whole", () => {
  const list = Array.from({ length: 80 }, (_, i) => task("t" + i, { due: DAY }));
  const m = planMissed(list, { day: DAY, nowMs: NOW });
  assert.equal(m.length, 80);
  const log = addToLog(undefined, DAY, [], "2026-11-10T10:00:00Z", m)!;
  assert.equal(log.missed!.length, TH.max); assert.equal(log.totals!.missed, 80);
  assert.equal(capMissed(m).length, TH.max);
});

ok("a Reset you press before the cut off hour closes the day before, after it the same day", () => {
  const list = [task("a", { due: "2026-11-09" }), task("b", { due: "2026-11-10" })];
  const early = planReset(list, { at: "2026-11-10T01:00:00Z", tz: TB, atMin: 0, dayEndsHour: 15 });   // 05:00 Dubai
  assert.equal(early.missedDay, "2026-11-09"); assert.deepEqual(early.missed.map((x) => x.id), ["a"]);
  const late = planReset(list, { at: "2026-11-10T12:00:00Z", tz: TB, atMin: 0, dayEndsHour: 15 });   // 16:00 Dubai
  assert.equal(late.missedDay, "2026-11-10"); assert.deepEqual(late.missed.map((x) => x.id), ["b"]);
  const nine = planReset(list, { at: "2026-11-10T06:00:00Z", tz: TB, atMin: 0, dayEndsHour: 9 });   // 10:00, cut off 9
  assert.equal(nine.missedDay, "2026-11-10");
});
ok("the automatic Reset closes the day before today, by the reset time", () => {
  const p = planReset([task("a", { due: "2026-11-09" })], { at: "2026-11-10T00:30:00Z", tz: TB, atMin: 240, auto: true });   // 04:30 Dubai
  assert.equal(p.today, "2026-11-10"); assert.equal(p.missedDay, "2026-11-09"); assert.equal(p.missed.length, 1);
});
ok("a day with no Reset (PS closed): the catch up files ticks into their own days and closes only the day before today", () => {
  const list = [task("a", { done: true, doneAt: "2026-11-07T08:00:00Z", due: "2026-11-07" }), task("open", { due: "2026-11-09" })];
  const p = planReset(list, { at: "2026-11-10T08:00:00Z", tz: TB, atMin: 0, auto: true });
  assert.deepEqual([...p.logs.keys()], ["2026-11-07"]);
  assert.equal(p.missedDay, "2026-11-09");
  assert.equal(p.logs.has("2026-11-08"), false, "no made up record for the skipped day");
});
ok("a tick keeps its Priority 1 mark in the log", () => {
  const p = planReset([task("a", { p1: true, done: true, doneAt: "2026-11-09T08:00:00Z" }), task("b", { done: true, doneAt: "2026-11-09T09:00:00Z" })], { at: "2026-11-10T08:00:00Z", tz: TB, atMin: 0, auto: true });
  const its = p.logs.get("2026-11-09")!;
  assert.equal(its.find((i) => i.todoId === "a")!.p1, true); assert.equal(its.find((i) => i.todoId === "b")!.p1, undefined);
});

const at1 = "2026-11-10T20:00:00Z";
ok("totals: done, missed, P1 done, P1 missed", () => {
  const p = planReset([task("d1", { p1: true, done: true, doneAt: "2026-11-09T08:00:00Z" }), task("d2", { done: true, doneAt: "2026-11-09T09:00:00Z" }),
    task("m1", { p1: true }), task("m2", { due: "2026-11-09" })], { at: "2026-11-10T08:00:00Z", tz: TB, atMin: 0, auto: true });
  const log = addToLog(undefined, "2026-11-09", p.logs.get("2026-11-09")!, at1, p.missed)!;
  assert.deepEqual(log.totals, { done: 2, missed: 2, p1Done: 1, p1Missed: 1, added: 0, deleted: 0, dimx: 0 });
});
ok("mini tasks are not counted as done tasks in the totals", () => {
  const log = addToLog(undefined, DAY, [{ todoId: "p/s1", title: "m", at: at1, parentId: "p" }, { todoId: "x", title: "x", at: at1 }], at1, [])!;
  assert.equal(log.totals!.done, 1);
});
ok("duplicate Resets: the same list again writes nothing, a later one replaces the missed list", () => {
  const m1 = planMissed([task("a", { due: DAY }), task("b", { due: DAY })], { day: DAY, nowMs: NOW });
  const log = addToLog(undefined, DAY, [], at1, m1)!;
  assert.equal(addToLog(log, DAY, [], "2026-11-10T21:00:00Z", m1), null);
  const m2 = planMissed([task("a", { due: DAY })], { day: DAY, nowMs: NOW });
  const log2 = addToLog(log, DAY, [], "2026-11-10T21:00:00Z", m2)!;
  assert.deepEqual(log2.missed!.map((x) => x.id), ["a"]); assert.equal(log2.totals!.missed, 1);
  assert.equal(log.missed!.length, 2, "the input is never changed");
});
ok("a task missed at the first Reset and ticked before the second one is not missed any more", () => {
  const m = planMissed([task("a", { due: DAY })], { day: DAY, nowMs: NOW });
  const log = addToLog(undefined, DAY, [], at1, m)!;
  const log2 = addToLog(log, DAY, [{ todoId: "a", title: "a", at: "2026-11-10T22:00:00Z" }], "2026-11-10T22:30:00Z", m)!;
  assert.deepEqual(log2.missed, []); assert.equal(log2.totals!.missed, 0); assert.equal(log2.totals!.done, 1);
});
ok("a task deleted the same day is in deleted and not in missed", () => {
  let log: any = addEvent(undefined, DAY, "added", { id: "a", title: "A", p1: true }, at1)!;
  log = addEvent(log, DAY, "deleted", { id: "a", title: "A", p1: true }, "2026-11-10T21:00:00Z")!;
  const m = planMissed([], { day: DAY, nowMs: NOW });   // gone from the list by Reset
  log = addToLog(log, DAY, [], "2026-11-10T22:00:00Z", m)!;
  assert.equal(log.added.length, 1); assert.equal(log.deleted.length, 1); assert.deepEqual(log.missed, []);
  assert.equal(log.totals.added, 1); assert.equal(log.totals.deleted, 1);
});
ok("added, deleted and Dimension X notes: once per task per kind, capped, counted", () => {
  let log: any = addEvent(undefined, DAY, "dimx", { id: "x1", title: "Idea", clientId: "c" }, at1)!;
  assert.equal(addEvent(log, DAY, "dimx", { id: "x1", title: "Idea" }, at1), null, "the same move twice is one");
  assert.equal(log.dimx[0].c, "c");
  for (let i = 0; i < 70; i++) log = addEvent(log, DAY, "added", { id: "n" + i, title: "t" }, at1) || log;
  assert.equal(log.added.length, TH.max); assert.equal(log.totals.added, 70); assert.equal(log.totals.dimx, 1);
});
ok("a tick added after the missed list keeps the missed totals", () => {
  const log = addToLog(undefined, DAY, [], at1, planMissed([task("a", { due: DAY })], { day: DAY, nowMs: NOW }))!;
  const log2 = addToLog(log, DAY, [{ todoId: "z", title: "z", at: "2026-11-10T23:00:00Z", p1: true }], "2026-11-10T23:30:00Z")!;
  assert.equal(log2.totals!.missed, 1); assert.equal(log2.totals!.done, 1); assert.equal(log2.totals!.p1Done, 1);
});
ok("old logs without the new fields read as empty and still take ticks", () => {
  const old: DayLog = { date: DAY, items: [{ todoId: "a", title: "A", at: at1 }], updatedAt: at1 };
  const r = readDay(old);
  assert.deepEqual([r.missed, r.added, r.deleted, r.dimx, r.totals], [[], [], [], [], null]);
  const next = addToLog(old, DAY, [{ todoId: "b", title: "B", at: "2026-11-10T21:00:00Z" }], at1)!;
  assert.equal(next.items.length, 2); assert.equal(next.totals, undefined, "no totals invented for an old log");
  assert.equal(addToLog(old, DAY, old.items, at1), null);
  assert.deepEqual(readDay(null).missed, []);
  assert.deepEqual(readDay({ missed: [{ id: 1 }, "x", { id: "ok", t: "T" }], totals: { done: -3, missed: "x" } }).missed.map((x) => x.id), ["ok"]);
  assert.equal(readDay({ totals: { done: -3, missed: "x" } }).totals!.done, 0);
});
ok("totalsOf and the switch", () => {
  assert.equal(totalsOf({ items: [] }).done, 0);
  assert.equal(historyOn(undefined), true); assert.equal(historyOn({}), true); assert.equal(historyOn({ taskHistory: false }), false);
});
console.log(`taskhist: ${n} passed`);

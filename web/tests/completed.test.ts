// The Completed section (core/completed.ts, V1.34): which ticked tasks show there, for how long in the developer's zone, that
// unticking puts a task back where it was, the settings with their defaults, and the list changes PS's Tab list sends.
import assert from "node:assert/strict";
import { COMPLETED_MAX, cleanListLooks, cleanTodoData, cleanTodoOp, completedList, completedOn, isCompleted, keepSince, listPrefs, nextRollAt } from "../src/core/completed.ts";
import { tabLists } from "../src/core/groups.ts";
import { tickPatch } from "../src/core/repeat.ts";
import type { Doc, Todo } from "../src/core/model.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const TB = "Asia/Dubai";
const at = (iso: string) => Date.parse(iso);
const task = (id: string, data: Partial<Todo>): Doc<Todo> =>
  ({ id, ws: null, kind: "todo", author: null, updatedAt: null, data: { title: id, type: "once", done: false, order: 0, ...data } }) as Doc<Todo>;
const NOW = at("2026-11-05T10:00:00Z");   // 14:00 in the developer's city

ok("defaults: Move to Completed, shown, today", () => {
  assert.deepEqual(listPrefs(undefined), { mode: "completed", show: true, keep: "today" });
  assert.deepEqual(listPrefs({}), { mode: "completed", show: true, keep: "today" });
  assert.equal(completedOn(listPrefs({})), true);
});
ok("settings are cleaned on read: anything odd is the default", () => {
  assert.deepEqual(listPrefs({ tmTickMode: "x" as never, tmShowDone: "no" as never, tmDoneKeep: "1y" as never }), { mode: "completed", show: true, keep: "today" });
  assert.deepEqual(listPrefs({ tmTickMode: "vanish", tmShowDone: false, tmDoneKeep: "30d" }), { mode: "vanish", show: false, keep: "30d" });
});
ok("Disappear or hidden: no Completed section", () => {
  assert.equal(completedOn(listPrefs({ tmTickMode: "vanish" })), false);
  assert.equal(completedOn(listPrefs({ tmShowDone: false })), false);
});
ok("settings are cleaned on save: only the three keys, only their values", () => {
  assert.deepEqual(cleanListLooks({ tmTickMode: "vanish", tmShowDone: false, tmDoneKeep: "7d", other: 1 }), { tmTickMode: "vanish", tmShowDone: false, tmDoneKeep: "7d" });
  assert.deepEqual(cleanListLooks({ tmTickMode: "gone", tmShowDone: 1, tmDoneKeep: "8d" }), {});
});
ok("today means since midnight in the developer's zone, not UTC", () => {
  assert.equal(keepSince("today", NOW, TB), at("2026-11-04T20:00:00Z"));   // 00:00 on 5 Nov in the developer's city
  assert.equal(keepSince("today", at("2026-11-04T21:00:00Z"), TB), at("2026-11-04T20:00:00Z"), "01:00 Dubai on the 5th is already the 5th");
  assert.equal(keepSince("7d", NOW, TB), at("2026-10-29T20:00:00Z"), "today and the 6 days before");
  assert.equal(keepSince("30d", NOW, TB), at("2026-10-06T20:00:00Z"));
  assert.equal(nextRollAt(NOW, TB), at("2026-11-05T20:00:00Z"));
});
ok("a ticked one-off shows; open, repeating, cleared or older ones do not", () => {
  const since = keepSince("today", NOW, TB);
  assert.equal(isCompleted({ type: "once", done: true, doneAt: "2026-11-05T08:00:00Z" }, since), true);
  assert.equal(isCompleted({ type: "once", done: false, doneAt: null }, since), false, "open");
  assert.equal(isCompleted({ type: "daily", done: true, doneAt: "2026-11-05T08:00:00Z" }, since), false, "repeating tasks keep their own section");
  assert.equal(isCompleted({ type: "once", done: true, doneAt: "2026-11-05T08:00:00Z", clearedAt: "2026-11-05T09:00:00Z" }, since), false, "cleared");
  assert.equal(isCompleted({ type: "once", done: true, doneAt: "2026-11-04T19:59:00Z" }, since), false, "yesterday in the developer's city");
  assert.equal(isCompleted({ type: "once", done: true, doneAt: null }, since), false, "no time: unknown, left out");
});
ok("newest tick on top; 7 days keeps more; never more than the cap", () => {
  const all = [task("a", { done: true, doneAt: "2026-11-05T06:00:00Z" }), task("b", { done: true, doneAt: "2026-11-05T09:00:00Z" }),
    task("c", { done: true, doneAt: "2026-11-02T09:00:00Z" }), task("d", { type: "daily", done: true, doneAt: "2026-11-05T09:30:00Z" }), task("e", {})];
  assert.deepEqual(completedList(all, "today", NOW, TB).map((d) => d.id), ["b", "a"]);
  assert.deepEqual(completedList(all, "7d", NOW, TB).map((d) => d.id), ["b", "a", "c"]);
  const many = Array.from({ length: COMPLETED_MAX + 20 }, (_, i) => task(`t${i}`, { done: true, doneAt: new Date(NOW - i * 1000).toISOString() }));
  assert.equal(completedList(many, "today", NOW, TB).length, COMPLETED_MAX);
});
ok("unticking puts a task back exactly where it was: the tick never touches its order, P1 or group", () => {
  const groups = [{ id: "grp1abcd", name: "Calls" }];
  const list = [task("p1a", { p1: true, order: 0 }), task("x", { order: 1 }), task("y", { order: 2 }), task("g", { group: "grp1abcd", order: 3 })];
  const before = tabLists(list, groups, "2026-11-05");
  for (const id of ["p1a", "y", "g"]) {
    const d = list.find((x) => x.id === id)!;
    const ticked = { ...d, data: { ...d.data, ...tickPatch(d.data, "2026-11-05T09:00:00Z") } };
    const mid = tabLists(list.map((x) => (x.id === id ? ticked : x)), groups, "2026-11-05");
    assert.ok(![...mid.ranked, ...mid.groups.get("grp1abcd")!].some((x) => x.id === id), `${id} left its section`);
    assert.deepEqual(completedList([ticked], "today", NOW, TB).map((x) => x.id), [id], `${id} is in Completed`);
    const back = { ...ticked, data: { ...ticked.data, ...tickPatch(ticked.data, "2026-11-05T09:01:00Z") } };
    const after = tabLists(list.map((x) => (x.id === id ? back : x)), groups, "2026-11-05");
    assert.deepEqual(after.p1.map((x) => x.id), before.p1.map((x) => x.id), `${id}: Priority 1 as before`);
    assert.deepEqual(after.prio.map((x) => x.id), before.prio.map((x) => x.id), `${id}: Priorities as before`);
    assert.deepEqual(after.groups.get("grp1abcd")!.map((x) => x.id), ["g"], `${id}: the group as before`);
    assert.equal(back.data.doneAt, null);
  }
});
ok("list changes from the Tab list are checked", () => {
  assert.deepEqual(cleanTodoOp({ op: "done", ids: ["11111111-aaaa", "11111111-aaaa", 7, "bad id!"], done: false }), { op: "done", ids: ["11111111-aaaa"], done: false });
  assert.equal(cleanTodoOp({ op: "done", ids: ["11111111-aaaa"] }), null, "done needs a direction");
  assert.deepEqual(cleanTodoOp({ op: "clear", ids: ["22222222-bbbb"] }), { op: "clear", ids: ["22222222-bbbb"] });
  assert.deepEqual(cleanTodoOp({ op: "unclear", ids: ["22222222-bbbb"] }), { op: "unclear", ids: ["22222222-bbbb"] });
  assert.equal(cleanTodoOp({ op: "clear", ids: [] }), null);
  assert.equal(cleanTodoOp({ op: "wipe", ids: ["22222222-bbbb"] }), null);
  assert.equal(cleanTodoOp(null), null);
});
ok("a deleted task comes back with everything it had, and nothing it should not", () => {
  const data = { title: "  Call Ana  ", type: "once", done: false, order: 3, p1: true, group: "grp1abcd", due: "2026-11-06", notes: "ask about the brief",
    createdAt: "2026-11-05T08:00:00Z", subtasks: [{ id: "s1", title: "find number", done: false }], evil: "<script>", streak: 2.6 };
  const op = cleanTodoOp({ op: "restore", id: "33333333-cccc", data });
  assert.ok(op && op.op === "restore");
  assert.equal(op.data.title, "Call Ana");
  assert.equal(op.data.p1, true); assert.equal(op.data.group, "grp1abcd"); assert.equal(op.data.order, 3); assert.equal(op.data.due, "2026-11-06");
  assert.equal(op.data.notes, "ask about the brief"); assert.equal(op.data.createdAt, "2026-11-05T08:00:00Z"); assert.equal(op.data.subtasks?.length, 1);
  assert.equal(op.data.streak, 3);
  assert.equal("evil" in op.data, false);
  assert.equal(cleanTodoData({ title: "", type: "once" }), null, "no title");
  assert.equal(cleanTodoData({ title: "x", type: "weekly" }), null, "a bad type");
  assert.equal(cleanTodoOp({ op: "restore", id: "x", data }), null, "a bad id");
});
console.log(`${n} of ${n} ok`);

// V1.57: the all completed history (core/completed.ts allCompletedList, moreCompleted, historySlice) and picking tasks
// in Completed so Resurrect brings back only those (isPickClick, resurrectTargets, longPressMoved).
import assert from "node:assert/strict";
import { HISTORY_PAGE, LONG_PRESS_MS, allCompletedList, completedList, historySlice, isPickClick, longPressMoved, moreCompleted, resurrectTargets } from "../src/core/completed.ts";
import type { Doc, Todo } from "../src/core/model.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const TB = "Asia/Dubai";
const at = (iso: string) => Date.parse(iso);
const task = (id: string, data: Partial<Todo>): Doc<Todo> =>
  ({ id, ws: null, kind: "todo", author: null, updatedAt: null, data: { title: id, type: "once", done: false, order: 0, ...data } }) as Doc<Todo>;
const NOW = at("2026-11-13T10:00:00Z");
const done = (id: string, iso: string | null, extra: Partial<Todo> = {}) => task(id, { done: true, doneAt: iso, ...extra });
const ids = (l: Doc<Todo>[]) => l.map((d) => d.id);

ok("history: every done one-off, newest first, no keep window", () => {
  const all = [done("old", "2026-01-02T10:00:00Z"), done("new", "2026-11-13T09:00:00Z"), done("mid", "2026-10-01T10:00:00Z"), task("open", {})];
  assert.deepEqual(ids(allCompletedList(all)), ["new", "mid", "old"]);
});
ok("history: repeating tasks and open tasks are left out; cleared ones stay in", () => {
  const all = [done("d", "2026-11-12T10:00:00Z", { type: "daily" }), task("o", {}), done("c", "2026-11-12T10:00:00Z", { clearedAt: "2026-11-12T20:00:00Z" })];
  assert.deepEqual(ids(allCompletedList(all)), ["c"]);
});
ok("history: no tick time sorts last, ties by id so the order never jumps", () => {
  const all = [done("z", null), done("b", "2026-11-12T10:00:00Z"), done("a", "2026-11-12T10:00:00Z"), done("bad", "not a date")];
  assert.deepEqual(ids(allCompletedList(all)), ["a", "b", "bad", "z"]);
});
ok("history: no cap (hundreds of tasks all show)", () => {
  const all = Array.from({ length: 600 }, (_, i) => done(`t${i}`, new Date(NOW - i * 3600_000).toISOString()));
  const h = allCompletedList(all);
  assert.equal(h.length, 600);
  assert.equal(h[0].id, "t0"); assert.equal(h[599].id, "t599");
  assert.ok(completedList(all, "30d", NOW, TB).length <= 200, "Completed itself keeps its cap");
});
ok("history: the section's own tasks are a prefix of it, so the history is the same list longer", () => {
  const all = [done("a", "2026-11-13T09:00:00Z"), done("b", "2026-11-13T08:00:00Z"), done("c", "2026-11-10T08:00:00Z")];
  const today = completedList(all, "today", NOW, TB), h = allCompletedList(all);
  assert.deepEqual(ids(h).slice(0, today.length), ids(today));
});
ok("moreCompleted: how many are beyond what Completed shows (0 hides the row)", () => {
  const all = [done("a", "2026-11-13T09:00:00Z"), done("b", "2026-11-01T08:00:00Z"), done("c", "2026-10-01T08:00:00Z")];
  const today = completedList(all, "today", NOW, TB), h = allCompletedList(all);
  assert.equal(moreCompleted(h, today), 2);
  assert.equal(moreCompleted(h, h), 0);
  assert.equal(moreCompleted([], []), 0);
});
ok("historySlice: pages of HISTORY_PAGE rows, more says whether any are left", () => {
  const l = Array.from({ length: HISTORY_PAGE * 2 + 5 }, (_, i) => i);
  assert.deepEqual(historySlice(l, 1), { rows: l.slice(0, HISTORY_PAGE), more: true });
  assert.equal(historySlice(l, 2).rows.length, HISTORY_PAGE * 2);
  assert.deepEqual(historySlice(l, 3), { rows: l, more: false });
  assert.deepEqual(historySlice(l, 99), { rows: l, more: false });
  assert.equal(historySlice(l, 0).rows.length, HISTORY_PAGE, "never fewer than one page");
  assert.deepEqual(historySlice([], 1), { rows: [], more: false });
});
ok("pick click: Cmd on a Mac, Ctrl elsewhere, never a plain click", () => {
  assert.equal(isPickClick({ metaKey: true, ctrlKey: false }, true), true);
  assert.equal(isPickClick({ metaKey: false, ctrlKey: true }, true), false, "Ctrl + click is a right click on a Mac");
  assert.equal(isPickClick({ metaKey: false, ctrlKey: false }, true), false);
  assert.equal(isPickClick({ metaKey: false, ctrlKey: true }, false), true);
  assert.equal(isPickClick({ metaKey: false, ctrlKey: false }, false), false);
});

const a = done("a", "2026-11-13T09:00:00Z"), b = done("b", "2026-11-13T08:00:00Z"), c = done("c", "2026-11-12T08:00:00Z"), old = done("old", "2026-01-01T08:00:00Z");
ok("resurrect: nothing picked brings back everything, as before", () => {
  const back = [a, b, c];
  assert.equal(resurrectTargets(back, back, new Set()), back);
});
ok("resurrect: only the picked ones, in the order they show", () => {
  const back = [a, b, c];
  assert.deepEqual(ids(resurrectTargets(back, back, new Set(["c", "a"]))), ["a", "c"]);
  assert.deepEqual(ids(resurrectTargets(back, back, new Set(["b"]))), ["b"]);
});
ok("resurrect: a task picked in the history, outside the keep window, comes back too", () => {
  const back = [a, b], visible = [a, b, c, old];
  assert.deepEqual(ids(resurrectTargets(back, visible, new Set(["old", "a"]))), ["a", "old"]);
});
ok("resurrect: picks of open or unknown tasks change nothing", () => {
  const back = [a, b];
  assert.equal(resurrectTargets(back, back, new Set(["open-task"])), back);
});
ok("resurrect: a task is listed once even when it is in both lists", () => {
  assert.deepEqual(ids(resurrectTargets([a, b], [a, b, c], new Set(["a", "b", "c"]))), ["a", "b", "c"]);
});
ok("long press: 450 ms and a small wobble still counts, a drag does not", () => {
  assert.equal(LONG_PRESS_MS, 450);
  assert.equal(longPressMoved(3, 4), false);
  assert.equal(longPressMoved(12, 0), true);
  assert.equal(longPressMoved(0, -11), true);
});
console.log(`${n} of ${n} ok`);

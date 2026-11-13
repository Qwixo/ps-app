// Mini tasks (core/subtasks.ts): ops, the parent's tick, Reset and the sealed op's title match.
import assert from "node:assert/strict";
import { applySubOp, cleanSubOp, resetSubs, subCount, tickParentSubs, titleMatches, type Subtask } from "../src/core/subtasks.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const T = "2026-10-24T10:00:00.000Z";
const three = (): Subtask[] => [{ id: "a", title: "Jo", done: false }, { id: "b", title: "Sam", done: false }, { id: "c", title: "Ana", done: false }];

ok("add, tick, rename, remove, restore, order", () => {
  let l = applySubOp([], { op: "add", id: "a", title: "Jo" }, T);
  l = applySubOp(l, { op: "add", id: "b", title: "Sam" }, T);
  l = applySubOp(l, { op: "add", id: "b", title: "Sam again" }, T);
  assert.equal(l.length, 2, "the same id never twice");
  l = applySubOp(l, { op: "tick", id: "a" }, T);
  assert.deepEqual(subCount(l), { done: 1, total: 2 });
  l = applySubOp(l, { op: "tick", id: "a" }, T);
  assert.equal(l[0].done, false, "a second tick unticks (Undo)");
  l = applySubOp(l, { op: "rename", id: "b", title: "Sam P" }, T);
  assert.equal(l[1].title, "Sam P");
  const gone = l[0];
  l = applySubOp(l, { op: "remove", id: "a" }, T);
  assert.deepEqual(l.map((s) => s.id), ["b"]);
  l = applySubOp(l, { op: "restore", item: gone, index: 0 }, T);
  assert.deepEqual(l.map((s) => s.id), ["a", "b"], "Undo puts it back where it was");
  l = applySubOp(l, { op: "order", ids: ["b", "a"] }, T);
  assert.deepEqual(l.map((s) => s.id), ["b", "a"]);
});
ok("all done does not tick the parent; ticking the parent ticks them, unticking puts them back", () => {
  let l = three();
  l = applySubOp(l, { op: "tick", id: "a" }, T);
  const on = tickParentSubs(l, true, T)!;
  assert.ok(on.every((s) => s.done));
  assert.ok(!on[0].byParent, "the one he ticked himself is his");
  const off = tickParentSubs(on, false, T)!;
  assert.deepEqual(off.map((s) => s.done), [true, false, false], "untick the parent: only the ones it ticked untick");
});
ok("Reset: a repeating task's mini tasks untick, an unfinished one-off drops its done ones", () => {
  const l = applySubOp(three(), { op: "tick", id: "b" }, T);
  assert.ok(resetSubs(l, true)!.every((s) => !s.done));
  assert.deepEqual(resetSubs(l, false)!.map((s) => s.id), ["a", "c"]);
});
ok("ops from outside are checked", () => {
  assert.equal(cleanSubOp({ op: "add", id: "x y", title: "a" }), null);
  assert.equal(cleanSubOp({ op: "add", id: "ok1", title: "  " }), null);
  assert.equal(cleanSubOp({ op: "nuke", id: "ok1" }), null);
  assert.deepEqual(cleanSubOp({ op: "tick", id: "ok1", extra: 1 }), { op: "tick", id: "ok1" });
});
ok("sealed ops find the parent by the words of its title", () => {
  assert.ok(titleMatches("Follow-ups for this week", "follow-ups week"));
  assert.ok(!titleMatches("Follow-ups", "follow-ups week"));
  assert.ok(!titleMatches("Anything", ""));
});
console.log(`${n} passed`);

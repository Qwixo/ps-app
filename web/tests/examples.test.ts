// Run: node --experimental-strip-types tests/examples.test.ts
// Example tasks (G Squad, core/examples.ts): only a brand new account in PS gets them, every one is found again by its
// id (never its words), "Delete all example tasks" takes exactly those and leaves the person's own things alone.
import assert from "node:assert/strict";
import * as E from "../src/core/examples.ts";

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
let k = 0;
const id = () => `id-${++k}`;
const NOW = Date.parse("2026-11-07T12:00:00Z");
const base = { ps: true, owner: true, red: false, synced: true, todoCount: 0, examples: undefined, accountOlder: false };

ok("a brand new owner account in PS gets them", () => { assert.equal(E.shouldSeed(base), true); });
ok("never the developer's, never a client, never the website or phone, never before the first sync", () => {
  for (const o of [{ red: true }, { owner: false }, { ps: false }, { synced: false }]) assert.equal(E.shouldSeed({ ...base, ...o }), false, JSON.stringify(o));
});
ok("never an account with tasks, one that already had them (even deleted), or one older than this build", () => {
  for (const o of [{ todoCount: 1 }, { examples: { at: "x", ids: [] } }, { accountOlder: true }]) assert.equal(E.shouldSeed({ ...base, ...o }), false, JSON.stringify(o));
});
ok("the build lists every record it makes, and flags each task", () => {
  k = 0;
  const b = E.buildExamples(NOW, id);
  assert.equal(b.todos.length, E.EXAMPLE_TODOS.length);
  assert.deepEqual(b.state.ids, [...b.todos.map((t) => t.id), b.person.id]);
  assert.deepEqual(b.state.aware, [b.aware.id]); assert.deepEqual(b.state.timelines, [b.timeline.id]);
  assert.ok(b.todos.every((t) => t.data.example === true));
  assert.equal(b.todos.filter((t) => t.data.p1).length, 1);
  assert.ok(b.todos.some((t) => t.data.type === "daily") && b.todos.some((t) => t.data.done) && b.todos.some((t) => t.data.subtasks?.length));
  assert.equal(b.timeline.date, "2026-12-07");
});
ok("every example is plainly made up: each title starts with Example", () => {
  for (const t of E.EXAMPLE_TODOS) { assert.match(t.title, /^Example: /); for (const s of t.subtasks ?? []) assert.match(s, /^Example: /); }
  assert.match(E.EXAMPLE_PERSON.name, /^Example: /); assert.match(E.EXAMPLE_AWARE, /^Example: /); assert.match(E.EXAMPLE_TIMELINE, /^Example: /);
});
ok("found by id or the example flag, never by words: a task the person typed as \"Example: ...\" stays", () => {
  k = 0;
  const b = E.buildExamples(NOW, id);
  const docs = [
    ...b.todos.map((t) => ({ id: t.id, kind: "todo", data: t.data })),
    { id: b.person.id, kind: "tzperson", data: b.person.data },
    { id: "mine", kind: "todo", data: { title: "Example: drink a glass of water" } },   // the person's own, same words
    { id: "stray", kind: "todo", data: { title: "anything", example: true } },        // flagged, not listed
  ];
  const left = E.examplesLeft(b.state, docs);
  assert.ok(!left.includes("mine"));
  assert.ok(left.includes("stray"));
  assert.equal(left.length, b.todos.length + 2);
});
ok("the Urgent notes and countdowns are taken out by id only", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(E.withoutExamples(list, ["b"]), [{ id: "a" }, { id: "c" }]);
  assert.deepEqual(E.withoutExamples(null, ["b"]), []);
});
ok("the Settings button shows while any example is left anywhere", () => {
  const state = { at: "x", ids: ["t1"], aware: ["a1"], timelines: ["l1"] };
  assert.equal(E.hasExamples(state, [], [], []), false);
  assert.equal(E.hasExamples(state, [{ id: "t1", kind: "todo", data: {} }], [], []), true);
  assert.equal(E.hasExamples(state, [], [{ id: "a1" }], []), true);
  assert.equal(E.hasExamples(state, [], [], [{ id: "l1" }]), true);
});
ok("no long dashes in any example word", () => { for (const t of E.examplesCopy()) assert.doesNotMatch(t, /[–—<>]/, t); });

console.log(`\n${n} passed`);

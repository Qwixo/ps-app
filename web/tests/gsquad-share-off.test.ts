// Run: node --experimental-strip-types tests/gsquad-share-off.test.ts
// G Squad (V1.43), the developer 8 Nov 2026: "you have to go out of your way to make your tasks shared and viewable by the
// squad." Task sharing is OFF by default (a never set Tasks switch reads off), a task is shared only when it is marked
// Share with G Squad, copies already on the hub are taken off on the next sync, and someone who switched it on keeps
// it on. Anonymise and hand off keep working for shared tasks. Names and clients are fictional.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../src/core/squadcrypto.ts";
import { NEUTRAL_TITLE } from "../src/core/squadanon.ts";
import { cleanShareOpts, planTaskSync, sealForSquad, SHARE_PIECES, shareOn, taskCopies, taskShared } from "../src/core/squadshare.ts";
import { tasksCard } from "../src/core/squadboard.ts";
import { handTask } from "../src/squad/flows.ts";
import { cleanSquadOp } from "../src/squad/view.ts";
import type { SquadRec } from "../src/core/squadrec.ts";
import type { Doc, Todo } from "../src/core/model.ts";
import type { HubApi } from "../src/squad/hub.ts";

const tests: [string, () => Promise<void> | void][] = [];
const ok = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const SQ = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d";
const SECRET = S.newSecret();
const CLIENTS = [{ name: "Northwind Silk", contactName: "Odette Lind" }];
const todo = (id: string, data: Partial<Todo>): Doc<Todo> => ({ id, ws: null, kind: "todo", author: null, updatedAt: null,
  data: { title: "Task", type: "once", done: false, order: 0, ...data } as Todo });
let KEY: { raw: string; gen: number } | null = null;
async function plan(todos: Doc<Todo>[], squadShare: unknown, have = new Map<string, string>()) {
  KEY ??= { raw: await S.newSquadKey(), gen: 1 };
  return planTaskSync({ todos, settings: squadShare === undefined ? {} : { squadShare: cleanShareOpts(squadShare) }, clients: CLIENTS, squad: SQ, member: "m1", secret: SECRET, key: KEY, have });
}

// ---------- the default ----------
ok("default: the Tasks switch is off for everyone; the other pieces keep their default", () => {
  assert.equal(shareOn(undefined, "tasks"), false);
  assert.equal(shareOn(null, "tasks"), false);
  assert.equal(shareOn({}, "tasks"), false);
  for (const p of ["working", "money", "screen", "fitness", "sleep"] as const) assert.equal(shareOn({}, p), true, p);
  assert.match(SHARE_PIECES.find((p) => p.id === "tasks")!.line, /Only the tasks you mark Share with G Squad/);
});
ok("default: a task is not shared until it is marked Share with G Squad", () => {
  assert.equal(taskShared({}), false);
  assert.equal(taskShared({ sqOn: true }), true);
  assert.equal(taskShared({ sqOn: true, sqOff: true }), false, "an old Not shared mark still wins");
  assert.equal(taskShared(null), false);
});
ok("default: the Add task box starts at Only you will see this task, and the add paths carry only Share with G Squad", () => {
  const add = src("views/GSquadTask.tsx");
  assert.match(add, /\{shared \? "Shared with G Squad" : "Only you will see this task"\}/);
  assert.match(add, /const shared = value\.sqOn;/);
  assert.match(src("views/TaskMap.tsx"), /useState<SquadAdd>\(\{ sqOn: false \}\)/);
  assert.match(src("views/TaskMap.tsx"), /setSq\(\{ sqOn: false \}\)/);
  assert.match(src("ps.ts"), /\.\.\.\(m\.sqOn === true \? \{ sqOn: true \} : \{\}\)/);
  assert.match(src("views/PsApp.tsx"), /\.\.\.\(t\.sqOn === true \? \{ sqOn: true \} : \{\}\)/);
});

// ---------- never set ----------
ok("never set: a stored value that is missing, null or not a boolean reads as off", async () => {
  for (const v of [undefined, null, {}, { tasks: null }, { tasks: "yes" }, { tasks: 1 }]) {
    assert.equal(shareOn(cleanShareOpts(v), "tasks"), false, JSON.stringify(v));
    assert.equal(taskCopies([todo("a", { sqOn: true })], { squadShare: cleanShareOpts(v) }, CLIENTS).length, 0);
  }
  assert.equal(await sealForSquad(cleanShareOpts({}), "tasks", { raw: "!!not-a-key!!", gen: 1 }, { t: "x" }, "x"), null, "the key is never touched");
});
ok("never set: copies already on the hub are taken off on the next sync, and nothing is sent", async () => {
  // Someone on V1.42 (Tasks never touched, so it was on) had two tasks on the hub.
  const todos = [todo("a", { title: "Write the plan" }), todo("b", { title: "Gym", type: "daily" })];
  const before = await plan(todos.map((d) => ({ ...d, data: { ...d.data, sqOn: true } })), { tasks: true });
  const have = new Map(before.put.map((r) => [r.id, r.fp]));
  assert.equal(have.size, 2);
  const after = await plan(todos, undefined, have);
  assert.deepEqual(after.put, [], "no sealed copy at all");
  assert.deepEqual(after.del.sort(), [...have.keys()].sort(), "every copy the hub held is deleted");
  // The same as switching Tasks off on purpose.
  assert.deepEqual((await plan(todos, { tasks: false }, have)).del.sort(), [...have.keys()].sort());
});
ok("never set: the leaderboard's tasks done count sends nothing either", () => {
  const m = src("core/squadboard.ts");
  assert.match(m, /if \(!shareOn\(opts, PIECE_OF\[kind\]\)\) \{ if \(input\.have\.has\(kind\)\) del\.push\(kind\); continue; \}/);
});

// ---------- explicit on ----------
ok("explicit on: someone who switched Tasks on keeps it on", () => {
  assert.deepEqual(cleanShareOpts({ tasks: true }), { tasks: true });
  assert.equal(shareOn(cleanShareOpts({ tasks: true, money: false }), "tasks"), true);
});
ok("explicit on: only the tasks marked Share with G Squad go, so switching on never shares old tasks in bulk", async () => {
  const todos = [todo("old", { title: "From before V1.43" }), todo("pick", { title: "Plan the launch", sqOn: true }), todo("no", { title: "Salary talk", sqOn: true, sqOff: true })];
  const p = await plan(todos, { tasks: true });
  assert.equal(p.put.length, 1);
  const copy = await S.open<{ t: string }>(KEY!.raw, p.put[0].ct, S.sqAad.task(SQ, "m1", p.put[0].id, 1));
  assert.equal(copy.t, "Plan the launch");
  assert.ok(!JSON.stringify(p).includes("Salary") && !JSON.stringify(p).includes("before"));
  // Stop sharing one task: its copy is taken off.
  const have = new Map(p.put.map((r) => [r.id, r.fp]));
  const later = await plan([todo("pick", { title: "Plan the launch", sqOn: false })], { tasks: true }, have);
  assert.deepEqual(later.del, [...have.keys()]);
});
ok("explicit on: anonymise still works on a shared task", async () => {
  const p = await plan([todo("c", { title: "Send Northwind Silk the draft", sqOn: true })], { tasks: true });
  const copy = await S.open<{ t: string; a?: boolean }>(KEY!.raw, p.put[0].ct, S.sqAad.task(SQ, "m1", p.put[0].id, 1));
  assert.equal(copy.t, NEUTRAL_TITLE);
  assert.equal(copy.a, true);
});
ok("explicit on: hand off works for a shared task and is refused while Tasks is off", async () => {
  const rec: SquadRec = { v: 1, squadId: SQ, memberId: S.newUuid(), me: "Alex", keys: [{ gen: 1, k: await S.newSquadKey() }], sign: await S.newSignPair(), box: await S.newBoxPair(), secret: SECRET, joinedAt: new Date().toISOString() };
  const sent: unknown[] = [];
  const api = { hand: async (a: unknown) => { sent.push(a); return { ok: true as const }; } } as unknown as HubApi;
  const to = S.newUuid();
  assert.equal(await handTask(rec, api, {}, to, { t: "Plan the launch", d: null }), null, "never set: nothing sealed or sent");
  assert.equal(sent.length, 0);
  assert.ok(await handTask(rec, api, { tasks: true }, to, { t: "Plan the launch", d: null }));
  assert.equal(sent.length, 1);
  const e = src("squad/engine.ts");
  assert.match(e, /if \(!d \|\| !taskShared\(d\.data\)\) return;/, "only a shared task can be handed over");
});
ok("explicit on: the leaderboard counts only tasks shared with G Squad", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  const c = tasksCard([todo("a", { done: true, doneAt: "2026-11-07T08:00:00Z", sqOn: true }), todo("b", { done: true, doneAt: "2026-11-07T09:00:00Z" })], now, "Asia/Dubai");
  assert.deepEqual(c.d, { "2026-11-07": 1 });
});

// ---------- the per task controls ----------
ok("per task: Share with G Squad and Stop sharing go to the main page, and sharing clears an old Not shared mark", () => {
  assert.deepEqual(cleanSquadOp({ op: "task", id: "todo-12345678", sqOn: true }), { op: "task", id: "todo-12345678", sqOn: true });
  assert.deepEqual(cleanSquadOp({ op: "task", id: "todo-12345678", sqOn: false }), { op: "task", id: "todo-12345678", sqOn: false });
  assert.equal(cleanSquadOp({ op: "task", id: "todo-12345678", sqOn: "yes" }), null);
  assert.match(src("squad/engine.ts"), /if \(typeof o\.sqOn === "boolean"\) \{ patch\.sqOn = o\.sqOn; if \(o\.sqOn\) patch\.sqOff = false; \}/);
});
ok("per task: while Tasks is off, the Add task box and the right click menu say so and offer to turn it on", () => {
  const g = src("views/GSquadTask.tsx");
  assert.match(g, /Only you will see this task\. Task sharing with G Squad is off\./);
  assert.match(g, /Turn on task sharing/);
  assert.match(g, /label: "Share with G Squad \(task sharing is off: this turns it on\)"/);
  assert.match(g, /run: \(\) => \{ sfx\.click\(\); shareTasksOn\(\); squadOp\(\{ op: "task", id, sqOn: true \}\); \}/);
  assert.match(g, /export const shareTasksOn = \(\) => squadOp\(\{ op: "share", piece: "tasks", on: true \}\);/);
  assert.match(g, /if \(!shared\) return out;/, "anonymise and hand off only for a shared task");
});
ok("wording: setup menu, Tasks tab and leaderboard match", () => {
  assert.match(src("core/welcome.ts"), /Tasks start off: switch Tasks on, then pick each task you want seen with Share with G Squad/);
  assert.match(src("views/GSquad.tsx"), /Task sharing starts off/);
  assert.match(src("views/GSquadBoard.tsx"), /Counts only the tasks you share with G Squad/);
});
ok("no em or en dashes in anything this change touched", () => {
  for (const p of ["core/squadshare.ts", "core/squadboard.ts", "views/GSquadTask.tsx", "views/GSquad.tsx", "views/GSquadBoard.tsx", "core/welcome.ts", "squad/engine.ts", "squad/view.ts", "views/gsquad.css"]) {
    assert.ok(!/[\u2013\u2014]/.test(src(p)), p);
  }
});

let pass = 0;
for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log("ok -", name); } catch (e) { console.error("FAIL -", name); console.error(e); process.exitCode = 1; }
}
console.log(`\ngsquad-share-off: ${pass} of ${tests.length} passed`);

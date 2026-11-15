// Run: node --experimental-strip-types tests/squadp1.test.ts
// G Squad Priority 1 (PS 1.63, core/squadp1.ts): the 24 hour clock, which tasks are shared and which never are, the default for a new
// person versus the one question for everyone else, the panel's rows, the once per device alerts, and that the gate refuses an opted out
// piece before it touches the key. Made up names and ids only. No network, no hub, no vault.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../src/core/squadcrypto.ts";
import * as P from "../src/core/squadp1.ts";
import { NEUTRAL_TITLE } from "../src/core/squadanon.ts";
import { cleanShareOpts, planTaskSync, sealForSquad, shareOn, SHARE_PIECES, taskCopies } from "../src/core/squadshare.ts";
import { cleanSquadOp } from "../src/squad/view.ts";
import { cardKind } from "../src/core/dnd.ts";
import { INTROS } from "../src/core/featureintro.ts";
import type { Doc, Todo } from "../src/core/model.ts";

const tests: [string, () => Promise<void> | void][] = [];
const ok = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const H = 3_600_000, MIN = 60_000;
const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const iso = (t: number) => new Date(t).toISOString();
const ago = (ms: number) => iso(NOW - ms);
const todo = (id: string, data: Partial<Todo>): Doc<Todo> => ({ id, ws: null, kind: "todo", author: null, updatedAt: null, data: { title: "Task " + id, type: "once", done: false, order: 0, ...data } as Todo });
const CLIENTS = [{ name: "Northwind Silk", contactName: "Odette Lind" }];
const SQ = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d";
const SECRET = S.newSecret();
let KEY: { raw: string; gen: number } | null = null;
async function plan(todos: Doc<Todo>[], squadShare: unknown, have = new Map<string, string>(), now = NOW) {
  KEY ??= { raw: await S.newSquadKey(), gen: 1 };
  return planTaskSync({ todos, settings: { squadShare: cleanShareOpts(squadShare) }, clients: CLIENTS, squad: SQ, member: "m1", secret: SECRET, key: KEY, have, now });
}

// ---------- the clock ----------
ok("the window is 24 hours from the start, the reminder 2 hours before", () => {
  assert.equal(P.P1_WINDOW_MS, 24 * H);
  assert.equal(P.P1_REMIND_BEFORE_MS, 2 * H);
  assert.equal(P.p1Deadline(ago(0)), NOW + 24 * H);
});
ok("a start time must be a real, recent, not future time", () => {
  assert.equal(P.cleanStart(ago(5 * H), NOW), ago(5 * H));
  for (const v of [undefined, null, "", "nonsense", 5, "1999-01-01T00:00:00Z", iso(NOW + 10 * MIN)]) assert.equal(P.cleanStart(v, NOW), null, String(v));
  assert.equal(P.cleanStart(iso(NOW + 30_000), NOW), iso(NOW + 30_000), "half a minute of clock difference is fine");
});
ok("state: open with time left, missed after 24 hours, done is done at any time", () => {
  assert.deepEqual(P.p1State({ s: ago(1 * H), x: false }, NOW), { kind: "open", left: 23 * H });
  assert.deepEqual(P.p1State({ s: ago(24 * H), x: false }, NOW), { kind: "missed", late: 0 });
  assert.equal(P.p1State({ s: ago(24 * H + 1), x: false }, NOW).kind, "missed");
  assert.equal(P.p1State({ s: ago(23 * H + 59 * MIN), x: false }, NOW).kind, "open");
  assert.deepEqual(P.p1State({ s: ago(30 * H), x: true }, NOW), { kind: "done" }, "done within or after, the panel keeps it as done");
});
ok("time left words", () => {
  assert.equal(P.leftText(23 * H), "23h"); assert.equal(P.leftText(2 * H + 10 * MIN), "2h 10m"); assert.equal(P.leftText(35 * MIN), "35m");
  assert.equal(P.leftText(10_000), "Under 1m"); assert.equal(P.leftText(-5), "Under 1m"); assert.equal(P.leftText(6 * H + 20 * MIN), "6h");
  assert.equal(P.stateText({ kind: "missed", late: 5 }), "Missed"); assert.equal(P.stateText({ kind: "done" }), "Done");
});

// ---------- stamping ----------
ok("stamps: a P1 you share with no start gets now (a task that was already P1 never gets a past time)", () => {
  const st = P.p1Stamps([todo("a", { p1: true }), todo("b", { p1: false }), todo("c", {})], { active: true, now: NOW });
  assert.deepEqual(st, [{ id: "a", p1At: iso(NOW) }]);
});
ok("stamps: nothing is started while the person does not share P1", () => {
  assert.deepEqual(P.p1Stamps([todo("a", { p1: true })], { active: false, now: NOW }), []);
});
ok("stamps: a start stays; leaving P1 takes it off even when nothing is shared, so a later P1 starts fresh", () => {
  assert.deepEqual(P.p1Stamps([todo("a", { p1: true, p1At: ago(5 * H) })], { active: true, now: NOW }), []);
  assert.deepEqual(P.p1Stamps([todo("a", { p1: false, p1At: ago(5 * H) })], { active: false, now: NOW }), [{ id: "a", p1At: null }]);
  assert.deepEqual(P.p1Stamps([todo("a", { p1: undefined, p1At: ago(5 * H) })], { active: true, now: NOW }), [{ id: "a", p1At: null }]);
});
ok("stamps: hidden, daily, cleared and example tasks carry no clock", () => {
  const list = [todo("h", { p1: true, sqOff: true, p1At: ago(H) }), todo("d", { p1: true, type: "daily", p1At: ago(H) }), todo("c", { p1: true, clearedAt: ago(H), p1At: ago(H) }), todo("e", { p1: true, p1At: ago(H), ...({ example: true } as object) })];
  assert.deepEqual(P.p1Stamps(list, { active: true, now: NOW }).map((x) => [x.id, x.p1At]), [["h", null], ["d", null], ["c", null], ["e", null]]);
  assert.deepEqual(P.p1Stamps([todo("h", { p1: true, sqOff: true })], { active: true, now: NOW }), [], "a hidden P1 is not started");
});
ok("stamps: a start from the future or nonsense is replaced, never believed", () => {
  assert.deepEqual(P.p1Stamps([todo("a", { p1: true, p1At: iso(NOW + 5 * H) })], { active: true, now: NOW }), [{ id: "a", p1At: iso(NOW) }]);
  assert.deepEqual(P.p1Stamps([todo("a", { p1: true, p1At: "junk" })], { active: false, now: NOW }), [{ id: "a", p1At: null }]);
});

// ---------- the question and the default ----------
ok("default: a saved yes or no is kept; a new person gets yes; an updater is asked; unknown waits", () => {
  assert.equal(P.p1Default("done", { p1: false }), "keep");
  assert.equal(P.p1Default("open", { p1: true }), "keep");
  assert.equal(P.p1Default("done", {}), "on");
  assert.equal(P.p1Default("done", undefined), "on");
  assert.equal(P.p1Default("open", {}), "ask");
  assert.equal(P.p1Default("unknown", {}), "wait");
  assert.equal(P.p1Default("done", { p1: "yes" }), "on", "a non boolean is not an answer");
});
ok("until answered nothing of theirs is shared (off unless an explicit yes)", () => {
  for (const v of [undefined, null, {}, { p1: null }, { p1: "yes" }, { p1: 1 }, { p1: false }]) assert.equal(shareOn(cleanShareOpts(v), "p1"), false, JSON.stringify(v));
  assert.equal(shareOn({ p1: true }, "p1"), true);
  assert.equal(shareOn(undefined, "p1"), false);
  assert.equal(P.p1Answered({}), false); assert.equal(P.p1Answered({ p1: false }), true);
});
ok("the Priority 1 piece is its own switch, separate from Tasks, listed in What you share", () => {
  assert.ok(SHARE_PIECES.some((p) => p.id === "p1" && p.label === "Priority 1 tasks"));
  assert.equal(shareOn({ tasks: true }, "p1"), false); assert.equal(shareOn({ p1: true }, "tasks"), false);
});
ok("the question is an intro with Yes and No, once; the new person path and the question are wired", () => {
  const d = INTROS.find((x) => x.id === "squad-p1")!;
  assert.ok(d && d.choice === true && d.ask === "Share your Priority 1 tasks with the squad?" && d.show === "Yes" && d.later === "No");
  const f = src("views/FeatureIntro.tsx");
  assert.match(f, /"squad-p1": async/);
  assert.match(f, /if \(todo === "on"\) \{ await saveSettings\(\{ squadShare: \{ \.\.\.opts, p1: true \} \}\); return "done"; \}/);
  assert.match(f, /CHOICES: Record<string/);
  assert.match(f, /finish\("show", false\)/);
  assert.match(src("core/features.ts") + src("../../features.json"), /squad-p1/);
});

// ---------- what is shared ----------
ok("copies: nothing unless the P1 switch is an explicit yes", () => {
  const t = [todo("a", { p1: true, p1At: ago(H) })];
  for (const v of [undefined, {}, { p1: false }, { tasks: true }]) assert.deepEqual(P.p1Copies(t, v, CLIENTS, NOW), [], JSON.stringify(v));
  assert.equal(P.p1Copies(t, { p1: true }, CLIENTS, NOW).length, 1);
});
ok("copies: title, date, done and the start only; never notes, client id or anything else", () => {
  const c = P.p1Copies([todo("a", { title: "Ship the draft", p1: true, p1At: ago(H), due: "2026-11-17T00:00:00Z", notes: "secret notes", clientId: null })], { p1: true }, CLIENTS, NOW)[0].copy;
  assert.deepEqual(c, { t: "Ship the draft", p: 1, d: "2026-11-17", x: false, s: ago(H) });
  assert.ok(!JSON.stringify(c).includes("secret"));
});
ok("copies: a task that names a client gets the neutral title unless the person chose to show it", () => {
  const named = P.p1Copies([todo("a", { title: "Call Northwind Silk", p1: true, p1At: ago(H) })], { p1: true }, CLIENTS, NOW)[0].copy;
  assert.equal(named.t, NEUTRAL_TITLE); assert.equal(named.a, true);
  assert.equal(P.p1Copies([todo("a", { title: "Call Northwind Silk", p1: true, p1At: ago(H), sqAnon: false })], { p1: true }, CLIENTS, NOW)[0].copy.t, "Call Northwind Silk");
  assert.equal(P.p1Copies([todo("a", { title: "Call someone", clientId: "c1", p1: true, p1At: ago(H) })], { p1: true }, CLIENTS, NOW)[0].copy.t, NEUTRAL_TITLE, "linked to a client");
});
ok("copies: hidden, daily, example, cleared, not P1 and no start are never copied", () => {
  const base = { p1: true, p1At: ago(H) };
  const list = [todo("hid", { ...base, sqOff: true }), todo("day", { ...base, type: "daily" }), todo("ex", { ...base, ...({ example: true } as object) }), todo("clr", { ...base, clearedAt: ago(1) }),
    todo("no", { p1At: ago(H) }), todo("nostart", { p1: true }), todo("ai", { ...base, aiInbox: true }), todo("ok", base)];
  assert.deepEqual(P.p1Copies(list, { p1: true }, CLIENTS, NOW).map((c) => c.todoId), ["ok"]);
});
ok("copies: a task that just became P1 waits the grace time, so Hide from the squad is always in time", () => {
  const t = (age: number) => [todo("a", { p1: true, p1At: ago(age) })];
  assert.equal(P.p1Copies(t(9 * MIN), { p1: true }, CLIENTS, NOW).length, 0);
  assert.equal(P.p1Copies(t(10 * MIN), { p1: true }, CLIENTS, NOW).length, 1);
});
ok("copies: done stays a day then goes; a done copy carries the done time", () => {
  const d = (ago_: number) => [todo("a", { p1: true, p1At: ago(30 * H), done: true, doneAt: ago(ago_) })];
  const c = P.p1Copies(d(2 * H), { p1: true }, CLIENTS, NOW)[0].copy;
  assert.equal(c.x, true); assert.equal(c.xa, ago(2 * H));
  assert.equal(P.p1Copies(d(25 * H), { p1: true }, CLIENTS, NOW).length, 0);
  assert.equal(P.p1Copies([todo("a", { p1: true, p1At: ago(30 * H), done: true })], { p1: true }, CLIENTS, NOW).length, 0, "done with no time is dropped");
});

// ---------- the gate ----------
ok("gate: sealForSquad refuses an opted out P1 before it touches the key", async () => {
  const bad = { get raw(): string { throw new Error("the key was touched"); }, gen: 1 };
  for (const v of [{}, { p1: false }, undefined]) assert.equal(await sealForSquad(cleanShareOpts(v), "p1", bad, { t: "x" }, "aad"), null, JSON.stringify(v));
  assert.equal(await sealForSquad({ tasks: true }, "p1", bad, { t: "x" }, "aad"), null, "the Tasks switch does not open the P1 piece");
});
ok("gate: a sync seals P1 copies only with the P1 switch on; off or unanswered seals nothing and takes the hub's copy off", async () => {
  const todos = [todo("a", { title: "One", p1: true, p1At: ago(H) }), todo("b", { title: "Two", p1: true, p1At: ago(H) })];
  const on = await plan(todos, { p1: true });
  assert.equal(on.put.length, 2); assert.deepEqual(on.del, []);
  const have = new Map(on.put.map((r) => [r.id, r.fp]));
  for (const v of [undefined, {}, { p1: false }]) {
    const off = await plan(todos, v, have);
    assert.deepEqual(off.put, [], JSON.stringify(v));
    assert.deepEqual(off.del.sort(), [...have.keys()].sort(), "what the hub held is deleted");
  }
});
ok("gate: a hidden task is never sealed, and an already shared copy is taken off", async () => {
  const shown = [todo("a", { p1: true, p1At: ago(H) })];
  const first = await plan(shown, { p1: true });
  const have = new Map(first.put.map((r) => [r.id, r.fp]));
  const hidden = [todo("a", { p1: true, p1At: ago(H), sqOff: true })];
  const after = await plan(hidden, { p1: true }, have);
  assert.deepEqual(after.put, []); assert.equal(after.del.length, 1);
});
ok("gate: a task still inside its grace time is not sealed yet", async () => {
  const r = await plan([todo("a", { p1: true, p1At: ago(3 * MIN) })], { p1: true });
  assert.deepEqual(r.put, []);
});
ok("gate: a task shared as an ordinary task and P1 is one row, as a task, with the start added; with Tasks off it is a P1 row", async () => {
  const t = [todo("a", { title: "Both", p1: true, p1At: ago(H), sqOn: true })];
  const both = await plan(t, { tasks: true, p1: true });
  assert.equal(both.put.length, 1);
  const opened = await S.open<{ t: string; s?: string }>(KEY!.raw, both.put[0].ct, S.sqAad.task(SQ, "m1", both.put[0].id, 1));
  assert.equal(opened.s, ago(H));
  const p1only = await plan(t, { p1: true });
  assert.equal(p1only.put.length, 1);
  assert.equal(taskCopies(t, { squadShare: { p1: true } }, CLIENTS, NOW).length, 0, "the Tasks piece itself is unchanged");
  const tasksOnly = await plan(t, { tasks: true });
  assert.equal((await S.open<{ s?: string }>(KEY!.raw, tasksOnly.put[0].ct, S.sqAad.task(SQ, "m1", tasksOnly.put[0].id, 1))).s, undefined, "no clock without the P1 switch");
});
ok("gate: the engine forces the P1 piece off while the squad-p1 feature is off", () => {
  assert.match(src("squad/engine.ts"), /feature\(P1_FEATURE\) \? st : \{ \.\.\.st, squadShare: \{ \.\.\.cleanShareOpts\(st\.squadShare\), p1: false \} \}/);
});
ok("ordinary tasks are unchanged: Tasks still off unless switched on", () => {
  assert.equal(shareOn({}, "tasks"), false);
  assert.equal(taskCopies([todo("a", { p1: true, sqOn: true })], { squadShare: { p1: true } }, CLIENTS, NOW).length, 0);
});

// ---------- the panel ----------
const copy = (id: string, member: string, o: Record<string, unknown> = {}) => ({ id, member, t: "Task " + id, x: false, s: ago(2 * H), ...o });
const LIVE = new Set(["m2", "m3", "me"]);
ok("rows: only other people's copies with a start; own, left members, no start and daily are left out", () => {
  const rows = P.p1Rows([copy("1", "m2"), copy("2", "me"), copy("3", "gone"), copy("4", "m2", { s: undefined }), copy("5", "m2", { e: true }), copy("6", "m3", { t: "  " })], { me: "me", live: LIVE, now: NOW });
  assert.deepEqual(rows.map((r) => r.id), ["1"]);
});
ok("rows: open first by time left, then missed, then done; old missed and old done drop off", () => {
  const rows = P.p1Rows([copy("done", "m2", { x: true, xa: ago(H) }), copy("miss", "m3", { s: ago(26 * H) }), copy("late", "m2", { s: ago(10 * H) }), copy("soon", "m3", { s: ago(23 * H) }),
    copy("old", "m2", { s: ago(49 * H) }), copy("olddone", "m2", { x: true, xa: ago(7 * H) })], { me: "me", live: LIVE, now: NOW });
  assert.deepEqual(rows.map((r) => r.id), ["soon", "late", "miss", "done"]);
});
ok("rows: at most 8", () => {
  const many = Array.from({ length: 20 }, (_, i) => copy("r" + i, "m2", { s: ago((i + 1) * 30 * MIN) }));
  assert.equal(P.p1Rows(many, { me: "me", live: LIVE, now: NOW }).length, 8);
});
ok("first name", () => { assert.equal(P.firstName("Kit Doe"), "Kit"); assert.equal(P.firstName("  "), "Someone"); assert.equal(P.firstName(null), "Someone"); assert.equal(P.firstName("Mo"), "Mo"); });
ok("the panel is hidden when the feature or the Show switch is off", () => {
  assert.equal(P.p1PanelOn(true, {}), true); assert.equal(P.p1PanelOn(false, {}), false); assert.equal(P.p1PanelOn(true, { squadP1Show: false }), false);
  const panel = src("views/SquadP1Panel.tsx");
  assert.match(panel, /if \(!v\.in \|\| !p1PanelOn\(feature\(P1_FEATURE\), st\)\) return null;/);
  assert.match(src("views/TaskMap.tsx"), /<Slot id="squadp1"><SquadP1Panel \/><\/Slot>\s*\n\s*<Slot id="meetnotes">/, "under the emails and Record screen, above Sleep");
  assert.match(src("views/GSquadSettings.tsx"), /<SquadP1Switch \/>/);
});

// ---------- alerts ----------
const NAMES = new Map([["m2", "Kit Doe"], ["m3", "Ari Lee"], ["me", "Me"]]);
const row = (id: string, member: string, s: number, x = false): P.P1Row => ({ id, member, t: "Do " + id, s: ago(s), x });
const inp = (o: Partial<Parameters<typeof P.planMissedAlerts>[1]> = {}) => ({ me: "me", names: NAMES, now: NOW, since: ago(48 * H), ledger: {}, held: false, ...o });
const ids = (p: { show: { id: string; key: string }[] }) => p.show.map((c) => c.key);
ok("alert: a task past 24 hours not done alerts with the first name and the task", () => {
  const p = P.planMissedAlerts([row("t1", "m2", 25 * H)], inp());
  assert.equal(p.show.length, 1);
  assert.equal(p.show[0].title, "Kit did not complete their task"); assert.equal(p.show[0].body, "Do t1");
  const card = P.alertCard(p.show[0], false);
  assert.equal(card.tone, "squad"); assert.ok(!card.id.startsWith("g:") && card.id.startsWith("sp:") && card.id.length <= 40);
});
ok("alert: not before 24 hours, not when done, never your own", () => {
  const p = P.planMissedAlerts([row("early", "m2", 23 * H), row("done", "m2", 30 * H, true), row("own", "me", 30 * H)], inp());
  assert.deepEqual(p.show, []);
  assert.deepEqual(p.skipped.map((s) => s.why).sort(), ["done", "early", "own"]);
});
ok("alert: once per task per device, even when the plan is run again", () => {
  const a = P.planMissedAlerts([row("t1", "m2", 25 * H)], inp());
  const b = P.planMissedAlerts([row("t1", "m2", 25 * H)], inp({ ledger: a.ledger }));
  assert.equal(a.show.length, 1); assert.deepEqual(b.show, []); assert.equal(b.skipped[0].why, "again");
});
ok("alert: Do Not Disturb, Sleep or Sentry hold it and nothing is used up; it comes when the quiet time ends", () => {
  const r = [row("t1", "m2", 25 * H)];
  const held = P.planMissedAlerts(r, inp({ held: true }));
  assert.deepEqual(held.show, []); assert.deepEqual(held.ledger, {});
  assert.equal(P.planMissedAlerts(r, inp({ ledger: held.ledger })).show.length, 1);
});
ok("alert: a deadline that passed before this device started watching never fires (an update does not fire old deadlines at once)", () => {
  const r = [row("old", "m2", 30 * H)];
  assert.deepEqual(P.planMissedAlerts(r, inp({ since: ago(2 * H) })).show, []);
  assert.deepEqual(P.planMissedAlerts(r, inp({ since: null })).show, []);
  assert.equal(P.planMissedAlerts([row("new", "m2", 24 * H + MIN)], inp({ since: ago(2 * H) })).show.length, 1, "a deadline that passes after it started does");
});
ok("alert: older than a day past the deadline is dropped, and a flood is capped at three", () => {
  assert.deepEqual(P.planMissedAlerts([row("ancient", "m2", 50 * H)], inp({ since: ago(60 * H) })).show, []);
  const many = Array.from({ length: 6 }, (_, i) => row("t" + i, "m2", 25 * H + i * MIN));
  const p = P.planMissedAlerts(many, inp());
  assert.equal(p.show.length, 3); assert.equal(Object.keys(p.ledger).length, 6, "all six are used up, none queued");
});
ok("alert: each member and task is its own once", () => {
  const p = P.planMissedAlerts([row("t1", "m2", 25 * H), row("t1", "m3", 25 * H)], inp());
  assert.equal(p.show.length, 2); assert.equal(new Set(ids(p)).size, 2);
});
ok("own reminder: two hours before your own deadline, once, not when done, hidden, held or not shared", () => {
  const t = (ageH: number, extra: Partial<Todo> = {}) => [todo("a", { title: "Mine", p1: true, p1At: ago(ageH * H), ...extra })];
  const o = { shared: true, now: NOW, ledger: {}, held: false };
  assert.deepEqual(P.planOwnReminders(t(21), o).show, [], "three hours left is too early");
  const r = P.planOwnReminders(t(22.5), o);
  assert.equal(r.show.length, 1); assert.match(r.show[0].title, /^Your Priority 1 task is due in 1h 30m$/);
  assert.deepEqual(P.planOwnReminders(t(22.5), { ...o, ledger: r.ledger }).show, [], "once");
  assert.deepEqual(P.planOwnReminders(t(25), o).show, [], "after the deadline it is the squad's card, not a reminder");
  assert.deepEqual(P.planOwnReminders(t(22.5, { done: true }), o).show, []);
  assert.deepEqual(P.planOwnReminders(t(22.5, { sqOff: true }), o).show, []);
  assert.deepEqual(P.planOwnReminders(t(22.5), { ...o, shared: false }).show, []);
  const held = P.planOwnReminders(t(22.5), { ...o, held: true });
  assert.deepEqual(held.show, []); assert.deepEqual(held.ledger, {});
});
ok("alert cards are muted like G Squad messages by Do Not Disturb", () => {
  assert.equal(cardKind("sp:abc"), "gsquad");
  assert.match(src("squad/p1engine.ts"), /dndMutes\(st\.dnd, "gsquad"/);
  assert.match(src("squad/p1engine.ts"), /sleepState\(\)\.here \|\| sentryNow\(\)/);
});

// ---------- wiring ----------
ok("the squad's P1 view travels to the Tab list and the switch op is checked", () => {
  assert.deepEqual(cleanSquadOp({ op: "p1show", on: false }), { op: "p1show", on: false });
  assert.equal(cleanSquadOp({ op: "p1show", on: "no" }), null);
  assert.deepEqual(cleanSquadOp({ op: "share", piece: "p1", on: true }), { op: "share", piece: "p1", on: true });
  assert.match(src("squad/mirror.ts"), /p1: cleanP1Rows\(o\.p1\)/);
  assert.match(src("squad/flows.ts"), /\.\.\.\(typeof c\.s === "string"/);
});
ok("hide from the squad: a P1 menu line that sets Not shared, only on a one off P1 while the switch is on", () => {
  const on = { featureOn: true, shareP1: true };
  assert.deepEqual(P.p1HideItem({ p1: true, type: "once" }, on), { label: "Hide from the squad", sqOff: true });
  assert.deepEqual(P.p1HideItem({ p1: true, type: "once", sqOff: true }, on), { label: "Show to the squad again", sqOff: false });
  assert.equal(P.p1HideItem({ p1: false, type: "once" }, on), null);
  assert.equal(P.p1HideItem({ p1: true, type: "daily" }, on), null);
  assert.equal(P.p1HideItem({ p1: true, type: "once" }, { ...on, shareP1: false }), null);
  assert.equal(P.p1HideItem({ p1: true, type: "once" }, { ...on, featureOn: false }), null);
  assert.match(src("views/GSquadTask.tsx"), /squadOp\(\{ op: "task", id, sqOff: hide\.sqOff \}\)/);
});
ok("no em or en dashes in anything this change touched", () => {
  for (const p of ["core/squadp1.ts", "core/squadshare.ts", "squad/p1engine.ts", "squad/engine.ts", "squad/view.ts", "squad/mirror.ts", "views/SquadP1Panel.tsx", "views/SquadP1Switch.tsx", "views/squadp1.css", "views/FeatureIntro.tsx", "core/featureintro.ts", "views/GSquadTask.tsx"]) {
    assert.ok(!/[–—]/.test(src(p)), p);
  }
});

let pass = 0;
for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log("ok -", name); } catch (e) { console.error("FAIL -", name); console.error(e); process.exitCode = 1; }
}
console.log(`\nsquadp1: ${pass} of ${tests.length} passed`);

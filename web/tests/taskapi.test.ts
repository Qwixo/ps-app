// The Task API's rules (core/taskapi.ts): the switches, every endpoint, the AI Inbox, the errors, and the
// "Copy for AI" text (core/taskapidoc.ts). Runs every endpoint against a fake vault.
import assert from "node:assert/strict";
import { DEFAULT_SCOPES, SCOPES, cleanScopes, handleApi, type ApiStore, type Scopes, type SentryStartResult } from "../src/core/taskapi.ts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { INBOX, inboxMove, inboxTasks, openInboxCount } from "../src/core/aiinbox.ts";
import { aiGuide, KEY_SLOT } from "../src/core/taskapidoc.ts";
import { tabLists } from "../src/core/groups.ts";
import { cleanRemind, type RemindRec } from "../src/core/remind.ts";

let n = 0;
const tests: [string, () => Promise<void> | void][] = [];
const ok = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);
const T = "2026-11-12";
type Data = Record<string, unknown>;
type Doc = { id: string; ws: null; kind: "todo"; author: null; updatedAt: null; data: Data };

function fake(init: { todos?: Doc[]; settings?: Data; locked?: boolean } = {}) {
  const docs = new Map<string, Doc>((init.todos ?? []).map((d) => [d.id, d]));
  let settings: Data = { ...(init.settings ?? {}) };
  let rem: RemindRec | null = null;
  let seq = 0, gseq = 0;
  const log: string[] = [];
  let sentry: SentryStartResult = { result: "engaged", phase: "covered" };
  const store: ApiStore & { docs: Map<string, Doc>; log: string[]; set: () => Data; rem: () => RemindRec | null; sentryWill: (r: SentryStartResult) => void } = {
    docs, log, set: () => settings, rem: () => rem, sentryWill: (r) => { sentry = r; },
    state: () => (init.locked ? "locked" : "ok"),
    todos: () => [...docs.values()].filter((d) => !d.data.clearedAt).sort((a, b) => ((a.data.order as number) ?? 0) - ((b.data.order as number) ?? 0)) as never,
    settings: () => settings as never,
    remind: () => rem,
    today: () => T, now: () => Date.parse(`${T}T10:00:00Z`), deviceTz: () => "UTC", red: () => false, version: () => "1.56",
    async add(t) {
      const id = `new${++seq}`;
      const all = [...docs.values()];
      const order = (t as Data).order ?? (all.length ? Math.max(...all.map((d) => (d.data.order as number) ?? 0)) + 1 : 0);
      docs.set(id, { id, ws: null, kind: "todo", author: null, updatedAt: null, data: { type: "once", done: false, ...t, order, createdAt: "2026-11-12T10:00:00.000Z" } });
      log.push(`add ${id}`);
      return id;
    },
    async update(id, patch) { const d = docs.get(id); if (d) d.data = { ...d.data, ...patch }; log.push(`update ${id} ${JSON.stringify(patch)}`); },
    async setDone(id, done) { const d = docs.get(id); if (d && !!d.data.done !== done) d.data = { ...d.data, done, doneAt: done ? "2026-11-12T10:00:00.000Z" : null }; log.push(`done ${id} ${done}`); },
    async remove(id) { docs.delete(id); log.push(`remove ${id}`); },
    async saveSettings(p) { settings = { ...settings, ...p }; log.push(`settings ${Object.keys(p).join(",")}`); },
    async saveRemind(change) { const next = change(rem); if (next) rem = cleanRemind(next); log.push("remind"); },
    newGroupId: () => `grp${++gseq}x`,
    async startSentry() { log.push("sentry start"); return sentry; },
  };
  return store;
}
const d = (id: string, order: number, x: Data = {}): Doc => ({ id, ws: null, kind: "todo", author: null, updatedAt: null, data: { title: `Task ${id}`, type: "once", done: false, order, ...x } });
const ALL: Scopes = Object.fromEntries(SCOPES.map((s) => [s.id, true])) as Scopes;
const call = (s: ApiStore, method: string, path: string, body?: unknown, scopes: unknown = DEFAULT_SCOPES, query?: Record<string, string>) =>
  handleApi({ method, path, body, query }, scopes, s) as Promise<{ status: number; body: any }>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const SETTINGS = {
  tmGroups: [{ id: "errand1", name: "Errands" }],
  tmPages: [{ id: "work01", name: "Work", secs: ["g:errand1"] }, { id: "panel1", name: "Page 2", secs: [], kind: "panels" }],
  tmPageOrder: ["main", "work01", "panel1"],
};
const world = () => fake({
  settings: SETTINGS,
  todos: [d("a1", 0, { p1: true }), d("a2", 1), d("gym", 0, { type: "daily" }), d("e1", 0, { group: "errand1" }), d("ai1", 5, { ai: true, aiInbox: true, title: "Inbox one" })],
});

// ---------- switches ----------
ok("defaults: add, read and the AI Inbox on, everything else off", () => {
  assert.deepEqual(DEFAULT_SCOPES, { inbox: true, lists: false, rename: false, read: true, add: true, edit: false, done: false, delete: false, remind: false, sentry: false });
  assert.deepEqual(cleanScopes({ lists: true, delete: "yes", bogus: true }), { ...DEFAULT_SCOPES, lists: true });
  assert.deepEqual(cleanScopes(null), DEFAULT_SCOPES);
});

// ---------- GET /v1 and the lock ----------
ok("GET /v1 answers even while PS is locked, every other endpoint says 423", async () => {
  const s = fake({ locked: true });
  const r = await call(s, "GET", "/v1");
  assert.equal(r.status, 200);
  assert.equal(r.body.vault, "locked");
  assert.equal(r.body.inbox.id, INBOX);
  assert.ok(r.body.endpoints.includes("POST /v1/tasks"));
  const r2 = await call(s, "GET", "/v1/tasks");
  assert.equal(r2.status, 423);
  assert.equal(r2.body.error.code, "locked");
});
ok("unknown paths 404, wrong methods 405 with the allowed ones", async () => {
  const s = world();
  assert.equal((await call(s, "GET", "/v2/tasks")).status, 404);
  assert.equal((await call(s, "GET", "/v1/nope")).status, 404);
  const r = await call(s, "PUT", "/v1/tasks");
  assert.equal(r.status, 405);
  assert.deepEqual(r.body.error.allow, ["GET", "POST"]);
  assert.equal((await call(s, "POST", "/v1/lists")).status, 405);
  assert.equal((await call(s, "GET", "/v1/tasks/a2/explode")).status, 404);
  assert.equal((await call(s, "GET", "/v1/tasks/../../etc")).status, 404);
});

// ---------- reading ----------
ok("default switches: only the AI Inbox can be read", async () => {
  const s = world();
  const r = await call(s, "GET", "/v1/tasks");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.tasks.map((t: { id: string }) => t.id), ["ai1"]);
  assert.equal(r.body.tasks[0].list, "inbox");
  assert.equal(r.body.tasks[0].addedByAi, true);
  const l = await call(s, "GET", "/v1/lists");
  assert.deepEqual(l.body.lists.map((x: { id: string }) => x.id), ["inbox"]);
  assert.equal((await call(s, "GET", "/v1/tasks", undefined, DEFAULT_SCOPES, { list: "main" })).body.error.scope, "lists");
  const one = await call(s, "GET", "/v1/tasks/a2");
  assert.equal(one.status, 403);
  assert.equal(one.body.error.code, "scope_off");
  assert.equal(one.body.error.scope, "lists");
});
ok("read off: nothing can be read", async () => {
  const s = world();
  const sc = { ...DEFAULT_SCOPES, read: false };
  assert.equal((await call(s, "GET", "/v1/tasks", undefined, sc)).body.error.scope, "read");
  assert.equal((await call(s, "GET", "/v1/lists", undefined, sc)).body.error.scope, "read");
  assert.equal((await call(s, "GET", "/v1/tasks/ai1", undefined, sc)).body.error.scope, "read");
});
ok("lists on: every list in order, sections, what they take, panels pages marked", async () => {
  const s = world();
  const r = await call(s, "GET", "/v1/lists", undefined, ALL);
  const lists = r.body.lists;
  assert.deepEqual(lists.map((x: { id: string }) => x.id), ["inbox", "main", "work01", "panel1"]);
  const main = lists[1];
  assert.equal(main.name, "Main list");
  assert.equal(main.home, true);
  assert.deepEqual(main.sections.map((x: { key: string; takes: string; openTasks: number }) => [x.key, x.takes, x.openTasks]), [["p1", "once", 1], ["prio", "once", 1], ["daily", "daily", 1]]);
  assert.deepEqual(lists[2].sections, [{ key: "g:errand1", name: "Errands", takes: "any", openTasks: 1 }]);
  assert.equal(lists[3].kind, "panels");
  assert.equal(lists[0].openTasks, 1);
});
ok("tasks in order: inbox, then each list and section; filters by list, section, status, words", async () => {
  const s = world();
  s.docs.set("old", d("old", 9, { done: true, doneAt: "2026-11-11T08:00:00Z" }));
  const all = await call(s, "GET", "/v1/tasks", undefined, ALL);
  assert.deepEqual(all.body.tasks.map((t: { id: string }) => t.id), ["ai1", "a1", "a2", "gym", "e1"]);
  const p = (q: Record<string, string>) => call(s, "GET", "/v1/tasks", undefined, ALL, q).then((r) => r.body.tasks.map((t: { id: string }) => t.id));
  assert.deepEqual(await p({ list: "work01" }), ["e1"]);
  assert.deepEqual(await p({ section: "p1" }), ["a1"]);
  assert.deepEqual(await p({ status: "done" }), ["old"]);
  assert.deepEqual(await p({ q: "INBOX" }), ["ai1"]);
  assert.deepEqual(await p({ limit: "2" }), ["ai1", "a1"]);
  assert.equal((await call(s, "GET", "/v1/tasks", undefined, ALL, { status: "maybe" })).status, 400);
  assert.equal((await call(s, "GET", "/v1/tasks", undefined, ALL, { lmit: "2" })).body.error.code, "unknown_field");
  assert.equal((await call(s, "GET", "/v1/tasks", undefined, ALL, { list: "nope" })).status, 404);
  const one = (await call(s, "GET", "/v1/tasks/e1", undefined, ALL)).body.task;
  assert.deepEqual([one.list, one.listName, one.section, one.sectionName, one.kind, one.p1], ["work01", "Work", "g:errand1", "Errands", "once", false]);
});

// ---------- adding ----------
ok("add: lands in the AI Inbox with the AI marker, nothing on the lists changes", async () => {
  const s = world();
  const r = await call(s, "POST", "/v1/tasks", { title: "  Email Sam  ", notes: "Attach the PDF", due: "2026-11-15" });
  assert.equal(r.status, 201);
  const t = r.body.task;
  assert.deepEqual([t.title, t.notes, t.due, t.list, t.section, t.addedByAi, t.inInbox], ["Email Sam", "Attach the PDF", "2026-11-15", "inbox", "inbox", true, true]);
  const saved = s.docs.get(t.id)!.data;
  assert.equal(saved.ai, true);
  assert.equal(saved.aiInbox, true);
  // The Tab list's sections never show it.
  const lists = tabLists(s.todos(), [{ id: "errand1", name: "Errands" }], T);
  assert.ok(![...lists.ranked, ...lists.daily].some((x) => x.id === t.id));
  assert.deepEqual(inboxTasks(s.todos() as never, Date.parse(`${T}T10:00:00Z`)).map((x) => x.id), ["ai1", t.id]);
  assert.equal(openInboxCount(s.todos() as never), 2);
});
ok("add: a batch keeps its order, and one bad task means none are added", async () => {
  const s = world();
  const bad = await call(s, "POST", "/v1/tasks", { tasks: [{ title: "One" }, { title: "" }] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.field, "title");
  assert.match(bad.body.error.message, /tasks\[1\]/);
  assert.ok(!s.log.some((x) => x.startsWith("add")));
  const r = await call(s, "POST", "/v1/tasks", { tasks: [{ title: "One" }, { title: "Two", kind: "daily" }] });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.tasks.map((t: { title: string; kind: string }) => [t.title, t.kind]), [["One", "once"], ["Two", "daily"]]);
  const many = await call(s, "POST", "/v1/tasks", { tasks: Array.from({ length: 51 }, (_, i) => ({ title: `T${i}` })) });
  assert.equal(many.body.error.code, "too_many");
});
ok("add: checks every field, names unknown ones", async () => {
  const s = world();
  const e = async (b: unknown) => (await call(s, "POST", "/v1/tasks", b)).body.error;
  assert.equal((await e({ title: "x", prority: 1 })).code, "unknown_field");
  assert.equal((await e({ title: "x", due: "2026-02-30" })).field, "due");
  assert.equal((await e({ title: "x", due: "tomorrow" })).field, "due");
  assert.equal((await e({ title: "x", kind: "weekly" })).field, "kind");
  assert.equal((await e({ title: "x", kind: "daily", due: "2026-11-20" })).field, "due");
  assert.equal((await e({ title: "x", kind: "daily", p1: true })).field, "p1");
  assert.equal((await e("just text")).code, "bad_request");
  assert.equal((await e([{ title: "x" }])).code, "bad_request");
  assert.equal((await e({ title: "x".repeat(600) })), undefined);   // trimmed, not refused
});
ok("add off: refused; adding to a list needs lists on", async () => {
  const s = world();
  assert.equal((await call(s, "POST", "/v1/tasks", { title: "x" }, { ...DEFAULT_SCOPES, add: false })).body.error.scope, "add");
  assert.equal((await call(s, "POST", "/v1/tasks", { title: "x", list: "main" })).body.error.scope, "lists");
  assert.equal((await call(s, "POST", "/v1/tasks", { title: "x" }, { ...DEFAULT_SCOPES, inbox: false, lists: true })).body.error.scope, "inbox");
});
ok("add to a list: the right section, at its end, with the AI marker", async () => {
  const s = world();
  const sc = { ...DEFAULT_SCOPES, lists: true };
  const main = (await call(s, "POST", "/v1/tasks", { title: "Main one", list: "main" }, sc)).body.task;
  assert.deepEqual([main.list, main.section, main.inInbox, main.addedByAi], ["main", "prio", false, true]);
  assert.equal(s.docs.get(main.id)!.data.order, 2);   // after a1 (0) and a2 (1)
  const p1 = (await call(s, "POST", "/v1/tasks", { title: "Urgent", section: "p1" }, sc)).body.task;
  assert.deepEqual([p1.section, p1.p1], ["p1", true]);
  const work = (await call(s, "POST", "/v1/tasks", { title: "Buy milk", list: "work01" }, sc)).body.task;
  assert.deepEqual([work.list, work.section], ["work01", "g:errand1"]);
  const daily = (await call(s, "POST", "/v1/tasks", { title: "Walk", kind: "daily", list: "main" }, sc)).body.task;
  assert.equal(daily.section, "daily");
  const wrong = await call(s, "POST", "/v1/tasks", { title: "Walk", kind: "daily", section: "prio" }, sc);
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.error.code, "wrong_section");
  assert.equal((await call(s, "POST", "/v1/tasks", { title: "x", list: "panel1" }, sc)).body.error.code, "not_a_task_list");
  assert.equal((await call(s, "POST", "/v1/tasks", { title: "x", list: "main", section: "g:errand1" }, sc)).body.error.field, "section");
  assert.equal((await call(s, "POST", "/v1/tasks", { title: "x", section: "g:zzzz9" }, sc)).status, 404);
  assert.equal((await call(s, "POST", "/v1/tasks", { title: "x", list: "inbox", section: "prio" }, sc)).status, 400);
});
ok("add to a list with no section that takes it: a new To do group on that list", async () => {
  const s = fake({ settings: { tmPages: [{ id: "daily1", name: "Streaks", secs: ["daily"] }], tmPageOrder: ["main", "daily1"] }, todos: [] });
  const r = await call(s, "POST", "/v1/tasks", { title: "One off", list: "daily1" }, { ...DEFAULT_SCOPES, lists: true });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.task.list, r.body.task.section, r.body.task.sectionName], ["daily1", "g:grp1x", "To do"]);
  const st = s.set() as { tmPages: { id: string; secs: string[] }[]; tmGroups: { id: string }[] };
  assert.deepEqual(st.tmPages.find((p) => p.id === "daily1")!.secs, ["daily", "g:grp1x"]);
  assert.deepEqual(st.tmGroups.map((g) => g.id), ["grp1x"]);
});

// ---------- editing, moving, ticking, deleting ----------
ok("edit needs edit; done needs done; nothing else changes", async () => {
  const s = world();
  assert.equal((await call(s, "PATCH", "/v1/tasks/ai1", { title: "New" })).body.error.scope, "edit");
  assert.equal((await call(s, "PATCH", "/v1/tasks/ai1", { done: true })).body.error.scope, "done");
  const sc = { ...DEFAULT_SCOPES, edit: true, done: true };
  const r = await call(s, "PATCH", "/v1/tasks/ai1", { title: "Renamed", notes: "n", due: "2026-12-01", done: true }, sc);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.task.title, r.body.task.notes, r.body.task.due, r.body.task.done, r.body.task.inInbox], ["Renamed", "n", "2026-12-01", true, true]);
  const c = await call(s, "PATCH", "/v1/tasks/ai1", { notes: null, due: null }, sc);
  assert.deepEqual([c.body.task.notes, c.body.task.due], [null, null]);
  assert.equal((await call(s, "PATCH", "/v1/tasks/ai1", {}, sc)).status, 400);
  assert.equal((await call(s, "PATCH", "/v1/tasks/ai1", { colour: "red" }, sc)).body.error.code, "unknown_field");
  assert.equal((await call(s, "PATCH", "/v1/tasks/nope", { title: "x" }, sc)).status, 404);
});
ok("move out of the AI Inbox needs lists; it clears the inbox flag and keeps the AI marker", async () => {
  const s = world();
  const sc = { ...DEFAULT_SCOPES, edit: true };
  assert.equal((await call(s, "PATCH", "/v1/tasks/ai1", { list: "main" }, sc)).body.error.scope, "lists");
  const r = await call(s, "PATCH", "/v1/tasks/ai1", { list: "main" }, { ...sc, lists: true });
  assert.deepEqual([r.body.task.list, r.body.task.section, r.body.task.inInbox, r.body.task.addedByAi], ["main", "prio", false, true]);
  assert.equal(s.docs.get("ai1")!.data.aiInbox, false);
  const back = await call(s, "PATCH", "/v1/tasks/ai1", { list: "inbox" }, { ...sc, lists: true });
  assert.equal(back.body.task.inInbox, true);
  const g = await call(s, "PATCH", "/v1/tasks/a2", { section: "g:errand1" }, ALL);
  assert.deepEqual([g.body.task.list, g.body.task.section], ["work01", "g:errand1"]);
  assert.equal((await call(s, "PATCH", "/v1/tasks/gym", { section: "prio" }, ALL)).body.error.code, "wrong_section");
  assert.equal((await call(s, "PATCH", "/v1/tasks/gym", { p1: true }, ALL)).body.error.field, "p1");
  assert.equal((await call(s, "PATCH", "/v1/tasks/e1", { p1: true }, ALL)).body.error.code, "wrong_section");
  const p = await call(s, "PATCH", "/v1/tasks/a2", { section: "prio", p1: true }, ALL);
  assert.deepEqual([p.body.task.section, p.body.task.p1], ["p1", true]);
});
ok("complete and reopen need done; delete needs delete and takes the reminder with it", async () => {
  const s = world();
  assert.equal((await call(s, "POST", "/v1/tasks/ai1/complete")).body.error.scope, "done");
  const sc = { ...DEFAULT_SCOPES, done: true, delete: true, remind: true };
  assert.equal((await call(s, "POST", "/v1/tasks/ai1/complete", undefined, sc)).body.task.done, true);
  assert.equal((await call(s, "POST", "/v1/tasks/ai1/reopen", undefined, sc)).body.task.done, false);
  assert.equal((await call(s, "GET", "/v1/tasks/ai1/complete", undefined, sc)).status, 405);
  await call(s, "PUT", "/v1/tasks/ai1/reminder", { time: "09:30" }, sc);
  assert.equal(s.rem()!.list.filter((r) => r.task === "ai1").length, 1);
  assert.equal((await call(s, "DELETE", "/v1/tasks/ai1", undefined, DEFAULT_SCOPES)).body.error.scope, "delete");
  const r = await call(s, "DELETE", "/v1/tasks/ai1", undefined, sc);
  assert.deepEqual(r.body, { deleted: "ai1" });
  assert.ok(!s.docs.has("ai1"));
  assert.equal(s.rem()!.list.filter((x) => x.task === "ai1").length, 0);
});
ok("tasks on lists stay out of reach while lists is off, whatever else is on", async () => {
  const s = world();
  const sc = { ...ALL, lists: false };
  for (const [m, p, b] of [["PATCH", "/v1/tasks/a1", { title: "x" }], ["POST", "/v1/tasks/a1/complete"], ["DELETE", "/v1/tasks/a1"], ["PUT", "/v1/tasks/a1/reminder", { time: "10:00" }]] as const) {
    const r = await call(s, m, p, b, sc);
    assert.equal(r.status, 403, `${m} ${p}`);
    assert.equal(r.body.error.scope, "lists");
  }
  assert.equal(s.docs.get("a1")!.data.title, "Task a1");
});

// ---------- reminders ----------
ok("reminder: once on a date, default 3 hours, changed by a second PUT, taken off by DELETE", async () => {
  const s = world();
  const sc = { ...DEFAULT_SCOPES, remind: true };
  assert.equal((await call(s, "PUT", "/v1/tasks/ai1/reminder", { time: "09:30" })).body.error.scope, "remind");
  const r = await call(s, "PUT", "/v1/tasks/ai1/reminder", { time: "09:30", date: "2026-11-13" }, sc);
  assert.deepEqual(r.body.task.reminder, { date: "2026-11-13", time: "09:30", until: "12:30", on: true, message: null });
  const r2 = await call(s, "PUT", "/v1/tasks/ai1/reminder", { time: "22:00", until: "01:00", message: "Do it now" }, sc);
  assert.deepEqual(r2.body.task.reminder, { date: T, time: "22:00", until: "01:00", on: true, message: "Do it now" });
  assert.equal(s.rem()!.list.filter((x) => x.task === "ai1").length, 1);
  assert.equal((await call(s, "PUT", "/v1/tasks/ai1/reminder", { time: "9:30" }, sc)).body.error.field, "time");
  assert.equal((await call(s, "PUT", "/v1/tasks/ai1/reminder", { time: "09:30", date: "2026-11-01" }, sc)).body.error.field, "date");
  assert.equal((await call(s, "PUT", "/v1/tasks/ai1/reminder", { time: "09:30", until: "09:30" }, sc)).body.error.field, "until");
  assert.equal((await call(s, "PUT", "/v1/tasks/ai1/reminder", { time: "09:30", sound: "loud" }, sc)).body.error.code, "unknown_field");
  const del = await call(s, "DELETE", "/v1/tasks/ai1/reminder", undefined, sc);
  assert.equal(del.body.task.reminder, null);
  assert.equal((await call(s, "DELETE", "/v1/tasks/ai1/reminder", undefined, sc)).status, 404);
});

// ---------- renaming ----------
ok("rename lists and sections: needs rename and lists, blank brings the usual name back", async () => {
  const s = world();
  assert.equal((await call(s, "PATCH", "/v1/lists/main", { name: "Work" })).body.error.scope, "rename");
  assert.equal((await call(s, "PATCH", "/v1/lists/main", { name: "Work" }, { ...DEFAULT_SCOPES, rename: true })).body.error.scope, "lists");
  const sc = { ...DEFAULT_SCOPES, rename: true, lists: true };
  assert.deepEqual((await call(s, "PATCH", "/v1/lists/main", { name: "Home base" }, sc)).body, { list: { id: "main", name: "Home base" } });
  assert.equal((s.set().tmNames as Data).main, "Home base");
  await call(s, "PATCH", "/v1/lists/main", { name: "" }, sc);
  assert.equal((s.set().tmNames as Data).main, undefined);
  await call(s, "PATCH", "/v1/lists/work01", { name: "Office" }, sc);
  assert.equal((s.set().tmPages as { name: string }[])[0].name, "Office");
  assert.equal((await call(s, "PATCH", "/v1/lists/work01", { name: "  " }, sc)).body.error.field, "name");
  assert.equal((await call(s, "PATCH", "/v1/lists/inbox", { name: "Mine" }, sc)).status, 400);
  assert.equal((await call(s, "PATCH", "/v1/lists/zzzz11", { name: "x" }, sc)).status, 404);
  assert.deepEqual((await call(s, "PATCH", "/v1/sections/prio", { name: "This week" }, sc)).body, { section: { key: "prio", name: "This week" } });
  assert.equal((await call(s, "PATCH", "/v1/sections/g:errand1", { name: "Shops" }, sc)).body.section.name, "Shops");
  assert.equal((s.set().tmGroups as { name: string }[])[0].name, "Shops");
  assert.equal((await call(s, "PATCH", "/v1/sections/g%3Aerrand1", { name: "Shops 2" }, sc)).body.section.name, "Shops 2");
  assert.equal((await call(s, "PATCH", "/v1/sections/nope", { name: "x" }, sc)).status, 404);
  assert.equal((await call(s, "PATCH", "/v1/sections/prio", { name: "x", colour: 1 }, sc)).body.error.code, "unknown_field");
});

// ---------- robustness ----------
ok("a store that throws answers 500 with no task text", async () => {
  const s = world();
  s.update = async () => { throw new Error("secret task text"); };
  const r = await call(s, "PATCH", "/v1/tasks/ai1", { title: "x" }, { ...DEFAULT_SCOPES, edit: true });
  assert.equal(r.status, 500);
  assert.ok(!JSON.stringify(r.body).includes("secret"));
});
ok("the inbox fills up at 500 open tasks", async () => {
  const s = fake({ todos: Array.from({ length: 500 }, (_, i) => d(`i${i}`, i, { aiInbox: true, ai: true })) });
  assert.equal((await call(s, "POST", "/v1/tasks", { title: "one more" })).body.error.code, "inbox_full");
});
ok("inboxMove: to a list's first section that takes it, or a new To do group there", () => {
  const groups = [{ id: "errand1", name: "Errands" }];
  const lists = tabLists([d("a2", 3) as never], groups, T);
  const pages = [{ id: "work01", name: "Work", secs: ["g:errand1"] }, { id: "dd0001", name: "Streaks", secs: ["daily"] }, { id: "pp0001", name: "P", secs: [], kind: "panels" as const }];
  const full = ["p1", "prio", "daily", "g:errand1"];
  const ctx = { lists, full, pages, groups };
  assert.deepEqual(inboxMove({ type: "once" }, "main", ctx, () => "zz")!.patch, { group: null, order: 4, p1: false, unranked: false, aiInbox: false });
  assert.deepEqual(inboxMove({ type: "once" }, "work01", ctx, () => "zz")!.patch, { group: "errand1", order: 0, aiInbox: false });
  const made = inboxMove({ type: "once" }, "dd0001", ctx, () => "newg1")!;
  assert.deepEqual(made.patch, { group: "newg1", order: 0, aiInbox: false });
  assert.deepEqual(made.settings!.tmPages!.find((p) => p.id === "dd0001")!.secs, ["daily", "g:newg1"]);
  assert.equal(inboxMove({ type: "once" }, "pp0001", ctx, () => "zz"), null);
  assert.equal(inboxMove({ type: "once" }, "gone99", ctx, () => "zz"), null);
});

// ---------- Sentry mode: start only ----------
ok("Start Sentry mode: off by default, so refused and nothing runs", async () => {
  const s = world();
  const r = await call(s, "POST", "/v1/sentry/start");
  assert.equal(r.status, 403);
  assert.equal(r.body.error.scope, "sentry");
  assert.ok(!s.log.includes("sentry start"));
  assert.equal(SCOPES.find((x) => x.id === "sentry")!.label, "Start Sentry mode");
  assert.equal((await call(s, "POST", "/v1/sentry/start", undefined, { ...ALL, sentry: false })).body.error.scope, "sentry");
});
ok("Start Sentry mode: switched on, it starts exactly once and says it cannot be stopped here", async () => {
  const s = world();
  const sc = { ...DEFAULT_SCOPES, sentry: true };
  const r = await call(s, "POST", "/v1/sentry/start", undefined, sc);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.sentry.started, r.body.sentry.phase], [true, "covered"]);
  assert.match(r.body.sentry.note, /never stopped/);
  assert.deepEqual(s.log, ["sentry start"]);
  assert.equal((await call(s, "POST", "/v1/sentry/start", {}, sc)).status, 200);   // an empty object is fine
  s.sentryWill({ result: "already", phase: "locked" });
  const a = await call(s, "POST", "/v1/sentry/start", undefined, sc);
  assert.deepEqual([a.status, a.body.sentry.started, a.body.sentry.alreadyOn, a.body.sentry.phase], [200, false, true, "locked"]);
});
ok("Start Sentry mode: the button's checks failing means no start, with what to fix", async () => {
  const s = world();
  const sc = { ...DEFAULT_SCOPES, sentry: true };
  s.sentryWill({ result: "blocked", title: "The restart is not ready", lines: ["The restart helper is off."] });
  const b = await call(s, "POST", "/v1/sentry/start", undefined, sc);
  assert.deepEqual([b.status, b.body.error.code], [409, "sentry_checks"]);
  assert.deepEqual(b.body.error.lines, ["The restart helper is off."]);
  s.sentryWill({ result: "refused", note: "Sentry mode did not start: a protected app is in front." });
  assert.deepEqual(await call(s, "POST", "/v1/sentry/start", undefined, sc).then((r) => [r.status, r.body.error.code, r.body.error.message]), [409, "sentry_refused", "Sentry mode did not start: a protected app is in front."]);
  s.sentryWill({ result: "notStarted" });
  assert.equal((await call(s, "POST", "/v1/sentry/start", undefined, sc)).body.error.code, "sentry_refused");
  s.sentryWill({ result: "noAnswer" });
  assert.equal((await call(s, "POST", "/v1/sentry/start", undefined, sc)).status, 503);
  assert.equal((await call(fake({ locked: true }), "POST", "/v1/sentry/start", undefined, sc)).status, 423);
});
ok("Start Sentry mode takes no settings: any field or query is refused before anything runs", async () => {
  const s = world();
  const sc = { ...ALL, sentry: true };
  for (const b of [{ restartH: 0 }, { lid: false }, { stop: true }, { minutes: 5 }, "now", [1]]) {
    const r = await call(s, "POST", "/v1/sentry/start", b, sc);
    assert.equal(r.status, 400, JSON.stringify(b));
  }
  assert.equal((await call(s, "POST", "/v1/sentry/start", undefined, sc, { until: "10:00" })).status, 400);
  assert.ok(!s.log.includes("sentry start"));
});
ok("no route stops, pauses or changes Sentry mode: every other path and method is refused untouched", async () => {
  const s = world();
  const sc = { ...ALL, sentry: true };
  const paths = ["/v1/sentry", "/v1/sentry/stop", "/v1/sentry/end", "/v1/sentry/off", "/v1/sentry/pause", "/v1/sentry/leave", "/v1/sentry/unlock",
    "/v1/sentry/disable", "/v1/sentry/settings", "/v1/sentry/start/stop", "/v1/sentry/start/cancel", "/v1/sentry/stop/now", "/v1/sentries/stop"];
  for (const p of paths) for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
    const r = await call(s, m, p, {}, sc);
    assert.ok(r.status === 404 || r.status === 405, `${m} ${p}: ${r.status}`);
  }
  for (const m of ["GET", "PUT", "PATCH", "DELETE"]) assert.equal((await call(s, m, "/v1/sentry/start", undefined, sc)).status, 405, m);
  assert.deepEqual(s.log, [], "nothing ran, not even a start");
  const e = (await call(s, "DELETE", "/v1/sentry/start", undefined, sc)).body.error.message;
  assert.match(e, /never stopped/);
  // The API's store can only start it; GET /v1 lists one Sentry endpoint and it is a start.
  const list = (await call(s, "GET", "/v1")).body.endpoints.filter((x: string) => /sentry/i.test(x));
  assert.deepEqual(list, ["POST /v1/sentry/start"]);
});
ok("nowhere in the page code is there a message or store call that stops Sentry mode", () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = `${d}/${f}`; if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f)) files.push(p); } };
  walk(new URL("../src", import.meta.url).pathname);
  const sent = new Set<string>();
  for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/type:\s*"(sentry:[a-zA-Z]+)"/g)) sent.add(m[1]);
  const allowed = new Set(["sentry:start", "sentry:get", "sentry:lidCheck", "sentry:fileVault"]);   // none of them stops it
  assert.ok(sent.has("sentry:start"), "the scan found the start message");
  for (const x of sent) assert.ok(allowed.has(x), `unexpected Sentry message ${x}`);
  const api = readFileSync(new URL("../src/core/taskapi.ts", import.meta.url), "utf8") + readFileSync(new URL("../src/taskapi.ts", import.meta.url), "utf8");
  assert.ok(!/(stop|end|pause|leave|disengage|cancel)Sentry/i.test(api), "no stop in the API or its store");
});

// ---------- Copy for AI ----------
ok("Copy for AI: self explaining, every endpoint, the switches as they are, the key slot, no dashes", () => {
  const g = aiGuide({ scopes: { ...DEFAULT_SCOPES, delete: true }, today: T });
  assert.ok(g.includes("http://127.0.0.1:47836"));
  assert.ok(g.includes(KEY_SLOT));
  for (const e of ["GET /v1/lists", "GET /v1/tasks", "POST /v1/tasks", "PATCH /v1/tasks/{id}", "DELETE /v1/tasks/{id}", "/complete", "/reopen", "PUT /v1/tasks/{id}/reminder", "PATCH /v1/lists/{id}", "PATCH /v1/sections/{key}"])
    assert.ok(g.includes(e), e);
  assert.ok(g.includes("- delete: ON."));
  assert.ok(g.includes("- edit: OFF."));
  for (const c of ["401", "403 scope_off", "404", "409", "423", "429", "browser_blocked"]) assert.ok(g.includes(c), c);
  assert.ok(g.includes("AI Inbox"));
  assert.ok(g.includes("curl -s -X POST http://127.0.0.1:47836/v1/sentry/start"), "Sentry mode has its curl example");
  assert.ok(g.includes("It cannot be turned off through the API"), "and its one plain line");
  assert.ok(g.includes("- sentry: OFF."), "and its switch");
  assert.ok(!/[\u2013\u2014]/.test(g), "no en or em dashes");
  assert.ok(!/\bRed\b|Cincee/.test(g), "nothing personal");
});

for (const [name, fn] of tests) { await fn(); n++; console.log("ok -", name); }
console.log(`${n} passed`);

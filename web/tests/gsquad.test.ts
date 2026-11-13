// Run: node --experimental-strip-types tests/gsquad.test.ts
// G Squad core (V1.40): the squad key kept and re-keyed, invite hashing, request signatures, anonymise matching,
// and the opt-out gate (an opted out piece never reaches the hub writer). Names and clients are fictional.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../src/core/squadcrypto.ts";
import { cleanSquadRec, currentKey, openCard, planRekey, sealCard, takeDrop, withKey, type HubMember, type SquadRec } from "../src/core/squadrec.ts";
import { NEUTRAL_TITLE, clientTerms, namedClient, namesClient, shouldAsk, squadTitle } from "../src/core/squadanon.ts";
import { cleanShareOpts, planTaskSync, sealForSquad, shareOn, taskCopies, SHARE_PIECES } from "../src/core/squadshare.ts";
import { sha256hex } from "../src/core/crypto.ts";
import type { Doc, Todo } from "../src/core/model.ts";
import { cleanSquadOp, workingLine } from "../src/squad/view.ts";

let n = 0;
const tests: [string, () => Promise<void> | void][] = [];
const ok = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const SQ = "0b6f1a52-7c1d-4b0e-9a3c-1f2e3d4c5b6a";

async function member(id: string, me: string, keys: { gen: number; k: string }[]): Promise<SquadRec> {
  return { v: 1, squadId: SQ, memberId: id, me, keys, sign: await S.newSignPair(), box: await S.newBoxPair(), secret: S.newSecret(), joinedAt: new Date().toISOString() };
}
async function hubRow(r: SquadRec): Promise<HubMember> {
  const c = await sealCard(r, r.me);
  return { id: r.memberId, sign_pub: r.sign.pub, box_pub: r.box.pub, card_ct: c.ct, card_gen: c.gen, left_at: null };
}
// Marked Share with G Squad (V1.43: the only way a task is shared); the tests below are about shared tasks.
const todo = (id: string, data: Partial<Todo>): Doc<Todo> => ({ id, ws: null, kind: "todo", author: null, updatedAt: null,
  data: { title: "Task", type: "once", done: false, order: 0, sqOn: true, ...data } as Todo });
const CLIENTS = [
  { name: "Northwind Silk", contactName: "Odette Lind", greetingName: "Odette" },
  { name: "Example Co", contactName: null },
  { name: "Harbour Studio (HBS)", contactName: "Kit" },
];

// ---------- squad key: kept in the vault record, sealed, re-keyed ----------
ok("a squad key seals and opens only with the same aad", async () => {
  const k = await S.newSquadKey();
  const ct = await S.seal(k, { t: "Ship it" }, S.sqAad.task(SQ, "m", "t", 1));
  assert.deepEqual(await S.open(k, ct, S.sqAad.task(SQ, "m", "t", 1)), { t: "Ship it" });
  await assert.rejects(S.open(k, ct, S.sqAad.task(SQ, "other", "t", 1)), "a copy moved onto another member does not open");
  await assert.rejects(S.open(k, ct, S.sqAad.task(SQ, "m", "t", 2)), "a copy moved to another gen does not open");
  await assert.rejects(S.open(await S.newSquadKey(), ct, S.sqAad.task(SQ, "m", "t", 1)), "another key does not open it");
});
ok("the vault record is checked and keeps every gen in order", async () => {
  const r = await member(crypto.randomUUID(), "Sam", [{ gen: 1, k: await S.newSquadKey() }]);
  const back = cleanSquadRec(JSON.parse(JSON.stringify(r)));
  assert.ok(back);
  assert.equal(currentKey(back!).gen, 1);
  const r2 = withKey(withKey(back!, 3, await S.newSquadKey()), 2, await S.newSquadKey());
  assert.deepEqual(r2.keys.map((k) => k.gen), [1, 2, 3]);
  assert.equal(currentKey(r2).gen, 3);
  assert.equal(cleanSquadRec({ ...r, keys: [] }), null);
  assert.equal(cleanSquadRec({ ...r, squadId: "not-a-uuid" }), null);
});
ok("re-key: everyone still in gets the new key, the one who left cannot open it", async () => {
  const k1 = await S.newSquadKey();
  const [a, b, c] = await Promise.all([member(crypto.randomUUID(), "Alex", [{ gen: 1, k: k1 }]), member(crypto.randomUUID(), "Sam", [{ gen: 1, k: k1 }]), member(crypto.randomUUID(), "Kit", [{ gen: 1, k: k1 }])]);
  const rows = await Promise.all([a, b, c].map(hubRow));
  rows[2].left_at = new Date().toISOString();   // Kit left
  const plan = await planRekey(a, rows, "G Squad");
  assert.ok(plan);
  assert.equal(plan!.gen, 2);
  assert.deepEqual(plan!.drops.map((d) => d.member).sort(), [a.memberId, b.memberId].sort());
  const b2 = await takeDrop(b, 2, plan!.drops.find((d) => d.member === b.memberId)!.sealed);
  assert.equal(currentKey(b2).raw, plan!.raw);
  assert.deepEqual(await S.open(plan!.raw, plan!.meta, S.sqAad.meta(SQ, 2)), { n: "G Squad" });
  // Kit has no drop, and Sam's drop does not open with Kit's key or as Kit.
  await assert.rejects(takeDrop(c, 2, plan!.drops.find((d) => d.member === b.memberId)!.sealed));
  await assert.rejects(S.openKeyDrop(b.box.priv, plan!.drops.find((d) => d.member === b.memberId)!.sealed, S.sqAad.drop(SQ, a.memberId, 2)), "a drop handed to another member does not open");
  // New copies sealed with gen 2 do not open with gen 1 (all Kit holds).
  const ct = await S.seal(plan!.raw, { t: "x" }, S.sqAad.meta(SQ, 2));
  await assert.rejects(S.open(k1, ct, S.sqAad.meta(SQ, 2)));
});
ok("re-key refuses a member whose public key the hub swapped", async () => {
  const k1 = await S.newSquadKey();
  const [a, b] = await Promise.all([member(crypto.randomUUID(), "Alex", [{ gen: 1, k: k1 }]), member(crypto.randomUUID(), "Sam", [{ gen: 1, k: k1 }])]);
  const rows = await Promise.all([a, b].map(hubRow));
  rows[1].box_pub = (await S.newBoxPair()).pub;   // the hub's own key in place of Sam's
  assert.equal(await planRekey(a, rows, "G Squad"), null);
  const rows2 = await Promise.all([a, b].map(hubRow));
  rows2[1].card_ct = null;   // V1.49: no card yet = still getting in: left out (never sealed to), the hub agrees
  const p2 = await planRekey(a, rows2, "G Squad");
  assert.deepEqual(p2!.drops.map((d) => d.member), [a.memberId]);
  rows2[1].card_ct = "AAAA";   // a card that does not open: still refused (the hub may have swapped it)
  assert.equal(await planRekey(a, rows2, "G Squad"), null);
});
ok("a member card opens only for that member and gen", async () => {
  const k1 = await S.newSquadKey();
  const a = await member(crypto.randomUUID(), "Alex", [{ gen: 1, k: k1 }]);
  const c = await sealCard(a, "  Alex \u0007 Rivera  ");
  assert.equal((await openCard(a, a.memberId, c.ct, c.gen))?.n, "Alex Rivera");
  assert.equal(await openCard(a, crypto.randomUUID(), c.ct, c.gen), null);
  assert.equal(await openCard(a, a.memberId, c.ct, 2), null);
});

// ---------- invites ----------
ok("invite: the hub keeps only a hash of the token, and the token never opens the key", async () => {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const m = await S.squadInviteMaterial(secret);
  assert.equal(m.tokenHash, await sha256hex(m.token));
  assert.match(m.tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(m.token, Buffer.from(secret).toString("base64url"), "the token is not the secret");
  const raw = await S.newSquadKey(), inv = crypto.randomUUID();
  const wrapped = await S.wrapForInvite(m.wrap, raw, S.sqAad.invite(SQ, inv, 1));
  const again = await S.squadInviteMaterial(secret);
  assert.equal(again.tokenHash, m.tokenHash, "the same link gives the same hash");
  assert.equal(await S.unwrapInvite(again.wrap, wrapped, S.sqAad.invite(SQ, inv, 1)), raw);
  // Someone holding only the token (the hub at join time) cannot derive the wrapping key from it.
  const fromToken = await S.squadInviteMaterial(new Uint8Array(Buffer.from(m.token, "base64url")));
  await assert.rejects(S.unwrapInvite(fromToken.wrap, wrapped, S.sqAad.invite(SQ, inv, 1)));
  await assert.rejects(S.unwrapInvite(again.wrap, wrapped, S.sqAad.invite(SQ, crypto.randomUUID(), 1)), "bound to its invite id");
});
ok("invite links: the secret sits after the #, pasted text is read back", () => {
  const secret = crypto.getRandomValues(new Uint8Array(32)), id = crypto.randomUUID();
  const link = S.inviteLink("https://cincee.com/client/", id, secret);
  assert.ok(link.startsWith("https://cincee.com/client/gsquad#"));
  assert.ok(!link.split("#")[0].includes(Buffer.from(secret).toString("base64url")));
  const p = S.parseSquadInvite(`  join us: ${link}  `);
  assert.equal(p?.inviteId, id);
  assert.deepEqual([...p!.secret], [...secret]);
  assert.equal(S.parseSquadInvite("https://cincee.com/client/gsquad"), null);
  assert.equal(S.parseSquadInvite(`${id}.short`), null);
});
ok("request signatures cover the act, member, time, nonce and body", async () => {
  const kp = await S.newSignPair();
  const r = await S.signRequest(kp.priv, "beat", "m1", { a: 1 });
  assert.ok(await S.verifyRequest(kp.pub, r));
  assert.equal(await S.verifyRequest(kp.pub, { ...r, args: { a: 2 } }), false);
  assert.equal(await S.verifyRequest(kp.pub, { ...r, act: "leave" }), false);
  assert.equal(await S.verifyRequest(kp.pub, { ...r, member: "m2" }), false);
  assert.equal(await S.verifyRequest(kp.pub, { ...r, ts: r.ts + 1 }), false);
  assert.equal(await S.verifyRequest((await S.newSignPair()).pub, r), false);
});
ok("the hub function checks the same signed text", () => {
  const fn = readFileSync(new URL("../supabase/hub/functions/squad/index.ts", import.meta.url), "utf8");
  assert.ok(fn.includes("`gsquad-v1|${act}|${member}|${ts}|${nonce}|${bodyHash}`"));
  assert.ok(src("core/squadcrypto.ts").includes("`${V}|${act}|${member}|${ts}|${nonce}|${bodyHash}`"));
});
ok("task squad ids are stable per member and unlinkable to vault ids", async () => {
  const s1 = S.newSecret(), s2 = S.newSecret();
  const a = await S.taskSquadId(s1, "todo-1");
  assert.equal(a, await S.taskSquadId(s1, "todo-1"));
  assert.notEqual(a, await S.taskSquadId(s2, "todo-1"));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(!a.includes("todo"));
});

// ---------- anonymise ----------
ok("a task naming a client is found by name, word, contact or bracket", () => {
  const terms = clientTerms(CLIENTS);
  assert.equal(namedClient("Send Northwind Silk the draft", terms), "Northwind Silk");
  assert.equal(namedClient("northwind homepage", terms), "Northwind Silk");
  assert.equal(namedClient("Call Odette tomorrow", terms), "Northwind Silk");
  assert.equal(namedClient("Invoice example co", terms), "Example Co");
  assert.equal(namedClient("HBS moodboard", terms), "Harbour Studio (HBS)");
  assert.equal(namedClient("Call Kit about the logo", terms), "Harbour Studio (HBS)");
  assert.equal(namedClient("Café Nórthwind visit", terms), "Northwind Silk", "accents do not hide a name");
});
ok("generic and partial words never count", () => {
  const terms = clientTerms(CLIENTS);
  assert.equal(namedClient("Book the studio", terms), null, "Studio alone is generic");
  assert.equal(namedClient("Exam prep", terms), null, "part of a word is not the word");
  assert.equal(namedClient("Northwinds", terms), null, "whole words only");
  assert.equal(namedClient("Gym", terms), null);
  assert.equal(namedClient("Kitchen tidy", terms), null);
});
ok("the squad sees the neutral title until you say show the name; you keep the real one", () => {
  const terms = clientTerms(CLIENTS);
  const t = { title: "Send Northwind Silk the draft", clientId: null };
  assert.deepEqual(squadTitle(t, terms), { title: NEUTRAL_TITLE, anon: true }, "not asked yet: anonymised");
  assert.deepEqual(squadTitle({ ...t, sqAnon: true }, terms), { title: NEUTRAL_TITLE, anon: true });
  assert.deepEqual(squadTitle({ ...t, sqAnon: false }, terms), { title: t.title, anon: false });
  assert.deepEqual(squadTitle({ title: "Gym", clientId: "c1" }, terms), { title: NEUTRAL_TITLE, anon: true }, "linked to a client");
  assert.deepEqual(squadTitle({ title: "Gym" }, terms), { title: "Gym", anon: false });
  assert.ok(shouldAsk(t, terms));
  assert.ok(!shouldAsk({ ...t, sqAnon: false }, terms));
  assert.ok(!shouldAsk({ title: "Gym" }, terms));
  assert.ok(namesClient({ title: "x", clientId: "c" }, terms));
});
ok("client names are never sent: the matcher has no network or vault import", () => {
  const s = src("core/squadanon.ts");
  assert.ok(!/fetch\(|from "\.\/vault|squadcrypto|XMLHttpRequest/.test(s));
});

// ---------- opt-outs: never sealed, never sent ----------
const KEY = { raw: "", gen: 1 };
// Tasks switched on (V1.43: it starts off) unless a test says otherwise.
async function plan(todos: Doc<Todo>[], squadShare: Record<string, boolean> = { tasks: true }, have = new Map<string, string>()) {
  if (!KEY.raw) KEY.raw = await S.newSquadKey();
  return planTaskSync({ todos, settings: { squadShare }, clients: CLIENTS, squad: SQ, member: "m1", secret: SECRET, key: KEY, have });
}
const SECRET = S.newSecret();
ok("switches: on unless switched off, except Tasks (off unless switched on, V1.43); every piece has one", () => {
  assert.ok(!shareOn(undefined, "tasks"));
  assert.ok(shareOn({}, "working"));
  assert.ok(shareOn({ tasks: true }, "tasks"));
  assert.ok(!shareOn({ tasks: false }, "tasks"));
  assert.deepEqual(cleanShareOpts({ tasks: false, money: "no", nonsense: false }), { tasks: false });
  assert.deepEqual(SHARE_PIECES.map((p) => p.id).sort(), ["fitness", "money", "screen", "sleep", "tasks", "working"]);
  assert.ok(!SHARE_PIECES.some((p) => /private mode/i.test(p.label + p.line)), "never called Private mode");
});
ok("an opted out piece is never encrypted with the squad key", async () => {
  // A key that throws if anyone imports it: the gate must refuse before touching it.
  assert.equal(await sealForSquad({ tasks: false }, "tasks", { raw: "!!not-a-key!!", gen: 1 }, { t: "secret" }, "x"), null);
  assert.equal(await sealForSquad({ money: false }, "money", { raw: "!!not-a-key!!", gen: 1 }, { m: 1 }, "x"), null);
  assert.equal(await sealForSquad({}, "tasks", { raw: "!!not-a-key!!", gen: 1 }, { t: "x" }, "x"), null, "Tasks never set: off, the key is not touched");
  await assert.rejects(sealForSquad({ tasks: true }, "tasks", { raw: "!!not-a-key!!", gen: 1 }, { t: "x" }, "x"), "switched on it does use the key");
});
ok("tasks switched off: nothing reaches the hub writer, and what the hub had is taken away", async () => {
  const todos = [todo("a", { title: "Write the plan" }), todo("b", { title: "Gym", type: "daily" })];
  const on = await plan(todos);
  assert.equal(on.put.length, 2);
  // What a writer would receive (the hub's rows) when Tasks is off.
  const have = new Map(on.put.map((r) => [r.id, r.fp]));
  const sent: unknown[] = [];
  const off = await plan(todos, { tasks: false }, have);
  sent.push(...off.put);
  assert.deepEqual(sent, [], "no sealed copy at all");
  assert.deepEqual(off.del.sort(), [...have.keys()].sort(), "the hub's copies are deleted (a delete carries no content)");
  assert.equal(taskCopies(todos, { squadShare: { tasks: false } }, CLIENTS).length, 0);
});
ok("a task marked Not shared never reaches the hub writer", async () => {
  const todos = [todo("a", { title: "Write the plan" }), todo("s", { title: "Secret salary talk", sqOff: true })];
  const p = await plan(todos);
  assert.equal(p.put.length, 1);
  for (const r of p.put) {
    const copy = await S.open<{ t: string }>(KEY.raw, r.ct, S.sqAad.task(SQ, "m1", r.id, 1));
    assert.notEqual(copy.t, "Secret salary talk");
  }
  assert.ok(!JSON.stringify(p).includes("salary"));
  const sid = await S.taskSquadId(SECRET, "s");
  const later = await plan(todos, undefined, new Map([[sid, "old"]]));
  assert.deepEqual(later.del, [sid], "switching a shared task to Not shared deletes the squad copy");
});
ok("the squad copy holds only title, priority, date and done; client names stay home", async () => {
  const todos = [todo("c", { title: "Send Northwind Silk the draft", due: "2026-11-09", p1: true, notes: "Odette's number is 555", clientId: null }),
    todo("d", { title: "Reply to Example Co", sqAnon: false, order: 2 }), todo("e", { title: "Plan week", unranked: true, order: 3 })];
  const p = await plan(todos);
  const copies = await Promise.all(p.put.map((r) => S.open<Record<string, unknown>>(KEY.raw, r.ct, S.sqAad.task(SQ, "m1", r.id, 1))));
  for (const c of copies) assert.deepEqual(Object.keys(c).filter((k) => !["t", "p", "d", "x", "xa", "e", "a"].includes(k)), []);
  assert.ok(copies.some((c) => c.t === NEUTRAL_TITLE && c.p === 1 && c.d === "2026-11-09" && c.a === true));
  assert.ok(copies.some((c) => c.t === "Reply to Example Co" && c.p === 2), "shown by choice");
  assert.ok(copies.some((c) => c.t === "Plan week" && c.p === null));
  assert.ok(!JSON.stringify(copies).includes("Northwind") && !JSON.stringify(copies).includes("555"));
});
ok("change only: an unchanged task is not sent again; a change is", async () => {
  const todos = [todo("a", { title: "Write the plan" })];
  const first = await plan(todos);
  const have = new Map(first.put.map((r) => [r.id, r.fp]));
  assert.equal((await plan(todos, undefined, have)).put.length, 0);
  assert.equal((await plan([todo("a", { title: "Write the plan", done: true, doneAt: new Date().toISOString() })], undefined, have)).put.length, 1);
});
ok("cleared, old done and example tasks are left out", () => {
  const old = new Date(Date.now() - 9 * 864e5).toISOString();
  const list = taskCopies([todo("a", { clearedAt: old }), todo("b", { done: true, doneAt: old }), todo("c", { example: true } as Partial<Todo>), todo("d", { title: "Keep" })], { squadShare: { tasks: true } }, CLIENTS);
  assert.deepEqual(list.map((x) => x.copy.t), ["Keep"]);
});
ok("the hub writer only takes sealed rows, and every push goes through planTaskSync", () => {
  const hub = src("squad/hub.ts"), engine = src("squad/engine.ts");
  assert.ok(/putTasks\(rows: TaskRow\[\]/.test(hub));
  assert.ok(!/encryptJson|seal\(/.test(hub), "the transport never seals anything itself");
  assert.ok(/planTaskSync\(/.test(engine));
  assert.ok(!/\bseal\(/.test(engine.replace(/sealCard|sealForSquad|sealKeyTo/g, "")), "the engine seals only through the gate or for cards and keys");
});
ok("working status switched off: no heartbeat", () => {
  const engine = src("squad/engine.ts");
  assert.ok(/shareOn\([^)]*"working"\)/.test(engine));
});

// ---------- the Tab list side ----------
ok("the hover says working, never online", () => {
  assert.equal(workingLine(2), "2 people are working right now");
  assert.equal(workingLine(1), "1 person is working right now");
  assert.equal(workingLine(0), "Nobody is working right now");
  for (const f of ["squad/view.ts", "views/GSquad.tsx", "views/GSquadTask.tsx", "core/squadshare.ts"]) {
    const code = src(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");   // comments may say "online" to forbid it
    const words = [...code.matchAll(/"([^"\n]*)"|`([^`\n]*)`|>([^<{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3]).join("\n");
    assert.ok(!/\bonline\b/i.test(words), `${f} says "online" somewhere a person reads`);
  }
});
ok("what the Tab list may ask is checked field by field", () => {
  const id = "0b6f1a52-7c1d-4b0e-9a3c-1f2e3d4c5b6a";
  assert.deepEqual(cleanSquadOp({ op: "share", piece: "tasks", on: false }), { op: "share", piece: "tasks", on: false });
  assert.equal(cleanSquadOp({ op: "share", piece: "everything", on: false }), null);
  assert.equal(cleanSquadOp({ op: "share", piece: "tasks", on: "no" }), null);
  assert.deepEqual(cleanSquadOp({ op: "hand", id: "todo-1234", to: id.toUpperCase() }), { op: "hand", id: "todo-1234", to: id });
  assert.equal(cleanSquadOp({ op: "hand", id: "x", to: id }), null);
  assert.equal(cleanSquadOp({ op: "remove", member: "nope" }), null);
  assert.deepEqual(cleanSquadOp({ op: "task", id: "todo-1234", sqAnon: null }), { op: "task", id: "todo-1234", sqAnon: null });
  assert.equal(cleanSquadOp({ op: "task", id: "todo-1234" }), null, "a task op must change something");
  assert.equal(cleanSquadOp({ op: "join", link: "   " }), null);
  assert.equal((cleanSquadOp({ op: "create", name: "x".repeat(99), me: "A\u0000B" }) as { name: string; me: string }).name.length, 40);
  assert.equal(cleanSquadOp({ op: "drop_table" }), null);
});
ok("the button and every switch show on every account in PS, never behind a the developer gate", () => {
  const tm = src("views/TaskMap.tsx");
  assert.match(tm, /\{\(\(PS && !docked\) \|\| web\) && (?:<Slot id="gsquad">)?<GSquadButton \/>(?:<\/Slot>)?\}/);   // V1.44: and the website's To-do page   // inside its Edit mode Slot after the V1.40 merge
  const g = src("views/GSquad.tsx");
  assert.ok(!/\bred\b|isRedAccount/.test(g), "no the developer gate in the pop-up");
  // V1.47: the switches live in views/GSquadSettings.tsx (Squad settings, What you share) and on the join screen.
  const st = src("views/GSquadSettings.tsx");
  assert.match(st, /SHARE_PIECES/);
  assert.ok(!/\bred\b|isRedAccount/.test(st), "no the developer gate in Squad settings");
  assert.match(g, /<SharingList \/>/, "the join screen shows every switch too");
});
ok("only the page that holds the vault runs the engine: PS's main page and the phone, never the website or the Tab list", () => {
  assert.match(src("ps.ts"), /startSquad\(psPost\);/);   // V1.42: the poster for the "asked to join" card
  assert.match(src("gos/bridge.ts"), /startSquad\(\);/);
  assert.ok(!/startSquad/.test(src("App.tsx")) && !/startSquad/.test(src("views/TaskMap.tsx")));
  assert.match(src("squad/engine.ts"), /s\.userId === "ps-overlay"/);
});
ok("the squad record (keys) never goes to the Tab list", () => {
  const ps = src("ps.ts");
  const docsFilter = ps.slice(ps.indexOf("const docs = s.status === \"unlocked\""), ps.indexOf("if (cal) docs.push(cal);"));
  assert.ok(docsFilter.length > 100);
  assert.ok(!docsFilter.includes("\"squad\""), "kind squad is not mirrored");
});
ok("the hub and the phone may be reached by the page; the website does not need it", () => {
  assert.match(readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8"), /connect-src 'self' \$\{SB\} \$\{SB\.replace\("https", "wss"\)\} \$\{SQUAD_HUB\}/);
});

for (const [name, fn] of tests) { await fn(); n++; console.log("ok -", name); }
console.log(`\n${n} passed`);

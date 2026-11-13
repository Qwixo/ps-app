// Run: node --experimental-strip-types tests/localfirst-gate.test.ts
// Turn on sync from end to end, the deciding part (src/core/movegate.ts): the local vault on this device moving into
// the account that is opening, with every way it can go wrong. The developer, 8 Nov 2026: "make sure they don't lose their data
// is the important part". Each test checks the same three things at the end:
//   1. the local records are byte for byte what they were (nothing local is ever changed or deleted),
//   2. the head says "moved" only after a verified move, and is back at "local" after Back,
//   3. the account never gets a record twice, and nothing in it that the move did not write is touched.
import assert from "node:assert/strict";
import * as C from "../src/core/crypto.ts";
import { openLocalVault, readHead, rowsKey, outKey, updateHead, type LocalHead, type Row } from "../src/core/localstore.ts";
import type { Payload } from "../src/core/move.ts";
import { moveIntoAccount, type GateChoice, type GateDeps, type GateView } from "../src/core/movegate.ts";
import { fakeServer, localHashes, memHolder, seedLocal, serverHashes, type FakeServer } from "./localfirst-fakes.ts";

let n = 0;
const tests: [string, () => Promise<void>][] = [];
const ok = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);
const PROJECT = "abcdefghijklmnopqrst";

/** A local vault waiting to move (the person chose Turn on sync), the gate's deps over it, and a script of answers. */
async function setup(count: number, o: { unreadable?: string[]; answers?: GateChoice[] } = {}) {
  const seed = await seedLocal(count, { unreadable: o.unreadable });
  await updateHead(seed.kv, (h) => ({ ...h, syncIntent: "2026-11-09T00:00:00.000Z" }));
  const localBefore = JSON.stringify([seed.kv.m.get(rowsKey(seed.head)), seed.kv.m.get(outKey(seed.head))]);
  const answers = [...(o.answers ?? [])];
  const seen: GateView[] = [];
  let allows = 0, failUpdateTo: string | null = null;
  const deps: GateDeps = {
    open: () => openLocalVault(seed.kv, [seed.kc, seed.dev]),
    rows: async (h) => { const { loadLocalRows } = await import("../src/core/localstore.ts"); return loadLocalRows(seed.kv, h); },
    update: (fn) => updateHead(seed.kv, (h) => { const x = fn(h); if (failUpdateTo && x.state === failUpdateTo) { failUpdateTo = null; throw new Error("disk full"); } return x; }),
    ask: async (v) => { seen.push(v); const a = answers.shift(); if (!a) throw new Error(`no answer scripted for ${v.phase}`); return a; },
    show: (v) => { if (v.phase !== "running") seen.push(v); },
    allow: async () => { allows++; seed.kc.mode = "ok"; },
    decrypt: (vk, r: Row) => C.decryptJson<Payload>(vk, r.ct, C.aad.record(r.id, r.workspace_id)),
    project: PROJECT,
    now: () => "2026-11-09T12:00:00.000Z",
    batch: 50,
  };
  const now = async () => (await readHead(seed.kv))!;
  const localSame = () => JSON.stringify([seed.kv.m.get(rowsKey(seed.head)), seed.kv.m.get(outKey(seed.head))]) === localBefore;
  return { ...seed, deps, seen, answers, now, localSame, allows: () => allows, failNextUpdateTo: (s: string) => { failUpdateTo = s; } };
}
const phases = (v: GateView[]) => v.map((x) => x.phase);
async function sameAsLocal(t: Awaited<ReturnType<typeof setup>>, s: FakeServer) {
  const l = await localHashes(t.kv, t.head, t.vk);
  const r = await serverHashes(s);
  for (const [id, h] of l) assert.equal(r.get(id), h, `record ${id} arrived intact`);
}

// ---------- the happy path ----------
ok("a new account: everything moves, is verified, and only then does the head say moved", async () => {
  const t = await setup(240);
  const s = await fakeServer();
  const r = await moveIntoAccount(t.deps, { target: s, userId: "u1", fresh: true });
  assert.equal(r.kind, "moved");
  assert.equal(r.kind === "moved" && r.count, 240);
  const h = await t.now();
  assert.equal(h.state, "moved");
  assert.equal(h.move?.verified?.count, 240, "the journal holds the verified count");
  assert.equal(h.syncIntent, null);
  assert.equal(s.rowsSent, 240, "each record sent exactly once");
  assert.ok(t.localSame(), "the local copy is untouched");
  await sameAsLocal(t, s);
  assert.deepEqual(phases(t.seen), [], "no question asked into a brand new account");
});

ok("nothing waiting: the gate stands aside (no local vault, or one that already moved)", async () => {
  const t = await setup(3);
  await updateHead(t.kv, (h) => ({ ...h, state: "moved" }));
  const s = await fakeServer();
  assert.equal((await moveIntoAccount(t.deps, { target: s, userId: "u1", fresh: true })).kind, "none");
  assert.equal(s.rowsSent, 0);
  const empty = { ...t.deps, open: async () => ({ status: "none" as const }) };
  assert.equal((await moveIntoAccount(empty, { target: s, userId: "u1", fresh: true })).kind, "none");
});

// ---------- failures ----------
ok("the connection drops mid move: nothing switches over; Try again finishes it and sends nothing twice", async () => {
  const t = await setup(300, { answers: ["retry"] });
  const s = await fakeServer();
  s.failAtBatch = 3;   // the third batch never arrives
  const r = await moveIntoAccount(t.deps, { target: s, userId: "u1", fresh: true });
  assert.deepEqual(phases(t.seen), ["failed"]);
  const f = t.seen[0] as Extract<GateView, { phase: "failed" }>;
  assert.equal(f.code, "offline");
  assert.match(f.message, /safe on this device/);
  assert.equal(r.kind, "moved");
  assert.equal(s.rowsSent, 300, "the two batches that arrived before the drop were not sent again");
  assert.equal((await t.now()).state, "moved");
  assert.ok(t.localSame());
  await sameAsLocal(t, s);
});

ok("a failure then Back: the person is exactly where they were, and a later try carries on without doubles", async () => {
  const t = await setup(200, { answers: ["back"] });
  const s = await fakeServer();
  s.failAtBatch = 2;
  const r = await moveIntoAccount(t.deps, { target: s, userId: "u1", fresh: true });
  assert.equal(r.kind, "back");
  const h = await t.now();
  assert.equal(h.state, "local", "back to the data on this device");
  assert.equal(h.syncIntent, null);
  assert.equal(h.snoozedFor, PROJECT, "not asked again for this project until Turn on sync");
  assert.ok(h.move && !h.move.verified, "the journal is kept, never marked verified");
  assert.ok(t.localSame());
  const sentBefore = s.rowsSent;
  // Later: Turn on sync again into the same account (not fresh now, it holds the first batch). Same account and project
  // as the journal: no question, carries on.
  await updateHead(t.kv, (x) => ({ ...x, syncIntent: "2026-11-10T00:00:00.000Z", snoozedFor: null }));
  s.failAtBatch = undefined;
  const r2 = await moveIntoAccount(t.deps, { target: s, userId: "u1", fresh: false });
  assert.equal(r2.kind, "moved");
  assert.equal(s.rowsSent - sentBefore, 200 - sentBefore, "only what had not arrived was sent");
  assert.ok(t.localSame());
  await sameAsLocal(t, s);
});

ok("PS quits mid move (no error path runs): the next start carries on from the journal into the same account", async () => {
  const t = await setup(260);
  const s = await fakeServer();
  // The save after the second batch is where the Mac "dies": the move stops there and nothing else runs.
  let saves = 0;
  const dying: GateDeps = { ...t.deps, update: async (fn) => { const h = await updateHead(t.kv, fn); if (h.move && ++saves === 4) throw new Error("killed"); return h; },
    ask: async () => { throw new Error("killed"); } };
  await assert.rejects(moveIntoAccount(dying, { target: s, userId: "u1", fresh: true }), /killed/);
  assert.equal((await t.now()).state, "moving", "a stopped move is still a move: next start signs in and carries on");
  const sent = s.rowsSent;
  const r = await moveIntoAccount(t.deps, { target: s, userId: "u1", fresh: false });
  assert.equal(r.kind, "moved");
  assert.deepEqual(phases(t.seen), [], "its own account: no question");
  assert.equal(s.rowsSent - sent, 260 - sent, "nothing that arrived before the crash is sent again");
  assert.ok(t.localSame());
  await sameAsLocal(t, s);
});

ok("a record the server keeps getting wrong: the move fails verified, never says moved; once fixed, Try again finishes", async () => {
  const t = await setup(30, { answers: ["retry"] });
  const s = await fakeServer();
  s.corruptAlways = new Set(["r000007"]);
  let fails = 0;
  t.deps.ask = async (v) => { t.seen.push(v); fails++; assert.equal((await t.now()).state, "moving", "never moved while a record is wrong"); s.corruptAlways = undefined; return "retry"; };
  const r = await moveIntoAccount(t.deps, { target: s, userId: "u1", fresh: true });
  assert.equal(fails, 1);
  assert.equal((t.seen[0] as Extract<GateView, { phase: "failed" }>).code, "verify");
  assert.equal(r.kind, "moved");
  await sameAsLocal(t, s);
  assert.ok(t.localSame());
});

ok("the final write fails (disk full): not moved, Try again finishes from what already arrived", async () => {
  const t = await setup(40, { answers: ["retry"] });
  const s = await fakeServer();
  t.failNextUpdateTo("moved");
  const r = await moveIntoAccount(t.deps, { target: s, userId: "u1", fresh: true });
  assert.deepEqual(phases(t.seen), ["failed"]);
  assert.equal(r.kind, "moved");
  assert.equal(s.rowsSent, 40, "the second try found everything there and sent nothing");
  assert.equal((await t.now()).state, "moved");
});

ok("an unreadable local record stops the move before anything is sent; Move the rest keeps it in the local copy", async () => {
  const t = await setup(20, { unreadable: ["r000004"], answers: ["rest"] });
  const s = await fakeServer();
  const r = await moveIntoAccount(t.deps, { target: s, userId: "u1", fresh: true });
  const f = t.seen[0] as Extract<GateView, { phase: "failed" }>;
  assert.equal(f.unreadable, true);
  assert.equal(r.kind, "moved");
  assert.equal(r.kind === "moved" && r.count, 19);
  assert.ok(!s.db.has("r000004"), "the unreadable one was not sent");
  assert.ok((t.kv.m.get(rowsKey(t.head)) as Record<string, Row>)["r000004"], "and it is still in the local copy");
  assert.ok(t.localSame());
});

// ---------- questions ----------
ok("an account that already holds records: asked first; Not now sends nothing and changes nothing", async () => {
  const t = await setup(15, { answers: ["back"] });
  const s = await fakeServer();
  s.db.set("theirs", { id: "theirs", workspace_id: null, author_id: "u1", ct: await C.encryptJson(s.vk, { kind: "todo", data: { title: "made on the other Mac" } }, C.aad.record("theirs", null)), deleted: false, updated_at: "x" });
  const before = JSON.stringify([...s.db]);
  const r = await moveIntoAccount(t.deps, { target: s, userId: "u1", fresh: false });
  assert.equal(r.kind, "back");
  const q = t.seen[0] as Extract<GateView, { phase: "confirm" }>;
  assert.equal(q.phase, "confirm");
  assert.equal(q.count, 15); assert.equal(q.existing, 1);
  assert.equal(JSON.stringify([...s.db]), before, "the account is exactly as it was");
  assert.equal((await t.now()).state, "local");
  assert.ok(t.localSame());
});

ok("Move my data into an account with records: theirs are kept, ours join them", async () => {
  const t = await setup(15, { answers: ["start"] });
  const s = await fakeServer();
  const theirs = await C.encryptJson(s.vk, { kind: "todo", data: { title: "made on the other Mac" } }, C.aad.record("theirs", null));
  s.db.set("theirs", { id: "theirs", workspace_id: null, author_id: "u1", ct: theirs, deleted: false, updated_at: "x" });
  const r = await moveIntoAccount(t.deps, { target: s, userId: "u1", fresh: false });
  assert.equal(r.kind, "moved");
  assert.equal(s.db.get("theirs")!.ct, theirs, "the record the move did not write is untouched");
  assert.equal(s.db.size, 16);
  await sameAsLocal(t, s);
});

ok("a journal for another account never continues there by itself: it asks again", async () => {
  const t = await setup(10, { answers: ["back", "start"] });
  const s = await fakeServer();
  s.failAtBatch = 1;
  t.answers.splice(0, 2, "back");
  await moveIntoAccount(t.deps, { target: s, userId: "u1", fresh: true });   // fails, Back: journal names u1
  await updateHead(t.kv, (x) => ({ ...x, syncIntent: "y", snoozedFor: null }));
  s.failAtBatch = undefined;
  const other = await fakeServer();
  other.db.set("x", { id: "x", workspace_id: null, author_id: "u2", ct: "zz", deleted: false, updated_at: "x" });
  t.answers.push("back");
  const r = await moveIntoAccount(t.deps, { target: other, userId: "u2", fresh: false });
  assert.equal(r.kind, "back");
  assert.equal(t.seen.at(-1)!.phase, "confirm", "u2 is a different account: the person is asked");
  assert.equal(other.rowsSent, 0);
});

// ---------- the key ----------
ok("a key that needs Allow (a new PS build): asked, Allow, then the move runs", async () => {
  const t = await setup(12, { answers: ["allow"] });
  t.kc.mode = "denied"; t.dev.mode = "unavailable";
  const s = await fakeServer();
  const r = await moveIntoAccount(t.deps, { target: s, userId: "u1", fresh: true });
  assert.deepEqual(phases(t.seen), ["key"]);
  assert.equal((t.seen[0] as Extract<GateView, { phase: "key" }>).denied, true);
  assert.equal(t.allows(), 1);
  assert.equal(r.kind, "moved");
});

ok("a key that cannot be found: Back, nothing sent, nothing reset, the vault still opens once the key is back", async () => {
  const t = await setup(12, { answers: ["back"] });
  const kc = t.kc.key, dev = t.dev.key;
  t.kc.key = null; t.dev.key = null;
  t.kc.mode = "ok"; t.dev.mode = "ok";
  const s = await fakeServer();
  // A holder that lost its key must NOT get a new one while the vault cannot be opened (that would orphan the data).
  const r = await moveIntoAccount(t.deps, { target: s, userId: "u1", fresh: true });
  assert.equal(r.kind, "back");
  assert.equal((t.seen[0] as Extract<GateView, { phase: "key" }>).denied, false);
  assert.equal(s.rowsSent, 0);
  assert.equal(t.kc.creates + t.dev.creates, 2, "only the two keys made at Start now");
  t.kc.key = kc; t.dev.key = dev;
  assert.equal((await openLocalVault(t.kv, [t.kc, t.dev])).status, "ok");
  assert.ok(t.localSame());
});

for (const [name, fn] of tests) { await fn(); n++; console.log("ok -", name); }
console.log(`\nlocalfirst-gate: ${n} passed`);

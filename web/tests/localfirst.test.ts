// Run: node --experimental-strip-types tests/localfirst.test.ts
// Local first (V1.44): the local vault (core/localstore.ts), its key holders, the move into a synced vault
// (core/move.ts) and the backup file (core/backup.ts). Fakes only: an in memory store, in memory key holders and an in
// memory "server" that can drop the connection, lose an answer, refuse a row, corrupt or drop a record.
import assert from "node:assert/strict";
import * as C from "../src/core/crypto.ts";
import {
  createLocalVault, discardLocalBackup, localCommit, loadLocalRows, nudgeDue, openLocalVault, readHead, rowsKey, outKey, updateHead,
  type HolderGet, type KeyHolder, type KV, type LocalHead, type MoveJournal, type Row,
} from "../src/core/localstore.ts";
import { MoveError, hashPayload, newJournal, runMove, stableJson, type MoveTarget, type Payload } from "../src/core/move.ts";
import { makeBackup, openBackup, planImport } from "../src/core/backup.ts";

let n = 0;
const tests: [string, () => Promise<void>][] = [];
const ok = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

// ---------- fakes ----------
function memKV(): KV & { m: Map<string, unknown>; writes: number } {
  const m = new Map<string, unknown>();
  const copy = (v: unknown) => { try { return structuredClone(v); } catch { return v; } };
  const kv = {
    m, writes: 0,
    async get<T>(k: string) { return copy(m.get(k)) as T | undefined; },
    async set(k: string, v: unknown) { kv.writes++; m.set(k, copy(v)); },
    async setMany(e: [string, unknown][]) { kv.writes++; for (const [k, v] of e) m.set(k, copy(v)); },
    async del(k: string) { kv.writes++; m.delete(k); },
  };
  return kv;
}
type MemHolder = KeyHolder & { key: CryptoKey | null; mode: "ok" | "denied" | "unavailable"; creates: number; asked: number; fakeSave?: boolean };
function memHolder(name: KeyHolder["name"]): MemHolder {
  const h: MemHolder = {
    name, key: null, mode: "ok", creates: 0, asked: 0,
    async get(): Promise<HolderGet> {
      if (h.mode === "unavailable") return { status: "unavailable" };
      if (!h.key) return { status: "missing" };
      if (h.mode === "denied") return { status: "denied" };
      return { status: "ok", kek: h.key };
    },
    async create() {
      h.asked++;
      if (h.key) throw new Error("a key is already there");
      h.creates++;
      const k = await C.newAesKey();
      if (!h.fakeSave) h.key = k;
      return k;
    },
    async forget() { h.key = null; },
  };
  return h;
}
const snapshot = (kv: ReturnType<typeof memKV>) => stableJson([...kv.m.entries()].filter(([k]) => k !== "nothing").map(([k, v]) => [k, v]));

/** A local vault with `count` records, written the way the vault engine writes them (encryptJson, record AAD). */
async function seedLocal(count: number, opts: { outboxDeletes?: string[]; unreadable?: string[] } = {}) {
  const kv = memKV(), kc = memHolder("keychain"), dev = memHolder("device");
  const { head, vk } = await createLocalVault(kv, [kc, dev], "Sam");
  const rows: Record<string, Row> = {};
  for (let i = 0; i < count; i++) {
    const id = `r${String(i).padStart(6, "0")}`;
    const kind = i === 0 ? "settings" : "todo";
    const data = i === 0 ? { ownerName: "Sam", theme: "dark" } : { title: `Task ${i}`, done: i % 3 === 0, order: i, nested: { b: 2, a: [1, { z: 1, y: 2 }] } };
    rows[id] = { id, workspace_id: null, author_id: "local-x", ct: await C.encryptJson(vk, { kind, data }, C.aad.record(id, null)), deleted: false, updated_at: "2026-11-08T00:00:00.000Z" };
  }
  for (const id of opts.unreadable ?? []) rows[id] = { ...rows[id], ct: rows[id].ct.slice(0, -8) + "AAAAAAAA" };
  await kv.set(rowsKey(head), rows);
  const out: Record<string, Row> = {};
  for (const id of opts.outboxDeletes ?? []) out[id] = { ...rows[id], deleted: true };
  await kv.set(outKey(head), out);
  return { kv, kc, dev, head, vk };
}
const localSource = async (kv: KV, head: LocalHead, vk: CryptoKey) => ({
  rows: await loadLocalRows(kv, head),
  decrypt: (r: Row) => C.decryptJson<Payload>(vk, r.ct, C.aad.record(r.id, r.workspace_id)),
});

class NetErr extends Error { constructor() { super("Failed to fetch"); } }
interface FakeServer extends MoveTarget {
  db: Map<string, Row>; upserts: number; rowsSent: number; batches: number; vk: CryptoKey;
  failAtBatch?: number; loseAnswerAtBatch?: number; refuse?: Set<string>; corruptOnce?: Set<string>; corruptAlways?: Set<string>;
  dropOnce?: Set<string>; badEncrypt?: Set<string>;
}
async function fakeServer(): Promise<FakeServer> {
  const vk = await C.newAesKey();
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 9, 0, 0, 0, ++clock)).toISOString();
  const s: FakeServer = {
    db: new Map(), upserts: 0, rowsSent: 0, batches: 0, vk,
    async stamps() { return [...s.db.values()].map((r) => ({ id: r.id, deleted: r.deleted })); },
    async fetch(ids) { return ids.map((id) => s.db.get(id)).filter((r): r is Row => !!r).map((r) => ({ ...r })); },
    async upsert(list) {
      s.batches++;
      if (s.failAtBatch === s.batches) throw new NetErr();
      for (const x of list) if (s.refuse?.has(x.id)) { const e = new Error("new row violates row-level security policy") as Error & { code: string }; e.code = "42501"; throw e; }
      s.upserts++;
      const out: Row[] = [];
      for (const x of list) {
        s.rowsSent++;
        let ct = x.ct;
        if (s.corruptOnce?.delete(x.id) || s.corruptAlways?.has(x.id)) ct = ct.slice(0, -8) + "BBBBBBBB";
        const row: Row = { id: x.id, workspace_id: null, author_id: "u1", ct, deleted: x.deleted, updated_at: stamp() };
        if (!s.dropOnce?.delete(x.id)) s.db.set(x.id, row);
        out.push({ ...row, ct: x.ct });
      }
      if (s.loseAnswerAtBatch === s.batches) throw new NetErr();   // stored, but the answer never came back
      return out;
    },
    async encrypt(id, p) { if (s.badEncrypt?.has(id)) throw new TypeError("Do not know how to serialize a BigInt"); return C.encryptJson(vk, p, C.aad.record(id, null)); },
    async decrypt(r) { if (r.workspace_id) throw new Error("not ours"); return C.decryptJson<Payload>(vk, r.ct, C.aad.record(r.id, r.workspace_id)); },
    isNetworkError: (e) => e instanceof NetErr,
  };
  return s;
}
function journalStore(target = { project: "abcdefghijklmnopqrst", userId: "u1" }) {
  const box = { j: newJournal(target, "2026-11-09T00:00:00.000Z") as MoveJournal, saves: 0, history: [] as MoveJournal[] };
  return { box, save: async (j: MoveJournal) => { box.j = structuredClone(j); box.saves++; box.history.push(structuredClone(j)); } };
}
async function serverHashes(s: FakeServer) {
  const m = new Map<string, string>();
  for (const r of s.db.values()) if (!r.deleted) m.set(r.id, await hashPayload(await s.decrypt(r)));
  return m;
}
async function localHashes(kv: KV, head: LocalHead, vk: CryptoKey) {
  const m = new Map<string, string>();
  for (const r of await loadLocalRows(kv, head)) m.set(r.id, await hashPayload(await C.decryptJson<Payload>(vk, r.ct, C.aad.record(r.id, null))));
  return m;
}

// ---------- the local vault and its keys ----------
ok("Start now makes a vault that opens again from storage, and never writes over one", async () => {
  const kv = memKV(), kc = memHolder("keychain"), dev = memHolder("device");
  const { head, vk } = await createLocalVault(kv, [kc, dev], "  Sam\u0007 ");
  assert.equal(head.name, "Sam");
  assert.deepEqual(Object.keys(head.wraps).sort(), ["device", "keychain"]);
  assert.equal(vk.extractable, false, "the vault key in memory cannot be exported");
  const again = await openLocalVault(kv, [kc, dev]);
  assert.equal(again.status, "ok");
  await assert.rejects(createLocalVault(kv, [kc, dev], "Other"), /already data on this device/);
  assert.equal((await readHead(kv))!.id, head.id, "the first vault is still there");
  // Nothing in storage is the key itself: only wraps and a check value.
  assert.ok(!JSON.stringify(await readHead(kv)).includes("kek"));
});

ok("one holder losing its key is repaired from the other, never a new vault key", async () => {
  const { kv, kc, dev, head, vk } = await seedLocal(3);
  const before = await localHashes(kv, head, vk);
  kc.key = null;                                         // the Keychain item is gone (say, a reinstall)
  const r = await openLocalVault(kv, [kc, dev]);
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.equal(r.by, "device");
  assert.deepEqual(r.repaired, ["keychain"]);
  assert.equal(kc.creates, 2, "a new Keychain key only because the old one was missing");
  assert.deepEqual(await localHashes(kv, head, r.vk), before, "the same vault key: every record still opens");
  dev.key = null;                                        // now the browser key is gone; the repaired Keychain opens it
  const r2 = await openLocalVault(kv, [kc, dev]);
  assert.equal(r2.status, "ok");
  if (r2.status === "ok") assert.equal(r2.by, "keychain");
});

ok("a holder that is there but denied is never asked to make a key, even when another one opens the vault", async () => {
  const { kv, kc, dev, head } = await seedLocal(2);
  const wrapBefore = (await readHead(kv))!.wraps.device;
  const keyBefore = dev.key;
  dev.mode = "denied"; kc.asked = 0; dev.asked = 0;
  const r = await openLocalVault(kv, [kc, dev]);
  assert.equal(r.status, "ok");
  assert.equal(dev.asked, 0, "no create call at all");
  assert.equal(dev.key, keyBefore);
  assert.equal((await readHead(kv))!.wraps.device, wrapBefore, "its wrap is left as it was");
  assert.equal((await readHead(kv))!.id, head.id);
});

ok("a denied or lost key leaves everything exactly as it was", async () => {
  const { kv, kc, dev } = await seedLocal(5);
  const before = snapshot(kv);
  kc.mode = "denied"; dev.mode = "unavailable";
  const d = await openLocalVault(kv, [kc, dev]);
  assert.equal(d.status, "denied");
  assert.equal(snapshot(kv), before);
  kc.mode = "ok"; kc.key = await C.newAesKey(); dev.mode = "ok"; dev.key = await C.newAesKey();   // both keys replaced by someone
  const l = await openLocalVault(kv, [kc, dev]);
  assert.equal(l.status, "lost");
  assert.equal(snapshot(kv), before, "nothing deleted or reset on a lost key");
  assert.equal(kc.creates + dev.creates, 2, "no holder was asked to make a new key over an existing one");
});

ok("a holder that only seems to keep its key stops Start now before anything is saved", async () => {
  const kv = memKV(), kc = memHolder("keychain");
  kc.fakeSave = true;
  await assert.rejects(createLocalVault(kv, [kc], "Sam"), /could not keep a key safe/);
  assert.equal(await readHead(kv), undefined, "no half made vault left behind");
  const none = memHolder("device"); none.mode = "unavailable";
  await assert.rejects(createLocalVault(kv, [none], "Sam"), /could not keep a key safe/);
});

ok("the local save commits the outbox like the server would, deletes leave the device", async () => {
  const rows = new Map<string, Row>([["a", { id: "a", workspace_id: null, author_id: "u", ct: "x", deleted: false, updated_at: "t0" }]]);
  const out = new Map<string, Row>([
    ["a", { id: "a", workspace_id: null, author_id: null, ct: "x2", deleted: false, updated_at: "t0" }],
    ["b", { id: "b", workspace_id: null, author_id: null, ct: "y", deleted: false, updated_at: null }],
    ["c", { id: "c", workspace_id: null, author_id: null, ct: "z", deleted: true, updated_at: null }],
  ]);
  const r = localCommit(rows, out, "t1", "local-1");
  assert.deepEqual([...r.rows.keys()].sort(), ["a", "b"]);
  assert.equal(r.rows.get("a")!.ct, "x2");
  assert.equal(r.rows.get("b")!.updated_at, "t1");
  assert.equal(r.rows.get("b")!.author_id, "local-1");
  assert.equal(rows.get("a")!.ct, "x", "the old map is not changed in place");
  assert.deepEqual(r.committed.sort(), ["a", "b", "c"]);
});

// ---------- the move ----------
ok("a large move (5,000 records) arrives complete, verified, once each, local copy untouched", async () => {
  const { kv, head, vk } = await seedLocal(5000);
  const before = snapshot(kv);
  const s = await fakeServer();
  const js = journalStore();
  const phases = new Set<string>();
  const r = await runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save, progress: (p) => phases.add(p.phase) });
  assert.equal(r.count, 5000);
  assert.equal(s.db.size, 5000);
  assert.deepEqual(await serverHashes(s), await localHashes(kv, head, vk), "every record's content matches");
  assert.equal(s.rowsSent, 5000, "each record sent exactly once");
  assert.equal(js.box.j.verified?.count, 5000);
  assert.equal(js.box.j.verified?.digest, r.digest);
  assert.equal(snapshot(kv), before, "the local copy was only read");
  assert.deepEqual([...phases].sort(), ["check", "done", "read", "send", "verify"]);
  assert.equal(r.rows.length, 5000, "the engine starts with the verified rows: nothing downloaded twice");
});

ok("an interrupted move carries on where it stopped and sends nothing twice", async () => {
  const { kv, head, vk } = await seedLocal(1000);
  const before = snapshot(kv);
  const s = await fakeServer();
  s.failAtBatch = 4;                                   // the connection drops on the 4th batch
  const js = journalStore();
  const e = await runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save }).catch((x) => x);
  assert.ok(e instanceof MoveError && e.code === "offline", String(e));
  assert.equal(js.box.j.verified, null, "not verified: nothing switches over");
  assert.equal(Object.keys(js.box.j.sent).length, 300, "the journal knows the 3 batches that arrived");
  assert.equal(js.box.j.lastError?.code, "offline");
  assert.equal(snapshot(kv), before);
  s.failAtBatch = undefined; s.rowsSent = 0;
  const r = await runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save });
  assert.equal(r.count, 1000);
  assert.equal(s.rowsSent, 700, "only the rest was sent");
  assert.equal(s.db.size, 1000);
  assert.deepEqual(await serverHashes(s), await localHashes(kv, head, vk));
  assert.equal(js.box.j.attempts, 2);
});

ok("a move killed mid way (no error path runs) resumes from the journal saved after each batch", async () => {
  const { kv, head, vk } = await seedLocal(1000);
  const s = await fakeServer();
  s.failAtBatch = 6;
  const js = journalStore();
  await assert.rejects(runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save }));
  // The app was killed instead: only what was saved BEFORE the failing batch exists (the error's own save never ran).
  const beforeCrash = js.box.history[js.box.history.length - 2];
  assert.equal(Object.keys(beforeCrash.sent).length, 500, "saved after each of the 5 batches that arrived");
  s.failAtBatch = undefined; s.rowsSent = 0;
  const j2 = journalStore(); j2.box.j = beforeCrash;
  const r = await runMove({ source: await localSource(kv, head, vk), target: s, journal: j2.box.j, save: j2.save });
  assert.equal(r.count, 1000);
  assert.equal(s.rowsSent, 500, "the rest only");
  assert.equal(s.db.size, 1000);
});

ok("a batch the server stored but whose answer was lost is not sent again and never doubles", async () => {
  const { kv, head, vk } = await seedLocal(250);
  const s = await fakeServer();
  s.loseAnswerAtBatch = 2;
  const js = journalStore();
  await assert.rejects(runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save }), (x: unknown) => x instanceof MoveError && x.code === "offline");
  assert.equal(Object.keys(js.box.j.sent).length, 100, "the lost answer's batch is not in the journal");
  s.loseAnswerAtBatch = undefined; s.rowsSent = 0;
  await runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save });
  assert.equal(s.rowsSent, 50, "the stored batch was recognised by its hash and skipped");
  assert.equal(s.db.size, 250);
});

ok("a record that fails to encrypt fails the move after the rest arrived; a retry finishes it", async () => {
  const { kv, head, vk } = await seedLocal(120);
  const before = snapshot(kv);
  const s = await fakeServer();
  s.badEncrypt = new Set(["r000042"]);
  const js = journalStore();
  const e = await runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save }).catch((x) => x);
  assert.ok(e instanceof MoveError && e.code === "failed");
  assert.deepEqual((e as MoveError).failed, ["r000042"]);
  assert.ok(!(e as MoveError).message.includes("Task"), "the error names no content");
  assert.equal(js.box.j.verified, null);
  assert.equal(s.db.size, 119);
  assert.equal(snapshot(kv), before);
  s.badEncrypt = undefined; s.rowsSent = 0;
  const r = await runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save });
  assert.equal(r.count, 120);
  assert.equal(s.rowsSent, 1);
});

ok("a row the server refuses fails the move; the others still arrive", async () => {
  const { kv, head, vk } = await seedLocal(30);
  const s = await fakeServer();
  s.refuse = new Set(["r000007"]);
  const js = journalStore();
  const e = await runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save }).catch((x) => x);
  assert.ok(e instanceof MoveError && e.code === "failed");
  assert.deepEqual((e as MoveError).failed, ["r000007"]);
  assert.equal(s.db.size, 29);
  assert.equal(js.box.j.verified, null);
});

ok("running the move twice changes nothing the second time (no duplicates)", async () => {
  const { kv, head, vk } = await seedLocal(300);
  const s = await fakeServer();
  const js = journalStore();
  await runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save });
  const ids = [...s.db.keys()].sort();
  s.rowsSent = 0;
  const r = await runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save });
  assert.equal(s.rowsSent, 0);
  assert.deepEqual([...s.db.keys()].sort(), ids);
  assert.equal(r.count, 300);
  // A fresh journal (say, after the app lost it) still makes no duplicates: same ids, hashes match.
  const js2 = journalStore();
  await runMove({ source: await localSource(kv, head, vk), target: s, journal: js2.box.j, save: js2.save });
  assert.equal(s.rowsSent, 0);
  assert.equal(s.db.size, 300);
});

ok("verification catches a record the server changed or dropped, resends it once, and fails if it stays wrong", async () => {
  const { kv, head, vk } = await seedLocal(80);
  const s = await fakeServer();
  s.corruptOnce = new Set(["r000010"]); s.dropOnce = new Set(["r000020"]);
  const js = journalStore();
  const r = await runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save });
  assert.equal(r.count, 80);
  assert.equal(s.rowsSent, 82, "the two bad ones were sent once more");
  assert.deepEqual(await serverHashes(s), await localHashes(kv, head, vk));

  const t = await seedLocal(40);
  const s2 = await fakeServer();
  s2.corruptAlways = new Set(["r000005"]);
  const js2 = journalStore();
  const e = await runMove({ source: await localSource(t.kv, t.head, t.vk), target: s2, journal: js2.box.j, save: js2.save }).catch((x) => x);
  assert.ok(e instanceof MoveError && e.code === "verify");
  assert.deepEqual((e as MoveError).failed, ["r000005"]);
  assert.equal(js2.box.j.verified, null, "never marked done");
});

ok("a local record this device cannot read stops the move before anything is sent, unless the person chose so", async () => {
  const { kv, head, vk } = await seedLocal(20, { unreadable: ["r000003"] });
  const s = await fakeServer();
  const js = journalStore();
  const e = await runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save }).catch((x) => x);
  assert.ok(e instanceof MoveError && e.code === "unreadable");
  assert.equal(s.upserts, 0, "nothing sent");
  const r = await runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save, allowUnreadable: true });
  assert.equal(r.count, 19);
  assert.deepEqual(r.unreadable, ["r000003"]);
  assert.ok((await loadLocalRows(kv, head)).some((x) => x.id === "r000003"), "it stays in the local copy");
});

ok("unsaved local changes move too, and records deleted locally after a partial move are deleted there", async () => {
  const { kv, head, vk } = await seedLocal(150, { outboxDeletes: ["r000002"] });
  const s = await fakeServer();
  s.failAtBatch = 2;
  const js = journalStore();
  await assert.rejects(runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save }));
  assert.ok(!s.db.has("r000002"), "a local delete waiting in the outbox does not move");
  assert.ok(s.db.has("r000050"));
  // Back in local mode the person deletes r000050, then tries again.
  const rows = (await kv.get<Record<string, Row>>(rowsKey(head)))!;
  delete rows.r000050;
  await kv.set(rowsKey(head), rows);
  s.failAtBatch = undefined;
  const r = await runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save });
  assert.equal(r.count, 148);
  assert.equal(s.db.get("r000050")?.deleted, true, "deleted there too");
  assert.equal([...s.db.values()].filter((x) => !x.deleted).length, 148);
});

ok("records already in the synced vault that the move did not write are never touched", async () => {
  const { kv, head, vk } = await seedLocal(10);
  const s = await fakeServer();
  await s.upsert([{ id: "theirs", workspace_id: null, ct: await s.encrypt("theirs", { kind: "todo", data: { title: "on another Mac" } }), deleted: false }]);
  const was = structuredClone(s.db.get("theirs"));
  const js = journalStore();
  const r = await runMove({ source: await localSource(kv, head, vk), target: s, journal: js.box.j, save: js.save });
  assert.equal(r.count, 10);
  assert.deepEqual(s.db.get("theirs"), was);
  assert.equal(s.db.size, 11);
  assert.ok(r.rows.some((x) => x.id === "theirs"), "handed to the engine with the rest");
});

ok("the local copy can only be removed after a verified move and the person's confirm", async () => {
  const { kv, kc, dev, head } = await seedLocal(5);
  await assert.rejects(discardLocalBackup(kv, [kc, dev], true), /stays until/);
  await updateHead(kv, (h) => ({ ...h, state: "moving", move: { ...newJournal({ project: "p", userId: "u" }, "t"), verified: null } }));
  await assert.rejects(discardLocalBackup(kv, [kc, dev], true), /stays until/);
  await updateHead(kv, (h) => ({ ...h, state: "moved", move: { ...h.move!, verified: { at: "t", count: 5, digest: "d" } } }));
  await assert.rejects(discardLocalBackup(kv, [kc, dev], false), /Confirm/);
  assert.ok(await kv.get(rowsKey(head)));
  await discardLocalBackup(kv, [kc, dev], true);
  assert.equal(await readHead(kv), undefined);
  assert.equal(await kv.get(rowsKey(head)), undefined);
  assert.equal(kc.key, null);
});

// ---------- the backup file ----------
ok("backup: saves and opens with the passphrase, refuses a wrong one and a changed file", async () => {
  const recs = [{ id: "a", kind: "todo", data: { title: "One" } }, { id: "s", kind: "settings", data: { theme: "dark" } }];
  const pass = "orbit velvet canyon lantern marble";
  const text = await makeBackup(recs, pass, { name: "Sam", iters: 2000 });
  assert.ok(!text.includes("One") && !text.includes("Sam") && !text.includes("dark"), "nothing readable outside");
  const back = await openBackup(text, pass);
  assert.deepEqual(back.records.map((r) => r.id), ["a", "s"]);
  assert.equal(back.name, "Sam");
  await assert.rejects(openBackup(text, "orbit velvet canyon lantern marblf"), /Wrong passphrase/);
  const f = JSON.parse(text); f.ct = f.ct.slice(0, -6) + "AAAAAA";
  await assert.rejects(openBackup(JSON.stringify(f), pass), /Wrong passphrase|damaged/);
  await assert.rejects(openBackup("{}", pass), /not a PS app backup/);
  await assert.rejects(makeBackup(recs, "short"), /stronger passphrase/);
});

ok("backup import adds what is missing, keeps this device's other versions, folds settings in", async () => {
  const file = [
    { id: "a", kind: "todo", data: { title: "One" } },
    { id: "b", kind: "todo", data: { title: "Two" } },
    { id: "c", kind: "todo", data: { title: "Three, older" } },
    { id: "s1", kind: "settings", data: { theme: "dark", dimx: { a: 1 } } },
  ];
  const have = new Map<string, { kind: string; data: unknown }>([
    ["a", { kind: "todo", data: { title: "One" } }],
    ["c", { kind: "todo", data: { title: "Three, newer" } }],
  ]);
  const p = planImport(file, have, { id: "s0", data: { ownerName: "Sam", theme: "light" } });
  assert.deepEqual(p.add.map((r) => r.id), ["b"]);
  assert.equal(p.same, 1); assert.equal(p.kept, 1);
  assert.deepEqual(p.settings, { id: "s0", data: { ownerName: "Sam", theme: "dark", dimx: { a: 1 } } });
});

ok("Export my data: one JSON of { id, kind, data } for every kind, the same record shape as the ps-health export", async () => {
  const kinds = ["todo", "settings", "fwork", "fsleep", "fact", "squad", "tzperson", "note"];
  const recs = kinds.map((kind, i) => ({ id: `id${i}`, kind, data: { n: i, nested: { k: kind } } }));
  const file = await makeBackup(recs, "correct horse battery staple 42", { name: "Sam", iters: 1000 });
  const outer = JSON.parse(file);
  assert.deepEqual(Object.keys(outer).sort(), ["ct", "format", "kdf", "v"], "outside the encryption: only what it is and how the key was made");
  const back = await openBackup(file, "correct horse battery staple 42");
  assert.deepEqual(back.records.map((r) => r.kind).sort(), [...kinds].sort(), "every kind is in the one file");
  for (const r of back.records) assert.deepEqual(Object.keys(r).sort(), ["data", "id", "kind"]);
});

ok("the reminder card: after a week, not again for a month after Not now", async () => {
  const now = Date.parse("2026-11-20T00:00:00Z");
  assert.equal(nudgeDue("2026-11-15T00:00:00Z", null, now), false);
  assert.equal(nudgeDue("2026-11-10T00:00:00Z", null, now), true);
  assert.equal(nudgeDue("2026-11-10T00:00:00Z", "2026-11-19T00:00:00Z", now), false);
  assert.equal(nudgeDue("2026-10-01T00:00:00Z", "2026-10-10T00:00:00Z", now), true);
  assert.equal(nudgeDue("nonsense", null, now), false);
});

ok("stable hashes: key order never matters, content does", async () => {
  assert.equal(stableJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } }), stableJson({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }));
  assert.notEqual(await hashPayload({ kind: "todo", data: { a: 1 } }), await hashPayload({ kind: "todo", data: { a: 2 } }));
});

for (const [name, fn] of tests) { await fn(); n++; console.log("ok -", name); }
console.log(`\n${n} passed`);

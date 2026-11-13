// Shared fakes for the local first tests (tests/localfirst-gate.test.ts): an in memory store, in memory key holders,
// a seeded local vault and an in memory "server" that can drop the connection, lose an answer, refuse a row, corrupt or
// drop a record. The same as the ones inside tests/localfirst.test.ts.
import * as C from "../src/core/crypto.ts";
import {
  createLocalVault, loadLocalRows, rowsKey, outKey,
  type HolderGet, type KeyHolder, type KV, type LocalHead, type MoveJournal, type Row,
} from "../src/core/localstore.ts";
import { hashPayload, newJournal, stableJson, type MoveTarget, type Payload } from "../src/core/move.ts";

// ---------- fakes ----------
export function memKV(): KV & { m: Map<string, unknown>; writes: number } {
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
export type MemHolder = KeyHolder & { key: CryptoKey | null; mode: "ok" | "denied" | "unavailable"; creates: number; asked: number; fakeSave?: boolean };
export function memHolder(name: KeyHolder["name"]): MemHolder {
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
export const snapshot = (kv: ReturnType<typeof memKV>) => stableJson([...kv.m.entries()].filter(([k]) => k !== "nothing").map(([k, v]) => [k, v]));

/** A local vault with `count` records, written the way the vault engine writes them (encryptJson, record AAD). */
export async function seedLocal(count: number, opts: { outboxDeletes?: string[]; unreadable?: string[] } = {}) {
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
export const localSource = async (kv: KV, head: LocalHead, vk: CryptoKey) => ({
  rows: await loadLocalRows(kv, head),
  decrypt: (r: Row) => C.decryptJson<Payload>(vk, r.ct, C.aad.record(r.id, r.workspace_id)),
});

export class NetErr extends Error { constructor() { super("Failed to fetch"); } }
export interface FakeServer extends MoveTarget {
  db: Map<string, Row>; upserts: number; rowsSent: number; batches: number; vk: CryptoKey;
  failAtBatch?: number; loseAnswerAtBatch?: number; refuse?: Set<string>; corruptOnce?: Set<string>; corruptAlways?: Set<string>;
  dropOnce?: Set<string>; badEncrypt?: Set<string>;
}
export async function fakeServer(): Promise<FakeServer> {
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
export function journalStore(target = { project: "abcdefghijklmnopqrst", userId: "u1" }) {
  const box = { j: newJournal(target, "2026-11-09T00:00:00.000Z") as MoveJournal, saves: 0, history: [] as MoveJournal[] };
  return { box, save: async (j: MoveJournal) => { box.j = structuredClone(j); box.saves++; box.history.push(structuredClone(j)); } };
}
export async function serverHashes(s: FakeServer) {
  const m = new Map<string, string>();
  for (const r of s.db.values()) if (!r.deleted) m.set(r.id, await hashPayload(await s.decrypt(r)));
  return m;
}
export async function localHashes(kv: KV, head: LocalHead, vk: CryptoKey) {
  const m = new Map<string, string>();
  for (const r of await loadLocalRows(kv, head)) m.set(r.id, await hashPayload(await C.decryptJson<Payload>(vk, r.ct, C.aad.record(r.id, null))));
  return m;
}


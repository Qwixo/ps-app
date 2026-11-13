// Turn on sync (V1.44): moves every record of the local vault (core/localstore.ts) into the person's new synced vault,
// encrypted with that vault's key, checks that every one arrived, and only then says "done". The most important code
// of local first: the developer, 8 Nov 2026, "make sure they don't lose their data is the important part".
//
// What it guarantees (tests/localfirst.test.ts proves each one with fakes):
// - The local copy is only ever READ here. Nothing local is changed or deleted, on success or on any error.
// - Same record ids in the synced vault, written as upserts by id: running it twice, or again after a failure, can
//   never make a second copy of anything. What already arrived intact (same content hash) is not sent again.
// - Progress is written to a journal after every batch, before the next one starts, so a move cut off at any point (app
//   closed, Mac asleep, offline, a lost answer) carries on where it stopped. The journal names the target account and
//   project; a move never continues into another account.
// - Done means verified: every record is read back from the server, decrypted with the synced vault's key and its
//   content hash compared with the local one. The count must match exactly. Anything missing, changed, deleted or not
//   readable is sent once more and checked again; if it still is not right the move fails and nothing switches over.
// - A record that cannot be encrypted, or that the server refuses, fails the move (with its id, never its content) after
//   the rest went through, so a retry has little left to do. A local record this device cannot read itself fails the
//   move before anything is sent, unless the person chose to move the rest anyway (the unreadable one stays in the
//   local copy, which is kept).
// - Records the move wrote earlier that were deleted locally since (the person went back to local mode between two
//   tries) are deleted in the synced vault again. Nothing the move did not write is ever touched there.
import * as C from "./crypto.ts";
import type { MoveJournal, Row } from "./localstore.ts";

export interface Payload { kind: string; data: unknown }
export interface MoveSource { rows: Row[]; decrypt(r: Row): Promise<Payload> }
export interface MoveTarget {
  /** Every record id in the synced vault, with whether it is deleted (no content). */
  stamps(): Promise<{ id: string; deleted: boolean }[]>;
  /** The full rows for these ids (rows not found are left out). */
  fetch(ids: string[]): Promise<Row[]>;
  /** Upsert by id. Answers the stored rows. */
  upsert(rows: { id: string; workspace_id: null; ct: string; deleted: boolean }[]): Promise<Row[]>;
  encrypt(id: string, p: Payload): Promise<string>;
  decrypt(r: Row): Promise<Payload>;
  isNetworkError(e: unknown): boolean;
}
export type MovePhase = "read" | "check" | "send" | "verify" | "done";
export interface MoveProgress { phase: MovePhase; done: number; total: number }
export type MoveCode = "unreadable" | "offline" | "failed" | "verify" | "target";

export class MoveError extends Error {
  code: MoveCode; failed: string[]; retry: boolean;
  constructor(code: MoveCode, message: string, failed: string[] = [], retry = true) { super(message); this.code = code; this.failed = failed; this.retry = retry; }
}
export interface MoveResult {
  /** Every row of the synced vault the move saw (the verified ones and the ones that were there before), so the vault
   *  engine starts with them and downloads nothing twice (egress). */
  rows: Row[];
  count: number;
  unreadable: string[];
  digest: string;
}

/** JSON with the keys of every object in sorted order: the same content always gives the same text. */
export function stableJson(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, norm(o[k])]));
    }
    return x;
  };
  return JSON.stringify(norm(JSON.parse(JSON.stringify(v ?? null))));
}
export const hashPayload = (p: Payload) => C.sha256hex(stableJson({ kind: p.kind, data: p.data }));

export function newJournal(target: { project: string; userId: string }, nowIso: string): MoveJournal {
  return { v: 1, target, startedAt: nowIso, attempts: 0, map: {}, sent: {}, lastError: null, verified: null };
}

function chunks<T>(a: T[], n: number): T[][] { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; }

export async function runMove(o: {
  source: MoveSource; target: MoveTarget; journal: MoveJournal; save: (j: MoveJournal) => Promise<void>;
  progress?: (p: MoveProgress) => void; batch?: number; allowUnreadable?: boolean; now?: () => string;
}): Promise<MoveResult> {
  const { source, target } = o;
  const B = Math.max(1, Math.min(200, o.batch ?? 100));
  const now = o.now ?? (() => new Date().toISOString());
  const j: MoveJournal = structuredClone(o.journal);
  j.attempts += 1; j.lastError = null; j.verified = null;
  const say = (phase: MovePhase, done: number, total: number) => { try { o.progress?.({ phase, done, total }); } catch { /* the screen only */ } };
  const fail = async (e: MoveError) => {
    j.lastError = { at: now(), code: e.code, message: e.message, failed: e.failed.slice(0, 200) };
    try { await o.save(j); } catch { /* the error itself still reaches the person */ }
    return e;
  };
  const offline = (e: unknown) => target.isNetworkError(e);
  try {
    // 1. Read the local copy (read only).
    type Item = { id: string; payload: Payload; hash: string };
    const items: Item[] = [], unreadable: string[] = [], skipped: string[] = [];
    let n = 0;
    for (const r of source.rows) {
      say("read", n++, source.rows.length);
      if (r.deleted) continue;
      if (r.workspace_id !== null) { skipped.push(r.id); continue; }   // never made in local mode: kept locally, not moved
      let p: Payload;
      try { p = await source.decrypt(r); } catch { unreadable.push(r.id); continue; }
      if (!p || typeof p.kind !== "string") { unreadable.push(r.id); continue; }
      if (p.kind === "_deleted") continue;
      items.push({ id: r.id, payload: { kind: p.kind, data: p.data }, hash: await hashPayload(p) });
    }
    if (skipped.length) throw await fail(new MoveError("failed", `${skipped.length} record${skipped.length === 1 ? "" : "s"} on this device belong to a client space and cannot move yet.`, skipped, false));
    if (unreadable.length && !o.allowUnreadable) {
      throw await fail(new MoveError("unreadable", `${unreadable.length} record${unreadable.length === 1 ? "" : "s"} on this device could not be read. Nothing was moved yet. You can move the rest; the unreadable ${unreadable.length === 1 ? "one stays" : "ones stay"} in the copy kept on this device.`, unreadable));
    }
    const plan = new Map(items.map((it) => [it.id, it]));
    for (const it of items) j.map[it.id] = it.id;
    await o.save(j);   // the target is bound before anything is sent

    // 2. What the synced vault holds already (ids first, then the content of only what matters).
    say("check", 0, 1);
    const stamps = await target.stamps();
    const live = new Map(stamps.map((s) => [s.id, s]));
    const have = new Map<string, Row>();      // every live target row we fetched
    const haveHash = new Map<string, string>();
    const wantIds = stamps.filter((s) => !s.deleted).map((s) => s.id);
    for (const part of chunks(wantIds, B)) {
      for (const r of await target.fetch(part)) {
        have.set(r.id, r);
        if (!plan.has(r.id)) continue;
        try { haveHash.set(r.id, await hashPayload(await target.decrypt(r))); } catch { /* sent again below */ }
      }
    }
    say("check", 1, 1);

    // 3. Send what is not there intact yet, batch by batch, the journal saved after each.
    const send = items.filter((it) => haveHash.get(it.id) !== it.hash || live.get(it.id)?.deleted);
    // Earlier moves' records that are gone locally now: delete them there too (only ones the move itself wrote).
    const orphans = Object.keys(j.sent).filter((id) => !plan.has(id) && live.has(id) && !live.get(id)!.deleted);
    const failed: string[] = [];
    let sentCount = 0;
    const total = send.length + orphans.length;
    const put = async (list: { id: string; ct: string; deleted: boolean; hash: string | null }[]) => {
      if (!list.length) return;
      const body = list.map((x) => ({ id: x.id, workspace_id: null as null, ct: x.ct, deleted: x.deleted }));
      let back: Row[] = [];
      try { back = await target.upsert(body); }
      catch (e) {
        if (offline(e)) throw e;
        for (const x of body) {   // one bad row must not stop the rest
          try { back.push(...await target.upsert([x])); }
          catch (e2) { if (offline(e2)) throw e2; failed.push(x.id); }
        }
      }
      const got = new Set(back.map((r) => r.id));
      for (const x of list) {
        if (!got.has(x.id)) { if (!failed.includes(x.id)) failed.push(x.id); continue; }
        if (x.deleted) delete j.sent[x.id]; else j.sent[x.id] = x.hash!;
      }
      for (const r of back) have.set(r.id, { ...r, ct: list.find((x) => x.id === r.id)?.ct ?? r.ct });
      await o.save(j);
    };
    for (const part of chunks(send, B)) {
      const list: { id: string; ct: string; deleted: boolean; hash: string | null }[] = [];
      for (const it of part) {
        try { list.push({ id: it.id, ct: await target.encrypt(it.id, it.payload), deleted: false, hash: it.hash }); }
        catch { failed.push(it.id); }
      }
      await put(list);
      sentCount += part.length;
      say("send", sentCount, total);
    }
    for (const part of chunks(orphans, B)) {
      const list: { id: string; ct: string; deleted: boolean; hash: string | null }[] = [];
      for (const id of part) {
        try { list.push({ id, ct: await target.encrypt(id, { kind: "_deleted", data: null }), deleted: true, hash: null }); }
        catch { failed.push(id); }
      }
      await put(list);
      sentCount += part.length;
      say("send", sentCount, total);
    }

    // 4. Verify: read back every planned record and compare hashes; resend what is wrong once, then check again.
    const check = async (ids: string[]): Promise<string[]> => {
      const bad = new Set(ids);
      let done = 0;
      for (const part of chunks(ids, B)) {
        for (const r of await target.fetch(part)) {
          const it = plan.get(r.id);
          if (!it || r.deleted || r.workspace_id !== null) continue;
          try { if ((await hashPayload(await target.decrypt(r))) === it.hash) { bad.delete(r.id); have.set(r.id, r); } } catch { /* stays bad */ }
        }
        done += part.length;
        say("verify", done, ids.length);
      }
      return [...bad];
    };
    let bad = await check(items.map((it) => it.id).filter((id) => !failed.includes(id)));
    if (bad.length) {
      for (const id of bad) delete j.sent[id];
      for (const part of chunks(bad.map((id) => plan.get(id)!), B)) {
        const list: { id: string; ct: string; deleted: boolean; hash: string | null }[] = [];
        for (const it of part) {
          try { list.push({ id: it.id, ct: await target.encrypt(it.id, it.payload), deleted: false, hash: it.hash }); }
          catch { failed.push(it.id); }
        }
        await put(list);
      }
      bad = await check(bad.filter((id) => !failed.includes(id)));
    }
    const wrong = [...new Set([...failed, ...bad])];
    if (wrong.length) {
      throw await fail(new MoveError(bad.length && !failed.length ? "verify" : "failed",
        `${wrong.length} of ${items.length} record${items.length === 1 ? "" : "s"} did not arrive correctly. Your data is safe on this device. Try again.`, wrong));
    }
    // The orphans must be gone (deleted) as well.
    if (orphans.length) {
      const still = (await target.fetch(orphans)).filter((r) => !r.deleted).map((r) => r.id);
      if (still.length) throw await fail(new MoveError("verify", "Some old copies could not be removed from your synced data. Try again.", still));
    }

    // 5. Verified: the exact count and every hash. Only now may the app switch over.
    const digest = await C.sha256hex(items.map((it) => `${it.id}:${it.hash}`).join("\n"));
    j.verified = { at: now(), count: items.length, digest };
    await o.save(j);
    say("done", items.length, items.length);
    return { rows: [...have.values()], count: items.length, unreadable, digest };
  } catch (e) {
    if (e instanceof MoveError) throw e;
    if (offline(e)) throw await fail(new MoveError("offline", "The connection dropped. Everything is safe on this device, and the move carries on where it stopped when you try again."));
    throw await fail(new MoveError("failed", `The move stopped: ${String((e as Error)?.message || e).slice(0, 160)}. Your data is safe on this device. Try again.`));
  }
}

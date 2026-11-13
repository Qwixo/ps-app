// Local first (V1.44, the developer 8 Nov 2026: "new people should get in instantly with no database... once they do connect a
// database, they don't suddenly lose all their data"). A new person taps Start now with only a name: no Supabase, no
// password. This file is the local vault's own small part, kept apart from core/vault.ts so it can be tested on its own.
//
// How it holds together:
// - One strong random vault key (AES-256-GCM, the same kind as a normal vault key) encrypts every record exactly as on
//   the server: same record format, same AAD (record id and scope), through the same vault code paths (vault.ts put,
//   remove, docs). There is no second data model: the local vault is a vault whose "server" is this device.
// - The vault key itself is never stored. It is WRAPPED by one or more "key holders", each a key kept by the device:
//   the macOS Keychain (Mac), the Android Keystore (phone), or a non extractable WebCrypto key in the browser's own
//   storage (web, and the phone when its shell is older). Any one holder that still has its key opens the vault, and a
//   holder that lost its key gets a fresh wrap the next time another one opens it.
// - Everything lives in its own browser database (core/localidb.ts), never in a project's offline copy, so linking a
//   Supabase project (which reloads the page with another database name) can never hide or drop it.
//
// The rules that keep data safe (each one has a test in tests/localfirst.test.ts):
// 1. Nothing here ever deletes a record or the head, except discardLocalBackup, and that refuses unless a move into a
//    synced vault finished AND was verified record by record, and the person confirmed.
// 2. A holder's key is never replaced while it might still open the vault: create() is only called for a holder that
//    answered "missing", and a holder must refuse to create over an existing key.
// 3. Start now never writes over an existing local vault.
// 4. A vault key that cannot be opened ("denied", "lost") leaves everything as it is: the person can Allow, retry, or
//    restore from a backup file. Nothing is reset.
import * as C from "./crypto.ts";

export interface Row {
  id: string;
  workspace_id: string | null;
  author_id: string | null;
  ct: string;
  deleted: boolean;
  updated_at: string | null;
}

/** The small key value store the local vault lives in (IndexedDB in the app, a Map in the tests). */
export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, val: unknown): Promise<void>;
  /** Several keys in ONE transaction: all of them or none. */
  setMany(entries: [string, unknown][]): Promise<void>;
  del(key: string): Promise<void>;
}

export type HolderName = "keychain" | "keystore" | "device";
export type HolderGet =
  | { status: "ok"; kek: CryptoKey }
  | { status: "missing" }        // this holder has no key at all (never made, or removed)
  | { status: "denied" }         // it has one but could not read it now (a Keychain Deny, a new build not allowed yet)
  | { status: "unavailable" };   // this holder does not exist here (an older shell, a browser without storage)
export interface KeyHolder {
  name: HolderName;
  get(): Promise<HolderGet>;
  /** Makes and keeps a NEW key. Must throw if a key is already there (never replace one). */
  create(): Promise<CryptoKey>;
  /** Removes its key. Only ever called by discardLocalBackup. */
  forget?(): Promise<void>;
}

export interface MoveJournal {
  v: 1;
  /** Where the records are going: the project and the account (the move never continues into another one). */
  target: { project: string; userId: string };
  startedAt: string;
  attempts: number;
  /** Local record id -> the id it has in the synced vault (the same id, except a merged one of a kind kept once). */
  map: Record<string, string>;
  /** Synced vault id -> hash of what the move last wrote there (lets a retry skip what already arrived). */
  sent: Record<string, string>;
  lastError?: { at: string; code: string; message: string; failed: string[] } | null;
  verified?: { at: string; count: number; digest: string } | null;
}

export interface LocalHead {
  v: 1;
  id: string;                  // random, names this local vault
  name: string;                // the first name typed at Start now
  createdAt: string;
  wraps: Partial<Record<HolderName, string>>;
  check: string;               // a known value encrypted with the vault key: proves a key opened the right vault
  state: "local" | "moving" | "moved";
  /** Turn on sync was chosen (ISO), and not called off. */
  syncIntent?: string | null;
  /** "Not now" on the sign in that would start the move, for this project (it then opens the local vault again). */
  snoozedFor?: string | null;
  move?: MoveJournal | null;
  movedAt?: string | null;
  exportedAt?: string | null;
}

export const HEAD_KEY = "head";
const CHECK = "ps-local-v1:check";
export const wrapAad = (holder: HolderName, id: string) => `ps-local-v1:vk:${holder}:${id}`;
const checkAad = (id: string) => `ps-local-v1:check:${id}`;
/** The vault engine's login name for the local vault (its meta, rows and outbox are kept under it). */
export const localLogin = (h: Pick<LocalHead, "id">) => `local:${h.id}`;
export const localUserId = (h: Pick<LocalHead, "id">) => `local-${h.id}`;
export const rowsKey = (h: Pick<LocalHead, "id">) => `${localLogin(h)}:rows`;
export const outKey = (h: Pick<LocalHead, "id">) => `${localLogin(h)}:outbox`;
export const metaKey = (h: Pick<LocalHead, "id">) => `${localLogin(h)}:meta`;

export const readHead = (kv: KV) => kv.get<LocalHead>(HEAD_KEY);

/** Read, change and write the head (the only writer of the head besides creation). */
export async function updateHead(kv: KV, fn: (h: LocalHead) => LocalHead): Promise<LocalHead> {
  const h = await readHead(kv);
  if (!h) throw new Error("There is no data on this device.");
  const next = fn(structuredClone(h));
  if (next.id !== h.id) throw new Error("The local vault cannot change its id.");
  await kv.set(HEAD_KEY, next);
  return next;
}

async function tryOpen(h: LocalHead, holder: HolderName, kek: CryptoKey): Promise<CryptoKey | null> {
  const w = h.wraps[holder];
  if (!w) return null;
  try {
    const vk = await C.unwrapKey(kek, w, wrapAad(holder, h.id), true);
    if ((await C.decryptJson<string>(vk, h.check, checkAad(h.id))) !== CHECK) return null;
    return vk;
  } catch { return null; }
}
async function nonExtractable(vk: CryptoKey): Promise<CryptoKey> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", vk));
  try { return await C.importAesRaw(raw, false); } finally { raw.fill(0); }
}

export type OpenResult =
  | { status: "none" }
  | { status: "ok"; head: LocalHead; vk: CryptoKey; by: HolderName; repaired: HolderName[] }
  | { status: "denied"; head: LocalHead; holders: HolderName[] }
  | { status: "lost"; head: LocalHead };

/** Opens the local vault with the first holder that can. Repairs holders that lost their key (new wrap, never a new
 *  vault key). Never deletes or resets anything. */
export async function openLocalVault(kv: KV, holders: KeyHolder[]): Promise<OpenResult> {
  const head = await readHead(kv);
  if (!head) return { status: "none" };
  const answers = new Map<HolderName, HolderGet>();
  let vk: CryptoKey | null = null, by: HolderName | null = null;
  for (const hd of holders) {
    let g: HolderGet;
    try { g = await hd.get(); } catch { g = { status: "unavailable" }; }
    answers.set(hd.name, g);
    if (!vk && g.status === "ok") {
      const k = await tryOpen(head, hd.name, g.kek);
      if (k) { vk = k; by = hd.name; }
    }
  }
  if (!vk || !by) {
    const denied = [...answers].filter(([n, g]) => g.status === "denied" && head.wraps[n]).map(([n]) => n);
    return denied.length ? { status: "denied", head, holders: denied } : { status: "lost", head };
  }
  // Repair: a holder that answered but cannot open its wrap (its key changed) or has no wrap yet gets one now. A holder
  // that is missing its key gets a new one first. Denied and unavailable holders are left alone.
  const repaired: HolderName[] = [];
  const wraps = { ...head.wraps };
  for (const hd of holders) {
    if (hd.name === by) continue;
    let g = answers.get(hd.name)!;
    try {
      if (g.status === "ok" && (await tryOpen(head, hd.name, g.kek))) continue;
      if (g.status === "missing") g = { status: "ok", kek: await hd.create() };
      if (g.status !== "ok") continue;
      wraps[hd.name] = await C.wrapKey(g.kek, vk, wrapAad(hd.name, head.id));
      repaired.push(hd.name);
    } catch { /* that holder stays as it was; the vault is open anyway */ }
  }
  let out = head;
  if (repaired.length) out = await updateHead(kv, (h) => ({ ...h, wraps: { ...h.wraps, ...Object.fromEntries(repaired.map((n) => [n, wraps[n]])) } }));
  return { status: "ok", head: out, vk: await nonExtractable(vk), by, repaired };
}

/** Start now: a brand new local vault. Refuses if one is already on this device. The head is written once and then
 *  opened again from storage before it counts (a holder that only seemed to keep its key is caught here, while there
 *  is still nothing in the vault). */
export async function createLocalVault(kv: KV, holders: KeyHolder[], name: string, now = new Date()): Promise<{ head: LocalHead; vk: CryptoKey }> {
  if (await readHead(kv)) throw new Error("There is already data on this device. Open it instead.");
  const id = C.b64url(C.randomBytes(16));
  const vk = await C.newAesKey();
  const wraps: Partial<Record<HolderName, string>> = {};
  for (const hd of holders) {
    try {
      let g = await hd.get();
      if (g.status === "missing") g = { status: "ok", kek: await hd.create() };
      if (g.status === "ok") wraps[hd.name] = await C.wrapKey(g.kek, vk, wrapAad(hd.name, id));
    } catch { /* try the next holder */ }
  }
  if (!Object.keys(wraps).length) throw new Error("This device could not keep a key safe, so nothing was saved. Try again, or turn on sync instead.");
  const head: LocalHead = {
    v: 1, id, name: cleanName(name), createdAt: now.toISOString(), wraps,
    check: await C.encryptJson(vk, CHECK, checkAad(id)), state: "local",
  };
  await kv.set(HEAD_KEY, head);
  const back = await openLocalVault(kv, holders);
  if (back.status !== "ok" || back.head.id !== id) {
    // Nothing is in this vault yet, so taking the head away again loses nothing and lets Start now be tried again.
    const still = await readHead(kv);
    if (still?.id === id && !(await kv.get(rowsKey(head))) && !(await kv.get(outKey(head)))) await kv.del(HEAD_KEY);
    throw new Error("This device could not keep a key safe, so nothing was saved. Try again, or turn on sync instead.");
  }
  return { head: back.head, vk: back.vk };
}

export function cleanName(s: string): string {
  return String(s ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40);
}

/** The vault engine's save, local mode: what the server would have answered, done here. Deletes leave the device. */
export function localCommit(rows: Map<string, Row>, outbox: Map<string, Row>, nowIso: string, userId: string): { rows: Map<string, Row>; committed: string[] } {
  const next = new Map(rows);
  const committed: string[] = [];
  for (const [id, r] of outbox) {
    if (r.deleted) next.delete(id);
    else next.set(id, { ...r, workspace_id: r.workspace_id ?? null, author_id: r.author_id ?? userId, updated_at: nowIso });
    committed.push(id);
  }
  return { rows: next, committed };
}

/** Every record of the local vault as it stands, unsaved changes included (what a move or an export reads). */
export async function loadLocalRows(kv: KV, head: Pick<LocalHead, "id">): Promise<Row[]> {
  const rows = new Map(Object.entries((await kv.get<Record<string, Row>>(rowsKey(head))) || {}));
  const out = (await kv.get<Record<string, Row>>(outKey(head))) || {};
  for (const [id, r] of Object.entries(out)) { if (r.deleted) rows.delete(id); else rows.set(id, r); }
  return [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Removes the local copy after a verified move, and only then. `confirmed` is the person's own click. */
export async function discardLocalBackup(kv: KV, holders: KeyHolder[], confirmed: boolean): Promise<void> {
  const h = await readHead(kv);
  if (!h) return;
  if (!confirmed) throw new Error("Confirm first.");
  if (h.state !== "moved" || !h.move?.verified) throw new Error("The local copy stays until your data has moved and been checked.");
  await kv.del(rowsKey(h)); await kv.del(outKey(h)); await kv.del(metaKey(h));
  await kv.del(HEAD_KEY);
  for (const hd of holders) { try { await hd.forget?.(); } catch { /* an old key left behind opens nothing */ } }
}

/** A local vault older than a week, not yet synced, not dismissed: the gentle reminder card shows. */
export function nudgeDue(createdAt: string | null | undefined, dismissedAt: string | null | undefined, nowMs: number): boolean {
  const c = Date.parse(String(createdAt || ""));
  if (!Number.isFinite(c) || nowMs - c < 7 * 864e5) return false;
  const d = Date.parse(String(dismissedAt || ""));
  return !(Number.isFinite(d) && nowMs - d < 30 * 864e5);   // Not now: asked again a month later, quietly
}

// G Squad directory (V1.42): "See available squads", Ask to join, and the admin's Approve. Pure crypto and checks,
// no vault and no screen, so the engine, the unit tests and the live hub check run the same code.
//
// Ask: the asker makes two new key pairs (sign, box) for that squad. The hub gets their public halves plus a blob
// sealed to the admin's box key: their name in the squad and the same two public keys. The hub never sees the name.
// Approve: the admin's device opens the blob and checks it names exactly the keys the hub row says (so the hub cannot
// slip its own box key in), then seals the squad key to that box key (the same key drop as a re-key) and seals the
// new member's card for them, so they show by name at once and a later re-key never waits for them.
// Check code: six digits both sides can compare (eg over a text) to be sure no one sat in the middle.
import * as S from "./squadcrypto.ts";
import { b64, sha256hex } from "./crypto.ts";
import { cleanName, currentKey, type Card, type SquadRec } from "./squadrec.ts";
import type { KeyPairB64 } from "./squadcrypto.ts";

/** The listed squads PS knows by name. The hub lists ids only (it never holds a name); for now one slot. */
export const DIR_NAMES: Record<string, string> = { gsquad: "The G Squad" };
export const LISTED_NAME = DIR_NAMES.gsquad;
/** After a decline, the same keys may ask again after this long (the hub enforces it per key). A cancel forgets the
 *  request on your side, so asking again uses new keys. */
export const ASK_AGAIN_MS = 60 * 60_000;

const aad = {
  ask: (squad: string, req: string) => `${S.V}:ask:${squad}:${req}`,
  askKey: (squad: string, req: string) => `${S.V}:askkey:${squad}:${req}`,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const PUB = /^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]{2}$/;

export interface DirEntry { id: string; slot: string; admin_box: string; name?: string | null }
/** One listed squad as PS shows it (unknown slots are not shown). */
export function cleanDir(v: unknown): { id: string; name: string; adminBox: string }[] {
  const list = Array.isArray(v) ? v : [];
  return list.flatMap((e) => {
    const o = e as Partial<DirEntry> | null;
    if (!o || typeof o.id !== "string" || !UUID.test(o.id) || typeof o.slot !== "string" || !DIR_NAMES[o.slot] || typeof o.admin_box !== "string" || !PUB.test(o.admin_box)) return [];
    // V1.43: the admin of the listed squad may rename it; no name yet means the slot's own name.
    return [{ id: o.id.toLowerCase(), name: cleanName(o.name) || DIR_NAMES[o.slot], adminBox: o.admin_box }];
  }).slice(0, 20);
}

/** Your request, kept in your own vault (kind "squadask") until you are in, cancel for good, or it is gone. */
export interface AskRec {
  v: 1;
  squadId: string;
  name: string;            // the squad's name as listed
  reqId: string;
  me: string;              // your name in the squad
  sign: KeyPairB64;
  box: KeyPairB64;
  adminBox: string;
  at: string;              // when you asked
  state: "open" | "declined" | "cancelled";
  settledAt?: string;      // declined or cancelled at (ask again an hour later)
}
const pair = (v: unknown): KeyPairB64 | null => {
  const p = v as { pub?: unknown; priv?: unknown } | null;
  return p && typeof p.pub === "string" && typeof p.priv === "string" && PUB.test(p.pub) && B64.test(p.priv) && p.priv.length <= 400 ? { pub: p.pub, priv: p.priv } : null;
};
export function cleanAskRec(v: unknown): AskRec | null {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || r.v !== 1) return null;
  if (typeof r.squadId !== "string" || !UUID.test(r.squadId) || typeof r.reqId !== "string" || !UUID.test(r.reqId)) return null;
  const sign = pair(r.sign), box = pair(r.box);
  if (!sign || !box || typeof r.adminBox !== "string" || !PUB.test(r.adminBox)) return null;
  const state = r.state === "declined" || r.state === "cancelled" ? r.state : "open";
  return { v: 1, squadId: r.squadId.toLowerCase(), name: cleanName(r.name) || LISTED_NAME, reqId: r.reqId.toLowerCase(), me: cleanName(r.me) || "Me", sign, box, adminBox: r.adminBox,
    at: typeof r.at === "string" ? r.at : new Date(0).toISOString(), state,
    ...(typeof r.settledAt === "string" && state !== "open" ? { settledAt: r.settledAt } : {}) };
}
/** When a declined or cancelled request may ask again (null: it may now, or it is still open). */
export function askAgainAt(a: AskRec, now = Date.now()): string | null {
  if (a.state === "open" || !a.settledAt) return null;
  const t = Date.parse(a.settledAt) + ASK_AGAIN_MS;
  return Number.isFinite(t) && t > now ? new Date(t).toISOString() : null;
}

/** Six digits from both sides' keys: the asker sees it while waiting, the admin sees it on the request. */
export async function checkCode(squad: string, sign: string, box: string, adminBox: string): Promise<string> {
  const h = await sha256hex(`${S.V}|check|${squad}|${sign}|${box}|${adminBox}`);
  const n = (parseInt(h.slice(0, 8), 16) % 1_000_000).toString().padStart(6, "0");
  return `${n.slice(0, 3)} ${n.slice(3)}`;
}

/** A new request: new keys, the blob sealed to the admin. Returns what goes to the hub and the record you keep. */
export async function makeAsk(entry: { id: string; name: string; adminBox: string }, me: string, old?: AskRec | null) {
  // Asking again after a decline: the same keys (the hub's hour wait is per key), a new request id.
  const [sign, box] = old && old.squadId === entry.id && old.state === "declined" ? [old.sign, old.box] : await Promise.all([S.newSignPair(), S.newBoxPair()]);
  const reqId = S.newUuid(), name = cleanName(me) || "Me";
  const k = await S.newSquadKey();   // a one-off key for this blob, sealed to the admin's box key
  const blob = JSON.stringify({ v: 1, k: await S.sealKeyTo(entry.adminBox, k, aad.askKey(entry.id, reqId)), c: await S.seal(k, { n: name, sign: sign.pub, box: box.pub } satisfies Card, aad.ask(entry.id, reqId)) });
  const rec: AskRec = { v: 1, squadId: entry.id, name: entry.name, reqId, me: name, sign, box, adminBox: entry.adminBox, at: new Date().toISOString(), state: "open" };
  return { rec, hub: { id: reqId, squad: entry.id, box: box.pub, admin: entry.adminBox, sealed: blob } };
}

/** A request row as the hub hands it to the admin. */
export interface HubAskRow { id: string; sign_pub: string; box_pub: string; admin_box: string; sealed: string; created_at: string }
export interface AskView { id: string; name: string; code: string; at: string; ok: boolean; sign: string; box: string }
/** The admin opens a request. ok is false when it was not sealed to you, does not open, or names other keys than the
 *  hub row (then it can only be declined). */
export async function openAsk(rec: SquadRec, row: HubAskRow): Promise<AskView> {
  const bad: AskView = { id: row.id, name: "Someone", code: "", at: row.created_at, ok: false, sign: row.sign_pub, box: row.box_pub };
  if (row.admin_box !== rec.box.pub) return bad;
  try {
    const b = JSON.parse(row.sealed) as { v?: number; k?: string; c?: string };
    if (b.v !== 1 || typeof b.k !== "string" || typeof b.c !== "string") return bad;
    const k = await S.openKeyDrop(rec.box.priv, b.k, aad.askKey(rec.squadId, row.id));
    const c = await S.open<Card>(k, b.c, aad.ask(rec.squadId, row.id));
    if (!c || c.sign !== row.sign_pub || c.box !== row.box_pub) return bad;
    return { id: row.id, name: cleanName(c.n) || "Someone", code: await checkCode(rec.squadId, row.sign_pub, row.box_pub, rec.box.pub), at: row.created_at, ok: true, sign: row.sign_pub, box: row.box_pub };
  } catch { return bad; }
}

/** Approve: the new member's id, the squad key sealed to their box key, and their card sealed with the squad key. */
export async function approveMaterial(rec: SquadRec, ask: AskView): Promise<{ id: string; member: string; gen: number; drop: string; card: string }> {
  if (!ask.ok) throw new Error("This request cannot be opened, so it can only be declined.");
  const key = currentKey(rec), member = S.newUuid();
  const drop = await S.sealKeyTo(ask.box, key.raw, S.sqAad.drop(rec.squadId, member, key.gen));
  const card = await S.seal(key.raw, { n: ask.name, sign: ask.sign, box: ask.box } satisfies Card, S.sqAad.card(rec.squadId, member, key.gen));
  return { id: ask.id, member, gen: key.gen, drop, card };
}

/** The asker after Approve: the key drop opened with their box key into a squad record for their vault. The same on
 *  every device that holds the request (Mac and phone may both see the approval): the task id secret comes from the
 *  box key and the joined time from the approval, so two copies of the record are one and the same. */
export async function recFromApproval(a: AskRec, s: { squad: string; member: string; drop: { gen: number; sealed: string }; at?: string }): Promise<SquadRec> {
  if (s.squad !== a.squadId || !UUID.test(s.member)) throw new Error("That approval is not for this request.");
  const raw = await S.openKeyDrop(a.box.priv, s.drop.sealed, S.sqAad.drop(a.squadId, s.member.toLowerCase(), s.drop.gen));
  const h = await sha256hex(`${S.V}|secret|${a.squadId}|${a.box.priv}`);
  const secret = b64(Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16))));
  const at = s.at && !Number.isNaN(Date.parse(s.at)) ? new Date(Date.parse(s.at)).toISOString() : new Date().toISOString();
  return { v: 1, squadId: a.squadId, memberId: s.member.toLowerCase(), me: a.me, keys: [{ gen: s.drop.gen, k: raw }], sign: a.sign, box: a.box, secret, joinedAt: at };
}

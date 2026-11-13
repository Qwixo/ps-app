// G Squad (V1.40): your squad keys, kept as ONE record of kind "squad" in your own vault (sealed by your vault key
// on your own Supabase project, like every other record; the hub never sees it). It holds every squad key gen you
// were given, your two key pairs for this squad, and the secret your squad ids come from.
// Also the re-key: when someone leaves, a remaining member makes the next gen and seals it to every member still
// in, but only to members whose card (name and public keys, sealed with a squad key) matches what the hub says, so
// the hub cannot slip its own public key in.
import type { KeyPairB64 } from "./squadcrypto.ts";
import { newSquadKey, open, openKeyDrop, seal, sealKeyTo, sqAad } from "./squadcrypto.ts";

export interface SquadRec {
  v: 1;
  squadId: string;
  memberId: string;
  me: string;                       // your name in the squad (also inside your sealed card)
  keys: { gen: number; k: string }[];
  sign: KeyPairB64;
  box: KeyPairB64;
  secret: string;                   // HMAC secret for your task ids and fingerprints
  joinedAt: string;
  creator?: boolean;
}
/** What every member publishes about themselves, sealed with a squad key. */
export interface Card { n: string; sign: string; box: string }

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pair = (v: unknown): KeyPairB64 | null => {
  const p = v as { pub?: unknown; priv?: unknown } | null;
  return p && typeof p.pub === "string" && typeof p.priv === "string" && B64.test(p.pub) && B64.test(p.priv) && p.pub.length <= 120 && p.priv.length <= 400
    ? { pub: p.pub, priv: p.priv } : null;
};
export function cleanName(v: unknown): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) : "";
}
export function cleanSquadRec(v: unknown): SquadRec | null {
  const r = v as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || r.v !== 1) return null;
  if (typeof r.squadId !== "string" || !UUID.test(r.squadId) || typeof r.memberId !== "string" || !UUID.test(r.memberId)) return null;
  const sign = pair(r.sign), box = pair(r.box);
  if (!sign || !box || typeof r.secret !== "string" || !B64.test(r.secret)) return null;
  const keys = Array.isArray(r.keys) ? r.keys.filter((k): k is { gen: number; k: string } => !!k && Number.isInteger(k.gen) && k.gen >= 1 && typeof k.k === "string" && B64.test(k.k)) : [];
  if (!keys.length) return null;
  return { v: 1, squadId: r.squadId.toLowerCase(), memberId: r.memberId.toLowerCase(), me: cleanName(r.me) || "Me", keys: dedupeKeys(keys), sign, box, secret: r.secret,
    joinedAt: typeof r.joinedAt === "string" ? r.joinedAt : new Date(0).toISOString(), ...(r.creator === true ? { creator: true } : {}) };
}
function dedupeKeys(keys: { gen: number; k: string }[]) {
  const m = new Map<number, string>();
  for (const k of keys) if (!m.has(k.gen)) m.set(k.gen, k.k);
  return [...m].sort((a, b) => a[0] - b[0]).map(([gen, k]) => ({ gen, k }));
}
export function currentKey(rec: SquadRec): { raw: string; gen: number } {
  const k = rec.keys[rec.keys.length - 1];
  return { raw: k.k, gen: k.gen };
}
export function keyFor(rec: SquadRec, gen: number): string | null {
  return rec.keys.find((k) => k.gen === gen)?.k ?? null;
}
export function withKey(rec: SquadRec, gen: number, raw: string): SquadRec {
  return { ...rec, keys: dedupeKeys([...rec.keys, { gen, k: raw }]) };
}

/** Opens a member card with whichever gen it was sealed under (if we hold that gen). */
export async function openCard(rec: SquadRec, member: string, ct: string | null | undefined, gen: number | null | undefined): Promise<Card | null> {
  if (!ct || !Number.isInteger(gen)) return null;
  const raw = keyFor(rec, gen as number);
  if (!raw) return null;
  try {
    const c = await open<Card>(raw, ct, sqAad.card(rec.squadId, member, gen as number));
    return c && typeof c.sign === "string" && typeof c.box === "string" ? { n: cleanName(c.n) || "Someone", sign: c.sign, box: c.box } : null;
  } catch { return null; }
}
export async function sealCard(rec: SquadRec, name: string): Promise<{ ct: string; gen: number }> {
  const key = currentKey(rec);
  const card: Card = { n: cleanName(name) || "Someone", sign: rec.sign.pub, box: rec.box.pub };
  return { ct: await seal(key.raw, card, sqAad.card(rec.squadId, rec.memberId, key.gen)), gen: key.gen };
}

export interface HubMember { id: string; sign_pub: string; box_pub: string; card_ct: string | null; card_gen: number | null; left_at: string | null }
/**
 * The next squad key after someone left: sealed to every member still in, each checked first (their sealed card
 * must open and name the same public keys the hub lists). Returns null when a member still in has no valid card
 * yet (the hub then waits; it never re-keys around someone).
 */
export async function planRekey(rec: SquadRec, members: HubMember[], squadName: string): Promise<{ gen: number; raw: string; drops: { member: string; sealed: string }[]; meta: string } | null> {
  const cur = currentKey(rec);
  const gen = cur.gen + 1, raw = await newSquadKey();
  const drops: { member: string; sealed: string }[] = [];
  for (const m of members) {
    if (m.left_at || !m.card_ct) continue;   // V1.49: no card yet means still getting in (the hub's re-key agrees)
    const card = await openCard(rec, m.id, m.card_ct, m.card_gen);
    if (!card || card.box !== m.box_pub || card.sign !== m.sign_pub) return null;
    drops.push({ member: m.id, sealed: await sealKeyTo(m.box_pub, raw, sqAad.drop(rec.squadId, m.id, gen)) });
  }
  if (!drops.some((d) => d.member === rec.memberId)) return null;
  return { gen, raw, drops, meta: await seal(raw, { n: squadName }, sqAad.meta(rec.squadId, gen)) };
}
/** Your own drop of a new gen, opened with your box key. */
export async function takeDrop(rec: SquadRec, gen: number, sealed: string): Promise<SquadRec> {
  const raw = await openKeyDrop(rec.box.priv, sealed, sqAad.drop(rec.squadId, rec.memberId, gen));
  return withKey(rec, gen, raw);
}

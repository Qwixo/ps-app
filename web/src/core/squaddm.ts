// G Squad v3 (PS 1.65): direct messages, group chats and profile pictures. Keys and sealing only, no screen and no hub
// calls here, so the tests, the engine and the hub check run this very code.
//
// Direct message (DM): the key of a DM is made on the two members' own devices from their box keys (P-256 ECDH, then
// HKDF with both public keys, the squad, the conversation and the epoch in it). The hub never holds a key for a DM, it
// only stores ciphertext, so neither the hub nor any other member can open one: a third member has neither private key.
// Every box key is checked against the member's sealed card first (trustedBox in squadchat.ts), so the hub cannot slip
// its own key in. Rotating a DM = a higher epoch: a new key, bound into every message's aad.
// Group chat: a random key per epoch, sealed to each member's checked box key (the same seal as the chat periods). When
// someone is removed or leaves, a member still in makes the next epoch for exactly the members still in, so the one
// who left holds no key for any message sent after. A member added gets keys from their epoch on, never older ones.
// Pictures: a small picture sealed with the squad key (the whole squad opens it, the hub does not).
import { b64, sha256hex, unb64 } from "./crypto.ts";
import { open, seal, sealKeyTo, newSquadKey, V } from "./squadcrypto.ts";
import { cleanBody, cleanText, trustedBox, type ChatBody } from "./squadchat.ts";
import { openKeyDrop } from "./squadcrypto.ts";
import { cleanName, keyFor, currentKey, type HubMember, type SquadRec } from "./squadrec.ts";

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const BOX = { name: "ECDH", namedCurve: "P-256" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const dmAad = {
  msg: (squad: string, conv: string, epoch: number, member: string, id: string) => `${V}:dm:${squad}:${conv}:${epoch}:${member}:${id}`,
  key: (squad: string, conv: string, member: string, epoch: number) => `${V}:gkey:${squad}:${conv}:${member}:${epoch}`,
  title: (squad: string, conv: string, epoch: number) => `${V}:gtitle:${squad}:${conv}:${epoch}`,
  avatar: (squad: string, member: string, gen: number) => `${V}:avatar:${squad}:${member}:${gen}`,
};

export const MAX_GROUP = 24, MAX_TITLE = 40;
export const AVATAR_MAX_BYTES = 40 * 1024;

// ---------- direct messages ----------
/** The conversation id of two members: the same on both devices, so "open or create" never makes two. */
export async function dmConvId(squad: string, a: string, b: string): Promise<string> {
  const [x, y] = [a, b].sort();
  const h = await sha256hex(`${V}:dmconv:${squad}:${x}:${y}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** The DM key for one epoch, from your box private key and the other member's CHECKED box public key. */
export async function dmKey(rec: SquadRec, conv: string, peerId: string, peerBoxPub: string, epoch: number): Promise<string> {
  const priv = await subtle.importKey("pkcs8", unb64(rec.box.priv), BOX, false, ["deriveBits"]);
  const pub = await subtle.importKey("raw", unb64(peerBoxPub), BOX, false, []);
  const shared = await subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const [ids, pubs] = [[rec.memberId, peerId].sort(), [rec.box.pub, peerBoxPub].sort()];
  const hk = await subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const salt = te.encode(`${V}:dmsalt:${rec.squadId}:${ids.join(":")}`);
  const info = te.encode(`${V}:dmkey:${rec.squadId}:${conv}:${epoch}:${pubs.join(":")}`);
  return b64(new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info } as HkdfParams, hk, 256)));
}
/** The key for a DM with this member, or null while their card does not check out (never derive from an unchecked key). */
export async function dmKeyWith(rec: SquadRec, conv: string, peer: HubMember, epoch: number): Promise<string | null> {
  const box = await trustedBox(rec, peer);
  return box ? dmKey(rec, conv, peer.id, box, epoch) : null;
}

// ---------- group chats ----------
export function cleanTitle(v: unknown): string {
  return cleanName(typeof v === "string" ? v.slice(0, 200) : "").slice(0, MAX_TITLE);
}
/** Epoch keys for exactly `members` (each checked first). Null when any of them cannot be checked or you are not among
 *  them: nobody is ever sealed around. `title` is sealed under the new key. */
export async function planGroupKeys(rec: SquadRec, conv: string, epoch: number, members: HubMember[], title: string):
  Promise<{ epoch: number; raw: string; drops: { member: string; sealed: string }[]; title_ct: string } | null> {
  const raw = await newSquadKey();
  const drops: { member: string; sealed: string }[] = [];
  for (const m of members) {
    const box = await trustedBox(rec, m);
    if (!box) return null;
    drops.push({ member: m.id, sealed: await sealKeyTo(box, raw, dmAad.key(rec.squadId, conv, m.id, epoch)) });
  }
  if (!drops.some((d) => d.member === rec.memberId)) return null;
  return { epoch, raw, drops, title_ct: await seal(raw, { n: cleanTitle(title) || "Group" }, dmAad.title(rec.squadId, conv, epoch)) };
}
export async function openGroupDrop(rec: SquadRec, conv: string, epoch: number, sealed: string): Promise<string | null> {
  try { return await openKeyDrop(rec.box.priv, sealed, dmAad.key(rec.squadId, conv, rec.memberId, epoch)); } catch { return null; }
}
export async function openTitle(raw: string, squad: string, conv: string, epoch: number, ct: string): Promise<string | null> {
  try { const t = await open<{ n?: unknown }>(raw, ct, dmAad.title(squad, conv, epoch)); return cleanTitle(t.n) || null; } catch { return null; }
}

// ---------- messages (DM and group share the shape of the squad chat's) ----------
export async function sealConvMessage(raw: string, squad: string, conv: string, epoch: number, member: string, id: string, body: ChatBody): Promise<string> {
  const b = cleanBody(body);
  if (!b) throw new Error("Empty message.");
  return seal(raw, b, dmAad.msg(squad, conv, epoch, member, id));
}
export async function openConvMessage(raw: string, squad: string, conv: string, epoch: number, member: string, id: string, ct: string): Promise<ChatBody | null> {
  try { return cleanBody(await open(raw, ct, dmAad.msg(squad, conv, epoch, member, id))); } catch { return null; }
}

// ---------- profile pictures ----------
/** A picture the app will take: a jpeg or webp data URL of at most 40 KB (the Tab list shows it as is). */
export function cleanAvatar(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 60_000) return null;
  const m = /^data:image\/(jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
  if (!m) return null;
  const bytes = Math.floor((m[2].length * 3) / 4) - (m[2].endsWith("==") ? 2 : m[2].endsWith("=") ? 1 : 0);
  return bytes > 0 && bytes <= AVATAR_MAX_BYTES ? v : null;
}
export async function sealAvatar(rec: SquadRec, dataUrl: string): Promise<{ ct: string; gen: number }> {
  const p = cleanAvatar(dataUrl);
  if (!p) throw new Error("That picture is too big or not a jpeg or webp.");
  const k = currentKey(rec);
  return { ct: await seal(k.raw, { p }, dmAad.avatar(rec.squadId, rec.memberId, k.gen)), gen: k.gen };
}
/** Another member's picture, or null (a gen we do not hold, a bad seal, a bad picture: the letter shows). */
export async function openAvatar(rec: SquadRec, member: string, ct: string, gen: number): Promise<string | null> {
  const raw = Number.isInteger(gen) ? keyFor(rec, gen) : null;
  if (!raw) return null;
  try { return cleanAvatar((await open<{ p?: unknown }>(raw, ct, dmAad.avatar(rec.squadId, member, gen))).p); } catch { return null; }
}

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export { cleanText };

// G Squad v3 (PS 1.65): direct messages, group chats and profile pictures. Keys and sealing only, no screen and no hub
// calls here, so the tests, the engine and the hub check run this very code.
//
// Direct message (DM): the key of a DM is made on the two members' own devices from their box keys (P-256 ECDH, then
// HKDF with both public keys, the squad, the conversation and the epoch in it). The hub never holds a key for a DM, it
// only stores ciphertext, so neither the hub nor any other member can open one: a third member has neither private key.
// Every box key is checked against the member's sealed card first (trustedBox in squadchat.ts), so the hub cannot slip
// its own key in. Rotating a DM = a higher epoch: a new key, bound into every message's aad. NOTE: both keys are static, so
// a DM rotation is NOT forward secrecy (anyone who gets a box key can derive every epoch); it only separates epochs.
// Messages are not signed: any member holding a group key could post as another member (same as the main squad chat).
// Group chat: a random key per epoch, sealed to each member's checked box key (the same seal as the chat periods). When
// someone is removed or leaves, a member still in makes the next epoch for exactly the members still in, so the one
// who left holds no key for any message sent after. A member added gets keys from their epoch on, never older ones.
// Pictures: a small picture sealed with the squad key (the whole squad opens it, the hub does not).
import { b64, sha256hex, unb64 } from "./crypto.ts";
import { open, seal, sealKeyTo, newSquadKey, V } from "./squadcrypto.ts";
import { cleanBody, cleanText, trustedBox, type ChatBody } from "./squadchat.ts";
import { openKeyDrop } from "./squadcrypto.ts";
import { cleanName, keyFor, currentKey, openCard, type HubMember, type SquadRec } from "./squadrec.ts";

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
export const AVATAR_MAX_BYTES = 36 * 1024;   // the hub takes 70,000 characters of sealed base64: 36 KB becomes about 65,500, so every picture the app accepts also fits there

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
/** What a rekeying member signs for each member's copy of an epoch key: the squad, group, epoch, who signs, who made the
 *  group, the exact member list, the sealed name, and this member's sealed copy. A hub cannot swap any of it. */
export interface GroupEnv { epoch: number; signer: string; creator: string; members: string[]; title_ct: string }
export interface GroupTrust { epoch: number; members: string[]; creator: string }
const dropText = (squad: string, conv: string, e: GroupEnv, member: string, sealedHash: string, titleHash: string) =>
  `${V}:gdrop:${squad}:${conv}:${e.epoch}:${e.signer}:${e.creator}:${[...e.members].sort().join(",")}:${titleHash}:${member}:${sealedHash}`;
async function signDrop(rec: SquadRec, conv: string, e: GroupEnv, member: string, sealed: string): Promise<string> {
  const k = await subtle.importKey("pkcs8", unb64(rec.sign.priv), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const text = dropText(rec.squadId, conv, e, member, await sha256hex(sealed), await sha256hex(e.title_ct));
  return b64(new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k, te.encode(text))));
}
/** A member's sign key checked against their own signed card (a member who has since left still counts: they signed while in). */
async function trustedSignPub(rec: SquadRec, m: HubMember | undefined): Promise<string | null> {
  if (!m) return null;
  const card = await openCard(rec, m.id, m.card_ct, m.card_gen);
  return card && card.sign === m.sign_pub && card.box === m.box_pub ? m.sign_pub : null;
}
/**
 * Is this key copy (yours) really made by a member of this group? Needs: the signer's checked sign key, a good signature,
 * you and the signer in the signed list, and the chain: after an epoch you already accepted, the signer must have been in
 * its list, the creator stays the same, and only the creator may add people. A first epoch (or one after a gap) must be
 * signed by the creator. So a hub that swaps keys or adds a member cannot produce one.
 */
export async function checkGroupDrop(rec: SquadRec, conv: string, env: GroupEnv, sealed: string, sig: string, signerRow: HubMember | undefined, prev: GroupTrust | null): Promise<boolean> {
  try {
    if (!Array.isArray(env.members) || !env.members.includes(rec.memberId) || !env.members.includes(env.signer)) return false;
    const pub = await trustedSignPub(rec, signerRow);
    if (!pub || signerRow!.id !== env.signer) return false;
    const key = await subtle.importKey("raw", unb64(pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const text = dropText(rec.squadId, conv, env, rec.memberId, await sha256hex(sealed), await sha256hex(env.title_ct));
    if (!(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, unb64(sig), te.encode(text)))) return false;
    if (prev && prev.epoch === env.epoch - 1) {
      if (!prev.members.includes(env.signer) || env.creator !== prev.creator) return false;
      if (env.members.some((m) => !prev.members.includes(m)) && env.signer !== env.creator) return false;
      return true;
    }
    return env.signer === env.creator;
  } catch { return false; }
}

/** Epoch keys for exactly `members` (each checked first), every copy and the member list signed with your sign key.
 *  Null when any of them cannot be checked or you are not among them: nobody is ever sealed around. `title` is sealed
 *  under the new key. `creator` is who made the group. */
export async function planGroupKeys(rec: SquadRec, conv: string, epoch: number, members: HubMember[], title: string, creator: string = rec.memberId):
  Promise<{ epoch: number; raw: string; drops: { member: string; sealed: string; sig: string }[]; title_ct: string; members: string[] } | null> {
  const raw = await newSquadKey();
  const boxes: { id: string; box: string }[] = [];
  for (const m of members) {
    const box = await trustedBox(rec, m);
    if (!box) return null;
    boxes.push({ id: m.id, box });
  }
  if (!boxes.some((b) => b.id === rec.memberId)) return null;
  const title_ct = await seal(raw, { n: cleanTitle(title) || "Group" }, dmAad.title(rec.squadId, conv, epoch));
  const env: GroupEnv = { epoch, signer: rec.memberId, creator, members: boxes.map((b) => b.id).sort(), title_ct };
  const drops: { member: string; sealed: string; sig: string }[] = [];
  for (const b of boxes) {
    const sealed = await sealKeyTo(b.box, raw, dmAad.key(rec.squadId, conv, b.id, epoch));
    drops.push({ member: b.id, sealed, sig: await signDrop(rec, conv, env, b.id, sealed) });
  }
  return { epoch, raw, drops, title_ct, members: env.members };
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
/** A picture the app will take: a jpeg or webp data URL of at most 36 KB (the Tab list shows it as is). */
export function cleanAvatar(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 50_000) return null;
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

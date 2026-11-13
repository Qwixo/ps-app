// G Squad (V1.40) crypto. Everything runs on the member's own device with WebCrypto; the hub (its own Supabase
// project) only ever stores what these functions produce: ciphertext, public keys, hashes, ids and timestamps.
//
// Squad key SK (AES-256-GCM, random, one per key generation "gen"): seals everything the squad shares (squad name,
// member cards, task copies, hand overs). Each member keeps every gen they hold inside ONE record of their own vault
// (kind "squad"), which their vault key seals like any other record, on their own Supabase project.
// Identity: per squad, each member has two P-256 key pairs, made on their device and kept in that same record:
//   sign (ECDSA)  every request to the hub is signed with it; the hub keeps only the public half and checks it.
//   box  (ECDH)   a new squad key after someone leaves is sealed to it (keyDrop), so only that member can open it.
// No hub password and no hub account: the private keys never leave the member's vault.
// Invites: a random 32 byte secret after the # of the link. The hub keeps only sha256(token), where token and the
// wrapping key both come from the secret through HKDF, so knowing the token never opens the wrapped squad key.
import { b64, b64url, decryptJson, encryptJson, randomBytes, sha256hex, unb64, unb64url } from "./crypto.ts";

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;
const AES: AesKeyGenParams = { name: "AES-GCM", length: 256 };
const SIGN = { name: "ECDSA", namedCurve: "P-256" } as const;
const BOX = { name: "ECDH", namedCurve: "P-256" } as const;

export const V = "gsquad-v1";

/** Additional data binds every ciphertext to what it is, its squad, its id and its key gen: the hub cannot move
 *  a sealed task onto another member, a card onto another member, or an old gen's text into a new slot. */
export const sqAad = {
  meta: (squad: string, gen: number) => `${V}:meta:${squad}:${gen}`,
  card: (squad: string, member: string, gen: number) => `${V}:card:${squad}:${member}:${gen}`,
  task: (squad: string, member: string, id: string, gen: number) => `${V}:task:${squad}:${member}:${id}:${gen}`,
  hand: (squad: string, from: string, to: string, id: string, gen: number) => `${V}:hand:${squad}:${from}:${to}:${id}:${gen}`,
  invite: (squad: string, invite: string, gen: number) => `${V}:invite:${squad}:${invite}:${gen}`,
  drop: (squad: string, member: string, gen: number) => `${V}:drop:${squad}:${member}:${gen}`,
};

// ---------- the squad key ----------
export async function newSquadKey(): Promise<string> {
  return b64(randomBytes(32));
}
const keyCache = new Map<string, CryptoKey>();
export async function squadKey(raw: string): Promise<CryptoKey> {
  const have = keyCache.get(raw);
  if (have) return have;
  const k = await subtle.importKey("raw", unb64(raw), AES, false, ["encrypt", "decrypt"]);
  if (keyCache.size > 32) keyCache.clear();
  keyCache.set(raw, k);
  return k;
}
export async function seal(raw: string, value: unknown, aad: string): Promise<string> {
  return encryptJson(await squadKey(raw), value, aad);
}
export async function open<T = unknown>(raw: string, ct: string, aad: string): Promise<T> {
  return decryptJson<T>(await squadKey(raw), ct, aad);
}

// ---------- identity ----------
export interface KeyPairB64 { pub: string; priv: string }   // pub: raw point (65 bytes) b64, priv: pkcs8 b64
export async function newSignPair(): Promise<KeyPairB64> {
  const kp = await subtle.generateKey(SIGN, true, ["sign", "verify"]) as CryptoKeyPair;
  return { pub: b64(new Uint8Array(await subtle.exportKey("raw", kp.publicKey))), priv: b64(new Uint8Array(await subtle.exportKey("pkcs8", kp.privateKey))) };
}
export async function newBoxPair(): Promise<KeyPairB64> {
  const kp = await subtle.generateKey(BOX, true, ["deriveBits"]) as CryptoKeyPair;
  return { pub: b64(new Uint8Array(await subtle.exportKey("raw", kp.publicKey))), priv: b64(new Uint8Array(await subtle.exportKey("pkcs8", kp.privateKey))) };
}
const signCache = new Map<string, CryptoKey>();
async function signKey(priv: string): Promise<CryptoKey> {
  let k = signCache.get(priv);
  if (!k) { k = await subtle.importKey("pkcs8", unb64(priv), SIGN, false, ["sign"]); signCache.clear(); signCache.set(priv, k); }
  return k;
}

/** The exact text a request signature covers (the hub's function builds the same string). */
export function signedText(act: string, member: string, ts: number, nonce: string, bodyHash: string): string {
  return `${V}|${act}|${member}|${ts}|${nonce}|${bodyHash}`;
}
export interface SignedRequest { act: string; member: string; ts: number; nonce: string; args: unknown; sig: string }
/** One request to the hub, signed with the member's own key. `member` is "" before the hub has given one. */
export async function signRequest(priv: string, act: string, member: string, args: unknown, now = Date.now()): Promise<SignedRequest> {
  const ts = Math.floor(now / 1000);
  const nonce = b64url(randomBytes(16));
  const body = JSON.stringify(args ?? null);
  const text = signedText(act, member, ts, nonce, await sha256hex(body));
  const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signKey(priv), te.encode(text)));
  return { act, member, ts, nonce, args: args ?? null, sig: b64(sig) };
}
/** The hub's check, the same code path (tests use it to prove the format; the edge function has its own copy). */
export async function verifyRequest(pub: string, r: SignedRequest): Promise<boolean> {
  try {
    const k = await subtle.importKey("raw", unb64(pub), SIGN, false, ["verify"]);
    const text = signedText(r.act, r.member, r.ts, r.nonce, await sha256hex(JSON.stringify(r.args ?? null)));
    return await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k, unb64(r.sig), te.encode(text));
  } catch { return false; }
}

// ---------- a new squad key to one member (after someone leaves) ----------
async function dropKey(shared: ArrayBuffer, salt: Bytes, info: string) {
  const hk = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: te.encode(info) } as HkdfParams, hk, AES, false, ["encrypt", "decrypt"]);
}
/** Seals the raw squad key to one member's box key: an ephemeral ECDH key, HKDF, AES-GCM, the aad names squad,
 *  member and gen (so the hub cannot hand member A's drop to member B or call an old key new). */
export async function sealKeyTo(boxPub: string, raw: string, aad: string): Promise<string> {
  const pub = await subtle.importKey("raw", unb64(boxPub), BOX, false, []);
  const eph = await subtle.generateKey(BOX, true, ["deriveBits"]) as CryptoKeyPair;
  const shared = await subtle.deriveBits({ name: "ECDH", public: pub }, eph.privateKey, 256);
  const epk = new Uint8Array(await subtle.exportKey("raw", eph.publicKey));
  const key = await dropKey(shared, epk, `${V} keydrop`);
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(aad) }, key, unb64(raw)));
  return JSON.stringify({ v: 1, epk: b64(epk), iv: b64(iv), ct: b64(ct) });
}
export async function openKeyDrop(boxPriv: string, sealed: string, aad: string): Promise<string> {
  const s = JSON.parse(sealed) as { v: number; epk: string; iv: string; ct: string };
  if (s.v !== 1) throw new Error("Unknown key drop.");
  const priv = await subtle.importKey("pkcs8", unb64(boxPriv), BOX, false, ["deriveBits"]);
  const epkRaw = unb64(s.epk);
  const epk = await subtle.importKey("raw", epkRaw, BOX, false, []);
  const shared = await subtle.deriveBits({ name: "ECDH", public: epk }, priv, 256);
  const key = await dropKey(shared, epkRaw, `${V} keydrop`);
  const pt = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: unb64(s.iv), additionalData: te.encode(aad) }, key, unb64(s.ct)));
  if (pt.length !== 32) throw new Error("Bad key drop.");
  return b64(pt);
}

// ---------- invites ----------
/** Token (sent to the hub at join, only its hash is stored) and wrapping key, both from the secret after the #. */
export async function squadInviteMaterial(secret: Bytes) {
  const hk = await subtle.importKey("raw", secret, "HKDF", false, ["deriveBits", "deriveKey"]);
  const p = (info: string) => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: te.encode(info) } as HkdfParams);
  const token = b64url(new Uint8Array(await subtle.deriveBits(p(`${V} invite token`), hk, 256)));
  const wrap = await subtle.deriveKey(p(`${V} invite wrap`), hk, AES, false, ["encrypt", "decrypt"]);
  return { token, tokenHash: await sha256hex(token), wrap };
}
export async function wrapForInvite(wrap: CryptoKey, raw: string, aad: string): Promise<string> {
  return encryptJson(wrap, { k: raw }, aad);
}
export async function unwrapInvite(wrap: CryptoKey, blob: string, aad: string): Promise<string> {
  const v = await decryptJson<{ k?: unknown }>(wrap, blob, aad);
  if (typeof v.k !== "string" || unb64(v.k).length !== 32) throw new Error("That invite could not be opened.");
  return v.k;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The link: `<base>gsquad#<invite id>.<secret>`. The secret never goes to a server (browsers never send a #). */
export function inviteLink(base: string, inviteId: string, secret: Bytes): string {
  return `${base}gsquad#${inviteId}.${b64url(secret)}`;
}
/** Reads an invite out of a pasted link (or just the part after the #). */
export function parseSquadInvite(text: string): { inviteId: string; secret: Bytes } | null {
  const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/i.exec(String(text || "").trim());
  if (!m || !UUID.test(m[1])) return null;
  try {
    const secret = unb64url(m[2]);
    return secret.length === 32 ? { inviteId: m[1].toLowerCase(), secret } : null;
  } catch { return null; }
}

// ---------- ids the hub sees ----------
/** A task's squad id: HMAC of the vault task id under the member's own secret, shaped as a uuid. Stable on every
 *  device of that member (so the Mac and the phone write the same row) and unlinkable to the vault's ids. */
export async function taskSquadId(secret: string, todoId: string): Promise<string> {
  const h = await hmacHex(secret, `task:${todoId}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** A short fingerprint of a sealed copy's plaintext and gen: the hub can see "changed", never what. */
export async function copyFp(secret: string, value: unknown, gen: number): Promise<string> {
  return (await hmacHex(secret, `fp:${gen}:${JSON.stringify(value)}`)).slice(0, 32);
}
const hmacCache = new Map<string, CryptoKey>();
async function hmacHex(secret: string, text: string): Promise<string> {
  let k = hmacCache.get(secret);
  if (!k) { k = await subtle.importKey("raw", unb64(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); hmacCache.clear(); hmacCache.set(secret, k); }
  const d = new Uint8Array(await subtle.sign("HMAC", k, te.encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function newSecret(): string { return b64(randomBytes(32)); }
export function newUuid(): string { return globalThis.crypto.randomUUID(); }

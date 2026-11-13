// Sign in on a phone by scanning the Mac (V1.55). The developer, 12 Nov 2026: "with the QR code when you link an iPhone or a
// GOS device, can you also make it so it automatically logs you in completely?" Done the way WhatsApp or Signal link a
// computer: the Mac shows a one time offer, the phone answers with a key of its own, both screens show the same six
// digit code, the person presses Allow on the Mac, and only then does the Mac send the phone what it needs to open
// the vault, sealed so only that phone can read it. Pure: no DOM, no vault, no network (tests/phonepair.test.ts).
//
// The steps (the relay is the person's own Supabase project, migration 029, which only ever sees public keys, a random
// nonce and ciphertext):
//  1. Mac: a fresh P-256 key pair and a random offer id (128 bits), plus a random nonce N it keeps to itself. The QR
//     carries the offer id, the Mac's public key and a COMMITMENT to N (its hash), never N. The offer can be claimed
//     for 60 seconds and only once (the database refuses a second claim).
//  2. Phone: a fresh P-256 key pair of its own; claims the offer with its public key.
//  3. Mac: sees the phone's key (the first and only one), and only THEN reveals N. Both sides compute the code from
//     the offer id, both public keys and N. The phone checks N against the commitment from the QR.
//     Why the commitment: someone who photographed the QR AND controlled the relay could otherwise swap in a key of
//     their own and try a million keys until the codes match. They have to pick their key before N is known, and N
//     cannot be changed afterwards (the phone checks it), so their chance is one in a million per fresh QR, and each
//     try still needs Allow on the Mac.
//  4. The person compares the codes and presses Allow on the Mac (a PS panel, never a blocking pop-up).
//  5. Mac: seals the sign in (the same derived keys "Remember me" keeps: the account's username or project handle, its
//     login password and its key encryption key; never the passphrase) with AES-256-GCM under a key from ECDH(Mac,
//     phone) and HKDF over the whole transcript. Only that phone's private key opens it; a relay that swapped keys
//     gets a different code on the Mac than on the phone, and a box it cannot open.
//  6. Phone: opens it, deletes the offer (single use), keeps the keys the way its platform keeps Remember me, signs in.
//
// A photo of the QR is useless on its own: it runs out after 60 seconds, works once, and nothing is sent without
// Allow on the Mac after the codes match. Nothing secret is ever logged.

const te = new TextEncoder();
const td = new TextDecoder();
const subtle = globalThis.crypto.subtle;
type Bytes = Uint8Array<ArrayBuffer>;
const EC = { name: "ECDH", namedCurve: "P-256" } as const;

export const OFFER_MS = 60_000;           // a QR can be claimed for a minute, then the Mac shows a new one
export const ALLOW_MS = 3 * 60_000;       // after the phone claimed it: time to compare the codes and press Allow
export const POLL_MS = 1_000;             // both sides look at the offer row this often while it is open (V1.57: was 1.5 s)
const LABEL = "ps-phone-link-v1";

const B64URL = /^[A-Za-z0-9_-]+$/;
export const ID_RE = /^[A-Za-z0-9_-]{22}$/;          // 16 random bytes
export const PUB_RE = /^[A-Za-z0-9_-]{87}$/;         // a P-256 public key, raw uncompressed (65 bytes)
export const COMMIT_RE = /^[A-Za-z0-9_-]{22}$/;      // the first 16 bytes of the nonce's SHA-256
export const NONCE_RE = /^[A-Za-z0-9_-]{22}$/;       // 16 random bytes

function b64url(u: Uint8Array): string {
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Bytes {
  if (!B64URL.test(s)) throw new Error("bad base64url");
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(p + "===".slice((p.length + 3) % 4));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
const rnd = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
async function sha(s: string | Uint8Array): Promise<Bytes> {
  return new Uint8Array(await subtle.digest("SHA-256", typeof s === "string" ? te.encode(s) : (s as Bytes)));
}

/** What the QR carries for the pairing (next to the project link): all three are public. */
export interface Offer { id: string; mac: string; c: string }
/** What the Mac keeps to itself while the offer is open. Never stored, never logged. */
export interface MacSide { offer: Offer; priv: CryptoKey; nonce: string }
export interface PhoneSide { pub: string; priv: CryptoKey }

async function keyPair(): Promise<{ pub: string; priv: CryptoKey }> {
  const kp = await subtle.generateKey(EC, false, ["deriveBits"]) as CryptoKeyPair;   // the private half never leaves memory
  return { pub: b64url(new Uint8Array(await subtle.exportKey("raw", kp.publicKey))), priv: kp.privateKey };
}

export async function commitOf(nonce: string): Promise<string> {
  return b64url((await sha(`${LABEL} commit\n${nonce}`)).subarray(0, 16));
}

/** Mac: a new one time offer. */
export async function newOffer(): Promise<MacSide> {
  const k = await keyPair();
  const nonce = b64url(rnd(16));
  return { offer: { id: b64url(rnd(16)), mac: k.pub, c: await commitOf(nonce) }, priv: k.priv, nonce };
}
/** Phone: its own key pair for this one pairing. */
export async function newPhoneKey(): Promise<PhoneSide> { return keyPair(); }

/** The QR's extra part: "&o=...&m=...&c=...". */
export function offerPart(o: Offer): string {
  return `&o=${o.id}&m=${o.mac}&c=${o.c}`;
}
/** The offer in a scanned code, or null (none, or not well formed: then the phone links the project only). */
export function readOffer(q: URLSearchParams): Offer | null {
  const id = q.get("o") ?? "", mac = q.get("m") ?? "", c = q.get("c") ?? "";
  return ID_RE.test(id) && PUB_RE.test(mac) && COMMIT_RE.test(c) ? { id, mac, c } : null;
}

/** Phone: the nonce the Mac revealed belongs to the commitment the QR showed. */
export async function revealOk(o: Offer, nonce: string): Promise<boolean> {
  return NONCE_RE.test(nonce) && (await commitOf(nonce)) === o.c;
}

function transcript(o: Offer, phonePub: string, nonce: string) {
  return `${LABEL}\n${o.id}\n${o.mac}\n${o.c}\n${phonePub}\n${nonce}`;
}

/** The six digit code both screens show ("123 456"). */
export async function linkCode(o: Offer, phonePub: string, nonce: string): Promise<string> {
  const h = await sha(`${transcript(o, phonePub, nonce)}\ncode`);
  const n = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
  const s = String(n % 1_000_000).padStart(6, "0");
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

async function boxKey(priv: CryptoKey, otherPub: string, t: string, use: KeyUsage): Promise<CryptoKey> {
  const pub = await subtle.importKey("raw", unb64url(otherPub), EC, false, []);
  const shared = await subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  const hk = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: await sha(t), info: te.encode(`${LABEL} seal`) } as HkdfParams,
    hk, { name: "AES-GCM", length: 256 }, false, [use]);
}

/** What the phone receives: the same derived keys Remember me keeps on a Mac. */
export interface LinkPayload {
  v: 1;
  /** The account's username, or its project handle for a passphrase only account (core/accountid.ts). */
  u: string;
  /** The login password Supabase sees (derived; never the passphrase). */
  a: string;
  /** The key encryption key, raw, base64url (derived; unwraps the vault key). */
  k: string;
  /** This phone's row in the account's device list (Remove device on the Mac deletes it). */
  d: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function cleanPayload(x: unknown): LinkPayload | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const u = typeof o.u === "string" ? o.u.trim() : "";
  if (o.v !== 1 || !u || u.length > 120 || /[\u0000-\u001f\u007f]/.test(u)) return null;
  if (typeof o.a !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(o.a)) return null;
  if (typeof o.k !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(o.k)) return null;
  if (typeof o.d !== "string" || !UUID.test(o.d)) return null;
  return { v: 1, u, a: o.a, k: o.k, d: o.d };
}

/** Mac, after Allow: the sign in, sealed to the phone that claimed the offer. */
export async function sealForPhone(m: MacSide, phonePub: string, p: LinkPayload): Promise<string> {
  if (!PUB_RE.test(phonePub) || !cleanPayload(p)) throw new Error("PS could not seal the sign in for that phone.");
  const t = transcript(m.offer, phonePub, m.nonce);
  const key = await boxKey(m.priv, phonePub, t, "encrypt");
  const iv = rnd(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(t) }, key, te.encode(JSON.stringify(p))));
  return `1.${b64url(iv)}.${b64url(ct)}`;
}
/** Phone: open what the Mac sealed. Throws on anything that is not exactly that (wrong key, swapped, damaged). */
export async function openOnPhone(ph: PhoneSide, o: Offer, nonce: string, sealed: string): Promise<LinkPayload> {
  if (!(await revealOk(o, nonce))) throw new Error("The Mac's answer does not match its code.");
  const m = /^1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{40,2000})$/.exec(sealed);
  if (!m) throw new Error("That is not a PS sign in.");
  const t = transcript(o, ph.pub, nonce);
  const key = await boxKey(ph.priv, o.mac, t, "decrypt");
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: unb64url(m[1]), additionalData: te.encode(t) }, key, unb64url(m[2]));
  const p = cleanPayload(JSON.parse(td.decode(pt)));
  if (!p) throw new Error("That is not a PS sign in.");
  return p;
}

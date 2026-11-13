// Cincee Client Vault crypto. Everything runs in the browser with WebCrypto.
//
// passphrase + email --PBKDF2-SHA256 (600k)--> master bits
//   master --HKDF "auth"--> login password sent to Supabase (it never sees the passphrase)
//   master --HKDF "kek" --> KEK (AES-256-GCM) that wraps the random vault key VK
// VK (AES-256-GCM, random)  encrypts the owner's private records and wraps workspace keys
// WK (AES-256-GCM, random, one per client workspace) encrypts that workspace's shared records
// recovery key (256 random bits) --HKDF--> recovery KEK (second wrap of VK) + recovery auth token
// Owner ECDH P-256 keypair: lets the Fireflies edge function seal items only the developer can open.
//
// Every ciphertext is AES-256-GCM with a fresh 96-bit IV and AAD that binds it to its
// record id and scope, so the server cannot swap ciphertexts between records or clients.
import { WORDLIST } from "./wordlist.ts";

const te = new TextEncoder();
const td = new TextDecoder();
export const KDF_ITERS = 600_000;
export const KDF_PARAMS = { alg: "PBKDF2-SHA256", iters: KDF_ITERS, v: 1 };

const subtle = globalThis.crypto.subtle;
type Bytes = Uint8Array<ArrayBuffer>;

export function randomBytes(n: number): Bytes {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function b64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(s: string): Bytes {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export function b64url(u: Uint8Array): string {
  return b64(u).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64url(s: string): Bytes {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  return unb64(p + "===".slice((p.length + 3) % 4));
}
export async function sha256hex(s: string | Uint8Array): Promise<string> {
  const d = new Uint8Array(await subtle.digest("SHA-256", typeof s === "string" ? te.encode(s) : (s as Bytes)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normEmail(email: string) {
  return email.trim().toLowerCase();
}

// The server only ever sees this pseudonymous login id, never the real email.
export async function loginEmail(email: string): Promise<string> {
  const h = await sha256hex("cincee-vault-v1:login:" + normEmail(email));
  return `v-${h.slice(0, 40)}@vault.cincee.app`;
}

async function hkdfBase(bits: ArrayBuffer | Bytes) {
  return subtle.importKey("raw", bits, "HKDF", false, ["deriveBits", "deriveKey"]);
}
function hkdf(info: string, salt: Bytes = new Uint8Array(32)) {
  return { name: "HKDF", hash: "SHA-256", salt, info: te.encode(info) } as HkdfParams;
}
const AES: AesKeyGenParams = { name: "AES-GCM", length: 256 };

export interface Derived {
  authPassword: string; // 43 char base64url, sent to Supabase as the account password
  kek: CryptoKey;       // wraps the vault key
}

// extractableKek: only the PS Mac app asks for it, to keep the derived key in the macOS Keychain.
export async function deriveFromPassphrase(passphrase: string, email: string, iters = KDF_ITERS, extractableKek = false): Promise<Derived> {
  return deriveWithSalt(passphrase, "cincee-vault-v1|" + normEmail(email), iters, extractableKek);
}

// V1.49 (the developer, 12 Nov 2026: "all it needs is the passphrase really"): an account made in PS on a Supabase project of
// the person's own has no username. That project holds exactly one account (vault-auth owner_setup makes only the
// primary owner), so the project's own id, its ref, stands in for the username. It is not secret (it is in the
// project's address) and does not need to be: like the username before, it only makes the PBKDF2 salt and the
// pseudonymous login id unique, here per project. The same PBKDF2-SHA256 600k and HKDF steps as every account.
// Its own "v2 project" labels keep it apart from every username account: a v1 salt always starts
// "cincee-vault-v1|" and a v1 login id hashes "cincee-vault-v1:login:", so no username can ever give the same salt
// or login id as a project account.
const PROJECT_ID = /^([a-z0-9]{20}|http:\/\/(127\.0\.0\.1|localhost):\d{2,5})$/;   // a hosted ref, or a local test server
export function cleanProjectId(id: string): string {
  const v = String(id ?? "").trim().toLowerCase();
  if (!PROJECT_ID.test(v)) throw new Error("This Supabase project has no usable id.");   // fail closed: never an empty salt
  return v;
}
export async function projectLoginEmail(projectId: string): Promise<string> {
  const h = await sha256hex("cincee-vault-v2:login:project:" + cleanProjectId(projectId));
  return `v-${h.slice(0, 40)}@vault.cincee.app`;
}
export async function deriveForProject(passphrase: string, projectId: string, iters = KDF_ITERS, extractableKek = false): Promise<Derived> {
  return deriveWithSalt(passphrase, "cincee-vault-v2|project|" + cleanProjectId(projectId), iters, extractableKek);
}

async function deriveWithSalt(passphrase: string, salt: string, iters: number, extractableKek: boolean): Promise<Derived> {
  const base = await subtle.importKey("raw", te.encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const master = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: te.encode(salt), iterations: iters },
    base, 256,
  );
  const hk = await hkdfBase(master);
  const auth = new Uint8Array(await subtle.deriveBits(hkdf("cincee-vault-v1 auth"), hk, 256));
  const kek = await subtle.deriveKey(hkdf("cincee-vault-v1 kek"), hk, AES, extractableKek, ["encrypt", "decrypt"]);
  return { authPassword: b64url(auth), kek };
}

export interface RecoveryDerived {
  kek: CryptoKey;
  authToken: string;  // proves possession of the recovery key to the edge function
}

export async function deriveFromRecovery(recovery: Bytes): Promise<RecoveryDerived> {
  const hk = await hkdfBase(recovery);
  const kek = await subtle.deriveKey(hkdf("cincee-vault-v1 recovery kek"), hk, AES, false, ["encrypt", "decrypt"]);
  const tok = new Uint8Array(await subtle.deriveBits(hkdf("cincee-vault-v1 recovery auth"), hk, 256));
  return { kek, authToken: b64url(tok) };
}

// Human friendly recovery key: 32 bytes as 13 groups of 4 base32 chars.
const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
export function formatRecovery(bytes: Uint8Array): string {
  let bits = 0, val = 0, out = "";
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join("-");
}
export function parseRecovery(s: string): Bytes {
  const clean = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("That recovery key has a character that is not allowed.");
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  if (out.length < 32) throw new Error("That recovery key is too short.");
  return new Uint8Array(out.slice(0, 32));
}

// ---------- symmetric keys ----------
export async function newAesKey(): Promise<CryptoKey> {
  return subtle.generateKey(AES, true, ["encrypt", "decrypt"]);
}
export async function importAesRaw(raw: Bytes, extractable = false): Promise<CryptoKey> {
  return subtle.importKey("raw", raw, AES, extractable, ["encrypt", "decrypt"]);
}

export async function encryptBytes(key: CryptoKey, data: Bytes, aad: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(aad) }, key, data));
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = 1; // format version
  out.set(iv, 1);
  out.set(ct, 13);
  return b64(out);
}
export async function decryptBytes(key: CryptoKey, blob: string, aad: string): Promise<Bytes> {
  const u = unb64(blob);
  if (u[0] !== 1) throw new Error("Unknown ciphertext version");
  const iv = u.slice(1, 13);
  const ct = u.slice(13);
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv, additionalData: te.encode(aad) }, key, ct));
}
export async function encryptJson(key: CryptoKey, value: unknown, aad: string): Promise<string> {
  return encryptBytes(key, te.encode(JSON.stringify(value)), aad);
}
export async function decryptJson<T = unknown>(key: CryptoKey, blob: string, aad: string): Promise<T> {
  return JSON.parse(td.decode(await decryptBytes(key, blob, aad))) as T;
}

// Wrap = encrypt the raw bytes of an extractable key under another key.
export async function wrapKey(wrapping: CryptoKey, key: CryptoKey, aad: string): Promise<string> {
  const raw = new Uint8Array(await subtle.exportKey("raw", key));
  return encryptBytes(wrapping, raw, aad);
}
export async function unwrapKey(wrapping: CryptoKey, blob: string, aad: string, extractable = false): Promise<CryptoKey> {
  const raw = await decryptBytes(wrapping, blob, aad);
  return importAesRaw(raw, extractable);
}

export const aad = {
  vk: "cincee-vault-v1:vk",
  vkRecovery: "cincee-vault-v1:vk-recovery",
  priv: "cincee-vault-v1:inbox-private-key",
  wk: (ws: string) => `cincee-vault-v1:wk:${ws}`,
  invite: (ws: string, inviteId: string) => `cincee-vault-v1:invite:${ws}:${inviteId}`,
  record: (id: string, ws: string | null) => `cincee-vault-v1:rec:${id}:${ws ?? "owner"}`,
};

// ---------- invites ----------
// The invite secret goes in the URL fragment (#), which browsers never send to servers.
export async function inviteMaterial(secret: Bytes) {
  const hk = await hkdfBase(secret);
  const token = b64url(new Uint8Array(await subtle.deriveBits(hkdf("cincee-vault-v1 invite token"), hk, 256)));
  const key = await subtle.deriveKey(hkdf("cincee-vault-v1 invite wrap"), hk, AES, false, ["encrypt", "decrypt"]);
  return { token, tokenHash: await sha256hex(token), key };
}

// ---------- owner inbox keypair (Fireflies) ----------
export async function newInboxKeypair() {
  const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = b64(new Uint8Array(await subtle.exportKey("spki", kp.publicKey)));
  const pkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", kp.privateKey));
  return { publicKey: pub, privatePkcs8: pkcs8 };
}
export async function importInboxPrivate(pkcs8: Bytes): Promise<CryptoKey> {
  return subtle.importKey("pkcs8", pkcs8, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}
export async function openSealed<T = unknown>(priv: CryptoKey, sealed: string): Promise<T> {
  const s = JSON.parse(sealed) as { v: number; epk: string; iv: string; ct: string };
  const epkRaw = unb64(s.epk);
  const epk = await subtle.importKey("raw", epkRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await subtle.deriveBits({ name: "ECDH", public: epk }, priv, 256);
  const hk = await hkdfBase(shared);
  const key = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: epkRaw, info: te.encode("cincee-inbox-v1") } as HkdfParams,
    hk, AES, false, ["decrypt"],
  );
  const pt = await subtle.decrypt({ name: "AES-GCM", iv: unb64(s.iv) }, key, unb64(s.ct));
  return JSON.parse(td.decode(pt)) as T;
}
// Same scheme as the edge function, used by tests and the "paste a summary" path.
export async function sealTo(publicKeyB64: string, payload: unknown): Promise<string> {
  const pub = await subtle.importKey("spki", unb64(publicKeyB64), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const shared = await subtle.deriveBits({ name: "ECDH", public: pub }, eph.privateKey, 256);
  const epk = new Uint8Array(await subtle.exportKey("raw", eph.publicKey));
  const hk = await hkdfBase(shared);
  const key = await subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: epk, info: te.encode("cincee-inbox-v1") } as HkdfParams,
    hk, AES, false, ["encrypt"],
  );
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(payload))));
  return JSON.stringify({ v: 1, epk: b64(epk), iv: b64(iv), ct: b64(ct) });
}

// ---------- passphrase strength ----------
// Rough entropy estimate. The vault is only as strong as the passphrase, because a
// stolen database could be attacked offline (600k PBKDF2 rounds per guess slows that a lot).
export function passphraseScore(p: string): { bits: number; ok: boolean; hint: string } {
  if (!p) return { bits: 0, ok: false, hint: "Use 4 or more random words, or 14+ characters." };
  const words = p.trim().split(/[\s\-_.]+/).filter((w) => w.length >= 3);
  let pool = 0;
  if (/[a-z]/.test(p)) pool += 26;
  if (/[A-Z]/.test(p)) pool += 26;
  if (/[0-9]/.test(p)) pool += 10;
  if (/[^A-Za-z0-9]/.test(p)) pool += 33;
  const charBits = p.length * Math.log2(Math.max(pool, 1)) * 0.6; // discount for human patterns
  const wordBits = words.length >= 4 ? words.length * 11 : 0;
  const bits = Math.round(Math.max(charBits, wordBits));
  const common = /^(password|passw0rd|qwerty|letmein|cincee|123456)/i.test(p);
  const ok = !common && p.length >= 14 && bits >= 60;
  const hint = ok
    ? bits >= 80 ? "Strong." : "Good. A few more words makes it stronger."
    : p.length < 14 ? "Too short. Use at least 14 characters, ideally 4 or more random words."
    : "Too predictable. Add more random words.";
  return { bits, ok, hint };
}

const WORDS = ("amber anchor apple arrow atlas autumn bamboo banjo basil beacon berry blossom bramble breeze bronze " +
  "cactus camera candle canyon cedar cherry cinnamon citrus clover cobalt comet coral cotton crystal " +
  "cypress dahlia daisy delta denim desert dune ember falcon fern fiesta fig flint forest fossil galaxy " +
  "garnet ginger glacier granite harbor hazel honey horizon indigo iris island ivory jasmine juniper " +
  "kettle lagoon lantern lavender lemon lilac linen lotus lunar magnet mango maple marble meadow melon " +
  "meteor mint mosaic nectar nickel north oasis olive onyx opal orbit orchid pebble pepper pine planet " +
  "plum polar poppy prism quartz quill radish raven reef ribbon river rocket saffron sage salmon satin " +
  "shadow sierra silver sketch sparrow spruce summit sunset tango thistle thunder tiger timber topaz " +
  "tulip tundra velvet violet walnut willow winter yarrow zephyr acorn alpine almond badge bagel ballet " +
  "barley bison bluebell bonfire brook butter cabin cameo canary caramel carbon cello chalk charm " +
  "chestnut cider cliff cocoa compass copper cosmos cricket crown cupcake dawn dolphin dragon drift " +
  "eagle echo elm emerald fable feather fennel firefly fjord flora fudge garden gazelle geyser glimmer " +
  "globe gopher gravel grove gull hammock harvest hedge heron hollow hummus igloo inkwell jade jelly " +
  "jigsaw jungle kayak kiwi koala ladder lake larch lemur lichen lily lodge loom lynx mallow mantis " +
  "marsh meringue mesa mirror molten moss muffin nebula nutmeg oak ocean otter oyster paddle panda " +
  "papaya parsley peach pearl pelican piano pickle pilot pistachio pixel plaza pond puffin pumpkin " +
  "quail quokka rain rapids robin rose ruby rustic sable sail sandal sapphire scarlet seal sequoia " +
  "shell skylark slate").split(" ");
// ---------- three word client logins ----------
// The developer's door button gives each client a login link plus three set words (eg "maple otter rocket").
// The link carries a long random username the client never sees, so guessing the words alone gets
// nobody anywhere, and the words also unlock the link's one-time invite (see wordsSecret).
export function normWords(s: string) { return s.toLowerCase().split(/[^a-z]+/).filter(Boolean).join(" "); }
export function threeWords(): string {
  const out: string[] = [];
  const n = WORDLIST.length, limit = Math.floor(0x100000000 / n) * n;   // no modulo bias
  while (out.length < 3) {
    const r = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
    if (r < limit) { const w = WORDLIST[r % n]; if (!out.includes(w)) out.push(w); }
  }
  return out.join(" ");
}
/** The invite secret is the link's secret mixed with the words, so the link alone cannot be used. */
export async function wordsSecret(linkSecret: Bytes, words: string): Promise<Bytes> {
  const w = new TextEncoder().encode("cincee-vault-v1 words|" + normWords(words));
  const all = new Uint8Array(linkSecret.length + w.length);
  all.set(linkSecret); all.set(w, linkSecret.length);
  return new Uint8Array(await subtle.digest("SHA-256", all));
}
export function randomUsername() { return "c" + b64url(randomBytes(12)); }

// 256 words = 8 bits each; 7 words + 2 digits is about 63 bits before the 600k-round KDF.
export function suggestPassphrase(n = 7): string {
  const out: string[] = [];
  const r = new Uint32Array(n + 1);
  globalThis.crypto.getRandomValues(r);
  for (let i = 0; i < n; i++) out.push(WORDS[r[i] & 255]);
  return out.join("-") + "-" + String(r[n] % 90 + 10);
}

// ---------- passphrase only sign in for accounts made with a username (V1.55) ----------
// The developer, 12 Nov 2026: "make it so people that have created accounts with usernames can still log in ... just make it so
// their passphrase is kind of like their username as well". An account made with a username before V1.49 keeps its
// keys and login id exactly (deriveFromPassphrase(passphrase, username) above, untouched). What is new is a small
// "account hint" on the person's own project: the username, sealed with a key only the passphrase gives, found by a
// token only the passphrase gives. The server keeps sha256(token) and the sealed username, never the username itself
// (accounts/sign in ids stay pseudonymous), and hands the sealed username back only to someone who sends the token.
//
// The token and the key come from the SAME PBKDF2-SHA256 600k master as the project derivation (deriveForProject:
// salt "cincee-vault-v2|project|<ref>"), through their own HKDF labels, so one slow derivation serves both the
// passphrase only sign in and, when that account turns out to be a username one, the hint lookup. authPassword and
// kek here are byte for byte deriveForProject's (tests/passphrase-only.test.ts).
export interface ProjectDerived extends Derived {
  hintToken: string;   // 43 char base64url; proves the passphrase to ps_hint_get (the server stores only its sha256)
  hintKey: CryptoKey;  // AES-256-GCM, seals the username in the hint
}
export async function deriveForProjectWithHint(passphrase: string, projectId: string, iters = KDF_ITERS, extractableKek = false): Promise<ProjectDerived> {
  const base = await subtle.importKey("raw", te.encode(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const master = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: te.encode("cincee-vault-v2|project|" + cleanProjectId(projectId)), iterations: iters },
    base, 256,
  );
  const hk = await hkdfBase(master);
  const auth = new Uint8Array(await subtle.deriveBits(hkdf("cincee-vault-v1 auth"), hk, 256));
  const kek = await subtle.deriveKey(hkdf("cincee-vault-v1 kek"), hk, AES, extractableKek, ["encrypt", "decrypt"]);
  const tok = new Uint8Array(await subtle.deriveBits(hkdf("cincee-vault-v2 hint token"), hk, 256));
  const hintKey = await subtle.deriveKey(hkdf("cincee-vault-v2 hint key"), hk, AES, false, ["encrypt", "decrypt"]);
  return { authPassword: b64url(auth), kek, hintToken: b64url(tok), hintKey };
}
const HINT_AAD = "cincee-vault-v2:hint";
/** What the account writes: the sha256 of its token and its username sealed (padded to 64 so the length says nothing). */
export async function sealHint(d: Pick<ProjectDerived, "hintToken" | "hintKey">, username: string): Promise<{ check: string; sealed: string }> {
  const u = te.encode(username.trim());
  if (!u.length || u.length > 64) throw new Error("That username cannot be kept for passphrase only sign in.");
  const padded = new Uint8Array(65);
  padded[0] = u.length; padded.set(u, 1);
  return { check: await sha256hex(d.hintToken), sealed: await encryptBytes(d.hintKey, padded, HINT_AAD) };
}
/** The username inside a sealed hint, or null (not this passphrase, damaged, or not a hint). */
export async function openHint(d: Pick<ProjectDerived, "hintKey">, sealed: string): Promise<string | null> {
  try {
    const p = await decryptBytes(d.hintKey, sealed, HINT_AAD);
    if (p.length !== 65 || !p[0] || p[0] > 64) return null;
    const name = td.decode(p.subarray(1, 1 + p[0])).trim();
    return name && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
  } catch { return null; }
}

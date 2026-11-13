// Run: node tests/passphrase-only.test.ts  (Node 22.6+ strips types)
// V1.49 (the developer, 12 Nov 2026): PS sign up asks for a passphrase only. Proves:
//  1. accounts made with a username derive EXACTLY the same login id and keys as before V1.49 (golden values were
//     computed from the unchanged code at 6ad42fd, before crypto.ts was touched),
//  2. a passphrase only account derives the same keys on two devices that link the same project,
//  3. the two kinds can never collide, and the project derivation keeps PBKDF2-SHA256 600k plus the same HKDF.
import * as C from "../src/core/crypto.ts";
import * as A from "../src/core/accountid.ts";
import { chooseProject, RED_PROJECT_URL } from "../src/core/project.ts";
import assert from "node:assert/strict";

const raw = async (k: CryptoKey) => C.b64url(new Uint8Array(await crypto.subtle.exportKey("raw", k)));
const LOGIN_RE = /^v-[0-9a-f]{40}@vault\.cincee\.app$/;   // vault-auth EMAIL_RE and invites.for_login check
const ENV_KEY = "sb_publishable_buildsownkey000000000";
// What the Mac shell hands a page linked to someone's own project (fictional ref and key).
const REF = "abcdefghijklmnopqrst";
const ownMac = () => chooseProject("ps", { url: `https://${REF}.supabase.co`, key: "sb_publishable_fictionalkey0000000000" }, RED_PROJECT_URL, ENV_KEY);
const red = chooseProject("ps", null, RED_PROJECT_URL, ENV_KEY);           // The developer's Mac: no project handed in
const web = chooseProject("production", null, RED_PROJECT_URL, ENV_KEY);   // the website
const other = chooseProject("ps", { url: "https://zyxwvutsrqponmlkjihg.supabase.co", key: "sb_publishable_fictionalkey0000000000" }, RED_PROJECT_URL, ENV_KEY);

// ---------- 1. username accounts: unchanged ----------
const GOLDEN_LOGIN: Record<string, string> = {
  "admin": "v-373d333b261df4eb67ae0af7dce2a88c670dd571@vault.cincee.app",
  "Admin ": "v-373d333b261df4eb67ae0af7dce2a88c670dd571@vault.cincee.app",
  "alex.smith": "v-6099064492f435e3c78aa97fa3563c333391c310@vault.cincee.app",
  "friend_01": "v-4069f251ddc4245e6e3c1c4a37084b4f8dbdad6d@vault.cincee.app",
  "someone@example.com": "v-dfabc2374c69219a2202b36bb2c2036e92867f35@vault.cincee.app",
};
const GOLDEN_KEYS = [
  { pass: "fictional-test-passphrase-one", user: "admin", auth: "P_uFkuhoCjjX1rrKXN0Hgo2wbO3egTB3XdpMM6hDp3E", kek: "97pQ70liffvRpRg2oifY8WJKAAt4L8zukO2-4-adMhU" },
  { pass: "fictional test passphrase two", user: "alex.smith", auth: "eh9Z-pv1ZqqYRlmb_mwXgh9q7_QqPScA8C8RlOkg2sY", kek: "hVdcQ6BP2kz4ceAWk_9-2DDFU-RQLdJvgGZev7BtwQk" },
];
for (const [u, want] of Object.entries(GOLDEN_LOGIN)) {
  assert.equal(await C.loginEmail(u), want, `loginEmail(${u}) unchanged`);
  // Whatever project the page is on (the developer's Mac, the website, a friend's own project), a username is a username.
  for (const p of [red, web, ownMac(), other]) assert.equal(await A.accountLogin(u, p), want, `accountLogin(${u}) unchanged on ${p.url}`);
}
for (const g of GOLDEN_KEYS) {
  for (const p of [null, red, web, ownMac()]) {
    const d = await A.accountDerive(g.pass, g.user, p, undefined, true);
    assert.equal(d.authPassword, g.auth, `login password for ${g.user} unchanged`);
    assert.equal(await raw(d.kek), g.kek, `KEK for ${g.user} unchanged`);
  }
}
console.log("ok: username accounts derive the same login ids and keys as before V1.49");

// ---------- 2. passphrase only: stable across devices ----------
assert.equal(A.projectHandle(red), null, "The developer's project never gets a handle (many accounts there)");
assert.equal(A.projectHandle(web), null, "the website never gets a handle");
assert.equal(A.projectHandle(chooseProject("gos", { url: `https://${REF}.supabase.co`, key: "sb_publishable_fictionalkey0000000000" }, RED_PROJECT_URL, ENV_KEY)), null, "the phone app stays on the build's project");
const macA = ownMac(), macB = ownMac();   // first Mac, and a second Mac (or a reinstall) linking the same project
const hA = A.projectHandle(macA)!, hB = A.projectHandle(macB)!;
assert.equal(hA, `ps-project:${REF}`);
assert.equal(hA, hB, "the same handle on every device linked to the project");
const mobile = chooseProject("production", { url: `https://${REF}.supabase.co`, key: "sb_publishable_fictionalkey0000000000" }, RED_PROJECT_URL, ENV_KEY, true);
assert.equal(A.projectHandle(mobile), hA, "the phone's web app linked to the same project gets the same handle");
const PASS = "fictional passphrase only account 1";
const dA = await A.accountDerive(PASS, hA, macA, undefined, true);
const dB = await A.accountDerive(PASS, hB, macB, undefined, true);
assert.equal(dA.authPassword, dB.authPassword, "same login password on both devices");
assert.equal(await raw(dA.kek), await raw(dB.kek), "same KEK on both devices: the vault key unwraps on the second Mac");
assert.equal(await A.accountLogin(hA, macA), await A.accountLogin(hB, macB));
assert.match(await A.accountLogin(hA, macA), LOGIN_RE, "the login id keeps the format vault-auth accepts");
// A wrapped vault key made on Mac A opens on Mac B and not with another passphrase.
const vk = await C.newAesKey();
const wrapped = await C.wrapKey(dA.kek, vk, C.aad.vk);
await C.unwrapKey(dB.kek, wrapped, C.aad.vk);
await assert.rejects(C.unwrapKey((await A.accountDerive(PASS + "x", hB, macB)).kek, wrapped, C.aad.vk), "wrong passphrase fails");
// Nothing about the device: a local test server's address is its id.
const local = chooseProject("ps", { url: "http://127.0.0.1:54321", key: "sb_publishable_fictionalkey0000000000" }, RED_PROJECT_URL, ENV_KEY);
assert.equal(A.projectHandle(local), "ps-project:http://127.0.0.1:54321");
console.log("ok: passphrase only accounts derive the same keys on two devices");

// ---------- 3. never a collision, same strength ----------
const projLogin = await A.accountLogin(hA, macA);
const projKeys = await A.accountDerive(PASS, hA, macA, undefined, true);
for (const u of [hA, REF, `ps-project:${REF}`.toUpperCase(), "admin", ""]) {
  if (u) assert.notEqual(await C.loginEmail(u), projLogin, `no username (${u}) gives the project's login id`);
  if (u) {
    const v1 = await C.deriveFromPassphrase(PASS, u, undefined, true);
    assert.notEqual(v1.authPassword, projKeys.authPassword, `no username (${u}) gives the project's login password`);
    assert.notEqual(await raw(v1.kek), await raw(projKeys.kek), `no username (${u}) gives the project's KEK`);
  }
}
// The handle only counts on its own project: typed on the developer's project, the website or another project it is a plain
// username (v1), so nobody can reach a project account from somewhere else, and no existing username changes meaning.
for (const p of [red, web, other, null]) {
  assert.equal(await A.accountLogin(hA, p), await C.loginEmail(hA), "handle elsewhere = an ordinary username");
  assert.equal((await A.accountDerive(PASS, hA, p)).authPassword, (await C.deriveFromPassphrase(PASS, hA)).authPassword);
}
// Two people with the same passphrase on two projects: different login ids and keys (the salt is per project).
const hO = A.projectHandle(other)!;
assert.notEqual(await A.accountLogin(hO, other), projLogin);
assert.notEqual((await A.accountDerive(PASS, hO, other)).authPassword, projKeys.authPassword);
// The same PBKDF2-SHA256 600,000 rounds and HKDF labels as every account, only the salt differs.
{
  const te = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", te.encode(PASS.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const master = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: te.encode(`cincee-vault-v2|project|${REF}`), iterations: 600_000 }, base, 256);
  const hk = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveBits"]);
  const info = (s: string) => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: te.encode(s) });
  assert.equal(C.b64url(new Uint8Array(await crypto.subtle.deriveBits(info("cincee-vault-v1 auth"), hk, 256))), projKeys.authPassword, "600k PBKDF2 + HKDF auth");
  assert.equal(C.b64url(new Uint8Array(await crypto.subtle.deriveBits(info("cincee-vault-v1 kek"), hk, 256))), await raw(projKeys.kek), "600k PBKDF2 + HKDF kek");
  assert.equal(C.KDF_ITERS, 600_000);
}
// Fail closed: no usable id, no handle (never an empty or made up salt).
assert.equal(A.projectAccountId({ custom: true, ref: null, url: "https://example.com" }), null);
assert.equal(A.projectAccountId({ custom: true, ref: "short", url: "" }), null);
assert.throws(() => C.cleanProjectId(""));
await assert.rejects(C.projectLoginEmail("not a ref"));
console.log("ok: no collisions, same PBKDF2 600k and HKDF");

// ---------- the sign in screen's choice (views/Lock.tsx) ----------
const pick = (o: Partial<Parameters<typeof A.signInUsername>[0]>) => A.signInUsername({ handle: hA, typed: false, typedName: "", remembered: "", ...o });
assert.equal(pick({ handle: null, typedName: "admin" }), "admin", "The developer's project: the typed username, as before");
assert.equal(pick({}), hA, "new Mac, new account: the passphrase alone");
assert.equal(pick({ remembered: hA }), hA, "this Mac remembers the passphrase only account");
assert.equal(pick({ remembered: "alex.smith" }), "alex.smith", "an account made with a username on this Mac: used without asking");
assert.equal(pick({ typed: true, typedName: "alex.smith", remembered: hA }), "alex.smith", "Signed up with a username? wins");
console.log("ok: sign in picks the right account");

// ---------- 4. V1.55: passphrase only sign in for accounts made with a username ----------
// (a) Nothing about any existing account moved: the golden values above still hold (checked again here after the
//     V1.55 code is loaded), and the one derivation the new sign in uses for the passphrase only attempt gives byte for
//     byte the same login password and KEK as deriveForProject (the V1.49 account keeps its keys).
for (const [u, want] of Object.entries(GOLDEN_LOGIN)) assert.equal(await C.loginEmail(u), want);
for (const g of GOLDEN_KEYS) {
  const d = await C.deriveFromPassphrase(g.pass, g.user, undefined, true);
  assert.equal(d.authPassword, g.auth);
  assert.equal(await raw(d.kek), g.kek);
}
// Computed from the unchanged V1.49 code (HEAD 2bdd823's crypto.ts, before V1.55 touched it) and pinned.
const GOLDEN_PROJECT = { pass: "fictional passphrase only account 1", ref: REF,
  login: "v-0fcb164f37108296587b5abb6047b3c3f723df51@vault.cincee.app",
  auth: "qV93MYaAWWy-70hB0w8BAZPlkyWhO16ad_E6wyv97So", kek: "eh2I9u2NwZQI-2iOXqU14aQCj8QUH183THg38BpIbNI" };
assert.equal(await C.projectLoginEmail(REF), GOLDEN_PROJECT.login, "V1.49 passphrase only login id unchanged");
assert.equal(projKeys.authPassword, GOLDEN_PROJECT.auth, "V1.49 passphrase only login password unchanged");
assert.equal(await raw(projKeys.kek), GOLDEN_PROJECT.kek, "V1.49 passphrase only KEK unchanged");
{
  const w = await C.deriveForProjectWithHint(GOLDEN_PROJECT.pass, REF, undefined, true);
  assert.equal(w.authPassword, GOLDEN_PROJECT.auth, "the passphrase only attempt signs in with the V1.49 login password");
  assert.equal(await raw(w.kek), GOLDEN_PROJECT.kek, "and unwraps with the V1.49 KEK");
  assert.match(w.hintToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(w.hintToken, w.authPassword, "the hint token is not the login password");
  // Pinned values: computed once from this code. If they ever change, every hint already written stops matching.
  assert.equal(w.hintToken, "vaDAwLp3ZsAguzRrcQ_ofO0rQHuQlEG8mDksYXs4GXA", "hint token is stable");
}
// (b) The hint: sealed with the passphrase, opened only with the same passphrase, never the plain username on the wire.
{
  const owner = { pass: "fictional test passphrase two", user: "alex.smith" };   // an account made with a username (GOLDEN_KEYS[1])
  const w = await C.deriveForProjectWithHint(owner.pass, REF);
  const h = await C.sealHint(w, owner.user);
  assert.match(h.check, /^[0-9a-f]{64}$/);
  assert.equal(h.check, await C.sha256hex(w.hintToken), "the server keeps only the token's hash");
  assert.ok(!h.sealed.includes(owner.user) && !atob(h.sealed).includes(owner.user), "the username is sealed");
  assert.equal(await C.openHint(w, h.sealed), owner.user, "the same passphrase opens it");
  const wrong = await C.deriveForProjectWithHint(owner.pass + "x", REF);
  assert.notEqual(wrong.hintToken, w.hintToken, "another passphrase finds nothing");
  assert.equal(await C.openHint(wrong, h.sealed), null, "and opens nothing");
  const elsewhere = await C.deriveForProjectWithHint(owner.pass, "zyxwvutsrqponmlkjihg");
  assert.notEqual(elsewhere.hintToken, w.hintToken, "the same passphrase on another project is another token");
  assert.equal(await C.openHint(elsewhere, h.sealed), null);
  // Same length whatever the username (padded to 64), so its length says nothing.
  assert.equal((await C.sealHint(w, "a")).sealed.length, h.sealed.length);
  await assert.rejects(C.sealHint(w, "x".repeat(65)));
  // And then: the username it gives derives EXACTLY the account's old login id and keys.
  const name = (await C.openHint(w, h.sealed))!;
  assert.equal(await A.accountLogin(name, ownMac()), GOLDEN_LOGIN["alex.smith"], "same login id as before V1.49");
  const d = await A.accountDerive(owner.pass, name, ownMac(), undefined, true);
  assert.equal(d.authPassword, GOLDEN_KEYS[1].auth, "same login password");
  assert.equal(await raw(d.kek), GOLDEN_KEYS[1].kek, "same KEK: the same vault key opens, nobody re-encrypts");
}
console.log("ok: V1.55 passphrase only sign in keeps every account's keys, the hint opens only with the passphrase");

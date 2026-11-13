// Run: node tests/crypto.test.ts  (Node 22.6+ strips types)
import * as C from "../src/core/crypto.ts";
import assert from "node:assert/strict";

const t0 = Date.now();
const d1 = await C.deriveFromPassphrase("amber-anchor-apple-arrow-atlas-autumn-42", "admin");
const d2 = await C.deriveFromPassphrase("amber-anchor-apple-arrow-atlas-autumn-42", "ADMIN ");
const d3 = await C.deriveFromPassphrase("amber-anchor-apple-arrow-atlas-autumn-43", "admin");
console.log("KDF 600k x3 ms:", Date.now() - t0);
assert.equal(d1.authPassword, d2.authPassword, "username is case and space insensitive");
assert.notEqual(d1.authPassword, d3.authPassword);
assert.match(d1.authPassword, /^[A-Za-z0-9_-]{43}$/);
assert.match(await C.loginEmail("admin"), /^v-[0-9a-f]{40}@vault\.cincee\.app$/);

// vault key wrap / unwrap, wrong passphrase fails
const vk = await C.newAesKey();
const wrapped = await C.wrapKey(d1.kek, vk, C.aad.vk);
const vk2 = await C.unwrapKey(d1.kek, wrapped, C.aad.vk);
await assert.rejects(C.unwrapKey(d3.kek, wrapped, C.aad.vk), "wrong passphrase must fail");

// record encryption + AAD binding (no swapping between records or workspaces)
const id = crypto.randomUUID(), ws = crypto.randomUUID();
const ct = await C.encryptJson(vk2, { kind: "todo", data: { title: "Gym" } }, C.aad.record(id, null));
assert.deepEqual(await C.decryptJson(vk2, ct, C.aad.record(id, null)), { kind: "todo", data: { title: "Gym" } });
await assert.rejects(C.decryptJson(vk2, ct, C.aad.record(crypto.randomUUID(), null)), "moved to another id must fail");
await assert.rejects(C.decryptJson(vk2, ct, C.aad.record(id, ws)), "moved to a workspace must fail");
const tampered = C.b64(Uint8Array.from(C.unb64(ct), (b, i) => (i === 20 ? b ^ 1 : b)));
await assert.rejects(C.decryptJson(vk2, tampered, C.aad.record(id, null)), "tampering must fail");
const ct2 = await C.encryptJson(vk2, { a: 1 }, "x");
const ct3 = await C.encryptJson(vk2, { a: 1 }, "x");
assert.notEqual(ct2, ct3, "fresh IV every time");

// workspace isolation: another workspace key cannot read
const wkA = await C.newAesKey(), wkB = await C.newAesKey();
const ctA = await C.encryptJson(wkA, { secret: "client A sales" }, C.aad.record(id, ws));
await assert.rejects(C.decryptJson(wkB, ctA, C.aad.record(id, ws)), "client B key cannot open client A data");

// recovery key format round trip
const rec = C.randomBytes(32);
const text = C.formatRecovery(rec);
assert.deepEqual(C.parseRecovery(text.toLowerCase()), rec);
const r1 = await C.deriveFromRecovery(rec);
const wrappedR = await C.wrapKey(r1.kek, vk, C.aad.vkRecovery);
await C.unwrapKey((await C.deriveFromRecovery(C.parseRecovery(text))).kek, wrappedR, C.aad.vkRecovery);

// invite material
const sec = C.randomBytes(32);
const m1 = await C.inviteMaterial(sec), m2 = await C.inviteMaterial(C.unb64url(C.b64url(sec)));
assert.equal(m1.tokenHash, m2.tokenHash);
const wInv = await C.wrapKey(m1.key, wkA, C.aad.invite(ws, id));
await C.unwrapKey(m2.key, wInv, C.aad.invite(ws, id));

// sealed inbox (Fireflies) round trip
const kp = await C.newInboxKeypair();
const priv = await C.importInboxPrivate(kp.privatePkcs8);
const sealed = await C.sealTo(kp.publicKey, { title: "Call", actionItems: "Send apps list" });
assert.deepEqual(await C.openSealed(priv, sealed), { title: "Call", actionItems: "Send apps list" });
const kp2 = await C.newInboxKeypair();
await assert.rejects(C.openSealed(await C.importInboxPrivate(kp2.privatePkcs8), sealed), "other key cannot open");

// passphrase strength
assert.equal(C.passphraseScore("password123").ok, false);
assert.equal(C.passphraseScore(C.suggestPassphrase()).ok, true);
console.log("suggested:", C.suggestPassphrase(), "| all crypto tests passed");

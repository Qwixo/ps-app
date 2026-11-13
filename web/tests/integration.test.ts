// End to end security test against the real Cincee Client Vault backend.
// Usage: SETUP_CODE=<one time code whose sha256 is in setup_codes> node tests/integration.test.ts
// Creates a throwaway owner + two fictional clients, proves the sandbox, then prints the
// ids so the caller can wipe them. Uses fictional data only.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as C from "../src/core/crypto.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(new URL("../.env", import.meta.url), "utf8").trim().split("\n").map((l) => l.split("=")));
const URL_ = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_KEY;
const FN = `${URL_}/functions/v1/vault-auth`;
const mk = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let pass = 0;
const ok = (m: string) => { pass++; console.log("  ok", m); };

async function fn(body: unknown) {
  const r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json", apikey: KEY }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function login(sb: SupabaseClient, user: string, p: string) {
  const d = await C.deriveFromPassphrase(p, user);
  const { data, error } = await sb.auth.signInWithPassword({ email: await C.loginEmail(user), password: d.authPassword });
  if (error) throw error;
  return { uid: data.user!.id, d };
}

const tag = Math.random().toString(36).slice(2, 8);
const OWNER = `test-owner-${tag}`, CA = `test-client-a-${tag}`, CB = `test-client-b-${tag}`;
const PW = "test-" + C.suggestPassphrase();

console.log("1. Public signup is blocked");
{
  const sb = mk();
  const { error } = await sb.auth.signUp({ email: await C.loginEmail("intruder-" + tag), password: "x".repeat(43) });
  assert.ok(error, "public signup must fail");
  ok(`public signup rejected (${error!.message})`);
  const bad = await fn({ action: "owner_setup", code: "wrong-code", email: await C.loginEmail("intruder"), password: "A".repeat(43) });
  assert.equal(bad.status, 403); ok("owner setup with a wrong code rejected");
}

console.log("2. Owner setup");
const owner = mk();
const od = await C.deriveFromPassphrase(PW, OWNER);
{
  const r = await fn({ action: "owner_setup", code: process.env.SETUP_CODE, email: await C.loginEmail(OWNER), password: od.authPassword });
  assert.equal(r.status, 200, JSON.stringify(r.body)); ok("owner created with the setup code");
  const again = await fn({ action: "owner_setup", code: process.env.SETUP_CODE, email: await C.loginEmail("second-" + tag), password: od.authPassword });
  assert.equal(again.status, 409); ok("second owner impossible");
  const resume = await fn({ action: "owner_setup", code: process.env.SETUP_CODE, email: await C.loginEmail(OWNER), password: od.authPassword });
  assert.equal(resume.status, 200); ok("interrupted setup can be resumed by the same owner with the code");
}
const { uid: ownerId } = await login(owner, OWNER, PW);
const VK = await C.newAesKey();
const rec = C.randomBytes(32), rd = await C.deriveFromRecovery(rec);
const kp = await C.newInboxKeypair();
{
  const { error } = await owner.from("user_keys").insert({
    user_id: ownerId, kdf: C.KDF_PARAMS, wrapped_vk: await C.wrapKey(od.kek, VK, C.aad.vk),
    wrapped_vk_recovery: await C.wrapKey(rd.kek, VK, C.aad.vkRecovery), recovery_check: await C.sha256hex(rd.authToken),
    public_key: kp.publicKey, wrapped_private_key: await C.encryptBytes(VK, kp.privatePkcs8, C.aad.priv),
  });
  assert.ifError(error); ok("owner keys stored (wrapped)");
  const after = await fn({ action: "owner_setup", code: process.env.SETUP_CODE, email: await C.loginEmail(OWNER), password: od.authPassword });
  assert.equal(after.status, 409); ok("setup code is dead once the owner keys exist");
  const { data } = await owner.rpc("is_owner"); assert.equal(data, true); ok("is_owner true for owner");
}

console.log("3. Owner creates two client workspaces with separate keys");
async function newWs() {
  const { data, error } = await owner.from("workspaces").insert({}).select("id").single();
  assert.ifError(error);
  const wk = await C.newAesKey();
  const { error: e2 } = await owner.from("workspace_keys").insert({ workspace_id: data!.id, user_id: ownerId, wrapped_key: await C.wrapKey(VK, wk, C.aad.wk(data!.id)) });
  assert.ifError(e2);
  return { ws: data!.id as string, wk };
}
const A = await newWs(), B = await newWs();
async function putRec(sb: SupabaseClient, key: CryptoKey, ws: string | null, payload: unknown) {
  const id = crypto.randomUUID();
  const { error } = await sb.from("records").insert({ id, workspace_id: ws, ct: await C.encryptJson(key, payload, C.aad.record(id, ws)) });
  if (error) throw error;
  return id;
}
const recA = await putRec(owner, A.wk, A.ws, { kind: "project", data: { title: "Fictional A redesign", conv: "1.6%" } });
const recB = await putRec(owner, B.wk, B.ws, { kind: "project", data: { title: "Fictional B CRO", revenue: "$91,000" } });
const recPriv = await putRec(owner, VK, null, { kind: "client", data: { name: "Fictional B", notes: "private" } });
ok("records written: one per client + one owner private");
{
  const { data } = await owner.from("records").select("ct").eq("id", recB).single();
  assert.ok(!JSON.stringify(data).includes("91,000")); ok("server copy is ciphertext only (no plaintext)");
}

console.log("4. Invites and client joins");
async function invite(w: { ws: string; wk: CryptoKey }) {
  const wkx = await C.unwrapKey(VK, (await owner.from("workspace_keys").select("wrapped_key").eq("workspace_id", w.ws).eq("user_id", ownerId).single()).data!.wrapped_key, C.aad.wk(w.ws), true);
  const secret = C.randomBytes(32), m = await C.inviteMaterial(secret), id = crypto.randomUUID();
  const { error } = await owner.from("invites").insert({ id, workspace_id: w.ws, token_hash: m.tokenHash, wrapped_key: await C.wrapKey(m.key, wkx, C.aad.invite(w.ws, id)), expires_at: new Date(Date.now() + 864e5).toISOString() });
  assert.ifError(error);
  return { id, m };
}
async function join(user: string, inv: { id: string; m: Awaited<ReturnType<typeof C.inviteMaterial>> }) {
  const d = await C.deriveFromPassphrase(PW, user);
  const r = await fn({ action: "client_join", inviteId: inv.id, token: inv.m.token, email: await C.loginEmail(user), password: d.authPassword });
  return r;
}
const invA = await invite(A), invB = await invite(B);
{
  const bad = await fn({ action: "client_join", inviteId: invA.id, token: "wrong", email: await C.loginEmail("x" + tag), password: "A".repeat(43) });
  assert.equal(bad.status, 403); ok("invite with wrong token rejected");
  const ra = await join(CA, invA); assert.equal(ra.status, 200, JSON.stringify(ra.body)); ok("client A joined");
  const rb = await join(CB, invB); assert.equal(rb.status, 200); ok("client B joined");
  const reuse = await join("thief-" + tag, invA); assert.equal(reuse.status, 403); ok("used invite cannot be reused by someone else");
  const hijack = await fn({ action: "client_join", inviteId: invA.id, token: invA.m.token, email: await C.loginEmail(OWNER), password: "B".repeat(43) });
  assert.equal(hijack.status, 403); ok("invite cannot take over the owner account");
  const cross = await join(CB, invA); assert.notEqual(cross.status, 200); ok("client B cannot use client A's invite");
  // client A unwraps its key
  var wkA = await C.unwrapKey(invA.m.key, ra.body.wrappedKey, C.aad.invite(A.ws, invA.id));
}

console.log("5. Client A sandbox: tries everything");
const ca = mk();
const { uid: aId } = await login(ca, CA, PW);
{
  const { data: own } = await ca.rpc("is_owner"); assert.equal(own, false); ok("is_owner false for a client");
  const { data: all } = await ca.from("records").select("id, workspace_id");
  assert.deepEqual((all || []).map((r) => r.id), [recA]); ok("client A sees ONLY its own record");
  const { data: b } = await ca.from("records").select("*").eq("id", recB); assert.equal(b?.length, 0); ok("client A cannot fetch client B record by id");
  const { data: p } = await ca.from("records").select("*").eq("id", recPriv); assert.equal(p?.length, 0); ok("client A cannot fetch the owner's private records");
  const { data: wsl } = await ca.from("workspaces").select("id"); assert.deepEqual((wsl || []).map((w) => w.id), [A.ws]); ok("client A sees only its own workspace");
  const { data: keys } = await ca.from("workspace_keys").select("*"); assert.equal((keys || []).length, 0); ok("client A cannot read anyone's wrapped keys");
  const { data: uk } = await ca.from("user_keys").select("user_id"); assert.ok((uk || []).every((k) => k.user_id === aId)); ok("client A cannot read the owner key material");
  const { data: inv } = await ca.from("invites").select("*"); assert.equal((inv || []).length, 0); ok("client A cannot read invites");
  const { data: mem } = await ca.from("members").select("*"); assert.ok((mem || []).every((m) => m.user_id === aId)); ok("client A cannot list other members");
  const { data: log } = await ca.from("access_log").select("*"); assert.equal((log || []).length, 0); ok("client A cannot read the sign-in log");
  const { data: inbox } = await ca.from("inbox").select("*"); assert.equal((inbox || []).length, 0); ok("client A cannot read the Fireflies inbox");
  const { data: owners } = await ca.from("app_owner").select("*"); assert.equal((owners || []).length, 0); ok("client A cannot read the owner table");

  const forged = crypto.randomUUID();
  const { error: insB } = await ca.from("records").insert({ id: forged, workspace_id: B.ws, ct: "x" });
  assert.ok(insB); ok("client A cannot write into client B workspace");
  const { error: insP } = await ca.from("records").insert({ id: crypto.randomUUID(), workspace_id: null, ct: "x" });
  assert.ok(insP); ok("client A cannot write owner private records");
  const { data: upd } = await ca.from("records").update({ ct: "tampered" }).eq("id", recA).select();
  assert.equal((upd || []).length, 0); ok("client A cannot edit records the developer wrote");
  const { data: upB } = await ca.from("records").update({ ct: "tampered" }).eq("id", recB).select();
  assert.equal((upB || []).length, 0); ok("client A cannot edit client B records");
  const { error: steal } = await ca.from("records").upsert({ id: recB, workspace_id: A.ws, ct: "x" }).select();
  const { data: stillB } = await owner.from("records").select("workspace_id, ct").eq("id", recB).single();
  assert.equal(stillB!.workspace_id, B.ws); assert.notEqual(stillB!.ct, "x"); ok(`client A cannot move or overwrite client B record (${steal ? "rejected" : "no effect"})`);
  const { error: delA } = await ca.from("records").delete().eq("id", recA);
  const { data: stillA } = await owner.from("records").select("id").eq("id", recA);
  assert.equal(stillA?.length, 1); ok(`client A cannot delete records${delA ? "" : " (no effect)"}`);
  const { error: wsIns } = await ca.from("workspaces").insert({}); assert.ok(wsIns); ok("client A cannot create workspaces");
  const { error: memIns } = await ca.from("members").insert({ workspace_id: B.ws, user_id: aId }); assert.ok(memIns); ok("client A cannot add itself to client B");
  const { error: wkIns } = await ca.from("workspace_keys").insert({ workspace_id: B.ws, user_id: aId, wrapped_key: "x" }); assert.ok(wkIns); ok("client A cannot plant a key for client B");
  const { error: red } = await ca.rpc("redeem_invite", { invite: invB.id, token: "guess" }); assert.ok(red); ok("client A cannot redeem client B invite without its secret");

  // own record: decrypts with A's key, and B's ciphertext does not decrypt with A's key
  const { data: mine } = await ca.from("records").select("id, workspace_id, ct").eq("id", recA).single();
  const pt = await C.decryptJson<{ data: { title: string } }>(wkA!, mine!.ct, C.aad.record(mine!.id, mine!.workspace_id));
  assert.equal(pt.data.title, "Fictional A redesign"); ok("client A decrypts its own data");
  const { data: bct } = await owner.from("records").select("id, workspace_id, ct").eq("id", recB).single();
  await assert.rejects(C.decryptJson(wkA!, bct!.ct, C.aad.record(bct!.id, bct!.workspace_id)));
  ok("even with client B's ciphertext in hand, client A's key cannot decrypt it");

  // client authored approval is allowed in its own workspace
  const appr = await putRec(ca, wkA!, A.ws, { kind: "approval", data: { stageKey: "pick" } });
  ok("client A can record its own approval");
  const { data: ownerSees } = await owner.from("records").select("id, author_id").eq("id", appr).single();
  assert.equal(ownerSees!.author_id, aId); ok("approval is stamped with client A as author (cannot be forged)");
}

console.log("6. Anonymous visitor");
{
  const anon = mk();
  for (const t of ["records", "workspaces", "workspace_keys", "user_keys", "invites", "members", "inbox", "access_log", "app_owner", "setup_codes"]) {
    const { data } = await anon.from(t).select("*").limit(1);
    assert.equal((data || []).length, 0, t);
  }
  ok("anonymous visitor reads nothing from any table");
}

console.log("7. Owner sees everything and the sign-in log");
{
  const { data } = await owner.from("records").select("id");
  assert.equal(data!.length, 4); ok("owner sees all 4 records");
  const { data: log } = await owner.from("access_log").select("user_id");
  const who = new Set((log || []).map((l) => l.user_id));
  assert.ok(who.has(ownerId) && who.has(aId)); ok(`sign-in log recorded the owner and client A logins (${(log || []).length} entries)`);
}

console.log("8. Owner recovery with the recovery key");
{
  const nd = await C.deriveFromPassphrase(PW + "-new", OWNER);
  const wrong = await fn({ action: "owner_recover", email: await C.loginEmail(OWNER), recoveryAuth: "nope", password: nd.authPassword });
  assert.equal(wrong.status, 403); ok("recovery with a wrong key rejected");
  const r = await fn({ action: "owner_recover", email: await C.loginEmail(OWNER), recoveryAuth: rd.authToken, password: nd.authPassword });
  assert.equal(r.status, 200); ok("recovery with the right key resets the login");
  const viaClient = await fn({ action: "owner_recover", email: await C.loginEmail(CA), recoveryAuth: rd.authToken, password: nd.authPassword });
  assert.equal(viaClient.status, 403); ok("recovery cannot be used on a client account");
}

console.log(`\nALL ${pass} SECURITY CHECKS PASSED`);
console.log(JSON.stringify({ cleanup: { owner: ownerId, workspaces: [A.ws, B.ws] } }));

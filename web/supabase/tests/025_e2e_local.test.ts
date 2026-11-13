// End to end on a LOCAL Supabase copy only (127.0.0.1, never the live vault): vault-auth, owner invites, client invites.
// Needs: migrations 001 to 025 on the local copy, `supabase functions serve --no-verify-jwt` with vault-auth, ANON=<local anon key>.
// Run: ANON=... node --experimental-strip-types supabase/tests/025_e2e_local.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as C from "../../src/core/crypto.ts";

const URL_ = "http://127.0.0.1:54321";
if (!URL_.startsWith("http://127.0.0.1")) throw new Error("local only");
const ANON = process.env.ANON!;
const psql = (q: string) => execFileSync("docker", ["exec", "-i", "supabase_db_ps-accounts-test", "psql", "-U", "postgres", "-d", "postgres", "-tAq", "-c", q]).toString().trim();
let n = 0;
const ok = (what: string) => { n++; console.log("ok -", what); };

async function auth(body: Record<string, unknown>) {
  const r = await fetch(`${URL_}/functions/v1/vault-auth`, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => ({})) as Record<string, unknown> };
}
async function login(user: string, pass: string) {
  const email = await C.loginEmail(user);
  const d = await C.deriveFromPassphrase(pass, user);
  return { email, password: d.authPassword };
}
async function signIn(l: { email: string; password: string }) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON }, body: JSON.stringify(l) });
  const j = await r.json() as { access_token?: string; refresh_token?: string; user?: { id: string } };
  return r.ok ? { token: j.access_token!, refresh: j.refresh_token!, id: j.user!.id } : null;
}
async function rest(token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${token}`, Prefer: "return=representation", ...(init.headers || {}) } });
  return { status: r.status, j: await r.json().catch(() => null) };
}
const rpc = (token: string, fn: string, args: object = {}) => rest(token, `rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });

// ---------- The developer (primary owner) through owner_setup ----------
const red = await login("admin-test", "correct horse battery staple red");
psql(`insert into public.setup_codes values ('${await C.sha256hex("SETUP-1")}', now() + interval '1 hour')`);
assert.equal((await auth({ action: "owner_setup", code: "SETUP-1", ...red })).status, 200); ok("The developer created through owner_setup");
const redS = (await signIn(red))!;
psql(`insert into public.user_keys (user_id, kdf, wrapped_vk, wrapped_vk_recovery, recovery_check) values ('${redS.id}', '{}', 'x', 'y', 'z')`);
assert.equal((await rpc(redS.token, "vault_role")).j, "red"); ok("The developer's role is red");

// ---------- owner invite ----------
const token = C.b64url(C.randomBytes(32));
const inv = await rpc(redS.token, "create_owner_invite", { p_token_hash: await C.sha256hex(token) });
assert.equal(inv.status, 200); const invId = inv.j as string; ok("The developer makes an owner invite");

const bad = await auth({ action: "owner_join", inviteId: invId, token: C.b64url(C.randomBytes(32)), ...red });
assert.equal(bad.status, 403); ok("a wrong secret with the developer's username says only 'not valid' (no username probing)");
const take = await auth({ action: "owner_join", inviteId: invId, token, ...(await login("admin-test", "attacker passphrase here")) });
assert.equal(take.status, 409); assert.ok(await signIn(red), "The developer can still sign in"); ok("a real invite cannot take over the developer's username or reset his password");

const olga = await login("olga", "olga long passphrase number one");
const j1 = await auth({ action: "owner_join", inviteId: invId, token, ...olga });
assert.equal(j1.status, 200, JSON.stringify(j1.j)); ok("Olga joins as a new owner");
const j2 = await auth({ action: "owner_join", inviteId: invId, token, ...(await login("mallory", "mallory passphrase long one")) });
assert.equal(j2.status, 403); ok("the same link never works twice (replay)");
const j3 = await auth({ action: "owner_join", inviteId: invId, token, ...(await login("olga", "a different passphrase entirely")) });
assert.equal(j3.status, 200); assert.equal(j3.j.resumed, true);
assert.ok(await signIn(olga), "Olga's own passphrase still works"); assert.equal(await signIn(await login("olga", "a different passphrase entirely")), null);
ok("resuming an interrupted join never changes the password");

const olgaS = (await signIn(olga))!;
assert.equal((await rpc(olgaS.token, "vault_role")).j, "owner"); ok("Olga's role is owner, not red");
assert.notEqual((await rpc(olgaS.token, "create_owner_invite", { p_token_hash: "a".repeat(64) })).status, 200); ok("Olga cannot make owner invites");
assert.deepEqual((await rpc(olgaS.token, "list_owner_invites")).j, []); ok("Olga lists no owner invites");
const ow = await rest(olgaS.token, "workspaces", { method: "POST", body: JSON.stringify({ owner_id: redS.id }) });
assert.equal(ow.status, 201); assert.equal((ow.j as { owner_id: string }[])[0].owner_id, olgaS.id); ok("Olga's workspace is hers even when she claims the developer's id");
const redWs = (await rest(redS.token, "workspaces?select=id")).j as { id: string }[];
assert.ok(!redWs.some((w) => w.id === (ow.j as { id: string }[])[0].id)); ok("The developer does not see Olga's workspace");

// ---------- client invites ----------
const ws = ((await rest(redS.token, "workspaces", { method: "POST", body: "{}" })).j as { id: string }[])[0].id;
async function clientInvite(forWho: string | null) {
  const secret = C.randomBytes(32); const m = await C.inviteMaterial(secret); const id = crypto.randomUUID();
  const r = await rest(redS.token, "invites", { method: "POST", body: JSON.stringify({ id, workspace_id: ws, token_hash: m.tokenHash, wrapped_key: "wk", expires_at: new Date(Date.now() + 864e5).toISOString(), for_login: forWho ? await C.loginEmail(forWho) : null }) });
  assert.equal(r.status, 201, JSON.stringify(r.j));
  return { id, token: m.token };
}
const cat = await login("cat@example.com", "cat long passphrase one two");
const i1 = await clientInvite("cat@example.com");
assert.equal((await auth({ action: "client_join", inviteId: i1.id, token: i1.token, ...cat })).status, 200); ok("Cat joins the developer's workspace");
assert.equal((await auth({ action: "client_join", inviteId: i1.id, token: i1.token, ...(await login("cat@example.com", "attacker one two three")) })).status, 403); ok("replaying Cat's used link cannot reset her password");
assert.ok(await signIn(cat));
const i2 = await clientInvite(null);
assert.equal((await auth({ action: "client_join", inviteId: i2.id, token: i2.token, ...(await login("cat@example.com", "attacker one two three")) })).status, 409); ok("a spare link made for nobody cannot reset Cat");
const i2b = await clientInvite("dan@example.com");
assert.equal((await auth({ action: "client_join", inviteId: i2b.id, token: i2b.token, ...(await login("cat@example.com", "attacker one two three")) })).status, 409); ok("a link made for someone else cannot reset Cat");
const i2c = await clientInvite(null);
assert.equal((await auth({ action: "client_join", inviteId: i2c.id, token: i2c.token, ...olga })).status, 409); assert.ok(await signIn(olga)); ok("a client link cannot touch an owner's account");
const catOld = (await signIn(cat))!;
const i3 = await clientInvite("cat@example.com");
const cat2 = await login("cat@example.com", "cat new passphrase after forgetting");
assert.equal((await auth({ action: "client_join", inviteId: i3.id, token: i3.token, ...cat2 })).status, 200); ok("a fresh link made for Cat resets her forgotten password");
assert.ok(await signIn(cat2)); assert.equal(await signIn(cat), null);
const refresh = await fetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { "Content-Type": "application/json", apikey: ANON }, body: JSON.stringify({ refresh_token: catOld.refresh }) });
assert.ok(!refresh.ok, "old session refresh refused"); ok("the reset ended Cat's old sessions");

const i4 = await clientInvite(null);
for (let k = 0; k < 10; k++) assert.equal((await auth({ action: "client_join", inviteId: i4.id, token: C.b64url(C.randomBytes(32)), ...(await login(`guess${k}`, "guess passphrase long")) })).status, 403);
assert.equal((await auth({ action: "client_join", inviteId: i4.id, token: i4.token, ...(await login("eve@example.com", "eve passphrase long one")) })).status, 403);
ok("10 wrong secrets lock a client invite, even against the right one");

// Olga cannot redeem the developer's client link while signed in
const i5 = await clientInvite(null);
const red5 = await rpc(olgaS.token, "redeem_invite", { invite: i5.id, token: i5.token });
assert.notEqual(red5.status, 200); ok("Olga cannot join the developer's client workspace with a valid link");

console.log(`\n${n} end-to-end checks passed (local copy)`);

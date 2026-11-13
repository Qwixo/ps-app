// vault-auth: the only way an account can be created in the Cincee Client Vault.
// Public signups are blocked by a trigger on auth.users (it needs a 2 minute
// allowance that only this function, as service role, can write). This function
// creates accounts only for (a) the developer, once, with a one-time setup code,
// (b) clients holding a valid invite token, and (c) new owners holding one of the developer's
// one-time owner invites (27 Oct 2026). It also lets any owner reset their login
// with their recovery key. It never sees passphrases or encryption keys: the "password"
// it receives is already a derived auth hash, and every key it stores is wrapped.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const ALLOWED_ORIGINS = [
  "https://cincee.com",
  "https://www.cincee.com",
  "https://web.netlify.app",
  "http://localhost:5173",
  "http://localhost:4173",
  "ps://app", // PS, the Mac app (~/Projects/ps/mac)
];

function cors(origin: string | null) {
  const ok = origin && ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Where PS's tables live. PS's setup (ps-mac Sources/ProjectEngine.swift) writes "ps" on this exact line when it
// installs into a project that already holds someone's own app (7 Nov 2026): then every PS table and function
// is in the schema ps and nothing of PS is in public.
const DB_SCHEMA: string = "public";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false }, db: { schema: DB_SCHEMA } },
);

async function sha256hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const EMAIL_RE = /^v-[0-9a-f]{40}@vault\.cincee\.app$/;
const PASS_RE = /^[A-Za-z0-9_-]{43}$/;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

async function userIdByEmail(email: string): Promise<string | null> {
  const { data, error } = await admin.rpc("vault_user_id_by_email", { e: email });
  if (error) throw error;
  return (data as string | null) ?? null;
}

async function ownerId(): Promise<string | null> {
  const { data } = await admin.from("app_owner").select("user_id").maybeSingle();
  return data?.user_id ?? null;
}

// Owners (the developer included) and the developer's assistant never get their login reset through a client invite.
async function isProtectedAccount(uid: string): Promise<boolean> {
  if (uid === await ownerId()) return true;
  const [{ data: o }, { data: a }] = await Promise.all([
    admin.from("owners").select("user_id").eq("user_id", uid).maybeSingle(),
    admin.from("agents").select("user_id").eq("user_id", uid).maybeSingle(),
  ]);
  return !!(o || a);
}

// The auth.users trigger only lets an account be created if this allowance exists.
async function createVaultUser(email: string, password: string) {
  await admin.from("signup_allowances").upsert({ email, expires_at: new Date(Date.now() + 120_000).toISOString() });
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { vault_invited: "yes" },
  });
  await admin.from("signup_allowances").delete().eq("email", email);
  if (error || !data.user) throw new HttpError(400, error?.message || "Could not create the account.");
  return data.user;
}

class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

async function ownerSetup(b: Record<string, string>) {
  const hash = await sha256hex(String(b.code || "").trim());
  const { data: code } = await admin.from("setup_codes").select("code_hash, expires_at")
    .eq("code_hash", hash).maybeSingle();
  const existing = await ownerId();
  if (existing) {
    // Retry of an interrupted setup: allowed only with the still-valid code, for the same
    // login, and only while the owner has no keys yet (the code is consumed when keys land).
    const { data: k } = await admin.from("user_keys").select("user_id").eq("user_id", existing).maybeSingle();
    const sameLogin = (await userIdByEmail(b.email)) === existing;
    if (k || !code || new Date(code.expires_at) < new Date() || !sameLogin) throw new HttpError(409, "This vault already has an owner.");
    const { error } = await admin.auth.admin.updateUserById(existing, { password: b.password });
    if (error) throw new HttpError(400, error.message);
    return { ok: true, resumed: true };
  }
  if (!code || new Date(code.expires_at) < new Date()) throw new HttpError(403, "Setup code is wrong or has expired.");
  const user = await createVaultUser(b.email, b.password);
  const { error: e2 } = await admin.from("app_owner").insert({ id: true, user_id: user.id });
  if (e2) {
    await admin.auth.admin.deleteUser(user.id);
    throw new HttpError(409, "This vault already has an owner.");
  }
  // The setup code is consumed by a trigger once the owner's keys are stored.
  return { ok: true };
}

const INVITE_BAD = "This invite link is not valid, has been used or has expired. Ask for a new one.";
const HAS_ACCOUNT = "This email already has an account. Sign in first, then open the invite link again.";

// After any password reset, end every session of that account (a reset must lock out whoever had it).
async function endSessions(uid: string) {
  const { error } = await admin.rpc("end_sessions", { p_user: uid });
  if (error) console.error("end_sessions failed");
}

async function clientJoin(b: Record<string, string>) {
  const id = b.inviteId, token = b.token;
  if (!ID_RE.test(id) || !TOKEN_RE.test(token) || !b.email || !b.password) throw new HttpError(400, "Bad request");
  const tokenHash = await sha256hex(token);
  const { data: inv } = await admin.from("invites").select("*").eq("id", id).maybeSingle();
  if (!inv) throw new HttpError(403, INVITE_BAD);
  if (inv.token_hash !== tokenHash) {
    await admin.rpc("invite_failed", { p_id: id });   // 10 wrong secrets (three-word guesses) lock the invite
    throw new HttpError(403, INVITE_BAD);
  }
  // Single use: a used invite never works here again. Someone whose join was interrupted signs in and
  // uses "I already have an account" (redeem_invite, which needs their real login).
  if (inv.used_at || new Date(inv.expires_at) < new Date() || (inv.fail_count ?? 0) >= 10) throw new HttpError(403, INVITE_BAD);
  const uid = await userIdByEmail(b.email);
  if (uid) {
    // A forgotten password: reset ONLY through an unused invite the owner made for exactly this login, never
    // for an owner or the assistant, and never for an account that also belongs to another owner's workspace.
    if (!inv.for_login || inv.for_login !== b.email || await isProtectedAccount(uid)) throw new HttpError(409, HAS_ACCOUNT);
    const { data: ws, error: wsErr } = await admin.from("workspaces").select("owner_id").eq("id", inv.workspace_id).maybeSingle();
    if (wsErr || !ws) throw new HttpError(409, HAS_ACCOUNT);
    const { data: mine, error: mErr } = await admin.from("members").select("workspace_id, workspaces!inner(owner_id)").eq("user_id", uid);
    if (mErr) throw new HttpError(409, HAS_ACCOUNT);
    const other = (mine || []).some((r: { workspaces: { owner_id: string } | { owner_id: string }[] }) => {
      const w = Array.isArray(r.workspaces) ? r.workspaces[0] : r.workspaces;
      return !w || w.owner_id !== ws.owner_id;
    });
    if (other) throw new HttpError(409, HAS_ACCOUNT);
  }
  // Claim it atomically: of two requests with the same link, only one gets past here.
  const { data: claimed, error: ce } = await admin.rpc("claim_client_invite", { p_id: id, p_token_hash: tokenHash });
  if (ce) throw ce;
  if (!claimed) throw new HttpError(403, INVITE_BAD);
  let made: string | null = null;
  try {
    let user = uid;
    if (user) {
      const { error } = await admin.auth.admin.updateUserById(user, { password: b.password });
      if (error) throw new HttpError(400, error.message);
      await endSessions(user);
    } else {
      user = made = (await createVaultUser(b.email, b.password)).id;
    }
    const { error: me } = await admin.from("members").upsert({ workspace_id: inv.workspace_id, user_id: user, role: "client" });
    if (me) throw me;
    const { error: ue } = await admin.from("invites").update({ used_by: user }).eq("id", id);
    if (ue) throw ue;
  } catch (e) {
    if (made) await admin.auth.admin.deleteUser(made);
    await admin.rpc("release_client_invite", { p_id: id });
    throw e;
  }
  return { ok: true, wrappedKey: inv.wrapped_key, workspaceId: inv.workspace_id };
}

// A new owner, from one of the developer's one-time owner invites. The invite is claimed atomically for this one
// attempt (two requests with the same link can never both create an account), then finished or released.
const OWNER_INVITE_BAD = "This invite link is not valid, has been used or has expired. Ask for a new one.";

async function ownerJoin(b: Record<string, string>) {
  const id = b.inviteId, token = b.token;
  if (!ID_RE.test(id) || !TOKEN_RE.test(token) || !b.email || !b.password) throw new HttpError(400, "Bad request");
  const tokenHash = await sha256hex(token);
  // The invite first: without a real one, nothing here says whether a username exists.
  const { data: inv } = await admin.from("owner_invites").select("token_hash, used_by, used_at").eq("id", id).maybeSingle();
  if (!inv || inv.token_hash !== tokenHash) throw new HttpError(403, OWNER_INVITE_BAD);
  const existing = await userIdByEmail(b.email);
  if (existing) {
    // An interrupted join of this same invite (account made, keys not stored yet, under a day ago) just
    // continues: the browser signs in with the passphrase it already set. Nothing is reset, ever.
    const { data: k } = await admin.from("user_keys").select("user_id").eq("user_id", existing).maybeSingle();
    const fresh = inv.used_at && Date.now() - Date.parse(inv.used_at) < 864e5;
    if (inv.used_by === existing && fresh && !k) return { ok: true, resumed: true };
    throw new HttpError(409, "That username is taken. Pick another one.");
  }
  const { data: claimed, error: ce } = await admin.rpc("claim_owner_invite", { p_id: id, p_token_hash: tokenHash });
  if (ce) throw ce;
  if (!claimed) throw new HttpError(403, OWNER_INVITE_BAD);
  let user;
  try {
    user = await createVaultUser(b.email, b.password);
  } catch (e) {
    await admin.rpc("release_owner_invite", { p_id: id });
    if (e instanceof HttpError && /already|registered|exists/i.test(e.message)) throw new HttpError(409, "That username is taken. Pick another one.");
    throw e;
  }
  const { data: done, error: fe } = await admin.rpc("finish_owner_invite", { p_id: id, p_user: user.id });
  if (fe || !done) {
    const { error: de } = await admin.auth.admin.deleteUser(user.id);
    if (de) console.error("owner_join cleanup failed");
    await admin.rpc("release_owner_invite", { p_id: id });
    throw new HttpError(403, OWNER_INVITE_BAD);
  }
  return { ok: true };
}

async function isAnyOwner(uid: string): Promise<boolean> {
  if (uid === await ownerId()) return true;
  const { data } = await admin.from("owners").select("user_id").eq("user_id", uid).maybeSingle();
  return !!data;
}

async function ownerRecover(b: Record<string, string>) {
  const uid = await userIdByEmail(b.email);
  if (!uid || !(await isAnyOwner(uid))) throw new HttpError(403, "Recovery failed.");
  const { data: k } = await admin.from("user_keys").select("recovery_check").eq("user_id", uid).maybeSingle();
  const check = await sha256hex(String(b.recoveryAuth || ""));
  if (!k?.recovery_check || k.recovery_check !== check) throw new HttpError(403, "Recovery failed.");
  const { error } = await admin.auth.admin.updateUserById(uid, { password: b.password });
  if (error) throw new HttpError(400, error.message);
  await endSessions(uid);
  return { ok: true };
}

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get("origin")), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
  try {
    const b = await req.json();
    if (typeof b !== "object" || !b || Array.isArray(b)) throw new HttpError(400, "Bad request");
    for (const f of ["action", "email", "password", "inviteId", "token", "code", "recoveryAuth"]) {
      if (b[f] !== undefined && typeof b[f] !== "string") throw new HttpError(400, "Bad request");
    }
    // Every action needs a well-formed login and password.
    if (!EMAIL_RE.test(b.email || "") || !PASS_RE.test(b.password || "")) throw new HttpError(400, "Bad request");
    let out;
    if (b.action === "owner_setup") out = await ownerSetup(b);
    else if (b.action === "client_join") out = await clientJoin(b);
    else if (b.action === "owner_recover") out = await ownerRecover(b);
    else if (b.action === "owner_join") out = await ownerJoin(b);
    else throw new HttpError(400, "Unknown action");
    return new Response(JSON.stringify(out), { headers });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const msg = e instanceof HttpError ? e.message : "Something went wrong";
    if (!(e instanceof HttpError)) console.error(e);
    return new Response(JSON.stringify({ error: msg }), { status, headers });
  }
});

// Multi-owner accounts (27 Oct 2026): who is the developer, owner invite links, and static checks on migration 025.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RED_ONLY, accountKind, canUse, isRedAccount, parseRole } from "../src/core/account.ts";
import { ownerInviteLink, ownerInviteState, parseOwnerInvite, publicBase } from "../src/core/ownerInvite.ts";
import { RED_PROJECT_URL, chooseProject, setActiveProject } from "../src/core/project.ts";

// These checks are about accounts on the developer's own project (other projects: tests/own-project.test.ts).
setActiveProject(chooseProject("production", undefined, RED_PROJECT_URL, "k"));

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const ID = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const TOKEN = "A".repeat(20) + "b-_" + "9".repeat(20);   // 43 base64url characters

ok("vault_role answers map to role and red, unknown is the safe client", () => {
  assert.deepEqual(parseRole("red"), { role: "owner", red: true });
  assert.deepEqual(parseRole("owner"), { role: "owner", red: false });
  assert.deepEqual(parseRole("client"), { role: "client", red: false });
  for (const v of [null, undefined, "", "RED", true, 1, {}]) assert.deepEqual(parseRole(v), { role: "client", red: false });
});

ok("only the developer's unlocked account is the developer", () => {
  assert.equal(accountKind({ status: "unlocked", role: "owner", red: true }), "red");
  assert.equal(accountKind({ status: "unlocked", role: "owner", red: false }), "owner");
  assert.equal(accountKind({ status: "unlocked", role: "client", red: true }), "client", "a client is never the developer, whatever the flag says");
  assert.equal(accountKind({ status: "locked", role: "owner", red: true }), null);
  assert.equal(accountKind({ status: "busy", role: null, red: false }), null);
  assert.equal(isRedAccount({ status: "unlocked", role: "owner", red: true }), true);
  assert.equal(isRedAccount({ status: "unlocked", role: "owner", red: false }), false);
  assert.equal(isRedAccount({ status: "locked", role: "owner", red: true }), false);
});

ok("developer-only features are off for every other owner and client", () => {
  const red = { status: "unlocked" as const, role: "owner" as const, red: true };
  const other = { status: "unlocked" as const, role: "owner" as const, red: false };
  const client = { status: "unlocked" as const, role: "client" as const, red: false };
  for (const f of RED_ONLY) {
    assert.equal(canUse(red, f), true, f);
    assert.equal(canUse(other, f), false, f);
    assert.equal(canUse(client, f), false, f);
  }
  for (const f of ["gmail", "mailcards", "telegram", "fireflies", "radar", "followupCard", "instantly", "brief", "claude", "airpods", "backgroundVideos", "secondComputer"]) {
    assert.ok((RED_ONLY as readonly string[]).includes(f), `${f} is on the developer-only list`);
  }
  // Everyone's since 7 Nov 2026: meetings come from the person's own Mac Calendar.
  assert.ok(!(RED_ONLY as readonly string[]).includes("meetingAlerts"), "meeting alerts are everyone's");
});

ok("owner invite links: built, parsed, and anything else refused", () => {
  const link = ownerInviteLink("https://cincee.com", "/client/", ID, TOKEN);
  assert.equal(link, `https://cincee.com/client/join-owner#${ID}.${TOKEN}`);
  assert.equal(ownerInviteLink("ps://app", "/client/", ID, TOKEN), `https://cincee.com/client/join-owner#${ID}.${TOKEN}`, "PS links point at cincee.com");
  assert.equal(publicBase("http://localhost:5173", "/client/"), "http://localhost:5173/client/");
  assert.deepEqual(parseOwnerInvite(new URL(link).hash), { id: ID, token: TOKEN });
  assert.deepEqual(parseOwnerInvite(`${ID.toUpperCase()}.${TOKEN}`), { id: ID, token: TOKEN });
  for (const bad of ["", "#", `#${ID}`, `#${ID}.`, `#${ID}.${TOKEN}x`, `#${ID}.${TOKEN.slice(1)}`, `#not-a-uuid.${TOKEN}`,
    `#${ID}.${TOKEN.slice(0, 42)}=`, `#${ID}.${TOKEN}.extra`, `#${ID}.${"A".repeat(42)}/`]) {
    assert.equal(parseOwnerInvite(bad), null, bad);
  }
  assert.throws(() => ownerInviteLink("https://cincee.com", "/client/", "x", TOKEN));
  assert.throws(() => ownerInviteLink("https://cincee.com", "/client/", ID, "short"));
});

ok("owner invite state: used beats revoked beats expired", () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const base = { id: ID, created_at: "2026-10-25T00:00:00Z", expires_at: "2026-11-01T00:00:00Z", used_at: null, revoked_at: null };
  assert.equal(ownerInviteState(base, now), "open");
  assert.equal(ownerInviteState({ ...base, expires_at: "2026-10-27T12:00:00Z" }, now), "expired");
  assert.equal(ownerInviteState({ ...base, revoked_at: "2026-10-26T00:00:00Z" }, now), "revoked");
  assert.equal(ownerInviteState({ ...base, used_at: "2026-10-26T00:00:00Z", revoked_at: "2026-10-26T01:00:00Z" }, now), "used");
});

// ---------- migration 025, read as text ----------
const sql = readFileSync(new URL("../supabase/migrations/025_multi_owner.sql", import.meta.url), "utf8");
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

ok("025: every function is security definer with an empty search_path, or invoker", () => {
  const fns = [...code.matchAll(/create or replace function public\.(\w+)\([^)]*\)[\s\S]*?\$\$/g)];
  assert.ok(fns.length >= 13, `found ${fns.length} functions`);
  for (const m of fns) assert.match(m[0], /set search_path = ''/, `${m[1]} pins search_path`);
});

ok("025: redemption functions are service role only, the developer's are not callable by anon", () => {
  for (const f of ["claim_owner_invite(uuid, text)", "finish_owner_invite(uuid, uuid)", "release_owner_invite(uuid)",
    "invite_failed(uuid)", "claim_client_invite(uuid, text)", "release_client_invite(uuid)", "end_sessions(uuid)"]) {
    assert.ok(code.includes(`revoke all on function public.${f} from public, anon, authenticated;`), `${f} revoked`);
    assert.ok(code.includes(`grant execute on function public.${f} to service_role;`), `${f} granted to service_role only`);
    assert.ok(!code.includes(`grant execute on function public.${f} to authenticated`), `${f} never granted to users`);
  }
  for (const f of ["create_owner_invite(text)", "revoke_owner_invite(uuid)", "list_owner_invites()", "vault_role()", "is_vault_owner()", "owns_workspace(uuid)"]) {
    assert.ok(code.includes(`revoke all on function public.${f} from public, anon;`), `${f} not callable by anon`);
  }
  for (const f of ["create_owner_invite", "revoke_owner_invite"]) {
    const body = code.slice(code.indexOf(`function public.${f}`)).split("end $$;")[0];
    assert.match(body, /if not public\.is_owner\(\) then raise exception/, `${f} checks it is the developer`);
  }
  assert.match(code.slice(code.indexOf("function public.list_owner_invites")).split("$$;")[0], /where public\.is_owner\(\)/, "list is the developer only");
});

ok("025: new tables have RLS on and nothing granted to anon or users", () => {
  for (const t of ["owners", "owner_invites"]) {
    assert.ok(code.includes(`alter table public.${t} enable row level security;`), `${t} RLS`);
    assert.ok(code.includes(`revoke all on public.${t} from anon, authenticated;`), `${t} revoked`);
    assert.ok(!new RegExp(`create policy [^;]* on public\\.${t}\\b`).test(code), `${t} has no policies`);
  }
});

ok("025: no rewritten policy still trusts is_owner() (the developer) for someone else's rows", () => {
  const policies = [...code.matchAll(/create policy "([^"]+)" on (public|realtime)\.(\w+)[\s\S]*?;/g)];
  assert.ok(policies.length >= 16, `found ${policies.length} policies`);
  // Only the policies that are the developer's on purpose (the assistant table, his private inbox signal) may use is_owner().
  const redOnly = new Set(["agents owner all", "red reads inbox signal"]);
  for (const p of policies) if (!redOnly.has(p[1])) assert.ok(!/is_owner\(\)/.test(p[0]), `${p[1]} on ${p[3]} must not use is_owner()`);
  // Private records and files: always the caller's own (author) and only for owners.
  for (const p of policies.filter((x) => x[3] === "records" || x[3] === "blobs")) {
    const nullBranches = [...p[0].matchAll(/workspace_id is null[^)]*\)/g)].map((x) => x[0]);
    for (const b of nullBranches) {
      if (/is_vault_owner/.test(b) && !/insert/.test(p[0])) assert.match(b, /author_id = \(select auth\.uid\(\)\)/, `${p[1]}: private rows are the author's own`);
    }
  }
  // Workspace owners can only make workspaces in their own name.
  assert.match(code, /"workspaces owner insert"[\s\S]*?owner_id = \(select auth\.uid\(\)\)/);
});

ok("025: owners stay out of client workspaces, the assistant stays in the developer's, users cannot edit invites", () => {
  const redeem = code.slice(code.indexOf("function public.redeem_invite")).split("end $$;")[0];
  assert.match(redeem, /if public\.is_vault_owner\(\) then raise exception/);
  assert.match(redeem, /public\.is_agent\(\) and not exists/);
  assert.match(redeem, /fail_count = fail_count \+ 1/, "wrong secrets count");
  assert.ok(!/create policy "invites[^"]*" on public\.invites for (all|update)/.test(code), "no update policy on invites");
  assert.match(code, /"invites owner insert"[\s\S]*?used_at is null and used_by is null and fail_count = 0/);
  assert.match(code, /function public\.agent_can_edit[\s\S]*?join public\.app_owner/);
  const rec = code.slice(code.indexOf('create policy "records update"')).split(";")[0];
  assert.ok(rec.includes("agent_can_edit") && !rec.includes("is_agent()"), "records update uses agent_can_edit");
  assert.match(code, /"access log owner read"[\s\S]*?can_see_signins_of\(user_id\)/);
});

ok("025: storage quota skips the developer, inbox leaves the public change feed, one transaction", () => {
  const q = code.slice(code.indexOf("function public.space_quota_guard")).split("end $$;")[0];
  assert.match(q, /exists \(select 1 from public\.app_owner where user_id = v_owner\) then return new/);
  assert.match(code, /alter publication supabase_realtime drop table public\.inbox/);
  assert.match(code, /alter publication supabase_realtime drop table public\.records/);
  assert.ok(/^begin;$/m.test(code) && /^commit;\s*$/m.test(code), "wrapped in begin/commit");
});

ok("025: the claim is single use, unexpired, unrevoked, hash matched and capped", () => {
  const claim = code.slice(code.indexOf("function public.claim_owner_invite")).split("end $$;")[0];
  for (const part of ["token_hash = p_token_hash", "used_at is null", "revoked_at is null", "expires_at > now()", "owner_cap()", "pg_advisory_xact_lock"]) {
    assert.ok(claim.includes(part), `claim checks ${part}`);
  }
  const finish = code.slice(code.indexOf("function public.finish_owner_invite")).split("end $$;")[0];
  assert.ok(finish.includes("claimed_at is not null") && finish.includes("used_at is null"), "finish needs a live claim");
  assert.ok(finish.includes("owner_cap()") && finish.includes("interval '2 minutes'"), "finish rechecks the cap and claim age");
});

console.log(`\n${n} account checks passed`);

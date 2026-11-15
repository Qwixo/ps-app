// The developer channel's hub function `dev` (PS V1.62), project zxhvchchfrkfqxuyorqo only. Its own function next to
// `squad`, `chat`, `board`, `gym` and `sb`, so none can overwrite another. The rules are in logic.ts (the unit tests run
// the same file); this file only answers HTTP and maps the Store onto the dev_ tables with the service role.
// verify_jwt is off on purpose: the signature is the only credential, there are no cookies or ambient auth.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { serve, Fail, type AgentRow, type DropRow, type EpochRow, type LinkRow, type MemberRow, type MessageRow, type Store, type UpdateRow } from "./logic.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const must = <T,>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Fail(500, "database"); return r.data; };
const AGENT = "id, squad_id, member_id, sign_pub, box_pub, card_ct, card_epoch, linked_at, beat_at, unlinked_at";

const store: Store = {
  async member(id) {
    return must(await db.from("squad_members").select("id, squad_id, sign_pub, left_at, admitted").eq("id", id).maybeSingle()) as MemberRow | null;
  },
  async members(squad) {
    return must(await db.from("squad_members").select("id, squad_id, sign_pub, left_at, admitted").eq("squad_id", squad).limit(200)) as MemberRow[];
  },
  async nonce(key, nonce) {
    const r = await db.from("squad_nonces").insert({ member_key: key, nonce });
    return !r.error;
  },
  async linkInsert(row) { must(await db.from("dev_links").insert(row)); },
  async linksOpen(member, now) {
    const r = await db.from("dev_links").select("id", { count: "exact", head: true }).eq("member_id", member).is("used_at", null).gt("expires_at", now);
    if (r.error) throw new Fail(500, "database");
    return r.count ?? 0;
  },
  async linkTake(hash, now) {
    const rows = must(await db.from("dev_links").update({ used_at: now }).eq("token_hash", hash).is("used_at", null).gt("expires_at", now).select("*")) as LinkRow[];
    return rows[0] ?? null;
  },
  async agentInsert(row) {
    const r = await db.from("dev_agents").insert(row);
    if (r.error && r.error.code === "23505") return false;
    if (r.error) throw new Fail(500, "database");
    return true;
  },
  async agent(id) { return must(await db.from("dev_agents").select(AGENT).eq("id", id).maybeSingle()) as AgentRow | null; },
  async agents(squad) { return must(await db.from("dev_agents").select(AGENT).eq("squad_id", squad).limit(200)) as AgentRow[]; },
  async agentPatch(id, patch) { must(await db.from("dev_agents").update(patch).eq("id", id)); },
  async epochLatest(squad) {
    return must(await db.from("dev_epochs").select("squad_id, epoch, agents, created_at").eq("squad_id", squad).order("epoch", { ascending: false }).limit(1).maybeSingle()) as EpochRow | null;
  },
  async epochInsert(row, drops) {
    const r = await db.rpc("dev_epoch_put", { p_squad: row.squad_id, p_epoch: row.epoch, p_agents: row.agents, p_drops: drops.map((d) => ({ agent: d.agent_id, sealed: d.sealed })), p_from: drops[0]?.from_agent ?? null });
    if (r.error) throw new Fail(500, "database");
    return r.data === true;
  },
  async drops(agent) { return must(await db.from("dev_keydrops").select("agent_id, squad_id, epoch, sealed, from_agent, created_at").eq("agent_id", agent).order("epoch").limit(500)) as DropRow[]; },
  async messageInsert(row) {
    const r = await db.from("dev_messages").insert(row);
    if (r.error && r.error.code === "23505") return false;
    if (r.error) throw new Fail(500, "database");
    return true;
  },
  async messagesSent(agent, after) {
    const r = await db.from("dev_messages").select("id", { count: "exact", head: true }).eq("agent_id", agent).gt("created_at", after);
    if (r.error) throw new Fail(500, "database");
    return r.count ?? 0;
  },
  async messages(squad, eps, since, limit) {
    let q = db.from("dev_messages").select("id, squad_id, agent_id, epoch, ct, created_at").eq("squad_id", squad).in("epoch", eps);
    if (since) q = q.gt("created_at", since);
    const rows = must(await q.order("created_at", { ascending: false }).limit(limit)) as MessageRow[];
    return rows.reverse();
  },
  async update(id) { return must(await db.from("dev_updates").select("*").eq("id", id).maybeSingle()) as UpdateRow | null; },
  async updatePut(row) { must(await db.from("dev_updates").upsert(row)); },
  async updates(squad, eps, since) {
    let q = db.from("dev_updates").select("*").eq("squad_id", squad).in("epoch", eps);
    q = since ? q.gt("updated_at", since) : q.eq("open", true);
    return must(await q.order("updated_at").limit(500)) as UpdateRow[];
  },
  async tidy() { await db.rpc("dev_tidy"); },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { ...CORS, "Content-Type": "application/json" } });
  const r = await serve(store, await req.text());
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
});

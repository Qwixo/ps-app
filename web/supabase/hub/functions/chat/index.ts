// G Squad chat hub function (V1.40), project zxhvchchfrkfqxuyorqo only. Its own function next to the core's `squad`,
// so the two are deployed apart and never overwrite each other. Same door rules as `squad`:
//
// Every request is signed on the member's device with their own ECDSA P-256 key (the same key and the same signed
// text as the core, src/core/squadcrypto.ts signRequest). This function checks it against the public key the hub
// holds for that member, refuses requests older than 2 minutes and any nonce seen before (the core's squad_nonces,
// shared, so a request signed for one function can never be replayed to the other), and only then reads or writes
// with the service role. Acts are named c_* so none can be mistaken for a core act. Everything stored is ciphertext,
// public keys, ids, counts and timestamps; it never sees a chat key, a name or a message. verify_jwt is off on purpose.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const te = new TextEncoder();
const CORS = {
  "Access-Control-Allow-Origin": "*",   // no cookies or ambient auth: the signature is the only credential
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const FIRST_LOAD = 200, PAGE = 200;

class Fail extends Error { constructor(public code: number, msg: string) { super(msg); } }
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function sha256hex(s: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function verify(pub: string, act: string, member: string, ts: number, nonce: string, args: unknown, sig: string) {
  const bodyHash = await sha256hex(JSON.stringify(args ?? null));
  const text = `gsquad-v1|${act}|${member}|${ts}|${nonce}|${bodyHash}`;
  try {
    const k = await crypto.subtle.importKey("raw", unb64(pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k, unb64(sig), te.encode(text));
  } catch { return false; }
}
const ct = (v: unknown, max = 6000) => { if (typeof v !== "string" || !v || v.length > max || !B64.test(v)) throw new Fail(400, "bad ciphertext"); return v; };
const int = (v: unknown, lo: number, hi: number) => { if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) throw new Fail(400, "bad number"); return v as number; };
const uuid = (v: unknown) => { if (typeof v !== "string" || !UUID.test(v)) throw new Fail(400, "bad id"); return v.toLowerCase(); };
// Kept as sent (Postgres keeps microseconds; rounding to milliseconds would leave a read message counted as unread).
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?(Z|[+-]\d\d:\d\d)$/;
const iso = (v: unknown) => (typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const must = <T,>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Fail(500, "database"); return r.data; };
/** A database step that may refuse on purpose (raise 'epoch', 'slow', 'vote', 'drops'): its word, else 500. */
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const r = await db.rpc(name, args);
  if (r.error) {
    const m = /\b(epoch|slow|vote|drops|member)\b/.exec(r.error.message)?.[1];
    throw new Fail(m === "slow" ? 429 : m === "member" ? 403 : m ? 409 : 500, m === "member" ? "not a member" : m || "database");
  }
  return r.data as T;
}
const drops = (v: unknown, withEpoch: boolean) => (Array.isArray(v) ? v.slice(0, 64) : []).map((d: Record<string, unknown>) => {
  if (typeof d?.sealed !== "string" || d.sealed.length > 600) throw new Fail(400, "drop");
  return withEpoch ? { epoch: int(d.epoch, 1, 1e6), sealed: d.sealed } : { member: uuid(d.member), sealed: d.sealed };
});

type Me = { id: string; squad_id: string; sign_pub: string };

async function handle(body: Record<string, unknown>) {
  const act = String(body.act || ""), member = String(body.member ?? ""), ts = Number(body.ts), nonce = String(body.nonce || ""), sig = String(body.sig || "");
  const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;
  if (!/^c_[a-z]{2,10}$/.test(act) || !/^[A-Za-z0-9_-]{16,32}$/.test(nonce) || !B64.test(sig) || sig.length > 200) throw new Fail(400, "bad request");
  if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > 120) throw new Fail(401, "clock");
  // V1.57 invite only (invite_001_invite_only.sql): someone asking to join (not let in yet) is not a member here.
  const me = must(await db.from("squad_members").select("id, squad_id, sign_pub").eq("id", uuid(member)).is("left_at", null).eq("admitted", true).maybeSingle()) as Me | null;
  if (!me) throw new Fail(403, "not a member");
  if (!(await verify(me.sign_pub, act, member, ts, nonce, body.args ?? null, sig))) throw new Fail(401, "signature");
  const used = await db.from("squad_nonces").insert({ member_key: await sha256hex(me.sign_pub), nonce });
  if (used.error) throw new Fail(409, "replay");
  if (Math.random() < 0.01) await db.rpc("chat_tidy");

  switch (act) {
    // The cheap look (every 2 minutes while PS runs): period, new period due, unread, newest change, votes, history to hand over.
    case "c_tick":
      return await rpc("chat_status", { p_member: me.id });

    // The chat's data, change only. since: rows changed after it (null = the newest 200). before: 200 older ones.
    case "c_pull": {
      const since = iso(args.since), before = iso(args.before);
      const now = new Date().toISOString();
      const status = await rpc<Record<string, unknown>>("chat_status", { p_member: me.id });
      // Your keys: every one on a full load, then only ones handed to you since (a new period, or history after a yes).
      const all = must(await db.from("chat_keydrops").select("epoch, sealed, created_at").eq("member_id", me.id).order("epoch").limit(500)) as { epoch: number; created_at: string }[];
      const eps = all.map((d) => d.epoch);
      const myDrops = since && !before ? all.filter((d) => Date.parse(d.created_at) > Date.parse(since)) : before ? [] : all;
      let msgs: unknown[] = [];
      if (eps.length) {
        let q = db.from("chat_messages").select("id, member_id, epoch, ct, edited, deleted, created_at, updated_at").eq("squad_id", me.squad_id).in("epoch", eps);
        if (before) q = q.lt("created_at", before).eq("deleted", false).order("created_at", { ascending: false }).limit(PAGE);
        else if (since) q = q.gt("updated_at", since).order("updated_at").limit(500);
        else q = q.eq("deleted", false).order("created_at", { ascending: false }).limit(FIRST_LOAD);
        msgs = must(await q) as unknown[];
      }
      let mq = db.from("squad_members").select("id, sign_pub, box_pub, card_ct, card_gen, joined_at, left_at, updated_at").eq("squad_id", me.squad_id).eq("admitted", true).limit(100);
      if (since && !before) mq = mq.gt("updated_at", since);
      const members = before ? [] : must(await mq);
      return { now, status, drops: myDrops, members, msgs, more: !since && msgs.length >= (before ? PAGE : FIRST_LOAD) };
    }

    case "c_post": {
      const text = ct(args.ct);
      return await rpc("chat_post", { p_member: me.id, p_id: uuid(args.id), p_epoch: int(args.epoch, 1, 1e6), p_ct: text });
    }
    // Edit or delete: your own messages only (the author is the signed member, nobody else can).
    case "c_edit": {
      const r = must(await db.from("chat_messages").update({ ct: ct(args.ct), edited: true, updated_at: new Date().toISOString() })
        .eq("id", uuid(args.id)).eq("member_id", me.id).eq("deleted", false).select("id")) as unknown[];
      if (!r.length) throw new Fail(404, "no message");
      return { ok: true };
    }
    case "c_del": {
      must(await db.from("chat_messages").update({ ct: "", deleted: true, edited: false, updated_at: new Date().toISOString() })
        .eq("id", uuid(args.id)).eq("member_id", me.id).eq("deleted", false));
      return { ok: true };
    }
    case "c_read": {
      const at = iso(args.at);
      if (!at || Date.parse(at) > Date.now() + 5_000) throw new Fail(400, "at");
      const have = must(await db.from("chat_reads").select("read_at").eq("member_id", me.id).maybeSingle()) as { read_at: string } | null;
      if (!have || Date.parse(have.read_at) <= Date.parse(at)) must(await db.from("chat_reads").upsert({ member_id: me.id, read_at: at }));
      return { ok: true };
    }
    case "c_rotate":
      return await rpc("chat_rotate", { p_member: me.id, p_from: int(args.from, 0, 1e6), p_drops: drops(args.drops, false) });
    case "c_ballot":
      if (typeof args.yes !== "boolean") throw new Fail(400, "yes");
      return await rpc("chat_ballot", { p_member: me.id, p_vote: uuid(args.vote), p_yes: args.yes });
    case "c_give":
      return await rpc("chat_give", { p_member: me.id, p_vote: uuid(args.vote), p_drops: drops(args.drops, true) });
  }
  throw new Fail(400, "unknown act");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const text = await req.text();
  if (text.length > 100_000) return json({ error: "too big" }, 413);
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object") throw new Fail(400, "bad request");
    return json(await handle(body));
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.code);
    return json({ error: "bad request" }, 400);
  }
});

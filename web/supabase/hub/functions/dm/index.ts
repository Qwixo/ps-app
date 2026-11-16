// G Squad direct messages, group chats and pictures hub function (PS 1.65), project zxhvchchfrkfqxuyorqo only. Its own
// function next to `squad` and `chat` (the main squad chat is untouched), so deploying it changes nothing for them.
// Same door rules as `chat`:
//
// Every request is signed on the member's device with their own ECDSA P-256 key (the same key and the same signed
// text as the core, src/core/squadcrypto.ts signRequest). This function checks it against the public key the hub
// holds for that member, refuses requests older than 2 minutes and any nonce seen before (the core's squad_nonces,
// shared, so a request signed for one function can never be replayed to the other), and only then reads or writes
// with the service role. Acts are named d_*. Everything stored is ciphertext, ids, counts and timestamps (it knows who is in a
// conversation, never a key, a name, a title, a message or a picture). verify_jwt is off on purpose.
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
const FIRST_LOAD = 200, PAGE = 200, AVATAR_PAGE = 60;
// Best effort per instance, on top of the database limits: 120 calls a minute per member.
const hits = new Map<string, { n: number; at: number }>();
function limited(member: string) {
  const now = Date.now(), h = hits.get(member);
  if (!h || now - h.at > 60_000) { if (hits.size > 2000) hits.clear(); hits.set(member, { n: 1, at: now }); return; }
  if (++h.n > 120) throw new Fail(429, "slow");
}

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
    const m = /\b(epoch|slow|drops|member|closed)\b/.exec(r.error.message)?.[1];
    throw new Fail(m === "slow" ? 429 : m === "member" ? 403 : m ? 409 : 500, m === "member" ? "not a member" : m || "database");
  }
  return r.data as T;
}
const dropList = (v: unknown) => (Array.isArray(v) ? v.slice(0, 24) : []).map((d: Record<string, unknown>) => {
  if (typeof d?.sealed !== "string" || d.sealed.length > 600 || typeof d?.sig !== "string" || !B64.test(d.sig) || d.sig.length > 200) throw new Fail(400, "drop");
  return { member: uuid(d.member), sealed: d.sealed, sig: d.sig };
});
const ids = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []).map(uuid);
/** The DM conversation id both devices derive (src/core/squaddm.ts dmConvId): the hub checks it so an id cannot be squatted. */
async function dmConvId(squad: string, a: string, b: string) {
  const [x, y] = [a, b].sort();
  const h = await sha256hex(`gsquad-v1:dmconv:${squad}:${x}:${y}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
type Me = { id: string; squad_id: string; sign_pub: string };

async function handle(body: Record<string, unknown>) {
  const act = String(body.act || ""), member = String(body.member ?? ""), ts = Number(body.ts), nonce = String(body.nonce || ""), sig = String(body.sig || "");
  const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;
  if (!/^d_[a-z]{2,10}$/.test(act) || !/^[A-Za-z0-9_-]{16,32}$/.test(nonce) || !B64.test(sig) || sig.length > 200) throw new Fail(400, "bad request");
  if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > 120) throw new Fail(401, "clock");
  const me = must(await db.from("squad_members").select("id, squad_id, sign_pub").eq("id", uuid(member)).is("left_at", null).eq("admitted", true).maybeSingle()) as Me | null;
  if (!me) throw new Fail(403, "not a member");
  if (!(await verify(me.sign_pub, act, member, ts, nonce, body.args ?? null, sig))) throw new Fail(401, "signature");
  limited(me.id);
  const used = await db.from("squad_nonces").insert({ member_key: await sha256hex(me.sign_pub), nonce });
  if (used.error) throw new Fail(409, "replay");
  if (Math.random() < 0.01) await db.rpc("dm_tidy");   // gated inside: runs once a day, bounded deletes

  switch (act) {
    // The cheap look (every 2 minutes while PS runs): every conversation with its epoch, newest message time, unread; the pictures' newest change.
    case "d_tick":
      return await rpc("dm_status", { p_member: me.id });

    // One conversation's data, change only. since: rows changed after it (null = the newest 200). before: 200 older ones.
    case "d_pull": {
      const conv = uuid(args.conv), since = iso(args.since), before = iso(args.before);
      const now = new Date().toISOString();
      const c = await rpc<Record<string, unknown>>("dm_access", { p_member: me.id, p_conv: conv });
      // The same list the rekey check uses (dm_in: not removed, still in the squad), so a member who left the squad is left out on both sides.
      const people = await rpc<string[]>("dm_in", { p_conv: conv });
      let eps: number[] | null = null, myDrops: unknown[] = [], epochs: unknown[] = [];
      if (c.kind === "group") {
        const all = must(await db.from("dm_keydrops").select("epoch, sealed, sig, created_at").eq("conv_id", conv).eq("member_id", me.id).order("epoch").limit(500)) as { epoch: number; created_at: string }[];
        eps = all.map((d) => d.epoch);
        myDrops = since && !before ? all.filter((d) => Date.parse(d.created_at) > Date.parse(since)) : before ? [] : all;
        const want = (myDrops as { epoch: number }[]).map((d) => d.epoch);
        if (want.length) epochs = must(await db.from("dm_epochs").select("epoch, signer, creator, members, title_ct").eq("conv_id", conv).in("epoch", want).order("epoch").limit(500)) as unknown[];
      }
      let msgs: unknown[] = [];
      if (eps === null || eps.length) {
        let q = db.from("dm_messages").select("id, member_id, epoch, ct, edited, deleted, created_at, updated_at").eq("conv_id", conv);
        if (eps) q = q.in("epoch", eps);
        if (before) q = q.lt("created_at", before).eq("deleted", false).order("created_at", { ascending: false }).limit(PAGE);
        else if (since) q = q.gt("updated_at", since).order("updated_at").limit(500);
        else q = q.eq("deleted", false).order("created_at", { ascending: false }).limit(FIRST_LOAD);
        msgs = must(await q) as unknown[];
      }
      const conv_ = { id: conv, kind: c.kind, epoch: c.epoch, title_ct: c.kind === "group" ? c.title_ct : null };
      return { now, conv: conv_, people, drops: myDrops.map((d) => ({ epoch: (d as { epoch: number }).epoch, sealed: (d as { sealed: string }).sealed, sig: (d as { sig: string }).sig })), epochs, msgs, more: !since && msgs.length >= (before ? PAGE : FIRST_LOAD) };
    }

    case "d_new": {
      const kind = args.kind === "group" ? "group" : args.kind === "dm" ? "dm" : "";
      if (!kind) throw new Fail(400, "kind");
      const others = ids(args.others, 24);
      const id = uuid(args.id);
      if (kind === "dm") {
        if (others.length !== 1 || others[0] === me.id || id !== (await dmConvId(me.squad_id, me.id, others[0]))) throw new Fail(400, "bad id");
      }
      const title = kind === "group" ? ct(args.title, 400) : null;
      return await rpc("dm_new", { p_member: me.id, p_id: id, p_kind: kind, p_others: others, p_title: title, p_drops: kind === "group" ? dropList(args.drops) : [] });
    }
    case "d_change":
      return await rpc("dm_change", { p_member: me.id, p_conv: uuid(args.conv), p_add: ids(args.add, 23), p_remove: args.remove ? uuid(args.remove) : null });
    case "d_rotate":
      return await rpc("dm_rotate", { p_member: me.id, p_conv: uuid(args.conv), p_from: int(args.from, 1, 1e6), p_drops: dropList(args.drops), p_title: args.title ? ct(args.title, 400) : null });
    case "d_post":
      return await rpc("dm_post", { p_member: me.id, p_conv: uuid(args.conv), p_id: uuid(args.id), p_epoch: int(args.epoch, 1, 1e6), p_ct: ct(args.ct) });

    // Edit or delete: your own messages only, in a conversation you are still in.
    case "d_edit": case "d_del": {
      const conv = uuid(args.conv);
      if (act === "d_edit") {
        // Only into the epoch now (the row moves to it), so new text is never under a key a removed member holds.
        const r = await rpc<{ ok: boolean }>("dm_edit", { p_member: me.id, p_conv: conv, p_id: uuid(args.id), p_epoch: int(args.epoch, 1, 1e6), p_ct: ct(args.ct) });
        if (!r.ok) throw new Fail(404, "no message");
        return { ok: true };
      }
      await rpc("dm_access", { p_member: me.id, p_conv: conv });
      const patch = { ct: "", deleted: true, edited: false, updated_at: new Date().toISOString() };
      must(await db.from("dm_messages").update(patch).eq("id", uuid(args.id)).eq("conv_id", conv).eq("member_id", me.id).eq("deleted", false).select("id"));
      return { ok: true };
    }
    case "d_read": {
      const conv = uuid(args.conv), at = iso(args.at);
      if (!at || Date.parse(at) > Date.now() + 5_000) throw new Fail(400, "at");
      await rpc("dm_access", { p_member: me.id, p_conv: conv });
      const have = must(await db.from("dm_reads").select("read_at").eq("conv_id", conv).eq("member_id", me.id).maybeSingle()) as { read_at: string } | null;
      if (!have || Date.parse(have.read_at) <= Date.parse(at)) must(await db.from("dm_reads").upsert({ conv_id: conv, member_id: me.id, read_at: at }));
      return { ok: true };
    }

    // Pictures of the squad, change only.
    case "d_apull": {
      // updated_at >= since (not >): rows that share the timestamp at a page edge are never skipped; the device ignores a row it already holds.
      const since = iso(args.since);
      let q = db.from("dm_avatars").select("member_id, ct, gen, updated_at").eq("squad_id", me.squad_id).order("updated_at").order("member_id").limit(AVATAR_PAGE);
      if (since) q = q.gte("updated_at", since);
      const rows = must(await q) as unknown[];
      return { rows, more: rows.length >= AVATAR_PAGE };   // a full page: ask again from its last time
    }
    case "d_aset": {
      const text = args.clear === true ? "" : ct(args.ct, 70_000);
      return await rpc("dm_avatar_set", { p_member: me.id, p_ct: text, p_gen: int(args.gen ?? 1, 1, 1e6) });
    }
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

// G Squad board function (V1.40), project zxhvchchfrkfqxuyorqo only: the Leaderboard and Screen time cards.
// Its own function (not more acts in `squad`) so the chats adding to the hub never overwrite each other's code.
//
// The same signed request model as `squad`: every request is signed on the member's device with that member's
// own ECDSA P-256 key; this function checks it against the public key the hub holds for that member (a member
// still in the squad), refuses requests older than 2 minutes and any nonce seen before (its own table), and only
// then reads or writes with the service role. It stores ciphertext, ids, fingerprints and times; it never sees an
// amount, a count or a screen time. verify_jwt is off on purpose: the signature is the check.
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
const KINDS = new Set(["money", "tasks", "screen"]);

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
const ct = (v: unknown) => { if (typeof v !== "string" || !v || v.length > 4000 || !B64.test(v)) throw new Fail(400, "bad ciphertext"); return v; };
const int = (v: unknown, lo: number, hi: number) => { if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) throw new Fail(400, "bad number"); return v as number; };
const kind = (v: unknown) => { if (typeof v !== "string" || !KINDS.has(v)) throw new Fail(400, "bad kind"); return v; };
const must = <T,>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Fail(500, "database"); return r.data; };

type Me = { id: string; squad_id: string; sign_pub: string };

async function handle(body: Record<string, unknown>) {
  const act = String(body.act || ""), member = String(body.member ?? ""), ts = Number(body.ts), nonce = String(body.nonce || ""), sig = String(body.sig || "");
  const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;
  if (!/^board_[a-z]{2,10}$/.test(act) || !/^[A-Za-z0-9_-]{16,32}$/.test(nonce) || !B64.test(sig) || sig.length > 200) throw new Fail(400, "bad request");
  if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > 120) throw new Fail(401, "clock");
  if (typeof member !== "string" || !UUID.test(member)) throw new Fail(403, "not a member");
  const me = must(await db.from("squad_members").select("id, squad_id, sign_pub").eq("id", member.toLowerCase()).is("left_at", null).maybeSingle()) as Me | null;
  if (!me) throw new Fail(403, "not a member");
  if (!(await verify(me.sign_pub, act, member, ts, nonce, body.args ?? null, sig))) throw new Fail(401, "signature");
  const used = await db.from("board_nonces").insert({ member_key: await sha256hex(me.sign_pub), nonce });
  if (used.error) throw new Fail(409, "replay");
  if (Math.random() < 0.02) await db.rpc("board_tidy");

  switch (act) {
    // Your own cards' fingerprints, so a device only sends what changed.
    case "board_mine":
      return { rows: must(await db.from("board_cards").select("kind, fp").eq("member_id", me.id).eq("deleted", false)) };
    // New or changed cards (at most the three kinds), sealed under a gen the squad has.
    case "board_put": {
      const rows = Array.isArray(args.rows) ? args.rows : [];
      if (!rows.length || rows.length > 3) throw new Fail(400, "rows");
      const sq = must(await db.from("squads").select("gen").eq("id", me.squad_id).maybeSingle()) as { gen: number } | null;
      if (!sq) throw new Fail(404, "no squad");
      const now = new Date().toISOString();
      const clean = rows.map((r: Record<string, unknown>) => {
        if (typeof r.fp !== "string" || !/^[0-9a-f]{16,64}$/.test(r.fp)) throw new Fail(400, "fp");
        return { member_id: me.id, kind: kind(r.kind), squad_id: me.squad_id, ct: ct(r.ct), gen: int(r.gen, 1, sq.gen), fp: r.fp, deleted: false, updated_at: now };
      });
      if (new Set(clean.map((r) => r.kind)).size !== clean.length) throw new Fail(400, "rows");
      must(await db.from("board_cards").upsert(clean));
      return { ok: true };
    }
    // A piece switched off: its card goes (a tombstone, so the others' change-only pulls see it go).
    case "board_del": {
      const kinds = (Array.isArray(args.kinds) ? args.kinds : []).slice(0, 3).map(kind);
      if (kinds.length) must(await db.from("board_cards").update({ deleted: true, ct: "", fp: "", updated_at: new Date().toISOString() })
        .eq("member_id", me.id).in("kind", kinds).eq("deleted", false));
      return { ok: true };
    }
    // The squad's cards: all of them the first time, then only what changed since (only while the pop-up is open).
    case "board_pull": {
      const since = typeof args.since === "string" && !Number.isNaN(Date.parse(args.since)) ? args.since : null;
      const now = new Date().toISOString();
      const ins = must(await db.from("squad_members").select("id").eq("squad_id", me.squad_id).is("left_at", null)) as { id: string }[];
      let q = db.from("board_cards").select("member_id, kind, ct, gen, deleted, updated_at").eq("squad_id", me.squad_id)
        .in("member_id", ins.map((r) => r.id)).order("updated_at").limit(300);
      q = since ? q.gt("updated_at", since) : q.eq("deleted", false);
      return { now, rows: must(await q) };
    }
  }
  throw new Fail(400, "unknown act");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const text = await req.text();
  if (text.length > 40_000) return json({ error: "too big" }, 413);
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object") throw new Fail(400, "bad request");
    return json(await handle(body));
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.code);
    return json({ error: "bad request" }, 400);
  }
});

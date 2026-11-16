// G Squad Feature requests function (PS 1.65, the Settings assistant; migration featreq_001_requests.sql). The hub project only.
// Its own function (not more acts in `squad` or `board`) so nothing that already runs changes. A request is what a person typed and
// which part of Settings they were in, sealed with the squad key on their own device: this function stores the ciphertext and the
// key's generation, never the words.
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
const LIVE_MAX = 50;   // live requests per member: more is refused (taken back ones do not count)

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
const uuid = (v: unknown) => { if (typeof v !== "string" || !UUID.test(v)) throw new Fail(400, "bad id"); return v.toLowerCase(); };
const must = <T,>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Fail(500, "database"); return r.data; };

type Me = { id: string; squad_id: string; sign_pub: string };

async function handle(body: Record<string, unknown>) {
  const act = String(body.act || ""), member = String(body.member ?? ""), ts = Number(body.ts), nonce = String(body.nonce || ""), sig = String(body.sig || "");
  const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;
  if (!/^fr_[a-z]{2,10}$/.test(act) || !/^[A-Za-z0-9_-]{16,32}$/.test(nonce) || !B64.test(sig) || sig.length > 200) throw new Fail(400, "bad request");
  if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > 120) throw new Fail(401, "clock");
  if (typeof member !== "string" || !UUID.test(member)) throw new Fail(403, "not a member");
  const me = must(await db.from("squad_members").select("id, squad_id, sign_pub").eq("id", member.toLowerCase()).is("left_at", null).eq("admitted", true).maybeSingle()) as Me | null;
  if (!me) throw new Fail(403, "not a member");
  if (!(await verify(me.sign_pub, act, member, ts, nonce, body.args ?? null, sig))) throw new Fail(401, "signature");
  const used = await db.from("featreq_nonces").insert({ member_key: await sha256hex(me.sign_pub), nonce });
  if (used.error) throw new Fail(409, "replay");
  if (Math.random() < 0.02) await db.rpc("featreq_tidy");

  switch (act) {
    // One new request, sealed under a gen the squad has. The same id twice is refused (never overwrites someone's words).
    case "fr_put": {
      const sq = must(await db.from("squads").select("gen").eq("id", me.squad_id).maybeSingle()) as { gen: number } | null;
      if (!sq) throw new Fail(404, "no squad");
      const live = await db.from("featreq_items").select("id", { count: "exact", head: true }).eq("member_id", me.id).eq("deleted", false);
      if (live.error) throw new Fail(500, "database");
      if ((live.count ?? 0) >= LIVE_MAX) throw new Fail(429, "too many");
      const now = new Date().toISOString();
      const ins = await db.from("featreq_items").insert({ id: uuid(args.id), member_id: me.id, squad_id: me.squad_id, ct: ct(args.ct), gen: int(args.gen, 1, sq.gen), created_at: now, updated_at: now });
      if (ins.error) throw new Fail(409, "exists");
      return { ok: true };
    }
    // Undo: only your own, and it leaves a tombstone so the others' change only reads see it go.
    case "fr_del": {
      must(await db.from("featreq_items").update({ deleted: true, ct: "", updated_at: new Date().toISOString() })
        .eq("id", uuid(args.id)).eq("member_id", me.id).eq("deleted", false));
      return { ok: true };
    }
    // The squad's requests: all live ones the first time, then only what changed since. Only on a click in Settings, never on a timer.
    case "fr_pull": {
      const since = typeof args.since === "string" && !Number.isNaN(Date.parse(args.since)) ? args.since : null;
      const now = new Date().toISOString();
      let q = db.from("featreq_items").select("id, member_id, ct, gen, deleted, created_at, updated_at").eq("squad_id", me.squad_id).order("updated_at").limit(200);
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

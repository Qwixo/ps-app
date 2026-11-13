// G Squad Fitness hub function (V1.40), project zxhvchchfrkfqxuyorqo only. The one door to the gym_ tables.
//
// The same signed request model as the core's `squad` function (no hub accounts, no passwords): every request is
// signed on the member's device with that member's own P-256 key, checked here against the public key the hub
// already holds for that member (squad_members, read only), refused when older than 2 minutes or when its nonce was
// seen before. It is its own function so the core's `squad` function is never redeployed by this part of V1.40.
// Everything stored is ciphertext, ids, a short tag, fingerprints and timestamps: never a name, an exercise or a number.
// verify_jwt is off on purpose: the signature is the check.
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
const TAG = /^[0-9a-f]{16}$/;
const FP = /^[0-9a-f]{16,64}$/;
const PARTS = new Set(["sum", "sleep", "ex"]);

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
const ct = (v: unknown, max: number) => { if (typeof v !== "string" || !v || v.length > max || !B64.test(v)) throw new Fail(400, "bad ciphertext"); return v; };
const int = (v: unknown, lo: number, hi: number) => { if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) throw new Fail(400, "bad number"); return v as number; };
const uuid = (v: unknown) => { if (typeof v !== "string" || !UUID.test(v)) throw new Fail(400, "bad id"); return v.toLowerCase(); };
const time = (v: unknown) => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
const must = <T,>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Fail(500, "database"); return r.data; };

type Me = { id: string; squad_id: string; sign_pub: string };
async function squadGen(id: string): Promise<number> {
  const s = must(await db.from("squads").select("gen").eq("id", id).maybeSingle()) as { gen: number } | null;
  if (!s) throw new Fail(404, "no squad");
  return s.gen;
}
type MemberCard = { id: string; card_ct: string | null; card_gen: number | null };
/** Members still in, with their sealed cards (name and public keys: the screens need the names). */
async function membersIn(squad: string): Promise<MemberCard[]> {
  return must(await db.from("squad_members").select("id, card_ct, card_gen").eq("squad_id", squad).is("left_at", null).order("joined_at")) as MemberCard[];
}
const ROW_COLS = "id, member_id, part, tag, ct, gen, deleted, updated_at";
const POST_COLS = "id, member_id, ct, gen, deleted, updated_at";

async function handle(body: Record<string, unknown>) {
  const act = String(body.act || ""), member = String(body.member ?? ""), ts = Number(body.ts), nonce = String(body.nonce || ""), sig = String(body.sig || "");
  const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;
  if (!/^gym_[a-z]{2,12}$/.test(act) || !/^[A-Za-z0-9_-]{16,32}$/.test(nonce) || !B64.test(sig) || sig.length > 200) throw new Fail(400, "bad request");
  if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > 120) throw new Fail(401, "clock");
  const me = must(await db.from("squad_members").select("id, squad_id, sign_pub").eq("id", uuid(member)).is("left_at", null).maybeSingle()) as Me | null;
  if (!me) throw new Fail(403, "not a member");
  if (!(await verify(me.sign_pub, act, member, ts, nonce, body.args ?? null, sig))) throw new Fail(401, "signature");
  const used = await db.from("gym_nonces").insert({ member_key: await sha256hex(me.sign_pub), nonce });
  if (used.error) throw new Fail(409, "replay");
  if (Math.random() < 0.02) await db.rpc("gym_tidy");

  switch (act) {
    case "gym_mine":
      return { rows: must(await db.from("gym_rows").select("id, part, fp").eq("member_id", me.id).eq("deleted", false).limit(500)) };

    case "gym_put": {
      const gen = await squadGen(me.squad_id);
      const rows = Array.isArray(args.rows) ? args.rows : [];
      if (!rows.length || rows.length > 60) throw new Fail(400, "rows");
      const now = new Date().toISOString();
      const clean = rows.map((r: Record<string, unknown>) => {
        if (typeof r.part !== "string" || !PARTS.has(r.part)) throw new Fail(400, "part");
        if (typeof r.fp !== "string" || !FP.test(r.fp)) throw new Fail(400, "fp");
        const tag = r.part === "ex" ? (typeof r.tag === "string" && TAG.test(r.tag) ? r.tag : null) : null;
        if (r.part === "ex" && !tag) throw new Fail(400, "tag");
        return { id: uuid(r.id), squad_id: me.squad_id, member_id: me.id, part: r.part, tag, ct: ct(r.ct, 8000), gen: int(r.gen, 1, gen), fp: r.fp, deleted: false, updated_at: now };
      });
      const taken = must(await db.from("gym_rows").select("id, member_id").in("id", clean.map((r) => r.id))) as { id: string; member_id: string }[];
      if (taken.some((t) => t.member_id !== me.id)) throw new Fail(403, "not yours");
      must(await db.from("gym_rows").upsert(clean));
      return { ok: true, n: clean.length };
    }

    case "gym_del": {
      // By id, or every row of some parts (a switch turned off: nothing of that piece stays on the hub).
      const now = new Date().toISOString();
      const ids = (Array.isArray(args.ids) ? args.ids : []).slice(0, 500).map(uuid);
      const parts = (Array.isArray(args.parts) ? args.parts : []).filter((p): p is string => typeof p === "string" && PARTS.has(p));
      if (ids.length) must(await db.from("gym_rows").update({ deleted: true, ct: "x", updated_at: now }).eq("member_id", me.id).in("id", ids).eq("deleted", false));
      if (parts.length) must(await db.from("gym_rows").update({ deleted: true, ct: "x", updated_at: now }).eq("member_id", me.id).in("part", parts).eq("deleted", false));
      return { ok: true };
    }

    case "gym_pull": {
      // Boards: the sum and sleep rows changed since `r` (all live ones the first time). Posts changed since `p`.
      // A compare screen: the ex rows of up to 8 tags (one exercise, under this gen and the one before), changed since `x`.
      const now = new Date().toISOString();
      const members = await membersIn(me.squad_id);
      const ins = members.map((m) => m.id);
      const r = time(args.r), p = time(args.p), x = time(args.x);
      const tags = (Array.isArray(args.tags) ? args.tags : []).filter((t): t is string => typeof t === "string" && TAG.test(t)).slice(0, 8);
      const wantBoards = args.boards !== false;
      let rq = db.from("gym_rows").select(ROW_COLS).eq("squad_id", me.squad_id).in("part", ["sum", "sleep"]).in("member_id", ins).order("updated_at").limit(200);
      rq = r ? rq.gt("updated_at", r) : rq.eq("deleted", false);
      let pq = db.from("gym_posts").select(POST_COLS).eq("squad_id", me.squad_id).in("member_id", ins).order("updated_at").limit(500);
      pq = p ? pq.gt("updated_at", p) : pq.eq("deleted", false).gt("created_at", new Date(Date.now() - 70 * 864e5).toISOString());
      let xq = tags.length ? db.from("gym_rows").select(ROW_COLS).eq("squad_id", me.squad_id).eq("part", "ex").in("tag", tags).in("member_id", ins).limit(120) : null;
      if (xq) xq = x ? xq.gt("updated_at", x) : xq.eq("deleted", false);
      const [rows, posts, ex, gen] = await Promise.all([wantBoards ? rq : null, wantBoards ? pq : null, xq, squadGen(me.squad_id)]);
      // Sealed member cards (names) only when asked: a screen asks once, then only when someone new shows up.
      const out = args.cards === true ? members : members.map((m) => ({ id: m.id, card_ct: null, card_gen: null }));
      return { now, gen, members: out, rows: rows ? must(rows) : [], posts: posts ? must(posts) : [], ex: ex ? must(ex) : [] };
    }

    case "gym_post": {
      const gen = await squadGen(me.squad_id);
      const id = uuid(args.id);
      const there = must(await db.from("gym_posts").select("member_id").eq("id", id).maybeSingle()) as { member_id: string } | null;
      if (there && there.member_id !== me.id) throw new Fail(403, "not yours");
      if (!there) {
        const day = await db.from("gym_posts").select("id", { count: "exact", head: true }).eq("member_id", me.id).gt("created_at", new Date(Date.now() - 864e5).toISOString());
        if ((day.count ?? 0) >= 300) throw new Fail(429, "too many");
      }
      must(await db.from("gym_posts").upsert({ id, squad_id: me.squad_id, member_id: me.id, ct: ct(args.ct, 1500), gen: int(args.gen, 1, gen), deleted: false, updated_at: new Date().toISOString() }));
      return { ok: true };
    }

    case "gym_unpost": {
      const ids = (Array.isArray(args.ids) ? args.ids : []).slice(0, 200).map(uuid);
      if (ids.length) must(await db.from("gym_posts").update({ deleted: true, ct: "x", updated_at: new Date().toISOString() }).eq("member_id", me.id).in("id", ids).eq("deleted", false));
      return { ok: true };
    }
  }
  throw new Fail(400, "unknown act");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const text = await req.text();
  if (text.length > 400_000) return json({ error: "too big" }, 413);
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object") throw new Fail(400, "bad request");
    return json(await handle(body));
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.code);
    return json({ error: "bad request" }, 400);
  }
});

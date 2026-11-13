// Soundboard sharing hub function (V1.47), project zxhvchchfrkfqxuyorqo only. The one door to the sb_ tables.
//
// The same signed request model as `squad` and `gym` (no hub accounts, no passwords): every request is signed on the
// member's device with that member's own P-256 key, checked here against the public key the hub already holds for
// that member (squad_members, read only), refused when older than 2 minutes or when its nonce was seen before. It is
// its own function so no other hub function is redeployed by the Soundboard.
// Stored: the sound, its name and note sealed with the squad key (ciphertext only), piece counts, sealed sizes, ids,
// timestamps. Free plan limits in sb_001_sounds.sql. verify_jwt is off on purpose: the signature is the check.
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
const PART_MAX = 720_000;          // one sealed piece, base64 (512 KB of sound)
const FILE_MAX = 14_000_000;       // sealed bytes of one file (10 MB of sound)
const SQUAD_FILES = 15, SQUAD_BYTES = 80_000_000, DAY_SHARES = 5;

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
const must = <T,>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Fail(500, "database"); return r.data; };

type Me = { id: string; squad_id: string; sign_pub: string };
type FileRow = { id: string; squad_id: string; member_id: string; parts: number; size: number; done: boolean };
async function squadGen(id: string): Promise<number> {
  const s = must(await db.from("squads").select("gen").eq("id", id).maybeSingle()) as { gen: number } | null;
  if (!s) throw new Fail(404, "no squad");
  return s.gen;
}

async function handle(body: Record<string, unknown>) {
  const act = String(body.act || ""), member = String(body.member ?? ""), ts = Number(body.ts), nonce = String(body.nonce || ""), sig = String(body.sig || "");
  const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;
  if (!/^sb_[a-z]{2,12}$/.test(act) || !/^[A-Za-z0-9_-]{16,32}$/.test(nonce) || !B64.test(sig) || sig.length > 200) throw new Fail(400, "bad request");
  if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > 120) throw new Fail(401, "clock");
  // V1.57 invite only (invite_001_invite_only.sql): someone asking to join (not let in yet) is not a member here.
  const me = must(await db.from("squad_members").select("id, squad_id, sign_pub").eq("id", uuid(member)).is("left_at", null).eq("admitted", true).maybeSingle()) as Me | null;
  if (!me) throw new Fail(403, "not a member");
  if (!(await verify(me.sign_pub, act, member, ts, nonce, body.args ?? null, sig))) throw new Fail(401, "signature");
  const used = await db.from("sb_nonces").insert({ member_key: await sha256hex(me.sign_pub), nonce });
  if (used.error) throw new Fail(409, "replay");
  if (Math.random() < 0.05) await db.rpc("sb_tidy");

  switch (act) {
    // The squad's shared sounds: sealed names and notes, sizes, never the sound itself.
    case "sb_list": {
      const rows = must(await db.from("sb_files").select("id, member_id, meta_ct, gen, parts, size, created_at, expires_at")
        .eq("squad_id", me.squad_id).eq("done", true).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(SQUAD_FILES));
      return { now: new Date().toISOString(), files: rows };
    }

    // Start a share (n 0 carries the sealed name and note) or add a piece. The last piece marks it done.
    case "sb_put": {
      const id = uuid(args.id), n = int(args.n, 0, 23);
      const data = ct(args.data, PART_MAX);
      let f = must(await db.from("sb_files").select("id, squad_id, member_id, parts, size, done").eq("id", id).maybeSingle()) as FileRow | null;
      if (n === 0 && !f) {
        await db.rpc("sb_tidy");
        const gen = await squadGen(me.squad_id);
        const parts = int(args.parts, 1, 24), size = int(args.size, 1, FILE_MAX);
        const day = await db.from("sb_files").select("id", { count: "exact", head: true }).eq("member_id", me.id).gt("created_at", new Date(Date.now() - 864e5).toISOString());
        if ((day.count ?? 0) >= DAY_SHARES) throw new Fail(429, "too many today");
        const live = must(await db.from("sb_files").select("size").eq("squad_id", me.squad_id)) as { size: number }[];
        if (live.length >= SQUAD_FILES || live.reduce((a, r) => a + r.size, 0) + size > SQUAD_BYTES) throw new Fail(409, "squad full");
        must(await db.from("sb_files").insert({ id, squad_id: me.squad_id, member_id: me.id, meta_ct: ct(args.meta, 2000), gen: int(args.gen, 1, gen), parts, size }));
        f = { id, squad_id: me.squad_id, member_id: me.id, parts, size, done: false };
      }
      if (!f || f.member_id !== me.id) throw new Fail(403, "not yours");
      if (f.done || n >= f.parts) throw new Fail(409, "done");
      must(await db.from("sb_parts").upsert({ file_id: id, n, ct: data }));
      if (n === f.parts - 1) {
        const got = must(await db.from("sb_parts").select("n").eq("file_id", id)) as { n: number }[];
        if (got.length !== f.parts) throw new Fail(409, "missing pieces");
        must(await db.from("sb_files").update({ done: true }).eq("id", id));
        return { ok: true, done: true };
      }
      return { ok: true, done: false };
    }

    // One piece of a shared sound (members of the same squad only).
    case "sb_get": {
      const id = uuid(args.id), n = int(args.n, 0, 23);
      const f = must(await db.from("sb_files").select("squad_id, done").eq("id", id).maybeSingle()) as { squad_id: string; done: boolean } | null;
      if (!f || f.squad_id !== me.squad_id || !f.done) throw new Fail(404, "gone");
      const p = must(await db.from("sb_parts").select("ct").eq("file_id", id).eq("n", n).maybeSingle()) as { ct: string } | null;
      if (!p) throw new Fail(404, "gone");
      return { data: p.ct };
    }

    // Take your own share off the hub.
    case "sb_del": {
      const id = uuid(args.id);
      must(await db.from("sb_files").delete().eq("id", id).eq("member_id", me.id));
      return { ok: true };
    }
  }
  throw new Fail(400, "unknown act");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const text = await req.text();
  if (text.length > 800_000) return json({ error: "too big" }, 413);
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object") throw new Fail(400, "bad request");
    return json(await handle(body));
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.code);
    return json({ error: "bad request" }, 400);
  }
});

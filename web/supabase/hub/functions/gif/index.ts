// G Squad GIF hub function (PS 1.63), project zxhvchchfrkfqxuyorqo only. Its own function next to `squad` and `chat`, so
// deploying it touches nothing else. Same door rules as `chat`: every request is signed on the member's device with their
// own ECDSA P-256 key (core/squadcrypto.ts signRequest), checked against the public key the hub holds for that member,
// refused when older than 2 minutes and when its nonce was seen before (the shared squad_nonces table). Only then does it
// ask GIPHY, with the hub secret GIPHY_API_KEY (set by the owner in the function's secrets, never in code), and answer with
// only what the picker needs (logic.ts). Nothing is stored except the nonce rows the other functions also write. No key
// set means "on: false" and the app hides the GIF button. At most 20 asks a minute per member (counted in squad_nonces,
// so it needs no new table). verify_jwt is off on purpose: the signature is the check.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { Fail, allowed, search, type GifOut } from "./logic.ts";

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
const must = <T,>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Fail(500, "database"); return r.data; };
type Me = { id: string; squad_id: string; sign_pub: string };
const cache = new Map<string, { at: number; v: unknown }>();   // the same search a minute later costs nothing

async function handle(body: Record<string, unknown>) {
  const act = String(body.act || ""), member = String(body.member ?? ""), ts = Number(body.ts), nonce = String(body.nonce || ""), sig = String(body.sig || "");
  const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;
  if (!/^g_[a-z]{2,10}$/.test(act) || !/^[A-Za-z0-9_-]{16,32}$/.test(nonce) || !B64.test(sig) || sig.length > 200) throw new Fail(400, "bad request");
  if (!Number.isInteger(ts) || Math.abs(Date.now() / 1000 - ts) > 120) throw new Fail(401, "clock");
  if (!UUID.test(member)) throw new Fail(400, "bad id");
  const me = must(await db.from("squad_members").select("id, squad_id, sign_pub").eq("id", member.toLowerCase()).is("left_at", null).eq("admitted", true).maybeSingle()) as Me | null;
  if (!me) throw new Fail(403, "not a member");
  if (!(await verify(me.sign_pub, act, member, ts, nonce, body.args ?? null, sig))) throw new Fail(401, "signature");
  const key = await sha256hex(me.sign_pub);
  const used = await db.from("squad_nonces").insert({ member_key: key, nonce });
  if (used.error) throw new Fail(409, "replay");
  const giphy = Deno.env.get("GIPHY_API_KEY") || "";

  switch (act) {
    // Is it set up? One cheap answer, no call to GIPHY.
    case "g_status":
      return { on: giphy.length > 0 };

    case "g_search": {
      if (!giphy) return { on: false, items: [], next: null };
      // Rate limit: each ask leaves a marker row in squad_nonces (tidied by the other functions after 10 minutes).
      const since = new Date(Date.now() - 60_000).toISOString();
      const recent = await db.from("squad_nonces").select("nonce", { count: "exact", head: true }).eq("member_key", key).like("nonce", "gif-%").gt("at", since);
      // A count that failed is treated as over the limit (never fail open: a beta GIPHY key has a small hourly limit).
      if (recent.error || typeof recent.count !== "number" || !allowed(recent.count)) throw new Fail(429, "slow");
      await db.from("squad_nonces").insert({ member_key: key, nonce: `gif-${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}` });
      const ck = `${String(args.q ?? "")}|${String(args.pos ?? 0)}`;
      const hit = cache.get(ck);
      if (hit && Date.now() - hit.at < 60_000) return hit.v;
      const out = await search((u, i) => fetch(u, i), giphy, args);
      if (cache.size > 200) cache.clear();
      cache.set(ck, { at: Date.now(), v: out });
      return out as { on: true; items: GifOut[]; next: number | null };
    }
  }
  throw new Fail(400, "unknown act");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const text = await req.text();
  if (text.length > 4_000) return json({ error: "too big" }, 413);
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object") throw new Fail(400, "bad request");
    return json(await handle(body));
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.message }, e.code);
    return json({ error: "bad request" }, 400);
  }
});

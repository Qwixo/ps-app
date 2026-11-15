// instantly-inbox: your last 20 Instantly conversations, as full threads, sealed so only your
// vault can open them. A conversation is a thread where the lead has replied at least once.
// op "poll" (pg_cron every 5 minutes, x-cron-secret) and op "refresh" (the vault's button, owner
// only): lists the newest replies, picks the 20 newest threads, re-reads a thread in full only
// when it has a new reply or was last read over 30 minutes ago (Instantly allows 20 calls a
// minute), and posts one sealed package (source 'instantly2') when anything changed.
// Needs the Supabase secret INSTANTLY_API_KEY (scope emails:read). Without it nothing runs.
// The server keeps only keyed hashes to spot changes, never email text. Read only on Instantly.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const API = "https://api.instantly.ai/api/v2/emails";
const KEEP = 20;              // conversations shown in the vault
const MAX_FETCH = 14;         // thread reads per run (rate limit: 20 calls a minute)
const STALE_MS = 30 * 60_000; // re-read a quiet thread at most every 30 minutes (catches your own replies)
const enc = new TextEncoder();
// Chunked, so large packages never overflow the call stack.
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function seal(publicKeyB64: string, payload: unknown): Promise<string> {
  const pub = await crypto.subtle.importKey("spki", unb64(publicKeyB64), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: pub }, eph.privateKey, 256);
  const epk = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey) as ArrayBuffer);
  const hk = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: epk, info: enc.encode("cincee-inbox-v1") },
    hk, { name: "AES-GCM", length: 256 }, false, ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(payload))));
  return JSON.stringify({ v: 1, epk: b64(epk), iv: b64(iv), ct: b64(ct) });
}
async function sha256hex(s: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

type IEmail = {
  id: string; thread_id?: string; timestamp_email?: string; timestamp_created?: string; ue_type?: number;
  from_address_email?: string; from_address_json?: { name?: string; address?: string }[]; to_address_email_list?: string;
  eaccount?: string; subject?: string; body?: { text?: string; html?: string }; content_preview?: string;
  is_unread?: number; campaign_id?: string; lead?: string;
};

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function htmlToText(h: string) {
  return decode(h.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
const TYPE: Record<number, "sent" | "received" | "manual"> = { 1: "sent", 2: "received", 3: "manual" };
function message(e: IEmail) {
  const t = e.body?.text?.trim() ? e.body.text : e.body?.html ? htmlToText(e.body.html) : e.content_preview || "";
  return {
    iid: e.id, at: e.timestamp_email || e.timestamp_created || null, type: TYPE[e.ue_type ?? 2] || "received",
    from: (e.from_address_email || "").toLowerCase(), fromName: e.from_address_json?.[0]?.name || null,
    to: e.to_address_email_list || null, account: (e.eaccount || "").toLowerCase(),
    subject: e.subject || "(no subject)", text: t.slice(0, 20000), unread: !!e.is_unread,
  };
}

async function api(key: string, params: Record<string, string>): Promise<{ items: IEmail[] }> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${API}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${key}` } });
    if (r.ok) return await r.json();
    if (r.status === 429 && attempt < 2) { await sleep(4000 * (attempt + 1)); continue; }
    const e = await r.json().catch(() => ({}));
    throw new Error(`instantly ${r.status}${e?.message ? ": " + String(e.message).slice(0, 160) : ""}`);
  }
}

async function meta(k: string) {
  const { data } = await admin.from("instantly_meta").select("value").eq("key", k).maybeSingle();
  return data?.value ?? null;
}
async function metas(keys: string[]) {
  const { data } = await admin.from("instantly_meta").select("key, value").in("key", keys);
  return new Map((data || []).map((r) => [r.key as string, r.value as string | null]));
}
async function setMetas(kv: Record<string, string | null>) {
  const at = new Date().toISOString();
  await admin.from("instantly_meta").upsert(Object.entries(kv).map(([key, value]) => ({ key, value, updated_at: at })));
}
// Egress: the cron secret (also the hash key) is read once per warm instance, not on every call.
let secretCache: { v: string; at: number } | null = null;
async function cronSecret() {
  if (!secretCache || Date.now() - secretCache.at > 10 * 60_000) secretCache = { v: (await admin.rpc("instantly_get_config")).data?.cron_secret || "", at: Date.now() };
  return secretCache.v;
}

async function poll(force = false) {
  // The key comes from Supabase Vault (instantly_api_key, via instantly_get_config); the function secret INSTANTLY_API_KEY is the older way.
  const key = (String((await admin.rpc("instantly_get_config")).data?.api_key || "") || Deno.env.get("INSTANTLY_API_KEY") || "").trim();
  if (!key) return { ok: true, skipped: "not connected" };
  const secret = await cronSecret();
  const kh = (s: string) => sha256hex(secret + "|instantly|" + s);
  const m = await metas(["order_hash", "last_ok", "last_error"]);
  try {
    // 1. The newest replies, newest first: their threads, in order, are the conversations.
    const recent = await api(key, { email_type: "received", limit: "100", sort_order: "desc" });
    const order: string[] = [];
    const latest = new Map<string, string>();
    for (const e of recent.items || []) {
      const t = e.thread_id;
      if (!t || latest.has(t)) continue;
      latest.set(t, e.id);
      order.push(t);
      if (order.length >= KEEP) break;
    }
    // 2. Re-read only threads with a new reply, or quiet ones not read for 30 minutes.
    const hashes = await Promise.all(order.map((t) => kh(t)));
    const { data: rows } = await admin.from("instantly_threads").select("h, latest, fetched_at, content_h").in("h", hashes);
    const known = new Map((rows || []).map((r) => [r.h, r]));
    const due = order.map((t, i) => ({ t, h: hashes[i], row: known.get(hashes[i]) }))
      .map((x) => ({ ...x, reason: !x.row || x.row.latest !== latest.get(x.t) ? 2 : Date.now() - Date.parse(x.row.fetched_at) > (force ? 120_000 : STALE_MS) ? 1 : 0 }))
      .filter((x) => x.reason > 0)
      .sort((a, b) => b.reason - a.reason)
      .slice(0, MAX_FETCH);
    const threads = [];
    const fetched: { h: string; latest: string | null; fetched_at: string; content_h: string }[] = [];
    for (const d of due) {
      await sleep(3100);
      const r = await api(key, { search: `thread:${d.t}`, limit: "50", sort_order: "asc" });
      const msgs = (r.items || []).map(message).sort((a, b) => String(a.at).localeCompare(String(b.at)));
      if (!msgs.length) continue;
      const lastIn = [...msgs].reverse().find((m) => m.type === "received");
      const first = msgs[0];
      const leadMsg = lastIn || first;
      // The lead is whoever wrote the replies; the account is your inbox the thread lives in.
      const thread = {
        threadId: d.t, subject: (lastIn || first).subject, lead: (recent.items || []).find((e) => e.thread_id === d.t)?.lead || leadMsg.from,
        leadName: lastIn?.fromName || null, account: first.account,
        lastAt: msgs[msgs.length - 1].at, unread: msgs.some((m) => m.type === "received" && m.unread), messages: msgs,
      };
      // Egress: a re-read thread that did not change is not sealed again (PS would rewrite it for nothing).
      const ch = await kh(JSON.stringify(thread));
      if (ch !== d.row?.content_h) threads.push(thread);
      fetched.push({ h: d.h, latest: latest.get(d.t) ?? null, fetched_at: new Date().toISOString(), content_h: ch });
    }
    // 3. One sealed package when the list or any thread changed.
    const orderHash = await kh(order.join(","));
    const orderChanged = orderHash !== m.get("order_hash");
    let stored = false;
    if (threads.length || orderChanged) {
      const { data: owner } = await admin.from("app_owner").select("user_id").maybeSingle();
      if (!owner) throw new Error("no owner");
      const { data: k } = await admin.from("user_keys").select("public_key").eq("user_id", owner.user_id).maybeSingle();
      if (!k?.public_key) throw new Error("no inbox key");
      const sealed = await seal(k.public_key, { kind: "instantly-threads", at: new Date().toISOString(), order, threads });
      const { error } = await admin.from("inbox").insert({ source: "instantly2", sealed });
      if (error) throw new Error("store failed");
      await setMetas({ order_hash: orderHash });
      stored = true;
    }
    // Only now that the package is stored: remember what was read.
    if (fetched.length) await admin.from("instantly_threads").upsert(fetched);
    // Forget hashes of threads that dropped out of the 20 (the list only changes when its order does).
    if (orderChanged) await admin.from("instantly_threads").delete().not("h", "in", `(${hashes.map((h) => `"${h}"`).join(",") || '""'})`);
    // last_ok at most every 10 minutes from the cron (the refresh button always stamps it).
    const lastOk = m.get("last_ok");
    if (force || m.get("last_error") || !lastOk || Date.now() - Date.parse(lastOk) > 10 * 60_000) await setMetas({ last_ok: new Date().toISOString(), last_error: null });
    return { ok: true, threads: order.length, read: threads.length, stored };
  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 300);
    await setMetas({ last_error: msg });
    return { ok: false, error: msg };
  }
}

// The vault's refresh button calls this from the browser: answer only your own sites.
// Your own site address(es) come from the secret PS_SITE_ORIGINS (comma separated, for example https://example.com).
const EXTRA_ORIGINS = (Deno.env.get("PS_SITE_ORIGINS") || "").split(",").map((x) => x.trim()).filter((x) => /^https:\/\/[a-z0-9.-]+$/i.test(x));
const ALLOWED_ORIGINS = [...EXTRA_ORIGINS, "http://localhost:5173"];
function withCors(res: Response, origin: string | null) {
  const ok = !!origin && ALLOWED_ORIGINS.includes(origin);
  res.headers.set("Access-Control-Allow-Origin", ok ? origin! : ALLOWED_ORIGINS[0]);
  res.headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Vary", "Origin");
  return res;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return withCors(new Response("ok"), req.headers.get("origin"));
  return withCors(await handle(req), req.headers.get("origin"));
});

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let body: { op?: string };
  try { body = await req.json(); } catch { return json({ error: "bad body" }, 400); }
  try {
    if (body.op === "refresh") {
      // The vault's refresh button: only you (the owner), at most every 30 seconds.
      const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const { data: u } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
      const { data: owner } = await admin.from("app_owner").select("user_id").maybeSingle();
      if (!u?.user || !owner || u.user.id !== owner.user_id) return json({ error: "unauthorized" }, 401);
      const last = await meta("last_ok");
      if (last && Date.now() - Date.parse(last) < 30_000) return json({ ok: true, lastOk: last, throttled: true });
      const r = await poll(true);
      return json({ ...r, lastOk: await meta("last_ok") });
    }
    if (body.op === "poll") {
      const secret = await cronSecret();
      if (!secret || !safeEqual(req.headers.get("x-cron-secret") || "", secret)) return json({ error: "unauthorized" }, 401);
      return json(await poll());
    }
    return json({ error: "unknown op" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e).slice(0, 200) }, 500);
  }
}

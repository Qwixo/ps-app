// instantly-replies: the near real time Instantly reply feed (lead reply cards, meeting alerts). Every 2 minutes
// (pg_cron, x-cron-secret) it lists the newest received emails and your own Unibox replies, READ ONLY, and when
// anything changed seals ONE package to your vault key (inbox source 'instantly-replies'; a newer package
// replaces one still waiting). Plaintext exists only in this function's memory; the server keeps a keyed hash
// to spot changes, never email text. Instantly key from Supabase Vault (instantly_api_key; emails:read is enough).
// Never replies, never changes anything in Instantly. Once the webhook (instantly-webhook) delivers, this is the
// backup and runs every 5 minutes. Package: {kind, v:1, at, replies:[...], sent:[...]}.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const API = "https://api.instantly.ai/api/v2/emails";
const UNIBOX = "https://app.instantly.ai/app/unibox";
const enc = new TextEncoder();
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
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: epk, info: enc.encode("cincee-inbox-v1") }, hk, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(payload))));
  return JSON.stringify({ v: 1, epk: b64(epk), iv: b64(iv), ct: b64(ct) });
}
async function sha256hex(s: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
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
  eaccount?: string; subject?: string; body?: { text?: string; html?: string }; content_preview?: string; campaign_id?: string; lead?: string;
};
const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function htmlToText(h: string) {
  return decode(h.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
/** The new words only: quoted history and signature cut, at most 800 characters. */
function opening(e: IEmail) {
  const t = e.body?.text?.trim() ? e.body.text : e.body?.html ? htmlToText(e.body.html) : e.content_preview || "";
  const out: string[] = [];
  for (const raw of t.split(/\r?\n/)) {
    const l = raw.trimEnd();
    if (/^\s*>/.test(l) || /^\s*on .{3,160}wrote:?\s*$/i.test(l) || /^\s*-{2,}\s*(original|forwarded) message/i.test(l) || /^\s*from:\s/i.test(l) || l.trim() === "--" || /^\s*sent from my/i.test(l)) break;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 800);
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
async function setMeta(k: string, value: string | null) {
  await admin.from("instantly_meta").upsert({ key: k, value, updated_at: new Date().toISOString() });
}
async function setMetas(kv: Record<string, string | null>) {
  const at = new Date().toISOString();
  await admin.from("instantly_meta").upsert(Object.entries(kv).map(([key, value]) => ({ key, value, updated_at: at })));
}
// Egress: secrets are read once per warm instance (10 minutes), not two or three times on every run.
let cfgCache: { apiKey: string; cron: string; at: number } | null = null;
async function cfg() {
  if (!cfgCache || Date.now() - cfgCache.at > 10 * 60_000) {
    const [{ data: i }, { data: c }] = await Promise.all([admin.rpc("instantly_get_config"), admin.rpc("calendar_get_config")]);
    cfgCache = { apiKey: String(i?.api_key || Deno.env.get("INSTANTLY_API_KEY") || "").trim(), cron: c?.cron_secret || "", at: Date.now() };
  }
  return cfgCache;
}

async function poll() {
  // The key comes from Supabase Vault (instantly_api_key, via instantly_get_config). The older function secret
  // is only a fallback until you has put the key in Vault.
  const c = await cfg();
  const key = c.apiKey;
  if (!key) return { ok: true, skipped: "not connected" };
  const { data: mrows } = await admin.from("instantly_meta").select("key, value").in("key", ["hook_last_at", "replies_hash", "replies_last_ok", "replies_last_error"]);
  const m = new Map((mrows || []).map((r) => [r.key as string, r.value as string | null]));
  // While the webhook delivers (an event in the last 30 minutes), this poll is the backup: every 5 minutes only.
  const hook = m.get("hook_last_at");
  if (hook && Date.now() - Date.parse(hook) < 30 * 60_000 && new Date().getUTCMinutes() % 5 !== 0) return { ok: true, skipped: "webhook live" };
  try {
    const got = await api(key, { email_type: "received", limit: "100", sort_order: "desc" });
    await sleep(1200);
    const mine = await api(key, { email_type: "manual", limit: "100", sort_order: "desc" });
    const replies = (got.items || []).map((e) => ({
      id: e.id, threadId: e.thread_id || null, lead: (e.lead || e.from_address_email || "").toLowerCase(),
      from: (e.from_address_email || "").toLowerCase(), fromName: e.from_address_json?.[0]?.name || null,
      account: (e.eaccount || "").toLowerCase(), at: e.timestamp_email || e.timestamp_created || null,
      subject: e.subject || "(no subject)", opening: opening(e), campaignId: e.campaign_id || null, url: UNIBOX,
    }));
    const cutoff = new Date(Date.now() - 14 * 864e5).toISOString();
    const sent = (mine.items || []).filter((e) => (e.timestamp_email || e.timestamp_created || "") >= cutoff).map((e) => ({
      id: e.id, threadId: e.thread_id || null, lead: (e.lead || (e.to_address_email_list || "").split(",")[0] || "").trim().toLowerCase(),
      account: (e.eaccount || "").toLowerCase(), at: e.timestamp_email || e.timestamp_created || null,
    }));
    // Only when something changed: one sealed package, replacing any older one still waiting.
    const h = await sha256hex(c.cron + "|replies|" + replies.map((r) => r.id).join(",") + "|" + sent.map((s) => s.id).join(","));
    if (h === m.get("replies_hash")) {
      // Nothing new: stamp "last ok" at most every 10 minutes (it is only a health mark).
      const last = m.get("replies_last_ok");
      if (m.get("replies_last_error") || !last || Date.now() - Date.parse(last) > 10 * 60_000) await setMetas({ replies_last_ok: new Date().toISOString(), replies_last_error: null });
      return { ok: true, changed: false };
    }
    const { data: owner } = await admin.from("app_owner").select("user_id").maybeSingle();
    if (!owner) throw new Error("no owner");
    const { data: k } = await admin.from("user_keys").select("public_key").eq("user_id", owner.user_id).maybeSingle();
    if (!k?.public_key) throw new Error("no inbox key");
    const sealed = await seal(k.public_key, { kind: "instantly-replies", v: 1, at: new Date().toISOString(), replies, sent });
    const { data: ins, error } = await admin.from("inbox").insert({ source: "instantly-replies", sealed }).select("id").single();
    if (error) throw new Error("store failed");
    await admin.from("inbox").delete().eq("source", "instantly-replies").neq("id", ins.id);
    await setMetas({ replies_hash: h, replies_last_ok: new Date().toISOString(), replies_last_error: null });
    return { ok: true, changed: true, replies: replies.length, sent: sent.length };
  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 300);
    await setMeta("replies_last_error", msg);
    return { ok: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let body: { op?: string };
  try { body = await req.json(); } catch { return json({ error: "bad body" }, 400); }
  if (body.op !== "poll") return json({ error: "unknown op" }, 400);
  const secret = (await cfg()).cron;
  if (!secret || !safeEqual(req.headers.get("x-cron-secret") || "", secret)) return json({ error: "unauthorized" }, 401);
  return json(await poll());
});

// instantly-webhook: receives Instantly's webhook the moment a reply (or a lead event such as a booked meeting)
// lands, checks the secret (the last path segment of the URL, or an x-webhook-secret header), keeps only what the
// lead reply cards and the meeting alerts need, SEALS it to your vault key and stores it as an inbox package (source
// 'instantly-hook'). Plaintext exists only in this function's memory. Read only: it never calls Instantly back.
// The secret lives in Supabase Vault (instantly_webhook_secret, read via instantly_get_config); never printed.
// Sends, opens and clicks are ignored (they would flood the vault). The every-minute poll (instantly-replies)
// stays as the backup and slows down by itself while webhook events keep arriving.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const IGNORE = /^(email_sent|email_opened|email_link_clicked|link_clicked|email_bounced|campaign_completed|account_error)$/i;

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
function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const str = (...v: unknown[]) => { for (const x of v) if (typeof x === "string" && x.trim()) return x.trim(); return null; };
const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const htmlToText = (h: string) => decode(h.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, "\n").replace(/<[^>]+>/g, "")).trim();
function opening(text: string) {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trimEnd();
    if (/^\s*>/.test(l) || /^\s*on .{3,160}wrote:?\s*$/i.test(l) || /^\s*-{2,}\s*(original|forwarded) message/i.test(l) || /^\s*from:\s/i.test(l) || l.trim() === "--" || /^\s*sent from my/i.test(l)) break;
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 800);
}

Deno.serve(async (req) => {
  const { data: cfg } = await admin.rpc("instantly_get_config");
  const secret = String(cfg?.webhook_secret || "");
  const url = new URL(req.url);
  const given = req.headers.get("x-webhook-secret") || url.pathname.split("/").filter(Boolean).pop() || "";
  if (!secret || !safeEqual(given, secret)) return json({ error: "unauthorized" }, 401);
  if (req.method === "GET") return json({ ok: true });               // Instantly's "test the URL"
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let p: Record<string, unknown>;
  try { p = await req.json(); } catch { return json({ error: "bad body" }, 400); }
  const type = str(p.event_type, p.event, p.type) || "unknown";
  if (IGNORE.test(type)) return json({ ok: true, ignored: type });
  const text = str(p.reply_text, p.reply_text_snippet, p.text) || (typeof p.reply_html === "string" ? htmlToText(p.reply_html) : "") || "";
  const ev = {
    type, id: str(p.email_id, p.reply_id, p.id) || crypto.randomUUID(), threadId: str(p.thread_id, p.email_thread_id),
    at: str(p.timestamp, p.reply_timestamp, p.timestamp_email) || new Date().toISOString(),
    lead: (str(p.lead_email, p.email, p.lead) || "").toLowerCase(), fromName: str(p.firstName && p.lastName ? `${p.firstName} ${p.lastName}` : null, p.lead_name, p.firstName),
    account: (str(p.email_account, p.eaccount, p.sender_email) || "").toLowerCase(), subject: str(p.reply_subject, p.subject) || "",
    opening: opening(text), campaignId: str(p.campaign_id), campaignName: str(p.campaign_name), url: str(p.unibox_url) || "https://app.instantly.ai/app/unibox",
    meeting: type.includes("meeting") ? { start: str(p.meeting_start, p.meeting_time, p.start_time), title: str(p.meeting_title) } : null,
  };
  const { data: owner } = await admin.from("app_owner").select("user_id").maybeSingle();
  const { data: k } = owner ? await admin.from("user_keys").select("public_key").eq("user_id", owner.user_id).maybeSingle() : { data: null };
  if (!k?.public_key) return json({ error: "vault not ready" }, 503);
  const sealed = await seal(k.public_key, { kind: "instantly-hook", v: 1, at: new Date().toISOString(), event: ev });
  const { error } = await admin.from("inbox").insert({ source: "instantly-hook", sealed });
  if (error) return json({ error: "store failed" }, 500);
  await admin.from("instantly_meta").upsert({ key: "hook_last_at", value: new Date().toISOString(), updated_at: new Date().toISOString() });
  return json({ ok: true });
});

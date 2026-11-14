// Pure helpers for whatsapp-webhook (no imports, so Node tests can load this file as is).
// Meta's WhatsApp Cloud API (docs checked 14 Nov 2026): the webhook GET handshake, the X-Hub-Signature-256 header, and
// the payload shapes for incoming messages and delivery statuses.

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");

export function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function sha256hex(s: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
}

/** Meta signs the exact request body: "sha256=" + HMAC-SHA256(app secret, raw body). Compared in constant time. */
export async function verifySignature(rawBody: string, header: string | null | undefined, appSecret: string | null | undefined): Promise<boolean> {
  if (!appSecret || !header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody))));
  return safeEqual(mac, header.slice(7).trim().toLowerCase());
}

/** The GET handshake: hub.mode=subscribe and the verify token matches, then answer with hub.challenge. Null: refuse. */
export function handshake(params: URLSearchParams, verifyToken: string | null | undefined): string | null {
  if (params.get("hub.mode") !== "subscribe") return null;
  const given = params.get("hub.verify_token") || "";
  if (!verifyToken || !safeEqual(given, verifyToken)) return null;
  const ch = params.get("hub.challenge");
  return ch && ch.length <= 200 ? ch : null;
}

/** Seal a payload to the owner's ECDH P-256 public key. Same scheme as gmail-inbox and crypto.ts sealTo. */
export async function seal(publicKeyB64: string, payload: unknown): Promise<string> {
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

export type WaKind = "text" | "photo" | "voice" | "audio" | "video" | "file" | "sticker" | "location" | "contact" | "reaction" | "button" | "unsupported" | "other";
export interface WaIn {
  id: string;                 // the WhatsApp message id (wamid...): the dedupe key
  at: string;                 // ISO time the person sent it
  from: string | null;        // international number, digits only (null when the person only has a username)
  userId: string | null;      // Meta's business scoped user id, when sent
  name: string | null;        // the profile name they chose
  kind: WaKind;
  text: string;               // the words, or a caption, or the button label; never a media file
  mediaId?: string;           // a photo, voice note or file: only the id (PS never downloads media)
  fileName?: string;
  replyTo?: string;           // the message id this one answers
}
export interface WaStatus { id: string; status: "sent" | "delivered" | "read" | "failed" | "played"; at: string; recipient: string | null; error?: string }
export interface Parsed { messages: WaIn[]; statuses: WaStatus[]; numberIds: string[] }

const s = (v: unknown, max = 4096): string => typeof v === "string" ? v.slice(0, max) : "";
const iso = (ts: unknown): string => {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
};
export const digits = (v: unknown): string | null => { const d = s(v, 40).replace(/\D/g, ""); return d.length >= 6 && d.length <= 15 ? d : null; };

/** One message object from Meta, every type. Anything not known becomes kind "other" with no text (still announced as a message). */
export function parseMessage(m: Record<string, unknown>, names: Map<string, string>): WaIn | null {
  const id = s(m.id, 200);
  if (!id) return null;
  const from = digits(m.from);
  const userId = s(m.from_user_id, 100) || null;
  const type = s(m.type, 40);
  const o = (m[type] ?? {}) as Record<string, unknown>;
  const base: WaIn = { id, at: iso(m.timestamp), from, userId, name: (from && names.get(from)) || (userId && names.get(userId)) || null, kind: "other", text: "" };
  const ctx = m.context as Record<string, unknown> | undefined;
  if (ctx && typeof ctx.id === "string") base.replyTo = ctx.id.slice(0, 200);
  switch (type) {
    case "text": return { ...base, kind: "text", text: s(o.body) };
    case "image": return { ...base, kind: "photo", text: s(o.caption), mediaId: s(o.id, 200) || undefined };
    case "video": return { ...base, kind: "video", text: s(o.caption), mediaId: s(o.id, 200) || undefined };
    case "audio": return { ...base, kind: o.voice === true ? "voice" : "audio", text: "", mediaId: s(o.id, 200) || undefined };
    case "document": return { ...base, kind: "file", text: s(o.caption), mediaId: s(o.id, 200) || undefined, fileName: s(o.filename, 200) || undefined };
    case "sticker": return { ...base, kind: "sticker", text: "", mediaId: s(o.id, 200) || undefined };
    case "location": return { ...base, kind: "location", text: [s(o.name, 200), s(o.address, 300)].filter(Boolean).join(", ") };
    case "contacts": return { ...base, kind: "contact", text: ((Array.isArray(m.contacts) ? m.contacts : []) as Record<string, unknown>[]).map((c) => s((c.name as Record<string, unknown> | undefined)?.formatted_name, 120)).filter(Boolean).join(", ") };
    case "reaction": return { ...base, kind: "reaction", text: s(o.emoji, 16), replyTo: s(o.message_id, 200) || base.replyTo };
    case "button": return { ...base, kind: "button", text: s(o.text) };
    case "interactive": {
      const r = (o.button_reply ?? o.list_reply ?? {}) as Record<string, unknown>;
      return { ...base, kind: "button", text: s(r.title) };
    }
    case "unsupported": return { ...base, kind: "unsupported", text: "" };
    default: return base;
  }
}

/** The whole POST body: every message and every status, for any of the person's numbers. A body that is not Meta's shape gives nothing. */
export function parsePayload(p: unknown): Parsed {
  const out: Parsed = { messages: [], statuses: [], numberIds: [] };
  const o = p as { object?: unknown; entry?: unknown };
  if (!o || o.object !== "whatsapp_business_account" || !Array.isArray(o.entry)) return out;
  for (const e of o.entry as { changes?: unknown }[]) {
    for (const ch of (Array.isArray(e?.changes) ? e.changes : []) as { field?: unknown; value?: Record<string, unknown> }[]) {
      if (ch.field !== "messages" || !ch.value) continue;
      const v = ch.value;
      const pid = s((v.metadata as Record<string, unknown> | undefined)?.phone_number_id, 60);
      if (pid && !out.numberIds.includes(pid)) out.numberIds.push(pid);
      const names = new Map<string, string>();
      for (const c of (Array.isArray(v.contacts) ? v.contacts : []) as Record<string, unknown>[]) {
        const nm = s((c.profile as Record<string, unknown> | undefined)?.name, 120);
        if (nm) for (const k of [s(c.wa_id, 40), s(c.user_id, 100)]) if (k) names.set(k, nm);
      }
      for (const m of (Array.isArray(v.messages) ? v.messages : []) as Record<string, unknown>[]) {
        const x = parseMessage(m, names);
        if (x) out.messages.push(x);
      }
      for (const st of (Array.isArray(v.statuses) ? v.statuses : []) as Record<string, unknown>[]) {
        const status = s(st.status, 20);
        const id = s(st.id, 200);
        if (!id || !["sent", "delivered", "read", "failed", "played"].includes(status)) continue;
        const err = (Array.isArray(st.errors) ? st.errors[0] : null) as Record<string, unknown> | null;
        out.statuses.push({ id, status: status as WaStatus["status"], at: iso(st.timestamp), recipient: digits(st.recipient_id),
          ...(err ? { error: `${String(err.code ?? "").slice(0, 12)} ${s(err.title, 160)}`.trim() } : {}) });
      }
    }
  }
  return out;
}

/** Messages that open (reset) the 24 hour customer service window: anything the person wrote, except a reaction. */
export const opensWindow = (m: WaIn) => m.kind !== "reaction" && !!m.from;

/** Dedupe keys, sha256 only. A status can arrive several times (sent, delivered, read), each once. */
export const msgKey = (m: WaIn) => sha256hex(`msg|${m.id}`);
export const statusKey = (st: WaStatus) => sha256hex(`st|${st.id}|${st.status}`);

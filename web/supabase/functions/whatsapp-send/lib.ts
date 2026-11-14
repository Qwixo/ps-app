// Pure helpers for whatsapp-send (no imports, so Node tests can load this file as is). The Graph API base address is
// passed in, so the tests point it at a fake local server and never reach Meta.

/** Graph API version in Meta's current WhatsApp Cloud API docs (14 Nov 2026: v27.0). One place to change. */
export const GRAPH_VERSION = "v27.0";
export const GRAPH_BASE = "https://graph.facebook.com";
/** A free text reply is allowed for 24 hours after the person's last message (Meta: the window opens and resets with each user message). */
export const WINDOW_MS = 24 * 3600_000;
export const TEXT_MAX = 4096;

const enc = new TextEncoder();
export async function sha256hex(s: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** The number a message goes to: digits only, 7 to 15 of them. Null when it is not a phone number. */
export function cleanTo(v: unknown): string | null {
  const d = typeof v === "string" ? v.replace(/\D/g, "") : "";
  return d.length >= 7 && d.length <= 15 ? d : null;
}

export interface WindowState { open: boolean; msLeft: number }
/** The 24 hour rule. `lastInAt` is when the person last wrote (ISO or null). Closed when never, or 24 hours or more ago. */
export function windowState(lastInAt: string | null | undefined, now: number): WindowState {
  const t = lastInAt ? Date.parse(lastInAt) : NaN;
  if (!Number.isFinite(t)) return { open: false, msLeft: 0 };
  const left = t + WINDOW_MS - now;
  return left > 0 ? { open: true, msLeft: left } : { open: false, msLeft: 0 };
}

export interface Cfg { accessToken: string; phoneNumberId: string; wabaId?: string | null; base?: string }
const url = (c: Cfg, path: string) => `${c.base || GRAPH_BASE}/${GRAPH_VERSION}/${path}`;
export type F = (u: string, init?: RequestInit) => Promise<Response>;

/** What Meta said, in plain words. Never the token. */
export function graphError(status: number, body: unknown): string {
  const e = (body as { error?: { code?: number; message?: string; error_data?: { details?: string } } } | null)?.error;
  if (e?.code === 131047) return "The 24 hour window is closed. Send a template instead.";
  if (e?.code === 190) return "Meta says the access token is no longer valid. Make a new one and link again.";
  if (e?.code === 131030) return "That number is not on your list of allowed test numbers in Meta yet.";
  if (e?.code === 131056 || e?.code === 130429) return "Meta says you are sending too fast. Try again in a minute.";
  const m = (e?.error_data?.details || e?.message || "").toString().slice(0, 200);
  return m ? `Meta said: ${m}` : `Meta answered ${status}.`;
}

async function call(f: F, c: Cfg, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await f(url(c, path), { ...init, headers: { Authorization: `Bearer ${c.accessToken}`, "Content-Type": "application/json", ...(init?.headers || {}) } });
  let body: unknown = null;
  try { body = await r.json(); } catch { /* an empty or non JSON answer */ }
  return { ok: r.ok, status: r.status, body };
}

export type SendResult = { ok: true; id: string } | { ok: false; error: string; code?: number };
const sent = (r: { ok: boolean; status: number; body: any }): SendResult => {
  const id = r.body?.messages?.[0]?.id;
  return r.ok && typeof id === "string" ? { ok: true, id } : { ok: false, error: graphError(r.status, r.body), code: r.body?.error?.code };
};

/** A text reply. `replyTo` quotes one of their messages. The caller has already checked the 24 hour window. */
export async function sendText(f: F, c: Cfg, to: string, text: string, replyTo?: string | null): Promise<SendResult> {
  const body = { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: text.slice(0, TEXT_MAX) },
    ...(replyTo ? { context: { message_id: replyTo } } : {}) };
  return sent(await call(f, c, `${c.phoneNumberId}/messages`, { method: "POST", body: JSON.stringify(body) }));
}

/** An approved template by name and language. Allowed at any time (Meta charges per template message). */
export async function sendTemplate(f: F, c: Cfg, to: string, name: string, language: string): Promise<SendResult> {
  const body = { messaging_product: "whatsapp", recipient_type: "individual", to, type: "template", template: { name, language: { code: language } } };
  return sent(await call(f, c, `${c.phoneNumberId}/messages`, { method: "POST", body: JSON.stringify(body) }));
}

/** Mark one of their messages as read (the blue ticks on their side). */
export async function markRead(f: F, c: Cfg, messageId: string): Promise<boolean> {
  const r = await call(f, c, `${c.phoneNumberId}/messages`, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }) });
  return r.ok;
}

export interface Template { name: string; language: string; text: string }
/** Approved templates that need nothing filled in (no {{1}} style placeholders), so PS can send them as they are. */
export async function listTemplates(f: F, c: Cfg): Promise<{ ok: true; templates: Template[] } | { ok: false; error: string }> {
  if (!c.wabaId) return { ok: false, error: "No business account id is saved. Link again." };
  const r = await call(f, c, `${c.wabaId}/message_templates?status=APPROVED&fields=name,language,components&limit=50`);
  if (!r.ok || !Array.isArray(r.body?.data)) return { ok: false, error: graphError(r.status, r.body) };
  const out: Template[] = [];
  for (const t of r.body.data as { name?: string; language?: string; components?: { type?: string; text?: string }[] }[]) {
    const bodyText = (t.components || []).find((x) => x.type === "BODY")?.text || "";
    if (!t.name || !t.language || /\{\{/.test(bodyText) || (t.components || []).some((x) => x.type === "HEADER" && /\{\{/.test(x.text || ""))) continue;
    out.push({ name: t.name, language: t.language, text: bodyText.slice(0, 400) });
  }
  return { ok: true, templates: out };
}

/** The connection test: Meta's own answer about the number (display number and verified name). */
export async function getNumber(f: F, c: Cfg): Promise<{ ok: true; number: string; name: string } | { ok: false; error: string }> {
  const r = await call(f, c, `${c.phoneNumberId}?fields=display_phone_number,verified_name`);
  const n = r.body?.display_phone_number;
  return r.ok && typeof n === "string" ? { ok: true, number: n.slice(0, 40), name: String(r.body?.verified_name || "").slice(0, 80) } : { ok: false, error: graphError(r.status, r.body) };
}

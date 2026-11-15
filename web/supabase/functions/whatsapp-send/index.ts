// whatsapp-send: sends WhatsApp replies from your own number through Meta's Cloud API, and links your number.
// Every op except "enroll" is OWNER ONLY (your signed in session, checked against app_owner). It acts only when you
// press Send in PS (after the 10 second Undo); PS never sends by itself.
//  send           text reply. Only inside the 24 hour window (the server keeps when each person last wrote, sha256 of the
//                 number only). Outside it: refused with "window_closed", and PS offers your approved templates.
//  templates      your approved templates that need nothing filled in.
//  send-template  one of those, allowed at any time.
//  read           mark one of their messages read ("Mark as read when I reply").
//  test           Meta's own answer about your number (Test connection).
//  unlink         forget the secrets and the window list.
//  enroll         scripts/whatsapp-connect.mjs, with a one time code: checks the token with Meta, then keeps the secrets in Vault.
// Secrets live in Supabase Vault (whatsapp_get_config) and are never returned or printed.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { cleanTo, getNumber, listTemplates, markRead, safeEqual, sendTemplate, sendText, sha256hex, TEXT_MAX, windowState, type Cfg } from "./lib.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const ALLOWED_ORIGINS = (Deno.env.get("PS_SITE_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean);
const BASE = Deno.env.get("WA_GRAPH_BASE") || undefined;   // tests only (a fake server); unset in real life
const f = (u: string, init?: RequestInit) => fetch(u, init);

function withCors(res: Response, origin: string | null) {
  const ok = !!origin && (ALLOWED_ORIGINS.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin === "app://ps" || origin.startsWith("file:"));
  res.headers.set("Access-Control-Allow-Origin", ok ? origin! : (ALLOWED_ORIGINS[0] || "null"));
  res.headers.set("Access-Control-Allow-Headers", "authorization, x-client-info, apikey, content-type");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Vary", "Origin");
  return res;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return withCors(new Response("ok"), req.headers.get("origin"));
  return withCors(await handle(req), req.headers.get("origin"));
});

async function isOwner(req: Request): Promise<boolean> {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  const { data: owner } = await admin.from("app_owner").select("user_id").maybeSingle();
  return !!u?.user && !!owner && u.user.id === owner.user_id;
}
async function cfg(): Promise<Cfg | null> {
  const { data } = await admin.rpc("whatsapp_get_config");
  if (!data?.access_token || !data?.phone_number_id) return null;
  return { accessToken: data.access_token, phoneNumberId: data.phone_number_id, wabaId: data.waba_id, base: BASE };
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ error: "bad body" }, 400); }
  try {
    if (b.op === "enroll") return await enroll(b);
    if (!(await isOwner(req))) return json({ error: "unauthorized" }, 401);
    const c = await cfg();
    if (!c) return json({ error: "not_linked" }, 409);
    if (b.op === "test") {
      const r = await getNumber(f, c);
      if (r.ok) await admin.from("whatsapp_state").upsert({ key: "number", value: r.number, updated_at: new Date().toISOString() });
      return json(r.ok ? { ok: true, number: r.number, name: r.name } : { ok: false, error: r.error });
    }
    if (b.op === "unlink") { await admin.rpc("whatsapp_unlink"); return json({ ok: true }); }
    if (b.op === "templates") return json(await listTemplates(f, c));
    if (b.op === "read") {
      const id = typeof b.messageId === "string" ? b.messageId.slice(0, 200) : "";
      return json({ ok: id ? await markRead(f, c, id) : false });
    }
    const to = cleanTo(b.to);
    if (!to) return json({ ok: false, error: "That is not a phone number." }, 400);
    if (b.op === "send-template") {
      const name = typeof b.name === "string" ? b.name.slice(0, 512) : "", language = typeof b.language === "string" ? b.language.slice(0, 20) : "";
      if (!name || !language) return json({ ok: false, error: "Pick a template." }, 400);
      return json(await sendTemplate(f, c, to, name, language));
    }
    if (b.op === "send") {
      const text = typeof b.text === "string" ? b.text.trim() : "";
      if (!text) return json({ ok: false, error: "Type a reply first." }, 400);
      if (text.length > TEXT_MAX) return json({ ok: false, error: `WhatsApp allows ${TEXT_MAX} characters.` }, 400);
      const { data: w } = await admin.from("whatsapp_window").select("last_in_at").eq("h", await sha256hex(`wa|${to}`)).maybeSingle();
      const win = windowState(w?.last_in_at, Date.now());
      if (!win.open) return json({ ok: false, error: "window_closed" }, 409);   // never sent: PS offers a template
      const replyTo = typeof b.replyTo === "string" ? b.replyTo.slice(0, 200) : null;
      return json(await sendText(f, c, to, text, replyTo));
    }
    return json({ error: "unknown op" }, 400);
  } catch {
    return json({ error: "failed" }, 500);
  }
}

async function enroll(b: Record<string, unknown>) {
  const code = typeof b.code === "string" ? b.code : "";
  const sec = (b.secrets ?? {}) as Record<string, unknown>;
  const get = (k: string) => typeof sec[k] === "string" ? (sec[k] as string).trim() : "";
  const a = { access_token: get("access_token"), app_secret: get("app_secret"), phone_number_id: get("phone_number_id"), waba_id: get("waba_id") };
  if (!code || Object.values(a).some((v) => !v || v.length > 600)) return json({ error: "bad request" }, 400);
  const h = await sha256hex(code);
  const { data: row } = await admin.from("whatsapp_enroll").select("code_hash").eq("code_hash", h).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!row || !safeEqual(row.code_hash, h)) return json({ error: "invalid or expired code" }, 401);
  // Check with Meta before keeping anything: a wrong token or number id stops here.
  const r = await getNumber(f, { accessToken: a.access_token, phoneNumberId: a.phone_number_id, base: BASE });
  if (!r.ok) return json({ ok: false, error: r.error }, 400);
  await admin.rpc("whatsapp_set_config", { p: a });
  await admin.from("whatsapp_state").upsert({ key: "number", value: r.number, updated_at: new Date().toISOString() });
  await admin.from("whatsapp_enroll").delete().eq("code_hash", h);
  return json({ ok: true, number: r.number, name: r.name });
}

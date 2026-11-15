// Sends the reminder pushes for the iPhone web app (1.60). Called every minute by the project's own scheduler
// (web/supabase/push-cron.sql) with a key; it sends what is due and marks it sent. Secrets to set on the project:
//   VAPID_PRIVATE_KEY   the private half of the VAPID key pair (the public half is in push_config)
//   VAPID_SUBJECT       "mailto:you@example.com" (any contact address of yours)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are given to every function by Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { authorised, sendBatch, type DueRow } from "./logic.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("no", { status: 405 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: cfg } = await sb.from("push_config").select("vapid_public, sender_key").eq("id", 1).maybeSingle();
  if (!authorised(req.headers.get("x-sender-key"), cfg?.sender_key)) return new Response("no", { status: 401 });
  const priv = Deno.env.get("VAPID_PRIVATE_KEY"), subject = Deno.env.get("VAPID_SUBJECT");
  if (!priv || !subject || !cfg?.vapid_public) return new Response("not set up", { status: 503 });
  webpush.setVapidDetails(subject, cfg.vapid_public, priv);
  const { data } = await sb.from("push_queue")
    .select("id, rem_id, fire_at, sub:push_subs(id, endpoint, p256dh, auth)")
    .is("sent_at", null).lte("fire_at", new Date().toISOString()).order("fire_at").limit(200);
  const rows = (data ?? []).filter((r: { sub: unknown }) => !!r.sub) as unknown as DueRow[];
  const out = await sendBatch(rows, async (s, body) => {
    try { const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 600, urgency: "high" }); return { status: r.statusCode }; }
    catch (e) { return { status: (e as { statusCode?: number }).statusCode ?? 0 }; }
  }, Date.now());
  if (out.sent.length) await sb.from("push_queue").update({ sent_at: new Date().toISOString() }).in("id", out.sent);
  if (out.goneSubs.length) await sb.from("push_subs").delete().in("id", out.goneSubs);
  return new Response(JSON.stringify({ sent: out.sent.length, failed: out.failed.length, gone: out.goneSubs.length }), { headers: { "content-type": "application/json" } });
});

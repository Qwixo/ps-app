// whatsapp-webhook: Meta's WhatsApp Cloud API calls this when someone writes to your number, and with delivery
// statuses (sent, delivered, read) for replies you sent.
//  GET  Meta's verify handshake: answers hub.challenge when hub.verify_token matches the token in your Vault.
//  POST checks X-Hub-Signature-256 (HMAC-SHA256 of the exact body with your app secret, from Vault) and refuses
//       anything that fails. Each new message is SEALED to your vault key and stored in the inbox (source 'whatsapp';
//       delivery statuses 'whatsapp'). Plaintext exists only in this function's memory; no text is kept after sealing.
//       Deduped by the WhatsApp message id (sha256 only, 30 days). Read only: it never calls Meta back.
// Secrets (app secret, verify token) live in Supabase Vault, read via whatsapp_get_config, never printed.
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { digits, handshake, msgKey, opensWindow, parsePayload, seal, sha256hex, statusKey, verifySignature } from "./lib.ts";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const now = () => new Date().toISOString();
const state = (key: string, value: string | null) => admin.from("whatsapp_state").upsert({ key, value, updated_at: now() });

Deno.serve(async (req) => {
  try {
    const { data: cfg } = await admin.rpc("whatsapp_get_config");
    if (req.method === "GET") {
      const ch = handshake(new URL(req.url).searchParams, cfg?.verify_token);
      if (ch === null) return new Response("forbidden", { status: 403 });
      await state("verified_at", now());
      return new Response(ch, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    if (req.method !== "POST") return new Response("GET or POST only", { status: 405 });
    const raw = await req.text();
    if (raw.length > 3_000_000) return json({ error: "too big" }, 413);
    if (!(await verifySignature(raw, req.headers.get("x-hub-signature-256"), cfg?.app_secret))) return json({ error: "bad signature" }, 401);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: "bad body" }, 400); }
    const p = parsePayload(body);
    // Only the person's own number: a message addressed to some other number id is ignored.
    if (cfg?.phone_number_id && p.numberIds.length && !p.numberIds.includes(cfg.phone_number_id)) return json({ ok: true, ignored: "other number" });
    if (!p.messages.length && !p.statuses.length) return json({ ok: true });

    // Dedupe: one batch insert, ignoring keys already there; what comes back is what is new.
    const keyed = [
      ...(await Promise.all(p.messages.map(async (m) => ({ h: await msgKey(m), m })))),
      ...(await Promise.all(p.statuses.map(async (st) => ({ h: await statusKey(st), st })))),
    ];
    const { data: fresh, error: seenErr } = await admin.from("whatsapp_seen").upsert(keyed.map((k) => ({ h: k.h })), { onConflict: "h", ignoreDuplicates: true }).select("h");
    if (seenErr) return json({ error: "store failed" }, 500);   // not 200: Meta tries again
    const newH = new Set((fresh || []).map((r: { h: string }) => r.h));
    const items = keyed.filter((k) => newH.has(k.h));
    if (!items.length) return json({ ok: true, duplicate: true });

    const { data: owner } = await admin.from("app_owner").select("user_id").maybeSingle();
    const { data: k } = owner ? await admin.from("user_keys").select("public_key").eq("user_id", owner.user_id).maybeSingle() : { data: null };
    if (!k?.public_key) { await admin.from("whatsapp_seen").delete().in("h", [...newH]); return json({ error: "vault not ready" }, 503); }

    const rows = await Promise.all(items.map(async (i) => ({
      source: "whatsapp",
      sealed: await seal(k.public_key, i.m
        ? { kind: "whatsapp", v: 1, at: now(), event: i.m }
        : { kind: "whatsapp-status", v: 1, at: now(), event: i.st }),
    })));
    const { error } = await admin.from("inbox").insert(rows);
    if (error) { await admin.from("whatsapp_seen").delete().in("h", [...newH]); return json({ error: "store failed" }, 500); }

    // The 24 hour window per sender (sha256 of the number only).
    const last = new Map<string, string>();
    for (const i of items) if (i.m && opensWindow(i.m) && i.m.from) { const prev = last.get(i.m.from); if (!prev || prev < i.m.at) last.set(i.m.from, i.m.at); }
    if (last.size) {
      const winRows = await Promise.all([...last].map(async ([n, at]) => ({ h: await sha256hex(`wa|${digits(n)}`), last_in_at: at, at: now() })));
      const { data: old } = await admin.from("whatsapp_window").select("h, last_in_at").in("h", winRows.map((r) => r.h));
      const prev = new Map((old || []).map((r: { h: string; last_in_at: string }) => [r.h, r.last_in_at]));
      await admin.from("whatsapp_window").upsert(winRows.map((r) => ({ ...r, last_in_at: (prev.get(r.h) || "") > r.last_in_at ? prev.get(r.h)! : r.last_in_at })));
      await state("last_in_at", now());
    }
    // Housekeeping now and then (indexed time columns): seen keys after 30 days, windows after 8 days.
    if (Math.random() < 0.02) {
      await admin.from("whatsapp_seen").delete().lt("at", new Date(Date.now() - 30 * 86_400_000).toISOString());
      await admin.from("whatsapp_window").delete().lt("at", new Date(Date.now() - 8 * 86_400_000).toISOString());
    }
    return json({ ok: true, sealed: rows.length });
  } catch {
    return json({ error: "failed" }, 500);   // no detail: nothing about a message ever leaves in an error
  }
});

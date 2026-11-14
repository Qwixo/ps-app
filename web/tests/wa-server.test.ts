// Run: node --experimental-strip-types tests/wa-server.test.ts
// PS 1.60 WhatsApp, the server part: the webhook signature check and handshake, parsing every message type, dedupe keys,
// sealing, the 24 hour window rule, phone number cleaning, and the Graph API calls against a FAKE local server (never Meta,
// never a real number or message). Plus structural checks on the two functions and the migration.
import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import * as H from "../supabase/functions/whatsapp-webhook/lib.ts";
import * as S from "../supabase/functions/whatsapp-send/lib.ts";
import { openSealed } from "../src/core/crypto.ts";

let n = 0;
const ok = async (name: string, f: () => void | Promise<void>) => { await f(); n++; console.log("ok - " + name); };
const SECRET = "fake-app-secret-for-tests";
const sign = (body: string, secret = SECRET) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

await ok("signature: right secret passes, everything else is refused", async () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  assert.equal(await H.verifySignature(body, sign(body), SECRET), true);
  assert.equal(await H.verifySignature(body, sign(body, "other-secret"), SECRET), false, "signed with another secret");
  assert.equal(await H.verifySignature(body + " ", sign(body), SECRET), false, "body changed after signing");
  assert.equal(await H.verifySignature(body, null, SECRET), false, "no header");
  assert.equal(await H.verifySignature(body, sign(body).replace("sha256=", "sha1="), SECRET), false, "wrong prefix");
  assert.equal(await H.verifySignature(body, "sha256=", SECRET), false, "empty hash");
  assert.equal(await H.verifySignature(body, sign(body), ""), false, "no app secret stored: nothing passes");
  assert.equal(await H.verifySignature(body, sign(body), null), false);
  assert.equal(await H.verifySignature(body, sign(body).toUpperCase().replace("SHA256=", "sha256="), SECRET), true, "hex case does not matter");
});

await ok("handshake: only subscribe with the right token answers the challenge", () => {
  const q = (o: Record<string, string>) => new URLSearchParams(o);
  assert.equal(H.handshake(q({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "12345" }), "tok"), "12345");
  assert.equal(H.handshake(q({ "hub.mode": "subscribe", "hub.verify_token": "bad", "hub.challenge": "12345" }), "tok"), null);
  assert.equal(H.handshake(q({ "hub.mode": "unsubscribe", "hub.verify_token": "tok", "hub.challenge": "1" }), "tok"), null);
  assert.equal(H.handshake(q({ "hub.mode": "subscribe", "hub.verify_token": "tok" }), "tok"), null, "no challenge");
  assert.equal(H.handshake(q({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }), ""), null, "no token stored");
});

const wrap = (value: Record<string, unknown>) => ({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "15550001111", phone_number_id: "PN1" }, ...value } }] }] });
const contacts = [{ profile: { name: "Sam Example" }, wa_id: "16505551234" }];
const msg = (type: string, extra: Record<string, unknown>) => ({ from: "16505551234", id: "wamid.T" + type, timestamp: "1763100000", type, ...extra });
const one = (m: Record<string, unknown>) => H.parsePayload(wrap({ contacts, messages: [m] })).messages[0];

await ok("parse: every message type", () => {
  const t = one(msg("text", { text: { body: "Hi, can we move our call to Friday?" } }));
  assert.deepEqual([t.kind, t.text, t.from, t.name, t.id], ["text", "Hi, can we move our call to Friday?", "16505551234", "Sam Example", "wamidtext".replace("wamid", "wamid.T")]);
  assert.equal(t.at, new Date(1763100000 * 1000).toISOString());
  assert.deepEqual([one(msg("image", { image: { id: "M1", caption: "look" } })).kind, one(msg("image", { image: { id: "M1", caption: "look" } })).text, one(msg("image", { image: { id: "M1" } })).mediaId], ["photo", "look", "M1"]);
  assert.equal(one(msg("audio", { audio: { id: "A1", voice: true } })).kind, "voice");
  assert.equal(one(msg("audio", { audio: { id: "A1", voice: false } })).kind, "audio");
  const d = one(msg("document", { document: { id: "D1", filename: "quote.pdf", caption: "here" } }));
  assert.deepEqual([d.kind, d.fileName, d.text], ["file", "quote.pdf", "here"]);
  assert.equal(one(msg("video", { video: { id: "V1" } })).kind, "video");
  assert.equal(one(msg("sticker", { sticker: { id: "S1" } })).kind, "sticker");
  assert.deepEqual([one(msg("location", { location: { name: "Cafe", address: "1 Example St" } })).kind, one(msg("location", { location: { name: "Cafe", address: "1 Example St" } })).text], ["location", "Cafe, 1 Example St"]);
  const c = one(msg("contacts", { contacts: [{ name: { formatted_name: "Pat Example" } }] }));
  assert.deepEqual([c.kind, c.text], ["contact", "Pat Example"]);
  const r = one(msg("reaction", { reaction: { message_id: "wamid.X", emoji: "\u{1F44D}" } }));
  assert.deepEqual([r.kind, r.replyTo], ["reaction", "wamid.X"]);
  assert.deepEqual([one(msg("button", { button: { text: "Yes", payload: "p" } })).kind, one(msg("button", { button: { text: "Yes" } })).text], ["button", "Yes"]);
  assert.equal(one(msg("interactive", { interactive: { type: "button_reply", button_reply: { id: "1", title: "Book" } } })).text, "Book");
  assert.equal(one(msg("unsupported", { errors: [{ code: 131051 }] })).kind, "unsupported");
  assert.equal(one(msg("somethingnew", {})).kind, "other", "an unknown type still shows as a message");
  assert.equal(one({ ...msg("text", { text: { body: "x" } }), context: { id: "wamid.Q" } }).replyTo, "wamid.Q");
});

await ok("parse: username only senders, bad bodies, other fields, statuses", () => {
  const u = one({ id: "wamid.U", timestamp: "1763100000", type: "text", from_user_id: "US.123", text: { body: "hi" } });
  assert.deepEqual([u.from, u.userId], [null, "US.123"], "no phone number: PS cannot reply by number");
  assert.equal(H.opensWindow(u), false);
  assert.deepEqual(H.parsePayload(null).messages, []);
  assert.deepEqual(H.parsePayload({ object: "page", entry: [] }).messages, [], "not a WhatsApp body");
  assert.deepEqual(H.parsePayload({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "account_update", value: { messages: [msg("text", { text: { body: "x" } })] } }] }] }).messages, [], "other webhook fields are ignored");
  assert.deepEqual(H.parsePayload(wrap({ messages: [{ type: "text", text: { body: "no id" } }] })).messages, []);
  const st = H.parsePayload(wrap({ statuses: [
    { id: "wamid.S1", status: "sent", timestamp: "1763100010", recipient_id: "16505551234" },
    { id: "wamid.S1", status: "delivered", timestamp: "1763100011", recipient_id: "16505551234" },
    { id: "wamid.S1", status: "read", timestamp: "1763100012", recipient_id: "16505551234" },
    { id: "wamid.S2", status: "failed", timestamp: "1763100013", recipient_id: "16505551234", errors: [{ code: 131047, title: "Re-engagement message" }] },
    { id: "wamid.S3", status: "weird", timestamp: "1" },
  ] })).statuses;
  assert.deepEqual(st.map((x) => x.status), ["sent", "delivered", "read", "failed"]);
  assert.equal(st[3].error, "131047 Re-engagement message");
  assert.equal(H.opensWindow(one(msg("reaction", { reaction: { emoji: "x", message_id: "q" } }))), false, "a reaction does not open the window");
  assert.equal(H.opensWindow(one(msg("text", { text: { body: "x" } }))), true);
  assert.deepEqual(H.parsePayload(wrap({ contacts, messages: [] })).numberIds, ["PN1"]);
});

await ok("dedupe keys: the same message gives the same key, a status gives one per step, nothing readable inside", async () => {
  const a = one(msg("text", { text: { body: "one" } })), b = one(msg("text", { text: { body: "changed words" } }));
  assert.equal(await H.msgKey(a), await H.msgKey(b), "keyed by the message id only");
  assert.notEqual(await H.msgKey(a), await H.msgKey({ ...a, id: "wamid.other" }));
  const sent = { id: "wamid.S", status: "sent" as const, at: "", recipient: null }, read = { ...sent, status: "read" as const };
  assert.notEqual(await H.statusKey(sent), await H.statusKey(read));
  assert.equal(await H.statusKey(sent), await H.statusKey({ ...sent }));
  assert.match(await H.msgKey(a), /^[0-9a-f]{64}$/);
  assert.notEqual(await H.msgKey(a), await H.statusKey(sent), "a message and a status never collide");
});

await ok("sealing: only the owner's private key opens it; nothing readable in the sealed text", async () => {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const spki = Buffer.from(await webcrypto.subtle.exportKey("spki", pair.publicKey)).toString("base64");
  const event = one(msg("text", { text: { body: "A secret sentence about Glow Studio" } }));
  const sealed = await H.seal(spki, { kind: "whatsapp", v: 1, event });
  assert.ok(!sealed.includes("secret sentence") && !sealed.includes("16505551234") && !sealed.includes("Sam"), "no plain text in the sealed string");
  const opened = await openSealed<{ kind: string; event: typeof event }>(pair.privateKey, sealed);
  assert.deepEqual([opened.kind, opened.event.text, opened.event.from], ["whatsapp", event.text, "16505551234"]);
  const other = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  await assert.rejects(() => openSealed(other.privateKey, sealed), "another key cannot open it");
});

await ok("24 hour window rule", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
  assert.deepEqual(S.windowState(ago(1), now), { open: true, msLeft: 23 * 3600_000 });
  assert.equal(S.windowState(ago(23.99), now).open, true);
  assert.equal(S.windowState(ago(24), now).open, false, "exactly 24 hours: closed");
  assert.equal(S.windowState(ago(30), now).open, false);
  assert.equal(S.windowState(null, now).open, false, "never wrote: closed");
  assert.equal(S.windowState("not a date", now).open, false);
  assert.equal(S.windowState(new Date(now + 3600_000).toISOString(), now).open, true, "a clock a little ahead is still inside");
});

await ok("phone number cleaning on the server", () => {
  assert.equal(S.cleanTo("+1 (650) 555-1234"), "16505551234");
  assert.equal(S.cleanTo("123"), null);
  assert.equal(S.cleanTo("1234567890123456"), null);
  assert.equal(S.cleanTo(null), null);
  assert.equal(S.cleanTo("not a number"), null);
});

// ---------- the fake Graph API ----------
const seen: { path: string; auth: string; body: any }[] = [];
const fake = createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    const body = b ? JSON.parse(b) : null;
    seen.push({ path: req.url || "", auth: String(req.headers.authorization || ""), body });
    const send = (code: number, o: unknown) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== "Bearer FAKE-TOKEN") return send(401, { error: { code: 190, message: "Invalid OAuth access token" } });
    if ((req.url || "").startsWith("/v27.0/PN1/messages")) {
      if (body?.status === "read") return send(200, { success: true });
      if (body?.to === "0000000000") return send(400, { error: { code: 131047, message: "Re-engagement message" } });
      return send(200, { messaging_product: "whatsapp", contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: "wamid.FAKE" + seen.length }] });
    }
    if ((req.url || "").startsWith("/v27.0/PN1?")) return send(200, { display_phone_number: "+1 555 000 1111", verified_name: "Example Studio" });
    if ((req.url || "").startsWith("/v27.0/WABA1/message_templates")) return send(200, { data: [
      { name: "reopen", language: "en_US", components: [{ type: "BODY", text: "Hi, are you still interested?" }] },
      { name: "with_var", language: "en_US", components: [{ type: "BODY", text: "Hi {{1}}" }] }] });
    send(404, { error: { message: "nope" } });
  });
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
const cfg: S.Cfg = { accessToken: "FAKE-TOKEN", phoneNumberId: "PN1", wabaId: "WABA1", base };

await ok("Graph calls against the fake server: text, quote, template, read, test, templates, errors", async () => {
  const r = await S.sendText(fetch, cfg, "16505551234", "Sure, Friday works.", "wamid.IN");
  assert.equal(r.ok, true);
  const last = seen[seen.length - 1];
  assert.equal(last.path, "/v27.0/PN1/messages");
  assert.deepEqual([last.auth, last.body.type, last.body.to, last.body.text.body, last.body.context.message_id, last.body.messaging_product], ["Bearer FAKE-TOKEN", "text", "16505551234", "Sure, Friday works.", "wamid.IN", "whatsapp"]);
  assert.match((r as { id: string }).id, /^wamid\.FAKE/);
  const t = await S.sendTemplate(fetch, cfg, "16505551234", "reopen", "en_US");
  assert.equal(t.ok, true);
  assert.deepEqual([seen[seen.length - 1].body.type, seen[seen.length - 1].body.template.name, seen[seen.length - 1].body.template.language.code], ["template", "reopen", "en_US"]);
  assert.equal(await S.markRead(fetch, cfg, "wamid.IN"), true);
  assert.deepEqual(await S.getNumber(fetch, cfg), { ok: true, number: "+1 555 000 1111", name: "Example Studio" });
  assert.deepEqual(await S.listTemplates(fetch, cfg), { ok: true, templates: [{ name: "reopen", language: "en_US", text: "Hi, are you still interested?" }] });
  const closed = await S.sendText(fetch, cfg, "0000000000", "x");
  assert.deepEqual(closed, { ok: false, error: "The 24 hour window is closed. Send a template instead.", code: 131047 });
  const badTok = await S.sendText(fetch, { ...cfg, accessToken: "wrong" }, "16505551234", "x");
  assert.equal(badTok.ok, false);
  assert.ok(!JSON.stringify(badTok).includes("wrong"), "an error never carries the token");
  assert.equal((await S.listTemplates(fetch, { ...cfg, wabaId: null })).ok, false);
  await S.sendText(fetch, cfg, "16505551234", "y".repeat(5000));
  assert.equal(seen[seen.length - 1].body.text.body.length, 4096, "WhatsApp's own limit is respected");
});
fake.close();

// ---------- the functions and the migration, read as text ----------
const root = new URL("../supabase/", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");
const hook = read("functions/whatsapp-webhook/index.ts"), send = read("functions/whatsapp-send/index.ts"), sql = read("migrations/041_whatsapp.sql");

await ok("the webhook: signature before anything is parsed, never calls Meta, no logging, secrets only from Vault", () => {
  assert.ok(hook.indexOf("verifySignature(") < hook.indexOf("JSON.parse(raw)"), "signature is checked before the body is parsed");
  assert.ok(!/fetch\(/.test(hook), "the webhook never calls anything");
  assert.ok(!/console\./.test(hook + send), "nothing is logged");
  assert.match(hook, /rpc\("whatsapp_get_config"\)/);
  assert.ok(!/Deno\.env\.get\("(WA|WHATSAPP)[A-Z_]*(TOKEN|SECRET|ID)/.test(hook + send), "no secret in an environment variable");
  assert.match(hook, /\.insert\(rows\)/);
  assert.match(hook, /bad signature" }, 401\)/);
});
await ok("send: owner only, window checked before the text goes out, the token never returned", () => {
  assert.ok(send.indexOf("isOwner(req)") < send.indexOf('b.op === "send"'), "owner check first");
  assert.ok(send.indexOf("windowState(") < send.indexOf("sendText("), "the 24 hour rule comes before the send");
  assert.match(send, /window_closed/);
  assert.ok(!/accessToken[^;]*json\(/.test(send), "the token is never in a response");
  assert.match(send, /code_hash/);
});
await ok("every table and rpc the two functions use exists in migration 041 (and the keys tables from 001)", () => {
  for (const m of (hook + send).matchAll(/\.rpc\("([a-z_]+)"/g)) assert.match(sql, new RegExp(`function public\\.${m[1]}\\b`), m[1]);
  for (const m of (hook + send).matchAll(/\.from\("([a-z_]+)"\)/g)) if (!["app_owner", "user_keys", "inbox"].includes(m[1])) assert.match(sql, new RegExp(`table if not exists public\\.${m[1]}\\b`), m[1]);
});
await ok("migration: state tables are closed to the API, secrets only via service role, owner helpers check is_owner, no cron", () => {
  assert.match(sql, /revoke all on public\.whatsapp_seen, public\.whatsapp_window, public\.whatsapp_state, public\.whatsapp_enroll from anon, authenticated/);
  for (const f of ["whatsapp_get_config()", "whatsapp_set_config(jsonb)", "whatsapp_unlink()"]) assert.match(sql, new RegExp(`revoke all on function public\\.${f.replace(/[()]/g, "\\$&")} from public, anon, authenticated`));
  assert.ok(!/grant execute on function public\.whatsapp_get_config\(\) to authenticated/.test(sql));
  assert.equal((sql.match(/public\.is_owner\(\)/g) || []).length, 2, "status and webhook info both check the owner");
  assert.ok(!/cron\.schedule|net\.http/.test(sql.replace(/--[^\n]*/g, "")), "no scheduled job, no outgoing call");
  assert.match(read("../supabase/rollback/041_whatsapp_down.sql"), /drop table if exists public\.whatsapp_seen/);
});
console.log(`whatsapp server tests: ${n} passed`);

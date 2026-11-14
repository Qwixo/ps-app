// Run: node tests/mail.test.ts  (Node 22.6+ strips types)
// Gmail replies: sender parsing, client matching, reply folding, the sealed payloads the
// gmail-inbox function builds, and that the browser can open what the function seals.
import assert from "node:assert/strict";
import * as M from "../src/core/mail.ts";
import * as L from "../supabase/functions/gmail-inbox/lib.ts";
import * as C from "../src/core/crypto.ts";

let n = 0;
const ok = (name: string, fn: () => void | Promise<void>) => Promise.resolve(fn()).then(() => { n++; }, (e) => { console.error("FAIL", name); throw e; });

// ---------- sender parsing ----------
await ok("parseAddress", () => {
  assert.deepEqual(M.parseAddress('"Morgan, Alex" <PMorgan@client1.example>'), { name: "Morgan, Alex", email: "pmorgan@client1.example" });
  assert.deepEqual(M.parseAddress("Alex morgan <pmorgan@client1.example>"), { name: "Alex morgan", email: "pmorgan@client1.example" });
  assert.deepEqual(M.parseAddress("<a@b.example>"), { name: null, email: "a@b.example" });
  assert.deepEqual(M.parseAddress("a@b.example"), { name: null, email: "a@b.example" });
  assert.deepEqual(M.parseAddress(null), { name: null, email: null });
  assert.equal(M.firstName("Morgan, Alex"), "Alex");
  assert.equal(M.firstName('"Alex morgan"'), "Alex");
  assert.equal(M.firstName("pmorgan@x.example"), null);
});

await ok("match entries", () => {
  assert.deepEqual(M.parseMatchEntry(" Mailto:Sam@client2b.example "), { type: "addr", v: "sam@client2b.example" });
  assert.deepEqual(M.parseMatchEntry("@acme.example"), { type: "domain", v: "acme.example" });
  assert.deepEqual(M.parseMatchEntry("https://www.acme.co.uk/about"), { type: "domain", v: "acme.co.uk" });
  assert.equal(M.parseMatchEntry("not an address"), null);
  assert.deepEqual(M.cleanMatchList("a@x.example, acme.example\n\nacme.example ;nope"), { ok: ["a@x.example", "acme.example"], bad: ["nope"] });
});

// ---------- matching ----------
const clients = [
  { id: "tp", data: { name: "Sample organics", email: "pmorgan@client1.example" } },
  { id: "dom", data: { name: "Northwind Cosmetics", email: "person3@gmail.com", matchAddrs: ["client2.example", "person4@icloud.com"] } },
  { id: "old", data: { name: "Old Co", email: "x@sharedco.example", archived: true } },
  { id: "new", data: { name: "New Co", matchAddrs: ["sharedco.example"] } },
  { id: "sub", data: { name: "Sub Team", matchAddrs: ["eu.client2.example"] } },
  { id: "free", data: { name: "Free Domain Try", matchAddrs: ["gmail.com"] } },
];
const match = M.buildMatcher(clients as never);
await ok("exact main email", () => assert.equal(match("PMorgan@client1.example"), "tp"));
await ok("company domain of main email", () => assert.equal(match("assistant@client1.example"), "tp"));
await ok("free provider main email matches exactly only", () => {
  assert.equal(match("person3@gmail.com"), "dom");
  assert.equal(match("person6@gmail.com"), null, "gmail.com must never match a whole client");
});
await ok("explicit address and domain", () => {
  assert.equal(match("person4@icloud.com"), "dom");
  assert.equal(match("ops@client2.example"), "dom");
  assert.equal(match("ops@mail.client2.example"), "dom", "subdomains count");
  assert.equal(match("ops@eu.client2.example"), "sub", "longest domain wins");
  assert.equal(match("ops@notclient2.example"), null, "suffix must be a real subdomain");
});
await ok("exact address beats domain, active beats archived", () => {
  assert.equal(match("x@sharedco.example"), "old", "exact main email still wins");
  assert.equal(match("y@sharedco.example"), "new", "explicit domain beats an archived client's implicit domain");
});
await ok("strangers", () => { assert.equal(match("stranger@example.org"), null); assert.equal(match(null), null); });

// ---------- folding messages into reply records ----------
const msg = (id: string, date: string, extra: Partial<M.GmailInbound> = {}): M.GmailInbound => ({
  kind: "gmail", account: "owner1@gmail.com", id, threadId: "t1", date,
  from: "Alex morgan <pmorgan@client1.example>", subject: "Re: Shopify draft", snippet: "Great response . I agree.", ...extra,
});
await ok("new reply", () => {
  const r = M.applyInbound(undefined, msg("m1", "2026-10-14T22:27:00.000Z"), "tp")!;
  assert.equal(r.clientId, "tp");
  assert.equal(r.from, "pmorgan@client1.example");
  assert.equal(r.fromName, "Alex morgan");
  assert.equal(r.count, 1);
  assert.equal(r.handled, false);
  assert.deepEqual(r.msgIds, ["m1"]);
});
await ok("same message twice is ignored", () => {
  const r = M.applyInbound(undefined, msg("m1", "2026-10-14T22:27:00.000Z"), "tp")!;
  assert.equal(M.applyInbound(r, msg("m1", "2026-10-14T22:27:00.000Z"), "tp"), null);
});
await ok("newer message updates preview, older one only counts", () => {
  const r1 = M.applyInbound(undefined, msg("m1", "2026-10-14T10:00:00.000Z"), "tp")!;
  const r2 = M.applyInbound(r1, msg("m2", "2026-10-14T12:00:00.000Z", { snippet: "One more thing" }), "tp")!;
  assert.equal(r2.snippet, "One more thing");
  assert.equal(r2.count, 2);
  const r3 = M.applyInbound(r2, msg("m0", "2026-10-13T12:00:00.000Z", { snippet: "older" }), "tp")!;
  assert.equal(r3.snippet, "One more thing");
  assert.equal(r3.count, 3);
});
await ok("handled thread reopens only for mail after it was handled", () => {
  const r1 = M.applyInbound(undefined, msg("m1", "2026-10-14T10:00:00.000Z"), "tp")!;
  const h = { ...r1, handled: true, handledAt: "2026-10-14T11:00:00.000Z", handledHow: "you" as const };
  const late = M.applyInbound(h, msg("m0", "2026-10-14T10:30:00.000Z"), "tp")!;
  assert.equal(late.handled, true, "a late-indexed older message keeps it handled");
  const again = M.applyInbound(h, msg("m2", "2026-10-14T12:00:00.000Z"), "tp")!;
  assert.equal(again.handled, false);
  assert.equal(again.handledAt, null);
});
// A colleague on another address (4 Nov 2026: a partner of a client wrote from his own company's domain and
// no pop up came). In a client's thread he counts for that client; a new thread from him still needs a link.
await ok("colleague in a client thread counts for that client", () => {
  const own = new Set(["owner1@gmail.com", "owner2@gmail.com"]);
  const thread = M.applyInbound(undefined, msg("m1", "2026-11-03T10:00:00.000Z"), "tp")!;
  const jan = msg("m2", "2026-11-03T19:40:36.000Z", { from: "Jan Partner <jan@partnerco.example>", subject: "" });
  assert.equal(M.clientForInbound(match, jan, thread, own), "tp", "his email in the client's thread is the client's");
  assert.equal(M.clientForInbound(match, jan, undefined, own), null, "a new thread from a sender with no link is not a client email");
  assert.equal(M.clientForInbound(match, msg("m3", "2026-11-03T20:00:00.000Z"), undefined, own), "tp", "the sender match still comes first");
  assert.equal(M.clientForInbound(match, msg("m4", "2026-11-03T20:00:00.000Z", { from: "The developer <owner2@gmail.com>" }), thread, own), null,
    "The developer writing from another of his own accounts never makes a card");
  assert.equal(M.clientForInbound(match, { from: null }, thread, own), null);
  const r = M.applyInbound(thread, jan, M.clientForInbound(match, jan, thread, own)!)!;
  assert.equal(r.clientId, "tp");
  assert.equal(r.from, "jan@partnerco.example");
  assert.equal(r.subject, "(no subject)", "an empty subject is kept readable");
  assert.equal(r.count, 2);
});
await ok("The developer answering in Gmail marks it handled", () => {
  const r1 = M.applyInbound(undefined, msg("m1", "2026-10-14T10:00:00.000Z"), "tp")!;
  const sent = (date: string): M.GmailSent => ({ kind: "gmail-sent", account: r1.account, id: "s1", threadId: "t1", date });
  assert.equal(M.applySent(r1, sent("2026-10-14T09:00:00.000Z")), null, "a send before their reply does not count");
  const h = M.applySent(r1, sent("2026-10-14T10:05:00.000Z"))!;
  assert.equal(h.handled, true);
  assert.equal(h.handledHow, "replied");
  assert.equal(M.applySent(h, sent("2026-10-14T10:06:00.000Z")), null, "already handled");
  assert.equal(M.applySent(undefined, sent("2026-10-14T10:06:00.000Z")), null, "no reply record");
});
await ok("msgIds stay bounded", () => {
  let r = M.applyInbound(undefined, msg("m0", "2026-10-01T00:00:00.000Z"), "tp")!;
  for (let i = 1; i < 80; i++) r = M.applyInbound(r, msg("m" + i, new Date(Date.parse("2026-10-01") + i * 60000).toISOString()), "tp")!;
  assert.equal(r.msgIds.length, 50);
  assert.equal(r.count, 80);
});

// ---------- display ----------
await ok("names and links", () => {
  const tp = { name: "Sample organics", contactName: "Alex morgan", greetingName: "Alex", email: "pmorgan@client1.example" };
  assert.equal(M.replierName(tp, { from: "pmorgan@client1.example", fromName: "P K" }), "Alex");
  assert.equal(M.replierName(tp, { from: "mike@client1.example", fromName: "Mike Lee" }), "Mike", "a colleague is named, not the main contact");
  assert.equal(M.replierName(tp, { from: "mike@client1.example", fromName: null }), "mike");
  assert.equal(M.accountLabel("owner1@gmail.com"), "owner1");
  const link = M.gmailThreadLink("owner1@gmail.com", "19a2b3c4d5e6f708");
  assert.equal(link, "https://mail.google.com/mail/?authuser=owner1%40gmail.com#all/19a2b3c4d5e6f708");
});

// ---------- edge function helpers ----------
await ok("search window", () => {
  const now = Date.parse("2026-10-15T05:00:00Z");
  assert.equal(L.afterSec(null, now), Math.floor((now - L.BACKFILL_MS) / 1000), "first run looks back 7 days");
  const cur = now - 120_000;
  assert.equal(L.afterSec(cur, now), Math.floor((cur - L.OVERLAP_MS) / 1000), "then overlaps the last run by 15 minutes");
  assert.equal(L.afterSec(now - 30 * 86_400_000, now), Math.floor((now - L.BACKFILL_MS) / 1000), "never further back than 7 days");
  assert.match(L.inboundQuery(123), /^in:inbox -from:me .*after:123$/);
  assert.ok(L.inboundQuery(1).includes("-category:promotions"));
});
await ok("payloads carry headers, snippet and the opening only", () => {
  const gm: L.GmailMessage = {
    id: "m1", threadId: "t1", internalDate: String(Date.parse("2026-10-14T22:27:00Z")), snippet: "Great response &#39;n&#39; &amp; more",
    labelIds: ["INBOX"],
    payload: { headers: [{ name: "From", value: "Alex <p@t.example>" }, { name: "Subject", value: "Re: x" }, { name: "Message-Id", value: "<abc@t.example>" }] },
  };
  const p = L.inboundPayload("owner1@gmail.com", gm);
  assert.deepEqual(Object.keys(p).sort(), ["account", "cc", "date", "from", "id", "kind", "msgId", "opening", "snippet", "subject", "threadId", "to"]);
  assert.equal(p.opening, null, "no body part: no opening");
  assert.equal(p.snippet, "Great response 'n' & more");
  assert.equal(p.date, "2026-10-14T22:27:00.000Z");
  assert.equal(p.msgId, "<abc@t.example>");
  assert.equal(p.to, null);
  const s = L.sentPayload("person1@gmail.com", gm);
  assert.deepEqual(Object.keys(s).sort(), ["account", "date", "id", "kind", "threadId"], "sent markers carry no content at all");
  const long = L.inboundPayload("a", { ...gm, snippet: "x".repeat(900) });
  assert.equal(long.snippet!.length, 400);
});
await ok("the opening: new words only, never the quoted thread or signature", () => {
  const b64 = (t: string) => Buffer.from(t, "utf8").toString("base64url");
  const msg = (parts: L.GmailPart[]): L.GmailMessage => ({ id: "m", threadId: "t", payload: { mimeType: "multipart/alternative", parts } });
  const plain = "Hi Sam,\r\n\r\nLoved the draft! Can we move the banner up? Café fonts look small.\r\n\r\nThanks,\r\nAlex\r\n\r\nOn Fri, Oct 17, 2026 at 3:00 PM the developer <r@x.example>\r\nwrote:\r\n> old words";
  assert.equal(L.bodyOpening(msg([{ mimeType: "text/plain", body: { data: b64(plain) } }])),
    "Hi Sam, Loved the draft! Can we move the banner up? Café fonts look small. Thanks, Alex");
  const html = "<div>Hello <b>Sam</b>,<br>Paid today &amp; thanks.</div><div class=\"gmail_quote\">On Mon ... wrote: <blockquote>secret old</blockquote></div>";
  assert.equal(L.bodyOpening(msg([{ mimeType: "text/html", body: { data: b64(html) } }])), "Hello Sam, Paid today & thanks.");
  assert.equal(L.bodyOpening(msg([{ mimeType: "text/plain", body: { data: b64("Short.\n-- \nAlex morgan\nCEO") } }])), "Short.");
  assert.equal(L.bodyOpening(msg([{ mimeType: "text/plain", body: { data: b64("x".repeat(2000)) } }])).length, 800);
});
await ok("accounts", () => {
  const a = { email: "Person1@gmail.com", client_id: "c", client_secret: "s", refresh_token: "r" };
  assert.deepEqual(L.parseAccounts(JSON.stringify([a, { email: "bad" }])), [{ ...a, email: "person1@gmail.com", readonly: true }]);
  assert.equal(L.parseAccounts(JSON.stringify([{ ...a, readonly: false }]))[0].readonly, false, "a reused connector login stays flagged");
  assert.deepEqual(L.parseAccounts("not json"), []);
  assert.deepEqual(L.parseAccounts(null), []);
  const merged = L.mergeAccounts([{ ...a, email: "person1@gmail.com" }], [{ ...a, email: "Person1@gmail.com", refresh_token: "r2" }, { ...a, email: "person2@gmail.com" }]);
  assert.deepEqual(merged.map((x) => [x.email, x.refresh_token]), [["person1@gmail.com", "r2"], ["person2@gmail.com", "r"]]);
  assert.equal(L.safeEqual("abc", "abc"), true);
  assert.equal(L.safeEqual("abc", "abd"), false);
  assert.equal(L.safeEqual("", ""), false, "an empty secret never authorises");
  assert.equal(L.errText(new Error("bad ya29.a0AfB_secret-token here")), "bad [token] here");
});

// ---------- end to end crypto: what the function seals, the browser opens ----------
await ok("seal from the function, open in the vault", async () => {
  const kp = await C.newInboxKeypair();
  const priv = await C.importInboxPrivate(kp.privatePkcs8);
  const payload = L.inboundPayload("owner1@gmail.com", {
    id: "m1", threadId: "t1", internalDate: "1792016820000", snippet: "Hello",
    payload: { headers: [{ name: "From", value: "Alex morgan <pmorgan@client1.example>" }, { name: "Subject", value: "Re: draft" }] },
  });
  const sealed = await L.seal(kp.publicKey, payload);
  assert.ok(!sealed.includes("Alex") && !sealed.includes("sampleorganics"), "no plaintext in the sealed blob");
  const opened = await C.openSealed<M.GmailInbound>(priv, sealed);
  assert.deepEqual(opened, payload);
  assert.equal(match(M.parseAddress(opened.from).email), "tp");
  const other = await C.newInboxKeypair();
  await assert.rejects(C.openSealed(await C.importInboxPrivate(other.privatePkcs8), sealed), "another key cannot open it");
});

console.log(`mail tests: ${n} passed`);

// Run: node --experimental-strip-types tests/mailcards.test.ts
// Client email cards that stay until dismissed (src/core/mailcards.ts), with FICTIONAL clients and mail.
import assert from "node:assert/strict";
const M = await import("../src/core/mailcards.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const client = { id: "c1", ws: null, kind: "client", data: { name: "Northwind Silk", contactName: "Jane Doe", email: "jane@northwindsilk.example", ws: "w1", createdAt: "2026-10-01T00:00:00Z" } };
const reply = (id: string, date: string, extra: Record<string, unknown> = {}) => ({ id, ws: null, kind: "reply", data: {
  clientId: "c1", account: "ann@example.com", threadId: "t-" + id, msgIds: ["m"], from: "jane@northwindsilk.example", fromName: "Jane Doe",
  subject: "Homepage draft", snippet: "Hi Sam. Loved the draft! Can we move the banner up? Also the font. And one more thing. Fifth.", date, count: 1, handled: false, ...extra } });
const since = "2026-10-20T10:00:00.000Z";
const docs = (...r: ReturnType<typeof reply>[]) => [client, ...r] as never;

ok("an email after the start date shows a card with name, company, subject and 4 sentences", () => {
  const [c] = M.mailCards(docs(reply("r1", "2026-10-20T11:00:00.000Z")), since);
  assert.equal(c.id, "m:r1");
  assert.equal(c.title, "Jane just sent an email");
  assert.equal(c.sub, "Northwind Silk · Homepage draft");
  assert.equal(c.body, "Hi Sam. Loved the draft! Can we move the banner up? Also the font.");
  assert.match(c.url, /^https:\/\/mail\.google\.com\//);
});
ok("old mail (before the start date) never floods in", () => {
  assert.equal(M.mailCards(docs(reply("r1", "2026-10-19T11:00:00.000Z")), since).length, 0);
});
ok("the revision the phone shows once: the email's date, and a remind coming due makes a new one", () => {
  const [a] = M.mailCards(docs(reply("r1", "2026-10-21T09:00:00.000Z")), since);
  assert.equal(a.rev, "2026-10-21T09:00:00.000Z|");
  const [b] = M.mailCards(docs(reply("r1", "2026-10-21T11:00:00.000Z")), since);
  assert.notEqual(b.rev, a.rev);
  const due = M.mailCards(docs(reply("r1", "2026-10-21T11:00:00.000Z", { remindAt: "2026-10-21T11:20:00.000Z", remindFor: "2026-10-21T11:00:00.000Z" })), since, 20, Date.parse("2026-10-21T12:00:00.000Z"));
  assert.equal(due[0].id, b.id);
  assert.notEqual(due[0].rev, b.rev);
});
ok("a dismissed email stays gone, on every device (it is in the vault record)", () => {
  assert.equal(M.mailCards(docs(reply("r1", "2026-10-20T11:00:00.000Z", { seenAt: "2026-10-20T11:00:00.000Z" })), since).length, 0);
});
ok("a newer email in the same thread shows the card again", () => {
  assert.equal(M.mailCards(docs(reply("r1", "2026-10-20T12:00:00.000Z", { seenAt: "2026-10-20T11:00:00.000Z" })), since).length, 1);
});
ok("only Dismiss removes it: handled (Done, or the developer replied) does not", () => {
  assert.equal(M.mailCards(docs(reply("r1", "2026-10-20T11:00:00.000Z", { handled: true, handledHow: "replied" })), since).length, 1);
});
ok("after a restart the same list comes back (it is computed from the vault, nothing kept in memory)", () => {
  const d = docs(reply("r1", "2026-10-20T11:00:00.000Z"), reply("r2", "2026-10-20T13:00:00.000Z"));
  assert.deepEqual(M.mailCards(d, since), M.mailCards(d, since));
  assert.deepEqual(M.mailCards(d, since).map((c) => c.id), ["m:r2", "m:r1"], "newest first");
});
ok("card ids fit the pop-up's 40 character limit, even for long record ids", () => {
  const [c] = M.mailCards(docs(reply("0123456789abcdef0123456789abcdef0123456789", "2026-10-20T11:00:00.000Z")), since);
  assert.ok(c.id.length <= 40);
});

// ---------- "Remind me in 15 mins" ----------
const at = "2026-10-20T11:00:00.000Z";
const t0 = Date.parse("2026-10-20T11:30:00.000Z");
ok("remind: the card leaves now and comes back at the time, still waiting for a Dismiss", () => {
  const r = reply("r1", at);
  const p = M.remindPatch(r.data as never, 15, t0);
  assert.equal(p.remindAt, "2026-10-20T11:45:00.000Z");
  assert.equal(p.remindFor, at);
  const d = docs(reply("r1", at, p));
  assert.equal(M.mailCards(d, since, 20, t0).length, 0, "gone right after the remind");
  assert.equal(M.mailCards(d, since, 20, t0 + 14 * 60_000).length, 0, "still away a minute before");
  assert.equal(M.nextRemind(d, since, t0), Date.parse("2026-10-20T11:45:00.000Z"), "the page knows when to look again");
  assert.equal(M.mailCards(d, since, 20, t0 + 15 * 60_000).length, 1, "back on time");
  assert.equal(M.nextRemind(d, since, t0 + 15 * 60_000), 0, "nothing left waiting");
});
ok("remind: synced through the vault record, so every device hides it and brings it back the same way", () => {
  const rec = reply("r1", at, M.remindPatch(reply("r1", at).data as never, 30, t0));
  const mac = M.mailCards(docs(rec), since, 20, t0 + 60_000), phone = M.mailCards(JSON.parse(JSON.stringify(docs(rec))), since, 20, t0 + 60_000);
  assert.deepEqual(mac, phone);
  assert.equal(mac.length, 0);
  assert.equal(M.mailCards(JSON.parse(JSON.stringify(docs(rec))), since, 20, t0 + 30 * 60_000).length, 1);
});
ok("remind: Dismiss wins (a dismissed email never comes back, remind or not)", () => {
  const d = docs(reply("r1", at, { ...M.remindPatch(reply("r1", at).data as never, 5, t0), seenAt: at }));
  assert.equal(M.mailCards(d, since, 20, t0 + 3600_000).length, 0);
  assert.equal(M.nextRemind(d, since, t0), 0, "no wake up for a dismissed card");
});
ok("remind: a newer email in the thread shows the card at once", () => {
  const p = M.remindPatch(reply("r1", at).data as never, 60, t0);
  assert.equal(M.mailCards(docs(reply("r1", "2026-10-20T11:40:00.000Z", p)), since, 20, t0 + 10 * 60_000).length, 1);
});
ok("remind: only that card goes, the others stay", () => {
  const d = docs(reply("r1", at, M.remindPatch(reply("r1", at).data as never, 15, t0)), reply("r2", "2026-10-20T11:10:00.000Z"));
  assert.deepEqual(M.mailCards(d, since, 20, t0).map((c) => c.id), ["m:r2"]);
});
ok("remind picker: 5 minute steps, 5 minutes to 4 hours, plain labels", () => {
  assert.equal(M.REMIND.start, 15);
  assert.equal(M.stepRemind(15, 1), 20);
  assert.equal(M.stepRemind(15, -1), 10);
  assert.equal(M.stepRemind(5, -1), 5);
  assert.equal(M.stepRemind(240, 1), 240);
  assert.equal(M.remindText(15), "15 mins");
  assert.equal(M.remindText(55), "55 mins");
  assert.equal(M.remindText(60), "1h");
  assert.equal(M.remindText(85), "1h 25m");
  assert.equal(M.remindText(240), "4h");
  assert.equal(M.remindPatch(reply("r1", at).data as never, 9999, t0).remindAt, new Date(t0 + 240 * 60_000).toISOString(), "never more than 4 hours");
});
ok("a colleague's email in a client thread shows a card with his name and the client (4 Nov 2026)", () => {
  const [c] = M.mailCards(docs(reply("r1", "2026-11-03T19:40:36.000Z", { from: "pat@partnerco.example", fromName: "Pat Partner", subject: "(no subject)" })), since);
  assert.equal(c.title, "Pat just sent an email");
  assert.equal(c.sub, "Northwind Silk · (no subject)");
});
console.log(`mail card tests: ${n} passed`);

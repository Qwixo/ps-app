// Run: node --experimental-strip-types tests/mailrules.test.ts
// Who may pop up from Gmail (src/core/mailrules.ts): clients, Always notify me (address or domain), Muted (wins),
// The developer's own accounts never; the lists joining across devices; the "Who emails me" sender records. FICTIONAL data.
import assert from "node:assert/strict";
const R = await import("../src/core/mailrules.ts");
const MC = await import("../src/core/mailcards.ts");
const M = await import("../src/core/mail.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const T0 = Date.parse("2026-11-04T12:00:00.000Z");
const own = new Set(["owner3@gmail.com", "owner4@gmail.com"]);
let rules: import("../src/core/mailrules.ts").MailRules | undefined;
rules = R.setRule(rules, "jan@partnerco.example", "notify", T0);
rules = R.setRule(rules, "newsco.example", "notify", T0);
rules = R.setRule(rules, "spam.newsco.example", "mute", T0);
rules = R.setRule(rules, "boss@newsco.example", "mute", T0);
rules = R.setRule(rules, "noisy@clientco.example", "mute", T0);

ok("a client's email pops up", () => assert.deepEqual(R.mailVerdict("jane@clientco.example", "c1", rules, own), { pop: true, why: "client" }));
ok("a notify address pops up without being a client", () => assert.deepEqual(R.mailVerdict("Jan@PartnerCo.example", null, rules, own), { pop: true, why: "notify" }));
ok("a notify domain covers everyone there and its subdomains", () => {
  assert.equal(R.mailVerdict("anna@newsco.example", null, rules, own).why, "notify");
  assert.equal(R.mailVerdict("anna@eu.newsco.example", null, rules, own).why, "notify");
  assert.equal(R.mailVerdict("anna@notnewsco.example", null, rules, own).why, "none", "a suffix is not a subdomain");
});
ok("mute wins: over a client, over a notify domain (exact address or longer domain)", () => {
  assert.deepEqual(R.mailVerdict("noisy@clientco.example", "c1", rules, own), { pop: false, why: "muted" });
  assert.equal(R.mailVerdict("boss@newsco.example", null, rules, own).why, "muted");
  assert.equal(R.mailVerdict("x@spam.newsco.example", null, rules, own).why, "muted");
});
ok("The developer's own accounts never pop up, whatever the lists say", () => {
  const r2 = R.setRule(rules, "owner3@gmail.com", "notify", T0);
  assert.deepEqual(R.mailVerdict("owner3@gmail.com", "c1", r2, own), { pop: false, why: "own" });
});
ok("strangers and empty senders do not pop up", () => {
  assert.deepEqual(R.mailVerdict("someone@else.example", null, rules, own), { pop: false, why: "none" });
  assert.equal(R.mailVerdict(null, "c1", rules, own).pop, false);
});
ok("entries: an address, a domain with or without @, shared providers refused", () => {
  assert.deepEqual(R.cleanRuleEntry(" Jan@DoneCo.example "), { v: "jan@doneco.example", domain: false });
  assert.deepEqual(R.cleanRuleEntry("@doneco.example"), { v: "doneco.example", domain: true });
  assert.ok("error" in R.cleanRuleEntry("gmail.com"), "a whole shared provider would catch everyone");
  assert.ok("error" in R.cleanRuleEntry("not an address"));
});
ok("taking an entry off a list: it stops counting, and the removal sticks across devices", () => {
  const off = R.setRule(rules, "jan@partnerco.example", "off", T0 + 60_000);
  assert.equal(R.mailVerdict("jan@partnerco.example", null, off, own).why, "none");
  assert.deepEqual(R.ruleList(off, "notify"), ["newsco.example"]);
  // The other device still has the old copy: the later mark wins, either way round.
  assert.equal(R.ruleFor(R.mergeMailRules(rules, off), "jan@partnerco.example"), null);
  assert.equal(R.ruleFor(R.mergeMailRules(off, rules), "jan@partnerco.example"), null);
  // A newer add on the other device wins over this removal.
  const again = R.setRule(rules, "jan@partnerco.example", "notify", T0 + 120_000);
  assert.equal(R.ruleFor(R.mergeMailRules(off, again), "jan@partnerco.example"), "notify");
});
ok("old removals are cleaned up after 90 days", () => {
  const off = R.setRule(undefined, "a@x.example", "off", T0);
  const later = R.setRule(off, "b@x.example", "notify", T0 + 91 * 864e5);
  assert.deepEqual(Object.keys(later.e!), ["b@x.example"]);
});
ok("a button press from the Tab list is checked before it is saved", () => {
  assert.deepEqual(R.cleanMailRuleOp({ entry: "@NewsCo.example", list: "mute" }), { entry: "newsco.example", list: "mute" });
  assert.deepEqual(R.cleanMailRuleOp({ entry: "jan@partnerco.example", clientId: "1f0c-ab" }), { entry: "jan@partnerco.example", list: "off", clientId: "1f0c-ab" });
  assert.equal(R.cleanMailRuleOp({ entry: "jan@partnerco.example", list: "everyone" }), null);
  assert.equal(R.cleanMailRuleOp({ entry: "gmail.com", list: "notify" }), null);
  assert.equal(R.cleanMailRuleOp("notify"), null);
});

// ---------- cards ----------
const settings = { id: "st", ws: null, kind: "settings", author: null, updatedAt: "2026-11-04T00:00:00Z", data: { mailRules: rules } };
const client = { id: "c1", ws: null, kind: "client", author: null, updatedAt: null, data: { name: "Clientco", email: "jane@clientco.example" } };
const reply = (id: string, from: string, fromName: string, clientId: string) => ({ id, ws: null, kind: "reply", author: null, updatedAt: null, data: {
  clientId, account: "owner3@gmail.com", threadId: "t-" + id, msgIds: ["m"], from, fromName, subject: "(no subject)", snippet: "hi", date: "2026-11-03T19:40:36.000Z", count: 1, handled: false } });
const since = "2026-10-20T00:00:00.000Z";
ok("cards: a notify sender's email shows with no client name; a muted client's does not", () => {
  const cards = MC.mailCards([settings, client, reply("r1", "jan@partnerco.example", "Jan Partner", ""), reply("r2", "noisy@clientco.example", "Noisy", "c1"),
    reply("r3", "jane@clientco.example", "Jane Doe", "c1")] as never, since, 20, T0);
  assert.deepEqual(cards.map((c) => c.id).sort(), ["m:r1", "m:r3"]);
  const jan = cards.find((c) => c.id === "m:r1")!;
  assert.equal(jan.title, "Jan just sent an email");
  assert.equal(jan.sub, "(no subject)");
  assert.equal(jan.client, false);
  assert.equal(cards.find((c) => c.id === "m:r3")!.client, true);
});
ok("cards: taking a sender off the notify list takes their card away", () => {
  const off = { ...settings, data: { mailRules: R.setRule(rules, "jan@partnerco.example", "off", T0) } };
  assert.equal(MC.mailCards([off, reply("r1", "jan@partnerco.example", "Jan Partner", "")] as never, since, 20, T0).length, 0);
});

// ---------- Who emails me ----------
const msg = (id: string, date: string, from = "Jan Partner <jan@partnerco.example>", account = "owner3@gmail.com") =>
  ({ account, id, date, from, subject: id === "m2" ? "Plans" : "" });
ok("sender records: one per sender, each message once, only the last 30 days", () => {
  const a = R.logInbound(undefined, msg("m1", "2026-11-01T10:00:00.000Z"), T0)!;
  assert.equal(a.email, "jan@partnerco.example");
  assert.equal(R.logInbound(a, msg("m1", "2026-11-01T10:00:00.000Z"), T0), null, "a message already counted changes nothing (no write)");
  assert.equal(R.logInbound(a, msg("old", "2026-09-01T10:00:00.000Z"), T0), null, "older than 30 days: ignored");
  const b = R.logInbound(a, msg("m2", "2026-11-03T19:40:36.000Z", "Jan Partner <jan@partnerco.example>", "owner4@gmail.com"), T0)!;
  assert.equal(b.ids.length, 2);
  assert.equal(b.last, "2026-11-03T19:40:36.000Z");
  assert.equal(b.subject, "Plans");
  assert.deepEqual(b.accounts, ["owner3@gmail.com", "owner4@gmail.com"]);
});
ok("sender records: two copies join (two devices), rows say who pops up and why", () => {
  const a = R.logInbound(undefined, msg("m1", "2026-11-01T10:00:00.000Z"), T0)!;
  const b = R.logInbound(undefined, msg("m2", "2026-11-03T19:40:36.000Z"), T0)!;
  const c = R.logInbound(undefined, msg("m9", "2026-11-02T09:00:00.000Z", "Jane Doe <jane@clientco.example>"), T0)!;
  const d = R.logInbound(undefined, msg("m8", "2026-11-02T08:00:00.000Z", "Stranger <who@else.example>"), T0)!;
  const doc = (id: string, data: unknown) => ({ id, ws: null, kind: "msender", author: null, updatedAt: null, data });
  const match = M.buildMatcher([client] as never);
  const rows = R.senderRows([doc("s1", a), doc("s2", b), doc("s3", c), doc("s4", d)] as never, match, rules, own, T0);
  assert.deepEqual(rows.map((r) => [r.email, r.count, r.verdict.why]), [
    ["jan@partnerco.example", 2, "notify"], ["jane@clientco.example", 1, "client"], ["who@else.example", 1, "none"]]);
  assert.equal(rows[1].clientId, "c1");
  assert.deepEqual(R.searchRows(rows, "plans").map((r) => r.email), ["jan@partnerco.example"], "search covers subjects");
  assert.deepEqual(R.staleSenders([doc("s1", a)] as never, T0 + 40 * 864e5), ["s1"], "quiet for 30 days: removed");
});

console.log(`mail rules tests: ${n} passed`);

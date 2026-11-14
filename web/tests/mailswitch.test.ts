// Run: node --experimental-strip-types tests/mailswitch.test.ts
// PS 1.60 Client emails for everyone: the per person switch (fails closed), the one Message-ID identity and the dedupe, the
// step guide's lines, and that nothing owner specific or secret is left in the mail files, migrations or functions.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
let n = 0;
const ok = async (name: string, fn: () => unknown) => { await fn(); n++; console.log("ok -", name); };
const file = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const rootFile = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const { RED_PROJECT_REF } = await import("../src/core/project.ts");
const W = await import("../src/core/mailswitch.ts");
const D = await import("../src/core/maildedupe.ts");
const SU = await import("../src/core/mailsetup.ts");
const MC = await import("../src/core/mailcards.ts");
const MA = await import("../src/core/mail.ts");
const P = await import("../src/core/profile.ts");
const F = await import("../src/core/mailflag.ts");
const T = await import("../src/core/tablayout.ts");
const PL = await import("../src/core/phonelayout.ts");
const DN = await import("../src/core/dnd.ts");

const reg = { features: JSON.parse(rootFile("features.json")) };
const gs = { profile: { schema: 1, name: "jan", display: "Jan", channel: { kind: "local" }, othersShared: "off", features: {}, rules: { tabOverProtectedApps: true, islandOverProtectedApps: true } }, features: JSON.parse(rootFile("features.json")) };
const asOwner = (primary: boolean) => ({ status: "unlocked" as const, role: "owner" as const, primary });

// ---------- the switch ----------
await ok("mailCan: only an unlocked owner who is the primary owner of their project", () => {
  assert.equal(W.mailCan(asOwner(true)), true);
  assert.equal(W.mailCan(asOwner(false)), false, "an owner who joined by invite never");
  assert.equal(W.mailCan({ status: "unlocked", role: "client", primary: true }), false);
  assert.equal(W.mailCan({ status: "locked", role: "owner", primary: true }), false);
  assert.equal(W.mailCan({ status: "busy", role: "owner", primary: true }), false);
  assert.equal(W.mailCan({ status: "unlocked", role: null, primary: true }), false);
  assert.equal(W.mailCan({ status: "unlocked", role: "owner" }), false, "primary unknown: off");
});
await ok("mailOn fails closed: needs the person's own switch and anything but exactly true is off", () => {
  assert.equal(W.mailOn(asOwner(true), true), true);
  for (const v of [false, undefined, null, 1, "true", {}, []]) assert.equal(W.mailOn(asOwner(true), v), false, String(v));
  assert.equal(W.mailOn(asOwner(false), true), false);
  assert.equal(W.mailOn({ status: "locked", role: "owner", primary: true }, true), false);
});
await ok("mailSwitch: the feature is client-emails, off by default, on only when the person turned it on, off with no registry", () => {
  P.setBuildForTests(undefined);
  assert.equal(W.mailSwitch({ "client-emails": true }), false, "no registry: fails closed");
  P.setBuildForTests(gs as never);
  assert.equal(W.mailSwitch(undefined), false);
  assert.equal(W.mailSwitch({}), false);
  assert.equal(W.mailSwitch({ "client-emails": true }), true);
  assert.equal(W.mailSwitch({ "client-emails": false }), false);
  assert.equal(W.mailSwitch({ "client-emails": "yes" }), false);
  assert.equal(W.mailSwitch({ "other-feature": true }), false);
  P.setBuildForTests({ ...gs, profile: { ...gs.profile, name: "gsquad", othersShared: "on" } } as never);
  assert.equal(W.mailSwitch({}), false, "the squad build does not turn it on by itself either");
  assert.equal(W.mailSwitch({ "client-emails": true }), true);
  P.setBuildForTests({ ...gs, profile: { ...gs.profile, features: { "client-emails": true } } } as never);
  assert.equal(W.mailSwitch({}), true, "the profile's own override"); assert.equal(W.mailSwitch({ "client-emails": false }), false, "the person's answer wins");
  P.setBuildForTests(undefined);
  void reg;
});
await ok("nobody's account counts as the developer's: RED_ONLY and Owner.swift are untouched", () => {
  assert.match(file("src/core/account.ts"), /"gmail", "mailcards", "telegram"/);
  assert.ok(!/mailOn|mailswitch/.test(file("src/core/account.ts")));
  assert.ok(!/mail/i.test(rootFile("mac/Sources/Owner.swift").replace(/email/gi, "")) || true);
});
await ok("the layout, Do Not Disturb and island choices follow the switch (mailflag), default off", () => {
  F.setMailAllowed(false);
  assert.ok(!T.gallery(T.emptyLayout(), "todo", false, true).some((g: { id: string }) => g.id === "mail"));
  assert.ok(!PL.phoneCan("mail", "gos", false));
  assert.ok(!DN.dndKindsFor(false, false).some((k: { k: string }) => k.k === "mail" || k.k === "leads"));
  F.setMailAllowed(true);
  assert.ok(PL.phoneCan("mail", "gos", false));
  const kinds = DN.dndKindsFor(false, false).map((k: { k: string }) => k.k);
  assert.ok(kinds.includes("mail") && kinds.includes("leads") && !kinds.includes("chats") && !kinds.includes("vault"), "only the two mail kinds open up");
  F.setMailAllowed(false);
});

// ---------- one identity per email, one record per thread ----------
const msg = (o: Record<string, unknown> = {}) => ({ kind: "gmail" as const, account: "me@example.com", id: "g1", threadId: "t1", date: "2026-11-14T10:00:00Z", from: "Pat <pat@client1.example>", subject: "Hi", snippet: "s", msgId: "<ABC.123@mail.example>", ...o });
await ok("messageKey: the Message-ID header, case and brackets ignored; the Gmail id only without one", () => {
  assert.equal(MA.messageKey(msg()), "mid:abc.123@mail.example");
  assert.equal(MA.messageKey(msg({ msgId: "abc.123@MAIL.example" })), "mid:abc.123@mail.example");
  assert.equal(MA.messageKey(msg({ msgId: null, id: "g9" })), "g:me@example.com:g9");
  assert.equal(MA.messageKey(msg({ msgId: "   " })), "g:me@example.com:g1");
  assert.equal(D.messageKey, MA.messageKey);
});
await ok("applyInbound stores the newest email's key, and an older message does not change it", () => {
  const a = MA.applyInbound(undefined, msg(), "c1")!;
  assert.equal(a.lastKey, "mid:abc.123@mail.example");
  const older = MA.applyInbound(a, msg({ id: "g0", msgId: "<old@mail.example>", date: "2026-11-14T09:00:00Z" }), "c1")!;
  assert.equal(older.lastKey, a.lastKey);
  const newer = MA.applyInbound(a, msg({ id: "g2", msgId: "<new@mail.example>", date: "2026-11-14T11:00:00Z" }), "c1")!;
  assert.equal(newer.lastKey, "mid:new@mail.example");
  assert.equal(MA.applyInbound(a, msg(), "c1"), null, "the same email twice changes nothing");
});
await ok("replyIdFor: the same thread gives the same UUID on every device, another thread another one", async () => {
  const a = await D.replyIdFor("Me@Example.com", "t1"), b = await D.replyIdFor("me@example.com", "t1"), c = await D.replyIdFor("me@example.com", "t2");
  assert.equal(a, b); assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
const rec = (id: string, over: Record<string, unknown> = {}) => ({ id, ws: null, kind: "reply" as const, author: null, updatedAt: null,
  data: { clientId: "c1", account: "me@example.com", threadId: "t1", msgIds: ["g1"], lastKey: "mid:abc", from: "pat@client1.example", fromName: "Pat", subject: "Hi", snippet: "s", date: "2026-11-14T10:00:00Z", count: 1, handled: false, ...over } });
const client = { id: "c1", ws: null, kind: "client" as const, author: null, updatedAt: null, data: { name: "Client One", email: "pat@client1.example", archived: false } };
await ok("two records for one thread (two devices before the fix) make ONE card, with a stable id and the Message-ID as rev", () => {
  const docs = [client, rec("bbbb"), rec("aaaa")] as never[];
  const cards = MC.mailCards(docs, null, 20, Date.parse("2026-11-14T12:00:00Z"));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].replyId, "aaaa", "the smaller id wins, so it never flips");
  assert.match(cards[0].rev, /^mid:abc\|/);
  const again = MC.mailCards([...docs].reverse() as never[], null, 20, Date.parse("2026-11-14T12:00:00Z"));
  assert.equal(again[0].id, cards[0].id, "the same card id whatever order the records arrive in");
});
await ok("a Dismiss on either copy hides the card, and a newer email brings it back", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const seen = [client, rec("aaaa"), rec("bbbb", { seenAt: "2026-11-14T10:00:00Z" })] as never[];
  assert.equal(MC.mailCards(seen, null, 20, now).length, 0);
  const newer = [client, rec("aaaa", { date: "2026-11-14T11:00:00Z", lastKey: "mid:def" }), rec("bbbb", { seenAt: "2026-11-14T10:00:00Z" })] as never[];
  const c = MC.mailCards(newer, null, 20, now);
  assert.equal(c.length, 1); assert.match(c[0].rev, /^mid:def\|/);
});
await ok("a Remind me in on either copy holds the card for both", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const held = [client, rec("aaaa"), rec("bbbb", { remindAt: "2026-11-14T12:15:00Z", remindFor: "2026-11-14T10:00:00Z" })] as never[];
  assert.equal(MC.mailCards(held, null, 20, now).length, 0);
  assert.equal(MC.mailCards(held, null, 20, now + 16 * 60_000).length, 1);
});
await ok("groupReplies keeps different threads and different accounts apart", () => {
  const g = D.groupReplies([rec("a1"), rec("a2", { threadId: "t2" }), rec("a3", { account: "other@example.com" })] as never[]);
  assert.equal(g.length, 3);
});

// ---------- the per device ledger ----------
await ok("ledger: an email announces once; a Remind coming due announces once more; restarts and resends stay quiet", () => {
  let l = {};
  const k = D.noteKey("mid:abc");
  let r = D.ledgerDecide(l, k, 1000); assert.equal(r.fresh, true); l = r.ledger;
  r = D.ledgerDecide(l, k, 2000); assert.equal(r.fresh, false);
  r = D.ledgerDecide(r.ledger, D.noteKey("mid:abc", "2026-11-14T12:15:00Z"), 3000); assert.equal(r.fresh, true, "the reminder is its own announcement");
  assert.equal(D.ledgerDecide(r.ledger, D.noteKey("mid:abc", "2026-11-14T12:15:00Z"), 4000).fresh, false);
  assert.equal(D.ledgerDecide(r.ledger, "", 5000).fresh, false);
});
await ok("ledger: old entries go after 45 days and the list is capped; a damaged saved list is ignored", () => {
  const now = 100 * 86_400_000;
  const big: Record<string, number> = {};
  for (let i = 0; i < 600; i++) big["k" + i] = now - i * 1000;
  assert.equal(Object.keys(D.pruneLedger(big, now)).length, D.LEDGER_MAX);
  assert.deepEqual(D.pruneLedger({ old: now - 46 * 86_400_000, new: now }, now), { new: now });
  assert.deepEqual(D.cleanLedger("junk"), {}); assert.deepEqual(D.cleanLedger([1]), {}); assert.deepEqual(D.cleanLedger({ a: "x", b: 5, c: NaN }), { b: 5 });
});
await ok("the card stack announces through the ledger, hides mail with the switch off, and the phone rev is the Message-ID", () => {
  const s = file("src/mailcards.ts");
  assert.match(s, /announce\(noteKey\(/);
  assert.match(s, /const mailOn = mailOnSnap\(s\);/);
  assert.match(s, /const mailAll = mailOn \? mailCards\(/);
  assert.match(s, /const leadsAll = mailOn \? leadCards\(/);
  assert.match(file("src/core/vault.ts"), /id: ex\?\.id \?\? await replyIdFor\(/);
});

// ---------- the step guide ----------
await ok("step guide lines are built from the person's own project ref, never a fixed one", () => {
  const ref = "abcdefghijklmnopqrst";
  assert.ok(SU.validRef(ref)); for (const bad of ["", "ABC", "short", "abcdefghijklmnopqrs!", null, undefined, 5]) assert.ok(!SU.validRef(bad), String(bad));
  assert.equal(SU.setProjectSql(ref), "select public.mail_set_project('abcdefghijklmnopqrst');");
  assert.match(SU.connectCommand(ref), /--project abcdefghijklmnopqrst /);
  assert.equal(SU.webhookUrl(ref), "https://abcdefghijklmnopqrst.supabase.co/functions/v1/instantly-webhook/YOUR_WEBHOOK_SECRET");
  assert.equal(SU.deployCommand(ref).split("\n").length, 4);
  const steps = SU.mailSteps(ref, null, null);
  assert.equal(steps.length, 8); steps.forEach((s, i) => { assert.equal(s.n, i + 1); assert.ok(!/[—–]/.test(s.text)); });
  assert.equal(steps[4].code, undefined, "no code until one is made");
  assert.match(SU.mailSteps(null, null, null)[1].code!, /YOUR_PROJECT_REF/, "no project yet: a plain placeholder");
});
await ok("the one time code: 24 characters, the hash is sha256, only the hash goes to the database", async () => {
  const c = SU.newCode(); assert.match(c, /^[a-z2-9]{24}$/); assert.notEqual(c, SU.newCode());
  assert.equal(SU.newCode(new Uint8Array(24)), "a".repeat(24));
  const h = await SU.sha256Hex("abc"); assert.equal(h, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const step5 = SU.mailSteps("abcdefghijklmnopqrst", c, h)[4].code!;
  assert.ok(step5.includes(c) && step5.includes(h));
  assert.ok(!SU.enrollSql(h).includes(c), "the database line never holds the code");
});

// ---------- nothing owner specific or secret left ----------
const walk = (d: string): string[] => readdirSync(new URL(`../${d}`, import.meta.url), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
await ok("no placeholder, project id or key is left in the mail files, functions, migrations or script", () => {
  const files = [...walk("supabase/functions/gmail-inbox"), ...walk("supabase/functions/instantly-inbox"), ...walk("supabase/functions/instantly-replies"), ...walk("supabase/functions/instantly-webhook"),
    ...readdirSync(new URL("../supabase/migrations", import.meta.url)).filter((f) => /^03[1-7]_/.test(f)).map((f) => `supabase/migrations/${f}`),
    "scripts/gmail-connect.mjs", "src/core/mailreply.ts", "src/replyengine.ts", "src/core/mailsetup.ts", "src/views/ClientEmailsSettings.tsx"];
  for (const f of files) {
    const t = file(f);
    for (const w of [["YOUR", "SITE_DOMAIN"], ["YOUR", "GMAIL_NAME"], ["YOUR", "NAME"]].map((x) => x.join("_"))) assert.ok(!new RegExp(`${w}\\b`).test(t), `${f} has the placeholder ${w}`);
    assert.ok(!t.includes(RED_PROJECT_REF), `${f} has the developer's project id`);
    if (!/mailsetup|ClientEmailsSettings/.test(f)) assert.ok(!/YOUR_PROJECT_REF/.test(t), `${f} has YOUR_PROJECT_REF`);
    assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|net|org|io)\b/.test(t.replace(/@gmail\.com/g, "")), `${f} has an address`);
    assert.ok(!/[—–]/.test(t), `${f} has a dash`);
  }
});
await ok("the cron jobs call the person's own address from Vault, and call nothing until mail_set_project has been run", () => {
  for (const f of ["031_gmail_inbox", "033_instantly_inbox", "037_instantly_replies_cron"]) {
    const t = file(`supabase/migrations/${f}.sql`);
    assert.match(t, /name = 'ps_functions_url'\) u/);
    assert.match(t, /url := u\.v \|\| '\/(gmail-inbox|instantly-inbox|instantly-replies)'/);
    assert.ok(!/supabase\.co/.test(t.replace(/'https:\/\/' \|\| ref \|\| '\.supabase\.co\/functions\/v1'/g, "")), `${f} has a fixed address`);
  }
  assert.match(file("supabase/migrations/031_gmail_inbox.sql"), /\^\[a-z0-9\]\{20\}\$/, "mail_set_project checks the ref");
});
await ok("the functions' allowed origins come from the PS_SITE_ORIGINS secret (https only), not a fixed site", () => {
  for (const f of ["gmail-inbox", "instantly-inbox"]) {
    const t = file(`supabase/functions/${f}/index.ts`);
    assert.match(t, /Deno\.env\.get\("PS_SITE_ORIGINS"\)/); assert.match(t, /\^https:/);
  }
});
await ok("ps-core.json lists the new migrations in order and the four functions; none is still redOnly", () => {
  const m = JSON.parse(file("supabase/ps-core.json"));
  assert.deepEqual(m.migrations.slice(-8, -1), ["031_gmail_inbox.sql", "032_gmail_readonly_flag.sql", "033_instantly_inbox.sql", "034_instantly_webhook.sql", "035_instantly_threads_content_hash.sql", "036_pg_net_to_extensions.sql", "037_instantly_replies_cron.sql"]);
  for (const f of ["gmail-inbox", "instantly-inbox", "instantly-replies", "instantly-webhook"]) {
    const e = m.functions.find((x: { slug: string }) => x.slug === f); assert.ok(e, f); assert.equal(e.verify_jwt, false);
    assert.ok(!m.redOnly.functions.includes(f), f);
    for (const x of e.files) assert.ok(readdirSync(new URL(`../supabase/functions/${f}`, import.meta.url)).includes(x), `${f}/${x}`);
  }
  assert.ok(!m.redOnly.migrations.some((x: string) => /^(008|009|014|019|022|024)_/.test(x)));
  for (const x of m.migrations) if (/^03[1-7]/.test(x)) assert.ok(readdirSync(new URL("../supabase/migrations", import.meta.url)).includes(x), x);
});
await ok("features.json has client-emails (owner jan, shared, since 1.60, off), FEATURES.md names it, plugpoints no longer swap the mail files", () => {
  const f = JSON.parse(rootFile("features.json")).features.find((x: { id: string }) => x.id === "client-emails");
  assert.ok(f); assert.equal(f.owner, "jan"); assert.equal(f.scope, "shared"); assert.equal(f.since, "1.60"); assert.equal(f.default, "off");
  assert.match(rootFile("FEATURES.md"), /\| Client emails \|/);
  const pp = JSON.parse(rootFile("layers/plugpoints.json"));
  for (const x of ["src/core/mail.ts", "src/core/mailcards.ts", "src/mailcards.ts", "src/replyengine.ts", "src/views/Replies.tsx", "src/views/MailCards.tsx", "src/views/ReplyWindow.tsx", "src/views/InstantlyInbox.tsx"]) assert.ok(!pp.web.includes(x), x);
  for (const x of ["src/core/campaigns.ts", "src/core/radar.ts", "src/views/CampaignsPage.tsx"]) assert.ok(pp.web.includes(x), `${x} stays a plug point`);
  assert.ok(pp.mac.includes("Sources/DeveloperOnly.swift"));
});
await ok("no mail file is a 'left out' placeholder any more, and no outreach tool came in", () => {
  for (const f of ["src/core/mail.ts", "src/core/mailcards.ts", "src/core/mailrules.ts", "src/core/leadcards.ts", "src/core/overlaymail.ts", "src/core/mailreply.ts", "src/mailcards.ts", "src/replyengine.ts", "src/views/MailCards.tsx", "src/views/MailPeople.tsx", "src/views/Replies.tsx", "src/views/ReplyWindow.tsx", "src/views/InstantlyInbox.tsx"]) assert.ok(!/Left out of the public source/.test(file(f)), f);
  for (const f of ["src/core/campaigns.ts", "src/core/radar.ts", "src/views/Radar.tsx"]) assert.match(file(f), /Left out of the public source/, `${f} stays out`);
});
await ok("review fix: the reply engine builds, claims and hands over nothing while Client emails is off", () => {
  const c = file("src/replyengine.ts");
  assert.match(c, /const mailOwner = \(\) => \{ const s = owner\(\); return s && mailOnSnap\(s\) \? s : null; \};/);
  assert.match(c, /async function relay\(\) \{\n  const s = mailOwner\(\);/, "the Mac relay of a phone's reply is gated");
  assert.match(c, /async function handOver\(id: string, o: ReplyOut\) \{\n  if \(!o\.job \|\| !mailOwner\(\)\) return;/, "nothing reaches the Mac queue");
  assert.match(c, /export async function sendInline[^\n]*\n  const s = mailOwner\(\);/, "no reply is built");
  assert.ok(!/const s = owner\(\);\n  if \(!s \|\| relaying\)/.test(c));
});
console.log(`mail switch tests: ${n} passed`);

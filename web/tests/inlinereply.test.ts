// Run: node --experimental-strip-types tests/inlinereply.test.ts
// Reply in the email panel (src/core/inlinereply.ts, V1.59) with FICTIONAL people and mail. A FAKE sender stands in
// for the Mac's queue (ps-mac MailSend.swift): it only writes down what it was asked to send. There is no network and
// no Mac here, so nothing can be sent. Checks: replies go from the account and in the thread the email came in on;
// Undo stops a send; drafts are kept when the box closes; nothing is ever sent without the developer's own Send (the relay never
// sends a record twice, never one too old, never one another Mac holds, and two Macs never both send one).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const I = await import("../src/core/inlinereply.ts");
const M = await import("../src/core/mailreply.ts");
const S = await import("../src/core/settingsindex.ts");

let n = 0;
const ok = async (name: string, fn: () => unknown) => { await fn(); n++; console.log("ok -", name); };
const src = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const NOW = new Date(2026, 10, 14, 1, 0, 0).getTime();

// ---------- fictional email ----------
const gmailReply = { clientId: "c1", account: "Studio@example.com", threadId: "t-north-1", msgIds: [], from: "jane@northwind.example", fromName: "Jane Doe",
  subject: "Homepage draft", snippet: "Loved it", opening: "Hi Sam, loved the draft. Could the reviews move up?", date: "2026-11-14T00:20:00.000Z", count: 2, handled: false };
const client = { name: "Northwind", contactName: "Jane" } as unknown as Parameters<typeof M.ctxFromGmail>[2];
const gctx = () => M.ctxFromGmail("m:r-north", gmailReply as never, client)!;
const lead = { id: "e-lead-7", threadId: "th-lead-7", from: "omar@acme.example", fromName: "Omar Lee", account: "hello@outreach.example", at: "2026-11-14T00:30:00.000Z", subject: "Re: your site", opening: "Sounds good, send the link." };
const lctx = () => M.ctxFromLead("n:e-lead-7", lead)!;

/** The fake sender: what the Mac's queue would have been asked to send, never sent anywhere. */
function fakeQueue() {
  const sent: { id: string; via: string; account: string; thread: string; to: string; subject: string; text: string }[] = [];
  return { sent, take(job: ReturnType<typeof M.makeJob>) { const r = I.routeOf(job); sent.push({ id: job.id, via: r.via, account: r.account, thread: r.thread, to: job.to, subject: job.subject, text: job.text }); } };
}
/** Fake timers: time moves only when the test says so. */
function fakeTimers() {
  let t = NOW; const q: { at: number; f: () => void; h: number }[] = []; let h = 0;
  return {
    now: () => t,
    timers: { set: (f: () => void, ms: number) => { q.push({ at: t + ms, f, h: ++h }); return h; }, clear: (x: unknown) => { const i = q.findIndex((e) => e.h === x); if (i >= 0) q.splice(i, 1); } },
    run(ms: number) { t += ms; for (const e of [...q].sort((a, b) => a.at - b.at)) if (e.at <= t) { q.splice(q.indexOf(e), 1); e.f(); } },
  };
}

// ---------- thread routing ----------
await ok("a Gmail email: the reply goes from the account it came to, in its own thread, to the sender", () => {
  const q = fakeQueue();
  q.take(I.inlineJob(gctx(), "Hi {first name}, yes, moving them up today.", { sig: "Sam" }, "job-1", NOW));
  assert.deepEqual(q.sent.map(({ text: _t, ...r }) => r), [{ id: "job-1", via: "gmail", account: "studio@example.com", thread: "t-north-1", to: "jane@northwind.example", subject: "Re: Homepage draft" }]);
  assert.match(q.sent[0].text, /^Hi Jane, yes, moving them up today\.\n\nSam\n\n/);   // his words, filled in, then his signature
  assert.match(q.sent[0].text, /> Hi Sam, loved the draft/);                           // and the last message quoted
});
await ok("an Instantly lead: the reply goes through Instantly, from the inbox the lead wrote to, answering that email", () => {
  const q = fakeQueue();
  q.take(I.inlineJob(lctx(), "Here it is: example.com/demo", undefined, "job-2", NOW));
  const r = q.sent[0];
  assert.equal(r.via, "instantly"); assert.equal(r.account, "hello@outreach.example"); assert.equal(r.thread, "e-lead-7"); assert.equal(r.to, "omar@acme.example");
  assert.equal(r.subject, "Re: your site");   // already a reply: no second Re:
});
await ok("a signature of that account's own wins over the one for every account", () => {
  const j = I.inlineJob(gctx(), "Thanks", { sig: "General", sigs: { "studio@example.com": "Studio sig" } }, "job-3", NOW);
  assert.match(j.text, /Studio sig/); assert.doesNotMatch(j.text, /General/);
});
await ok("no words, or no thread to answer in: nothing is made, a plain sentence instead", () => {
  assert.throws(() => I.inlineJob(gctx(), "   ", undefined, "j", NOW), /Type a reply first/);
  assert.throws(() => I.inlineJob({ ...gctx(), threadId: null }, "Hi", undefined, "j", NOW), /Gmail thread/);
  assert.throws(() => I.inlineJob({ ...lctx(), emailId: null }, "Hi", undefined, "j", NOW), /Instantly email/);
  assert.throws(() => I.routeOf({ via: "gmail", account: "person1@b.co", threadId: null, emailId: "x" }), /no Gmail thread/);
  assert.throws(() => I.routeOf({ via: "instantly", account: "person1@b.co", threadId: "x", emailId: null }), /no Instantly email/);
});
await ok("which accounts this Mac can send from: a connected Gmail account (any case), an Instantly key, never with a problem", () => {
  const st = { gmail: [{ account: "Studio@example.com", connected: true }, { account: "old@example.com", connected: true, problem: "signed out" }], instantly: { saved: false } };
  assert.equal(I.canSendFrom(st, "gmail", "studio@example.com"), true);
  assert.equal(I.canSendFrom(st, "gmail", "old@example.com"), false);
  assert.equal(I.canSendFrom(st, "gmail", "other@example.com"), false);
  assert.equal(I.canSendFrom(st, "instantly", "hello@outreach.example"), false);
  assert.equal(I.canSendFrom({ ...st, instantly: { saved: true } }, "instantly", "x@client6.example"), true);
  assert.equal(I.canSendFrom(null, "gmail", "studio@example.com"), false);
});

// ---------- Send with Undo ----------
await ok("Send: nothing goes during the 10 seconds; then it goes exactly once", () => {
  const t = fakeTimers(), q = fakeQueue();
  const u = I.startUndoSend(() => q.take(I.inlineJob(gctx(), "Yes", undefined, "u1", t.now())), { timers: t.timers, now: t.now });
  assert.equal(u.left(), 10);
  t.run(9_900); assert.equal(q.sent.length, 0); assert.equal(u.state, "waiting");
  t.run(200); assert.equal(q.sent.length, 1); assert.equal(u.state, "gone");
  t.run(60_000); assert.equal(q.sent.length, 1);
  assert.equal(u.undo(), false, "too late to undo once it has gone");
});
await ok("Undo in time: it never goes, not even later", () => {
  const t = fakeTimers(), q = fakeQueue();
  const u = I.startUndoSend(() => q.take(I.inlineJob(gctx(), "Yes", undefined, "u2", t.now())), { timers: t.timers, now: t.now });
  t.run(4_000);
  assert.equal(u.undo(), true); assert.equal(u.state, "undone");
  t.run(3_600_000); assert.equal(q.sent.length, 0);
  assert.equal(u.undo(), false, "a second Undo changes nothing");
});
await ok("the Undo window is 10 seconds, the same as the compose window's", () => assert.equal(I.UNDO_MS, M.UNDO_SECONDS * 1000));

// ---------- drafts ----------
function fakeKV() { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; }
await ok("a draft is kept when the box closes, and is still there after the page reloads", () => {
  const kv = fakeKV();
  const d = I.makeDrafts(kv, () => NOW);
  d.set("m:r-north", "Hi Jane, half way through typing");
  assert.equal(d.get("m:r-north"), "Hi Jane, half way through typing");
  const again = I.makeDrafts(kv, () => NOW + 60_000);   // the Tab list hid, the page reloaded
  assert.equal(again.get("m:r-north"), "Hi Jane, half way through typing");
  assert.equal(again.has("m:r-north"), true); assert.equal(again.get("n:other"), "");
});
await ok("drafts: one per email; emptying the box lets it go; clear() only after the reply has gone; very old ones go", () => {
  const kv = fakeKV(); let now = NOW;
  const d = I.makeDrafts(kv, () => now);
  d.set("m:a", "one"); d.set("n:b", "two");
  assert.equal(d.get("m:a"), "one"); assert.equal(d.get("n:b"), "two");
  d.set("m:a", "   "); assert.equal(d.has("m:a"), false);
  d.clear("n:b"); assert.equal(d.get("n:b"), "");
  d.set("m:c", "kept a while");
  now += (I.DRAFT_DAYS + 1) * 86_400_000; d.set("m:d", "new");
  assert.equal(d.get("m:c"), "", "a draft untouched for over two weeks is let go"); assert.equal(d.get("m:d"), "new");
});
await ok("drafts: no storage, or broken storage, still keep the words in memory", () => {
  const d = I.makeDrafts(null); d.set("m:x", "words"); assert.equal(d.get("m:x"), "words");
  const bad = { getItem: () => "{not json", setItem: () => { throw new Error("full"); }, removeItem: () => {} };
  const b = I.makeDrafts(bad); b.set("m:y", "still here"); assert.equal(b.get("m:y"), "", "a broken store reads as empty, never throws");
});
await ok("the box: Cancel, Esc and Back keep the words; typing saves them; only Send hands them on", () => {
  const box = src("src/views/ReplyBox.tsx");
  assert.match(box, /onClick=\{\(\) => \{ drafts\.set\(cardId, textRef\.current\); onClose\(\); \}\}[^>]*>Cancel/);
  assert.match(box, /const close = \(\) => \{ drafts\.set\(cardId, textRef\.current\); onClose\(\); \}/);
  assert.match(box, /e\.key === "Escape"/); assert.match(box, /"gos-back"/);
  assert.match(box, /const type = \(v: string\) => \{ setText\(v\); setErr\(""\); drafts\.set\(cardId, v\); \}/);
  assert.doesNotMatch(box, /drafts\.clear/, "the box never throws a draft away");
  assert.doesNotMatch(box, /replyInline|sendInline|reply:queue|psPost/, "the box itself cannot send");
});

// ---------- never sends by itself ----------
type Rec = { id: string; out: ReturnType<typeof I.newOut> };
const can = (via: string) => via === "gmail";
await ok("the panel hands a reply on only from inside the Undo callback, after the developer's Send", () => {
  const tm = src("src/views/TaskMap.tsx");
  const calls = tm.match(/taskMapActions\.replyInline\(/g) || [];
  assert.equal(calls.length, 1, "one place calls it");
  assert.match(tm, /const u = startUndoSend\(\(\) => \{\s*dropUndo\(r\.cardId\);\s*void taskMapActions\.replyInline\(r\.cardId, text, id\)/);
  assert.match(tm, /onSent=\{\(text\) => sendFrom\(r, text\)\}/);
});
await ok("the relay: only waiting records with a reply in them, young enough, from an account this Mac can send from", () => {
  const job = I.inlineJob(gctx(), "Yes", undefined, "a", NOW);
  const base = I.newOut(job, "Jane", "Homepage draft", "phone", NOW);
  const list: Rec[] = [
    { id: "ok", out: base },
    { id: "nojob", out: { ...base, job: undefined } },
    { id: "old", out: { ...base, at: new Date(NOW - I.STALE_MS - 1).toISOString() } },
    { id: "handed", out: { ...base, state: "handed", by: "macB" } },
    { id: "sent", out: { ...base, state: "sent" } },
    { id: "failed", out: { ...base, state: "failed" } },
    { id: "lead", out: I.newOut(I.inlineJob(lctx(), "Hi", undefined, "b", NOW), "Omar", "x", "web", NOW) },
    { id: "claimedFresh", out: { ...I.claim(base, "macB", NOW - 10_000) } },
    { id: "claimedStale", out: { ...I.claim(base, "macB", NOW - I.CLAIM_STALE_MS - 1) } },
    { id: "claimedMine", out: { ...I.claim(base, "macA", NOW - I.CLAIM_STALE_MS - 1) } },
  ];
  assert.deepEqual(I.relayPicks(list, "macA", can, NOW), ["ok", "claimedStale"]);
  assert.deepEqual(I.staleOnes(list, NOW), ["old"]);
});
await ok("two Macs, one reply typed on the phone: both claim, only the Mac whose claim stands sends it, and only once", () => {
  // A fake vault with last write wins, as the real one; each Mac reads it fresh after the wait.
  const vault = new Map<string, ReturnType<typeof I.newOut>>();
  const job = I.inlineJob(gctx(), "Sent from my phone", undefined, "phone-1", NOW);
  vault.set("phone-1", I.newOut(job, "Jane", "Homepage draft", "phone", NOW));
  const queues = { macA: fakeQueue(), macB: fakeQueue() };
  const step1 = (me: "macA" | "macB") => { const picks = I.relayPicks([...vault].map(([id, out]) => ({ id, out })), me, can, NOW); for (const id of picks) vault.set(id, I.claim(vault.get(id)!, me, NOW)); return picks; };
  const step2 = (me: "macA" | "macB", picks: string[]) => { for (const id of picks) { const o = vault.get(id)!; if (I.claimWon(o, me)) { vault.set(id, I.handed(o, me, NOW)); queues[me].take(o.job!); } } };
  // The race: both Macs read the vault before either claim has arrived (both see it waiting), then both claim, B last.
  const seen = [...vault].map(([id, out]) => ({ id, out }));
  const a = I.relayPicks(seen, "macA", can, NOW), b = I.relayPicks(seen, "macB", can, NOW);
  assert.deepEqual([a, b], [["phone-1"], ["phone-1"]]);
  for (const id of a) vault.set(id, I.claim(vault.get(id)!, "macA", NOW));
  for (const id of b) vault.set(id, I.claim(vault.get(id)!, "macB", NOW));
  // After the wait, each reads it fresh: only B's claim stands.
  step2("macA", a); step2("macB", b);
  assert.equal(queues.macA.sent.length + queues.macB.sent.length, 1);
  assert.equal(queues.macB.sent.length, 1);
  assert.equal(vault.get("phone-1")!.state, "handed");
  // Every later pass (a reload, the 30 second loop, the other Mac): handed is never handed again.
  for (let i = 0; i < 3; i++) { step2("macA", step1("macA")); step2("macB", step1("macB")); }
  assert.equal(queues.macA.sent.length + queues.macB.sent.length, 1);
});
await ok("what the queue says: sent drops the words from the vault; failed keeps them and says why; anything else waits", () => {
  const job = I.inlineJob(gctx(), "Private words", undefined, "q1", NOW);
  const h = I.handed(I.newOut(job, "Jane", "Homepage draft", "web", NOW), "macA", NOW);
  const sent = I.fromQueue(h, { state: "sent" }, NOW + 1000)!;
  assert.equal(sent.state, "sent"); assert.equal(sent.job, undefined); assert.doesNotMatch(JSON.stringify(sent), /Private words/);
  const failed = I.fromQueue(h, { state: "failed", error: "Google said no" }, NOW)!;
  assert.equal(failed.state, "failed"); assert.equal(failed.error, "Google said no"); assert.ok(failed.job);
  assert.equal(I.fromQueue(h, { state: "queued" }, NOW), null);
  assert.equal(I.fromQueue(sent, { state: "failed" }, NOW), null, "a finished record never changes again");
  assert.equal(I.markStale(I.newOut(job, "J", "S", "phone", NOW), NOW).state, "failed");
});
await ok("records from other devices are checked; the Tab list's Send is checked as it crosses", () => {
  const job = I.inlineJob(gctx(), "Yes", undefined, "c1", NOW);
  const good = I.newOut(job, "Jane", "Homepage draft", "phone", NOW);
  assert.deepEqual(I.cleanOut(JSON.parse(JSON.stringify(good))), good);
  assert.equal(I.cleanOut({ ...good, cardId: "x:1" }), null);
  assert.equal(I.cleanOut({ ...good, state: "sending-now" }), null);
  assert.equal(I.cleanOut({ ...good, v: 2 }), null);
  assert.equal(I.cleanOut({ ...good, job: { ...job, cardId: "m:other" } })!.job, undefined, "a reply for another email is dropped");
  assert.deepEqual(I.cleanInlineSend({ cardId: "m:r-north", text: "Hi", id: "0b6c8a3e-1111-2222-3333-444455556666" }), { cardId: "m:r-north", text: "Hi", id: "0b6c8a3e-1111-2222-3333-444455556666" });
  assert.equal(I.cleanInlineSend({ cardId: "m:r-north", text: "  ", id: "0b6c8a3e-1111" }), null);
  assert.equal(I.cleanInlineSend({ cardId: "javascript:x", text: "Hi", id: "0b6c8a3e-1111" }), null);
  assert.equal(I.cleanInlineSend({ cardId: "m:r", text: "x".repeat(I.MESSAGE_MAX + 1), id: "0b6c8a3e-1111" }), null);
  assert.equal(I.failedOut("n:e1", "No thread", "web", NOW).via, "instantly");
  assert.ok(I.cleanOut(I.failedOut("m:r1", "No thread", "web", NOW)), "a Not sent record reads back");
});
await ok("the main window: a reply from the Tab list is built there; the Mac takes a job only from the main window", () => {
  const ps = src("src/ps.ts"), eng = src("src/replyengine.ts");
  assert.match(ps, /const r = cleanInlineSend\(patch\.replyInline\); if \(r\) void sendInlineOrSay\(r\.cardId, r\.text, r\.id, "mac"\)/);
  assert.match(eng, /await put\("rout", handed\(o, me\(\), Date\.now\(\)\), \{ id, ws: null \}\);\s*post\(\{ type: "reply:queue"/, "saved as handed before it goes to the queue");
  assert.match(eng, /if \(claimWon\(o, me\(\)\)\) await handOver/);
  assert.match(src("src/core/vault.ts"), /"phonelayout", "phonedev", "rout",/, "owner private, vault key");
});

// ---------- what the panel shows ----------
await ok("the panel: Sending, Replied (sinks to the bottom, like Done), Not sent with why; the newest record wins", () => {
  const job = I.inlineJob(gctx(), "Yes", undefined, "s1", NOW);
  const o = I.newOut(job, "Jane", "Homepage draft", "phone", NOW);
  const st = I.panelStatus([o, { ...I.newOut(I.inlineJob(lctx(), "Hi", undefined, "s2", NOW), "Omar", "x", "mac", NOW), state: "sent" }]);
  assert.deepEqual(st.get("m:r-north"), { kind: "sending", text: "Sending through your Mac" });
  assert.equal(st.get("n:e-lead-7")!.text, "Replied");
  const later = { ...o, at: new Date(NOW + 5000).toISOString(), state: "failed" as const, error: "signed out" };
  assert.deepEqual(I.panelStatus([later, o]).get("m:r-north"), { kind: "failed", text: "Not sent", error: "signed out" });
  const rows = [{ cardId: "n:e-lead-7" }, { cardId: "m:r-north" }, { cardId: "m:z" }];
  assert.deepEqual(I.sinkReplied(rows, st).map((r) => r.cardId), ["m:r-north", "m:z", "n:e-lead-7"]);
});
await ok("Replied rows stay an hour after the email has left the open list; records are removed two days after", () => {
  const sent = { ...I.newOut(I.inlineJob(gctx(), "Yes", undefined, "r1", NOW), "Jane", "Homepage draft", "web", NOW), state: "sent" as const, doneAt: new Date(NOW).toISOString() };
  assert.deepEqual(I.repliedRows([sent], new Set(), NOW + 60_000).map((r) => r.who), ["Jane"]);
  assert.equal(I.repliedRows([sent], new Set(["m:r-north"]), NOW).length, 0, "still in the open list: shown there, not twice");
  assert.equal(I.repliedRows([sent], new Set(), NOW + I.REPLIED_SHOW_MS + 1).length, 0);
  assert.deepEqual(I.sweepIds([{ id: "x", out: sent }], NOW + I.KEEP_MS + 1), ["x"]);
  assert.deepEqual(I.sweepIds([{ id: "x", out: sent }], NOW + 1000), []);
});

// ---------- the switch ----------
await ok("Settings: 'Reply in the email panel' is on unless switched off, and shows everywhere (public build too)", () => {
  assert.equal(I.replyInPanelOn({}), true); assert.equal(I.replyInPanelOn(undefined), true); assert.equal(I.replyInPanelOn({ replyInPanel: false }), false);
  const e = S.SETTINGS.find((x) => x.id === "reply-in-panel")!;
  assert.ok(e); assert.equal(e.name, "Reply in the email panel"); assert.equal(e.red, undefined); assert.equal(e.on, undefined); assert.equal(e.mail, undefined);
  assert.match(src("src/views/SettingsGroups.tsx"), /"reply-in-panel": function ReplyInPanel/);
  assert.match(src("src/ps.ts"), /if \(typeof p\.replyInPanel === "boolean"\) o\.replyInPanel = p\.replyInPanel;/, "the Tab list can switch it");
  assert.match(src("src/views/TaskMap.tsx"), /const inline = replyInPanelOn\(settingsData\(s\)\);/);
});
await ok("no em or en dashes in the new code", () => {
  for (const p of ["src/core/inlinereply.ts", "src/views/ReplyBox.tsx", "tests/inlinereply.test.ts"]) assert.doesNotMatch(src(p), /[\u2013\u2014]/, p);
});

console.log(`\n${n} passed`);

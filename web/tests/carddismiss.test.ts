// Run: node --experimental-strip-types tests/carddismiss.test.ts
// A Dismiss never comes back (3 Nov 2026): across a feed poll, a Realtime copy from the other device, a restart
// and the two devices' sync; "Remind me in" brings a card back once, on time. FICTIONAL leads, chats and mail.
import assert from "node:assert/strict";
const L = await import("../src/core/leadcards.ts");
const C = await import("../src/core/chatdone.ts");
const M = await import("../src/core/mailcards.ts");
const S = await import("../src/core/cardsync.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const now = Date.parse("2026-11-03T12:00:00.000Z");
const iso = (agoMin: number) => new Date(now - agoMin * 60_000).toISOString();
const since = iso(4 * 24 * 60);
const rep = (id: string, agoMin: number, x: Record<string, unknown> = {}) => ({ id, threadId: "t-" + id, from: "jane@northwindsilk.example", fromName: "Jane Doe",
  at: iso(agoMin), subject: "Re: Jane, I rebuilt your homepage", opening: "Hi Sam, this looks great. Can we talk on Tuesday?", campaignId: "camp1", ...x });
// The page's Dismiss (src/mailcards.ts apply): every reply, dismissed or not, so the card is always found.
const dismissLead = (st: any, feed: any, id: string, at = now) =>
  L.leadAnswer(st, L.leadCards(feed, { ...st, seen: {}, remind: {} }, at, Infinity), id, "dismiss", at);
const ids = (cards: { id: string }[]) => cards.map((c) => c.id);
// The base settings both devices start from (only the parts that matter here).
const base = (x: Record<string, unknown> = {}) => ({ ownerName: "Owner", autoLockMin: 15, autoReset: "off", theme: "dark", ...x }) as any;

// ---------- the root cause on both devices: more than 20 lead replies ----------
const many = { replies: Array.from({ length: 25 }, (_, i) => rep("r" + i, 30 + i * 30)) };   // 25 replies, newest first
ok("with 25 lead replies, a Dismiss on the oldest card is saved (it used to find nothing and the card came back)", () => {
  const st = { since };
  const shown = L.leadCards(many, st, now);
  assert.equal(shown.length, 20);
  // What the page did before: only the 20 newest of ALL replies, so after 5 Dismisses the rest could not be found.
  let s: any = st;
  for (const id of ["n:r0", "n:r1", "n:r2", "n:r3", "n:r4"]) s = dismissLead(s, many, id);
  const oldest = L.leadCards(many, s, now).at(-1)!;
  assert.equal(oldest.id, "n:r24");
  assert.ok(!ids(L.leadCards(many, { ...s, seen: {}, remind: {} }, now)).includes(oldest.id));   // the old lookup never had it
  const s2 = dismissLead(s, many, oldest.id)!;
  assert.ok(s2, "saved");
  assert.ok(!ids(L.leadCards(many, s2, now)).includes("n:r24"));
});
ok("a Dismiss on a card the feed no longer carries still holds, under the email id", () => {
  const s2 = L.leadAnswer({ since }, [], "n:gone1", "dismiss", now)!;
  assert.ok(s2.seen!["gone1"]);
  assert.equal(L.leadCards({ replies: [rep("gone1", 30)] }, s2, now).length, 0);
});
ok("dismissing a card that is already dismissed saves nothing (no extra settings write)", () => {
  const s2 = dismissLead({ since }, many, "n:r3")!;
  assert.equal(dismissLead(s2, many, "n:r3"), null);
});

// ---------- poll: the same email again, from the webhook and the feed ----------
ok("poll: the feed's copy of a dismissed email (thread added, time written differently) stays gone", () => {
  const hook = { replies: [rep("e1", 60, { threadId: null, at: "2026-11-03T11:00:00Z" })] };
  const s2 = dismissLead({ since }, hook, "n:e1")!;
  const feed = { replies: [rep("e1", 60, { threadId: "th1", at: "2026-11-03T11:00:00.000Z" })] };
  assert.equal(L.leadCards(feed, s2, now).length, 0);
  // and a copy whose time came out a little later (the webhook's own clock)
  const later = { replies: [rep("e1", 59, { threadId: "th1" })] };
  assert.equal(L.leadCards(later, s2, now).length, 0);
});
ok("poll: a dismissed thread still shows a NEWER reply in it (that is a new email)", () => {
  const s2 = dismissLead({ since }, { replies: [rep("a1", 120, { threadId: "thA" })] }, "n:a1")!;
  assert.deepEqual(ids(L.leadCards({ replies: [rep("a1", 120, { threadId: "thA" }), rep("a2", 10, { threadId: "thA" })] }, s2, now)), ["n:a2"]);
});

// ---------- sync and Realtime: the other device's older copy ----------
ok("sync: the phone's older settings (no Dismiss) written after the Mac's Dismiss keep the Dismiss", () => {
  const feed = { replies: [rep("x1", 30), rep("x2", 40)] };
  const before = base({ leadCards: { since }, chatDone: [{ id: "chatA", chat: "Fictional chat", at: iso(5) }] });
  const mac = { ...before, leadCards: dismissLead(before.leadCards, feed, "n:x1")!, chatDone: C.chatDoneAnswer(before.chatDone, "c:chatA", "dismiss", now)! };
  // The phone changes something else from its old copy; its unsent copy meets the server's (the Mac's) before it goes up.
  const phone = { ...before, gymAck: ["2026-11-03"] };
  const sent = S.mergeSettings(phone, mac);
  assert.deepEqual(ids(L.leadCards(feed, sent.leadCards, now)), ["n:x2"]);
  assert.equal(C.chatDoneCards(sent.chatDone, now).length, 0);
  assert.deepEqual(sent.gymAck, ["2026-11-03"]);   // the phone's own change goes up too
});
ok("Realtime: the Mac's unsent Dismiss meets the phone's newer copy coming in and still goes up", () => {
  const feed = { replies: [rep("y1", 30)] };
  const before = base({ leadCards: { since } });
  const mac = { ...before, leadCards: dismissLead(before.leadCards, feed, "n:y1")! };
  const phone = { ...before, tmScale: 90 };
  const sent = S.mergeSettings(mac, phone);
  assert.equal(L.leadCards(feed, sent.leadCards, now).length, 0);
});
ok("sync both ways ends the same on both devices (merge order does not matter for the cards)", () => {
  const feed = { replies: [rep("z1", 30), rep("z2", 40), rep("z3", 50)] };
  const st = { since };
  const a = dismissLead(st, feed, "n:z1")!, b = dismissLead(st, feed, "n:z2")!;
  const ab = L.mergeLeadState(a, b)!, ba = L.mergeLeadState(b, a)!;
  assert.deepEqual(ids(L.leadCards(feed, ab, now)), ["n:z3"]);
  assert.deepEqual(ids(L.leadCards(feed, ba, now)), ["n:z3"]);
});
ok("sync: a Dismiss on one device beats a Remind on the other for the same reply", () => {
  const feed = { replies: [rep("w1", 30)] };
  const st = { since };
  const dis = dismissLead(st, feed, "n:w1")!;
  const rem = L.leadAnswer(st, L.leadCards(feed, st, now), "n:w1", 15, now)!;
  const m = L.mergeLeadState(rem, dis)!;
  assert.equal(L.leadCards(feed, m, now + 20 * 60_000).length, 0);   // not back when the remind would have come due
  assert.equal(Object.keys(m.remind || {}).length, 0);
});
ok("chats: the phone's older list keeps the Mac's Dismiss; a NEW finish of the same chat is a new card", () => {
  const old = [{ id: "chatB", chat: "Fictional chat", at: iso(30) }];
  const mac = C.chatDoneAnswer(old, "c:chatB", "dismiss", now)!;
  assert.equal(C.chatDoneCards(C.mergeChatDone(old, mac), now).length, 0);
  assert.equal(C.chatDoneCards(C.mergeChatDone(mac, old), now).length, 0);
  const again = [{ id: "chatB", chat: "Fictional chat", at: iso(1) }];
  assert.equal(C.chatDoneCards(C.mergeChatDone(mac, again), now).length, 1);
});
ok("client email: the phone's older reply record (no seenAt) keeps the Mac's Dismiss", () => {
  const r = { clientId: "c1", account: "red@example.com", threadId: "th", msgIds: ["a"], from: "jane@example.com", subject: "Hello", snippet: "", date: iso(60), count: 1, handled: false } as any;
  const mac = { ...r, seenAt: r.date };
  assert.equal(M.isUnseen(M.mergeReply(r, mac), since), false);
  assert.equal(M.isUnseen(M.mergeReply(mac, r), since), false);
  // A newer email in the thread on the other copy does show again.
  const newer = { ...r, date: iso(5), msgIds: ["a", "b"] };
  assert.equal(M.isUnseen(M.mergeReply(mac, newer), since), true);
});

// ---------- restart: only what the vault holds ----------
ok("restart: the cards are worked out again from the saved state alone, and the dismissed ones stay gone", () => {
  const feed = { replies: [rep("q1", 30), rep("q2", 40)] };
  const saved = JSON.parse(JSON.stringify(dismissLead({ since }, feed, "n:q1")));   // what the vault keeps
  assert.deepEqual(ids(L.leadCards(feed, saved, now + 3600_000)), ["n:q2"]);
});
ok("a Dismiss lost on the way is held by the page that made it: by email or finish for mail and chats, by id for leads", () => {
  const d: any = new Map([["m:r1", { at: iso(60), t: now }], ["n:e9", { at: "", t: now }], ["c:x", { at: iso(5), t: now }]]);
  assert.equal(S.heldDismissed(d, "m:r1", iso(60), now), true);
  assert.equal(S.heldDismissed(d, "m:r1", iso(1), now), false);   // a newer email
  assert.equal(S.heldDismissed(d, "n:e9", "anything", now), true);
  assert.equal(S.heldDismissed(d, "c:x", iso(1), now), false);    // the chat finished again
  assert.equal(S.heldDismissed(d, "m:r1", iso(60), now + S.DISMISS_HOLD_MS + 1), false);
});

// ---------- Remind me in: back once, on time ----------
ok("lead remind: hidden until due, back once with a new revision, then the same revision on every poll", () => {
  const feed = { replies: [rep("k1", 30)] };
  const st = L.leadAnswer({ since }, L.leadCards(feed, { since }, now), "n:k1", 15, now)!;
  assert.equal(L.leadCards(feed, st, now + 14 * 60_000).length, 0);
  assert.equal(L.nextLeadRemind(st, now), now + 15 * 60_000);
  const back = L.leadCards(feed, st, now + 15 * 60_000 + 1);
  assert.equal(back.length, 1);
  const later = L.leadCards(feed, st, now + 40 * 60_000);
  assert.equal(back[0].rev, later[0].rev);     // the phone shows it once (ps-gos NoteLedger)
  assert.notEqual(back[0].rev, "");
  assert.equal(L.nextLeadRemind(st, now + 16 * 60_000), 0);   // no second timer
});
ok("chat remind: back once at the time, one revision", () => {
  const list = C.chatDoneAnswer([{ id: "r", chat: "Fictional", at: iso(10) }], "c:r", 2, now)!;
  assert.equal(C.chatDoneCards(list, now + 60_000).length, 0);
  const a = C.chatDoneCards(list, now + 2 * 60_000 + 1), b = C.chatDoneCards(list, now + 30 * 60_000);
  assert.equal(a.length, 1);
  assert.equal(a[0].rev, b[0].rev);
  assert.equal(C.nextChatRemind(list, now + 3 * 60_000), 0);
});
ok("client email remind: back once at the time, one revision", () => {
  const r = { clientId: "c1", account: "red@example.com", threadId: "th", msgIds: ["a"], from: "jane@example.com", subject: "Hello", snippet: "", date: iso(60), count: 1, handled: false } as any;
  const rr = { ...r, ...M.remindPatch(r, 15, now) };
  const docs = (x: any) => [{ id: "r1", kind: "reply", data: x }] as any;
  assert.equal(M.mailCards(docs(rr), since, 20, now + 10 * 60_000).length, 0);
  const a = M.mailCards(docs(rr), since, 20, now + 15 * 60_000 + 1), b = M.mailCards(docs(rr), since, 20, now + 50 * 60_000);
  assert.equal(a.length, 1);
  assert.equal(a[0].rev, b[0].rev);
  assert.equal(M.nextRemind(docs(rr), since, now + 16 * 60_000), 0);
});

console.log(`\n${n} passed`);

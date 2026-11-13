// Run: node --experimental-strip-types tests/chatdone.test.ts
// Claude chat done cards (src/core/chatdone.ts): Dismiss and "Remind me in 2 mins", with FICTIONAL chats.
import assert from "node:assert/strict";
const C = await import("../src/core/chatdone.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const now = Date.parse("2026-10-30T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const chat = (id: string, agoMin: number, x: Record<string, unknown> = {}) => ({ id, chat: "Fictional " + id, at: iso(now - agoMin * 60_000), ...x });

ok("a chat that just finished shows a card and counts as fresh (it chimes)", () => {
  const [c] = C.chatDoneCards([chat("a", 1)], now);
  assert.equal(c.id, "c:a");
  assert.equal(c.fresh, true);
});
ok("one that finished an hour ago still shows but does not chime again", () => {
  assert.equal(C.chatDoneCards([chat("a", 60)], now)[0].fresh, false);
});
ok("Remind me in 2 mins hides it until then, and the timer knows when", () => {
  const l = C.chatDoneAnswer([chat("a", 1)], "c:a", 2, now)!;
  assert.equal(C.chatDoneCards(l, now).length, 0);
  assert.equal(C.nextChatRemind(l, now), now + 2 * 60_000);
  const back = C.chatDoneCards(l, now + 2 * 60_000 + 1);
  assert.equal(back.length, 1);
  assert.equal(back[0].fresh, true, "coming back chimes");
});
ok("the time is clamped to 1 minute .. 4 hours and rounded", () => {
  assert.equal(C.nextChatRemind(C.chatDoneAnswer([chat("a", 1)], "c:a", 0.2, now)!, now), now + 60_000);
  assert.equal(C.nextChatRemind(C.chatDoneAnswer([chat("a", 1)], "c:a", 999, now)!, now), now + 240 * 60_000);
});
ok("a long remind still comes back (the few hours count from the remind, not the finish)", () => {
  const l = C.chatDoneAnswer([chat("a", 170)], "c:a", 120, now)!;
  assert.equal(C.chatDoneCards(l, now + 121 * 60_000).length, 1);
  assert.equal(C.addChatDone(l, chat("b", 0), now + 60 * 60_000).some((x) => x.id === "a"), true, "kept while it waits");
});
ok("Dismiss wins and stays gone", () => {
  const l = C.chatDoneAnswer(C.chatDoneAnswer([chat("a", 1)], "c:a", 2, now)!, "c:a", "dismiss", now)!;
  assert.equal(C.chatDoneCards(l, now + 10 * 60_000).length, 0);
  assert.equal(C.nextChatRemind(l, now), 0);
});
ok("an unknown or already dismissed card changes nothing", () => {
  assert.equal(C.chatDoneAnswer([chat("a", 1)], "c:zzz", 2, now), null);
  assert.equal(C.chatDoneAnswer([chat("a", 1, { seen: true })], "c:a", 2, now), null);
});
ok("the same chat finishing again is a new card without the old remind", () => {
  const l = C.chatDoneAnswer([chat("a", 5)], "c:a", 30, now)!;
  const again = C.addChatDone(l, chat("a", 0), now);
  assert.equal(again.length, 1);
  assert.equal(again[0].remindAt, undefined);
  assert.equal(C.chatDoneCards(again, now).length, 1);
});
ok("the revision the phone shows once: the same on every resync, a new one when a remind comes due", () => {
  const [a] = C.chatDoneCards([chat("a", 1)], now);
  assert.equal(C.chatDoneCards([chat("a", 1)], now + 30_000)[0].rev, a.rev);
  const l = C.chatDoneAnswer([chat("a", 1)], "c:a", 2, now)!;
  const [back] = C.chatDoneCards(l, now + 2 * 60_000 + 1);
  assert.equal(back.id, a.id);
  assert.notEqual(back.rev, a.rev);
});
// ---------- V1.53: other AI tools, from PS on the Mac (src/aidone.ts) ----------
ok("a Claude chat with no tool still reads Claude finished, as before", () => {
  const [c] = C.chatDoneCards([chat("a", 1)], now);
  assert.equal(c.sub, "Claude finished");
  assert.equal(c.tool, "claude");
});
ok("a Codex chat reads Codex finished and keeps its tool", () => {
  const d = C.chatDoneFrom({ id: "th-9", chat: "Fictional app", at: iso(now - 60_000), tool: "codex" })!;
  assert.equal(d.tool, "codex");
  assert.equal(d.id, "codex-th-9", "never the same card as a Claude chat with the same id");
  assert.equal(C.chatDoneCards([d], now)[0].sub, "Codex finished");
});
ok("Gemini and Cursor read their own names", () => {
  assert.equal(C.chatDoneSub({ tool: "gemini" }), "Gemini finished");
  assert.equal(C.chatDoneSub({ tool: "cursor" }), "Cursor finished");
});
ok("an unknown tool is dropped and the card reads Claude, a Claude tool adds nothing", () => {
  const x = C.chatDoneFrom({ id: "s1", chat: "Fictional", at: iso(now), tool: "chatgpt-window" })!;
  assert.equal(x.tool, undefined);
  assert.equal(x.id, "s1");
  const y = C.chatDoneFrom({ id: "s1", chat: "Fictional", at: iso(now), tool: "claude" })!;
  assert.deepEqual(y, { id: "s1", chat: "Fictional", at: iso(now) }, "a Claude chat from this Mac is the same card as one from a package");
  assert.equal(C.chatDoneFrom({ id: "s1", chat: "Fictional", at: iso(now), tool: "__proto__" })!.tool, undefined);
});
ok("the tool survives the two devices' merge, and a Dismiss holds", () => {
  const d = C.chatDoneFrom({ id: "c1", chat: "Fictional", at: iso(now - 60_000), tool: "cursor" })!;
  const dismissed = C.chatDoneAnswer([d], C.chatCardId(d), "dismiss", now)!;
  const m = C.mergeChatDone([d], dismissed)!;
  assert.equal(m[0].tool, "cursor");
  assert.equal(m[0].seen, true);
});
ok("items from the Mac: every good key is taken, bad items too, bad keys are not", () => {
  const r = C.aiDoneItems([
    { key: "codex.1700000000.42.drop", tool: "codex", id: "th-1", chat: "Fictional", at: iso(now) },
    { key: "gemini.1.2.drop", tool: "gemini", id: "", chat: "Fictional", at: iso(now) },
    { key: "../../etc/passwd", tool: "codex", id: "x", chat: "y", at: iso(now) },
    "nonsense", null,
  ]);
  assert.deepEqual(r.keys, ["codex.1700000000.42.drop", "gemini.1.2.drop"]);
  assert.equal(r.done.length, 1);
  assert.equal(r.done[0].tool, "codex");
  assert.deepEqual(C.aiDoneItems("not a list"), { keys: [], done: [] });
});
console.log(`\n${n} passed`);

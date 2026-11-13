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

// ---------- V1.57: a finished chat shows once (the developer, 13 Nov 2026: the bubble "keeps spamming me every like 15 seconds
// even when there is no chat that finished ... for like 10 minutes") ----------
// The Mac's side, as ps-mac Toast.swift does it: a card that ran out (its 10 s) is remembered by chat and time
// ("id|at", notes.expired) and the same card sent again stays away. So the Mac pops a card again only when the
// list hands it a new time. This plays out a chat that ends turn after turn by itself for 10 minutes.
const popsOver = (finishes: Record<string, unknown>[], start: number) => {
  let list: ReturnType<typeof C.addChatDone> = [];
  const ranOut = new Set<string>();
  let pops = 0;
  finishes.forEach((f, i) => {
    const t = start + i * 15_000;
    list = C.addChatDone(list, C.chatDoneFrom({ chat: "Fictional outreach chat", ...f, at: iso(t) })!, t);
    for (const c of C.chatDoneCards(list, t + 2_000)) {
      const key = `${c.id}|${c.at}`;
      if (ranOut.has(key)) continue;   // the same card again: Swift's deliver() returns
      pops++;
      ranOut.add(key);                 // shown, then its 10 s ran out before the next turn end
    }
  });
  return { pops, list };
};
ok("13 Nov: a chat waking every 15 s for 10 minutes with no new prompt pops once, not 41 times", () => {
  const r = popsOver(Array.from({ length: 41 }, () => ({ id: "s-loop", tool: "claude", turn: "p-1" })), now);
  assert.equal(r.pops, 1);
  assert.equal(r.list.length, 1);
  assert.equal(r.list[0].at, iso(now), "the card keeps the first finish, so the Mac remembers it ran out");
});
ok("the same without a prompt to go by (the developer's own hook, Codex, Gemini, Cursor): one card for the whole burst", () => {
  assert.equal(popsOver(Array.from({ length: 41 }, () => ({ id: "s-loop" })), now).pops, 1);
  assert.equal(popsOver(Array.from({ length: 41 }, () => ({ id: "t-1", tool: "codex" })), now).pops, 1);
});
ok("the check itself: a real new finish each time (a new prompt every turn) does pop each time", () => {
  // Before V1.57 every turn end counted like this, so the 15 s loop above popped 41 times.
  assert.equal(popsOver(Array.from({ length: 41 }, (_, i) => ({ id: "s-loop", turn: `p-${i}` })), now).pops, 41);
});
ok("a new prompt is a new card at once, even seconds later", () => {
  const a = C.chatDoneFrom({ id: "s1", chat: "Fictional", at: iso(now), turn: "p-1" })!;
  const b = C.chatDoneFrom({ id: "s1", chat: "Fictional", at: iso(now + 20_000), turn: "p-2" })!;
  const l = C.addChatDone(C.addChatDone([], a, now), b, now + 20_000);
  assert.equal(l.length, 1);
  assert.equal(l[0].at, b.at);
  assert.equal(l[0].turn, "p-2");
});
ok("the same prompt is the same finish however long the chat keeps going by itself", () => {
  const a = C.chatDoneFrom({ id: "s1", chat: "Fictional", at: iso(now), turn: "p-1" })!;
  const b = C.chatDoneFrom({ id: "s1", chat: "Fictional", at: iso(now + 50 * 60_000), turn: "p-1" })!;
  const l = C.addChatDone([a], b, now + 50 * 60_000);
  assert.equal(l[0].at, a.at);
  assert.equal(l[0].last, b.at);
});
ok("without a prompt: quiet for 3 minutes after the last turn end, then a finish is a new card", () => {
  const a = C.chatDoneFrom({ id: "s1", chat: "Fictional", at: iso(now) })!;
  const near = C.chatDoneFrom({ id: "s1", chat: "Fictional", at: iso(now + 2 * 60_000) })!;
  const later = C.chatDoneFrom({ id: "s1", chat: "Fictional", at: iso(now + 2 * 60_000 + C.CHAT_DONE.repeat) })!;
  const l1 = C.addChatDone([a], near, now + 2 * 60_000);
  assert.equal(l1[0].at, a.at);
  const l2 = C.addChatDone(l1, later, now + 6 * 60_000);
  assert.equal(l2[0].at, later.at, "3 minutes after the last turn end (not the first) it is news again");
  assert.equal(l2[0].last, undefined);
});
ok("a Dismiss stays when the chat ends another turn by itself", () => {
  const a = C.chatDoneFrom({ id: "s1", chat: "Fictional", at: iso(now), turn: "p-1" })!;
  const gone = C.chatDoneAnswer([a], "c:s1", "dismiss", now)!;
  const l = C.addChatDone(gone, C.chatDoneFrom({ id: "s1", chat: "Fictional", at: iso(now + 15_000), turn: "p-1" })!, now + 15_000);
  assert.equal(C.chatDoneCards(l, now + 16_000).length, 0);
});
ok("an older package opened late never replaces a newer card", () => {
  const newer = C.chatDoneFrom({ id: "s1", chat: "Fictional", at: iso(now) })!;
  const older = C.chatDoneFrom({ id: "s1", chat: "Fictional", at: iso(now - 10 * 60_000) })!;
  assert.equal(C.addChatDone([newer], older, now)[0].at, newer.at);
});
ok("the prompt key comes through from the Mac, cleaned, and the merge keeps the latest repeat", () => {
  const r = C.aiDoneItems([{ key: "claude.1.2.drop", tool: "claude", id: "s1", chat: "Fictional", at: iso(now), turn: "abc-123<x>" }]);
  assert.equal(r.done[0].turn, "abc-123x");
  const a = { id: "s1", chat: "F", at: iso(now), last: iso(now + 30_000) }, b = { id: "s1", chat: "F", at: iso(now), last: iso(now + 90_000) };
  assert.equal(C.mergeChatDone([a], [b])![0].last, iso(now + 90_000));
  assert.equal("last" in C.mergeChatDone([{ id: "s1", chat: "F", at: iso(now) }], [{ id: "s1", chat: "F", at: iso(now) }])![0], false);
});

ok("a stuck chat (friend, V1.56): a finish every 30 s for an hour pops once, with or without its prompt", () => {
  const every30 = (f: Record<string, unknown>) => {
    let list: ReturnType<typeof C.addChatDone> = [];
    const ranOut = new Set<string>(); let pops = 0;
    for (let i = 0; i < 120; i++) {
      const t = now + i * 30_000;
      list = C.addChatDone(list, C.chatDoneFrom({ chat: "Fictional stuck chat", ...f, at: iso(t) })!, t);
      for (const c of C.chatDoneCards(list, t + 1_000)) { const k = `${c.id}|${c.at}`; if (!ranOut.has(k)) { pops++; ranOut.add(k); } }
    }
    return { pops, list };
  };
  assert.equal(every30({ id: "stuck", tool: "claude", turn: "p-1" }).pops, 1, "PS's hook reads the same prompt each time");
  assert.equal(every30({ id: "stuck", tool: "claude" }).pops, 1, "a transcript PS cannot read: the 3 minute fold, sliding");
  assert.equal(every30({ id: "stuck" }).pops, 1, "The developer's own hook");
  // Still within its 3 hours the one card stays one card, and a Dismiss on it holds for the rest of the hour.
  const r = every30({ id: "stuck", tool: "claude" });
  assert.equal(r.list.length, 1);
  assert.equal(r.list[0].at, iso(now));
});
ok("a stuck chat that is dismissed stays dismissed while it keeps going", () => {
  let list = [C.chatDoneFrom({ id: "stuck", chat: "Fictional stuck chat", at: iso(now) })!];
  list = C.chatDoneAnswer(list, "c:stuck", "dismiss", now)!;
  for (let i = 1; i <= 60; i++) list = C.addChatDone(list, C.chatDoneFrom({ id: "stuck", chat: "Fictional stuck chat", at: iso(now + i * 30_000) })!, now + i * 30_000);
  assert.equal(C.chatDoneCards(list, now + 31 * 60_000).length, 0);
});
console.log(`\n${n} passed`);

// Run: node --experimental-strip-types tests/gsquad-notify.test.ts
// PR 10, G Squad message notifications (core/squadnotify.ts): which messages notify, once per device, mute rules, the
// settings switches, the card, the Undo steps of Reply, and that the engine, the card and the settings are wired.
// Made up names and ids only. No network, no hub, no vault.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const N = await import("../src/core/squadnotify.ts");
const V = await import("../src/squad/chatview.ts");
const S = await import("../src/squad/chatsend.ts");
const D = await import("../src/core/dnd.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const NOW = Date.parse("2026-11-14T12:00:00.000Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const msg = (id: string, from: string, min: number, t = "hi " + id) => ({ id, from, name: from === "me" ? "You" : from, t, at: ago(min) });
const inp = (o: Partial<Parameters<typeof N.planNotes>[1]> = {}) => ({ me: "me", since: ago(60), read: null, seen: null, chatOpen: false, muted: false, now: NOW, ledger: {}, ...o });
const ids = (p: { show: { id: string }[] }) => p.show.map((m) => m.id);
const why = (p: { skipped: { id: string; why: string }[] }, id: string) => p.skipped.find((s) => s.id === id)?.why;

// ---------- which messages notify ----------
ok("a new message from someone else notifies", () => assert.deepEqual(ids(N.planNotes([msg("a", "kit", 2)], inp())), ["a"]));
ok("your own message never notifies", () => { const p = N.planNotes([msg("a", "me", 2)], inp()); assert.deepEqual(ids(p), []); assert.equal(why(p, "a"), "own"); });
ok("a message from before notifications were switched on here never notifies", () => { const p = N.planNotes([msg("a", "kit", 90)], inp()); assert.equal(why(p, "a"), "before"); });
ok("no baseline yet: nothing notifies", () => assert.deepEqual(ids(N.planNotes([msg("a", "kit", 2)], inp({ since: null }))), []));
ok("a message older than six hours never notifies (a Mac that slept)", () => { const p = N.planNotes([msg("a", "kit", 7 * 60)], inp({ since: ago(9 * 60) })); assert.equal(why(p, "a"), "old"); });
ok("exactly six hours still counts, one minute more does not", () => {
  assert.deepEqual(ids(N.planNotes([msg("a", "kit", 360)], inp({ since: ago(500) }))), ["a"]);
  assert.deepEqual(ids(N.planNotes([msg("a", "kit", 361)], inp({ since: ago(500) }))), []);
});
ok("already read (the hub's read mark, here or on another device) never notifies", () => {
  const p = N.planNotes([msg("a", "kit", 10), msg("b", "kit", 3)], inp({ read: ago(5) }));
  assert.deepEqual(ids(p), ["b"]); assert.equal(why(p, "a"), "read");
});
ok("a message at exactly the read mark counts as read", () => assert.deepEqual(ids(N.planNotes([msg("a", "kit", 5)], inp({ read: ago(5) }))), []));
ok("dismissed on another device (the seen mark) never notifies", () => {
  const p = N.planNotes([msg("a", "kit", 10), msg("b", "kit", 3)], inp({ seen: ago(5) }));
  assert.deepEqual(ids(p), ["b"]); assert.equal(why(p, "a"), "dismissed");
});
ok("chat open and in front: no card, and it is marked so it never comes up after the chat closes", () => {
  const p = N.planNotes([msg("a", "kit", 2)], inp({ chatOpen: true }));
  assert.deepEqual(ids(p), []); assert.equal(why(p, "a"), "open");
  assert.deepEqual(ids(N.planNotes([msg("a", "kit", 2)], inp({ ledger: p.ledger }))), []);
});
ok("muted (Do Not Disturb): no card, and no card later when it ends", () => {
  const p = N.planNotes([msg("a", "kit", 2)], inp({ muted: true }));
  assert.deepEqual(ids(p), []); assert.equal(why(p, "a"), "muted");
  assert.deepEqual(ids(N.planNotes([msg("a", "kit", 2)], inp({ ledger: p.ledger }))), []);
});
ok("more than three new at once: the newest three show, the rest are marked", () => {
  const list = ["a", "b", "c", "d", "e"].map((x, i) => msg(x, "kit", 10 - i));
  const p = N.planNotes(list, inp());
  assert.deepEqual(ids(p), ["c", "d", "e"]); assert.equal(why(p, "a"), "capped");
  assert.deepEqual(ids(N.planNotes(list, inp({ ledger: p.ledger }))), []);
});
ok("order is by time, then by id", () => assert.deepEqual(ids(N.planNotes([msg("b", "kit", 1), msg("a", "kit", 2)], inp())), ["a", "b"]));
ok("a mix: own, other and old in one look", () => {
  const p = N.planNotes([msg("a", "me", 4), msg("b", "kit", 3), msg("c", "kit", 100)], inp());
  assert.deepEqual(ids(p), ["b"]);
});

// ---------- once per device ----------
ok("the same message notifies once: the ledger remembers it", () => {
  const first = N.planNotes([msg("a", "kit", 2)], inp());
  assert.deepEqual(ids(first), ["a"]);
  const again = N.planNotes([msg("a", "kit", 2)], inp({ ledger: first.ledger }));
  assert.deepEqual(ids(again), []); assert.equal(why(again, "a"), "again");
});
ok("a restart (ledger read back from storage) does not notify again", () => {
  const first = N.planNotes([msg("a", "kit", 2)], inp());
  const back = N.cleanNoteLedger(JSON.parse(JSON.stringify(first.ledger)));
  assert.deepEqual(ids(N.planNotes([msg("a", "kit", 2)], inp({ ledger: back }))), []);
});
ok("an edited message (same id, new words) does not notify again", () => {
  const first = N.planNotes([msg("a", "kit", 2, "hello")], inp());
  assert.deepEqual(ids(N.planNotes([msg("a", "kit", 2, "hello there")], inp({ ledger: first.ledger }))), []);
});
ok("the ledger of one device does not know another's id (keys are per message id)", () => {
  const first = N.planNotes([msg("a", "kit", 2)], inp());
  assert.deepEqual(ids(N.planNotes([msg("b", "kit", 1)], inp({ ledger: first.ledger }))), ["b"]);
});
ok("the ledger stays small (400 newest, 45 days)", () => {
  let l = {}; const msgs = [];
  for (let i = 0; i < 500; i++) msgs.push(msg("m" + i, "kit", 1 + (i % 5)));
  const p = N.planNotes(msgs, inp({ ledger: l }));
  assert.ok(Object.keys(p.ledger).length <= 400);
});

// ---------- settings and muting ----------
const on = (st: object = {}) => N.noteOn(true, st);
ok("on needs the feature, the switch (missing = on) and the pop-ups gear", () => {
  assert.equal(on(), true); assert.equal(N.noteOn(false, {}), false);
  assert.equal(on({ squadNotify: false }), false); assert.equal(on({ squadNotify: true }), true);
  assert.equal(on({ tmNotify: false }), false); assert.equal(N.noteOn(true, null), true);
});
const dnd = (pass: string[] = []) => ({ on: true, pass } as any);
ok("Do Not Disturb mutes G Squad unless it lets G Squad through", () => {
  assert.equal(N.noteMuted({ dnd: dnd() }, NOW, "mac"), true);
  assert.equal(N.noteMuted({ dnd: dnd(["gsquad"]) }, NOW, "mac"), false);
  assert.equal(N.noteMuted({}, NOW, "mac"), false);
});
ok("the phone is muted unless Do Not Disturb passes the phone", () => assert.equal(N.noteMuted({ dnd: dnd(["gsquad"]) }, NOW, "phone"), true));
ok("a G Squad card id belongs to the G Squad kind of Do Not Disturb (the phone and the Mac use it)", () => assert.equal(D.cardKind("g:" + "a".repeat(36)), "gsquad"));
ok("sound: the switch (missing = on), the speaker and Do Not Disturb", () => {
  assert.equal(N.noteSound({}, NOW, "mac"), true);
  assert.equal(N.noteSound({ squadNotifySound: false }, NOW, "mac"), false);
  assert.equal(N.noteSound({ tmMuted: true }, NOW, "mac"), false);
  assert.equal(N.noteSound({ dnd: dnd() }, NOW, "mac"), false);
});
ok("cards on screen go when read, dismissed elsewhere, the chat opens, muted or switched off", () => {
  const cards = [{ id: "g:a", at: ago(10) }, { id: "g:b", at: ago(2) }];
  const base = { read: null, seen: null, chatOpen: false, muted: false, enabled: true };
  assert.deepEqual(N.staleNotes(cards, base), []);
  assert.deepEqual(N.staleNotes(cards, { ...base, read: ago(5) }), ["g:a"]);
  assert.deepEqual(N.staleNotes(cards, { ...base, seen: ago(1) }), ["g:a", "g:b"]);
  assert.deepEqual(N.staleNotes(cards, { ...base, chatOpen: true }), ["g:a", "g:b"]);
  assert.deepEqual(N.staleNotes(cards, { ...base, muted: true }), ["g:a", "g:b"]);
  assert.deepEqual(N.staleNotes(cards, { ...base, enabled: false }), ["g:a", "g:b"]);
});
ok("the seen mark only moves forward", () => {
  assert.equal(N.laterSeen(ago(5), ago(10)), ago(5)); assert.equal(N.laterSeen(ago(10), ago(5)), ago(5)); assert.equal(N.laterSeen(undefined, ago(5)), ago(5));
});

// ---------- the card ----------
ok("the card: id g:<message id>, short, tone squad, discreet line, Reply on", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  const c = N.noteCard({ id, from: "kit", name: "Kit", t: "Gym at 6?", at: ago(1) });
  assert.equal(c.id, "g:" + id); assert.ok(c.id.length <= 40); assert.equal(c.rev, id); assert.equal(c.tone, "squad");
  assert.equal(c.title, "Kit"); assert.equal(c.body, "Gym at 6?"); assert.equal(c.reply, true); assert.equal(c.discreetText, "New G Squad message");
  assert.ok(N.isNoteCard(c.id)); assert.ok(!N.isNoteCard("m:abc")); assert.ok(!N.isNoteCard("g:")); assert.ok(!N.isNoteCard(5 as any));
});
ok("the card's words are cut and a blank name is Someone; the discreet line has no words", () => {
  const c = N.noteCard({ id: "x", from: "k", name: "  ", t: "y".repeat(900), at: ago(1) });
  assert.equal(c.title, "Someone"); assert.equal(c.body.length, N.NOTE_BODY_MAX); assert.ok(!c.discreetText.includes("y"));
});

// ---------- PS 1.63: the message on the Mac's island ----------
ok("the island switch: the feature and the person's switch, missing = on", () => {
  assert.equal(N.ISLAND_FEATURE, "gsquad-island-reply");
  assert.equal(N.noteIsland(true, {}), true); assert.equal(N.noteIsland(true, null), true);
  assert.equal(N.noteIsland(true, { squadNoteIsland: false }), false); assert.equal(N.noteIsland(false, {}), false);
  assert.equal(N.noteIsland(true, { squadNoteIsland: true }), true);
});
ok("the island switch is apart from the notification switch (off here, the corner card stays)", () => {
  assert.equal(N.noteOn(true, { squadNoteIsland: false }), true);
  assert.equal(N.noteOn(true, { squadNotify: false }), false);
});
ok("the card without the island option is exactly the old card", () => {
  const m = { id: "x1", from: "kit", name: "Kit", t: "hi", at: ago(1) };
  assert.deepEqual(N.noteCard(m), N.noteCard(m, {})); assert.deepEqual(N.noteCard(m, { island: false }), N.noteCard(m));
  assert.ok(!("island" in N.noteCard(m)) && !("chat" in N.noteCard(m)));
});
ok("the card for the island carries the flag, the chat, the sound and the group", () => {
  const c = N.noteCard({ id: "x1", from: "kit", name: "Kit", t: "hi", at: ago(1) }, { island: true, sound: false, group: "  Gym   crew " }) as Record<string, unknown>;
  assert.equal(c.island, true); assert.equal(c.chat, N.NOTE_CHAT); assert.equal(c.sound, false); assert.equal(c.group, "Gym crew");
  assert.equal(c.tone, "squad"); assert.equal(c.id, "g:x1");
  assert.equal((N.noteCard({ id: "x1", from: "k", name: "K", t: "t", at: ago(1) }, { island: true }) as Record<string, unknown>).sound, true);
});
ok("what the island is told after a reply: went, or still held as not sent", () => {
  assert.deepEqual(N.replyOutcome(0, null), { ok: true }); assert.deepEqual(N.replyOutcome(0, "old error"), { ok: true });
  assert.deepEqual(N.replyOutcome(1, "No connection"), { ok: false, why: "No connection" });
  assert.deepEqual(N.replyOutcome(2, null), { ok: false, why: "Could not send" });
  assert.equal(N.replyOutcome(1, "x".repeat(200)).why?.length, 60);
});
ok("a reply that could not reach the chat is told as not sent, never as Sent", () => {
  assert.equal(N.NOT_CONNECTED, "Not connected");
  const o = { ok: false, why: N.NOT_CONNECTED }; assert.equal(o.ok, false); assert.ok(o.why.length > 0 && o.why.length <= 60);
});
ok("the view and the request carry the island switch, checked", () => {
  assert.deepEqual(V.cleanChatOp({ op: "noteIsland", on: false }), { op: "noteIsland", on: false });
  assert.equal(V.cleanChatOp({ op: "noteIsland", on: "no" }), null);
  assert.equal(V.cleanChatView({}).noteIsland, true); assert.equal(V.cleanChatView({}).islandOk, false);
  assert.equal(V.cleanChatView({ noteIsland: false, islandOk: true }).noteIsland, false); assert.equal(V.cleanChatView({ islandOk: true }).islandOk, true);
});
ok("the engine, the settings and the Mac are wired for the island", () => {
  const eng = readFileSync(new URL("../src/squad/chatengine.ts", import.meta.url), "utf8");
  assert.ok(eng.includes("noteCard(m, { island, sound })") && eng.includes('type: "sqresult"') && eng.includes('action === "retry"') && eng.includes('o.op === "noteIsland"'));
  const ui = readFileSync(new URL("../src/views/GSquadSettings.tsx", import.meta.url), "utf8");
  assert.ok(ui.includes("Show messages on the island") && ui.includes("c.islandOk"));
  const feats = JSON.parse(readFileSync(new URL("../../features.json", import.meta.url), "utf8")).features;
  const f = feats.find((x: { id: string }) => x.id === "gsquad-island-reply");
  assert.ok(f && f.owner === "jan" && f.scope === "shared" && f.since === "1.63" && f.default === "on");
});

// ---------- Reply through the composer's send, with a short Undo ----------
const T0 = 1_000_000;
ok("Reply opens an empty box; typing fills it", () => {
  let s = N.replyStep(N.REPLY_IDLE, { e: "open" }, T0).state; assert.deepEqual(s, { k: "typing", text: "" });
  s = N.replyStep(s, { e: "type", text: "on my way" }, T0).state; assert.deepEqual(s, { k: "typing", text: "on my way" });
});
ok("Send with nothing typed does nothing", () => {
  const s = N.replyStep({ k: "typing", text: "   " }, { e: "send" }, T0); assert.deepEqual(s.state, { k: "typing", text: "   " }); assert.equal(s.send, null);
});
ok("Send starts the Undo; nothing goes before it runs out", () => {
  const s = N.replyStep({ k: "typing", text: "ok" }, { e: "send" }, T0);
  assert.deepEqual(s.state, { k: "undo", text: "ok", until: T0 + N.REPLY_UNDO_MS }); assert.equal(s.send, null);
  assert.equal(N.replyStep(s.state, { e: "tick" }, T0 + N.REPLY_UNDO_MS - 1).send, null);
});
ok("when the Undo runs out the reply goes as the composer's send request and the card is done", () => {
  const u = { k: "undo", text: "  ok then  ", until: T0 } as const;
  const r = N.replyStep(u, { e: "tick" }, T0);
  assert.deepEqual(r.send, S.buildSend("  ok then  ")); assert.deepEqual(r.send, { op: "send", text: "ok then" }); assert.equal(r.done, true); assert.equal(r.state.k, "idle");
});
ok("Undo brings the words back and nothing is sent", () => {
  const r = N.replyStep({ k: "undo", text: "ok", until: T0 + 99 }, { e: "undo" }, T0); assert.deepEqual(r.state, { k: "typing", text: "ok" }); assert.equal(r.send, null);
});
ok("Esc or Back: closes the box first (nothing sent, even during Undo), then the card", () => {
  const a = N.replyStep({ k: "typing", text: "x" }, { e: "close" }, T0); assert.equal(a.state.k, "idle"); assert.equal(a.done, false);
  const b = N.replyStep({ k: "undo", text: "x", until: T0 + 99 }, { e: "close" }, T0); assert.equal(b.state.k, "idle"); assert.equal(b.send, null); assert.equal(b.done, false);
  const c = N.replyStep(N.REPLY_IDLE, { e: "close" }, T0); assert.equal(c.done, true);
});
ok("a tick, a second Send or a type in the wrong state changes nothing", () => {
  assert.equal(N.replyStep(N.REPLY_IDLE, { e: "tick" }, T0).state.k, "idle");
  assert.equal(N.replyStep({ k: "undo", text: "x", until: T0 + 9 }, { e: "send" }, T0).state.k, "undo");
  assert.equal(N.replyStep({ k: "undo", text: "x", until: T0 + 9 }, { e: "type", text: "y" }, T0).state.k, "undo");
});
ok("a reply is cut to the chat's limit like any message", () => {
  const r = N.replyStep({ k: "undo", text: "z".repeat(5000), until: T0 }, { e: "tick" }, T0);
  assert.ok(r.send && r.send.op === "send" && r.send.text.length < 5000);
});

// ---------- the chat view carries the switches, and the Tab list may ask for them ----------
ok("the view and the Tab list's requests carry the two switches", () => {
  assert.deepEqual(V.cleanChatOp({ op: "notify", on: false }), { op: "notify", on: false });
  assert.deepEqual(V.cleanChatOp({ op: "noteSound", on: true }), { op: "noteSound", on: true });
  assert.equal(V.cleanChatOp({ op: "notify", on: "yes" }), null);
  const v = V.cleanChatView({ in: true, notify: true, notifyOn: false, noteSound: false });
  assert.equal(v.notify, true); assert.equal(v.notifyOn, false); assert.equal(v.noteSound, false);
  const d = V.cleanChatView({ in: true });
  assert.equal(d.notify, false); assert.equal(d.notifyOn, true); assert.equal(d.noteSound, true);
});

// ---------- review: a card that leaves during the Undo ----------
const readF = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
ok("a card that left during the Undo is still drawn (held), after the live ones, once", () => {
  const live = [{ id: "g:a" }, { id: "g:b" }], held = [{ id: "g:b" }, { id: "g:c" }];
  assert.deepEqual(N.withHeld(live, held).map((c) => c.id), ["g:a", "g:b", "g:c"]);
  assert.deepEqual(N.withHeld([], held).map((c) => c.id), ["g:b", "g:c"]);
  assert.deepEqual(N.withHeld(live, []).map((c) => c.id), ["g:a", "g:b"]);
});
ok("the Undo promise holds: the reply goes only when its time is up, whatever happens to the card", () => {
  let st: any = N.REPLY_IDLE, r;
  for (const ev of [{ e: "open" }, { e: "type", text: "ok" }, { e: "send" }] as const) { r = N.replyStep(st, ev as any, 1000); st = r.state; }
  assert.equal(st.k, "undo");
  assert.equal(N.replyStep(st, { e: "tick" }, 1000 + N.REPLY_UNDO_MS - 1).send, null);
  assert.equal(N.replyStep(st, { e: "tick" }, 1000 + N.REPLY_UNDO_MS).send?.op, "send");
});
ok("the website card holds itself while an Undo waits and lets go when it ends", () => {
  const f = readF("src/views/SquadNoteCards.tsx");
  assert.ok(f.includes("withHeld(live, keep)") && f.includes('hold(c, st.k === "undo")') && f.includes("() => () => hold(c, false)"));
});
ok("the Mac card holds itself through Toast's remove() while an Undo waits", () => {
  assert.ok(readF("../mac/Sources/Toast.swift").includes("if(SquadMsg.hold(c))return;"));
  assert.ok(!/sqUndo&&c\.sqText\)\{var t=c\.sqText;c\.sqText='';if\(c\.data\.id\)post/.test(readF("../mac/Sources/SquadMessageCard.swift")));
});

// ---------- wiring (the files say what the tests above rely on) ----------
const read = (p: string) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
ok("the feature entry is there: owner jan, shared, since 1.60, on by default, parts web mac phone", () => {
  const f = JSON.parse(readFileSync(new URL("../../features.json", import.meta.url), "utf8")).features.find((x: any) => x.id === "gsquad-notify");
  assert.ok(f); assert.equal(f.owner, "jan"); assert.equal(f.scope, "shared"); assert.equal(f.since, "1.60"); assert.equal(f.default, "on"); assert.deepEqual(f.parts, ["web", "mac", "phone"]);
  assert.ok(readFileSync(new URL("../../FEATURES.md", import.meta.url), "utf8").includes("G Squad message notifications"));
});
ok("the engine asks the feature, never notifies from the open chat, and routes Dismiss, Open and Reply", () => {
  const e = read("src/squad/chatengine.ts");
  assert.ok(e.includes('feature(NOTIFY_FEATURE)')); assert.ok(e.includes("planNotes(")); assert.ok(e.includes("chatOpen: open"));
  assert.ok(e.includes('action === "dismiss"') && e.includes('action === "open"') && e.includes('action === "reply"'));
  assert.ok(e.includes("buildSend(text)"));   // Reply from the Mac's card sends through the composer's request
  assert.ok(e.includes("squadNoteSeen"));      // a Dismiss is saved for the other devices
});
ok("the website card sends through the composer and listens for Esc and Back", () => {
  const c = read("src/views/SquadNoteCards.tsx");
  assert.ok(c.includes("sendChat(")); assert.ok(c.includes("useBack(")); assert.ok(c.includes('"Escape"'));
  assert.ok(!/dangerouslySetInnerHTML|innerHTML/.test(c));
});
ok("no dashes in the new files", () => {
  for (const p of ["src/core/squadnotify.ts", "src/views/SquadNoteCards.tsx", "src/views/squadnote.css", "tests/gsquad-notify.test.ts"]) assert.ok(!new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]").test(read(p)), p);
});
console.log(`\n${n} checks passed`);

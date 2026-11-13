// Run: node --experimental-strip-types tests/dnd.test.ts
// PS Do Not Disturb (src/core/dnd.ts): on and off, what each toggle mutes on the Mac and the phone, when it
// ends, held chat cards keeping their place, the island lighting up instead of popping. FICTIONAL data.
import assert from "node:assert/strict";
const D = await import("../src/core/dnd.ts");
const C = await import("../src/core/chatdone.ts");
const I = await import("../src/core/island.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const T0 = Date.parse("2026-10-30T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3600_000, M = 60_000;

ok("off by default: nothing is muted", () => {
  assert.equal(D.dndActive(undefined, T0), false);
  for (const x of D.DND_KINDS) assert.equal(D.dndMutes(undefined, x.k, T0), false, x.k);
  assert.equal(D.dndMutes({ on: false }, "mail", T0), false);
});

ok("one click turns it on at once, with every toggle muted", () => {
  const d = D.dndApply(undefined, { op: "on" }, T0);
  assert.equal(d.on, true);
  assert.equal(d.since, iso(T0));
  assert.equal(d.until, null);
  for (const x of D.DND_KINDS) assert.equal(D.dndMutes(d, x.k, T0), true, x.k);
});

ok("turning it on again while on changes nothing (a double click never resets the stretch)", () => {
  const d = D.dndApply(undefined, { op: "on" }, T0);
  assert.deepEqual(D.dndApply(d, { op: "on" }, T0 + 5 * M), d);
});

ok("a toggle let through comes through, the rest stay muted", () => {
  let d = D.dndApply(undefined, { op: "on" }, T0);
  d = D.dndApply(d, { op: "pass", kind: "mail", pass: true }, T0);
  assert.equal(D.dndMutes(d, "mail", T0), false);
  assert.equal(D.dndMutes(d, "chats", T0), true);
  d = D.dndApply(d, { op: "pass", kind: "mail", pass: false }, T0);
  assert.equal(D.dndMutes(d, "mail", T0), true);
});

ok("let-through choices are kept for next time, in the pop-up's order", () => {
  let d = D.dndApply(undefined, { op: "on" }, T0);
  d = D.dndApply(d, { op: "pass", kind: "sounds", pass: true }, T0);
  d = D.dndApply(d, { op: "pass", kind: "mail", pass: true }, T0);
  assert.deepEqual(d.pass, ["mail", "sounds"]);
  d = D.dndApply(d, { op: "off" }, T0 + H);
  d = D.dndApply(d, { op: "on" }, T0 + 2 * H);
  assert.deepEqual(d.pass, ["mail", "sounds"]);
  assert.equal(D.dndMutes(d, "mail", T0 + 2 * H), false);
});

ok("the phone toggle mutes everything on the phone only", () => {
  let d = D.dndApply(undefined, { op: "on" }, T0);
  d = D.dndApply(d, { op: "pass", kind: "mail", pass: true }, T0);
  assert.equal(D.dndMutes(d, "mail", T0, "mac"), false);
  assert.equal(D.dndMutes(d, "mail", T0, "phone"), true);       // phone notifications still muted
  d = D.dndApply(d, { op: "pass", kind: "phone", pass: true }, T0);
  assert.equal(D.dndMutes(d, "mail", T0, "phone"), false);
  assert.equal(D.dndMutes(d, "chats", T0, "phone"), true);      // chats themselves are still muted
});

ok("1 hour ends by itself, on time", () => {
  let d = D.dndApply(undefined, { op: "on" }, T0);
  d = D.dndApply(d, { op: "until", until: D.inAnHour(T0) }, T0);
  assert.equal(D.dndEndsAt(d, T0), T0 + H);
  assert.equal(D.dndActive(d, T0 + H - 1), true);
  assert.equal(D.dndActive(d, T0 + H), false);
  assert.equal(D.dndMutes(d, "mail", T0 + H + 1), false);
  assert.equal(D.dndEndsAt(d, T0 + H + 1), 0);
});

ok("until I turn it off clears the end time; a past or broken time does too", () => {
  let d = D.dndApply(undefined, { op: "on" }, T0);
  d = D.dndApply(d, { op: "until", until: iso(T0 + H) }, T0);
  d = D.dndApply(d, { op: "until", until: null }, T0);
  assert.equal(d.until, null);
  d = D.dndApply(d, { op: "until", until: iso(T0 - H) }, T0);
  assert.equal(d.until, null);
  assert.equal(D.dndEndsAt(d, T0), 0);
});

ok("a time can only be set while it is on", () => {
  const d = D.dndApply({ on: false }, { op: "until", until: iso(T0 + H) }, T0);
  assert.equal(d.on, false);
  assert.equal(D.dndActive(d, T0), false);
});

ok("until tomorrow is 8 in the morning in the developer's time zone (Dubai, UTC+4)", () => {
  // 30 Oct 16:00 in the developer's city -> 31 Oct 08:00 Dubai = 04:00 UTC.
  assert.equal(D.tomorrowMorning(Date.parse("2026-10-30T12:00:00Z"), "Asia/Dubai"), "2026-10-31T04:00:00.000Z");
  // 02:30 at night (the developer works nights): "tomorrow" is this coming morning.
  assert.equal(D.tomorrowMorning(Date.parse("2026-10-30T22:30:00Z"), "Asia/Dubai"), "2026-10-31T04:00:00.000Z");
  // Another zone with summer time ending: New York, 31 Oct evening -> 1 Nov 08:00 EST = 13:00 UTC.
  assert.equal(D.tomorrowMorning(Date.parse("2026-11-01T00:00:00Z"), "America/New_York"), "2026-11-01T13:00:00.000Z");
});

ok("turning it off records when, and a stretch that ended by its clock ends then", () => {
  let d = D.dndApply(undefined, { op: "on" }, T0);
  const off = D.dndApply(d, { op: "off" }, T0 + 30 * M);
  assert.equal(off.on, false);
  assert.equal(off.offAt, iso(T0 + 30 * M));
  d = D.dndApply(d, { op: "until", until: iso(T0 + H) }, T0);
  const late = D.dndApply(d, { op: "off" }, T0 + 5 * H);
  assert.equal(late.offAt, iso(T0 + H));
  assert.deepEqual(D.dndApply({ on: false }, { op: "off" }, T0), { on: false });
});

ok("cleanDndOp only lets known actions through", () => {
  assert.deepEqual(D.cleanDndOp({ op: "on" }), { op: "on" });
  assert.deepEqual(D.cleanDndOp({ op: "pass", kind: "mail", pass: true }), { op: "pass", kind: "mail", pass: true });
  assert.deepEqual(D.cleanDndOp({ op: "until", until: null }), { op: "until", until: null });
  assert.equal(D.cleanDndOp({ op: "pass", kind: "everything", pass: true }), null);
  assert.equal(D.cleanDndOp({ op: "pass", kind: "mail", pass: "yes" }), null);
  assert.equal(D.cleanDndOp({ op: "until", until: "soon" }), null);
  assert.equal(D.cleanDndOp({ op: "delete" }), null);
  assert.equal(D.cleanDndOp("on"), null);
  assert.equal(D.cleanDndOp(null), null);
});

ok("every card PS raises maps to its toggle; VPN alarms, private mode and notes are never muted", () => {
  assert.equal(D.cardKind("m:abc"), "mail");
  assert.equal(D.cardKind("c:sess"), "chats");
  assert.equal(D.cardKind("n:thread"), "leads");
  for (const id of ["mb:1", "ma:2", "md:3", "mm:4", "ms:5"]) assert.equal(D.cardKind(id), "meetings", id);
  for (const id of ["eod", "eod-done", "ar:airpods", "net-online", "net-warmup"]) assert.equal(D.cardKind(id), "system", id);
  for (const id of ["net-vpn", "nl:x1", "private-ask"]) assert.equal(D.cardKind(id), null, id);
  assert.equal(D.cardKind("notes-1", "notes"), null);
});

ok("the native state names each muted kind, all false when off", () => {
  let d = D.dndApply(undefined, { op: "on" }, T0);
  d = D.dndApply(d, { op: "pass", kind: "sounds", pass: true }, T0);
  const s = D.dndNative(d, T0);
  assert.equal(s.on, true);
  assert.equal(s.until, 0);
  assert.equal(s.mute.sounds, false);
  assert.equal(s.mute.followup, true);
  const p = D.dndNative(d, T0, "phone");
  assert.equal(p.mute.sounds, true);    // the phone toggle is muted, so everything is on the phone
  const off = D.dndNative(D.dndApply(d, { op: "off" }, T0 + M), T0 + M);
  assert.equal(off.on, false);
  assert.ok(Object.values(off.mute).every((v) => v === false));
});

ok("held time: only the overlap with the quiet stretch, and nothing for a kind let through", () => {
  let d = D.dndApply(undefined, { op: "on" }, T0);
  assert.equal(D.dndHeldMs(d, "chats", T0 - H, T0 + 2 * H), 2 * H);     // still on: since T0
  d = D.dndApply(d, { op: "off" }, T0 + 2 * H);
  assert.equal(D.dndHeldMs(d, "chats", T0 + H, T0 + 5 * H), H);         // from T0+1h to the off at T0+2h
  assert.equal(D.dndHeldMs(d, "chats", T0 + 3 * H, T0 + 5 * H), 0);     // came after it ended
  d = D.dndApply(D.dndApply(d, { op: "on" }, T0 + 6 * H), { op: "pass", kind: "chats", pass: true }, T0 + 6 * H);
  assert.equal(D.dndHeldMs(d, "chats", T0 + 6 * H, T0 + 8 * H), 0);
});

ok("a chat card held for 5 hours is not lost (its 3 hours count without the quiet stretch)", () => {
  const done = [{ id: "s1", chat: "Fictional chat", at: iso(T0 + 10 * M) }];
  let d = D.dndApply(undefined, { op: "on" }, T0);
  // Still on, 5 hours later: kept (not dropped from the list either).
  assert.equal(C.chatDoneCards(done, T0 + 5 * H, d).length, 1);
  assert.equal(C.addChatDone(done, { id: "s2", chat: "Other chat", at: iso(T0 + 5 * H) }, T0 + 5 * H, d).length, 2);
  // Off at 5 hours: it comes up, and it is fresh (the chime) because its clock only started now.
  d = D.dndApply(d, { op: "off" }, T0 + 5 * H);
  const back = C.chatDoneCards(done, T0 + 5 * H + M, d);
  assert.equal(back.length, 1);
  assert.equal(back[0].fresh, true);
  // Without DND the same card would be long gone.
  assert.equal(C.chatDoneCards(done, T0 + 5 * H + M).length, 0);
  // And its usual 3 hours still apply after DND ends.
  assert.equal(C.chatDoneCards(done, T0 + 8 * H + 2 * M, d).length, 0);
});

ok("the island lights up instead of popping while its toggle is muted; counts still update", () => {
  const ev = { id: "m:1", kind: "mail" as const, title: "Jane just sent an email", sub: "Northwind Silk", url: "" };
  const base = { todos: [], today: "2026-10-30", mail: 3, leads: 1, event: ev, now: T0 };
  const on = D.dndApply(undefined, { op: "on" }, T0);
  const quiet = I.islandState({ ...base, settings: { dnd: on } });
  assert.equal(quiet.event?.quiet, true);
  assert.equal(quiet.mail, 3);
  assert.equal(quiet.leads, 1);
  const loud = I.islandState({ ...base, settings: {} });
  assert.equal(loud.event?.quiet, undefined);
  const let_ = I.islandState({ ...base, settings: { dnd: D.dndApply(on, { op: "pass", kind: "island", pass: true }, T0) } });
  assert.equal(let_.event?.quiet, undefined);
});

ok("the pop-up's line says how long", () => {
  const on = D.dndApply(undefined, { op: "on" }, T0);
  assert.equal(D.dndUntilText(on, T0), "Until you turn it off");
  const hour = D.dndApply(on, { op: "until", until: iso(T0 + H) }, T0);
  assert.match(D.dndUntilText(hour, T0, "en-GB"), /^Until \d{1,2}:\d\d$/);
  const tmr = D.dndApply(on, { op: "until", until: iso(T0 + 20 * H) }, T0);
  assert.match(D.dndUntilText(tmr, T0, "en-GB"), /^Until tomorrow \d{1,2}:\d\d$/);
});

ok("every toggle has words with no dashes", () => {
  for (const x of D.DND_KINDS) for (const t of [x.label, x.hint]) assert.ok(!/[\u2013\u2014]/.test(t), t);
});

console.log(`\n${n} of ${n} passed`);

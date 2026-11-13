// Run: node --experimental-strip-types tests/notescard.test.ts
// Meeting notes pop-up (src/core/notescard.ts) with FICTIONAL meetings and notes.
import assert from "node:assert/strict";
const N = await import("../src/core/notescard.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const T0 = Date.parse("2026-10-22T15:00:00Z"), min = 60_000;
const ev = (o: Partial<{ id: string; title: string; start: number; end: number; link: string | null; guests: boolean }> = {}) => ({
  id: o.id || "e1", title: o.title || "Shopify Redesign", start: new Date(o.start ?? T0).toISOString(), end: new Date(o.end ?? T0 + 60 * min).toISOString(),
  allDay: false, link: o.link === undefined ? "https://meet.google.com/abc" : o.link,
  attendees: o.guests === false ? [{ email: "red@example.com", self: true }] : [{ email: "red@example.com", self: true }, { email: "jane@northwindsilk.example" }],
});
const e = ev();
const key = N.meetingKey(e as never);
const notes = [{ key, title: e.title, start: e.start, items: [{ id: "i1", text: "Ask about the launch date", done: false }, { id: "i2", text: "Mention the size guide", done: true }], doneStanding: [] as string[] }];
const standing = [{ title: "shopify redesign", items: [{ id: "s1", text: "Confirm the budget" }] }];
const P = N.NOTES_DEFAULTS;
const card = (now: number, local = {}, nn = notes, ss = standing, p = P, evs = [e]) => N.notesCard(now, evs as never, nn as never, ss as never, local, p);

ok("nothing before the meeting has run 5 minutes", () => { assert.equal(card(T0 + 4 * min), null); });
ok("at +5 minutes: the open notes, every call ones first, ticked ones left out", () => {
  const c = card(T0 + 5 * min)!;
  assert.deepEqual(c.items.map((x) => x.text), ["Confirm the budget", "Ask about the launch date"]);
  assert.equal(c.items[0].every, true);
  assert.ok(c.id.length <= 40 && c.id.startsWith("nc:"));
  assert.deepEqual(c.snooze, [5, 10, 15, 20, 25, 30, 40, 45, 50, 60]);
});
ok("the minutes after the start follow the setting", () => {
  assert.equal(card(T0 + 2 * min, {}, notes, standing, { ...P, after: 3 }), null);
  assert.ok(card(T0 + 3 * min, {}, notes, standing, { ...P, after: 3 }));
});
ok("all ticked: no card (it closes itself)", () => {
  const done = [{ ...notes[0], items: notes[0].items.map((x) => ({ ...x, done: true })), doneStanding: ["s1"] }];
  assert.equal(card(T0 + 10 * min, {}, done), null);
});
ok("no notes for the meeting: no card", () => { assert.equal(card(T0 + 10 * min, {}, [], []), null); });
ok("snoozed: hidden until the time is up, then back with the items still open", () => {
  const local = { [key]: { snoozeUntil: T0 + 20 * min, at: T0 } };
  assert.equal(card(T0 + 10 * min, local), null);
  assert.equal(card(T0 + 20 * min, local)!.items.length, 2);
});
ok("Don't remind me: gone for that meeting", () => { assert.equal(card(T0 + 30 * min, { [key]: { quiet: true, at: T0 } }), null); });
ok("the meeting has ended: no card", () => { assert.equal(card(T0 + 61 * min), null); });
ok("not a meeting (no guests, no link): no card", () => { assert.equal(card(T0 + 10 * min, {}, notes, standing, P, [ev({ link: null, guests: false })]), null); });
ok("switched off: no card", () => { assert.equal(card(T0 + 10 * min, {}, notes, standing, { ...P, on: false }), null); });
ok("after the call: notes left open can become tasks", () => {
  const l = N.leftovers(T0 + 90 * min, [e] as never, notes as never);
  assert.deepEqual(l.map((x) => x.items.map((i) => i.text)), [["Ask about the launch date"]]);
  assert.equal(N.leftovers(T0 + 3 * 864e5, [e] as never, notes as never).length, 0, "only for 2 days");
});
ok("Claude's op: notes for a meeting by event id, no doubles", () => {
  let i = 0; const id = () => `n${++i}`;
  const r = N.applyNotesOp({ eventId: "e1", items: ["Ask about the launch date", "Show the mobile menu"] }, [e] as never, notes as never, standing as never, id)!;
  assert.deepEqual(r.meetingNotes.find((x) => x.key === key)!.items.map((x) => x.text), ["Ask about the launch date", "Mention the size guide", "Show the mobile menu"]);
});
ok("Claude's op: by title and start time, or for every call", () => {
  const id = () => "x";
  const r = N.applyNotesOp({ title: "shopify redesign", start: new Date(T0 + 5 * min).toISOString(), items: ["Share the preview link"] }, [e] as never, [], [], id)!;
  assert.equal(r.meetingNotes[0].key, key);
  const every = N.applyNotesOp({ title: "Shopify Redesign", items: ["Thank them for the time"], every: true }, [], [], [], id)!;
  assert.deepEqual(every.standingNotes, [{ title: "shopify redesign", items: [{ id: "x", text: "Thank them for the time" }] }]);
  assert.equal(N.applyNotesOp({ title: "Unknown call", start: new Date(T0).toISOString(), items: ["x"] }, [e] as never, [], [], id), null, "no meeting: waits");
});
console.log(`meeting notes card tests: ${n} passed`);

// Run: node --experimental-strip-types tests/meethide.test.ts
// Hiding a meeting from PS (src/core/meethide.ts): hide, Undo, one occurrence of a repeating event,
// tidying, and the op that travels from the Tab list. FICTIONAL events only.
import assert from "node:assert/strict";
const H = await import("../src/core/meethide.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const now = Date.parse("2026-11-03T10:00:00Z");
const ev = (id: string, start: string, end?: string) => ({ id, start, end: end ?? start, title: "Fictional " + id });
// Google gives each occurrence of a repeating event its own id (singleEvents=true).
const lesson1 = ev("abc_20261103T120000Z", "2026-11-03T12:00:00Z", "2026-11-03T13:00:00Z");
const lesson2 = ev("abc_20261110T120000Z", "2026-11-10T12:00:00Z", "2026-11-10T13:00:00Z");
const call = ev("call1", "2026-11-03T15:00:00Z", "2026-11-03T15:30:00Z");

ok("hiding takes the meeting off the list", () => {
  const l = H.hideMeeting([], H.meetKey(call), call.end, now);
  assert.deepEqual(H.visibleEvents([lesson1, call], l).map((e) => e.id), [lesson1.id]);
});
ok("Undo brings it back", () => {
  const l = H.unhideMeeting(H.hideMeeting([], H.meetKey(call), call.end, now), H.meetKey(call), now);
  assert.deepEqual(H.visibleEvents([lesson1, call], l).map((e) => e.id), [lesson1.id, call.id]);
});
ok("a repeating event: only that occurrence is hidden", () => {
  const l = H.hideMeeting([], H.meetKey(lesson1), lesson1.end, now);
  assert.deepEqual(H.visibleEvents([lesson1, lesson2], l).map((e) => e.id), [lesson2.id]);
});
ok("a hidden meeting moved to another time shows again", () => {
  const l = H.hideMeeting([], H.meetKey(call), call.end, now);
  const moved = { ...call, start: "2026-11-03T16:00:00Z" };
  assert.equal(H.visibleEvents([moved], l).length, 1);
});
ok("hiding twice keeps one entry", () => {
  let l = H.hideMeeting([], H.meetKey(call), call.end, now);
  l = H.hideMeeting(l, H.meetKey(call), call.end, now + 1000);
  assert.equal(l.length, 1);
});
ok("meetings over for two days drop off the list", () => {
  const l = H.hideMeeting([{ key: "old", at: "2026-10-20T00:00:00Z", end: "2026-10-30T00:00:00Z" }], H.meetKey(call), call.end, now);
  assert.deepEqual(l.map((h) => h.key), [H.meetKey(call)]);
});
ok("the list never grows past its cap", () => {
  let l: ReturnType<typeof H.hideMeeting> = [];
  for (let i = 0; i < 400; i++) l = H.hideMeeting(l, "k" + i, "2026-11-20T00:00:00Z", now);
  assert.equal(l.length, H.MEET_HIDE.max);
  assert.equal(l[l.length - 1].key, "k399");
});
ok("no end time: kept a day", () => {
  const [h] = H.hideMeeting([], "x", null, now);
  assert.equal(h.end, new Date(now + 86400_000).toISOString());
});
ok("the op from the Tab list is checked", () => {
  assert.deepEqual(H.cleanMeetHideOp({ op: "hide", key: "a", end: "2026-11-03T15:30:00Z" }), { op: "hide", key: "a", end: "2026-11-03T15:30:00Z" });
  assert.deepEqual(H.cleanMeetHideOp({ op: "unhide", key: "a" }), { op: "unhide", key: "a" });
  assert.deepEqual(H.cleanMeetHideOp({ op: "hide", key: "a", end: "nope" }), { op: "hide", key: "a", end: null });
  assert.equal(H.cleanMeetHideOp({ op: "drop", key: "a" }), null);
  assert.equal(H.cleanMeetHideOp({ op: "hide", key: "" }), null);
  assert.equal(H.cleanMeetHideOp({ op: "hide", key: "x".repeat(401) }), null);
  assert.equal(H.cleanMeetHideOp(null), null);
});
ok("hide then undo through ops, from the newest copy", () => {
  const a = H.applyMeetHide([], { op: "hide", key: "a", end: null }, now);
  const b = H.applyMeetHide(a, { op: "hide", key: "b", end: null }, now);
  const c = H.applyMeetHide(b, { op: "unhide", key: "a" }, now);
  assert.deepEqual(c.map((h) => h.key), ["b"]);
});
ok("nothing hidden: the same list back", () => {
  const list = [call];
  assert.equal(H.visibleEvents(list, undefined), list);
});

console.log(`\n${n} meeting hide tests passed`);

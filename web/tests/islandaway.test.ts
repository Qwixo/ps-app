// Run: node --experimental-strip-types tests/islandaway.test.ts
// V1.58 "Disappear for this meeting" (core/islandaway.ts): what the page tells the Mac about meetings. Only ids and
// times, the Meetings panel's own calendar copy, meetings taken off the panel left out, all day events never, from now to
// 12 hours ahead. The hide itself (the meeting's end, minutes, moved meetings, a restart) is ps-mac
// tests/island-away-test.swift.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const A = await import("../src/core/islandaway.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const now = Date.parse("2026-11-13T15:00:00Z");
const at = (min: number) => new Date(now + min * 60_000).toISOString();
const ev = (id: string, s: number, e: number, x: Record<string, unknown> = {}) => ({ id, title: "Secret client call", start: at(s), end: at(e), allDay: false, attendees: [], ...x });

ok("a meeting on now goes, with its start and end, never its title", () => {
  const m = A.islandMeetings([ev("a", -10, 20, { link: "https://meet.google.com/x" })], now);
  assert.deepEqual(m, [{ id: "a", start: now - 600_000, end: now + 1_200_000, real: true }]);
  assert.ok(!JSON.stringify(m).includes("Secret"));
});
ok("over, all day, broken or more than 12 hours ahead: left out", () => {
  const m = A.islandMeetings([ev("over", -60, -1), ev("day", -60, 600, { allDay: true }), ev("far", 12 * 60 + 1, 13 * 60), { id: "bad", title: "", start: "x", end: null, allDay: false, attendees: [] } as never, ev("back", 30, 10)], now);
  assert.deepEqual(m, []);
});
ok("later today goes too, so the Mac knows when it starts without a new message; earliest first, at most 12", () => {
  const list = Array.from({ length: 20 }, (_, i) => ev(`e${i}`, 300 - i * 10, 400));
  const m = A.islandMeetings(list, now);
  assert.equal(m.length, 12);
  assert.ok(m.every((x, i) => i === 0 || m[i - 1].start <= x.start));
});
ok("a calendar block with no people and no call link is not a real meeting (the Mac prefers real ones)", () => {
  assert.equal(A.islandMeetings([ev("focus", -5, 30)], now)[0].real, false);
  assert.equal(A.islandMeetings([ev("p", -5, 30, { attendees: [{ email: "a@b.c", name: null, rsvp: "accepted", self: false, organizer: false }] })], now)[0].real, true);
});
ok("long ids are cut", () => {
  assert.equal(A.islandMeetings([ev("x".repeat(500), -5, 30)], now)[0].id.length, 200);
});
ok("the page sends them with the island state, from the Meetings panel's calendar, hidden meetings left out", () => {
  const s = readFileSync("src/island.ts", "utf8");
  // V1.58 merge: the meetings are worked out first, then sent with the Pomodoro, Stand-up and meeting bubble state.
  assert.match(s, /const meets = islandMeetings\(visibleEvents\(cal \? cal\.data\.events : \[\], st\.meetHidden\), now\);/);
  assert.match(s, /send\(\{ \.\.\.shown, meets[,} ]/);
  assert.match(s, /const cal = calendarSnap\(s\);/);
});
console.log(`${n} ok`);

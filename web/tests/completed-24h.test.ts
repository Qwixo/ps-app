// V1.59: Completed opens on the last 24 hours, "More" opens the rest of the keep window
// (core/completed.ts RECENT_MS, recentSince, splitRecent, completedView, nextAgeOutAt).
import assert from "node:assert/strict";
import { RECENT_MS, completedList, completedView, nextAgeOutAt, recentSince, splitRecent } from "../src/core/completed.ts";
import type { Doc, Todo } from "../src/core/model.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const at = (iso: string) => Date.parse(iso);
const task = (id: string, data: Partial<Todo>): Doc<Todo> =>
  ({ id, ws: null, kind: "todo", author: null, updatedAt: null, data: { title: id, type: "once", done: false, order: 0, ...data } }) as Doc<Todo>;
const NOW = at("2026-11-14T10:00:00Z");
const done = (id: string, ms: number | string | null, extra: Partial<Todo> = {}) =>
  task(id, { done: true, doneAt: ms === null ? null : typeof ms === "number" ? new Date(ms).toISOString() : ms, ...extra });
const ids = (l: Doc<Todo>[]) => l.map((d) => d.id);

ok("24 hours is 24 real hours", () => { assert.equal(RECENT_MS, 86_400_000); assert.equal(recentSince(NOW), NOW - 86_400_000); });

ok("edge: a tick exactly 24 hours old is in; one millisecond older is out", () => {
  const l = [done("in", NOW - RECENT_MS), done("out", NOW - RECENT_MS - 1), done("fresh", NOW)];
  const s = splitRecent(l, NOW);
  assert.deepEqual(ids(s.recent), ["in", "fresh"]);
  assert.deepEqual(ids(s.older), ["out"]);
});
ok("edge: a tick one millisecond inside is in", () => assert.deepEqual(ids(splitRecent([done("a", NOW - RECENT_MS + 1)], NOW).recent), ["a"]));
ok("a tick in the future (clock drift between devices) counts as recent", () => assert.deepEqual(ids(splitRecent([done("a", NOW + 5 * 60_000)], NOW).recent), ["a"]));
ok("no readable tick time counts as older, never lost", () => {
  const s = splitRecent([done("none", null), done("bad", "not a date"), done("ok", NOW - 1000)], NOW);
  assert.deepEqual(ids(s.recent), ["ok"]); assert.deepEqual(ids(s.older), ["none", "bad"]);
});
ok("order is kept (newest first stays newest first) in both halves", () => {
  const l = [done("a", NOW - 1000), done("b", NOW - 2000), done("c", NOW - RECENT_MS - 1000), done("d", NOW - RECENT_MS - 2000)];
  const s = splitRecent(l, NOW);
  assert.deepEqual(ids(s.recent), ["a", "b"]); assert.deepEqual(ids(s.older), ["c", "d"]);
});

// Time zones: the cut is an elapsed time, so the same instant gives the same answer in every zone. Only the keep window
// (which days Completed holds) depends on the zone, and the 24 hour cut is always inside or equal to what it holds.
const ZONES = ["Asia/Dubai", "America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Europe/London", "Asia/Kolkata"];
ok("time zones: the 24 hour cut is the same instant in every zone", () => {
  const all = [done("a", NOW - 3 * 3600_000), done("b", NOW - RECENT_MS), done("c", NOW - RECENT_MS - 60_000), done("d", NOW - 5 * 86_400_000)];
  for (const tz of ZONES) {
    const list = completedList(all, "30d", NOW, tz);
    assert.deepEqual(ids(splitRecent(list, NOW).recent), ["a", "b"], tz);
    assert.deepEqual(ids(splitRecent(list, NOW).older), ["c", "d"], tz);
  }
});
ok("time zones: with keep Today, only ticks since the start of today show; the 24 hour cut then only trims them", () => {
  // 10:00 UTC on 14 Nov: Dubai (+4) is 14:00, so today started at 20:00 UTC on the 13th.
  const all = [done("today", at("2026-11-14T05:00:00Z")), done("lastnight", at("2026-11-13T21:00:00Z")), done("yesterday", at("2026-11-13T15:00:00Z"))];
  const tb = completedList(all, "today", NOW, "Asia/Dubai");
  assert.deepEqual(ids(tb), ["lastnight", "today"].sort((a, b) => at(all.find((d) => d.id === b)!.data.doneAt!) - at(all.find((d) => d.id === a)!.data.doneAt!)));
  assert.equal(splitRecent(tb, NOW).older.length, 0, "all of today is inside the last 24 hours, so there is no More");
  // In New York (-5) today started at 05:00 UTC on the 14th: only the 05:00 tick is in the keep window, still all recent.
  assert.deepEqual(ids(completedList(all, "today", NOW, "America/New_York")), ["today"]);
});
ok("time zones: with keep 7 days, a tick two days old is older (behind More) in every zone", () => {
  const all = [done("two", NOW - 2 * 86_400_000), done("one", NOW - 3600_000)];
  for (const tz of ZONES) {
    const v = completedView(completedList(all, "7d", NOW, tz), NOW, false);
    assert.deepEqual(ids(v.recent), ["one"], tz); assert.deepEqual(ids(v.older), ["two"], tz);
  }
});
ok("clock change days: 24 hours stays 24 elapsed hours across a daylight saving change", () => {
  // London springs forward 29 Mar 2026 01:00 UTC: the calendar day there is 23 hours long.
  const now = at("2026-03-29T12:00:00Z");
  const l = [done("in", now - RECENT_MS), done("out", now - RECENT_MS - 1)];
  const s = splitRecent(completedList(l, "7d", now, "Europe/London"), now);
  assert.deepEqual(ids(s.recent), ["in"]); assert.deepEqual(ids(s.older), ["out"]);
});

ok("More: collapsed shows only the last 24 hours, with More when there are older ones", () => {
  const list = [done("a", NOW - 1000), done("b", NOW - 2 * 86_400_000), done("c", NOW - 3 * 86_400_000)];
  const v = completedView(list, NOW, false);
  assert.deepEqual(ids(v.shown), ["a"]); assert.equal(v.canMore, true); assert.equal(v.canLess, false); assert.equal(v.quiet, false);
  assert.equal(v.older.length, 2);
});
ok("More: expanded shows everything the keep setting holds, newest first, with a way back", () => {
  const list = [done("a", NOW - 1000), done("b", NOW - 2 * 86_400_000), done("c", NOW - 3 * 86_400_000)];
  const v = completedView(list, NOW, true);
  assert.deepEqual(ids(v.shown), ["a", "b", "c"]); assert.equal(v.canMore, false); assert.equal(v.canLess, true);
});
ok("More: nothing older means no More button either way", () => {
  const list = [done("a", NOW - 1000), done("b", NOW - 5000)];
  for (const ex of [false, true]) { const v = completedView(list, NOW, ex); assert.equal(v.canMore, false); assert.equal(v.canLess, false); assert.deepEqual(ids(v.shown), ["a", "b"]); }
});
ok("More: nothing in the last 24 hours is a quiet line plus More", () => {
  const list = [done("old", NOW - 3 * 86_400_000)];
  const v = completedView(list, NOW, false);
  assert.equal(v.quiet, true); assert.deepEqual(ids(v.shown), []); assert.equal(v.canMore, true);
  const e = completedView(list, NOW, true);
  assert.equal(e.quiet, true, "still quiet about the last 24 hours, the older row shows below"); assert.deepEqual(ids(e.shown), ["old"]);
});
ok("More: an empty Completed is quiet with no More", () => {
  const v = completedView([], NOW, false);
  assert.equal(v.quiet, true); assert.equal(v.canMore, false); assert.equal(v.canLess, false); assert.deepEqual(v.shown, []);
});
ok("collapsing again (opened again) goes back to 24 hours: the view is a pure function of the flag", () => {
  const list = [done("a", NOW - 1000), done("b", NOW - 2 * 86_400_000)];
  assert.deepEqual(ids(completedView(list, NOW, true).shown), ["a", "b"]);
  assert.deepEqual(ids(completedView(list, NOW, false).shown), ["a"]);
});
ok("a tick ages out while the list is open: the next view moves it behind More", () => {
  const list = [done("a", NOW - RECENT_MS + 60_000)];
  assert.deepEqual(ids(completedView(list, NOW, false).shown), ["a"]);
  assert.deepEqual(ids(completedView(list, NOW + 60_001, false).shown), []);
  assert.equal(completedView(list, NOW + 60_001, false).canMore, true);
});

ok("nextAgeOutAt: the soonest tick to turn 24 hours old, none when nothing will", () => {
  const r = [done("a", NOW - 3600_000), done("b", NOW - 7200_000)];
  assert.equal(nextAgeOutAt(r, NOW), NOW - 7200_000 + RECENT_MS + 1);
  assert.equal(nextAgeOutAt([], NOW), null);
  assert.equal(nextAgeOutAt([done("x", null)], NOW), null);
  assert.equal(nextAgeOutAt([done("a", NOW - RECENT_MS)], NOW), NOW + 1, "exactly 24 hours old now: out one millisecond later");
});

console.log(`\n${n} passed`);

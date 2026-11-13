// Run: node tests/repeat.test.ts
// Repeating tasks and streaks: dates, ticks, the Reset button, the editors.
import assert from "node:assert/strict";
import * as R from "../src/core/repeat.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { try { fn(); n++; } catch (e) { console.error("FAIL", name); throw e; } };
type T = R.RepeatTask;
const tick = (t: T, at = "x") => ({ ...t, ...R.tickPatch(t, at) });
const reset = (t: T, today: string) => ({ ...t, ...(R.resetPatch(t, today) || {}) });

ok("months keep their day", () => {
  const r: R.Repeat = { every: 1, unit: "month", from: "2026-01-31" };
  assert.deepEqual([0, 1, 2, 3].map((k) => R.occurrence(r, k)), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.equal(R.occurrence({ every: 1, unit: "year", from: "2028-02-29" }, 1), "2029-02-28");
  assert.equal(R.nextAfter({ every: 2, unit: "day", from: "2026-10-01" }, "2026-10-16"), "2026-10-17");
  assert.equal(R.nextAfter({ every: 1, unit: "week", from: "2026-10-16" }, "2026-10-16"), "2026-10-23");
  assert.equal(R.nextAfter({ every: 1, unit: "week", from: "2026-10-20" }, "2026-10-16"), "2026-10-20");
  assert.equal(R.nextAfter({ every: 1, unit: "day", from: "2016-01-01" }, "2026-10-16"), "2026-10-17");
  assert.equal(R.nextAfter({ every: 1, unit: "month", from: "2026-01-31" }, "2026-02-28"), "2026-03-31");
});

ok("every day streak follows ticks and resets, not midnight", () => {
  let t: T = { type: "daily", done: false };
  t = tick(t); assert.equal(t.streak, 1);
  t = reset(t, "2026-10-16"); assert.equal(t.streak, 1); assert.equal(t.done, false);
  t = tick(t); assert.equal(t.streak, 2);
  t = tick(t); assert.equal(t.streak, 1, "untick takes it back");
  t = tick(t); assert.equal(t.streak, 2, "tick again does not double count");
  t = reset(t, "2026-10-17");
  t = tick(t); assert.equal(t.streak, 3); assert.equal(t.bestStreak, 3);
  t = reset(t, "2026-10-18");
  t = reset(t, "2026-10-19"); assert.equal(t.streak, 0, "a reset with it not done ends the streak");
  assert.equal(t.bestStreak, 3);
});

ok("one-offs never get a streak", () => {
  const t = tick({ type: "once", done: false });
  assert.equal(t.streak, undefined);
  assert.equal(R.resetPatch(t, "2026-10-16"), null);
});

ok("weekly: due day is safe until the day after, then moves on when done", () => {
  let t: T = { type: "daily", done: false, repeat: { every: 1, unit: "week", from: "2026-10-16" }, due: "2026-10-16" };
  assert.equal(R.isDueNow(t, "2026-10-15"), false);
  assert.equal(R.isDueNow(t, "2026-10-16"), true);
  t = tick(t); t = reset(t, "2026-10-17");
  assert.equal(t.due, "2026-10-23"); assert.equal(t.streak, 1);
  assert.equal(R.isDueNow(t, "2026-10-20"), false);
  t = reset(t, "2026-10-21"); assert.equal(t.streak, 1, "not due yet, nothing missed");
  t = reset(t, "2026-10-23"); assert.equal(t.streak, 1, "due today, still time");
  t = tick(t); t = reset(t, "2026-10-23"); assert.equal(t.due, "2026-10-30"); assert.equal(t.streak, 2);
  t = reset(t, "2026-10-31"); assert.equal(t.streak, 0, "missed its day"); assert.equal(t.due, "2026-10-30", "stays overdue");
  t = tick(t); t = reset(t, "2026-11-02"); assert.equal(t.due, "2026-11-06"); assert.equal(t.streak, 1);
});

ok("editor drafts and patches", () => {
  const today = "2026-10-16";
  assert.deepEqual(R.patchOf({ kind: "daily", every: 1, unit: "week", from: today }, today), { type: "daily", repeat: null, due: null });
  assert.deepEqual(R.patchOf({ kind: "repeat", every: 1, unit: "day", from: today }, today), { type: "daily", repeat: null, due: null });
  const w = R.patchOf({ kind: "repeat", every: 1, unit: "week", from: "2026-10-01" }, today);
  assert.equal(w.due, "2026-10-22");
  const m = R.patchOf({ kind: "repeat", every: 1, unit: "month", from: "2026-10-16" }, today);
  assert.equal(m.due, "2026-10-16");
  const prev = { type: "daily" as const, done: false, repeat: m.repeat, due: "2026-11-16" };
  const d = R.draftOf(prev, today);
  assert.equal(d.kind, "repeat"); assert.equal(d.from, "2026-11-16");
  assert.equal(R.patchOf(d, today, prev).due, "2026-11-16", "saving without changes keeps the date");
  assert.equal(R.repeatLabel({ every: 2, unit: "day", from: today }), "Every other day");
  assert.equal(R.repeatLabel({ every: 3, unit: "week", from: today }), "Every 3 weeks");
  assert.equal(R.cleanRepeat({ every: 0, unit: "week" }, today), null);
  assert.equal(R.cleanRepeat({ every: 2, unit: "fortnight" }, today), null);
});

console.log(`repeat: ${n} passed`);

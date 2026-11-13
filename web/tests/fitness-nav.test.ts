// Run: node --experimental-strip-types tests/fitness-nav.test.ts
// PS Fitness navigation (src/fitness/nav-logic.ts, V1.43): the sections, the screen stack (home at the bottom, back one
// step), personal bests, the day after next and the home summary words. FICTIONAL data.
import assert from "node:assert/strict";
const N = await import("../src/fitness/nav-logic.ts");
type W = { id: string; data: import("../src/core/fitness.ts").FitWorkout };

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };

function w(id: string, date: string, ex: { exId?: string | null; name: string; sets: [number | null, number | null, boolean?, { warm?: boolean; gone?: boolean }?][] }[], end = true): W {
  const startedAt = `${date}T15:00:00.000Z`;
  return { id, data: { programId: "p1", dayId: "d1", dayName: "Day 1", week: 1, date, startedAt, endedAt: end ? `${date}T16:00:00.000Z` : null, at: startedAt,
    exercises: ex.map((e, j) => ({ id: `${id}-x${j}`, exId: e.exId ?? null, name: e.name, at: startedAt,
      sets: e.sets.map(([kg, reps, done = true, o = {}], i) => ({ id: `${id}-${j}-${i}`, kg, reps, rir: null, done, at: startedAt, ...o })) })) } };
}

// ---------- sections ----------
ok("the menu holds every section in the developer's order, each with one plain line", () => {
  assert.deepEqual(N.SECTIONS.map((s) => s.k), ["gym", "plan", "history", "bests", "exercises", "sleep", "squad", "settings"]);
  assert.deepEqual(N.SECTIONS.map((s) => s.title), ["Today", "Programs", "History", "Personal bests", "Exercises", "Sleep", "Squad", "Settings"]);
  for (const s of N.SECTIONS) { assert.ok(s.line.length > 10 && s.line.length < 60, s.k); assert.ok(!/[\u2013\u2014]/.test(s.line + s.title), "no dashes"); }
  assert.equal(N.sectionInfo("home").title, "Fitness");
  assert.equal(N.sectionInfo("bests").title, "Personal bests");
  assert.ok(N.isSection("exercises") && !N.isSection("nope") && !N.isSection(null));
});

// ---------- the stack ----------
ok("Fitness opens on home, or on Today while a workout is open, or where the self test asks", () => {
  assert.deepEqual(N.startStack(null, false), [{ s: "home" }]);
  assert.deepEqual(N.startStack(null, true), [{ s: "home" }, { s: "gym" }]);
  assert.deepEqual(N.startStack("history", true), [{ s: "home" }, { s: "history" }]);
  assert.deepEqual(N.startStack("home", true), [{ s: "home" }]);
  assert.deepEqual(N.startStack("bogus", false), [{ s: "home" }]);
});
ok("the menu always lands one step above home, back goes one step, home has no back", () => {
  let st = N.startStack(null, false);
  st = N.goTo(st, "bests");
  assert.deepEqual(st, [{ s: "home" }, { s: "bests" }]);
  st = N.push(st, "history", { k: "x", key: "id:bench" });
  assert.equal(st.length, 3);
  assert.deepEqual(N.push(st, "history", { k: "x", key: "id:bench" }), st, "the same screen twice is one step");
  st = N.goTo(st, "settings");
  assert.deepEqual(st, [{ s: "home" }, { s: "settings" }], "the menu never piles screens up");
  st = N.back(st)!;
  assert.deepEqual(st, [{ s: "home" }]);
  assert.equal(N.back(st), null);
  assert.deepEqual(N.goTo(st, "home"), [{ s: "home" }]);
});

// ---------- personal bests ----------
ok("personal bests: heaviest set (most reps at that weight), strongest by estimated max, sessions, newest first", () => {
  const ws = [
    w("a", "2026-10-01", [{ exId: "bench", name: "Bench press", sets: [[60, 8], [70, 3], [40, 20, true, { warm: true }]] }]),
    w("b", "2026-10-05", [{ exId: "bench", name: "Bench press", sets: [[70, 5], [65, 10]] }, { name: "Sit-table bicep curl thing", sets: [[12, 10]] }]),
    w("c", "2026-10-09", [{ name: "Sit-table bicep curl thing", sets: [[14, 8], [100, 10, false], [80, 1, true, { gone: true }]] }]),
  ];
  const pb = N.personalBests(ws);
  assert.deepEqual(pb.map((x) => x.name), ["Sit-table bicep curl thing", "Bench press"]);
  const bench = pb[1];
  assert.equal(bench.kg, 70); assert.equal(bench.reps, 5); assert.equal(bench.date, "2026-10-05"); assert.equal(bench.workoutId, "b");
  assert.equal(bench.e1Kg, 65); assert.equal(bench.e1Reps, 10);   // 65 x 10 is about 86.7, beats 70 x 5 at 81.7
  assert.equal(bench.sessions, 2);
  const curl = pb[0];
  assert.equal(curl.kg, 14, "an unticked set and a taken out set never count");
  assert.equal(curl.sessions, 2);
  assert.equal(N.bestLine(bench), "70 kg x 5");
  assert.equal(N.bestLine(curl, true), "14 kg each side x 8");
});
ok("personal bests: nothing logged, bodyweight only or warm ups only gives an empty list", () => {
  assert.deepEqual(N.personalBests([]), []);
  assert.deepEqual(N.personalBests([w("a", "2026-10-01", [{ name: "Pull ups", sets: [[0, 8], [null, 6], [20, 5, true, { warm: true }]] }])]), []);
});

// ---------- home ----------
ok("the day after next wraps to day 1 of the next week, and needs two days", () => {
  const prog = { data: { name: "P", days: [{ id: "d1", name: "Day 1", exercises: [] }, { id: "d2", name: "Day 2", title: "Arms", exercises: [] }], createdAt: "", updatedAt: "" } } as never;
  assert.deepEqual(N.dayAfter(prog, { programId: "p", dayId: "d1", dayIndex: 0, week: 1, locked: false }), { week: 1, name: "Day 2", title: "Arms" });
  assert.deepEqual(N.dayAfter(prog, { programId: "p", dayId: "d2", dayIndex: 1, week: 1, locked: false }), { week: 2, name: "Day 1", title: null });
  const one = { data: { name: "P", days: [{ id: "d1", name: "Day 1", exercises: [] }], createdAt: "", updatedAt: "" } } as never;
  assert.equal(N.dayAfter(one, { programId: "p", dayId: "d1", dayIndex: 0, week: 1, locked: false }), null);
  assert.equal(N.dayAfter(null, null), null);
});
ok("the last workout is the newest finished one; an open one is not it", () => {
  const ws = [w("a", "2026-10-01", []), w("b", "2026-10-05", []), w("c", "2026-10-09", [], false)];
  assert.equal(N.lastFinished(ws)?.id, "b");
  assert.equal(N.lastFinished([]), null);
});
ok("ago words: Today, Yesterday, 3 days ago, then the date", () => {
  const short = (d: string) => `short ${d}`;
  assert.equal(N.agoWord("2026-11-08", "2026-11-08", short), "Today");
  assert.equal(N.agoWord("2026-11-07", "2026-11-08", short), "Yesterday");
  assert.equal(N.agoWord("2026-11-05", "2026-11-08", short), "3 days ago");
  assert.equal(N.agoWord("2026-10-20", "2026-11-08", short), "short 2026-10-20");
});

ok("coming days: Today, Tomorrow, then the weekday", () => {
  const wd = (d: string) => `wd ${d}`;
  assert.equal(N.soonWord("2026-11-08", "2026-11-08", wd), "Today");
  assert.equal(N.soonWord("2026-11-09", "2026-11-08", wd), "Tomorrow");
  assert.equal(N.soonWord("2026-11-11", "2026-11-08", wd), "wd 2026-11-11");
});

ok("plain day words and about how long a day takes", () => {
  assert.equal(N.dayWords({ name: "Day 3", title: "Arms" }), "Day 3: Arms");
  assert.equal(N.dayWords({ name: "Day 3", title: null }), "Day 3");
  const set = { reps: 10, kg: 20 };
  // two exercises x 3 sets, isolation rest 90 s: 2 x (3 x 45 + 2 x 90 + 60) = 750 s, about 15 min
  const day = { exercises: [{ id: "a", exId: "dumbbell-curl", name: "Dumbbell curl", kind: "isolation", sets: [set, set, set] }, { id: "b", exId: null, name: "Arm thing", kind: "isolation", sets: [set, set, set] }] } as never;
  assert.equal(N.dayMinutes(day, {}), 15);
  assert.equal(N.dayMinutes({ exercises: [] } as never, {}), 0);
  assert.ok(N.dayMinutes({ exercises: [{ id: "c", exId: null, name: "Thing", kind: "isolation", sets: [] }] } as never, {}) >= 10, "never under 10 when there is an exercise");
});

console.log(`\n${n} checks passed`);

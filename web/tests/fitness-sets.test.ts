// Run: node --experimental-strip-types tests/fitness-sets.test.ts
// PS Fitness V1.40 (the developer: rest times you choose, sets you choose, "never force the planned sets"): the short and
// long rest, a per exercise rest pick, the default and per exercise set count, Finish exercise and the gym's Sets
// chip, and that a workout finished early counts like any other. FICTIONAL data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const F = await import("../src/core/fitness.ts");
type W = { id: string; data: import("../src/core/fitness.ts").FitWorkout };

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const T0 = "2026-11-02T08:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();

const bench = { exId: "bench", name: "Bench press", kind: "compound" as const };
const curl = { exId: null, name: "Cable curl", kind: "isolation" as const };
const prog = { id: "p1", data: {
  name: "Fictional split", createdAt: T0, updatedAt: T0,
  days: [{ id: "d1", name: "Day 1", exercises: [
    { id: "a", ...bench, sets: [{ reps: 10, kg: 40 }, { reps: 10, kg: 40 }, { reps: 10, kg: 40 }], rir: 2 },
    { id: "b", ...curl, sets: [{ reps: 12, kg: 15 }, { reps: 12, kg: 15 }] },
    { id: "c", exId: null, name: "Plank", sets: [] },
  ] }],
} };
const start = (prefs?: import("../src/core/fitness.ts").FitPrefs) => F.startWorkout(prog, prog.data.days[0], 1, [], new Date(T0), "2026-11-02", "phone", prefs);
const tickAll = (w: import("../src/core/fitness.ts").FitWorkout, exId: string, k: number) => {
  const e = w.exercises.find((x) => x.id === exId)!;
  for (const s of F.liveSets(e).slice(0, k)) w = F.patchSet(w, exId, s.id, { done: true, rir: 2 }, at(5));
  return w;
};

// ---------- rest ----------
ok("defaults: big lifts get the long rest (2 min), small lifts the short rest (90 s)", () => {
  assert.equal(F.restFor(bench, {}), 120);
  assert.equal(F.restFor(curl, {}), 90);
  assert.equal(F.restFor(bench, { restCompound: 150, restIsolation: 60 }), 150);
  assert.equal(F.restFor(curl, { restCompound: 150, restIsolation: 60 }), 60);
});
ok("one rest for everything: both set to the same time", () => {
  const p = { restCompound: 105, restIsolation: 105 };
  assert.deepEqual([F.restFor(bench, p), F.restFor(curl, p)], [105, 105]);
});
ok("a per exercise pick: Long on a small lift, Short on a big one, and it follows the setting", () => {
  const p = { restKind: { "n:cable curl": "long" as const, "id:bench": "short" as const }, restCompound: 180, restIsolation: 75 };
  assert.equal(F.restFor(curl, p), 180);
  assert.equal(F.restFor(bench, p), 75);
  assert.equal(F.restFor(curl, { ...p, restCompound: 200 }), 200);
});
ok("order: own time, then the short or long pick, then the plan's rest, then the kind", () => {
  const key = "id:bench";
  assert.equal(F.restFor({ ...bench, rest: 100 }, {}), 100);
  assert.equal(F.restFor({ ...bench, rest: 100 }, { restKind: { [key]: "short" } }), 90);
  assert.equal(F.restFor({ ...bench, rest: 100 }, { restKind: { [key]: "short" }, restBy: { [key]: 135 } }), 135);
  assert.equal(F.restDefault({ ...bench, rest: 100 }, { restKind: { [key]: "short" }, restBy: { [key]: 135 } }), 100);
  assert.equal(F.restDefault(bench, { restBy: { [key]: 135 } }), 120);
});
ok("own rests are counted once per exercise (a time and a pick on the same one is one)", () => {
  assert.equal(F.ownRestCount({}), 0);
  assert.equal(F.ownRestCount({ restBy: { "id:bench": 90 }, restKind: { "id:bench": "long", "n:cable curl": "short" } }), 2);
});
ok("rest times stay between 5 s and 15 min (V1.47; was 15 s to 10 min)", () => {
  assert.equal(F.restLong({ restCompound: 5000 }), 900);
  assert.equal(F.restShort({ restIsolation: 1 }), 5);
});

// ---------- how many sets ----------
ok("sets: own number for the exercise, then the plan's, then the default (3)", () => {
  assert.equal(F.setsFor(bench, 4, {}), 4);
  assert.equal(F.setsFor(bench, 0, {}), 3);
  assert.equal(F.setsFor(bench, 0, { setsDefault: 5 }), 5);
  assert.equal(F.setsFor(bench, 4, { setsDefault: 5 }), 4);
  assert.equal(F.setsFor(bench, 4, { setsBy: { "id:bench": 2 } }), 2);
  assert.equal(F.setsFor({ exId: null, name: "cable  CURL" }, 0, { setsBy: { "n:cable curl": 6 } }), 6);
});
ok("sets stay between 1 and 12", () => {
  assert.equal(F.setsDefault({ setsDefault: 0 }), 1);
  assert.equal(F.setsDefault({ setsDefault: 40 }), 12);
  assert.equal(F.setsDefault({ setsDefault: Number.NaN }), 3);
  assert.equal(F.setsFor(bench, 99, {}), 12);
});
ok("a new workout uses them: the plan's 3 and 2, own 5 for the curl, the default 4 for an exercise with none", () => {
  const w = start({ setsBy: { "n:cable curl": 5 }, setsDefault: 4 });
  assert.deepEqual(w.exercises.map((e) => e.sets.length), [3, 5, 4]);
  assert.deepEqual(w.exercises[1].sets.map((s) => s.kg), [15, 15, 15, 15, 15]);   // more sets repeat the plan's last one
  assert.deepEqual(start().exercises.map((e) => e.sets.length), [3, 2, 3]);   // nothing set: as before
});
ok("prefillSets with a count: the weights still come from last time", () => {
  const hist: W[] = [{ id: "h", data: { programId: null, dayId: null, dayName: "Free workout", week: 1, date: "2026-11-01", startedAt: at(-1440), at: at(-1440), exercises: [
    { id: "x", ...bench, at: at(-1440), sets: [{ id: "s1", kg: 50, reps: 8, rir: 2, done: true, at: at(-1440) }, { id: "s2", kg: 52.5, reps: 6, rir: 1, done: true, at: at(-1440) }] },
  ] } }];
  assert.deepEqual(F.prefillSets({ ...bench, sets: [] }, hist, T0, null, 4).map((s) => s.kg), [50, 52.5, 52.5, 52.5]);
  assert.equal(F.prefillSets({ ...bench, sets: [] }, hist, T0).length, 3);   // no count: 3, a short day last time is never copied
});

// ---------- Finish exercise ----------
ok("Finish exercise after 2 of 3: the third is left out, the two done stay", () => {
  let w = tickAll(start(), "a", 2);
  const r = F.endExercise(w, "a", at(10));
  assert.equal(r.ids.length, 1);
  w = r.w;
  const e = w.exercises[0];
  assert.deepEqual(F.liveSets(e).map((s) => s.done), [true, true]);
  assert.equal(e.sets.length, 3);   // kept, marked gone, so the other device's copy cannot bring it back
  assert.equal(e.sets[2].gone, true);
});
ok("then the workout moves on to the next exercise, and the progress line counts 2 of 2 for it", () => {
  const w = F.endExercise(tickAll(start(), "a", 2), "a", at(10)).w;
  assert.deepEqual(F.currentSpot(w), { exIndex: 1, setIndex: 0 });
});
ok("Finish exercise with nothing done does nothing (that is Remove from today)", () => {
  const w = start();
  const r = F.endExercise(w, "a", at(10));
  assert.equal(r.ids.length, 0);
  assert.equal(r.w, w);
});
ok("a workout finished early counts like any other: sets, volume, history and the week streak", () => {
  let w = F.endExercise(tickAll(start(), "a", 2), "a", at(10)).w;
  w = F.endExercise(tickAll(w, "b", 1), "b", at(20)).w;
  w = F.endExercise(w, "c", at(21)).w;   // nothing done on the plank: left as it is
  assert.equal(F.workoutSetsDone(w), 3);
  assert.equal(F.workoutVolume(w), 40 * 10 * 2 + 15 * 12);
  const hist: W[] = [{ id: "w1", data: w }];
  const pts = F.exerciseProgress("id:bench", hist);
  assert.deepEqual([pts.length, pts[0].sets], [1, 2]);
  assert.equal(F.weekStats(hist, "2026-11-02", 1).count, 1);
  assert.equal(F.nextDay(prog, hist)!.week, 2);   // the day is done, the program moves on
});
ok("next time starts with the usual number again, at last time's weights", () => {
  const w1 = F.endExercise(tickAll(start(), "a", 2), "a", at(10)).w;
  const w2 = F.startWorkout(prog, prog.data.days[0], 2, [{ id: "w1", data: w1 }], new Date(at(2880)), "2026-11-04");
  assert.equal(w2.exercises[0].sets.length, 3);
  assert.deepEqual(w2.exercises[0].sets.map((s) => s.kg), [40, 40, 40]);
});
ok("the add weight hint is not upset by fewer sets than planned", () => {
  let w = start();
  for (const s of w.exercises[0].sets.slice(0, 2)) w = F.patchSet(w, "a", s.id, { done: true, rir: 4 }, at(5));
  w = F.endExercise(w, "a", at(10)).w;
  const h = F.progressionHint("id:bench", [{ id: "w1", data: w }], { targetRir: 2, targetReps: [10, 10, 10] });
  assert.equal(h?.kind, "up");
});
ok("the offline merge keeps the early finish (a gone set stays gone)", () => {
  const base = tickAll(start(), "a", 2);
  const phone = F.endExercise(base, "a", at(10)).w;
  const mac = F.patchSet(base, "b", base.exercises[1].sets[0].id, { kg: 17.5 }, at(8));
  const m = F.mergeWorkout(phone, mac);
  assert.deepEqual(F.liveSets(m.exercises[0]).length, 2);
  assert.equal(m.exercises[1].sets[0].kg, 17.5);
});

// ---------- the Sets chip in the gym ----------
ok("Sets chip: up to 5 adds two copies of the last set; down to 1 takes open sets off the end", () => {
  let w = F.fitSetCount(start(), "a", 5, at(1));
  assert.deepEqual(F.liveSets(w.exercises[0]).map((s) => s.kg), [40, 40, 40, 40, 40]);
  w = tickAll(w, "a", 2);
  w = F.fitSetCount(w, "a", 1, at(2));
  assert.equal(F.liveSets(w.exercises[0]).length, 2);   // never below the sets already done
  assert.ok(F.liveSets(w.exercises[0]).every((s) => s.done));
});
ok("Sets chip at the same number changes nothing", () => {
  const w = start();
  assert.equal(F.fitSetCount(w, "a", 3, at(1)).exercises[0], w.exercises[0]);
});

// ---------- settings sync ----------
ok("the new settings merge field by field like the rest (one device's sets, the other's rest pick)", () => {
  const a = F.stampPrefs({}, { setsDefault: 4 }, at(1));
  const b = F.stampPrefs({}, { restKind: { "id:bench": "short" } }, at(2));
  const m = F.mergePrefs(a, b);
  assert.deepEqual([m.setsDefault, m.restKind], [4, { "id:bench": "short" }]);
  const reset = F.mergePrefs(F.stampPrefs({}, { setsBy: { "id:bench": 2 } }, at(1)), F.stampPrefs({}, { setsBy: {} }, at(3)));
  assert.deepEqual(reset.setsBy, {});
});

// ---------- the words ----------
ok("the new words have no dashes and never nag", () => {
  const src = ["src/fitness/Gym.tsx", "src/fitness/FitSettings.tsx", "src/fitness/Programs.tsx"].map((f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8")).join("\n");
  for (const w of ["Finish exercise", "The rest are left out.", "Long rest", "Short rest", "sets per exercise", "Back to "]) assert.ok(src.includes(w), w);
  assert.ok(!/[–—]/.test(src));
  assert.ok(!/are you sure|you missed|incomplete/i.test(src));
});

console.log(`\n${n} passed`);

// Run: node --experimental-strip-types tests/fitness-startlast.test.ts
// PS Fitness, "New sets start at your last weight" (src/core/fitness.ts setStart, addSet, extraSet, V1.60): a new set starts with the
// weight and reps of the last set done on that exercise, this workout first, else the last time. FICTIONAL data.
import assert from "node:assert/strict";
const F = await import("../src/core/fitness.ts");
type FitSet = import("../src/core/fitness.ts").FitSet;

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const T0 = "2026-11-02T08:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();
const set = (id: string, kg: number | null, reps: number | null, done: boolean, more: Partial<FitSet> = {}): FitSet => ({ id, kg, reps, rir: null, done, at: T0, ...more });
const W = (id: string, startedAt: string, sets: FitSet[], exId: string | null = "leg-curl", name = "Lying leg curl") => ({
  id, data: { programId: null, dayId: null, dayName: "Free workout", week: 1, date: startedAt.slice(0, 10), startedAt, at: startedAt,
    exercises: [{ id: `${id}-x`, exId, name, at: startedAt, sets }] },
});
const hist = [
  W("h1", "2026-10-20T08:00:00.000Z", [set("a", 50, 10, true), set("b", 55, 8, true)]),
  W("h2", "2026-10-27T08:00:00.000Z", [set("c", 60, 10, true), set("d", 65, 6, true), set("w", 20, 12, true, { warm: true })]),
];

ok("this workout first: the last set done, not the plan's number", () => {
  const w = W("now", T0, [set("s1", 70, 8, true), set("s2", 40, 12, false), set("s3", 40, 12, false)]);
  assert.deepEqual(F.setStart(w.data.exercises[0], hist), { kg: 70, reps: 8 });
  const a = F.addSet(w.data, w.data.exercises[0].id, at(1), hist);
  const last = a.exercises[0].sets[3];
  assert.deepEqual([last.kg, last.reps, last.done], [70, 8, false]);
});
ok("nothing done in this workout yet: the last time, its last set", () => {
  const w = W("now", T0, [set("s1", null, null, false)]);
  assert.deepEqual(F.setStart(w.data.exercises[0], hist), { kg: 65, reps: 6 });
  const a = F.addSet(w.data, w.data.exercises[0].id, at(1), hist);
  assert.deepEqual([a.exercises[0].sets[1].kg, a.exercises[0].sets[1].reps], [65, 6]);
});
ok("a new exercise with no sets at all still starts at last time (every set was taken out)", () => {
  const w = W("now", T0, [set("s1", 10, 10, false, { gone: true })]);
  assert.deepEqual(F.setStart(w.data.exercises[0], hist), { kg: 65, reps: 6 });
});
ok("warm ups never set the start; a drop set done in this workout does (Add set copies the last set); old drop sets never do", () => {
  const w = W("now", T0, [set("s1", 80, 5, true), set("s2", 64, 5, true, { drop: true }), set("s3", 20, 12, true, { warm: true })]);
  assert.deepEqual(F.setStart(w.data.exercises[0], hist), { kg: 64, reps: 5 });
  const h = [W("h3", "2026-10-29T08:00:00.000Z", [set("a", 90, 5, true), set("b", 72, 5, true, { drop: true })])];
  assert.deepEqual(F.setStart({ exId: "leg-curl", name: "Lying leg curl", sets: [] }, h), { kg: 90, reps: 5 });
});
ok("no history and nothing done: the set on screen, or nothing", () => {
  const w = W("now", T0, [set("s1", 40, 12, false)]);
  assert.deepEqual(F.setStart(w.data.exercises[0], []), { kg: 40, reps: 12 });
  assert.deepEqual(F.setStart({ exId: null, name: "Brand new", sets: [] }, hist), { kg: null, reps: null });
});
ok("history of another exercise never leaks in", () => {
  const e = { exId: "bench", name: "Bench press", sets: [] as FitSet[] };
  assert.deepEqual(F.setStart(e, hist), { kg: null, reps: null });
  // an exercise with no id matches by its name
  const own = W("h4", "2026-10-30T08:00:00.000Z", [set("a", 30, 15, true)], null, "Seat adjust curl");
  assert.deepEqual(F.setStart({ exId: null, name: "seat adjust  CURL", sets: [] }, [own]), { kg: 30, reps: 15 });
});
ok("bodyweight: no weight, the reps still carry", () => {
  const w = W("now", T0, [set("s1", null, 12, true)], null, "Push up");
  assert.deepEqual(F.setStart(w.data.exercises[0], []), { kg: null, reps: 12 });
});
ok("Add set and Drop set: Add starts at the last set done, Drop goes lighter than the last set on screen", () => {
  const w = W("now", T0, [set("s1", 70, 8, true), set("s2", 40, 12, false)]);
  const e = w.data.exercises[0];
  const add = F.extraSet(w.data, e.id, "new1", false, 2.5, at(2), hist).exercises[0].sets.at(-1)!;
  assert.deepEqual([add.kg, add.reps, add.extra], [70, 8, true]);
  const drop = F.extraSet(w.data, e.id, "new2", true, 2.5, at(2), hist).exercises[0].sets.at(-1)!;
  assert.deepEqual([drop.kg, drop.drop], [F.dropKg(40, 2.5), true]);
});
ok("Add set twice in a row keeps the same numbers (no retyping)", () => {
  let w = W("now", T0, [set("s1", 70, 8, true)]).data;
  const id = w.exercises[0].id;
  w = F.addSet(w, id, at(1), hist);
  w = F.addSet(w, id, at(2), hist);
  const s = w.exercises[0].sets;
  assert.deepEqual(s.map((x) => [x.kg, x.reps]), [[70, 8], [70, 8], [70, 8]]);
});
ok("switched off: the old way, a copy of the last set on screen", () => {
  const w = W("now", T0, [set("s1", 70, 8, true), set("s2", 40, 12, false)]);
  assert.deepEqual(F.setStart(w.data.exercises[0], hist, false), { kg: 40, reps: 12 });
  const a = F.addSet(w.data, w.data.exercises[0].id, at(1), hist, false).exercises[0].sets.at(-1)!;
  assert.deepEqual([a.kg, a.reps], [40, 12]);
});
ok("existing behaviour: a fresh workout's Add set copies the plan's weight", () => {
  const w = W("now", T0, [set("s1", 40, 12, false), set("s2", 40, 10, false)]);
  const a = F.addSet(w.data, w.data.exercises[0].id, at(1), []).exercises[0].sets.at(-1)!;
  assert.deepEqual([a.kg, a.reps], [40, 10]);
});
ok("a new exercise added mid workout still prefills every set from last time", () => {
  const sets = F.prefillSets({ exId: "leg-curl", name: "Lying leg curl", sets: [{ reps: 10, kg: null }, { reps: 10, kg: null }, { reps: 10, kg: null }] }, hist, T0, null, 3);
  assert.deepEqual(sets.map((s) => [s.kg, s.reps]), [[60, 10], [65, 6], [65, 6]]);
});
console.log(`\n${n} checks passed`);

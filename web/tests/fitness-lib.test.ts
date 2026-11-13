// Run: node --experimental-strip-types tests/fitness-lib.test.ts
// PS Fitness: the door between the library / trainer sheet modules and the app (src/fitness/lib.ts):
// a pasted sheet becomes a program, a logged week goes back out in the trainer's layout. FICTIONAL data.
import assert from "node:assert/strict";
const L = await import("../src/fitness/lib.ts");
const F = await import("../src/core/fitness.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const sheet = [
  "\tDAY 1\tDAY 1\tDAY 1\tDAY 1",
  "\tExercise\tSets and Reps\tWeight\tRIR",
  "\te.g. Overhead dumbbell press\te.g.: 3 sets x 12, 10, 10\te.g.: 20kg each side\trir 2",
  "\tOverhead dumbbell press\t3 sets x 12, 10, 10\t20kg each side\trir 2",
  "\tLat pulldown\t3x10\t50kg\trir 1-2",
  "",
  "\tDAY 2\tDAY 2\tDAY 2\tDAY 2",
  "\tExercise\tSets and Reps\tWeight\tRIR",
  "\tFictional made up move\t2 x 15\t\t",
].join("\n");

ok("a pasted sheet becomes a program: days, per set reps, kg, each side, target RIR; the e.g. row is skipped", () => {
  const { program, warnings } = L.importSheet(sheet, "Fictional plan");
  assert.equal(program.days.length, 2);
  const [ohp, lat] = program.days[0].exercises;
  assert.equal(program.days[0].exercises.length, 2);
  assert.equal(ohp.exId, "standing-dumbbell-overhead-press");
  assert.deepEqual(ohp.sets.map((s) => [s.reps, s.kg]), [[12, 20], [10, 20], [10, 20]]);
  assert.equal(ohp.perSide, true);
  assert.equal(ohp.rir, 2);
  assert.equal(ohp.rest, null);                    // The developer's defaults apply (2 min compound)
  assert.equal(F.restFor(ohp), 120);
  assert.equal(lat.rir, 1);                         // "rir 1-2": the harder end
  assert.equal(program.days[1].exercises[0].exId, null);   // not in the library: kept as written
  assert.equal(program.days[1].exercises[0].sets.length, 2);
  assert.ok(Array.isArray(warnings));
});
ok("a logged week goes out in the trainer's layout", () => {
  const { program } = L.importSheet(sheet);
  const prog = { id: "p", data: { ...program, createdAt: "", updatedAt: "" } };
  let w = F.startWorkout(prog, program.days[0], 1, [], new Date("2026-11-02T08:00:00Z"), "2026-11-02");
  const e = w.exercises[0];
  w = F.patchSet(w, e.id, e.sets[0].id, { done: true, rir: 2 }, "2026-11-02T08:01:00Z");
  w = F.patchSet(w, e.id, e.sets[1].id, { done: true, rir: 1 }, "2026-11-02T08:04:00Z");
  const out = L.exportWeek([{ id: "w", data: w }], "p", 1);
  const row = out.rows.find((r) => r.includes(e.name))!;
  assert.deepEqual(row.slice(1), [e.name, "2 sets x 12, 10", "20kg each side", "rir 2, 1"]);
  assert.ok(out.rows.some((r) => r[1] === "Exercise" && r[4] === "RIR"));
  assert.ok(out.tsv.includes("\t"));
  assert.ok(out.csv.includes(","));
  assert.equal(out.rows.some((r) => r.includes("Lat pulldown")), false);   // nothing done: left out
});
ok("the library: search, find, and the step and cue the screens show", () => {
  const x = L.findLib("lat pull down")!;
  assert.equal(x.id, "lat-pulldown");
  assert.ok(x.step > 0 && x.cue);
  assert.ok(L.searchLib("curl").length > 1);
  assert.equal(L.libById("nope"), null);
  const p = L.planFromLib(x);
  assert.deepEqual([p.sets.length, p.rir, p.rest], [3, 2, null]);
});

ok("a plan from a sealed package keeps the names as written, links only real library ids, makes up no sets", () => {
  const r = L.programFromPlan({ name: "  Test plan  ", days: [
    { name: "Day 1", title: "Push", exercises: [{ name: "Fly machine (chest)", exId: "pec-deck" }, { name: "Odd cable thing", exId: "not-a-real-id" }, { name: "  " }] },
    { title: null, exercises: [{ name: "Curl thing", note: "Seat on 4" }] },
    { name: "Day 3", title: "Legs", exercises: [] },
  ] })!;
  assert.equal(r.name, "Test plan");
  assert.deepEqual(r.days.map((d) => [d.name, d.title]), [["Day 1", "Push"], ["Day 2", null], ["Day 3", "Legs"]]);
  const [a, b] = r.days[0].exercises;
  assert.deepEqual([a.name, a.exId, a.kind, a.step, a.sets], ["Fly machine (chest)", "pec-deck", "isolation", 5, []]);
  assert.deepEqual([b.name, b.exId, b.sets], ["Odd cable thing", null, []]);
  assert.equal(r.days[0].exercises.length, 2);
  assert.equal(r.days[1].exercises[0].note, "Seat on 4");
  assert.equal(L.programFromPlan({ name: "", days: [{ exercises: [] }] }), null);
  assert.equal(L.programFromPlan({ name: "x", days: [] }), null);
});
ok("a plan exercise with no sets still starts with three blank sets in the gym, its note carried along", () => {
  const r = L.programFromPlan({ name: "T", days: [{ exercises: [{ name: "Curl thing", note: "Seat on 4" }] }] })!;
  const w = F.startWorkout({ id: "p", data: { ...r, createdAt: "", updatedAt: "" } }, r.days[0], 1, [], new Date("2026-11-02T08:00:00Z"), "2026-11-02");
  assert.equal(w.exercises[0].sets.length, 3);
  assert.equal(w.exercises[0].note, "Seat on 4");
});
console.log(`\n${n} passed`);

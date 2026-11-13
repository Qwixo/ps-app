// Run: node --experimental-strip-types tests/fitness-plan.test.ts
// PS Fitness, the Program screen's helpers (src/fitness/plan-logic.ts): moving days and exercises, the set
// count, per set reps and kg, the card's words, beginner hints, typed numbers, import checks and the
// weeks to export. FICTIONAL data.
import assert from "node:assert/strict";
const L = await import("../src/fitness/plan-logic.ts");
type W = { id: string; data: import("../src/core/fitness.ts").FitWorkout };

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };

// ---------- lists ----------
ok("moveItem moves up and down and clamps", () => {
  assert.deepEqual(L.moveItem(["a", "b", "c"], 0, 1), ["b", "a", "c"]);
  assert.deepEqual(L.moveItem(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  assert.deepEqual(L.moveItem(["a", "b", "c"], 2, 9), ["a", "b", "c"]);
  assert.deepEqual(L.moveItem(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
  const src = ["a", "b"]; L.moveItem(src, 0, 1); assert.deepEqual(src, ["a", "b"]);
});
ok("renumberDays renames Day N, keeps own names", () => {
  const days = [{ id: "x", name: "Day 3", exercises: [] }, { id: "y", name: "Arms", exercises: [] }, { id: "z", name: "Day 1", exercises: [] }];
  assert.deepEqual(L.renumberDays(days).map((d) => d.name), ["Day 1", "Arms", "Day 3"]);
  const same = [{ id: "a", name: "Day 1", exercises: [] }];
  assert.equal(L.renumberDays(same)[0], same[0]);
});
ok("blankProgram: My program with four empty days", () => {
  const p = L.blankProgram();
  assert.equal(p.name, "My program");
  assert.deepEqual(p.days.map((d) => d.name), ["Day 1", "Day 2", "Day 3", "Day 4"]);
  assert.equal(new Set(p.days.map((d) => d.id)).size, 4);
  assert.equal(p.source, "manual");
});
ok("indexAfterDelete stays in place, else the last", () => {
  assert.equal(L.indexAfterDelete(1, 3), 1);
  assert.equal(L.indexAfterDelete(3, 3), 2);
  assert.equal(L.indexAfterDelete(0, 0), -1);
});

// ---------- sets ----------
const t = (reps: number | null, kg: number | null, repsMax?: number | null) => (repsMax === undefined ? { reps, kg } : { reps, kg, repsMax });
ok("setCount adds copies of the last set and keeps per set reps", () => {
  const s = [t(12, 20), t(10, 20), t(10, 22.5)];
  assert.deepEqual(L.setCount(s, 5), [t(12, 20), t(10, 20), t(10, 22.5), t(10, 22.5), t(10, 22.5)]);
  assert.deepEqual(L.setCount(s, 2), [t(12, 20), t(10, 20)]);
  assert.equal(L.setCount(s, 0).length, 1);
  assert.equal(L.setCount(s, 40).length, L.SETS_MAX);
  assert.deepEqual(L.setCount([], 2), [t(10, null), t(10, null)]);
  const grown = L.setCount(s, 4); grown[3].reps = 1; assert.equal(s[2].reps, 10);
});
ok("allSame and setAll", () => {
  assert.equal(L.allSame([t(10, 20), t(10, 20)], "reps"), true);
  assert.equal(L.allSame([t(12, 20), t(10, 20)], "reps"), false);
  assert.equal(L.allSame([t(12, 20), t(10, 20)], "kg"), true);
  assert.deepEqual(L.setAll([t(12, 20), t(10, 22.5)], "kg", 25), [t(12, 25), t(10, 25)]);
  assert.deepEqual(L.setAll([t(12, 20), t(10, 22.5)], "reps", 8), [t(8, 20), t(8, 22.5)]);
});
ok("setAt changes one set; a range keeps its top only while above", () => {
  assert.deepEqual(L.setAt([t(12, 20), t(10, 20)], 1, "reps", 9), [t(12, 20), t(9, 20)]);
  assert.deepEqual(L.setAt([t(8, 20, 10)], 0, "reps", 9), [t(9, 20, 10)]);
  assert.deepEqual(L.setAt([t(8, 20, 10)], 0, "reps", 10), [t(10, 20, null)]);
  assert.deepEqual(L.setAt([t(8, 20)], 0, "kg", null), [t(8, null)]);
});
ok("stepKg never below zero, no float dust", () => {
  assert.equal(L.stepKg(20, 2.5), 22.5);
  assert.equal(L.stepKg(1, -2.5), 0);
  assert.equal(L.stepKg(null, 2.5), 2.5);
  assert.equal(L.stepKg(0.1, 0.2), 0.3);
});
ok("parseKg and parseReps read what the developer types", () => {
  assert.equal(L.parseKg("22,5"), 22.5);
  assert.equal(L.parseKg("20 kg"), 20);
  assert.equal(L.parseKg(""), null);
  assert.equal(L.parseKg("abc"), null);
  assert.equal(L.parseKg("5000"), null);
  assert.equal(L.parseReps("12"), 12);
  assert.equal(L.parseReps("0"), null);
  assert.equal(L.parseReps(""), null);
});

// ---------- words ----------
ok("weightLine: one kg, each side, per set, none", () => {
  assert.equal(L.weightLine({ perSide: true, sets: [t(12, 20), t(10, 20)] }), "20 kg each");
  assert.equal(L.weightLine({ sets: [t(10, 50), t(8, 52.5), t(8, 52.5)] }), "50, 52.5, 52.5 kg");
  assert.equal(L.weightLine({ sets: [t(10, 50), t(8, null)] }), "50, ? kg");
  assert.equal(L.weightLine({ sets: [t(10, null)] }), "");
});
ok("kindHint and restWords for a beginner", () => {
  assert.equal(L.kindHint("compound"), "Compound: works several muscles, rest 2 min");
  assert.equal(L.kindHint("isolation"), "Isolation: works one muscle, rest 1:30");
  assert.equal(L.kindHint(undefined, { restCompound: 180 }), "Compound: works several muscles, rest 3 min");
  assert.equal(L.restWords(135), "2:15");
  assert.equal(L.nudgeRest(120, 15), 135);
  assert.equal(L.nudgeRest(15, -15), 5);   // V1.47: the floor is 5 s
});
ok("ownEx: free text, three sets of ten, no library id", () => {
  const e = L.ownEx("  Cable fly ", "isolation");
  assert.equal(e.name, "Cable fly");
  assert.equal(e.exId, null);
  assert.equal(e.kind, "isolation");
  assert.deepEqual(e.sets, [t(10, null), t(10, null), t(10, null)]);
  assert.equal(L.ownEx("", "compound").name, "My exercise");
});
ok("sameName ignores case and marks", () => {
  assert.equal(L.sameName("Lat Pulldown", "lat-pulldown"), true);
  assert.equal(L.sameName("Lat pulldown", "Seated row"), false);
});
ok("programSummary", () => {
  assert.equal(L.programSummary({ days: [{ id: "a", name: "Day 1", exercises: [L.ownEx("A", "compound")] }] }), "1 day · 1 exercise");
  assert.equal(L.programSummary(L.blankProgram()), "4 days · 0 exercises");
});

// ---------- import ----------
ok("importName: by week, else by date", () => {
  assert.equal(L.importName(2, "2026-10-31"), "Trainer plan, week 2");
  assert.equal(L.importName(null, "2026-10-31"), "Trainer plan, 31 Oct");
});
ok("planWarnings in plain words", () => {
  assert.match(L.planWarnings({ days: [] })[0], /could not find DAY 1/);
  const w = L.planWarnings({ days: [
    { id: "a", name: "Day 1", exercises: [{ id: "x", exId: null, name: "Row", sets: [t(null, 40)] }, { id: "y", exId: null, name: "Curl", sets: [t(10, null)] }] },
    { id: "b", name: "Day 2", exercises: [] },
  ] });
  assert.deepEqual(w, [
    "Day 2 has no exercises.",
    "I could not read the reps for: Row. You can fix them after saving.",
    "No weight given for: Curl. You can pick it in the gym.",
  ]);
});

// ---------- export ----------
function wk(id: string, programId: string | null, week: number, startedAt: string, done = true): W {
  return { id, data: { programId, dayId: "d1", dayName: "Day 1", week, date: startedAt.slice(0, 10), startedAt, at: startedAt, exercises: [
    { id: "e", exId: null, name: "Row", at: startedAt, sets: [{ id: "s", kg: 40, reps: 10, rir: 2, done, at: startedAt }] },
  ] } };
}
ok("weekList: weeks with a set done, per program, newest first", () => {
  const l = L.weekList([
    wk("a", "p1", 1, "2026-10-20T10:00:00Z"), wk("b", "p1", 1, "2026-10-22T10:00:00Z"),
    wk("c", "p1", 2, "2026-10-27T10:00:00Z"), wk("d", "p1", 3, "2026-10-29T10:00:00Z", false),
    wk("e", "p2", 1, "2026-10-30T10:00:00Z"),
  ]);
  assert.deepEqual(l.map((x) => [x.programId, x.week, x.days]), [["p2", 1, 1], ["p1", 2, 1], ["p1", 1, 2]]);
  assert.equal(l[2].last, "2026-10-22T10:00:00Z");
});
ok("csvName and rowKind", () => {
  assert.equal(L.csvName(2), "PS week 2.csv");
  assert.equal(L.rowKind(["DAY 1", "", "", ""]), "day");
  assert.equal(L.rowKind(["Exercise", "Sets and Reps", "Weight", "RIR"]), "head");
  assert.equal(L.rowKind(["", "", "", ""]), "gap");
  assert.equal(L.rowKind(["Row", "3 sets x 10", "40kg", "rir 2"]), "ex");
});

console.log(`\n${n} passed`);

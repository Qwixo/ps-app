// Run: node --experimental-strip-types tests/fitness-gym.test.ts
// PS Fitness, the gym screen's helpers (src/fitness/gym-logic.ts): which exercises show, the progress
// line, "Last 52.5 x 8 · RIR 2", stepper maths, typed numbers, the hint pills and the finish summary.
// FICTIONAL data.
import assert from "node:assert/strict";
const G = await import("../src/fitness/gym-logic.ts");
type FW = import("../src/core/fitness.ts").FitWorkout;
type FX = import("../src/core/fitness.ts").FitLogEx;
type W = { id: string; data: FW };

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const T0 = "2026-11-02T08:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();

const set = (id: string, kg: number | null, reps: number | null, rir: number | null, done = true, extra: object = {}) =>
  ({ id, kg, reps, rir, done, at: T0, ...extra });
const ex = (id: string, sets: ReturnType<typeof set>[], extra: Partial<FX> = {}): FX =>
  ({ id, exId: "lat-pulldown", name: "Lat pulldown", at: T0, sets, rir: 2, target: [{ reps: 10, kg: 50 }, { reps: 10, kg: 50 }, { reps: 10, kg: 50 }], ...extra });
const wk = (id: string, startedAt: string, exercises: FX[]): W =>
  ({ id, data: { programId: "p1", dayId: "d2", dayName: "Day 2", week: 1, date: startedAt.slice(0, 10), startedAt, at: startedAt, exercises } });

// ---------- what shows ----------
ok("removed exercises are left out, the rest keep their order", () => {
  const w = wk("w", T0, [ex("b", [], { order: 2 }), ex("a", [], { order: 0 }), ex("c", [], { order: 1, removed: true })]).data;
  assert.deepEqual(G.liveList(w).map((e) => e.id), ["a", "b"]);
});
ok("progress counts sets done out of sets on screen (gone sets and removed exercises left out)", () => {
  const w = wk("w", T0, [
    ex("a", [set("1", 50, 10, 2), set("2", 50, 10, null, false), set("3", 50, 10, null, false, { gone: true })]),
    ex("b", [set("4", 12, 12, 1)], { removed: true }),
  ]).data;
  assert.deepEqual(G.progress(w), { done: 1, total: 2 });
});
ok("firstOpen and exDone", () => {
  const e = ex("a", [set("1", 50, 10, 2), set("2", 50, 10, null, false)]);
  assert.equal(G.firstOpen(e), 1);
  assert.equal(G.exDone(e), false);
  e.sets[1].done = true;
  assert.equal(G.firstOpen(e), -1);
  assert.equal(G.exDone(e), true);
  assert.equal(G.exDone(ex("x", [])), false);   // no sets is not "done"
});

// ---------- last time ----------
ok("last line: the set at the same place, else the last one", () => {
  const last = { sets: [set("1", 50, 12, 3), set("2", 52.5, 8, 2)] };
  assert.equal(G.lastLine(last, 0), "Last 50 x 12 · RIR 3");
  assert.equal(G.lastLine(last, 1), "Last 52.5 x 8 · RIR 2");
  assert.equal(G.lastLine(last, 5), "Last 52.5 x 8 · RIR 2");
  assert.equal(G.lastLine({ sets: [set("1", 20, 10, null)] }, 0), "Last 20 x 10");
  assert.equal(G.lastLine(null, 0), "");
  assert.equal(G.lastLine({ sets: [] }, 0), "");
});

// ---------- steppers and typing ----------
ok("stepper: plate steps add up cleanly and never go below zero", () => {
  assert.equal(G.stepValue(50, 2.5), 52.5);
  assert.equal(G.stepValue(0.1 + 0.2, 0), 0.3);
  assert.equal(G.stepValue(1.25, -2.5), 0);
  assert.equal(G.stepValue(null, 2.5), 2.5);
  assert.equal(G.stepValue(10, -1), 9);
});
ok("typed numbers: comma or dot, reps whole, nonsense is null", () => {
  assert.equal(G.parseNum("52,5"), 52.5);
  assert.equal(G.parseNum(" 52.5 "), 52.5);
  assert.equal(G.parseNum("8.6", true), 9);
  assert.equal(G.parseNum(""), null);
  assert.equal(G.parseNum("abc"), null);
  assert.equal(G.parseNum("-5"), null);
});
ok("target text: plan and RIR", () => {
  assert.equal(G.targetText({ target: [{ reps: 12, kg: 50 }, { reps: 10, kg: 55 }, { reps: 10, kg: 55 }], rir: 2 }), "3 x 12, 10, 10 · RIR 2");
  assert.equal(G.targetText({ target: [], rir: null }), "");
  assert.equal(G.targetText({ target: [{ reps: 10, kg: null }], rir: 4 }), "1 x 10 · RIR 4+");
});

// ---------- hints ----------
const easy = (id: string, min: number) => wk(id, at(min), [ex(`${id}x`, [set(`${id}1`, 50, 10, 4), set(`${id}2`, 50, 10, 4), set(`${id}3`, 50, 10, 4)])]);
ok("before the first set: an easy last time says try more", () => {
  const today = wk("now", at(3000), [ex("t", [set("t1", 50, 10, null, false), set("t2", 50, 10, null, false)])]);
  const h = G.preHint(today.data.exercises[0], [easy("a", 0), today], "now", 2.5)!;
  assert.equal(h.kind, "up");
  assert.equal(h.kg, 52.5);
  assert.equal(h.text, "Felt easy last time. Try 52.5 kg");
});
ok("the pill goes once a set is done, or once the weight is already applied", () => {
  const today = wk("now", at(3000), [ex("t", [set("t1", 50, 10, 2), set("t2", 50, 10, null, false)])]);
  assert.equal(G.preHint(today.data.exercises[0], [easy("a", 0), today], "now", 2.5), null);
  const applied = wk("now", at(3000), [ex("t", [set("t1", 52.5, 10, null, false), set("t2", 52.5, 10, null, false)])]);
  assert.equal(G.preHint(applied.data.exercises[0], [easy("a", 0), applied], "now", 2.5), null);
});
ok("no pill for 'stay at this weight' or with no history", () => {
  const right = wk("a", at(0), [ex("ax", [set("a1", 50, 10, 2), set("a2", 50, 10, 2)])]);
  const today = wk("now", at(3000), [ex("t", [set("t1", 50, 10, null, false)])]);
  assert.equal(G.preHint(today.data.exercises[0], [right, today], "now", 2.5), null);
  assert.equal(G.preHint(today.data.exercises[0], [today], "now", 2.5), null);
});
ok("live hint: a very easy set offers more weight for the very next set", () => {
  const e = ex("t", [set("t1", 50, 10, 4), set("t2", 50, 10, null, false), set("t3", 50, 10, null, false)]);
  const h = G.liveHintFor(e)!;
  assert.deepEqual([h.setId, h.nextId, h.hint.kg], ["t1", "t2", 52.5]);
  e.sets[1].kg = 52.5;                       // applied
  assert.equal(G.liveHintFor(e), null);
  const hard = ex("t", [set("t1", 50, 10, 2), set("t2", 50, 10, null, false)]);
  assert.equal(G.liveHintFor(hard), null);
  const noRir = ex("t", [set("t1", 50, 10, null), set("t2", 50, 10, null, false)]);
  assert.equal(G.liveHintFor(noRir), null);
});
ok("live hint skips taken out sets", () => {
  const e = ex("t", [set("t1", 50, 10, 4), set("g", 50, 10, null, false, { gone: true }), set("t2", 50, 10, null, false)]);
  assert.equal(G.liveHintFor(e)!.nextId, "t2");
});

// ---------- finish ----------
ok("summary: sets, volume, new bests and minutes", () => {
  const before = wk("a", at(0), [ex("ax", [set("a1", 50, 10, 2)])]);
  const today = wk("now", at(3000), [ex("t", [set("t1", 55, 10, 2), set("t2", 50, 10, 2), set("t3", 50, 10, null, false)])]);
  const s = G.summary(today.data, "now", [before, today], Date.parse(at(3000 + 47)));
  assert.deepEqual(s, { sets: 2, volume: 1050, bests: 1, minutes: 47 });
});
ok("durations and volume read plainly", () => {
  assert.equal(G.fmtDur(47), "47 min");
  assert.equal(G.fmtDur(60), "1 h");
  assert.equal(G.fmtDur(65), "1 h 5 min");
  assert.equal(G.fmtVol(4320), "4,320");
  assert.equal(G.fmtVol(1234567.4), "1,234,567");
  assert.equal(G.fmtVol(950), "950");
});
ok("week dots: at least the goal, filled for days trained", () => {
  assert.deepEqual(G.weekDots(2, 4), [true, true, false, false]);
  assert.deepEqual(G.weekDots(5, 3), [true, true, true, true, true]);
  assert.deepEqual(G.weekDots(0, 0), [false]);
});

// ---------- on the fly (V1.25) ----------
const free = (exercises: FX[]): FW => ({ ...wk("f", T0, exercises).data, programId: null, dayId: null, dayName: "Free workout" });
ok("move: one place earlier or later, only the two that changed place get a new time, the ends stay put", () => {
  const w = free([ex("a", [], { order: 0 }), ex("b", [], { order: 1 }), ex("c", [], { order: 2 }), ex("x", [], { order: 3, removed: true })]);
  const m = G.moveEx(w, "c", -1, at(5));
  assert.deepEqual(G.liveList(m).map((e) => e.id), ["a", "c", "b"]);
  assert.deepEqual(m.exercises.filter((e) => e.at === at(5)).map((e) => e.id).sort(), ["b", "c"]);
  assert.equal(G.moveEx(w, "a", -1, at(5)), w);
  assert.equal(G.moveEx(w, "c", 1, at(5)), w);
});
ok("swap: the old one is taken out (kept for the merge), the new one takes its place", () => {
  const w = free([ex("a", [], { order: 0 }), ex("b", [], { order: 1 }), ex("c", [], { order: 2 })]);
  const s = G.swapEx(w, "b", ex("n", [set("9", null, null, null, false)], { exId: null, name: "Cable thing" }), at(3));
  assert.deepEqual(G.liveList(s).map((e) => e.id), ["a", "n", "c"]);
  assert.equal(s.exercises.find((e) => e.id === "b")?.removed, true);
});
ok("save as a plan: one day, each exercise with the sets ticked (else the ones on screen), warm ups and gone sets left out", () => {
  const w = free([
    ex("a", [set("1", 20, 12, 2, true, { warm: true }), set("2", 50, 10, 2), set("3", 52.5, 8, 1), set("4", 55, 6, null, false)], { order: 0 }),
    ex("b", [set("5", null, 15, null, false), set("6", 9, 9, null, false, { gone: true })], { order: 1, exId: null, name: "Rope thing" }),
    ex("c", [set("7", 40, 10, 2)], { order: 2, removed: true }),
  ]);
  const p = G.planFromWorkout(w, "  Tuesday arms ");
  assert.equal(p.name, "Tuesday arms");
  assert.equal(p.days.length, 1);
  assert.deepEqual(p.days[0].exercises.map((e) => [e.name, e.exId, e.sets]), [
    ["Lat pulldown", "lat-pulldown", [{ reps: 10, kg: 50 }, { reps: 8, kg: 52.5 }]],
    ["Rope thing", null, [{ reps: 15, kg: null }]],
  ]);
  assert.equal(G.planFromWorkout(w, " ").name, "My workout");
});
ok("your exercises: own names from the gym (newest first) and from plans, library names left out, a search needs every word", () => {
  const lib = new Set(["lat pulldown"]);
  const older = wk("o", at(-3000), [ex("a", [set("1", 10, 10, 2)], { exId: null, name: "Rope pull thing" })]);
  const newer = wk("n", at(-60), [ex("b", [set("2", 10, 10, 2)], { exId: null, name: "Cable twist thing" }), ex("c", [set("3", 50, 10, 2)])]);
  const untouched = wk("u", at(-30), [ex("d", [set("4", 10, 10, null, false)], { exId: null, name: "Never ticked" })]);
  const prog = { data: { name: "P", createdAt: T0, updatedAt: T0, days: [{ id: "d", name: "Day 1", exercises: [
    { id: "e1", exId: "pec-deck", name: "Fly (chest)", sets: [] }, { id: "e2", exId: null, name: "Rope pull thing", sets: [] }] }] } };
  const all = G.yourExercises([newer, untouched, older], [prog], "", lib);
  assert.deepEqual(all.map((x) => [x.name, x.uses, x.inPlan]), [["Cable twist thing", 1, false], ["Rope pull thing", 1, true], ["Fly (chest)", 0, true]]);
  assert.equal(all[2].exId, "pec-deck");
  assert.deepEqual(G.yourExercises([newer, older], [prog], "rope thing", lib).map((x) => x.name), ["Rope pull thing"]);
});

console.log(`\n${n} passed`);

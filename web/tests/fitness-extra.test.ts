// Run: node --experimental-strip-types tests/fitness-extra.test.ts
// PS Fitness V1.29, extra sets after the plan: "Add set" (same weight, normal rest) and "Drop set" (20 percent off,
// rounded to a plate step, no rest, tagged DROP), unlimited, counted in "x of N sets". Covers core/fitness.ts
// (dropKg, extraSet, lastTime, progressionHint, setLine), gym-logic.ts (extrasDue, extrasPreview, restOwed,
// progress, liveHintFor) and the week export. FICTIONAL data.
import assert from "node:assert/strict";
const F = await import("../src/core/fitness.ts");
const G = await import("../src/fitness/gym-logic.ts");
const S = await import("../src/fitness/sheet.ts");
type FW = import("../src/core/fitness.ts").FitWorkout;
type FX = import("../src/core/fitness.ts").FitLogEx;
type FS = import("../src/core/fitness.ts").FitSet;
type W = { id: string; data: FW };

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const T0 = "2026-11-02T08:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();

const set = (id: string, kg: number | null, reps: number | null, rir: number | null, done = true, extra: Partial<FS> = {}): FS =>
  ({ id, kg, reps, rir, done, at: T0, ...extra });
const ex = (id: string, sets: FS[], extra: Partial<FX> = {}): FX =>
  ({ id, exId: "lat-pulldown", name: "Lat pulldown", at: T0, sets, rir: 2, ...extra });
const wk = (id: string, startedAt: string, exercises: FX[]): W =>
  ({ id, data: { programId: "p1", dayId: "d2", dayName: "Day 2", week: 1, date: startedAt.slice(0, 10), startedAt, at: startedAt, exercises } });

// ---------- drop set weight ----------
ok("drop weight: 20 percent off, rounded to the nearest plate step", () => {
  assert.equal(F.dropKg(100, 2.5), 80);
  assert.equal(F.dropKg(52.5, 2.5), 42.5);      // 42 rounds to 42.5
  assert.equal(F.dropKg(60, 5), 50);            // a machine stack in 5 kg steps: 48 rounds to 50
  assert.equal(F.dropKg(12, 2), 10);            // dumbbells in 2 kg steps: 9.6 rounds to 10
  assert.equal(F.dropKg(70, 2.5), 55);          // 56 rounds to 55
});
ok("drop weight: always at least one step lighter, never below zero", () => {
  assert.equal(F.dropKg(4, 2), 2);              // 3.2 would round back to 4: one step down instead
  assert.equal(F.dropKg(5, 5), 0);
  assert.equal(F.dropKg(2.5, 2.5), 0);
  assert.equal(F.dropKg(1, 2.5), 0);
});
ok("drop weight: no weight, bodyweight and assisted stay as they are; a bad step falls back to 2.5", () => {
  assert.equal(F.dropKg(null, 2.5), null);
  assert.equal(F.dropKg(undefined, 2.5), null);
  assert.equal(F.dropKg(0, 2.5), 0);
  assert.equal(F.dropKg(-20, 2.5), -20);
  assert.equal(F.dropKg(100, 0), 80);
  assert.equal(F.dropKg(100, -1), 80);
});

// ---------- the extra set itself ----------
const three = () => ex("a", [set("1", 50, 10, 2), set("2", 50, 10, 1), set("3", 50, 8, 0)], { target: [{ reps: 10, kg: 50 }, { reps: 10, kg: 50 }, { reps: 10, kg: 50 }] });

ok("Add set copies the last set's kg and reps, not done, tagged extra (not drop)", () => {
  const w = wk("w", T0, [three()]).data;
  const out = F.extraSet(w, "a", "x1", false, 2.5, at(5));
  const s = out.exercises[0].sets[3];
  assert.deepEqual(s, { id: "x1", kg: 50, reps: 8, rir: null, done: false, at: at(5), extra: true });
  assert.equal(w.exercises[0].sets.length, 3, "the old workout is left alone");
});
ok("Drop set takes the weight down and is tagged drop", () => {
  const out = F.extraSet(wk("w", T0, [three()]).data, "a", "d1", true, 2.5, at(5));
  const s = out.exercises[0].sets[3];
  assert.equal(s.kg, 40);
  assert.equal(s.reps, 8);
  assert.equal(s.drop, true);
  assert.equal(s.extra, true);
});
ok("unlimited: drop after drop keeps going down, from the last set on screen", () => {
  let w = wk("w", T0, [three()]).data;
  w = F.extraSet(w, "a", "d1", true, 2.5, at(5));
  w.exercises[0].sets[3].done = true;
  w = F.extraSet(w, "a", "d2", true, 2.5, at(6));
  w.exercises[0].sets[4].done = true;
  w = F.extraSet(w, "a", "x3", false, 2.5, at(7));
  assert.deepEqual(w.exercises[0].sets.map((s) => s.kg), [50, 50, 50, 40, 32.5, 32.5]);
  assert.equal(w.exercises[0].sets.length, 6);
});
ok("a removed (gone) last set is skipped: the extra copies the last live one", () => {
  const e = ex("a", [set("1", 50, 10, 2), set("2", 60, 6, null, false, { gone: true })]);
  const out = F.extraSet(wk("w", T0, [e]).data, "a", "x", false, 2.5, at(1));
  assert.equal(out.exercises[0].sets[2].kg, 50);
});
ok("the same set id twice (a double tap, or the merge) adds it once", () => {
  let w = wk("w", T0, [three()]).data;
  w = F.extraSet(w, "a", "x1", false, 2.5, at(5));
  w = F.extraSet(w, "a", "x1", false, 2.5, at(5));
  assert.equal(w.exercises[0].sets.length, 4);
});
ok("only the asked exercise changes; an exercise with no sets gets an empty one", () => {
  const w = wk("w", T0, [three(), ex("b", [])]).data;
  const out = F.extraSet(w, "b", "x", true, 2.5, at(1));
  assert.equal(out.exercises[0], w.exercises[0]);
  assert.deepEqual(out.exercises[1].sets.map((s) => [s.kg, s.reps, s.drop]), [[null, null, true]]);
});

// ---------- counted in "x of N sets" ----------
ok("progress counts extra and drop sets in both numbers", () => {
  let w = wk("w", T0, [three(), ex("b", [set("4", 12, 12, null, false)])]).data;
  assert.deepEqual(G.progress(w), { done: 3, total: 4 });
  w = F.extraSet(w, "a", "x", false, 2.5, at(5));
  w = F.extraSet(w, "a", "d", true, 2.5, at(6));
  assert.deepEqual(G.progress(w), { done: 3, total: 6 });
  w.exercises[0].sets[3].done = true;
  assert.deepEqual(G.progress(w), { done: 4, total: 6 });
});

// ---------- when the pair shows, and its labels ----------
ok("Add set and Drop set show once every set of the exercise is done, and again after each extra", () => {
  const e = three();
  assert.equal(G.extrasDue(e), true);
  e.sets[2].done = false;
  assert.equal(G.extrasDue(e), false);
  e.sets[2].done = true;
  const w = F.extraSet(wk("w", T0, [e]).data, "a", "x", false, 2.5, at(1));
  assert.equal(G.extrasDue(w.exercises[0]), false, "hidden while the new set waits");
  w.exercises[0].sets[3].done = true;
  assert.equal(G.extrasDue(w.exercises[0]), true, "back for one more");
});
ok("labels: the last set's kg and reps, and the drop kg", () => {
  assert.deepEqual(G.extrasPreview(three(), 2.5), { kg: 50, dropKg: 40, reps: 8 });
  assert.deepEqual(G.extrasPreview(ex("a", []), 2.5), { kg: null, dropKg: null, reps: null });
});

// ---------- rest ----------
ok("Add set: the normal rest, counted from when the last set was done", () => {
  const now = Date.parse(at(1));
  assert.equal(G.restOwed(at(0), 120, now), 60);
  assert.equal(G.restOwed(at(0), 90, Date.parse(at(1.5))), 0, "rest already over");
  assert.equal(G.restOwed(at(0), 60, now - 2000 + 60_000 - 3000), 0, "under 5 s left is not worth a timer");
  assert.equal(G.restOwed(null, 120, now), 0);
  assert.equal(G.restOwed("not a date", 120, now), 0);
});
ok("the add weight pill never fires for a drop set (it is lighter on purpose)", () => {
  const e = ex("a", [set("1", 50, 10, 4), set("d", 40, 10, null, false, { drop: true, extra: true })]);
  assert.equal(G.liveHintFor(e), null);
});

// ---------- drop sets never steer next time ----------
ok("next time's prefill skips drop sets", () => {
  const e = ex("a", [set("1", 50, 10, 2), set("2", 50, 9, 1), set("d", 40, 8, 0, true, { drop: true, extra: true })]);
  const got = F.lastTime("id:lat-pulldown", [wk("w1", T0, [e])]);
  assert.ok(got);
  assert.deepEqual(got!.sets.map((s) => s.kg), [50, 50]);
});
ok("the progression hint ignores drop sets", () => {
  // Two sessions at RIR 4 with every rep done would say "add weight"; a drop set at RIR 0 must not change that.
  const s1 = ex("a", [set("1", 50, 10, 4), set("2", 50, 10, 4), set("d", 40, 6, 0, true, { drop: true })], { target: [{ reps: 10 }, { reps: 10 }] });
  const s2 = ex("a", [set("3", 50, 10, 4), set("4", 50, 10, 4), set("e", 40, 5, 0, true, { drop: true })], { target: [{ reps: 10 }, { reps: 10 }] });
  const ws = [wk("w1", at(0), [s1]), wk("w2", at(60 * 48), [s2])];
  const withDrops = F.progressionHint("id:lat-pulldown", ws, { targetRir: 2, targetReps: [10, 10], step: 2.5 });
  const without = F.progressionHint("id:lat-pulldown", [
    wk("w1", at(0), [ex("a", s1.sets.filter((s) => !s.drop))]), wk("w2", at(60 * 48), [ex("a", s2.sets.filter((s) => !s.drop))]),
  ], { targetRir: 2, targetReps: [10, 10], step: 2.5 });
  assert.deepEqual(withDrops, without);
  assert.ok(withDrops, "the hint still shows");
});
ok("set line says DROP", () => {
  assert.equal(F.setLine({ kg: 40, reps: 8, rir: 0, drop: true }), "40 kg x 8 · RIR 0 · DROP");
  assert.equal(F.setLine({ kg: 50, reps: 8, rir: null }), "50 kg x 8");
});

// ---------- the trainer's week export ----------
ok("week export names the drop sets for the trainer, and still reads back", () => {
  const rows = S.exportWeekRows({ days: [{ index: 1, title: "Pull", exercises: [
    { name: "Lat pulldown", sets: [{ kg: 50, reps: 10, rir: 2 }, { kg: 50, reps: 8, rir: 1 }, { kg: 40, reps: 8, rir: 0, drop: true }] },
  ] }] });
  const line = rows.find((r) => r[1] === "Lat pulldown");
  assert.ok(line);
  assert.equal(line![2], "3 sets x 10, 8, 8 (1 drop)");
  const back = S.importTrainerSheet(rows);
  const e = back.days[0].exercises[0];
  assert.equal(e.name, "Lat pulldown");
  assert.deepEqual(e.sets.map((s) => [s.reps, s.kg]), [[10, 50], [8, 50], [8, 40]]);
});

// ---------- two devices (the vault's offline merge) ----------
ok("merge: an extra set on the phone and a drop set on the Mac, made offline, both survive with their tags", () => {
  const start = wk("w", T0, [three()]).data;
  const phone = F.extraSet(start, "a", "p1", false, 2.5, at(5));
  const mac = F.extraSet(start, "a", "m1", true, 2.5, at(6));
  for (const m of [F.mergeWorkout(phone, mac), F.mergeWorkout(mac, phone)]) {
    const sets = m.exercises[0].sets;
    assert.deepEqual(sets.map((s) => s.id).sort(), ["1", "2", "3", "m1", "p1"]);
    assert.equal(sets.find((s) => s.id === "m1")!.drop, true);
    assert.equal(sets.find((s) => s.id === "p1")!.drop, undefined);
    assert.equal(G.progress(m).total, 5);
  }
});
ok("merge: a drop set ticked on one device and taken out on the other stays out", () => {
  let a = F.extraSet(wk("w", T0, [three()]).data, "a", "d", true, 2.5, at(5));
  const b = F.removeSet(a, "a", "d", at(7));
  a = F.patchSet(a, "a", "d", { done: true }, at(6));
  const m = F.mergeWorkout(a, b);
  assert.equal(m.exercises[0].sets.find((s) => s.id === "d")!.gone, true);
  assert.deepEqual(G.progress(m), { done: 3, total: 3 });
});

console.log(`\n${n} passed`);

// Run: node --experimental-strip-types tests/fitness.test.ts
// PS Fitness (src/core/fitness.ts): which day is next, prefill from history, rest defaults and the rest
// timer, RIR, the add weight hint, new bests, history numbers and the offline merge. FICTIONAL data.
import assert from "node:assert/strict";
const F = await import("../src/core/fitness.ts");
type W = { id: string; data: import("../src/core/fitness.ts").FitWorkout };

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const T0 = "2026-11-02T08:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60_000).toISOString();

const prog = { id: "p1", data: {
  name: "Fictional split", createdAt: T0, updatedAt: T0,
  days: [1, 2, 3, 4].map((i) => ({ id: `d${i}`, name: `Day ${i}`, exercises: [
    { id: `d${i}-a`, exId: "bench", name: "Bench press", kind: "compound" as const, sets: [{ reps: 12, kg: 40 }, { reps: 10, kg: 40 }, { reps: 10, kg: 40 }], rir: 2 },
    { id: `d${i}-b`, exId: null, name: "Cable curl", kind: "isolation" as const, sets: [{ reps: 12, kg: 15 }, { reps: 12, kg: 15 }] },
  ] })),
} };
function workout(id: string, dayId: string, week: number, startedAt: string, sets: [number, number, number | null][], ex = "bench", name = "Bench press"): W {
  return { id, data: { programId: "p1", dayId, dayName: dayId.replace("d", "Day "), week, date: startedAt.slice(0, 10), startedAt, at: startedAt, exercises: [
    { id: `${id}-x`, exId: ex, name, at: startedAt, sets: sets.map(([kg, reps, rir], i) => ({ id: `${id}-s${i}`, kg, reps, rir, done: true, at: startedAt })) },
  ] } };
}

// ---------- day rotation ----------
ok("no workouts yet: Week 1 · Day 1", () => {
  const d = F.nextDay(prog, [])!;
  assert.deepEqual([d.week, d.dayId, d.locked], [1, "d1", false]);
  assert.equal(F.dayLabel(d.week, prog.data.days[d.dayIndex].name), "Week 1 · Day 1");
});
ok("a new program from the trainer's week 2 sheet starts at Week 2 · Day 1", () => {
  const d = F.nextDay({ id: "p9", data: { ...prog.data, startWeek: 2 } }, [workout("w1", "d4", 1, at(0), [[40, 12, 2]])])!;
  assert.deepEqual([d.week, d.dayId], [2, "d1"]);
});
ok("after Day 1 comes Day 2 of the same week", () => {
  const d = F.nextDay(prog, [workout("w1", "d1", 1, at(0), [[40, 12, 2]])])!;
  assert.deepEqual([d.week, d.dayId], [1, "d2"]);
});
ok("after Day 4 comes Week 2 · Day 1", () => {
  const d = F.nextDay(prog, [workout("w1", "d3", 1, at(0), [[40, 12, 2]]), workout("w2", "d4", 1, at(60 * 24), [[40, 12, 2]])])!;
  assert.deepEqual([d.week, d.dayId], [2, "d1"]);
});
ok("a workout with nothing ticked does not move the day on", () => {
  const w = workout("w1", "d1", 1, at(0), [[40, 12, 2]]);
  w.data.exercises[0].sets[0].done = false;
  assert.equal(F.nextDay(prog, [w])!.dayId, "d1");
});
ok("an override (Day 3 done instead of Day 2) carries on from Day 3", () => {
  const d = F.nextDay(prog, [workout("w1", "d1", 1, at(0), [[40, 12, 2]]), workout("w2", "d3", 1, at(1440), [[40, 12, 2]])])!;
  assert.equal(d.dayId, "d4");
});
ok("a lock keeps the same day until it is unlocked", () => {
  const ws = [workout("w1", "d2", 1, at(0), [[40, 12, 2]])];
  const d = F.nextDay(prog, ws, { programId: "p1", dayId: "d2" })!;
  assert.deepEqual([d.dayId, d.locked, d.week], ["d2", true, 1]);
  assert.equal(F.nextDay(prog, ws, null)!.dayId, "d3");
  assert.equal(F.nextDay(prog, ws, { programId: "other", dayId: "d2" })!.dayId, "d3");   // a lock on another program does nothing
});
ok("workouts of another program never move this one", () => {
  const w = workout("w1", "d1", 1, at(0), [[40, 12, 2]]); w.data.programId = "p2";
  assert.equal(F.nextDay(prog, [w])!.dayId, "d1");
});

// ---------- prefill ----------
ok("first time: each set is the plan's target", () => {
  const s = F.prefillSets(prog.data.days[0].exercises[0], [], T0);
  assert.deepEqual(s.map((x) => [x.kg, x.reps, x.rir, x.done]), [[40, 12, null, false], [40, 10, null, false], [40, 10, null, false]]);
});
ok("after that: last time's weight and reps, set by set", () => {
  const ws = [workout("w1", "d1", 1, at(0), [[40, 12, 3], [42.5, 9, 1]]), workout("w0", "d1", 1, at(-5000), [[30, 5, 0]])];
  const s = F.prefillSets(prog.data.days[0].exercises[0], ws, T0);
  assert.deepEqual(s.map((x) => [x.kg, x.reps]), [[40, 12], [42.5, 9], [42.5, 9]]);   // the newest workout; the extra set repeats the last
});
ok("prefill follows the exercise across days and programs (by library id, else by name)", () => {
  const ws = [workout("w1", "d3", 1, at(0), [[20, 12, 2]], "cable-curl-lib", "Cable curl")];
  const byName = F.prefillSets({ exId: null, name: "cable  CURL", sets: [{ reps: 12, kg: 10 }] }, [workout("w2", "d3", 1, at(0), [[17.5, 11, 2]], null as unknown as string, "Cable curl")], T0);
  assert.equal(byName[0].kg, 17.5);
  assert.equal(F.prefillSets({ exId: "cable-curl-lib", name: "anything", sets: [{ reps: 12, kg: 10 }] }, ws, T0)[0].kg, 20);
});
ok("warm up sets and sets not done are not last time's numbers", () => {
  const w = workout("w1", "d1", 1, at(0), [[20, 10, 4], [40, 10, 2]]);
  w.data.exercises[0].sets[0].warm = true;
  w.data.exercises[0].sets.push({ id: "x", kg: 99, reps: 1, rir: null, done: false, at: T0 });
  assert.deepEqual(F.prefillSets({ exId: "bench", name: "Bench press", sets: [{ reps: 8, kg: 30 }] }, [w], T0).map((x) => x.kg), [40]);
});
ok("startWorkout copies the day with every set prefilled and nothing done", () => {
  const w = F.startWorkout(prog, prog.data.days[1], 1, [workout("w1", "d1", 1, at(0), [[45, 10, 2]])], new Date(T0), "2026-11-02");
  assert.equal(w.dayName, "Day 2");
  assert.equal(w.exercises.length, 2);
  assert.equal(w.exercises[0].sets[0].kg, 45);
  assert.equal(w.exercises[1].sets[0].kg, 15);
  assert.ok(w.exercises.every((e) => e.sets.every((s) => !s.done)));
  assert.deepEqual(F.currentSpot(w), { exIndex: 0, setIndex: 0 });
});

// ---------- rest ----------
ok("rest defaults: 2 min compound, 90 s isolation", () => {
  assert.equal(F.restFor({ name: "Squat", kind: "compound" }), 120);
  assert.equal(F.restFor({ name: "Curl", kind: "isolation" }), 90);
  assert.equal(F.restFor({ name: "Unknown" }), 120);
});
ok("rest: the plan's own rest, then the developer's own choice for that exercise, win", () => {
  assert.equal(F.restFor({ name: "Curl", kind: "isolation", rest: 60 }), 60);
  assert.equal(F.restFor({ exId: "curl", name: "Curl", kind: "isolation", rest: 60 }, { restBy: { "id:curl": 75 } }), 75);
  assert.equal(F.restFor({ name: "Squat", kind: "compound" }, { restCompound: 180 }), 180);
  assert.equal(F.restFor({ name: "Squat", rest: 5000 }), F.REST_MAX);
});
ok("rest timer: +15 and -15 move the end, a skip below 5 s ends it, the clock reads m:ss", () => {
  const now = Date.parse(T0);
  const r = F.restStart(120, now, "e", "s");
  assert.equal(F.restLeft(r, now), 120);
  const p = F.restNudge(r, 15, now)!;
  assert.equal(F.restLeft(p, now), 135);
  const m = F.restNudge(r, -15, now + 100_000)!;   // 20 s left, minus 15 -> 5 s
  assert.equal(F.restLeft(m, now + 100_000), 5);
  assert.equal(F.restNudge(r, -15, now + 110_000), null);
  assert.equal(F.restLeft(r, now + 200_000), 0);
  assert.equal(F.fmtClock(90), "1:30");
  assert.equal(F.fmtClock(5), "0:05");
});

// ---------- RIR ----------
ok("RIR: 0 to 4, where 4 means 4 or more", () => {
  assert.deepEqual([...F.RIR_VALUES], [0, 1, 2, 3, 4]);
  assert.equal(F.rirLabel(4), "4+");
  assert.equal(F.rirLabel(2), "2");
  assert.equal(F.rirLabel(null), "");
  assert.equal(F.clampRir("4+"), 4);
  assert.equal(F.clampRir(7), 4);
  assert.equal(F.clampRir(-1), 0);
  assert.equal(F.clampRir(""), null);
  for (const r of F.RIR_VALUES) assert.ok(F.RIR_WORDS[r]);
});
ok("ticking a set stamps it; its RIR is saved with it", () => {
  let w = F.startWorkout(prog, prog.data.days[0], 1, [], new Date(T0), "2026-11-02");
  const e = w.exercises[0], s = e.sets[0];
  w = F.patchSet(w, e.id, s.id, { done: true }, at(1));
  w = F.patchSet(w, e.id, s.id, { rir: 2 }, at(2));
  const got = w.exercises[0].sets[0];
  assert.deepEqual([got.done, got.rir, got.doneAt, got.at], [true, 2, at(1), at(2)]);
  assert.deepEqual(F.currentSpot(w), { exIndex: 0, setIndex: 1 });
  assert.equal(F.setLine(got), "40 kg x 12 · RIR 2");
  assert.equal(F.setLine({ kg: 20, reps: 12, rir: 4 }, true), "20 kg each x 12 · RIR 4+");
  assert.equal(F.targetLine(prog.data.days[0].exercises[0].sets), "3 x 12, 10, 10");
  assert.equal(F.targetLine([{ reps: 8, repsMax: 10, kg: 1 }, { reps: 8, repsMax: 10, kg: 1 }]), "2 x 8-10");
});
ok("add and take out sets: a taken out set stays in the record, gone", () => {
  let w = F.startWorkout(prog, prog.data.days[0], 1, [], new Date(T0), "2026-11-02");
  const e = w.exercises[0];
  w = F.addSet(w, e.id, at(1));
  assert.equal(F.liveSets(w.exercises[0]).length, 4);
  assert.equal(w.exercises[0].sets[3].kg, 40);
  w = F.removeSet(w, e.id, w.exercises[0].sets[3].id, at(2));
  assert.equal(w.exercises[0].sets.length, 4);
  assert.equal(F.liveSets(w.exercises[0]).length, 3);
});

// ---------- the add weight hint ----------
ok("hint: RIR 2 above the target with every rep done says add a jump", () => {
  const h = F.progressionHint("id:bench", [workout("w1", "d1", 1, at(0), [[40, 12, 4], [40, 10, 4], [40, 10, 4]])], { targetRir: 2, targetReps: [12, 10, 10] })!;
  assert.deepEqual([h.kind, h.kg], ["up", 42.5]);
  assert.match(h.text, /42\.5 kg/);
});
ok("hint: RIR 1 above the target two sessions running says add a jump; once is not enough", () => {
  const one = [workout("w1", "d1", 1, at(0), [[40, 12, 3], [40, 10, 3]])];
  assert.equal(F.progressionHint("id:bench", one, { targetRir: 2, targetReps: [12, 10] })!.kind, "hold");
  const two = [...one, workout("w0", "d1", 1, at(-3000), [[40, 12, 3], [40, 10, 3]])];
  assert.equal(F.progressionHint("id:bench", two, { targetRir: 2, targetReps: [12, 10] })!.kind, "up");
});
ok("hint: easy but reps missed is not a reason to add weight", () => {
  const h = F.progressionHint("id:bench", [workout("w1", "d1", 1, at(0), [[40, 8, 4], [40, 7, 4]])], { targetRir: 2, targetReps: [12, 10] })!;
  assert.equal(h.kind, "hold");
});
ok("hint: RIR 0 and reps well short says take a jump off", () => {
  const h = F.progressionHint("id:bench", [workout("w1", "d1", 1, at(0), [[50, 6, 0], [50, 5, 0]])], { targetRir: 2, targetReps: [10, 10] })!;
  assert.deepEqual([h.kind, h.kg], ["down", 47.5]);
});
ok("hint: dumbbells use their own jump; no history means no hint", () => {
  const h = F.progressionHint("id:bench", [workout("w1", "d1", 1, at(0), [[20, 12, 4]])], { targetRir: 2, step: 2 })!;
  assert.equal(h.kg, 22);
  assert.equal(F.progressionHint("id:none", []), null);
});
ok("live hint: a very easy set offers more weight for the next set, never after the last", () => {
  let w = F.startWorkout(prog, prog.data.days[0], 1, [], new Date(T0), "2026-11-02");
  const e = w.exercises[0];
  w = F.patchSet(w, e.id, e.sets[0].id, { done: true, rir: 4 }, at(1));
  assert.equal(F.liveHint(w.exercises[0], e.sets[0].id)!.kg, 42.5);
  w = F.patchSet(w, e.id, e.sets[2].id, { done: true, rir: 4 }, at(2));
  assert.equal(F.liveHint(w.exercises[0], e.sets[2].id), null);
  w = F.patchSet(w, e.id, e.sets[1].id, { done: true, rir: 2 }, at(3));
  assert.equal(F.liveHint(w.exercises[0], e.sets[1].id), null);
});

// ---------- bests ----------
ok("bests: heavier weight, then a better estimated max, then more reps at a weight", () => {
  const hist = [workout("w1", "d1", 1, at(0), [[40, 10, 2], [42.5, 6, 1]])];
  let w = F.startWorkout(prog, prog.data.days[0], 1, hist, new Date(at(3000)), "2026-11-04");
  const e = w.exercises[0];
  w = F.patchSet(w, e.id, e.sets[0].id, { kg: 45, reps: 3, done: true }, at(3001));   // heavier
  w = F.patchSet(w, e.id, e.sets[1].id, { kg: 40, reps: 12, done: true }, at(3002));  // 40 x 12 beats the e1rm of 45 x 3
  w = F.patchSet(w, e.id, e.sets[2].id, { kg: 40, reps: 11, done: true }, at(3003));  // not a best any more (12 at 40 today)
  const all = [...hist, { id: "today", data: w }];
  const b = F.bestsInWorkout(w.exercises[0], "today", all);
  assert.equal(b.get(e.sets[0].id), "kg");
  assert.equal(b.get(e.sets[1].id), "e1rm");
  assert.equal(b.has(e.sets[2].id), false);
});
ok("bests: the very first time is never a best (nothing to beat)", () => {
  let w = F.startWorkout(prog, prog.data.days[0], 1, [], new Date(T0), "2026-11-02");
  w = F.patchSet(w, w.exercises[0].id, w.exercises[0].sets[0].id, { done: true }, at(1));
  assert.equal(F.bestsInWorkout(w.exercises[0], "today", [{ id: "today", data: w }]).size, 0);
});

// ---------- history ----------
ok("progress per exercise: best kg, estimated max and volume per workout, oldest first", () => {
  const ws = [workout("w2", "d1", 1, at(3000), [[45, 8, 2], [45, 8, 2]]), workout("w1", "d1", 1, at(0), [[40, 10, 2]])];
  const p = F.exerciseProgress("id:bench", ws);
  assert.deepEqual(p.map((x) => [x.workoutId, x.bestKg, x.volume, x.sets]), [["w1", 40, 400, 1], ["w2", 45, 720, 2]]);
  assert.equal(Math.round(p[1].e1rm * 10) / 10, 57);
  assert.equal(F.exercisesLogged(ws)[0].name, "Bench press");
  assert.equal(F.workoutVolume(ws[0].data), 720);
  assert.equal(F.workoutSetsDone(ws[0].data), 2);
});
ok("days trained this week (Monday start), streak of weeks that met the goal, days in a row", () => {
  const d = (day: string) => workout(day, "d1", 1, `${day}T08:00:00.000Z`, [[40, 10, 2]]);
  // Fictional: 3 days in each of the two weeks before, 2 so far this week (Wed 2026-11-04 is today).
  const ws = ["2026-10-19", "2026-10-21", "2026-10-23", "2026-10-26", "2026-10-28", "2026-10-30", "2026-11-02", "2026-11-03"].map(d);
  const s = F.weekStats(ws, "2026-11-04", 3);
  assert.deepEqual(s.days, ["2026-11-02", "2026-11-03"]);
  assert.equal(s.count, 2);
  assert.equal(s.streakWeeks, 2);   // this week not met yet: the two before it
  assert.equal(s.dayStreak, 2);     // Mon and Tue, today not yet
  assert.equal(F.weekStats([...ws, d("2026-11-04")], "2026-11-04", 3).streakWeeks, 3);
  assert.equal(F.weekOf("2026-11-01"), "2026-10-26");   // a Sunday belongs to the week before
});

// ---------- offline merge ----------
ok("merge: a set ticked offline on the phone and a weight fixed on the Mac both survive", () => {
  const base = F.startWorkout(prog, prog.data.days[0], 1, [], new Date(T0), "2026-11-02");
  const e = base.exercises[0];
  const phone = F.patchSet(F.patchSet(base, e.id, e.sets[1].id, { done: true, rir: 1 }, at(10)), e.id, e.sets[2].id, { done: true, rir: 0 }, at(13));
  const mac = F.patchSet(base, e.id, e.sets[0].id, { kg: 37.5 }, at(11));
  for (const m of [F.mergeWorkout(phone, mac), F.mergeWorkout(mac, phone)]) {
    const s = m.exercises[0].sets;
    assert.deepEqual(s.map((x) => [x.kg, x.done, x.rir]), [[37.5, false, null], [40, true, 1], [40, true, 0]]);
  }
});
ok("merge: the same set changed on both sides keeps the newer change", () => {
  const base = F.startWorkout(prog, prog.data.days[0], 1, [], new Date(T0), "2026-11-02");
  const e = base.exercises[0], s = e.sets[0];
  const a = F.patchSet(base, e.id, s.id, { reps: 11 }, at(5));
  const b = F.patchSet(base, e.id, s.id, { reps: 9 }, at(6));
  assert.equal(F.mergeWorkout(a, b).exercises[0].sets[0].reps, 9);
  assert.equal(F.mergeWorkout(b, a).exercises[0].sets[0].reps, 9);
});
ok("merge: sets and exercises added on either side are all kept, in order; gone sets stay gone", () => {
  const base = F.startWorkout(prog, prog.data.days[0], 1, [], new Date(T0), "2026-11-02");
  const e = base.exercises[0];
  const a = F.addSet(base, e.id, at(3));
  const b = { ...F.removeSet(base, e.id, e.sets[2].id, at(4)), exercises: [...F.removeSet(base, e.id, e.sets[2].id, at(4)).exercises,
    { id: "extra", exId: null, name: "Fictional plank", at: at(4), order: 9, sets: [] }] };
  const m = F.mergeWorkout(a, b);
  assert.deepEqual(m.exercises.map((x) => x.id), [e.id, base.exercises[1].id, "extra"]);
  assert.equal(m.exercises[0].sets.length, 4);
  assert.equal(F.liveSets(m.exercises[0]).length, 3);
  assert.equal(m.exercises[0].sets[2].gone, true);
});
ok("merge: a finished workout stays finished; an exercise taken out stays out", () => {
  const base = F.startWorkout(prog, prog.data.days[0], 1, [], new Date(T0), "2026-11-02");
  const ended = { ...base, endedAt: at(60), at: at(60) };
  const other = { ...base, note: "fictional note", at: at(30), exercises: base.exercises.map((x, i) => (i === 1 ? { ...x, removed: true, at: at(30) } : x)) };
  const m = F.mergeWorkout(other, ended);
  assert.equal(m.endedAt, at(60));
  assert.equal(m.exercises[1].removed, true);
  assert.equal(F.mergeWorkout(ended, other).endedAt, at(60));
});
ok("merge: settings merge field by field, the newer change of each wins", () => {
  const a = F.stampPrefs({}, { style: "chalk" }, at(1));
  const b = F.stampPrefs(F.stampPrefs({}, { restCompound: 150 }, at(2)), { style: "pulse" }, at(0));
  const m = F.mergePrefs(a, b);
  assert.deepEqual([m.style, m.restCompound], ["chalk", 150]);
  assert.deepEqual([F.mergePrefs(b, a).style, F.mergePrefs(b, a).restCompound], ["chalk", 150]);
  const r = F.mergePrefs(F.stampPrefs({}, { restBy: { "id:a": 60 } }, at(1)), F.stampPrefs({}, { restBy: { "id:b": 75 } }, at(2)));
  assert.deepEqual(r.restBy, { "id:b": 75 });   // the newer whole list: a reset to {} on one device sticks
  assert.deepEqual(F.mergePrefs(F.stampPrefs({}, { restBy: { "id:a": 60 } }, at(1)), F.stampPrefs({}, { restBy: {} }, at(2))).restBy, {});
});
ok("merge: a program keeps the newer whole copy", () => {
  const a = { ...prog.data, name: "Old", updatedAt: at(1) }, b = { ...prog.data, name: "New", updatedAt: at(2) };
  assert.equal(F.mergeProgram(a, b).name, "New");
  assert.equal(F.mergeProgram(b, a).name, "New");
});

// ---------- small things ----------
ok("kg reads plainly and rounds to plate jumps", () => {
  assert.equal(F.fmtKg(22.5), "22.5");
  assert.equal(F.fmtKg(20), "20");
  assert.equal(F.fmtKg(null), "");
  assert.equal(F.roundKg(41.3), 42.5);
  assert.equal(F.roundKg(21.1, 2), 22);
  assert.equal(F.exKey({ exId: null, name: "  Lat Pull-Down " }), "n:lat pull down");
});

console.log(`\n${n} passed`);

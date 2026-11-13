// Run: node --experimental-strip-types tests/fitness-setup.test.ts
// PS Fitness "Set up your training" (src/fitness/setup-logic.ts, V1.47): the draft saved after every answer and resumed
// on any device, when setup opens by itself, and the rules that build the suggested program. FICTIONAL data.
import assert from "node:assert/strict";
const S = await import("../src/fitness/setup-logic.ts");
const F = await import("../src/core/fitness.ts");
const L = await import("../src/fitness/library.ts");
const N = await import("../src/fitness/nav-logic.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const t = (m: number) => `2026-11-10T10:${String(m).padStart(2, "0")}:00.000Z`;
const ids = (p: { days: { exercises: { exId: string | null }[] }[] }) => p.days.flatMap((d) => d.exercises.map((e) => e.exId));

// ---------- the draft: saved as you go, resumed exactly ----------
ok("every answer is kept in the draft with a new time, and moves nothing by itself", () => {
  let d = S.newDraft(t(0));
  assert.equal(d.step, "start");
  d = S.goNext(d, t(1));
  assert.equal(d.step, "goal");
  d = S.withAnswer(d, { goal: "muscle" }, t(2));
  assert.equal(d.a.goal, "muscle");
  assert.equal(d.step, "goal");
  assert.equal(d.at, t(2));
  assert.equal(d.startedAt, t(0));
});
ok("a draft survives storage (JSON) and comes back on the same step with the same answers and plan", () => {
  let d = S.newDraft(t(0));
  d = S.goStep(d, "days", t(1));
  d = S.withAnswer(d, { goal: "strength", days: 4, mins: 45, level: "some", gear: "gym", avoid: ["knees"] }, t(2));
  d = S.goStep(d, "plan", t(3));
  assert.ok(d.plan && d.plan.days.length === 4);
  const back = S.sanitizeDraft(JSON.parse(JSON.stringify(d)))!;
  assert.equal(back.step, "plan");
  assert.equal(back.at, d.at);
  assert.deepEqual(S.resolved(back.a), S.resolved(d.a));
  const shape = (x: typeof d) => x.plan!.days.map((dd) => [dd.id, dd.name, dd.title, dd.exercises.map((e) => [e.id, e.exId, e.name, e.rest, e.rir, e.sets.map((st) => [st.reps, st.repsMax])])]);
  assert.deepEqual(shape(back), shape(d));
  assert.equal(back.plan!.from, d.plan!.from);
  assert.deepEqual(S.sanitizeDraft(JSON.parse(JSON.stringify(back))), back, "stable from then on");
});
ok("a broken or foreign copy is never trusted", () => {
  assert.equal(S.sanitizeDraft(null), null);
  assert.equal(S.sanitizeDraft({ v: 2, at: t(0), startedAt: t(0) }), null);
  assert.equal(S.sanitizeDraft("x"), null);
  const d = S.sanitizeDraft({ v: 1, at: t(1), startedAt: t(0), step: "nope", a: { goal: "fly", days: 40, gear: "moon", avoid: ["knees", "x", "knees"] } });
  assert.ok(d);
  assert.equal(d!.step, "start");
  assert.equal(d!.a.goal, null);
  assert.equal(d!.a.days, 6);
  assert.equal(d!.a.gear, null);
  assert.deepEqual(d!.a.avoid, ["knees"]);
  const p = S.sanitizeDraft({ v: 1, at: t(1), startedAt: t(0), step: "plan", a: {}, plan: { name: "", days: [{ exercises: [{ name: "Leg press", exId: "leg-press", sets: [{ reps: 10 }] }, { name: "" }, { name: "Mystery", exId: "not-real" }] }] } });
  assert.equal(p!.plan!.name, "My program");
  assert.equal(p!.plan!.days[0].name, "Day 1");
  assert.equal(p!.plan!.days[0].exercises.length, 2);
  assert.equal(p!.plan!.days[0].exercises[1].exId, null, "an unknown library id becomes free text");
});
ok("Back goes one step, never past the start; a scratch plan goes back to the start", () => {
  let d = S.goStep(S.newDraft(t(0)), "gear", t(1));
  d = S.goBack(d, t(2))!;
  assert.equal(d.step, "level");
  assert.equal(S.goBack(S.newDraft(t(0)), t(1)), null);
  const s = S.scratchPlan(S.withAnswer(S.newDraft(t(0)), { days: 2 }, t(1)), t(2));
  assert.equal(s.step, "plan");
  assert.equal(s.plan!.days.length, 2);
  assert.ok(s.plan!.days.every((x) => x.exercises.length === 0));
  assert.equal(S.goBack(s, t(3))!.step, "start");
});
ok("Skip clears that answer (its default is used) and moves on; answering it later un-skips it", () => {
  let d = S.goStep(S.withAnswer(S.newDraft(t(0)), { days: 5 }, t(1)), "days", t(2));
  d = S.skipStep(d, t(3));
  assert.equal(d.step, "length");
  assert.equal(d.a.days, null);
  assert.deepEqual(d.skipped, ["days"]);
  assert.equal(S.resolved(d.a).days, 3);
  d = S.withAnswer(d, { days: 2 }, t(4));
  assert.deepEqual(d.skipped, []);
});
ok("skipping every question still gives a full, sensible plan", () => {
  let d = S.goNext(S.newDraft(t(0)), t(1));
  for (let i = 0; i < 6; i++) d = S.skipStep(d, t(2 + i));
  assert.equal(d.step, "plan");
  assert.equal(d.plan!.days.length, 3);
  assert.ok(d.plan!.days.every((x) => x.exercises.length >= 2));
});
ok("the progress bar counts the six questions", () => {
  assert.deepEqual(S.progressOf(S.newDraft(t(0))), { i: 0, n: 6 });
  assert.deepEqual(S.progressOf(S.goStep(S.newDraft(t(0)), "length", t(1))), { i: 3, n: 6 });
  assert.deepEqual(S.progressOf(S.goStep(S.newDraft(t(0)), "plan", t(1))), { i: 6, n: 6 });
});
ok("which copy to resume: the newer of this device's and the synced one", () => {
  const a = S.withAnswer(S.newDraft(t(0)), { goal: "fat" }, t(5));
  const b = S.withAnswer(S.newDraft(t(0)), { goal: "fit" }, t(7));
  assert.equal(S.pickDraft(a, b)!.a.goal, "fit");
  assert.equal(S.pickDraft(b, a)!.a.goal, "fit");
  assert.equal(S.pickDraft(a, null)!.a.goal, "fat", "the vault is not open yet: this device's copy");
  assert.equal(S.pickDraft(null, b)!.a.goal, "fit", "a new device: the synced copy");
});
ok("finished or put away on another device: this device's older copy is dropped, a newer one is kept", () => {
  const a = S.withAnswer(S.newDraft(t(0)), { goal: "fat" }, t(5));
  assert.equal(S.pickDraft(a, null, { clearedAt: t(6) }), null);
  assert.equal(S.pickDraft(a, null, { doneAt: t(6) }), null);
  assert.equal(S.pickDraft(a, null, { clearedAt: t(4) })!.a.goal, "fat", "an answer given after the clear is kept");
});
ok("the draft rides in the synced settings: two devices merge to the newer draft", () => {
  const a = S.withAnswer(S.newDraft(t(0)), { goal: "fat" }, t(5));
  const b = S.withAnswer(S.newDraft(t(0)), { goal: "muscle" }, t(7));
  const pa = F.stampPrefs({}, { setup: a }, t(5)), pb = F.stampPrefs({}, { setup: b }, t(7));
  assert.equal(F.mergePrefs(pa, pb).setup!.a.goal, "muscle");
  assert.equal(F.mergePrefs(pb, pa).setup!.a.goal, "muscle");
  const done = F.stampPrefs(pa, { setup: null, setupDone: t(9) }, t(9));
  const m = F.mergePrefs(pb, done);
  assert.equal(m.setup, null);
  assert.equal(m.setupDone, t(9));
});
ok("setup opens by itself only for someone brand new", () => {
  const base = { ready: true, programs: 0, workouts: 0 };
  assert.equal(S.autoOpen(base), true);
  assert.equal(S.autoOpen({ ...base, ready: false }), false);
  assert.equal(S.autoOpen({ ...base, programs: 1 }), false);
  assert.equal(S.autoOpen({ ...base, workouts: 2 }), false);
  assert.equal(S.autoOpen({ ...base, done: t(1) }), false);
  assert.equal(S.autoOpen({ ...base, later: true }), false);
  assert.equal(S.autoOpen({ ...base, test: true }), false);
  assert.equal(S.autoOpen({ ...base, asked: true }), false);
});

// ---------- the suggestion rules ----------
ok("every exercise the rules can pick is a real library exercise (so it has a picture)", () => {
  for (const [slot, list] of Object.entries(S.SLOTS)) for (const x of list) {
    const e = L.getExercise(x.id);
    assert.ok(e, `${slot}: ${x.id}`);
    assert.ok(!e!.timed, `${x.id} is timed`);
    assert.match(x.at, /^[gdhb]+$/);
    assert.match(x.load, /^[sewbhk]*$/);
  }
});
ok("days per week sets the split", () => {
  const titles = (a: object) => S.suggestPlan(a).days.map((d) => d.title);
  assert.deepEqual(titles({ days: 1 }), ["Full body"]);
  assert.deepEqual(titles({ days: 2 }), ["Full body A", "Full body B"]);
  assert.deepEqual(titles({ days: 3, level: "new" }), ["Full body A", "Full body B", "Full body C"]);
  assert.deepEqual(titles({ days: 3, level: "some", goal: "muscle" }), ["Push", "Pull", "Legs"]);
  assert.deepEqual(titles({ days: 4 }), ["Upper A", "Lower A", "Upper B", "Lower B"]);
  assert.deepEqual(titles({ days: 5 }), ["Upper", "Lower", "Push", "Pull", "Legs"]);
  assert.deepEqual(titles({ days: 6, level: "exp" }), ["Push A", "Pull A", "Legs A", "Push B", "Pull B", "Legs B"]);
  for (let k = 1; k <= 6; k++) {
    const p = S.suggestPlan({ days: k, level: "exp", mins: 90 });
    assert.equal(p.days.length, k);
    p.days.forEach((d, i) => { assert.equal(d.name, `Day ${i + 1}`); assert.ok(d.exercises.length >= 2, `${k} days, ${d.title}`); });
  }
});
ok("no exercise twice in one day, and Push B is not a copy of Push A", () => {
  for (const gear of ["gym", "dumbbells", "home", "bodyweight"] as const) for (let k = 1; k <= 6; k++) {
    for (const d of S.suggestPlan({ days: k, gear, mins: 90, level: "exp" }).days) {
      const xs = d.exercises.map((e) => e.exId);
      assert.equal(new Set(xs).size, xs.length, `${gear} ${k} ${d.title}`);
    }
  }
  const p = S.suggestPlan({ days: 6, level: "exp", mins: 90 });
  assert.notDeepEqual(p.days[0].exercises.map((e) => e.exId), p.days[3].exercises.map((e) => e.exId));
});
ok("the session length is respected: longer sessions get more exercises, every day fits its time", () => {
  for (const mins of S.MIN_CHOICES) {
    const p = S.suggestPlan({ days: 3, mins, level: "exp", goal: "muscle" });
    for (const d of p.days) if (d.exercises.length > 2) assert.ok(N.dayMinutes(d) <= mins, `${mins} min: ${N.dayMinutes(d)}`);
  }
  const count = (mins: number) => S.suggestPlan({ days: 4, mins, level: "exp" }).days.reduce((c, d) => c + d.exercises.length, 0);
  assert.ok(count(30) < count(60) && count(60) <= count(90));
});
ok("equipment: only exercises you can do where you train", () => {
  const gearOf = (id: string | null) => L.getExercise(id)!.equipment;
  const bw = S.suggestPlan({ days: 4, gear: "bodyweight", mins: 90, level: "exp" });
  for (const id of ids(bw)) assert.ok(["bodyweight", "dumbbell"].includes(gearOf(id)), `${id}`);
  // the dumbbell ones a bodyweight plan may use are the ones done without weights (split squats, lunges, step ups...)
  for (const id of ids(bw)) if (gearOf(id) === "dumbbell") assert.ok(Object.values(S.SLOTS).flat().some((x) => x.id === id && x.at.includes("b")), id);
  for (const id of ids(S.suggestPlan({ days: 4, gear: "dumbbells", mins: 90 }))) assert.ok(["dumbbell", "bodyweight"].includes(gearOf(id)), id);
  for (const id of ids(S.suggestPlan({ days: 4, gear: "home", mins: 90 }))) assert.ok(["dumbbell", "bodyweight", "kettlebell"].includes(gearOf(id)), id);
  const gym = ids(S.suggestPlan({ days: 3, gear: "gym", level: "new" }));
  assert.ok(gym.some((id) => ["machine", "cable"].includes(gearOf(id))), "a full gym uses machines and cables");
});
ok("areas to go easy on: exercises that load them hard are left out", () => {
  const knees = new Set(Object.values(S.SLOTS).flat().filter((x) => x.load.includes("k")).map((x) => x.id));
  const p = S.suggestPlan({ days: 4, avoid: ["knees"], mins: 90, level: "exp" });
  for (const id of ids(p)) assert.ok(!knees.has(id!), `${id} loads the knees`);
  assert.ok(p.days.every((d) => d.exercises.length >= 2), "lower days still get hip work instead");
  const sh = new Set(Object.values(S.SLOTS).flat().filter((x) => x.load.includes("s")).map((x) => x.id));
  for (const id of ids(S.suggestPlan({ days: 3, avoid: ["shoulders"], mins: 90 }))) assert.ok(!sh.has(id!), `${id} loads the shoulders`);
});
ok("new lifters get machines first and no heavy barbell lifts; experienced strength gets the barbell", () => {
  const heavy = new Set(Object.values(S.SLOTS).flat().filter((x) => x.x).map((x) => x.id));
  for (const id of ids(S.suggestPlan({ days: 4, level: "new", goal: "strength", mins: 90 }))) assert.ok(!heavy.has(id!), id!);
  const exp = ids(S.suggestPlan({ days: 4, level: "exp", goal: "strength", mins: 90 }));
  assert.ok(exp.includes("back-squat") && exp.includes("barbell-bench-press"));
});
ok("goal sets reps, rest and how hard: strength low reps long rest, fat loss high reps short rest", () => {
  const first = (a: object) => S.suggestPlan(a).days[0].exercises[0];
  const st = first({ goal: "strength", level: "some", days: 4 }), fat = first({ goal: "fat", level: "some", days: 4 }), mus = first({ goal: "muscle", level: "some", days: 4 });
  assert.equal(st.kind, "compound");
  assert.deepEqual([st.sets[0].reps, st.sets[0].repsMax], [4, 6]);
  assert.deepEqual([fat.sets[0].reps, fat.sets[0].repsMax], [10, 12]);
  assert.deepEqual([mus.sets[0].reps, mus.sets[0].repsMax], [8, 12]);
  assert.equal(st.rest, 180);
  assert.equal(fat.rest, 75);
  assert.equal(mus.rest, null, "muscle uses the usual long rest from Settings");
  assert.equal(S.dosage("muscle", "new", "compound").rir, 3);
  assert.equal(S.dosage("muscle", "exp", "compound").rir, 1);
  assert.equal(S.dosage("strength", "exp", "compound").rir, 2);
  assert.deepEqual([S.dosage("strength", "some", "compound", null, false).reps, S.dosage("strength", "some", "compound", null, false).repsMax], [6, 8], "only the first two lifts go heavy");
  // someone whose own long rest is already 3 min: no rest of its own for the squat
  assert.equal(S.dosage("strength", "some", "compound", { restCompound: 180 }).rest, 0);
});
ok("sets: 3 by default, a 4th on the first lift for experienced, 2 on small lifts for new", () => {
  assert.equal(S.setsAt(0, "compound", "exp"), 4);
  assert.equal(S.setsAt(1, "compound", "exp"), 3);
  assert.equal(S.setsAt(3, "isolation", "new"), 2);
  assert.equal(S.setsAt(0, "compound", "new"), 3);
});
ok("the plan is named after the goal, or the person's own words", () => {
  assert.equal(S.suggestPlan({ goal: "muscle" }).name, "Build muscle plan");
  assert.equal(S.suggestPlan({ goal: "custom", custom: "  Ski season  " }).name, "Ski season");
  assert.equal(S.suggestPlan({}).name, "Stay fit plan");
});
ok("the same answers always give the same exercises", () => {
  const a = { goal: "muscle" as const, days: 4, mins: 60, level: "some" as const, gear: "home" as const, avoid: ["wrists" as const] };
  assert.deepEqual(ids(S.suggestPlan(a)), ids(S.suggestPlan(a)));
});

// ---------- editing before saving ----------
ok("swap, add, remove, move, sets and rest edit the plan and mark it edited", () => {
  const a = { days: 3, level: "new" as const, gear: "gym" as const };
  let p = S.suggestPlan(a);
  const day = p.days[0], ex = day.exercises[0];
  const choices = S.swapChoices(ex, day, a);
  assert.ok(choices.length > 0 && !choices.some((x) => x.id === ex.exId));
  p = S.swapEx(p, day.id, ex.id, choices[0].id, a);
  assert.equal(p.days[0].exercises[0].exId, choices[0].id);
  assert.equal(p.days[0].exercises[0].id, ex.id, "keeps its place");
  assert.ok(p.edited);
  p = S.setSets(p, day.id, ex.id, 5);
  assert.equal(p.days[0].exercises[0].sets.length, 5);
  p = S.setSets(p, day.id, ex.id, 40);
  assert.equal(p.days[0].exercises[0].sets.length, 12);
  p = S.setRest(p, day.id, ex.id, 100);
  assert.equal(p.days[0].exercises[0].rest, 105);
  p = S.setRest(p, day.id, ex.id, null);
  assert.equal(p.days[0].exercises[0].rest, null);
  const n0 = p.days[0].exercises.length;
  p = S.addEx(p, day.id, "face-pull", a);
  assert.equal(p.days[0].exercises.length, n0 + 1);
  assert.equal(p.days[0].exercises[n0].name, "Face pull");
  p = S.moveEx(p, day.id, p.days[0].exercises[n0].id, -1);
  assert.equal(p.days[0].exercises[n0 - 1].name, "Face pull");
  p = S.removeEx(p, day.id, ex.id);
  assert.ok(!p.days[0].exercises.some((e) => e.id === ex.id));
  p = S.addDay(p);
  assert.equal(p.days[3].name, "Day 4");
  p = S.removeDay(p, p.days[0].id);
  assert.deepEqual(p.days.map((d) => d.name), ["Day 1", "Day 2", "Day 3"]);
});
ok("changed answers rebuild an untouched plan, but never replace one edited by hand", () => {
  let d = S.goStep(S.withAnswer(S.newDraft(t(0)), { days: 2 }, t(1)), "plan", t(2));
  assert.equal(d.plan!.days.length, 2);
  d = S.goStep(S.withAnswer(S.goStep(d, "days", t(3)), { days: 4 }, t(4)), "plan", t(5));
  assert.equal(d.plan!.days.length, 4, "untouched: rebuilt");
  d = { ...d, plan: S.removeEx(d.plan!, d.plan!.days[0].id, d.plan!.days[0].exercises[0].id) };
  d = S.goStep(S.withAnswer(S.goStep(d, "days", t(6)), { days: 2 }, t(7)), "plan", t(8));
  assert.equal(d.plan!.days.length, 4, "edited: kept");
  assert.ok(S.planStale(d));
  d = S.rebuild(d, t(9));
  assert.equal(d.plan!.days.length, 2);
  assert.ok(!S.planStale(d));
});
ok("the saved program keeps every edit and is a normal manual program", () => {
  const p = S.suggestPlan({ days: 2 });
  const prog = S.planToProgram({ ...p, name: "  " });
  assert.equal(prog.name, "My program");
  assert.equal(prog.source, "manual");
  assert.equal(prog.days.length, 2);
  assert.ok(F.nextDay({ id: "p", data: { ...prog, createdAt: t(0), updatedAt: t(0) } }, [], null));
  assert.equal(S.setsLine(p.days[0].exercises[0]), "3 x 10 to 12");
});
ok("no em or en dashes in any setup words", () => {
  const words = JSON.stringify([S.GOALS, S.LEVELS, S.GEARS, S.AREAS, S.suggestPlan({ days: 6 })]);
  assert.ok(!/[\u2013\u2014]/.test(words));
});

console.log(`\n${n} checks passed`);

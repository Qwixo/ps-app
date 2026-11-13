// The Fitness exercise library (src/fitness/library.ts): the data is sane and search forgives gym shorthand.
import assert from "node:assert/strict";
import { LIBRARY, MUSCLE_LABEL, REST, STEP, findExercise, getExercise, matchExercise, searchExercises, searchHits, stepFor, words } from "../src/fitness/library.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const find = (q: string) => findExercise(q)?.name ?? null;

ok("about 150 exercises, each id unique and a stable slug", () => {
  assert.ok(LIBRARY.length >= 140 && LIBRARY.length <= 170, `${LIBRARY.length}`);
  assert.equal(new Set(LIBRARY.map((e) => e.id)).size, LIBRARY.length);
  for (const e of LIBRARY) assert.match(e.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.equal(getExercise("barbell-bench-press")?.name, "Barbell bench press");
  assert.equal(getExercise("nope"), undefined);
});
ok("every exercise has muscles with a plain label, a rest and a step", () => {
  for (const e of LIBRARY) {
    assert.ok(e.muscles.length > 0, e.name);
    for (const m of e.muscles) assert.ok(MUSCLE_LABEL[m], `${e.name}: ${m}`);
    assert.ok([REST.heavy, REST.compound, REST.isolation].includes(e.restSec as 90), e.name);
    assert.ok(e.step > 0, e.name);
    assert.ok(e.cue && e.cue.length < 110, `${e.name}: cue`);
  }
});
ok("names, aliases and the whole library have no em or en dashes", () => {
  assert.ok(!/[\u2013\u2014]/.test(JSON.stringify(LIBRARY)));
});
ok("rest: 2 min compound, 90 s isolation, 3 min for the big barbell lifts", () => {
  assert.equal(getExercise("lat-pulldown")?.restSec, 120);
  assert.equal(getExercise("dumbbell-lateral-raise")?.restSec, 90);
  assert.equal(getExercise("back-squat")?.restSec, 180);
  assert.equal(getExercise("deadlift")?.restSec, 180);
});
ok("per side: dumbbells yes, one dumbbell held in both hands no, barbells no", () => {
  assert.equal(getExercise("standing-dumbbell-overhead-press")?.perSide, true);
  assert.equal(getExercise("goblet-squat")?.perSide, false);
  assert.equal(getExercise("dumbbell-pullover")?.perSide, false);
  assert.equal(getExercise("barbell-row")?.perSide, false);
});
ok("weight steps: barbell 2.5, dumbbell 2, machine stack 5, cable 2.5", () => {
  assert.equal(STEP.barbell, 2.5);
  assert.equal(stepFor(getExercise("barbell-bench-press")!), 2.5);
  assert.equal(stepFor(getExercise("dumbbell-curl")!), 2);
  assert.equal(stepFor(getExercise("leg-extension")!), 5);
  assert.equal(stepFor(getExercise("triceps-pushdown")!), 2.5);
  assert.equal(stepFor(getExercise("plate-front-raise")!), 5);
});
ok("bodyweight and timed flags", () => {
  assert.equal(getExercise("pull-up")?.bodyweight, true);
  assert.equal(getExercise("plank")?.timed, true);
  assert.equal(getExercise("plank")?.bodyweight, true);
  assert.equal(getExercise("leg-press")?.bodyweight, false);
});
ok("words: shorthand expanded, split words joined, plurals dropped", () => {
  assert.deepEqual(words("DB RDLs"), ["dumbbell", "romanian", "deadlift"]);
  assert.deepEqual(words("Lat pull-downs"), ["lat", "pulldown"]);
  assert.deepEqual(words("e.g. OHP"), ["overhead", "press"]);
  assert.deepEqual(words("Skull crushers"), ["skullcrusher"]);
});
ok("the trainer's example and its typos land on the right exercise", () => {
  assert.equal(find("Overhead dumbbell press"), "Standing dumbbell overhead press");
  assert.equal(find("e.g. Overhead dumbbell press"), "Standing dumbbell overhead press");
  assert.equal(find("overhead dumbell press"), "Standing dumbbell overhead press");
  assert.equal(find("Overhead dumbbel pres"), "Standing dumbbell overhead press");
});
ok("rough names a trainer writes", () => {
  const cases: [string, string][] = [
    ["Bench", "Barbell bench press"], ["bench press", "Barbell bench press"], ["Incline DB press", "Incline dumbbell press"],
    ["lat pull-downs", "Lat pulldown"], ["RDLs", "Romanian deadlift"], ["Skullcrushers", "Skull crusher"],
    ["OHP", "Overhead press"], ["cable flyes", "Cable fly"], ["seated row (wide grip)", "Seated cable row"],
    ["walking lunges w/ dbs", "Walking lunge"], ["calf raises", "Standing calf raise"], ["Bulgarian split squats", "Bulgarian split squat"],
    ["hip thrusts", "Hip thrust"], ["Pec dec", "Pec deck"], ["tricep rope pushdown", "Rope pushdown"],
    ["DB lateral raises", "Dumbbell lateral raise"], ["Chest press machine", "Machine chest press"], ["assisted pull-ups", "Assisted pull up"],
    ["face pulls", "Face pull"], ["Squats", "Back squat"], ["Hammer curls", "Hammer curl"], ["1 arm db row", "Dumbbell row"],
    ["T-bar row", "T bar row"], ["Hex bar deadlift", "Trap bar deadlift"], ["Leg curl", "Seated leg curl"],
    ["Lying hamstring curls", "Lying leg curl"], ["Press ups", "Push up"], ["Chin-ups", "Chin up"], ["Farmer's walk", "Farmers carry"],
  ];
  for (const [q, want] of cases) assert.equal(find(q), want, q);
});
ok("nothing close enough gives null, not a wild guess", () => {
  assert.equal(find("5 min bike warm up"), null);
  assert.equal(find("stretching"), null);
  assert.equal(find(""), null);
});
ok("matchExercise gives a score and next best options", () => {
  const m = matchExercise("leg curls")!;
  assert.ok(m.score > 0.9);
  assert.ok(m.alternatives.some((e) => e.id === "lying-leg-curl"));
});
ok("search as you type: a half word finds the exercise", () => {
  assert.equal(searchExercises("lat pu")[0].name, "Lat pulldown");
  assert.equal(searchExercises("bulg")[0].name, "Bulgarian split squat");
  assert.ok(searchExercises("curl", 20).every((e) => /curl/i.test(e.name + e.aliases.join(" "))));
  assert.equal(searchExercises("curl", 3).length, 3);
});
ok("search filters, and an empty query lists A to Z", () => {
  const all = searchExercises("", { limit: 500 });
  assert.equal(all.length, LIBRARY.length);
  assert.deepEqual(all.map((e) => e.name), [...all.map((e) => e.name)].sort((a, b) => a.localeCompare(b)));
  assert.ok(searchExercises("", { limit: 500, muscle: "calves" }).every((e) => e.muscles.includes("calves")));
  assert.ok(searchExercises("press", { limit: 50, equipment: "dumbbell" }).every((e) => e.equipment === "dumbbell"));
  assert.ok(searchHits("row").every((h, i, a) => i === 0 || a[i - 1].score >= h.score));
});

console.log(`\n${n} passed`);

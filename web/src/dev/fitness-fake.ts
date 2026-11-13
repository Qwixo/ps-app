// FICTIONAL Fitness data for the dev page, the self test and the phone emulator (never in a release
// build's data): a 4 day program and two weeks of logged workouts, so every screen has something to draw.
import type { Doc } from "../core/model";
import type { FitPlanEx, FitProgram, FitPrefs, FitWorkout } from "../core/fitness";
import { makeLog, spanFromClock } from "../core/sleep";
import { homeTz } from "../core/tz";

const ex = (id: string, exId: string | null, name: string, kind: "compound" | "isolation", sets: [number, number][], rir = 2, perSide = false, step = 2.5): FitPlanEx =>
  ({ id, exId, name, kind, perSide, step, rir, sets: sets.map(([reps, kg]) => ({ reps, kg })) });

export function fitnessFakeDocs(today: string): Doc[] {
  const at = new Date().toISOString();
  const day = (k: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
  const prog: FitProgram = {
    name: "Fictional 4 day split", createdAt: at, updatedAt: at, source: "sheet",
    days: [
      { id: "fd1", name: "Day 1", title: "Push", exercises: [
        ex("fd1a", "barbell-bench-press", "Barbell bench press", "compound", [[10, 50], [8, 52.5], [8, 52.5]]),
        ex("fd1b", "standing-dumbbell-overhead-press", "Standing dumbbell overhead press", "compound", [[12, 18], [10, 20], [10, 20]], 2, true, 2),
        ex("fd1c", "triceps-pushdown", "Triceps pushdown", "isolation", [[12, 25], [12, 25], [12, 25]], 1),
      ] },
      { id: "fd2", name: "Day 2", title: "Pull", exercises: [
        ex("fd2a", "lat-pulldown", "Lat pulldown", "compound", [[12, 50], [10, 55], [10, 55]]),
        ex("fd2b", "dumbbell-curl", "Dumbbell curl", "isolation", [[12, 12], [10, 12], [10, 12]], 1, true, 2),
      ] },
      { id: "fd3", name: "Day 3", title: "Legs", exercises: [
        ex("fd3a", "back-squat", "Back squat", "compound", [[8, 70], [8, 70], [6, 75]]),
      ] },
      { id: "fd4", name: "Day 4", title: "Upper", exercises: [
        ex("fd4a", "barbell-bench-press", "Barbell bench press", "compound", [[12, 45], [12, 45]]),
        ex("fd4b", "lat-pulldown", "Lat pulldown", "compound", [[12, 50], [12, 50]]),
      ] },
    ],
  };
  const out: Doc[] = [];
  const push = (id: string, kind: string, data: unknown) => out.push({ id, ws: null, kind: kind as Doc["kind"], author: "dev", updatedAt: at, data });
  push("fprog-fake", "fprog", prog);
  // Week 1 done (four days), week 2 Day 1 done: next up is Week 2 · Day 2.
  const log: [number, string, number, number[][]][] = [
    [-9, "fd1", 1, [[50, 10, 3], [52.5, 8, 2], [52.5, 8, 2]]],
    [-7, "fd2", 1, [[50, 12, 3], [55, 10, 2], [55, 10, 2]]],
    [-5, "fd3", 1, [[70, 8, 2], [70, 8, 1], [75, 6, 0]]],
    [-4, "fd4", 1, [[45, 12, 4], [45, 12, 4]]],
    [-2, "fd1", 2, [[52.5, 10, 3], [52.5, 9, 3], [55, 7, 1]]],
  ];
  log.forEach(([k, dayId, week, first], i) => {
    const d = prog.days.find((x) => x.id === dayId)!;
    const start = `${day(k)}T15:0${i}:00.000Z`;
    const w: FitWorkout = {
      programId: "fprog-fake", dayId, dayName: d.name, week, date: day(k), startedAt: start, endedAt: `${day(k)}T16:05:00.000Z`, at: start, device: "phone",
      exercises: d.exercises.map((e, j) => ({
        id: e.id, exId: e.exId, name: e.name, kind: e.kind, perSide: e.perSide, target: e.sets, rir: e.rir, step: e.step, at: start, order: j,
        sets: (j === 0 ? first : e.sets.map((s) => [s.kg ?? 0, s.reps ?? 0, 2])).map(([kg, reps, rir], n) => ({ id: `${dayId}-${k}-${j}-${n}`, kg, reps, rir, done: true, at: start, doneAt: start })),
      })),
    };
    push(`fwork-fake-${i}`, "fwork", w);
  });
  push("fit-fake", "fit", { style: "volt", programId: "fprog-fake", weekGoal: 4 } satisfies FitPrefs);
  // Sleep (V1.40): a day sleeper like the developer, nothing logged today yet (so the morning question shows), the last
  // 5 nights 7 h or more (a 5 night streak), one short night before that, and a late one that is not steady.
  const tz = homeTz();
  const nights: [number, string, string, number | null][] = [
    [-1, "07:10", "14:40", 4], [-2, "06:50", "14:30", 4], [-3, "07:30", "15:00", 3], [-4, "07:00", "14:20", 5], [-5, "08:15", "15:30", null],
    [-6, "09:30", "14:30", 2], [-7, "07:00", "14:50", 4], [-8, "07:20", "14:10", 3], [-9, "10:30", "17:30", 3], [-10, "07:00", "13:45", 2],
    [-11, "06:40", "14:40", 4], [-12, "07:10", "14:30", null],
  ];
  for (const [k, asleep, wake, rested] of nights) {
    const s = spanFromClock(day(k), asleep, wake, tz);
    const l = s && makeLog({ start: s.start, end: s.end, tz, rested }, new Date(s.end));
    if (l) push(`fsleep-fake${k}`, "fsleep", l);
  }
  // Other activities (V1.40): three runs, the last one the longest and the fastest yet.
  const runs: [number, number, number][] = [[-12, 5, 1680], [-6, 5.2, 1700], [-1, 6.1, 1890]];
  for (const [k, km, secs] of runs) push(`fact-fake${k}`, "fact", { kind: "run", date: day(k), km, secs, at, device: "phone" });
  return out;
}

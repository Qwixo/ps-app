// PS Fitness, the gym screen's small pure helpers (tests/fitness-gym.test.ts). The rules themselves live in
// core/fitness.ts; this only shapes them for the screen: which exercises show, the progress line, the
// "Last 52.5 x 8 · RIR 2" line, stepper maths, typed numbers, the hint pills and the finish summary.
// Imported with the .ts extension so node can run the tests straight from the source.
import {
  bestsInWorkout, dropKg, exKey, fmtKg, liveHint, liveSets, progressionHint, rirLabel, targetLine, uidF, workoutSetsDone, workoutVolume,
  type FitLogEx, type FitProgram, type FitSet, type FitTarget, type FitWorkout, type Hint,
} from "../core/fitness.ts";

type Dated = { id: string; data: FitWorkout };

/** The exercises on screen today, in their order (removed ones left out). */
export function liveList(w: FitWorkout): FitLogEx[] {
  return w.exercises.map((e, i) => ({ e, i })).filter((x) => !x.e.removed)
    .sort((a, b) => (a.e.order ?? a.i) - (b.e.order ?? b.i)).map((x) => x.e);
}
/** Sets done out of all sets on screen (warm ups count as sets here: they are ticked like any other). */
export function progress(w: FitWorkout): { done: number; total: number } {
  let done = 0, total = 0;
  for (const e of liveList(w)) for (const s of liveSets(e)) { total++; if (s.done) done++; }
  return { done, total };
}
/** Index (in liveSets) of the first set not done, or -1 when the exercise is complete. */
export const firstOpen = (e: FitLogEx) => liveSets(e).findIndex((s) => !s.done);
export const exDone = (e: FitLogEx) => liveSets(e).length > 0 && firstOpen(e) < 0;

/** "Last 52.5 x 8 · RIR 2": last time's set at the same place, else its last set. */
export function lastLine(last: { sets: FitSet[] } | null | undefined, i: number): string {
  if (!last?.sets.length) return "";
  const s = last.sets[Math.min(i, last.sets.length - 1)];
  const kg = s.kg != null ? fmtKg(s.kg) : "";
  const reps = s.reps != null ? String(s.reps) : "";
  const head = kg && reps ? `${kg} x ${reps}` : kg ? `${kg} kg` : reps ? `${reps} reps` : "";
  if (!head) return "";
  return `Last ${head}${s.rir != null ? ` · RIR ${rirLabel(s.rir)}` : ""}`;
}

/** One stepper press: never below `min`, rounded to 2 decimals (2.5 + 2.5 is 5, not 4.999). */
export function stepValue(cur: number | null | undefined, delta: number, min = 0): number {
  const base = cur ?? 0;
  return Math.max(min, Math.round((base + delta) * 100) / 100);
}
/** A typed number: "52,5" and "52.5" both work; reps are whole. Empty or nonsense gives null. */
export function parseNum(text: string, whole = false): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return whole ? Math.round(n) : Math.round(n * 100) / 100;
}

/** "3 x 12, 10, 10 · RIR 2" (only what the plan says). */
export function targetText(e: Pick<FitLogEx, "target" | "rir">): string {
  const t = targetLine(e.target);
  const r = e.rir != null ? `RIR ${rirLabel(e.rir)}` : "";
  return [t, r].filter(Boolean).join(" · ");
}

/** The pill before the first set: only when last time says go up (or down), never "stay". */
export function preHint(e: FitLogEx, workouts: Dated[], workoutId: string, step: number): Hint | null {
  if (liveSets(e).some((s) => s.done)) return null;
  const h = progressionHint(exKey(e), workouts, { targetRir: e.rir, targetReps: e.target?.map((t) => t.reps), step, except: workoutId });
  if (!h || h.kind === "hold" || h.kg == null) return null;
  const open = liveSets(e).filter((s) => !s.done);
  if (open.length && open.every((s) => s.kg === h.kg)) return null;   // already applied
  return { ...h, text: `${h.kind === "up" ? "Felt easy last time" : "Very hard last time"}. Try ${fmtKg(h.kg)} kg` };
}

/** After a set's RIR: the newest done set that says "go up", and the next open set it would change. */
export function liveHintFor(e: FitLogEx): { setId: string; nextId: string; hint: Hint } | null {
  const sets = liveSets(e);
  const i = sets.findIndex((s) => !s.done);
  if (i <= 0 || !sets[i - 1].done) return null;   // only the set right before the next one counts
  const prev = sets[i - 1], next = sets[i];
  if (next.drop) return null;   // a drop set is lighter on purpose
  const h = liveHint({ ...e, sets }, prev.id);
  if (!h || h.kg == null || (next.kg != null && next.kg >= h.kg)) return null;
  return { setId: prev.id, nextId: next.id, hint: h };
}

/** The Add set and Drop set pair shows once every set of the exercise is done (V1.29, unlimited). */
export const extrasDue = (e: FitLogEx) => exDone(e);
/** What the pair will add, for its labels: the last set's kg, and the drop set's kg. */
export function extrasPreview(e: FitLogEx, step: number): { kg: number | null; dropKg: number | null; reps: number | null } {
  const live = liveSets(e), last = live[live.length - 1];
  return { kg: last?.kg ?? null, dropKg: dropKg(last?.kg, step), reps: last?.reps ?? null };
}
/** Rest still owed after a set done at `doneAt` (seconds), for Add set: the normal rest, counted from that set. */
export function restOwed(doneAt: string | null | undefined, restSec: number, now: number): number {
  if (!doneAt) return 0;
  const left = Math.round(restSec - (now - Date.parse(doneAt)) / 1000);
  return Number.isFinite(left) && left >= 5 ? left : 0;
}

export interface Summary { sets: number; volume: number; bests: number; minutes: number }
/** The card after Finish. */
export function summary(w: FitWorkout, id: string, workouts: Dated[], now: number): Summary {
  let bests = 0;
  for (const e of liveList(w)) bests += bestsInWorkout(e, id, workouts).size;
  const minutes = Math.max(1, Math.round((now - Date.parse(w.startedAt)) / 60_000));
  return { sets: workoutSetsDone(w), volume: Math.round(workoutVolume(w)), bests, minutes };
}
/** "48 min", "1 h 5 min". */
export function fmtDur(min: number): string {
  const m = Math.max(0, Math.round(min));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}
/** "4,320": thousands with a comma. */
export function fmtVol(kg: number): string {
  return String(Math.round(kg)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
/** The week dots: filled for days trained, at least `goal` dots. */
export function weekDots(count: number, goal: number): boolean[] {
  return Array.from({ length: Math.max(goal, count, 1) }, (_, i) => i < count);
}

// ---------- on the fly (V1.25, the developer: "so I can do it on the fly as well") ----------
/** Every exercise on screen numbered again in its new order; only the ones whose place changed get a new `at`. */
function renumber(w: FitWorkout, order: FitLogEx[], at: string): FitWorkout {
  const place = new Map(order.map((e, i) => [e.id, i]));
  return { ...w, exercises: w.exercises.map((e) => {
    const i = place.get(e.id);
    return i == null || e.order === i ? e : { ...e, order: i, at };
  }) };
}
/** One exercise a place earlier (-1) or later (+1) in today's workout. */
export function moveEx(w: FitWorkout, exId: string, dir: -1 | 1, at: string): FitWorkout {
  const list = liveList(w);
  const i = list.findIndex((e) => e.id === exId), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return w;
  [list[i], list[j]] = [list[j], list[i]];
  return renumber(w, list, at);
}
/** Today only: `exId` is taken out and `ex` takes its place in the order. */
export function swapEx(w: FitWorkout, exId: string, ex: FitLogEx, at: string): FitWorkout {
  const list = liveList(w);
  const i = list.findIndex((e) => e.id === exId);
  if (i < 0) return w;
  const out = { ...w, exercises: [...w.exercises.map((e) => (e.id === exId ? { ...e, removed: true, at } : e)), ex] };
  return renumber(out, [...list.slice(0, i), ex, ...list.slice(i + 1)], at);
}
/** A finished free workout as a one day plan: each exercise with the sets the developer did (the ones he ticked,
 *  else every set on screen), so the plan starts where today ended. */
export function planFromWorkout(w: FitWorkout, name: string): Omit<FitProgram, "createdAt" | "updatedAt"> {
  const exercises = liveList(w).map((e) => {
    const live = liveSets(e).filter((s) => !s.warm);
    const done = live.filter((s) => s.done);
    const sets: FitTarget[] = (done.length ? done : live).map((s) => ({ reps: s.reps, kg: s.kg }));
    return { id: uidF(), exId: e.exId, name: e.name, kind: e.kind, perSide: e.perSide, rest: e.rest ?? null, step: e.step ?? null, rir: e.rir ?? null, sets };
  });
  return { name: name.trim() || "My workout", days: [{ id: uidF(), name: "Day 1", title: null, exercises }], source: "manual" };
}
export interface YourEx { name: string; exId: string | null; uses: number; inPlan: boolean }
/** The developer's own exercise names (typed as he likes, or from his plans) for the Add list, newest first. Names
 *  that are just a library name are left to the library list. A search keeps the ones with every word. */
export function yourExercises(workouts: Dated[], programs: { data: FitProgram }[], q: string, libNames: ReadonlySet<string>, limit = 8): YourEx[] {
  const by = new Map<string, YourEx>();
  const note = (name: string, exId: string | null, use: boolean, inPlan: boolean) => {
    const k = name.trim().toLowerCase();
    if (!k || libNames.has(k)) return;
    const cur = by.get(k) ?? { name: name.trim(), exId, uses: 0, inPlan: false };
    if (use) cur.uses++;
    if (inPlan) cur.inPlan = true;
    if (!cur.exId && exId) cur.exId = exId;
    by.set(k, cur);
  };
  for (const w of workouts) for (const e of w.data.exercises) if (!e.removed && e.sets.some((s) => s.done && !s.gone)) note(e.name, e.exId, true, false);
  for (const p of programs) if (!p.data.archived) for (const d of p.data.days) for (const e of d.exercises) note(e.name, e.exId, false, true);
  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return [...by.values()].filter((x) => words.every((wd) => x.name.toLowerCase().includes(wd))).slice(0, limit);
}

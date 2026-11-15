// PS Fitness (the developer, 31 Oct 2026: "a new fitness tab in the PS app ... log my workouts ... track the sets,
// track what weight I'm doing ... a timer between sets ... asked me if it was hard or not"). NOT a calorie
// tracker (he uses MyFitnessPal for that). Mainly the phone in the gym, readable on the Mac too.
//
// Everything here is pure (no React, no vault), so the rules are unit tested (tests/fitness.test.ts):
// which day is next, what each set is prefilled with, rest defaults, RIR, the "add weight" hint, new
// bests, history numbers and the offline merge of two devices' copies of one workout.
//
// Records (all owner private, AES-256-GCM under the vault key like the rest of PS):
//   "fprog"  one per program (a week of days, each with exercises and targets)
//   "fwork"  one per workout (a day done in the gym: every set with its kg, reps and RIR)
//   "fit"    one record of Fitness settings (style, active program, day lock, rest choices)
// Weights are kg. RIR (reps in reserve) is asked after EVERY set: 0, 1, 2, 3 or 4 (shown "4+").

import type { SetupDraft } from "../fitness/setup-logic.ts";

// ---------- shapes ----------
export type FitKind = "compound" | "isolation";
export type FitStyle = "volt" | "chalk" | "pulse";
/** A per exercise rest pick (V1.40): the short rest (restIsolation) or the long rest (restCompound). */
export type RestPick = "short" | "long";

/** One planned set: target reps (a range when repsMax is set) and target kg. */
export interface FitTarget { reps: number | null; repsMax?: number | null; kg: number | null }

/** An exercise in a program day. */
export interface FitPlanEx {
  id: string;                 // stable within the program; a workout's exercise keeps it (planId)
  exId: string | null;        // the exercise library id (src/fitness/library.ts), null for a free text one
  name: string;
  kind?: FitKind;             // compound lifts rest 2 min, isolation 90 s (unless rest is set)
  perSide?: boolean;          // dumbbells: "20 kg each side"
  sets: FitTarget[];          // one per set, so "3 sets x 12, 10, 10" keeps its per set reps
  rir?: number | null;        // the target RIR the trainer asked for
  rest?: number | null;       // seconds, this exercise only
  step?: number | null;       // the usual weight jump in kg (from the library), for the add weight hint
  note?: string | null;
}
export interface FitDay { id: string; name: string /* "Day 1" */; title?: string | null /* "Push" */; exercises: FitPlanEx[] }
export interface FitProgram {
  name: string;
  days: FitDay[];
  createdAt: string;
  updatedAt: string;
  source?: "manual" | "sheet";
  archived?: boolean;
  startWeek?: number;         // the week its first workout counts as (the trainer's week 2 plan starts at Week 2)
}

/** One logged set. `at` is when it last changed: the offline merge keeps the newer copy of each set. */
export interface FitSet {
  id: string;
  kg: number | null;
  reps: number | null;
  rir: number | null;         // null until the developer answers; 4 means "4 or more"
  done: boolean;
  at: string;
  doneAt?: string | null;
  warm?: boolean;             // a warm up set: never a best, never in volume
  extra?: boolean;            // added after the planned sets with Add set or Drop set (V1.29)
  drop?: boolean;             // a drop set (V1.29): about 20 percent lighter straight after a set, no rest before it, tagged DROP
  gone?: boolean;             // taken out (kept, so a merge with the other device's copy never brings it back)
  comment?: string;           // V1.59: the developer's short note on a done set ("left knee felt off", "seat at 4"). Sealed with the workout like every other field.
}
export interface FitLogEx {
  id: string;                 // the plan row id when it came from the program, else a new id
  exId: string | null;
  name: string;
  kind?: FitKind;
  perSide?: boolean;
  target?: FitTarget[];
  rir?: number | null;        // target RIR
  rest?: number | null;
  step?: number | null;
  sets: FitSet[];
  at: string;                 // when this exercise's own fields (not its sets) last changed
  removed?: boolean;          // taken out of this workout (kept so a merge never brings it back)
  order?: number;
  note?: string | null;       // the plan's note for this exercise ("seat on 4"), shown under its name
}
export interface FitWorkout {
  programId: string | null;
  dayId: string | null;
  dayName: string;            // "Day 2" (or "Free workout")
  week: number;               // "Week 1 · Day 2"
  date: string;               // YYYY-MM-DD, the developer's own day
  startedAt: string;
  endedAt?: string | null;
  exercises: FitLogEx[];
  note?: string | null;
  at: string;                 // when the header (end, note, day) last changed
  device?: "phone" | "mac" | "web";
  /** PS 1.60: when "Workout complete" was shown on a Mac (core/workoutsummary.ts). Synced with the workout, so no other Mac shows it again. */
  macShown?: string | null;
}
export interface FitLock { programId: string; dayId: string; week?: number | null }
/** Sleep mode's open sleep (core/sleepmode.ts has the rules). V1.43: `paused` is a Wake up waiting for "I'm up" or
 *  "Back to sleep in"; `brk` is a break running now; `breaks` are the ones already over (left out of time asleep). */
export interface OpenSleep {
  at: string; tz: string; woke?: string | null;
  paused?: string | null;
  brk?: { from: string; until: string; dev: "mac" | "phone" | "web" } | null;
  breaks?: { start: string; end: string }[] | null;
  timer?: { at: string; mins: number; style: "chime" | "sunrise" | "alert" | "wave" | "white" | "strobe" | "light" | "loud" } | null;   // V1.43 "Wake me up in"
}
export interface FitPrefs {
  style?: FitStyle;
  programId?: string | null;              // the active program
  lock?: FitLock | null;                  // "always this day" until the developer unlocks it
  restCompound?: number;                  // seconds, default 120
  restIsolation?: number;                 // seconds, default 90
  restBy?: Record<string, number>;        // per exercise (exercise key), set from the rest timer's +15 / -15
  restKind?: Record<string, RestPick>;    // per exercise (exercise key): always the short or the long rest (V1.40)
  setsDefault?: number;                   // sets for an exercise with no planned number (V1.40), 1 to 12, default 3
  setsBy?: Record<string, number>;        // per exercise (exercise key): your own number of sets, before the plan's (V1.40)
  sound?: boolean;                        // Mac: chime when the rest ends
  startLast?: boolean;                    // V1.60: a new set starts at the last weight and reps of that exercise (default on)
  scan?: boolean;                         // Gym scan (V1.59, src/fitness/Scan.tsx): the Scan button in a workout, default on
  island?: boolean;                       // V1.60: the phone's island shows Scanning, Found, Workout added, rest and progress hints (default on)
  islandSound?: boolean;                  // V1.60: each island moment has its own sound (default on)
  weekGoal?: number;                      // days a week, for "3 of 4 this week"
  // Sleep (V1.40, core/sleep.ts)
  sleepTarget?: number;                   // minutes, 7 to 9 h (default 7 h)
  sleepAsk?: boolean;                     // the once a day "How did you sleep?" card in Fitness (default on)
  sleepSkip?: string | null;              // the date "Not today" was pressed
  sleepShare?: boolean;                   // false: the sleep summary is never handed to a G Squad board
  sleepOpen?: OpenSleep | null;   // Sleep mode's "went to sleep" (and "woke up", waiting for the yes to log it; V1.43 breaks)
  // Set up your training (V1.47, src/fitness/setup-logic.ts): the unfinished setup, saved after every answer so it resumes on
  // any device, and when it was finished or put away (it never opens by itself again after that).
  setup?: SetupDraft | null;
  setupDone?: string | null;
  at?: Record<string, string>;            // field -> when it last changed (for the merge)
}

// ---------- small helpers ----------
export const RIR_VALUES = [0, 1, 2, 3, 4] as const;
export const rirLabel = (r: number | null | undefined) => (r == null ? "" : r >= 4 ? "4+" : String(r));
/** What each RIR answer means, in plain words (the developer is new to this). */
export const RIR_WORDS: Record<number, string> = {
  0: "Could not do one more", 1: "One more, just", 2: "Two more left", 3: "Three more left", 4: "Easy, 4 or more left",
};
export function clampRir(r: unknown): number | null {
  const n = typeof r === "number" ? r : typeof r === "string" && r.trim() ? Number(r.replace("+", "")) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(4, Math.round(n))) : null;
}
/** One normalised key per exercise, so history follows it across programs: the library id, else the name. */
export function exKey(e: { exId?: string | null; name: string }): string {
  return e.exId ? `id:${e.exId}` : `n:${e.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}
/** kg as the developer reads it: "20", "22.5", never "22.50". */
export function fmtKg(kg: number | null | undefined) {
  if (kg == null || !Number.isFinite(kg)) return "";
  return String(Math.round(kg * 100) / 100);
}
/** Round to the nearest plate jump (2.5 kg by default), never below zero. */
export function roundKg(kg: number, step = 2.5) {
  const s = step > 0 ? step : 2.5;
  return Math.max(0, Math.round(kg / s) * s);
}
export const uidF = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).replace(/-/g, "").slice(0, 16);

// ---------- rest timer defaults ----------
export const REST_COMPOUND = 120;
export const REST_ISOLATION = 90;
// V1.47 (the developer: "make it so I can select whatever time I want, not just up or down by 15 s"): any time from 5 s to 15 min,
// to the second (before V1.47: 15 s to 10 min in steps of 5 s).
export const REST_MIN = 5, REST_MAX = 900, REST_STEP = 15;
/** The long rest (big lifts) and the short rest (small lifts), as set in Fitness settings. */
export const restLong = (prefs?: FitPrefs | null) => clampRest(prefs?.restCompound ?? REST_COMPOUND);
export const restShort = (prefs?: FitPrefs | null) => clampRest(prefs?.restIsolation ?? REST_ISOLATION);
/** Rest for this exercise: the developer's own time for it, then his short or long pick for it (V1.40), then the plan's,
 *  then the long rest for a big lift and the short rest for a small one. */
export function restFor(ex: { exId?: string | null; name: string; kind?: FitKind; rest?: number | null }, prefs?: FitPrefs | null): number {
  const key = exKey(ex);
  const own = prefs?.restBy?.[key];
  if (own) return clampRest(own);
  const pick = prefs?.restKind?.[key];
  if (pick === "long") return restLong(prefs);
  if (pick === "short") return restShort(prefs);
  if (ex.rest) return clampRest(ex.rest);
  return (ex.kind ?? "compound") === "isolation" ? restShort(prefs) : restLong(prefs);
}
/** The rest the exercise would have with no choice of the developer's own for it (for "Reset to"). */
export const restDefault = (ex: { exId?: string | null; name: string; kind?: FitKind; rest?: number | null }, prefs?: FitPrefs | null) =>
  restFor(ex, { ...prefs, restBy: undefined, restKind: undefined });
/** Exercises with a rest of their own (a time or a short / long pick). */
export const ownRestCount = (prefs?: FitPrefs | null) => new Set([...Object.keys(prefs?.restBy ?? {}), ...Object.keys(prefs?.restKind ?? {})]).size;

// ---------- how many sets (V1.40, the developer: "2, 3, 5, anything", as a default and per exercise) ----------
export const SETS_DEF = 3, SETS_LO = 1, SETS_HI = 12;
export const clampSets = (n: number) => Math.max(SETS_LO, Math.min(SETS_HI, Math.round(Number.isFinite(n) ? n : SETS_DEF)));
export const setsDefault = (prefs?: FitPrefs | null) => clampSets(prefs?.setsDefault ?? SETS_DEF);
/** Sets for this exercise: the developer's own number for it, then the plan's, then his default. A day he stopped early
 *  never changes it (that is today only). */
export function setsFor(ex: { exId?: string | null; name: string }, planned: number | null | undefined, prefs?: FitPrefs | null): number {
  const own = prefs?.setsBy?.[exKey(ex)];
  if (own) return clampSets(own);
  if (planned && planned > 0) return clampSets(planned);
  return setsDefault(prefs);
}
export function clampRest(s: number) { return Math.max(REST_MIN, Math.min(REST_MAX, Math.round(Number.isFinite(s) ? s : REST_MIN))); }
/** A rest time typed by hand (V1.47), in seconds, or null if it cannot be read: "1:45", "105", "105 s", "2m",
 *  "2 min", "1m30", "1 min 30 s", "1.5 min". A bare number is seconds. Kept to 5 s to 15 min. */
export function parseRest(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, ".").replace(/\s+/g, " ");
  if (!t) return null;
  let secs: number | null = null, m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{1,3}):([0-5]?\d)$/))) secs = +m[1] * 60 + +m[2];
  else if ((m = t.match(/^(\d+(?:\.\d+)?) ?(?:s|sec|secs|second|seconds)?$/))) secs = +m[1];
  else if ((m = t.match(/^(\d+(?:\.\d+)?) ?(?:m|min|mins|minute|minutes)$/))) secs = +m[1] * 60;
  else if ((m = t.match(/^(\d+) ?(?:m|min|mins|minutes?) ?(\d{1,2}) ?(?:s|sec|secs|seconds?)?$/))) secs = +m[1] * 60 + +m[2];
  if (secs == null || !Number.isFinite(secs) || secs <= 0) return null;
  return clampRest(secs);
}

// ---------- the rest timer itself (absolute times, so a reload or a paused WebView never drifts) ----------
export interface RestState { endsAt: number; total: number; exId: string; setId: string }
export function restStart(total: number, now: number, exId: string, setId: string): RestState { return { endsAt: now + total * 1000, total, exId, setId }; }
/** +15 s / -15 s: moves the end, never into the past (less than 5 s left ends it). */
export function restNudge(r: RestState, secs: number, now: number): RestState | null {
  const endsAt = r.endsAt + secs * 1000;
  if (endsAt - now < 5000) return null;
  return { ...r, endsAt, total: Math.max(r.total + secs, Math.ceil((endsAt - now) / 1000)) };
}
export function restLeft(r: RestState | null, now: number) { return r ? Math.max(0, Math.ceil((r.endsAt - now) / 1000)) : 0; }
export function fmtClock(secs: number) { const s = Math.max(0, Math.round(secs)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

// ---------- which day is next ----------
export interface NextDay { programId: string; dayId: string; dayIndex: number; week: number; locked: boolean }
type Dated = { id: string; data: FitWorkout };
/** Workouts of one program that count (at least one set done), newest first. */
function doneIn(workouts: Dated[], programId: string) {
  return workouts.filter((w) => w.data.programId === programId && w.data.exercises.some((e) => !e.removed && e.sets.some((s) => s.done)))
    .sort((a, b) => b.data.startedAt.localeCompare(a.data.startedAt));
}
/** "Week 1 · Day 2": the day after the last one done (Day 4 goes on to Week 2 · Day 1), or the locked day. */
export function nextDay(program: { id: string; data: FitProgram }, workouts: Dated[], lock?: FitLock | null): NextDay | null {
  const days = program.data.days;
  if (!days.length) return null;
  const done = doneIn(workouts, program.id);
  const last = done[0]?.data;
  const lastIdx = last ? days.findIndex((d) => d.id === last.dayId) : -1;
  let week = last ? Math.max(1, last.week || 1) : Math.max(1, program.data.startWeek ?? 1), idx = 0;
  if (last && lastIdx >= 0) {
    idx = lastIdx + 1;
    if (idx >= days.length) { idx = 0; week++; }
  } else if (last) idx = 0;   // the last day was removed from the program: start at Day 1 of the same week
  if (lock && lock.programId === program.id) {
    const li = days.findIndex((d) => d.id === lock.dayId);
    if (li >= 0) return { programId: program.id, dayId: days[li].id, dayIndex: li, week: lock.week ?? week, locked: true };
  }
  return { programId: program.id, dayId: days[idx].id, dayIndex: idx, week, locked: false };
}
export const dayLabel = (week: number, dayName: string) => `Week ${week} · ${dayName}`;

// ---------- prefill from history ----------
/** The newest workout (other than `except`) with this exercise done, and its done working sets. */
export function lastTime(key: string, workouts: Dated[], except?: string | null): { workout: Dated; ex: FitLogEx; sets: FitSet[] } | null {
  let best: { workout: Dated; ex: FitLogEx; sets: FitSet[] } | null = null;
  for (const w of workouts) {
    if (w.id === except) continue;
    for (const e of w.data.exercises) {
      if (e.removed || exKey(e) !== key) continue;
      // Drop sets are lighter on purpose: they never set next time's starting weight.
      const sets = e.sets.filter((s) => s.done && !s.warm && !s.gone && !s.drop);
      if (!sets.length) continue;
      if (!best || w.data.startedAt > best.workout.data.startedAt) best = { workout: w, ex: e, sets };
    }
  }
  return best;
}
/** Each set's starting numbers: last time's set at the same place (a longer plan repeats the last one),
 *  else the plan's target. The developer changes them with the big steppers. How many: `count` when given (setsFor),
 *  else the plan's number, else 3. */
export function prefillSets(plan: Pick<FitPlanEx, "exId" | "name" | "sets">, workouts: Dated[], now: string, except?: string | null, count?: number | null): FitSet[] {
  const last = lastTime(exKey(plan), workouts, except);
  const n = count && count > 0 ? clampSets(count) : Math.max(1, plan.sets.length || SETS_DEF);
  const out: FitSet[] = [];
  for (let i = 0; i < n; i++) {
    const prev = last ? last.sets[Math.min(i, last.sets.length - 1)] : null;
    const t = plan.sets[Math.min(i, plan.sets.length - 1)];
    out.push({ id: uidF(), kg: prev?.kg ?? t?.kg ?? null, reps: prev?.reps ?? t?.reps ?? null, rir: null, done: false, at: now });
  }
  return out;
}
/** A fresh workout for a program day, every set prefilled. */
export function startWorkout(program: { id: string; data: FitProgram } | null, day: FitDay | null, week: number, workouts: Dated[], now: Date, date: string, device: FitWorkout["device"] = "phone", prefs?: FitPrefs | null): FitWorkout {
  const at = now.toISOString();
  return {
    programId: program?.id ?? null, dayId: day?.id ?? null, dayName: day?.name ?? "Free workout", week, date,
    startedAt: at, endedAt: null, at, device,
    exercises: (day?.exercises ?? []).map((p, i) => ({
      id: p.id, exId: p.exId, name: p.name, kind: p.kind, perSide: p.perSide, target: p.sets, rir: p.rir ?? null,
      rest: p.rest ?? null, step: p.step ?? null, sets: prefillSets(p, workouts, at, null, setsFor(p, p.sets.length, prefs)), at, order: i, ...(p.note ? { note: p.note } : {}),
    })),
  };
}

// ---------- bests ----------
/** Estimated one rep max (Epley), a fair way to compare 60 kg x 10 with 70 kg x 6. */
export const e1rm = (kg: number, reps: number) => (reps <= 1 ? kg : kg * (1 + reps / 30));
export interface Bests { kg: number; e1rm: number; reps: Record<string, number> /* kg -> most reps */; volume: number }
/** Best numbers for one exercise across workouts (done working sets only), leaving out one workout if asked. */
export function bestsFor(key: string, workouts: Dated[], except?: string | null): Bests {
  const b: Bests = { kg: 0, e1rm: 0, reps: {}, volume: 0 };
  for (const w of workouts) {
    if (w.id === except) continue;
    for (const e of w.data.exercises) {
      if (e.removed || exKey(e) !== key) continue;
      let vol = 0;
      for (const s of e.sets) {
        if (!s.done || s.warm || !s.reps || s.kg == null) continue;
        b.kg = Math.max(b.kg, s.kg);
        b.e1rm = Math.max(b.e1rm, e1rm(s.kg, s.reps));
        const k = fmtKg(s.kg);
        b.reps[k] = Math.max(b.reps[k] ?? 0, s.reps);
        vol += s.kg * s.reps;
      }
      b.volume = Math.max(b.volume, vol);
    }
  }
  return b;
}
export type BestKind = "kg" | "e1rm" | "reps";
/** Is this set a new best against everything before it? Heaviest weight first, then estimated max, then more reps at a weight. */
export function isBest(set: Pick<FitSet, "kg" | "reps" | "done" | "warm">, prior: Bests, hadHistory: boolean): BestKind | null {
  if (!hadHistory || !set.done || set.warm || !set.reps || set.kg == null || set.kg <= 0) return null;
  if (set.kg > prior.kg) return "kg";
  if (e1rm(set.kg, set.reps) > prior.e1rm + 0.01) return "e1rm";
  if (set.reps > (prior.reps[fmtKg(set.kg)] ?? Infinity)) return "reps";
  return null;
}
/** Which sets of this workout's exercise are new bests (each compared with history AND the sets before it today). */
export function bestsInWorkout(ex: FitLogEx, workoutId: string, workouts: Dated[]): Map<string, BestKind> {
  const key = exKey(ex);
  const hadHistory = workouts.some((w) => w.id !== workoutId && w.data.exercises.some((e) => !e.removed && exKey(e) === key && e.sets.some((s) => s.done && !s.warm)));
  const prior = bestsFor(key, workouts, workoutId);
  const out = new Map<string, BestKind>();
  for (const s of ex.sets) {
    const k = isBest(s, prior, hadHistory);
    if (k) out.set(s.id, k);
    if (s.done && !s.warm && s.reps && s.kg != null) {
      prior.kg = Math.max(prior.kg, s.kg); prior.e1rm = Math.max(prior.e1rm, e1rm(s.kg, s.reps));
      prior.reps[fmtKg(s.kg)] = Math.max(prior.reps[fmtKg(s.kg)] ?? 0, s.reps);
    }
  }
  return out;
}

// ---------- the add weight hint ----------
export interface Hint { kind: "up" | "hold" | "down"; kg: number | null; text: string }
/** After a workout (or before the next one): RIR that stays high with every rep done means the weight is
 *  too light. Two sessions in a row 1 above the target, or one session 2 above, says "add a jump". */
export function progressionHint(key: string, workouts: Dated[], opts: { targetRir?: number | null; targetReps?: (number | null)[]; step?: number | null; except?: string | null } = {}): Hint | null {
  const sessions: FitSet[][] = [];
  const sorted = [...workouts].filter((w) => w.id !== opts.except).sort((a, b) => b.data.startedAt.localeCompare(a.data.startedAt));
  for (const w of sorted) {
    const e = w.data.exercises.find((x) => !x.removed && exKey(x) === key);
    const sets = e?.sets.filter((s) => s.done && !s.warm && !s.gone && !s.drop && s.kg != null && s.reps) ?? [];
    if (sets.length) sessions.push(sets);
    if (sessions.length === 2) break;
  }
  if (!sessions.length) return null;
  const target = opts.targetRir ?? 2;
  const step = opts.step && opts.step > 0 ? opts.step : 2.5;
  const avgRir = (sets: FitSet[]) => { const r = sets.filter((s) => s.rir != null).map((s) => s.rir!); return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null; };
  const hitReps = (sets: FitSet[]) => sets.every((s, i) => { const t = opts.targetReps?.[Math.min(i, (opts.targetReps?.length ?? 1) - 1)]; return t == null || (s.reps ?? 0) >= t; });
  const top = (sets: FitSet[]) => Math.max(...sets.map((s) => s.kg ?? 0));
  const [last, prev] = sessions;
  const a = avgRir(last), b = prev ? avgRir(prev) : null;
  if (a == null) return null;
  const kg = top(last);
  if (hitReps(last) && (a >= target + 2 || (b != null && a >= target + 1 && b >= target + 1 && hitReps(prev!) && top(prev!) === kg))) {
    const next = roundKg(kg + step, step < 2.5 ? step : 2.5) || kg + step;
    return { kind: "up", kg: next, text: `Felt easy. Try ${fmtKg(next)} kg` };
  }
  const missed = last.some((s, i) => { const t = opts.targetReps?.[Math.min(i, (opts.targetReps?.length ?? 1) - 1)]; return t != null && (s.reps ?? 0) <= t - 3; });
  if (a <= 0 && missed && (b == null || b <= 0.5)) {
    const next = roundKg(Math.max(0, kg - step), step < 2.5 ? step : 2.5);
    return { kind: "down", kg: next, text: `Very hard last time. Try ${fmtKg(next)} kg` };
  }
  return { kind: "hold", kg, text: `Stay at ${fmtKg(kg)} kg` };
}
/** In the gym, after a set's RIR: the next set of the same exercise can go up when this one was very easy. */
export function liveHint(ex: FitLogEx, setId: string): Hint | null {
  const i = ex.sets.findIndex((s) => s.id === setId);
  const s = ex.sets[i];
  if (!s || s.rir == null || s.kg == null || i === ex.sets.length - 1) return null;
  const target = ex.rir ?? 2;
  const t = ex.target?.[Math.min(i, (ex.target?.length ?? 1) - 1)]?.reps;
  if (s.rir >= Math.max(4, target + 2) && (t == null || (s.reps ?? 0) >= t)) {
    const step = ex.step && ex.step > 0 ? ex.step : 2.5;
    return { kind: "up", kg: roundKg(s.kg + step, step < 2.5 ? step : 2.5), text: "That was easy. Add weight for the next set?" };
  }
  return null;
}

// ---------- history ----------
export function setVolume(sets: FitSet[]) { return sets.reduce((v, s) => v + (s.done && !s.warm && s.kg != null && s.reps ? s.kg * s.reps : 0), 0); }
export function workoutVolume(w: FitWorkout) { return w.exercises.reduce((v, e) => v + (e.removed ? 0 : setVolume(e.sets)), 0); }
export function workoutSetsDone(w: FitWorkout) { return w.exercises.reduce((n, e) => n + (e.removed ? 0 : e.sets.filter((s) => s.done && !s.warm).length), 0); }
export interface ProgressPoint { date: string; workoutId: string; bestKg: number; e1rm: number; volume: number; sets: number }
/** One point per workout for an exercise, oldest first (for its chart). */
export function exerciseProgress(key: string, workouts: Dated[]): ProgressPoint[] {
  const out: ProgressPoint[] = [];
  for (const w of [...workouts].sort((a, b) => a.data.startedAt.localeCompare(b.data.startedAt))) {
    const ex = w.data.exercises.filter((e) => !e.removed && exKey(e) === key);
    const sets = ex.flatMap((e) => e.sets.filter((s) => s.done && !s.warm && s.kg != null && s.reps));
    if (!sets.length) continue;
    out.push({ date: w.data.date, workoutId: w.id, bestKg: Math.max(...sets.map((s) => s.kg!)), e1rm: Math.max(...sets.map((s) => e1rm(s.kg!, s.reps!))), volume: setVolume(sets), sets: sets.length });
  }
  return out;
}
/** Every exercise the developer has logged, newest use first: key, name and how many workouts. */
export function exercisesLogged(workouts: Dated[]): { key: string; name: string; exId: string | null; count: number; last: string }[] {
  const m = new Map<string, { key: string; name: string; exId: string | null; count: number; last: string }>();
  for (const w of workouts) for (const e of w.data.exercises) {
    if (e.removed || !e.sets.some((s) => s.done)) continue;
    const k = exKey(e), cur = m.get(k);
    if (!cur) m.set(k, { key: k, name: e.name, exId: e.exId, count: 1, last: w.data.date });
    else { cur.count++; if (w.data.date > cur.last) { cur.last = w.data.date; cur.name = e.name; } }
  }
  return [...m.values()].sort((a, b) => b.last.localeCompare(a.last) || b.count - a.count);
}
const D = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const plusDaysF = (day: string, n: number) => iso(new Date(D(day).getTime() + n * 864e5));
/** Monday of the week that holds `day`. */
export const weekOf = (day: string) => plusDaysF(day, -((D(day).getUTCDay() + 6) % 7));
/** Days trained this week (Monday to Sunday), the days themselves, and the streak of weeks in a row that
 *  met the goal (this week counts once it is met; until then the streak runs to last week). */
export function weekStats(workouts: Dated[], today: string, goal = 3): { days: string[]; count: number; goal: number; streakWeeks: number; dayStreak: number } {
  const trained = new Set(workouts.filter((w) => workoutSetsDone(w.data) > 0).map((w) => w.data.date));
  const mon = weekOf(today);
  const days = [...trained].filter((d) => d >= mon && d <= plusDaysF(mon, 6)).sort();
  const g = Math.max(1, goal);
  const perWeek = (m: string) => [...trained].filter((d) => d >= m && d <= plusDaysF(m, 6)).length;
  let streakWeeks = days.length >= g ? 1 : 0;
  for (let m = plusDaysF(mon, -7); perWeek(m) >= g; m = plusDaysF(m, -7)) streakWeeks++;
  let dayStreak = 0;
  for (let d = trained.has(today) ? today : plusDaysF(today, -1); trained.has(d); d = plusDaysF(d, -1)) dayStreak++;
  return { days, count: days.length, goal: g, streakWeeks, dayStreak };
}

// ---------- offline merge ----------
// The vault keeps a change made offline in its outbox and sends it once there is signal. If the other
// device changed the same record meanwhile (the Mac fixed a weight while the phone logged on, offline),
// the two copies are merged here instead of the last one winning: exercises and sets by id, the newer
// `at` of each. A set ticked on one side is never lost, an exercise removed stays removed.
const newer = <T extends { at?: string | null }>(a: T, b: T) => ((b.at || "") > (a.at || "") ? b : a);
function mergeSets(a: FitSet[], b: FitSet[]): FitSet[] {
  const out: FitSet[] = [], seen = new Set<string>();
  const bm = new Map(b.map((s) => [s.id, s]));
  for (const s of a) { const o = bm.get(s.id); out.push(o ? newer(s, o) : s); seen.add(s.id); }
  for (const s of b) if (!seen.has(s.id)) out.push(s);
  return out;
}
export function mergeWorkout(a: FitWorkout, b: FitWorkout): FitWorkout {
  const head = newer(a, b), other = head === a ? b : a;
  const bm = new Map(b.exercises.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const exercises: FitLogEx[] = [];
  for (const e of a.exercises) {
    const o = bm.get(e.id); seen.add(e.id);
    if (!o) { exercises.push(e); continue; }
    const top = newer(e, o);
    exercises.push({ ...top, removed: e.removed || o.removed || undefined, sets: mergeSets(e.sets, o.sets) });
  }
  for (const e of b.exercises) if (!seen.has(e.id)) exercises.push(e);
  exercises.sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
  // PS 1.60: shown on a Mac once. The earliest mark wins, so a mark one device made is never lost to a newer header.
  const shown = [a.macShown, b.macShown].filter((x): x is string => !!x).sort()[0];
  return {
    ...head,
    endedAt: head.endedAt ?? other.endedAt ?? null,
    exercises,
    ...(shown ? { macShown: shown } : {}),
  };
}
export function mergePrefs(a: FitPrefs, b: FitPrefs): FitPrefs {
  const at = { ...(a.at || {}) };
  const out: FitPrefs = { ...a };
  for (const k of Object.keys(b) as (keyof FitPrefs)[]) {
    if (k === "at") continue;
    const ta = a.at?.[k] || "", tb = b.at?.[k] || "";
    if (!(k in a) || tb > ta) { (out as Record<string, unknown>)[k] = b[k]; at[k] = tb || ta; }
  }
  out.at = at;
  return out;
}
/** A prefs change, stamped field by field so the merge can tell which side changed what. */
export function stampPrefs(cur: FitPrefs, patch: Partial<FitPrefs>, now = new Date().toISOString()): FitPrefs {
  const at = { ...(cur.at || {}) };
  for (const k of Object.keys(patch)) if (k !== "at") at[k] = now;
  return { ...cur, ...patch, at };
}
/** A program is edited on one device at a time; the merge keeps the newer whole program. */
export function mergeProgram(a: FitProgram, b: FitProgram): FitProgram { return (b.updatedAt || "") > (a.updatedAt || "") ? b : a; }

// ---------- editing a workout (pure; the store saves the result) ----------
export function patchSet(w: FitWorkout, exId: string, setId: string, patch: Partial<FitSet>, now: string): FitWorkout {
  return { ...w, exercises: w.exercises.map((e) => e.id !== exId ? e : { ...e, sets: e.sets.map((s) => s.id !== setId ? s : { ...s, ...patch, at: now, ...(patch.done === true && !s.done ? { doneAt: now } : patch.done === false ? { doneAt: null } : {}) }) }) };
}
/** V1.59: the longest set comment (a short line, not an essay). */
export const COMMENT_MAX = 200;
/** What gets saved for a typed set comment: one line, trimmed, cut at COMMENT_MAX; "" when there is nothing. */
export function cleanComment(t: string | null | undefined): string {
  return (t ?? "").replace(/\s+/g, " ").trim().slice(0, COMMENT_MAX).trim();
}
/** Saves (or, with empty text, clears) the comment on a set. The set's `at` moves, so the offline merge keeps it. */
export function setComment(w: FitWorkout, exId: string, setId: string, text: string, now: string): FitWorkout {
  const c = cleanComment(text);
  return { ...w, exercises: w.exercises.map((e) => e.id !== exId ? e : { ...e, sets: e.sets.map((s) => {
    if (s.id !== setId) return s;
    const { comment: _old, ...rest } = s;
    return { ...rest, ...(c ? { comment: c } : {}), at: now };
  }) }) };
}
/** Where a new set starts (V1.60, the developer: "each new set starts with the weight and reps of the last set logged for that
 *  exercise: this workout first, else the last time"). 1) the last set done in this workout (warm ups are lighter on
 *  purpose and never count; a drop set done just now does, as before: Add set copies the last set), 2) the last set of the last time the exercise was done (`history`: the other
 *  workouts; drop sets there never count), 3) the last set on the screen even if not done yet (the plan's number), 4) nothing. */
export function setStart(e: Pick<FitLogEx, "exId" | "name" | "sets">, history: Dated[] = [], on = true): { kg: number | null; reps: number | null } {
  const live = liveSets(e);
  // Switched off in Fitness settings: the old way, a copy of the last set on screen.
  if (!on) { const l = live[live.length - 1]; return { kg: l?.kg ?? null, reps: l?.reps ?? null }; }
  const done = live.filter((s) => s.done && !s.warm);
  const prev = done[done.length - 1] ?? null;
  if (prev) return { kg: prev.kg ?? null, reps: prev.reps ?? null };
  const lt = lastTime(exKey(e), history);
  const old = lt ? lt.sets[lt.sets.length - 1] : null;
  if (old) return { kg: old.kg ?? null, reps: old.reps ?? null };
  const shown = live.filter((s) => !s.warm && !s.drop);
  const last = shown[shown.length - 1] ?? live[live.length - 1] ?? null;
  return { kg: last?.kg ?? null, reps: last?.reps ?? null };
}
export function addSet(w: FitWorkout, exId: string, now: string, history: Dated[] = [], on = true): FitWorkout {
  return { ...w, exercises: w.exercises.map((e) => {
    if (e.id !== exId) return e;
    const st = setStart(e, history, on);
    return { ...e, sets: [...e.sets, { id: uidF(), kg: st.kg, reps: st.reps, rir: null, done: false, at: now }] };
  }) };
}
// ---------- extra sets after the plan (V1.29, the developer: "Add set" and "Drop set", unlimited) ----------
/** Drop set weight: 20 percent off, rounded to the nearest plate step, and always at least one step lighter
 *  (a light dumbbell would otherwise round back to the same weight). Never below zero. */
export function dropKg(kg: number | null | undefined, step = 2.5): number | null {
  if (kg == null || !Number.isFinite(kg)) return null;
  if (kg <= 0) return kg;
  const s = step > 0 ? step : 2.5;
  const r = roundKg(kg * 0.8, s);
  return r < kg ? r : Math.max(0, roundKg(kg - s, s));
}
/** One more set at the end of an exercise: "Add set" copies the last set's kg and reps; "Drop set" takes the weight
 *  down (dropKg) and is tagged so it never starts a rest and shows DROP in the log and History. */
export function extraSet(w: FitWorkout, exId: string, setId: string, drop: boolean, step: number, now: string, history: Dated[] = [], on = true): FitWorkout {
  return { ...w, exercises: w.exercises.map((e) => {
    if (e.id !== exId || e.sets.some((s) => s.id === setId)) return e;
    const live = liveSets(e), last = live[live.length - 1];
    const st = setStart(e, history, on);
    const kg = drop ? dropKg(last?.kg ?? st.kg, step) : st.kg;
    const set: FitSet = { id: setId, kg, reps: drop ? last?.reps ?? st.reps : st.reps, rir: null, done: false, at: now, extra: true, ...(drop ? { drop: true } : {}) };
    return { ...e, sets: [...e.sets, set] };
  }) };
}

/** Takes a set out. It stays in the record marked gone, so the offline merge cannot bring it back. */
export function removeSet(w: FitWorkout, exId: string, setId: string, now: string): FitWorkout {
  return { ...w, exercises: w.exercises.map((e) => e.id !== exId ? e : { ...e, sets: e.sets.map((s) => s.id !== setId ? s : { ...s, gone: true, done: false, at: now }) }) };
}
/** Finish an exercise early (V1.40, the developer: "never force the planned sets"): the sets not done yet are taken out
 *  (kept marked gone, like Remove set), so the exercise counts as done with the sets the developer did, everywhere: History,
 *  bests, the week streak, next time's weights. Next time it starts with its usual number again. Returns the ids
 *  taken out (for Undo); none when nothing was done yet (that is "Remove from today"). */
export function endExercise(w: FitWorkout, exId: string, now: string): { w: FitWorkout; ids: string[] } {
  const e = w.exercises.find((x) => x.id === exId);
  if (!e || !liveSets(e).some((s) => s.done)) return { w, ids: [] };
  const ids = liveSets(e).filter((s) => !s.done).map((s) => s.id);
  if (!ids.length) return { w, ids };
  const out = new Set(ids);
  return { ids, w: { ...w, exercises: w.exercises.map((x) => x.id !== exId ? x : { ...x, sets: x.sets.map((s) => out.has(s.id) ? { ...s, gone: true, done: false, at: now } : s) }) } };
}
/** Today's sets of an exercise brought to `n` (the Sets chip in the gym): more copy the last set; fewer take out
 *  open sets from the end. Sets already done are never taken out. */
export function fitSetCount(w: FitWorkout, exId: string, n: number, now: string): FitWorkout {
  const want = clampSets(n);
  return { ...w, exercises: w.exercises.map((e) => {
    if (e.id !== exId) return e;
    let sets = e.sets;
    let live = liveSets({ sets });
    while (live.length < want) {
      const last = live[live.length - 1];
      sets = [...sets, { id: uidF(), kg: last?.kg ?? null, reps: last?.reps ?? null, rir: null, done: false, at: now }];
      live = liveSets({ sets });
    }
    if (live.length > want) {
      const drop = new Set<string>();
      for (let i = live.length - 1, k = live.length; i >= 0 && k > want; i--) { if (live[i].done) break; drop.add(live[i].id); k--; }
      sets = sets.map((s) => drop.has(s.id) ? { ...s, gone: true, done: false, at: now } : s);
    }
    return sets === e.sets ? e : { ...e, sets };
  }) };
}
/** The sets on screen (not taken out). */
export const liveSets = (e: Pick<FitLogEx, "sets">) => e.sets.filter((s) => !s.gone);
/** The exercise and set the developer is on: the first exercise with a set not done, and that set. */
export function currentSpot(w: FitWorkout): { exIndex: number; setIndex: number } | null {
  const list = w.exercises.filter((e) => !e.removed);
  for (let i = 0; i < list.length; i++) {
    const j = list[i].sets.findIndex((s) => !s.done && !s.gone);
    if (j >= 0) return { exIndex: w.exercises.indexOf(list[i]), setIndex: j };
  }
  return null;
}
/** Plain words for a set line, eg "60 kg x 8 · RIR 2". */
export function setLine(s: Pick<FitSet, "kg" | "reps" | "rir" | "drop">, perSide?: boolean) {
  const kg = s.kg != null ? `${fmtKg(s.kg)} kg${perSide ? " each" : ""}` : "";
  const reps = s.reps != null ? `${s.reps}` : "";
  const head = kg && reps ? `${kg} x ${reps}` : kg || (reps ? `${reps} reps` : "");
  const line = s.rir != null ? `${head} · RIR ${rirLabel(s.rir)}` : head;
  return s.drop ? `${line} · DROP` : line;
}
/** Planned target in plain words: "3 x 12, 10, 10" (or "3 x 10" when all the same, "3 x 8-10" for a range). */
export function targetLine(t: FitTarget[] | undefined) {
  if (!t?.length) return "";
  const reps = t.map((x) => (x.reps == null ? "?" : x.repsMax && x.repsMax > x.reps ? `${x.reps}-${x.repsMax}` : String(x.reps)));
  return `${t.length} x ${reps.every((r) => r === reps[0]) ? reps[0] : reps.join(", ")}`;
}

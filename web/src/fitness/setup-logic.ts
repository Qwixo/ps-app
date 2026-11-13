// PS Fitness "Set up your training" (V1.47, the developer: "When you open the Fitness app there should be an onboarding process
// where you can set up your training very easily, and if you're working on it, it should get saved so you can finish
// it later and don't have to start over every time. Very simple and flexible.")
//
// The pure half (tested in tests/fitness-setup.test.ts): the steps and their order, the draft that is saved after
// every answer (in the synced Fitness settings, mirrored on the device), which copy to resume, when setup opens by
// itself, and the rules that turn the answers into a suggested program from PS's own exercise library. Setup.tsx is
// the screen; it never decides anything this file does not.
import { REST_COMPOUND, REST_ISOLATION, restLong, restShort, uidF, type FitDay, type FitPlanEx, type FitPrefs, type FitProgram, type FitTarget } from "../core/fitness.ts";
import { getExercise, LIBRARY } from "./library.ts";
import { dayMinutes } from "./nav-logic.ts";
import type { Equipment, Exercise } from "./types.ts";

// ---------- the answers ----------
export type Goal = "muscle" | "strength" | "fat" | "fit" | "custom";
export type Level = "new" | "some" | "exp";
export type Gear = "gym" | "dumbbells" | "home" | "bodyweight";
export type Area = "shoulders" | "elbows" | "wrists" | "back" | "hips" | "knees";
export type Step = "start" | "goal" | "days" | "length" | "level" | "gear" | "avoid" | "plan";

export const STEPS: Step[] = ["start", "goal", "days", "length", "level", "gear", "avoid", "plan"];
/** The questions, in order (start and plan are not questions). */
export const QUESTIONS: Step[] = ["goal", "days", "length", "level", "gear", "avoid"];
export const GOALS: { k: Goal; t: string; d: string }[] = [
  { k: "muscle", t: "Build muscle", d: "Look and feel bigger" },
  { k: "strength", t: "Get stronger", d: "Lift heavier weights" },
  { k: "fat", t: "Lose fat", d: "Keep muscle while the weight comes off" },
  { k: "fit", t: "Stay fit", d: "Feel good and healthy" },
  { k: "custom", t: "Something else", d: "Say it in your own words" },
];
export const DAY_CHOICES = [1, 2, 3, 4, 5, 6] as const;
export const MIN_CHOICES = [30, 45, 60, 75, 90] as const;
export const LEVELS: { k: Level; t: string; d: string }[] = [
  { k: "new", t: "New", d: "Under 6 months, or starting again" },
  { k: "some", t: "Some", d: "6 months to 2 years" },
  { k: "exp", t: "Experienced", d: "Over 2 years, I know the big lifts" },
];
export const GEARS: { k: Gear; t: string; d: string }[] = [
  { k: "gym", t: "Full gym", d: "Machines, cables, barbells and dumbbells" },
  { k: "dumbbells", t: "Dumbbells only", d: "A pair of dumbbells, maybe a bench" },
  { k: "home", t: "Home", d: "Dumbbells, a kettlebell, a bench" },
  { k: "bodyweight", t: "Bodyweight", d: "No weights, maybe a pull up bar" },
];
export const AREAS: { k: Area; t: string }[] = [
  { k: "shoulders", t: "Shoulders" }, { k: "elbows", t: "Elbows" }, { k: "wrists", t: "Wrists" },
  { k: "back", t: "Lower back" }, { k: "hips", t: "Hips" }, { k: "knees", t: "Knees" },
];
/** What an unanswered (skipped) question counts as. */
export const DEFAULTS = { goal: "fit" as Goal, days: 3, mins: 60, level: "new" as Level, gear: "gym" as Gear };

export interface SetupAnswers {
  goal?: Goal | null;
  custom?: string | null;     // the goal in their own words ("Something else")
  days?: number | null;
  mins?: number | null;
  level?: Level | null;
  gear?: Gear | null;
  avoid?: Area[] | null;
}
/** The program being looked at and edited on the last step. */
export interface DraftPlan {
  name: string;
  days: FitDay[];
  from: string;               // the answers it was built from (answersKey); "" when started from scratch
  scratch?: boolean;          // "Start from scratch": empty days to fill
  edited?: boolean;           // changed by hand since it was built (then new answers never replace it silently)
}
/** Saved after every tap, in the synced Fitness settings (prefs.setup) and on the device. */
export interface SetupDraft {
  v: 1;
  step: Step;
  a: SetupAnswers;
  plan?: DraftPlan | null;
  skipped?: Step[];
  startedAt: string;
  at: string;
}

// ---------- the draft ----------
export function newDraft(now: string, step: Step = "start"): SetupDraft {
  return { v: 1, step, a: {}, plan: null, skipped: [], startedAt: now, at: now };
}
const STEP_OF: Record<keyof SetupAnswers, Step> = { goal: "goal", custom: "goal", days: "days", mins: "length", level: "level", gear: "gear", avoid: "avoid" };
/** An answer, saved at once. Answering a question un-skips it. */
export function withAnswer(d: SetupDraft, patch: SetupAnswers, now: string): SetupDraft {
  const touched = new Set((Object.keys(patch) as (keyof SetupAnswers)[]).map((k) => STEP_OF[k]));
  return { ...d, a: { ...d.a, ...patch }, skipped: (d.skipped ?? []).filter((s) => !touched.has(s)), at: now };
}
/** Skip: the question's answer is cleared (its default is used) and it moves on. */
export function skipStep(d: SetupDraft, now: string): SetupDraft {
  const s = d.step;
  if (!QUESTIONS.includes(s)) return goNext(d, now);
  const clear: SetupAnswers = s === "goal" ? { goal: null, custom: null } : s === "length" ? { mins: null } : s === "avoid" ? { avoid: [] } : { [s]: null } as SetupAnswers;
  const skipped = [...new Set([...(d.skipped ?? []), s])];
  return goNext({ ...d, a: { ...d.a, ...clear }, skipped }, now);
}
export function goStep(d: SetupDraft, step: Step, now: string): SetupDraft {
  const next = { ...d, step, at: now };
  return step === "plan" ? ensurePlan(next) : next;
}
/** The next step. Going into the last step builds the suggestion (or a new one when the answers changed and the
 *  plan was not edited by hand). */
export function goNext(d: SetupDraft, now: string): SetupDraft {
  const i = STEPS.indexOf(d.step);
  return goStep(d, STEPS[Math.min(STEPS.length - 1, i + 1)], now);
}
/** Back one step: null on the first one (the caller leaves setup). A plan started from scratch goes back to the start. */
export function goBack(d: SetupDraft, now: string): SetupDraft | null {
  if (d.step === "start") return null;
  if (d.step === "plan" && d.plan?.scratch) return { ...d, step: "start", at: now };
  return { ...d, step: STEPS[STEPS.indexOf(d.step) - 1], at: now };
}
/** Question n of 6, for the bar at the top. */
export function progressOf(d: SetupDraft): { i: number; n: number } {
  const n = QUESTIONS.length;
  if (d.step === "start") return { i: 0, n };
  if (d.step === "plan") return { i: n, n };
  return { i: QUESTIONS.indexOf(d.step) + 1, n };
}
export interface Resolved { goal: Goal; custom: string; days: number; mins: number; level: Level; gear: Gear; avoid: Area[] }
/** The answers with every skipped one filled with its default. */
export function resolved(a: SetupAnswers): Resolved {
  const days = a.days != null && Number.isFinite(a.days) ? Math.max(1, Math.min(6, Math.round(a.days))) : DEFAULTS.days;
  const mins = a.mins != null && Number.isFinite(a.mins) ? Math.max(20, Math.min(120, Math.round(a.mins))) : DEFAULTS.mins;
  return {
    goal: a.goal ?? DEFAULTS.goal, custom: (a.custom ?? "").trim(), days, mins,
    level: a.level ?? DEFAULTS.level, gear: a.gear ?? DEFAULTS.gear, avoid: [...new Set(a.avoid ?? [])].sort(),
  };
}
export const answersKey = (a: SetupAnswers) => { const r = resolved(a); return JSON.stringify([r.goal, r.days, r.mins, r.level, r.gear, r.avoid]); };
function ensurePlan(d: SetupDraft): SetupDraft {
  const key = answersKey(d.a);
  if (d.plan && (d.plan.scratch || d.plan.edited || d.plan.from === key)) return d;
  return { ...d, plan: suggestPlan(d.a) };
}
/** True when the plan on screen was built from older answers and was edited since (offer a new suggestion). */
export const planStale = (d: SetupDraft) => !!d.plan && !d.plan.scratch && d.plan.from !== answersKey(d.a);
/** "Start from scratch": straight to the last step with empty days to fill (as many as the days answer, else 3). */
export function scratchPlan(d: SetupDraft, now: string): SetupDraft {
  const n = resolved(d.a).days;
  const plan: DraftPlan = { name: "My program", from: "", scratch: true, days: Array.from({ length: n }, (_, i) => ({ id: uidF(), name: `Day ${i + 1}`, title: null, exercises: [] })) };
  return { ...d, plan, step: "plan", at: now };
}
/** Replace the plan on screen with a fresh suggestion from the answers. */
export function rebuild(d: SetupDraft, now: string): SetupDraft { return { ...d, plan: suggestPlan(d.a), at: now }; }

/** Which copy to carry on from: this device's (saved on every tap, even before the vault opened) or the synced one.
 *  The newer wins. A local copy older than the moment setup was finished, or put away on any device, is dropped. */
export function pickDraft(local: SetupDraft | null, synced: SetupDraft | null, o: { clearedAt?: string | null; doneAt?: string | null } = {}): SetupDraft | null {
  const cut = [o.doneAt ?? "", synced ? "" : o.clearedAt ?? ""].reduce((m, x) => (x > m ? x : m), "");
  const l = local && local.at > cut ? local : null;
  if (l && synced) return l.at > synced.at ? l : synced;
  return l ?? synced ?? null;
}
/** Setup opens by itself only for someone brand new: no program, no workout, never finished or put away, and not
 *  waved off with "Not now" on this device. Never on the self test page or when a screen was asked for. */
export function autoOpen(o: { ready: boolean; test?: boolean; asked?: boolean; later?: boolean; done?: string | null; programs: number; workouts: number }): boolean {
  return o.ready && !o.test && !o.asked && !o.later && !o.done && o.programs === 0 && o.workouts === 0;
}

// ---------- reading a stored draft (it comes from storage or another device: never trusted) ----------
const isStr = (v: unknown): v is string => typeof v === "string";
const oneOf = <T extends string>(v: unknown, xs: readonly T[]): T | null => (isStr(v) && (xs as readonly string[]).includes(v) ? (v as T) : null);
const numIn = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null);
const clip = (v: unknown, n: number) => (isStr(v) ? v.slice(0, n) : "");
function cleanTarget(t: unknown): FitTarget {
  const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
  return { reps: numIn(o.reps, 0, 999), repsMax: numIn(o.repsMax, 0, 999), kg: typeof o.kg === "number" && Number.isFinite(o.kg) ? o.kg : null };
}
function cleanEx(x: unknown): FitPlanEx | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const name = clip(o.name, 120).trim();
  if (!name) return null;
  const sets = Array.isArray(o.sets) ? o.sets.slice(0, 12).map(cleanTarget) : [];
  return {
    id: clip(o.id, 40) || uidF(), exId: isStr(o.exId) && getExercise(o.exId) ? o.exId : null, name,
    kind: o.kind === "isolation" ? "isolation" : "compound", perSide: !!o.perSide, sets,
    rir: numIn(o.rir, 0, 4), rest: numIn(o.rest, 15, 600), step: typeof o.step === "number" ? o.step : null, note: isStr(o.note) ? clip(o.note, 300) : null,
  };
}
export function sanitizeDraft(raw: unknown): SetupDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1 || !isStr(o.at) || !isStr(o.startedAt)) return null;
  const step = oneOf(o.step, STEPS) ?? "start";
  const ar = (o.a && typeof o.a === "object" ? o.a : {}) as Record<string, unknown>;
  const a: SetupAnswers = {
    goal: oneOf(ar.goal, GOALS.map((g) => g.k)), custom: isStr(ar.custom) ? clip(ar.custom, 80) : null,
    days: numIn(ar.days, 1, 6), mins: numIn(ar.mins, 20, 120), level: oneOf(ar.level, LEVELS.map((l) => l.k)),
    gear: oneOf(ar.gear, GEARS.map((g) => g.k)),
    avoid: Array.isArray(ar.avoid) ? [...new Set(ar.avoid.map((x) => oneOf(x, AREAS.map((y) => y.k))).filter((x): x is Area => !!x))] : [],
  };
  let plan: DraftPlan | null = null;
  if (o.plan && typeof o.plan === "object") {
    const p = o.plan as Record<string, unknown>;
    const days: FitDay[] = Array.isArray(p.days) ? p.days.slice(0, 7).map((d, i) => {
      const dd = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
      return { id: clip(dd.id, 40) || uidF(), name: clip(dd.name, 40) || `Day ${i + 1}`, title: isStr(dd.title) ? clip(dd.title, 60) : null,
        exercises: Array.isArray(dd.exercises) ? dd.exercises.slice(0, 20).map(cleanEx).filter((x): x is FitPlanEx => !!x) : [] };
    }) : [];
    plan = { name: clip(p.name, 80) || "My program", days, from: clip(p.from, 200), scratch: !!p.scratch, edited: !!p.edited };
  }
  const skipped = Array.isArray(o.skipped) ? o.skipped.map((s) => oneOf(s, QUESTIONS)).filter((s): s is Step => !!s) : [];
  const d: SetupDraft = { v: 1, step, a, plan, skipped, startedAt: o.startedAt as string, at: o.at as string };
  return step === "plan" && !plan ? ensurePlan(d) : d;
}

// ---------- the suggestion ----------
// Movement slots. Each lists real library exercises, the best for a newer lifter first. Per exercise: where it can be
// done (g gym, d dumbbells only, h home, b bodyweight; the gym can do everything), the joints it loads hard (s
// shoulders, e elbows, w wrists, b lower back, h hips, k knees) and x for a free weight lift better left to people
// with experience. The test checks every id is in the library.
type Slot = "squat" | "hinge" | "lunge" | "hpush" | "vpush" | "hpull" | "vpull" | "fly" | "lateral" | "rear" | "curl" | "tri" | "hamcurl" | "quadext" | "calf" | "core" | "glute";
interface Cand { id: string; at: string; load: string; x?: boolean }
const c = (id: string, at: string, load = "", x = false): Cand => ({ id, at, load, x });
export const SLOTS: Record<Slot, Cand[]> = {
  squat: [c("leg-press", "g", "k"), c("goblet-squat", "gdh", "k"), c("hack-squat", "g", "k"), c("smith-machine-squat", "g", "kb"), c("back-squat", "g", "kbh", true), c("split-squat", "gdhb", "kh"), c("step-up", "gdhb", "k")],
  hinge: [c("dumbbell-romanian-deadlift", "gdh", "b"), c("hip-thrust", "g", ""), c("glute-bridge", "gdhb", ""), c("romanian-deadlift", "g", "b", true), c("kettlebell-swing", "gh", "b"), c("back-extension", "g", "b"), c("deadlift", "g", "bh", true), c("single-leg-romanian-deadlift", "gdhb", "b")],
  lunge: [c("reverse-lunge", "gdhb", "kh"), c("bulgarian-split-squat", "gdhb", "kh"), c("walking-lunge", "gdhb", "kh"), c("step-up", "gdhb", "k")],
  hpush: [c("machine-chest-press", "g", "s"), c("dumbbell-bench-press", "gdh", "s"), c("push-up", "gdhb", "sw"), c("incline-dumbbell-press", "gdh", "s"), c("barbell-bench-press", "g", "sw", true), c("dumbbell-floor-press", "gdh", ""), c("incline-push-up", "gdhb", "w")],
  vpush: [c("machine-shoulder-press", "g", "s"), c("seated-dumbbell-shoulder-press", "gdh", "s"), c("arnold-press", "gdh", "s"), c("overhead-press", "g", "sb", true)],
  hpull: [c("seated-cable-row", "g", ""), c("machine-row", "g", ""), c("chest-supported-dumbbell-row", "gdh", ""), c("dumbbell-row", "gdh", ""), c("barbell-row", "g", "b", true), c("inverted-row", "gb", "")],
  vpull: [c("lat-pulldown", "g", ""), c("assisted-pull-up", "g", "s"), c("close-grip-lat-pulldown", "g", ""), c("pull-up", "gb", "se", true), c("chin-up", "gb", "e"), c("dumbbell-pullover", "gdh", "s")],
  fly: [c("pec-deck", "g", "s"), c("cable-fly", "g", "s"), c("dumbbell-fly", "gdh", "s")],
  lateral: [c("dumbbell-lateral-raise", "gdh", "s"), c("cable-lateral-raise", "g", "s"), c("machine-lateral-raise", "g", "s")],
  rear: [c("face-pull", "g", ""), c("reverse-pec-deck", "g", ""), c("rear-delt-fly", "gdh", "")],
  curl: [c("dumbbell-curl", "gdh", "e"), c("cable-curl", "g", "e"), c("hammer-curl", "gdh", ""), c("incline-dumbbell-curl", "gdh", "e"), c("ez-bar-curl", "g", "ew"), c("chin-up", "b", "e")],
  tri: [c("triceps-pushdown", "g", "e"), c("rope-pushdown", "g", "e"), c("overhead-dumbbell-triceps-extension", "gdh", "es"), c("triceps-kickback", "gdh", ""), c("bench-dip", "gdhb", "sw"), c("diamond-push-up", "b", "we")],
  hamcurl: [c("seated-leg-curl", "g", ""), c("lying-leg-curl", "g", ""), c("single-leg-romanian-deadlift", "dhb", "b"), c("nordic-curl", "b", "k")],
  quadext: [c("leg-extension", "g", "k"), c("goblet-squat", "dh", "k"), c("split-squat", "b", "kh")],
  calf: [c("standing-calf-raise", "g", ""), c("seated-calf-raise", "g", ""), c("dumbbell-calf-raise", "gdhb", "")],
  core: [c("dead-bug", "gdhb", ""), c("cable-crunch", "g", "b"), c("machine-crunch", "g", ""), c("hanging-leg-raise", "gb", "s"), c("crunch", "gdhb", "")],
  glute: [c("hip-thrust", "g", ""), c("glute-bridge", "gdhb", ""), c("cable-glute-kickback", "g", ""), c("hip-abduction-machine", "g", "h")],
};
const GEAR_CODE: Record<Gear, string> = { gym: "g", dumbbells: "d", home: "h", bodyweight: "b" };
const AREA_CODE: Record<Area, string> = { shoulders: "s", elbows: "e", wrists: "w", back: "b", hips: "h", knees: "k" };

type Pick = [Slot, number?];
interface Template { title: string; slots: Pick[] }
const FULL_A: Template = { title: "Full body A", slots: [["squat"], ["hpush"], ["hpull"], ["hinge"], ["lateral"], ["curl"], ["core"]] };
const FULL_B: Template = { title: "Full body B", slots: [["hinge"], ["vpush"], ["vpull"], ["lunge"], ["fly"], ["tri"], ["calf"]] };
const FULL_C: Template = { title: "Full body C", slots: [["lunge"], ["hpush", 1], ["hpull", 1], ["glute"], ["rear"], ["curl", 1], ["core", 1]] };
const UPPER_A: Template = { title: "Upper A", slots: [["hpush"], ["hpull"], ["vpush"], ["vpull"], ["lateral"], ["curl"], ["tri"]] };
const LOWER_A: Template = { title: "Lower A", slots: [["squat"], ["hinge"], ["lunge"], ["hamcurl"], ["calf"], ["core"], ["quadext"]] };
const UPPER_B: Template = { title: "Upper B", slots: [["vpull", 1], ["hpush", 1], ["hpull", 1], ["vpush", 1], ["rear"], ["tri", 1], ["curl", 1]] };
const LOWER_B: Template = { title: "Lower B", slots: [["hinge", 1], ["squat", 1], ["glute"], ["quadext"], ["hamcurl", 1], ["calf", 1], ["core", 1]] };
const PUSH: Template = { title: "Push", slots: [["hpush"], ["vpush"], ["hpush", 1], ["lateral"], ["tri"], ["fly"], ["tri", 1]] };
const PULL: Template = { title: "Pull", slots: [["vpull"], ["hpull"], ["vpull", 1], ["rear"], ["curl"], ["hpull", 1], ["curl", 1]] };
const LEGS: Template = { title: "Legs", slots: [["squat"], ["hinge"], ["lunge"], ["quadext"], ["hamcurl"], ["calf"], ["core"]] };
const shift = (t: Template, title: string): Template => ({ title, slots: t.slots.map(([s, v]) => [s, (v ?? 0) + 1]) });
const named = (t: Template, title: string): Template => ({ ...t, title });

/** Which days for how many days a week. Three days: full body for a newer lifter or a health goal, else push, pull, legs. */
export function splitFor(days: number, goal: Goal, level: Level): Template[] {
  switch (Math.max(1, Math.min(6, days))) {
    case 1: return [named(FULL_A, "Full body")];
    case 2: return [FULL_A, FULL_B];
    case 3: return level === "new" || goal === "fat" || goal === "fit" || goal === "custom" ? [FULL_A, FULL_B, FULL_C] : [PUSH, PULL, LEGS];
    case 4: return [UPPER_A, LOWER_A, UPPER_B, LOWER_B];
    case 5: return [named(UPPER_A, "Upper"), named(LOWER_A, "Lower"), PUSH, PULL, LEGS];
    default: return [named(PUSH, "Push A"), named(PULL, "Pull A"), named(LEGS, "Legs A"), shift(PUSH, "Push B"), shift(PULL, "Pull B"), shift(LEGS, "Legs B")];
  }
}
/** Reps, rest and how hard, from the goal, the experience and the kind of lift. `main`: one of the first two lifts of
 *  the day, the only ones a strength plan takes heavy (4 to 6 reps); later big lifts stay at 6 to 8. */
export function dosage(goal: Goal, level: Level, kind: "compound" | "isolation", prefs?: FitPrefs | null, main = true): { reps: number; repsMax: number; rest: number; rir: number } {
  const big = kind === "compound";
  let reps: [number, number], rest: number;
  switch (goal) {
    case "strength":
      if (!big) { reps = [8, 12]; rest = 90; }
      else if (!main || level === "new") { reps = [6, 8]; rest = main ? 150 : 120; }
      else { reps = [4, 6]; rest = 180; }
      break;
    case "muscle": reps = [8, 12]; rest = big ? 120 : 90; break;
    case "fat": reps = big ? [10, 12] : [12, 15]; rest = big ? 75 : 60; break;
    default: reps = big ? [10, 12] : [12, 15]; rest = big ? 90 : 60;
  }
  const rir = level === "new" ? 3 : level === "exp" ? (goal === "strength" && big && main ? 2 : 1) : 2;
  // The person's own long and short rest already match: leave the exercise on the default (Settings stays in charge).
  const usual = big ? restLong(prefs) : restShort(prefs);
  return { reps: reps[0], repsMax: reps[1], rest: rest === usual ? 0 : rest, rir };
}
/** Exercises that fit where you train and spare the areas you picked, in the order to use them for this level. */
export function candidates(slot: Slot, a: { gear: Gear; avoid: Area[]; level: Level; goal: Goal }): string[] {
  const g = GEAR_CODE[a.gear], bad = a.avoid.map((x) => AREA_CODE[x]);
  const ok = SLOTS[slot].filter((x) => (g === "g" || x.at.includes(g)) && !bad.some((b) => x.load.includes(b)));
  let list = ok;
  if (a.level === "new") { const easy = ok.filter((x) => !x.x); list = easy.length ? easy : ok; }
  else if (a.level === "exp" && a.goal === "strength") list = [...ok.filter((x) => x.x), ...ok.filter((x) => !x.x)];
  return list.map((x) => x.id);
}
function planEx(x: Exercise, goal: Goal, level: Level, sets: number, prefs?: FitPrefs | null, main = true): FitPlanEx {
  const d = dosage(goal, level, x.kind, prefs, main);
  return {
    id: uidF(), exId: x.id, name: x.name, kind: x.kind, perSide: x.perSide, step: x.step, rir: d.rir, rest: d.rest || null, note: null,
    sets: Array.from({ length: sets }, () => ({ reps: d.reps, repsMax: d.repsMax, kg: null })),
  };
}
/** Sets for the n-th exercise of a day: 3, a 4th on the first lift for experienced people, 2 on small lifts for new ones. */
export function setsAt(i: number, kind: "compound" | "isolation", level: Level): number {
  if (level === "exp" && i === 0) return 4;
  if (level === "new" && kind === "isolation") return 2;
  return 3;
}
const MAX_EX: Record<Level, number> = { new: 5, some: 6, exp: 7 };
/** The suggested program: the days of the split, each filled slot by slot until the session length is used up
 *  (at least 2 exercises a day when the equipment allows). Only real library exercises, so every one has its picture. */
export function suggestPlan(answers: SetupAnswers, prefs?: FitPrefs | null): DraftPlan {
  const r = resolved(answers);
  const days: FitDay[] = splitFor(r.days, r.goal, r.level).map((t, di) => {
    const used = new Set<string>();
    const exs: FitPlanEx[] = [];
    for (const [slot, v = 0] of t.slots) {
      if (exs.length >= MAX_EX[r.level]) break;
      const list = candidates(slot, r).filter((id) => !used.has(id));
      if (!list.length) continue;
      const x = getExercise(list[Math.min(v, list.length - 1)]);
      if (!x) continue;
      const e = planEx(x, r.goal, r.level, setsAt(exs.length, x.kind, r.level), prefs, exs.length < 2);
      if (exs.length >= 2 && dayMinutes({ exercises: [...exs, e] }, prefs) > r.mins) break;
      used.add(x.id);
      exs.push(e);
    }
    return { id: uidF(), name: `Day ${di + 1}`, title: t.title, exercises: exs };
  });
  const goal = GOALS.find((g) => g.k === r.goal)!;
  const name = r.goal === "custom" && r.custom ? r.custom : `${goal.t} plan`;
  return { name, days, from: answersKey(answers) };
}

// ---------- editing the plan before saving (each returns a new plan, marked edited) ----------
const editDay = (p: DraftPlan, dayId: string, f: (d: FitDay) => FitDay): DraftPlan => ({ ...p, edited: true, days: p.days.map((d) => (d.id === dayId ? f(d) : d)) });
const editEx = (p: DraftPlan, dayId: string, exId: string, f: (e: FitPlanEx) => FitPlanEx) => editDay(p, dayId, (d) => ({ ...d, exercises: d.exercises.map((e) => (e.id === exId ? f(e) : e)) }));
export const removeEx = (p: DraftPlan, dayId: string, exId: string) => editDay(p, dayId, (d) => ({ ...d, exercises: d.exercises.filter((e) => e.id !== exId) }));
export function moveEx(p: DraftPlan, dayId: string, exId: string, dir: -1 | 1): DraftPlan {
  return editDay(p, dayId, (d) => {
    const i = d.exercises.findIndex((e) => e.id === exId), j = i + dir;
    if (i < 0 || j < 0 || j >= d.exercises.length) return d;
    const xs = [...d.exercises];
    [xs[i], xs[j]] = [xs[j], xs[i]];
    return { ...d, exercises: xs };
  });
}
/** Sets for one exercise, 1 to 12, keeping its reps. */
export function setSets(p: DraftPlan, dayId: string, exId: string, n: number): DraftPlan {
  const k = Math.max(1, Math.min(12, Math.round(n)));
  return editEx(p, dayId, exId, (e) => {
    const t = e.sets[e.sets.length - 1] ?? { reps: 10, repsMax: null, kg: null };
    return { ...e, sets: Array.from({ length: k }, (_, i) => e.sets[i] ?? { ...t }) };
  });
}
/** Rest for one exercise (null: the long or short rest from Settings). */
export const setRest = (p: DraftPlan, dayId: string, exId: string, secs: number | null) =>
  editEx(p, dayId, exId, (e) => ({ ...e, rest: secs == null ? null : Math.max(15, Math.min(600, Math.round(secs / 15) * 15)) }));
/** Another library exercise in its place, with the same sets, reps and how hard; rest follows the new kind of lift. */
export function swapEx(p: DraftPlan, dayId: string, exId: string, libId: string, a: SetupAnswers, prefs?: FitPrefs | null): DraftPlan {
  const x = getExercise(libId);
  if (!x) return p;
  const r = resolved(a);
  return editEx(p, dayId, exId, (e) => ({ ...planEx(x, r.goal, r.level, e.sets.length || 3, prefs), id: e.id, sets: e.sets.length ? e.sets.map((s) => ({ ...s })) : planEx(x, r.goal, r.level, 3, prefs).sets }));
}
/** A library exercise added at the end of a day, set up for the answers. */
export function addEx(p: DraftPlan, dayId: string, libId: string, a: SetupAnswers, prefs?: FitPrefs | null): DraftPlan {
  const x = getExercise(libId);
  if (!x) return p;
  const r = resolved(a);
  return editDay(p, dayId, (d) => ({ ...d, exercises: [...d.exercises, planEx(x, r.goal, r.level, setsAt(d.exercises.length, x.kind, r.level), prefs, d.exercises.length < 2)] }));
}
export function addDay(p: DraftPlan): DraftPlan {
  if (p.days.length >= 7) return p;
  return { ...p, edited: true, days: [...p.days, { id: uidF(), name: `Day ${p.days.length + 1}`, title: null, exercises: [] }] };
}
/** A day taken out; the others are renumbered (Day 1, Day 2...). */
export function removeDay(p: DraftPlan, dayId: string): DraftPlan {
  const days = p.days.filter((d) => d.id !== dayId);
  if (!days.length || days.length === p.days.length) return p;
  return { ...p, edited: true, days: days.map((d, i) => ({ ...d, name: `Day ${i + 1}` })) };
}
export const renamePlan = (p: DraftPlan, name: string): DraftPlan => ({ ...p, edited: true, name: name.slice(0, 80) });
export const renameDay = (p: DraftPlan, dayId: string, title: string) => editDay(p, dayId, (d) => ({ ...d, title: title.slice(0, 60) || null }));

/** What to offer for Swap: the same movement first (fits the equipment and the areas to spare), then other library
 *  exercises for the same main muscle that fit the equipment. Never the exercise itself or one already that day. */
export function swapChoices(ex: FitPlanEx, day: FitDay, a: SetupAnswers, limit = 8): Exercise[] {
  const r = resolved(a);
  const taken = new Set(day.exercises.map((e) => e.exId).filter(Boolean) as string[]);
  const out: Exercise[] = [];
  const push = (id: string) => { const x = getExercise(id); if (x && !taken.has(id) && !out.some((o) => o.id === id)) out.push(x); };
  for (const s of Object.keys(SLOTS) as Slot[]) if (ex.exId && SLOTS[s].some((cnd) => cnd.id === ex.exId)) candidates(s, r).forEach(push);
  const main = ex.exId ? getExercise(ex.exId)?.muscles[0] : null;
  if (main) for (const x of LIBRARY) if (x.muscles[0] === main && fitsGear(x.equipment, r.gear) && !x.timed) push(x.id);
  return out.slice(0, limit);
}
/** Library exercises that can be done with this equipment (for Add and its search). */
export function fitsGear(eq: Equipment, gear: Gear): boolean {
  if (gear === "gym") return true;
  if (gear === "bodyweight") return eq === "bodyweight";
  if (gear === "dumbbells") return eq === "dumbbell" || eq === "bodyweight";
  return eq === "dumbbell" || eq === "kettlebell" || eq === "bodyweight" || eq === "other";
}
/** The finished plan as a program to save (the default rest of Settings is what an exercise with no rest of its own uses). */
export function planToProgram(p: DraftPlan): Omit<FitProgram, "createdAt" | "updatedAt"> {
  return { name: p.name.trim() || "My program", source: "manual", days: p.days.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e })) })) };
}
/** "3 x 8 to 12" for a planned exercise. */
export function setsLine(e: FitPlanEx): string {
  const n = e.sets.length;
  if (!n) return "Sets: pick them in the gym";
  const t = e.sets[0];
  const reps = t.reps == null ? "" : t.repsMax && t.repsMax !== t.reps ? `${t.reps} to ${t.repsMax}` : String(t.reps);
  return reps ? `${n} x ${reps}` : `${n} ${n === 1 ? "set" : "sets"}`;
}
/** The default rests, for "Rest: Long (2:00)" when an exercise has none of its own. */
export const DEFAULT_REST = { long: REST_COMPOUND, short: REST_ISOLATION };

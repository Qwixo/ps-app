// PS Fitness navigation (V1.43, the developer: "The Fitness tab on mobile and desktop is just very complicated to look at. I never
// know how to navigate it."). One home, one round menu button, every section one tap from the menu, and a back that
// always goes one step. This file holds the pure parts (tested in tests/fitness-nav.test.ts): the sections and their
// one line descriptions, the screen stack, the personal bests list and the home summary numbers.
import { exKey, fmtKg, restFor, setsDefault, type FitDay, type FitPrefs, type FitProgram, type FitWorkout, type NextDay } from "../core/fitness.ts";

export type FitSection = "home" | "gym" | "plan" | "history" | "bests" | "exercises" | "sleep" | "squad" | "settings" | "setup";
/** What a section opens on, when another screen sends you there (a personal best opens its exercise in History). */
export type FitArg = { k: "w"; id: string } | { k: "x"; key: string } | { k: "pick" } | null;
export interface FitScreen { s: FitSection; arg?: FitArg }

export interface SectionInfo { k: FitSection; title: string; line: string }
/** The menu, in the developer's order. Home sits above it on its own. */
export const SECTIONS: SectionInfo[] = [
  { k: "gym", title: "Today", line: "Start or carry on today's workout" },
  { k: "plan", title: "Programs", line: "Your plans, days and trainer's sheet" },
  { k: "history", title: "History", line: "Sleep and training day by day, and export" },
  { k: "bests", title: "Personal bests", line: "Your heaviest and strongest sets" },
  { k: "exercises", title: "Exercises", line: "Every exercise with a picture and a form tip" },
  { k: "sleep", title: "Sleep", line: "Log last night and see your nights" },
  { k: "squad", title: "Squad", line: "Gym boards with your G Squad" },
  { k: "settings", title: "Settings", line: "Rest, sets, week goal, reminder and look" },
];
export const HOME: SectionInfo = { k: "home", title: "Fitness", line: "What matters right now" };
/** V1.47: "Set up your training" sits under the sections in the menu (a few questions, then a plan to change and save). */
export const SETUP: SectionInfo = { k: "setup", title: "Set up your training", line: "A few questions, then a plan you can change" };
export const sectionInfo = (k: FitSection): SectionInfo => (k === "home" ? HOME : k === "setup" ? SETUP : SECTIONS.find((x) => x.k === k) ?? HOME);
const KEYS = new Set<string>(["home", "setup", ...SECTIONS.map((x) => x.k)]);
export const isSection = (k: unknown): k is FitSection => typeof k === "string" && KEYS.has(k);

// ---------- the screen stack: home is always at the bottom ----------
/** Where Fitness opens: a ?tab= the self test asked for, else Today while a workout is open, else home. */
export function startStack(tab: string | null | undefined, workoutOpen: boolean): FitScreen[] {
  const home: FitScreen = { s: "home" };
  if (tab === "home") return [home];
  if (isSection(tab)) return [home, { s: tab }];
  return workoutOpen ? [home, { s: "gym" }] : [home];
}
/** The menu (or the rail) takes you to a section: straight above home, whatever was open before. */
export function goTo(_st: FitScreen[], s: FitSection, arg?: FitArg): FitScreen[] {
  return s === "home" ? [{ s: "home" }] : [{ s: "home" }, arg ? { s, arg } : { s }];
}
/** A screen opens another one on top (a personal best opens its exercise; Back returns to the bests). */
export function push(st: FitScreen[], s: FitSection, arg?: FitArg): FitScreen[] {
  const top = st[st.length - 1];
  if (top && top.s === s && sameArg(top.arg, arg)) return st;
  return [...st, arg ? { s, arg } : { s }];
}
/** One step back. Null when already home (the caller then leaves Fitness: minimise, close or the page's own back). */
export function back(st: FitScreen[]): FitScreen[] | null { return st.length > 1 ? st.slice(0, -1) : null; }
const sameArg = (a?: FitArg, b?: FitArg) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------- personal bests ----------
type Dated = { id: string; data: FitWorkout };
export interface PersonalBest {
  key: string; name: string; exId: string | null;
  kg: number; reps: number; date: string; workoutId: string;      // the heaviest working set (most reps at that weight)
  e1rm: number; e1Kg: number; e1Reps: number;                       // the strongest set by estimated max
  sessions: number; last: string;
}
const est = (kg: number, reps: number) => (reps <= 1 ? kg : kg * (1 + reps / 30));
/** Each exercise you have done, with its heaviest set and its strongest set (estimated one rep max), newest first.
 *  Done working sets only (warm ups and removed exercises left out), a weight of 0 or less never counts. */
export function personalBests(workouts: Dated[]): PersonalBest[] {
  const m = new Map<string, PersonalBest>();
  const seen = new Map<string, Set<string>>();
  const ordered = [...workouts].sort((a, b) => a.data.startedAt.localeCompare(b.data.startedAt));
  for (const w of ordered) for (const e of w.data.exercises) {
    if (e.removed) continue;
    const k = exKey(e);
    for (const s of e.sets) {
      if (!s.done || s.warm || s.gone || !s.reps || s.kg == null || s.kg <= 0) continue;
      let b = m.get(k);
      if (!b) { b = { key: k, name: e.name, exId: e.exId ?? null, kg: 0, reps: 0, date: w.data.date, workoutId: w.id, e1rm: 0, e1Kg: 0, e1Reps: 0, sessions: 0, last: w.data.date }; m.set(k, b); }
      const ids = seen.get(k) ?? new Set<string>();
      if (!ids.has(w.id)) { ids.add(w.id); seen.set(k, ids); b.sessions++; }
      if (w.data.date >= b.last) { b.last = w.data.date; b.name = e.name; }
      if (s.kg > b.kg || (s.kg === b.kg && s.reps > b.reps)) { b.kg = s.kg; b.reps = s.reps; b.date = w.data.date; b.workoutId = w.id; }
      const x = est(s.kg, s.reps);
      if (x > b.e1rm + 0.001) { b.e1rm = x; b.e1Kg = s.kg; b.e1Reps = s.reps; }
    }
  }
  return [...m.values()].sort((a, b) => b.last.localeCompare(a.last) || b.kg - a.kg);
}
export const bestLine = (b: PersonalBest, perSide?: boolean) => `${fmtKg(b.kg)} kg${perSide ? " each side" : ""} x ${b.reps}`;

// ---------- the home summary ----------
/** The day after the one up next, in the program's order (wraps to day 1 and the next week). Null with one day or none. */
export function dayAfter(program: { data: FitProgram } | null, next: NextDay | null): { week: number; name: string; title?: string | null } | null {
  const days = program?.data.days ?? [];
  if (!next || days.length < 2) return null;
  const i = (next.dayIndex + 1) % days.length;
  return { week: i === 0 ? next.week + 1 : next.week, name: days[i].name, title: days[i].title ?? null };
}
/** The newest finished workout, or null. */
export function lastFinished(workouts: Dated[]): Dated | null {
  let best: Dated | null = null;
  for (const w of workouts) if (w.data.endedAt && (!best || w.data.startedAt > best.data.startedAt)) best = w;
  return best;
}
/** "Today", "Yesterday", "3 days ago", else the short date. */
export function agoWord(day: string, today: string, short: (d: string) => string): string {
  const n = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 864e5);
  if (n <= 0) return "Today";
  if (n === 1) return "Yesterday";
  if (n < 7) return `${n} days ago`;
  return short(day);
}
/** A coming day: "Today", "Tomorrow", else its weekday ("Tue"). */
export function soonWord(day: string, today: string, weekday: (d: string) => string): string {
  const n = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
  return n <= 0 ? "Today" : n === 1 ? "Tomorrow" : weekday(day);
}

// ---------- plain words for the day (V1.43, the developer: "every button says exactly what it does") ----------
/** "Day 3: Arms", or just "Day 3" with no title. */
export const dayWords = (d: { name: string; title?: string | null }) => `${d.name}${d.title ? `: ${d.title}` : ""}`;
/** About how long a day takes: each set about 45 s of work plus its rest (the last set of an exercise needs none),
 *  rounded to 5 minutes, at least 10. Days with no sets planned count the default number of sets. */
export function dayMinutes(day: Pick<FitDay, "exercises">, prefs?: FitPrefs | null): number {
  let secs = 0;
  for (const e of day.exercises) {
    const n = e.sets.length || setsDefault(prefs);
    secs += n * 45 + Math.max(0, n - 1) * restFor(e, prefs) + 60;   // a minute to set up each exercise
  }
  return day.exercises.length ? Math.max(10, Math.round(secs / 300) * 5) : 0;
}

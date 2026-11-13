// PS Fitness, the Program screen's pure helpers (no React, no vault), tested in tests/fitness-plan.test.ts:
// moving days and exercises, changing the set count while keeping each set's reps, "same for all",
// the plain words on an exercise card, the beginner hints, the weeks the developer can export and the import checks.
import { clampRest, fmtClock, fmtKg, uidF, type FitDay, type FitKind, type FitPlanEx, type FitPrefs, type FitProgram, type FitTarget, type FitWorkout } from "../core/fitness.ts";

// ---------- lists ----------
/** The list with the item at `from` moved to `to` (both clamped). A new array; the old one is untouched. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const t = Math.max(0, Math.min(out.length - 1, to));
  const [x] = out.splice(from, 1);
  out.splice(t, 0, x);
  return out;
}
/** Days still called "Day N" get their new place's number; a day the developer named himself keeps its name. */
export function renumberDays(days: FitDay[]): FitDay[] {
  return days.map((d, i) => (/^day\s*\d+$/i.test(d.name.trim()) && d.name !== `Day ${i + 1}` ? { ...d, name: `Day ${i + 1}` } : d));
}
export function blankDays(n: number, start = 1): FitDay[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => ({ id: uidF(), name: `Day ${start + i}`, title: null, exercises: [] }));
}
/** "New program" and "Build it myself": four empty days called My program. */
export function blankProgram(name = "My program", days = 4): Omit<FitProgram, "createdAt" | "updatedAt"> {
  return { name, days: blankDays(days), source: "manual" };
}
/** Which day to show after one is taken out: the one that slid into its place, else the new last one. */
export const indexAfterDelete = (index: number, lengthAfter: number) => (lengthAfter <= 0 ? -1 : Math.min(index, lengthAfter - 1));

// ---------- sets ----------
export const SETS_MIN = 1, SETS_MAX = 12;
/** More sets repeat the last one; fewer drop from the end. Each set's own reps and kg stay as they were. */
export function setCount(sets: FitTarget[], n: number): FitTarget[] {
  const k = Math.max(SETS_MIN, Math.min(SETS_MAX, Math.round(n)));
  if (k <= sets.length) return sets.slice(0, k);
  const last = sets[sets.length - 1] ?? { reps: 10, kg: null };
  return [...sets, ...Array.from({ length: k - sets.length }, () => ({ ...last }))];
}
/** True when every set has the same reps (or the same kg). */
export function allSame(sets: FitTarget[], key: "reps" | "kg"): boolean {
  return sets.every((s) => (key === "reps" ? s.reps === sets[0].reps && (s.repsMax ?? null) === (sets[0].repsMax ?? null) : s.kg === sets[0].kg));
}
/** One value for every set ("same for all"). */
export function setAll(sets: FitTarget[], key: "reps" | "kg", value: number | null): FitTarget[] {
  return sets.reduce((acc, _, i) => setAt(acc, i, key, value), sets);
}
/** One set's reps or kg. A rep range ("8-10") keeps its top only while it is still above the new reps. */
export function setAt(sets: FitTarget[], i: number, key: "reps" | "kg", value: number | null): FitTarget[] {
  return sets.map((s, j) => {
    if (j !== i) return s;
    if (key === "kg") return { ...s, kg: value };
    const max = s.repsMax != null && value != null && s.repsMax > value ? s.repsMax : null;
    const out: FitTarget = { ...s, reps: value };
    if (s.repsMax !== undefined || max != null) out.repsMax = max;
    return out;
  });
}
export const REPS_MIN = 1, REPS_MAX = 100;
export const clampReps = (r: number) => Math.max(REPS_MIN, Math.min(REPS_MAX, Math.round(r)));
/** A weight step with the plus and minus buttons, never below zero, kept to two decimals. */
export function stepKg(kg: number | null, by: number): number {
  return Math.max(0, Math.round(((kg ?? 0) + by) * 100) / 100);
}

// ---------- typed numbers ----------
/** "22,5", "22.5 kg", " 20 " all read as kg. Empty or silly is null. */
export function parseKg(text: string): number | null {
  const m = text.replace(",", ".").match(/\d+(\.\d+)?|\.\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n >= 0 && n <= 1000 ? Math.round(n * 100) / 100 : null;
}
export function parseReps(text: string): number | null {
  const m = text.match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= REPS_MIN && n <= REPS_MAX ? n : null;
}

// ---------- the card's plain words ----------
/** "20 kg each", or each set's kg when they differ ("50, 52.5, 52.5 kg"). Empty when no weight is set. */
export function weightLine(ex: Pick<FitPlanEx, "sets" | "perSide">): string {
  const kgs = ex.sets.map((s) => s.kg);
  if (!kgs.length || kgs.every((k) => k == null)) return "";
  const each = ex.perSide ? " each" : "";
  if (kgs.every((k) => k === kgs[0])) return `${fmtKg(kgs[0])} kg${each}`;
  return `${kgs.map((k) => (k == null ? "?" : fmtKg(k))).join(", ")} kg${each}`;
}
/** Rest in words a beginner reads at a glance: "2 min", "1:30". */
export const restWords = (s: number) => (s % 60 === 0 ? `${s / 60} min` : fmtClock(s));
/** The one line hint under the compound or isolation choice. */
export function kindHint(kind: FitKind | undefined, prefs?: FitPrefs | null): string {
  if (kind === "isolation") return `Isolation: works one muscle, rest ${restWords(clampRest(prefs?.restIsolation ?? 90))}`;
  return `Compound: works several muscles, rest ${restWords(clampRest(prefs?.restCompound ?? 120))}`;
}
/** The rest chips (seconds). Anything else is "Custom". */
export const REST_CHOICES = [90, 120, 180] as const;
export const nudgeRest = (secs: number, by: number) => clampRest(secs + by);
/** A free text exercise ("Add my own"): three sets of ten, no weight yet, RIR 2. */
export function ownEx(name: string, kind: FitKind, sets = 3): FitPlanEx {
  return { id: uidF(), exId: null, name: name.trim() || "My exercise", kind, perSide: false, step: 2.5, rest: null, rir: 2, note: null, sets: Array.from({ length: Math.max(SETS_MIN, Math.min(SETS_MAX, sets)) }, () => ({ reps: 10, kg: null })) };
}
/** Same name, ignoring case, spaces and marks: is a renamed exercise still the library one? */
export const sameName = (a: string, b: string) => norm(a) === norm(b);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function programSummary(p: Pick<FitProgram, "days">): string {
  const ex = p.days.reduce((n, d) => n + d.exercises.length, 0);
  return `${p.days.length} ${p.days.length === 1 ? "day" : "days"} · ${ex} ${ex === 1 ? "exercise" : "exercises"}`;
}

// ---------- import ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Trainer plan, week 2" when the week is known, else "Trainer plan, 31 Oct". */
export function importName(week: number | null | undefined, today: string): string {
  if (week && week > 0) return `Trainer plan, week ${week}`;
  const [, m, d] = today.split("-").map(Number);
  return `Trainer plan, ${d} ${MONTHS[(m || 1) - 1]}`;
}
/** Plain word checks on what the sheet gave, on top of the parser's own warnings. */
export function planWarnings(p: Pick<FitProgram, "days">): string[] {
  const out: string[] = [];
  if (!p.days.length) { out.push("I could not find DAY 1, DAY 2 and so on. Copy from the DAY 1 cell down, so the day names come too."); return out; }
  for (const d of p.days) if (!d.exercises.length) out.push(`${d.name} has no exercises.`);
  const noReps = p.days.flatMap((d) => d.exercises.filter((e) => e.sets.some((s) => s.reps == null)).map((e) => e.name));
  if (noReps.length) out.push(`I could not read the reps for: ${noReps.join(", ")}. You can fix them after saving.`);
  const noKg = p.days.flatMap((d) => d.exercises.filter((e) => e.sets.every((s) => s.kg == null)).map((e) => e.name));
  if (noKg.length) out.push(`No weight given for: ${noKg.join(", ")}. You can pick it in the gym.`);
  return out;
}

// ---------- export ----------
type Dated = { id: string; data: FitWorkout };
export interface WeekPick { programId: string | null; week: number; days: number; last: string }
/** Every week with at least one set done, per program, newest first. */
export function weekList(workouts: Dated[]): WeekPick[] {
  const m = new Map<string, WeekPick>();
  for (const w of workouts) {
    if (!w.data.exercises.some((e) => !e.removed && e.sets.some((s) => s.done && !s.gone))) continue;
    const k = `${w.data.programId ?? ""}|${w.data.week}`;
    const cur = m.get(k);
    if (!cur) m.set(k, { programId: w.data.programId, week: w.data.week, days: 1, last: w.data.startedAt });
    else { cur.days++; if (w.data.startedAt > cur.last) cur.last = w.data.startedAt; }
  }
  return [...m.values()].sort((a, b) => b.last.localeCompare(a.last));
}
export const csvName = (week: number) => `PS week ${week}.csv`;
/** What a row of the trainer's layout is, so the preview can draw it like the sheet. */
export function rowKind(r: string[]): "day" | "head" | "gap" | "ex" {
  if (r.every((c) => !c)) return "gap";
  if (r[0] === "Exercise" && r[1] === "Sets and Reps") return "head";
  if (r.slice(1).every((c) => !c)) return "day";   // only the first cell: a day's name (exercise rows fill every cell)
  return "ex";
}

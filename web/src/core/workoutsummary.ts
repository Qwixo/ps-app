// Workout summary on the Mac (PS 1.60, item 27). After a workout was finished on the phone, the first time the person
// is back at the Mac and using it, the island says "Workout complete" and shows a small summary. The maths is here
// (best set, up, same or down against the last time, days ago, total time); ps-mac WorkoutSummaryCore.swift decides when
// it shows and how it is laid out. Once per workout, never again on another Mac: the mark (`macShown`) is saved on the
// workout itself, which the vault syncs and merges (core/fitness.ts mergeWorkout), so another Mac that has seen the mark
// sends nothing. Pure: no vault, no clock.
import { exKey, lastTime, e1rm, fmtKg, rirLabel, type FitLogEx, type FitSet, type FitWorkout } from "./fitness.ts";

type Dated = { id: string; data: FitWorkout };

export interface SummaryPrefs { on: boolean }
export function summaryPrefs(v: unknown): SummaryPrefs { return { on: !(v && typeof v === "object" && (v as Record<string, unknown>).on === false) }; }

export const SUMMARY_WORDS = {
  settingOn: "Workout summary on the Mac",
  hint: "After a workout you finished on your phone, the first time you are back at the Mac, the island congratulates you and shows what you did.",
  title: "Workout complete",
  nice: "Nice work",
  gym: "In the gym",
  first: "First time",
} as const;

/** A workout counts as just finished for this long (a summary is for the same day, not last week's workout). */
export const SUMMARY_WINDOW_MS = 12 * 3600_000;
/** Most exercises listed (the rest are counted). */
export const SUMMARY_MAX_ROWS = 6;

export type Trend = "up" | "same" | "down" | "new";
export interface SummaryRow {
  name: string;
  sets: number;
  bestKg: number | null;
  bestReps: number | null;
  /** The best set's RIR, or the lowest RIR of the exercise's sets ("4+" for 4), as the app shows it. */
  rir: string | null;
  /** The person's own set comments, joined (the first two). */
  comment: string | null;
  trend: Trend;
  /** Whole days since the last time this exercise was done; null when there was no last time. */
  daysAgo: number | null;
}
export interface WorkoutSummary {
  id: string;
  title: string;
  minutes: number;
  rows: SummaryRow[];
  /** Exercises beyond the listed rows. */
  more: number;
  sets: number;
}

const workingSets = (e: FitLogEx): FitSet[] => e.sets.filter((s) => s.done && !s.warm && !s.gone && !s.drop && s.kg != null && (s.reps ?? 0) > 0);

/** The best set: the heaviest, then the most reps at that weight. Drop and warm up sets never count. */
export function bestSet(sets: FitSet[]): FitSet | null {
  let best: FitSet | null = null;
  for (const s of sets) {
    if (s.done === false || s.warm || s.gone || s.drop || s.kg == null || !(s.reps && s.reps > 0)) continue;
    if (!best || s.kg > (best.kg ?? 0) || (s.kg === best.kg && (s.reps ?? 0) > (best.reps ?? 0))) best = s;
  }
  return best;
}

/** Up, same or down: the best set now against the best set last time, by estimated one rep max, within a small step
 *  (under 1 percent, or 0.5 kg, is "same", so a rounding wobble never reads as progress). new: no last time. */
export function trendOf(now: FitSet | null, before: FitSet | null): Trend {
  if (!now) return "same";
  if (!before) return "new";
  const a = e1rm(now.kg ?? 0, now.reps ?? 0), b = e1rm(before.kg ?? 0, before.reps ?? 0);
  const tol = Math.max(0.5, b * 0.01);
  return a - b > tol ? "up" : b - a > tol ? "down" : "same";
}

const DAY = 86_400_000;
/** Whole calendar days between two YYYY-MM-DD days (never negative). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z"), b = Date.parse(to + "T00:00:00Z");
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / DAY)) : 0;
}
/** "today", "yesterday", "5 days ago". */
export function agoWords(n: number): string { return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`; }

/** Minutes in the gym: start to finish, at least 1. */
export function gymMinutes(w: Pick<FitWorkout, "startedAt" | "endedAt">): number {
  const a = Date.parse(w.startedAt), b = Date.parse(w.endedAt || "");
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? Math.max(1, Math.round((b - a) / 60_000)) : 0;
}

const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** The summary of one finished workout. `all` is every workout (the last time of each exercise comes from the others). */
export function summarize(id: string, w: FitWorkout, all: Dated[]): WorkoutSummary | null {
  const rows: SummaryRow[] = [];
  let sets = 0;
  for (const e of [...w.exercises].sort((x, y) => (x.order ?? 0) - (y.order ?? 0))) {
    if (e.removed) continue;
    const ws = workingSets(e);
    if (!ws.length) continue;
    sets += ws.length;
    const best = bestSet(ws)!;
    const prev = lastTime(exKey(e), all, id);
    const before = prev ? bestSet(prev.sets) : null;
    const rirs = ws.map((s) => s.rir).filter((r): r is number => r != null);
    const comments = ws.map((s) => clip(s.comment || "", 80)).filter(Boolean);
    rows.push({
      name: clip(e.name, 40),
      sets: ws.length,
      bestKg: best.kg,
      bestReps: best.reps,
      rir: best.rir != null ? rirLabel(best.rir) : rirs.length ? rirLabel(Math.min(...rirs)) : null,
      comment: comments.length ? comments.slice(0, 2).join(" / ") : null,
      trend: trendOf(best, before),
      daysAgo: prev ? daysBetween(prev.workout.data.date, w.date) : null,
    });
  }
  if (!rows.length) return null;
  return { id, title: clip(w.dayName || "Workout", 30), minutes: gymMinutes(w), rows: rows.slice(0, SUMMARY_MAX_ROWS), more: Math.max(0, rows.length - SUMMARY_MAX_ROWS), sets };
}

/** The workout waiting for its summary on a Mac, or null: finished on the phone, within the last 12 hours, with at least one
 *  done set, not yet shown on any Mac (the mark on the workout), and the switch on. The newest one only. */
export function pendingSummary(all: Dated[], now: number, prefs: SummaryPrefs): WorkoutSummary | null {
  if (!prefs.on) return null;
  let pick: Dated | null = null;
  for (const d of all) {
    const w = d.data, end = Date.parse(w.endedAt || "");
    if (w.device !== "phone" || !Number.isFinite(end) || w.macShown) continue;
    if (now - end > SUMMARY_WINDOW_MS || end > now + 60_000) continue;
    if (!pick || (w.endedAt || "") > (pick.data.endedAt || "")) pick = d;
  }
  return pick ? summarize(pick.id, pick.data, all) : null;
}

/** The workout with its Mac mark set (once: an existing mark is kept). */
export function withShown(w: FitWorkout, now: string): FitWorkout { return w.macShown ? w : { ...w, macShown: now, at: now }; }

/** A weight and reps as the island says them: "80 kg x 8". */
export function bestLine(r: Pick<SummaryRow, "bestKg" | "bestReps">): string {
  return `${r.bestKg == null ? "" : fmtKg(r.bestKg) + " kg"} x ${r.bestReps ?? 0}`.trim();
}

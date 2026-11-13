// PS Fitness: the one door to the exercise library and the trainer's sheet, so the screens never depend
// on how those are built. The research session's modules (src/fitness/library.ts, src/fitness/sheet.ts)
// sit behind it; this file turns their shapes into the program and workout shapes of core/fitness.ts.
import { exKey, uidF, type FitKind, type FitPlanEx, type FitProgram, type FitWorkout } from "../core/fitness.ts";
import { LIBRARY, MUSCLE_LABEL, getExercise, matchExercise, searchExercises } from "./library.ts";
import { exportWeekRows, importTrainerText, rowsToCsv, rowsToTsv } from "./sheet.ts";
import type { Exercise, LoggedDay } from "./types.ts";

export interface LibEx { id: string; name: string; kind: FitKind; equipment: string; muscles: string[]; perSide: boolean; step: number; rest: number; cue?: string; timed?: boolean; bodyweight?: boolean }

const toLib = (e: Exercise): LibEx => ({
  id: e.id, name: e.name, kind: e.kind, equipment: e.equipment, muscles: e.muscles.map((m) => MUSCLE_LABEL[m] ?? m),
  perSide: e.perSide, step: e.step, rest: e.restSec, cue: e.cue, timed: e.timed, bodyweight: e.bodyweight,
});
export const LIB: LibEx[] = LIBRARY.map(toLib);
export function libById(id: string | null | undefined): LibEx | null { const e = getExercise(id); return e ? toLib(e) : null; }
export function searchLib(q: string, limit = 20): LibEx[] { return (q.trim() ? searchExercises(q, limit) : LIBRARY.slice(0, limit)).map(toLib); }
export function findLib(text: string): LibEx | null { const m = matchExercise(text.replace(/^\s*e\.?\s?g\.?\s*:?\s*/i, "")); return m ? toLib(m.exercise) : null; }

/** A planned exercise from the library (sets x reps filled with a sensible start). */
export function planFromLib(x: LibEx, sets = 3, reps = 10, kg: number | null = null): FitPlanEx {
  return { id: uidF(), exId: x.id, name: x.name, kind: x.kind, perSide: x.perSide, step: x.step, rest: null, rir: 2, sets: Array.from({ length: sets }, () => ({ reps, kg })) };
}

/** A plan in a sealed package from Claude (App.tsx op "fitPlans"): the developer's own words kept as he wrote them.
 *  A library id is kept only when it is a real one (rest, weight step and form tips then work); anything
 *  else stays free text. No sets are made up: an exercise with none gets them in the gym. */
export interface PlanIn { name: string; days: { name?: string | null; title?: string | null; exercises: { name: string; exId?: string | null; note?: string | null }[] }[] }
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
export function programFromPlan(p: PlanIn): Omit<FitProgram, "createdAt" | "updatedAt"> | null {
  const name = clip(p?.name, 120);
  if (!name || !Array.isArray(p.days) || !p.days.length || p.days.length > 14) return null;
  const days: FitProgram["days"] = p.days.map((d, i) => ({
    id: uidF(), name: clip(d?.name, 40) || `Day ${i + 1}`, title: clip(d?.title, 80) || null,
    exercises: (Array.isArray(d?.exercises) ? d.exercises : []).slice(0, 40).map((e): FitPlanEx | null => {
      const n = clip(e?.name, 120);
      if (!n) return null;
      const x = libById(typeof e.exId === "string" ? e.exId : null);
      return { id: uidF(), exId: x?.id ?? null, name: n, kind: x?.kind, perSide: x?.perSide ?? false, step: x?.step ?? null, rest: null, rir: null, sets: [], note: clip(e.note, 400) || null };
    }).filter((e): e is FitPlanEx => !!e),
  }));
  return { name, days, source: "manual" };
}

/** The trainer's sheet, pasted (copy the cells in Google Sheets: tab separated) or as CSV. Rest is left
 *  to the developer's defaults (2 min compound, 90 s isolation) unless the sheet has its own Rest column. */
export function importSheet(text: string, name = "Trainer plan"): { program: Omit<FitProgram, "createdAt" | "updatedAt">; warnings: string[] } {
  const p = importTrainerText(text);
  const days: FitProgram["days"] = p.days.map((d) => ({
    id: uidF(), name: `Day ${d.index}`, title: d.title && !/^day\s*\d+$/i.test(d.title) ? d.title : null,
    exercises: d.exercises.map((x): FitPlanEx => {
      const lib = getExercise(x.exerciseId);
      // Only a Rest column in the sheet sets the rest; else the developer's defaults (Fitness settings) apply.
      const sheetRest = x.restSec && x.restSec !== (lib?.restSec ?? x.restSec) ? x.restSec : null;
      return {
        id: uidF(), exId: x.exerciseId, name: lib?.name ?? x.name, kind: lib?.kind, perSide: x.perSide, step: lib?.step ?? null,
        rir: x.rir ? x.rir.min : null, rest: sheetRest, note: [x.note, x.weight.note].filter(Boolean).join(". ") || null,
        sets: (x.sets.length ? x.sets : [{}, {}, {}]).map((s) => ({ reps: s.reps ?? null, repsMax: s.repsMax ?? null, kg: s.kg ?? null })),
      };
    }),
  }));
  return { program: { name, days, source: "sheet" }, warnings: p.warnings };
}

/** One logged week in the trainer's layout (DAY blocks: Exercise | Sets and Reps | Weight | RIR). */
export function exportWeek(workouts: { id: string; data: FitWorkout }[], programId: string | null, week: number): { rows: string[][]; tsv: string; csv: string } {
  const ws = workouts.filter((w) => w.data.programId === programId && w.data.week === week).sort((a, b) => a.data.startedAt.localeCompare(b.data.startedAt));
  const days: LoggedDay[] = ws.map((w) => ({
    name: w.data.dayName.toUpperCase(), date: w.data.date,
    exercises: w.data.exercises.filter((e) => !e.removed && e.sets.some((s) => s.done && !s.gone)).map((e) => ({
      name: e.name, exerciseId: e.exId, perSide: e.perSide,
      sets: e.sets.filter((s) => s.done && !s.gone).map((s) => ({ kg: s.kg, reps: s.reps, rir: s.rir, warmup: s.warm, ...(s.drop ? { drop: true } : {}) })),
    })),
  }));
  const rows = exportWeekRows(days, { title: `Week ${week}`, dates: true });
  return { rows, tsv: rowsToTsv(rows), csv: rowsToCsv(rows) };
}
export { exKey };

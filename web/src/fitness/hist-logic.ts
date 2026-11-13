// PS Fitness, History and Settings: pure helpers (no React, no vault), tested in tests/fitness-hist.test.ts.
// Dates and week groups, durations, numbers with thousands separators, the chart's scale and path, and
// "was this a new best at the time" for an old workout. The rules themselves live in core/fitness.ts.
import { bestsInWorkout, exKey, fmtKg, plusDaysF, weekOf, type BestKind, type FitLogEx, type FitWorkout } from "../core/fitness.ts";

type Dated = { id: string; data: FitWorkout };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const utc = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); };

/** "28 Oct" */
export function fmtDayShort(day: string) { const d = utc(day); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; }
/** "Tue 28 Oct" */
export function fmtDay(day: string) { const d = utc(day); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; }

/** Whole numbers with commas: 4320 -> "4,320". Not toLocaleString, so every device writes the same. */
export function fmtThousands(n: number) {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n), s = String(Math.abs(r));
  return (r < 0 ? "-" : "") + s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
/** A volume in kg as the developer reads it: "4,320 kg". */
export const fmtVolume = (kg: number) => `${fmtThousands(kg)} kg`;

/** How long a workout took: "48 min", "1 h 5 min", "2 h". Empty when it never finished. */
export function fmtDuration(startedAt: string, endedAt?: string | null) {
  if (!endedAt) return "";
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** "1 week" / "4 weeks" */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- the week at a glance ----------
export interface WeekDot { date: string; letter: string; trained: boolean; today: boolean; future: boolean }
/** Monday to Sunday of the week that holds `today`, each day marked trained, today or still to come. */
export function weekDots(today: string, trained: string[]): WeekDot[] {
  const mon = weekOf(today), set = new Set(trained);
  return ["M", "T", "W", "T", "F", "S", "S"].map((letter, i) => {
    const date = plusDaysF(mon, i);
    return { date, letter, trained: set.has(date), today: date === today, future: date > today };
  });
}

// ---------- workouts by week ----------
export interface WeekGroup<T> { monday: string; label: string; items: T[] }
/** Newest first, one group per week: "This week", "Last week", then "Week of 12 Oct". */
export function groupByWeek<T extends Dated>(workouts: T[], today: string): WeekGroup<T>[] {
  const thisMon = weekOf(today), lastMon = plusDaysF(thisMon, -7);
  const sorted = [...workouts].sort((a, b) => b.data.date.localeCompare(a.data.date) || b.data.startedAt.localeCompare(a.data.startedAt));
  const out: WeekGroup<T>[] = [];
  for (const w of sorted) {
    const monday = weekOf(w.data.date);
    let g = out[out.length - 1];
    if (!g || g.monday !== monday) {
      const label = monday === thisMon ? "This week" : monday === lastMon ? "Last week" : `Week of ${fmtDayShort(monday)}`;
      g = { monday, label, items: [] };
      out.push(g);
    }
    g.items.push(w);
  }
  return out;
}

// ---------- bests, as they were at the time ----------
/** New bests in an old workout, judged against the workouts BEFORE it (a later, heavier day does not take
 *  the gold off an earlier one). */
export function bestsThen(ex: FitLogEx, w: Dated, workouts: Dated[]): Map<string, BestKind> {
  const before = workouts.filter((x) => x.id === w.id || x.data.startedAt < w.data.startedAt);
  return bestsInWorkout(ex, w.id, before);
}
/** How many new bests a workout had (for the gold mark on its row). */
export function bestCount(w: Dated, workouts: Dated[]) {
  let n = 0;
  for (const e of w.data.exercises) if (!e.removed) n += bestsThen(e, w, workouts).size;
  return n;
}
export const BEST_WORDS: Record<BestKind, string> = { kg: "Heaviest yet", e1rm: "Best estimated max", reps: "Most reps at this weight" };

// ---------- one exercise's sessions ----------
/** The last few times an exercise was done, newest first, each as one plain line of sets: "52.5 x 10, 55 x 7". */
export function sessionLines(key: string, workouts: Dated[], n = 5): { workoutId: string; date: string; line: string }[] {
  const out: { workoutId: string; date: string; line: string; at: string }[] = [];
  for (const w of workouts) {
    const sets = w.data.exercises.filter((e) => !e.removed && exKey(e) === key)
      .flatMap((e) => e.sets.filter((s) => s.done && !s.warm && !s.gone && (s.kg != null || s.reps != null)).map((s) => ({ s, each: !!e.perSide })));
    if (!sets.length) continue;
    const line = sets.map(({ s, each }) => (s.kg != null && s.reps != null ? `${fmtKg(s.kg)}${each ? " each" : ""} x ${s.reps}` : s.kg != null ? `${fmtKg(s.kg)} kg` : `${s.reps} reps`) + (s.drop ? " DROP" : "")).join(", ");
    out.push({ workoutId: w.id, date: w.data.date, line, at: w.data.startedAt });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, n).map(({ workoutId, date, line }) => ({ workoutId, date, line }));
}

// ---------- the chart ----------
/** Tidy axis steps (1, 2, 2.5 or 5 times a power of ten) that cover min..max in about `count` steps. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  if (min > max) [min, max] = [max, min];
  const raw = (max - min) / Math.max(1, count);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let t = lo; t <= hi + step / 1000; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}
export interface ChartPoint { x: number; y: number; v: number }
export interface Chart { points: ChartPoint[]; ticks: { v: number; y: number }[]; line: string; area: string; best: number; lo: number; hi: number }
/** Places values in a w x h box (with `pad` around the plot): x spread evenly oldest to newest, y on tidy
 *  ticks. `best` is the index of the highest value (the newest one when two are equal). */
export function chartScale(values: number[], w: number, h: number, pad: { l: number; r: number; t: number; b: number }): Chart {
  const ticksV = values.length ? niceTicks(Math.min(...values), Math.max(...values), 4) : [];
  const lo = ticksV[0] ?? 0, hi = ticksV[ticksV.length - 1] ?? 1;
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const yOf = (v: number) => pad.t + ph - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * ph;
  const xOf = (i: number) => (values.length < 2 ? pad.l + pw / 2 : pad.l + (i / (values.length - 1)) * pw);
  const points = values.map((v, i) => ({ x: r1(xOf(i)), y: r1(yOf(v)), v }));
  let best = -1;
  values.forEach((v, i) => { if (best < 0 || v >= values[best]) best = i; });
  const line = points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  const base = r1(pad.t + ph);
  const area = points.length > 1 ? `${line} L${points[points.length - 1].x} ${base} L${points[0].x} ${base} Z` : "";
  return { points, ticks: ticksV.map((v) => ({ v, y: r1(yOf(v)) })), line, area, best, lo, hi };
}
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Which points get a date under them: the first, the last, and evenly between, at most `max`. */
export function labelIndexes(n: number, max = 5): number[] {
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>();
  for (let k = 0; k < max; k++) out.add(Math.round((k * (n - 1)) / (max - 1)));
  return [...out].sort((a, b) => a - b);
}
/** A tiny line for a list row (values oldest first). */
export function sparkPath(values: number[], w: number, h: number) {
  if (values.length < 2) return "";
  return chartScale(values, w, h, { l: 2, r: 2, t: 3, b: 3 }).line;
}

// ---------- typing numbers ----------
/** "22,5" or "22.5" -> 22.5; blank -> null; anything else (or below zero) -> undefined (keep the old value). */
export function parseKgInput(s: string): number | null | undefined {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n < 1000 ? Math.round(n * 100) / 100 : undefined;
}
/** Whole reps: blank -> null, nonsense -> undefined. */
export function parseRepsInput(s: string): number | null | undefined {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 && n < 1000 ? n : undefined;
}

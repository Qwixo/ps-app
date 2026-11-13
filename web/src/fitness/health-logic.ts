// PS Fitness, Health history and export (V1.44, a friend's request passed on by the developer: "be able to export the data and
// see history, like the sleep data, fitness data ... some people note everything down and then tell that to claude and
// use him as personal trainer ... to be able to see it nicely, day by day and export it").
// Pure (no React, no vault), tested in tests/fitness-health.test.ts: the day by day view of sleep, workouts and other
// activities, the month calendar, week and month summaries, current streaks, the sleep window chart, and the three
// exports. Every export is made on this device from the open vault; nothing here sends anything anywhere.
//
// The JSON export carries `records` in the same { id, kind, data } shape as the local first "Export my data" backup
// (core/backup.ts on the local-first branch), so it can be read back in by that importer later. Its `days` are open
// ended: a later kind (food, if it ever comes) adds one more field per day without changing the others.
import { addDay, breaksMins, clampTarget, clockIn, clockMedian, fmtMins, sleepMins, streak as sleepStreak, byDay, type SleepLog } from "../core/sleep.ts";
import {
  exKey, fmtKg, isBest, rirLabel, targetLine, weekOf, weekStats, workoutSetsDone, workoutVolume, e1rm,
  type BestKind, type Bests, type FitLogEx, type FitSet, type FitWorkout,
} from "../core/fitness.ts";
import { actName, fmtKm, fmtPace, fmtTime, type ActKind, type FitActivity } from "../core/activity.ts";

export type Dated = { id: string; data: FitWorkout };
export type ActDated = { id: string; data: FitActivity };
export type SleepDated = { id: string; log: SleepLog };
/** Everything the history reads. `target` is the sleep target in minutes, `tz` the zone clock times are shown in. */
export interface HealthData { workouts: Dated[]; sleeps: SleepDated[]; acts: ActDated[]; target?: number; weekGoal?: number; tz: string }
/** Which kinds an export holds. */
export interface Include { fitness: boolean; sleep: boolean; acts: boolean }
export const ALL: Include = { fitness: true, sleep: true, acts: true };

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const utc = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); };
const pad = (n: number) => String(n).padStart(2, "0");
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
/** "Mon 3 Nov 2026" */
export const fmtDayLong = (day: string) => { const d = utc(day); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`; };
/** "3 Nov 2026" */
export const fmtDate = (day: string) => { const d = utc(day); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`; };
const commas = (n: number) => { const r = Math.round(n); return (r < 0 ? "-" : "") + String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); };
const daysBetween = (from: string, to: string) => Math.round((utc(to).getTime() - utc(from).getTime()) / 864e5) + 1;
const inRange = (day: string, from: string, to: string) => day >= from && day <= to;

// ---------- months and the calendar ----------
/** "2026-11" for a date. */
export const monthOf = (day: string) => day.slice(0, 7);
/** The month n months away: addMonth("2026-01", -1) = "2025-12". */
export function addMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}
/** "November 2026" */
export const monthLabel = (month: string) => { const [y, m] = month.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
export const firstOfMonth = (month: string) => `${month}-01`;
export const lastOfMonth = (month: string) => addDay(firstOfMonth(addMonth(month, 1)), -1);
/** The month as weeks of 7 cells, Monday first; cells outside the month are null. */
export function monthGrid(month: string): (string | null)[][] {
  const first = firstOfMonth(month), last = lastOfMonth(month);
  const out: (string | null)[][] = [];
  for (let mon = weekOf(first); mon <= last; mon = addDay(mon, 7)) {
    out.push(Array.from({ length: 7 }, (_, i) => { const d = addDay(mon, i); return d >= first && d <= last ? d : null; }));
  }
  return out;
}

// ---------- ranges ----------
export type RangeKey = "week" | "lastweek" | "month" | "lastmonth" | "4w" | "3m" | "all";
export const RANGES: { k: RangeKey; t: string }[] = [
  { k: "week", t: "This week" }, { k: "lastweek", t: "Last week" }, { k: "month", t: "This month" }, { k: "lastmonth", t: "Last month" },
  { k: "4w", t: "Last 4 weeks" }, { k: "3m", t: "Last 3 months" }, { k: "all", t: "Everything" },
];
/** The oldest date anything was logged, or null. */
export function firstLogged(d: HealthData): string | null {
  let first: string | null = null;
  const see = (day: string) => { if (!first || day < first) first = day; };
  for (const w of d.workouts) if (workoutSetsDone(w.data) > 0) see(w.data.date);
  for (const s of d.sleeps) see(s.log.day);
  for (const a of d.acts) see(a.data.date);
  return first;
}
/** The dates a range covers, today included. */
export function rangeFor(k: RangeKey, today: string, d?: HealthData): { from: string; to: string } {
  const mon = weekOf(today), month = monthOf(today);
  switch (k) {
    case "week": return { from: mon, to: today };
    case "lastweek": return { from: addDay(mon, -7), to: addDay(mon, -1) };
    case "month": return { from: firstOfMonth(month), to: today };
    case "lastmonth": return { from: firstOfMonth(addMonth(month, -1)), to: lastOfMonth(addMonth(month, -1)) };
    case "4w": return { from: addDay(today, -27), to: today };
    case "3m": return { from: addDay(today, -90), to: today };
    case "all": { const f = d ? firstLogged(d) : null; return { from: f && f < today ? f : today, to: today }; }
  }
}
/** "3 Nov 2026 to 9 Nov 2026", or one date. */
export const rangeWords = (from: string, to: string) => (from === to ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`);

// ---------- one day ----------
export interface HealthDay {
  date: string;
  sleep: SleepLog | null; sleepId: string | null;
  mins: number | null;                // time asleep
  asleep: string | null; wake: string | null;   // clock times in the sleep's own zone
  onTarget: boolean;
  workouts: Dated[]; sets: number; volume: number;
  acts: FitActivity[]; km: number;
  any: boolean;                       // anything logged that day
}
const liveWorkout = (w: Dated) => workoutSetsDone(w.data) > 0;
/** Every date from `from` to `to` (oldest first), with what was logged on it. */
export function healthDays(d: HealthData, from: string, to: string): HealthDay[] {
  const target = clampTarget(d.target);
  const sleeps = byDay(d.sleeps.map((s) => s.log));
  const sleepIds = new Map<string, string>();
  for (const s of d.sleeps) if (sleeps.get(s.log.day) === s.log) sleepIds.set(s.log.day, s.id);
  const works = new Map<string, Dated[]>(), acts = new Map<string, FitActivity[]>();
  for (const w of d.workouts) if (inRange(w.data.date, from, to) && liveWorkout(w)) works.set(w.data.date, [...(works.get(w.data.date) ?? []), w]);
  for (const a of d.acts) if (inRange(a.data.date, from, to)) acts.set(a.data.date, [...(acts.get(a.data.date) ?? []), a.data]);
  const out: HealthDay[] = [];
  if (from > to) return out;
  for (let day = from, i = 0; day <= to && i < 4000; day = addDay(day, 1), i++) {
    const sl = sleeps.get(day) ?? null;
    const ws = (works.get(day) ?? []).sort((a, b) => a.data.startedAt.localeCompare(b.data.startedAt));
    const as = acts.get(day) ?? [];
    const mins = sl ? sleepMins(sl) : null;
    out.push({
      date: day, sleep: sl, sleepId: sleepIds.get(day) ?? null, mins,
      asleep: sl ? clockIn(Date.parse(sl.start), sl.tz) : null, wake: sl ? clockIn(Date.parse(sl.end), sl.tz) : null,
      onTarget: mins != null && mins >= target,
      workouts: ws, sets: ws.reduce((n, w) => n + workoutSetsDone(w.data), 0), volume: ws.reduce((n, w) => n + workoutVolume(w.data), 0),
      acts: as, km: Math.round(as.reduce((n, a) => n + a.km, 0) * 100) / 100,
      any: !!sl || ws.length > 0 || as.length > 0,
    });
  }
  return out;
}

// ---------- personal bests in a range ----------
export interface NewBest { date: string; workoutId: string; name: string; key: string; kind: BestKind; kg: number; reps: number; perSide: boolean }
const KIND_RANK: Record<BestKind, number> = { kg: 3, e1rm: 2, reps: 1 };
/** New personal bests set from `from` to `to`, one per exercise per workout (its strongest flagged set), oldest first.
 *  Judged in one pass against everything before, the same rule as the gym screen (core/fitness.ts isBest). */
export function newBests(workouts: Dated[], from: string, to: string): NewBest[] {
  const prior = new Map<string, Bests>(), had = new Set<string>();
  const out: NewBest[] = [];
  for (const w of [...workouts].sort((a, b) => a.data.startedAt.localeCompare(b.data.startedAt))) {
    const seenHere = new Set<string>();
    for (const e of w.data.exercises) {
      if (e.removed) continue;
      const k = exKey(e);
      const b = prior.get(k) ?? { kg: 0, e1rm: 0, reps: {}, volume: 0 };
      prior.set(k, b);
      let top: NewBest | null = null;
      for (const s of e.sets) {
        if (s.gone) continue;
        const kind = isBest(s, b, had.has(k));
        if (kind && inRange(w.data.date, from, to)) {
          const cand: NewBest = { date: w.data.date, workoutId: w.id, name: e.name, key: k, kind, kg: s.kg!, reps: s.reps!, perSide: !!e.perSide };
          if (!top || KIND_RANK[kind] > KIND_RANK[top.kind] || (KIND_RANK[kind] === KIND_RANK[top.kind] && e1rm(cand.kg, cand.reps) > e1rm(top.kg, top.reps))) top = cand;
        }
        if (s.done && !s.warm && s.reps && s.kg != null) {
          b.kg = Math.max(b.kg, s.kg); b.e1rm = Math.max(b.e1rm, e1rm(s.kg, s.reps));
          b.reps[fmtKg(s.kg)] = Math.max(b.reps[fmtKg(s.kg)] ?? 0, s.reps);
          seenHere.add(k);
        }
      }
      if (top) out.push(top);
    }
    for (const k of seenHere) had.add(k);
  }
  return out;
}
export const BEST_SHORT: Record<BestKind, string> = { kg: "heaviest yet", e1rm: "strongest set yet", reps: "most reps at this weight" };

// ---------- rest between sets ----------
/** The rest before each set in seconds, from when the sets were ticked (null for the first, or a gap over 15 min). */
export function restBefore(ex: Pick<FitLogEx, "sets">): Map<string, number> {
  const done = ex.sets.filter((s) => s.done && !s.gone && s.doneAt && Number.isFinite(Date.parse(s.doneAt)))
    .sort((a, b) => Date.parse(a.doneAt!) - Date.parse(b.doneAt!));
  const out = new Map<string, number>();
  for (let i = 1; i < done.length; i++) {
    const g = Math.round((Date.parse(done[i].doneAt!) - Date.parse(done[i - 1].doneAt!)) / 1000);
    if (g >= 10 && g <= 15 * 60) out.set(done[i].id, g);
  }
  return out;
}
/** The usual rest of an exercise (median of the gaps), or null. */
export function typicalRest(ex: Pick<FitLogEx, "sets">): number | null {
  const g = [...restBefore(ex).values()].sort((a, b) => a - b);
  if (!g.length) return null;
  return g.length % 2 ? g[(g.length - 1) / 2] : Math.round((g[g.length / 2 - 1] + g[g.length / 2]) / 2);
}

// ---------- summaries ----------
export interface WeekRow { monday: string; from: string; to: string; trained: number; workouts: number; sets: number; volume: number; nights: number; onTarget: number; avgSleep: number | null; km: number }
export interface HealthSummary {
  from: string; to: string; days: number;
  trained: number; workouts: number; sets: number; volume: number; trainMins: number;
  nights: number; onTarget: number; avgSleep: number | null; usualAsleep: string | null; usualWake: string | null;
  longest: { date: string; mins: number } | null; shortest: { date: string; mins: number } | null;
  acts: number; km: number; byKind: Partial<Record<ActKind, { n: number; km: number; secs: number }>>;
  bests: NewBest[];
  trainRun: number;    // most days trained in a row inside the range
  sleepRun: number;    // most nights on target in a row inside the range
  weeks: WeekRow[];
}
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
function longestRun(days: HealthDay[], ok: (d: HealthDay) => boolean) {
  let best = 0, cur = 0;
  for (const d of days) { cur = ok(d) ? cur + 1 : 0; best = Math.max(best, cur); }
  return best;
}
const workMins = (w: FitWorkout) => {
  if (!w.endedAt) return 0;
  const m = Math.round((Date.parse(w.endedAt) - Date.parse(w.startedAt)) / 60000);
  return Number.isFinite(m) && m > 0 && m < 12 * 60 ? m : 0;
};
/** One row per Monday to Sunday week the days touch (the first and last may be part weeks). */
export function weekRows(days: HealthDay[]): WeekRow[] {
  const out: { row: WeekRow; mins: number[] }[] = [];
  for (const d of days) {
    const monday = weekOf(d.date);
    let g = out[out.length - 1];
    if (!g || g.row.monday !== monday) { g = { row: { monday, from: d.date, to: d.date, trained: 0, workouts: 0, sets: 0, volume: 0, nights: 0, onTarget: 0, avgSleep: null, km: 0 }, mins: [] }; out.push(g); }
    const r = g.row;
    r.to = d.date;
    if (d.workouts.length) { r.trained++; r.workouts += d.workouts.length; r.sets += d.sets; r.volume = Math.round(r.volume + d.volume); }
    if (d.mins != null) { r.nights++; if (d.onTarget) r.onTarget++; g.mins.push(d.mins); }
    r.km = Math.round((r.km + d.km) * 100) / 100;
  }
  return out.map((g) => ({ ...g.row, avgSleep: avg(g.mins) }));
}
/** Week and month numbers for a range: training, sleep, other activities, new bests, the longest runs and each week. */
export function summarize(d: HealthData, from: string, to: string): HealthSummary {
  const days = healthDays(d, from, to);
  const slept = days.filter((x) => x.mins != null);
  const clocks = slept.map((x) => ({ a: x.asleep!, w: x.wake! }));
  const byKind: HealthSummary["byKind"] = {};
  let acts = 0, km = 0;
  for (const x of days) for (const a of x.acts) {
    acts++; km += a.km;
    const k = byKind[a.kind] ?? { n: 0, km: 0, secs: 0 };
    k.n++; k.km = Math.round((k.km + a.km) * 100) / 100; k.secs += a.secs; byKind[a.kind] = k;
  }
  const minsOf = slept.map((x) => x.mins!);
  const pick = (cmp: (a: number, b: number) => boolean) => slept.reduce<{ date: string; mins: number } | null>((b, x) => (!b || cmp(x.mins!, b.mins) ? { date: x.date, mins: x.mins! } : b), null);
  return {
    from, to, days: days.length,
    trained: days.filter((x) => x.workouts.length).length,
    workouts: days.reduce((n, x) => n + x.workouts.length, 0),
    sets: days.reduce((n, x) => n + x.sets, 0),
    volume: Math.round(days.reduce((n, x) => n + x.volume, 0)),
    trainMins: days.reduce((n, x) => n + x.workouts.reduce((m, w) => m + workMins(w.data), 0), 0),
    nights: slept.length, onTarget: slept.filter((x) => x.onTarget).length, avgSleep: avg(minsOf),
    usualAsleep: clockMedian(clocks.map((c) => c.a)), usualWake: clockMedian(clocks.map((c) => c.w)),
    longest: pick((a, b) => a > b), shortest: pick((a, b) => a < b),
    acts, km: Math.round(km * 100) / 100, byKind,
    bests: newBests(d.workouts, from, to),
    trainRun: longestRun(days, (x) => x.workouts.length > 0),
    sleepRun: longestRun(days, (x) => x.onTarget),
    weeks: weekRows(days),
  };
}

/** The streaks as of today: nights on target in a row, days trained in a row, weeks on the week goal in a row. */
export function streaksNow(d: HealthData, today: string): { sleep: number; trainDays: number; goalWeeks: number; goal: number } {
  const s = weekStats(d.workouts, today, d.weekGoal ?? 3);
  return { sleep: sleepStreak(byDay(d.sleeps.map((x) => x.log)), today, clampTarget(d.target)), trainDays: s.dayStreak, goalWeeks: s.streakWeeks, goal: s.goal };
}

// ---------- the sleep window chart (bed to wake as bars on a 24 hour clock) ----------
/** Where a 24 hour axis starts (minutes after midnight, on the hour) so the usual sleep sits in its middle. A day
 *  sleeper (07:00 to 15:00) gets an axis from 23:00; a night sleeper (23:30 to 07:30) one from 15:00. */
export function sleepAxis(logs: SleepLog[]): number {
  if (!logs.length) return 18 * 60;
  const mids = logs.map((l) => clockIn(Math.round((Date.parse(l.start) + Date.parse(l.end)) / 2), l.tz));
  const mid = toMin(clockMedian(mids)!);
  return ((Math.floor((mid - 720) / 60) * 60) % 1440 + 1440) % 1440;
}
/** A sleep's bar on that axis: from and to in minutes from the axis start (0 to 1440), plus its breaks. */
export function sleepBar(l: SleepLog, axis: number): { from: number; to: number; breaks: { from: number; to: number }[] } {
  const from = ((toMin(clockIn(Date.parse(l.start), l.tz)) - axis) % 1440 + 1440) % 1440;
  const len = Math.round((Date.parse(l.end) - Date.parse(l.start)) / 60000);
  const at = (iso: string) => Math.min(1440, from + Math.round((Date.parse(iso) - Date.parse(l.start)) / 60000));
  return { from, to: Math.min(1440, from + len), breaks: (l.breaks ?? []).map((b) => ({ from: at(b.start), to: at(b.end) })) };
}
/** The clock labels along the axis: every 6 hours. */
export const axisLabels = (axis: number) => [0, 360, 720, 1080, 1440].map((o) => ({ at: o, t: `${pad(Math.floor(((axis + o) % 1440) / 60))}:00` }));

// ---------- words used by every export ----------
const zoneWord = (tz: string) => tz.split("/").pop()!.replace(/_/g, " ");
function setWords(s: FitSet, perSide: boolean): string {
  const kg = s.kg != null ? `${fmtKg(s.kg)} kg${perSide ? " each side" : ""}` : "";
  const head = kg && s.reps != null ? `${kg} x ${s.reps}` : kg || (s.reps != null ? `${s.reps} reps` : "a set");
  const bits = [s.rir != null ? `RIR ${rirLabel(s.rir)}` : "", s.drop ? "drop set" : ""].filter(Boolean);
  return `${s.warm ? "warm up " : ""}${head}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}
const restWords = (secs: number) => (secs < 60 ? `${secs} s` : fmtTime(secs));
export function sleepWords(l: SleepLog, target: number): string {
  const m = sleepMins(l), br = breaksMins(l);
  const parts = [`${clockIn(Date.parse(l.start), l.tz)} to ${clockIn(Date.parse(l.end), l.tz)} (${zoneWord(l.tz)} time)`, `about ${fmtMins(m)} asleep`];
  if (br > 0) parts.push(`${fmtMins(br)} awake in the night`);
  if (l.rested != null) parts.push(`felt rested ${l.rested} of 5`);
  parts.push(m >= clampTarget(target) ? "on target" : `under my ${fmtMins(clampTarget(target))} target`);
  return parts.join(", ");
}
const actWords = (a: FitActivity) => `${actName(a.kind)}: ${fmtKm(a.km)} km in ${fmtTime(a.secs)} (${fmtPace(a.kind, a.km, a.secs)})`;
const liveExercises = (w: FitWorkout) => w.exercises.filter((e) => !e.removed && e.sets.some((s) => s.done && !s.gone));
const workoutTitle = (w: FitWorkout) => (w.programId || w.week > 1 || w.dayName !== "Free workout" ? `Week ${w.week}, ${w.dayName}` : w.dayName);

// ---------- (a) Copy for Claude ----------
/**
 * A plain text log of the range, written to be pasted into Claude (or any assistant) so it can act as a personal
 * trainer: what the person asks for, the units, a summary, new bests, each week, then every day with its sleep, each
 * workout (every set with kg, reps, RIR and the rest taken), notes, and runs. Days with nothing are folded into one line.
 */
export function claudeText(d: HealthData, from: string, to: string, inc: Include = ALL): string {
  const target = clampTarget(d.target);
  const s = summarize(d, from, to);
  const days = healthDays(d, from, to);
  const L: string[] = [];
  L.push(`My training and sleep log, ${rangeWords(from, to)} (${s.days === 1 ? "1 day" : `${s.days} days`}).`);
  L.push("");
  L.push("Please act as my personal trainer. Look at how I train and sleep below, tell me what is going well and what to change, and suggest my next sessions (exercises, sets, reps and weights). Ask me anything you need to know first.");
  L.push("");
  const units: string[] = [];
  if (inc.fitness) units.push("Weights are in kg. RIR is reps in reserve: how many more reps I could have done (0 means none left, 4+ means 4 or more). \"each side\" means per dumbbell or per side. Rest is the time between ticking one set and the next.");
  if (inc.sleep) units.push(`Sleep hours are about: from falling asleep to waking, minus time awake in the night. My sleep target is ${fmtMins(target)}.`);
  if (units.length) { L.push(...units); L.push(""); }

  L.push("SUMMARY");
  if (inc.fitness) {
    L.push(`- Trained ${s.trained} of ${s.days} days (${s.workouts === 1 ? "1 workout" : `${s.workouts} workouts`}), ${s.sets} working sets, ${commas(s.volume)} kg total volume${s.trainMins ? `, ${fmtMins(s.trainMins)} in the gym` : ""}.`);
    L.push(`- Week goal: ${d.weekGoal ?? 3} days a week. Most days trained in a row: ${s.trainRun}.`);
  }
  if (inc.sleep) {
    if (s.nights) {
      L.push(`- Sleep: ${s.nights} of ${s.days} nights logged, average ${fmtMins(s.avgSleep ?? 0)} asleep, ${s.onTarget} on target. Most nights on target in a row: ${s.sleepRun}.`);
      if (s.usualAsleep && s.usualWake) L.push(`- Usual time asleep ${s.usualAsleep}, usual wake ${s.usualWake}.`);
      if (s.longest && s.shortest && s.nights > 1) L.push(`- Longest ${fmtMins(s.longest.mins)} (${fmtDate(s.longest.date)}), shortest ${fmtMins(s.shortest.mins)} (${fmtDate(s.shortest.date)}).`);
    } else L.push("- Sleep: nothing logged in this range.");
  }
  if (inc.acts && s.acts) {
    const kinds = (Object.entries(s.byKind) as [ActKind, { n: number; km: number; secs: number }][]).map(([k, v]) => `${v.n} ${actName(k).toLowerCase()}${v.n === 1 ? "" : "s"} (${fmtKm(v.km)} km, ${fmtTime(v.secs)})`);
    L.push(`- Other activity: ${kinds.join(", ")}.`);
  }
  if (inc.fitness && s.bests.length) {
    L.push("");
    L.push("NEW PERSONAL BESTS");
    for (const b of s.bests) L.push(`- ${fmtDate(b.date)}: ${b.name}, ${fmtKg(b.kg)} kg${b.perSide ? " each side" : ""} x ${b.reps} (${BEST_SHORT[b.kind]})`);
  }
  if (s.weeks.length > 1) {
    L.push("");
    L.push("EACH WEEK (Monday to Sunday)");
    for (const w of s.weeks) {
      const bits: string[] = [];
      if (inc.fitness) bits.push(`${w.trained} days trained, ${w.sets} sets, ${commas(w.volume)} kg`);
      if (inc.sleep) bits.push(w.nights ? `sleep average ${fmtMins(w.avgSleep ?? 0)} over ${w.nights} nights, ${w.onTarget} on target` : "no sleep logged");
      if (inc.acts && w.km) bits.push(`${fmtKm(w.km)} km`);
      L.push(`- Week of ${fmtDate(w.monday)}: ${bits.join("; ")}`);
    }
  }
  L.push("");
  L.push("DAY BY DAY");
  const has = (x: HealthDay) => (inc.sleep && !!x.sleep) || (inc.fitness && x.workouts.length > 0) || (inc.acts && x.acts.length > 0);
  for (let i = 0; i < days.length; i++) {
    const x = days[i];
    if (!has(x)) {
      let j = i;
      while (j + 1 < days.length && !has(days[j + 1])) j++;
      L.push(j === i ? `${fmtDayLong(x.date)}: nothing logged` : `${fmtDayLong(x.date)} to ${fmtDayLong(days[j].date)}: nothing logged`);
      i = j;
      continue;
    }
    L.push(fmtDayLong(x.date));
    if (inc.sleep) L.push(x.sleep ? `  Sleep: ${sleepWords(x.sleep, target)}` : "  Sleep: not logged");
    if (inc.fitness) {
      if (!x.workouts.length) L.push("  No gym workout");
      for (const w of x.workouts) {
        const wd = w.data, mins = workMins(wd);
        const when = `${clockIn(Date.parse(wd.startedAt), d.tz)}${wd.endedAt ? ` to ${clockIn(Date.parse(wd.endedAt), d.tz)}` : ""}${mins ? `, ${fmtMins(mins)}` : ""}`;
        L.push(`  Workout: ${workoutTitle(wd)} (${when})`);
        for (const e of liveExercises(wd)) {
          const sets = e.sets.filter((st) => st.done && !st.gone);
          const plan = [targetLine(e.target), e.rir != null ? `RIR ${rirLabel(e.rir)}` : ""].filter(Boolean).join(" at ");
          const rest = typicalRest(e);
          L.push(`    ${e.name}${plan ? ` (plan: ${plan})` : ""}: ${sets.map((st) => setWords(st, !!e.perSide)).join(", ")}.${rest ? ` Rest about ${restWords(rest)}.` : ""}`);
          if (e.note) L.push(`      Plan note: ${e.note}`);
        }
        if (wd.note) L.push(`    Note: ${wd.note}`);
      }
    }
    if (inc.acts) for (const a of x.acts) L.push(`  ${actWords(a)}`);
  }
  return L.join("\n");
}

// ---------- (b) CSV, one file per kind ----------
export type Cell = string | number | boolean | null | undefined;
/** One CSV cell: quoted when it needs it, and text that a sheet would read as a formula gets a leading ' (never a number). */
export function csvCell(v: Cell): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  let s = String(v).replace(/\r\n?/g, "\n");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: Cell[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** Every done set in the range, one row each. */
export function setsCsv(d: HealthData, from: string, to: string): string {
  const rows: Cell[][] = [["date", "workout", "started", "ended", "exercise", "set", "warm_up", "kg", "per_side", "reps", "rir", "drop_set", "rest_before_secs", "planned", "plan_note", "workout_note"]];
  const ws = d.workouts.filter((w) => inRange(w.data.date, from, to) && liveWorkout(w)).sort((a, b) => a.data.startedAt.localeCompare(b.data.startedAt));
  for (const w of ws) {
    const wd = w.data;
    for (const e of liveExercises(wd)) {
      const rest = restBefore(e);
      let n = 0;
      for (const s of e.sets) {
        if (!s.done || s.gone) continue;
        n++;
        rows.push([wd.date, workoutTitle(wd), clockIn(Date.parse(wd.startedAt), d.tz), wd.endedAt ? clockIn(Date.parse(wd.endedAt), d.tz) : "", e.name, n, !!s.warm, s.kg, !!e.perSide, s.reps,
          s.rir == null ? "" : rirLabel(s.rir), !!s.drop, rest.get(s.id) ?? "", targetLine(e.target), e.note ?? "", n === 1 ? wd.note ?? "" : ""]);
      }
    }
  }
  return toCsv(rows);
}
/** One row per night (by wake date). */
export function sleepCsv(d: HealthData, from: string, to: string): string {
  const target = clampTarget(d.target);
  const rows: Cell[][] = [["date_woke", "fell_asleep", "woke_up", "time_zone", "hours_asleep", "minutes_asleep", "minutes_awake_in_night", "rested_1_to_5", "on_target", "logged_by"]];
  for (const x of healthDays(d, from, to)) {
    if (!x.sleep) continue;
    const m = x.mins!;
    rows.push([x.date, x.asleep, x.wake, x.sleep.tz, Math.round((m / 60) * 100) / 100, m, breaksMins(x.sleep), x.sleep.rested ?? "", m >= target, x.sleep.src === "sleepmode" ? "Sleep mode" : "typed"]);
  }
  return toCsv(rows);
}
/** One row per run, walk, ride or swim. */
export function actsCsv(d: HealthData, from: string, to: string): string {
  const rows: Cell[][] = [["date", "activity", "km", "time", "seconds", "pace"]];
  const as = d.acts.filter((a) => inRange(a.data.date, from, to)).sort((a, b) => a.data.date.localeCompare(b.data.date) || a.data.at.localeCompare(b.data.at));
  for (const { data: a } of as) rows.push([a.date, actName(a.kind), a.km, fmtTime(a.secs), a.secs, fmtPace(a.kind, a.km, a.secs)]);
  return toCsv(rows);
}

// ---------- (c) one JSON ----------
export const HEALTH_FORMAT = "ps-health";
export interface HealthExport {
  app: "PS"; format: typeof HEALTH_FORMAT; v: 1; exportedAt: string;
  range: { from: string; to: string }; units: { weight: "kg"; distance: "km"; time: "minutes" };
  sleepTargetMins: number; weekGoal: number;
  summary: Omit<HealthSummary, "weeks" | "bests"> & { weeks: WeekRow[]; bests: NewBest[] };
  days: {
    date: string;
    sleep?: { fellAsleep: string; wokeUp: string; tz: string; minsAsleep: number; minsAwakeInNight: number; rested: number | null; onTarget: boolean } | null;
    workouts?: { id: string; title: string; started: string; ended: string | null; sets: number; volumeKg: number; note: string | null;
      exercises: { name: string; exId: string | null; perSide: boolean; planned: string | null; planNote: string | null; sets: { kg: number | null; reps: number | null; rir: number | null; warm: boolean; drop: boolean; restBeforeSecs: number | null }[] }[] }[];
    activities?: { kind: ActKind; km: number; secs: number; pace: string }[];
  }[];
  /** The raw records in the backup's { id, kind, data } shape (fwork, fsleep, fact). */
  records: { id: string; kind: "fwork" | "fsleep" | "fact"; data: unknown }[];
}
/** Everything in the range in one file: the summary, every day, and the raw records. */
export function healthJson(d: HealthData, from: string, to: string, inc: Include = ALL, now = new Date()): HealthExport {
  const target = clampTarget(d.target);
  const s = summarize(d, from, to);
  const days: HealthExport["days"] = [];
  for (const x of healthDays(d, from, to)) {
    const day: HealthExport["days"][number] = { date: x.date };
    let any = false;
    if (inc.sleep && x.sleep) {
      any = true;
      day.sleep = { fellAsleep: x.sleep.start, wokeUp: x.sleep.end, tz: x.sleep.tz, minsAsleep: x.mins!, minsAwakeInNight: breaksMins(x.sleep), rested: x.sleep.rested ?? null, onTarget: x.onTarget };
    }
    if (inc.fitness && x.workouts.length) {
      any = true;
      day.workouts = x.workouts.map((w) => ({
        id: w.id, title: workoutTitle(w.data), started: w.data.startedAt, ended: w.data.endedAt ?? null, sets: workoutSetsDone(w.data), volumeKg: Math.round(workoutVolume(w.data)), note: w.data.note ?? null,
        exercises: liveExercises(w.data).map((e) => {
          const rest = restBefore(e);
          return { name: e.name, exId: e.exId, perSide: !!e.perSide, planned: targetLine(e.target) || null, planNote: e.note ?? null,
            sets: e.sets.filter((st) => st.done && !st.gone).map((st) => ({ kg: st.kg, reps: st.reps, rir: st.rir, warm: !!st.warm, drop: !!st.drop, restBeforeSecs: rest.get(st.id) ?? null })) };
        }),
      }));
    }
    if (inc.acts && x.acts.length) { any = true; day.activities = x.acts.map((a) => ({ kind: a.kind, km: a.km, secs: a.secs, pace: fmtPace(a.kind, a.km, a.secs) })); }
    if (any) days.push(day);
  }
  const records: HealthExport["records"] = [];
  if (inc.fitness) for (const w of d.workouts) if (inRange(w.data.date, from, to) && liveWorkout(w)) records.push({ id: w.id, kind: "fwork", data: w.data });
  if (inc.sleep) for (const x of d.sleeps) if (inRange(x.log.day, from, to)) records.push({ id: x.id, kind: "fsleep", data: x.log });
  if (inc.acts) for (const a of d.acts) if (inRange(a.data.date, from, to)) records.push({ id: a.id, kind: "fact", data: a.data });
  records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const summary = { ...s, bests: inc.fitness ? s.bests : [] };
  return { app: "PS", format: HEALTH_FORMAT, v: 1, exportedAt: now.toISOString(), range: { from, to }, units: { weight: "kg", distance: "km", time: "minutes" }, sleepTargetMins: target, weekGoal: d.weekGoal ?? 3, summary, days, records };
}

/** File names: "PS sleep 2026-11-03 to 2026-11-09.csv". */
export const exportName = (what: "sets" | "sleep" | "activities" | "health", from: string, to: string) =>
  `PS ${what === "sets" ? "workout sets" : what === "health" ? "health" : what} ${from === to ? from : `${from} to ${to}`}.${what === "health" ? "json" : "csv"}`;
/** How much a range holds, for the export sheet: "14 workouts, 24 nights, 3 runs and walks". */
export function rangeCount(d: HealthData, from: string, to: string, inc: Include = ALL): string {
  const w = inc.fitness ? d.workouts.filter((x) => inRange(x.data.date, from, to) && liveWorkout(x)).length : 0;
  const n = inc.sleep ? new Set(d.sleeps.filter((x) => inRange(x.log.day, from, to)).map((x) => x.log.day)).size : 0;
  const a = inc.acts ? d.acts.filter((x) => inRange(x.data.date, from, to)).length : 0;
  const parts = [inc.fitness ? `${w} ${w === 1 ? "workout" : "workouts"}` : "", inc.sleep ? `${n} ${n === 1 ? "night" : "nights"}` : "", inc.acts ? `${a} ${a === 1 ? "run or walk" : "runs and walks"}` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "Nothing picked";
}
/** Hours for a bar label: 450 -> "7.5". */
export const hoursShort = (m: number) => String(Math.round((m / 60) * 10) / 10);
export const daysIn = daysBetween;

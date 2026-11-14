// PS Fitness on the phone's island (V1.60): the rules, with no React and no vault, tested in tests/fitisland.test.ts.
// Moments the island shows during a workout: Scanning, Found, Not found, Workout added, a progress hint after a set, a
// nudge before the next one, and the rest countdown. The page works out WHAT to say (here); the phone's shell draws it
// (ps-gos IslandShow.kt, Island.kt) and plays each moment's own sound. Times are epoch ms on this device's clock.
import { exKey, fmtKg, roundKg, type FitLogEx, type FitPrefs, type FitSet, type FitWorkout } from "./fitness.ts";

type Dated = { id: string; data: FitWorkout };

export type FitMomentKind = "scanning" | "found" | "notfound" | "added" | "better" | "same" | "nudge";
/** A little stick figure: two poses (start and end of a rep), 17 points each as x,y pairs in a 0 to 100 box, and the head's radius. */
export interface FitFig { a: number[]; b: number[]; hr: number }
export interface FitMoment {
  id: string;
  kind: FitMomentKind;
  /** When it started and when it is over (epoch ms). */
  at: number; until: number;
  /** The words on the island. */
  title: string; sub: string;
  fig: FitFig | null;
  /** Its own sound plays (the "Island sounds" switch). */
  sound: boolean;
}
export interface FitRest { endsAt: number; exercise: string; set: number; of: number; over: boolean; overAt: number }
/** What the island is told (inside the island state as `fit`). */
export interface FitIsland { moment: FitMoment | null; rest: FitRest | null }

/** How long each moment stays (ms). Scanning and found wait for the scan screen; the cap is only a safety net. */
export const MOMENT_MS: Record<FitMomentKind, number> = { scanning: 25_000, found: 40_000, notfound: 3_200, added: 2_900, better: 4_500, same: 5_500, nudge: 5_500 };
/** "Rest over" stays on the island this long after a rest ends. */
export const REST_OVER_MS = 3_000;

/** The Fitness settings for the island. Both default on. */
export const islandOn = (p?: FitPrefs | null) => p?.island !== false;
export const islandSoundOn = (p?: FitPrefs | null) => p?.islandSound !== false;

// ---------- the scan, as moments ----------
export interface ScanIn { state: "idle" | "scanning" | "found" | "notfound" | "added"; hit?: { name: string; exId: string | null } | null; n: number }
/** What a scan state does to the current moment. Idle only clears what the scan screen was showing: a Workout added that
 *  is already on its way finishes by itself (the screen closes the instant the person says yes). */
export function momentOnScan(cur: FitMoment | null, s: ScanIn, now: number, o: { fig: FitFig | null; sound: boolean }): FitMoment | null {
  const mk = (kind: FitMomentKind, title: string, sub = "", fig: FitFig | null = null): FitMoment =>
    ({ id: `scan-${s.n}`, kind, at: now, until: now + MOMENT_MS[kind], title, sub, fig, sound: o.sound });
  switch (s.state) {
    case "scanning": return mk("scanning", "Scanning");
    case "found": return s.hit ? mk("found", clip(s.hit.name), "", o.fig) : mk("notfound", "Not found");
    case "notfound": return mk("notfound", "Not found");
    case "added": return mk("added", "Workout added", s.hit ? clip(s.hit.name) : "", o.fig);
    default: return cur && (cur.kind === "scanning" || cur.kind === "found" || cur.kind === "notfound") ? null : cur;
  }
}
const clip = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 60);

// ---------- progress hints from history ----------
export interface LastTime { kg: number; date: string; daysAgo: number }
const D = (day: string) => { const [y, m, d] = day.split("-").map(Number); return Date.UTC(y, (m || 1) - 1, d || 1); };
/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export const daysBetween = (from: string, to: string) => Math.round((D(to) - D(from)) / 864e5);
const working = (s: FitSet) => s.done && !s.warm && !s.gone && !s.drop && s.kg != null && s.kg > 0;

/** The heaviest working set of the last time this exercise was done on a PAST day (today's own earlier sets, in this or
 *  any workout dated today, never count). */
export function lastTime(key: string, workouts: Dated[], today: string, except?: string | null): LastTime | null {
  let best: { date: string; at: string; kg: number } | null = null;
  for (const w of workouts) {
    if (w.id === except || w.data.date >= today) continue;
    for (const e of w.data.exercises) {
      if (e.removed || exKey(e) !== key) continue;
      const kgs = e.sets.filter(working).map((s) => s.kg as number);
      if (!kgs.length) continue;
      if (!best || w.data.date > best.date || (w.data.date === best.date && w.data.startedAt > best.at)) best = { date: w.data.date, at: w.data.startedAt, kg: Math.max(...kgs) };
    }
  }
  return best ? { kg: best.kg, date: best.date, daysAgo: daysBetween(best.date, today) } : null;
}

export const daysAgoWords = (n: number) => (n <= 1 ? "yesterday" : `${n} days ago`);
export type SetHint = { kind: "better" | "same"; title: string; sub: string; daysAgo: number } | null;
/** After a set is ticked: heavier than last time says so, the same weight says so and suggests going up, lighter or no
 *  history says nothing. Warm up and drop sets say nothing. */
export function setHint(kg: number | null | undefined, last: LastTime | null, flags: { warm?: boolean; drop?: boolean } = {}): SetHint {
  if (kg == null || !(kg > 0) || !last || flags.warm || flags.drop) return null;
  if (kg > last.kg) return { kind: "better", title: "Higher than last time", sub: daysAgoWords(last.daysAgo), daysAgo: last.daysAgo };
  if (kg === last.kg) return { kind: "same", title: `Same weight as ${daysAgoWords(last.daysAgo)}`, sub: "Try going up next time.", daysAgo: last.daysAgo };
  return null;
}
/** Before the next set: last time was matched (the set just done is the same weight) and the next set is not heavier yet,
 *  so nudge to the higher weight. */
export function nudgeBefore(justKg: number | null | undefined, nextKg: number | null | undefined, last: LastTime | null, step?: number | null): { kg: number; title: string; sub: string } | null {
  if (justKg == null || !last || justKg !== last.kg) return null;
  if (nextKg != null && nextKg > last.kg) return null;
  const st = step && step > 0 ? step : 2.5;
  const kg = roundKg(last.kg + st, st < 2.5 ? st : 2.5) || last.kg + st;
  return { kg, title: `Try ${fmtKg(kg)} kg`, sub: "You matched last time" };
}

/** The hint for a set just ticked in `workoutId`, and the nudge to hold until its rest is over. History is the past days only. */
export function onSetDone(ex: FitLogEx, set: FitSet, workouts: Dated[], today: string, workoutId: string | null): { hint: SetHint; nudge: ReturnType<typeof nudgeBefore> } {
  const last = lastTime(exKey(ex), workouts, today, workoutId);
  const hint = setHint(set.kg, last, { warm: set.warm, drop: set.drop });
  const live = ex.sets.filter((s) => !s.gone);
  const i = live.findIndex((s) => s.id === set.id);
  const next = live.slice(i + 1).find((s) => !s.done);
  const nudge = hint?.kind === "same" && next ? nudgeBefore(set.kg, next.kg, last, ex.step) : null;
  return { hint, nudge };
}

export function momentOfHint(h: NonNullable<SetHint>, n: number, now: number, sound: boolean): FitMoment {
  return { id: `hint-${n}`, kind: h.kind, at: now, until: now + MOMENT_MS[h.kind], title: h.title, sub: h.sub, fig: null, sound };
}
export function momentOfNudge(nd: { title: string; sub: string }, n: number, now: number, sound: boolean): FitMoment {
  return { id: `nudge-${n}`, kind: "nudge", at: now, until: now + MOMENT_MS.nudge, title: nd.title, sub: nd.sub, fig: null, sound };
}

// ---------- rest ----------
export interface RestIn { endsAt: number; exercise: string; set: number; of: number; over: boolean; overAt: number }
/** What the island is told about a rest: running, or just over (for a few seconds), else nothing. */
export function restForIsland(r: RestIn | null, now: number): FitRest | null {
  if (!r) return null;
  if (r.over) return now - r.overAt < REST_OVER_MS ? { endsAt: r.endsAt, exercise: r.exercise, set: r.set, of: r.of, over: true, overAt: r.overAt } : null;
  return r.endsAt > now ? { endsAt: r.endsAt, exercise: r.exercise, set: r.set, of: r.of, over: false, overAt: 0 } : null;
}
/** A rest that just ended or was skipped (the same rest, now over): time to say the nudge that was held back for it. */
export const restJustEnded = (prev: RestIn | null, cur: RestIn | null) => !!prev && !prev.over && !!cur && cur.over && prev.exercise === cur.exercise && prev.set === cur.set;

// ---------- what goes to the island ----------
/** The island's `fit` block. A moment past its time is dropped; with the switch off nothing is sent at all. */
export function fitIslandState(moment: FitMoment | null, rest: RestIn | null, now: number, on: boolean): FitIsland | null {
  if (!on) return null;
  const m = moment && now < moment.until ? moment : null;
  const r = restForIsland(rest, now);
  return m || r ? { moment: m, rest: r } : null;
}
/** When the page must send again by itself (a moment or the "Rest over" word runs out). Null: nothing is pending. */
export function fitWakeAt(moment: FitMoment | null, rest: RestIn | null, now: number): number | null {
  const t: number[] = [];
  if (moment) t.push(moment.until);
  if (rest) t.push(rest.over ? rest.overAt + REST_OVER_MS : rest.endsAt);
  const next = t.filter((x) => x > now);
  return next.length ? Math.min(...next) : null;
}

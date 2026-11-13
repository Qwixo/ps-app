// G Squad Fitness (V1.40): what your Fitness shares with the squad, and the boards made from what others share.
// Pure rules (tested in tests/gymsquad.test.ts); the hub side is src/squad/gym.ts, the screens src/fitness/Squad*.tsx.
//
// Shared, only through core/squadshare.ts sealForSquad (so a switched off piece is never sealed or sent):
//   board card ("sum", piece fitness)   the days you trained or did an activity in the last 9 weeks, each day's
//                                       volume (kg x reps) and distance; personal bests of the last 5 weeks; percent better
//   one row per exercise ("ex", fitness) the best set, and the sets of the last 10 sessions (date, kg, reps, drop).
//                                       Never notes, RIR, programs, times of day or anything else in a workout
//   sleep card ("sleep", piece sleep)   hours slept (last night and this week's average), nights on target, the streak.
//                                       Never times, ratings or notes
// Exercises are matched across people by name (matchKey): the exercise library first (its names, aliases and gym short
// forms, with spelling slips forgiven), then the cleaned words of the name in any order.
import { bestsInWorkout, e1rm, plusDaysF, weekOf, type BestKind, type FitLogEx, type FitSet, type FitWorkout } from "./fitness.ts";
import { getExercise, matchExercise, words } from "../fitness/library.ts";
import { PACE_MIN_KM, isAct, paceOf, type ActKind, type FitActivity } from "./activity.ts";
import { byDay, clampTarget, streak, weekStats as sleepWeek, sleepMins, type SleepLog } from "./sleep.ts";
import { unb64 } from "./crypto.ts";

type Dated = { id: string; data: FitWorkout };
type DatedAct = { id: string; data: FitActivity };

export const SUM_DAYS = 63, PB_DAYS = 35, PB_MAX = 20, BETTER_DAYS = 28, BETTER_BASE_DAYS = 56, EX_SESSIONS = 10, EX_DAYS = 365, EX_MAX = 80;

// ---------- matching exercises across people ----------
const GLUED = /\b(bench|leg|chest|shoulder|overhead|military|hip|calf|floor|incline|decline|cable|hammer|preacher)(press|raise|raises|thrust|thrusts|fly|flys|curl|curls|row|rows)\b/gi;
const memo = new Map<string, string>();
/**
 * One key per exercise that is the same on everyone's device: "id:<library id>" when the exercise is from the library
 * or its name clearly is one (capital letters, spacing, plurals, "DB" or "BB" and close spellings do not matter),
 * else "n:" and the cleaned words of the name in A to Z order ("Incline BB bench", "bench incline barbell" match).
 */
export function matchKey(e: { exId?: string | null; name: string }): string {
  if (e.exId && getExercise(e.exId)) return `id:${e.exId}`;
  const name = String(e.name || "").slice(0, 120);
  const had = memo.get(name);
  if (had) return had;
  const tidy = name.replace(GLUED, "$1 $2");
  const lib = matchExercise(tidy, 0.85);
  let key: string;
  if (lib) key = `id:${lib.exercise.id}`;
  else {
    const w = [...new Set(words(tidy))].sort();
    key = w.length ? `n:${w.join(" ")}` : `n:${name.toLowerCase().replace(/\s+/g, " ").trim()}`;
  }
  if (memo.size > 2000) memo.clear();
  memo.set(name, key);
  return key;
}
export const actKey = (k: ActKind) => `act:${k}`;
/** The plain words for how matching works (shown on the compare screen). */
export const MATCH_WORDS = "Matched by name. Capital letters, spacing, plurals, short forms like DB or BB, word order and small spelling slips do not matter, so Incline BB bench and incline barbell bench press count as one exercise.";

// ---------- small helpers ----------
const r1 = (n: number) => Math.round(n * 10) / 10;
const doneSets = (e: FitLogEx) => e.sets.filter((s) => s.done && !s.warm && !s.gone);
const workSets = (e: FitLogEx) => doneSets(e).filter((s) => s.kg != null && (s.reps ?? 0) > 0);
const vol = (sets: FitSet[]) => sets.reduce((v, s) => v + (s.kg != null && s.reps ? s.kg * s.reps : 0), 0);
const between = (d: string, from: string, to: string) => d >= from && d <= to;
const okDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const txt = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const ID = /^[A-Za-z0-9:_-]{1,48}$/;
export const mondayOf = weekOf;
export const addDays = plusDaysF;

// ---------- your board card ----------
/** [date, volume kg, distance km, 1 when it was a gym day] */
export type GymDay = [string, number, number, 0 | 1];
export type PbKind = BestKind | "far" | "pace" | "farpace";
export interface GymPb { id: string; x: string; m: string; k: PbKind; d: string; kg?: number; r?: number; e?: 1; a?: ActKind; km?: number; s?: number }
export interface GymSum { v: 1; days: GymDay[]; pb: GymPb[]; better: { pct: number; n: number } | null; goal?: number }

export function buildSum(workouts: Dated[], acts: DatedAct[], today: string, goal?: number | null): GymSum {
  const from = addDays(today, -(SUM_DAYS - 1));
  const day = new Map<string, { v: number; km: number; g: boolean }>();
  const at = (d: string) => { let x = day.get(d); if (!x) { x = { v: 0, km: 0, g: false }; day.set(d, x); } return x; };
  for (const w of workouts) {
    if (!between(w.data.date, from, today)) continue;
    let any = false, v = 0;
    for (const e of w.data.exercises) { if (e.removed) continue; const s = doneSets(e); if (s.length) any = true; v += vol(s); }
    if (!any) continue;
    const x = at(w.data.date); x.v += v; x.g = true;
  }
  for (const a of acts) if (between(a.data.date, from, today)) at(a.data.date).km += a.data.km;
  const days: GymDay[] = [...day].sort((a, b) => a[0].localeCompare(b[0])).map(([d, x]) => [d, Math.round(x.v), r1(x.km), x.g ? 1 : 0]);
  const out: GymSum = { v: 1, days, pb: recentBests(workouts, acts, today), better: percentBetter(workouts, acts, today) };
  if (goal && goal >= 1 && goal <= 7) out.goal = Math.round(goal);
  return out;
}

/** Personal bests of the last 5 weeks, newest first: one per exercise per workout (its strongest new best, judged
 *  against the workouts before it), and for activities the longest yet and the fastest pace yet. */
export function recentBests(workouts: Dated[], acts: DatedAct[], today: string): GymPb[] {
  const from = addDays(today, -(PB_DAYS - 1));
  const out: GymPb[] = [];
  const sorted = [...workouts].sort((a, b) => a.data.startedAt.localeCompare(b.data.startedAt));
  for (const w of sorted) {
    if (!between(w.data.date, from, today)) continue;
    const before = sorted.filter((x) => x.id === w.id || x.data.startedAt < w.data.startedAt);
    for (const e of w.data.exercises) {
      if (e.removed) continue;
      const flags = bestsInWorkout(e, w.id, before);
      if (!flags.size) continue;
      let best: { s: FitSet; k: BestKind } | null = null;
      for (const s of e.sets) {
        const k = flags.get(s.id);
        if (k && !s.gone && !s.warm && s.kg != null && s.reps && (!best || e1rm(s.kg, s.reps) > e1rm(best.s.kg!, best.s.reps!))) best = { s, k };
      }
      if (!best || !ID.test(best.s.id)) continue;
      const pb: GymPb = { id: best.s.id, x: txt(e.name, 80) || "Exercise", m: matchKey(e), k: best.k, d: w.data.date, kg: best.s.kg!, r: best.s.reps! };
      if (e.perSide) pb.e = 1;
      out.push(pb);
    }
  }
  const asorted = [...acts].sort((a, b) => a.data.date.localeCompare(b.data.date) || a.data.at.localeCompare(b.data.at));
  asorted.forEach((a, i) => {
    if (!between(a.data.date, from, today) || !ID.test(a.id)) return;
    const earlier = asorted.slice(0, i).filter((x) => x.data.kind === a.data.kind);
    if (!earlier.length) return;
    const base = { x: actName(a.data.kind), m: actKey(a.data.kind), d: a.data.date, a: a.data.kind, km: a.data.km, s: a.data.secs };
    const far = a.data.km > Math.max(...earlier.map((x) => x.data.km));
    const min = PACE_MIN_KM[a.data.kind];
    const paced = earlier.filter((x) => x.data.km >= min);
    const fast = a.data.km >= min && paced.length > 0 && paceOf(a.data.km, a.data.secs) < Math.min(...paced.map((x) => paceOf(x.data.km, x.data.secs)));
    if (far || fast) out.push({ id: a.id.slice(0, 48), k: far && fast ? "farpace" : far ? "far" : "pace", ...base });
  });
  return out.sort((a, b) => b.d.localeCompare(a.d)).slice(0, PB_MAX);
}
const actName = (k: ActKind) => ({ run: "Run", walk: "Walk", ride: "Ride", swim: "Swim" })[k];

/**
 * Percent better: for every exercise you did in the last 4 weeks AND in the 8 weeks before, your best estimated max
 * now against then (for activities, your best pace now against then), each capped at 50 percent either way, then
 * the average. Null until there is something to compare.
 */
export function percentBetter(workouts: Dated[], acts: DatedAct[], today: string): { pct: number; n: number } | null {
  const rFrom = addDays(today, -(BETTER_DAYS - 1)), bTo = addDays(rFrom, -1), bFrom = addDays(bTo, -(BETTER_BASE_DAYS - 1));
  const now = new Map<string, number>(), then = new Map<string, number>();
  const take = (m: Map<string, number>, k: string, v: number, more: boolean) => { const h = m.get(k); if (h == null || (more ? v > h : v < h)) m.set(k, v); };
  for (const w of workouts) {
    const d = w.data.date;
    const into = between(d, rFrom, today) ? now : between(d, bFrom, bTo) ? then : null;
    if (!into) continue;
    for (const e of w.data.exercises) {
      if (e.removed) continue;
      for (const s of workSets(e)) if (s.kg! > 0) take(into, matchKey(e), e1rm(s.kg!, s.reps!), true);
    }
  }
  const pNow = new Map<string, number>(), pThen = new Map<string, number>();
  for (const a of acts) {
    if (a.data.km < PACE_MIN_KM[a.data.kind]) continue;
    const into = between(a.data.date, rFrom, today) ? pNow : between(a.data.date, bFrom, bTo) ? pThen : null;
    if (into) take(into, actKey(a.data.kind), paceOf(a.data.km, a.data.secs), false);
  }
  const cap = (x: number) => Math.max(-50, Math.min(50, x));
  const parts: number[] = [];
  for (const [k, v] of now) { const b = then.get(k); if (b && b > 0) parts.push(cap(((v - b) / b) * 100)); }
  for (const [k, v] of pNow) { const b = pThen.get(k); if (b && b > 0 && Number.isFinite(b)) parts.push(cap(((b - v) / b) * 100)); }
  if (!parts.length) return null;
  return { pct: r1(parts.reduce((a, b) => a + b, 0) / parts.length), n: parts.length };
}

// ---------- one row per exercise (the per exercise compare) ----------
/** [kg or null, reps or null, 1 for a drop set] */
export type ExSet = [number | null, number | null, 0 | 1];
export interface GymExLift { v: 1; t: "lift"; m: string; n: string; e?: 1; b: { kg: number; r: number; d: string } | null; x: number; s: [string, ExSet[]][]; c: number }
/** sessions: [date, [[km, seconds]]] */
export interface GymExAct { v: 1; t: "act"; m: string; n: string; a: ActKind; b: { km: number; d: string } | null; p: { s: number; km: number; d: string } | null; s: [string, [number, number][]][]; c: number }
export type GymEx = GymExLift | GymExAct;

export function buildExRows(workouts: Dated[], acts: DatedAct[], today: string): GymEx[] {
  const from = addDays(today, -(EX_DAYS - 1));
  const lifts = new Map<string, { last: string; n: string; e: boolean; sessions: { d: string; at: string; sets: ExSet[] }[]; b: GymExLift["b"]; x: number }>();
  for (const w of [...workouts].sort((a, b) => a.data.startedAt.localeCompare(b.data.startedAt))) {
    if (!between(w.data.date, from, today)) continue;
    for (const e of w.data.exercises) {
      if (e.removed) continue;
      const sets = doneSets(e).filter((s) => s.kg != null || s.reps != null);
      if (!sets.length) continue;
      const m = matchKey(e);
      let g = lifts.get(m);
      if (!g) { g = { last: "", n: "", e: false, sessions: [], b: null, x: 0 }; lifts.set(m, g); }
      g.last = w.data.date; g.n = txt(e.name, 80) || "Exercise"; g.e = !!e.perSide;
      g.sessions.push({ d: w.data.date, at: w.data.startedAt, sets: sets.slice(0, 12).map((s): ExSet => [s.kg ?? null, s.reps ?? null, s.drop ? 1 : 0]) });
      for (const s of sets) {
        if (s.kg == null || !s.reps) continue;
        if (!g.b || s.kg > g.b.kg || (s.kg === g.b.kg && s.reps > g.b.r)) g.b = { kg: s.kg, r: s.reps, d: w.data.date };
        g.x = Math.max(g.x, e1rm(s.kg, s.reps));
      }
    }
  }
  const out: (GymEx & { last: string })[] = [];
  for (const [m, g] of lifts) {
    const s = g.sessions.slice(-EX_SESSIONS).reverse().map((x): [string, ExSet[]] => [x.d, x.sets]);
    const row: GymExLift = { v: 1, t: "lift", m, n: g.n, b: g.b, x: Math.round(g.x * 2) / 2, s, c: g.sessions.length };
    if (g.e) row.e = 1;
    out.push({ ...row, last: g.last });
  }
  const byKind = new Map<ActKind, FitActivity[]>();
  for (const a of acts) if (between(a.data.date, from, today)) { const l = byKind.get(a.data.kind) ?? []; l.push(a.data); byKind.set(a.data.kind, l); }
  for (const [k, list] of byKind) {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
    const days = new Map<string, [number, number][]>();
    for (const a of list) { const l = days.get(a.date) ?? []; l.push([r1Km(a.km), Math.round(a.secs)]); days.set(a.date, l); }
    const far = list.reduce<FitActivity | null>((b, a) => (!b || a.km > b.km ? a : b), null);
    const paced = list.filter((a) => a.km >= PACE_MIN_KM[k]);
    const fast = paced.reduce<FitActivity | null>((b, a) => (!b || paceOf(a.km, a.secs) < paceOf(b.km, b.secs) ? a : b), null);
    const s = [...days].slice(-EX_SESSIONS).reverse();
    out.push({ v: 1, t: "act", m: actKey(k), n: actName(k), a: k, b: far ? { km: r1Km(far.km), d: far.date } : null,
      p: fast ? { s: Math.round(paceOf(fast.km, fast.secs)), km: r1Km(fast.km), d: fast.date } : null, s, c: list.length, last: list[list.length - 1].date });
  }
  return out.sort((a, b) => b.last.localeCompare(a.last)).slice(0, EX_MAX).map(({ last: _l, ...r }) => r as GymEx);
}
const r1Km = (km: number) => Math.round(km * 100) / 100;

// ---------- your sleep card ----------
export interface GymSleep { v: 1; streak: number; avg: number | null; last: number | null; lastDay: string | null; on: number; logged: number; target: number }
/** Null when sleep sharing is switched off in the Sleep settings too (prefs.sleepShare === false), or nothing was logged in 2 weeks. */
export function buildSleep(logs: Iterable<SleepLog>, prefs: { sleepShare?: boolean; sleepTarget?: number }, today: string): GymSleep | null {
  if (prefs.sleepShare === false) return null;
  const days = byDay(logs), target = clampTarget(prefs.sleepTarget);
  if (![...days.keys()].some((d) => d > addDays(today, -14) && d <= today)) return null;   // nothing logged lately: nothing to share
  const wk = sleepWeek(days, today, target);
  let last: SleepLog | null = null;
  for (let i = 0; i < 3 && !last; i++) last = days.get(addDays(today, -i)) ?? null;
  return { v: 1, streak: streak(days, today, target), avg: wk.avg == null ? null : Math.round(wk.avg), last: last ? Math.round(sleepMins(last)) : null, lastDay: last?.day ?? null,
    on: wk.onTarget, logged: wk.logged, target };
}

// ---------- reading what others share (untrusted: every field checked) ----------
export function cleanSum(v: unknown): GymSum | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || o.v !== 1 || !Array.isArray(o.days)) return null;
  const days: GymDay[] = [];
  for (const d of o.days.slice(0, SUM_DAYS + 7)) {
    if (!Array.isArray(d) || !okDay(d[0])) continue;
    days.push([d[0], num(d[1], 0, 1e7) ?? 0, num(d[2], 0, 2000) ?? 0, d[3] === 1 ? 1 : 0]);
  }
  const pb: GymPb[] = [];
  for (const p of Array.isArray(o.pb) ? o.pb.slice(0, PB_MAX) : []) {
    const q = p as Record<string, unknown>;
    if (!q || typeof q.id !== "string" || !ID.test(q.id) || !okDay(q.d) || typeof q.m !== "string") continue;
    const k = q.k;
    if (k !== "kg" && k !== "e1rm" && k !== "reps" && k !== "far" && k !== "pace" && k !== "farpace") continue;
    const c: GymPb = { id: q.id, x: txt(q.x, 80) || "Exercise", m: txt(q.m, 160), k, d: q.d };
    if (num(q.kg, -500, 2000) != null) c.kg = q.kg as number;
    if (num(q.r, 0, 1000) != null) c.r = q.r as number;
    if (q.e === 1) c.e = 1;
    if (isAct(q.a)) c.a = q.a;
    if (num(q.km, 0, 2000) != null) c.km = q.km as number;
    if (num(q.s, 0, 48 * 3600) != null) c.s = q.s as number;
    pb.push(c);
  }
  const b = o.better as Record<string, unknown> | null;
  const better = b && num(b.pct, -100, 100) != null && num(b.n, 1, 1000) != null ? { pct: b.pct as number, n: b.n as number } : null;
  const out: GymSum = { v: 1, days, pb, better };
  if (num(o.goal, 1, 7) != null) out.goal = o.goal as number;
  return out;
}
export function cleanSleepCard(v: unknown): GymSleep | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || o.v !== 1) return null;
  return { v: 1, streak: num(o.streak, 0, 3650) ?? 0, avg: num(o.avg, 0, 1440), last: num(o.last, 0, 1440), lastDay: okDay(o.lastDay) ? o.lastDay : null,
    on: num(o.on, 0, 7) ?? 0, logged: num(o.logged, 0, 7) ?? 0, target: num(o.target, 0, 1440) ?? 420 };
}
export function cleanEx(v: unknown): GymEx | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || o.v !== 1 || typeof o.m !== "string" || !Array.isArray(o.s)) return null;
  const m = txt(o.m, 160), n = txt(o.n, 80) || "Exercise", c = num(o.c, 0, 100000) ?? 0;
  if (o.t === "lift") {
    const s: [string, ExSet[]][] = [];
    for (const x of o.s.slice(0, EX_SESSIONS)) {
      if (!Array.isArray(x) || !okDay(x[0]) || !Array.isArray(x[1])) continue;
      s.push([x[0], x[1].slice(0, 12).filter(Array.isArray).map((q: unknown[]): ExSet => [num(q[0], -500, 2000), num(q[1], 0, 1000), q[2] === 1 ? 1 : 0])]);
    }
    const bb = o.b as Record<string, unknown> | null;
    const b = bb && num(bb.kg, -500, 2000) != null && num(bb.r, 0, 1000) != null && okDay(bb.d) ? { kg: bb.kg as number, r: bb.r as number, d: bb.d as string } : null;
    const out: GymExLift = { v: 1, t: "lift", m, n, b, x: num(o.x, 0, 5000) ?? 0, s, c };
    if (o.e === 1) out.e = 1;
    return out;
  }
  if (o.t === "act" && isAct(o.a)) {
    const s: [string, [number, number][]][] = [];
    for (const x of o.s.slice(0, EX_SESSIONS)) {
      if (!Array.isArray(x) || !okDay(x[0]) || !Array.isArray(x[1])) continue;
      const l = x[1].slice(0, 10).filter(Array.isArray).map((q: unknown[]) => [num(q[0], 0, 2000), num(q[1], 0, 48 * 3600)] as [number | null, number | null])
        .filter((q): q is [number, number] => q[0] != null && q[1] != null);
      if (l.length) s.push([x[0], l]);
    }
    const bb = o.b as Record<string, unknown> | null, pp = o.p as Record<string, unknown> | null;
    return { v: 1, t: "act", m, n, a: o.a, s, c,
      b: bb && num(bb.km, 0, 2000) != null && okDay(bb.d) ? { km: bb.km as number, d: bb.d as string } : null,
      p: pp && num(pp.s, 1, 1e6) != null && num(pp.km, 0, 2000) != null && okDay(pp.d) ? { s: pp.s as number, km: pp.km as number, d: pp.d as string } : null };
  }
  return null;
}

// ---------- posts: challenges, joins, reactions, comments ----------
export type ChMetric = "days" | "volume" | "km";
export const CH_METRICS: { k: ChMetric; t: string; line: string }[] = [
  { k: "days", t: "Days trained", line: "Most days with a workout or an activity" },
  { k: "volume", t: "Volume lifted", line: "Most kg lifted (kg x reps, every set)" },
  { k: "km", t: "Distance", line: "Most km run, walked, ridden or swum" },
];
export const CH_LENGTHS = [7, 14, 28] as const;
export const REACTIONS = ["🔥", "💪", "👏", "🏆", "😮"] as const;
export interface PostCh { k: "ch"; metric: ChMetric; from: string; to: string; t?: string }
export interface PostJoin { k: "join"; ch: string }
export interface PostRe { k: "re"; to: string; pb: string; e: string }
export interface PostCm { k: "cm"; to: string; pb: string; t: string }
export type GymPost = PostCh | PostJoin | PostRe | PostCm;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COMMENT_MAX = 200;
export function cleanPost(v: unknown): GymPost | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  switch (o.k) {
    case "ch": {
      if ((o.metric !== "days" && o.metric !== "volume" && o.metric !== "km") || !okDay(o.from) || !okDay(o.to) || o.to < o.from) return null;
      if (Date.parse(`${o.to}T00:00:00Z`) - Date.parse(`${o.from}T00:00:00Z`) > 31 * 864e5) return null;
      const t = txt(o.t, 60);
      return { k: "ch", metric: o.metric, from: o.from, to: o.to, ...(t ? { t } : {}) };
    }
    case "join": return typeof o.ch === "string" && UUID.test(o.ch) ? { k: "join", ch: o.ch.toLowerCase() } : null;
    case "re": return typeof o.to === "string" && UUID.test(o.to) && typeof o.pb === "string" && ID.test(o.pb) && (REACTIONS as readonly string[]).includes(o.e as string)
      ? { k: "re", to: o.to.toLowerCase(), pb: o.pb, e: o.e as string } : null;
    case "cm": { const t = txt(o.t, COMMENT_MAX); return t && typeof o.to === "string" && UUID.test(o.to) && typeof o.pb === "string" && ID.test(o.pb) ? { k: "cm", to: o.to.toLowerCase(), pb: o.pb, t } : null; }
  }
  return null;
}

// ---------- the boards ----------
export interface Person { id: string; name: string; me: boolean; sum: GymSum | null; sleep: GymSleep | null }
export interface BoardRow { id: string; name: string; me: boolean; rank: number; value: number | null; text: string; sub: string }
export interface Board { id: "showed" | "pbs" | "better" | "volume" | "sleep"; title: string; line: string; rows: BoardRow[]; missing: number }

export const daysIn = (s: GymSum | null, from: string, to: string) => (s ? s.days.filter((d) => between(d[0], from, to)) : []);
export const fmtThousands = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const fmtPct = (p: number) => `${p > 0 ? "+" : ""}${p.toFixed(1)}%`;
const fmtH = (m: number) => { const h = Math.floor(m / 60), mi = Math.round(m % 60); return mi ? `${h} h ${String(mi).padStart(2, "0")}` : `${h} h`; };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function ranked(rows: Omit<BoardRow, "rank">[], keys: (r: Omit<BoardRow, "rank">) => number[]): BoardRow[] {
  const withK = rows.map((r) => ({ r, k: keys(r) }));
  withK.sort((a, b) => { for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return b.k[i] - a.k[i]; return Number(b.r.me) - Number(a.r.me) || a.r.name.localeCompare(b.r.name); });
  let rank = 0, prev = "";
  return withK.map(({ r, k }, i) => { const sig = k.join("|"); if (sig !== prev) { rank = i + 1; prev = sig; } return { ...r, rank }; });
}

/** Every board, from the cards the squad shares. Someone who does not share a piece is left off that board. */
export function boards(people: Person[], today: string): Board[] {
  const mon = mondayOf(today), four = addDays(today, -27), month = addDays(today, -29);
  const fit = people.filter((p) => p.sum);
  const missF = people.length - fit.length;
  const n4s = new Map<string, number>();
  const showed = ranked(fit.map((p) => {
    const wk = daysIn(p.sum, mon, today).length, n4 = daysIn(p.sum, four, today).length;
    n4s.set(p.id, n4);
    return { id: p.id, name: p.name, me: p.me, value: wk, text: plural(wk, "day"), sub: `${n4} in 4 weeks${p.sum!.goal ? ` · goal ${p.sum!.goal} a week` : ""}` };
  }), (r) => [r.value ?? 0, n4s.get(r.id) ?? 0]);
  const pbs = ranked(fit.map((p) => {
    const l = p.sum!.pb.filter((b) => b.d >= month);
    const top = l[0];
    return { id: p.id, name: p.name, me: p.me, value: l.length, text: plural(l.length, "best"), sub: top ? `Latest: ${pbLine(top)}` : "None in 30 days" };
  }), (r) => [r.value ?? 0]);
  const better = ranked(fit.map((p) => {
    const b = p.sum!.better;
    return { id: p.id, name: p.name, me: p.me, value: b ? b.pct : null, text: b ? fmtPct(b.pct) : "Not yet", sub: b ? `across ${plural(b.n, "exercise")}` : "Needs 4 weeks before this month" };
  }), (r) => [r.value == null ? -1e9 : r.value]);
  const volume = ranked(fit.map((p) => {
    const d = daysIn(p.sum, mon, today);
    const v = d.reduce((a, x) => a + x[1], 0), km = d.reduce((a, x) => a + x[2], 0);
    return { id: p.id, name: p.name, me: p.me, value: v, text: `${fmtThousands(v)} kg`, sub: km > 0 ? `and ${r1(km)} km` : d.length ? plural(d.length, "day") : "Nothing yet this week" };
  }), (r) => [r.value ?? 0]);
  const slept = people.filter((p) => p.sleep);
  const sleep = ranked(slept.map((p) => {
    const s = p.sleep!;
    return { id: p.id, name: p.name, me: p.me, value: s.streak, text: s.streak ? `${plural(s.streak, "night")} in a row` : "No streak",
      sub: [s.last != null ? `Last night ${fmtH(s.last)}` : "", s.avg != null ? `${fmtH(s.avg)} a night this week` : ""].filter(Boolean).join(" · ") || "Nothing logged this week" };
  }), (r) => [r.value ?? 0, people.find((p) => p.id === r.id)?.sleep?.avg ?? 0]);
  return [
    { id: "showed", title: "Showed up", line: "Days with a workout or an activity this week", rows: showed, missing: missF },
    { id: "pbs", title: "Personal bests", line: "New bests in the last 30 days", rows: pbs, missing: missF },
    { id: "better", title: "Percent better", line: "Stronger than your own past: best this month against the 8 weeks before", rows: better, missing: missF },
    { id: "volume", title: "Weekly volume", line: "kg x reps over every set this week", rows: volume, missing: missF },
    { id: "sleep", title: "Sleep", line: "Nights in a row at your sleep target", rows: sleep, missing: people.length - slept.length },
  ];
}

export function pbLine(b: GymPb): string {
  if (b.k === "far") return `${b.x} ${r1(b.km ?? 0)} km, longest yet`;
  if (b.k === "pace") return `${b.x} ${r1(b.km ?? 0)} km, fastest pace yet`;
  if (b.k === "farpace") return `${b.x} ${r1(b.km ?? 0)} km, longest and fastest yet`;
  const kg = b.kg != null ? `${Math.round(b.kg * 100) / 100} kg${b.e ? " each" : ""}` : "";
  return `${b.x} ${kg}${b.r ? ` x ${b.r}` : ""}`.trim();
}

// ---------- challenges ----------
export interface ChallengeView { id: string; by: string; metric: ChMetric; from: string; to: string; t?: string; joined: string[] }
export function challengeState(c: { from: string; to: string }, today: string): "soon" | "on" | "done" {
  return today < c.from ? "soon" : today > c.to ? "done" : "on";
}
export function challengeScore(metric: ChMetric, sum: GymSum | null, from: string, to: string): number {
  const d = daysIn(sum, from, to);
  if (metric === "days") return d.length;
  if (metric === "volume") return d.reduce((a, x) => a + x[1], 0);
  return r1(d.reduce((a, x) => a + x[2], 0));
}
export function challengeTable(c: ChallengeView, people: Person[]): { id: string; name: string; me: boolean; score: number | null; rank: number }[] {
  const rows = c.joined.map((id) => { const p = people.find((x) => x.id === id); return { id, name: p?.name ?? "Someone", me: !!p?.me, score: p?.sum ? challengeScore(c.metric, p.sum, c.from, c.to) : null }; });
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
  let rank = 0, prev: number | null | undefined;
  return rows.map((r, i) => { if (r.score !== prev) { rank = i + 1; prev = r.score; } return { ...r, rank }; });
}
export function fmtScore(metric: ChMetric, n: number | null): string {
  if (n == null) return "Not shared";
  return metric === "days" ? plural(n, "day") : metric === "volume" ? `${fmtThousands(n)} kg` : `${r1(n)} km`;
}

// ---------- ids, tags and additional data (crypto) ----------
const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
async function hmacHex(rawB64: string, text: string): Promise<string> {
  const k = await subtle.importKey("raw", unb64(rawB64), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await subtle.sign("HMAC", k, te.encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const asUuid = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
/** A row's id: an HMAC under your own secret, the same on your Mac and phone, unlinkable to anything else. */
export const gymRowId = async (secret: string, what: string) => asUuid(await hmacHex(secret, `gym:${what}`));
/** Your reaction to one best is one post (a new pick replaces it). */
export const reactId = async (secret: string, to: string, pb: string) => asUuid(await hmacHex(secret, `gymre:${to}:${pb}`));
/** The compare screen's pull: the same tag for the same exercise on everyone's device, under one key gen. */
export const exTag = async (squadKeyRaw: string, m: string) => (await hmacHex(squadKeyRaw, `gym-ex:${m}`)).slice(0, 16);
export const gymAad = {
  row: (squad: string, member: string, id: string, part: string, gen: number) => `gsquad-v1:gym:${part}:${squad}:${member}:${id}:${gen}`,
  post: (squad: string, member: string, id: string, gen: number) => `gsquad-v1:gympost:${squad}:${member}:${id}:${gen}`,
};

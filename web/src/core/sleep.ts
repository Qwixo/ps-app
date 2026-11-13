// PS Fitness: Sleep (V1.40). The developer: "add how many hours sleep did you get last night ... I do want just the ability
// to log your sleep, so you can see someone slept eight hours a day, five days in a row, for example."
// Pure rules here (tests/sleep.test.ts); the saving is in fitness/sleep-store.ts and the drawing in fitness/Sleep.tsx.
// Built on ~/Projects/ps-handover-notes/research-sleep-science.md (V1.40 research):
// - A "night" is the MAIN sleep that ends on a date, at any hour: a sleep from 07:10 to 14:40 on 8 November is
//   8 November's sleep. The developer sleeps in the day; a night worker can have a perfect week. One record per wake date.
// - Target 7 h by default, a personal target between 7 and 9 h. A night counts when it reaches the target; no
//   extra credit above it (nothing to gain by lying in bed longer).
// - Streak: nights in a row on target, by wake date. The last 2 days may still be unlogged (they can be filled in
//   for 2 days) without breaking it; an older gap or a short night ends it.
// - Steady (regularity): of the last 7 logged sleeps, those whose fall asleep AND wake times are both within 60 min
//   of your own usual (the median), so a day sleeper scores as well as anyone.
// - Hours are "about": people overestimate their own sleep, and bed to wake is time in bed, not time asleep.
// - Never a running bank of lost hours, never red for a short night, no medical words; a few calm private notes only.
// Records: kind "fsleep", owner private (vault key), one small record per wake date. Never shared by this file:
// sleepSummary() is the ONLY thing a G Squad board may read, and only the streak and the weekly average.
import { wall, zonedToTs } from "./tz.ts";

export interface SleepLog {
  day: string;                   // YYYY-MM-DD: the date you woke up, in tz
  start: string;                 // ISO (UTC): fell asleep
  end: string;                   // ISO (UTC): woke up
  tz: string;                    // the zone the times were typed in (homeTz at the time)
  mins?: number | null;          // time asleep set by hand (lay awake for a while); else end minus start
  rested?: number | null;        // 1 (not at all) to 5 (very): optional
  src?: "hand" | "sleepmode";    // typed, or filled by a future bedside Sleep mode ("went to sleep" / "Wake up")
  breaks?: SleepBreak[] | null;  // V1.43: up for a while in the night (Sleep mode's "Back to sleep in"); not asleep
  at: string;                    // last change (the merge keeps the newer copy)
}
/** A short break inside a sleep: up from `start` to `end` (ISO, UTC). Time asleep leaves it out. */
export interface SleepBreak { start: string; end: string }
export const MAX_BREAKS = 12;

export const TARGET_DEF = 7 * 60, TARGET_MIN = 7 * 60, TARGET_MAX = 9 * 60, TARGET_STEP = 30;
export const MAX_SLEEP = 20 * 60;        // longer than this is a typing slip, not a sleep
export const BACKFILL_DAYS = 2;          // today plus the 2 days before can be filled in
export const STEADY_WINDOW = 60;         // minutes either side of your usual
export const BADGES = [3, 5, 7, 14, 30] as const;
export const DEF_ASLEEP = "23:00", DEF_WAKE = "07:00";

/** The personal target in minutes, 7 to 9 h (never under 7 for the streak). */
export function clampTarget(m: unknown): number {
  const n = typeof m === "number" && Number.isFinite(m) ? m : TARGET_DEF;
  return Math.max(TARGET_MIN, Math.min(TARGET_MAX, Math.round(n / 15) * 15));
}

// ---------- days and clock times ----------
const pad = (n: number) => String(n).padStart(2, "0");
/** The calendar date of a moment in a zone, as YYYY-MM-DD. */
export function dayIn(ts: number, tz: string): string { const w = wall(ts, tz); return `${w.y}-${pad(w.mo)}-${pad(w.d)}`; }
export function addDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
/** "HH:MM" of a moment in a zone. */
export function clockIn(ts: number, tz: string): string { const w = wall(ts, tz); return `${pad(w.h)}:${pad(w.mi)}`; }
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const fromMin = (m: number) => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad(Math.floor(x / 60))}:${pad(x % 60)}`; };
export const okClock = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const okDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/**
 * The 10 second log: you woke up on `day` at `wake` and fell asleep at `asleep` (clock times in tz). The sleep
 * started at the last `asleep` before the wake time: 23:30 then 07:00 started the evening before (across midnight),
 * 07:10 then 14:40 is a day sleep on the same date. Real moments, so a night across a clock change is its true length.
 * Null when it cannot be a sleep (same time twice, or longer than 20 h).
 */
export function spanFromClock(day: string, asleep: string, wake: string, tz: string): { start: number; end: number; mins: number } | null {
  if (!okDay(day) || !okClock(asleep) || !okClock(wake)) return null;
  const [y, mo, d] = day.split("-").map(Number);
  const end = zonedToTs(y, mo, d, ...(wake.split(":").map(Number) as [number, number]), tz);
  let start = zonedToTs(y, mo, d, ...(asleep.split(":").map(Number) as [number, number]), tz);
  if (start >= end) { const p = addDay(day, -1).split("-").map(Number); start = zonedToTs(p[0], p[1], p[2], ...(asleep.split(":").map(Number) as [number, number]), tz); }
  const mins = Math.round((end - start) / 60000);
  if (mins <= 0 || mins > MAX_SLEEP) return null;
  return { start, end, mins };
}

/** Minutes asleep: the hand set number when there is one, else wake minus fall asleep, minus any breaks (V1.43: time
 *  asleep, not time in bed, so streaks and averages count sleep). */
export function sleepMins(l: Pick<SleepLog, "start" | "end" | "mins"> & { breaks?: SleepBreak[] | null }): number {
  if (typeof l.mins === "number" && Number.isFinite(l.mins) && l.mins > 0) return Math.min(MAX_SLEEP, Math.round(l.mins));
  const m = Math.round((Date.parse(l.end) - Date.parse(l.start)) / 60000) - breaksMins(l);
  return Number.isFinite(m) && m > 0 ? Math.min(MAX_SLEEP, m) : 0;
}
/** Breaks kept inside the sleep, in order, never overlapping, at most MAX_BREAKS (anything odd is dropped). */
export function cleanBreaks(v: unknown, start: number, end: number): SleepBreak[] {
  if (!Array.isArray(v)) return [];
  const out: { s: number; e: number }[] = [];
  for (const b of v) {
    if (!b || typeof b !== "object") continue;
    const s = Math.max(start, Date.parse((b as SleepBreak).start)), e = Math.min(end, Date.parse((b as SleepBreak).end));
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) out.push({ s, e });
  }
  out.sort((a, b) => a.s - b.s);
  const merged: { s: number; e: number }[] = [];
  for (const x of out) { const last = merged[merged.length - 1]; if (last && x.s <= last.e) last.e = Math.max(last.e, x.e); else merged.push({ ...x }); }
  return merged.slice(0, MAX_BREAKS).map((x) => ({ start: new Date(x.s).toISOString(), end: new Date(x.e).toISOString() }));
}
/** Minutes of breaks inside the sleep. */
export function breaksMins(l: { start: string; end: string; breaks?: SleepBreak[] | null }): number {
  const s = Date.parse(l.start), e = Date.parse(l.end);
  return cleanBreaks(l.breaks, s, e).reduce((t, b) => t + Math.round((Date.parse(b.end) - Date.parse(b.start)) / 60000), 0);
}
/** "1 break: 30 min, 3 h in" or "2 breaks: 45 min"; null with none. */
export function breakLine(l: { start: string; end: string; breaks?: SleepBreak[] | null }): string | null {
  const bs = cleanBreaks(l.breaks, Date.parse(l.start), Date.parse(l.end));
  if (!bs.length) return null;
  const total = breaksMins(l);
  if (bs.length > 1) return `${bs.length} breaks: ${fmtMins(total)}`;
  const into = Math.round((Date.parse(bs[0].start) - Date.parse(l.start)) / 60000);
  return `1 break: ${fmtMins(total)}, ${fmtMins(into)} in`;
}

/** A log as it is saved: wake date worked out in tz, rested kept to 1 to 5, the hand set minutes dropped when they
 *  equal the clock difference (so moving a time later re-works the hours). */
export function makeLog(p: { start: number; end: number; tz: string; mins?: number | null; rested?: number | null; src?: SleepLog["src"]; breaks?: SleepBreak[] | null }, now = new Date()): SleepLog | null {
  if (!(p.end > p.start)) return null;
  const clock = Math.round((p.end - p.start) / 60000);
  if (clock > MAX_SLEEP) return null;
  const own = typeof p.mins === "number" && Number.isFinite(p.mins) ? Math.round(p.mins) : null;
  const rested = typeof p.rested === "number" && p.rested >= 1 && p.rested <= 5 ? Math.round(p.rested) : null;
  return {
    day: dayIn(p.end, p.tz), start: new Date(p.start).toISOString(), end: new Date(p.end).toISOString(), tz: p.tz,
    mins: own != null && own > 0 && own <= MAX_SLEEP && own !== clock ? own : null,
    rested, src: p.src ?? "hand", ...(() => { const b = cleanBreaks(p.breaks, p.start, p.end); return b.length ? { breaks: b } : {}; })(), at: now.toISOString(),
  };
}

/** A record read back from the vault, checked (anything odd is skipped, never drawn). */
export function cleanLog(v: unknown): SleepLog | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!okDay(o.day) || typeof o.start !== "string" || typeof o.end !== "string" || typeof o.tz !== "string") return null;
  const s = Date.parse(o.start), e = Date.parse(o.end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || (e - s) / 60000 > MAX_SLEEP) return null;
  return {
    day: o.day, start: o.start, end: o.end, tz: o.tz,
    mins: typeof o.mins === "number" && o.mins > 0 && o.mins <= MAX_SLEEP ? o.mins : null,
    rested: typeof o.rested === "number" && o.rested >= 1 && o.rested <= 5 ? Math.round(o.rested) : null,
    src: o.src === "sleepmode" ? "sleepmode" : "hand",
    ...(() => { const b = cleanBreaks(o.breaks, s, e); return b.length ? { breaks: b } : {}; })(),
    at: typeof o.at === "string" ? o.at : o.end,
  };
}
/** Two devices that each saved the same sleep: the newer change wins. */
export function mergeLog(a: SleepLog, b: SleepLog): SleepLog { return (b.at || "") > (a.at || "") ? b : a; }

/** One sleep per wake date (if two records name the same date, the newer change wins), newest date first. */
export function byDay(logs: Iterable<SleepLog>): Map<string, SleepLog> {
  const m = new Map<string, SleepLog>();
  for (const l of logs) { const h = m.get(l.day); if (!h || (l.at || "") > (h.at || "")) m.set(l.day, l); }
  return new Map([...m.entries()].sort((a, b) => b[0].localeCompare(a[0])));
}

// ---------- what Fitness shows ----------
export const onTarget = (l: SleepLog, target: number) => sleepMins(l) >= clampTarget(target);

/** Nights in a row on target, counting back from today by wake date. Today and the 2 days before may still be
 *  empty (they can be filled in) without breaking it; a short night or an older empty day ends it. */
export function streak(days: Map<string, SleepLog>, today: string, target: number): number {
  let n = 0;
  for (let i = 0; i < 4000; i++) {
    const d = addDay(today, -i), l = days.get(d);
    if (!l) { if (i <= BACKFILL_DAYS && n === 0) continue; break; }
    if (!onTarget(l, target)) break;
    n++;
  }
  return n;
}
/** The streak badge reached (3, 5, 7, 14, 30) and the next one. */
export function badge(n: number): { has: number | null; next: number | null } {
  let has: number | null = null, next: number | null = null;
  for (const b of BADGES) { if (n >= b) has = b; else { next = b; break; } }
  return { has, next };
}

/** The 7 wake dates ending today (oldest first), with the sleep for each, if logged. */
export function lastSeven(days: Map<string, SleepLog>, today: string): { day: string; log: SleepLog | null }[] {
  return Array.from({ length: 7 }, (_, i) => { const d = addDay(today, i - 6); return { day: d, log: days.get(d) ?? null }; });
}
export interface Week { logged: number; onTarget: number; avg: number | null; lastAvg: number | null }
/** This week (today and the 6 days before) and the week before it: average time asleep of the logged nights. */
export function weekStats(days: Map<string, SleepLog>, today: string, target: number): Week {
  const span = (from: number) => { const out: SleepLog[] = []; for (let i = from; i < from + 7; i++) { const l = days.get(addDay(today, -i)); if (l) out.push(l); } return out; };
  const avg = (ls: SleepLog[]) => (ls.length ? Math.round(ls.reduce((s, l) => s + sleepMins(l), 0) / ls.length) : null);
  const now = span(0), before = span(7);
  return { logged: now.length, onTarget: now.filter((l) => onTarget(l, target)).length, avg: avg(now), lastAvg: avg(before) };
}

/** The clock times of a sleep in its own zone (so a trip abroad does not move your usual). */
export function clocksOf(l: SleepLog): { asleep: string; wake: string } {
  return { asleep: clockIn(Date.parse(l.start), l.tz), wake: clockIn(Date.parse(l.end), l.tz) };
}
/** The middle of some clock times, across midnight (23:50 and 00:10 are 20 minutes apart, not 23 h 40). Each time
 *  is read as an offset from the first one in -12 h to +12 h, the median of those, back to a clock time. */
export function clockMedian(times: string[]): string | null {
  if (!times.length) return null;
  const ref = toMin(times[0]);
  const offs = times.map((t) => { let o = toMin(t) - ref; if (o > 720) o -= 1440; if (o <= -720) o += 1440; return o; }).sort((a, b) => a - b);
  const mid = offs.length % 2 ? offs[(offs.length - 1) / 2] : (offs[offs.length / 2 - 1] + offs[offs.length / 2]) / 2;
  return fromMin(ref + mid);
}
/** Minutes between two clock times, the short way round the clock. */
export function clockGap(a: string, b: string): number { const d = Math.abs(toMin(a) - toMin(b)) % 1440; return Math.min(d, 1440 - d); }

export interface Steady { steady: number; of: number; asleep: string | null; wake: string | null; wakeMoved: number | null }
/** Of the last 7 logged sleeps, how many had both times within an hour of your usual. Needs 3 to say anything. */
export function steadiness(days: Map<string, SleepLog>, today: string): Steady | null {
  const recent = [...days.values()].filter((l) => l.day <= today && l.day > addDay(today, -14)).slice(0, 7);
  if (recent.length < 3) return null;
  const c = recent.map(clocksOf);
  const asleep = clockMedian(c.map((x) => x.asleep))!, wake = clockMedian(c.map((x) => x.wake))!;
  const steady = c.filter((x) => clockGap(x.asleep, asleep) <= STEADY_WINDOW && clockGap(x.wake, wake) <= STEADY_WINDOW).length;
  const wakeMoved = Math.round(c.reduce((s, x) => s + clockGap(x.wake, wake), 0) / c.length);
  return { steady, of: recent.length, asleep, wake, wakeMoved };
}
/** The usual times for the log card (median of the last 7 sleeps), or the plain defaults. */
export function usual(days: Map<string, SleepLog>): { asleep: string; wake: string; known: boolean } {
  const recent = [...days.values()].slice(0, 7);
  if (recent.length < 3) return { asleep: recent[0] ? clocksOf(recent[0]).asleep : DEF_ASLEEP, wake: recent[0] ? clocksOf(recent[0]).wake : DEF_WAKE, known: false };
  const c = recent.map(clocksOf);
  return { asleep: clockMedian(c.map((x) => x.asleep))!, wake: clockMedian(c.map((x) => x.wake))!, known: true };
}

/** The once a day question: on, not put off today, and no sleep logged that ended in the last 18 hours (so a night
 *  worker opening Fitness before bed is not asked about a sleep they have not had yet). */
export const ASK_GAP = 18 * 3600_000;
export function askNow(days: Map<string, SleepLog>, now: number, today: string, prefs: { sleepAsk?: boolean; sleepSkip?: string | null }): boolean {
  if (prefs.sleepAsk === false || prefs.sleepSkip === today) return false;
  if (days.has(today)) return false;
  for (const l of days.values()) if (now - Date.parse(l.end) < ASK_GAP) return false;
  return true;
}

/** At most one calm private note (research 3.4): never a badge, never shared, never a diagnosis. */
export function sleepNote(days: Map<string, SleepLog>, today: string): string | null {
  const within = (n: number) => [...days.values()].filter((l) => l.day <= today && l.day > addDay(today, -n));
  const week = within(7), two = within(14);
  if (week.filter((l) => sleepMins(l) < 5 * 60).length >= 3) return "That's a short week. Under 7 h regularly affects mood, training and health.";
  if (two.length >= 10 && two.reduce((s, l) => s + sleepMins(l), 0) / two.length > 10 * 60) return "Long sleep can be a sign you are run down or unwell. Worth mentioning to a doctor if it continues.";
  if (two.filter((l) => l.rested === 1 && sleepMins(l) >= 7 * 60).length >= 8) return "Feeling unrested after enough sleep is worth checking with a doctor.";
  return null;
}

// ---------- words ----------
/** 450 -> "7 h 30", 420 -> "7 h", 45 -> "45 min". */
export function fmtMins(m: number): string {
  const r = Math.max(0, Math.round(m));
  const h = Math.floor(r / 60), mi = r % 60;
  return h ? (mi ? `${h} h ${pad(mi)}` : `${h} h`) : `${mi} min`;
}
export function nightsWord(n: number) { return n === 1 ? "1 night" : `${n} nights`; }

// ---------- G Squad (read only; this file never sends anything) ----------
export interface SleepSummary { streak: number; weekAvgMins: number | null }
/** The ONLY sleep a G Squad board may share: the streak and this week's average. Nothing at all (null) when the
 *  person switched sleep sharing off. Never times, ratings, notes or single nights: those stay in your vault. */
export function sleepSummary(logs: Iterable<SleepLog>, prefs: { sleepShare?: boolean; sleepTarget?: number }, today: string): SleepSummary | null {
  if (prefs.sleepShare === false) return null;
  const days = byDay(logs), target = clampTarget(prefs.sleepTarget);
  return { streak: streak(days, today, target), weekAvgMins: weekStats(days, today, target).avg };
}

// ---------- the bedside Sleep mode hook (future; see ps-handover-notes/future-ideas.md) ----------
/** "Went to sleep" then "Wake up": the log a Sleep mode would save. Null for a doze under 30 min (not a main sleep)
 *  or anything over 20 h (a forgotten button). An existing hand log for that date is replaced only if it is older. */
export function logFromSleepMode(asleepAt: number, wokeAt: number, tz: string, now = new Date(), breaks?: SleepBreak[] | null): SleepLog | null {
  if (wokeAt - asleepAt < 30 * 60000) return null;
  return makeLog({ start: asleepAt, end: wokeAt, tz, src: "sleepmode", breaks }, now);
}

// The time of the automatic Reset, and the day your tasks belong to (the developer, 8 Nov 2026: "make it so you can actually
// alter the time as well, so for example if you want to change it to 4am you can").
//
// settings.autoResetAt is "HH:MM" (missing or unreadable = "00:00", midnight, so nothing changes for anyone who never
// touches it). It is read in your own time zone (Settings, Your time zone; empty = this device's zone), and it does
// two jobs:
// 1. The automatic Reset (settings.autoReset "midnight" means on; the value keeps its old name so older builds still
//    read it) runs once per day at that time. A Mac or phone that was asleep or off then does it as soon as it runs
//    again, once, however many days were missed. Each Reset writes the day it belongs to (settings.lastResetDay), so
//    a time zone change or a new reset time never makes it run twice for one day.
// 2. Your day starts at that time: with 04:00, a task ticked at 02:00 belongs to the day before. That day is used by
//    Completed "Today" (and 7 or 30 days), the history an automatic Reset files ticks into, the date a Reset uses for
//    repeating tasks and streaks, and the G Squad leaderboard's tasks per day and month.
//    Not by: the Sleep log (a night is the sleep that ends on a date, by design), screen time (the phone and Mac count
//    calendar days), due dates and Overdue (calendar dates), and a Reset you press yourself, which still saves to the
//    day set by "Your work day ends at" (core/daylog.ts).
// Pure date maths, tested in tests/resettime.test.ts.
import { wall, zonedToTs } from "./tz.ts";

export const RESET_AT_DEFAULT = "00:00";
const pad = (n: number) => String(n).padStart(2, "0");
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A clock time the reset can run at: "00:00" to "23:59". */
export const okResetAt = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
/** The reset time from settings (anything unreadable is midnight). */
export function resetAtOf(s: { autoResetAt?: unknown } | null | undefined): string {
  return okResetAt(s?.autoResetAt) ? s!.autoResetAt as string : RESET_AT_DEFAULT;
}
/** Minutes after midnight. */
export function resetMinOf(s: { autoResetAt?: unknown } | null | undefined): number {
  const [h, m] = resetAtOf(s).split(":").map(Number);
  return h * 60 + m;
}
/** "midnight", "4am", "4:30am", "4pm" (for a sentence; the picker shows the clock as the device writes it). */
export function resetAtWords(at: string): string {
  if (!okResetAt(at) || at === "00:00") return "midnight";
  if (at === "12:00") return "noon";
  const [h, m] = at.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ""}${h < 12 ? "am" : "pm"}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** The day a moment belongs to (YYYY-MM-DD): its date in tz, or the day before when it is before the reset time. */
export function resetDayOf(ts: number, tz: string, atMin = 0): string {
  const w = wall(ts, tz);
  const day = `${w.y}-${pad(w.mo)}-${pad(w.d)}`;
  return w.h * 60 + w.mi < atMin ? addDays(day, -1) : day;
}

/** The moment a day starts (ms): its date at the reset time in tz. */
export function dayStartAt(day: string, tz: string, atMin = 0): number {
  const [y, m, d] = day.split("-").map(Number);
  return zonedToTs(y, m, d, Math.floor(atMin / 60), atMin % 60, tz);
}

/** The next reset time after now (ms). */
export function nextResetAt(now: number, tz: string, atMin = 0): number {
  const today = resetDayOf(now, tz, atMin);
  let at = dayStartAt(addDays(today, 1), tz, atMin);
  if (at <= now) at = dayStartAt(addDays(today, 2), tz, atMin);   // a daylight saving edge, never in practice
  return at;
}

type ResetState = { autoReset?: string; autoResetAt?: unknown; lastResetAt?: string | null; lastResetDay?: unknown };

/** The latest day already reset: the day the last Reset wrote, or (from a build before 8 Nov 2026, which only wrote
 *  lastResetAt) the day that moment belongs to now. The later of the two, so neither can make it run again. */
export function lastResetDayOf(s: ResetState, tz: string): string | null {
  const a = typeof s.lastResetDay === "string" && DAY.test(s.lastResetDay) ? s.lastResetDay : null;
  const t = s.lastResetAt ? Date.parse(s.lastResetAt) : NaN;
  const b = Number.isFinite(t) ? resetDayOf(t, tz, resetMinOf(s)) : null;
  return a && b ? (a > b ? a : b) : a || b;
}

/** Is the automatic Reset due now? On, and today (by the reset time) is later than the last day reset. */
export function autoResetDue(s: ResetState | null | undefined, now: number, tz: string): boolean {
  if (!s || s.autoReset !== "midnight") return false;
  const last = lastResetDayOf(s, tz);
  return !last || resetDayOf(now, tz, resetMinOf(s)) > last;
}

/** Group ticks by the day each was done (an automatic Reset that caught up after a few days asleep files each tick
 *  into its own day, not all into one). */
export function byResetDay<T extends { at: string }>(items: T[], tz: string, atMin = 0): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const i of items) {
    const t = Date.parse(i.at);
    if (!Number.isFinite(t)) continue;
    const k = resetDayOf(t, tz, atMin);
    const l = out.get(k);
    if (l) l.push(i); else out.set(k, [i]);
  }
  return out;
}

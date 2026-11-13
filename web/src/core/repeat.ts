// Repeating tasks and streaks. Pure date maths on "YYYY-MM-DD" strings, so it runs in tests too.
//
// A repeating task has type "daily" (it never leaves the list) plus an optional rule. No rule means
// every day. For anything longer (every other day, every week, month, year) the task's `due` is the
// occurrence it is waiting on and `repeat.from` is the first one, so months never drift (31 Jan,
// 28 Feb, 31 Mar).
//
// Streaks follow the developer's Reset button, not the clock: ticking a repeating task adds one, and a reset
// that finds it due and not done ends the streak. Midnight never touches it, so a 1am tick still
// counts for the day before. A task that is due today is never counted as missed: it gets until the
// reset after today.

export type RepeatUnit = "day" | "week" | "month" | "year";
export interface Repeat { every: number; unit: RepeatUnit; from: string }

/** The fields this file reads and writes on a to-do. */
export interface RepeatTask {
  type: "daily" | "once";
  done: boolean;
  doneAt?: string | null;
  due?: string | null;
  repeat?: Repeat | null;
  streak?: number;
  streakTicked?: boolean;    // this round's tick already counted (so untick, tick again stays fair)
  bestStreak?: number;
}

const re = /^\d{4}-\d{2}-\d{2}$/;
export const isISO = (s: unknown): s is string => typeof s === "string" && re.test(s);
const parts = (iso: string) => iso.split("-").map(Number) as [number, number, number];
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

export function plusDays(iso: string, n: number) {
  const [y, m, d] = parts(iso);
  return fmt(new Date(Date.UTC(y, m - 1, d + n)));
}
/** Add months, keeping the day of the month where it fits (31st becomes the 28th, 30th or 31st). */
export function plusMonths(iso: string, n: number) {
  const [y, m, d] = parts(iso);
  const total = (m - 1) + n, ny = y + Math.floor(total / 12), nm = ((total % 12) + 12) % 12;
  return fmt(new Date(Date.UTC(ny, nm, Math.min(d, daysIn(ny, nm)))));
}
/** The k-th occurrence after `from` (k = 0 is `from` itself). */
export function occurrence(r: Repeat, k: number) {
  const n = k * r.every;
  return r.unit === "day" ? plusDays(r.from, n) : r.unit === "week" ? plusDays(r.from, n * 7)
    : r.unit === "month" ? plusMonths(r.from, n) : plusMonths(r.from, n * 12);
}
/** The first occurrence strictly after `after`. */
export function nextAfter(r: Repeat, after: string) {
  // Jump close first, then step: keeps a ten year old "every day" rule fast.
  const [fy, fm] = parts(r.from), [ay, am] = parts(after);
  const spanDays = (Date.UTC(ay, am - 1, parts(after)[2]) - Date.UTC(fy, fm - 1, parts(r.from)[2])) / 86400000;
  const unitDays = r.unit === "day" ? 1 : r.unit === "week" ? 7 : r.unit === "month" ? 28 : 365;
  let k = Math.max(0, Math.floor(spanDays / (unitDays * r.every)) - 2);
  let d = occurrence(r, k);
  while (d <= after) d = occurrence(r, ++k);
  return d;
}

/** Every day is the plain daily task (no rule, or every 1 day). */
export const isEveryDay = (t: RepeatTask) => t.type === "daily" && (!t.repeat || (t.repeat.unit === "day" && t.repeat.every === 1));
export const isRepeating = (t: RepeatTask) => t.type === "daily";

/** Should it show as something to do today? Longer repeats wait out of sight until they are due. */
export function isDueNow(t: RepeatTask, today: string) {
  if (!isRepeating(t) || isEveryDay(t)) return true;
  return !t.due || t.due <= today || t.done;
}

/** "Every day", "Every other day", "Every 3 days", "Every week", "Every 2 weeks", "Every month", "Every year". */
export function repeatLabel(r?: Repeat | null) {
  if (!r || (r.unit === "day" && r.every === 1)) return "Every day";
  if (r.every === 1) return `Every ${r.unit}`;
  if (r.every === 2 && r.unit === "day") return "Every other day";
  return `Every ${r.every} ${r.unit}s`;
}

/** Clean a rule from anywhere (the Tab list, a package). Null means every day. */
export function cleanRepeat(r: unknown, fallbackFrom: string): Repeat | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const unit = (["day", "week", "month", "year"] as const).find((u) => u === o.unit);
  const every = Math.round(Number(o.every));
  if (!unit || !Number.isFinite(every) || every < 1 || every > 365) return null;
  if (unit === "day" && every === 1) return null;
  return { every, unit, from: isISO(o.from) ? o.from : fallbackFrom };
}

/** The changes to make when the task is ticked or unticked. */
export function tickPatch(t: RepeatTask, at: string): Partial<RepeatTask> {
  const done = !t.done;
  const base: Partial<RepeatTask> = { done, doneAt: done ? at : null };
  if (!isRepeating(t)) return base;
  const streak = t.streak || 0;
  if (done && !t.streakTicked) {
    const next = streak + 1;
    return { ...base, streak: next, streakTicked: true, bestStreak: Math.max(t.bestStreak || 0, next) };
  }
  if (!done && t.streakTicked) return { ...base, streak: Math.max(0, streak - 1), streakTicked: false };
  return base;
}

/**
 * What the Reset button does to a repeating task, or null to leave it alone.
 * Done: untick it, keep the streak, and move a longer repeat on to its next date.
 * Not done and missed: the streak ends (an every day task is missed whenever it is not done;
 * a longer one only once its date is before today). It stays on the list either way.
 */
export function resetPatch(t: RepeatTask, today: string): Partial<RepeatTask> | null {
  if (!isRepeating(t)) return null;
  const every = isEveryDay(t);
  if (t.done) {
    const p: Partial<RepeatTask> = { done: false, doneAt: null, streakTicked: false };
    if (!every && t.repeat) p.due = nextAfter(t.repeat, today);
    return p;
  }
  const missed = every || (!!t.due && t.due < today);
  if (missed && ((t.streak || 0) > 0 || t.streakTicked)) return { streak: 0, streakTicked: false };
  return null;
}

// ---------- the editors ----------
export type RepeatKind = "once" | "daily" | "repeat";
export interface RepeatDraft { kind: RepeatKind; every: number; unit: RepeatUnit; from: string }

export function draftOf(t: Partial<RepeatTask> | null, today: string): RepeatDraft {
  if (!t || t.type !== "daily") return { kind: "once", every: 1, unit: "week", from: t?.due || today };
  if (isEveryDay(t as RepeatTask)) return { kind: "daily", every: 1, unit: "week", from: today };
  const r = t.repeat!;
  return { kind: "repeat", every: r.every, unit: r.unit, from: t.due || r.from };
}

/** The type, rule and date to save. One-offs keep the date the editor gives them. */
export function patchOf(d: RepeatDraft, today: string, prev?: Partial<RepeatTask> | null):
  { type: "daily" | "once"; repeat: Repeat | null; due?: string | null } {
  if (d.kind === "once") return { type: "once", repeat: null };
  const r = d.kind === "repeat" ? cleanRepeat({ every: d.every, unit: d.unit, from: isISO(d.from) ? d.from : today }, today) : null;
  if (!r) return { type: "daily", repeat: null, due: null };
  const same = prev?.repeat && prev.repeat.every === r.every && prev.repeat.unit === r.unit && prev.due === r.from;
  if (same) return { type: "daily", repeat: prev!.repeat!, due: prev!.due! };
  // The first date it is due: the start date, or the next one on the schedule if that has passed.
  const due = r.from >= today ? r.from : nextAfter(r, plusDays(today, -1));
  return { type: "daily", repeat: r, due };
}

export const REPEAT_PRESETS: { key: string; label: string; every: number; unit: RepeatUnit }[] = [
  { key: "2-day", label: "Every other day", every: 2, unit: "day" },
  { key: "1-week", label: "Every week", every: 1, unit: "week" },
  { key: "2-week", label: "Every 2 weeks", every: 2, unit: "week" },
  { key: "1-month", label: "Every month", every: 1, unit: "month" },
  { key: "3-month", label: "Every 3 months", every: 3, unit: "month" },
  { key: "1-year", label: "Every year", every: 1, unit: "year" },
];

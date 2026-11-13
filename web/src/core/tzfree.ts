// Am I free then? (V1.57, the developer 13 Nov 2026: "When you're converting a time, check your calendar and the PS app tasks
// as well, and tell you if you're available at that time for, let's say, a one hour meeting; and if you're not
// available, say what task or what meeting is in the way.")
//
// Under the converted time in Convert a time: a window from that moment, 30 minutes, 1 hour (the default) or
// 2 hours long, is checked against
// - the meetings: the same calendar copies the Meetings panel reads (Mac Calendar or the linked Google calendar,
//   and any calendar linked to one Meetings panel), less the meetings taken off the panel and the ones declined;
// - PS tasks with a time: an open task due at a time ("2026-11-14T15:00", read in your own zone like the Overdue
//   rule), and an open task with a reminder on it (core/remind.ts task reminders: once on a date, or on the days
//   picked, at its start time in its own zone). A task counts as TASK_MIN minutes from its time.
// All day events never make you busy (a holiday or a birthday is not a meeting); they are listed as "That day" so
// nothing is hidden. Everything is worked out on this device from records already in the vault: nothing new is
// fetched or sent anywhere.
//
// Pure: no vault, no clock, no React. tests/tzfree.test.ts checks it.
import type { CalEvent } from "./model";
import { meetKey, type MeetHide } from "./meethide.ts";
import { wall, zonedToTs } from "./tz.ts";
import type { Reminder } from "./remind";

export const FREE_LENGTHS = [30, 60, 120] as const;
export type FreeLen = (typeof FREE_LENGTHS)[number];
export const FREE_LEN_DEF: FreeLen = 60;
/** How long a task with a time takes up, in minutes. */
export const TASK_MIN = 30;
/** A meeting with no end (or an end before its start) is taken as this long, in minutes. */
export const NO_END_MIN = 30;

const MIN = 60000, DAY_MS = 86400000;

export type Busy = {
  kind: "meeting" | "task";
  title: string;
  start: number;
  end: number;
  allDay?: boolean;
  /** Where it came from, so the same thing is never listed twice. */
  key: string;
};

/** Two spans [aS, aE) and [bS, bE) share some time. One that ends as the other starts does not clash. */
export const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The start of a calendar day ("2026-11-14") in a zone. */
const dayStartIn = (s: string, tz: string) => { const m = DATE.exec(s)!; return zonedToTs(+m[1], +m[2], +m[3], 0, 0, tz); };

/** You said no to it (the Mac and Google both mark your own answer on your own attendee line). */
const declined = (e: CalEvent) => e.attendees?.some((a) => a.self && a.rsvp === "declined") ?? false;

/** The calendar events as spans of time. tz: your own zone (an all day event runs midnight to midnight there). */
export function eventBlocks(events: CalEvent[], tz: string, hidden?: MeetHide[]): Busy[] {
  const gone = new Set((hidden || []).map((h) => h.key));
  const out: Busy[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (!e || !e.start || declined(e) || gone.has(meetKey(e))) continue;
    const key = "m:" + meetKey(e);
    if (seen.has(key)) continue;   // the same event in two calendar copies (the usual one and a panel's own)
    let start: number, end: number;
    if (e.allDay && DATE.test(e.start)) {
      // Google: "2026-11-14" to "2026-11-15" (the end day is not part of it).
      start = dayStartIn(e.start, tz);
      end = e.end && DATE.test(e.end) ? dayStartIn(e.end, tz) : start + DAY_MS;
      if (end <= start) end = zonedToTs(...ymdPlus(e.start, 1), 0, 0, tz);
    } else {
      start = Date.parse(e.start);
      end = e.end ? Date.parse(e.end) : NaN;
      if (!Number.isFinite(start)) continue;
      if (!Number.isFinite(end) || end <= start) end = start + (e.allDay ? DAY_MS : NO_END_MIN * MIN);
    }
    seen.add(key);
    out.push({ kind: "meeting", title: e.title || "(no title)", start, end, allDay: e.allDay || undefined, key });
  }
  return out;
}

function ymdPlus(s: string, n: number): [number, number, number] {
  const m = DATE.exec(s)!;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

/** The moment a task's due happens, or null when it has no time (a day only, or nothing). Times with no zone are
 *  read in your own zone, the same as the Overdue rule (core/overdue.ts). */
export function dueMoment(due: string | null | undefined, tz: string): number | null {
  if (!due) return null;
  const m = LOCAL.exec(due);
  if (m) return zonedToTs(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
  if (ZONED.test(due)) { const t = Date.parse(due); return Number.isFinite(t) ? t : null; }
  return null;
}

export type TaskLike = { id: string; title: string; due?: string | null; done?: boolean; clearedAt?: string | null };

/** The PS tasks with a time that touch [from, to): due at a time, or a reminder on the task (once on its date, or
 *  each day picked). tz: your own zone; deviceTz: the zone a reminder with no zone of its own uses. */
export function taskBlocks(tasks: TaskLike[], reminders: Reminder[], from: number, to: number, tz: string, deviceTz = tz): Busy[] {
  const open = new Map(tasks.filter((t) => t && !t.done && !t.clearedAt).map((t) => [t.id, t]));
  const out: Busy[] = [];
  const seen = new Set<string>();
  const add = (t: TaskLike, start: number, how: string) => {
    const end = start + TASK_MIN * MIN;
    if (!overlaps(start, end, from, to)) return;
    const key = `t:${t.id}@${start}`;   // a due and a reminder at the same moment are one thing
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind: "task", title: t.title || "(no name)", start, end, key: key + how });
  };
  for (const t of open.values()) {
    const at = dueMoment(t.due, tz);
    if (at !== null) add(t, at, "");
  }
  for (const r of reminders || []) {
    if (!r || !r.on || !r.task || !HM.test(r.at)) continue;
    const t = open.get(r.task);
    if (!t) continue;
    const rtz = r.tz || deviceTz;
    const [h, mi] = r.at.split(":").map(Number);
    if (r.date && DATE.test(r.date)) {
      const [y, mo, d] = ymdPlus(r.date, 0);
      add(t, zonedToTs(y, mo, d, h, mi, rtz), "");
      continue;
    }
    // On the days picked: every day in its zone from the day before the window to the day after it.
    const first = wall(from - DAY_MS, rtz), last = to + DAY_MS;
    for (let i = 0; i < 40; i++) {
      const day = new Date(Date.UTC(first.y, first.mo - 1, first.d + i));
      const y = day.getUTCFullYear(), mo = day.getUTCMonth() + 1, d = day.getUTCDate();
      const at = zonedToTs(y, mo, d, h, mi, rtz);
      if (at >= last) break;
      if ((r.days?.length ? r.days : [0, 1, 2, 3, 4, 5, 6]).includes(day.getUTCDay())) add(t, at, "");
    }
  }
  return out;
}

export type FreeAnswer = {
  free: boolean;
  /** What is in the way, soonest first (all day events never are). */
  clashes: Busy[];
  /** All day events that day: shown, never counted as busy. */
  allDay: Busy[];
};

/** Is [start, start + len minutes) free? */
export function checkFree(start: number, len: number, busy: Busy[]): FreeAnswer {
  const end = start + len * MIN;
  const hit = busy.filter((b) => overlaps(b.start, b.end, start, end));
  const clashes = hit.filter((b) => !b.allDay).sort((a, b) => a.start - b.start || a.end - b.end);
  const allDay = hit.filter((b) => b.allDay).sort((a, b) => a.start - b.start);
  return { free: clashes.length === 0, clashes, allDay };
}

/** Did any calendar copy look as far as this window? (A copy covers its from to to; none at all: no calendar.) */
export function calendarCovers(ranges: { from?: string | null; to?: string | null }[], start: number, end: number): "yes" | "no" | "none" {
  if (!ranges.length) return "none";
  for (const r of ranges) {
    const f = r.from ? Date.parse(r.from) : NaN, t = r.to ? Date.parse(r.to) : NaN;
    if (!Number.isFinite(f) || !Number.isFinite(t)) return "yes";   // an older copy with no range: trust it
    if (start >= f && end <= t) return "yes";
  }
  return "no";
}

/** "30 minutes", "1 hour", "2 hours". */
export function lenWords(n: number) {
  if (n < 60) return `${n} minutes`;
  const h = n / 60;
  return `${h} hour${h === 1 ? "" : "s"}`;
}
/** The short button label: "30 min", "1 h", "2 h". */
export const lenShort = (n: number) => (n < 60 ? `${n} min` : `${n / 60} h`);

/** The name shown for a clash: the real one, or (private mode on) just what kind of thing it is. */
export const clashName = (b: Pick<Busy, "kind" | "title">, priv: boolean) => (priv ? (b.kind === "meeting" ? "A meeting" : "A task") : b.title);

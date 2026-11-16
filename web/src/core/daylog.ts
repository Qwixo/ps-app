// The history of what the developer got done, day by day. Reset writes every ticked task into the log of the
// work day it was done on, so the Map can show it later (repeating tasks lose their tick on Reset,
// so without the log they would vanish from history).
//
// The developer works nights: pressing Reset at 5am or 10am closes the day before. Everything ticked since the
// last reset goes to that one day. A Reset before `dayEndsHour` (local time, settings.dayEndsHour,
// 15 by default) counts for the day before; from then on it counts for the same day.

import { capMissed, totalsOf, type MissedItem } from "./taskhist.ts";

export const DAY_ENDS_DEFAULT = 15;

export interface DayLogItem { todoId: string; title: string; at: string; repeat?: boolean; clientId?: string | null;
  parentId?: string; parentTitle?: string; p1?: boolean }   // a mini task: done under this task (todoId is "parent/mini"); p1: it was Priority 1 (PS 1.65, older ticks have none)
/** PS 1.65 (core/taskhist.ts): what was NOT done that day, what was added, deleted and moved to Dimension X, and the day's
 *  totals. All optional: a log from an older PS has none of them and reads exactly as before. */
export interface DayLog { date: string; items: DayLogItem[]; updatedAt: string;
  missed?: import("./taskhist.ts").MissedItem[]; added?: import("./taskhist.ts").EvItem[]; deleted?: import("./taskhist.ts").EvItem[];
  dimx?: import("./taskhist.ts").EvItem[]; totals?: import("./taskhist.ts").DayTotals }

const pad = (n: number) => String(n).padStart(2, "0");
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The work day a moment belongs to: before the cut off hour it still counts as the day before. */
export function workDayOf(ts: string | number | Date, dayEndsHour = DAY_ENDS_DEFAULT) {
  const d = new Date(ts);
  if (d.getHours() < dayEndsHour) d.setDate(d.getDate() - 1);
  return isoLocal(d);
}

export const itemKey = (i: { todoId: string; at: string }) => `${i.todoId}|${i.at}`;

/** Add a reset's ticks to the log of its work day, never the same tick twice. Null when nothing is new.
 *  missed (PS 1.65): what this Reset found still open for that day (core/taskhist.ts planMissed). The newest Reset's view
 *  wins (a second Reset the same day replaces the first one's list), minus anything that was ticked in the meantime. */
export function addToLog(existing: DayLog | undefined, date: string, items: DayLogItem[], at: string, missed?: MissedItem[]): DayLog | null {
  const log: DayLog = existing ? structuredClone(existing) : { date, items: [], updatedAt: at };
  const seen = new Set(log.items.map(itemKey));
  const fresh = items.filter((i) => !seen.has(itemKey(i)));
  const before = JSON.stringify([log.missed, log.totals]);
  if (fresh.length) log.items.push(...fresh);
  if (missed) {
    const doneIds = new Set(log.items.map((i) => i.todoId));
    const full = missed.filter((m) => !doneIds.has(m.id));
    log.missed = capMissed(full);
    log.totals = totalsOf(log, { missed: full.length, p1Missed: full.filter((m) => m.p1).length });
  } else if (fresh.length && log.totals) log.totals = totalsOf(log);
  if (!fresh.length && JSON.stringify([log.missed, log.totals]) === before) return null;
  log.updatedAt = at;
  return log;
}

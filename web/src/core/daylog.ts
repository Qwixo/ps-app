// The history of what the developer got done, day by day. Reset writes every ticked task into the log of the
// work day it was done on, so the Map can show it later (repeating tasks lose their tick on Reset,
// so without the log they would vanish from history).
//
// The developer works nights: pressing Reset at 5am or 10am closes the day before. Everything ticked since the
// last reset goes to that one day. A Reset before `dayEndsHour` (local time, settings.dayEndsHour,
// 15 by default) counts for the day before; from then on it counts for the same day.

export const DAY_ENDS_DEFAULT = 15;

export interface DayLogItem { todoId: string; title: string; at: string; repeat?: boolean; clientId?: string | null;
  parentId?: string; parentTitle?: string }   // a mini task: done under this task (todoId is "parent/mini")
export interface DayLog { date: string; items: DayLogItem[]; updatedAt: string }

const pad = (n: number) => String(n).padStart(2, "0");
const isoLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The work day a moment belongs to: before the cut off hour it still counts as the day before. */
export function workDayOf(ts: string | number | Date, dayEndsHour = DAY_ENDS_DEFAULT) {
  const d = new Date(ts);
  if (d.getHours() < dayEndsHour) d.setDate(d.getDate() - 1);
  return isoLocal(d);
}

export const itemKey = (i: { todoId: string; at: string }) => `${i.todoId}|${i.at}`;

/** Add a reset's ticks to the log of its work day, never the same tick twice. Null when nothing is new. */
export function addToLog(existing: DayLog | undefined, date: string, items: DayLogItem[], at: string): DayLog | null {
  const log: DayLog = existing ? structuredClone(existing) : { date, items: [], updatedAt: at };
  const seen = new Set(log.items.map(itemKey));
  const fresh = items.filter((i) => !seen.has(itemKey(i)));
  if (!fresh.length) return null;
  log.items.push(...fresh);
  log.updatedAt = at;
  return log;
}

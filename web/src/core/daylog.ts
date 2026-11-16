// The history of what the developer got done, day by day. Reset writes every ticked task into the log of the
// work day it was done on, so the Map can show it later (repeating tasks lose their tick on Reset,
// so without the log they would vanish from history).
//
// The developer works nights: pressing Reset at 5am or 10am closes the day before. Everything ticked since the
// last reset goes to that one day. A Reset before `dayEndsHour` (local time, settings.dayEndsHour,
// 15 by default) counts for the day before; from then on it counts for the same day.

import { capMissed, TH, totalsOf, type EvItem, type MissedItem } from "./taskhist.ts";

export const DAY_ENDS_DEFAULT = 15;

export interface DayLogItem { todoId: string; title: string; at: string; repeat?: boolean; clientId?: string | null;
  parentId?: string; parentTitle?: string; p1?: boolean }   // a mini task: done under this task (todoId is "parent/mini"); p1: it was Priority 1 (PS 1.65, older ticks have none)
/** PS 1.65 (core/taskhist.ts): what was NOT done that day, what was added, deleted and moved to Dimension X, and the day's
 *  totals. All optional: a log from an older PS has none of them and reads exactly as before. */
export interface DayLog { date: string; items: DayLogItem[]; updatedAt: string;
  missed?: import("./taskhist.ts").MissedItem[]; missedAt?: string; added?: import("./taskhist.ts").EvItem[]; deleted?: import("./taskhist.ts").EvItem[];
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
    log.missedAt = at;
    log.totals = totalsOf(log, { missed: full.length, p1Missed: full.filter((m) => m.p1).length });
  } else if (fresh.length && log.totals) log.totals = totalsOf(log);
  if (!fresh.length && JSON.stringify([log.missed, log.totals]) === before) return null;
  log.updatedAt = at;
  return log;
}

// ---------- two devices, one day (PS 1.65 review) ----------
// Every device may write the same day's log (a Reset, an add, a delete, a Dimension X move), and the last write used to win, so a
// device that had not pulled yet could wipe another device's ticks. Now every write and every read merges, field by field:
// ticks by their key, added/deleted/Dimension X notes by task id, the missed list from the newer Reset (minus what was ticked since),
// the totals worked out again from the merged lists (counts past the 60 cap keep the biggest count either device had).
const EV_KINDS = ["added", "deleted", "dimx"] as const;
const byAt = (a: { at: string }, b: { at: string }) => a.at.localeCompare(b.at);

export function mergeDayLog(a: DayLog, b: DayLog): DayLog {
  if (!a) return b;
  if (!b) return a;
  const out: DayLog = { date: a.date || b.date, items: [], updatedAt: a.updatedAt >= b.updatedAt ? a.updatedAt : b.updatedAt };
  const seen = new Map<string, DayLogItem>();
  for (const i of [...(a.items || []), ...(b.items || [])]) if (!seen.has(itemKey(i))) seen.set(itemKey(i), i);
  out.items = [...seen.values()].sort(byAt);
  for (const k of EV_KINDS) {
    const m = new Map<string, EvItem>();
    for (const e of [...(a[k] || []), ...(b[k] || [])]) if (!m.has(e.id)) m.set(e.id, e);
    if (m.size) out[k] = [...m.values()].sort(byAt).slice(0, TH.max);
  }
  // The missed list: the newer Reset's view. A log with a list and no stamp (never both unstamped and different) counts as oldest.
  const ma = a.missedAt || "", mb = b.missedAt || "";
  const src = (a.missed || b.missed) ? ((b.missed && (!a.missed || mb > ma)) ? b : a) : null;
  const done = new Set(out.items.map((i) => i.todoId));
  let missedTotal: number | undefined, p1MissedTotal: number | undefined;
  if (src?.missed) {
    const kept = src.missed.filter((m) => !done.has(m.id));
    const gone = src.missed.length - kept.length, goneP1 = src.missed.filter((m) => done.has(m.id) && m.p1).length;
    out.missed = kept;
    if (src.missedAt) out.missedAt = src.missedAt;
    missedTotal = Math.max(0, (src.totals?.missed ?? src.missed.length) - gone);
    p1MissedTotal = Math.max(0, (src.totals?.p1Missed ?? src.missed.filter((m) => m.p1).length) - goneP1);
  }
  const hasTotals = !!(a.totals || b.totals) || EV_KINDS.some((k) => out[k]);
  if (hasTotals || out.missed) {
    const base = totalsOf(out, { missed: missedTotal ?? 0, p1Missed: p1MissedTotal ?? 0, added: 0, deleted: 0, dimx: 0 });
    for (const k of EV_KINDS) base[k] = Math.max(a.totals?.[k] ?? 0, b.totals?.[k] ?? 0, out[k]?.length ?? 0);
    out.totals = base;
  }
  return out;
}

/** Several records of one date (two devices that both started it) read as one: merged, under the newest one's id. */
export function foldDayDocs<T extends { id: string; data: DayLog }>(docs: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const d of docs) {
    const had = out.get(d.data.date);
    if (!had) { out.set(d.data.date, d); continue; }
    const newest = had.data.updatedAt >= d.data.updatedAt ? had : d;
    out.set(d.data.date, { ...newest, data: mergeDayLog(had.data, d.data) });
  }
  return out;
}

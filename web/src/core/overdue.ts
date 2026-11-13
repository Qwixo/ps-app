// The Overdue card, bottom right of the Tab list (the developer, 4 Nov 2026: it replaces Urgent). A task that is
// 48 hours past its due moves off the list and onto Overdue by itself, and moves back when it gets a
// new date. Nothing new is saved or synced: Overdue is worked out from the task's own due and done,
// so every device shows the same thing as soon as the task itself syncs.
//
// The rule, in the developer's time zone (settings.tmHomeTz, else this device's zone; see core/tz.ts):
// - a due with a time ("2026-11-04T15:00"): overdue 48 hours after that time;
// - a due date only ("2026-11-04"): overdue 48 hours after the end of that day (so from 00:00 on the
//   7th, Dubai time, for a task due the 4th);
// - never: a finished or cleared task, a task with no date, an every day task (it has no date).
// Longer repeats (every week, month...) have a due too: the round they are waiting on. Missed by
// 48 hours, that round shows on Overdue; ticking it counts it (streak too) and the next End of day
// moves it on to its next date, back on the list.
import type { Doc, Todo } from "./model";
import { DEVICE_TZ, validTz, zonedToTs } from "./tz.ts";
import { isEveryDay, nextAfter, plusDays } from "./repeat.ts";

export const OVERDUE_AFTER_MS = 48 * 3600_000;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** The developer's zone for this rule: his saved Tab list zone, else this device's. */
export function overdueZone(homeTz?: string | null) { return homeTz && validTz(homeTz) ? homeTz : DEVICE_TZ; }

/** The moment a due becomes overdue (ms), or null for no or an unreadable due. */
export function overdueAt(due: string | null | undefined, tz: string): number | null {
  if (!due) return null;
  let m = DAY.exec(due);
  if (m) return zonedToTs(+m[1], +m[2], +m[3] + 1, 0, 0, tz) + OVERDUE_AFTER_MS;   // end of that day (Date.UTC rolls the day over)
  m = LOCAL.exec(due);
  if (m) return zonedToTs(+m[1], +m[2], +m[3], +m[4], +m[5], tz) + OVERDUE_AFTER_MS;
  if (ZONED.test(due)) { const t = Date.parse(due); return Number.isFinite(t) ? t + OVERDUE_AFTER_MS : null; }
  return null;
}

type Task = Pick<Todo, "type" | "done" | "due" | "repeat"> & { clearedAt?: string | null };
/** Can this task ever be on Overdue (open, dated, not an every day task)? */
const dated = (t: Task) => !t.done && !t.clearedAt && !!t.due && !(t.type === "daily" && isEveryDay(t));

export function isOverdue(t: Task, now: number, tz: string): boolean {
  if (!dated(t)) return false;
  const at = overdueAt(t.due, tz);
  return at != null && now >= at;
}

/** The list and the Overdue card: every overdue task leaves the list (the developer: not shown in both places). */
export function splitOverdue<T extends Task>(all: Doc<T>[], now: number, tz: string): { list: Doc<T>[]; overdue: Doc<T>[] } {
  const list: Doc<T>[] = [], overdue: Doc<T>[] = [];
  for (const d of all) (isOverdue(d.data, now, tz) ? overdue : list).push(d);
  // Oldest due first (the longest overdue on top), then the list's own order.
  overdue.sort((a, b) => (overdueAt(a.data.due, tz) ?? 0) - (overdueAt(b.data.due, tz) ?? 0)
    || ((a.data as { order?: number }).order ?? 0) - ((b.data as { order?: number }).order ?? 0));
  return { list, overdue };
}

/** The next moment any open task turns overdue (so the card updates live), or null if none will. */
export function nextOverdueAt(all: Doc<Task>[], now: number, tz: string): number | null {
  let next: number | null = null;
  for (const d of all) {
    if (!dated(d.data)) continue;
    const at = overdueAt(d.data.due, tz);
    if (at != null && at > now && (next == null || at < next)) next = at;
  }
  return next;
}

/** × on the Overdue card: off Overdue without ticking it. A one-off loses its date (back on the list,
 *  undated); a longer repeat skips to its next round from today on. */
export function clearDuePatch(t: Pick<Todo, "type" | "repeat">, today: string): Pick<Todo, "due"> {
  return t.type === "daily" && t.repeat ? { due: nextAfter(t.repeat, plusDays(today, -1)) } : { due: null };
}

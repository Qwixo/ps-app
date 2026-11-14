// The Completed section at the bottom of the Tab list (V1.34, the developer 5 Nov 2026: "If I click and complete the task, the
// task actually disappears. and by disappear I mean like go to the bottom. and at the very bottom I want like
// completed tasks like another section called completed tasks like a gray area where each task is like crossed
// out... a button above that section where it's like resurrect").
//
// The rules, all worked out from the tasks themselves so every device agrees as soon as a tick syncs:
// - a one-off task that is done (and not cleared by a Reset or by Clear) shows in Completed while its doneAt is
//   inside the keep window: since the start of today in the developer's home time zone (default; today starts at the reset time), or the last 7 or 30 days;
// - repeating tasks never go there: they stay in their own section and come back on their next round, as before;
// - unticking one puts it back where it was: its order, Priority 1 flag and group were never changed by the tick;
// - Resurrect unticks every task in Completed, Clear sets clearedAt on them (as Reset does); both have Undo.
// Settings (synced like every setting, cleaned here on read and in ps.ts cleanLooks on write):
//   tmTickMode  "completed" (default) or "vanish" (the old way: a ticked task just leaves the list)
//   tmShowDone  false hides the Completed section (default shown)
//   tmDoneKeep  "today" (default), "7d" or "30d"
import type { Doc, Settings, Todo } from "./model";
import { addDays, dayStartAt, nextResetAt, resetDayOf } from "./resetday.ts";

export type TickMode = "completed" | "vanish";
export type KeepFor = "today" | "7d" | "30d";
export type ListPrefs = { mode: TickMode; show: boolean; keep: KeepFor };
export const KEEP_DAYS: Record<KeepFor, number> = { today: 1, "7d": 7, "30d": 30 };
export const KEEP_LABEL: Record<KeepFor, string> = { today: "Today", "7d": "7 days", "30d": "30 days" };
/** Never more rows than this in Completed (the oldest ticks inside the window go first). */
export const COMPLETED_MAX = 200;

type ListSettings = Pick<Settings, "tmTickMode" | "tmShowDone" | "tmDoneKeep">;
const isMode = (v: unknown): v is TickMode => v === "completed" || v === "vanish";
const isKeep = (v: unknown): v is KeepFor => v === "today" || v === "7d" || v === "30d";

/** The To do list behaviour with its defaults (anything unreadable is the default). */
export function listPrefs(s: Partial<ListSettings> | null | undefined): ListPrefs {
  return { mode: isMode(s?.tmTickMode) ? s!.tmTickMode! : "completed", show: s?.tmShowDone !== false, keep: isKeep(s?.tmDoneKeep) ? s!.tmDoneKeep! : "today" };
}

/** Is the Completed section on the list? */
export function completedOn(p: ListPrefs): boolean { return p.mode === "completed" && p.show; }

/** The To do list part of a settings patch, checked (ps.ts cleanLooks). */
export function cleanListLooks(p: Record<string, unknown>): Partial<Settings> {
  const o: Partial<Settings> = {};
  if (isMode(p.tmTickMode)) o.tmTickMode = p.tmTickMode;
  if (typeof p.tmShowDone === "boolean") o.tmShowDone = p.tmShowDone;
  if (isKeep(p.tmDoneKeep)) o.tmDoneKeep = p.tmDoneKeep;
  return o;
}

/** The start of the keep window (ms): the start of today in the developer's zone, or 6 or 29 days before that. Today starts
 *  at the reset time (atMin minutes after midnight, core/resetday.ts; 0 = midnight). */
export function keepSince(keep: KeepFor, now: number, tz: string, atMin = 0): number {
  return dayStartAt(addDays(resetDayOf(now, tz, atMin), -(KEEP_DAYS[keep] - 1)), tz, atMin);
}

/** The next start of a day in the developer's zone (ms): the moment the oldest day leaves the window. */
export function nextRollAt(now: number, tz: string, atMin = 0): number {
  return nextResetAt(now, tz, atMin);
}

type Task = Pick<Todo, "type" | "done" | "doneAt"> & { clearedAt?: string | null };
const doneMs = (t: Task) => (t.doneAt ? Date.parse(t.doneAt) : NaN);

/** Does this task belong in Completed right now? */
export function isCompleted(t: Task, since: number): boolean {
  if (t.type === "daily" || !t.done || t.clearedAt) return false;
  const at = doneMs(t);
  return Number.isFinite(at) && at >= since;
}

/** Completed, newest tick first (a task ticked a moment ago sits at the top of the grey area). */
export function completedList<T extends Task>(all: Doc<T>[], keep: KeepFor, now: number, tz: string, atMin = 0): Doc<T>[] {
  const since = keepSince(keep, now, tz, atMin);
  return all.filter((d) => isCompleted(d.data, since)).sort((a, b) => doneMs(b.data) - doneMs(a.data)).slice(0, COMPLETED_MAX);
}

// ---------- The last 24 hours first, "More" for the rest (V1.59) ----------
// The developer: "when you click completed tasks, by default it only displays the last 24 hours of tasks, and you have to click
// 'More' at the bottom to expand it." Completed opens on the ticks of the last 24 hours (24 real hours back from now,
// not a calendar day, so no time zone or clock change moves the cut); "More" opens everything the keep setting holds
// (Today / 7 / 30 days). Opened again, it is back on 24 hours (the open state lives only as long as the section is on screen).

/** The short view of Completed: 24 hours. */
export const RECENT_MS = 24 * 3600_000;

/** The start of the short view (ms): a tick exactly 24 hours old is still in it. */
export function recentSince(now: number): number { return now - RECENT_MS; }

/** Completed (newest tick first) cut into the last 24 hours and the older ones the keep setting still holds.
 *  A task with no readable tick time counts as older. */
export function splitRecent<T extends Task>(list: Doc<T>[], now: number): { recent: Doc<T>[]; older: Doc<T>[] } {
  const since = recentSince(now), recent: Doc<T>[] = [], older: Doc<T>[] = [];
  for (const d of list) { const at = doneMs(d.data); (Number.isFinite(at) && at >= since ? recent : older).push(d); }
  return { recent, older };
}

/** What Completed shows: the last 24 hours until "More" is pressed (`expanded`), then everything in `list`.
 *  `quiet`: nothing in the last 24 hours (a quiet line shows instead of rows); `canMore` / `canLess`: which button shows. */
export function completedView<T extends Task>(list: Doc<T>[], now: number, expanded: boolean) {
  const { recent, older } = splitRecent(list, now);
  return { recent, older, shown: expanded ? list : recent, quiet: recent.length === 0, canMore: !expanded && older.length > 0, canLess: expanded && older.length > 0 };
}

/** When the next task in `recent` turns 24 hours old (ms), so the view can move it down by itself; null when none will. */
export function nextAgeOutAt<T extends Task>(recent: Doc<T>[], now: number): number | null {
  let best: number | null = null;
  for (const d of recent) {
    const at = doneMs(d.data);
    if (Number.isFinite(at)) { const t = at + RECENT_MS + 1; if (t > now && (best === null || t < best)) best = t; }
  }
  return best;
}

// ---------- Complete all and Resurrect at the end of the list (V1.47) ----------
// The developer, 10 Nov 2026: "At the bottom of the to-do list, next to the Sleep button, add a button that says Complete all,
// and it marks all tasks as complete." And: "I can't seem to find the Resurrect button anymore. Resurrect that
// Resurrect button." Resurrect used to live inside the Completed section, so it went away with it: after the reset
// (midnight or the reset time), End day, Clear, with Disappear picked, or with Completed hidden. Now it shows
// whenever something can come back.

/** Complete all asks first when it would tick more tasks than this. */
export const COMPLETE_ALL_ASK = 5;

type ListLike<T> = { ranked: Doc<T>[]; daily: Doc<T>[]; groups: Map<string, Doc<T>[]> };
/** Every open task on the list as it shows (Priority 1, Priorities, Every day, the developer's groups), in that order, each
 *  once. Every day tasks count: they are on the list (Undo takes their streak tick back). Overdue ones are in the
 *  Overdue card, not on the list, so they are left alone. */
export function openOnList<T extends Pick<Todo, "done">>(l: ListLike<T>): string[] {
  const out: string[] = [], seen = new Set<string>();
  const add = (d: Doc<T>) => { if (!d.data.done && !seen.has(d.id)) { seen.add(d.id); out.push(d.id); } };
  l.ranked.forEach(add); l.daily.forEach(add); l.groups.forEach((g) => g.forEach(add));
  return out;
}

/** How far back Resurrect looks when Completed is empty: the keep window, and never less than today and yesterday,
 *  so last night's reset does not hide yesterday's ticks. */
export function resurrectSince(keep: KeepFor, now: number, tz: string, atMin = 0): number {
  return dayStartAt(addDays(resetDayOf(now, tz, atMin), -(Math.max(2, KEEP_DAYS[keep]) - 1)), tz, atMin);
}

/** What Resurrect brings back: the Completed section when it shows anything; otherwise the one-offs ticked
 *  recently (resurrectSince), cleared by a reset, End day or Clear or not, newest first. Empty: no Resurrect. */
export function resurrectList<T extends Task>(all: Doc<T>[], p: ListPrefs, now: number, tz: string, atMin = 0): Doc<T>[] {
  if (completedOn(p)) { const c = completedList(all, p.keep, now, tz, atMin); if (c.length) return c; }
  const since = resurrectSince(p.keep, now, tz, atMin);
  return all.filter((d) => d.data.type !== "daily" && d.data.done && doneMs(d.data) >= since)
    .sort((a, b) => doneMs(b.data) - doneMs(a.data)).slice(0, COMPLETED_MAX);
}

// ---------- All completed, and picking tasks to Resurrect (V1.57) ----------
// The developer, 13 Nov 2026: "scroll to the bottom and be able to view all the completed tasks" and "CMD + left click tasks and
// then click the resurrect button to only resurrect certain tasks". Completed keeps Today / 7 / 30 days; a "Show all
// completed" row at its end opens the whole history (every one-off ever ticked, the cleared ones too, newest first),
// drawn a page at a time as the list scrolls so hundreds of rows stay smooth. In Completed, Cmd + click (Ctrl + click
// off a Mac; a long press on the phone) picks a task; with any picked, Resurrect brings back only those.

/** Rows drawn per step in the all completed history (the first step, then one more each time the end scrolls in). */
export const HISTORY_PAGE = 40;

/** Every completed one-off, newest tick first, with no keep window and no cap: the cleared ones too (Clear and a reset
 *  only take a task out of the short Completed section, it was still completed). Repeating tasks never count.
 *  A task with no tick time sorts last. */
export function allCompletedList<T extends Task>(all: Doc<T>[]): Doc<T>[] {
  const ms = (d: Doc<T>) => { const t = doneMs(d.data); return Number.isFinite(t) ? t : -Infinity; };
  return all.filter((d) => d.data.type !== "daily" && d.data.done).sort((a, b) => ms(b) - ms(a) || (a.id < b.id ? -1 : 1));
}

/** How many completed tasks the history has beyond the ones Completed already shows (0: no "Show all completed" row). */
export function moreCompleted(history: Doc<Task>[], shown: Doc<Task>[]): number {
  const have = new Set(shown.map((d) => d.id));
  return history.reduce((n, d) => n + (have.has(d.id) ? 0 : 1), 0);
}

/** The first `pages` pages of a list (what the history draws), and whether there is more below. */
export function historySlice<T>(list: T[], pages: number): { rows: T[]; more: boolean } {
  const n = Math.max(1, Math.floor(pages)) * HISTORY_PAGE;
  return { rows: list.slice(0, n), more: list.length > n };
}

/** Does this click pick a task? Cmd on a Mac, Ctrl elsewhere (Ctrl + click on a Mac is a right click, so it never picks). */
export function isPickClick(e: { metaKey: boolean; ctrlKey: boolean }, mac: boolean): boolean {
  return mac ? e.metaKey : e.ctrlKey || e.metaKey;
}

/** What Resurrect brings back: the picked tasks that are completed (in the order they show), or when none of them are
 *  (nothing picked, or only open tasks picked), everything it brought back before (`back`). `visible` are the rows
 *  Completed shows right now (the history included), so a task picked in the history can come back too. */
export function resurrectTargets<T>(back: Doc<T>[], visible: Doc<T>[], picked: ReadonlySet<string>): Doc<T>[] {
  if (!picked.size) return back;
  const seen = new Set<string>(), out: Doc<T>[] = [];
  for (const d of [...visible, ...back]) if (picked.has(d.id) && !seen.has(d.id)) { seen.add(d.id); out.push(d); }
  return out.length ? out : back;
}

/** A long press on the phone: a touch held this long without moving this far picks the task. */
export const LONG_PRESS_MS = 450;
export const LONG_PRESS_SLOP = 10;
export function longPressMoved(dx: number, dy: number): boolean { return Math.hypot(dx, dy) > LONG_PRESS_SLOP; }

// ---------- list changes from the Tab list in PS (its main window does the saving) ----------
// done: several tasks ticked or unticked at once (Complete all, Resurrect and their Undo); clear / unclear: Clear and
// its Undo; revive: Resurrect of tasks a reset or Clear took off (not cleared any more, not done); bury: its Undo
// (done again, and cleared again for the ids in `cleared`); restore: a task deleted from the right click menu, put
// back by Undo exactly as it was (same id).
export type TodoOp =
  | { op: "done"; ids: string[]; done: boolean }
  | { op: "revive"; ids: string[] }
  | { op: "bury"; ids: string[]; cleared: string[] }
  | { op: "clear"; ids: string[] }
  | { op: "unclear"; ids: string[] }
  | { op: "restore"; id: string; data: Todo };

const ID = /^[A-Za-z0-9-]{8,64}$/;
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, COMPLETED_MAX) : []);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 40) : null);
const iso = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v.slice(0, 40) : null);
const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);

/** A deleted task's data, checked field by field before it goes back in the vault. */
export function cleanTodoData(v: unknown): Todo | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  const title = typeof t.title === "string" ? t.title.trim().slice(0, 500) : "";
  if (!title || (t.type !== "once" && t.type !== "daily")) return null;
  const out: Todo = { title, type: t.type, done: t.done === true, order: typeof t.order === "number" && Number.isFinite(t.order) ? t.order : 0 };
  const keep: (keyof Todo)[] = ["createdAt", "doneAt", "clearedAt", "claudeDoneAt"];
  for (const k of keep) { const x = iso(t[k]); if (x) (out as unknown as Record<string, unknown>)[k] = x; }
  if (day(t.due)) out.due = day(t.due);
  for (const k of ["clientId", "projectId", "group"] as const) { const x = str(t[k], 64); if (x) out[k] = x; }
  if (typeof t.notes === "string" && t.notes) out.notes = t.notes.slice(0, 2000);
  if (typeof t.claudeNote === "string" && t.claudeNote) out.claudeNote = t.claudeNote.slice(0, 500);
  if (t.source === "manual" || t.source === "fireflies" || t.source === "project") out.source = t.source;
  for (const k of ["streak", "bestStreak", "pushes"] as const) if (typeof t[k] === "number" && Number.isFinite(t[k])) out[k] = Math.max(0, Math.round(t[k] as number));
  for (const k of ["streakTicked", "p1", "unranked"] as const) if (typeof t[k] === "boolean") out[k] = t[k] as boolean;
  if (t.repeat && typeof t.repeat === "object") out.repeat = t.repeat as Todo["repeat"];   // checked again by repeat.ts wherever it is read
  if (Array.isArray(t.subtasks)) out.subtasks = (t.subtasks as Todo["subtasks"])!.filter((s) => s && typeof s === "object" && typeof (s as { title?: unknown }).title === "string").slice(0, 100);
  return out;
}

/** One list change from the Tab list, checked; null for anything else. */
export function cleanTodoOp(v: unknown): TodoOp | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.op === "done" && typeof o.done === "boolean") { const l = ids(o.ids); return l.length ? { op: "done", ids: l, done: o.done } : null; }
  if (o.op === "clear" || o.op === "unclear") { const l = ids(o.ids); return l.length ? { op: o.op, ids: l } : null; }
  if (o.op === "revive") { const l = ids(o.ids); return l.length ? { op: "revive", ids: l } : null; }
  if (o.op === "bury") { const l = ids(o.ids); const set = new Set(l); return l.length ? { op: "bury", ids: l, cleared: ids(o.cleared).filter((x) => set.has(x)) } : null; }
  if (o.op === "restore" && typeof o.id === "string" && ID.test(o.id)) { const data = cleanTodoData(o.data); return data ? { op: "restore", id: o.id, data } : null; }
  return null;
}

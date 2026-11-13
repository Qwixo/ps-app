// The NEW badge on fresh tasks (V1.33, the developer 4 Nov 2026: "add a 'NEW' icon over each new task that has been there
// for less than 30 mins (adjustable in settings), but you can also click on the NEW badge to make it go away. You
// can also turn the new badges off completely in settings.").
//
// The rule, worked out from the task itself so every device agrees as soon as the task syncs:
// - a task is new while less than settings.newBadgeMin minutes (default 30, 5 to 240) have passed since its
//   createdAt; a task with no createdAt (older tasks) or an unreadable one is never new;
// - never on a ticked or cleared task, never when settings.newBadges is false;
// - a click on the badge hides it for that one task: settings.newGone gets { [task id]: created time in seconds },
//   which syncs through the vault like every setting, so the other devices drop it too.
// newGone stays tiny: a dismissal is pruned on the next dismissal once its task is older than the longest window
// (240 minutes), so it can never come back even if the minutes are raised later. Nothing is ever written only
// to prune, and an old entry is harmless (its task is past every window anyway).
import type { Settings, Todo } from "./model";

export const NEW_MIN_DEFAULT = 30;
export const NEW_MIN_LOW = 5;
export const NEW_MIN_HIGH = 240;
/** Quick picks beside the minutes slider. */
export const NEW_MIN_PICKS = [15, 30, 60, 120] as const;

export type NewPrefs = { on: boolean; min: number; gone: Record<string, number> };
type NewSettings = Pick<Settings, "newBadges" | "newBadgeMin" | "newGone">;

/** A minutes value kept inside 5 to 240 (whole minutes); anything unreadable is the default 30. */
export function clampNewMin(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return NEW_MIN_DEFAULT;
  return Math.min(NEW_MIN_HIGH, Math.max(NEW_MIN_LOW, Math.round(n)));
}

/** The badge settings with their defaults: on, 30 minutes, nothing dismissed. */
export function newPrefs(s: Partial<NewSettings> | null | undefined): NewPrefs {
  const g = s?.newGone;
  return { on: s?.newBadges !== false, min: clampNewMin(s?.newBadgeMin ?? NEW_MIN_DEFAULT), gone: g && typeof g === "object" ? g : {} };
}

/** The task's creation time in ms, or null (none or unreadable). */
export function createdMs(t: Pick<Todo, "createdAt">): number | null {
  if (!t.createdAt) return null;
  const ms = Date.parse(t.createdAt);
  return Number.isFinite(ms) ? ms : null;
}

type Task = Pick<Todo, "createdAt" | "done"> & { clearedAt?: string | null };

/** When this task's badge goes by itself (ms), or null when it has no badge at all right now. */
export function newUntil(t: Task, id: string, now: number, p: NewPrefs): number | null {
  if (!p.on || t.done || t.clearedAt || id in p.gone) return null;
  const c = createdMs(t);
  if (c == null) return null;
  // A clock a little ahead on the device that made it puts createdAt in the future: it still counts from then.
  const until = c + p.min * 60_000;
  return now < until ? until : null;
}

/** Does this task show NEW right now? */
export function isNewTask(t: Task, id: string, now: number, p: NewPrefs): boolean {
  return newUntil(t, id, now, p) != null;
}

/** The soonest moment any badge in the list goes by itself (one timer for the whole list), or null for none. */
export function nextNewExpiry(list: { id: string; data: Task }[], now: number, p: NewPrefs): number | null {
  let next: number | null = null;
  for (const d of list) {
    const u = newUntil(d.data, d.id, now, p);
    if (u != null && (next == null || u < next)) next = u;
  }
  return next;
}

/** Dismissals still worth keeping: only those whose task could still be inside the longest window. */
export function pruneGone(gone: Record<string, number>, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  const keepFrom = now / 1000 - NEW_MIN_HIGH * 60;
  for (const [id, sec] of Object.entries(gone)) if (typeof sec === "number" && Number.isFinite(sec) && sec > keepFrom) out[id] = sec;
  return out;
}

/** The settings patch for a click on one task's badge: that task added, the stale ones dropped. */
export function dismissPatch(gone: Record<string, number>, id: string, t: Pick<Todo, "createdAt">, now: number): Pick<Settings, "newGone"> {
  const c = createdMs(t) ?? now;
  return { newGone: { ...pruneGone(gone, now), [id]: Math.floor(c / 1000) } };
}

/** The badge part of a "looks" patch from the Tab list, the phone or the website (ps.ts cleanLooks calls this):
 *  newBadges on or off, newBadgeMin kept to 5 to 240, and newGoneId (a badge clicked away) turned into the newGone
 *  record from the newest settings, so the PS main window applies it to its own copy. An unknown task is ignored. */
export function cleanNewLooks(p: Record<string, unknown>, cur: Partial<NewSettings> | null | undefined,
  taskCreated: (id: string) => string | null | undefined, now: number): Partial<NewSettings> {
  const o: Partial<NewSettings> = {};
  if (typeof p.newBadges === "boolean") o.newBadges = p.newBadges;
  if (typeof p.newBadgeMin === "number" && Number.isFinite(p.newBadgeMin)) o.newBadgeMin = clampNewMin(p.newBadgeMin);
  if (typeof p.newGoneId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(p.newGoneId)) {
    const created = taskCreated(p.newGoneId);
    if (created !== undefined) Object.assign(o, dismissPatch(newPrefs(cur).gone, p.newGoneId, { createdAt: created ?? undefined }, now));
  }
  return o;
}

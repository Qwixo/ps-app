// Just tomorrow (PS 1.65). The developer's friend, 17 Nov 2026: "Add a feature in Sleep mode that allows changing the time of the
// alarm for just the next alarm ... You need your Touch ID to do this, so that somebody does not just change it while you are
// asleep ... when you go to bed too late, you can skip the alarm just that morning and set it for later, but don't have to turn
// off and on the main alarm."
//
// One override, synced with the Sleep mode settings (settings.sleepMode.once), so every device rings the same thing:
// - it names the rings it replaces: the next alarm and any other switched on alarm of that same morning (a backup alarm ten
//   minutes later moves too, or skipping would still wake you), each by its alarm id and the date its ring falls on;
// - `to` is the new time of the first one, as a wall clock time on this device's clock ("2026-11-18T10:30"), the others move by
//   the same amount; null means that morning is skipped.
// The main alarms are never touched. Once those rings are over the override does nothing any more (it only ever matches its own
// dates) and the engine clears it. Every change, and Undo, passes Touch ID or the device's own unlock first (withOwner).
// Pure: no React, no DOM, no clock of its own. tests/alarmonce.test.ts checks it.
import { wall, zonedToTs } from "./tz.ts";
import type { SleepAlarm } from "./sleepmode.ts";

export const ONCE_FEATURE = "alarm-once";
/** Later: the quick choices, in minutes after the usual time. */
export const ONCE_MINS = [30, 60, 90] as const;
/** Alarms ringing up to this long after the next one count as the same morning. */
export const MORNING = 3 * 3600_000;
/** A picked time may be at most this long after the usual one (and is always the next time that clock reads). */
export const ONCE_MAX = 12 * 3600_000;
/** After a ring this long (its grace and its longest built in ring), an override that only held it is spent. */
const SPENT_AFTER = 15 * 60_000 + 10 * 60_000;

export interface OnceRing { id: string; day: string }
export interface AlarmOnce { rings: OnceRing[]; to: string | null; set: string }
export type OnceChoice = { kind: "skip" } | { kind: "later"; mins: number } | { kind: "pick"; at: string } | { kind: "undo" };

const okDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const okWall = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(s);
const okClock = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const okId = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(s);
const pad = (n: number) => String(n).padStart(2, "0");

/** A synced value, checked: null when it is not a real override. */
export function cleanOnce(v: unknown): AlarmOnce | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.rings)) return null;
  const seen = new Set<string>();
  const rings = o.rings
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .filter((r) => okId(r.id) && okDay(r.day) && !seen.has(r.id as string) && (seen.add(r.id as string), true))
    .slice(0, 5)
    .map((r) => ({ id: r.id as string, day: r.day as string }));
  if (!rings.length) return null;
  if (o.to !== null && !okWall(o.to)) return null;
  const set = typeof o.set === "string" && Number.isFinite(Date.parse(o.set)) ? o.set : new Date(0).toISOString();
  return { rings, to: o.to as string | null, set };
}

// ---------- clock helpers (this device's zone) ----------
export function dayOf(ms: number, tz: string): string { const w = wall(ms, tz); return `${w.y}-${pad(w.mo)}-${pad(w.d)}`; }
export function clockOf(ms: number, tz: string): string { const w = wall(ms, tz); return `${pad(w.h)}:${pad(w.mi)}`; }
export const wallOf = (ms: number, tz: string): string => `${dayOf(ms, tz)}T${clockOf(ms, tz)}`;
/** The moment a date and clock time mean in tz (a clock change is handled by zonedToTs). */
export function tsOn(day: string, hhmm: string, tz: string): number {
  const [y, mo, d] = day.split("-").map(Number), [h, mi] = hhmm.split(":").map(Number);
  return zonedToTs(y, mo, d, h, mi, tz);
}
export const tsOfWall = (w: string, tz: string): number => tsOn(w.slice(0, 10), w.slice(11, 16), tz);
/** The first moment after `after` when the clock in tz reads hhmm (the same rule as core/sleepmode.ts nextAt). */
export function nextClock(hhmm: string, after: number, tz: string): number | null {
  if (!okClock(hhmm)) return null;
  const w = wall(after, tz);
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.UTC(w.y, w.mo - 1, w.d + i));
    const t = tsOn(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, hhmm, tz);
    if (t > after) return t;
  }
  return null;
}

// ---------- what the override does to the rings ----------
export interface OnceTime { orig: number; to: number | null }
/** Each replaced ring of a switched on alarm: when it would ring (orig) and when it rings instead (null: skipped). The first
 *  alarm deleted: the override is gone with it. A changed main alarm keeps its date's override (the day is what was set). */
export function onceTimes(alarms: SleepAlarm[], once: AlarmOnce | null | undefined, tz: string): Map<string, OnceTime> {
  const out = new Map<string, OnceTime>();
  const o = cleanOnce(once);
  if (!o) return out;
  const byId = new Map(alarms.map((a) => [a.id, a]));
  const first = byId.get(o.rings[0].id);
  if (!first) return out;
  const firstOrig = tsOn(o.rings[0].day, first.at, tz);
  const toTs = o.to ? tsOfWall(o.to, tz) : null;
  const delta = toTs == null ? 0 : toTs - firstOrig;
  o.rings.forEach((r, i) => {
    const a = byId.get(r.id);
    if (!a || !a.on) return;
    const orig = tsOn(r.day, a.at, tz);
    out.set(a.id, { orig, to: toTs == null ? null : i === 0 ? toTs : orig + delta });
  });
  return out;
}
/** One alarm's ring after `since` with the override: the moved ring, or its usual ring on another date, whichever is first.
 *  `moved`: the ring is the override's. Null: nothing rings for it (skipped, or the moved ring has already been). */
export function onceRing(a: SleepAlarm, since: number, tz: string, times: Map<string, OnceTime>): { at: number; moved: boolean } | null {
  const n = nextClock(a.at, since, tz);
  const t = times.get(a.id);
  if (!t) return n == null ? null : { at: n, moved: false };
  const c: { at: number; moved: boolean }[] = [];
  if (t.to != null && t.to > since) c.push({ at: t.to, moved: true });
  if (n != null && dayOf(n, tz) !== dayOf(t.orig, tz)) c.push({ at: n, moved: false });
  c.sort((x, y) => x.at - y.at);
  return c[0] ?? null;
}
/** Is the override over (every ring it holds has been, or its alarm is gone)? Then the engine clears it. */
export function onceSpent(alarms: SleepAlarm[], once: AlarmOnce | null | undefined, now: number, tz: string): boolean {
  if (!cleanOnce(once)) return once != null;
  const times = onceTimes(alarms, once, tz);
  if (!times.size) return true;
  for (const t of times.values()) if (Math.max(t.orig, t.to ?? t.orig) + SPENT_AFTER > now) return false;
  return true;
}

// ---------- the next morning ----------
export interface Morning { rings: { id: string; at: number; usual: string; day: string }[] }
/** The next morning's alarms with no override: the next switched on alarm after `now` and every other one within MORNING. */
export function nextMorning(alarms: SleepAlarm[], now: number, tz: string): Morning | null {
  const next = alarms.filter((a) => a.on).map((a) => ({ a, at: nextClock(a.at, now, tz) })).filter((x): x is { a: SleepAlarm; at: number } => x.at != null).sort((x, y) => x.at - y.at);
  if (!next.length) return null;
  const first = next[0].at;
  return { rings: next.filter((x) => x.at <= first + MORNING).map((x) => ({ id: x.a.id, at: x.at, usual: x.a.at, day: dayOf(x.at, tz) })) };
}

/** What the screens show. `none`: no override, the control offers the next morning. `set`: the override, its times and the
 *  usual ones. Null: no switched on alarm (nothing to change). */
export type OnceView =
  | { state: "none"; usual: string[]; at: number; day: "Today" | "Tomorrow" }
  | { state: "set"; skipped: boolean; usual: string[]; to: string[]; at: number; day: "Today" | "Tomorrow" };
/** "Today" when the ring is on today's date and the night is over (after 04:00), else "Tomorrow" (a bedtime after midnight
 *  still says tomorrow morning). */
export function dayWord(at: number, now: number, tz: string): "Today" | "Tomorrow" {
  return dayOf(at, tz) === dayOf(now, tz) && wall(now, tz).h >= 4 ? "Today" : "Tomorrow";
}
export function onceView(alarms: SleepAlarm[], once: AlarmOnce | null | undefined, now: number, tz: string): OnceView | null {
  const o = cleanOnce(once);
  const times = o ? onceTimes(alarms, o, tz) : new Map<string, OnceTime>();
  if (o && times.size && !onceSpent(alarms, o, now, tz)) {
    const ids = o.rings.map((r) => r.id).filter((id) => times.has(id));
    const byId = new Map(alarms.map((a) => [a.id, a]));
    const first = times.get(ids[0])!;
    return {
      state: "set", skipped: o.to == null,
      usual: ids.map((id) => byId.get(id)!.at),
      to: o.to == null ? [] : ids.map((id) => clockOf(times.get(id)!.to!, tz)),
      at: first.orig, day: dayWord(first.orig, now, tz),
    };
  }
  const m = nextMorning(alarms, now, tz);
  return m ? { state: "none", usual: m.rings.map((r) => r.usual), at: m.rings[0].at, day: dayWord(m.rings[0].at, now, tz) } : null;
}

/** The override a choice makes (null: back to the usual alarms), or an error word for the screen. A live override is the base
 *  (its own morning), so changing a skip to +60 moves the same morning; else the next morning from now. */
export function onceChoose(alarms: SleepAlarm[], current: AlarmOnce | null | undefined, now: number, tz: string, choice: OnceChoice): AlarmOnce | null | "none" | "past" | "far" {
  if (choice.kind === "undo") return null;
  const cur = cleanOnce(current);
  let rings: OnceRing[];
  let firstOrig: number;
  if (cur && !onceSpent(alarms, cur, now, tz) && onceTimes(alarms, cur, tz).size) {
    const times = onceTimes(alarms, cur, tz);
    rings = cur.rings.filter((r) => times.has(r.id));
    firstOrig = times.get(rings[0].id)!.orig;
  } else {
    const m = nextMorning(alarms, now, tz);
    if (!m) return "none";
    rings = m.rings.map((r) => ({ id: r.id, day: r.day }));
    firstOrig = m.rings[0].at;
  }
  const set = new Date(now).toISOString();
  if (choice.kind === "skip") return { rings, to: null, set };
  let to: number | null;
  if (choice.kind === "later") {
    const mins = Math.round(Number(choice.mins));
    if (!Number.isFinite(mins) || mins <= 0 || mins * 60_000 > ONCE_MAX) return "far";
    to = firstOrig + mins * 60_000;
  } else {
    to = nextClock(choice.at, now, tz);
    if (to == null) return "past";
    if (to === firstOrig) return null;   // the usual time picked: nothing to change
  }
  if (to <= now + 30_000) return "past";
  if (to > firstOrig + ONCE_MAX) return "far";
  return { rings, to: wallOf(to, tz), set };
}

// ---------- words (drafts for the developer's yes) ----------
const and = (xs: string[]) => xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
export function laterLabel(mins: number): string {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? (m ? `+${h} h ${pad(m)}` : `+${h} h`) : `+${m} min`;
}
export function onceWords(day: "Today" | "Tomorrow") {
  const d = day.toLowerCase();
  return {
    title: `Just ${d}`,
    skip: `Skip ${d}`,
    later: "Later",
    pick: "Pick a time",
    undo: "Undo",
    save: "Save",
    reason: `change ${d}'s alarm`,
    undoReason: `put ${d}'s alarm back`,
    mins: ONCE_MINS.map((m) => ({ mins: m, label: laterLabel(m) })),
  };
}
/** The one line: "Just tomorrow: 09:00", "Tomorrow only: 10:30 (your usual 09:00 is back the day after)", "Tomorrow skipped
 *  (your usual 09:00 is back the day after)". */
export function onceLine(v: OnceView): string {
  const back = v.day === "Today" ? "tomorrow" : "the day after";
  if (v.state === "none") return `Just ${v.day.toLowerCase()}: ${and(v.usual)}`;
  const usual = `your usual ${and(v.usual)} ${v.usual.length > 1 ? "are" : "is"} back ${back}`;
  if (v.skipped) return `${v.day} skipped${v.usual.length > 1 ? `, ${v.usual.length} alarms` : ""} (${usual})`;
  return `${v.day} only: ${and(v.to)} (${usual})`;
}
/** What a refused change says. */
export const ONCE_NOTES = {
  no: "Not changed. Touch ID did not pass.",
  none: "Change it on your Mac or phone. It needs Touch ID or the phone's unlock.",
  old: "Not changed. Update PS app on this device to use this.",
  past: "That time has already gone. Pick a later one.",
  far: "Pick a time within 12 hours of your usual alarm.",
  noAlarm: "No alarm is on, so there is nothing to change.",
} as const;

// ---------- the Touch ID gate ----------
/** "ok": passed. "no": cancelled or failed. "none": this device cannot ask (a browser). "old": the shell never answered. */
export type OwnerAnswer = "ok" | "no" | "none" | "old";
export type Authenticator = (reason: string) => Promise<OwnerAnswer>;
/** Runs `act` only after the owner passed Touch ID (or the Mac password, or the phone's unlock). Anything else changes nothing. */
export async function withOwner<T>(auth: Authenticator, reason: string, act: () => Promise<T> | T): Promise<{ ok: true; value: T } | { ok: false; why: Exclude<OwnerAnswer, "ok"> }> {
  let a: OwnerAnswer;
  try { a = await auth(reason); } catch { a = "no"; }
  if (a !== "ok") return { ok: false, why: a === "none" || a === "old" ? a : "no" };
  return { ok: true, value: await act() };
}

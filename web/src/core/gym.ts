// The gym reminder (the developer, 2 Nov 2026): every day at 08:00 by default; Fitness settings change the time, the
// days and on/off. Mac PS shows one card 2 h, 1 h, 30 min and 10 min before (the same card, its words move
// on); the phone gets a notification at the same four times and RINGS at gym time minus 16 minutes, full
// screen, until the developer taps Acknowledge (ps-gos Gym.kt). Acknowledging on either device is saved in the vault
// (settings.gymAck, the day), so the ring stops, the Mac card goes and that day's later reminders stay quiet.
// Gym already shows in the Meetings panel from his calendar, so nothing is added there.
// The developer's choices (2 Nov 2026): each phone ring stops by itself after 10 minutes and leaves a missed-gym
// notification; Later is 5 minutes, then it rings again (the Mac card's Later: back in 5 minutes with its
// chime); the ring is an alarm and rings through PS Do Not Disturb, the Mac card stays quiet under it.
//
// Pure: no vault, no clock, no storage. Times are wall clock times in the developer's own zone (settings.tmHomeTz,
// else this device's). A reminder fires only within GYM.grace of its time: a Mac that slept through
// 06:00 and 07:00 does not throw two stale cards at him when it wakes at 07:10, it waits for 07:30.
import { wall, zonedToTs } from "./tz.ts";
import { dndMutes, type Dnd } from "./dnd.ts";

export interface GymPrefs { on: boolean; time: string; days: number[] }   // days: 0 Sunday to 6 Saturday
export const GYM_DEFAULTS: GymPrefs = { on: true, time: "08:00", days: [0, 1, 2, 3, 4, 5, 6] };
export const GYM = {
  before: [120, 60, 30, 10] as readonly number[],   // minutes before: the Mac card, the phone's notifications
  ring: 16,                                         // minutes before: the phone rings
  grace: 2 * 60_000,                                // later than this, a reminder is stale and skipped
  cardStays: 90 * 60_000,                           // after gym time the card leaves by itself
  snooze: 5 * 60_000,                               // Later: the Mac card comes back after this (the phone rings again)
  keepDays: 14,                                     // acknowledged days kept this long
} as const;

/** Prefs from the vault (or an old or broken copy), with the defaults filled in. `defOn`: whether it is on before
 *  anything was saved. The developer's is on (unchanged); anyone else's starts off until they switch it on in Fitness settings
 *  (7 Nov 2026: the public PS has the gym reminder too, but it never rings a stranger's phone uninvited). */
export function gymPrefs(raw: unknown, defOn: boolean = GYM_DEFAULTS.on): GymPrefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof GymPrefs, unknown>>;
  const time = typeof r.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) ? r.time : GYM_DEFAULTS.time;
  const days = Array.isArray(r.days) ? [...new Set(r.days.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort((a, b) => a - b) : GYM_DEFAULTS.days;
  return { on: typeof r.on === "boolean" ? r.on : defOn, time, days };
}

const pad = (n: number) => String(n).padStart(2, "0");
/** "2026-11-03": the day in that zone. */
export function dayKey(ts: number, tz: string) { const w = wall(ts, tz); return `${w.y}-${pad(w.mo)}-${pad(w.d)}`; }
const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};
const weekday = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

export interface GymTime { day: string; at: number }
/** Gym times from yesterday to `ahead` days on, still worth a card (not over GYM.cardStays ago). */
export function gymTimes(p: GymPrefs, now: number, tz: string, ahead = 8): GymTime[] {
  if (!p.on || !p.days.length) return [];
  const [h, mi] = p.time.split(":").map(Number);
  const today = dayKey(now, tz), out: GymTime[] = [];
  for (let i = -1; i <= ahead; i++) {
    const day = addDays(today, i);
    if (!p.days.includes(weekday(day))) continue;
    const [y, m, d] = day.split("-").map(Number);
    const at = zonedToTs(y, m, d, h, mi, tz);
    if (at + GYM.cardStays > now) out.push({ day, at });
  }
  return out;
}

export interface GymStep { id: string; day: string; at: number; mins: number; due: number; ring: boolean }
/** Every reminder still to come for the days not acknowledged, soonest first. */
export function gymSteps(p: GymPrefs, now: number, tz: string, acked: string[] = [], ahead = 8): GymStep[] {
  const out: GymStep[] = [];
  for (const g of gymTimes(p, now, tz, ahead)) {
    if (acked.includes(g.day)) continue;
    for (const mins of [...GYM.before, GYM.ring]) out.push({ id: `${g.day}:${mins}`, day: g.day, at: g.at, mins, due: g.at - mins * 60_000, ring: mins === GYM.ring });
  }
  return out.sort((a, b) => a.due - b.due);
}

/** The Mac card step to show now: due, within the grace, not shown yet. Null when none (a stale one is skipped). */
export function gymDue(p: GymPrefs, now: number, tz: string, acked: string[], fired: string[]): GymStep | null {
  const live = gymSteps(p, now, tz, acked).filter((s) => !s.ring && s.due <= now && now < s.due + GYM.grace && !fired.includes(s.id));
  return live[live.length - 1] ?? null;
}

/** The card that belongs on screen now: the newest reminder this Mac really showed for a day not
 *  acknowledged, until GYM.cardStays after gym time. After a restart it comes back the same, quietly. */
export function gymCard(p: GymPrefs, now: number, tz: string, acked: string[], fired: string[]): { day: string; at: number; mins: number } | null {
  for (const g of gymTimes(p, now, tz, 1)) {
    if (acked.includes(g.day)) continue;
    const shown = GYM.before.filter((m) => fired.includes(`${g.day}:${m}`));
    if (shown.length) return { day: g.day, at: g.at, mins: Math.min(...shown) };
  }
  return null;
}

/** When to look again (ms): the next card step, Later being over, or the shown card leaving by itself. 0 = nothing coming. */
export function gymNextWake(p: GymPrefs, now: number, tz: string, acked: string[], fired: string[], snooze?: GymSnooze | null): number {
  const times = gymSteps(p, now, tz, acked).filter((s) => !s.ring && s.due > now).map((s) => s.due);
  const c = gymCard(p, now, tz, acked, fired);
  if (c) times.push(c.at + GYM.cardStays);
  if (c && snooze && snooze.day === c.day && snooze.until > now) times.push(snooze.until);
  return times.length ? Math.min(...times) : 0;
}

/** Later on the Mac card: put away for GYM.snooze, then back with its chime. */
export interface GymSnooze { day: string; until: number }
export function gymLater(day: string, now: number): GymSnooze { return { day, until: now + GYM.snooze }; }
/** Is the card for `day` put away by Later right now? */
export function gymSnoozed(s: GymSnooze | null | undefined, day: string, now: number) { return !!s && s.day === day && now < s.until; }

/** Quiet under PS Do Not Disturb? The Mac card yes (it follows meetings), the phone's ring never: it is an
 *  alarm (the developer, 2 Nov 2026). So the phone plan (gymPlan) never looks at DND. */
export function gymQuiet(what: "card" | "ring", dnd: Dnd | null | undefined, now: number) {
  return what === "card" && dndMutes(dnd, "meetings", now, "mac");
}

/** The card's words: "Gym in 2 h" / "Gym in 30 min" / "Gym now" and "08:00 today". */
export function gymCardText(c: { at: number; mins: number }, now: number, tz: string, time: string) {
  const left = Math.round((c.at - now) / 60_000);
  const title = left <= 0 ? "Gym time" : left >= 60 && left % 60 === 0 ? `Gym in ${left / 60} h` : left > 60 ? `Gym in ${Math.floor(left / 60)} h ${left % 60} min` : `Gym in ${left} min`;
  const sub = `${time} ${dayKey(c.at, tz) === dayKey(now, tz) ? "today" : "tomorrow"}`;
  return { title, sub };
}

/** The list with one more day acknowledged; days older than GYM.keepDays are dropped. */
export function ackGym(list: string[] | undefined, day: string, now: number, tz: string): string[] {
  const oldest = addDays(dayKey(now, tz), -GYM.keepDays);
  return [...new Set([...(list || []), day])].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= oldest).sort().slice(-30);
}
/** Fired step ids worth keeping (yesterday on). */
export function pruneFired(fired: string[], now: number, tz: string) {
  const y = addDays(dayKey(now, tz), -1);
  return fired.filter((f) => f.slice(0, 10) >= y).slice(-40);
}

/** What the phone shell needs to remind and ring by itself while PS sleeps (ps-gos Gym.kt). Only times,
 *  never a title: the shell words it. The days the developer already acknowledged are left out. */
export function gymPlan(p: GymPrefs, now: number, tz: string, acked: string[]) {
  return {
    on: p.on, time: p.time,
    items: gymTimes(p, now, tz, 8).filter((g) => !acked.includes(g.day)).map((g) => ({ day: g.day, at: g.at })),
    acked: acked.slice(-14), before: [...GYM.before], ring: GYM.ring, grace: GYM.grace,
  };
}

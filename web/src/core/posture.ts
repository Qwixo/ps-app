// Posture reminder (PS 1.65): every so often a pop-up shows a stick figure slouching, then sitting up straight, and one
// button, "Sitting straight". The pop-up looks like the Annoying 15 min reminder card (core/remind.ts, ps-mac Reminders.swift).
//
// Pure: no clock of its own, no storage, no React, no DOM. src/posturewatch.ts runs it and draws the pop-up (the Mac's
// card is Sources/Posture.swift, the website's is views/PosturePopup.tsx).
//
// The times sit on the wall clock, lined up with local midnight (every 45 minutes is 00:00, 00:45, 01:30 ...), so every
// device and every restart agrees on when a slot is, with nothing saved. A slot only counts inside the person's hours
// (a "to" before "from" runs past midnight, and "from" equal to "to" is the whole day).
//
// What happens when it is not a good moment (postureStep):
//  - In a meeting, while Sleep mode or Sentry mode covers the screen, or while the person is away from the keyboard (no
//    input for 2 minutes): the slot waits. It shows the moment the person is back, but only while the slot is still fresh
//    (half an interval old at most, never more than 10 minutes). After that it is skipped, never queued: one slot is
//    never followed by a second one for the same gap.
//  - Away for 5 minutes or more, or the Mac slept (the page saw no tick for 3 minutes): the person got up, which is the
//    point of the reminder. The slot is skipped.
//  - A pop-up already up never gets a second one on top.
//  - Off, or a slot outside the hours: nothing.

export interface PosturePrefs {
  on: boolean;
  every: number;      // minutes between reminders: one of EVERY_CHOICES
  from: string;       // "HH:MM"
  to: string;         // "HH:MM"
}
export const EVERY_CHOICES = [30, 45, 60, 90] as const;
export const POSTURE_DEFAULT: PosturePrefs = { on: true, every: 45, from: "09:00", to: "18:00" };

/** No input for this long and the person is away from the keyboard (the same as ps-mac Here.idleLimit). */
export const AWAY_MS = 120_000;
/** Away this long: the person stood up, so the slot that came meanwhile is skipped. */
export const LONG_AWAY_MS = 300_000;
/** No tick for this long means the computer slept (or the page was frozen): nothing is shown for the slot it missed. */
export const SLEEP_GAP_MS = 180_000;
/** A waiting slot is shown late for half an interval at most, and never more than this. */
export const GRACE_CAP_MS = 600_000;

export const POSTURE_WORDS = {
  tabTitle: "Posture Reminder",
  pill: "Posture check",
  title: "Sit up straight",
  button: "Sitting straight",
  on: "Posture reminder",
  every: "How often",
  hours: "Between these times",
  test: "Try it now",
  figureLabel: "A stick figure slouches, then sits up straight",
} as const;

// ---------- the first pop-up asks once (the developer's friend, 17 Nov 2026; the same way the first stand-up does, core/standup.ts) ----------
// The first real pop-up a person gets carries a small question under its button. Turn off saves the switch off, Keep it on
// just carries on. Asked once per person: kept in the synced settings (settings.postureAsk), so no other device asks again.
// "Try it now" never asks.
export const POSTURE_ASK_WORDS = {
  title: "Do you want to turn the posture reminder off?",
  off: "Turn off",
  keep: "Keep it on",
} as const;
export type PostureAnswer = "off" | "keep";
/** Ask with the next real pop-up? Only while the person has never seen the question and the reminder is on. */
export const postureAskDue = (st: { postureAsk?: boolean; posture?: unknown }): boolean => st.postureAsk !== true && posturePrefs(st.posture).on;
/** What an answer saves. Both mark the question seen, Turn off also switches the reminder off. null: not an answer. */
export function postureAskPatch(answer: unknown, current: unknown): { postureAsk: true; posture?: PosturePrefs } | null {
  if (answer !== "off" && answer !== "keep") return null;
  return answer === "off" ? { postureAsk: true, posture: { ...posturePrefs(current), on: false } } : { postureAsk: true };
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export function posturePrefs(v: unknown): PosturePrefs {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
  const n = typeof o.every === "number" ? o.every : typeof o.every === "string" ? Number(o.every) : NaN;
  return {
    on: o.on !== false,
    every: (EVERY_CHOICES as readonly number[]).includes(n) ? n : POSTURE_DEFAULT.every,
    from: typeof o.from === "string" && HHMM.test(o.from) ? o.from : POSTURE_DEFAULT.from,
    to: typeof o.to === "string" && HHMM.test(o.to) ? o.to : POSTURE_DEFAULT.to,
  };
}
const mins = (hhmm: string) => { const m = HHMM.exec(hhmm)!; return Number(m[1]) * 60 + Number(m[2]); };

/** Is this minute of the day (0 to 1439) inside the hours? A "to" before "from" runs past midnight; equal is all day. */
export function inWindow(p: Pick<PosturePrefs, "from" | "to">, minuteOfDay: number): boolean {
  const a = mins(p.from), b = mins(p.to);
  if (a === b) return true;
  return a < b ? minuteOfDay >= a && minuteOfDay < b : minuteOfDay >= a || minuteOfDay < b;
}

/** The latest slot at or before `now` (a time in ms), lined up with local midnight, or null when it is off or that
 *  slot is outside the hours. Never an older slot: those are too stale to show anyway. */
export function latestSlot(p: PosturePrefs, now: number): number | null {
  if (!p.on) return null;
  const d = new Date(now);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const every = p.every * 60_000;
  // Minutes since local midnight counted on the wall clock (a day with a clock change still lines up with the clock).
  const sinceMid = d.getHours() * 60 + d.getMinutes();
  const slotMin = Math.floor(sinceMid / p.every) * p.every;
  if (!inWindow(p, slotMin)) return null;
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(slotMin / 60), slotMin % 60).getTime();
  return s >= day && s <= now && now - s < every ? s : null;
}

/** The next slot after `now` inside the hours, or null (off, or nothing in the next two days). For Settings and tests. */
export function nextSlot(p: PosturePrefs, now: number): number | null {
  if (!p.on) return null;
  const d = new Date(now);
  for (let day = 0; day < 3; day++) {
    for (let m = 0; m < 1440; m += p.every) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + day, Math.floor(m / 60), m % 60).getTime();
      if (t > now && inWindow(p, m)) return t;
    }
  }
  return null;
}

/** The setting as one short key (on, how often, the hours). When it changes the watch starts fresh (posturePrime). */
export const postureKey = (p: PosturePrefs): string => `${p.on ? 1 : 0}|${p.every}|${p.from}|${p.to}`;
/** The first look, and every look after the setting changed (switched on, a new interval, new hours): the slot that is already
 *  running counts as dealt with, so a pop-up never lands the moment PS opens or a setting is touched. The next slot comes as usual. */
export function posturePrime(p: PosturePrefs, now: number, handled: number): number {
  const l = latestSlot(p, now);
  return l !== null && l > handled ? l : handled;
}

/** What the page sees at a tick. `idleMs`: no keyboard or mouse for this long. `awayMs`: the longest unbroken time away
 *  (a Mac only knows the idle time, so it is the same number). */
export interface PostureEnv {
  now: number;
  idleMs: number;
  meeting: boolean;
  /** Sleep mode or Sentry mode covers the screen. */
  covered: boolean;
  /** A pop-up of this reminder is up already. */
  shown: boolean;
  /** The time of the tick before this one (0 for the first), to see that the computer slept. */
  lastTick: number;
}
export type PostureWhy = "off" | "no slot" | "done" | "stale" | "slept" | "got up" | "shown" | "away" | "meeting" | "covered" | "show";
export interface PostureOut { show: boolean; handled: number; why: PostureWhy }

/** The one decision. `handled` is the last slot already dealt with (shown or skipped), 0 for none. Returns whether to show
 *  now, and the handled slot to keep. Never shows the same slot twice. */
export function postureStep(p: PosturePrefs, handled: number, e: PostureEnv): PostureOut {
  const slot = latestSlot(p, e.now);
  if (!p.on) return { show: false, handled, why: "off" };
  if (slot === null) return { show: false, handled, why: "no slot" };
  if (slot <= handled) return { show: false, handled, why: "done" };
  const grace = Math.min(p.every * 30_000, GRACE_CAP_MS);
  if (e.now - slot > grace) return { show: false, handled: slot, why: "stale" };
  if (e.lastTick > 0 && e.now - e.lastTick > SLEEP_GAP_MS) return { show: false, handled: slot, why: "slept" };
  if (e.idleMs >= LONG_AWAY_MS) return { show: false, handled: slot, why: "got up" };
  if (e.shown) return { show: false, handled: slot, why: "shown" };
  if (e.idleMs >= AWAY_MS) return { show: false, handled, why: "away" };
  if (e.meeting) return { show: false, handled, why: "meeting" };
  if (e.covered) return { show: false, handled, why: "covered" };
  return { show: true, handled: slot, why: "show" };
}

/** Which figure pose is on screen at `t` ms into the animation: 0 sitting straight, 1 fully slouched. Slouches for
 *  1.6 s, holds 0.5 s, sits up for 1.4 s, stays straight. Reduced motion: always straight. */
export const FIGURE_MS = { slouch: 1600, hold: 500, up: 1400 } as const;
export function slouchAt(t: number, reduced = false): number {
  if (reduced || !(t > 0)) return 0;
  const { slouch, hold, up } = FIGURE_MS;
  const ease = (x: number) => x * x * (3 - 2 * x);
  if (t < slouch) return ease(t / slouch);
  if (t < slouch + hold) return 1;
  if (t < slouch + hold + up) return 1 - ease((t - slouch - hold) / up);
  return 0;
}

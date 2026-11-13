// Stand-up reminders (V1.58, the developer 13 Nov 2026): every so often PS tells you to stand up. The island shows nothing until
// the last 15 seconds, when a small tab splits off its right side and counts down; then the task goes, the island opens
// to "Stand up" with a little man standing and the stand time counting down, then a green tick and back to the task.
// The island rules are core/islandtimers.ts (shared with Pomodoro and the next meeting bubble); ps-mac IslandTimers.swift
// draws them.
//
// The defaults come from the research (sources in ps-handover-notes/v158-pomodoro.md):
//  - Dunstan et al. 2012, Diabetes Care 35(5):976-983: 2 minutes of light activity every 20 minutes of sitting cut
//    blood sugar and insulin after a meal against unbroken sitting.
//  - Diaz et al. 2017, Annals of Internal Medicine: people whose sitting came in bouts under 30 minutes had the lowest
//    risk of death; the authors advise a break at least every 30 minutes.
//  - Buckley et al. 2015, British Journal of Sports Medicine expert statement: break up seated work regularly, building
//    to 2 hours a day of standing and light activity.
// So: every 30 minutes, stand for 2 minutes (the developer's own guess for the length). Both can be changed.
//
// Pure: no clock, no storage. The times are on the wall clock and lined up with it (every 30 minutes is :00 and :30), so
// every device and every restart agrees on when the next one is, with nothing saved.

export interface StandPrefs {
  on: boolean;
  every: number;          // minutes between stand-ups
  len: number;            // minutes to stand
  sound: boolean;
  hours: boolean;         // only between from and to (local time); off: whenever PS is open
  from: string;           // "HH:MM"
  to: string;             // "HH:MM"
}
export const STAND_DEFAULT: StandPrefs = { on: true, every: 30, len: 2, sound: true, hours: false, from: "09:00", to: "18:00" };
export const STAND_LIMITS = { every: [10, 120], len: [1, 15] } as const;
/** The tab on the island's right counts down this long before a stand-up. */
export const STAND_LEAD_MS = 15_000;

export const STAND_WORDS = {
  title: "Stand-up reminders",
  standUp: "Stand up",
  back: "Back to work",
  popTitle: "Time to stand up",
  popSub: (min: number) => `Stand for ${min} minute${min === 1 ? "" : "s"}.`,
  test: "Try it now",
  testing: "Coming up in 15 seconds",
} as const;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const whole = (v: unknown, [lo, hi]: readonly [number, number], d: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};
export function standPrefs(v: unknown): StandPrefs {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
  return {
    on: o.on !== false,
    every: whole(o.every, STAND_LIMITS.every, STAND_DEFAULT.every),
    len: whole(o.len, STAND_LIMITS.len, STAND_DEFAULT.len),
    sound: o.sound !== false,
    hours: o.hours === true,
    from: typeof o.from === "string" && HHMM.test(o.from) ? o.from : STAND_DEFAULT.from,
    to: typeof o.to === "string" && HHMM.test(o.to) ? o.to : STAND_DEFAULT.to,
  };
}
const mins = (hhmm: string) => { const m = HHMM.exec(hhmm)!; return Number(m[1]) * 60 + Number(m[2]); };

/** Inside the active hours (a "to" at or before "from" runs past midnight). */
export function inHours(p: StandPrefs, t: number): boolean {
  if (!p.hours) return true;
  const d = new Date(t), m = d.getHours() * 60 + d.getMinutes(), a = mins(p.from), b = mins(p.to);
  return a < b ? m >= a && m < b : m >= a || m < b;
}

/** A stand-up time that is skipped (a Pomodoro break: it counts as standing time). */
export type Skip = (at: number, len: number) => boolean;

/** The stand-up that is on now or comes next: the first time, lined up with the clock from local midnight, whose stand
 *  has not ended yet, inside the active hours and not skipped. null when off (or nothing in the next two days). */
export function nextStand(p: StandPrefs, now: number, skip: Skip = () => false): number | null {
  if (!p.on) return null;
  const every = p.every * 60_000, len = p.len * 60_000;
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  let start = day.getTime();
  for (let d = 0; d < 3; d++) {
    const next = new Date(start); next.setDate(next.getDate() + 1);
    for (let t = start; t < next.getTime(); t += every) {
      if (t + len <= now) continue;
      if (inHours(p, t) && !skip(t, len)) return t;
    }
    start = next.getTime();
  }
  return null;
}

/** What the island is told: the stand-up on now or next (wall clock), its length, and whether to chime. */
export interface StandIsland { at: number; len: number; sound: boolean; test?: boolean }
export function standIsland(p: StandPrefs, now: number, soundOk: boolean, skip?: Skip, test?: number | null): StandIsland | null {
  const len = p.len * 60_000;
  // "Try it now" in Settings: one stand-up 15 seconds from the press, whatever the schedule says.
  if (test && now < test + len) return { at: test, len, sound: p.sound && soundOk, test: true };
  const at = nextStand(p, now, skip);
  return at === null ? null : { at, len, sound: p.sound && soundOk };
}

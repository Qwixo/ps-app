// Pomodoro (V1.58, the developer 13 Nov 2026: "Add a Pomodoro timer too. Add it as a button on the display"). Work sessions and
// breaks, every length set in Settings ("fully customizable in the settings"). During a break the Dynamic Island swaps
// the task for a countdown, then shows a green tick and "Now back to work" and bounces back to the task (ps-mac
// IslandPomo.swift draws that; src/island.ts sends it what to show).
//
// Pure: no vault, no clock, no storage. The run is kept in the encrypted settings (settings.pomoRun), so it survives a
// PS restart, and it holds WALL CLOCK end times (never a ticking counter), so sleep and a screen lock never make it
// wrong: what shows is always worked out from the run and the time now (resolve below).
//
// Who uses it: src/pomodoro.ts (the page: the actions, saving each change as the time passes), views/Pomodoro.tsx (the
// button and the screen), views/SettingsGroups.tsx (the Settings section), src/island.ts (what the island shows).

export type PomoPhase = "work" | "short" | "long";

/** The Settings section. Lengths in whole minutes. clock: the minutes left beside the task on the island during work
 *  (off by default, the developer only asked for the countdown in breaks). on: the button in the Tab list (every public feature has
 *  its switch; off also stops a timer that is running). */
export interface PomoPrefs { on: boolean; work: number; short: number; long: number; rounds: number; auto: boolean; sound: boolean; clock: boolean }
export const POMO_DEFAULT: PomoPrefs = { on: true, work: 25, short: 5, long: 15, rounds: 4, auto: true, sound: true, clock: false };
export const POMO_LIMITS = { work: [1, 180], short: [1, 60], long: [1, 120], rounds: [1, 12] } as const;

/** A running Pomodoro. id: one per phase, made from when it began, so the same phase has the same id on every device
 *  and after every restart (the island shows "Now back to work" once per break by it).
 *  done: work sessions finished since the last long break. endsAt: when this phase ends (ms since 1970, wall clock).
 *  left: ms left while paused (null while it runs). wait: ready but not started (Start the next one by itself is off).
 *  back: the last break that ended or was skipped, for the island's "Now back to work". */
export interface PomoRun {
  id: string;
  phase: PomoPhase;
  done: number;
  endsAt: number;
  left: number | null;
  wait: boolean;
  back: { id: string; at: number } | null;
}

export type PomoOp = "start" | "pause" | "resume" | "skip" | "stop" | "begin";
export const POMO_OPS: readonly PomoOp[] = ["start", "pause", "resume", "skip", "stop", "begin"];

const MIN = 60_000;
/** Back from a sleep or a closed PS with the next phase already over too: it stops there, waiting for a Start, rather
 *  than running whole sessions nobody saw. Under a minute late it simply carries on. */
export const POMO_GRACE_MS = 60_000;
/** How long after a break ends the island may still say "Now back to work" (a late message, a wake). */
export const POMO_BACK_MS = 120_000;
/** The island holds "Now back to work" this long, then bounces back to the task (ps-mac IslandPomoCore.swift). */
export const POMO_BACK_SHOW_MS = 3_200;

// ---------- words (every one shown on screen; ps-mac IslandPomo.swift has its own copy of the island's) ----------
export const POMO_WORDS = {
  button: "Pomodoro",
  title: "Pomodoro",
  phase: { work: "Work", short: "Short break", long: "Long break" } as Record<PomoPhase, string>,
  ready: { work: "Ready to work", short: "Break ready", long: "Long break ready" } as Record<PomoPhase, string>,
  idle: "Ready when you are",
  paused: "Paused",
  start: "Start",
  pause: "Pause",
  resume: "Resume",
  skip: "Skip",
  stop: "Stop",
  startBreak: "Start break",
  startWork: "Start work",
  back: "Now back to work",
  introTitle: "Pomodoro works best with the Dynamic Island",
  introBody: "When a break starts, the island at the top of your screen swaps your task for a countdown. When the break ends, it says 'Now back to work' and brings your task back.",
  introSkip: "You can skip this. Pomodoro still works with Mac pop-ups and this screen.",
  introOn: "Your island is on, so you are all set.",
  introTurnOn: "Turn on the island",
  introNotNow: "Not now",
  introGotIt: "Got it",
  settings: "Settings",
  off: "Pomodoro is off in Settings.",
} as const;

// ---------- prefs ----------
const whole = (v: unknown, [lo, hi]: readonly [number, number], d: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};
/** Only well formed choices; anything else is the default (25, 5, 15, 4). */
export function pomoPrefs(v: unknown): PomoPrefs {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
  return {
    on: o.on !== false,
    work: whole(o.work, POMO_LIMITS.work, POMO_DEFAULT.work),
    short: whole(o.short, POMO_LIMITS.short, POMO_DEFAULT.short),
    long: whole(o.long, POMO_LIMITS.long, POMO_DEFAULT.long),
    rounds: whole(o.rounds, POMO_LIMITS.rounds, POMO_DEFAULT.rounds),
    auto: o.auto !== false,
    sound: o.sound !== false,
    clock: o.clock === true,
  };
}
/** How long a phase lasts, in ms. */
export function phaseMs(p: PomoPhase, prefs: PomoPrefs): number {
  return (p === "work" ? prefs.work : p === "short" ? prefs.short : prefs.long) * MIN;
}
export const isBreak = (p: PomoPhase) => p !== "work";

// ---------- the run ----------
const PHASES: readonly PomoPhase[] = ["work", "short", "long"];
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
const idOf = (p: PomoPhase, at: number) => `${p[0]}${Math.round(at).toString(36)}`;
const ID = /^[wsl][0-9a-z]{1,12}$/;

/** A saved run checked (it comes back from the vault and from the Tab list): anything odd is no run at all. */
export function cleanRun(v: unknown): PomoRun | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const phase = PHASES.find((p) => p === o.phase);
  const id = typeof o.id === "string" && ID.test(o.id) ? o.id : null;
  const endsAt = num(o.endsAt), left = o.left === null || o.left === undefined ? null : num(o.left);
  if (!phase || !id || (left === null && !(endsAt > 0)) || (left !== null && !(left >= 0 && left <= 400 * MIN))) return null;
  const done = Math.max(0, Math.min(12, Math.round(num(o.done) || 0)));
  const b = o.back && typeof o.back === "object" ? o.back as Record<string, unknown> : null;
  const back = b && typeof b.id === "string" && ID.test(b.id) && num(b.at) > 0 ? { id: b.id, at: num(b.at) } : null;
  return { id, phase, done, endsAt: left === null ? endsAt : 0, left, wait: o.wait === true && left !== null, back };
}

/** What comes after this phase: a break after work (the long one every `rounds` sessions), work after a break. */
export function nextPhase(r: Pick<PomoRun, "phase" | "done">, prefs: PomoPrefs): { phase: PomoPhase; done: number } {
  if (r.phase === "work") {
    const done = r.done + 1;
    return { phase: done >= prefs.rounds ? "long" : "short", done };
  }
  return { phase: "work", done: r.phase === "long" ? 0 : r.done };
}

/** The run as it is now. Phases that ended move on by themselves: straight into the next one when "Start the next one
 *  by itself" is on (it starts the moment the last one ended, so nothing drifts), else it waits for a Start. Back from a
 *  long sleep with the next phase over too, it waits as well. Pure: the same run and time give the same answer on every
 *  device. */
export function resolve(run: PomoRun | null, prefs: PomoPrefs, now: number): PomoRun | null {
  let r = run;
  for (let i = 0; r && !r.wait && r.left === null && now >= r.endsAt && i < 64; i++) {
    const next = nextPhase(r, prefs);
    const len = phaseMs(next.phase, prefs);
    const back = isBreak(r.phase) ? { id: r.id, at: r.endsAt } : r.back;
    const id = idOf(next.phase, r.endsAt);
    r = prefs.auto && now - r.endsAt < len + POMO_GRACE_MS
      ? { id, phase: next.phase, done: next.done, endsAt: r.endsAt + len, left: null, wait: false, back }
      : { id, phase: next.phase, done: next.done, endsAt: 0, left: len, wait: true, back };
  }
  return r;
}

/** A button pressed. Always on the run as it is NOW (resolve first), so a press after a sleep acts on what shows. */
export function applyOp(run: PomoRun | null, op: PomoOp, prefs: PomoPrefs, now: number): PomoRun | null {
  const r = resolve(run, prefs, now);
  switch (op) {
    case "start":
      // A fresh cycle of work. Start on a waiting phase starts that phase instead (the same as begin).
      if (r?.wait) return applyOp(r, "begin", prefs, now);
      if (r) return r;
      return { id: idOf("work", now), phase: "work", done: 0, endsAt: now + phaseMs("work", prefs), left: null, wait: false, back: null };
    case "pause":
      if (!r || r.wait || r.left !== null) return r;
      return { ...r, left: Math.max(0, r.endsAt - now), endsAt: 0 };
    case "resume":
    case "begin":
      if (!r || r.left === null) return r;
      return { ...r, id: r.wait ? idOf(r.phase, now) : r.id, endsAt: now + r.left, left: null, wait: false };
    case "skip": {
      // The next phase starts now, running (a skip is a press: it never waits). A skipped break still says back to work.
      if (!r) return r;
      const next = nextPhase(r, prefs);
      const back = isBreak(r.phase) ? { id: r.id, at: now } : r.back;
      return { id: idOf(next.phase, now), phase: next.phase, done: next.done, endsAt: now + phaseMs(next.phase, prefs), left: null, wait: false, back };
    }
    case "stop":
      return null;
  }
}
export function cleanOp(v: unknown): PomoOp | null {
  const o = v && typeof v === "object" ? (v as { op?: unknown }).op : v;
  return POMO_OPS.find((x) => x === o) ?? null;
}

// ---------- what shows ----------
/** ms left in the phase now (the full length while waiting). */
export function msLeft(r: PomoRun, now: number): number {
  return r.left !== null ? r.left : Math.max(0, r.endsAt - now);
}
/** "25:00", "4:59", "1:02:00". Rounded up, so a phase never shows 0:00 while it still runs. */
export function clock(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
/** "Session 2 of 4": the work session this is (or the one that comes next, on a break). */
export function sessionLine(r: PomoRun | null, prefs: PomoPrefs): string {
  if (!r) return `${prefs.work} min work, ${prefs.short} min break`;
  const n = r.phase === "work" ? r.done + 1 : r.phase === "long" ? prefs.rounds : Math.min(prefs.rounds, r.done);
  return `Session ${Math.max(1, n)} of ${prefs.rounds}`;
}
/** 0 to 1, how much of the phase has gone (the ring on the screen). */
export function progress(r: PomoRun, prefs: PomoPrefs, now: number): number {
  const len = phaseMs(r.phase, prefs);
  return len > 0 ? Math.max(0, Math.min(1, 1 - msLeft(r, now) / len)) : 0;
}

/** What the island is told ({type:"island", state:{ pomo }}): enough to count down by itself, every second, with no
 *  message from the page (endsAt is wall clock). null: no Pomodoro running. sound: the sound setting, with Do Not
 *  Disturb's "sounds" switch already applied by the page. */
export interface PomoIsland {
  id: string;
  phase: PomoPhase;
  endsAt: number;
  left: number | null;
  wait: boolean;
  clock: boolean;
  sound: boolean;
  back: { id: string; at: number } | null;
}
export function pomoIsland(run: PomoRun | null, prefs: PomoPrefs, now: number, soundOk: boolean): PomoIsland | null {
  if (!prefs.on) return null;
  const r = resolve(run, prefs, now);
  if (!r) return null;
  const back = r.back && now - r.back.at < POMO_BACK_MS ? r.back : null;
  return { id: r.id, phase: r.phase, endsAt: r.endsAt, left: r.left, wait: r.wait, clock: prefs.clock, sound: prefs.sound && soundOk, back };
}

/** The id of the break the island should say "Now back to work" for, if any: a running break whose end has come (the
 *  island counts by itself, so it is over even before the page says so), or the last break that ended or was skipped.
 *  Only in the two minutes after: back from a long sleep there is no old celebration. The rules for what the island
 *  shows are core/islandtimers.ts. */
export function pomoBackId(p: PomoIsland | null, now: number): string | null {
  if (!p) return null;
  // A running break whose end has come is over, even before the page says so (the island counts by itself).
  if (isBreak(p.phase) && !p.wait && p.left === null && now >= p.endsAt && now - p.endsAt < POMO_BACK_MS) return p.id;
  if (p.back && now >= p.back.at && now - p.back.at < POMO_BACK_MS) return p.back.id;
  return null;
}

/** The Pomodoro breaks known now: the one on now, or the next one after this work session when it starts by itself.
 *  Stand-ups that fall in one are skipped (a break counts as standing time, core/standup.ts). */
export function breakWindows(run: PomoRun | null, prefs: PomoPrefs, now: number): [number, number][] {
  const r = prefs.on ? resolve(run, prefs, now) : null;
  if (!r) return [];
  if (isBreak(r.phase)) return [r.left !== null ? [now, now + r.left] : [r.endsAt - phaseMs(r.phase, prefs), r.endsAt]];
  if (r.left !== null || !prefs.auto) return [];
  const next = nextPhase(r, prefs);
  return [[r.endsAt, r.endsAt + phaseMs(next.phase, prefs)]];
}

// The island's timers (V1.58): one small system that Pomodoro, Stand-up reminders and the next meeting bubble share, so
// the island never shows two takeovers at once and every timer looks and sounds alike. ps-mac IslandTimersCore.swift has
// the SAME rules (its own unit test, tests/island-timers-test.sh); this copy is what the page's tests check, and the
// page sends the island only what it needs to count by itself (wall clock times), never a ticking number.
//
// The island has a middle (normally the task) and a bubble on its right side.
//  Middle, most important first:
//   1. back:   a green tick and words for a few seconds once a break or a stand-up ends (once each), then the task.
//   2. break:  a Pomodoro break counting down (or "Break ready" with Start, when it waits for a press).
//   3. stand:  "Stand up", the little man, and the stand time counting down.
//   4. task:   the task, as always.
//  A stand-up never starts in a Pomodoro break: the break counts as standing time (the page skips that stand-up, and
//  the island drops one whose time comes while a break shows). A break that starts mid stand-up wins.
//  Right bubble, only while the middle shows the task (a takeover wins, the bubble comes back after):
//   1. standSoon: the last 15 seconds before a stand-up, counting down.
//   2. meet:      the next meeting, "<name> in 12m", Join in its last 2 minutes (with a link), time left during it.
//
// Reusable bits for other island work (setup-island-158): the green tick and its chime are ISLAND_TONES.done here and
// IslandTick and IslandChime in ps-mac IslandTimers.swift.
import { isBreak, pomoBackId, POMO_BACK_MS, POMO_BACK_SHOW_MS, POMO_WORDS, type PomoIsland } from "./pomodoro.ts";
import { STAND_LEAD_MS, STAND_WORDS, type StandIsland } from "./standup.ts";
import { MEET_JOIN_MS, type MeetIsland } from "./meetbubble.ts";

export interface TimersIn { pomo: PomoIsland | null; stand: StandIsland | null; meet: MeetIsland | null }

export type Middle =
  | { kind: "task" }
  | { kind: "back"; id: string; words: string }
  | { kind: "break"; phase: "short" | "long"; endsAt: number; left: number | null; ready: boolean }
  | { kind: "stand"; at: number; endsAt: number };
export type Bubble =
  | { kind: "none" }
  | { kind: "standSoon"; at: number }
  | { kind: "meet"; mode: "soon" | "join" | "now"; m: MeetIsland };
export interface TimersShow { middle: Middle; right: Bubble }

/** How long the green tick shows (the same for every timer). */
export const BACK_SHOW_MS = POMO_BACK_SHOW_MS;

/** A Pomodoro break on screen now (running or waiting): stand-ups wait for none, they are skipped. */
const breakNow = (p: PomoIsland | null, now: number) => !!p && isBreak(p.phase) && (p.wait || p.left !== null || now < p.endsAt);

/** The id of a stand-up's green tick, once its stand time is over (in the last two minutes only). */
export function standBackId(s: StandIsland | null, now: number): string | null {
  if (!s) return null;
  const end = s.at + s.len;
  return now >= end && now - end < POMO_BACK_MS ? `stand-${Math.round(s.at).toString(36)}` : null;
}

/** What the island shows now. seen: the green ticks already shown (the island adds one as it starts showing it).
 *  dropped: stand-ups whose time came in a break (the island remembers them, so they never show later). */
export function timersShow(t: TimersIn, now: number, seen: ReadonlySet<string> = new Set(), dropped: ReadonlySet<number> = new Set()): TimersShow {
  const middle = middleOf(t, now, seen, dropped);
  return { middle, right: middle.kind === "task" ? bubbleOf(t, now, dropped) : { kind: "none" } };
}

function middleOf(t: TimersIn, now: number, seen: ReadonlySet<string>, dropped: ReadonlySet<number>): Middle {
  const pb = pomoBackId(t.pomo, now);
  if (pb && !seen.has(pb)) return { kind: "back", id: pb, words: POMO_WORDS.back };
  const p = t.pomo;
  if (p && breakNow(p, now)) return { kind: "break", phase: p.phase as "short" | "long", endsAt: p.endsAt, left: p.left, ready: p.wait };
  const s = t.stand;
  if (s && !dropped.has(s.at)) {
    const sb = standBackId(s, now);
    if (sb && !seen.has(sb)) return { kind: "back", id: sb, words: STAND_WORDS.back };
    if (now >= s.at && now < s.at + s.len) return { kind: "stand", at: s.at, endsAt: s.at + s.len };
  }
  return { kind: "task" };
}

function bubbleOf(t: TimersIn, now: number, dropped: ReadonlySet<number>): Bubble {
  const s = t.stand;
  if (s && !dropped.has(s.at) && now >= s.at - STAND_LEAD_MS && now < s.at && !breakNow(t.pomo, s.at)) return { kind: "standSoon", at: s.at };
  const m = t.meet;
  if (m && now >= m.from && now < m.end) {
    const mode = now >= m.start ? "now" : m.link && m.start - now <= MEET_JOIN_MS ? "join" : "soon";
    return { kind: "meet", mode, m };
  }
  return { kind: "none" };
}

/** A stand-up whose time comes while a Pomodoro break shows is dropped (the break counts as standing). */
export function dropsStand(t: TimersIn, now: number): number | null {
  const s = t.stand;
  return s && now >= s.at && now < s.at + s.len && breakNow(t.pomo, now) ? s.at : null;
}

// ---------- the sounds every island timer shares (made here, never a recorded file; ps-mac Sfx.swift has the same) ----------
/** wave 0 sine, 1 triangle. done: a quick bright rise into a soft bell, with the green tick ("island-done").
 *  start: two soft notes falling, as a takeover begins ("island-start"). Quiet on purpose. */
export interface IslandTone { f: number; to?: number; dur: number; peak: number; wave: 0 | 1; at: number }
export const ISLAND_TONES: Record<"done" | "start", IslandTone[]> = {
  done: [
    { f: 783.99, dur: 0.16, peak: 0.09, wave: 1, at: 0 },
    { f: 987.77, dur: 0.16, peak: 0.09, wave: 1, at: 0.08 },
    { f: 1174.66, dur: 0.18, peak: 0.09, wave: 1, at: 0.16 },
    { f: 1567.98, dur: 0.95, peak: 0.1, wave: 0, at: 0.24 },
    { f: 3135.96, dur: 0.3, peak: 0.025, wave: 0, at: 0.25 },
    { f: 392, dur: 0.7, peak: 0.04, wave: 0, at: 0.24 },
  ],
  start: [
    { f: 1174.66, to: 1108.73, dur: 0.38, peak: 0.08, wave: 0, at: 0 },
    { f: 880, to: 830.61, dur: 0.55, peak: 0.08, wave: 0, at: 0.13 },
    { f: 440, dur: 0.5, peak: 0.03, wave: 0, at: 0.13 },
  ],
};

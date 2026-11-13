// Run: node --experimental-strip-types tests/pomodoro.test.ts
// V1.58 Pomodoro (src/core/pomodoro.ts): sessions, the long break cycle, pause, skip, stop, sleep and a restart (wall
// clock end times), the settings, and what the island shows (countdown, ready, "Now back to work", the task).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  POMO_BACK_MS, POMO_DEFAULT, POMO_GRACE_MS, POMO_WORDS, applyOp, cleanOp, cleanRun, clock, msLeft, nextPhase, phaseMs, pomoBackId,
  pomoIsland, pomoPrefs, progress, resolve, sessionLine, type PomoRun,
} from "../src/core/pomodoro.ts";
import { timersShow } from "../src/core/islandtimers.ts";
const pomoShow = (p: ReturnType<typeof pomoIsland>, now: number, seen?: Set<string>) => {
  const m = timersShow({ pomo: p, stand: null, meet: null }, now, seen).middle;
  return m.kind === "break" ? (m.ready ? "ready" : "countdown") : m.kind;
};

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 13, 9, 0, 0);
const P = POMO_DEFAULT;

// ---------- settings ----------
ok("defaults are 25, 5, 15 and 4, auto start on, sound on, island clock off, the button on", () => {
  assert.deepEqual(pomoPrefs(undefined), { on: true, work: 25, short: 5, long: 15, rounds: 4, auto: true, sound: true, clock: false });
});
ok("settings are kept in range and whole; nonsense falls back to the default", () => {
  const p = pomoPrefs({ work: 0, short: 999, long: "20", rounds: 2.6, auto: false, sound: false, clock: true, on: false });
  assert.deepEqual(p, { on: false, work: 1, short: 60, long: 20, rounds: 3, auto: false, sound: false, clock: true });
  assert.equal(pomoPrefs({ work: "abc" }).work, 25);
  assert.equal(pomoPrefs({ work: 180.4 }).work, 180);
  assert.equal(pomoPrefs({ rounds: 50 }).rounds, 12);
});
ok("phase lengths follow the settings", () => {
  const p = pomoPrefs({ work: 50, short: 10, long: 30 });
  assert.equal(phaseMs("work", p), 50 * MIN);
  assert.equal(phaseMs("short", p), 10 * MIN);
  assert.equal(phaseMs("long", p), 30 * MIN);
});

// ---------- sessions and the long break cycle ----------
ok("start makes a work session that ends 25 minutes later on the wall clock", () => {
  const r = applyOp(null, "start", P, T0)!;
  assert.equal(r.phase, "work"); assert.equal(r.done, 0); assert.equal(r.endsAt, T0 + 25 * MIN); assert.equal(r.left, null);
  assert.equal(clock(msLeft(r, T0)), "25:00");
  assert.equal(clock(msLeft(r, T0 + 1)), "25:00", "rounded up: never shows a second less than is left");
  assert.equal(clock(msLeft(r, T0 + 25 * MIN - 1)), "0:01");
});
ok("the cycle: work, short, work, short, work, short, work, LONG, then work again from session 1", () => {
  const seq: string[] = [];
  let r: PomoRun | null = applyOp(null, "start", P, T0);
  let t = T0;
  for (let i = 0; i < 9; i++) { seq.push(`${r!.phase}${r!.done}`); t = r!.endsAt; r = resolve(r, P, t); }
  assert.deepEqual(seq, ["work0", "short1", "work1", "short2", "work2", "short3", "work3", "long4", "work0"]);
});
ok("sessions before a long break is a setting", () => {
  const p = pomoPrefs({ rounds: 2 });
  assert.deepEqual(nextPhase({ phase: "work", done: 0 }, p), { phase: "short", done: 1 });
  assert.deepEqual(nextPhase({ phase: "work", done: 1 }, p), { phase: "long", done: 2 });
  assert.deepEqual(nextPhase({ phase: "long", done: 2 }, p), { phase: "work", done: 0 });
  assert.deepEqual(nextPhase({ phase: "short", done: 1 }, p), { phase: "work", done: 1 });
  assert.equal(nextPhase({ phase: "work", done: 0 }, pomoPrefs({ rounds: 1 })).phase, "long", "1: every break is the long one");
});
ok("auto start: the next phase begins the moment the last ended, so nothing drifts", () => {
  const r = applyOp(null, "start", P, T0)!;
  const b = resolve(r, P, T0 + 25 * MIN + 3000)!;
  assert.equal(b.phase, "short"); assert.equal(b.endsAt, T0 + 30 * MIN); assert.equal(b.wait, false);
  assert.equal(clock(msLeft(b, T0 + 25 * MIN + 3000)), "4:57");
});
ok("auto start off: a finished phase waits for Start with its full length, and Start begins it now", () => {
  const p = pomoPrefs({ auto: false });
  const r = applyOp(null, "start", p, T0)!;
  const w = resolve(r, p, T0 + 26 * MIN)!;
  assert.equal(w.phase, "short"); assert.equal(w.wait, true); assert.equal(w.left, 5 * MIN);
  assert.equal(resolve(w, p, T0 + 99 * MIN), w, "a waiting phase never moves on by itself");
  const s = applyOp(w, "start", p, T0 + 27 * MIN)!;
  assert.equal(s.wait, false); assert.equal(s.endsAt, T0 + 32 * MIN);
  const g = applyOp(w, "begin", p, T0 + 27 * MIN)!;
  assert.deepEqual(g, s, "Start and Start break do the same on a waiting phase");
});
ok("start on a running session changes nothing", () => {
  const r = applyOp(null, "start", P, T0)!;
  assert.deepEqual(applyOp(r, "start", P, T0 + MIN), r);
});

// ---------- pause, resume, skip, stop ----------
ok("pause keeps the time left; resume sets a new end time from now", () => {
  const r = applyOp(null, "start", P, T0)!;
  const p = applyOp(r, "pause", P, T0 + 10 * MIN)!;
  assert.equal(p.left, 15 * MIN); assert.equal(p.endsAt, 0);
  assert.equal(resolve(p, P, T0 + 500 * MIN), p, "a paused session never runs out");
  assert.equal(clock(msLeft(p, T0 + 500 * MIN)), "15:00");
  const q = applyOp(p, "resume", P, T0 + 60 * MIN)!;
  assert.equal(q.left, null); assert.equal(q.endsAt, T0 + 75 * MIN); assert.equal(q.id, r.id, "the same session");
});
ok("skip moves to the next phase now, running; a skipped break still says back to work", () => {
  const r = applyOp(null, "start", P, T0)!;
  const b = applyOp(r, "skip", P, T0 + 5 * MIN)!;
  assert.equal(b.phase, "short"); assert.equal(b.done, 1); assert.equal(b.endsAt, T0 + 10 * MIN); assert.equal(b.back, null);
  const w = applyOp(b, "skip", P, T0 + 6 * MIN)!;
  assert.equal(w.phase, "work"); assert.deepEqual(w.back, { id: b.id, at: T0 + 6 * MIN });
  const p = applyOp(applyOp(w, "pause", P, T0 + 7 * MIN), "skip", P, T0 + 8 * MIN)!;
  assert.equal(p.left, null, "skip on a paused session starts the next one running");
});
ok("stop ends it; pause and skip on nothing do nothing", () => {
  assert.equal(applyOp(applyOp(null, "start", P, T0), "stop", P, T0), null);
  assert.equal(applyOp(null, "pause", P, T0), null);
  assert.equal(applyOp(null, "skip", P, T0), null);
  assert.equal(applyOp(null, "resume", P, T0), null);
});
ok("only known buttons are taken from the Tab list", () => {
  assert.equal(cleanOp({ op: "skip" }), "skip");
  assert.equal(cleanOp("pause"), "pause");
  assert.equal(cleanOp({ op: "explode" }), null);
  assert.equal(cleanOp(null), null);
});

// ---------- sleep, lock and restart ----------
ok("asleep through the end of a work session: the break is under way by the wall clock", () => {
  const r = applyOp(null, "start", P, T0)!;
  const b = resolve(r, P, T0 + 27 * MIN)!;
  assert.equal(b.phase, "short"); assert.equal(clock(msLeft(b, T0 + 27 * MIN)), "3:00");
});
ok("asleep through a whole following phase: it stops there and waits, it never runs sessions nobody saw", () => {
  const r = applyOp(null, "start", P, T0)!;
  // Work ended at 25 min; the 5 min break would have ended at 30. Back at 31: more than the break plus the grace.
  const w = resolve(r, P, T0 + 25 * MIN + 5 * MIN + POMO_GRACE_MS + 1)!;
  assert.equal(w.phase, "short"); assert.equal(w.wait, true); assert.equal(w.left, 5 * MIN);
  // Back after 8 hours: the same, one waiting break.
  const z = resolve(r, P, T0 + 8 * 60 * MIN)!;
  assert.equal(z.phase, "short"); assert.equal(z.wait, true);
});
ok("a restart mid session: the saved run, read back, shows the same time left", () => {
  const r = applyOp(null, "start", P, T0)!;
  const saved = JSON.parse(JSON.stringify(r));
  const back = cleanRun(saved)!;
  assert.deepEqual(back, r);
  assert.equal(clock(msLeft(resolve(back, P, T0 + 7 * MIN)!, T0 + 7 * MIN)), "18:00");
  const paused = cleanRun(JSON.parse(JSON.stringify(applyOp(r, "pause", P, T0 + 2 * MIN))))!;
  assert.equal(paused.left, 23 * MIN);
});
ok("the same run and time give the same answer anywhere (ids included)", () => {
  const r = applyOp(null, "start", P, T0)!;
  assert.deepEqual(resolve(r, P, T0 + 40 * MIN), resolve(r, P, T0 + 40 * MIN));
  assert.equal(resolve(r, P, T0 + 26 * MIN)!.id, resolve(r, P, T0 + 29 * MIN)!.id);
});
ok("a broken saved run is no run", () => {
  for (const v of [null, 5, "x", {}, { id: "w1", phase: "nap", endsAt: 5 }, { id: "bad id!", phase: "work", endsAt: 5 }, { id: "w1", phase: "work" },
    { id: "w1", phase: "work", left: -5 }]) assert.equal(cleanRun(v), null, JSON.stringify(v));
  const c = cleanRun({ id: "s1", phase: "short", endsAt: T0, left: null, done: 99, wait: true, back: { id: "nope!", at: 1 } })!;
  assert.equal(c.done, 12); assert.equal(c.wait, false, "only a phase with time left can wait"); assert.equal(c.back, null);
});

// ---------- what the screen and the island show ----------
ok("session line and progress", () => {
  assert.equal(sessionLine(null, P), "25 min work, 5 min break");
  const r = applyOp(null, "start", P, T0)!;
  assert.equal(sessionLine(r, P), "Session 1 of 4");
  assert.equal(sessionLine(resolve(r, P, T0 + 26 * MIN), P), "Session 1 of 4", "the break after session 1");
  assert.equal(sessionLine(resolve(resolve(r, P, T0 + 26 * MIN), P, T0 + 31 * MIN), P), "Session 2 of 4");
  assert.equal(progress(r, P, T0 + 12.5 * MIN), 0.5);
});
ok("the island is told nothing when it is off or nothing runs", () => {
  assert.equal(pomoIsland(null, P, T0, true), null);
  assert.equal(pomoIsland(applyOp(null, "start", P, T0), pomoPrefs({ on: false }), T0, true), null);
});
ok("the island gets wall clock end times, the clock setting and the sound (Do Not Disturb applied)", () => {
  const r = applyOp(null, "start", P, T0)!;
  const i = pomoIsland(r, P, T0 + 26 * MIN, true)!;
  assert.equal(i.phase, "short"); assert.equal(i.endsAt, T0 + 30 * MIN); assert.equal(i.sound, true); assert.equal(i.clock, false);
  assert.equal(pomoIsland(r, P, T0, false)!.sound, false, "Do Not Disturb mutes it");
  assert.equal(pomoIsland(r, pomoPrefs({ sound: false }), T0, true)!.sound, false);
  assert.equal(pomoIsland(r, pomoPrefs({ clock: true }), T0, true)!.clock, true);
});
ok("island: work shows the task; a break swaps it for the countdown; a waiting break shows ready", () => {
  const r = applyOp(null, "start", P, T0)!;
  assert.equal(pomoShow(pomoIsland(r, P, T0, true), T0), "task");
  const at = T0 + 26 * MIN;
  assert.equal(pomoShow(pomoIsland(r, P, at, true), at), "countdown");
  const paused = applyOp(r, "pause", P, at)!;
  assert.equal(pomoShow(pomoIsland(paused, P, at, true), at + 10 * MIN), "countdown", "a paused break keeps its countdown");
  const p = pomoPrefs({ auto: false });
  assert.equal(pomoShow(pomoIsland(r, p, at, true), at), "ready");
  assert.equal(pomoShow(null, at), "task");
});
ok("island: when the break ends, 'Now back to work' once, then the task", () => {
  const r = applyOp(null, "start", P, T0)!;
  const brk = pomoIsland(r, P, T0 + 26 * MIN, true)!;
  const end = T0 + 30 * MIN;
  // The island counts by itself: at the end it is back to work even before the page sends the next state.
  assert.equal(pomoShow(brk, end), "back");
  assert.equal(pomoBackId(brk, end), brk.id);
  // The page's next state (work) carries the same break, so it is the same moment, shown once.
  const work = pomoIsland(r, P, end + 500, true)!;
  assert.equal(work.phase, "work"); assert.equal(work.back?.id, brk.id);
  assert.equal(pomoShow(work, end + 500), "back");
  assert.equal(pomoShow(work, end + 500, new Set([brk.id])), "task", "already shown: the task");
  // Long after (a wake hours later): no old celebration.
  assert.equal(pomoShow(pomoIsland(resolve(r, P, T0 + 26 * MIN), P, end + POMO_BACK_MS + 1, true), end + POMO_BACK_MS + 1), "task");
});
ok("island: a skipped break says back to work too; a stop just goes back to the task", () => {
  const r = resolve(applyOp(null, "start", P, T0), P, T0 + 26 * MIN)!;
  const sk = applyOp(r, "skip", P, T0 + 27 * MIN)!;
  assert.equal(pomoShow(pomoIsland(sk, P, T0 + 27 * MIN, true), T0 + 27 * MIN), "back");
  assert.equal(pomoShow(pomoIsland(applyOp(r, "stop", P, T0 + 27 * MIN), P, T0 + 27 * MIN, true), T0 + 27 * MIN), "task");
});

// ---------- wording: plain words, no long dashes ----------
ok("every Pomodoro word is plain, with no em or en dash", () => {
  const all = JSON.stringify(POMO_WORDS);
  assert.doesNotMatch(all, /[–—]/);
  assert.equal(POMO_WORDS.back, "Now back to work");
  for (const f of ["src/core/pomodoro.ts", "src/pomodoro.ts", "src/views/Pomodoro.tsx", "src/views/pomodoro.css"]) {
    assert.doesNotMatch(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), /[–—]/, f);
  }
});

console.log(`\n${n} passed`);

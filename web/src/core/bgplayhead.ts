// A background video that never restarts (V1.40, the developer 7 Nov 2026: "when I go on the Tab overlay the video always starts
// at the start. I want it to continue playing despite me not looking at it").
// Nothing plays while the list is hidden (no decoding, no CPU): the page keeps a virtual playhead instead. On hide it
// notes where the video was and the wall clock; on show it seeks to where the video WOULD be had it kept playing
// (saved time + time away, round the loop), before the first frame is shown. Pure maths, no DOM.

export type Playhead = { t: number; at: number; dur: number };

const ok = (n: number) => Number.isFinite(n) && n > 0;

/** What to remember when the video stops being seen: its time (s), the wall clock (ms) and its length (s). */
export function notePlayhead(t: number, now: number, dur: number): Playhead {
  const d = ok(dur) ? dur : 0;
  const time = Number.isFinite(t) && t > 0 ? t : 0;
  return { t: d ? time % d : time, at: now, dur: d };
}

/** Where to start when it is seen again: as if it had played on, looping, the whole time it was away.
 *  dur is the length the newly loaded video reports (the saved one if that is not known yet). */
export function resumeAt(p: Playhead | null | undefined, now: number, dur: number): number {
  if (!p) return 0;
  const d = ok(dur) ? dur : p.dur;
  const away = Math.max(0, (now - p.at) / 1000);   // a clock that went backwards counts as no time away
  const t = p.t + away;
  if (!ok(d)) return Math.max(0, t);
  const r = t % d;
  // Never land in the last few frames: the loop point is where a stutter would show.
  return r > d - 0.08 ? 0 : r;
}

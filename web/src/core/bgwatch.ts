// Keeps the phone's background video going (V1.47, the developer 10 Nov 2026: "the video background on the GOS app sometimes
// just stops working, completely ... Fix that").
//
// What stopped it, found in the code (no phone log of it yet, so each one gets a log line now):
//  - The player gave up for good on one bad answer from the shell: a busy Keystore on the first ask after PS started
//    (the shell said 503), a piece that could not be read mid stream, or a decoder the system took back. The <video>
//    then sat in its error state with no retry until PS was hidden and shown again.
//  - A pause the page did not ask for (the WebView paused and resumed, the decoder handed back after the screen was
//    off) left a paused video on screen.
//  - A frozen frame: playing on paper, the time not moving (the player waiting for data that never comes).
// This file is only the decision, a pure function the layer calls about once a second while the video is meant to
// be seen. It never acts while the list is hidden or the screen is off (nothing runs then, for the battery), and
// it backs off after failed tries (2 s, 4 s ... 60 s) so a video that truly can not play does not spin.

export interface VideoNow {
  /** The list is on screen and the page is visible (the video is meant to play). */
  wanted: boolean;
  /** The layer has its first frame (it waits for a seek after a show; nothing is judged before that). */
  ready: boolean;
  paused: boolean;
  /** The element's error code (1 aborted, 2 network, 3 decode, 4 not supported), 0 for none. */
  error: number;
  /** currentTime, seconds. */
  t: number;
}
export interface Watch {
  /** The last time seen and when it last moved (ms). */
  lastT: number;
  movedAt: number;
  /** Tries since it last played properly, and the earliest the next one may run. */
  tries: number;
  nextAt: number;
  /** Why the last try was made and when (for the log line once it plays again), or "" when all is well. */
  why: string;
  since: number;
}
export type Act = { kind: "none" } | { kind: "play"; why: string } | { kind: "reload"; why: string } | { kind: "recovered"; why: string; ms: number; tries: number };

/** Playing on paper but the time has not moved for this long: a frozen frame. */
export const STUCK_MS = 5000;
const BACKOFF_MAX = 60_000;

export function newWatch(now: number): Watch { return { lastT: -1, movedAt: now, tries: 0, nextAt: 0, why: "", since: 0 }; }

/** The wait before try number `n` (1 is the first): 2 s, 4 s, 8 s ... at most 60 s. The first is at once. */
export function backoff(n: number): number { return n <= 1 ? 0 : Math.min(BACKOFF_MAX, 1000 * 2 ** (n - 1)); }

const ERR = ["", "aborted", "network", "decode", "not supported"];
export const errName = (code: number) => ERR[code] ?? `code ${code}`;

/** One look. Returns the next state and what to do. */
export function look(w: Watch, v: VideoNow, now: number): { w: Watch; act: Act } {
  // Hidden, or still starting: nothing is judged, and the frozen frame clock starts again on the next show.
  if (!v.wanted || !v.ready) return { w: { ...w, lastT: -1, movedAt: now }, act: { kind: "none" } };
  const moved = w.lastT >= 0 && Math.abs(v.t - w.lastT) > 0.01;
  const next: Watch = { ...w, lastT: v.t, movedAt: moved || w.lastT < 0 ? now : w.movedAt };
  if (!v.error && !v.paused && moved) {
    // Playing. If a try got it here, say so once.
    if (w.why) return { w: { ...next, tries: 0, nextAt: 0, why: "", since: 0 }, act: { kind: "recovered", why: w.why, ms: now - w.since, tries: w.tries } };
    return { w: { ...next, tries: 0, nextAt: 0 }, act: { kind: "none" } };
  }
  const why = v.error ? `error (${errName(v.error)})` : v.paused ? "paused on its own" : now - next.movedAt >= STUCK_MS ? "frozen frame" : "";
  if (!why || now < w.nextAt) return { w: next, act: { kind: "none" } };
  const tries = w.tries + 1;
  // A pause is first answered with play(); an error, a frozen frame or a play() that did not take, with a reload.
  const kind: "play" | "reload" = !v.error && v.paused && w.why !== "paused on its own" ? "play" : "reload";
  return {
    w: { ...next, movedAt: now, tries, nextAt: now + Math.max(1500, backoff(tries + 1)), why: w.why || why, since: w.why ? w.since : now },
    act: { kind, why },
  };
}

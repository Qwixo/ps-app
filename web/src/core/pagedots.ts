// The list's page dots on the phone, like the iPhone home screen's (PS 1.60, phone fixes). Pure rules, no screen:
// where a finger lands among the dots, which way a tap goes, and when a press and slide counts as scrubbing.
//   - A tap on the left half of the dots pill goes one page back, on the right half one page forward.
//   - Press and slide along the pill (more than SLIDE_PX sideways) scrubs: the page under the finger is shown, and each
//     new page gives one small haptic tick.
//   - The pill is at least MIN_H points tall, and the two + buttons sit outside it with a gap, so a page tap can never
//     add a page.
//
// Run: node --experimental-strip-types tests/pagedots.test.ts

/** The dots pill's size on the phone (points). 44 is the smallest a thumb can hit reliably. */
export const MIN_H = 44;
/** The smallest sideways move that turns a press into a scrub. */
export const SLIDE_PX = 8;
/** The gap between the pill and each + button (points). */
export const PLUS_GAP = 14;

/** Where the pill's dots sit on screen (the pill without the + buttons) and how many pages it holds. */
export type Geo = { left: number; width: number; n: number };

/** The dot index under x (clamped: a finger past either end is the first or last page). Dots take equal room. */
export function dotAt(x: number, g: Geo): number {
  if (g.n <= 0 || !(g.width > 0)) return 0;
  const i = Math.floor(((x - g.left) / g.width) * g.n);
  return Math.max(0, Math.min(g.n - 1, i));
}

/** A tap: the left half goes back, the right half forward, never past the first or last page. */
export function tapTarget(x: number, g: Geo, cur: number): number {
  if (g.n <= 0) return 0;
  const c = Math.max(0, Math.min(g.n - 1, cur));
  return x < g.left + g.width / 2 ? Math.max(0, c - 1) : Math.min(g.n - 1, c + 1);
}

export type Press = { x0: number; t0: number; scrubbing: boolean; index: number };

/** A finger went down on the pill at x. `cur` is the page now shown. */
export function press(x: number, t: number, cur: number): Press {
  return { x0: x, t0: t, scrubbing: false, index: cur };
}

/** The finger moved to x. `to` is the page to show when it changed (also the moment for one haptic tick). */
export function move(p: Press, x: number, g: Geo): { p: Press; to: number | null; started: boolean } {
  let scrubbing = p.scrubbing, started = false;
  if (!scrubbing) {
    if (Math.abs(x - p.x0) < SLIDE_PX) return { p, to: null, started: false };
    scrubbing = true; started = true;
  }
  const i = dotAt(x, g);
  const changed = i !== p.index;
  return { p: { ...p, scrubbing, index: i }, to: changed ? i : null, started };
}

/** The finger lifted. A press that never slid is a tap; a slid press already showed its page. A press held very long
 *  without sliding (the dot's own long press menu) is neither. */
export const LONG_MS = 520;
export function release(p: Press, x: number, t: number, g: Geo): { kind: "scrub" } | { kind: "tap"; to: number } | { kind: "none" } {
  if (p.scrubbing) return { kind: "scrub" };
  if (t - p.t0 >= LONG_MS) return { kind: "none" };
  return { kind: "tap", to: tapTarget(x, g, p.index) };
}

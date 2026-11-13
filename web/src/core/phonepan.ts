// Sliding between the phone's pages with the mouse in the Mac's phone canvas (V1.57, views/PhoneEditor.tsx). The developer, 13 Nov
// 2026: "make it so you can use your mouse to move left and right". The same feel as the Mac's Edit overview
// (core/overviewnav.ts, the developer's V1.56 asks): drag the dark room or a page beside sideways and the row follows, a flick
// carries on, a two finger swipe follows the fingers, the mouse wheel goes a page per notch, and resting the pointer
// near the left or right edge of the pages slides the row. A press that moves less than CLICK_SLOP is still a click
// (a page beside flies into the middle). Pure (tests/phonepan.test.ts).
import { CLICK_SLOP, FLICK_MS, edgePan, isClick, rubber } from "./overviewnav.ts";

export { CLICK_SLOP, isClick };

/** The row's numbers (px on screen): the page being edited is wc wide, the others ws, with gap between the middle one
 *  and its neighbours and gap2 between the others. */
export type Row = { wc: number; ws: number; gap: number; gap2: number };
/** Where page d places from the middle one sits (its centre, px from the middle). */
export function rowPos(d: number, r: Row): number {
  return d === 0 ? 0 : Math.sign(d) * (r.wc / 2 + r.gap + r.ws / 2 + (Math.abs(d) - 1) * (r.ws + r.gap2));
}
/** How far the row may slide (px, positive: towards the pages on the right): until the + New page card past either
 *  end is in the middle. ci: the page in the middle, n: how many pages. */
export function panBounds(ci: number, n: number, r: Row): { min: number; max: number } {
  return { min: rowPos(-ci - 1, r), max: rowPos(n - ci, r) };
}
/** The row slid by off px, past an end it gives like a rubber band (in px, one small page is the unit). */
export function panRubber(off: number, ci: number, n: number, r: Row): number {
  const b = panBounds(ci, n, r);
  return rubber(off, b.min, b.max, Math.max(1, r.ws));
}
/** The page nearest the middle with the row slid by off px. */
export function nearestPage(off: number, ci: number, n: number, r: Row): number {
  let best = ci, bd = Infinity;
  for (let j = 0; j < n; j++) { const d = Math.abs(rowPos(j - ci, r) - off); if (d < bd) { bd = d; best = j; } }
  return best;
}
/** Where a drag or a swipe lands: the speed (px per ms, positive: the row moving towards the right hand pages) carried
 *  on a little (a flick), then the nearest page. A flick always goes at least one page from where it started. */
export function pageAfterPan(off: number, v: number, ci: number, n: number, r: Row): number {
  const b = panBounds(ci, n, r);
  const ahead = Math.max(b.min, Math.min(b.max, off + v * FLICK_MS));
  let j = nearestPage(ahead, ci, n, r);
  const here = nearestPage(off, ci, n, r);
  if (j === here && Math.abs(v) > 0.5) j = Math.max(0, Math.min(n - 1, here + Math.sign(v)));
  return j;
}

// ---------- the wheel ----------
/** One mouse wheel notch (or this much of a vertical swipe) goes one page. */
export const WHEEL_STEP = 60;
/** At most one page per this many ms from the wheel, so a hard spin does not fly past every page. */
export const WHEEL_GAP = 170;
/** A vertical wheel: the pages to go (-1, 0 or 1) and what is left over. Down and right go to the right. */
export function wheelPages(acc: number, dy: number, sinceLast: number): { step: -1 | 0 | 1; acc: number } {
  const a = sinceLast > 400 ? dy : acc + dy;   // a new spin starts fresh
  if (Math.abs(a) < WHEEL_STEP || sinceLast < WHEEL_GAP) return { step: 0, acc: Math.max(-WHEEL_STEP * 2, Math.min(WHEEL_STEP * 2, a)) };
  return { step: a > 0 ? 1 : -1, acc: 0 };
}
/** Is this wheel a sideways swipe (follow it) rather than a vertical one (pages, or the page's own scroll)? */
export const sidewaysWheel = (dx: number, dy: number) => Math.abs(dx) >= Math.abs(dy) && dx !== 0;

// ---------- the edge ----------
/** The edge slide for a pointer at x, with the pages between left and right on screen (the side sheet is right of
 *  them): px per frame, below 0 towards the left hand pages. Never in the top row (the buttons live there). */
export function phoneEdge(x: number, y: number, left: number, right: number, top = 70): number {
  if (!(y > top)) return 0;
  return edgePan(x - left, right - left);
}

// ---------- what a press may pan from ----------
type Near = { closest(sel: string): unknown } | null;
/** The room, the pages beside, the + cards, and the empty parts of the page being edited. Never a panel, the navbar, a
 *  name, a button, a field, the side sheet, the gallery or the top bar. */
export function phonePansFrom(t: Near): boolean {
  if (!t) return false;
  if (t.closest(".pe-plus")) return true;   // a + card: a drag slides, a click still adds a page
  if (t.closest(".pe-tile, .pe-nav, .pe-pill, .pe-top, .pe-sheet, .pe-gal, .pe-del, .pe-undo, button, input, select, textarea, label, a[href], .lk-panel, .lk-ask-wrap")) return false;
  return !!t.closest(".pe-room");
}

// V1.58 smooth page swipe (the developer, 13 Nov 2026: "All your tabs and the buttons all around the display just follow you
// when you move to the other page and then suddenly disappear all at once ... I want you to smooth it all off").
// The numbers behind the page layer (views/pagelayer.ts, views/ListPager.tsx). No DOM here, so the tests can run it.
//
// The model: while a swipe moves, `at` is where the pages are, as a page number with a fraction (2.3 is three tenths
// of the way from page 2 to page 3). Everything that belongs to page i sits (i - at) pages to the side and fades with
// that distance; things on every page (the gear, Tab and Lock, the headline, Add task, the dots' row) never move.
import { settleIndex, springStart } from "./lists.ts";

/** A page's panels are fully gone this far into the move (0.62 of a page), so the two pages' panels never pile up. */
export const FADE_END = 0.62;
/** The wave: the panels on the side the pages move towards leave (and arrive) first, by up to this much of a page. */
export const STAGGER = 0.1;
/** A list page beside the one showing is dimmed by this much at a full page away (it brightens as it comes in). */
export const PAGE_DIM = 0.45;
/** Reduce Motion: nothing slides. The fingers only dim the page a little (at most this much), then a quick fade. */
export const REDUCED_DIM = 0.4;
export const REDUCED_OUT_MS = 110;
export const REDUCED_IN_MS = 160;
/** The list's name under the headline slides this far as it fades and changes at half way. */
export const STRIP_SLIDE = 18;

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
/** 0 below a, 1 above b, a soft S between (smoothstep). */
export function smooth(a: number, b: number, x: number): number {
  if (b <= a) return x < a ? 0 : 1;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
/** Where the pages are, as a page number: `from` the page the swipe started on, x the strip's move in px (positive:
 *  the pages moved right, so an earlier page comes in), span one page's width. */
export const pageAt = (from: number, x: number, span: number) => (span > 0 ? from - x / span : from);
/** How far page i's own things sit to the side (px): exactly where its list is, so they move as one layer with it. */
export const layerX = (i: number, at: number, span: number) => (i - at) * span;
/** A panel of a page `d` pages away: 1 on its own page, gone by FADE_END (+ its lag). */
export const panelFade = (d: number, lag = 0) => 1 - smooth(lag, FADE_END + lag, Math.abs(d));
/** A list page `d` pages away. */
export const pageFade = (d: number) => 1 - PAGE_DIM * smooth(0, 1, Math.abs(d));
/** The page nearest to `at`, clamped to the pages there are. */
export const nearIndex = (at: number, count: number) => Math.max(0, Math.min(count - 1, Math.round(at)));
/** The list's name: full on a page, gone at half way, where it changes to the next page's name. */
export const stripFade = (at: number) => clamp01(1 - 2 * Math.abs(at - Math.round(at)));
/** Its small slide (px), the way the pages go. */
export const stripX = (at: number) => (Math.round(at) - at) * STRIP_SLIDE * 2 + 0;   // + 0: never -0
/** The wave's lag for a panel whose middle is at cx on a screen `width` wide. towardNext: the pages move left (the
 *  next page comes in from the right), so the left side leads; else the right side leads. 0 to STAGGER. */
export function lagFor(cx: number, width: number, towardNext: boolean): number {
  if (!(width > 0)) return 0;
  const f = clamp01(cx / width);
  return STAGGER * (towardNext ? f : 1 - f);
}
/** One thing that belongs to page i, while the pages are at `at`: its sideways move (px) and its opacity (0 to 1).
 *  reduced (Reduce Motion): it never moves; the page the swipe started on dims a little, the others stay hidden. */
export function partFrame(i: number, at: number, from: number, span: number, reduced: boolean, lag = 0): { x: number; o: number } {
  if (reduced) return { x: 0, o: i === from ? reducedFade(at, from) : 0 };
  return { x: layerX(i, at, span), o: panelFade(i - at, lag) };
}
/** Reduce Motion while the fingers move: the page dims a little with the move, never more than REDUCED_DIM. */
export const reducedFade = (at: number, from: number) => 1 - REDUCED_DIM * Math.min(1, Math.abs(at - from));

/** What happens when the fingers lift. to: the page it lands on (past a third of the width or a quick flick goes one
 *  page, else it snaps back to `from`). spring: the pages glide there with the finger's speed (v0, px per s, capped);
 *  fade (Reduce Motion): a quick cross fade instead. x the move so far (px), v the fingers' speed (px per ms). */
export type Release = { to: number; how: "spring" | "fade"; v0: number };
export function releasePlan(from: number, count: number, x: number, v: number, span: number, reduced: boolean): Release {
  const to = settleIndex(from, count, x, v, span);
  if (reduced) return { to, how: "fade", v0: 0 };
  return { to, how: "spring", v0: springStart(v, -(to - from) * span - x) };
}

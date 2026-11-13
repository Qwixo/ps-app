// Island clearance (V1.53, the developer 12 Nov 2026: "the dynamic island is STILL over the top two buttons despite me requesting
// the 2 buttons do an animation to move to the left and the right when the dynamic island is there ... nothing is over
// anything"). The Mac's Dynamic Island (ps-mac Island.swift) is a window of its own, above the Tab list, and the list's
// glass bar sits at the top centre right under it. The Mac app tells the list where the island's shape is right now
// (main.swift pushIsland: collapsed, open, the hover view, Slim, Halo, Drop, the pill, moved anywhere, hidden), and this
// works out where Keep overlay and Hover mode go so neither touches it. Pure: plain numbers, no page and no window, so
// tests/islandclear.test.ts checks every case.
//
// The rule, in order:
//  1. Nothing near the island: everything stays where it is.
//  2. Keep overlay slides left of the island and Hover mode right of it (what the developer asked for), when both fit there.
//  3. Not enough room on one side (the top right buttons, the Edit button, the screen's edge): both slide together to
//     the side that has room, Keep overlay first, so they still never cross.
//  4. Still no room (a very small screen with the island open wide): a button that cannot fit anywhere fades out
//     while the island is over its place, and fades back when the island goes.
// The transparency slider below the buttons fades out the same way while the island's open view reaches over it (the
// island only gets that tall while it is open: news for a few seconds, or the pointer resting on it).

export interface Box { left: number; top: number; right: number; bottom: number }
export interface ClearIn {
  /** The island's shape in page pixels, or null when it is not on this screen. */
  island: Box | null;
  /** Keep overlay and Hover mode where they sit without any move. */
  keep: Box;
  hover: Box;
  /** The transparency slider's bar. */
  slider: Box | null;
  /** Everything else on the top row the buttons may never slide onto (the top right buttons, the Edit button...). */
  blocks: Box[];
  /** The page's width. */
  vw: number;
}
export type ClearLayout = "none" | "split" | "left" | "right" | "partial";
export interface ClearOut { keepDx: number; hoverDx: number; keepHide: boolean; hoverHide: boolean; sliderHide: boolean; layout: ClearLayout }

/** Room between the island and a button (the island's open spring overshoots a few points, this covers it). */
export const ISLAND_GAP = 14;
/** Room to anything else on the row, and to the screen's edges. */
export const BLOCK_GAP = 8, EDGE_GAP = 12;
/** Up and down, a button only counts as under the island when they really overlap (Slim and Halo end in the menu bar,
 *  a clear 12 points above the buttons: nothing moves for them). */
const V_PAD = 2;

export const NO_CLEAR: ClearOut = { keepDx: 0, hoverDx: 0, keepHide: false, hoverHide: false, sliderHide: false, layout: "none" };

const ok = (b: Box | null | undefined): b is Box => !!b && [b.left, b.top, b.right, b.bottom].every(Number.isFinite) && b.right > b.left && b.bottom > b.top;
const shift = (b: Box, dx: number): Box => ({ left: b.left + dx, top: b.top, right: b.right + dx, bottom: b.bottom });
/** a and b overlap, or come closer than `h` side to side or `v` up and down. */
export function near(a: Box, b: Box, h: number, v = V_PAD): boolean {
  return a.left < b.right + h && a.right > b.left - h && a.top < b.bottom + v && a.bottom > b.top - v;
}

export function islandClear(i: ClearIn): ClearOut {
  const isl = i.island;
  if (!ok(isl) || !ok(i.keep) || !ok(i.hover) || !(i.vw > 0)) return NO_CLEAR;
  const blocks = i.blocks.filter(ok);
  const sliderHide = ok(i.slider) && near(i.slider, isl, 0);
  const hitK = near(i.keep, isl, ISLAND_GAP), hitH = near(i.hover, isl, ISLAND_GAP);
  if (!hitK && !hitH) return sliderHide ? { ...NO_CLEAR, sliderHide } : NO_CLEAR;
  // A spot is free when it is on the screen, clear of the island and clear of everything else on the row.
  const free = (b: Box) => b.left >= EDGE_GAP && b.right <= i.vw - EDGE_GAP && !near(b, isl, ISLAND_GAP - 0.5)
    && !blocks.some((x) => near(b, x, BLOCK_GAP - 0.5, 0));
  const round = (n: number) => Math.round(n) || 0;   // never -0
  // 2. Keep overlay to the left of the island, Hover mode to the right (a button already clear stays put).
  const kL = hitK ? Math.min(0, isl.left - ISLAND_GAP - i.keep.right) : 0, hR = hitH ? Math.max(0, isl.right + ISLAND_GAP - i.hover.left) : 0;
  if (free(shift(i.keep, kL)) && free(shift(i.hover, hR))) return { keepDx: round(kL), hoverDx: round(hR), keepHide: false, hoverHide: false, sliderHide, layout: "split" };
  // 3. Both together, to the left of the island, then to the right of it.
  const bothL = Math.min(0, isl.left - ISLAND_GAP - Math.max(i.keep.right, i.hover.right));
  if (free(shift(i.keep, bothL)) && free(shift(i.hover, bothL))) return { keepDx: round(bothL), hoverDx: round(bothL), keepHide: false, hoverHide: false, sliderHide, layout: "left" };
  const bothR = Math.max(0, isl.right + ISLAND_GAP - Math.min(i.keep.left, i.hover.left));
  if (free(shift(i.keep, bothR)) && free(shift(i.hover, bothR))) return { keepDx: round(bothR), hoverDx: round(bothR), keepHide: false, hoverHide: false, sliderHide, layout: "right" };
  // 4. Each on its own side if it fits there, else it fades while the island is over its place.
  const kOk = free(shift(i.keep, kL)), hOk = free(shift(i.hover, hR));
  return {
    keepDx: kOk ? round(kL) : 0, hoverDx: hOk ? round(hR) : 0,
    keepHide: !kOk && hitK, hoverHide: !hOk && hitH, sliderHide, layout: "partial",
  };
}

// ---------- pop-ups at the top centre (the update card, V1.53 sweep) ----------
/** Where a card `span` wide at the top centre goes so it covers nothing of the top bar or the island: `gap` below the
 *  lowest piece it would otherwise sit on, and never above `min`. Pieces beside it (no overlap side to side) do not
 *  count. Found by the V1.53 sweep: the update card sat at the very top, under the island and over Keep overlay,
 *  Hover mode, the slider and the first top right button. */
export function topClear(span: { left: number; right: number }, pieces: (Box | null)[], min: number, gap = 12): number {
  let y = min;
  for (const p of pieces) {
    if (!ok(p) || p.right <= span.left || p.left >= span.right) continue;
    y = Math.max(y, p.bottom + gap);
  }
  return Math.round(y);
}

/** V1.55 small screens (the developer, 12 Nov 2026: a friend's 13 inch MacBook Air M1, no notch: "his task list, where you can
 *  add a task, is at the very bottom of the screen. You can't even see it"). The pop-ups in the middle of the list (Add
 *  task, New tasks) and the update card open below the island so it is never over them. That only makes sense while
 *  the island is up top: dragged down (Island.swift, G Squad: anywhere on the screen, a no notch Mac's bottom right
 *  corner) "below the island" is the screen's bottom edge, and the Add task window opened off the screen. Now the
 *  island only counts while its top is in the top part of the page (above TOP_PART of its height); anywhere lower,
 *  the pop-ups keep their usual place. */
export const TOP_PART = 0.4;
export function topIsland(island: Box | null, pageH: number): Box | null {
  if (!ok(island) || !(pageH > 0)) return null;
  return island.top < pageH * TOP_PART ? island : null;
}

// ---------- what the Mac app sends (main.swift pushIsland) ----------
/** The island's shape in points from the Tab list window's top left, and that window's size in points. */
export interface IslandSpot { x: number; y: number; w: number; h: number; vw: number; vh: number }

/** Only a well formed spot; anything else is "no island here". */
export function cleanSpot(v: unknown): IslandSpot | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? o[k] as number : NaN);
  const s = { x: n("x"), y: n("y"), w: n("w"), h: n("h"), vw: n("vw"), vh: n("vh") };
  if (Object.values(s).some((x) => Number.isNaN(x))) return null;
  if (!(s.w > 0 && s.h > 0 && s.vw > 0 && s.vh > 0)) return null;
  return s;
}

/** The spot in page pixels: the page may be zoomed to fit a small screen (ScreenFit.swift), so points are scaled by
 *  the page's width over the window's. */
export function spotBox(s: IslandSpot | null, pageW: number): Box | null {
  if (!s || !(pageW > 0)) return null;
  const k = pageW / s.vw;
  return { left: s.x * k, top: s.y * k, right: (s.x + s.w) * k, bottom: (s.y + s.h) * k };
}

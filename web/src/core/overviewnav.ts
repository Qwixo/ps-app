// Moving around the Edit overview (views/EditMode.tsx), V1.56. The developer, 13 Nov 2026: "if you click anywhere on a page ...
// then a fancy animation brings you back into the page ... if you click anywhere on the area which is black right now,
// I want it to bring you back to the page that you were just active on ... use my mouse in the edit panel to like
// slide across and move to different screens ... move my mouse to the very left or the very right ... it should like
// also move the screen". The pure rules live here so they can be tested; the drawing is in EditMode.tsx.
import { MAIN_PAGE } from "./tablayout.ts";
import type { Box } from "./islandclear";

/** A press that moves less than this (screen pixels) is a click; more is a drag (it pans, it never clicks). */
export const CLICK_SLOP = 6;
export function isClick(dx: number, dy: number): boolean { return Math.hypot(dx, dy) < CLICK_SLOP; }

// ---------- the edge scroll: the same zone and the same curve as the to-do list's bottom edge (TaskMap.tsx) ----------
/** How close to the edge (px) the pointer starts the scroll. */
export const EDGE_ZONE = 110;
/** Pixels per frame (60 a second) right at the edge. */
export const EDGE_MAX = 16;
/** Speed at this distance from the edge: nothing outside the zone, then faster the closer (a gentle square curve). */
export function edgeRamp(d: number, zone = EDGE_ZONE, max = EDGE_MAX): number {
  if (!(d < zone)) return 0;
  const k = (zone - Math.max(0, d)) / zone;
  return k * k * max;
}
/** The overview's sideways edge scroll for a pointer at x on a screen vw wide: below 0 slides towards the pages on the
 *  left, above 0 towards the right, 0 in between (and when the pointer is not over the screen at all). */
export function edgePan(x: number, vw: number): number {
  if (!Number.isFinite(x) || x < 0 || x > vw || vw <= 2 * EDGE_ZONE) return 0;
  if (x < EDGE_ZONE) return -edgeRamp(x);
  if (vw - x < EDGE_ZONE) return edgeRamp(vw - x);
  return 0;
}

// ---------- what a click picks ----------
/** What was clicked: a page's card (or the live page itself), the room around the pages, or a control of its own
 *  (a panel, a button, a field, the bar, a name pill, a + card, the gallery). */
export type Hit = { kind: "page"; id: string } | { kind: "room" } | { kind: "control" };
/** The page a click zooms into, or null (a control keeps its own click). A page is that page; the room goes back to the
 *  page that was showing when Edit opened (the main page if that one was deleted meanwhile). */
export function clickPick(hit: Hit, start: string, ids: readonly string[]): string | null {
  if (hit.kind === "control") return null;
  if (hit.kind === "page") return ids.includes(hit.id) ? hit.id : null;
  return ids.includes(start) ? start : ids.includes(MAIN_PAGE) ? MAIN_PAGE : ids[0] ?? null;
}
/** Anything with closest(): a DOM element, or a stand in for the tests. */
type Near = { closest(sel: string): unknown } | null;
/** Things inside the live page that keep their own click (a click on anything else there is a click on the page). */
export const OWN_CLICK = "button, a[href], input, textarea, select, label, [contenteditable='true'], [role='button'], [role='menu'], [role='menuitem'], [role='slider'], [role='switch'], [role='checkbox'], .tm-editor, .tm-ctx, .tl-menu, .tl-card, .trm-pop, .ed-box";
/** Sort a click target into a Hit. `page` is the page showing in the middle (the live list). */
export function hitOf(t: Near, page: string): Hit {
  if (!t) return { kind: "room" };
  // The overview's own controls, over everything.
  if (t.closest(".ov-top, .ov-pill, .ov-plus, .ov-cal, .ov-card-add, .ov-ghost")) return { kind: "control" };
  const card = t.closest("[data-ov-page]") as { dataset?: { ovPage?: string } } | null;
  if (card) return card.dataset?.ovPage ? { kind: "page", id: card.dataset.ovPage } : { kind: "control" };
  if (t.closest(".tm-overlay.ed-able")) return t.closest(OWN_CLICK) ? { kind: "control" } : { kind: "page", id: page };
  if (t.closest(".ov-room")) return { kind: "room" };
  return { kind: "control" };   // anything else on the screen (another pop-up) is left alone
}
/** Surfaces a press may pan from: the room, the pages beside, the + cards, and the empty part of the page in the middle
 *  (its edit layer). Never a panel's outline or handles (they drag the panel), the bar, a pill or the gallery. */
export function pansFrom(t: Near): boolean {
  if (!t) return false;
  if (t.closest(".ov-top, .ov-pill, .ov-cal, .ov-card-add, .ed-box")) return false;
  if (t.closest(".tm-overlay")) return !!t.closest(".ed-layer");
  return !!t.closest(".ov-room");
}

// ---------- the camera ----------
// The camera sits at a page index (a fraction while it moves): 2 means the third page is in the middle. It may go half
// a page past each end, so the + cards come well into view, then it gives like a rubber band.
export const REACH = 0.5;
export function camBounds(n: number): { min: number; max: number } {
  return n > 1 ? { min: -REACH, max: n - 1 + REACH } : { min: 0, max: 0 };
}
/** The iOS rubber band: past an end the camera moves less and less (dim: how far is one page). */
export function rubber(x: number, min: number, max: number, dim = 1): number {
  const band = (over: number) => (1 - 1 / (over * 0.55 / dim + 1)) * dim;
  if (x < min) return min - band(min - x);
  if (x > max) return max + band(x - max);
  return x;
}
export const clampCam = (x: number, n: number) => { const b = camBounds(n); return Math.max(b.min, Math.min(b.max, x)); };
/** Where a flick lands: the speed (pages per ms) carried on with friction, inside the ends. */
export const FLICK_MS = 260;
export function flickTo(cam: number, v: number, n: number): number { return clampCam(cam + v * FLICK_MS, n); }
/** How long the glide to a page takes: a little longer the further it goes, never slow. */
export function glideMs(dist: number): number { return Math.round(Math.max(360, Math.min(760, 360 + 120 * Math.abs(dist)))); }
/** Ease in and out (a smooth start and a soft landing). */
export function easeInOut(t: number): number { const x = Math.max(0, Math.min(1, t)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
/** One frame of following a target: an exponential ease that does not depend on the frame rate. */
export function follow(cur: number, target: number, dtMs: number, tau = 90): number {
  return target + (cur - target) * Math.exp(-Math.max(0, dtMs) / tau);
}
/** The camera's offset (camera minus the page showing, in pages) after the page showing changed: the pages that were
 *  on screen stay exactly where they were, so nothing jumps (then the camera glides to the new page). It holds on to a
 *  page that is in both orders: the one that was showing, else the new one. With neither (everything changed): 0. */
export function keepInPlace(off: number, prevIds: readonly string[], prevCur: string, nextIds: readonly string[], nextCur: string): number {
  const next = nextIds.indexOf(nextCur);
  if (next < 0) return 0;
  for (const anchor of [prevCur, nextCur]) {
    const a = prevIds.indexOf(anchor), b = nextIds.indexOf(anchor);
    if (a < 0 || b < 0) continue;
    const camWas = prevIds.indexOf(prevCur) + off;       // the camera, as a place in the old order
    if (!Number.isFinite(camWas) || prevIds.indexOf(prevCur) < 0) return 0;
    return b + (camWas - a) - next;
  }
  return 0;
}

// ---------- nothing over anything: the bar and the hint keep clear of the Dynamic Island ----------
export interface Spot { left: number; top: number }
const hits = (a: Box, b: Box, gap: number) => a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
/** Where the bar (Done, Add panel, Reset) goes: top middle, unless the island is there; then the top left corner (where
 *  the Edit button was), then the top right, then under the island in the middle. */
export function barSpot(island: Box | null, vw: number, bw: number, bh: number, top = 16, side = 24, gap = 12, avoid: Box[] = []): Spot {
  const at = (left: number, t = top): Box => ({ left, top: t, right: left + bw, bottom: t + bh });
  // V1.56: other buttons that own a corner (the phone button, top left, views/PhoneEditor.tsx): the bar slides along
  // the top past them (right of one on the left, left of one on the right) rather than sitting on them.
  const past = (b: Box, dir: 1 | -1): Box => {
    let x = b;
    for (const a of [...avoid].sort((p, q) => dir * (p.left - q.left))) if (hits(x, a, gap)) x = at(dir > 0 ? a.right + gap : a.left - gap - bw, x.top);
    return x;
  };
  const free = (b: Box) => b.left >= 0 && b.right <= vw && (!island || !hits(b, island, gap)) && !avoid.some((a) => hits(b, a, gap));
  const tries = [at((vw - bw) / 2), past(at(side), 1), past(at(vw - side - bw), -1)];
  for (const b of tries) if (free(b)) return { left: b.left, top: b.top };
  if (!island) return { left: (vw - bw) / 2, top: Math.max(top, ...avoid.map((a) => a.bottom + gap)) };
  return { left: (vw - bw) / 2, top: island.bottom + gap };
}
/** The hint along the bottom: bottom middle, or just above the island when the island was moved down there. */
export function hintSpot(island: Box | null, vw: number, vh: number, hw: number, hh: number, bottom = 16, gap = 10): Spot {
  const b: Box = { left: (vw - hw) / 2, top: vh - bottom - hh, right: (vw + hw) / 2, bottom: vh - bottom };
  if (!island || !hits(b, island, gap)) return { left: b.left, top: b.top };
  return { left: b.left, top: Math.max(0, island.top - gap - hh) };
}

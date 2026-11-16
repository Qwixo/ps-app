// The element side of smooth dragging (core/tiledrag.ts): carry a panel by a transform, glide it home on let go.
// Nothing here goes through React, and nothing is a CSS variable on the carried element for a move (that would restyle
// the whole panel inside it on every frame).
import { moveTransform, navTransform, settleVars, tileVars, type DragMode } from "../core/tiledrag";
import type { Tile } from "../core/phonelayout";

const SIZE_VARS = ["--dw", "--dh"];
const clear = (el: HTMLElement) => { el.style.removeProperty("transform"); for (const k of SIZE_VARS) el.style.removeProperty(k); };

/** The panel being carried inside a root element (null when it is not drawn). */
export const carriedEl = (root: ParentNode | null, id: string): HTMLElement | null =>
  root?.querySelector<HTMLElement>(`.pe-tile[data-tid="${id.replace(/["\\]/g, "")}"]`) ?? null;

/** One frame of a drag: no React, one element. A move is a transform, a size is added width and height. */
export function carry(el: HTMLElement | null, t: Tile, mode: DragMode, dx: number, dy: number, W: number) {
  if (!el) return;
  if (mode === "move") { el.style.transform = moveTransform(dx, dy); return; }
  const v = tileVars(t, mode, dx, dy, W);
  el.style.setProperty("--dw", v["--dw"]); el.style.setProperty("--dh", v["--dh"]);
}

/** Let go: start from where it was carried to, then (two frames later, once React has put it at its new place) let the
 *  CSS bring it to 0 so it glides into its place. */
export function settle(el: HTMLElement | null, t: Tile, mode: DragMode, dx: number, dy: number, landed: Tile, W: number) {
  if (!el) return;
  const v = settleVars(t, mode, dx, dy, landed, W);
  if (mode === "move") el.style.transform = moveTransform(parseFloat(v["--dx"]), parseFloat(v["--dy"]));
  else { el.style.setProperty("--dw", v["--dw"]); el.style.setProperty("--dh", v["--dh"]); }
  requestAnimationFrame(() => requestAnimationFrame(() => clear(el)));
}

/** Let go with nothing to land (it left for another page, or was only tapped): drop what carried it. */
export function release(el: HTMLElement | null) { if (el) clear(el); }

/** The navbar (or one of its buttons) being carried: one frame, a transform on one element. */
export function carryNav(root: ParentNode | null, d: { kind: "bar"; dx: number; dy: number } | { kind: "item"; id: string; dx: number }) {
  const el = d.kind === "bar" ? root?.querySelector<HTMLElement>(".pe-nav") : root?.querySelector<HTMLElement>(`.pe-nav-i[data-nid="${d.id.replace(/["\\]/g, "")}"]`);
  if (el) el.style.transform = navTransform(d);
}
export function releaseNav(root: ParentNode | null) {
  root?.querySelectorAll<HTMLElement>(".pe-nav, .pe-nav-i").forEach((el) => el.style.removeProperty("transform"));
}

// Smooth dragging in the phone editors (V1.65). The developer's friend, 17 Nov 2026: "the mobile version is quite laggy
// with the way you can edit it." The old way wrote React state on every pointer move, so the whole page drew again on
// every move. Now: the pointer is read at most once per frame (frameQueue), the carried panel is moved by CSS variables
// on its own element (a transform, no layout), and React hears only when something DISCRETE changes (the cell the panel
// would land on, the page it is over). Pure logic here, the element work is in views/tiledrive.ts.
import { cellAt, cellBox, cellsFor, COLS, type Tile } from "./phonelayout.ts";

export type DragMode = "move" | "size";
export const DRAG_MIN = 30;   // a panel never sizes smaller than this many px while dragged

/** Pointer travel to the page's own pixels (the page is drawn scaled by k; pan: how far the row slid since the drag began). */
export function dragDelta(sx: number, sy: number, x: number, y: number, k: number, pan = 0): { dx: number; dy: number } {
  const s = k > 0 ? k : 1;
  return { dx: (x - sx + pan) / s, dy: (y - sy) / s };
}

/** Where a panel would land (move) or what size it would get (size), as a tile. */
export function ghostFor(t: Tile, mode: DragMode, dx: number, dy: number, W: number): Tile {
  const b = cellBox(t, W);
  if (mode === "move") return { ...t, ...cellAt(b.left + dx, b.top + dy, W, t.w, t.h) };
  const sz = cellsFor(b.width + dx, b.height + dy, W);
  return { ...t, ...sz, c: Math.min(t.c, COLS - sz.w) };
}

/** Changes only when something worth drawing changes: the landing cell or size, the page hovered, going out. */
export function dragSig(t: Tile, mode: DragMode, dx: number, dy: number, W: number, over: string | null, out = false): string {
  const g = ghostFor(t, mode, dx, dy, W);
  return `${g.c}.${g.r}.${g.w}.${g.h}|${over ?? ""}|${out ? 1 : 0}`;
}

/** The CSS variables that carry a panel: a move is a translate, a size is added width and height. */
export function tileVars(t: Tile, mode: DragMode, dx: number, dy: number, W: number): Record<"--dx" | "--dy" | "--dw" | "--dh", string> {
  if (mode === "move") return { "--dx": `${dx}px`, "--dy": `${dy}px`, "--dw": "0px", "--dh": "0px" };
  const b = cellBox(t, W);
  return { "--dx": "0px", "--dy": "0px", "--dw": `${Math.max(DRAG_MIN, b.width + dx) - b.width}px`, "--dh": `${Math.max(DRAG_MIN, b.height + dy) - b.height}px` };
}

/** On let go the panel sits at its new place at once, so the variables start from the distance between where it was
 *  carried to and where it lands, then go to 0 (it glides in, never jumps). */
export function settleVars(t: Tile, mode: DragMode, dx: number, dy: number, landed: Tile, W: number): Record<"--dx" | "--dy" | "--dw" | "--dh", string> {
  const from = cellBox(t, W), to = cellBox(landed, W);
  if (mode === "move") return { "--dx": `${from.left + dx - to.left}px`, "--dy": `${from.top + dy - to.top}px`, "--dw": "0px", "--dh": "0px" };
  const w = Math.max(DRAG_MIN, from.width + dx), h = Math.max(DRAG_MIN, from.height + dy);
  return { "--dx": "0px", "--dy": "0px", "--dw": `${w - to.width}px`, "--dh": `${h - to.height}px` };
}

/** True when the pointer is outside a rectangle (so the page under it must be looked up; inside it, it is this page). */
export function outsideBox(x: number, y: number, r: { left: number; top: number; right: number; bottom: number } | null): boolean {
  return !r || x < r.left || x > r.right || y < r.top || y > r.bottom;
}

/** One callback per frame: push as often as you like, only the newest runs, on the next frame. */
export type FrameQueue = { push: (run: () => void) => void; flush: () => void; cancel: () => void; pending: () => boolean };
export function frameQueue(
  raf: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
  caf: (id: number) => void = (id) => cancelAnimationFrame(id),
): FrameQueue {
  let id = 0, job: (() => void) | null = null;
  const run = () => { id = 0; const j = job; job = null; j?.(); };
  return {
    push(j) { job = j; if (!id) id = raf(run); },
    flush() { if (id) { caf(id); id = 0; } const j = job; job = null; j?.(); },
    cancel() { if (id) { caf(id); id = 0; } job = null; },
    pending: () => !!job,
  };
}

/** The transform that carries the navbar (the bar leans a little toward the finger) or one of its buttons. */
export function navTransform(d: { kind: "bar"; dx: number; dy: number } | { kind: "item"; dx: number }): string {
  return d.kind === "bar" ? `translate3d(${d.dx * 0.15}px, ${d.dy * 0.15}px, 0)` : `translate3d(${d.dx}px, 0, 0)`;
}

/** A move is a transform written straight onto the element (a CSS variable would restyle everything inside the panel
 *  on every frame); only a size uses the variables, because the width and height are laid out by the cell sizes. */
export const moveTransform = (dx: number, dy: number): string => `translate3d(${dx}px, ${dy}px, 0)`;

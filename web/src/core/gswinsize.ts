// G Squad v3 (PS 1.65): the G Squad window is a window you can resize, and it remembers its size on this device only.
export interface WinSize { w: number; h: number }
export const MIN_WIN: WinSize = { w: 640, h: 480 };
export const DEFAULT_WIN: WinSize = { w: 1040, h: 700 };
export const WIN_KEY = "gsquad.winsize";
const edge = 16;

/** Keeps a size on screen: at least the minimum (when the screen allows) and at most the screen minus a small edge. */
export function clampWin(s: WinSize, vw: number, vh: number): WinSize {
  const maxW = Math.max(320, vw - edge * 2), maxH = Math.max(320, vh - edge * 2);
  const w = Number.isFinite(s.w) ? s.w : DEFAULT_WIN.w, h = Number.isFinite(s.h) ? s.h : DEFAULT_WIN.h;
  return { w: Math.round(Math.min(maxW, Math.max(Math.min(MIN_WIN.w, maxW), w))), h: Math.round(Math.min(maxH, Math.max(Math.min(MIN_WIN.h, maxH), h))) };
}
export function readWin(store: Pick<Storage, "getItem"> | null): WinSize {
  try { const o = JSON.parse(store?.getItem(WIN_KEY) ?? "null"); if (o && typeof o.w === "number" && typeof o.h === "number") return { w: o.w, h: o.h }; } catch { /* unreadable: the default */ }
  return { ...DEFAULT_WIN };
}
export function saveWin(s: WinSize, store: Pick<Storage, "setItem"> | null) { try { store?.setItem(WIN_KEY, JSON.stringify({ w: Math.round(s.w), h: Math.round(s.h) })); } catch { /* storage off */ } }
/** Dragging an edge: which sides move. The window stays centred, so a drag changes the size by twice the pull. */
export function dragWin(start: WinSize, dx: number, dy: number, dir: { x: -1 | 0 | 1; y: -1 | 0 | 1 }, vw: number, vh: number): WinSize {
  return clampWin({ w: start.w + dir.x * dx * 2, h: start.h + dir.y * dy * 2 }, vw, vh);
}
/** The window is a floating one on a wide screen; on a phone or a narrow screen it fills the screen. */
export const floats = (narrow: boolean, phone: boolean): boolean => !narrow && !phone;

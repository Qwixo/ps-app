// Screen fit (V1.40, G Squad): the floating Tab list fits any screen and any macOS display scaling.
//
// PS (ps-mac Sources/ScreenFit.swift) reads the screen the list opens on (its size in points, the room the
// menu bar or notch and the Dock take, its backing scale) and picks a page zoom: 1 on a screen of at least
// 1440 x 860 points (the developer's MacBook and anything bigger), smaller on a smaller screen or a "Larger text"
// scaling, never under 0.8. It sets that zoom on the web view itself (WKWebView.pageZoom, so clicks, hover
// and every measurement stay right) and tells the page with window.__psScreen(info).
//
// Past the zoom the page's own fluid rules take over (taskmap.css "screen fit"): side columns that narrow,
// pop-ups kept on screen (ui/popfit.ts), and the glass bar placed where it never covers the top right
// buttons (glassPlace below). The website and the phone never get __psScreen and keep their own layout.
// V1.47: PS also says how big macOS draws the screen against the panel's own pixels (native, ui) and whether
// Accessibility Zoom is on (ax). A "Larger text" display is what a friend's Mac had: the zoom above already fits
// the page to it; the analogue clocks were the part that broke (core/clockface.ts).

export interface PsScreen {
  /** The screen in points, as macOS lays it out (System Settings, Displays, "looks like"). */
  w: number; h: number;
  /** Device pixels per point (2 on a Retina screen). */
  scale: number;
  /** The page zoom PS set: CSS pixels are points divided by this. */
  zoom: number;
  /** Points the menu bar (or notch) and the Dock take at each edge of the screen. */
  top: number; bottom: number; left: number; right: number;
  /** V1.47: the display's own panel width in pixels, when PS could read it (0 when not, or an older PS). */
  native: number;
  /** V1.47: how much bigger than the panel's own pixels macOS draws everything ("Larger text" in Displays):
   *  1 at the panel's own size or unknown, 1.25 for a 2880 px panel shown as 1152 x 720 at 2x. */
  ui: number;
  /** V1.47: Accessibility, Zoom is magnifying the screen (it magnifies PS too; PS does not undo it). */
  ax: boolean;
}

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** What PS sent, checked: anything missing or silly falls back to a plain 1440 x 900 screen at zoom 1. */
export function cleanScreen(v: unknown): PsScreen | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.w !== "number" || typeof o.h !== "number" || !(o.w > 0) || !(o.h > 0)) return null;
  return {
    w: num(o.w, 200, 20000, 1440), h: num(o.h, 200, 20000, 900), scale: num(o.scale, 1, 4, 2), zoom: num(o.zoom, 0.5, 2, 1),
    top: num(o.top, 0, 200, 0), bottom: num(o.bottom, 0, 400, 0), left: num(o.left, 0, 400, 0), right: num(o.right, 0, 400, 0),
    native: num(o.native, 0, 40000, 0), ui: num(o.ui, 0.5, 4, 1), ax: o.ax === 1 || o.ax === true,
  };
}

/** The same rule as ScreenFit.swift zoom(w:h:), here so the tests can hold both to it. */
export const FIT_REF = { w: 1440, h: 860, floor: 0.8 };
export function fitZoom(w: number, h: number): number {
  if (!(w >= 200) || !(h >= 200)) return 1;
  return Math.round(Math.max(FIT_REF.floor, Math.min(1, w / FIT_REF.w, h / FIT_REF.h)) * 1000) / 1000;
}

/** CSS custom properties for a screen: the page reads them, nothing else changes. */
export function screenVars(s: PsScreen): Record<string, string> {
  const z = s.zoom || 1;
  const px = (pt: number) => `${Math.round((pt / z) * 100) / 100}px`;
  return { "--scr-zoom": String(z), "--scr-scale": String(s.scale), "--scr-ui": String(s.ui), "--safe-top": px(Math.floor(s.top)), "--safe-bottom": px(s.bottom) };
}

let current: PsScreen | null = null;
/** The last screen PS described (null on the website, the phone, or an older PS). */
export function psScreen(): PsScreen | null { return current; }

export function applyScreen(v: unknown, root: HTMLElement = document.documentElement): PsScreen | null {
  const s = cleanScreen(v);
  if (!s) return null;
  current = s;
  for (const [k, val] of Object.entries(screenVars(s))) root.style.setProperty(k, val);
  root.dataset.scrFit = s.zoom < 1 ? "shrunk" : "full";
  // V1.47: "larger" when macOS draws the whole screen bigger than its panel (a "Larger text" display), so a
  // stylesheet or a bug report can tell; "ax" while Accessibility Zoom magnifies the screen.
  root.dataset.scrUi = s.ui > 1.04 ? "larger" : s.ui < 0.96 ? "smaller" : "default";
  if (s.ax) root.dataset.scrAx = "1"; else delete root.dataset.scrAx;
  window.dispatchEvent(new Event("ps-screen"));
  return s;
}

// ---------- the glass bar (Keep overlay, Hover mode and the slider) ----------

export interface GlassMeasure {
  /** Page width (CSS pixels). */
  vw: number;
  /** The glass bar's own width and height. */
  gw: number; gh: number;
  /** Left edge and bottom of the top right buttons (Tab, Lock, the gear...). */
  trLeft: number; trBottom: number;
  /** Right edge of whatever sits top left (the clock pill). */
  leftRight: number;
  /** The list column between the side columns. */
  listL: number; listR: number;
  /** Its usual top. */
  top: number;
}
export interface GlassSpot { cx: number; top: number; spot: "middle" | "free" | "below" }

/** Where the glass bar goes: the middle of the screen as always when that clears the clock pill and the top
 *  right buttons; else the middle of the free room between them; else just under the top right buttons, over
 *  the middle of the list. It never covers a button and never leaves the screen. */
export function glassPlace(m: GlassMeasure, gap = 12): GlassSpot {
  const half = m.gw / 2;
  const mid = m.vw / 2;
  if (mid - half >= m.leftRight + gap && mid + half <= m.trLeft - gap) return { cx: mid, top: m.top, spot: "middle" };
  const from = m.leftRight + gap, to = m.trLeft - gap;
  if (to - from >= m.gw) return { cx: Math.round(from + (to - from) / 2), top: m.top, spot: "free" };
  const lo = half + 8, hi = Math.max(lo, m.vw - half - 8);
  const cx = Math.round(Math.min(hi, Math.max(lo, (m.listL + m.listR) / 2)));
  return { cx, top: Math.round(Math.max(m.top, m.trBottom + gap)), spot: "below" };
}

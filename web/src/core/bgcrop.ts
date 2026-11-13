// The phone's own background and how a video fits the phone (V1.47, the developer 10 Nov 2026: "on the GOS and the iOS app,
// make it so the backgrounds don't mimic what you have on the desktop ... make it so you can crop the video, with
// different options for how you crop it so it fits the mobile device better").
//
// Two synced settings, both only read on a phone (PS GOS and the iPhone web app); the Mac never looks at them:
//  - settings.tmBgPhone: the phone's own background. Unset or null means "Same as my Mac" (settings.tmBg), which is
//    what every phone showed before, so nothing changes until the developer picks one.
//  - settings.tmBgCrop: how each background fits the phone, keyed by the background ("video:<id>"):
//      Fill  crops to fill the screen around a focus point (x, y from 0 to 1, where 0.5 is the middle), with a zoom;
//      Fit   shows the whole video with bars (blurred, black, or the video's own colour), placed by the same point.
//    A video with nothing saved fills at its automatic portrait crop (core/bgvault.ts autoFocus), as before.
//
// How it draws: one <video> with object-fit (cover or contain), object-position at the focus point, and for a zoom a
// CSS scale round that same point. The point at fraction p of the video then sits at fraction p of the screen at any
// zoom, so the maths below (what part of the video shows) and the CSS always agree. A transform is done by the GPU:
// no extra decoding, no canvas, so it costs the battery nothing. Pure: no React, no DOM.

export type BgFitMode = "fill" | "fit";
export type BgBars = "blur" | "black" | "colour";
export interface BgCrop { mode: BgFitMode; x: number; y: number; zoom: number; bars: BgBars }

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
/** At most this many backgrounds keep a crop (the newest win); a crop is a few bytes each. */
export const CROPS_MAX = 40;

const BG_ID = /^video:[a-z0-9-]{1,48}$/;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
/** Three decimals is far finer than a finger: keeps the saved settings small and the same on every device. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Nothing saved: fill the screen at the automatic crop (only across the width, as before V1.47). */
export function defaultCrop(focusX = 0.5): BgCrop {
  const x = Number.isFinite(focusX) ? r3(clamp01(focusX)) : 0.5;
  return { mode: "fill", x, y: 0.5, zoom: 1, bars: "blur" };
}

/** One saved crop, checked. Anything not understood falls back to the default's value for that part. */
export function cleanCrop(v: unknown, focusX = 0.5): BgCrop | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>, d = defaultCrop(focusX);
  const x = num(o.x), y = num(o.y), z = num(o.zoom);
  return {
    mode: o.mode === "fit" ? "fit" : "fill",
    x: Number.isFinite(x) ? r3(clamp01(x)) : d.x,
    y: Number.isFinite(y) ? r3(clamp01(y)) : d.y,
    zoom: Number.isFinite(z) ? r3(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))) : 1,
    bars: o.bars === "black" || o.bars === "colour" ? o.bars : "blur",
  };
}

/** Every saved crop, checked: only background ids, at most CROPS_MAX (the last ones). */
export function cleanCrops(v: unknown): Record<string, BgCrop> {
  const out: Record<string, BgCrop> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  const keys = Object.keys(v as object).filter((k) => BG_ID.test(k)).slice(-CROPS_MAX);
  for (const k of keys) { const c = cleanCrop((v as Record<string, unknown>)[k]); if (c) out[k] = c; }
  return out;
}

/** The crop for a background: the saved one, else filling at its automatic portrait crop. */
export function cropFor(crops: unknown, bg: string, autoX = 0.5): BgCrop {
  const all = crops && typeof crops === "object" && !Array.isArray(crops) ? crops as Record<string, unknown> : {};
  return cleanCrop(all[bg], autoX) ?? defaultCrop(autoX);
}

/** Saving one crop: the others stay, ones for videos no longer in the vault go (`keep`: the ids still there). */
export function withCrop(crops: unknown, bg: string, c: BgCrop | null, keep?: string[]): Record<string, BgCrop> {
  const all = cleanCrops(crops);
  delete all[bg];
  if (c) all[bg] = cleanCrop(c) ?? defaultCrop();
  if (keep) for (const k of Object.keys(all)) if (!keep.includes(k.slice(6))) delete all[k];
  return cleanCrops(all);
}

/** True when a crop is the same as having nothing saved (so Reset can simply forget it). */
export function sameCrop(a: BgCrop, b: BgCrop): boolean {
  return a.mode === b.mode && a.x === b.x && a.y === b.y && a.zoom === b.zoom && (a.mode === "fill" || a.bars === b.bars);
}

// ---------- the maths: what part of the video shows on a screen ----------
export interface Size { w: number; h: number }
/** A part of the video, as fractions of its width and height. Above 1 wide (or below 0) means bars beside it. */
export interface Window { left: number; top: number; w: number; h: number }

const okSize = (s: Size) => Number.isFinite(s.w) && Number.isFinite(s.h) && s.w > 0 && s.h > 0;

/** How much the video is scaled to the screen before the zoom: cover for Fill, contain for Fit. */
export function baseScale(media: Size, screen: Size, mode: BgFitMode): number {
  if (!okSize(media) || !okSize(screen)) return 1;
  const sx = screen.w / media.w, sy = screen.h / media.h;
  return mode === "fit" ? Math.min(sx, sy) : Math.max(sx, sy);
}

/** The part of the video the screen shows. With object-position p and a scale round p, the video's point p sits
 *  at the screen's point p, so the window is `p * (1 - size)` from the edge on each side. */
export function cropWindow(media: Size, screen: Size, c: BgCrop): Window {
  if (!okSize(media) || !okSize(screen)) return { left: 0, top: 0, w: 1, h: 1 };
  const s = baseScale(media, screen, c.mode) * c.zoom;
  const w = screen.w / (s * media.w), h = screen.h / (s * media.h);
  return { left: c.x * (1 - w), top: c.y * (1 - h), w, h };
}

/** The other way round: the focus point that puts the window's corner at (left, top). A window as wide as the
 *  video (or wider) can not move that way, so that part of the point stays as it was. */
export function focusFor(win: Window, was: { x: number; y: number }): { x: number; y: number } {
  const one = (pos: number, size: number, old: number) => (Math.abs(1 - size) < 1e-6 ? old : r3(clamp01(pos / (1 - size))));
  return { x: one(win.left, win.w, was.x), y: one(win.top, win.h, was.y) };
}

/** A drag on the phone's preview by (dx, dy) screen pixels on a preview `screen` big: the picture follows the
 *  finger, so the window moves the other way. Returns the new focus point. */
export function dragFocus(media: Size, screen: Size, c: BgCrop, dx: number, dy: number): { x: number; y: number } {
  const win = cropWindow(media, screen, c);
  if (!okSize(screen)) return { x: c.x, y: c.y };
  const left = win.left - (dx / screen.w) * win.w, top = win.top - (dy / screen.h) * win.h;
  // Fill keeps the window inside the video; Fit keeps the video inside the screen (bars on both sides at most).
  const bound = (pos: number, size: number) => (size <= 1 ? Math.max(0, Math.min(1 - size, pos)) : Math.max(1 - size, Math.min(0, pos)));
  return focusFor({ left: bound(left, win.w), top: bound(top, win.h), w: win.w, h: win.h }, c);
}

/** A tap on the whole video picture (fractions of its width and height): that point goes to the middle of the
 *  window where it can. */
export function tapFocus(media: Size, screen: Size, c: BgCrop, fx: number, fy: number): { x: number; y: number } {
  const win = cropWindow(media, screen, c);
  const bound = (pos: number, size: number) => (size <= 1 ? Math.max(0, Math.min(1 - size, pos)) : Math.max(1 - size, Math.min(0, pos)));
  return focusFor({ left: bound(clamp01(fx) - win.w / 2, win.w), top: bound(clamp01(fy) - win.h / 2, win.h), w: win.w, h: win.h }, c);
}

/** The CSS for the video element (a style object; the numbers are fixed so tests can read them). */
export function cropCss(c: BgCrop): { objectFit: "cover" | "contain"; objectPosition: string; transform?: string; transformOrigin?: string } {
  const pos = `${r3(c.x * 100)}% ${r3(c.y * 100)}%`;
  const css: ReturnType<typeof cropCss> = { objectFit: c.mode === "fit" ? "contain" : "cover", objectPosition: pos };
  if (c.zoom > 1.0005) { css.transform = `scale(${r3(c.zoom)})`; css.transformOrigin = pos; }
  return css;
}

/** Fit leaves bars (or the zoom does not cover the screen): only then is anything drawn behind the video. */
export function hasBars(media: Size, screen: Size, c: BgCrop): boolean {
  if (c.mode === "fill") return false;
  const win = cropWindow(media, screen, c);
  return win.w > 1.001 || win.h > 1.001;
}

/** The video's own colour for the bars: the average of a small sample, darkened so the list stays readable. */
export function barColour(rgba: ArrayLike<number>): string {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) { if (rgba[i + 3] < 8) continue; r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++; }
  if (!n) return "#000000";
  const k = 0.55 / n, hex = (v: number) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// ---------- the phone's own background ----------
/** The background a phone shows: its own when one is picked, else the Mac's. `valid` says what counts as a
 *  background (core/prio.ts bgDesign, passed in so this file stays free of the list's code). */
export function phoneBg(st: { tmBg?: string | null; tmBgPhone?: string | null }, valid: (v: string) => boolean): string | null | undefined {
  return typeof st.tmBgPhone === "string" && valid(st.tmBgPhone) ? st.tmBgPhone : st.tmBg;
}
/** Whether the phone has its own background (false: "Same as my Mac"). */
export function phoneOwn(st: { tmBgPhone?: string | null }, valid: (v: string) => boolean): boolean {
  return typeof st.tmBgPhone === "string" && valid(st.tmBgPhone);
}
/** Which setting a pick on this device saves: the phone's own one once it has one, else the shared one. */
export function bgKey(st: { tmBgPhone?: string | null }, phone: boolean, valid: (v: string) => boolean): "tmBg" | "tmBgPhone" {
  return phone && phoneOwn(st, valid) ? "tmBgPhone" : "tmBg";
}

/** A video replaced by a newer copy (core/bgvault.ts store): the phone's pick and its crop follow it. */
export function followReplaced(st: { tmBgPhone?: string | null; tmBgCrop?: unknown }, oldId: string, newId: string): { tmBgPhone?: string; tmBgCrop?: Record<string, BgCrop> } {
  const out: { tmBgPhone?: string; tmBgCrop?: Record<string, BgCrop> } = {};
  const from = `video:${oldId}`, to = `video:${newId}`;
  if (st.tmBgPhone === from) out.tmBgPhone = to;
  const crops = cleanCrops(st.tmBgCrop);
  if (crops[from]) { const c = crops[from]; delete crops[from]; crops[to] = c; out.tmBgCrop = crops; }
  return out;
}

// The Overdue card's own look (V1.44, the developer 9 Nov 2026: "for the overdue tab on the bottom right of the screen... add
// that as an appearance option in settings too. So I can change the colour, change the text color, change the like
// effect on it if I want like a lightning effect"). Settings, Appearance, Overdue card: a background colour, a text
// colour and an effect, each with presets and the colour wheel for your own colour.
//
// Saved as settings.tmOverdue = { bg, text, fx }, synced like every setting, and only when it really changes (the
// colour wheel tries colours on screen and saves once you stop). Unset, or every part at its default, is null: the
// card then looks exactly as before (the look's own red), because no colour is set on it at all.
// Pure: no React, no DOM. views/OverdueLook.tsx draws the settings and the effects; views/TaskMap.tsx's Overdue card
// takes the colours from overdueVars below.
import type { Settings } from "./model";
import { contrast, p1Color } from "./prio.ts";

export type OverdueFx = "none" | "glow" | "pulse" | "shimmer" | "lightning" | "fire" | "alarm";
export interface OverdueLook { bg: string | null; text: string | null; fx: OverdueFx }
/** As before: the look's own red card, its own text colours, no effect. */
export const OVERDUE_DEFAULT: OverdueLook = { bg: null, text: null, fx: "none" };

/** Card colours. The developer's default (null) is not one of these: it is each look's own red, as the card always was. */
export const OVERDUE_BGS: { id: string; label: string }[] = [
  { id: "#e0182d", label: "Bright red" },
  { id: "#5a0c14", label: "Dark red" },
  { id: "#e8590c", label: "Orange" },
  { id: "#f5a524", label: "Amber" },
  { id: "#15803d", label: "Green" },
  { id: "#0d9488", label: "Teal" },
  { id: "#2563eb", label: "Blue" },
  { id: "#1e2a5a", label: "Navy" },
  { id: "#7c3aed", label: "Purple" },
  { id: "#db2777", label: "Pink" },
  { id: "#0d0d10", label: "Black" },
  { id: "#f4f4f5", label: "White" },
];
/** Text colours (null: picked for you, so it always reads on the card). */
export const OVERDUE_TEXTS: { id: string; label: string }[] = [
  { id: "#ffffff", label: "White" },
  { id: "#111114", label: "Black" },
  { id: "#ff6b6b", label: "Red" },
  { id: "#ffd21f", label: "Yellow" },
  { id: "#f6c453", label: "Gold" },
  { id: "#67e8f9", label: "Cyan" },
  { id: "#86efac", label: "Mint" },
  { id: "#ff8fc8", label: "Pink" },
];

/** The effects, in the order Settings shows them. `moving`: it animates (still, or off, with Reduce motion). */
export const OVERDUE_FX: { id: OverdueFx; label: string; note: string; moving: boolean }[] = [
  { id: "none", label: "None", note: "The card as it always was.", moving: false },
  { id: "glow", label: "Glow", note: "A steady neon glow round the card.", moving: false },
  { id: "pulse", label: "Pulse", note: "The glow slowly breathes in and out.", moving: true },
  { id: "shimmer", label: "Shimmer", note: "A soft shine sweeps across now and then.", moving: true },
  { id: "lightning", label: "Lightning", note: "Bolts flash across the card, like the Priority 1 lightning.", moving: true },
  { id: "fire", label: "Fire", note: "Embers rise from a flickering glow at the bottom.", moving: true },
  { id: "alarm", label: "Alarm", note: "The edge flashes like a warning light.", moving: true },
];
const FX_IDS = new Set<string>(OVERDUE_FX.map((f) => f.id));
export const overdueFx = (v: unknown): OverdueFx => (typeof v === "string" && FX_IDS.has(v) ? v as OverdueFx : "none");

/** One saved value, cleaned: colours as "#rrggbb" or null, an effect we know (an unknown one, say from a newer PS,
 *  shows as None here without being written over: saving only ever sends what changed). Anything else is the default. */
export function cleanOverdue(v: unknown): OverdueLook {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...OVERDUE_DEFAULT };
  const o = v as Record<string, unknown>;
  return { bg: p1Color(o.bg), text: p1Color(o.text), fx: overdueFx(o.fx) };
}
/** The look to paint the card with, from the settings. */
export const overdueLookOf = (s: Pick<Settings, "tmOverdue"> | null | undefined): OverdueLook => cleanOverdue(s?.tmOverdue);
export const isDefaultOverdue = (l: OverdueLook) => !l.bg && !l.text && l.fx === "none";
export const sameOverdue = (a: OverdueLook, b: OverdueLook) => a.bg === b.bg && a.text === b.text && a.fx === b.fx;
/** What is saved for a look: null when it is the default (so the settings record stays as small as before). */
export const overdueSaved = (l: OverdueLook): OverdueLook | null => (isDefaultOverdue(l) ? null : { bg: l.bg, text: l.text, fx: l.fx });

/** The Overdue part of a settings patch, checked (ps.ts cleanLooks). null or the default puts it back to as before. */
export function cleanOverdueLook(p: Record<string, unknown>): Partial<Settings> {
  if (!("tmOverdue" in p)) return {};
  if (p.tmOverdue === null) return { tmOverdue: null };
  if (!p.tmOverdue || typeof p.tmOverdue !== "object" || Array.isArray(p.tmOverdue)) return {};
  return { tmOverdue: overdueSaved(cleanOverdue(p.tmOverdue)) };
}

// ---------- colours ----------
const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb: number[]) => `#${rgb.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("")}`;
/** `hex` mixed toward `to` by t (0 to 1). */
export const mixHex = (hex: string, to: string, t: number) => { const a = rgbOf(hex), b = rgbOf(to); return hexOf(a.map((x, i) => x + (b[i] - x) * t)); };
/** A light card (Orange, Amber, White...): dark words read better on it than white; a dark one: white words. */
export const isLightCard = (bg: string) => contrast(bg, "#17121a") > contrast(bg, "#ffffff");
/** `seed` moved toward white (on a dark card) or black (on a light one) just enough to read at `ratio` on `bg`. */
export function readableOn(bg: string, seed: string, ratio: number): string {
  const to = isLightCard(bg) ? "#000000" : "#ffffff";
  for (let t = 0; t <= 1.0001; t += 0.05) { const c = mixHex(seed, to, t); if (contrast(c, bg) >= ratio) return c; }
  return bestInk(bg);
}
/** Black or white, whichever reads better on `bg` (a mid grey reads best in black). */
export const bestInk = (bg: string) => (contrast("#000000", bg) > contrast("#ffffff", bg) ? "#000000" : "#ffffff");

/** The CSS custom properties the card gets for a look. Empty for the default, so it looks exactly as before. Every
 *  rule of the card (taskmap.css .tm-aware) already paints with these, so nothing else needs to know. */
export function overdueVars(l: OverdueLook): Record<string, string> {
  const v: Record<string, string> = {};
  if (l.bg) {
    const light = isLightCard(l.bg);
    // The edge, the row tints and the glow: the colour itself, made to show on the card and on a dark screen.
    const edge = light ? mixHex(l.bg, "#000000", 0.42) : readableOn("#1c1219", mixHex(l.bg, "#ffffff", 0.12), 3);
    v["--k-bad-bg"] = l.bg;
    v["--k-base"] = mixHex(l.bg, "#000000", light ? 0.18 : 0.55);   // the card's gradient goes a little deeper at the bottom
    v["--k-bad"] = edge;
    v["--k-bad-t"] = readableOn(l.bg, light ? mixHex(l.bg, "#000000", 0.5) : mixHex(edge, "#ffffff", 0.35), 4.5);
    v["--k-fg"] = contrast(light ? "#17121a" : "#ffffff", l.bg) >= 4.5 ? (light ? "#17121a" : "#ffffff") : bestInk(l.bg);
    v["--od-glow"] = rgbOf(edge).join(", ");
  }
  if (l.text) { v["--k-fg"] = l.text; v["--k-bad-t"] = l.text; }
  return v;
}
/** The effect to draw: moving ones stay still with Reduce motion (Glow), or are not drawn (None) when they cannot. */
export function overdueFxShown(fx: OverdueFx, reducedMotion: boolean): OverdueFx {
  if (!reducedMotion) return fx;
  return fx === "pulse" || fx === "alarm" || fx === "fire" || fx === "lightning" ? "glow" : fx === "shimmer" ? "none" : fx;
}
/** One plain line for the reset button's tip and the search. */
export function overdueSummary(l: OverdueLook): string {
  if (isDefaultOverdue(l)) return "As before: the look's own red.";
  const name = (list: { id: string; label: string }[], c: string | null, none: string) => (c ? list.find((x) => x.id === c)?.label ?? c.toUpperCase() : none);
  const fx = OVERDUE_FX.find((f) => f.id === l.fx)?.label ?? "None";
  return `${name(OVERDUE_BGS, l.bg, "The developer as before")} card, ${name(OVERDUE_TEXTS, l.text, "automatic")} text, ${fx} effect.`;
}

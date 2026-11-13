// Minecraft mode (the developer, 4 Nov 2026): the pure rules behind the offline translator panel (views/Minecraft.tsx).
// What has to happen for a pair of languages, the local history, sizes in words the developer reads. No network.

/** Minecraft mode on or off (V1.32, the developer 4 Nov 2026: out of PS for now, kept so it can come back with almost no work).
 *  Off: no pop up, no bubble, no window.__psOpenMinecraft, no card in the gear's Settings, so no way in at all; every
 *  piece (views/Minecraft.tsx, views/minecraft/*) and its tests stay as they are. To bring it back set this to true
 *  AND MINECRAFT_ENABLED in ps-mac Sources/MinecraftSwitch.swift (the native half: power watch, translator, torch). */
export const MINECRAFT_ENABLED = false;
import { NLLB, type Lang } from "./kalatin.ts";

/** The steps for one translation: read Latin Georgian into Georgian first, run the model (or not), write the
 *  Georgian back in Latin letters at the end. Georgian and Latin Georgian are one language to the model. */
export type Plan = { readLatin: boolean; model: { src: string; tgt: string } | null; toLatin: boolean };
export function plan(from: Lang, to: Lang): Plan {
  const a = from === "kl" ? "ka" : from, b = to === "kl" ? "ka" : to;
  return { readLatin: from === "kl", model: a === b ? null : { src: NLLB[a], tgt: NLLB[b] }, toLatin: to === "kl" };
}

export const FROM_CHOICES: (Lang | "auto")[] = ["auto", "en", "ru", "ka", "kl"];
export const TO_CHOICES: Lang[] = ["en", "ru", "ka", "kl"];

/** What the To side starts at for a detected language: Georgian and Russian to English, English to Georgian. */
export function defaultTo(from: Lang): Lang { return from === "en" ? "ka" : "en"; }

/** Swap: the language the result is in becomes the source (Latin Georgian stays Latin Georgian). */
export function swapped(from: Lang, to: Lang): { from: Lang; to: Lang } { return { from: to, to: from }; }

// ---------- history (this Mac only, never synced) ----------
export type HistItem = { at: number; from: Lang; to: Lang; src: string; out: string };
export const HIST_MAX = 25;
const LANGS = new Set<string>(["en", "ru", "ka", "kl"]);
export function cleanHistory(v: unknown): HistItem[] {
  if (!Array.isArray(v)) return [];
  const out: HistItem[] = [];
  for (const x of v) {
    const h = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    if (typeof h.at !== "number" || !LANGS.has(String(h.from)) || !LANGS.has(String(h.to)) || typeof h.src !== "string" || typeof h.out !== "string") continue;
    out.push({ at: h.at, from: h.from as Lang, to: h.to as Lang, src: h.src.slice(0, 4000), out: h.out.slice(0, 4000) });
  }
  return out.slice(0, HIST_MAX);
}
/** The new one on top; the same text and pair again just moves up. */
export function addHistory(list: HistItem[], h: HistItem): HistItem[] {
  return [h, ...list.filter((x) => !(x.src === h.src && x.from === h.from && x.to === h.to))].slice(0, HIST_MAX);
}

// ---------- the model download, in words ----------
export function bytesText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 MB";
  return n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`;
}
export type Pack = { state: "none" | "downloading" | "checking" | "paused" | "ready" | "error"; got: number; total: number; error?: string; helper: boolean; engine: string; pack?: string };
/** One line under the progress bar. */
export function packLine(p: Pack): string {
  switch (p.state) {
    case "ready": return `On this Mac (${bytesText(p.total)}). Works with no internet.`;
    case "downloading": return `${bytesText(p.got)} of ${bytesText(p.total)}`;
    case "checking": return `Checking the download (${Math.round((100 * p.got) / Math.max(1, p.total))}%)`;
    case "paused": return `Paused at ${bytesText(p.got)} of ${bytesText(p.total)}. Download carries on from there.`;
    case "error": return p.error || "The download stopped.";
    default: return `One download of ${bytesText(p.total)}, then it never needs the internet again.`;
  }
}
export const packPercent = (p: Pack) => Math.max(0, Math.min(100, (100 * p.got) / Math.max(1, p.total)));

// ---------- the minimised bubble ----------
export type Spot = { x: number; y: number };
export const BUBBLE_SIZE = 58;
export function cleanSpot(v: unknown): Spot | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return Number.isFinite(o.x) && Number.isFinite(o.y) ? { x: Number(o.x), y: Number(o.y) } : null;
}
/** Where the bubble sits: where the developer left it, kept fully on screen (12 px margin); first time, top left under the
 *  clock, the one corner of the Tab list with nothing in it. */
export function bubbleSpot(s: Spot | null, w: number, h: number, size = BUBBLE_SIZE): Spot {
  const m = 12, maxX = Math.max(m, w - size - m), maxY = Math.max(m, h - size - m);
  const p = s ?? { x: 28, y: 140 };
  return { x: Math.round(Math.min(maxX, Math.max(m, p.x))), y: Math.round(Math.min(maxY, Math.max(m, p.y))) };
}

// The Add task button, the round + beside the headline (V1.34, the developer 5 Nov 2026): a new default colour that stands out,
// any colour from Settings (presets or your own), and a small animation when it is clicked ("like a little three
// sixty when you click on it to add a task"), chosen in Settings too. settings.tmAddColor (a #rrggbb, unset = the
// default) and settings.tmAddAnim, synced like every setting, cleaned here on read and in ps.ts cleanLooks on save.
import type { Settings } from "./model";
import { contrast, p1Color } from "./prio.ts";

/** Mint: stands out against the pink and dark default look, and reads as "add". */
export const ADD_COLOR_DEFAULT = "#3ddc97";
export const ADD_COLORS: { id: string; label: string }[] = [
  { id: ADD_COLOR_DEFAULT, label: "Mint" }, { id: "#ec4e86", label: "Pink" }, { id: "#38bdf8", label: "Sky" },
  { id: "#ffc83d", label: "Gold" }, { id: "#a78bfa", label: "Violet" }, { id: "#ff7a45", label: "Coral" }, { id: "#ffffff", label: "White" },
];
export type AddAnim = "spin" | "pop" | "bounce" | "pulse" | "none";
export const ADD_ANIMS: { id: AddAnim; label: string }[] = [
  { id: "spin", label: "Spin 360" }, { id: "pop", label: "Pop" }, { id: "bounce", label: "Bounce" }, { id: "pulse", label: "Pulse" }, { id: "none", label: "None" },
];
const ANIM_IDS = new Set<string>(ADD_ANIMS.map((a) => a.id));

/** The button's colour: the saved one if it reads as a colour, else Mint. */
export function addColorOf(s: Pick<Settings, "tmAddColor"> | null | undefined): string {
  return p1Color(s?.tmAddColor) ?? ADD_COLOR_DEFAULT;
}
/** The click animation: Spin 360 unless another one was picked. */
export function addAnimOf(s: Pick<Settings, "tmAddAnim"> | null | undefined): AddAnim {
  return typeof s?.tmAddAnim === "string" && ANIM_IDS.has(s.tmAddAnim) ? s.tmAddAnim as AddAnim : "spin";
}
/** The + itself: dark ink on a light colour, white on a dark one (whichever reads better). */
export function addInkOn(hex: string): string {
  return contrast(hex, "#17121a") >= contrast(hex, "#ffffff") ? "#17121a" : "#ffffff";
}
/** The Add task part of a settings patch, checked (null puts the default back). */
export function cleanAddLooks(p: Record<string, unknown>): Partial<Settings> {
  const o: Partial<Settings> = {};
  if (p.tmAddColor === null) o.tmAddColor = null;
  else if (p1Color(p.tmAddColor)) o.tmAddColor = p1Color(p.tmAddColor);
  if (typeof p.tmAddAnim === "string" && ANIM_IDS.has(p.tmAddAnim)) o.tmAddAnim = p.tmAddAnim as AddAnim;
  return o;
}

// Minecraft mode, the torch: the parts with no React and no PS bridge, so tests/torch.test.ts can run
// them in node. The colours, the custom colour picker's maths, what is remembered, and the shell's state
// message cleaned. Nothing here goes online or into the vault: the last colour lives on this device only.

export type TorchPreset = { id: string; name: string; color: string; bright: boolean; note?: string };

/** The colour row, in order. The developer never raises the brightness: kind to dark adapted eyes at night. */
export const TORCH_PRESETS: TorchPreset[] = [
  { id: "white", name: "White", color: "#ffffff", bright: true },
  { id: "warm", name: "Warm", color: "#ffd59e", bright: true },
  { id: "red", name: "Red", color: "#d10a00", bright: false, note: "Dim, for night" },
  { id: "green", name: "Green", color: "#1fe04a", bright: true },
  { id: "blue", name: "Blue", color: "#2f6bff", bright: true },
];
export const CUSTOM_ID = "custom";

/** "#rrggbb" lower case (also takes "rrggbb" and "#rgb"), or null. */
export function cleanColor(s: unknown): string | null {
  if (typeof s !== "string") return null;
  let t = s.trim().toLowerCase();
  if (t.startsWith("#")) t = t.slice(1);
  if (/^[0-9a-f]{3}$/.test(t)) t = t.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/.test(t) ? "#" + t : null;
}

// ---------- the custom colour: a hue and how pale it is ----------

/** hue 0..360, pale 0..100 (0 = the pure colour, 100 = white). Always a valid "#rrggbb". */
export function customColor(hue: number, pale: number): string {
  const h = (((Number.isFinite(hue) ? hue : 0) % 360) + 360) % 360;
  const p = Math.max(0, Math.min(100, Number.isFinite(pale) ? pale : 0)) / 100;
  // HSV with full value: s = 1 - pale, so the brightest light at every hue.
  const s = 1 - p, c = s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = 1 - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return "#" + hex(r) + hex(g) + hex(b);
}

/** Back from a colour to the two sliders (for a remembered custom colour). */
export function toHuePale(color: string): { hue: number; pale: number } {
  const c = cleanColor(color) ?? "#ffffff";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
  }
  hue = Math.round((hue + 360) % 360);
  const sat = max === 0 ? 0 : d / max;
  return { hue, pale: Math.round((1 - sat) * 100) };
}

// ---------- what is remembered (this device only) ----------

export type TorchPrefs = { pick: string; custom: string; bright: boolean };
export const DEFAULT_PREFS: TorchPrefs = { pick: "white", custom: "#ff9a1f", bright: true };
export const PREFS_KEY = "ps.mc.torch";
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export function cleanPrefs(raw: unknown): TorchPrefs {
  const o = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const pick = typeof o.pick === "string" && (o.pick === CUSTOM_ID || TORCH_PRESETS.some((p) => p.id === o.pick)) ? o.pick : DEFAULT_PREFS.pick;
  return { pick, custom: cleanColor(o.custom) ?? DEFAULT_PREFS.custom, bright: typeof o.bright === "boolean" ? o.bright : DEFAULT_PREFS.bright };
}
export function loadPrefs(store: Store | null | undefined): TorchPrefs {
  try { const s = store?.getItem(PREFS_KEY); return cleanPrefs(s ? JSON.parse(s) : null); } catch { return { ...DEFAULT_PREFS }; }
}
export function savePrefs(store: Store | null | undefined, p: TorchPrefs) {
  try { store?.setItem(PREFS_KEY, JSON.stringify(cleanPrefs(p))); } catch { /* private window, full disk: the choice just is not kept */ }
}

/** What to send PS for the picked colour: the colour, and whether to raise the brightness. */
export function lightFor(p: TorchPrefs): { color: string; bright: boolean } {
  const preset = TORCH_PRESETS.find((x) => x.id === p.pick);
  if (preset) return { color: preset.color, bright: p.bright && preset.bright };
  return { color: cleanColor(p.custom) ?? "#ffffff", bright: p.bright };
}

// ---------- the shell's answer ----------

export type TorchState = { open: boolean; color: string; bright: boolean; canBright: boolean; refused: "protected" | null };
export const EMPTY_TORCH: TorchState = { open: false, color: "#ffffff", bright: true, canBright: true, refused: null };

export function cleanTorchState(raw: unknown): TorchState {
  const o = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    open: o.open === true,
    color: cleanColor(o.color) ?? "#ffffff",
    bright: o.bright !== false,
    canBright: o.canBright !== false,
    refused: o.refused === "protected" ? "protected" : null,
  };
}

/** Readable text on a swatch of this colour (dark on light colours). */
export function inkOn(color: string): string {
  const c = cleanColor(color) ?? "#ffffff";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1a1a1a" : "#ffffff";
}

/** The "Press Esc to turn off" hint on the torch itself: faint but readable on the torch colour (dark on
 *  light colours, light on dark ones), the same rule as the Mac's (Torch.swift hintColor). */
export const TORCH_HINT = "Press Esc to turn off";
export function hintInk(color: string): string {
  const c = cleanColor(color) ?? "#ffffff";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? "rgba(0,0,0,.38)" : "rgba(255,255,255,.5)";
}

/** a mixed toward b by t (0..1), for the torch icon's lighter flame layer. */
export function mixColor(a: string, b: string, t: number): string {
  const x = cleanColor(a) ?? "#ffffff", y = cleanColor(b) ?? "#ffffff";
  const k = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  return "#" + [1, 3, 5].map((i) => {
    const v = Math.round(parseInt(x.slice(i, i + 2), 16) * (1 - k) + parseInt(y.slice(i, i + 2), 16) * k);
    return v.toString(16).padStart(2, "0");
  }).join("");
}

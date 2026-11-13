// Colour backgrounds for the Tab list (V1.40, the developer 7 Nov 2026: "add different colour options as a background").
// Pure rules, no DOM: the presets (solid colours and soft gradients), the custom colour, and how a saved value reads.
// A colour background is one more value of the one background setting (settings.tmBg), so it syncs with the rest:
//   "color:<preset id>"  one of BG_COLOURS below
//   "color:#rrggbb"      a custom colour from the picker (lower case hex)
// An older PS that does not know these values shows no background (core/prio.ts bgDesign falls back to "none").

export type BgColour = { id: string; label: string; css: string; kind: "solid" | "gradient" };

/** Calm, soft colours. The list keeps solid cards while a colour is behind it, so text reads on any of them. */
export const BG_COLOURS: BgColour[] = [
  { id: "ink", label: "Ink", css: "#0E1116", kind: "solid" },
  { id: "plum", label: "Plum", css: "#2A1530", kind: "solid" },
  { id: "ocean", label: "Ocean", css: "#0F2A44", kind: "solid" },
  { id: "forest", label: "Forest", css: "#123326", kind: "solid" },
  { id: "slate", label: "Slate", css: "#2B3340", kind: "solid" },
  { id: "rose", label: "Rose", css: "#5A2340", kind: "solid" },
  { id: "sand", label: "Sand", css: "#C9B79C", kind: "solid" },
  { id: "sky", label: "Sky", css: "#8EC5E8", kind: "solid" },
  { id: "sage", label: "Sage", css: "#9CB59A", kind: "solid" },
  { id: "blush", label: "Blush", css: "#F2C4CE", kind: "solid" },
  { id: "g-dusk", label: "Dusk", css: "linear-gradient(160deg, #2B1A4A 0%, #7A3B6E 55%, #E8677A 100%)", kind: "gradient" },
  { id: "g-deep", label: "Deep sea", css: "linear-gradient(170deg, #04263F 0%, #0B4F6C 60%, #1C7C9C 100%)", kind: "gradient" },
  { id: "g-aurora", label: "Northern lights", css: "linear-gradient(150deg, #0B1E2D 0%, #1F8A70 50%, #6C3FB5 100%)", kind: "gradient" },
  { id: "g-sunrise", label: "Sunrise", css: "linear-gradient(170deg, #FF9A62 0%, #FFC48A 55%, #FFE3B8 100%)", kind: "gradient" },
  { id: "g-lavender", label: "Lavender haze", css: "linear-gradient(160deg, #A18CD1 0%, #D7A8E0 55%, #FBC2EB 100%)", kind: "gradient" },
  { id: "g-mist", label: "Forest mist", css: "linear-gradient(170deg, #0F2027 0%, #203A43 50%, #2C5364 100%)", kind: "gradient" },
  { id: "g-rosegold", label: "Rose gold", css: "linear-gradient(160deg, #6E3B47 0%, #B76E79 55%, #F4C2C2 100%)", kind: "gradient" },
  { id: "g-mint", label: "Mint", css: "linear-gradient(170deg, #5FB49C 0%, #A8E6CF 55%, #DCEDC1 100%)", kind: "gradient" },
];
const BY_ID = new Map(BG_COLOURS.map((c) => [c.id, c]));
export const DEFAULT_CUSTOM_COLOUR = "#3A2F5C";

/** True for a saved colour background ("color:<preset>" or "color:#rrggbb"). */
export function isColourBg(v: unknown): v is string {
  if (typeof v !== "string" || !v.startsWith("color:")) return false;
  const k = v.slice(6);
  return BY_ID.has(k) || /^#[0-9a-f]{6}$/.test(k);
}
/** A typed or posted colour cleaned to "#rrggbb" (lower case; "#rgb" and no "#" are fine), else null. */
export function hexColour(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let h = v.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(h)) h = h.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/.test(h) ? `#${h}` : null;
}
/** The saved value for a custom colour. */
export const customColourBg = (hex: string) => `color:${hexColour(hex) ?? DEFAULT_CUSTOM_COLOUR.toLowerCase()}`;
/** The CSS background for a saved colour background (null when it is not one). */
export function colourBgCss(v: unknown): string | null {
  if (!isColourBg(v)) return null;
  const k = v.slice(6);
  return BY_ID.get(k)?.css ?? k;
}
/** Its name for the Settings tile and the preview chip. */
export function colourBgLabel(v: unknown): string {
  if (!isColourBg(v)) return "None";
  const k = v.slice(6);
  return BY_ID.get(k)?.label ?? `Your colour ${k.toUpperCase()}`;
}
/** The custom colour behind a saved value (for the picker), else null. */
export const customOf = (v: unknown): string | null => (isColourBg(v) && v.slice(6).startsWith("#") ? v.slice(6) : null);

/** A colour from the picker's two sliders: hue 0 to 359 and shade 0 (deep) to 100 (pale). Always "#rrggbb". */
export function pickerColour(hue: number, shade: number): string {
  const h = ((Math.round(hue) % 360) + 360) % 360, l = 0.12 + 0.76 * Math.max(0, Math.min(100, shade)) / 100, s = 0.55;
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`;
}
/** The picker's sliders for a colour (the reverse of pickerColour, near enough to start from). */
export function pickerOf(hex: string): { hue: number; shade: number } {
  const c = hexColour(hex) ?? DEFAULT_CUSTOM_COLOUR.toLowerCase();
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: Math.round((h * 60 + 360) % 360), shade: Math.round(Math.max(0, Math.min(100, ((l - 0.12) / 0.76) * 100))) };
}

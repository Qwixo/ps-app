// The Dynamic Island's LOOKS (the developer, 4 Nov 2026: "for the pill under the notch one, I want to add another
// edit button so I can actually change the colour and the look of that one", and working, better looking
// versions of Around the notch). Pure: what each look is, the cleaning of saved choices, and the colours
// the island paints with. Every text colour is worked out here so it reads at WCAG AA (4.5 to 1) on the
// colour behind it, whatever colour is picked; rings and edges get at least 3 to 1.
// Saved inside settings.island as `pill` and `notch` (core/island.ts), synced like every other setting.
// V1.36 (the developer, 5 Nov 2026: "could you make it so I can actually edit the colour, like the background colour of it
// too"): every look has two colours, `fill` (the Background) and `color` (the Accent: tick, icon, edge, glow).
// fill null is the look's own background, so nothing changes until he picks one: Classic and around the notch stay
// black. Around the notch with a Background, the drop and wings take the colour while the camera notch itself stays
// black, blending softly into it (Island.swift notchBack, views/IslandLook.tsx Preview).
// The native side (ps-mac Island.swift) and the editor's preview (views/IslandLook.tsx) both paint with
// the tones from islandTones() / notchTones(), so the preview is what the island shows.
import { contrast, luminance, p1Color } from "./prio.ts";

export type PillStyle = "classic" | "glass" | "solid" | "gradient" | "outline" | "glow";
export type NotchStyle = "drop" | "slim" | "halo";
export type PillSize = "regular" | "compact";
/** fill: the Background (null: the look's own, black for Classic). color: the Accent (null: the look's own). */
export interface PillLook { style: PillStyle; fill: string | null; color: string | null; size: PillSize; icon: boolean }
export interface NotchLook { style: NotchStyle; fill: string | null; color: string | null; icon: boolean }

export const PILL_DEFAULT: PillLook = { style: "classic", fill: null, color: null, size: "regular", icon: false };
export const NOTCH_DEFAULT: NotchLook = { style: "drop", fill: null, color: null, icon: false };
/** The looks whose one colour was their fill before V1.36 (a look saved then is read with it as the Background). */
const FILLED: PillStyle[] = ["glass", "solid", "gradient"];

export const PILL_STYLES: { id: PillStyle; label: string; hint: string }[] = [
  { id: "classic", label: "Classic", hint: "Plain: black, or the background you pick" },
  { id: "glass", label: "Glass", hint: "Frosted, the screen shows through" },
  { id: "solid", label: "Solid", hint: "Filled with your background colour" },
  { id: "gradient", label: "Gradient", hint: "Your background colour, fading across" },
  { id: "outline", label: "Outline", hint: "A coloured edge in your accent" },
  { id: "glow", label: "Glow", hint: "A soft glow in your accent" },
];
export const NOTCH_STYLES: { id: NotchStyle; label: string; hint: string }[] = [
  { id: "drop", label: "Drop", hint: "Flows down out of the notch, never over the menu bar" },
  { id: "slim", label: "Slim", hint: "Small wings either side of the notch" },
  { id: "halo", label: "Halo", hint: "A soft glow round the notch, the task on hover" },
];
/** Presets: the strong colours of the Priority 1 picker plus deep ones that suit a filled pill. */
export const ISLAND_COLORS: { id: string; label: string }[] = [
  { id: "#2c2c31", label: "Graphite" },
  { id: "#1d2b53", label: "Navy" },
  { id: "#0f4c3a", label: "Forest" },
  { id: "#5b1a2e", label: "Wine" },
  { id: "#ff2e3e", label: "Red" },
  { id: "#ff7a1a", label: "Orange" },
  { id: "#ffd21f", label: "Yellow" },
  { id: "#3dff7a", label: "Green" },
  { id: "#1fe0ff", label: "Cyan" },
  { id: "#3d7bff", label: "Blue" },
  { id: "#a35bff", label: "Purple" },
  { id: "#ff3dc8", label: "Pink" },
  { id: "#f4f1ea", label: "Cream" },
  { id: "#ffffff", label: "White" },
];

const oneOf = <T extends string>(v: unknown, list: { id: T }[], d: T): T => (list.some((x) => x.id === v) ? v as T : d);
const obj = (v: unknown) => (v && typeof v === "object" ? v as Record<string, unknown> : {});
/** Only well formed choices; anything else falls back to the default (the pill stays as it was). */
export function pillLook(v: unknown): PillLook {
  const o = obj(v);
  const style = oneOf(o.style, PILL_STYLES, PILL_DEFAULT.style);
  let fill = p1Color(o.fill), color = p1Color(o.color);
  // Saved before V1.36 (no fill at all): Glass, Solid and Gradient used their one colour as the fill, so it is
  // read as the Background and they look exactly as they did.
  if (o.fill === undefined && FILLED.includes(style) && color) { fill = color; color = null; }
  return { style, fill, color, size: o.size === "compact" ? "compact" : "regular", icon: o.icon === true };
}
export function notchLook(v: unknown): NotchLook {
  const o = obj(v);
  return { style: oneOf(o.style, NOTCH_STYLES, NOTCH_DEFAULT.style), fill: p1Color(o.fill), color: p1Color(o.color), icon: o.icon === true };
}

// ---------- colour sums ----------
const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb: number[]) => `#${rgb.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("")}`;
/** a moved toward b by t (0 = a, 1 = b), in plain sRGB like the screen blends it. */
export const mix = (a: string, b: string, t: number) => { const x = rgbOf(a), y = rgbOf(b); return hexOf(x.map((v, i) => v + (y[i] - v) * t)); };
const WHITE = "#ffffff", BLACK = "#000000", INK = "#121216";
/** The lowest contrast of a colour against every backing it can sit on. */
export const worst = (c: string, bgs: string[]) => Math.min(...bgs.map((b) => contrast(c, b)));
/** White or near black, whichever reads better on every backing; pure black if neither reaches 4.5. */
function textOn(bgs: string[]): string {
  const w = worst(WHITE, bgs), k = worst(INK, bgs);
  if (Math.max(w, k) >= 4.5) return w >= k ? WHITE : INK;
  return worst(BLACK, bgs) > w ? BLACK : WHITE;
}
/** The softest version of the text (toward the backing) that still reads at 4.5, up to halfway. */
function dimOf(fg: string, bg: string, bgs: string[]): string {
  for (let t = 0.5; t > 0; t -= 0.05) { const c = mix(fg, bg, t); if (worst(c, bgs) >= 4.5) return c; }
  return fg;
}
/** A colour moved toward white (or black on light backings) just until it reaches `ratio` on every backing. */
function lift(c: string, bgs: string[], ratio: number): string {
  if (worst(c, bgs) >= ratio) return c;
  const toward = worst(WHITE, bgs) >= worst(BLACK, bgs) ? WHITE : BLACK;
  for (let t = 0.05; t <= 1.0001; t += 0.05) { const x = mix(c, toward, t); if (worst(x, bgs) >= ratio) return x; }
  return toward;
}
/** The colour moved toward `toward` just until `text` reads on it at 4.5 (t: how far it moved). */
function shadeFor(c: string, text: string, toward: string): { c: string; t: number } {
  for (let t = 0; t <= 1.0001; t += 0.05) { const x = mix(c, toward, t); if (contrast(text, x) >= 4.5) return { c: x, t }; }
  return { c: toward, t: 1 };
}
const PINK = "#ed4f87", BLUE = "#61a6fa", GREEN = "#33d499", ORANGE = "#d97857";

/** What the pill paints with. bg (and bg2, the far end of a gradient) is the fill; glass is how strongly
 *  the glass is tinted (0 = not glass); fg the words; dim a "next up" task; accent the tick ring and icon;
 *  edge the outline or glow colour (null = none); mail, lead, done, chat the counts, "Done" and a finished
 *  chat's icon, each kept
 *  readable on this fill. `backs` are every colour the words can end up on, for the tests. */
export interface PillTones {
  style: PillStyle; size: PillSize; icon: boolean;
  bg: string; bg2: string; glass: number; fg: string; dim: string; accent: string; edge: string | null;
  mail: string; lead: string; done: string; chat: string; backs: string[];
}
export function pillTones(look: PillLook): PillTones {
  const { style, fill, color: c, size, icon } = look;
  let bg = BLACK, bg2 = BLACK, glass = 0, edge: string | null = null, backs: string[];
  if (style === "solid" || (style === "classic" && fill)) {
    bg = bg2 = fill ?? "#2c2c31";
    backs = [bg];
  } else if (style === "gradient") {
    // White words on a gradient running darker, unless the colour would have to darken a lot for them
    // (yellow, cream): then dark words on one running lighter. Either way the colour is moved only as
    // far as the words need.
    const base = fill ?? "#2c2c31";
    const toWhite = shadeFor(base, WHITE, BLACK), toInk = shadeFor(base, INK, WHITE);
    const dark = toWhite.t <= 0.25 || toWhite.t <= toInk.t;
    bg = dark ? toWhite.c : toInk.c;
    bg2 = mix(bg, dark ? BLACK : WHITE, 0.42);
    backs = [bg, bg2];
  } else if (style === "glass") {
    // The glass is see through, so the words must read over ANY screen behind it, from black to white:
    // the tint gets just strong enough for that (a frosted blur sits under it on the Mac too). A mid
    // colour (a bright blue) is deepened a little first, so it stays glassy instead of nearly solid.
    const base = fill ?? "#1c1c22";
    const need = (tint: string) => {
      for (let k = 55; k < 100; k += 5) { const b = [mix(BLACK, tint, k / 100), mix(WHITE, tint, k / 100)]; if (worst(textOn(b), b) >= 4.5) return k / 100; }
      return 1;
    };
    const deep = mix(base, BLACK, 0.4), a1 = need(base), a2 = need(deep);
    bg = bg2 = a2 < a1 ? deep : base;
    glass = bg === base ? a1 : a2;
    backs = [mix(BLACK, bg, glass), mix(WHITE, bg, glass)];
  } else {
    bg = bg2 = style === "classic" ? BLACK : fill ?? "#0c0c0f";
    backs = [bg];
  }
  // With no Background picked, Classic, Outline and Glow keep exactly the words they always had.
  const plain = style === "classic" && !fill;
  const fg = plain ? "#f2f2f2" : (style === "outline" || style === "glow") && !fill ? WHITE : textOn(backs);
  const dim = plain ? "#808080" : dimOf(fg, bg, backs);   // Classic: exactly white at 50 percent, as before
  let accent: string;
  if (plain) accent = c ? lift(c, backs, 3) : "#bfbfbf";   // white at 75 percent, as before
  else if (style === "outline" || style === "glow") { accent = lift(c ?? fg, backs, 3); edge = accent; }
  else accent = c ? lift(c, backs, 3) : fg;
  const keep = (x: string) => (worst(x, backs) >= 3 ? x : fg);
  return { style, size, icon, bg, bg2, glass, fg, dim, accent, edge, mail: keep(PINK), lead: keep(BLUE), done: keep(GREEN), chat: keep(ORANGE), backs };
}

/** Around the notch is black like the notch unless a Background is picked (fill): then the drop, the Slim wings
 *  and the open island take that colour, and the camera notch itself stays black, blending softly into it a few
 *  points past its edge (the words never sit that close, so they only ever sit on the fill). The Accent (color)
 *  is the tick ring, the icon, the Drop's rim and the Halo's glow. With no colour picked the Halo glows a soft
 *  blue, which shows on a light menu bar and a dark wallpaper alike (white vanished on a light menu bar). The
 *  glow sits round the black notch in the menu bar, so it is worked out on black whatever the fill. */
export interface NotchTones {
  style: NotchStyle; icon: boolean; tinted: boolean; fill: string | null;
  fg: string; dim: string; accent: string; glow: string; mail: string; lead: string; done: string; chat: string; backs: string[];
}
export function notchTones(look: NotchLook): NotchTones {
  const onBlack = look.color ? lift(look.color, [BLACK], 3) : null;
  const glow = onBlack ?? "#8ab4ff";
  if (!look.fill) {
    return { style: look.style, icon: look.icon, tinted: !!look.color, fill: null, fg: "#f2f2f2", dim: "#808080", accent: onBlack ?? "#bfbfbf", glow,
      mail: PINK, lead: BLUE, done: GREEN, chat: ORANGE, backs: [BLACK] };
  }
  const bg = look.fill, backs = [bg];
  const fg = textOn(backs), dim = dimOf(fg, bg, backs);
  const accent = look.color ? lift(look.color, backs, 3) : lift(mix(fg, bg, 0.25), backs, 3);
  const keep = (x: string) => (worst(x, backs) >= 3 ? x : fg);
  return { style: look.style, icon: look.icon, tinted: !!look.color, fill: bg, fg, dim, accent, glow, mail: keep(PINK), lead: keep(BLUE), done: keep(GREEN), chat: keep(ORANGE), backs };
}

// ---------- the grab line (V1.36, the developer 6 Nov 2026) ----------
// "at the very top in the centre there's like a tiny little grey line in a landscape format and if you click that I
// want the dynamic island to disappear for let's say five seconds". A short grey line at the top centre of the
// island (the pill's top, or just below the camera notch), like an iOS sheet's handle. Grey always: the lightest
// grey on a dark island and the darkest on a light one that still shows at GRIP_RATIO on every backing it can sit
// on, and a stronger one while the pointer is on it. Island.swift IslandGrip does the same sum (the self test checks
// both give the same greys); the editor's preview paints with this one.
export const GRIP_RATIO = 3.5, GRIP_HI_RATIO = 6;
/** How far the black camera notch has faded at the line, around the notch with a Background (Island.swift NotchBlack). */
export const GRIP_FADE = 0.4;
/** The softest grey (r = g = b) that reaches `ratio` on every backing: lighter than every backing on a dark island,
 *  darker than every backing on a light one, moving away from it one step at a time; white or black if none does. */
function greyOn(backs: string[], ratio: number): string {
  const up = worst(WHITE, backs) >= worst(BLACK, backs);
  const lums = backs.map(luminance), hi = Math.max(...lums), lo = Math.min(...lums);
  for (let i = 0; i <= 255; i++) {
    const v = up ? i : 255 - i, c = hexOf([v, v, v]), l = luminance(c);
    if ((up ? l > hi : l < lo) && worst(c, backs) >= ratio) return c;
  }
  return up ? WHITE : BLACK;
}
/** The line's grey and its brighter hover grey, for a look's tones. Around the notch with a Background the line sits
 *  where the black notch is still fading into the fill, so both are worked out on that too. */
export function gripTones(t: { backs: string[]; fill?: string | null }, kind: "pill" | "notch"): { grip: string; gripHi: string } {
  const backs = kind === "notch" && t.fill ? [...t.backs, mix(t.fill, BLACK, GRIP_FADE)] : t.backs;
  return { grip: greyOn(backs, GRIP_RATIO), gripHi: greyOn(backs, GRIP_HI_RATIO) };
}

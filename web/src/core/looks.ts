// The PS appearance engine (V1.31, the developer 4 Nov 2026: "when I change the appearance, the entire PS app should change",
// "be careful when you change a colour not to make the text a colour I can't read").
//
// One set of design tokens drives every PS surface: the Tab list, its panels and cards, every screen inside the Tab
// overlay, the gear menu and settings windows, pop ups, toasts, scrollbars and the phone. The CSS never names a colour
// on its own any more: every colour is `var(--k-<token>, <the old colour>)` (scripts/looks-codemod.mjs did that), so
// with no token set the page is exactly the old dark glass, and a look only has to set tokens.
//
// This file is pure (no DOM): the colour maths, the WCAG contrast guard, the looks, and the settings cleaner. The
// page side (putting tokens on <html>, the switch animation, the preview) is src/looks/engine.ts.
// Families: acc (the brand pink), acc2 (the window purple), ok, warn (also Fitness gold), bad, info. Each family has
// a fill (X), a text colour that reads on the page (X-t), a tinted surface (X-bg) and a text colour for on the fill (on-X).

export type Rgb = [number, number, number];

// ---------- colour maths ----------
export function hexRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}
export function rgbHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}
const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
/** WCAG relative luminance. */
export function luminance(c: string | Rgb): number {
  const [r, g, b] = typeof c === "string" ? hexRgb(c) ?? [0, 0, 0] : c;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string | Rgb, b: string | Rgb): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** a mixed into b by t (0 = b, 1 = a), in sRGB like CSS color-mix(in srgb, a t, b). */
export function mix(a: string, b: string, t: number): string {
  const x = hexRgb(a) ?? [0, 0, 0], y = hexRgb(b) ?? [0, 0, 0];
  return rgbHex([0, 1, 2].map((i) => x[i] * t + y[i] * (1 - t)) as Rgb);
}
/** What text at this alpha looks like over this background (what the eye and the contrast check see). */
export const over = (ink: string, bg: string, alpha: number) => mix(ink, bg, Math.max(0, Math.min(1, alpha)));
export const isLight = (c: string) => luminance(c) > 0.36;

/** Moves a colour toward white or black, a step at a time, until it reaches `min` contrast against every background.
 *  The hue is kept; only the lightness moves. Returns the colour unchanged when it already passes. */
export function readable(color: string, bgs: string[], min: number): string {
  const ok = (c: string) => bgs.every((bg) => contrast(c, bg) >= min);
  if (ok(color)) return color;
  const lightBg = bgs.reduce((s, bg) => s + luminance(bg), 0) / bgs.length > 0.18;
  const toward = lightBg ? "#000000" : "#FFFFFF";
  for (let t = 0.04; t <= 1.0001; t += 0.04) {
    const c = mix(toward, color, t);
    if (ok(c)) return c;
  }
  // the other way, for a background in the middle
  const other = lightBg ? "#FFFFFF" : "#000000";
  for (let t = 0.04; t <= 1.0001; t += 0.04) { const c = mix(other, color, t); if (ok(c)) return c; }
  return toward;
}
/** The text colour for on top of a fill: white or near black, whichever reads better (at least 4.5:1 where any can). */
export function onFill(fill: string, dark = "#111111", light = "#FFFFFF"): string {
  return contrast(light, fill) >= contrast(dark, fill) ? light : dark;
}

// ---------- the looks ----------
import { NOTEBOOK_ON } from "./features.ts";
export type LookGroup = "classic" | "notebook" | "productivity";
export type LookSpec = {
  id: string; group: LookGroup; label: string; note: string;
  fg: string;          // the ink: text and lines
  base: string;        // the page under everything
  surface: string;     // cards, windows and panels
  acc: string;         // the accent (the developer can change it per look)
  acc2?: string;       // the second accent (windows, Claude); the accent when not given
  accText?: string;    // the accent as text when the fill is too dark or light to read as text (the research looks)
  prio?: [string, string, string, string];   // Priority 1 to 4 colours (made readable); bad, warn, info, muted when not given
  ok: string; warn: string; bad: string; info: string;
  font?: string;       // a FONTS id, the look's own type (the developer can change it)
  mono?: string;       // a MONOS id for times, numbers and ids
  textScale?: number;  // the look's own text size (Big Print is large), times the developer's text size
  heading?: string;    // a FONTS id for big headings (Day Plan's serif day title)
  hand?: string;       // a handwriting family for the notebook labels (notebook.css --nb-hand)
  radius?: number;     // corner scale, 1 = as drawn
  density?: Density;   // the look's starting density
  opaque?: number;     // the least cover over the screen behind the Tab list (0 to 1): paper is solid, glass is not
  swatch?: string[];   // the colours on its tile
};

/** The current dark glass. Sets no colour token at all, so every colour is the one in the CSS. */
const DARK: LookSpec = {
  id: "dark", group: "classic", label: "Dark glass", note: "The PS app you know: dark glass over your screen, pink and purple.",
  fg: "#FFFFFF", base: "#0B0709", surface: "#17121A", acc: "#EC4E86", acc2: "#8B5CF6",
  ok: "#34D399", warn: "#FBBF24", bad: "#FF5A5A", info: "#60A5FA", font: "inter", swatch: ["#17121A", "#EC4E86", "#8B5CF6"],
};
export const LOOKS: LookSpec[] = [
  DARK,
  { id: "light", group: "classic", label: "Light", note: "Dark text on solid white, made for bright sun.",
    fg: "#1B1A1D", base: "#FFFFFF", surface: "#F6F3F5", acc: "#C8366B", acc2: "#6D3FD6",
    ok: "#17804F", warn: "#9A5B00", bad: "#C0302A", info: "#1D5FC9", font: "inter", opaque: 0.97, swatch: ["#FFFFFF", "#C8366B", "#1B1A1D"] },
  { id: "midnight", group: "classic", label: "Midnight", note: "Solid near black, no glass, for an OLED screen or a dark room.",
    fg: "#F2F2F5", base: "#000000", surface: "#0E0E12", acc: "#EC4E86", acc2: "#8B5CF6",
    ok: "#34D399", warn: "#FBBF24", bad: "#FF6B6B", info: "#60A5FA", font: "inter", opaque: 0.96, swatch: ["#000000", "#EC4E86", "#F2F2F5"] },

  // The Notebook looks (V1.30, reworked on the engine in V1.31): the paper colours of src/views/notebook.css.
  { id: "legal", group: "notebook", label: "Legal pad", note: "Yellow ruled paper, a red double margin, a stitched leather top and a felt marker.",
    fg: "#2E2219", base: "#FBEC9E", surface: "#FFF4B8", acc: "#B42A27", acc2: "#6A43C9",
    ok: "#2F6F3E", warn: "#8A5A00", bad: "#B42A27", info: "#2C5C93", font: "patrick", hand: "legal", radius: 0.7, swatch: ["#FBEC9E", "#B42A27", "#2E2219"] },
  { id: "composition", group: "notebook", label: "Composition", note: "A marbled cover band, white college ruled paper and blue lines.",
    fg: "#1F2C66", base: "#FDFDFB", surface: "#FFFFFF", acc: "#C0313B", acc2: "#5B3CC4",
    ok: "#23743F", warn: "#8F5A00", bad: "#C0313B", info: "#2556B8", font: "patrick", hand: "composition", radius: 0.7, swatch: ["#FDFDFB", "#C0313B", "#1F2C66"] },
  { id: "graph", group: "notebook", label: "Graph paper", note: "A green engineering grid, a technical pencil and stamped labels.",
    fg: "#2C3036", base: "#F3F8EE", surface: "#F7FBF3", acc: "#B9480C", acc2: "#5B44B8",
    ok: "#2D7A4E", warn: "#8A5A00", bad: "#B83228", info: "#2B6A8F", font: "architects", hand: "graph", radius: 0.3, density: "dense", swatch: ["#F3F8EE", "#B9480C", "#2C3036"] },
  { id: "kraft", group: "notebook", label: "Kraft dotted", note: "Cream dotted paper in a kraft cover with an elastic band and a fountain pen.",
    fg: "#1D2440", base: "#F5EEDC", surface: "#F8F2E4", acc: "#9E2B2B", acc2: "#5A3E9E",
    ok: "#2E6B3C", warn: "#835600", bad: "#9E2B2B", info: "#2A4F86", font: "patrick", hand: "kraft", radius: 0.8, swatch: ["#F5EEDC", "#9E2B2B", "#1D2440"] },
  { id: "chalk", group: "notebook", label: "Chalkboard", note: "A dark slate with a wooden frame and white chalk. The dark notebook.",
    fg: "#F2F1EA", base: "#2D3B35", surface: "#33433C", acc: "#F6A7C3", acc2: "#CDB6FF",
    ok: "#9BE3A8", warn: "#F7DD7A", bad: "#FF9C93", info: "#9CCBFF", font: "patrick", hand: "chalk", radius: 0.7, swatch: ["#2D3B35", "#F6A7C3", "#F2F1EA"] },
];

// Productivity looks join here from src/core/looks-productivity.ts (the research file's proposals).
export function registerLooks(more: LookSpec[]) {
  for (const l of more) if (!LOOKS.some((x) => x.id === l.id)) LOOKS.push(l);
}

export const DEFAULT_LOOK = "dark";
export function lookById(id: unknown): LookSpec {
  return LOOKS.find((l) => l.id === id) ?? DARK;
}
export const NOTEBOOK_IDS = new Set(["legal", "composition", "graph", "kraft", "chalk"]);
/** Is this look one a person may use right now? The five Notebook looks only while NOTEBOOK_ON (core/features.ts). */
export const lookOffered = (id: unknown) => typeof id === "string" && LOOKS.some((l) => l.id === id) && (NOTEBOOK_ON || !NOTEBOOK_IDS.has(id));
/** THE list of looks to show or to pick from (Settings, Appearance, any "Page look" menu): every look except the
 *  ones switched off. Read it when drawing (looks join later through registerLooks), never keep a copy. */
export const offeredLooks = (): LookSpec[] => LOOKS.filter((l) => lookOffered(l.id));

// ---------- type, size and density ----------
export const FONTS: { id: string; label: string; css: string; note: string }[] = [
  { id: "inter", label: "Inter", css: "\"Inter Variable\", Inter, system-ui, -apple-system, sans-serif", note: "The PS app font: tall letters made for screens." },
  { id: "system", label: "System", css: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", Roboto, system-ui, sans-serif", note: "San Francisco on the Mac, Roboto on the phone." },
  { id: "plex", label: "IBM Plex", css: "\"PS Plex\", \"Inter Variable\", system-ui, sans-serif", note: "A little narrower than Inter, so more fits on a row (bundled)." },
  { id: "atkinson", label: "Atkinson", css: "\"PS Atkinson\", \"Inter Variable\", system-ui, sans-serif", note: "Made for low vision: letters you could mix up look different (bundled)." },
  { id: "rounded", label: "Rounded", css: "ui-rounded, \"SF Pro Rounded\", \"PS Atkinson\", system-ui, sans-serif", note: "Soft rounded letters (SF Rounded on the Mac)." },
  { id: "serif", label: "Serif", css: "\"PS Source Serif\", ui-serif, Georgia, serif", note: "Source Serif, a book face tuned for screens (bundled)." },
  { id: "mono", label: "Mono", css: "\"PS JetBrains Mono\", ui-monospace, Menlo, monospace", note: "Every letter the same width, like code (bundled)." },
  { id: "patrick", label: "Hand", css: "\"PS Patrick Hand\", \"Marker Felt\", cursive", note: "Neat handwriting (bundled)." },
  { id: "architects", label: "Drafting", css: "\"PS Architects Daughter\", \"PS Patrick Hand\", cursive", note: "An architect's hand (bundled)." },
];
export const MONOS: Record<string, string> = {
  jetbrains: "\"PS JetBrains Mono\", ui-monospace, Menlo, monospace",
  plex: "\"PS Plex Mono\", ui-monospace, Menlo, monospace",
  atkinson: "\"PS Atkinson Mono\", ui-monospace, Menlo, monospace",
};
export function fontCss(id: unknown): string {
  return (FONTS.find((f) => f.id === id) ?? FONTS[0]).css;
}

export type Density = "dense" | "comfortable" | "focus";
/** Spacing scale (padding and gaps) and a small text nudge per density. Dense is for the developer ("I like a lot of information"). */
export const DENSITIES: { id: Density; label: string; note: string; space: number; text: number }[] = [
  { id: "dense", label: "Information dense", note: "Tighter rows and gaps, slightly smaller type: the most on screen.", space: 0.8, text: 0.94 },
  { id: "comfortable", label: "Comfortable", note: "The spacing PS app always had.", space: 1, text: 1 },
  { id: "focus", label: "Focus", note: "More air and bigger type, fewer things at once.", space: 1.2, text: 1.08 },
];
export const TEXT_SIZES: { v: number; label: string }[] = [
  { v: 90, label: "Small" }, { v: 100, label: "Normal" }, { v: 112, label: "Large" }, { v: 125, label: "Larger" }, { v: 140, label: "Largest" },
];

// ---------- the Working on look (the task you are working on, the developer 4 Nov 2026: "add a few more so I can decide") ----------
export const WORK_STYLES: { id: string; label: string; note: string }[] = [
  { id: "white", label: "White glow", note: "The task turns solid white with a soft white halo. The PS app original." },
  { id: "glow", label: "Accent glow", note: "A soft wash and halo in the look's accent; the text stays in the page colours." },
  { id: "pulse", label: "Pulse", note: "An accent border that slowly breathes, about once every three seconds." },
  { id: "orbit", label: "Orbit", note: "A gradient edge in the accent that travels slowly round the task." },
  { id: "bar", label: "Accent bar", note: "A thick accent bar on the left with a gentle shimmer running down it." },
  { id: "lift", label: "Raised card", note: "The task lifts off the page: a solid card, a deep shadow and a little bigger." },
  { id: "marker", label: "Highlighter", note: "A highlighter swipe under the words, like on paper. Made for the Notebook looks." },
  { id: "lightning", label: "Red lightning", note: "Red bolts strike across the task and the edge flashes." },
];
const WORK_IDS = new Set(WORK_STYLES.map((w) => w.id));
/** A saved or posted Working on look, checked: unknown is the white glow. */
export function workStyle(v: unknown): string { return typeof v === "string" && WORK_IDS.has(v) ? v : "white"; }
/** Styles that keep the page colours on the working task (not the inverted white): the overlay also gets ws-own. */
export const OWN_WORK = new Set(["glow", "pulse", "orbit", "bar", "lift", "marker"]);

/** The working task's own colours for a look: its tint (the ink must read on it at 7:1), a solid raised card, and the
 *  highlighter (the ink must read on it at 4.5:1). Always set, the default look included; only the new styles use them. */
export function workTokens(fg: string, surface: string, acc: string): Tokens {
  const light = isLight(surface);
  let tint = mix(acc, surface, light ? 0.14 : 0.2);
  for (let t = light ? 0.14 : 0.2; t > 0 && contrast(fg, tint) < 7; t -= 0.02) tint = mix(acc, surface, t);
  let hl = mix(acc, surface, 0.42);
  for (let t = 0.42; t > 0 && contrast(fg, hl) < 4.5; t -= 0.02) hl = mix(acc, surface, t);
  const card = light ? "#FFFFFF" : mix(fg, surface, 0.08);
  const edge = readable(acc, [tint, card, surface], 3);   // the accent edge and halo must still show on the tint and the card
  return { "--k-work-bg": tint, "--k-work-card": card, "--k-hl": hl, "--k-work-edge": edge };
}

// ---------- accent ----------
export const ACCENT_PRESETS: { c: string; label: string }[] = [
  { c: "#EC4E86", label: "Cincee pink" }, { c: "#8B5CF6", label: "Violet" }, { c: "#3B82F6", label: "Blue" },
  { c: "#14B8A6", label: "Teal" }, { c: "#22C55E", label: "Green" }, { c: "#F59E0B", label: "Amber" },
  { c: "#F97316", label: "Orange" }, { c: "#EF4444", label: "Red" }, { c: "#94A3B8", label: "Slate" },
];

// ---------- settings ----------
export type Appearance = { look: string; accent: string | null; density: Density; text: number; font: string | null };
export type AppearanceSettings = {
  look?: string; lookAccent?: Record<string, string>; lookDensity?: string; lookText?: number; lookFont?: string | null;
  tmTheme?: string; tmNotebook?: string;
};
export function validHex(v: unknown): string | null {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : null;
}
/** The look as saved, falling back to the V1.30 settings (tmNotebook, tmTheme) for a vault that has not picked one. */
export function resolveAppearance(s: AppearanceSettings): Appearance {
  // A saved look that is switched off (Notebook, core/features.ts) counts as no choice: the normal look, nothing
  // written back, so the saved choice is still there when the switch is turned on.
  let look = lookOffered(s.look) ? (s.look as string) : "";
  if (!look) look = s.tmNotebook && NOTEBOOK_IDS.has(s.tmNotebook) && NOTEBOOK_ON ? s.tmNotebook : s.tmTheme === "light" ? "light" : DEFAULT_LOOK;
  const spec = lookById(look);
  const density: Density = (["dense", "comfortable", "focus"] as const).find((d) => d === s.lookDensity) ?? spec.density ?? "comfortable";
  const text = Number.isFinite(s.lookText) ? Math.max(80, Math.min(150, Math.round(s.lookText as number))) : 100;
  const font = typeof s.lookFont === "string" && FONTS.some((f) => f.id === s.lookFont) ? s.lookFont : null;
  return { look, accent: validHex(s.lookAccent?.[look]), density, text, font };
}
/** A looks patch from the Tab list or the phone, checked before it is saved (ps.ts cleanLooks calls this). */
export function cleanAppearance(p: Record<string, unknown>): AppearanceSettings {
  const o: AppearanceSettings = {};
  if (typeof p.look === "string" && LOOKS.some((l) => l.id === p.look)) o.look = p.look;
  if (p.lookAccent && typeof p.lookAccent === "object") {
    const a: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.lookAccent as Record<string, unknown>).slice(0, 60)) {
      const c = validHex(v);
      if (c && /^[a-z0-9-]{1,32}$/.test(k)) a[k] = c;
    }
    o.lookAccent = a;
  }
  if (p.lookDensity === "dense" || p.lookDensity === "comfortable" || p.lookDensity === "focus") o.lookDensity = p.lookDensity;
  if (Number.isFinite(Number(p.lookText)) && p.lookText !== null) o.lookText = Math.max(80, Math.min(150, Math.round(Number(p.lookText))));
  if (p.lookFont === null) o.lookFont = null;
  else if (typeof p.lookFont === "string" && FONTS.some((f) => f.id === p.lookFont)) o.lookFont = p.lookFont;
  return o;
}

// ---------- tokens ----------
export const FAMILIES = ["acc", "acc2", "ok", "warn", "bad", "info"] as const;
export type Family = typeof FAMILIES[number];

/** The ink boost for alpha text: the CSS writes hints as the ink at 45 to 60 percent. On paper that is too faint, so a
 *  light look scales those alphas up (min(100%, a * boost)). The smallest boost that passes the guard is chosen. */
export function inkBoost(fg: string, base: string, surface: string): number {
  for (let b = 1; b <= 2.4; b += 0.05) {
    const pass = [base, surface].every((bg) => contrast(over(fg, bg, Math.min(1, 0.55 * b)), bg) >= 4.5 && contrast(over(fg, bg, Math.min(1, 0.4 * b)), bg) >= 3);
    if (pass) return Math.round(b * 100) / 100;
  }
  return 2.4;
}

export type Tokens = Record<string, string>;
/** Every token for a look, with the accent, type, size and density the developer chose. The default look with nothing chosen
 *  gives only the size tokens (all 1), so the page is the old dark glass to the pixel. */
export function buildTokens(a: Appearance): Tokens {
  const spec = lookById(a.look);
  const t: Tokens = {};
  const dens = DENSITIES.find((d) => d.id === a.density) ?? DENSITIES[1];
  const fs = (a.text / 100) * dens.text * (spec.textScale ?? 1);
  if (fs !== 1) t["--k-fs"] = String(Math.round(fs * 1000) / 1000);
  if (dens.space !== 1) t["--k-dn"] = String(dens.space);
  if (spec.radius && spec.radius !== 1) t["--k-rd"] = String(spec.radius);
  const font = a.font ?? (spec.id === DEFAULT_LOOK ? null : spec.font ?? null);
  if (font) { t["--k-font"] = fontCss(font); t["--font"] = fontCss(font); }
  if (spec.mono && MONOS[spec.mono]) t["--k-mono"] = MONOS[spec.mono];
  if (spec.heading) t["--k-head"] = fontCss(spec.heading);
  const isDefault = spec.id === DEFAULT_LOOK;
  if (isDefault && !a.accent) return Object.assign(t, workTokens(spec.fg, spec.surface, spec.acc));

  const { fg, base, surface } = spec;
  const bgs = [base, surface];
  const fam = (id: Family, color: string, asText?: string) => {
    const fill = readable(color, bgs, 3);                 // a fill or a line must stand out 3:1 (UI)
    const tint = mix(fill, surface, isLight(base) ? 0.14 : 0.22);
    const text = readable(asText ?? color, [...bgs, tint], 4.5);    // as text 4.5:1 (body), on the page, a card and its own tint
    const on = onFill(fill, isLight(base) ? fg : "#111111", "#FFFFFF");
    t[`--k-${id}`] = fill; t[`--k-${id}-t`] = text; t[`--k-${id}-bg`] = tint; t[`--k-on-${id}`] = readable(on, [fill], 4.5);
  };
  const acc = a.accent ?? spec.acc;
  if (!isDefault) {
    t["--k-fg"] = fg; t["--k-base"] = base; t["--k-surface"] = surface;
    const boost = inkBoost(fg, base, surface);
    if (boost !== 1) t["--k-ia"] = String(boost);
    if (spec.opaque) t["--k-cover"] = `${Math.round(spec.opaque * 100)}%`;   // engine.ts marks the page solid
    if (isLight(base)) { t["--k-tsh"] = "transparent"; t["--k-glow"] = "transparent"; }
    fam("ok", spec.ok); fam("warn", spec.warn); fam("bad", spec.bad); fam("info", spec.info);
  }
  fam("acc", acc, a.accent ? undefined : spec.accText);
  fam("acc2", a.accent ?? spec.acc2 ?? spec.acc, a.accent ? undefined : spec.acc2 ? undefined : spec.accText);
  if (!isDefault) {
    const pr = spec.prio ?? [spec.bad, spec.warn, spec.info, over(fg, surface, 0.6)];
    pr.forEach((c, i) => { t[`--k-p${i + 1}`] = readable(c, bgs, 4.5); });
    // Fitness (its own gold under the default look) takes the look's accent; a second surface for its cards
    t["--k-fit"] = t["--k-acc"]; t["--k-fit-t"] = t["--k-acc-t"]; t["--k-on-fit"] = t["--k-on-acc"];
    t["--k-surface2"] = mix(fg, surface, isLight(base) ? 0.05 : 0.07);
    // the Notes window's own palette (views/notes.css)
    Object.assign(t, { "--nt-acc": t["--k-acc-t"], "--nt-acc-bg": t["--k-acc-bg"], "--nt-bg": surface, "--nt-side": base,
      "--nt-line": over(fg, surface, 0.14), "--nt-ink": fg, "--nt-muted": readable(over(fg, surface, 0.6), bgs, 4.5), "--nt-sel": mix(t["--k-acc"], surface, 0.25) });
  }
  // the website's own colour names, used by the shared parts (buttons, pills, fields, the Mac settings sections)
  Object.assign(t, workTokens(spec.fg, spec.surface, t["--k-acc"]));
  t["--pink"] = t["--k-acc"]; t["--pink-d"] = t["--k-acc-t"]; t["--pink-dd"] = t["--k-acc-t"];
  t["--pink-l"] = mix(t["--k-acc"], isDefault ? "#17121A" : surface, 0.35);
  t["--blush"] = t["--k-acc-bg"]; t["--soft"] = t["--k-acc-bg"];
  t["--claude"] = t["--k-acc2-t"]; t["--claude-bg"] = t["--k-acc2-bg"];
  if (!isDefault) {
    Object.assign(t, {
      "--ink": fg, "--ink-2": over(fg, surface, 0.86), "--muted": readable(over(fg, surface, 0.62), bgs, 4.5),
      "--line": over(fg, surface, 0.14), "--line-2": over(fg, surface, 0.24),
      "--surface": surface, "--bg": base, "--raise": mix(fg, surface, 0.04),
      "--good": t["--k-ok-t"], "--good-bg": t["--k-ok-bg"], "--warn": t["--k-warn-t"], "--warn-bg": t["--k-warn-bg"],
      "--bad": t["--k-bad-t"], "--bad-bg": t["--k-bad-bg"],
    });
  }
  return t;
}

/** Every text and background pair a look puts on screen, with the ratio it must reach. The unit test and the
 *  custom accent check both run this. */
export function guardPairs(a: Appearance): { what: string; fg: string; bg: string; min: number }[] {
  const spec = lookById(a.look);
  const t = buildTokens(a);
  const fg = t["--k-fg"] ?? spec.fg, base = t["--k-base"] ?? spec.base, surface = t["--k-surface"] ?? spec.surface;
  const boost = Number(t["--k-ia"] ?? 1);
  const out: { what: string; fg: string; bg: string; min: number }[] = [];
  for (const [bn, bg] of [["page", base], ["card", surface]] as const) {
    out.push({ what: `text on ${bn}`, fg, bg, min: 7 });
    out.push({ what: `muted text (55%) on ${bn}`, fg: over(fg, bg, Math.min(1, 0.55 * boost)), bg, min: 4.5 });
    out.push({ what: `faint text (40%) on ${bn}`, fg: over(fg, bg, Math.min(1, 0.4 * boost)), bg, min: 3 });
    for (const f of FAMILIES) {
      if (!t[`--k-${f}`]) continue;
      out.push({ what: `${f} text on ${bn}`, fg: t[`--k-${f}-t`], bg, min: 4.5 });
      out.push({ what: `${f} line on ${bn}`, fg: t[`--k-${f}`], bg, min: 3 });
    }
  }
  for (const f of FAMILIES) {
    if (!t[`--k-${f}`]) continue;
    out.push({ what: `text on the ${f} fill`, fg: t[`--k-on-${f}`], bg: t[`--k-${f}`], min: 4.5 });
    out.push({ what: `${f} text on its tint`, fg: t[`--k-${f}-t`], bg: t[`--k-${f}-bg`], min: 4.5 });
  }
  if (t["--muted"]) out.push({ what: "website muted on card", fg: t["--muted"], bg: surface, min: 4.5 });
  // the Working on looks: the task's words on its tint, its raised card and the highlighter
  out.push({ what: "working task text on its tint", fg, bg: t["--k-work-bg"], min: 7 });
  out.push({ what: "working task text on its raised card", fg, bg: t["--k-work-card"], min: 7 });
  out.push({ what: "working task text on the highlighter", fg, bg: t["--k-hl"], min: 4.5 });
  out.push({ what: "accent edge on the working tint", fg: t["--k-work-edge"], bg: t["--k-work-bg"], min: 3 });
  out.push({ what: "accent edge on the raised card", fg: t["--k-work-edge"], bg: t["--k-work-card"], min: 3 });
  if (t["--k-acc-t"]) out.push({ what: "Working on label on the working tint", fg: t["--k-acc-t"], bg: t["--k-work-bg"], min: 4.5 });
  return out;
}
export function guardFails(a: Appearance) {
  return guardPairs(a).map((p) => ({ ...p, ratio: Math.round(contrast(p.fg, p.bg) * 100) / 100 })).filter((p) => p.ratio < p.min);
}

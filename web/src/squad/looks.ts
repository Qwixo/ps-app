// G Squad Appearance (V1.47), the developer 10 Nov 2026: "let you adjust appearance options". Only the G Squad screen: light or
// dark or follow PS, an accent colour, the chat bubble style, the text size and the background. Kept on this device
// (like Fitness light and dark): a Mac at a desk and a phone can differ, and nothing about it ever goes to the squad.
// Rules only here, no DOM: views/GSquadWindow.tsx turns them into classes and a few CSS variables (views/gswin.css).

export type GsTheme = "ps" | "light" | "dark";
export type GsBubbles = "round" | "soft" | "square";
export type GsText = "m" | "l" | "xl" | "xxl";
export type GsBg = "glow" | "dots" | "plain" | "wash";
export interface GsLooks { theme: GsTheme; accent: string; bubbles: GsBubbles; text: GsText; bg: GsBg }

/** "ps" follows the PS look's own accent; the rest are fixed colours with readable text on them. */
export const ACCENTS: { id: string; label: string; c: string; c2: string; on: string }[] = [
  { id: "ps", label: "Follow PS app", c: "", c2: "", on: "" },
  { id: "rose", label: "Rose", c: "#E8457F", c2: "#9B5CF6", on: "#FFFFFF" },
  { id: "violet", label: "Violet", c: "#8B5CF6", c2: "#4F7CFF", on: "#FFFFFF" },
  { id: "blue", label: "Blue", c: "#3B82F6", c2: "#22B8CF", on: "#FFFFFF" },
  { id: "teal", label: "Teal", c: "#14B8A6", c2: "#3B82F6", on: "#04201C" },
  { id: "green", label: "Green", c: "#22C55E", c2: "#14B8A6", on: "#052E14" },
  { id: "amber", label: "Amber", c: "#F5A524", c2: "#EF5B3A", on: "#2A1700" },
  { id: "coral", label: "Coral", c: "#F2604B", c2: "#E8457F", on: "#FFFFFF" },
];
export const THEMES: { id: GsTheme; label: string }[] = [
  { id: "ps", label: "Follow PS app" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" },
];
export const BUBBLES: { id: GsBubbles; label: string }[] = [
  { id: "round", label: "Round" }, { id: "soft", label: "Soft" }, { id: "square", label: "Square" },
];
/** V1.47 starts bigger than before ("make everything much bigger"): Large is the default. */
export const TEXTS: { id: GsText; label: string; scale: number }[] = [
  { id: "m", label: "Medium", scale: 1.08 }, { id: "l", label: "Large", scale: 1.22 }, { id: "xl", label: "Larger", scale: 1.38 }, { id: "xxl", label: "Largest", scale: 1.56 },
];
export const BGS: { id: GsBg; label: string }[] = [
  { id: "glow", label: "Glow" }, { id: "dots", label: "Dots" }, { id: "wash", label: "Colour wash" }, { id: "plain", label: "Plain" },
];
export const DEFAULT_LOOKS: GsLooks = { theme: "ps", accent: "ps", bubbles: "round", text: "l", bg: "glow" };

const pick = <T extends string>(v: unknown, list: { id: T }[], d: T): T => (list.some((x) => x.id === v) ? (v as T) : d);
/** Anything unknown falls back to the default, field by field. */
export function cleanLooks(v: unknown): GsLooks {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    theme: pick(o.theme, THEMES, DEFAULT_LOOKS.theme),
    accent: pick(o.accent, ACCENTS, DEFAULT_LOOKS.accent),
    bubbles: pick(o.bubbles, BUBBLES, DEFAULT_LOOKS.bubbles),
    text: pick(o.text, TEXTS, DEFAULT_LOOKS.text),
    bg: pick(o.bg, BGS, DEFAULT_LOOKS.bg),
  };
}
export const textScale = (t: GsText) => TEXTS.find((x) => x.id === t)?.scale ?? 1.22;

/** The classes on the G Squad screen. */
export function looksClass(l: GsLooks): string {
  return `th-${l.theme} bb-${l.bubbles} bg-${l.bg}${l.accent !== "ps" ? " acc-own" : ""}`;
}
/** The CSS variables on the G Squad screen (set on it, so everything inside follows): the text size times PS's own
 *  text size, and the accent unless it follows PS. Every G Squad style already reads these look tokens. */
export function looksVars(l: GsLooks, psFs: number): Record<string, string> {
  const fs = Number.isFinite(psFs) && psFs > 0 ? psFs : 1;
  const out: Record<string, string> = { "--k-fs": String(Math.round(fs * textScale(l.text) * 1000) / 1000) };
  const a = ACCENTS.find((x) => x.id === l.accent);
  if (a && a.id !== "ps") { out["--k-acc"] = a.c; out["--k-acc2"] = a.c2; out["--k-on-acc"] = a.on; out["--k-acc-t"] = a.c; }
  return out;
}

// ---------- kept on this device ----------
export const LOOKS_KEY = "gsquad.looks";
type Store = Pick<Storage, "getItem" | "setItem">;
function safeStore(): Store | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
export function readLooks(store: Pick<Storage, "getItem"> | null = safeStore()): GsLooks {
  try { const raw = store?.getItem(LOOKS_KEY); return cleanLooks(raw ? JSON.parse(raw) : null); } catch { return { ...DEFAULT_LOOKS }; }
}
export function saveLooks(l: GsLooks, store: Pick<Storage, "setItem"> | null = safeStore()) {
  try { store?.setItem(LOOKS_KEY, JSON.stringify(cleanLooks(l))); } catch { /* storage off: this session only */ }
}

let now: GsLooks | null = null;
const subs = new Set<() => void>();
export const looksStore = {
  subscribe(l: () => void) { subs.add(l); return () => { subs.delete(l); }; },
  get(): GsLooks { if (!now) now = readLooks(); return now; },
};
/** Changes one or more choices; the screen follows at once (a live preview, the developer 8 Nov 2026: every appearance choice
 *  must show straight away). */
export function setLooks(p: Partial<GsLooks>) {
  now = cleanLooks({ ...looksStore.get(), ...p });
  saveLooks(now);
  subs.forEach((f) => f());
}

// Rain over the Tab list (V1.40, the developer 7 Nov 2026: "a rain effect... multiple different rain effects. It's quite
// soothing, to some people it's therapeutic to see rain"). Pure rules, no DOM: the kinds, the saved settings, how many
// drops each kind draws for a screen size, and when it may run. The drawing is views/Rain.tsx (Canvas 2D, no WebGL).
// Saved in the vault settings (synced): tmRain (a kind id, default "off") and tmRainAmount (0 to 100, default 50).

export type RainId = "off" | "drizzle" | "steady" | "windy" | "storm" | "glass";
export const RAIN_KINDS: { id: RainId; label: string; note: string }[] = [
  { id: "off", label: "No rain", note: "Nothing falls. The default." },
  { id: "drizzle", label: "Light drizzle", note: "Fine, slow drops, far apart. The quietest one." },
  { id: "steady", label: "Steady rain", note: "An even shower falling straight down." },
  { id: "windy", label: "Windswept", note: "Rain blown at a slant, with slow gusts." },
  { id: "storm", label: "Heavy storm", note: "Fast, dense rain and now and then a soft lightning flash." },
  { id: "glass", label: "Rain on glass", note: "Drops land on the screen and slowly run down it, leaving trails." },
];
const IDS = new Set<string>(RAIN_KINDS.map((k) => k.id));
export const RAIN_DEFAULT_AMOUNT = 50;
/** The most drops any kind draws at once, whatever the screen (keeps every frame cheap). */
export const MAX_DROPS = 700;
/** Frames are drawn at most this often (60 a second), even on a 120 Hz screen: half the work, looks the same. */
export const FRAME_MS = 1000 / 60;

/** A saved or posted rain kind, checked: unknown is off. */
export const rainKind = (v: unknown): RainId => (typeof v === "string" && IDS.has(v) ? (v as RainId) : "off");
/** A saved or posted amount, 0 to 100 (whole numbers), default 50. */
export function rainAmount(v: unknown): number {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? RAIN_DEFAULT_AMOUNT : Math.max(0, Math.min(100, Math.round(n)));
}

export type RainSpec = {
  /** How many drops (or beads on glass) at once. */
  drops: number;
  /** Fall speed, screen heights per second (the far layer gets the low end). */
  speed: [number, number];
  /** Streak length in px (at 1x). */
  len: [number, number];
  /** Sideways drift per px of fall (0 straight down). */
  slant: number;
  /** How much the slant swings with the gusts (0 none). */
  gust: number;
  /** Streak opacity, far to near. */
  alpha: [number, number];
  /** Streak width in px (at 1x). */
  width: number;
  /** Seconds between lightning flashes (storm only), else null. */
  flash: [number, number] | null;
  /** Rain on glass: beads that sit and run down, not falling streaks. */
  glass: boolean;
};

/** What a kind draws on a screen of w by h css px at an amount (0 to 100). Off gives 0 drops. */
export function rainSpec(kind: RainId, amount: number, w: number, h: number): RainSpec {
  const a = 0.2 + 0.8 * Math.max(0, Math.min(100, amount)) / 100;     // even 0 keeps a few drops: Off is the kind, not the slider
  const area = Math.max(0.25, Math.min(3, (Math.max(0, w) * Math.max(0, h)) / (1440 * 900)));
  const n = (base: number) => Math.max(0, Math.min(MAX_DROPS, Math.round(base * a * area)));
  switch (kind) {
    case "drizzle": return { drops: n(110), speed: [0.45, 0.7], len: [6, 12], slant: 0.04, gust: 0.02, alpha: [0.12, 0.3], width: 1, flash: null, glass: false };
    case "steady": return { drops: n(260), speed: [0.9, 1.35], len: [14, 26], slant: 0.02, gust: 0, alpha: [0.14, 0.38], width: 1.1, flash: null, glass: false };
    case "windy": return { drops: n(280), speed: [1.0, 1.5], len: [16, 28], slant: 0.38, gust: 0.16, alpha: [0.14, 0.36], width: 1.1, flash: null, glass: false };
    case "storm": return { drops: n(520), speed: [1.6, 2.3], len: [22, 40], slant: 0.18, gust: 0.1, alpha: [0.16, 0.44], width: 1.3, flash: [7, 18], glass: false };
    case "glass": return { drops: n(150), speed: [0.05, 0.16], len: [0, 0], slant: 0, gust: 0, alpha: [0.35, 0.7], width: 1, flash: null, glass: true };
    default: return { drops: 0, speed: [0, 0], len: [0, 0], slant: 0, gust: 0, alpha: [0, 0], width: 0, flash: null, glass: false };
  }
}

/** Whether rain may draw frames now: a kind is on, the list is showing, the page is visible and Reduce motion is off.
 *  Anything else stops the frame loop completely (no work at all while PS is hidden). */
export function rainRuns(o: { kind: RainId; shown: boolean; visible: boolean; reduced: boolean; docked: boolean }): boolean {
  return o.kind !== "off" && o.shown && o.visible && !o.reduced && !o.docked;
}

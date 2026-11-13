// Mouse trail (V1.43, the developer 8 Nov 2026: "when I hover over tasks I see a little white shadow that follows me, which I
// really like, but I want to edit it in Settings: multiple options, like red lightning sparks following my mouse (change
// the colour of the sparks), a fire sparkler, a blade that follows you around... a bunch of different effects").
// Pure rules, no DOM: the effects, the saved setting, what reduced motion and touch screens get, and the particle caps
// that keep every frame cheap. The drawing is views/Trail.tsx (one Canvas 2D layer, no WebGL); Settings is
// views/MouseTrail.tsx. Saved in the vault settings (synced) as tmTrail. Unset is Glow: the soft spotlight the rows have
// always had, drawn by CSS (views/taskmap.css .tm-fx::before), exactly as before.

export type TrailId =
  | "off" | "glow" | "sparks" | "lightning" | "sparkler" | "blade" | "comet" | "neon" | "laser" | "orb"
  | "embers" | "stardust" | "bubbles" | "snow" | "rainbow" | "pixels";

/** "multi": the effect's own mix of colours (the full rainbow). Else "#rrggbb". */
export type TrailColour = string;

export type TrailKind = {
  id: TrailId;
  label: string;
  /** One plain line for its tile and the note under the picker. */
  note: string;
  /** Its own colour until you pick one. */
  colour: TrailColour;
  /** It can show its own mix of colours ("multi"). */
  multi?: boolean;
  /** Drawn on the canvas (everything but Off and Glow). */
  canvas: boolean;
};

export const TRAIL_KINDS: TrailKind[] = [
  { id: "glow", label: "Glow", note: "The soft light that follows your mouse over a task. The default.", colour: "#ffffff", canvas: false },
  { id: "sparks", label: "Sparks", note: "Bright sparks fly off behind your mouse and fall away.", colour: "#ff4632", canvas: true },
  { id: "lightning", label: "Lightning", note: "Forked bolts crackle between the places your mouse just was.", colour: "#ff2e4c", canvas: true },
  { id: "sparkler", label: "Fire sparkler", note: "A white hot tip throwing crackling golden sparks that split as they burn.", colour: "#ffb43c", canvas: true },
  { id: "blade", label: "Blade", note: "A sword slash that follows you and swishes wider the faster you move.", colour: "#cfe4ff", canvas: true },
  { id: "comet", label: "Comet", note: "A glowing head with a long tail that tapers away behind it.", colour: "#8ccfff", canvas: true },
  { id: "neon", label: "Neon ribbon", note: "A smooth ribbon of neon light that trails your path.", colour: "#ff2bd6", canvas: true },
  { id: "laser", label: "Laser", note: "A thin, very bright beam with a burning tip.", colour: "#ff2020", canvas: true },
  { id: "orb", label: "Electric orb", note: "A ball of light that chases your mouse with arcs crackling round it.", colour: "#55d6ff", canvas: true },
  { id: "embers", label: "Embers", note: "Glowing embers drift up and flicker out.", colour: "#ff7a1a", canvas: true },
  { id: "stardust", label: "Stardust", note: "Tiny stars twinkle and drift where you have been.", colour: "#ffe7a0", canvas: true },
  { id: "bubbles", label: "Bubbles", note: "Soap bubbles float up, wobble and pop.", colour: "#9fe6ff", canvas: true },
  { id: "snow", label: "Snow", note: "Snowflakes fall gently from your mouse.", colour: "#ffffff", canvas: true },
  { id: "rainbow", label: "Rainbow", note: "A ribbon that runs through every colour.", colour: "multi", multi: true, canvas: true },
  { id: "pixels", label: "Pixels", note: "A blocky retro trail that fades out in steps.", colour: "#5cff8a", canvas: true },
  { id: "off", label: "Off", note: "Nothing follows your mouse.", colour: "#ffffff", canvas: false },
];
const BY_ID = new Map<string, TrailKind>(TRAIL_KINDS.map((k) => [k.id, k]));

/** Colours to pick in one click (the colour wheel does the rest). */
export const TRAIL_PRESETS: string[] = ["#ffffff", "#ff2e4c", "#ff7a1a", "#ffc83c", "#5cff8a", "#55d6ff", "#4b6bff", "#a35cff", "#ff2bd6"];

export type TrailFx = {
  /** Colour: "#rrggbb", or "multi" for an effect's own mix. */
  c: TrailColour;
  /** Size, 0 to 100 (50 is the effect's normal size). */
  s: number;
  /** Intensity, 0 to 100 (50 is normal): how much it draws and how bright. */
  i: number;
};
export type TrailPrefs = {
  kind: TrailId;
  /** A pop of the effect where you click (off by default). */
  burst: boolean;
  /** Each effect keeps its own colour, size and intensity (switching back finds them as you left them). */
  fx: Partial<Record<TrailId, TrailFx>>;
};
export const TRAIL_DEFAULT: TrailPrefs = { kind: "glow", burst: false, fx: {} };
export const FX_SIZE = 50, FX_INTENSITY = 50;

const HEX = /^#[0-9a-f]{6}$/i;
const pct = (v: unknown, d: number) => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || typeof v === "boolean" || !Number.isFinite(n) ? d : Math.max(0, Math.min(100, Math.round(n)));
};

/** A saved or posted effect id, checked: unknown is Glow (nothing changes for anyone who never touched it). */
export const trailKind = (v: unknown): TrailId => (typeof v === "string" && BY_ID.has(v) ? (v as TrailId) : "glow");
export const trailInfo = (id: TrailId): TrailKind => BY_ID.get(id) ?? BY_ID.get("glow")!;

/** One effect's colour, size and intensity, checked: a colour it cannot show is its own colour. */
export function cleanFx(kind: TrailId, v: unknown): TrailFx {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const k = trailInfo(kind);
  const c = typeof o.c === "string" && (HEX.test(o.c) || (o.c === "multi" && k.multi)) ? o.c.toLowerCase() : k.colour;
  return { c, s: pct(o.s, FX_SIZE), i: pct(o.i, FX_INTENSITY) };
}

/** The saved setting, checked. Anything unknown falls back to the default; an effect left at its defaults is not kept. */
export function trailPrefs(v: unknown): TrailPrefs {
  if (!v || typeof v !== "object") return { ...TRAIL_DEFAULT, fx: {} };
  const o = v as Record<string, unknown>;
  const fx: TrailPrefs["fx"] = {};
  if (o.fx && typeof o.fx === "object") {
    for (const [id, raw] of Object.entries(o.fx as Record<string, unknown>)) {
      if (!BY_ID.has(id) || id === "off") continue;
      const f = cleanFx(id as TrailId, raw);
      if (!isDefaultFx(id as TrailId, f)) fx[id as TrailId] = f;
    }
  }
  return { kind: trailKind(o.kind), burst: o.burst === true, fx };
}

/** An effect's colour, size and intensity, its own defaults where nothing is saved. */
export const fxOf = (p: TrailPrefs, id: TrailId): TrailFx => cleanFx(id, p.fx[id]);
export const isDefaultFx = (id: TrailId, f: TrailFx) => f.c === trailInfo(id).colour && f.s === FX_SIZE && f.i === FX_INTENSITY;

/** A new setting with one effect's colour, size or intensity changed (back to its defaults drops it). */
export function withFx(p: TrailPrefs, id: TrailId, patch: Partial<TrailFx>): TrailPrefs {
  const f = cleanFx(id, { ...fxOf(p, id), ...patch });
  const fx = { ...p.fx };
  if (isDefaultFx(id, f)) delete fx[id]; else fx[id] = f;
  return { ...p, fx };
}

/** What actually draws. Reduce motion (the device setting) gets the still Glow instead of a moving effect, and Off
 *  stays off. A touch screen has no mouse to follow: nothing is drawn there (a finger trail fights the swipes). */
export function trailShown(kind: TrailId, o: { reduced: boolean; touchOnly?: boolean }): TrailId {
  if (kind === "off") return "off";
  if (o.touchOnly) return "off";
  if (o.reduced) return "glow";
  return kind;
}

/** Whether the canvas may draw frames now. Anything else stops the frame loop completely. */
export function trailRuns(o: { kind: TrailId; shown: boolean; visible: boolean }): boolean {
  return trailInfo(o.kind).canvas && o.kind !== "off" && o.shown && o.visible;
}

// ---------- sizes and amounts ----------
/** Size 0 to 100 as a scale: 0.45x to 1.75x, 50 is 1x. */
export const sizeScale = (s: number) => {
  const v = Math.max(0, Math.min(100, s));
  return v <= 50 ? 0.45 + 0.55 * (v / 50) : 1 + 0.75 * ((v - 50) / 50);
};
/** Intensity 0 to 100 as a scale: 0.3x to 2x, 50 is 1x. */
export const intensityScale = (i: number) => {
  const v = Math.max(0, Math.min(100, i));
  return v <= 50 ? 0.3 + 0.7 * (v / 50) : 1 + (v - 50) / 50;
};

// ---------- particle caps ----------
/** The most particles any effect draws at once, whatever the settings (keeps every frame cheap). */
export const MAX_PARTICLES = 700;
/** The most particles one mouse move may add, so a very fast flick never floods a frame. */
export const MAX_PER_MOVE = 24;
/** Frames are drawn at most this often (60 a second), even on a 120 Hz screen. */
export const FRAME_MS = 1000 / 60;
/** With nothing left to draw for this long after the last move, the loop stops (and the canvas is cleared). */
export const IDLE_MS = 900;

/** Particles alive at once at normal intensity, per effect (ribbons draw their own path and keep few particles). */
const BASE_CAP: Record<TrailId, number> = {
  off: 0, glow: 0, sparks: 260, lightning: 80, sparkler: 340, blade: 60, comet: 140, neon: 40, laser: 90, orb: 90,
  embers: 200, stardust: 220, bubbles: 70, snow: 160, rainbow: 40, pixels: 260,
};
/** Particles per px the mouse moves, at normal intensity. */
const RATE: Record<TrailId, number> = {
  off: 0, glow: 0, sparks: 0.32, lightning: 0.05, sparkler: 0.22, blade: 0.03, comet: 0.12, neon: 0, laser: 0.06, orb: 0.06,
  embers: 0.14, stardust: 0.16, bubbles: 0.045, snow: 0.07, rainbow: 0, pixels: 0,
};

/** How many particles an effect may have alive at once at an intensity (0 to 100). Never more than MAX_PARTICLES. */
export function particleCap(kind: TrailId, intensity: number): number {
  const base = BASE_CAP[kind] ?? 0;
  if (!base) return 0;
  return Math.max(8, Math.min(MAX_PARTICLES, Math.round(base * (0.55 + 0.45 * intensityScale(intensity)))));
}

/** How many to add for a move of `dist` px. `carry` is the fraction left from earlier moves (so slow moves still add
 *  some), `live` how many are alive now: the result never takes the effect over its cap or past MAX_PER_MOVE. */
export function emitCount(kind: TrailId, dist: number, intensity: number, carry: number, live: number): { n: number; carry: number } {
  const cap = particleCap(kind, intensity);
  const want = Math.max(0, dist) * (RATE[kind] ?? 0) * intensityScale(intensity) + Math.max(0, carry);
  let n = Math.floor(want);
  const left = want - n;
  n = Math.max(0, Math.min(n, MAX_PER_MOVE, cap - live));
  return { n, carry: Math.min(1, left) };
}

/** How many a Burst on click adds (never over the cap). */
export function burstCount(kind: TrailId, intensity: number, live: number): number {
  const cap = particleCap(kind, intensity);
  const want = Math.round(34 * intensityScale(intensity));
  return Math.max(0, Math.min(want, cap - live, MAX_PARTICLES));
}

/** A fixed size store of particles (typed arrays, no garbage while drawing). `add` refuses past the cap; `kill`
 *  swaps the last one into the gap, so the live ones are always 0 to n - 1. */
export class Pool {
  readonly cap: number;
  n = 0;
  x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array;
  age: Float32Array; life: Float32Array; size: Float32Array; rot: Float32Array; vr: Float32Array;
  seed: Float32Array; tone: Float32Array; type: Uint8Array;
  constructor(cap: number) {
    this.cap = Math.max(0, Math.min(MAX_PARTICLES, Math.floor(cap)));
    const f = () => new Float32Array(this.cap);
    this.x = f(); this.y = f(); this.vx = f(); this.vy = f(); this.age = f(); this.life = f();
    this.size = f(); this.rot = f(); this.vr = f(); this.seed = f(); this.tone = f(); this.type = new Uint8Array(this.cap);
  }
  /** A new particle's index, or -1 when full. */
  add(x: number, y: number, vx: number, vy: number, life: number, size: number, type = 0): number {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.age[i] = 0; this.life[i] = Math.max(0.01, life);
    this.size[i] = size; this.rot[i] = 0; this.vr[i] = 0; this.seed[i] = Math.random(); this.tone[i] = 0; this.type[i] = type;
    return i;
  }
  kill(i: number) {
    const j = --this.n;
    if (i === j) return;
    this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
    this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.size[i] = this.size[j]; this.rot[i] = this.rot[j];
    this.vr[i] = this.vr[j]; this.seed[i] = this.seed[j]; this.tone[i] = this.tone[j]; this.type[i] = this.type[j];
  }
  clear() { this.n = 0; }
}

// ---------- the Glow ----------
/** The CSS Glow's colour, size and brightness as style variables, or null at its defaults (then the CSS is exactly
 *  what it always was: the look's text colour, 260 px, 16%). */
export function glowVars(f: TrailFx): Record<string, string> | null {
  if (isDefaultFx("glow", f)) return null;
  const o: Record<string, string> = {};
  if (f.c !== "#ffffff" && HEX.test(f.c)) o["--trail-glow-c"] = f.c;
  if (f.s !== FX_SIZE) o["--trail-glow-r"] = `${Math.round(260 * sizeScale(f.s))}px`;
  if (f.i !== FX_INTENSITY) o["--trail-glow-a"] = `${Math.round(Math.min(60, 16 * intensityScale(f.i)))}%`;
  return Object.keys(o).length ? o : null;
}

// ---------- colours ----------
export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(HEX.test(hex) ? hex.slice(1) : "ffffff", 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** On a light look (paper), very pale colours would vanish: they are deepened so they still show. */
export function inkFor(rgb: [number, number, number], light: boolean): [number, number, number] {
  if (!light) return rgb;
  const [r, g, b] = rgb;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum < 0.72) return rgb;
  const k = 0.55;
  return [Math.round(r * (1 - k) + 70 * k), Math.round(g * (1 - k) + 96 * k), Math.round(b * (1 - k) + 130 * k)];
}

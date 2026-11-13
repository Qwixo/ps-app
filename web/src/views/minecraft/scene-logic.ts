// Minecraft mode scene: the pure rules (no DOM, no React, no audio), so tests/mc-scene.test.ts can run them in
// node. Scene.tsx draws; mc-audio.ts makes the noises; this file decides WHEN anything may move or make a sound.
//
// The developer (4 Nov 2026): "two or three Minecraft villagers with pickaxes working on an electrical problem visibly on the
// screen in the background, on loop, making the villager sounds" and "an animation when they first go on the
// screen of the villagers running over to the electrical problem and then working on it". The crew here is our
// own blocky electricians (hard hats, hi vis vests), never Mojang's villagers, art or sounds.

// ---------- when it runs, when it is quiet ----------

export interface McRunInput {
  /** The host panel says it is open (Minecraft mode on and shown). */
  active: boolean;
  /** document.visibilityState is "visible". */
  docVisible: boolean;
  /** The scene's box is on screen (IntersectionObserver), and has a size. */
  onScreen: boolean;
  /** The mute button. */
  muted: boolean;
  /** PS Do Not Disturb is on right now (core/dnd.ts dndActive). */
  dnd: boolean;
  /** A meeting is live right now. */
  meeting: boolean;
  /** The host asks for silence for its own reason. */
  hostQuiet?: boolean;
  /** prefers-reduced-motion: reduce. */
  reducedMotion: boolean;
}

export interface McRunState {
  /** Request animation frames at all. False: no frames, no timers, the clock stands still. */
  animate: boolean;
  /** Frames a second while animating (a pixel scene does not need 60, and the battery thanks us). */
  fps: number;
  /** Grunts and clinks may play. Never true while not animating. */
  audio: boolean;
  /** Why it is silent, for the mute button's title ("" when it may play). */
  quietWhy: "" | "muted" | "dnd" | "meeting" | "host" | "hidden";
  /** Skip the run in (they are already at work). */
  skipEntrance: boolean;
}

export const MC_FPS = { normal: 24, reduced: 8 } as const;

export function mcRunState(i: McRunInput): McRunState {
  const animate = !!(i.active && i.docVisible && i.onScreen);
  const quietWhy: McRunState["quietWhy"] = !animate ? "hidden" : i.muted ? "muted" : i.dnd ? "dnd" : i.meeting ? "meeting" : i.hostQuiet ? "host" : "";
  return {
    animate,
    fps: i.reducedMotion ? MC_FPS.reduced : MC_FPS.normal,
    audio: animate && quietWhy === "",
    quietWhy,
    skipEntrance: i.reducedMotion,
  };
}

/** Is a meeting live right now? Timed events only (all day ones are not calls). */
export function meetingLive(events: { start: string | null; end: string | null; allDay?: boolean }[] | null | undefined, now = Date.now()): boolean {
  for (const e of events || []) {
    if (e.allDay || !e.start || !e.end) continue;
    const s = Date.parse(e.start), en = Date.parse(e.end);
    if (s <= now && en > now) return true;
  }
  return false;
}

// ---------- the mute button's memory ----------

export const MUTE_KEY = "ps.mc.muted";
type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };

/** Remembered mute state. Default: sound on (the developer asked for the noises). A broken storage reads as not muted. */
export function readMuted(store: KV | null | undefined): boolean {
  try { return store?.getItem(MUTE_KEY) === "1"; } catch { return false; }
}
export function writeMuted(store: KV | null | undefined, muted: boolean): void {
  try { store?.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* private window or blocked storage: it just forgets */ }
}

// ---------- a small seeded random, so a layout is the same every open ----------

export function rng(seed: number) {
  // Mix the seed first (small or close seeds would otherwise start with close, small numbers).
  let h = (seed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  let s = h >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// The crew, their run in and what they do each open: crew-plan.ts.

// ---------- the work loop ----------

/** Gus's pickaxe: one swing every `period` ms; the strike lands at `hit` of the way through. */
export const SWING = { period: 1150, hit: 0.58 } as const;
/** Every few strikes the box bites back (ZAP!). */
export const ZAP_EVERY = 5;
/** Grunts come every 3 to 7 s. */
export const GRUNT_GAP: [number, number] = [3000, 7000];
export const nextGruntIn = (r: () => number) => GRUNT_GAP[0] + r() * (GRUNT_GAP[1] - GRUNT_GAP[0]);

/** Pickaxe arm angle (degrees, 0 = hanging down, 90 = forward, 180 = straight up) for phase p in [0,1). */
export function swingAngle(p: number): number {
  const ease = (x: number) => x * x * (3 - 2 * x);
  const REST = 40, UP = 205, HIT = 98;
  if (p < 0.45) return REST + (UP - REST) * ease(p / 0.45);                      // wind up over the shoulder
  if (p < SWING.hit) return UP - (UP - HIT) * ((p - 0.45) / (SWING.hit - 0.45)) ** 1.6; // the strike, fast
  if (p < 0.7) return HIT + Math.sin(((p - SWING.hit) / 0.12) * Math.PI) * 7;    // a little bounce off the box
  return HIT - (HIT - REST) * ease((p - 0.7) / 0.3);                             // back to rest
}

/** How many strikes have landed by work time `w` (ms since Gus started working). */
export const strikesBy = (w: number) => (w < 0 ? 0 : Math.floor(w / SWING.period + (1 - SWING.hit)));

// ---------- your own background: contrast on the real pixels ----------

const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
/** WCAG relative luminance of an sRGB colour (0..255 channels). */
export const luminance = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const contrast = (l1: number, l2: number) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

/**
 * The lowest contrast of text colour `fg` over RGBA pixels `px` once a flat overlay colour `ov` at alpha `a` is
 * composited on top (browsers blend in sRGB, so this does too). Fully transparent pixels are skipped.
 */
export function worstContrast(px: ArrayLike<number>, fg: [number, number, number], ov: [number, number, number], a: number): number {
  const lf = luminance(fg[0], fg[1], fg[2]);
  let worst = Infinity;
  for (let i = 0; i + 3 < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const r = px[i] * (1 - a) + ov[0] * a, g = px[i + 1] * (1 - a) + ov[1] * a, b = px[i + 2] * (1 - a) + ov[2] * a;
    const c = contrast(lf, luminance(r, g, b));
    if (c < worst) worst = c;
  }
  return worst === Infinity ? 21 : worst;
}

/**
 * The lightest overlay alpha (at least `min`) that gives `target` contrast for `fg` over every pixel. Light text over
 * a dark overlay gets better as alpha rises, so a binary search finds it. Returns alpha and the measured contrast.
 */
export function overlayFor(px: ArrayLike<number>, fg: [number, number, number], ov: [number, number, number], target = 4.5, min = 0.35): { alpha: number; contrast: number } {
  const at = (a: number) => worstContrast(px, fg, ov, a);
  if (at(min) >= target) return { alpha: min, contrast: at(min) };
  let lo = min, hi = 1;
  if (at(hi) < target) return { alpha: 1, contrast: at(1) };
  for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (at(mid) >= target) hi = mid; else lo = mid; }
  // A hair over the found edge so rounding in the browser's own blend never lands under the target.
  const alpha = Math.min(1, hi + 0.01);
  return { alpha, contrast: at(alpha) };
}

/** Cover crop: the source rectangle of an image of iw x ih that fills a box of bw x bh (like object-fit: cover). */
export function coverCrop(iw: number, ih: number, bw: number, bh: number) {
  const s = Math.max(bw / iw, bh / ih);
  const w = bw / s, h = bh / s;
  return { sx: (iw - w) / 2, sy: (ih - h) / 2, sw: w, sh: h };
}

/** A picked file is an image we can show (type check only; the decode decides the rest). */
export const isImageFile = (f: { type?: string; name?: string } | null | undefined) =>
  !!f && (/^image\/(png|jpe?g|gif|webp|avif|bmp|heic|heif)$/i.test(f.type || "") || (!f.type && /\.(png|jpe?g|gif|webp|avif|bmp|heic|heif)$/i.test(f.name || "")));

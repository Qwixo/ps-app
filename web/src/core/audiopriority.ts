// Audio priority (PS 1.65, feature "audio-priority", the developer's friend, 17 Nov 2026): "We want to select the ORDER in
// which we want to use the microphones, and same for speakers."
// The volume mixer shows two ordered lists, Speakers and Microphones, of every device this Mac has ever seen. Drag one
// to change the order; PS always uses the top one that is connected (ps-mac Sources/AudioPriority.swift does the
// switching and keeps the order on that Mac, by device id, forever). A device that is not connected shows dimmed with
// "not connected" and can be forgotten. A click on a connected device uses it now.
// Pure: no React, no DOM, no clock. tests/audiopriority.test.ts checks it; views/AudioPriority.tsx draws it.

export type APSide = "speakers" | "mics";
export const AP_SIDES: APSide[] = ["speakers", "mics"];
export type APKind = "builtIn" | "jack" | "bluetooth" | "usb" | "display" | "airplay" | "phone" | "other";
const KINDS: readonly string[] = ["builtIn", "jack", "bluetooth", "usb", "display", "airplay", "phone", "other"];

export interface APRow { uid: string; name: string; kind: APKind; connected: boolean; using: boolean }
/** What the Mac sends the volume mixer: {type:"audioprio", ...} (AudioPriority.swift push). */
export interface APState {
  on: boolean;
  speakers: APRow[];
  mics: APRow[];
  /** The person picked the one in use themselves (in macOS, or with a click here): PS leaves it. */
  held: Record<APSide, boolean>;
  /** A call is on: PS switches this list when it ends. */
  waiting: APSide[];
}

const MAX_ROWS = 40;
const cleanRow = (v: unknown): APRow | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.uid !== "string" || !o.uid || o.uid.length > 300) return null;
  const name = typeof o.name === "string" && o.name.trim() ? o.name.slice(0, 100) : AP_WORDS.unnamed;
  const kind = (typeof o.kind === "string" && KINDS.includes(o.kind) ? o.kind : "other") as APKind;
  return { uid: o.uid, name, kind, connected: o.connected === true, using: o.using === true && o.connected === true };
};
const cleanRows = (v: unknown): APRow[] => {
  if (!Array.isArray(v)) return [];
  const out: APRow[] = [];
  for (const x of v) {
    const r = cleanRow(x);
    if (r && !out.some((y) => y.uid === r.uid)) out.push(r);
    if (out.length >= MAX_ROWS) break;
  }
  // Only one device can be in use per list.
  let seen = false;
  return out.map((r) => { if (r.using && seen) return { ...r, using: false }; if (r.using) seen = true; return r; });
};

/** The Mac's message, checked (it comes from PS's own shell, but the page never trusts shapes). */
export function cleanAPState(v: unknown): APState | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.speakers) || !Array.isArray(o.mics)) return null;
  const h = (o.held && typeof o.held === "object" ? o.held : {}) as Record<string, unknown>;
  const w = Array.isArray(o.waiting) ? o.waiting.filter((x): x is APSide => x === "speakers" || x === "mics") : [];
  return { on: o.on === true, speakers: cleanRows(o.speakers), mics: cleanRows(o.mics), held: { speakers: h.speakers === true, mics: h.mics === true }, waiting: [...new Set(w)] };
}

/** A list with one row moved from `from` to `to` (both clamped). The same list when nothing moves. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const l = [...list];
  if (from < 0 || from >= l.length) return l;
  const t = Math.max(0, Math.min(l.length - 1, to));
  if (t === from) return l;
  const [x] = l.splice(from, 1);
  l.splice(t, 0, x);
  return l;
}

/** While dragging: which place the row being dragged would drop into. `from` its place, `dy` how far it moved (px),
 *  `pitch` one row's height plus the gap. Half a row is enough to take the next place. */
export function dropIndex(from: number, dy: number, pitch: number, count: number): number {
  if (count <= 0 || pitch <= 0) return Math.max(0, from);
  return Math.max(0, Math.min(count - 1, from + Math.round(dy / pitch)));
}

/** How far each OTHER row is pushed while one is dragged from `from` towards `over` (in rows: -1, 0 or 1). */
export function shiftFor(i: number, from: number, over: number): number {
  if (i === from) return 0;
  if (from < over && i > from && i <= over) return -1;
  if (from > over && i < from && i >= over) return 1;
  return 0;
}

/** Did the pointer move far enough to count as a drag, not a click (px)? */
export const DRAG_START = 4;
export const isDrag = (dx: number, dy: number): boolean => Math.hypot(dx, dy) >= DRAG_START;

/** One step of a damped spring (the rows' glide): position x, speed v, towards `to`, over dt seconds.
 *  Stiff and a little bouncy, settling in about a third of a second. Steps are split so a slow frame never explodes. */
export interface Spring { x: number; v: number }
export const SPRING = { k: 520, c: 34 };
export function springStep(s: Spring, to: number, dt: number, k = SPRING.k, c = SPRING.c): Spring {
  let { x, v } = s;
  let left = Math.max(0, Math.min(dt, 0.1));
  while (left > 0) {
    const h = Math.min(left, 1 / 240);
    v += (-k * (x - to) - c * v) * h;
    x += v * h;
    left -= h;
  }
  return { x, v };
}
/** Close enough to stop: under a quarter pixel away and nearly still. */
export const springAtRest = (s: Spring, to: number): boolean => Math.abs(s.x - to) < 0.25 && Math.abs(s.v) < 4;

/** The order the page sends the Mac after a drop: the ids, top first. */
export const orderOf = (rows: readonly APRow[]): string[] => rows.map((r) => r.uid);

/** The small line under a list, when there is something to say. */
export function noteFor(s: APState, side: APSide): string {
  if (s.waiting.includes(side)) return AP_WORDS.waiting;
  if (s.held[side]) return side === "speakers" ? AP_WORDS.heldSpeaker : AP_WORDS.heldMic;
  return "";
}

/** Every on screen word (the developer approves them). */
export const AP_WORDS = {
  speakers: "Speakers",
  mics: "Microphones",
  why: "The top one that is connected is used. Drag to change the order.",
  inUse: "In use",
  notConnected: "not connected",
  forget: (name: string) => `Forget ${name}`,
  use: (name: string) => `Use ${name} now`,
  drag: (name: string) => `${name}. Drag to change the order`,
  empty: "No devices yet.",
  unnamed: "Unnamed device",
  waiting: "A call is on. PS switches when it ends.",
  heldSpeaker: "You picked this one yourself, so PS keeps it until a device higher up connects.",
  heldMic: "You picked this one yourself, so PS keeps it until a microphone higher up connects.",
  apps: "Apps",
};

/** The soft sounds (PS plays its own copy by the same name, ps-mac Sfx.swift "ap-*", the same numbers).
 *  lift: a row picked up. slot: it passes a place. drop: it settles. use: a device used now. forget: one forgotten. */
export interface APTone { f: number; to?: number; dur: number; peak: number; wave: 0 | 1; at: number }
export const AP_TONES: Record<"lift" | "slot" | "drop" | "use" | "forget", APTone[]> = {
  lift: [{ f: 520, to: 660, dur: 0.07, peak: 0.05, wave: 0, at: 0 }],
  slot: [{ f: 1760, to: 1600, dur: 0.018, peak: 0.025, wave: 1, at: 0 }],
  drop: [{ f: 660, to: 440, dur: 0.09, peak: 0.06, wave: 0, at: 0 }, { f: 1320, dur: 0.05, peak: 0.015, wave: 0, at: 0.01 }],
  use: [{ f: 784, dur: 0.18, peak: 0.05, wave: 0, at: 0 }, { f: 1174.66, dur: 0.3, peak: 0.045, wave: 0, at: 0.06 }],
  forget: [{ f: 880, to: 520, dur: 0.16, peak: 0.04, wave: 0, at: 0 }],
};

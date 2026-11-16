// V1.65 Time zones: click a zone and its detail card moves into the list's own area, tall instead of wide, so the
// rest of the screen stays clear (the developer, 17 Nov 2026: "a click means this is my client"). Hover is
// unchanged. Pure rules here (which zone is focused, where the card goes, how the spring runs), the view only draws.

/** The focused zone: its id and the name on the row at that moment. */
export type Focus = { tz: string; name: string };

export type FocusEvent =
  | { type: "click"; tz: string; name: string }   // a click on a zone's row
  | { type: "back" }                              // the back chevron, Esc, or the zone clicked again
  | { type: "gone"; zones: string[] };            // the list of zones changed: these are what is left

/** What a click on a row, the back button, Esc or a list change does to the focus. Null means the list shows. */
export function focusReduce(f: Focus | null, e: FocusEvent): Focus | null {
  if (e.type === "click") return f && f.tz === e.tz ? null : { tz: e.tz, name: e.name };
  if (e.type === "back") return null;
  return f && !e.zones.includes(f.tz) ? null : f;
}

/** A click that really is a click on the row: not on a button or box inside it, not the tail of a drag. */
export function isRowClick(target: { closest(sel: string): unknown } | null, sinceDrag: number, zoneRow: boolean): boolean {
  if (!zoneRow || !target) return false;
  if (target.closest("button, input, a, select, textarea")) return false;
  return sinceDrag > 300;
}

export type Box = { left: number; top: number; width: number; height: number };

/** A rect relative to the parent the card is placed in. */
export function relBox(r: { left: number; top: number; width: number; height: number }, parent: { left: number; top: number }): Box {
  return { left: r.left - parent.left, top: r.top - parent.top, width: r.width, height: r.height };
}

/** Where the tall card ends up: exactly the list's own box, taller only when the content needs it (never past the
 *  room under it on screen). */
export function tallBox(list: Box, contentHeight: number, room: number): Box {
  const h = Math.max(list.height, Math.min(contentHeight, Math.max(list.height, room)));
  return { ...list, height: Math.round(h) };
}

/** A damped spring from 0 to 1 at time t seconds. Slightly under damped, so it overshoots a little and settles. */
export function springAt(t: number, stiffness = 260, damping = 22): number {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness), z = damping / (2 * w0);
  if (z >= 1) { const e = Math.exp(-w0 * t); return 1 - e * (1 + w0 * t); }
  const wd = w0 * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
}

/** How long the spring takes to come to rest (within 0.2 percent), in seconds. */
export function springDuration(stiffness = 260, damping = 22): number {
  let last = 0;
  for (let t = 0; t < 3; t += 0.01) if (Math.abs(1 - springAt(t, stiffness, damping)) > 0.002) last = t;
  return last + 0.01;
}

/** Progress values for an animation of n+1 frames, the first 0 and the last exactly 1. */
export function springFrames(n = 36, stiffness = 260, damping = 22): number[] {
  const d = springDuration(stiffness, damping);
  return Array.from({ length: n + 1 }, (_, i) => (i === n ? 1 : springAt((i / n) * d, stiffness, damping)));
}

/** One box between two boxes at progress p (the spring may take p a little past 1). */
export function lerpBox(a: Box, b: Box, p: number): Box {
  const m = (x: number, y: number) => x + (y - x) * p;
  return { left: m(a.left, b.left), top: m(a.top, b.top), width: Math.max(0, m(a.width, b.width)), height: Math.max(0, m(a.height, b.height)) };
}

/** One frame of the morph: a box and where it sits in the animation (0 to 1), plus the corner radius. */
export type MorphFrame = Box & { offset: number; radius: number };

/** The whole move from one box to another: a tiny squeeze first (the box pulls in a little around its middle, the
 *  island's own way of starting a move), then the spring carries it to the end. Out (back to the row) uses a calmer
 *  spring so a small box never wobbles under the row. ms: how long it all takes. */
export function morphFrames(from: Box, to: Box, opts: { out?: boolean; n?: number; r0?: number; r1?: number } = {}): { frames: MorphFrame[]; ms: number } {
  const n = opts.n ?? 40, r0 = opts.r0 ?? 18, r1 = opts.r1 ?? 18;
  const [k, d] = opts.out ? [300, 31] : [180, 21];
  const squeezeMs = opts.out ? 0 : 70;
  const springMs = springDuration(k, d) * 1000;
  const ms = Math.round(squeezeMs + springMs);
  const s = 0.025;   // the squeeze: 2.5 percent smaller around the middle
  const pinched: Box = squeezeMs ? { left: from.left + from.width * s / 2, top: from.top + from.height * s / 2, width: from.width * (1 - s), height: from.height * (1 - s) } : from;
  const frames: MorphFrame[] = [{ ...from, offset: 0, radius: r0 }];
  if (squeezeMs) frames.push({ ...pinched, offset: squeezeMs / ms, radius: r0 });
  const ps = springFrames(n, k, d);
  for (let i = 1; i <= n; i++) {
    const p = ps[i];
    const b = lerpBox(pinched, to, p);
    frames.push({ ...b, offset: (squeezeMs + (i / n) * springMs) / ms, radius: r0 + (r1 - r0) * Math.min(1, Math.max(0, p)) });
  }
  frames[frames.length - 1] = { ...to, offset: 1, radius: r1 };
  return { frames, ms };
}

/** Hold an arrow down: the wait before the next step. The first repeat waits a little (so a click is one step),
 *  then it speeds up to a steady quick pace. */
export function repeatGap(i: number): number {
  if (i <= 0) return 380;
  return Math.max(55, Math.round(130 * Math.pow(0.88, i - 1)));
}

/** Switching zones in the tall view: the new one comes in from the right when it is further down the list. */
export function swapDir(ids: string[], from: string, to: string): 1 | -1 {
  return ids.indexOf(to) >= ids.indexOf(from) ? 1 : -1;
}

/** Back on the page with the panel kept open: the zone you were looking at is still there (if it still is on your list). */
export function focusOnMount(pinned: boolean, kept: Focus | null, zones: string[]): Focus | null {
  return pinned && kept && zones.includes(kept.tz) ? kept : null;
}

/** The sounds, made in code (the same numbers as mac/Sources/Sfx.swift "tz-open", "tz-back", "tz-up", "tz-down").
 *  wave 0 sine, 1 triangle. Soft: well under the island's own chimes. */
export type TzTone = { f: number; to?: number; dur: number; peak: number; wave: 0 | 1; at: number };
export const TZ_TONES: Record<"open" | "back" | "up" | "down", TzTone[]> = {
  // A soft glass chime: two notes a fifth apart and a quiet octave on top.
  open: [{ f: 880, dur: 0.32, peak: 0.07, wave: 0, at: 0 }, { f: 1318.51, dur: 0.5, peak: 0.06, wave: 0, at: 0.07 }, { f: 2637.02, dur: 0.35, peak: 0.015, wave: 0, at: 0.08 }],
  // Back to the list: one soft note falling a little.
  back: [{ f: 1046.5, to: 784, dur: 0.22, peak: 0.05, wave: 0, at: 0 }],
  // The 30 minute arrows: a tiny light tick, a little higher going up.
  up: [{ f: 2200, to: 2600, dur: 0.022, peak: 0.05, wave: 1, at: 0 }],
  down: [{ f: 1900, to: 1500, dur: 0.022, peak: 0.05, wave: 1, at: 0 }],
};

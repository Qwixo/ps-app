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

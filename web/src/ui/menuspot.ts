// Where the Dynamic Island menu goes (the old views/TaskMap.tsx island menu, gone since V1.58: no longer used by the app, kept for its test). The developer, 5 Nov 2026: its look editor ran off
// the left of his monitor when the island button sat near the screen's left edge.

/** Under the button with the right edges lined up when there is room, else slid in from the screen's edge.
 *  Always 8 px inside the screen on every side; maxH lets it scroll inside instead of running off the bottom. */
export function islandMenuSpot(r: { right: number; bottom: number }, w: number, vw: number, vh: number) {
  const m = 8;
  const left = Math.round(Math.min(Math.max(m, r.right - w), Math.max(m, vw - w - m)));
  const top = Math.round(Math.min(r.bottom + 8, Math.max(m, vh - 260)));
  return { top, left, maxH: Math.max(160, vh - top - m) };
}

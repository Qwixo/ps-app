// The hover card's thinking (V1.43, the developer 8 Nov 2026: "whenever you hover over a button, like the little buttons at
// the top right, it comes up with a nice animation with what the button is and a short what it does when you
// press it"). The page half is src/ui/hovercard.ts; the words for buttons that still carry an old title are in
// core/hoverwords.ts. No DOM here, so tests can run it.

export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface Placed { x: number; y: number; side: "below" | "above"; arrow: number }

/** How long the pointer rests on a button before its card shows, and how quickly the next one shows while a card
 *  was just up (moving along a row of buttons feels instant, a pass over the screen never flickers). */
export const SHOW_MS = 420, WARM_MS = 70, WARM_FOR_MS = 450, HIDE_MS = 90;

/** Where the card goes: under the button (the Tab list's buttons sit at the top), above it when there is no room,
 *  always fully on screen with `margin` to spare, the little arrow pointing at the button's middle. */
export function placeCard(a: Rect, card: { w: number; h: number }, view: { w: number; h: number }, gap = 8, margin = 8): Placed {
  const below = a.bottom + gap + card.h <= view.h - margin;
  const above = a.top - gap - card.h >= margin;
  const side: Placed["side"] = below || !above ? "below" : "above";
  let y = side === "below" ? a.bottom + gap : a.top - gap - card.h;
  y = Math.max(margin, Math.min(y, view.h - margin - card.h));
  const mid = a.left + a.width / 2;
  const maxX = Math.max(margin, view.w - margin - card.w);
  const x = Math.max(margin, Math.min(mid - card.w / 2, maxX));
  // The arrow stays on the card, clear of its rounded corners.
  const arrow = Math.max(12, Math.min(mid - x, card.w - 12));
  return { x: Math.round(x), y: Math.round(y), side, arrow: Math.round(arrow) };
}

/** A tidy name and line: one line each, no dashes, cut to a readable length. */
export function cleanTip(name: string | null | undefined, line: string | null | undefined): { name: string; line: string } | null {
  const tidy = (v: string | null | undefined, max: number) => (v || "").replace(/[\u2013\u2014]/g, ",").replace(/\s+/g, " ").trim().slice(0, max);
  const n = tidy(name, 80), l = tidy(line, 140);
  if (!n) return null;
  return { name: n, line: l === n ? "" : l };
}

/** An old browser title split into a name and a line: "Undo. Puts back the last change" or "Undo: puts back". */
export function splitTitle(title: string): { name: string; line: string } {
  const t = title.replace(/\s+/g, " ").trim();
  const m = /^(.{2,40}?)(?:\.\s+|:\s+|\s+\(|\n)(.+)$/.exec(t);
  if (!m) return { name: t, line: "" };
  const line = m[2].replace(/\)$/, "");
  return { name: m[1], line: line.charAt(0).toUpperCase() + line.slice(1) };
}

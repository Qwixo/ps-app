// The phone's own Edit mode (gos/PhoneEditMode.tsx), its numbers and rules. Pure (tests/phone-edit-mode.test.ts).
import { editSoundOk } from "../core/editsounds.ts";

/** The phone's ring mode (ps-gos Ringer.kt). "unknown": an older shell, or the iPhone (whose silent switch mutes the
 *  sounds by itself, gos/editsfx.ts). */
export type Ringer = "normal" | "vibrate" | "silent" | "unknown";
/** Is the phone quiet now (silent or vibrate)? Unknown counts as ringing. */
export const isSilent = (r: Ringer) => r === "silent" || r === "vibrate";
/** Whether an Edit sound plays on the phone: the shared rules (core/editsounds.ts), and the phone not on silent. */
export function phoneEditSoundOk(g: { on: boolean; volume: number; dndMutesSounds: boolean; meetingNow: boolean }, r: Ringer): boolean {
  return editSoundOk(g) && !isSilent(r);
}

/** Holding the navbar this long opens Edit mode (an iPhone home screen opens its jiggle mode at about half a second). */
export const NAV_HOLD_MS = 550;
/** A finger that moves this far (px) while holding is scrolling or swiping, not holding. */
export const HOLD_SLOP = 10;
/** A flick: this fast (px per ms) goes to the next page even when the finger moved less than half a page. */
export const FLICK = 0.4;
/** How far a page beside is from the middle (px): the gap from the page being edited (scale k) to the first one beside
 *  it (scale ks). A swipe this long moves one page. */
export const pagerStep = (W: number, k: number, ks: number) => (W * k) / 2 + 16 + (W * ks) / 2;
/** The page after a sideways swipe: whole pages by distance, or one page for a quick flick; kept in the list. */
export function pageAfterSwipe(ci: number, n: number, dx: number, v: number, step: number): number {
  let move = Math.round(-dx / Math.max(1, step));
  if (move === 0 && Math.abs(v) > FLICK && Math.abs(dx) > 24) move = dx < 0 ? 1 : -1;
  return Math.max(0, Math.min(n - 1, ci + move));
}

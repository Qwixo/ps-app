// Re-layout of the floating Tab list (V1.44 #9). The developer: "this thing still keeps breaking sometimes, i go away from this view
// with tab, go back and that fixes it every time".
//
// Why it broke: while the list is hidden PS shrinks its window to one pixel (ps-mac main.swift tuck()), so the page lays
// itself out 1 x 1 wide. The parts of the list that measure themselves (the Keep overlay and Hover mode bar, pop-ups)
// measured at that size: the bar decided there was no room and went to the far left, over the clock. When the list
// came back they only measured again on a later animation frame, and a window that was hidden can hold those back, so
// the bad layout stayed on screen until the next hide and show. The list box could also be scrolled sideways (a
// sideways trackpad move next to a swipe), which slid the whole list under Coming up; hiding shrank it back.
//
// The rules now:
//  - nothing is measured in the tucked window (tucked(): under 200 x 200, the same line ScreenFit.swift uses); what
//    was placed last stays as it was;
//  - whatever measures listens to onRelayout and measures at once, in the event, never waiting for a frame: on every
//    size change, a new screen or scaling (ps-screen), fonts that arrive late, the page coming back, and each time the
//    list is shown (relayoutNow, from ps.ts);
//  - the list box never scrolls sideways (taskmap.css .tm-scroll, TaskMap.tsx), and list content fades out under the
//    top bar instead of showing under Keep overlay and the top right buttons (topBand).

/** PS's hidden list window is one pixel; no real screen is under 200 points either way (ScreenFit.swift zoom). */
export const TUCKED = 200;
export function tucked(w: number = typeof window === "undefined" ? 0 : window.innerWidth, h: number = typeof window === "undefined" ? 0 : window.innerHeight): boolean {
  return !(w >= TUCKED && h >= TUCKED);
}

/** Tell everything that measures itself to measure again now (the list was just shown). */
export function relayoutNow() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("tm-relayout"));
}

/** Calls `fn` straight away on every event that can change the list's layout. Returns the unsubscribe. */
export function onRelayout(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const wins = ["resize", "ps-screen", "tm-relayout", "pageshow"] as const;
  const vis = () => { if (document.visibilityState === "visible") fn(); };
  for (const e of wins) window.addEventListener(e, fn);
  document.addEventListener("visibilitychange", vis);
  const fonts = document.fonts as FontFaceSet | undefined;   // fonts that arrive late change every width
  fonts?.addEventListener?.("loadingdone", fn);
  return () => {
    for (const e of wins) window.removeEventListener(e, fn);
    document.removeEventListener("visibilitychange", vis);
    fonts?.removeEventListener?.("loadingdone", fn);
  };
}

export interface BarPiece { left: number; right: number; bottom: number }

/** How far down the top bar reaches over the list column (page pixels from the top), plus a small gap: list content
 *  is faded out above this line, so nothing of the list ever shows under Keep overlay or the top right buttons.
 *  Pieces beside the list (or hidden, no width) do not count; none over it gives 0 (no band). */
export function topBand(pieces: BarPiece[], list: { left: number; right: number }, gap = 6): number {
  let low = 0;
  for (const p of pieces) {
    if (!(p.right - p.left > 1)) continue;
    if (p.right <= list.left || p.left >= list.right) continue;
    low = Math.max(low, p.bottom);
  }
  return low > 0 ? Math.round(low + gap) : 0;
}

// The moving looks behind the Tab list rest while a full screen covers it (V1.53, the developer 12 Nov 2026: "when in the settings
// menu I notice the background of the settings menu randomly go dark then light, then dark again, then light again").
//
// Why it flickered: Fitness and the Soundboard put the list's moving looks to rest while they are open (the
// .tm-overlay.scr-open rules hide lightning, the background video, the scene round Priority 1 and the colour layer), but
// the Settings screen never did. So behind Settings a lightning strike, a background video's bright and dark scenes,
// or the thunderstorm rain's flash kept lighting up the screen through its dim layer and around its window, by itself,
// over and over. The storm rain's flash was never put to rest by any screen.
//
// Now every full screen asks for the rest by name, and the list's looks wake only when the last one has gone: a
// screen closing never wakes them under another one still open (the old add and remove of one class could).
// Pure, so tests/screenrest.test.ts runs it; ui/screenrest.ts puts it on the page.

/** Who holds the rest after `who` asks for it (on) or lets it go (off). */
export function restHolders(prev: ReadonlySet<string>, who: string, on: boolean): Set<string> {
  const next = new Set(prev);
  if (on) next.add(who); else next.delete(who);
  return next;
}

/** The Settings screen wants the looks behind it at rest while it is up (and while it shrinks away), except while a
 *  Looks preview runs: then the window steps aside to show the list as it really looks, moving looks and all. */
export function settingsRests(phase: "closed" | "open" | "closing", previewing: boolean): boolean {
  return phase !== "closed" && !previewing;
}

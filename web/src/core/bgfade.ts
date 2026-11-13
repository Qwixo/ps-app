// List transparency (V1.43). Until V1.42 this was the glass slider at the top middle of the Tab list (V1.34, the developer 5 Nov
// 2026: "when I slide it down, like I want to see my desktop... I want the background or whatever background I have
// on my PS app to disappear"). The developer, 8 Nov 2026: it "doesn't really work... when I slide it to the left on most of the
// backgrounds it doesn't actually work". Why:
//  1. Its right half (more solid than the default) only thickened the tint UNDER the chosen background, so with any
//     background (a colour, a video, a scene, a storm) that half did nothing at all.
//  2. The background faded on an eased curve, so the first stretch to the left barely changed it either.
//  3. The Light look painted the list's backing solid, so there the slider never did anything.
// Now it lives in Settings, Looks as "List transparency", 0% (the usual look) to 100% (your screen, clearly). It keeps
// the same saved key (settings.tmBackdrop, 0 = see through, 50 = the usual look) so the Mac's own glass (ps-mac
// applyBackdrop: alpha = v / 50) needs no change; a value above 50 from the old right half counts as 50.
// Everything behind the list fades with it, in a straight line: the tint, the blur, the Mac's glass and the chosen
// background (gone at 100%, the video paused, the storm stopped). The Light look's backing fades too.

export const BACKDROP_USUAL = 50;

/** The saved value as it counts now: 0 to 50 (anything above, or unreadable, is the usual look). */
export function backdropOf(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : BACKDROP_USUAL;
  return Math.max(0, Math.min(BACKDROP_USUAL, Math.round(n)));
}
/** Settings' percent (0 the usual look, 100 see through) for a saved value. */
export const transparencyOf = (v: unknown) => Math.round((1 - backdropOf(v) / BACKDROP_USUAL) * 100);
/** The saved value for Settings' percent. */
export const backdropFor = (pct: number) => backdropOf(BACKDROP_USUAL * (1 - Math.max(0, Math.min(100, pct)) / 100));

/** How much of the background shows (0 to 1) for a saved value: in a straight line, gone at 0. */
export function bgFade(v: number, def = BACKDROP_USUAL): number {
  const k = Math.max(0, Math.min(1, (Number.isFinite(v) ? v : def) / def));
  return Math.round(k * 1000) / 1000;
}

/** The page's tint and blur for a saved value (50 = the usual look: tint .58, blur 16 px). */
export function backdropLook(v: number) {
  const k = backdropOf(v) / BACKDROP_USUAL;
  return { tint: (0.58 * k).toFixed(3), blur: `${(16 * k).toFixed(1)}px` };
}

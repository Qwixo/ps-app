// Full screen panels on the phone (PS 1.60, phone fixes): the top safe area and the size of the close and minimise
// targets. The Android shell hands the page the status bar's height (--gos-inset-top, gos/bridge.ts), and the page
// is drawn edge to edge, so a panel that starts at the very top lands under the clock (the Soundboard did).
//   - gos/gos.css gives every phone panel --safe-top (the real status bar height) and --sat (the same, for panels
//     that used env(safe-area-inset-top), which is always 0 inside the Android WebView).
//   - A close or minimise button is at least TARGET points square.
//
// Run: node --experimental-strip-types tests/phonesafe.test.ts

/** The smallest touch target (points): Apple's 44 and Android's 48 dp rule of thumb, the smaller of the two. */
export const TARGET = 44;

/** A usable top inset from whatever the shell or the browser reported: finite, not negative, rounded up to a whole point. */
export function topInset(raw: unknown): number {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 0;
}

/** Where a panel's bar starts: below the status bar, plus the gap (a bar never starts closer than `gap` points). */
export function barTop(inset: unknown, gap = 8): number { return topInset(inset) + Math.max(0, gap); }

/** The size a close or minimise button must have: never under TARGET in either direction. */
export function targetSize(w: number, h: number): { w: number; h: number } {
  return { w: Math.max(TARGET, Math.ceil(w || 0)), h: Math.max(TARGET, Math.ceil(h || 0)) };
}

/** Does a button of this size meet the rule. */
export function targetOk(w: number, h: number): boolean { return w >= TARGET && h >= TARGET; }

/** The status bar can be hidden behind a bar a panel draws itself: is `barTopPx` (where the bar's top edge sits) clear of it. */
export function clearOfStatusBar(barTopPx: number, inset: unknown): boolean { return barTopPx >= topInset(inset); }

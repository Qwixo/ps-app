// The mobile web app: which phone and browser this is, so the Add to Home Screen guide shows the right steps.
// Pure: tests/mobile.test.ts runs it with made up browser strings.

export type Platform = "ios-safari" | "ios-other" | "android" | "desktop";

/** iPad on iPadOS says "Macintosh" but has touch points; count it as iOS. */
export function detectPlatform(ua: string, touchPoints = 0): Platform {
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  if (iOS) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|DuckDuckGo|Brave/i.test(ua) ? "ios-other" : "ios-safari";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

/** Opened from the Home Screen icon (no browser bar), on iPhone or Android. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || !!window.matchMedia?.("(display-mode: standalone)").matches || !!window.matchMedia?.("(display-mode: fullscreen)").matches;
}

/** The app's own address, from wherever it is served (cincee.com/todolist-mobile/, or the dev server's /client/todolist-mobile/). */
export function appBase(path: string): string {
  const m = /^(.*?\/todolist-mobile)(\/|$)/.exec(path);
  return m ? `${m[1]}/` : "/todolist-mobile/";
}
export function isInstallPath(path: string): boolean {
  return /\/todolist-mobile\/install\/?$/.test(path);
}

/** Where a phone remembers "Not now, use it in Safari" (this browser only, so it is asked once per phone). */
export const GUIDE_SKIP_KEY = "psm.guide.skip";

/** Whether the Add to Home Screen guide is the first screen. Never inside the Home Screen app; always at /install;
 *  otherwise in any browser tab until the person chose "Not now". Pure: tests/mobileguide.test.ts. */
export function showGuide(o: { standalone: boolean; skipped: boolean; installPath: boolean }): boolean {
  if (o.standalone) return false;
  return o.installPath || !o.skipped;
}

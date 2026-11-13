// Esc always backs out of PS (V1.41, the developer, 8 Nov 2026: "No matter what screen you're on, no matter what's going on in
// the PS app, make sure the escape button always works to back you out of the PS app, no matter what.").
//
// How it works, on the Mac (ps-mac main.swift escKey, and its own key monitor when the keyboard tap is off):
//  1. PS takes the Esc itself and asks the Tab list page first (window.__psEscape, src/ui/escape.ts): the page
//     closes the top screen or pop-up (a text box being edited, a menu, a sheet, the screen) and answers true.
//  2. Nothing open (false): PS hides the list and gives the keyboard back to the app you were in.
//  3. The page is busy or broken and has not answered after PAGE_WAIT_MS: PS hides the list anyway.
//  4. Esc pressed BURST_COUNT times within BURST_MS: PS hides the list whatever the page says.
//  5. Sleep mode: Esc always leaves the sleep screen, with no Touch ID, and locks PS like the padlock.
//  6. Sentry mode (V1.48, ps-mac Sentry.swift): Esc leaves the PS cover and locks the Mac at once with the real macOS
//     lock screen (the keep awake stays on); unlocking the Mac ends Sentry mode. It never leaves the Mac open.
// These rules have no DOM and no AppKit, so the unit test checks them directly. The Mac copies the numbers
// (tests/esc-always.test.ts checks they match when ps-mac is next to this checkout).

/** How long PS waits for the page's answer before hiding the list anyway. */
export const PAGE_WAIT_MS = 700;
/** Esc this many times within BURST_MS hides PS, whatever is open. */
export const BURST_COUNT = 3;
export const BURST_MS = 1500;
/** After the page's Esc, how long it watches for a screen to leave (React redraws after the key). */
export const SETTLE_MS = 160;

/** What happened to the page's own Esc (a synthetic keydown sent the way a real one would arrive). */
export interface EscProbe {
  prevented: boolean;     // a handler called preventDefault (most screens do)
  reached: boolean;       // the page's last listener on window still got it (false: someone stopped it, it was used)
  layersGone: number;     // screens or pop-ups that left the page within SETTLE_MS
}

/** Did the page step back? */
export function steppedBack(p: EscProbe): boolean {
  return p.prevented || !p.reached || p.layersGone > 0;
}
/** Can the page tell at once (no need to wait SETTLE_MS for a screen to leave)? */
export function knownAtOnce(p: Pick<EscProbe, "prevented" | "reached">): boolean {
  return p.prevented || !p.reached;
}

// A screen or pop-up: role dialog, or a class part that names one ("tm-pop", "dx-win", "uf-layer", "slp-sheet").
const LAYER_PARTS = new Set(["layer", "overlay", "pop", "popup", "sheet", "modal", "dialog", "drawer", "menu", "win", "window", "screen", "panel", "scrim", "tray"]);
/** Is an element with this class and role a screen or pop-up (not a row, a button or a card in the list)? */
export function isLayer(className: string, role: string | null): boolean {
  if (role === "dialog" || role === "menu" || role === "alertdialog") return true;
  for (const c of className.split(/\s+/)) {
    if (!c) continue;
    for (const part of c.toLowerCase().split(/[-_]/)) if (LAYER_PARTS.has(part)) return true;
  }
  return false;
}

/** The Mac's side, as pure steps: what one press of Esc does. */
export type MacEsc = "sleep-leave-and-lock" | "burst-hide" | "ask-page" | "hide";
export function macEsc(o: { sleepUp: boolean; listShown: boolean; recent: number }): MacEsc {
  if (o.sleepUp) return "sleep-leave-and-lock";
  if (!o.listShown) return "hide";
  if (o.recent + 1 >= BURST_COUNT) return "burst-hide";
  return "ask-page";
}
/** After asking the page: true (stepped back) keeps the list; false, an error or no answer in time hides it. */
export function afterPage(answer: unknown, timedOut: boolean): "stay" | "hide" {
  return !timedOut && answer === true ? "stay" : "hide";
}

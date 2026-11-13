// The rules behind pinning a screen in the Tab list (src/ui/pin.ts), kept free of the page so the
// unit test (tests/pin.test.ts) can check them.

/** What counts as a screen or pop-up. Add data-pin-screen to anything else that should pin. */
export const SCREEN_SEL = "[role='dialog'], [data-pin-screen], .tm-pop, aside[aria-label], section[aria-label], article[aria-labelledby]";
/** Always-on side panels and the task list itself are not screens. */
export const NOT_SCREEN = ".tm-aware, .tm-meet, .tm-mn, .tm-list";
/** A screen's top bar: the first of these inside it. data-pin-bar marks one by hand. */
export const BAR_SEL = "[data-pin-bar], header, [class*='-head'], [class*='-top'], [class*='-bar'], [class$='-h'], [class*='-h '], .tm-panel-h";
/** A double click on one of these is for the control, never a pin. */
export const INTERACTIVE = "button, input, textarea, select, a, label, [contenteditable='true'], [role='button'], [role='tab'], [role='switch'], [role='slider'], [role='radio']";
/** Buttons never replayed to reopen a screen after a restart. */
export const DANGER = /\b(delete|remove|reset|end my day|ungroup|tick|untick|lock|sign out|unpair|shut down|restart|send|dismiss|decline|accept)\b/i;

/** Classes that come and go with state, so they never name a screen. */
const DYN = /^(on|open|opening|closing|closed|hot|sel|active|show|shown|in|out|peek|docked|big|ready|busy|dragging|empty|all|m-edit|asap)$|^s-/;

type ElLike = { tagName: string; classList: Iterable<string>; getAttribute(n: string): string | null };
/** A stable name for a screen: its tag, its fixed classes and the first word of its label. */
export function keyOf(r: ElLike): string {
  const cls = [...r.classList].filter((c) => !DYN.test(c)).sort().join(".");
  const label = (r.getAttribute("aria-label") || "").split(/[\s:]/)[0];
  return `${r.tagName.toLowerCase()}.${cls}|${label}`;
}

/** How a screen was opened: the button(s) clicked just before it appeared, or a hover on its owner. */
export type Launch = { mode: "click" | "hover"; steps: string[]; owner: string };
export type Pin = { key: string; launch: Launch; at: number };

/** From the recent clicks (newest last, performance.now() times) when a screen appeared at `now`. */
export function launchFrom(recent: { sel: string; at: number }[], now: number, owner: string): Launch {
  const near = recent.filter((c) => now - c.at <= 3000 && now >= c.at);
  const last = near[near.length - 1];
  if (!last || now - last.at > 900) return { mode: "hover", steps: [], owner };
  return { mode: "click", steps: near.slice(-2).map((c) => c.sel), owner };
}

/** A stored pin, checked (it comes back from local storage). */
export function parsePin(raw: string | null): Pin | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<Pin>;
    const l = p?.launch as Partial<Launch> | undefined;
    if (typeof p?.key !== "string" || !p.key || p.key.length > 300 || !l || (l.mode !== "click" && l.mode !== "hover")) return null;
    const steps = Array.isArray(l.steps) ? l.steps.filter((s): s is string => typeof s === "string" && s.length < 400).slice(-2) : [];
    return { key: p.key, launch: { mode: l.mode, steps, owner: typeof l.owner === "string" && l.owner.length < 400 ? l.owner : "" }, at: typeof p.at === "number" ? p.at : 0 };
  } catch { return null; }
}

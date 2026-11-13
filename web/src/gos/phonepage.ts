// The page the phone shows right now, from its synced phone layout (V1.56, core/phonelayout.ts). gos/GosLayer.tsx sets
// it; views/TaskMap.tsx reads its background, App.tsx its look, and gos/PhonePages.tsx draws a page of panels.
// Nothing sets it on the Mac or the website, so there every hook here returns null and nothing changes.
import { useSyncExternalStore } from "react";
import type { PhoneKind, PhoneLayout, PhonePage } from "../core/phonelayout";
import { bgDesign } from "../core/prio";

export type PhoneNow = {
  layout: PhoneLayout | null;
  page: PhonePage | null;      // the page showing (null: the vault pages)
  bg: string | null;           // its background (its own, else the phone's own), checked
  look: string | null;         // its look
  side: "l" | "r";             // a page of panels left or right of the list (which way the list slides away)
  order: string[];             // the views left to right ("plan", "list", "inbox", "page:<id>")
  go: (view: string) => void;  // switch to a view (a swipe on a page of panels)
};
const NONE: PhoneNow = { layout: null, page: null, bg: null, look: null, side: "r", order: [], go: () => {} };
let now: PhoneNow = NONE;
const subs = new Set<() => void>();
const sub = (l: () => void) => { subs.add(l); return () => { subs.delete(l); }; };

export function setPhoneNow(next: PhoneNow) {
  const bg = next.bg && bgDesign(next.bg) === next.bg ? next.bg : null;
  const n = { ...next, bg };
  if (now.layout === n.layout && now.page === n.page && now.bg === n.bg && now.look === n.look && now.side === n.side && now.order.join() === n.order.join() && now.go === n.go) return;
  now = n;
  subs.forEach((f) => f());
}
export function clearPhoneNow() { if (now !== NONE) { now = NONE; subs.forEach((f) => f()); } }
export const usePhoneNow = () => useSyncExternalStore(sub, () => now);
/** The phone page's own background, or null (the usual one). */
export const usePhoneBg = () => useSyncExternalStore(sub, () => now.bg);
/** The phone page's own look, or null (the usual one). */
export const usePhoneLook = () => useSyncExternalStore(sub, () => now.look);

/** Which phone kind this build is: PS GOS, or the mobile web app (the iPhone web app; the same page in any phone's
 *  browser). Null on the Mac and the website. */
export function thisPhoneKind(): PhoneKind | null {
  const mode = import.meta.env.MODE;
  if (mode === "gos") return "gos";
  if (mode !== "ps" && (globalThis as { __psMobile?: unknown }).__psMobile === true) return "ios";
  return null;
}
/** The view id of a page ("page:<id>" for a page of panels). */
export const viewOf = (p: PhonePage) => (p.kind === "panels" ? `page:${p.id}` : p.kind);

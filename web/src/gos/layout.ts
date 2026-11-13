// PS GOS list layouts (the developer, 30 Oct 2026: "the tasks look too big ... add different design options").
// Four ways to draw the same list on the phone, picked in the PS settings sheet and kept in the vault
// settings (settings.gosLayout). The layout is a data attribute on <html> (data-gos-layout) that
// src/gos/layouts.css reads, so nothing on the Mac or the website changes. A copy in this phone's
// storage applies it before the vault opens, so the list never jumps from one look to another.
import { useEffect } from "react";
import { saveSettings } from "../core/actions";
import { settingsData } from "../core/select";
import { useVault } from "../ui/kit";
import { haptic } from "./bridge";

export type GosLayout = NonNullable<import("../core/model").Settings["gosLayout"]>;
export const GOS_LAYOUTS: { k: GosLayout; t: string; d: string }[] = [
  { k: "compact", t: "Compact", d: "One slim line per task, like a phone list. The most tasks on screen." },
  { k: "cards", t: "Cards", d: "Small cards with the date and P number under the title. Overdue and Priority 1 get a colour edge." },
  { k: "focus", t: "Focus", d: "The task you are working on grows big with a large tick; the rest shrink to one line and fade back." },
  { k: "simple", t: "Simple", d: "No boxes: plain rows with thin lines between them, big section titles. Calm and quiet." },
];
const KEY = "gos.layout";
const valid = (v: unknown): v is GosLayout => GOS_LAYOUTS.some((x) => x.k === v);

function stored(): GosLayout {
  try { const v = localStorage.getItem(KEY); if (valid(v)) return v; } catch { /* storage off */ }
  return "compact";
}
/** Puts the layout on the page. A switch crossfades (a view transition where the WebView has one). */
export function applyGosLayout(l: GosLayout, animate = false) {
  const root = document.documentElement;
  if (root.dataset.gosLayout === l) return;
  try { localStorage.setItem(KEY, l); } catch { /* storage off */ }
  const doc = document as Document & { startViewTransition?: (f: () => void) => unknown };
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (animate && doc.startViewTransition && !reduce) doc.startViewTransition(() => { root.dataset.gosLayout = l; });
  else root.dataset.gosLayout = l;
}
/** Before the first paint (src/gos/main.tsx): the last layout this phone used. */
export function startGosLayout() { applyGosLayout(stored()); }

/** The layout in the vault settings (it follows a change made on another visit), and a setter. */
export function useGosLayout(): [GosLayout, (l: GosLayout) => void] {
  const s = useVault();
  const saved = s.status === "unlocked" ? settingsData(s).gosLayout : undefined;
  const now = valid(saved) ? saved : stored();
  useEffect(() => { applyGosLayout(now, true); }, [now]);
  const set = (l: GosLayout) => {
    if (l === now) return;
    haptic("press");
    applyGosLayout(l, true);
    void saveSettings({ gosLayout: l });
  };
  return [now, set];
}

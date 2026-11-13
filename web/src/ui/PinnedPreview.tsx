// A live preview that stays in view while its settings scroll (V1.47). The developer's friend, 11 Nov 2026: "When you change
// settings in Sleep mode you have to scroll down to change a setting and scroll back up to see what it changed. The
// preview should be pinned so you constantly see it, or on one side with the settings on the other."
// One shared layout, for any settings page with a picture of what it changes:
// - Wide (its own box at least 720 px wide, a container query, so it fits a side panel as well as a full screen): the
//   preview sits on one side and stays put while the settings scroll on the other.
// - Narrow (a phone, a small window): the preview sticks to the top, kept short, and the settings scroll beneath it.
//   "Hide preview" folds it to a slim bar for more room; "Show preview" brings it back (remembered per preview).
// Used by Sleep mode's settings (views/SleepSettings.tsx) and Settings, Appearance (looks/AppearanceSettings.tsx, the
// Accent and Layout and text pictures). Anything else with a picture can use it the same way:
//   <PinnedPreview id="fit-look" preview={<FitnessSample />} side="end">{the settings}</PinnedPreview>
// The page around it must scroll (the nearest scrolling box is what it sticks to).
import { useState, type CSSProperties, type ReactNode } from "react";
import { sfx } from "./sfx";
import "./pinnedpreview.css";

const KEY = "ps.pinnedPreview.shut";
const readShut = (id: string): boolean => { try { return (JSON.parse(localStorage.getItem(KEY) || "[]") as string[]).includes(id); } catch { return false; } };
const writeShut = (id: string, shut: boolean) => {
  try {
    const all = new Set(JSON.parse(localStorage.getItem(KEY) || "[]") as string[]);
    if (shut) all.add(id); else all.delete(id);
    localStorage.setItem(KEY, JSON.stringify([...all].slice(-50)));
  } catch { /* private window: kept for this page only */ }
};

export function PinnedPreview({ id, preview, children, side = "end", label = "Preview", size = 380, className }: {
  /** Names this preview, so "Hide preview" is remembered for it. */
  id: string;
  /** The live picture. */
  preview: ReactNode;
  /** The settings that change it. */
  children: ReactNode;
  /** Wide: the preview on the left ("start") or the right ("end"). */
  side?: "start" | "end";
  label?: string;
  /** Wide: the preview's column width (px). */
  size?: number;
  className?: string;
}) {
  const [shut, setShut] = useState(() => readShut(id));
  const toggle = () => { sfx.hover(); setShut((s) => { writeShut(id, !s); return !s; }); };
  return (
    <div className={`pp${className ? ` ${className}` : ""}`} data-pp={id} style={{ "--pp-size": `${size}px` } as CSSProperties}>
      <div className={`pp-in pp-${side}${shut ? " pp-shut" : ""}`}>
        <aside className="pp-prev" aria-label={label}>
          {!shut && <div className="pp-frame">{preview}</div>}
          <button type="button" className="pp-toggle" aria-expanded={!shut} onClick={toggle}>
            <span>{shut ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={shut ? "M6 9l6 6 6-6" : "M6 15l6-6 6 6"} /></svg>
          </button>
        </aside>
        <div className="pp-body">{children}</div>
      </div>
    </div>
  );
}

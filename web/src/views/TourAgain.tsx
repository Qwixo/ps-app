// Settings, About and updates, "Show the tour again" (PS 1.65): asks for the "where things live" tour (core/tour.ts) once more. It only
// saves a small request on this device and tells the intro host (views/FeatureIntro.tsx); the tour then starts at the next calm moment
// (the island free, no meeting, not idle), never at once.
import { useEffect, useState } from "react";
import { AGAIN_KEY, TOUR_WORDS } from "../core/tour";
import { sfx } from "../ui/sfx";

export function showTourAgain() {
  try { localStorage.setItem(AGAIN_KEY, "1"); } catch { /* private window: the request is lost, nothing breaks */ }
  window.dispatchEvent(new Event("ps:tour-again"));
}

export function TourAgainEntry() {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = window.setTimeout(() => setDone(false), 3500); return () => window.clearTimeout(t); }, [done]);
  const W = TOUR_WORDS.again;
  return (
    <button type="button" className="wn-entry" onClick={() => { sfx.click(); showTourAgain(); setDone(true); }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10z" /><circle cx="12" cy="11" r="2.2" />
      </svg>
      <span><b>{done ? W.done : W.name}</b><em>{done ? W.doneLine : W.line}</em></span>
    </button>
  );
}

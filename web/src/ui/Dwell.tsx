// Hover to choose: rest the mouse on an option for a moment and it is picked, no click needed.
// A pink fill runs along the bottom while you wait, so you can see it is about to switch;
// move off before it finishes and nothing changes. A click still works straight away.
import { useEffect, useRef, useState, type ReactNode } from "react";

export const DWELL_MS = 420;

export function DwellButton({ selected, onPick, children, className = "", title, ms = DWELL_MS, role = "radio" }: {
  selected: boolean; onPick: () => void; children: ReactNode; className?: string; title?: string; ms?: number; role?: string;
}) {
  const [arming, setArming] = useState(false);
  const t = useRef(0);
  useEffect(() => () => window.clearTimeout(t.current), []);
  const stop = () => { window.clearTimeout(t.current); setArming(false); };
  return (
    <button type="button" role={role} aria-checked={selected} title={title}
      className={`dwell${selected ? " on" : ""}${arming ? " arming" : ""} ${className}`} style={{ ["--dwell" as string]: `${ms}ms` }}
      onMouseEnter={() => { if (selected) return; setArming(true); t.current = window.setTimeout(() => { setArming(false); onPick(); }, ms); }}
      onMouseLeave={stop}
      onClick={() => { stop(); if (!selected) onPick(); }}>
      {children}
    </button>
  );
}

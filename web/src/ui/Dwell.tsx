// An option button that changes only on a real click or tap (V1.57). It used to pick itself when the mouse rested on
// it for a moment ("hover to choose"); a friend of the developer's hovered over the task editor's One-off / Every day / Repeat
// and it switched by itself ("I only want them to change when I actually click"). The name stays so the callers
// stay as they are; hovering now only gives the button its usual highlight (the .tm-ed-seg button:hover look).
import type { ReactNode } from "react";

export function DwellButton({ selected, onPick, children, className = "", title, role = "radio" }: {
  selected: boolean; onPick: () => void; children: ReactNode; className?: string; title?: string; role?: string;
}) {
  return (
    <button type="button" role={role} aria-checked={selected} title={title}
      className={`dwell${selected ? " on" : ""} ${className}`}
      onClick={() => { if (!selected) onPick(); }}>
      {children}
    </button>
  );
}

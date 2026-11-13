// Smooth expand and collapse: a grid row animated from 0fr to 1fr, so the height follows the
// content with no measuring and no jump. Closed content is inert (not focusable, hidden from
// screen readers). With `lazy`, children mount on the first open and stay mounted after that,
// so heavy content (a whole proposal) is only built when the developer actually opens it.
import { useState, type ReactNode } from "react";
import "./accordion.css";

export function Collapse({ open, id, lazy, className, children }: { open: boolean; id?: string; lazy?: boolean; className?: string; children: ReactNode }) {
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return (
    <div id={id} className={`acc-collapse${open ? " open" : ""}${className ? " " + className : ""}`} inert={!open} aria-hidden={!open}>
      <div className="acc-clip">
        <div className="acc-inner">{!lazy || seen ? children : null}</div>
      </div>
    </div>
  );
}

/** A small chevron that turns when its row is open. */
export function Chevron({ open, size = 18 }: { open: boolean; size?: number }) {
  return (
    <svg className={`acc-chev${open ? " open" : ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

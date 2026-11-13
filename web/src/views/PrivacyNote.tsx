// "How your data stays private" (G Squad, the developer 7 Nov 2026): a plain words note on the account screens, closed
// until clicked. Why there is a database, which password is the key, and why a break in at the database shows
// nothing. The words, and the crypto facts they rest on, are in core/setupcopy.ts. The height changes in one step
// (PS's Sign in window follows the page's height), only the words fade in.
import { useState } from "react";
import { PRIVACY_TITLE, privacyPoints } from "../core/setupcopy";
import "./privacynote.css";

export function PrivacyNote({ own, device, className }: { own: boolean; device: "Mac" | "device"; className?: string }) {
  const [open, setOpen] = useState(false);
  const pts = privacyPoints({ own, device });
  return (
    <div className={`pvn${open ? " open" : ""}${className ? ` ${className}` : ""}`}>
      <button type="button" className="pvn-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        <span>{PRIVACY_TITLE}</span>
        <svg className="pvn-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <dl className="pvn-list">
          {pts.map((p, i) => (
            <div key={p.title} style={{ animationDelay: `${i * 60}ms` }}><dt>{p.title}</dt><dd>{p.text}</dd></div>
          ))}
        </dl>
      )}
    </div>
  );
}

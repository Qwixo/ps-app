// The patch notes of several versions at once (V1.52, the developer: an update from 1.49 to 1.52 must show what 1.50, 1.51
// and 1.52 each changed). One block per version, newest first, headed "V1.51 · Healing"; the list scrolls
// smoothly inside its card. Which blocks start open is core/notehistory.ts startsOpen (the newest always, a few
// versions all of them); the rest are one tap away. Used by the Mac and website update card, the "Updated to"
// card, the What's new panel and the phone's update card. Text only, never HTML. With one version the callers
// keep their plain list (the card's title already names it).
import { useState, type CSSProperties } from "react";
import { startsOpen, type NoteBlock } from "../core/notehistory";
import "./notegroups.css";

/** `all`: every version starts open (the What's new panel, whose whole job is reading the list; V1.53). */
export function NoteGroups({ blocks, className, tall, all }: { blocks: NoteBlock[]; className?: string; tall?: boolean; all?: boolean }) {
  const start = (i: number) => all || startsOpen(i, blocks.length);
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(blocks.map((b, i) => [b.version, start(i)])));
  const toggle = (v: string, el: HTMLElement) => {
    const now = !open[v];
    setOpen((o) => ({ ...o, [v]: now }));
    // Opening: after the block has grown, bring it into view without a jump.
    if (now) window.setTimeout(() => el.closest(".ng-b")?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }), 60);
  };
  return (
    <div className={`ng${tall ? " tall" : ""}${className ? ` ${className}` : ""}`} role="list">
      {blocks.map((b, i) => {
        const isOpen = open[b.version] ?? start(i);
        return (
          <section key={b.version} className={`ng-b${isOpen ? " open" : ""}`} role="listitem" style={{ "--i": i } as CSSProperties}>
            <button type="button" className="ng-h" aria-expanded={isOpen} onClick={(e) => toggle(b.version, e.currentTarget)}>
              <b>V{b.version}</b>{b.keyword && <><i aria-hidden="true">·</i><em>{b.keyword}</em></>}
              <span className="ng-n">{b.notes.length} {b.notes.length === 1 ? "change" : "changes"}</span>
              <svg className="ng-c" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <div className="ng-body" aria-hidden={!isOpen}>
              <ul>{b.notes.map((n, j) => <li key={j}>{n}</li>)}</ul>
            </div>
          </section>
        );
      })}
    </div>
  );
}

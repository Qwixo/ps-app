// Delete page (V1.57), under the page being edited: in the Mac's phone canvas (views/PhoneEditor.tsx) and in the phone's
// own Edit mode (gos/PhoneEditMode.tsx). The developer, 13 Nov 2026: "add a delete page button on the bottom". It asks "Are you
// sure?" first, and Undo comes up after. A page the phone cannot lose (List with your tasks, Plan, Inbox, the last
// page) is never deleted: the button says why (core/phonepagedelete.ts).
import { useEffect, useState, type CSSProperties } from "react";
import { pageDeleteBlock, pageDeleteSays } from "../core/phonepagedelete";
import type { PhoneLayout, PhonePage } from "../core/phonelayout";
import "./phonedelete.css";

/** The button and its question. `asking` is the page whose question is open (the editor keeps it, so Esc and back
 *  close it first). */
export function DeletePage({ layout, page, name, asking, onAsk, onDelete, onWhy, phone = false }: {
  layout: PhoneLayout; page: PhonePage; name: string; asking: boolean; phone?: boolean;
  onAsk: (open: boolean) => void; onDelete: () => void; onWhy?: () => void;
}) {
  const block = pageDeleteBlock(layout, page.id);
  const [why, setWhy] = useState(false);
  useEffect(() => { setWhy(false); }, [page.id]);
  useEffect(() => { if (!why) return; const t = window.setTimeout(() => setWhy(false), 3600); return () => window.clearTimeout(t); }, [why]);
  return (
    <div className={`pe-del${phone ? " phone" : ""}${asking ? " asking" : ""}`} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <button type="button" className={`pe-del-btn${block ? " locked" : ""}`} aria-disabled={!!block || undefined}
        title={block ?? `Delete ${name}`}
        onClick={() => { if (block) { setWhy(true); onWhy?.(); return; } onAsk(!asking); }}>
        {block ? <LockIcon /> : <BinIcon />}<span>Delete page</span>
      </button>
      {/* The question opens over the button (on the phone: above the bottom row). */}
      {asking && !block && (
        <div className="pe-del-ask" role="alertdialog" aria-label={`Delete ${name}?`}>
          <p><b>Are you sure?</b> {`Delete ${name}. ${pageDeleteSays(page)}`}</p>
          <div>
            <button type="button" className="pe-del-keep" onClick={() => onAsk(false)}>Keep it</button>
            <button type="button" className="pe-del-go" onClick={onDelete} autoFocus={!phone}>Delete page</button>
          </div>
        </div>
      )}
      {why && block && !asking && <p className="pe-del-why" role="status">{block}</p>}
    </div>
  );
}

/** "Page 2 deleted. Undo" for a few seconds, with a line that runs out. */
export const UNDO_MS = 8000;
export function UndoDelete({ name, onUndo, onGone, phone = false, style }: { name: string; onUndo: () => void; onGone: () => void; phone?: boolean; style?: CSSProperties }) {
  useEffect(() => { const t = window.setTimeout(onGone, UNDO_MS); return () => window.clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`pe-undo${phone ? " phone" : ""}`} style={style} role="status" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <span>{name} deleted</span>
      <button type="button" onClick={onUndo}>Undo</button>
      <i style={{ animationDuration: `${UNDO_MS}ms` }} aria-hidden="true" />
    </div>
  );
}

const sv = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, width: 16, height: 16 };
const BinIcon = () => <svg {...sv}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
const LockIcon = () => <svg {...sv}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;

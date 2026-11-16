// G Squad members list (PS 1.64), the developer 16 Nov 2026: the pictures at the top right of the G Squad window are a button;
// it opens a list of everyone in the squad with their picture, name and status ("Online", "At the gym", "Last seen 2 h
// ago", or nothing for someone who does not share "working"). The rules are core/squadpresence.ts memberStatus; the
// data comes with the squad's own pulls while the window is open (squad/engine.ts), so this adds no request at all.
// The button's hover line stays the working line ("N people are working right now"). Esc, a click outside or the
// button again closes the list. The times move on by themselves every 30 seconds while the list is open (no request).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SquadMember, SquadView } from "../squad/view";
import { workingLine } from "../squad/view";
import { memberStatus, statusOrder } from "../core/squadpresence";
import { useBack } from "../squad/back";
import { sfx } from "../ui/sfx";
import { Avatar } from "./SquadAvatar";
import "./gsmembers.css";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 40) : null);

/** The pictures in the window's header, as one button. */
export function MembersButton({ v, size, max, open, onToggle }: { v: SquadView; size: number; max: number; open: boolean; onToggle: () => void }) {
  const shown = v.members.slice(0, max);
  const more = v.members.length - shown.length;
  return (
    <button type="button" className={`gsw-stack gsm-btn${open ? " on" : ""}`} aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Members, ${v.members.length}. ${workingLine(v.count)}`} data-tip="Members" data-tip-line={workingLine(v.count)}
      onClick={() => { sfx.click(); onToggle(); }}>
      {shown.map((m) => <Avatar key={m.id} id={m.id} name={m.name} size={size} working={m.working} />)}
      {more > 0 && <span className="gsm-more num" style={{ height: size, minWidth: size }}>+{more}</span>}
    </button>
  );
}

/** The list itself: a card that drops from the button (or rises from the bottom on a narrow screen). */
export function MembersList({ v, onClose, narrow }: { v: SquadView; onClose: () => void; narrow: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const closing = useRef(false);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    const el = box.current;
    if (!el || reduced() || typeof el.animate !== "function") { onClose(); return; }
    const a = el.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: narrow ? "translateY(18px)" : "translateY(-6px) scale(.97)" }],
      { duration: 160, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" });
    a.onfinish = () => onClose();
    window.setTimeout(onClose, 260);
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useBack(true, () => closeRef.current());   // Esc: the window asks here first (squad/back.ts)
  useLayoutEffect(() => {
    const el = box.current;
    // Just under the window's header, whatever its height in this look.
    const head = el?.parentElement?.querySelector<HTMLElement>(".gsw-head");
    if (el && head && !narrow) el.style.top = `${head.offsetTop + head.offsetHeight + 6}px`;
    if (!el || reduced() || typeof el.animate !== "function") return;
    el.animate([{ opacity: 0, transform: narrow ? "translateY(24px)" : "translateY(-8px) scale(.96)" }, { opacity: 1, transform: "none" }],
      { duration: 260, easing: "cubic-bezier(.22, 1.1, .36, 1)" });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const down = (e: PointerEvent) => { const t = e.target as Element | null; if (!box.current?.contains(t) && !t?.closest?.(".gsm-btn")) closeRef.current(); };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, []);
  const rows = useMemo(() => v.members.map((m: SquadMember) => {
    const st = memberStatus({ shares: m.shares !== false, seen: str(m.seen), gym: str(m.gym), working: m.working, known: m.known === true }, now);
    return { m, st, me: m.me, name: m.name, seen: str(m.seen) };
  }).sort(statusOrder), [v.members, now]);
  const on = rows.filter((r) => r.st.kind === "online" || r.st.kind === "gym").length;
  return (
    <div ref={box} className={`gsm${narrow ? " narrow" : ""}`} role="dialog" aria-label="Members">
      <div className="gsm-head">
        <span className="gsm-t">Members<em>{v.members.length} in the squad{on ? `, ${on} online` : ""}</em></span>
        <button type="button" className="gsm-x" onClick={() => { sfx.click(); close(); }} aria-label="Close" title="Close (Esc)">×</button>
      </div>
      <ul className="gsm-list">
        {rows.map(({ m, st }, i) => (
          <li key={m.id} className={`gsm-row ${st.kind}`} style={{ animationDelay: `${Math.min(i, 12) * 22}ms` }}>
            <span className="gsm-av"><Avatar id={m.id} name={m.name} size={40} />{(st.kind === "online" || st.kind === "gym") && <i className={`gsm-dot ${st.kind}`} aria-hidden="true" />}</span>
            <span className="gsm-m">
              <b>{m.me ? `${m.name} (you)` : m.name}{m.creator && <small>Admin</small>}</b>
              {st.label && <em className={st.kind}>{st.kind === "gym" && <Dumbbell />}{st.label}</em>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
const Dumbbell = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6.5 8v8M17.5 8v8M3.8 10v4M20.2 10v4M6.5 12h11" /></svg>;

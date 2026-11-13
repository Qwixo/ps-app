// PS Fitness (i) cards (V1.47, the developer: "Everywhere, if you hover over anything, or little info icons, there should be a lot
// more information about what it means, so it's easy to understand for everybody.")
// A small round (i) next to a setting or a word. A tap opens a little card: what it is, an example and why it matters,
// all from the one glossary (glossary.ts). With a mouse (the Mac, the website) resting on the (i) opens the same card,
// and it stays while the pointer moves onto it. Esc, the phone's back gesture, a tap anywhere else or another (i) close
// it. Only one card is open at a time. "Every word explained" (Settings) lists the whole glossary.
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { haptic } from "../gos/bridge";
import { GLOSSARY, GROUPS, TERM_KEYS, type TermKey } from "./glossary";
import "./info.css";

const OPEN_MS = 260, CLOSE_MS = 200;
let closeOpen: (() => void) | null = null;   // the card open now, so a new one closes it

/** The (i) button. `k` is the glossary word. */
export function Info({ k, className }: { k: TermKey; className?: string }) {
  const t = GLOSSARY[k];
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState<null | "hover" | "pin">(null);
  const timer = useRef(0);
  const id = useId();
  const close = () => { window.clearTimeout(timer.current); setOpen(null); };
  const closeRef = useRef(close);
  closeRef.current = close;
  const show = (how: "hover" | "pin") => {
    if (closeOpen && closeOpen !== closeRef.current) closeOpen();
    closeOpen = closeRef.current;
    setOpen(how);
  };
  useEffect(() => () => { window.clearTimeout(timer.current); if (closeOpen === closeRef.current) closeOpen = null; }, []);
  const mouse = (e: RPointerEvent) => e.pointerType === "mouse";
  const later = (f: () => void, ms: number) => { window.clearTimeout(timer.current); timer.current = window.setTimeout(f, ms); };
  return (
    <>
      <button ref={btn} type="button" className={`fi-i${open ? " on" : ""}${className ? ` ${className}` : ""}`}
        aria-label={`What is ${t.title}?`} aria-expanded={!!open} aria-controls={open ? id : undefined} data-tip=""
        onClick={(e) => { e.stopPropagation(); haptic("press"); if (open === "pin") close(); else show("pin"); }}
        onPointerEnter={(e) => { if (mouse(e) && !open) later(() => show("hover"), OPEN_MS); }}
        onPointerLeave={(e) => { if (!mouse(e)) return; if (open === "hover") later(close, CLOSE_MS); else if (!open) window.clearTimeout(timer.current); }}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="12" cy="7.7" r="1.35" fill="currentColor" />
          <path d="M12 11v6" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
        </svg>
      </button>
      {open && <InfoCard k={k} id={id} anchor={btn.current} pinned={open === "pin"} onClose={close}
        onHold={() => window.clearTimeout(timer.current)} onLeave={() => { if (open === "hover") later(close, CLOSE_MS); }} />}
    </>
  );
}

/** A label with its (i) right after it. */
export function Term({ k, children, className }: { k: TermKey; children: ReactNode; className?: string }) {
  return <span className={`fi-lab${className ? ` ${className}` : ""}`}>{children}<Info k={k} /></span>;
}

function InfoCard({ k, id, anchor, pinned, onClose, onHold, onLeave }: { k: TermKey; id: string; anchor: HTMLElement | null; pinned: boolean; onClose: () => void; onHold: () => void; onLeave: () => void }) {
  const t = GLOSSARY[k];
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean; arrow: number } | null>(null);
  const done = useRef(onClose);
  done.current = onClose;
  // Place it under the (i), above when there is no room, always fully on screen.
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el || !anchor || !anchor.isConnected) { done.current(); return; }
      const a = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight, gap = 8, edge = 12;
      const left = Math.max(edge, Math.min(vw - w - edge, a.left + a.width / 2 - w / 2));
      const below = a.bottom + gap + h <= vh - edge || a.top - gap - h < edge;
      const top = below ? Math.min(a.bottom + gap, vh - h - edge) : a.top - gap - h;
      setPos({ left, top: Math.max(edge, top), up: !below, arrow: Math.max(14, Math.min(w - 14, a.left + a.width / 2 - left)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [anchor]);
  // Esc and the phone's back close the card first; a tap anywhere else closes it too.
  useEffect(() => {
    const back = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); done.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); done.current(); } };
    const away = (e: PointerEvent) => {
      const n = e.target as Node | null;
      if (n && (ref.current?.contains(n) || anchor?.contains(n))) return;
      done.current();
    };
    window.addEventListener("gos-back", back, true);
    window.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", away, true);
    return () => { window.removeEventListener("gos-back", back, true); window.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", away, true); };
  }, [anchor]);
  const host = (anchor?.closest(".fit") as HTMLElement | null) ?? (typeof document !== "undefined" ? document.body : null);
  if (!host) return null;
  return createPortal(
    <div ref={ref} id={id} className={`fi-card${pinned ? " pin" : ""}${pos?.up ? " up" : ""}`} role={pinned ? "dialog" : "tooltip"} aria-label={t.title}
      style={(pos ? { left: pos.left, top: pos.top, "--fi-arrow": `${pos.arrow}px` } : { left: -9999, top: 0 }) as CSSProperties}
      onPointerEnter={onHold} onPointerLeave={(e) => { if (e.pointerType === "mouse") onLeave(); }}>
      <i className="fi-arrow" aria-hidden="true" />
      <div className="fi-head">
        <b>{t.title}</b>
        {pinned && <button type="button" className="fi-x" onClick={() => done.current()} aria-label="Close" data-tip=""><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>}
      </div>
      <TermBody k={k} />
    </div>,
    host,
  );
}

/** What, example and why, as the card and the glossary list show them. */
function TermBody({ k }: { k: TermKey }) {
  const t = GLOSSARY[k];
  return (
    <>
      <p className="fi-what">{t.what}</p>
      <p className="fi-ex"><span>For example</span>{t.example}</p>
      <p className="fi-why"><span>Why it matters</span>{t.why}</p>
    </>
  );
}

/** Settings' "Every word explained": the whole glossary by group, each word opens in place. */
export function Glossary() {
  return (
    <div className="fi-gloss">
      {GROUPS.map((g) => {
        const keys = TERM_KEYS.filter((k) => GLOSSARY[k].group === g.k);
        if (!keys.length) return null;
        return (
          <div key={g.k} className="fi-gloss-g">
            <h4>{g.title}</h4>
            {keys.map((k) => (
              <details key={k} className="fi-gloss-t">
                <summary><b>{GLOSSARY[k].title}</b><span className="fi-gloss-chev" aria-hidden="true" /></summary>
                <div className="fi-gloss-b"><TermBody k={k} /></div>
              </details>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** An (i) card is open: a sheet under it leaves back and Esc to the card. */
export const infoOpen = () => typeof document !== "undefined" && !!document.querySelector(".fi-card");

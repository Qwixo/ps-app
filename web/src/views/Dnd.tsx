// Do Not Disturb (the developer, 30 Oct 2026), the moon at the top right of the Tab list (core/dnd.ts decides what
// it mutes). Off: one click turns it on at once, with a glow, no pop-up. On: a click opens the pop-up:
// how long (1 hour, until tomorrow morning, until you turn it off), a switch per distraction (muted unless
// let through), what is waiting, and Turn off Do Not Disturb. On the Mac it drops from the moon like the
// island menu. On the phone the moon sits in the thumb row above the dock (the top row has no room left)
// and the same pop-up is a sheet that slides up from the bottom with thumb-sized rows.
// The pop-up lives on document.body (the overlay's blur would shift a fixed menu inside it) and never
// takes the keyboard.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Settings } from "../core/model";
import type { Snapshot } from "../core/vault";
import { activeMode, dndActive, dndKindsFor, dndEndsAt, dndUntilText, inAnHour, modeUntil, moonMode, tomorrowMorning, type DndKind, type DndOp } from "../core/dnd";
import { FocusIcon } from "./FocusIcon";
import { Cog, DndSettings } from "./DndSettings";
import { mailCards } from "../core/mailcards";
import { isRedAccount } from "../core/account";
import { chatDoneCards } from "../core/chatdone";
import { leadCards } from "../core/leadcards";
import { irepFeed } from "../mailcards";
import { haptic } from "../gos/bridge";
import { sfx } from "../ui/sfx";
import "./dnd.css";

const PHONE = import.meta.env.MODE === "gos";
const tap = () => { if (PHONE) haptic("press"); else sfx.click(); };

/** The moon: a solid crescent (Apple's Do Not Disturb symbol; End day's moon is an outline), with two
 *  small stars while it is on. */
function Moon({ on, size = 20 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19.6 14.9A7.9 7.9 0 0 1 9.1 4.4a7.9 7.9 0 1 0 10.5 10.5z" fill="currentColor" stroke="none" />
      <g className="dnd-stars" opacity={on ? 1 : 0}>
        <path d="M16.6 3.6v2.8M15.2 5h2.8" /><path d="M20.1 8.3v1.8M19.2 9.2h1.8" />
      </g>
    </svg>
  );
}

/** Re-render when DND ends by its own clock, so the moon goes dark on time. */
function useDndNow(st: Partial<Settings>) {
  const [, setTick] = useState(0);
  const end = dndEndsAt(st.dnd);
  useEffect(() => {
    if (!end) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), Math.min(Math.max(end - Date.now() + 200, 200), 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [end]);
  return dndActive(st.dnd);
}

export function DndButton({ st, s, act, homeTz, size = 20 }: { st: Partial<Settings>; s: Snapshot; act: (o: DndOp) => Promise<unknown>; homeTz?: string; size?: number }) {
  const on = useDndNow(st);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);   // V1.43: the cog's settings and focus modes
  const [burst, setBurst] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const cog = useRef<HTMLButtonElement>(null);
  const press = useRef<{ t: number; long: boolean } | null>(null);
  useEffect(() => { if (!on && !PHONE) setOpen(false); }, [on]);   // the phone's sheet slides away by itself
  const mode = on ? activeMode(st.dnd) : null;
  const moon = moonMode(st.dnd);
  const click = () => {
    if (press.current?.long) { press.current = null; return; }   // a long press already opened the settings
    tap();
    setSettings(false);
    if (!on) { setBurst(Date.now()); void act({ op: "on", mode: moon.id, until: modeUntil(moon, Date.now(), homeTz) }); return; }   // off: on at once, no pop-up
    setOpen((v) => !v);
  };
  // A long press on the moon opens the settings, to pick which mode it turns on (the developer: "long press or the menu").
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const t = window.setTimeout(() => { if (press.current) { press.current.long = true; tap(); setOpen(false); setSettings(true); } }, 550);
    press.current = { t, long: false };
  };
  const up = () => { if (press.current && !press.current.long) { clearTimeout(press.current.t); press.current = null; } };
  const name = mode?.name || "Do Not Disturb";
  return (
    <span className={`dnd-wrap${settings ? " set-open" : ""}`}>
      <button ref={btn} type="button" className={`dnd-btn${on ? " on" : ""}${open ? " open" : ""}`} onClick={click}
        onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
        aria-haspopup="dialog" aria-expanded={open} aria-pressed={on}
        aria-label={on ? `${name} is on. Click for what it mutes` : `Do Not Disturb is off. Click to turn on ${moon.name}`}
        data-tip={on ? `${name} is on` : moon.id === "dnd" ? "Do Not Disturb" : `Do Not Disturb: ${moon.name}`}
        data-tip-line={on ? "Click for what it mutes, or turn it off" : "Mutes cards and sounds. Hold to pick a focus mode"}>
        {mode && mode.icon !== "moon" ? <span className="dnd-mode-now"><FocusIcon icon={mode.icon} size={size - 1} /></span> : <Moon on={on} size={size} />}
        {burst > 0 && <i key={burst} className="dnd-burst" aria-hidden="true" onAnimationEnd={() => setBurst(0)} />}
      </button>
      <button ref={cog} type="button" className={`dnd-cog${settings ? " open" : ""}`} onClick={() => { tap(); setOpen(false); setSettings((v) => !v); }}
        aria-haspopup="dialog" aria-expanded={settings} aria-label="Do Not Disturb settings and focus modes"
        data-tip="Do Not Disturb settings" data-tip-line="What it mutes, focus modes and schedules">
        <Cog size={10} />
      </button>
      {open && (PHONE
        ? <DndSheet st={st} s={s} act={act} homeTz={homeTz} on={on} onClose={() => setOpen(false)} />
        : <DndMenu st={st} s={s} act={act} homeTz={homeTz} anchor={btn} onClose={() => setOpen(false)} />)}
      {settings && <DndSettings st={st} s={s} act={act} homeTz={homeTz} anchor={cog} onClose={() => setSettings(false)} />}
    </span>
  );
}

type PanelProps = { st: Partial<Settings>; s: Snapshot; act: (o: DndOp) => Promise<unknown>; homeTz?: string; onClose: () => void };

/** What is held right now, per toggle (client emails, finished chats, lead replies). */
function waiting(st: Partial<Settings>, s: Snapshot): Partial<Record<DndKind, number>> {
  try {
    return {
      mail: st.mailCardsSince ? mailCards(s.docs.values(), st.mailCardsSince).length : 0,
      chats: chatDoneCards(st.chatDone, Date.now(), st.dnd).length,
      leads: leadCards(irepFeed(s), st.leadCards).length,
    };
  } catch { return {}; }
}

/** The pop-up's body, the same on the Mac and the phone. */
function DndBody({ st, s, act, homeTz, onClose, topEnd }: PanelProps & { topEnd?: React.ReactNode }) {
  const pass = new Set(st.dnd?.pass || []);
  const held = waiting(st, s);
  const total = (held.mail || 0) + (held.chats || 0) + (held.leads || 0);
  const end = dndEndsAt(st.dnd);
  const morning = tomorrowMorning(Date.now(), homeTz);
  const which = !end ? "off" : Math.abs(end - Date.parse(morning)) < 60_000 ? "tomorrow" : "hour";
  const kinds = dndKindsFor(isRedAccount(s), PHONE);   // The developer's own feeds' switches only on his account
  const run = (o: DndOp) => { tap(); void act(o); };
  return (
    <>
      <div className="dnd-top">
        <span className="dnd-orb" aria-hidden="true">{(() => { const m = activeMode(st.dnd); return m && m.icon !== "moon" ? <FocusIcon icon={m.icon} size={22} /> : <Moon on size={22} />; })()}</span>
        <span className="dnd-t">{activeMode(st.dnd)?.name || "Do Not Disturb"}<em>{dndUntilText(st.dnd)}{total > 0 ? ` · ${total} waiting` : ""}</em></span>
        {topEnd}
      </div>
      <div className="dnd-chips" role="radiogroup" aria-label="How long">
        <button type="button" role="radio" aria-checked={which === "hour"} className={which === "hour" ? "sel" : ""} onClick={() => run({ op: "until", until: inAnHour() })}>1 hour</button>
        <button type="button" role="radio" aria-checked={which === "tomorrow"} className={which === "tomorrow" ? "sel" : ""} onClick={() => run({ op: "until", until: morning })}>Until tomorrow</button>
        <button type="button" role="radio" aria-checked={which === "off"} className={which === "off" ? "sel" : ""} onClick={() => run({ op: "until", until: null })}>Until I turn it off</button>
      </div>
      <span className="dnd-h">Muted while it is on</span>
      <ul className="dnd-list">
        {kinds.map((x) => {
          const muted = !pass.has(x.k);
          const n = held[x.k] || 0;
          return (
            <li key={x.k}>
              <button type="button" role="switch" aria-checked={muted} className={`dnd-row${muted ? " muted" : ""}`}
                onClick={() => run({ op: "pass", kind: x.k, pass: muted, ...(activeMode(st.dnd) ? { mode: activeMode(st.dnd)!.id } : {}) })}>
                <span className="dnd-l">{x.label}{n > 0 && <b className="dnd-n">{n}</b>}<em>{muted ? x.hint : "Coming through"}</em></span>
                <i className="dnd-tog" aria-hidden="true"><b /></i>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="dnd-note">Muted cards wait and come up when you turn it off. VPN alarms and meeting notes always come through.</p>
      <button type="button" className="dnd-off" onClick={() => { run({ op: "off" }); onClose(); }}>Turn off Do Not Disturb</button>
    </>
  );
}

/** The Mac: drops from the moon, like the island menu. Esc or a click outside closes it. */
function DndMenu({ anchor, ...p }: PanelProps & { anchor: React.RefObject<HTMLButtonElement | null> }) {
  const menu = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 10, right: Math.max(8, window.innerWidth - r.right) });
  }, [anchor]);
  useEffect(() => {
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!menu.current?.contains(t) && !anchor.current?.contains(t)) p.onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); p.onClose(); } };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", down, true); window.removeEventListener("keydown", key, true); };
  }, [anchor, p]);
  if (!at) return null;
  return createPortal(
    <div ref={menu} className="dnd-menu" role="dialog" aria-label="Do Not Disturb" style={{ top: at.top, right: at.right, maxHeight: `calc(100vh - ${at.top + 12}px)` }}
      onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <DndBody {...p} />
    </div>, document.body);
}

/** The phone: a sheet that slides up from the bottom; drag the grabber down, tap the dim or Done to close. */
function DndSheet({ on, ...p }: PanelProps & { on: boolean }) {
  const [closing, setClosing] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const close = () => setClosing(true);
  useEffect(() => { if (!on) setClosing(true); }, [on]);   // turned off (here, on the Mac, or by its clock)
  useEffect(() => {
    const back = (e: Event) => { e.preventDefault(); close(); };
    window.addEventListener("gos-back", back);
    return () => window.removeEventListener("gos-back", back);
  }, []);
  return createPortal(
    <div className={`gos-sheet-wrap dnd-sheet-wrap${closing ? "" : " open"}`} onAnimationEnd={(e) => { if (closing && e.target === sheet.current) p.onClose(); }}>
      <div className="gos-sheet-dim" onClick={close} aria-hidden="true" />
      <div ref={sheet} className="gos-sheet dnd-sheet" role="dialog" aria-label="Do Not Disturb"
        onTouchStart={(e) => { if ((e.target as Element).closest(".gos-grab")) drag.current = { y: e.touches[0].clientY, dy: 0 }; }}
        onTouchMove={(e) => {
          if (!drag.current || !sheet.current) return;
          drag.current.dy = Math.max(0, e.touches[0].clientY - drag.current.y);
          sheet.current.style.transform = `translateY(${drag.current.dy}px)`;
          sheet.current.style.transition = "none";
        }}
        onTouchEnd={() => {
          if (!drag.current || !sheet.current) return;
          const far = drag.current.dy > 110;
          sheet.current.style.transition = ""; sheet.current.style.transform = "";
          drag.current = null;
          if (far) close();
        }}>
        <div className="gos-grab" aria-hidden="true"><i /></div>
        <div className="dnd-sheet-body"><DndBody {...p} onClose={close} topEnd={<button type="button" className="gos-x" onClick={close}>Done</button>} /></div>
      </div>
    </div>, document.body);
}

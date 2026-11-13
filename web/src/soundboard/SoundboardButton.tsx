// The Soundboard button and the screen's host (V1.47). On the Mac's Tab list and the website's To-do page it sits in
// the bottom row next to Dimension X and Fitness (TaskMap.tsx, slot "soundboard"); on the phone the dock has its own
// Soundboard button (gos/GosLayer.tsx) and the host is drawn there, so this button draws nothing on the phone.
// The screen grows out of the button like Dimension X and Fitness (views/DimensionX.tsx morph), and goes back into it.
// While it is open on the Mac the list stays when Tab is let go and takes the keyboard (search, the time field).
import { restBehind } from "../ui/screenrest";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PS, psPost } from "../ps";
import { GOS, onShell } from "../gos/bridge";
import { sfx } from "../ui/sfx";
import { morph } from "../views/DimensionX";
import { taskMapActions } from "../views/TaskMap";
import { Soundboard, RingBar } from "./Soundboard";
import { sbState, useSb } from "./store";
import { stop, usePlayer } from "./player";
import "./soundboard.css";

const MORPH = { body: ".sb-body", tint: ".sb-morph" };
const OPEN_EV = "ps-sb-open";
/** Opens the Soundboard from anywhere (the phone's dock, a notification's Open, Settings). */
export function openSoundboard(from?: HTMLElement | null) { window.dispatchEvent(new CustomEvent(OPEN_EV, { detail: from ?? null })); }
let isOpen = false;
export const soundboardIsOpen = () => isOpen;

export const NoteIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" />
  </svg>
);

type Phase = "closed" | "open" | "closing";
/** The screen, its open and close, and the ring bar while it is closed. One per page. */
export function SoundboardHost({ anchor, docked }: { anchor: () => HTMLElement | null; docked?: boolean }) {
  const [phase, setPhase] = useState<Phase>("closed");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const win = useRef<HTMLDivElement>(null), dim = useRef<HTMLDivElement>(null);
  const from = useRef<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const sb = useSb();
  useLayoutEffect(() => { setHost(docked || GOS ? document.body : anchor()?.closest<HTMLElement>(".tm-overlay") ?? document.body); }, [docked]);   // eslint-disable-line react-hooks/exhaustive-deps

  const open = (el?: HTMLElement | null) => {
    if (phaseRef.current === "open") return;
    from.current = el ?? anchor();
    sfx.click(); setPhase("open");
  };
  const close = () => { if (phaseRef.current !== "open") return; sfx.drop(); setPhase("closing"); };
  useEffect(() => {
    const f = (e: Event) => open((e as CustomEvent<HTMLElement | null>).detail);
    window.addEventListener(OPEN_EV, f);
    // The phone: a timed play's notification Open (ps-gos Soundboard.kt).
    const off = GOS ? onShell((m) => { if (m.type === "open" && m.what === "soundboard") window.setTimeout(() => open(null), 120); }) : null;
    return () => { window.removeEventListener(OPEN_EV, f); off?.(); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const root = anchor()?.closest<HTMLElement>(".tm-overlay");
    if (phase === "open") {
      isOpen = true;
      restBehind(root, "soundboard", true);   // the Tab list's moving looks rest while this covers them (ui/screenrest.ts)
      if (PS) psPost({ type: "dimx", open: true }); else if (!GOS) taskMapActions.editing(true);
      void morph(win.current, from.current ?? anchor(), dim.current, "in", MORPH);
    } else if (phase === "closing") {
      isOpen = false;
      if (PS) psPost({ type: "dimx", open: false }); else if (!GOS) taskMapActions.editing(false);
      const a = document.activeElement as HTMLElement | null;
      if (a && win.current?.contains(a)) a.blur();
      // Nothing plays in the background unless you chose it (Settings in the Soundboard).
      if (!sbState().prefs.keep) stop();
      void morph(win.current, GOS ? null : anchor(), dim.current, "out", MORPH).then(() => {
        restBehind(root, "soundboard", false);
        setPhase((p) => (p === "closing" ? "closed" : p));
      });
    }
  }, [phase]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (isOpen) { isOpen = false; if (PS) psPost({ type: "dimx", open: false }); } }, []);

  if (!host) return null;
  const layer = phase !== "closed";
  return createPortal(
    <>
      {layer && (
        <div className={`sb-layer${docked ? " docked" : ""}${GOS ? " gos" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
          <div ref={dim} className="sb-dim" aria-hidden="true" />
          <div ref={win} className="sb-win"><Soundboard onClose={close} /></div>
        </div>
      )}
      {!layer && sb.ring && <div className={`sb-ring-out${docked ? " docked" : ""}`}><RingBar /></div>}
    </>,
    host,
  );
}

/** The bottom row button (Mac Tab list, website). Draws the host too. */
export function SoundboardButton({ docked }: { docked?: boolean }) {
  const btn = useRef<HTMLButtonElement>(null);
  const p = usePlayer();
  if (GOS) return null;
  return (
    <>
      <button ref={btn} type="button" className={`sb-tab-btn${p.playing ? " on" : ""}`} onClick={() => openSoundboard(btn.current)} onMouseDown={(e) => e.stopPropagation()}
        aria-label={p.playing ? "Open the Soundboard (playing)" : "Open the Soundboard"} title="Soundboard">
        {p.playing ? <span className="sb-eq sb-eq-btn" aria-hidden="true"><i /><i /><i /></span> : <NoteIcon />}<span>Soundboard</span>
      </button>
      <SoundboardHost anchor={() => btn.current} docked={docked} />
    </>
  );
}

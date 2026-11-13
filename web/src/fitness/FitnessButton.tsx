// The Tab list's Fitness button (next to Dimension X). Since 2 Nov 2026 (the developer) Fitness is a screen inside the Tab
// list, like Dimension X: it grows out of the button over the list, and Esc or a click on the dim
// closes it. The separate PS Fitness window is gone. The Tab list holds no keys, so on the Mac every save goes to
// PS's main page, which encrypts it (core/vault.ts setMirrorWriter, ps.ts runFitOp). The phone has its own Gym
// button in the dock, so the button is not drawn there.
import { restBehind } from "../ui/screenrest";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PS, psPost } from "../ps";
import { sfx } from "../ui/sfx";
import { morph } from "../views/DimensionX";
import { taskMapActions } from "../views/TaskMap";
import { DumbbellIcon, FitnessApp } from "./FitnessApp";
import { FitMini } from "./FitMini";
import { fitnessNow } from "./store";

const MORPH = { body: ".fit-scr-content", tint: ".fit-scr-morph" };
let fitOpen = false;
export function fitnessIsOpen() { return fitOpen; }

// V1.29 (the developer): the same big pop up with a clear Minimise and Close. Minimise shrinks it into a mini timer in the
// corner of the Tab list (FitMini.tsx: the live rest and set progress); a click on it grows the pop up back. Esc and a
// click on the dim minimise during a workout (never lose the timer) and close when no workout is open.
type Phase = "closed" | "open" | "closing" | "minning" | "min";
export function FitnessButton({ docked }: { docked?: boolean }) {
  const [phase, setPhase] = useState<Phase>("closed");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const btn = useRef<HTMLButtonElement>(null);
  const win = useRef<HTMLElement>(null), dim = useRef<HTMLDivElement>(null), mini = useRef<HTMLButtonElement>(null);
  const from = useRef<HTMLElement | null>(null);   // what the pop up grows out of: the button, or the mini timer
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setHost(docked ? document.body : btn.current?.closest<HTMLElement>(".tm-overlay") ?? null); }, [docked]);

  const open = (el?: HTMLElement | null) => {
    if (phaseRef.current === "open") return;
    from.current = el ?? (phaseRef.current === "min" ? mini.current : btn.current);
    sfx.click(); setPhase("open");
  };
  const close = () => { if (phaseRef.current !== "open") return; sfx.drop(); setPhase("closing"); };
  const minimise = () => { if (phaseRef.current !== "open") return; sfx.drop(); setPhase("minning"); };
  const away = () => { if (fitnessNow().open) minimise(); else close(); };
  useLayoutEffect(() => {
    const root = btn.current?.closest<HTMLElement>(".tm-overlay");
    const leave = () => {
      fitOpen = false;
      if (PS) psPost({ type: "dimx", open: false }); else taskMapActions.editing(false);
      const a = document.activeElement as HTMLElement | null;
      if (a && win.current?.contains(a)) a.blur();
    };
    if (phase === "open") {
      fitOpen = true;
      restBehind(root, "fitness", true);   // the Tab list's moving looks rest while this covers them (ui/screenrest.ts)
      // PS: the list stays when Tab is let go and takes the keyboard, so kg and reps can be typed.
      if (PS) psPost({ type: "dimx", open: true }); else taskMapActions.editing(true);
      void morph(win.current, from.current ?? btn.current, dim.current, "in", MORPH);
    } else if (phase === "closing") {
      leave();
      void morph(win.current, btn.current, dim.current, "out", MORPH).then(() => {
        restBehind(root, "fitness", false);
        setPhase((p) => (p === "closing" ? "closed" : p));
      });
    } else if (phase === "minning") {
      // Into the mini timer: the list is the list again (Tab let go hides it, with the timer in its corner).
      leave();
      void morph(win.current, mini.current, dim.current, "out", MORPH).then(() => {
        restBehind(root, "fitness", false);
        setPhase((p) => (p === "minning" ? "min" : p));
      });
    }
  }, [phase]);
  // Esc: whatever Fitness has open first (a sheet, a picker), then the screen (PS hands its Esc over as __psDimxClose).
  useEffect(() => {
    if (phase !== "open") return;
    const escape = () => {
      const inner = new Event("gos-back", { cancelable: true });   // Fitness's own back handling (FitnessApp, Gym)
      window.dispatchEvent(inner);
      if (!inner.defaultPrevented) away(); else if (PS) psPost({ type: "dimx", open: true });
      return true;
    };
    const key = (e: KeyboardEvent) => { if (e.key !== "Escape") return; e.preventDefault(); e.stopImmediatePropagation(); escape(); };
    const w = window as Window & { __psDimxClose?: () => boolean };
    window.addEventListener("keydown", key, true);
    w.__psDimxClose = escape;
    return () => { window.removeEventListener("keydown", key, true); if (w.__psDimxClose === escape) delete w.__psDimxClose; };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    if (fitOpen) { fitOpen = false; if (!PS) taskMapActions.editing(false); }
    restBehind(btn.current?.closest(".tm-overlay"), "fitness", false);
  }, []);
  // The self test, and every other place that used to open the Fitness window, opens this screen.
  useEffect(() => {
    // V1.43: Settings says which Fitness it means (the website's To-do page has its own button, docked).
    const on = (e: Event) => { const d = (e as CustomEvent<{ docked?: boolean } | null>).detail; if (d && d.docked !== !!docked) return; open(); };
    window.addEventListener("ps-fitness-open", on);
    return () => window.removeEventListener("ps-fitness-open", on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (import.meta.env.MODE === "gos") return null;
  const layer = phase === "open" || phase === "closing" || phase === "minning";
  const bubble = phase === "min" || phase === "minning";
  return (
    <>
      <button ref={btn} type="button" className={`fit-tab-btn${phase !== "closed" ? " on" : ""}`} onClick={() => open(btn.current)} onMouseDown={(e) => e.stopPropagation()}
        aria-expanded={phase === "open"} aria-label="Open Fitness" title="Fitness">
        <DumbbellIcon size={18} /><span>Fitness</span>
      </button>
      {layer && host && createPortal(
        <div className={`dx-layer fit-scr-layer${docked ? " docked" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
          <div ref={dim} className="fit-scr-dim" onMouseDown={away} aria-hidden="true" />
          <section ref={win} className="fit-scr" role="dialog" aria-modal="true" aria-label="Fitness">
            <div className="fit-scr-morph" aria-hidden="true" />
            <div className="fit-scr-content"><FitnessApp desk chrome={{ onMin: minimise, onClose: close }} /></div>
          </section>
        </div>, host)}
      {bubble && host && createPortal(
        <FitMini ref={mini} className={`fit-mini-mac${docked ? " docked" : ""}${phase === "minning" ? " pre" : ""}`} hidden={phase === "minning"} onOpen={(el) => open(el)} />, host)}
    </>
  );
}

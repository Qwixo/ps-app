// Tab list, bottom left, between Timelines and Numerology: the Map pill. One click grows a window
// out of it with the series map from the website (To-do > Map, views/SeriesMap.tsx): the same
// calendar of the year, month and week, the same notes, month titles and goals timeline. This
// window has no vault keys, so notes and titles go through PS to the main window, which saves them.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PS, psPost } from "../ps";
import { sfx } from "../ui/sfx";
import { Icon } from "../ui/kit";
import { morph, reduced } from "./DimensionX";
import { SeriesMap, type MapSaves } from "./SeriesMap";
import "./seriespill.css";

export function SeriesPill({ docked, saves }: { docked?: boolean; saves: MapSaves }) {
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const btn = useRef<HTMLButtonElement>(null);
  const win = useRef<HTMLElement>(null);
  const dim = useRef<HTMLDivElement>(null);
  const esc = useRef<(() => void) | null>(null);
  // The window goes to the top of the Tab list (or the page when docked), never inside the side
  // column, so nothing in the list can draw over it.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setHost(docked ? document.body : btn.current?.closest<HTMLElement>(".tm-overlay") ?? document.body); }, [docked]);

  const open = () => { if (phaseRef.current === "closed") { sfx.click(); setPhase("open"); } };
  const close = () => { if (phaseRef.current === "open") { sfx.drop(); setPhase("closing"); } };
  const closeRef = useRef(close);
  closeRef.current = close;

  useLayoutEffect(() => {
    if (phase === "open") {
      // PS: pin the list and give it the keyboard (for notes; never over 1Password or Signal, PS
      // decides) and send the first Esc here, the same way Dimension X and Numerology do.
      if (PS) psPost({ type: "dimx", open: true });
      void morph(win.current, btn.current, dim.current, "in", { body: ".sp-content", tint: ".sp-tint" });
    } else if (phase === "closing") {
      if (PS) psPost({ type: "dimx", open: false });
      const a = document.activeElement as HTMLElement | null;
      if (a && win.current?.contains(a)) a.blur();   // a note being typed saves on blur
      void morph(win.current, btn.current, dim.current, "out", { body: ".sp-content", tint: ".sp-tint" }).then(() => {
        setPhase((p) => (p === "closing" ? "closed" : p));
        if (!reduced()) btn.current?.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 340, easing: "cubic-bezier(.22,1,.36,1)" });
      });
    }
  }, [phase]);
  useEffect(() => () => { if (phaseRef.current !== "closed" && PS) psPost({ type: "dimx", open: false }); }, []);

  // Esc: the search first, then an open note, then the map; the Tab list stays. PS sends its Esc as __psDimxClose.
  useEffect(() => {
    if (phase !== "open") return;
    const escape = () => { (esc.current ?? closeRef.current)(); return true; };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); escape(); } };
    const w = window as Window & { __psDimxClose?: () => boolean };
    window.addEventListener("keydown", key, true);
    w.__psDimxClose = escape;
    return () => { window.removeEventListener("keydown", key, true); if (w.__psDimxClose === escape) delete w.__psDimxClose; };
  }, [phase]);

  return (
    <div className="sp">
      <button ref={btn} type="button" className={`sp-pill${phase !== "closed" ? " on" : ""}`} onClick={() => (phase === "open" ? close() : open())}
        onMouseEnter={() => sfx.hover()} aria-haspopup="dialog" aria-expanded={phase === "open"} aria-label="Map: your series calendar">
        <Icon name="map" size={15} />
        <b>Map</b>
      </button>
      {phase !== "closed" && host && createPortal(
        <div className={`sp-layer${docked ? " docked" : ""}`} role="dialog" aria-modal="true" aria-label="Your series map" onMouseDown={(e) => e.stopPropagation()}>
          <div ref={dim} className="sp-dim" onMouseDown={close} aria-hidden="true" />
          <section ref={win} className="sp-win">
            <div className="sp-tint" aria-hidden="true" />
            <div className="sp-content">
              <SeriesMap embedded saves={saves} escRef={esc} onClose={close} />
            </div>
          </section>
        </div>, host)}
    </div>
  );
}

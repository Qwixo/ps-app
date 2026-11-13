// PS Fitness on the phone as a pop up (V1.29, the developer: "Today on the phone he cannot leave Fitness without closing and
// reopening the app"). The Gym button opens a large pop up over PS that grows out of the button. Top bar:
// Minimise, the Sync state, sun / moon, Close. Minimise (or the back gesture during a workout) shrinks it into a
// floating bubble with the live rest timer and set progress (FitMini.tsx); a tap on the bubble grows it back.
// Close (or back with no workout open) puts it away; the workout itself stays open and saved either way.
// Motion: the window's transform and opacity only (DimensionX's morph), the dim fades.
import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { morph } from "../views/DimensionX";
import { haptic } from "../gos/bridge";
import { FitnessApp, ownsBack } from "./FitnessApp";
import { FitMini } from "./FitMini";
import { fitPop, useFitPop } from "./pop";
import { fitnessNow } from "./store";

const MORPH = { body: ".fit-scr-content", tint: ".fit-scr-morph" };
type Phase = "closed" | "open" | "closing" | "minning" | "min";
/** morph() wants an element; a remembered rect does too. */
const rectEl = (r: DOMRect | null) => (r ? ({ getBoundingClientRect: () => r } as unknown as HTMLElement) : null);

/** Minimise when a workout is open (never lose the bubble's timer), else close. */
export function fitAway() { if (fitnessNow().open) fitPop.min(); else fitPop.close(); }

export function FitnessPop() {
  const want = useFitPop();
  const [phase, setPhase] = useState<Phase>(want === "min" ? "min" : "closed");
  const win = useRef<HTMLElement>(null), dim = useRef<HTMLDivElement>(null), mini = useRef<HTMLButtonElement>(null);
  const origin = useRef<DOMRect | null>(null);
  // V1.47 (the developer: opening Fitness "very laggy, almost feels like the app is about to crash"): the whole Fitness screen
  // used to be built inside the tap, before the window could start to grow. Now the empty window starts growing
  // first (on the GPU, see morph's flat mode), and the screen is built just after, while the window is still
  // faded (its content shows from 40% of the way). The build can no longer hold up a single frame of the motion.
  const [body, setBody] = useState(false);

  // Follow what was asked (the Gym button, the bubble, Minimise, Close, back).
  useEffect(() => {
    if (want === "open" && phase !== "open") { origin.current = fitPop.takeOrigin() ?? origin.current; setPhase("open"); }
    else if (want === "min" && phase === "open") setPhase("minning");
    else if (want === "min" && phase === "closed") setPhase("min");
    else if (want === "closed" && phase === "open") setPhase("closing");
    else if (want === "closed" && phase === "min") setPhase("closed");
  }, [want, phase]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    // While the pop up is open the PS dock slides away under it (gos.css data-fit-live); it comes back on Minimise.
    if (phase === "open") root.dataset.fitLive = "1"; else delete root.dataset.fitLive;
    if (phase === "open") void morph(win.current, rectEl(origin.current), dim.current, "in", MORPH);
    else if (phase === "minning") {
      void morph(win.current, mini.current, dim.current, "out", MORPH).then(() => setPhase((p) => (p === "minning" ? "min" : p)));
    } else if (phase === "closing") {
      void morph(win.current, rectEl(origin.current), dim.current, "out", MORPH).then(() => setPhase((p) => (p === "closing" ? "closed" : p)));
    }
  }, [phase]);
  useEffect(() => () => { delete document.documentElement.dataset.fitLive; }, []);
  useEffect(() => {
    if (phase === "closed" || phase === "min") { setBody(false); return; }
    if (phase !== "open" || body) return;
    // Two frames: the first one paints the empty window, so its animation is on the GPU before the build starts.
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => startTransition(() => setBody(true))); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [phase, body]);

  // The back gesture: Fitness's own panels and sheets close first (they listen in the capture phase and mark it
  // handled); then the pop up minimises (or closes when no workout is open). It never traps.
  useEffect(() => {
    if (phase !== "open") return;
    // V1.43: listeners on window run in the order they were added, so a sheet opened after this one may not have had
    // its turn yet: leave the event to it (ownsBack) instead of minimising under it.
    const back = (e: Event) => { if (e.defaultPrevented || ownsBack()) return; e.preventDefault(); haptic("press"); fitAway(); };
    window.addEventListener("gos-back", back);
    return () => window.removeEventListener("gos-back", back);
  }, [phase]);

  // Built once (V1.47): Minimise and Close change only this pop up's phase, and used to rebuild the whole Fitness
  // screen before the window could start to move.
  const app = useMemo(() => <FitnessApp chrome={{ onMin: () => { haptic("press"); fitPop.min(); }, onClose: () => { haptic("press"); fitPop.close(); } }} />, []);
  // V1.47: the bubble fades in where the shrinking window lands (fitness.css .fit-mini-gos.pre), so the window's
  // squashed corners never show; once there it does not pop in a second time ("early").
  const early = useRef(false);
  if (phase === "minning") early.current = true; else if (phase !== "min") early.current = false;
  const layer = phase === "open" || phase === "closing" || phase === "minning";
  const bubble = phase === "min" || phase === "minning";
  return createPortal(
    <>
      {layer && (
        <div className="fit-pop-layer" data-phase={phase}>
          <div ref={dim} className="fit-pop-dim" onClick={() => fitAway()} aria-hidden="true" />
          <section ref={win} className="fit-pop" role="dialog" aria-modal="true" aria-label="Fitness">
            <div className="fit-scr-morph" aria-hidden="true" />
            <div className="fit-scr-content">
              {body && app}
            </div>
          </section>
        </div>
      )}
      {bubble && <FitMini ref={mini} className={`fit-mini-gos${phase === "minning" ? " pre" : early.current ? " early" : ""}`} hidden={phase === "minning"}
        onOpen={(el) => { haptic("press"); fitPop.open(el); }} />}
    </>,
    document.body,
  );
}

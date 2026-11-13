// The Mouse trail on the list (V1.43; the rules are core/trail.ts, the drawing views/trailfx.ts, Settings
// views/MouseTrail.tsx). One fixed Canvas 2D layer over the Tab list or the website's To-do page. Mounted only for a
// canvas effect (never for Glow or Off, which cost nothing); pointer events pass straight through it, the mouse is
// only watched (passive listeners), and the engine draws only while the mouse moves over the tasks.
import { useEffect, useRef, type RefObject } from "react";
import { fxOf, trailInfo, trailKind, trailPrefs, trailShown, glowVars, type TrailId, type TrailPrefs } from "../core/trail";
import { createTrail, type TrailLive } from "./trailfx";
import "./trail.css";

const reducedNow = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
/** A touch screen with no mouse at all (phones, tablets): a trail would only fight the swipes, so none is drawn. */
export const touchOnly = () => typeof matchMedia === "function" && matchMedia("(hover: none) and (pointer: coarse)").matches;

/** What the list draws for a saved setting on this device: the effect (or Glow, or Off), and the Glow's style. */
export function trailOnList(saved: unknown, previewKind?: TrailId | null): { kind: TrailId; prefs: TrailPrefs; attr: "glow" | "off" | "fx"; glow: Record<string, string> | null } {
  const prefs = devTrail() ?? trailPrefs(saved);
  const kind = trailShown(previewKind ?? prefs.kind, { reduced: reducedNow(), touchOnly: touchOnly() });
  const attr = kind === "off" ? "off" : trailInfo(kind).canvas ? "fx" : "glow";
  return { kind, prefs, attr, glow: kind === "glow" ? glowVars(fxOf(prefs, "glow")) : null };
}

/** The dev server only: ?trail=sparks&trailc=%2355d6ff&trails=70&traili=80&burst tries an effect without Settings. */
function devTrail(): TrailPrefs | null {
  if (!import.meta.env.DEV || typeof location === "undefined") return null;
  const q = new URLSearchParams(location.search), k = q.get("trail");
  if (!k) return null;
  const kind = trailKind(k);
  return trailPrefs({ kind, burst: q.has("burst"), fx: { [kind]: { c: q.get("trailc") ?? undefined, s: q.get("trails") ?? undefined, i: q.get("traili") ?? undefined } } });
}

/** True while a mouse event is likely the copy a browser makes after a touch. */
function touchGuard(el: HTMLElement) {
  let at = -1e9;
  const on = () => { at = performance.now(); };
  el.addEventListener("touchstart", on, { passive: true });
  return { recent: () => performance.now() - at < 900, off: () => el.removeEventListener("touchstart", on) };
}

/** The layer itself. `host` is the list's root (its mouse moves are watched), `active` false stops everything. */
export function TrailLayer({ host, kind, prefs, active }: { host: RefObject<HTMLElement | null>; kind: TrailId; prefs: TrailPrefs; active: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const live = useRef<TrailLive>({ kind, fx: fxOf(prefs, kind), burst: prefs.burst });
  live.current = { kind, fx: fxOf(prefs, kind), burst: prefs.burst };
  useEffect(() => {
    const canvas = cv.current, el = host.current;
    if (!canvas || !el || !active) return;
    const eng = createTrail(canvas, () => live.current, { maxDpr: 1.5 });
    const touch = touchGuard(el);
    let ox = 0, oy = 0;
    const place = () => { const r = canvas.getBoundingClientRect(); ox = r.left; oy = r.top; };
    place();
    const over = (t: EventTarget | null) => !!(t as Element | null)?.closest?.(".tm-list, .tm-row");
    const move = (e: MouseEvent) => {
      if (touch.recent()) return;
      if (!over(e.target)) { eng.leave(); return; }
      eng.move(e.clientX - ox, e.clientY - oy, performance.now());
    };
    const down = (e: MouseEvent) => { if (e.button === 0 && !touch.recent() && over(e.target)) eng.down(e.clientX - ox, e.clientY - oy, performance.now()); };
    const out = () => eng.leave();
    const resized = () => { eng.resize(); place(); };
    const hidden = () => { if (document.visibilityState === "hidden") eng.clear(); };
    el.addEventListener("mousemove", move, { passive: true });
    el.addEventListener("mousedown", down, { passive: true });
    el.addEventListener("mouseleave", out, { passive: true });
    window.addEventListener("resize", resized, { passive: true });
    document.addEventListener("visibilitychange", hidden);
    return () => {
      el.removeEventListener("mousemove", move);
      el.removeEventListener("mousedown", down);
      el.removeEventListener("mouseleave", out);
      window.removeEventListener("resize", resized);
      document.removeEventListener("visibilitychange", hidden);
      touch.off();
      eng.clear();
    };
  }, [host, active, kind]);
  return <canvas ref={cv} className="tm-trail" aria-hidden="true" />;
}

/** The live preview in Settings: three made up tasks to move the mouse over, with the effect as it is being set up. */
export function TrailPad({ live }: { live: TrailLive }) {
  const box = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null), hint = useRef<HTMLSpanElement>(null);
  const cur = useRef(live);
  cur.current = live;
  const canvasKind = trailInfo(live.kind).canvas;
  useEffect(() => {
    const el = box.current, canvas = cv.current;
    if (!el || !canvas || !canvasKind) return;
    const eng = createTrail(canvas, () => cur.current, { maxDpr: 2 });
    const touch = touchGuard(el);
    let r = el.getBoundingClientRect();
    const enter = () => { r = el.getBoundingClientRect(); eng.resize(); };
    const move = (e: MouseEvent) => { if (!touch.recent()) eng.move(e.clientX - r.left, e.clientY - r.top, performance.now()); };
    const down = (e: MouseEvent) => { if (e.button === 0 && !touch.recent()) eng.down(e.clientX - r.left, e.clientY - r.top, performance.now()); };
    const out = () => eng.leave();
    el.addEventListener("mouseenter", enter, { passive: true });
    el.addEventListener("mousemove", move, { passive: true });
    el.addEventListener("mousedown", down, { passive: true });
    el.addEventListener("mouseleave", out, { passive: true });
    return () => {
      el.removeEventListener("mouseenter", enter); el.removeEventListener("mousemove", move);
      el.removeEventListener("mousedown", down); el.removeEventListener("mouseleave", out);
      touch.off(); eng.clear();
    };
  }, [canvasKind, live.kind]);
  // The Glow is the rows' own CSS light: the pad moves it the same way the list does.
  const glowMove = (e: React.MouseEvent<HTMLDivElement>) => {
    hint.current?.classList.add("gone");
    if (canvasKind) return;
    const row = (e.target as Element).closest<HTMLElement>(".mt-prow");
    if (!row) return;
    const rr = row.getBoundingClientRect();
    row.style.setProperty("--mx", `${e.clientX - rr.left}px`);
    row.style.setProperty("--my", `${e.clientY - rr.top}px`);
  };
  const glow = live.kind === "glow" ? glowVars(live.fx) : null;
  return (
    <div ref={box} className={`mt-pad${live.kind === "off" ? " off" : ""}${canvasKind ? " fx" : " glow"}`} onMouseMove={glowMove}
      style={glow ?? undefined} aria-label="Try the mouse trail here" role="img">
      {["Reply to Jo about Friday", "Gym at 8", "Send the invoice"].map((t, i) => (
        <div key={t} className={`mt-prow${i === 0 ? " p1" : ""}`}><span className="tm-fx" aria-hidden="true" /><i className="mt-ptick" /><span>{t}</span></div>
      ))}
      <canvas ref={cv} className="mt-pad-c" aria-hidden="true" />
      <span ref={hint} className="mt-hint">{live.kind === "off" ? "Off: nothing follows your mouse" : "Move your mouse here"}</span>
    </div>
  );
}

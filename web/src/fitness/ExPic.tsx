// The exercise picture (V1.40): a small still beside the exercise name (start pose solid, end pose faint), a
// looping rep while the mouse is over it, and a big card on tap with the figure doing the rep, the muscles it
// works and its one line tip. Colours come from the Fitness look tokens (volt, chalk, pulse; light and dark).
// Reduced motion: no animation anywhere; the card shows the start and the end side by side instead.
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { blend, repK, solve, FLOOR, type Joints, type Pose, type V2 } from "./pic-rig";
import { picFor, sceneBox, type Pic, type Scene, type Spot } from "./pics";
import { MUSCLE_LABEL } from "./library";
import type { Muscle } from "./types";
import { haptic } from "../gos/bridge";
import "./pics.css";

const PERIOD = 2600;   // one rep, ms
const BREATH = 3200;   // a hold (plank): a slow breath

// ---------- reduced motion ----------
const rmq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
function useReducedMotion(): boolean {
  return useSyncExternalStore((f) => { rmq?.addEventListener?.("change", f); return () => rmq?.removeEventListener?.("change", f); }, () => !!rmq?.matches, () => false);
}

/** 0 to 1 blend of the rep while `on`, smoothly back to the start when it stops. */
function useRep(on: boolean, hold: boolean): number {
  const [k, setK] = useState(0);
  const kRef = useRef(0);
  useEffect(() => {
    let raf = 0;
    let t0 = 0;
    if (!on) {
      if (kRef.current === 0) return;
      // Ease home from wherever the rep was, so it never snaps.
      const from = kRef.current;
      const step = (now: number) => {
        if (!t0) t0 = now;
        const p = Math.min(1, (now - t0) / 260);
        const v = from * (1 - (1 - Math.pow(1 - p, 3)));
        kRef.current = v; setK(v);
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }
    const period = hold ? BREATH : PERIOD;
    const step = (now: number) => {
      if (!t0) t0 = now;
      const ph = (now - t0) / period;
      const v = hold ? 0.5 - 0.5 * Math.cos(ph * Math.PI * 2) : repK(ph);
      kRef.current = v; setK(v);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [on, hold]);
  return k;
}

// ---------- drawing ----------
const f2 = (n: number) => Math.round(n * 100) / 100;
const pts = (...p: V2[]) => p.map((v) => `${f2(v[0])},${f2(v[1])}`).join(" ");
const addV = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const mulV = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const dirA = (a: number, l = 1): V2 => [Math.sin((a * Math.PI) / 180) * l, Math.cos((a * Math.PI) / 180) * l];

function spot(j: Joints, s: Spot | undefined, far = false): V2 {
  switch (s) {
    case "nape": return addV(addV(j.neck, mulV(j.tn, -2.8)), mulV(j.td, -1.2));
    case "rack": return addV(j.sh, mulV(j.tn, 3));
    case "chest": return addV(addV(j.neck, mulV(j.td, -6)), mulV(j.tn, 4.6));
    case "hip": return addV(j.hip, mulV(j.tn, 4.2));
    case "an": return far ? j.an2 : j.an;
    case "kn": return far ? j.kn2 : j.kn;
    case "el": return far ? j.el2 : j.el;
    case "sh": return j.sh;
    case "toe": return addV(far ? j.an2 : j.an, mulV([(far ? j.toe2 : j.toe)[0] - (far ? j.an2 : j.an)[0], (far ? j.toe2 : j.toe)[1] - (far ? j.an2 : j.an)[1]], 0.7));
    default: return far ? j.grip2 : j.grip;
  }
}

interface Mark { c: V2; rx: number; ry: number; rot: number }
const segMark = (a: V2, d: V2, l: number, k: number, off: number, side: 1 | -1 = 1, ry = 2.2): Mark => {
  const n: V2 = [d[1] * side, -d[0] * side];
  const c = addV(addV(a, mulV(d, l * k)), mulV(n, off));
  return { c, rx: l * 0.32, ry, rot: (Math.atan2(d[1], d[0]) * 180) / Math.PI };
};
/** Where each worked muscle is lit on the figure. */
function marks(j: Joints, ms: Muscle[]): Mark[] {
  const out: Mark[] = [];
  const T = 22;
  const torso = (k: number, off: number, rx = 4, ry = 2.3): Mark => {
    const c = addV(addV(j.hip, mulV(j.td, T * k)), mulV(j.tn, off));
    return { c, rx, ry, rot: (Math.atan2(j.td[1], j.td[0]) * 180) / Math.PI };
  };
  if (j.f) {
    const mid = (a: V2, b: V2, k = 0.5): V2 => addV(a, mulV([b[0] - a[0], b[1] - a[1]], k));
    const lr = (fn: (s: 1 | 2) => Mark) => { out.push(fn(1), fn(2)); };
    const seg = (a: V2, b: V2, k: number, out2: number, rx: number): Mark => {
      const d: V2 = [b[0] - a[0], b[1] - a[1]];
      const l = Math.hypot(d[0], d[1]) || 1;
      const u: V2 = [d[0] / l, d[1] / l];
      return { c: addV(mid(a, b, k), [out2, 0]), rx: Math.max(1.6, l * rx), ry: 2, rot: (Math.atan2(u[1], u[0]) * 180) / Math.PI };
    };
    for (const m of ms) {
      if (m === "chest") lr((s) => ({ c: addV(mid(j.hip, j.neck, 0.78), [s === 1 ? -3 : 3, 0]), rx: 3, ry: 2.2, rot: 0 }));
      else if (m === "abs") out.push(torso(0.4, 0, 2.2, 4.5));
      else if (m === "obliques") lr((s) => ({ c: addV(mid(j.hip, j.neck, 0.4), [s === 1 ? -4 : 4, 0]), rx: 1.6, ry: 4, rot: 0 }));
      else if (m === "lats") lr((s) => ({ c: addV(mid(j.hip, j.neck, 0.6), [s === 1 ? -4.6 : 4.6, 0]), rx: 1.8, ry: 4.6, rot: 0 }));
      else if (m === "traps" || m === "upper_back") lr((s) => ({ c: mid(j.neck, s === 1 ? j.sh : j.sh2, 0.5), rx: 2.6, ry: 1.6, rot: 0 }));
      else if (m === "front_delts" || m === "side_delts" || m === "rear_delts") lr((s) => ({ c: s === 1 ? j.sh : j.sh2, rx: 2.3, ry: 2.3, rot: 0 }));
      else if (m === "biceps" || m === "triceps") lr((s) => seg(s === 1 ? j.sh : j.sh2, s === 1 ? j.el : j.el2, 0.5, 0, 0.32));
      else if (m === "forearms") lr((s) => seg(s === 1 ? j.el : j.el2, s === 1 ? j.wr : j.wr2, 0.5, 0, 0.32));
      else if (m === "quads" || m === "hamstrings") lr((s) => seg(s === 1 ? j.hipL : j.hipR, s === 1 ? j.kn : j.kn2, 0.5, 0, 0.34));
      else if (m === "adductors") lr((s) => seg(s === 1 ? j.hipL : j.hipR, s === 1 ? j.kn : j.kn2, 0.55, s === 1 ? 1.4 : -1.4, 0.3));
      else if (m === "abductors" || m === "glutes") lr((s) => seg(s === 1 ? j.hipL : j.hipR, s === 1 ? j.kn : j.kn2, 0.25, s === 1 ? -1.6 : 1.6, 0.3));
      else if (m === "calves") lr((s) => seg(s === 1 ? j.kn : j.kn2, s === 1 ? j.an : j.an2, 0.35, 0, 0.3));
      else if (m === "lower_back") out.push(torso(0.15, 0, 2.6, 1.8));
    }
    return out;
  }
  const UA = 12.5, FA = 11.5, TH = 15, SH = 15;
  for (const m of ms) {
    switch (m) {
      case "chest": out.push(torso(0.74, 2.1, 3.6)); break;
      case "abs": out.push(torso(0.36, 2, 3.8)); break;
      case "obliques": out.push(torso(0.42, 0.4, 4, 2.4)); break;
      case "lats": out.push(torso(0.6, -2.1, 4.2)); break;
      case "upper_back": out.push(torso(0.82, -2, 3.4)); break;
      case "traps": out.push(torso(0.95, -1.6, 2.4, 1.9)); break;
      case "lower_back": out.push(torso(0.18, -1.9, 3.2)); break;
      case "front_delts": out.push({ c: addV(j.sh, mulV(j.tn, 1.6)), rx: 2.2, ry: 2.2, rot: 0 }); break;
      case "side_delts": out.push({ c: j.sh, rx: 2.4, ry: 2.4, rot: 0 }); break;
      case "rear_delts": out.push({ c: addV(j.sh, mulV(j.tn, -1.6)), rx: 2.2, ry: 2.2, rot: 0 }); break;
      case "biceps": out.push(segMark(j.sh, j.dUA, UA, 0.5, 1.7, 1)); break;
      case "triceps": out.push(segMark(j.sh, j.dUA, UA, 0.5, 1.7, -1)); break;
      case "forearms": out.push(segMark(j.el, j.dFA, FA, 0.45, 0.6, 1)); break;
      case "quads": out.push(segMark(j.hip, j.dTH, TH, 0.5, 1.8, 1, 2.4)); break;
      case "hamstrings": out.push(segMark(j.hip, j.dTH, TH, 0.5, 1.8, -1, 2.4)); break;
      case "glutes": out.push(segMark(j.hip, j.dTH, TH, 0.1, 2.2, -1, 2.6)); break;
      case "adductors": case "abductors": out.push(segMark(j.hip, j.dTH, TH, 0.4, 0, 1, 2.2)); break;
      case "calves": out.push(segMark(j.kn, j.dSH, SH, 0.32, 1.6, -1, 2.1)); break;
    }
  }
  return out;
}

function Held({ kind, p, fa, front }: { kind: Scene["hold"]; p: V2; fa: number; front: boolean }) {
  if (!kind || kind === "none") return null;
  const [x, y] = [f2(p[0]), f2(p[1])];
  if (kind === "bar") return front ? null : <g className="xp-w"><circle cx={x} cy={y} r={5.2} /><circle className="xp-hole" cx={x} cy={y} r={1.3} /></g>;
  if (kind === "plate") return <g className="xp-w"><circle cx={x} cy={y} r={4.8} /><circle className="xp-hole" cx={x} cy={y} r={1.2} /></g>;
  if (kind === "kb") {
    const c = addV(p, dirA(fa, 3.6));
    return <g className="xp-w"><circle cx={f2(c[0])} cy={f2(c[1])} r={3.3} /></g>;
  }
  const rot = f2(front ? 0 : -fa);
  if (kind === "db") {
    return (
      <g className="xp-w" transform={`translate(${x} ${y}) rotate(${rot})`}>
        <line className="xp-wl" x1={-4.4} y1={0} x2={4.4} y2={0} />
        <rect x={-5.6} y={-2.6} width={2.4} height={5.2} rx={0.7} />
        <rect x={3.2} y={-2.6} width={2.4} height={5.2} rx={0.7} />
      </g>
    );
  }
  if (kind === "rope") {
    const a = addV(p, dirA(fa - 22, 4)), b = addV(p, dirA(fa + 22, 4));
    return <g className="xp-w"><polyline className="xp-wl" points={pts(a, p, b)} /></g>;
  }
  return <g className="xp-w" transform={`translate(${x} ${y}) rotate(${rot})`}><line className="xp-wl" x1={-2.6} y1={0} x2={2.6} y2={0} /></g>;
}

function Body({ j, far }: { j: Joints; far: boolean }) {
  return (
    <g className="xp-b">
      {far && <g className="xp-far"><polyline points={pts(j.sh2, j.el2, j.wr2)} /><polyline points={pts(j.hipR, j.kn2, j.an2, j.toe2)} /></g>}
      {!far && j.f && <><polyline points={pts(j.sh2, j.el2, j.wr2)} /><polyline points={pts(j.hipR, j.kn2, j.an2, j.toe2)} /></>}
      {j.f && <><line x1={f2(j.sh[0])} y1={f2(j.sh[1])} x2={f2(j.sh2[0])} y2={f2(j.sh2[1])} /><line x1={f2(j.hipL[0])} y1={f2(j.hipL[1])} x2={f2(j.hipR[0])} y2={f2(j.hipR[1])} /></>}
      <polyline points={pts(j.hipL, j.kn, j.an, j.toe)} />
      <line x1={f2(j.hip[0])} y1={f2(j.hip[1])} x2={f2(j.neck[0])} y2={f2(j.neck[1])} />
      <polyline points={pts(j.sh, j.el, j.wr)} />
      <circle className="xp-hd" cx={f2(j.head[0])} cy={f2(j.head[1])} r={4.6} />
    </g>
  );
}

/** One frame of the figure with its equipment. */
function Frame({ scene, pose, muscles, ghost }: { scene: Scene; pose: Pose; muscles: Muscle[]; ghost?: Pose }) {
  const j = solve(pose);
  const g = ghost ? solve(ghost) : null;
  const front = j.f;
  const both = front && !!scene.two;
  const plat = scene.plat;
  const platLine = (p: V2) => {
    if (!plat) return null;
    const c = addV(p, dirA(plat.ang + 90, plat.off ?? 0));
    if (plat.len <= 2) return <circle className="xp-roll" cx={f2(c[0])} cy={f2(c[1])} r={2.3} />;
    const a = addV(c, dirA(plat.ang, plat.len / 2)), b = addV(c, dirA(plat.ang, -plat.len / 2));
    return <line className="xp-pad" x1={f2(a[0])} y1={f2(a[1])} x2={f2(b[0])} y2={f2(b[1])} />;
  };
  return (
    <>
      {g && (
        <g className="xp-ghost">
          <Body j={g} far={false} />
        </g>
      )}
      {scene.cable && <line className="xp-cab" x1={scene.cable[0]} y1={scene.cable[1]} x2={f2(spot(j, scene.cableTo)[0])} y2={f2(spot(j, scene.cableTo)[1])} />}
      {scene.cable2 && <line className="xp-cab" x1={scene.cable2[0]} y1={scene.cable2[1]} x2={f2(spot(j, scene.cableTo, true)[0])} y2={f2(spot(j, scene.cableTo, true)[1])} />}
      {scene.lever && <line className="xp-lev" x1={scene.lever.p[0]} y1={scene.lever.p[1]} x2={f2(spot(j, scene.lever.to)[0])} y2={f2(spot(j, scene.lever.to)[1])} />}
      {plat && platLine(spot(j, plat.at))}
      {plat && both && platLine(spot(j, plat.at, true))}
      <g className="xp-m">{marks(j, muscles).map((m, i) => <ellipse key={i} cx={f2(m.c[0])} cy={f2(m.c[1])} rx={f2(m.rx)} ry={f2(m.ry)} transform={`rotate(${f2(m.rot)} ${f2(m.c[0])} ${f2(m.c[1])})`} />)}</g>
      {scene.hold === "bar" && !front && <Held kind="bar" p={spot(j, scene.at)} fa={j.fa} front={front} />}
      <Body j={j} far={!front} />
      {scene.wheel && <circle className="xp-roll" cx={f2(j.grip[0])} cy={f2(j.grip[1] + 1)} r={3.2} />}
      {both && scene.hold === "bar" && <line className="xp-wbar" x1={f2(j.grip[0] - 9)} y1={f2(j.grip[1])} x2={f2(j.grip2[0] + 9)} y2={f2(j.grip2[1])} />}
      {scene.hold !== "bar" && <Held kind={scene.hold} p={spot(j, scene.at)} fa={j.fa} front={front} />}
      {both && <Held kind={scene.hold} p={spot(j, scene.at, true)} fa={j.fa2} front={front} />}
    </>
  );
}

const PRIM_CLS: Record<string, string> = { l: "xp-eq", pad: "xp-pad", rail: "xp-rail" };
function Gear({ scene }: { scene: Scene }) {
  return (
    <g>
      {scene.eq.map((p, i) => {
        if (p[0] === "c") return <circle key={i} className="xp-pul" cx={p[1]} cy={p[2]} r={p[3]} />;
        if (p[0] === "stack") return <g key={i} className="xp-stack"><rect x={p[1]} y={p[2]} width={p[3]} height={p[4]} rx={1} /><line x1={p[1]} y1={p[2] + p[4] / 3} x2={p[1] + p[3]} y2={p[2] + p[4] / 3} /><line x1={p[1]} y1={p[2] + (2 * p[4]) / 3} x2={p[1] + p[3]} y2={p[2] + (2 * p[4]) / 3} /></g>;
        if (p[0] === "box") return <rect key={i} className="xp-box" x={p[1]} y={p[2]} width={p[3]} height={p[4]} rx={1.6} />;
        return <line key={i} className={PRIM_CLS[p[0]]} x1={p[1]} y1={p[2]} x2={p[3]} y2={p[4]} />;
      })}
    </g>
  );
}

export type PicMode = "still" | "play" | "start" | "end";

/** The picture itself: `still` shows the start with the end faint behind it, `play` loops one rep. Memoised (V1.47):
 *  a list re-rendering (a search letter, a tick) never redraws the pictures that did not change. */
export const PicArt = memo(function PicArt({ pic, mode, title, at }: { pic: Pic | null; mode: PicMode; title?: string; at?: number }) {
  const reduced = useReducedMotion();
  const play = mode === "play" && !reduced && !!pic && at == null;
  const k = useRep(play, !!pic?.scene.hold2);
  if (!pic) {
    // Unknown exercise: a neutral standing figure, no equipment, no colour.
    const j = solve({ hip: [50, 54.5], t: 180, arm: [8, 4], leg: { at: [50, FLOOR] } });
    return (
      <svg className="xp xp-none" viewBox="18 14 64 74" role="img" aria-label={title ?? "No picture for this exercise yet"}>
        <line className="xp-fl" x1={26} y1={FLOOR + 0.6} x2={74} y2={FLOOR + 0.6} />
        <Body j={j} far={false} />
      </svg>
    );
  }
  const s = pic.scene;
  const pose = at != null ? blend(s.a, s.b, at) : mode === "end" ? s.b : k > 0 ? blend(s.a, s.b, k) : s.a;
  const ghost = mode === "still" && at == null && !s.hold2 && k === 0 ? s.b : undefined;
  return (
    <svg className="xp" viewBox={sceneBox(s)} role="img" aria-label={title ?? pic.exercise.name}>
      <line className="xp-fl" x1={-20} y1={FLOOR + 0.6} x2={120} y2={FLOOR + 0.6} />
      <Gear scene={s} />
      <Frame scene={s} pose={pose} muscles={pic.muscles} ghost={ghost} />
    </svg>
  );
});

// ---------- drawn only near the screen (V1.47) ----------
// The exercise list has 153 pictures and the program library about as many: drawing all of them at once held the
// phone up for a long moment. A thumbnail draws its figure once it comes within a screen of view, then keeps it.
let io: IntersectionObserver | null = null;
const nearSubs = new WeakMap<Element, () => void>();
function nearObserver(): IntersectionObserver | null {
  if (io || typeof IntersectionObserver === "undefined") return io;
  io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) { const f = nearSubs.get(e.target); nearSubs.delete(e.target); io!.unobserve(e.target); f?.(); }
  }, { rootMargin: "600px 0px" });
  return io;
}
function useNear(ref: RefObject<Element | null>): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current, o = nearObserver();
    if (near || !el || !o) { if (!near) setNear(true); return; }
    nearSubs.set(el, () => setNear(true));
    o.observe(el);
    return () => { nearSubs.delete(el); o.unobserve(el); };
  }, [near]); // eslint-disable-line react-hooks/exhaustive-deps
  return near;
}

// ---------- the thumbnail and its card ----------
const fine = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(hover: hover) and (pointer: fine)") : null;

/** A small picture beside an exercise name. Hover plays a rep (mouse), a tap opens the big card. */
export const ExPic = memo(function ExPic({ exId, name, size = 56, className, card = true }: { exId?: string | null; name: string; size?: number; className?: string; card?: boolean }) {
  const pic = useMemo(() => picFor(exId, name), [exId, name]);
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null), spanRef = useRef<HTMLSpanElement>(null);
  const near = useNear(card ? ref : spanRef);
  const label = pic ? `Picture of ${name}. Tap to see it done` : `${name}: no picture yet`;
  const art = near ? <PicArt pic={pic} mode={hover ? "play" : "still"} title={label} /> : null;
  if (!card) return <span ref={spanRef} className={`xp-thumb${className ? ` ${className}` : ""}`} style={{ width: size, height: size * 0.9 }} aria-hidden="true">{art}</span>;
  return (
    <>
      <button ref={ref} type="button" className={`xp-thumb${pic ? "" : " none"}${className ? ` ${className}` : ""}`} style={{ width: size, height: size * 0.9 }}
        aria-label={label} onPointerEnter={(e) => { if (e.pointerType === "mouse" && fine?.matches) setHover(true); }} onPointerLeave={() => setHover(false)}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); haptic("press"); setHover(false); setOpen(true); }}>
        {art}
      </button>
      {open && <PicCard pic={pic} name={name} anchor={ref.current} onClose={() => setOpen(false)} />}
    </>
  );
});

/** An exercise card is open (V1.43): sheets and panels under it leave back and Escape to it, whatever order their
 *  window listeners were added in. */
export const picCardOpen = () => typeof document !== "undefined" && !!document.querySelector(".xp-card:not(.out)");

export function PicCard({ pic, name, anchor, onClose }: { pic: Pic | null; name: string; anchor: HTMLElement | null; onClose: () => void }) {
  const reduced = useReducedMotion();
  const [out, setOut] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const gone = useRef(false);
  const close = () => { if (gone.current) return; gone.current = true; setOut(true); window.setTimeout(() => closeRef.current(), 220); };
  const closeFn = useRef(close);
  closeFn.current = close;
  useEffect(() => {
    // Escape and the phone's back button close the card first (capture: before the Fitness panels).
    const back = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); closeFn.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); closeFn.current(); } };
    window.addEventListener("gos-back", back, true);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("gos-back", back, true); window.removeEventListener("keydown", key, true); };
  }, []);
  const host = (anchor?.closest(".fit") as HTMLElement | null) ?? (typeof document !== "undefined" ? document.body : null);
  if (!host) return null;
  const x = pic?.exercise;
  const muscles = x ? x.muscles.map((m) => MUSCLE_LABEL[m]).join(", ") : "";
  const body: ReactNode = (
    <div className={`xp-card${out ? " out" : ""}`} role="dialog" aria-modal="true" aria-label={name}>
      <div className="xp-card-bg" onClick={close} />
      <div className="xp-card-in">
        <button type="button" className="xp-card-x" onClick={close} aria-label="Close"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        <h3 className="xp-card-h">{name}</h3>
        {pic && pic.how !== "exact" && <p className="xp-card-like">Looks like {x!.name}{pic.how === "guess" ? " (a guess from the name)" : ""}</p>}
        {reduced && pic && !pic.scene.hold2 ? (
          <div className="xp-card-two">
            <figure><div className="xp-card-art"><PicArt pic={pic} mode="start" /></div><figcaption>Start</figcaption></figure>
            <figure><div className="xp-card-art"><PicArt pic={pic} mode="end" /></div><figcaption>End</figcaption></figure>
          </div>
        ) : (
          <div className="xp-card-art big"><PicArt pic={pic} mode="play" /></div>
        )}
        {pic ? (
          <>
            {muscles && <p className="xp-card-mus"><span className="xp-dot" aria-hidden="true" />Works: {muscles}</p>}
            {x?.cue && <p className="xp-card-cue">{x.cue}</p>}
          </>
        ) : (
          <p className="xp-card-cue">PS app does not know this one yet, so there is no picture. Pick it from the list when you add it and the picture comes with it.</p>
        )}
      </div>
    </div>
  );
  return createPortal(body, host);
}

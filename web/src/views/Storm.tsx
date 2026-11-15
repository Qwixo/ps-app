// Red lightning backgrounds for the Tab list (Settings, gear > Background; the developer, 18 Oct 2026).
// A layer of its own behind everything: rows and panels get solid backings while it is on, so
// the list itself never flickers. Nothing runs between strikes (no frame loop): each strike is a
// path drawn once and faded with the Web Animations API, scheduled with setTimeout. It only runs
// while the list is actually showing (PS keeps its window alive while hidden), and thunder plays
// at most one at a time, only then, and never louder than the volume the developer set.
import { useEffect, useRef } from "react";
import { PS, psOverlayShown, psPost, useOverlayShown } from "../ps";
import { thunder } from "../ui/sfx";
import { PREVIEW_STRIKES_MS } from "../core/looksample";
import "./storm.css";

export type StormKind = "storm-forked" | "storm-sheet" | "storm-edges" | "storm-aimed" | "storm-rumble";
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
type Pt = [number, number];
const pathOf = (p: Pt[]) => p.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");

/** A jagged bolt from a to b (the zig zag scales with the distance). */
function bolt(a: Pt, b: Pt, jag = 0.12): Pt[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(6, Math.round(len / 34));
  const nx = -(b[1] - a[1]) / (len || 1), ny = (b[0] - a[0]) / (len || 1);
  const out: Pt[] = [a];
  for (let i = 1; i < steps; i++) {
    const t = i / steps, off = (Math.random() - 0.5) * len * jag * (1 - Math.abs(0.5 - t));
    out.push([a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + ny * off]);
  }
  out.push(b);
  return out;
}
/** A small side branch from somewhere along a bolt. */
function branch(main: Pt[], reach: number): Pt[] {
  const from = main[Math.floor(main.length * rnd(0.25, 0.7))];
  const ang = Math.atan2(main[main.length - 1][1] - main[0][1], main[main.length - 1][0] - main[0][0]) + rnd(-1, 1) * 0.9;
  return bolt(from, [from[0] + Math.cos(ang) * reach, from[1] + Math.sin(ang) * reach], 0.25);
}

/** Thunder after a strike: the further away it is meant to be, the longer the wait and the softer the sound. */
const SOUND: Record<StormKind, { name: string; delay: [number, number]; loud: number }> = {
  "storm-forked": { name: "thunder-crack", delay: [180, 650], loud: 1 },
  "storm-aimed": { name: "thunder-crack", delay: [120, 400], loud: 1 },
  "storm-edges": { name: "thunder-roll", delay: [500, 1400], loud: 0.85 },
  "storm-sheet": { name: "thunder-roll", delay: [900, 2000], loud: 0.75 },
  "storm-rumble": { name: "thunder-far", delay: [1500, 3200], loud: 0.6 },
};

export function Storm({ kind, intensity, frequency, sound, volume, soon }: {
  kind: StormKind; intensity: number; frequency: number; sound: boolean; volume: number;
  /** A two second preview (More settings): strike almost at once, then again within the preview. */
  soon?: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null), flash = useRef<HTMLDivElement>(null);
  const shown = useOverlayShown();
  const opts = useRef({ kind, intensity, frequency, sound, volume });
  opts.current = { kind, intensity, frequency, sound, volume };
  useEffect(() => {
    if (!shown || reduced()) return;
    let t = 0, stopped = false;
    const strike = () => {
      const s = svg.current, f = flash.current;
      if (stopped || !s || !f) return;
      const { kind: k, intensity: inten, sound: snd, volume: vol } = opts.current;
      const W = s.clientWidth, H = s.clientHeight, i = Math.max(0.05, inten / 100);
      if (W > 50 && H > 50) {
        let mains: Pt[] = [], twigs: Pt[][] = [], fx = 50, fy = 0, flashPeak = 0.45 * i, boltPeak = 0.55 + 0.45 * i;
        const root = s.closest<HTMLElement>(".tm-overlay");
        const cs = root ? getComputedStyle(root) : null;
        const gx = parseFloat(cs?.getPropertyValue("--p1x") || "") || W / 2, gy = parseFloat(cs?.getPropertyValue("--p1y") || "") || H * 0.32;
        const gw = parseFloat(cs?.getPropertyValue("--p1w") || "") || 600, gh = parseFloat(cs?.getPropertyValue("--p1h") || "") || 160;
        if (k === "storm-forked") {
          const x0 = rnd(0.05, 0.95) * W;
          mains = bolt([x0, -8], [x0 + rnd(-0.12, 0.12) * W, rnd(0.35, 0.85) * H]);
          for (let n = 0; n < 1 + Math.round(i * 2); n++) twigs.push(branch(mains, rnd(60, 160)));
          fx = (x0 / W) * 100; fy = 0;
        } else if (k === "storm-aimed") {
          // From an edge toward the P1 group, stopping at the edge of its outline.
          const side = Math.floor(rnd(0, 3));
          const start: Pt = side === 0 ? [rnd(0.05, 0.95) * W, -8] : side === 1 ? [-8, rnd(0.05, 0.6) * H] : [W + 8, rnd(0.05, 0.6) * H];
          const dx = gx - start[0], dy = gy - start[1], d = Math.hypot(dx, dy) || 1;
          const sx = (gw / 2 + 12) / Math.abs(dx / d || 1e-6), sy = (gh / 2 + 12) / Math.abs(dy / d || 1e-6);
          const stop = Math.min(sx, sy, d - 20);
          const end: Pt = [gx - (dx / d) * stop, gy - (dy / d) * stop];
          mains = bolt(start, end);
          for (let n = 0; n < Math.round(i * 2); n++) twigs.push(branch(mains, rnd(40, 110)));
          fx = (end[0] / W) * 100; fy = (end[1] / H) * 100; flashPeak = 0.35 * i;
        } else if (k === "storm-edges") {
          // Short bolts that stay along the left or right edge, with a glow on that side.
          const left = Math.random() < 0.5, x0 = left ? rnd(0.01, 0.1) * W : rnd(0.9, 0.99) * W;
          mains = bolt([x0, -8], [x0 + rnd(-0.03, 0.03) * W, rnd(0.3, 0.75) * H], 0.08);
          if (i > 0.4) twigs.push(branch(mains, rnd(30, 80)));
          fx = left ? 0 : 100; fy = rnd(10, 60);
        } else if (k === "storm-sheet") {
          fx = rnd(10, 90); fy = rnd(0, 25); flashPeak = 0.6 * i; boltPeak = 0;
        } else {
          fx = rnd(10, 90); fy = 100; flashPeak = 0.28 * i; boltPeak = 0;
        }
        s.querySelectorAll<SVGPathElement>("path.m").forEach((p) => p.setAttribute("d", mains.length ? pathOf(mains) : ""));
        s.querySelectorAll<SVGPathElement>("path.b").forEach((p) => p.setAttribute("d", twigs.map(pathOf).join(" ")));
        f.style.setProperty("--fx", `${fx.toFixed(1)}%`);
        f.style.setProperty("--fy", `${fy.toFixed(1)}%`);
        f.dataset.kind = k;
        s.parentElement!.dataset.strikes = String(Number(s.parentElement!.dataset.strikes || 0) + 1);   // counted for PS's self test
        const slow = k === "storm-rumble" ? 1.8 : k === "storm-sheet" ? 1.3 : 1;
        if (boltPeak > 0) s.animate([{ opacity: 0 }, { opacity: boltPeak, offset: 0.05 }, { opacity: boltPeak * 0.2, offset: 0.13 }, { opacity: boltPeak * 0.85, offset: 0.2 }, { opacity: 0 }], { duration: 700, easing: "ease-out" });
        f.animate([{ opacity: 0 }, { opacity: flashPeak, offset: 0.06 }, { opacity: flashPeak * 0.25, offset: 0.16 }, { opacity: flashPeak * 0.8, offset: 0.25 }, { opacity: 0 }], { duration: 1000 * slow, easing: "ease-out" });
        // Thunder, if the developer switched it on: one at a time, only while the list is showing.
        if (snd && vol > 0) {
          const spec = SOUND[k];
          window.setTimeout(() => {
            if (stopped || (PS && !psOverlayShown())) return;
            const v = (vol / 100) * spec.loud * (0.6 + 0.4 * i);
            if (PS) psPost({ type: "thunder", name: spec.name, vol: Math.round(v * 100) / 100 });
            else thunder(spec.name, v);
          }, rnd(spec.delay[0], spec.delay[1]));
        }
      }
      // Next strike: 0 = about every 20 s, 100 = about every 1.5 s (give or take half).
      const f01 = Math.max(0, Math.min(1, opts.current.frequency / 100));
      t = window.setTimeout(strike, (1500 + 20000 * (1 - f01) * (1 - f01)) * rnd(0.5, 1.5));
    };
    // A preview (five seconds): strike at fixed times inside it whatever the frequency, so it is really seen (V1.43:
    // one strike near the start used to fade before the eye found it, and the preview looked empty).
    const extra = soon ? PREVIEW_STRIKES_MS.slice(1).map((ms) => window.setTimeout(() => { clearTimeout(t); strike(); }, ms)) : [];
    t = window.setTimeout(strike, soon ? PREVIEW_STRIKES_MS[0] : rnd(500, 1500));
    return () => { stopped = true; clearTimeout(t); extra.forEach(clearTimeout); };
  }, [shown, kind, soon]);
  return (
    <div className={`tm-storm ${kind}`} aria-hidden="true">
      <div ref={flash} className="tm-storm-flash" />
      <svg ref={svg} className="tm-storm-bolt" width="100%" height="100%">
        <path className="m glow" /><path className="b glow" /><path className="m core" /><path className="b core thin" />
      </svg>
    </div>
  );
}

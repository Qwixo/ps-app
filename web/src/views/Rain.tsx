// Rain over the Tab list (V1.40, Settings > Looks > Rain; the rules and kinds are core/rain.ts). One Canvas 2D layer
// in front of the background and behind the list (no WebGL). Cheap on purpose:
//  - the frame loop runs only while the list is showing, the page is visible and Reduce motion is off; otherwise it
//    is stopped completely (no timers, no frames);
//  - at most 60 frames a second, even on a 120 Hz screen;
//  - falling rain is three strokes a frame (near, middle, far drops each one path); rain on glass is one small
//    pre drawn drop image stamped per bead;
//  - the canvas is drawn at no more than 1.5x the screen's pixels.
// The storm's lightning is a soft flash of one plain layer (Web Animations), a few times a minute at most.
import { useEffect, useRef } from "react";
import { useOverlayShown } from "../ps";
import { FRAME_MS, rainRuns, rainSpec, type RainId, type RainSpec } from "../core/rain";
import "./rain.css";

const reducedNow = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** The rain colour: the look's text colour (light on dark looks, dark on paper looks), read from the page. */
function rainRgb(el: Element): [number, number, number] {
  const v = getComputedStyle(el).getPropertyValue("--k-fg").trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  return [214, 226, 242];
}

/** A drop of water seen on glass: a dark rim, a clear middle and one bright highlight. Drawn once, stamped per bead. */
function dropSprite(rgb: [number, number, number]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const [r, gg, b] = rgb;
  const body = g.createRadialGradient(28, 26, 4, 32, 32, 30);
  body.addColorStop(0, `rgba(${r},${gg},${b},0.05)`);
  body.addColorStop(0.7, `rgba(${r},${gg},${b},0.16)`);
  body.addColorStop(0.92, `rgba(${r},${gg},${b},0.42)`);
  body.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = body;
  g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
  const hi = g.createRadialGradient(24, 21, 0, 24, 21, 9);
  hi.addColorStop(0, "rgba(255,255,255,0.85)");
  hi.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = hi;
  g.beginPath(); g.arc(24, 21, 9, 0, Math.PI * 2); g.fill();
  return c;
}

type Falling = { x: Float32Array; y: Float32Array; z: Float32Array; len: Float32Array; v: Float32Array };
type Beads = { x: Float32Array; y: Float32Array; r: Float32Array; vy: Float32Array; top: Float32Array; a: Float32Array; wob: Float32Array };

export function Rain({ kind, amount }: { kind: RainId; amount: number }) {
  const cv = useRef<HTMLCanvasElement>(null), flash = useRef<HTMLDivElement>(null);
  const shown = useOverlayShown();
  const amt = useRef(amount);
  amt.current = amount;
  useEffect(() => {
    const canvas = cv.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    let raf = 0, last = 0, t = 0, W = 0, H = 0, dpr = 1, spec: RainSpec = rainSpec(kind, amt.current, 0, 0);
    let rgb = rainRgb(canvas), sprite: HTMLCanvasElement | null = null, frames = 0, flashAt = 0;
    let fall: Falling | null = null, beads: Beads | null = null;
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const runs = () => rainRuns({ kind, shown, visible: visible(), reduced: reducedNow(), docked: false });

    const seedFalling = (n: number): Falling => {
      const f: Falling = { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), len: new Float32Array(n), v: new Float32Array(n) };
      for (let i = 0; i < n; i++) {
        f.z[i] = Math.random();
        f.x[i] = rnd(-0.4 * H, W + 0.1 * H);
        f.y[i] = rnd(-H, H);
        f.len[i] = rnd(spec.len[0], spec.len[1]) * (0.55 + 0.45 * f.z[i]);
        f.v[i] = rnd(spec.speed[0], spec.speed[1]) * (0.6 + 0.4 * f.z[i]);
      }
      return f;
    };
    const newBead = (b: Beads, i: number, anywhere: boolean) => {
      b.x[i] = rnd(0, W); b.y[i] = anywhere ? rnd(0, H) : rnd(0, H * 0.85);
      b.r[i] = Math.random() < 0.18 ? rnd(5, 9) : rnd(1.5, 4.5);
      b.vy[i] = 0; b.top[i] = b.y[i]; b.a[i] = anywhere ? 1 : 0; b.wob[i] = rnd(0, 6.28);
    };
    const seedBeads = (n: number): Beads => {
      const b: Beads = { x: new Float32Array(n), y: new Float32Array(n), r: new Float32Array(n), vy: new Float32Array(n), top: new Float32Array(n), a: new Float32Array(n), wob: new Float32Array(n) };
      for (let i = 0; i < n; i++) newBead(b, i, true);
      return b;
    };
    const size = () => {
      const r = canvas.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      spec = rainSpec(kind, amt.current, W, H);
      rgb = rainRgb(canvas);
      if (spec.glass) { beads = seedBeads(spec.drops); fall = null; sprite = dropSprite(rgb); }
      else { fall = seedFalling(spec.drops); beads = null; }
    };

    const drawFalling = (f: Falling, dt: number) => {
      const gust = spec.gust ? spec.gust * (Math.sin(t * 0.35) + 0.5 * Math.sin(t * 0.9 + 1.3)) : 0;
      const slant = spec.slant + gust;
      const n = f.x.length;
      for (let i = 0; i < n; i++) {
        const dy = f.v[i] * H * dt;
        f.y[i] += dy; f.x[i] += dy * slant;
        if (f.y[i] - f.len[i] > H) { f.y[i] = -rnd(0, H * 0.25); f.x[i] = rnd(-0.4 * H, W + 0.1 * H); }
      }
      ctx.lineCap = "round";
      const [r, g, b] = rgb;
      for (let layer = 0; layer < 3; layer++) {
        const lo = layer / 3, hi = (layer + 1) / 3, mid = (lo + hi) / 2;
        ctx.strokeStyle = `rgba(${r},${g},${b},${(spec.alpha[0] + (spec.alpha[1] - spec.alpha[0]) * mid).toFixed(3)})`;
        ctx.lineWidth = spec.width * (0.55 + 0.7 * mid);
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const z = f.z[i];
          if (z < lo || z >= hi) continue;
          const x = f.x[i], y = f.y[i], l = f.len[i];
          ctx.moveTo(x, y); ctx.lineTo(x - l * slant, y - l);
        }
        ctx.stroke();
      }
    };
    const drawGlass = (b: Beads, dt: number) => {
      const n = b.x.length, [r, g, bl] = rgb;
      // Now and then a big enough bead lets go and runs down, a little wobbly, leaving a fading trail.
      const startChance = dt * (0.25 + 0.75 * amt.current / 100) * 0.05;
      ctx.lineCap = "round";
      for (let i = 0; i < n; i++) {
        if (b.a[i] < 1) b.a[i] = Math.min(1, b.a[i] + dt * 0.8);
        if (b.vy[i] === 0 && b.r[i] > 3.2 && Math.random() < startChance) { b.vy[i] = rnd(spec.speed[0], spec.speed[1]); b.top[i] = b.y[i]; }
        if (b.vy[i] > 0) {
          // Runs in bursts: quick, then almost stuck, like a real drop on a window.
          const burst = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.2 + b.wob[i]));
          b.y[i] += b.vy[i] * H * dt * burst;
          b.x[i] += Math.sin(t * 1.7 + b.wob[i]) * 0.12;
          b.top[i] += (b.y[i] - b.top[i]) * Math.min(1, dt * 0.35);
          const tl = b.y[i] - b.top[i];
          if (tl > 2) {
            ctx.strokeStyle = `rgba(${r},${g},${bl},${(0.16 * b.a[i]).toFixed(3)})`;
            ctx.lineWidth = Math.max(1, b.r[i] * 0.55);
            ctx.beginPath(); ctx.moveTo(b.x[i], b.top[i]); ctx.lineTo(b.x[i], b.y[i]); ctx.stroke();
          }
          if (b.top[i] > H + 10) newBead(b, i, false);
        }
        const d = b.r[i] * 2;
        ctx.globalAlpha = b.a[i] * (spec.alpha[0] + (spec.alpha[1] - spec.alpha[0]) * Math.min(1, b.r[i] / 7));
        ctx.drawImage(sprite!, b.x[i] - b.r[i], b.y[i] - b.r[i] * 1.1, d, d * 1.15);
      }
      ctx.globalAlpha = 1;
    };
    const lightning = (now: number) => {
      if (!spec.flash || !flash.current) return;
      if (!flashAt) { flashAt = now + rnd(spec.flash[0], spec.flash[1]) * 1000 * (1.4 - 0.8 * amt.current / 100); return; }
      if (now < flashAt) return;
      flashAt = 0;
      const p = 0.18 + 0.2 * amt.current / 100;
      flash.current.animate([{ opacity: 0 }, { opacity: p, offset: 0.05 }, { opacity: p * 0.2, offset: 0.14 }, { opacity: p * 0.75, offset: 0.22 }, { opacity: 0 }],
        { duration: 1100, easing: "ease-out" });
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < FRAME_MS - 2) return;      // 60 a second at most
      const dt = Math.min(0.05, last ? (now - last) / 1000 : FRAME_MS / 1000);
      last = now; t += dt;
      ctx.clearRect(0, 0, W, H);
      if (fall) drawFalling(fall, dt);
      else if (beads && sprite) drawGlass(beads, dt);
      lightning(now);
      if (++frames % 60 === 0) canvas.dataset.frames = String(frames);   // read by the self test and the pictures, once a second
    };
    const start = () => {
      if (raf || !runs()) return;
      last = 0;
      raf = requestAnimationFrame(frame);
      canvas.dataset.run = "1";
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; flashAt = 0;
      canvas.dataset.run = "0";
    };
    size();
    if (!runs()) { stop(); ctx.clearRect(0, 0, W, H); return; }
    start();
    const ro = new ResizeObserver(() => { size(); });
    ro.observe(canvas);
    const vis = () => (runs() ? start() : stop());
    document.addEventListener("visibilitychange", vis);
    const mq = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    mq?.addEventListener?.("change", vis);
    // The look can change under it (paper looks get dark rain): read the colour again when it does.
    const mo = new MutationObserver(() => { rgb = rainRgb(canvas); if (spec.glass) sprite = dropSprite(rgb); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-look", "style"] });
    return () => { stop(); ro.disconnect(); mo.disconnect(); document.removeEventListener("visibilitychange", vis); mq?.removeEventListener?.("change", vis); };
  }, [kind, shown, amount]);   // a new amount reseeds the drops
  return (
    <div className={`tm-rain rain-${kind}`} aria-hidden="true">
      <canvas ref={cv} className="tm-rain-c" data-kind={kind} />
      {kind === "storm" && <div ref={flash} className="tm-rain-flash" />}
    </div>
  );
}

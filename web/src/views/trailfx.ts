// Mouse trail drawing (V1.43, Settings > Appearance > Mouse trail; the rules, kinds and caps are core/trail.ts).
// One Canvas 2D engine (no WebGL) shared by the Tab list, the website's To-do page, the Settings preview and the
// little picture on each effect's tile. Cheap on purpose:
//  - no frame loop at all until the mouse moves; it stops by itself once everything has faded (about a second after
//    the last move), and clears what it drew;
//  - at most 60 frames a second, even on a 120 Hz screen;
//  - every particle lives in one fixed size typed array store (core/trail.ts Pool), capped per effect and per move;
//  - glows are small pre drawn pictures stamped with drawImage (no shadowBlur), sparks are batched into a few paths;
//  - only the part of the canvas drawn on the last frame is cleared.
import {
  FRAME_MS, IDLE_MS, MAX_PARTICLES, Pool, burstCount, emitCount, hexRgb, inkFor, intensityScale, particleCap, sizeScale,
  type TrailFx, type TrailId,
} from "../core/trail";

export type TrailLive = { kind: TrailId; fx: TrailFx; burst: boolean };
type Rgb = [number, number, number];
type Pt = { x: number; y: number; t: number };

const SPARK = 0, DOT = 1, STAR = 2, BUBBLE = 3, FLAKE = 4, PIXEL = 7, RING = 8, EMBER = 10, HUEDOT = 11;
const TAU = Math.PI * 2;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${clamp(a, 0, 1).toFixed(3)})`;
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
const WHITE: Rgb = [255, 255, 255], BLACK: Rgb = [0, 0, 0];
const hueOf = ([r, g, b]: Rgb) => {
  const R = r / 255, G = g / 255, B = b / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn;
  if (!d) return 0;
  const h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return (h * 60 + 360) % 360;
};
function hslRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const RAINBOW: Rgb[] = [0, 40, 80, 140, 190, 230, 270, 315].map((h) => hslRgb(h, 1, 0.6));

/** The colours an effect draws with: its picked colour with a lighter and a deeper shade, or its own mix. */
function paletteOf(kind: TrailId, fx: TrailFx, light: boolean): Rgb[] {
  let list: Rgb[];
  if (fx.c === "multi") list = RAINBOW;
  else { const b = hexRgb(fx.c); list = [b, mix(b, WHITE, 0.4), mix(b, BLACK, 0.28)]; }
  return list.map((c) => inkFor(c, light));
}

// ---------- small pre drawn pictures, made once per colour ----------
const SPRITES = new Map<string, HTMLCanvasElement>();
function sprite(kind: "glow" | "core" | "blot", rgb: Rgb): HTMLCanvasElement {
  const key = `${kind}${rgb.join(",")}`;
  const had = SPRITES.get(key);
  if (had) return had;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (kind === "glow") {
    grd.addColorStop(0, rgba(rgb, 0.85)); grd.addColorStop(0.22, rgba(rgb, 0.5)); grd.addColorStop(0.55, rgba(rgb, 0.13)); grd.addColorStop(1, rgba(rgb, 0));
  } else if (kind === "core") {
    grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.18, rgba(mix(rgb, WHITE, 0.6), 0.95)); grd.addColorStop(0.45, rgba(rgb, 0.4)); grd.addColorStop(1, rgba(rgb, 0));
  } else {
    grd.addColorStop(0, rgba(rgb, 0.9)); grd.addColorStop(0.5, rgba(rgb, 0.62)); grd.addColorStop(0.78, rgba(rgb, 0.28)); grd.addColorStop(1, rgba(rgb, 0));
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  if (SPRITES.size > 160) SPRITES.clear();
  SPRITES.set(key, c);
  return c;
}

/** A jagged line between two points (midpoint displacement), appended to `out` as x, y pairs (the start left out). */
function jag(out: number[], ax: number, ay: number, bx: number, by: number, rough: number, depth: number) {
  if (depth <= 0) { out.push(bx, by); return; }
  const mx = (ax + bx) / 2, my = (ay + by) / 2, len = Math.hypot(bx - ax, by - ay);
  const nx = -(by - ay) / (len || 1), ny = (bx - ax) / (len || 1);
  const off = (Math.random() - 0.5) * len * rough;
  jag(out, ax, ay, mx + nx * off, my + ny * off, rough, depth - 1);
  jag(out, mx + nx * off, my + ny * off, bx, by, rough, depth - 1);
}

export type TrailEngine = {
  /** The mouse moved to x, y (canvas css px) at `t` ms. `inside`: over the list, so the effect draws. */
  move(x: number, y: number, t?: number): void;
  /** A click at x, y (the Burst, when it is on). */
  down(x: number, y: number, t?: number): void;
  /** The mouse left: ribbons fade out, nothing new is added. */
  leave(): void;
  /** Wipe everything and stop the frame loop (the list hid, the page went to the background). */
  clear(): void;
  /** Re-read the canvas size (after a resize). */
  resize(): void;
  /** One frame by hand at `t` ms (the tile pictures, tests): no loop is started. */
  frame(t: number): void;
  /** Live particles (tests, the Settings preview). */
  count(): number;
  stop(): void;
};

/** The engine on one canvas. `get` hands in the effect, colour, size and intensity at every move, so a change in
 *  Settings shows at once. `manual`: never start a frame loop (frames come from `frame`). */
export function createTrail(canvas: HTMLCanvasElement, get: () => TrailLive, o: { maxDpr?: number; manual?: boolean } = {}): TrailEngine {
  const ctx = canvas.getContext("2d", { alpha: true })!;
  const pool = new Pool(MAX_PARTICLES);
  const hist: Pt[] = [];
  let W = 1, H = 1, dpr = 1, raf = 0, last = 0, lastMove = -1e9, lx = NaN, ly = NaN, carry = 0, speed = 0;
  let light = false, live: TrailLive = get(), pal: Rgb[] = [], kindNow: TrailId = live.kind;
  let box = { x0: 0, y0: 0, x1: 0, y1: 0 }, dirty = false;
  // the Electric orb, the Sparkler tip, Lightning's bolts and the Blade's afterimages
  const orb = { x: NaN, y: NaN, vx: 0, vy: 0, a: 0, tx: 0, ty: 0 };
  let tip = 0, bolts: number[][] = [], boltAt = 0, flick = 1, arcs: number[][] = [], arcAt = 0, pixKey = "";
  let slashes: { pts: number[]; at: number; nx: number; ny: number }[] = [], slashAt = 0;

  const S = () => sizeScale(live.fx.s), I = () => intensityScale(live.fx.i);
  const readLook = () => {
    const v = getComputedStyle(canvas).getPropertyValue("--k-fg").trim();
    const m = /^#([0-9a-f]{6})$/i.exec(v);
    if (m) { const [r, g, b] = hexRgb(`#${m[1]}`); light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45; }
    else light = false;
  };
  const refresh = () => {
    live = get();
    if (live.kind !== kindNow) { kindNow = live.kind; pool.clear(); hist.length = 0; bolts = []; arcs = []; slashes = []; orb.a = 0; orb.x = NaN; tip = 0; }
    pal = paletteOf(live.kind, live.fx, light);
  };
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    dpr = Math.min(o.maxDpr ?? 1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    box = { x0: 0, y0: 0, x1: W, y1: H }; dirty = true;
    readLook(); pal = paletteOf(live.kind, live.fx, light);
  };
  resize();

  const tone = () => Math.floor(Math.random() * pal.length);
  const add = (x: number, y: number, vx: number, vy: number, life: number, size: number, type: number) => {
    if (pool.n >= particleCap(live.kind, live.fx.i) && type !== RING) return -1;
    const i = pool.add(x, y, vx, vy, life, size, type);
    if (i >= 0) pool.tone[i] = tone();
    return i;
  };

  // ---------- adding particles as the mouse moves ----------
  function spawn(x: number, y: number, dx: number, dy: number, n: number, t: number) {
    const k = live.kind, s = S(), dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
    for (let j = 0; j < n; j++) {
      const f = (j + Math.random()) / Math.max(1, n), px = x - dx * f, py = y - dy * f;   // spread along this move
      let i = -1;
      switch (k) {
        case "sparks": {
          const a = Math.atan2(-uy, -ux) + rnd(-1.1, 1.1), v = rnd(90, 340) * Math.sqrt(s);
          i = add(px, py, Math.cos(a) * v + dx * 2, Math.sin(a) * v - rnd(20, 120), rnd(0.32, 0.75), rnd(0.9, 1.6) * s, SPARK);
          break;
        }
        case "sparkler": {
          const a = rnd(0, TAU), v = rnd(140, 420) * Math.sqrt(s);
          i = add(px, py, Math.cos(a) * v, Math.sin(a) * v, rnd(0.12, 0.34), rnd(0.7, 1.3) * s, SPARK);
          break;
        }
        case "lightning": case "laser": case "orb": case "blade": {
          if (k === "blade" && speed < 900) break;
          const a = rnd(0, TAU), v = rnd(60, 220) * Math.sqrt(s);
          i = add(px + rnd(-2, 2), py + rnd(-2, 2), Math.cos(a) * v, Math.sin(a) * v - 40, rnd(0.18, 0.42), rnd(0.6, 1.1) * s, SPARK);
          break;
        }
        case "comet": i = add(px + rnd(-3, 3) * s, py + rnd(-3, 3) * s, rnd(-14, 14) - dx * 0.4, rnd(-14, 14) - dy * 0.4, rnd(0.45, 0.95), rnd(1.4, 3.2) * s, DOT); break;
        case "embers": i = add(px + rnd(-6, 6) * s, py + rnd(-4, 4) * s, rnd(-22, 22) + dx * 0.6, -rnd(40, 115) * Math.sqrt(s), rnd(0.9, 1.9), rnd(1.1, 3.1) * s, EMBER); break;
        case "stardust": {
          i = add(px + rnd(-9, 9) * s, py + rnd(-9, 9) * s, rnd(-16, 16), rnd(-12, 18), rnd(0.8, 1.7), rnd(1.6, 4.6) * s, STAR);
          if (i >= 0) { pool.rot[i] = rnd(0, TAU); pool.vr[i] = rnd(-2.4, 2.4); }
          break;
        }
        case "bubbles": i = add(px + rnd(-5, 5), py + rnd(-5, 5), rnd(-12, 12), -rnd(24, 62), rnd(1.4, 2.6), rnd(3.5, 11) * s, BUBBLE); break;
        case "snow": {
          i = add(px + rnd(-10, 10) * s, py + rnd(-6, 6), rnd(-12, 12), rnd(16, 44), rnd(1.8, 3.2), rnd(1.3, 4.6) * s, FLAKE);
          if (i >= 0) { pool.rot[i] = rnd(0, TAU); pool.vr[i] = rnd(-1.3, 1.3); }
          break;
        }
        default: break;
      }
      void i; void t;
    }
  }

  function pixelsAlong(ax: number, ay: number, bx: number, by: number) {
    const g = Math.max(3, Math.round(7 * S())), steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (g / 2)));
    const cap = particleCap("pixels", live.fx.i), extra = 0.35 * I();
    for (let j = 1; j <= steps; j++) {
      const x = ax + (bx - ax) * (j / steps), y = ay + (by - ay) * (j / steps);
      const cx = Math.floor(x / g), cy = Math.floor(y / g), key = `${cx},${cy}`;
      if (key === pixKey || pool.n >= cap) continue;
      pixKey = key;
      add(cx * g, cy * g, 0, 0, rnd(0.45, 0.8), g, PIXEL);
      if (Math.random() < extra) add((cx + (Math.random() < 0.5 ? -1 : 1)) * g, (cy + (Math.random() < 0.5 ? -1 : 1)) * g, 0, 0, rnd(0.2, 0.4), g, PIXEL);
    }
  }

  function burst(x: number, y: number) {
    const k = live.kind, s = S(), n = burstCount(k, live.fx.i, pool.n);
    const ring = (delay: number, r: number) => { const i = pool.add(x, y, 0, 0, 0.7, r * s, RING); if (i >= 0) pool.age[i] = -delay; };
    if (k === "pixels") {
      const g = Math.max(3, Math.round(7 * s)), cx = Math.floor(x / g), cy = Math.floor(y / g);
      for (let r = 0; r <= 5; r++) for (let ox = -r; ox <= r; ox++) for (const oy of r ? [-(r - Math.abs(ox)), r - Math.abs(ox)] : [0]) {
        const i = add((cx + ox) * g, (cy + oy) * g, 0, 0, 0.35, g, PIXEL);
        if (i >= 0) pool.age[i] = -r * 0.045;
      }
      return;
    }
    const type = k === "embers" ? EMBER : k === "stardust" ? STAR : k === "bubbles" ? BUBBLE : k === "snow" ? FLAKE
      : k === "rainbow" ? HUEDOT : k === "comet" ? DOT : SPARK;
    const count = type === BUBBLE ? Math.ceil(n / 3) : n;
    for (let j = 0; j < count; j++) {
      const a = (j / count) * TAU + rnd(-0.2, 0.2);
      const v = (type === SPARK ? rnd(180, 520) : type === BUBBLE || type === FLAKE ? rnd(40, 120) : rnd(80, 260)) * Math.sqrt(s);
      const life = type === SPARK ? rnd(0.35, 0.8) : type === BUBBLE ? rnd(1, 1.8) : rnd(0.6, 1.3);
      const size = type === SPARK ? rnd(1, 1.7) * s : type === BUBBLE ? rnd(4, 10) * s  : rnd(1.6, 4) * s;
      const i = add(x, y, Math.cos(a) * v, Math.sin(a) * v, life, size, type);
      if (i >= 0) { pool.rot[i] = rnd(0, TAU); pool.vr[i] = rnd(-6, 6); if (type === HUEDOT) pool.tone[i] = j % RAINBOW.length; }
    }
    if (type === SPARK || type === DOT || type === HUEDOT) ring(0, 34);
  }

  // ---------- the frame loop ----------
  const kick = () => { if (!raf && !o.manual) raf = requestAnimationFrame(loop); };
  function loop(now: number) {
    raf = 0;
    if (now - last < FRAME_MS - 2) { raf = requestAnimationFrame(loop); return; }
    const more = frame(now);
    if (more) raf = requestAnimationFrame(loop);
  }

  /** One frame: move everything on, draw it, and say whether anything is left to draw. */
  function frame(now: number): boolean {
    const dt = last ? clamp((now - last) / 1000, 0, 0.05) : FRAME_MS / 1000;
    last = now;
    const k = live.kind, s = S(), idle = now - lastMove;
    // the path the ribbons follow: only the last moments of it
    const keep = k === "rainbow" ? 520 : k === "neon" ? 430 : k === "comet" ? 380 : k === "lightning" ? 380 : k === "blade" ? 150 : k === "laser" ? 170 : 200;
    while (hist.length && now - hist[0].t > keep) hist.shift();
    if (k === "sparkler") {
      tip = idle < 650 ? Math.min(1, tip + dt * 8) : Math.max(0, tip - dt * 3);
      if (tip > 0.3 && idle < 650 && !isNaN(lx)) {    // a lit sparkler keeps throwing sparks while you hold it still
        const want = 70 * I() * dt + carry; let n = Math.floor(want); carry = want - n;
        n = Math.min(n, particleCap(k, live.fx.i) - pool.n, 8);
        if (n > 0) spawn(lx, ly, 0, 0, n, now);
      }
    }
    if (k === "orb") stepOrb(dt, idle);
    stepParticles(dt);

    // clear only what was drawn last time, and draw again
    const pad = 4;
    if (dirty) ctx.clearRect(box.x0 - pad, box.y0 - pad, box.x1 - box.x0 + pad * 2, box.y1 - box.y0 + pad * 2);
    box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const grow = (x: number, y: number, r: number) => { if (x - r < box.x0) box.x0 = x - r; if (y - r < box.y0) box.y0 = y - r; if (x + r > box.x1) box.x1 = x + r; if (y + r > box.y1) box.y1 = y + r; };
    for (let i = 0; i < pool.n; i++) grow(pool.x[i], pool.y[i], pool.size[i] * 6 + 12 + (pool.type[i] === RING ? pool.size[i] * 1.2 : 0) + (pool.type[i] === SPARK ? Math.hypot(pool.vx[i], pool.vy[i]) * 0.05 : 0));
    for (const p of hist) grow(p.x, p.y, 40 * s + 20);
    if (k === "orb" && orb.a > 0) grow(orb.x, orb.y, 60 * s);
    if (k === "sparkler" && tip > 0) grow(lx, ly, 30 * s);
    for (const sl of slashes) for (let j = 0; j < sl.pts.length; j += 2) grow(sl.pts[j], sl.pts[j + 1], 40 * s);
    for (const b of bolts) for (let j = 0; j < b.length; j += 2) grow(b[j], b[j + 1], 20 * s);
    if (box.x0 > box.x1) { box = { x0: 0, y0: 0, x1: 0, y1: 0 }; dirty = false; }
    else { box.x0 = Math.max(0, box.x0); box.y0 = Math.max(0, box.y0); box.x1 = Math.min(W, box.x1); box.y1 = Math.min(H, box.y1); dirty = true; }

    ctx.globalCompositeOperation = light ? "source-over" : "lighter";
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    switch (k) {
      case "lightning": drawLightning(now, idle); break;
      case "comet": drawRibbon("comet", now); break;
      case "neon": drawRibbon("neon", now); break;
      case "rainbow": drawRibbon("rainbow", now); break;
      case "laser": drawRibbon("laser", now); break;
      case "blade": drawBlade(now); break;
      case "orb": drawOrb(now); break;
      case "sparkler": drawTip(now); break;
      default: break;
    }
    drawParticles(now);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    const left = pool.n > 0 || hist.length > 0 || slashes.length > 0 || (k === "orb" && orb.a > 0.01) || (k === "sparkler" && tip > 0.01) || idle < IDLE_MS * 0.25;
    if (!left && dirty) { ctx.clearRect(0, 0, W, H); dirty = false; }
    if (!left) { last = 0; bolts = []; arcs = []; }
    return left;
  }

  function stepParticles(dt: number) {
    const k = live.kind;
    const G = k === "sparks" ? 640 : k === "sparkler" ? 240 : 300;
    const drag = Math.pow(k === "sparkler" ? 0.05 : 0.3, dt);
    for (let i = pool.n - 1; i >= 0; i--) {
      pool.age[i] += dt;
      const a = pool.age[i];
      if (a < 0) continue;
      if (a >= pool.life[i]) {
        const t = pool.type[i], x = pool.x[i], y = pool.y[i], vx = pool.vx[i], vy = pool.vy[i], sz = pool.size[i], gen = pool.rot[i];
        pool.kill(i);
        if (t === SPARK && k === "sparkler" && gen === 0 && Math.random() < 0.5) {   // the sparkler's crackle: a spark splits
          const n = 2 + (Math.random() < 0.4 ? 1 : 0), base = Math.atan2(vy, vx), v = Math.hypot(vx, vy) * 0.45;
          for (let j = 0; j < n; j++) {
            const ang = base + rnd(-1.2, 1.2), c = add(x, y, Math.cos(ang) * v, Math.sin(ang) * v, rnd(0.06, 0.15), sz * 0.7, SPARK);
            if (c >= 0) pool.rot[c] = 1;
          }
        } else if (t === BUBBLE) {    // a bubble pops into a quick ring
          const c = pool.add(x, y, 0, 0, 0.18, sz * 1.5, RING);
          if (c >= 0) pool.tone[c] = 1;
        }
        continue;
      }
      const t = pool.type[i], sd = pool.seed[i];
      switch (t) {
        case SPARK: pool.vy[i] += G * dt; pool.vx[i] *= drag; pool.vy[i] *= drag; break;
        case HUEDOT: case DOT: pool.vx[i] *= Math.pow(0.2, dt); pool.vy[i] *= Math.pow(0.2, dt); break;
        case EMBER: pool.vx[i] += Math.sin(a * 6 + sd * 20) * 70 * dt; pool.vy[i] -= 10 * dt; break;
        case STAR: pool.vy[i] += 14 * dt; pool.rot[i] += pool.vr[i] * dt; break;
        case BUBBLE: pool.vx[i] = Math.sin(a * 3 + sd * 12) * 16; break;
        case FLAKE: pool.vx[i] = Math.sin(a * 1.8 + sd * 9) * 20; pool.rot[i] += pool.vr[i] * dt; break;
        default: break;
      }
      pool.x[i] += pool.vx[i] * dt; pool.y[i] += pool.vy[i] * dt;
    }
  }

  // ---------- drawing ----------
  function drawParticles(now: number) {
    const k = live.kind, n = pool.n;
    if (!n) return;
    const c0 = pal[0], hot = mix(c0, WHITE, 0.75);
    // sparks: a few batched paths (a soft coloured stroke under a hot thin one), by how faded they are
    let anySpark = false;
    for (let i = 0; i < n; i++) if (pool.type[i] === SPARK) { anySpark = true; break; }
    if (anySpark) {
      const tail = k === "sparkler" ? 0.03 : 0.045;
      for (let pass = 0; pass < 2; pass++) {
        for (let b = 0; b < 4; b++) {
          ctx.beginPath();
          let some = false;
          for (let i = 0; i < n; i++) {
            if (pool.type[i] !== SPARK || pool.age[i] < 0) continue;
            const u = pool.age[i] / pool.life[i];
            if (Math.min(3, Math.floor(u * 4)) !== b) continue;
            const x = pool.x[i], y = pool.y[i];
            ctx.moveTo(x, y); ctx.lineTo(x - pool.vx[i] * tail, y - pool.vy[i] * tail);
            some = true;
          }
          if (!some) continue;
          const fade = 1 - (b + 0.5) / 4, sz = (k === "sparkler" ? 1.1 : 1.3) * S();
          if (pass === 0) { ctx.strokeStyle = rgba(b < 1 && k === "sparkler" ? hot : c0, fade * 0.55 * Math.min(1.4, I())); ctx.lineWidth = sz * 2.6; }
          else { ctx.strokeStyle = rgba(b < 2 ? WHITE : mix(c0, WHITE, 0.5), fade * 0.95); ctx.lineWidth = sz * 0.9; }
          ctx.stroke();
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const t = pool.type[i];
      if (t === SPARK) continue;
      const a = pool.age[i];
      if (a < 0) continue;
      const u = a / pool.life[i], x = pool.x[i], y = pool.y[i], sz = pool.size[i], col = pal[pool.tone[i] % pal.length] ?? c0;
      switch (t) {
        case DOT: {
          const al = (1 - u) * 0.8;
          ctx.globalAlpha = al; const r = sz * 3.4; ctx.drawImage(sprite("glow", col), x - r, y - r, r * 2, r * 2);
          break;
        }
        case HUEDOT: {
          const cc = RAINBOW[pool.tone[i] % RAINBOW.length], r = sz * 3.6;
          ctx.globalAlpha = (1 - u) * 0.9; ctx.drawImage(sprite("glow", cc), x - r, y - r, r * 2, r * 2);
          break;
        }
        case EMBER: {
          const fl = 0.65 + 0.35 * Math.sin(a * 22 + pool.seed[i] * 40), al = (u < 0.1 ? u / 0.1 : 1 - (u - 0.1) / 0.9) * fl;
          const warm = u < 0.5 ? mix(col, hexRgb("#ffe08a"), 0.35 * (1 - u * 2)) : mix(col, hexRgb("#8a1a08"), (u - 0.5) * 1.2);
          let r = sz * 4.2; ctx.globalAlpha = al * 0.55; ctx.drawImage(sprite("glow", warm), x - r, y - r, r * 2, r * 2);
          r = sz * 1.4; ctx.globalAlpha = al; ctx.drawImage(sprite("core", warm), x - r, y - r, r * 2, r * 2);
          break;
        }
        case STAR: {
          const tw = 0.5 + 0.5 * Math.sin(a * 14 + pool.seed[i] * 30), al = (u < 0.12 ? u / 0.12 : 1 - (u - 0.12) / 0.88) * (0.45 + 0.55 * tw);
          const r = sz * 3.2; ctx.globalAlpha = al * 0.4; ctx.drawImage(sprite("glow", col), x - r, y - r, r * 2, r * 2);
          ctx.globalAlpha = al; ctx.fillStyle = rgba(mix(col, WHITE, 0.55), 1);
          star(x, y, sz * (0.8 + 0.4 * tw), pool.rot[i]);
          break;
        }
        case BUBBLE: {
          const al = u < 0.12 ? u / 0.12 : u > 0.85 ? 1 - (u - 0.85) / 0.15 * 0.4 : 1, r = sz * (0.9 + 0.1 * Math.sin(a * 5 + pool.seed[i] * 9));
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = al;
          ctx.fillStyle = rgba(col, 0.07); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
          ctx.strokeStyle = rgba(col, 0.6); ctx.lineWidth = 1.1; ctx.stroke();
          ctx.strokeStyle = rgba(hslRgb((hueOf(col) + 70) % 360, 0.9, 0.7), 0.28); ctx.lineWidth = 0.9;
          ctx.beginPath(); ctx.arc(x + 0.6, y + 0.4, r * 0.93, 0.2, Math.PI * 1.1); ctx.stroke();
          ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = Math.max(1, r * 0.13);
          ctx.beginPath(); ctx.arc(x, y, r * 0.66, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.beginPath(); ctx.arc(x + r * 0.35, y - r * 0.45, Math.max(0.6, r * 0.09), 0, TAU); ctx.fill();
          ctx.globalCompositeOperation = light ? "source-over" : "lighter";
          break;
        }
        case FLAKE: {
          const al = (u < 0.12 ? u / 0.12 : u > 0.65 ? 1 - (u - 0.65) / 0.35 : 1) * 0.9;
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = al * 0.35; let r = sz * 2.4; ctx.drawImage(sprite("glow", col), x - r, y - r, r * 2, r * 2);
          ctx.globalAlpha = al;
          if (sz < 2.6) { ctx.fillStyle = rgba(col, 1); ctx.beginPath(); ctx.arc(x, y, sz * 0.6, 0, TAU); ctx.fill(); }
          else {
            ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = Math.max(0.8, sz * 0.18); r = sz * 1.5;
            ctx.beginPath();
            for (let arm = 0; arm < 6; arm++) {
              const an = pool.rot[i] + arm * (TAU / 6), cx = Math.cos(an), cy = Math.sin(an);
              ctx.moveTo(x, y); ctx.lineTo(x + cx * r, y + cy * r);
              const bx = x + cx * r * 0.55, by = y + cy * r * 0.55, br = r * 0.32;
              ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(an + 0.8) * br, by + Math.sin(an + 0.8) * br);
              ctx.moveTo(bx, by); ctx.lineTo(bx + Math.cos(an - 0.8) * br, by + Math.sin(an - 0.8) * br);
            }
            ctx.stroke();
          }
          ctx.globalCompositeOperation = light ? "source-over" : "lighter";
          break;
        }
        case PIXEL: {
          const steps = Math.ceil((1 - u) * 4) / 4, g = sz, sh = u < 0.5 ? 0 : Math.round(g * 0.18);
          ctx.globalAlpha = steps * 0.9; ctx.fillStyle = rgba(pool.tone[i] % 2 ? (pal[1] ?? col) : col, 1);
          ctx.fillRect(Math.round(x + sh), Math.round(y + sh), Math.max(1, Math.round(g - sh * 2 - 1)), Math.max(1, Math.round(g - sh * 2 - 1)));
          break;
        }
        case RING: {
          const e = 1 - Math.pow(1 - u, 3), pop = pool.tone[i] === 1, r = pop ? sz * (0.7 + 0.5 * e) : 2 + sz * e;
          ctx.globalAlpha = (1 - u) * (pop ? 0.7 : 0.8);
          ctx.strokeStyle = rgba(pop ? mix(col, WHITE, 0.5) : col, 1); ctx.lineWidth = pop ? 1 : Math.max(0.5, 2.4 * (1 - u) * S());
          ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
          break;
        }
        default: break;
      }
    }
    ctx.globalAlpha = 1;
    void now;
  }
  function star(x: number, y: number, r: number, rot: number) {
    ctx.beginPath();
    for (let j = 0; j < 8; j++) {
      const an = rot + j * (Math.PI / 4), rr = j % 2 ? r * 0.28 : r;
      const px = x + Math.cos(an) * rr, py = y + Math.sin(an) * rr;
      if (j) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }

  /** A smooth path through the recent points (each point and the middles between them). */
  function smooth(): { x: number; y: number }[] {
    if (hist.length < 2) return hist.slice();
    const out: { x: number; y: number }[] = [{ x: hist[0].x, y: hist[0].y }];
    for (let j = 1; j < hist.length; j++) {
      const a = hist[j - 1], b = hist[j];
      out.push({ x: (a.x * 3 + b.x) / 4, y: (a.y * 3 + b.y) / 4 }, { x: (a.x + b.x * 3) / 4, y: (a.y + b.y * 3) / 4 });
    }
    out.push({ x: hist[hist.length - 1].x, y: hist[hist.length - 1].y });
    return out;
  }

  function drawRibbon(kind: "comet" | "neon" | "rainbow" | "laser", now: number) {
    const p = smooth(), m = p.length, s = S(), I0 = Math.min(1.6, I());
    if (m < 2) return;
    const c = pal[0];
    const base = live.fx.c === "multi" ? 0 : hueOf(c), spread = live.fx.c === "multi" ? 330 : 120;
    const passes: { w: number; a: number; col: (u: number) => Rgb }[] =
      kind === "comet" ? [{ w: 10, a: 0.22, col: () => c }, { w: 4.2, a: 0.85, col: (u) => mix(c, WHITE, u * 0.8) }]
      : kind === "neon" ? [{ w: 13, a: 0.12, col: () => c }, { w: 5.5, a: 0.5, col: () => c }, { w: 2, a: 0.9, col: () => mix(c, WHITE, 0.65) }]
      : kind === "laser" ? [{ w: 10, a: 0.14, col: () => c }, { w: 3.4, a: 0.8, col: () => c }, { w: 1.3, a: 1, col: () => WHITE }]
      : [{ w: 16, a: 0.12, col: (u) => hslRgb((base + (1 - u) * spread + now * 0.06) % 360, 1, 0.6) }, { w: 7, a: 0.85, col: (u) => hslRgb((base + (1 - u) * spread + now * 0.06) % 360, 1, 0.62) }];
    for (const ps of passes) {
      for (let j = 1; j < m; j++) {
        const u = j / (m - 1);
        const taper = kind === "comet" ? Math.pow(u, 1.4) : kind === "laser" ? 0.35 + 0.65 * u : 0.25 + 0.75 * Math.sin(Math.min(1, u * 1.15) * Math.PI / 2);
        const al = ps.a * I0 * (kind === "laser" ? 0.5 + 0.5 * u : Math.pow(u, 1.2));
        ctx.strokeStyle = rgba(light && kind !== "rainbow" ? inkFor(ps.col(u), true) : ps.col(u), al);
        ctx.lineWidth = Math.max(0.5, ps.w * s * taper);
        ctx.beginPath(); ctx.moveTo(p[j - 1].x, p[j - 1].y); ctx.lineTo(p[j].x, p[j].y); ctx.stroke();
      }
    }
    const h = p[m - 1], recent = now - hist[hist.length - 1].t < 120 ? 1 : 0.5;
    if (kind === "comet" || kind === "laser") {
      let r = (kind === "comet" ? 20 : 14) * s; ctx.globalAlpha = 0.6 * recent * I0; ctx.drawImage(sprite("glow", c), h.x - r, h.y - r, r * 2, r * 2);
      r = (kind === "comet" ? 8 : 5) * s; ctx.globalAlpha = 0.95 * recent; ctx.drawImage(sprite("core", c), h.x - r, h.y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
    }
  }

  function drawBlade(now: number) {
    const s = S(), c = pal[0];
    // afterimages of fast slashes, fading and drifting off
    slashes = slashes.filter((sl) => now - sl.at < 300);
    for (const sl of slashes) {
      const u = (now - sl.at) / 300, d = u * 10 * s;
      ctx.globalAlpha = (1 - u) * 0.55;
      ctx.fillStyle = rgba(c, 0.35);
      ctx.beginPath();
      for (let j = 0; j < sl.pts.length; j += 2) { const x = sl.pts[j] + sl.nx * d, y = sl.pts[j + 1] + sl.ny * d; if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const p = smooth(), m = p.length;
    if (m < 3) return;
    const wMax = clamp(speed * 0.011, 1.4, 17) * s, edge: number[] = [], back: number[] = [];
    let anx = 0, any = 0;
    for (let j = 0; j < m; j++) {
      const a = p[Math.max(0, j - 1)], b = p[Math.min(m - 1, j + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
      const u = j / (m - 1), w = wMax * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.85);
      edge.push(p[j].x, p[j].y); back.push(p[j].x + nx * w, p[j].y + ny * w);
      anx += nx; any += ny;
    }
    const nl = Math.hypot(anx, any) || 1;
    const shape: number[] = [...edge];
    for (let j = back.length - 2; j >= 0; j -= 2) shape.push(back[j], back[j + 1]);
    // the body of the slash: a soft fill, then the bright cutting edge on top
    const g = ctx.createLinearGradient(p[0].x, p[0].y, p[m - 1].x, p[m - 1].y);
    g.addColorStop(0, rgba(c, 0)); g.addColorStop(0.6, rgba(c, 0.22 * Math.min(1.5, I()))); g.addColorStop(1, rgba(mix(c, WHITE, 0.5), 0.42 * Math.min(1.5, I())));
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let j = 0; j < shape.length; j += 2) { if (j) ctx.lineTo(shape[j], shape[j + 1]); else ctx.moveTo(shape[j], shape[j + 1]); }
    ctx.closePath(); ctx.fill();
    const stroke = (pts: number[], w: number, col: string) => {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath();
      for (let j = 0; j < pts.length; j += 2) { if (j) ctx.lineTo(pts[j], pts[j + 1]); else ctx.moveTo(pts[j], pts[j + 1]); }
      ctx.stroke();
    };
    const fast = clamp((speed - 200) / 1600, 0, 1);
    stroke(edge, 5 * s, rgba(c, 0.25 + 0.2 * fast));
    stroke(edge.slice(Math.floor(edge.length * 0.25) & ~1), 1.6 * s, rgba(light ? mix(c, BLACK, 0.35) : WHITE, 0.95));
    stroke(back, 0.8, rgba(c, 0.3));
    // a glint at the tip on a quick swing
    if (fast > 0.25) {
      const h = p[m - 1], r = (6 + 10 * fast) * s;
      ctx.globalAlpha = fast; ctx.drawImage(sprite("core", c), h.x - r, h.y - r, r * 2, r * 2);
      ctx.strokeStyle = rgba(WHITE, 0.8 * fast); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(h.x - r * 1.6, h.y); ctx.lineTo(h.x + r * 1.6, h.y); ctx.moveTo(h.x, h.y - r * 1.6); ctx.lineTo(h.x, h.y + r * 1.6); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (speed > 1500 && now - slashAt > 110 && slashes.length < 4) { slashAt = now; slashes.push({ pts: shape, at: now, nx: anx / nl, ny: any / nl }); }
  }

  function drawLightning(now: number, idle: number) {
    if (hist.length < 2) { bolts = []; return; }
    const s = S(), c = pal[0];
    if (now - boltAt > 48 || !bolts.length) {    // a new crackle about 20 times a second
      boltAt = now; flick = rnd(0.6, 1);
      const anchors: { x: number; y: number }[] = [];
      const step = Math.max(1, Math.floor(hist.length / 7));
      for (let j = 0; j < hist.length; j += step) anchors.push(hist[j]);
      anchors.push(hist[hist.length - 1]);
      const main: number[] = [anchors[0].x, anchors[0].y];
      for (let j = 1; j < anchors.length; j++) jag(main, anchors[j - 1].x, anchors[j - 1].y, anchors[j].x, anchors[j].y, 0.42, 3);
      bolts = [main];
      const forks = 1 + Math.floor(Math.random() * (1 + 2 * Math.min(1, I())));
      for (let f = 0; f < forks && main.length >= 6; f++) {
        const at = 2 * Math.floor(rnd(0.2, 0.95) * (main.length / 2 - 1));
        const x = main[at], y = main[at + 1], nx2 = main[at + 2] ?? x, ny2 = main[at + 3] ?? y;
        const ang = Math.atan2(ny2 - y, nx2 - x) + (Math.random() < 0.5 ? -1 : 1) * rnd(0.5, 1.2), len = rnd(18, 52) * s;
        const fork: number[] = [x, y];
        jag(fork, x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len, 0.5, 3);
        bolts.push(fork);
      }
    }
    const fade = idle < 90 ? 1 : Math.max(0, 1 - (idle - 90) / 200), I0 = Math.min(1.5, I()) * flick * fade;
    if (I0 <= 0.01) return;
    const pass = (w: number, col: string) => {
      ctx.strokeStyle = col;
      bolts.forEach((b, bi) => {
        ctx.lineWidth = w * (bi ? 0.6 : 1);
        ctx.beginPath(); ctx.moveTo(b[0], b[1]);
        for (let j = 2; j < b.length; j += 2) ctx.lineTo(b[j], b[j + 1]);
        ctx.stroke();
      });
    };
    pass(8 * s, rgba(c, 0.16 * I0));
    pass(2.6 * s, rgba(c, 0.75 * I0));
    pass(1 * s, rgba(light ? mix(c, BLACK, 0.3) : mix(c, WHITE, 0.85), Math.min(1, 0.95 * I0)));
    const h = hist[hist.length - 1], r = 16 * s;
    ctx.globalAlpha = 0.55 * I0; ctx.drawImage(sprite("glow", c), h.x - r, h.y - r, r * 2, r * 2); ctx.globalAlpha = 1;
  }

  function stepOrb(dt: number, idle: number) {
    if (isNaN(orb.x)) { if (isNaN(lx)) return; orb.x = lx; orb.y = ly; }
    const on = idle < 750;
    orb.a = on ? Math.min(1, orb.a + dt * 5) : Math.max(0, orb.a - dt * 2.6);
    const k = 110, damp = 13;
    orb.vx += ((orb.tx - orb.x) * k - orb.vx * damp) * dt;
    orb.vy += ((orb.ty - orb.y) * k - orb.vy * damp) * dt;
    orb.x += orb.vx * dt; orb.y += orb.vy * dt;
  }
  function drawOrb(now: number) {
    if (orb.a <= 0.01 || isNaN(orb.x)) return;
    const s = S(), c = pal[0], A = orb.a, I0 = Math.min(1.5, I());
    if (now - arcAt > 46 || !arcs.length) {
      arcAt = now; arcs = [];
      const n = 2 + Math.round(2 * Math.min(1.5, I0));
      for (let j = 0; j < n; j++) {
        const an = rnd(0, TAU), r0 = 5 * s, r1 = rnd(15, 30) * s;
        const a: number[] = [orb.x + Math.cos(an) * r0, orb.y + Math.sin(an) * r0];
        jag(a, a[0], a[1], orb.x + Math.cos(an + rnd(-0.5, 0.5)) * r1, orb.y + Math.sin(an + rnd(-0.5, 0.5)) * r1, 0.6, 2);
        arcs.push(a);
      }
      if (!isNaN(lx) && Math.hypot(lx - orb.x, ly - orb.y) > 10 * s) {   // one arc reaches back to the mouse while it lags
        const a: number[] = [orb.x, orb.y];
        jag(a, orb.x, orb.y, lx, ly, 0.45, 3);
        arcs.push(a);
      }
    }
    let r = 30 * s; ctx.globalAlpha = 0.5 * A * I0; ctx.drawImage(sprite("glow", c), orb.x - r, orb.y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
    for (const [w, col] of [[4 * s, rgba(c, 0.3 * A)], [1.1 * s, rgba(light ? mix(c, BLACK, 0.3) : mix(c, WHITE, 0.8), 0.9 * A)]] as [number, string][]) {
      ctx.strokeStyle = col; ctx.lineWidth = w;
      for (const a of arcs) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); for (let j = 2; j < a.length; j += 2) ctx.lineTo(a[j], a[j + 1]); ctx.stroke(); }
    }
    const pulse = 1 + 0.08 * Math.sin(now * 0.02);
    r = 10 * s * pulse; ctx.globalAlpha = A; ctx.drawImage(sprite("core", c), orb.x - r, orb.y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }
  function drawTip(now: number) {
    if (tip <= 0.01 || isNaN(lx)) return;
    const s = S(), c = pal[0], fl = 0.8 + 0.2 * Math.sin(now * 0.05) * Math.sin(now * 0.031);
    let r = 22 * s * fl; ctx.globalAlpha = 0.5 * tip; ctx.drawImage(sprite("glow", c), lx - r, ly - r, r * 2, r * 2);
    r = 7 * s * fl; ctx.globalAlpha = tip; ctx.drawImage(sprite("core", mix(c, WHITE, 0.4)), lx - r, ly - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  // ---------- the outside ----------
  return {
    move(x, y, t = performance.now()) {
      refresh();
      const k = live.kind;
      const had = !isNaN(lx), dx = had ? x - lx : 0, dy = had ? y - ly : 0, dist = Math.hypot(dx, dy);
      const gap = Math.max(1, t - lastMove);
      if (had && gap < 120) speed = speed * 0.6 + (dist / gap) * 1000 * 0.4; else speed = 0;
      if (gap > 250) pixKey = "";
      lastMove = t;
      if (had && dist > 60 && gap > 200) { lx = x; ly = y; hist.length = 0; return; }   // a jump (came back from elsewhere): no streak across the screen
      hist.push({ x, y, t });
      if (hist.length > 64) hist.shift();
      if (k === "orb") { orb.tx = x; orb.ty = y; }
      if (k === "pixels") { if (had) pixelsAlong(lx, ly, x, y); else pixelsAlong(x, y, x, y); }
      else if (had && dist > 0) {
        const e = emitCount(k, dist, live.fx.i, carry, pool.n);
        carry = e.carry;
        if (e.n) spawn(x, y, dx, dy, e.n, t);
      }
      lx = x; ly = y;
      kick();
    },
    down(x, y, t = performance.now()) {
      refresh();
      if (!live.burst) return;
      lastMove = t; lx = x; ly = y;
      burst(x, y);
      kick();
    },
    leave() { lx = NaN; ly = NaN; },
    clear() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; last = 0; pool.clear(); hist.length = 0; bolts = []; arcs = []; slashes = []; orb.a = 0; orb.x = NaN; tip = 0; lx = NaN; ly = NaN;
      ctx.clearRect(0, 0, W, H); dirty = false;
    },
    resize() { resize(); },
    frame(t) { frame(t); },
    count: () => pool.n,
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; },
  };
}

/** The little picture on an effect's tile: the effect run for a moment along a swoosh across `canvas`, by hand
 *  (no frame loop), then left as it is. */
export function drawThumb(canvas: HTMLCanvasElement, kind: TrailId, fx: TrailFx) {
  const live: TrailLive = { kind, fx, burst: false };
  const e = createTrail(canvas, () => live, { maxDpr: 2, manual: true });
  const r = canvas.getBoundingClientRect(), w = r.width || 120, h = r.height || 60;
  let t = 1000;
  const sparse = kind === "embers" || kind === "bubbles" || kind === "snow";
  const steps = kind === "blade" ? 9 : sparse ? 60 : 26, dur = kind === "blade" ? 110 : sparse ? 700 : 420;
  for (let j = 0; j <= steps; j++) {
    const v = j / steps, u = sparse ? (v < 0.5 ? v * 2 : 2 - v * 2) : v, x = w * (0.12 + 0.76 * u), y = h * (0.62 - 0.32 * Math.sin(u * Math.PI * 1.1));
    t += dur / steps;
    e.move(x, y, t);
    e.frame(t);
  }
  e.frame(t + 16);
  e.stop();
}

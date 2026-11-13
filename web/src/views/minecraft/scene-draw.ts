// Minecraft mode scene: the painter. A tiny pixel canvas (about 180 rows high) scaled up with no smoothing, so
// every block is crisp and a frame costs next to nothing. Plain Canvas2D only (the developer's browser has no WebGL).
// All art is drawn here from code: our own grass, dirt and stone, our own pixel sun, moon and clouds, and our own
// crew of three blocky electricians (Gus, Bram and Pip).
//
// The painter is also the little simulation: it owns the clock of the scene, runs this open's plan (crew-plan.ts:
// the run in, then one working beat after another from crew-beats.ts), the sparks, the flickering bulb and the
// speech bubbles, and returns what just happened (a strike, a zap, a grunt) so Scene.tsx can play the sound.
// It uses seeded random only, so the same plan at the same moment always looks the same (the screenshots rely on it).
import { rng } from "./scene-logic.ts";
import {
  IDS, arriveMs, beatFor, makeEntrance, poleXFor, workerAt,
  type BeatId, type EntrancePlan, type OpenPlan, type WorkerAt, type WorkerId,
} from "./crew-plan.ts";
import { base, makeBeat, poseIn, worldIn, type Beat, type Body, type Cue, type Tool, type Voice, type World, type WorldNow } from "./crew-beats.ts";

export type McTheme = "light" | "dark";
export type McEvent =
  | { type: "hit"; who: WorkerId; zap: boolean; big?: boolean }
  | { type: "tap"; who: WorkerId }
  | { type: "grunt"; who: WorkerId; kind: Voice; vol: number }
  | { type: "spark"; vol: number }
  | { type: "thud" };

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const css = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
const clamp = (v: number, a = 0, b = 255) => Math.max(a, Math.min(b, v));
/** Night: darker, a touch blue. k = how much light is left. */
const nightOf = (c: RGB, k: number): RGB => [clamp(c[0] * k), clamp(c[1] * (k + 0.03)), clamp(c[2] * (k + 0.14) + 10)];
const mul = (c: RGB, k: number): RGB => [clamp(c[0] * k), clamp(c[1] * k), clamp(c[2] * k)];
const toHex = (c: RGB) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
/** A darker shade, still as #rrggbb so it can go through the night tint. */
const darkHex = (h: string, k = 0.78) => toHex(mul(hex(h), k));

// ---------- the 3 x 5 pixel letters (and symbols) for the speech bubbles ----------
const GLYPH: Record<string, string[]> = {
  H: ["101", "101", "111", "101", "101"], M: ["10001", "11011", "10101", "10001", "10001"],
  R: ["110", "101", "110", "101", "101"], Z: ["111", "001", "010", "100", "111"], A: ["010", "101", "111", "101", "101"],
  P: ["110", "101", "110", "100", "100"], O: ["010", "101", "101", "101", "010"], F: ["111", "100", "110", "100", "100"],
  U: ["101", "101", "101", "101", "111"], "?": ["110", "001", "010", "000", "010"], "!": ["1", "1", "1", "0", "1"],
  ".": ["0", "0", "0", "0", "1"], " ": ["00", "00", "00", "00", "00"], N: ["1001", "1101", "1011", "1001", "1001"],
  I: ["111", "010", "010", "010", "111"], C: ["011", "100", "100", "100", "011"], E: ["111", "100", "110", "100", "111"],
  Y: ["101", "101", "010", "010", "010"],
  "#": ["01010", "11111", "01010", "11111", "01010"], "@": ["01110", "10001", "10111", "10110", "01111"],
  "~": ["001", "010", "111", "010", "100"],                                // a tiny lightning bolt
  "<": ["01010", "11111", "11111", "01110", "00100"],                      // a heart
};
const textW = (s: string) => [...s].reduce((w, ch) => w + (GLYPH[ch] || GLYPH[" "])[0].length + 1, -1);
/** Symbol letters are drawn in red (the bolt in gold, the heart in pink). */
const inkOf = (ch: string) => (ch === "<" ? "#e0457b" : ch === "~" ? "#d99a00" : ch === "#" || ch === "@" ? "#c0262d" : "#1b1a1d");

// ---------- sprites: little pixel pictures that can be turned to any angle without blur ----------
type Px = [number, number, string];
interface Sprite { px: Px[]; r: number }
const sprite = (px: Px[]): Sprite => ({ px, r: Math.ceil(Math.max(...px.map(([x, y]) => Math.hypot(Math.abs(x) + 1, Math.abs(y) + 1)))) });

/** Points on the pole, relative to the middle of its foot, for wires, sparks and the bulb. */
const POLE_AT = {
  armL: [-17, -71], armR: [8, -71], bulb: [17, -66], frayed: [-20, -48], box: [-10, -18], meter: [8, -16], top: [0, -74],
} as const;
/** The pole canvas: 64 x 80, the middle of the foot at (26, 79). */
const PC = { w: 64, h: 80, fx: 26, fy: 79 } as const;

export class McPainter {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  W = 0; H = 0; P = 3; dpr = 1;
  theme: McTheme = "light";
  ownBg = false;
  reduced = false;
  private seed: number;
  private r: () => number;
  private gy = 0;
  private poleX = 0;
  private plan: OpenPlan | null = null;
  private entrance: EntrancePlan[] = [];
  private arrive: Record<string, number> = {};
  private layers: { sky?: HTMLCanvasElement; far?: HTMLCanvasElement; mid?: HTMLCanvasElement; ground?: HTMLCanvasElement; pole?: HTMLCanvasElement } = {};
  private clouds: { x: number; y: number; w: number; layer: number; parts: [number, number, number, number][] }[] = [];
  private stars: { x: number; y: number; ph: number }[] = [];
  private sparks: { x: number; y: number; vx: number; vy: number; age: number; life: number }[] = [];
  private bubbles: { who: WorkerId | "box"; text: string; age: number; life: number }[] = [];
  private smoke: { x: number; y: number; age: number; life: number; dust?: boolean }[] = [];
  private t = 0;
  private zapAt = -1e9;
  private flashAt = -1e9;
  private boltAt = -1e9;
  private boltTo: WorkerId = "gus";
  private bulbOn = true;
  private bulbNext = 0;
  private bulbForce: "on" | null = null;
  private bulbDeadUntil = -1e9;
  private nextAmbient = 400;
  private lastVoice = -1e9;
  private seen: Record<string, { pose: string; downs: number }> = {};
  private beat: Beat | null = null;
  private beatAt = 0;
  private beatIdx = 0;
  private beatLt = 0;
  private beatR: () => number = rng(1);
  private prevBeat: BeatId | null = null;
  private now: WorldNow = { poleAngle: 0, shake: 0, huge: null, flying: null, hat: null };
  private wc: HTMLCanvasElement;
  private wg: CanvasRenderingContext2D;
  private rot = new Map<string, HTMLCanvasElement>();
  private wpos: Record<string, { x: number; headY: number }> = {};
  private torches: [number, number][] = [];
  private toolboxX: number | null = null;
  private skip = false;
  /** The beats played this open, in order (for tests and the dev page). */
  readonly played: BeatId[] = [];

  constructor(canvas: HTMLCanvasElement, seed = 20261104) {
    this.canvas = canvas;
    const g = canvas.getContext("2d", { alpha: true });
    if (!g) throw new Error("no 2d context");
    this.g = g;
    this.seed = seed;
    this.r = rng(seed);
    this.wc = document.createElement("canvas"); this.wc.width = 64; this.wc.height = 62;
    this.wg = this.wc.getContext("2d", { willReadFrequently: true })!;
  }

  /** The crew strip at the bottom (CSS px): no panel text should sit here. */
  crewCssHeight() { return ((this.H - (this.gy - 50)) * this.P) / this.dpr; }
  /** When the last worker reaches the box (ms). */
  entranceEnd() { return this.skip ? 0 : Math.max(0, ...Object.values(this.arrive)); }
  /** What is happening now (the dev page and tests read it). */
  status() { return { t: this.t, beat: this.beat?.id ?? null, beatLt: this.beatLt, plan: this.plan, played: [...this.played] }; }

  /** Fit the pixel canvas to a box of cssW x cssH. Returns false when there is nothing to draw into. */
  resize(cssW: number, cssH: number, dpr = 1): boolean {
    if (cssW < 8 || cssH < 8) return false;
    this.dpr = dpr;
    const dev = cssH * dpr;
    this.P = Math.max(2, Math.round(dev / 180));
    const W = Math.ceil((cssW * dpr) / this.P), H = Math.ceil(dev / this.P);
    if (W === this.W && H === this.H && this.layers.ground) return true;
    this.W = W; this.H = H;
    this.canvas.width = W; this.canvas.height = H;
    this.canvas.style.width = `${(W * this.P) / dpr}px`;
    this.canvas.style.height = `${(H * this.P) / dpr}px`;
    this.g.imageSmoothingEnabled = false;
    this.layout();
    return true;
  }

  setLook(theme: McTheme, ownBg: boolean, reduced: boolean) {
    const changed = theme !== this.theme || ownBg !== this.ownBg;
    this.theme = theme; this.ownBg = ownBg; this.reduced = reduced;
    if (changed && this.W) this.layout();
  }

  /** Back to the start (every open), with this open's plan. */
  restart(plan: OpenPlan, skipEntrance: boolean) {
    this.plan = plan;
    this.r = rng(plan.seed ^ 0x5eed);
    this.beatR = rng(plan.seed ^ 0xbea7);
    this.t = 0; this.sparks = []; this.bubbles = []; this.smoke = [];
    this.zapAt = -1e9; this.flashAt = -1e9; this.boltAt = -1e9; this.lastVoice = -1e9;
    this.nextAmbient = 400; this.bulbNext = 0; this.bulbForce = null; this.bulbDeadUntil = -1e9;
    this.seen = {}; this.beat = null; this.beatIdx = 0; this.prevBeat = null; this.beatLt = 0;
    this.played.length = 0;
    this.skip = skipEntrance;
    this.planEntrance();
  }

  private planEntrance() {
    if (!this.plan || !this.W) return;
    this.entrance = makeEntrance(rng(this.plan.seed), this.plan.kind, this.poleX, this.W);
    this.arrive = {};
    for (const p of this.entrance) this.arrive[p.id] = arriveMs(p, this.poleX, this.W);
  }
  private world(): World { return { poleX: this.poleX, W: this.W, gy: this.gy, toolbox: this.toolboxX }; }

  // ---------- layout and the cached layers ----------

  private layout() {
    const { W, H } = this;
    const B = 12;
    this.gy = this.ownBg ? H - B : H - Math.round(B * 3.2);
    this.poleX = poleXFor(W);
    this.planEntrance();
    const lr = rng(this.seed ^ W);
    // Clouds: two layers, flat blocky puffs.
    this.clouds = [];
    const n = Math.max(3, Math.round(W / 70));
    for (let i = 0; i < n; i++) {
      const layer = i % 2;
      const w = 18 + Math.round(lr() * 26) + layer * 8;
      const parts: [number, number, number, number][] = [[0, 3, w, 5]];
      const bumps = 2 + Math.floor(lr() * 2);
      for (let b = 0; b < bumps; b++) { const bw = 6 + Math.round(lr() * 10); parts.push([Math.round(lr() * (w - bw)), 0, bw, 4]); }
      this.clouds.push({ x: lr() * (W + 60), y: 8 + Math.round(lr() * (H * 0.28)) + layer * 4, w, layer, parts });
    }
    this.stars = [];
    for (let i = 0; i < Math.round(W / 9); i++) this.stars.push({ x: Math.floor(lr() * W), y: Math.floor(lr() * this.gy * 0.62), ph: lr() * 6.28 });
    this.layers = {};
    this.rot.clear();
    this.sprites = {};
    if (!this.ownBg) { this.layers.sky = this.drawSky(); this.layers.far = this.drawHills(0); this.layers.mid = this.drawHills(1); }
    this.layers.ground = this.drawGround();
    this.layers.pole = this.drawPoleCanvas();
  }

  private night = () => this.theme === "dark";
  private T = (h: string, k = 0.42) => css(this.night() ? nightOf(hex(h), k) : hex(h));

  private mk(w: number, h: number) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d")!; g.imageSmoothingEnabled = false;
    return [c, g] as const;
  }

  private drawSky() {
    const { W, H } = this;
    const [c, g] = this.mk(W, H);
    const top = this.night() ? hex("#0a1030") : hex("#5aa9f0");
    const bot = this.night() ? hex("#2a3466") : hex("#cfeafc");
    const bands = 9;
    const at = (k: number): RGB => [top[0] + (bot[0] - top[0]) * k, top[1] + (bot[1] - top[1]) * k, top[2] + (bot[2] - top[2]) * k];
    for (let i = 0; i < bands; i++) {
      const y0 = Math.floor((i / bands) * this.gy), y1 = Math.floor(((i + 1) / bands) * this.gy);
      g.fillStyle = css(at(i / (bands - 1))); g.fillRect(0, y0, W, y1 - y0 + 1);
      // A dithered seam between bands, the pixel way.
      if (i > 0) { g.fillStyle = css(at((i - 1) / (bands - 1))); for (let x = (i & 1); x < W; x += 2) g.fillRect(x, y0, 1, 1); }
    }
    g.fillStyle = css(bot); g.fillRect(0, this.gy, W, H - this.gy);
    return c;
  }

  /** Far (0) or near (1) hills: blocky steps, the near ones with grass tops and trees. 8 px wider for the sway. */
  private drawHills(layer: 0 | 1) {
    const { W } = this;
    const w = W + 16, h = this.gy + 2;
    const [c, g] = this.mk(w, h);
    const lr = rng(this.seed * (layer + 3));
    const step = layer ? 6 : 8;
    const baseY = this.gy - (layer ? 10 : 26);
    let y = baseY - lr() * 14;
    const cols: number[] = [];
    for (let x = 0; x < w; x += step) { y += (lr() - 0.5) * (layer ? 8 : 12); y = Math.max(this.gy * (layer ? 0.55 : 0.4), Math.min(baseY + 4, y)); cols.push(Math.round(y)); }
    const body = layer ? (this.night() ? "#1f3a2a" : "#4f8f3e") : (this.night() ? "#1b2550" : "#93b9dc");
    const top = layer ? (this.night() ? "#2b5236" : "#6cb34f") : (this.night() ? "#26306a" : "#b0cde8");
    cols.forEach((yy, i) => {
      g.fillStyle = body; g.fillRect(i * step, yy, step, h - yy);
      g.fillStyle = top; g.fillRect(i * step, yy, step, layer ? 2 : 1);
    });
    if (layer) {
      // Blocky trees: a trunk and a stack of leaf squares.
      const trunk = this.T("#6b4a2a", 0.5), leaf = this.night() ? "#163a22" : "#3d7a2e", leaf2 = this.night() ? "#1d4a2a" : "#4f9a3a";
      for (let x = 10; x < w; x += 26 + Math.floor(lr() * 30)) {
        const i = Math.min(cols.length - 1, Math.floor(x / step)), yy = cols[i];
        g.fillStyle = trunk; g.fillRect(x, yy - 7, 2, 7);
        g.fillStyle = leaf; g.fillRect(x - 4, yy - 14, 10, 7); g.fillRect(x - 2, yy - 17, 6, 3);
        g.fillStyle = leaf2; g.fillRect(x - 3, yy - 13, 3, 2); g.fillRect(x + 2, yy - 16, 2, 2);
      }
    }
    return c;
  }

  /** One textured block, made up on the spot from noise (our own textures). */
  private block(g: CanvasRenderingContext2D, x: number, y: number, kind: "grass" | "dirt" | "stone" | "plank" | "ore" | "gold", lr: () => number, B = 12) {
    const k = 0.42;
    const pal: Record<string, string[]> = {
      dirt: ["#8a5a35", "#74492a", "#9c6b42", "#5f3b22"],
      stone: ["#8b8f96", "#777b82", "#9ea2a8", "#62666c"],
      plank: ["#b9894f", "#a5773f", "#c99a5c", "#7d5a2e"],
      ore: ["#8b8f96", "#777b82", "#9ea2a8", "#2c2c30"],
      gold: ["#8b8f96", "#777b82", "#9ea2a8", "#f2c230"],
    };
    const base0 = kind === "grass" ? pal.dirt : pal[kind];
    g.fillStyle = this.T(base0[0], k); g.fillRect(x, y, B, B);
    for (let i = 0; i < B * B * 0.35; i++) {
      const px = Math.floor(lr() * B), py = Math.floor(lr() * B), v = lr();
      g.fillStyle = this.T(v < 0.45 ? base0[1] : v < 0.85 ? base0[2] : base0[3], k);
      g.fillRect(x + px, y + py, 1, 1);
    }
    if (kind === "plank") { g.fillStyle = this.T("#7d5a2e", k); g.fillRect(x, y + 3, B, 1); g.fillRect(x, y + 7, B, 1); g.fillRect(x + 5, y, 1, 3); g.fillRect(x + 9, y + 4, 1, 3); g.fillRect(x + 3, y + 8, 1, 4); }
    if (kind === "ore" || kind === "gold") {
      g.fillStyle = this.T(base0[3], k);
      for (let i = 0; i < 4; i++) { const ox = 1 + Math.floor(lr() * (B - 3)), oy = 1 + Math.floor(lr() * (B - 3)); g.fillRect(x + ox, y + oy, 2, 2); }
    }
    if (kind === "grass") {
      const greens = ["#5fae3c", "#4f9a32", "#74c24a"];
      for (let px = 0; px < B; px++) {
        const d = 2 + Math.floor(lr() * 3) + (lr() < 0.2 ? 1 : 0);
        for (let py = 0; py < d; py++) { g.fillStyle = this.T(greens[Math.floor(lr() * 3)], k); g.fillRect(x + px, y + py, 1, 1); }
      }
    }
    // A 1 px darker edge on the right and bottom keeps blocks reading as blocks.
    g.fillStyle = "rgba(0,0,0,0.16)"; g.fillRect(x + B - 1, y, 1, B); g.fillRect(x, y + B - 1, B, 1);
  }

  private drawGround() {
    const { W, H } = this, B = 12;
    const [c, g] = this.mk(W, H);
    const lr = rng(this.seed + 7);
    const rows = Math.ceil((H - this.gy) / B);
    for (let bx = 0; bx * B < W; bx++) {
      for (let r = 0; r < rows; r++) {
        const y = this.gy + r * B;
        const kind = r === 0 ? "grass" : r === 1 ? "dirt" : lr() < 0.12 ? "ore" : lr() < 0.05 ? "gold" : "stone";
        this.block(g, bx * B, y, kind, lr, B);
      }
    }
    // Placed blocks with torches on top, and a toolbox (Pip's or Bram's bed, when one of them naps).
    const torchAt: [number, number][] = [];
    const lx = Math.max(4, Math.round(W * 0.1));
    this.block(g, lx, this.gy - B, "stone", lr); this.block(g, lx, this.gy - 2 * B, "plank", lr);
    torchAt.push([lx + 6, this.gy - 2 * B]);
    const rx = W - B - 6;
    if (rx - this.poleX > 30) { this.block(g, rx, this.gy - B, "plank", lr); torchAt.push([rx + 6, this.gy - B]); }
    this.torches = torchAt;
    const tb = this.poleX - 62;
    this.toolboxX = null;
    if (tb > lx + 16) {
      this.toolboxX = tb + 5;
      g.fillStyle = this.T("#b8322a"); g.fillRect(tb, this.gy - 6, 11, 6);
      g.fillStyle = this.T("#8e2420"); g.fillRect(tb, this.gy - 6, 11, 1); g.fillRect(tb, this.gy - 1, 11, 1);
      g.fillStyle = this.T("#3a3a3a"); g.fillRect(tb + 3, this.gy - 8, 5, 1); g.fillRect(tb + 3, this.gy - 8, 1, 2); g.fillRect(tb + 7, this.gy - 8, 1, 2);
      g.fillStyle = this.T("#d9d9d9"); g.fillRect(tb + 5, this.gy - 4, 1, 1);
    }
    return c;
  }

  /** The pole with its arm, insulators, broken wire, fuse box and meter, on its own canvas so it can fall over. */
  private drawPoleCanvas() {
    const [c, g] = this.mk(PC.w, PC.h);
    // Draw in world-like numbers: the pole's left edge at x, the ground at gy.
    const x = PC.fx - 2, gy = PC.fy + 1, top = gy - 74, arm = gy - 68;
    const wood = this.T("#7a5530", 0.5), woodD = this.T("#5d3f22", 0.5), woodL = this.T("#946a3e", 0.5);
    g.fillStyle = wood; g.fillRect(x, top, 4, gy - top);
    g.fillStyle = woodD; g.fillRect(x + 3, top, 1, gy - top);
    g.fillStyle = woodL; g.fillRect(x, top, 1, gy - top);
    for (let y = top + 5; y < gy; y += 9) { g.fillStyle = woodD; g.fillRect(x + 1, y, 2, 1); }
    g.fillStyle = wood; g.fillRect(x - 17, arm, 38, 3); g.fillStyle = woodD; g.fillRect(x - 17, arm + 2, 38, 1);
    const ins = this.T("#cfe6d8", 0.6), insD = this.T("#8fb3a0", 0.6);
    for (const ix of [x - 16, x + 9, x + 18]) { g.fillStyle = ins; g.fillRect(ix, arm - 3, 2, 3); g.fillStyle = insD; g.fillRect(ix + 1, arm - 3, 1, 3); }
    const wire = this.night() ? "#05070c" : "#2b2b30";
    // The broken wire: hangs off the left end of the arm, its frayed end sparks.
    const bw: [number, number][] = [[x - 15, arm - 1], [x - 16, arm + 3], [x - 18, arm + 7], [x - 19, arm + 11], [x - 19, arm + 15], [x - 18, arm + 18]];
    g.fillStyle = wire; for (let i = 1; i < bw.length; i++) { const [ax, ay] = bw[i - 1], [bx, by] = bw[i]; for (let k = 0; k <= 4; k++) g.fillRect(Math.round(ax + (bx - ax) * k / 4), Math.round(ay + (by - ay) * k / 4), 1, 1); }
    g.fillStyle = this.T("#c8742a", 0.7); g.fillRect(x - 19, arm + 19, 1, 1); g.fillRect(x - 17, arm + 19, 1, 1);
    // The fuse box (left of the pole) and the little meter box (right).
    const bx = x - 11, by = gy - 30;
    g.fillStyle = this.T("#5d636b", 0.55); g.fillRect(bx, by, 11, 15);
    g.fillStyle = this.T("#8d949d", 0.55); g.fillRect(bx + 1, by + 1, 9, 13);
    g.fillStyle = this.T("#a9b0b8", 0.55); g.fillRect(bx + 1, by + 1, 9, 1); g.fillRect(bx + 1, by + 1, 1, 13);
    const yel = this.T("#f2c230", 0.7), blk = "#1a1a1a";
    g.fillStyle = yel; g.fillRect(bx + 5, by + 3, 1, 1); g.fillRect(bx + 4, by + 4, 3, 1); g.fillRect(bx + 3, by + 5, 5, 1); g.fillRect(bx + 2, by + 6, 7, 1);
    g.fillStyle = blk; g.fillRect(bx + 5, by + 4, 1, 1); g.fillRect(bx + 4, by + 5, 1, 1); g.fillRect(bx + 5, by + 5, 1, 1); g.fillRect(bx + 6, by + 6, 1, 1);
    g.fillStyle = "rgba(20,15,10,0.55)"; g.fillRect(bx + 2, by + 10, 3, 2); g.fillRect(bx + 6, by + 11, 2, 2);
    g.fillStyle = this.T("#3b3f45", 0.55); g.fillRect(bx + 4, by + 15, 1, gy - by - 15);
    const mx = x + 4, my = gy - 21;
    g.fillStyle = this.T("#5d636b", 0.55); g.fillRect(mx, my, 6, 8);
    g.fillStyle = this.T("#c9d4dc", 0.55); g.fillRect(mx + 1, my + 1, 4, 3);
    g.fillStyle = this.T("#3a8a3a", 0.55); g.fillRect(mx + 2, my + 5, 2, 1);
    return c;
  }

  /** A point on the pole in the scene, with the pole leaning `deg` (+ = to the right). */
  private poleAt(k: keyof typeof POLE_AT, deg = this.now.poleAngle): [number, number] {
    const [dx, dy] = POLE_AT[k], a = (deg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
    return [Math.round(this.poleX + 2 + dx * cs - dy * sn), Math.round(this.gy + dx * sn + dy * cs)];
  }

  /** The pole canvas turned to `deg` around its foot, nearest pixel, cached in 2 degree steps. */
  private poleTurned(deg: number): { c: HTMLCanvasElement; ox: number; oy: number } {
    const src = this.layers.pole!;
    const a = Math.round(deg / 2) * 2;
    if (a === 0) return { c: src, ox: PC.fx, oy: PC.fy };
    const id = `pole@${a}`;
    const R = Math.ceil(Math.hypot(PC.w, PC.h)) + 1, size = R * 2 + 1;
    let c = this.rot.get(id);
    if (!c) {
      const sd = src.getContext("2d")!.getImageData(0, 0, PC.w, PC.h).data;
      const [cc, g] = this.mk(size, size);
      const out = g.createImageData(size, size);
      const th = (a * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
      for (let ty = 0; ty < size; ty++) for (let tx = 0; tx < size; tx++) {
        const dx = tx - R, dy = ty - R;
        const sx = Math.round(PC.fx + dx * cs + dy * sn), sy = Math.round(PC.fy - dx * sn + dy * cs);
        if (sx < 0 || sy < 0 || sx >= PC.w || sy >= PC.h) continue;
        const i = (sy * PC.w + sx) * 4, j = (ty * size + tx) * 4;
        out.data[j] = sd[i]; out.data[j + 1] = sd[i + 1]; out.data[j + 2] = sd[i + 2]; out.data[j + 3] = sd[i + 3];
      }
      g.putImageData(out, 0, 0);
      c = cc;
      this.rot.set(id, c);
    }
    return { c, ox: R, oy: R };
  }

  // ---------- the crew ----------

  private static LOOK: Record<WorkerId, { skin: string; hat: string; vest: string; shirt: string; pants: string; hair: string; face: "stache" | "specs" | "beard" }> = {
    gus: { skin: "#e3a978", hat: "#f2c230", vest: "#f2781e", shirt: "#3a62b8", pants: "#2a3550", hair: "#4a2e18", face: "stache" },
    bram: { skin: "#b97f4f", hat: "#f1f1ee", vest: "#9bd13a", shirt: "#7a4fa0", pants: "#4b3a2a", hair: "#1f1a18", face: "specs" },
    pip: { skin: "#f2c39a", hat: "#ff8a2a", vest: "#ffd23a", shirt: "#2f8a6a", pants: "#3a3a4a", hair: "#b04a20", face: "beard" },
  };

  private sprites: Record<string, Sprite> = {};
  /** Tool pixels, hanging down from the hand at (0, 0). */
  private toolPx(tool: Tool, y0 = 5): Px[] {
    const px: Px[] = [];
    if (tool === "pick") {
      const h = this.T("#7a5530", 0.6), hd = this.T("#9aa3ad", 0.6), hl = this.T("#cfd6dd", 0.6), dk = this.T("#5f666e", 0.6);
      for (let y = y0; y <= y0 + 12; y++) px.push([0, y, h]);
      for (let x = -6; x <= 6; x++) px.push([x, y0 + 11, Math.abs(x) <= 1 ? dk : hd]);
      for (let x = -4; x <= 4; x++) px.push([x, y0 + 10, Math.abs(x) <= 1 ? hl : hd]);
      px.push([-6, y0 + 10, hd], [6, y0 + 10, hd], [-7, y0 + 10, dk], [7, y0 + 10, dk], [-7, y0 + 9, dk], [7, y0 + 9, dk]);
    } else if (tool === "wrench") {
      const m = this.T("#aab3bd", 0.6), d = this.T("#6c757e", 0.6);
      for (let y = y0; y <= y0 + 7; y++) px.push([0, y, m]);
      px.push([-1, y0 + 7, m], [1, y0 + 7, m], [-2, y0 + 8, d], [-1, y0 + 8, m], [1, y0 + 8, m], [2, y0 + 8, d], [-2, y0 + 9, d], [2, y0 + 9, d]);
    } else if (tool === "light") {
      const b = this.T("#30343a", 0.6), l = "#fff6b0";
      for (let y = y0; y <= y0 + 4; y++) for (let x = -1; x <= 1; x++) px.push([x, y, b]);
      px.push([-1, y0 + 5, l], [0, y0 + 5, l], [1, y0 + 5, l]);
    } else if (tool === "torch") {
      const st = this.T("#6b4a2a", 0.6);
      for (let y = y0; y <= y0 + 5; y++) px.push([0, y, st]);
      px.push([0, y0 + 6, "#ffd23a"], [0, y0 + 7, "#ff9a2a"], [-1, y0 + 6, "#ff8a2a"], [1, y0 + 6, "#ff8a2a"], [0, y0 + 8, "#fff1a0"]);
    }
    return px;
  }
  private spr(key: string, sleeve: string, skin: string, tool: Tool): Sprite {
    const id = `${key}:${tool}`;
    if (this.sprites[id]) return this.sprites[id];
    const px: Px[] = [];
    for (let y = 0; y < 7; y++) for (let x = -1; x <= 1; x++) px.push([x, y, y < 5 ? sleeve : skin]);
    px.push(...this.toolPx(tool));
    if (tool !== "none") for (const p of px) if (p[1] >= 5 && p[1] <= 6 && Math.abs(p[0]) <= 1) p[2] = skin; // the hand over the handle
    return (this.sprites[id] = sprite(px));
  }
  private toolOnly(tool: Tool): Sprite {
    const id = `tool:${tool}`;
    return this.sprites[id] || (this.sprites[id] = sprite(this.toolPx(tool, 0)));
  }

  /** A sprite turned to `deg` (0 = hanging down, 90 = forward), nearest pixel only, cached. */
  private turned(s: Sprite, key: string, deg: number): HTMLCanvasElement {
    const step = 6;
    const a = ((Math.round(deg / step) * step) % 360 + 360) % 360;
    const id = `${key}@${a}`;
    const hit = this.rot.get(id);
    if (hit) return hit;
    const r = s.r + 1, size = r * 2 + 1;
    const [c, g] = this.mk(size, size);
    const map = new Map<string, string>();
    for (const [x, y, col] of s.px) map.set(`${x},${y}`, col);
    const th = (a * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
    for (let ty = -r; ty <= r; ty++) for (let tx = -r; tx <= r; tx++) {
      // Inverse of: x' = x cos + y sin, y' = -x sin + y cos (down turns toward +x as the angle grows).
      const sx = Math.round(tx * cs - ty * sn), sy = Math.round(tx * sn + ty * cs);
      const col = map.get(`${sx},${sy}`);
      if (col) { g.fillStyle = col; g.fillRect(tx + r, ty + r, 1, 1); }
    }
    if (this.rot.size > 1400) this.rot.clear();
    this.rot.set(id, c);
    return c;
  }

  /** Draw one worker into the small worker canvas, facing right, feet on row 40 at x 20 (offset 12, 16). */
  private paintWorker(id: WorkerId, o: Body) {
    const g = this.wg, L = McPainter.LOOK[id];
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.wc.width, this.wc.height);
    g.setTransform(1, 0, 0, 1, 12, 16);
    const k = 0.62;
    const C = (h: string) => this.T(h, k);
    const cx = 20, hipY = 33 - o.bob, shY = 27 - o.bob; // the shoulder sits a pixel under the chin
    const put = (sp: HTMLCanvasElement, x: number, y: number) => { const r = (sp.width - 1) / 2; g.drawImage(sp, x - r, y - r); };
    const toolB = o.toolB === "none" && id === "pip" && this.night() ? "light" : o.toolB;
    put(this.turned(this.spr(`${id}-b`, C(darkHex(L.shirt)), C(L.skin), toolB), `${id}-b-${toolB}`, o.armB), cx, shY);
    const leg = (key: string, col: string) => {
      const boot = C("#3b2a1a");
      return this.sprites[key] || (this.sprites[key] = sprite(Array.from({ length: 21 }, (_, i) => { const x = (i % 3) - 1, y = Math.floor(i / 3); return [x, y, y >= 5 ? boot : col] as Px; })));
    };
    put(this.turned(leg(`${id}-lb`, C(darkHex(L.pants))), `${id}-lb`, o.legB), cx, hipY);
    g.fillStyle = C(L.shirt); g.fillRect(cx - 3, 25 - o.bob, 6, 9);
    g.fillStyle = C(L.vest); g.fillRect(cx - 3, 26 - o.bob, 6, 7); g.fillStyle = C(L.shirt); g.fillRect(cx, 26 - o.bob, 1, 2);
    g.fillStyle = this.night() ? "#c9cfd6" : "#eef2f5"; g.fillRect(cx - 3, 30 - o.bob, 6, 1);
    g.fillStyle = C("#4a3020"); g.fillRect(cx - 3, 33 - o.bob, 6, 1); g.fillStyle = C("#d9b04a"); g.fillRect(cx + 1, 33 - o.bob, 1, 1);
    put(this.turned(leg(`${id}-lf`, C(L.pants)), `${id}-lf`, o.legF), cx, hipY);
    const hx = cx - 3 + o.headDx, hy = 18 - o.bob;
    g.fillStyle = C(L.skin); g.fillRect(hx, hy, 7, 7);
    g.fillStyle = C(L.hair); g.fillRect(hx, hy, 2, 5); g.fillRect(hx, hy, 7, 1);
    g.fillStyle = C(darkHex(L.skin)); g.fillRect(hx + 2, hy + 3, 1, 2);
    if (o.shocked) { g.fillStyle = "#ffffff"; g.fillRect(hx + 4, hy + 2, 2, 2); g.fillStyle = "#111"; g.fillRect(hx + 5, hy + 3, 1, 1); g.fillRect(hx + 4, hy + 5, 2, 1); }
    else { g.fillStyle = "#1a1410"; g.fillRect(hx + 5, hy + 3, 1, 1); }
    if (L.face === "stache") { g.fillStyle = C(L.hair); g.fillRect(hx + 3, hy + 5, 4, 1); g.fillRect(hx + 4, hy + 6, 3, 1); g.fillRect(hx + 7, hy + 5, 1, 1); }
    if (L.face === "specs") { g.fillStyle = "#18181c"; g.fillRect(hx + 3, hy + 2, 4, 1); g.fillRect(hx + 4, hy + 3, 1, 1); g.fillStyle = "#cfe8ff"; g.fillRect(hx + 5, hy + 3, 1, 1); g.fillStyle = "#18181c"; g.fillRect(hx + 6, hy + 3, 1, 1); }
    if (L.face === "beard") { g.fillStyle = C(L.hair); g.fillRect(hx + 2, hy + 5, 5, 2); g.fillRect(hx + 3, hy + 7, 3, 1); g.fillStyle = C(L.skin); g.fillRect(hx + 5, hy + 5, 1, 1); }
    if (!o.hatOff) {
      const hu = o.hatUp;
      g.fillStyle = C(L.hat); g.fillRect(hx + 1, hy - 3 - hu, 5, 1); g.fillRect(hx, hy - 2 - hu, 7, 2); g.fillRect(hx - 1, hy - hu, 10, 1);
      g.fillStyle = C(darkHex(L.hat, 0.84)); g.fillRect(hx + 3, hy - 3 - hu, 1, 3);
      if (id === "gus") { g.fillStyle = this.night() ? "#fff6b0" : "#fff2a0"; g.fillRect(hx + 6, hy - 2 - hu, 1, 1); }
    } else { g.fillStyle = C(L.hair); g.fillRect(hx + 1, hy - 1, 5, 1); g.fillRect(hx + 2, hy - 2, 1, 1); g.fillRect(hx + 4, hy - 2, 1, 1); } // bare head, hair on end
    put(this.turned(this.spr(`${id}-f`, C(L.shirt), C(L.skin), o.toolF), `${id}-f-${o.toolF}`, o.armF), cx, shY);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Turn the whole worker canvas around a point (a trip, a nap, a fall), nearest pixel. */
  private tilt(deg: number, px: number, py: number) {
    if (!deg) return;
    const w = this.wc.width, h = this.wc.height;
    const src = this.wg.getImageData(0, 0, w, h), out = this.wg.createImageData(w, h);
    const th = (deg * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x - px, dy = y - py;
      const sx = Math.round(px + dx * cs + dy * sn), sy = Math.round(py - dx * sn + dy * cs);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const i = (sy * w + sx) * 4, j = (y * w + x) * 4;
      out.data[j] = src.data[i]; out.data[j + 1] = src.data[i + 1]; out.data[j + 2] = src.data[i + 2]; out.data[j + 3] = src.data[i + 3];
    }
    this.wg.putImageData(out, 0, 0);
  }

  // ---------- one frame ----------

  private sp(x: number, y: number, n: number, power = 1) {
    const r = this.r;
    for (let i = 0; i < n; i++) this.sparks.push({ x, y, vx: (r() - 0.5) * 90 * power, vy: -(15 + r() * 70) * power, age: 0, life: 260 + r() * 420 });
  }
  /** A grunt, unless another voice was heard less than 450 ms ago (funny, not noisy). The bubble shows anyway. */
  private voice(ev: McEvent[], who: WorkerId, kind: Voice, vol = 1) {
    if (this.t - this.lastVoice < 450) return;
    this.lastVoice = this.t;
    ev.push({ type: "grunt", who, kind, vol });
  }

  /** Move the scene on by dt ms and draw it. Returns what happened, for the sounds. */
  frame(dt: number, draw = true): McEvent[] {
    const ev: McEvent[] = [];
    if (!this.plan) return ev;
    this.t += dt;
    const t = this.t, r = this.r, w = this.world();

    // The run in.
    const entering = !this.skip && t < this.entranceEnd();
    const at: Record<string, WorkerAt> = {};
    for (const p of this.entrance) {
      const a = workerAt(p, t, this.poleX, this.W, this.skip);
      at[p.id] = a;
      const s = this.seen[p.id] || (this.seen[p.id] = { pose: "run", downs: 0 });
      if (a.pose !== s.pose) {
        if (a.pose === "down") { s.downs++; this.say(p.id, s.downs > 1 ? "OOF!" : "OOF"); this.voice(ev, p.id, "oof", s.downs > 1 ? 1 : 0.9); }
        if (a.pose === "turn") { this.say(p.id, "HUH?"); this.voice(ev, p.id, "huh", 0.8); }
        if (a.pose === "work" && s.downs === 0 && p.overshoot) this.say(p.id, "...");
        s.pose = a.pose;
      }
    }

    // The beats, one after another, once everyone is there.
    let bodies: Record<string, Body> | null = null;
    if (!entering) {
      const start = this.entranceEnd();
      if (!this.beat) this.startBeat(start);
      let lt = t - this.beatAt;
      while (this.beat && lt >= this.beat.dur) { this.fireCues(this.beatLt, this.beat.dur + 1, ev, w); this.startBeat(this.beatAt + this.beat.dur); lt = t - this.beatAt; }
      const b = this.beat!;
      this.fireCues(this.beatLt, lt, ev, w);
      this.beatLt = lt;
      this.now = worldIn(b, lt, w);
      bodies = {};
      for (const id of IDS) bodies[id] = poseIn(b, id, lt, w);
    } else this.now = { poleAngle: 0, shake: 0, huge: null, flying: null, hat: null };

    // The frayed wire and the box spit sparks on their own now and then.
    if (t >= this.nextAmbient) {
      const f = this.poleAt("frayed"), bx = this.poleAt("box");
      this.sp(f[0], f[1], 2 + Math.floor(r() * 4), 0.7);
      if (r() < 0.35) this.sp(bx[0] + 2, bx[1] - 4, 2, 0.5);
      this.nextAmbient = t + 280 + r() * 900;
      if (r() < 0.15) ev.push({ type: "spark", vol: 0.3 });
    }
    // The bulb flickers on its own, unless a beat holds it on (or it has just popped).
    if (t >= this.bulbNext) { this.bulbOn = r() < 0.62; this.bulbNext = t + (this.bulbOn ? 120 + r() * 700 : 40 + r() * 160); }

    const s = dt / 1000;
    for (const p of this.sparks) { p.age += dt; p.x += p.vx * s; p.y += p.vy * s; p.vy += 190 * s; if (p.y > this.gy - 1) { p.y = this.gy - 1; p.vy *= -0.3; p.vx *= 0.5; } }
    this.sparks = this.sparks.filter((p) => p.age < p.life).slice(-200);
    for (const b of this.bubbles) b.age += dt;
    this.bubbles = this.bubbles.filter((b) => b.age < b.life);
    for (const m of this.smoke) m.age += dt;
    this.smoke = this.smoke.filter((m) => m.age < m.life);
    if (draw) this.paint(at, bodies);
    return ev;
  }

  private startBeat(at: number) {
    if (!this.plan) return;
    const id = beatFor(this.plan, this.beatIdx, this.prevBeat, this.beatR, this.reduced);
    this.beat = makeBeat(id, this.beatR, this.world(), this.plan, this.reduced);
    this.beatAt = at; this.beatLt = -1; this.beatIdx++; this.prevBeat = id;
    this.played.push(id);
    if (this.played.length > 40) this.played.splice(0, this.played.length - 40);
  }

  private fireCues(from: number, to: number, ev: McEvent[], w: World) {
    const b = this.beat; if (!b) return;
    for (const c of b.cues) {
      if (c.at <= from || c.at > to) continue;
      this.cue(c, ev, w);
    }
  }

  private cue(c: Cue, ev: McEvent[], w: World) {
    const t = this.t;
    if (c.say && c.who) this.say(c.who, c.say);
    if (c.voice && c.who && c.who !== "box") this.voice(ev, c.who, c.voice, c.vol ?? 1);
    const box = this.poleAt("box");
    switch (c.fx) {
      case "hit": this.sp(box[0], box[1], 8); this.flashAt = t; ev.push({ type: "hit", who: "gus", zap: false }); break;
      case "zapHit": this.sp(box[0], box[1], 26, 1.5); this.flashAt = t; this.zapAt = t; this.say("box", "ZAP!"); this.smoke.push({ x: box[0], y: box[1] - 6, age: 0, life: 1400 }); ev.push({ type: "hit", who: "gus", zap: true }); break;
      case "tap": { const m = this.poleAt("meter"); if (this.r() < 0.35) this.sp(m[0], m[1], 3, 0.6); ev.push({ type: "tap", who: (c.who as WorkerId) || "pip" }); break; }
      case "bigspark": this.sp(box[0], box[1], 44, 1.9); this.flashAt = t; this.zapAt = t; this.smoke.push({ x: box[0], y: box[1] - 6, age: 0, life: 1800 }); ev.push({ type: "hit", who: "gus", zap: true, big: true }); break;
      case "bighit": this.sp(box[0], box[1], 70, 2.3); this.sp(box[0] - 4, box[1] - 8, 30, 1.6); this.flashAt = t; this.zapAt = t; this.smoke.push({ x: box[0], y: box[1] - 6, age: 0, life: 2000 }); ev.push({ type: "hit", who: "gus", zap: true, big: true }); break;
      case "bolt": this.boltAt = t; this.boltTo = (c.who as WorkerId) || "gus"; break;
      case "bulbOn": this.bulbForce = "on"; break;
      case "bulbAuto": this.bulbForce = null; break;
      case "bulbPop": { this.bulbForce = null; this.bulbDeadUntil = t + 1400; const b = this.bulbPos(); this.sp(b[0], b[1] + 3, 10, 0.8); this.say("box", "..."); ev.push({ type: "spark", vol: 0.6 }); break; }
      case "thud": { const tp = this.poleAt("top", 82); for (let i = 0; i < 4; i++) this.smoke.push({ x: tp[0] - 12 + i * 8, y: this.gy - 2, age: 0, life: 900, dust: true }); ev.push({ type: "thud" }); break; }
      case "dust": { const x = this.wpos[c.who as string]?.x ?? box[0]; this.smoke.push({ x, y: this.gy - 2, age: 0, life: 700, dust: true }); break; }
    }
    void w;
  }

  say(who: WorkerId | "box", text: string) {
    this.bubbles = this.bubbles.filter((b) => b.who !== who);
    this.bubbles.push({ who, text, age: 0, life: text.length > 2 ? 1300 : 1000 });
  }

  // ---------- painting ----------

  private paint(at: Record<string, WorkerAt>, bodies: Record<string, Body> | null) {
    const g = this.g, { W, H, t } = this;
    const motion = !this.reduced;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    if (this.now.shake && motion) g.setTransform(1, 0, 0, 1, Math.floor(t / 40) % 2 ? 1 : -1, Math.floor(t / 55) % 2 ? 1 : 0);
    if (!this.ownBg) {
      g.drawImage(this.layers.sky!, 0, 0);
      if (this.night()) {
        for (const st of this.stars) {
          const tw = motion ? Math.sin(t / 700 + st.ph) : 1;
          g.fillStyle = tw > 0.6 ? "#ffffff" : tw > -0.2 ? "#b9c3ff" : "#5a68a8";
          g.fillRect(st.x, st.y, 1, 1);
        }
        this.drawMoon(Math.round(W * 0.2), Math.round(this.gy * 0.18));
      } else this.drawSun(Math.round(W * 0.18), Math.round(this.gy * 0.16) + (motion ? Math.round(Math.sin(t / 2600)) : 0));
      const sway = (amp: number) => (motion ? Math.round(Math.sin(t / 6500) * amp) : 0);
      g.drawImage(this.layers.far!, -8 + sway(1), 0);
      this.drawClouds(0);
      g.drawImage(this.layers.mid!, -8 + sway(3), 0);
      this.drawClouds(1);
    }
    this.drawGlows();
    g.drawImage(this.layers.ground!, 0, 0);
    this.drawTorches();
    this.drawWires();
    const pt = this.poleTurned(this.now.poleAngle);
    g.drawImage(pt.c, this.poleX + 2 - pt.ox, this.gy - pt.oy);
    this.drawBulb();
    if (this.now.hat) this.drawHat(this.now.hat.who, this.now.hat.x, this.now.hat.lift);
    // Workers, back to front.
    for (const id of ["bram", "gus", "pip"] as WorkerId[]) {
      if (bodies) this.drawBody(id, bodies[id], null);
      else if (at[id]) this.drawBody(id, this.entranceBody(id, at[id]), at[id]);
    }
    if (this.now.flying) { const f = this.now.flying; const c = this.turned(this.toolOnly("wrench"), "fly-wrench", f.spin); g.drawImage(c, Math.round(f.x) - (c.width >> 1), Math.round(f.y) - (c.width >> 1)); }
    if (t - this.boltAt < 220) this.drawBolt();
    for (const p of this.sparks) {
      const k = p.age / p.life;
      g.fillStyle = k < 0.2 ? "#ffffff" : k < 0.45 ? "#fff6a0" : k < 0.75 ? "#ffd23a" : "#ff8a2a";
      const sz = p.age < 70 ? 2 : 1;
      g.fillRect(Math.round(p.x), Math.round(p.y), sz, sz);
    }
    for (const m of this.smoke) {
      const k = m.age / m.life, y = Math.round(m.y - k * (m.dust ? 5 : 16)), x = Math.round(m.x + Math.sin(k * 6) * 2);
      g.fillStyle = m.dust ? `rgba(200,180,150,${(0.55 * (1 - k)).toFixed(2)})` : `rgba(${this.night() ? "120,120,130" : "90,90,96"},${(0.55 * (1 - k)).toFixed(2)})`;
      const sz = (m.dust ? 3 : 2) + Math.round(k * 4);
      g.fillRect(x - (sz >> 1), y - (sz >> 1), sz, sz);
    }
    if (t - this.zapAt < 90) { g.fillStyle = this.night() ? "rgba(255,250,210,0.22)" : "rgba(255,255,255,0.28)"; g.fillRect(-2, -2, W + 4, H + 4); }
    for (const b of this.bubbles) this.drawBubble(b);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  private entranceBody(id: WorkerId, w: WorkerAt): Body {
    const b = base(this.world(), id);
    b.x = w.x; b.face = w.face;
    const ph = w.dist / 4.2, s = Math.sin(ph);
    if (w.pose === "run" || w.pose === "trip") {
      b.legF = s * 40; b.legB = -s * 40; b.bob = Math.abs(Math.cos(ph)) > 0.7 ? 1 : 0;
      if (id === "gus") { b.armF = 80 + s * 15; b.armB = s * 45; }
      else if (id === "bram") { b.armB = 160; b.armF = -s * 45; }
      else { b.armF = -s * 50; b.armB = s * 50; }
      if (w.pose === "trip") b.tilt = w.k * 88;
    } else if (w.pose === "down") {
      b.tilt = 88; b.legF = 30; b.legB = -10; b.armF = 160; b.armB = 140;
      if (!this.reduced && Math.floor(this.t / 80) % 2) b.hatUp = 1;
    } else if (w.pose === "up") {
      b.tilt = 88 * (1 - w.k * w.k * (3 - 2 * w.k)); b.legF = 10; b.armF = 40;
    } else if (w.pose === "turn") {
      // Ran past it: stops, looks around.
      b.legF = 10; b.legB = -6; b.headDx = Math.floor(this.t / 150) % 2 ? -1 : 0; b.armF = 120; b.armB = 60;
    }
    return b;
  }

  private drawBody(id: WorkerId, o: Body, w: WorkerAt | null) {
    const t = this.t;
    // The shoulder jolt on a strike and the zap shake.
    let dx = 0;
    if (id === "gus" && this.beat?.id === "hit" && t - this.zapAt < 420) { o.shocked = true; o.hatUp = t - this.zapAt < 250 ? 3 : 1; dx = Math.floor((t - this.zapAt) / 45) % 2 ? 1 : -1; }
    if (this.beat?.id === "hit" && id === "bram" && t - this.zapAt < 300) { o.bob = 2; o.shocked = true; }
    const huge = this.now.huge && this.now.huge.who === id ? this.now.huge : null;
    if (huge) { o.toolF = "none"; o.armF = huge.angle; }
    this.paintWorker(id, o);
    if (o.tilt) this.tilt(o.tilt, 35, 56);
    const face = o.face;
    const x = Math.round(o.x) + dx * face, yTop = this.gy - 56 - Math.round(o.lift);
    const g = this.g;
    if (face === 1) g.drawImage(this.wc, x - 32, yTop);
    else { g.save(); g.translate(x + 32, yTop); g.scale(-1, 1); g.drawImage(this.wc, 0, 0); g.restore(); }
    // Where his head is (bubbles, dizzy stars): the head top turned with the body around the feet.
    const th = (o.tilt * Math.PI) / 180, hx0 = -3, hy0 = -25;
    const hxT = Math.cos(th) * hx0 - Math.sin(th) * hy0, hyT = Math.sin(th) * hx0 + Math.cos(th) * hy0;
    const headX = Math.round(x + face * (3 + hxT)), headY = Math.round(this.gy - o.lift + hyT);
    this.wpos[id] = { x: headX, headY };
    if (w && w.pose === "down") {
      for (let i = 0; i < 3; i++) { const a = t / 160 + (i * Math.PI * 2) / 3; g.fillStyle = i ? "#ffd23a" : "#ffffff"; g.fillRect(Math.round(headX + Math.cos(a) * 5), Math.round(headY - 3 + Math.sin(a) * 2), 1, 1); }
    }
    if (w && w.pose === "up") { g.fillStyle = `rgba(200,180,150,${(0.5 * (1 - w.k)).toFixed(2)})`; g.fillRect(x - 6 - Math.round(w.k * 4), this.gy - 3, 4, 3); g.fillRect(x + 4 + Math.round(w.k * 4), this.gy - 3, 4, 3); }
    // A held torch lights up around its flame.
    if (o.toolF === "torch") {
      const a = (o.armF * Math.PI) / 180, sx = x, sy = this.gy - 13 - o.lift;
      const fx = Math.round(sx + face * Math.sin(a) * 13), fy = Math.round(sy + Math.cos(a) * 13);
      this.glow(fx, fy, this.night() ? 20 : 10, "255,190,90", this.night() ? 0.16 : 0.08);
    }
    // The ridiculously huge pickaxe.
    if (huge && huge.scale > 0.02) {
      const a = (huge.angle * Math.PI) / 180, sx = x, sy = this.gy - 13 - o.lift;
      const hx = sx + face * Math.sin(a) * 6, hy = sy + Math.cos(a) * 6;
      const c = this.turned(this.toolOnly("pick"), "huge-pick", huge.angle);
      const r = (c.width - 1) / 2, s = 0.6 + huge.scale * 1.8;
      g.save(); g.translate(Math.round(hx), Math.round(hy)); g.scale(face * s, s); g.drawImage(c, -r, -r); g.restore();
    }
  }

  private drawHat(id: WorkerId, x: number, lift: number) {
    const g = this.g, L = McPainter.LOOK[id], y = this.gy - 3 - Math.round(lift);
    g.fillStyle = this.T(L.hat, 0.62); g.fillRect(Math.round(x) - 2, y - 2, 5, 1); g.fillRect(Math.round(x) - 3, y - 1, 7, 2); g.fillRect(Math.round(x) - 4, y + 1, 9, 1);
  }

  private drawBolt() {
    const g = this.g, [bx, by] = this.poleAt("box"), p = this.wpos[this.boltTo];
    if (!p) return;
    const tx = p.x, ty = p.headY + 10;
    g.fillStyle = Math.floor(this.t / 40) % 2 ? "#ffffff" : "#fff3a0";
    const n = 6;
    let px = bx, py = by;
    for (let i = 1; i <= n; i++) {
      const k = i / n, nx = Math.round(bx + (tx - bx) * k + (i < n ? (i % 2 ? 3 : -3) : 0)), ny = Math.round(by + (ty - by) * k + (i < n ? (i % 2 ? -2 : 2) : 0));
      const steps = Math.max(Math.abs(nx - px), Math.abs(ny - py), 1);
      for (let s = 0; s <= steps; s++) g.fillRect(Math.round(px + ((nx - px) * s) / steps), Math.round(py + ((ny - py) * s) / steps), 1, 1);
      px = nx; py = ny;
    }
  }

  private drawWires() {
    const g = this.g, gy = this.gy, arm = gy - 68;
    g.fillStyle = this.night() ? "#05070c" : "#2b2b30";
    const sag = (x0: number, y0: number, x1: number, y1: number, s: number) => {
      const n = Math.max(1, Math.abs(x1 - x0));
      let py = y0;
      for (let i = 0; i <= n; i++) {
        const k = i / n, xx = Math.round(x0 + (x1 - x0) * k);
        const yy = Math.min(gy - 1, Math.round(y0 + (y1 - y0) * k + s * 4 * k * (1 - k)));
        const a = Math.min(py, yy), b = Math.max(py, yy);
        g.fillRect(xx, a, 1, Math.max(1, b - a + (i ? 0 : 1)));
        py = yy;
      }
    };
    const [rx, ry] = this.poleAt("armR"), [lx, ly] = this.poleAt("armL");
    const slack = Math.abs(this.now.poleAngle) / 82; // a fallen pole leaves the wires hanging low
    sag(rx + 2, ry, this.W + 2, arm - 12, 7 + slack * 18);
    sag(-2, arm - 14, lx + 1, ly, 9 + slack * 14);
    sag(-2, arm - 4, lx + 1, ly + 1, 12 + slack * 14);
  }

  private drawSun(x: number, y: number) {
    const g = this.g, t = this.t;
    g.fillStyle = "#ffe98a"; g.fillRect(x - 9, y - 9, 18, 18);
    g.fillStyle = "#fff6c4"; g.fillRect(x - 7, y - 7, 14, 14);
    g.fillStyle = "#fffbe6"; g.fillRect(x - 5, y - 5, 10, 10);
    const on = this.reduced ? 0 : Math.floor(t / 700) % 2;
    g.fillStyle = "#ffe98a";
    const d = on ? 13 : 12;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) g.fillRect(x + dx * d - 1, y + dy * d - 1, 2, 2);
    for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) g.fillRect(x + dx * (d - 2) - 1, y + dy * (d - 2) - 1, 2, 2);
  }
  private drawMoon(x: number, y: number) {
    const g = this.g;
    g.fillStyle = "rgba(200,210,255,0.10)"; g.fillRect(x - 11, y - 11, 22, 22);
    g.fillStyle = "#e7e9f2"; g.fillRect(x - 7, y - 7, 14, 14);
    g.fillStyle = "#c4c8d6"; g.fillRect(x - 3, y - 4, 3, 3); g.fillRect(x + 2, y + 1, 2, 2); g.fillRect(x - 5, y + 3, 2, 2);
    g.fillStyle = "#f6f7fb"; g.fillRect(x - 7, y - 7, 14, 1); g.fillRect(x - 7, y - 7, 1, 14);
  }
  private drawClouds(layer: number) {
    const g = this.g, W = this.W;
    const speed = layer ? 3.2 : 1.6;
    const span = W + 80;
    for (const c of this.clouds) {
      if (c.layer !== layer) continue;
      const x = Math.round((((c.x + (this.reduced ? 0 : (this.t / 1000) * speed)) % span) + span) % span) - 60;
      const body = this.night() ? (layer ? "#3a4478" : "#2c356a") : layer ? "#ffffff" : "#eef6ff";
      const belly = this.night() ? "#262e5c" : layer ? "#dbe8f5" : "#d6e6f6";
      for (const [px, py, w, h] of c.parts) { g.fillStyle = body; g.fillRect(x + px, c.y + py, w, h); }
      g.fillStyle = belly; g.fillRect(x, c.y + 7, c.w, 1);
    }
  }
  /** A soft light as stacked pixel discs (three rings, brighter in the middle). */
  private glow(x: number, y: number, r: number, rgb: string, a: number) {
    const g = this.g;
    for (let i = 3; i >= 1; i--) {
      const rr = Math.max(1, Math.round((r * i) / 3));
      g.fillStyle = `rgba(${rgb},${(a / (i + 0.6)).toFixed(3)})`;
      for (let dy = -rr; dy <= rr; dy++) {
        const half = Math.floor(Math.sqrt(rr * rr - dy * dy));
        if (half > 0) g.fillRect(x - half, y + dy, half * 2, 1);
      }
    }
  }
  private lit() {
    if (this.t < this.bulbDeadUntil) return false;
    if (this.bulbForce === "on") return true;
    return this.bulbOn && this.t - this.zapAt > 350;
  }
  private drawGlows() {
    const night = this.night();
    if (night) for (const [x, y] of this.torches) this.glow(x, y - 6, 18 + (this.reduced ? 0 : Math.round(Math.sin(this.t / 90) * 1.2)), "255,190,90", 0.12);
    const flash = this.t - this.flashAt < 140;
    const b = this.bulbPos();
    const steady = this.bulbForce === "on";
    if (this.lit() || flash) this.glow(b[0], b[1] + 2, flash ? 30 : steady ? (night ? 30 : 18) : night ? 22 : 12, "255,240,160", flash ? 0.2 : steady ? (night ? 0.2 : 0.1) : night ? 0.13 : 0.06);
    const p = this.wpos.gus;
    if (night && p) this.glow(p.x + 3, p.headY + 2, 8, "255,240,170", 0.08);
  }
  private bulbPos(): [number, number] {
    const [ax, ay] = this.poleAt("bulb");
    const len = 23;
    const a = this.reduced ? 0.04 : Math.sin(this.t / 900) * 0.16 + (this.t - this.zapAt < 600 ? Math.sin((this.t - this.zapAt) / 40) * 0.12 : 0);
    return [Math.round(ax + Math.sin(a) * len), Math.min(this.gy - 7, Math.round(ay + Math.cos(a) * len))];
  }
  private drawBulb() {
    const g = this.g, [ax, ay] = this.poleAt("bulb");
    const [bx, by] = this.bulbPos();
    g.fillStyle = this.night() ? "#05070c" : "#2b2b30";
    const n = Math.max(1, Math.abs(by - ay), Math.abs(bx - ax));
    for (let i = 0; i <= n; i++) g.fillRect(Math.round(ax + ((bx - ax) * i) / n), Math.round(ay + ((by - ay) * i) / n), 1, 1);
    const flash = this.t - this.flashAt < 140;
    const lit = this.lit() || flash;
    g.fillStyle = this.T("#5d636b", 0.6); g.fillRect(bx - 1, by, 3, 2);
    g.fillStyle = lit ? (flash ? "#ffffff" : "#fff3a0") : this.T("#9a9a88", 0.6);
    g.fillRect(bx - 2, by + 2, 5, 3); g.fillRect(bx - 1, by + 5, 3, 1);
    if (lit) { g.fillStyle = "#ffffff"; g.fillRect(bx - 1, by + 2, 1, 1); }
  }
  private drawTorches() {
    const g = this.g;
    for (const [x, y] of this.torches) {
      g.fillStyle = this.T("#6b4a2a", 0.6); g.fillRect(x, y - 5, 1, 5);
      const f = this.reduced ? 0 : Math.floor(this.t / 110 + x) % 3;
      g.fillStyle = ["#ffd23a", "#ff9a2a", "#fff1a0"][f]; g.fillRect(x, y - 7, 1, 2);
      g.fillStyle = ["#ff8a2a", "#ffd23a", "#ff9a2a"][f]; g.fillRect(x, y - 8 + (f === 1 ? 1 : 0), 1, 1);
    }
  }

  private drawBubble(b: { who: WorkerId | "box"; text: string; age: number; life: number }) {
    const g = this.g;
    let x: number, y: number;
    if (b.who === "box") { const [bx] = this.poleAt("box"); x = bx - 4; y = this.gy - 46; }
    else { const p = this.wpos[b.who]; if (!p) return; x = p.x; y = p.headY - 14; }
    x = Math.max(textW(b.text) / 2 + 3, Math.min(this.W - textW(b.text) / 2 - 3, x));
    const pop = b.age < 90 ? 1 : 0;
    const tw = textW(b.text), w = tw + 4, h = 9;
    const bx = Math.round(x - w / 2), by = Math.round(y) - pop;
    const angry = /[#@~]/.test(b.text);
    const fill = b.who === "box" ? "#ffd23a" : angry ? "#fff0e8" : "#ffffff", ink = "#1b1a1d";
    g.fillStyle = ink; g.fillRect(bx + 1, by, w - 2, h); g.fillRect(bx, by + 1, w, h - 2);
    g.fillStyle = fill; g.fillRect(bx + 1, by + 1, w - 2, h - 2);
    g.fillStyle = ink; g.fillRect(Math.round(x) - 1, by + h, 3, 1); g.fillRect(Math.round(x), by + h + 1, 1, 1);
    g.fillStyle = fill; g.fillRect(Math.round(x), by + h - 1, 1, 1);
    let cx = bx + 2;
    for (const ch of b.text) {
      const gl = GLYPH[ch] || GLYPH[" "];
      g.fillStyle = inkOf(ch);
      gl.forEach((row, yy) => { for (let xx = 0; xx < row.length; xx++) if (row[xx] === "1") g.fillRect(cx + xx, by + 2 + yy, 1, 1); });
      cx += gl[0].length + 1;
    }
  }
}


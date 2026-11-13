// Minecraft mode crew: what they do this time. Pure (no DOM), so tests/mc-scene.test.ts can run it in node.
//
// The developer (4 Nov 2026): "every time Minecraft mode opens, the workers should do slightly different things, so it never
// feels the same twice". So every open gets its own plan:
//  - a randomised run in: who comes first, from which side, who trips (sometimes nobody, sometimes one trips
//    twice), and sometimes one runs past the pole and has to come back;
//  - a stream of working beats picked at random with weights, never the same beat twice in a row;
//  - now and then an argument (two of them, symbols in their bubbles, the third quietly fixing it), which ends
//    with them making up or one stomping off and coming back;
//  - about one open in ten a rare surprise (a ridiculously huge pickaxe, or the pole falling over).
// The last few opens are remembered (localStorage), so the next one starts differently.
import { rng } from "./scene-logic.ts";

export type WorkerId = "gus" | "bram" | "pip";
export const IDS: WorkerId[] = ["gus", "bram", "pip"];

/** Their spots at the pole (offset from the pole, logical px) and which way they face there. */
export const HOME: Record<WorkerId, { spot: number; face: 1 | -1; speed: number }> = {
  gus: { spot: -24, face: 1, speed: 118 },
  bram: { spot: -42, face: 1, speed: 104 },
  pip: { spot: 11, face: -1, speed: 112 },
};

/** The pole sits at two thirds of the width; on a narrow panel it keeps room for Pip on its right. */
export const poleXFor = (width: number) => Math.max(60, Math.min(width - 34, Math.round(width * 0.66)));

// ---------- the run in ----------

/** A trip: fall, lie there, get up (ms); the fall slides him TRIP.slide px. */
export const TRIP = { fall: 240, down: 520, up: 300, slide: 6 } as const;
/** Running past the spot: how far past the pole, and the "wait, where?" pause before coming back. */
export const OVERSHOOT = { past: 26, pause: 420 } as const;

export interface EntrancePlan {
  id: WorkerId;
  from: "left" | "right";
  delay: number;
  speed: number;
  /** Where along the first run he trips (0..1 of the way), none, one or two. */
  trips: number[];
  /** Runs past the pole and has to come back. */
  overshoot: boolean;
}

export type Pose = "run" | "trip" | "down" | "up" | "turn" | "work";
type Seg =
  | { k: "run"; x0: number; x1: number; ms: number }
  | { k: "trip" | "down" | "up"; x0: number; x1: number; ms: number }
  | { k: "turn"; x0: number; x1: number; ms: number };

export interface WorkerAt { x: number; pose: Pose; face: 1 | -1; /** 0..1 inside a trip phase. */ k: number; /** Distance run so far (drives the leg cycle). */ dist: number }

const startX = (p: EntrancePlan, width: number) => (p.from === "left" ? -18 : width + 18);

/** His run in as segments: runs, trips, and the turn when he overshot. */
export function pathOf(p: EntrancePlan, poleX: number, width: number): Seg[] {
  const target = poleX + HOME[p.id].spot;
  const x0 = startX(p, width);
  const dir = p.from === "left" ? 1 : -1;
  const segs: Seg[] = [];
  const run = (a: number, b: number) => { if (Math.abs(b - a) > 0.01) segs.push({ k: "run", x0: a, x1: b, ms: (Math.abs(b - a) / p.speed) * 1000 }); };
  // The first leg goes to the spot, or past the pole when he overshoots.
  const end1 = p.overshoot ? (dir === 1 ? Math.max(target, poleX) + OVERSHOOT.past : Math.min(target, poleX) - OVERSHOOT.past) : target;
  let x = x0;
  const span = end1 - x0;
  for (const f of [...p.trips].sort((a, b) => a - b)) {
    const at = x0 + span * f;
    if ((at - x) * dir <= 0) continue;
    run(x, at);
    const slid = at + dir * TRIP.slide;
    segs.push({ k: "trip", x0: at, x1: slid, ms: TRIP.fall }, { k: "down", x0: slid, x1: slid, ms: TRIP.down }, { k: "up", x0: slid, x1: slid, ms: TRIP.up });
    x = slid;
  }
  run(x, end1);
  if (p.overshoot) { segs.push({ k: "turn", x0: end1, x1: end1, ms: OVERSHOOT.pause }); run(end1, target); }
  return segs;
}

/** When he reaches his spot (ms after the open). */
export function arriveMs(p: EntrancePlan, poleX: number, width: number): number {
  return p.delay + pathOf(p, poleX, width).reduce((s, g) => s + g.ms, 0);
}
export const entranceMs = (plan: EntrancePlan[], poleX: number, width: number) => Math.max(0, ...plan.map((p) => arriveMs(p, poleX, width)));

/** Where one worker is `t` ms after the open. */
export function workerAt(p: EntrancePlan, t: number, poleX: number, width: number, skipEntrance = false): WorkerAt {
  const home = HOME[p.id], target = poleX + home.spot;
  const dir: 1 | -1 = p.from === "left" ? 1 : -1;
  if (skipEntrance) return { x: target, pose: "work", face: home.face, k: 0, dist: 0 };
  let tt = t - p.delay;
  const x0 = startX(p, width);
  if (tt <= 0) return { x: x0, pose: "run", face: dir, k: 0, dist: 0 };
  let dist = 0;
  for (const g of pathOf(p, poleX, width)) {
    if (tt < g.ms) {
      const k = g.ms ? tt / g.ms : 1;
      const x = g.x0 + (g.x1 - g.x0) * k;
      const face: 1 | -1 = g.x1 === g.x0 ? (g.k === "turn" ? dir : dir) : g.x1 > g.x0 ? 1 : -1;
      return { x, pose: g.k, face, k, dist: dist + Math.abs(x - g.x0) };
    }
    tt -= g.ms;
    dist += Math.abs(g.x1 - g.x0);
  }
  return { x: target, pose: "work", face: home.face, k: 0, dist };
}

/** The kinds of run in, for the "next open differs" memory. */
export type EntranceKind = "clean" | "trip" | "trip2" | "overshoot" | "trip+overshoot";
export const entranceKind = (plan: EntrancePlan[]): EntranceKind => {
  const trips = plan.reduce((n, p) => n + p.trips.length, 0), over = plan.some((p) => p.overshoot);
  return trips === 0 ? (over ? "overshoot" : "clean") : over ? "trip+overshoot" : plan.some((p) => p.trips.length > 1) ? "trip2" : "trip";
};

/** Scale everyone's pace (trips and turns do not scale) so the whole run in lands between 2.4 and 3.8 s. */
export function fitEntrance(plan: EntrancePlan[], poleX: number, width: number): EntrancePlan[] {
  const base = entranceMs(plan, poleX, width);
  const want = Math.min(3800, Math.max(2400, base));
  if (Math.abs(want - base) < 1) return plan;
  const scaled = (f: number) => plan.map((p) => ({ ...p, speed: p.speed * f }));
  let lo = 0.15, hi = 12;
  for (let k = 0; k < 44; k++) { const mid = (lo + hi) / 2; if (entranceMs(scaled(mid), poleX, width) > want) lo = mid; else hi = mid; }
  return scaled(hi);
}

/** A fresh run in. `kind` picks the flavour; the rest (order, sides, who) is random. */
export function makeEntrance(r: () => number, kind: EntranceKind, poleX: number, width: number): EntrancePlan[] {
  const order = shuffle(r, [...IDS]);
  const delays = [0, 200 + r() * 140, 440 + r() * 200];
  const plan: EntrancePlan[] = order.map((id, i) => ({
    id,
    // Mostly from the side of their spot, sometimes the long way round.
    from: r() < 0.72 ? (HOME[id].spot < 0 ? "left" : "right") : (HOME[id].spot < 0 ? "right" : "left"),
    delay: delays[i],
    speed: HOME[id].speed * (0.9 + r() * 0.2),
    trips: [],
    overshoot: false,
  }));
  const pick = () => plan[Math.floor(r() * plan.length)];
  if (kind === "trip" || kind === "trip+overshoot") pick().trips = [0.3 + r() * 0.3];
  if (kind === "trip2") pick().trips = [0.22 + r() * 0.12, 0.58 + r() * 0.14];
  if (kind === "overshoot" || kind === "trip+overshoot") {
    const free = plan.filter((p) => !p.trips.length);
    (free.length ? free[Math.floor(r() * free.length)] : pick()).overshoot = true;
  }
  return fitEntrance(plan, poleX, width);
}

// ---------- the working beats ----------

export type BeatId = "hit" | "scratch" | "torch" | "pass" | "nap" | "blowback" | "cheer" | "argue" | "hugePick" | "poleFalls";
export interface BeatDef {
  /** Weight in the random pick (0: only when the plan puts it there). */
  w: number;
  /** How long it lasts (ms), picked inside the range. */
  dur: [number, number];
  /** Fine under prefers-reduced-motion (nobody flies, jumps or falls). */
  calm: boolean;
}
export const BEATS: Record<BeatId, BeatDef> = {
  hit: { w: 5, dur: [6500, 9000], calm: true },        // Gus hits the box, Bram scratches, Pip taps
  scratch: { w: 2.4, dur: [4200, 5200], calm: true },  // all three stare at it and scratch their heads
  torch: { w: 2, dur: [5200, 6600], calm: true },      // one holds a torch up while another works
  pass: { w: 2, dur: [4800, 6000], calm: true },       // two pass the wrench back and forth
  nap: { w: 1.6, dur: [8200, 9400], calm: false },     // one naps on the toolbox until another nudges him
  blowback: { w: 1.4, dur: [4600, 5200], calm: false },// a big spark blows one back a few blocks
  cheer: { w: 1.5, dur: [4400, 5000], calm: false },   // the bulb comes on, everyone cheers, it goes out again
  argue: { w: 0, dur: [9000, 10500], calm: true },     // only when the plan has an argument
  hugePick: { w: 0, dur: [5400, 6000], calm: false },  // rare surprise
  poleFalls: { w: 0, dur: [7000, 7600], calm: false }, // rare surprise
};
export const SURPRISES: BeatId[] = ["hugePick", "poleFalls"];

export function weighted<T extends string>(r: () => number, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [it, w] of items) { x -= w; if (x < 0) return it; }
  return items[items.length - 1][0];
}
export function shuffle<T>(r: () => number, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** A random beat from the pool: never `prev`, never a plan-only one, only calm ones under reduced motion. */
export function pickBeat(r: () => number, prev: BeatId | null, reduced: boolean, avoid: BeatId[] = []): BeatId {
  const pool = (Object.keys(BEATS) as BeatId[]).filter((b) => BEATS[b].w > 0 && b !== prev && !avoid.includes(b) && (!reduced || BEATS[b].calm));
  const use = pool.length ? pool : (Object.keys(BEATS) as BeatId[]).filter((b) => BEATS[b].w > 0 && b !== prev);
  return weighted(r, use.map((b) => [b, BEATS[b].w] as [BeatId, number]));
}

/** Who plays which part in a beat: [lead, second, third]. */
export function castFor(r: () => number, beat: BeatId): [WorkerId, WorkerId, WorkerId] {
  const c = shuffle(r, [...IDS]) as [WorkerId, WorkerId, WorkerId];
  // The pickaxe moments belong to whoever has a pickaxe (Gus or Bram).
  if ((beat === "hugePick" || beat === "hit") && c[0] === "pip") [c[0], c[1]] = [c[1], c[0]];
  return c;
}

// ---------- one open ----------

export interface OpenPlan {
  seed: number;
  kind: EntranceKind;
  first: BeatId;
  /** Beat number (1 or 2) where the argument goes, or -1. */
  argueAt: number;
  argueEnd: "makeup" | "stomp";
  surprise: BeatId | null;
  surpriseAt: number;
}

/** What the next open remembers about this one. */
export interface OpenMemo { kind: EntranceKind; first: BeatId; argue: boolean; surprise: BeatId | null }
export const memoOf = (p: OpenPlan): OpenMemo => ({ kind: p.kind, first: p.first, argue: p.argueAt >= 0, surprise: p.surprise });

export const ODDS = { argue: 0.3, surprise: 0.1 } as const;
const KINDS: [EntranceKind, number][] = [["trip", 4], ["clean", 2], ["trip2", 1.5], ["overshoot", 1.8], ["trip+overshoot", 1]];

/**
 * Plan one open. `history` is the last few opens, newest last. The run in and the first beat always differ from the
 * last open's, and the run in from the last two; an argument never two opens running; a surprise at most one open
 * in three (and about one in ten overall).
 */
export function planOpen(seed: number, history: OpenMemo[], reduced = false): OpenPlan {
  const r = rng(seed);
  const last = history[history.length - 1], last2 = history.slice(-2);
  const kinds = KINDS.filter(([k]) => !last2.some((h) => h.kind === k));
  const kind = weighted(r, kinds.length ? kinds : KINDS);
  const first = pickBeat(r, null, reduced, last ? [last.first] : []);
  const argue = !(last && last.argue) && r() < ODDS.argue;
  const recentSurprise = history.slice(-3).some((h) => h.surprise);
  const surprise = !reduced && !recentSurprise && r() < ODDS.surprise / (1 - 3 * ODDS.surprise) /* the 3 open cool down skips some, this lands on 1 in 10 */ ? SURPRISES[Math.floor(r() * SURPRISES.length)] : null;
  const argueAt = argue ? 1 + Math.floor(r() * 2) : -1;
  const surpriseAt = surprise ? (argueAt === 1 ? 2 : argueAt === 2 ? 1 : 1 + Math.floor(r() * 2)) : -1;
  return { seed, kind, first, argueAt, argueEnd: r() < 0.55 ? "makeup" : "stomp", surprise, surpriseAt };
}

/** The beat at position `i` of this open (0 = first), given the one before it. */
export function beatFor(plan: OpenPlan, i: number, prev: BeatId | null, r: () => number, reduced: boolean): BeatId {
  if (i === 0) return plan.first;
  if (i === plan.argueAt) return "argue";
  if (i === plan.surpriseAt && plan.surprise && !reduced) return plan.surprise;
  return pickBeat(r, prev, reduced);
}

export const beatMs = (b: BeatId, r: () => number) => BEATS[b].dur[0] + r() * (BEATS[b].dur[1] - BEATS[b].dur[0]);

// ---------- the memory of the last opens ----------

export const HISTORY_KEY = "ps.mc.opens";
export const HISTORY_MAX = 6;
type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export function readHistory(store: KV | null | undefined): OpenMemo[] {
  try {
    const v = JSON.parse(store?.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(v)) return [];
    return v.filter((h) => h && typeof h.kind === "string" && typeof h.first === "string" && h.first in BEATS).slice(-HISTORY_MAX)
      .map((h) => ({ kind: h.kind, first: h.first, argue: !!h.argue, surprise: h.surprise in BEATS ? h.surprise : null }));
  } catch { return []; }
}
export function pushHistory(store: KV | null | undefined, memo: OpenMemo): OpenMemo[] {
  const h = [...readHistory(store), memo].slice(-HISTORY_MAX);
  try { store?.setItem(HISTORY_KEY, JSON.stringify(h)); } catch { /* forgets, fine */ }
  return h;
}

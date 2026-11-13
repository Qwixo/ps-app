// PS Fitness exercise pictures (V1.40, the developer: "a little diagram of what the machine looks like ... and maybe a
// little animation of a little figure man doing the workout"). ONE shared stick figure rig: a pose is a few
// angles, or a hand or foot target the arm or leg reaches with simple two bone IK, so every exercise is two
// small poses plus its equipment. Pure maths, no DOM, so it is unit tested and the picture costs a few bytes.
// Drawing space: 100 x 90, floor at y 84, the figure faces right in side view.

export type V2 = [number, number];
/** A limb: absolute angles [upper, lower] in degrees (0 = straight down, 90 = forward, 180 = up), or a
 *  target the hand or ankle reaches. `rel: "S"` puts the target relative to the shoulder and turns it with
 *  the torso (a bar on the back, hands behind the head). `b` picks the bend side: elbows +1 (back), knees -1 (front). */
export type Limb = [number, number] | { at: V2; rel?: "S" | "H"; b?: number };

export interface Pose {
  /** Front view (facing the viewer) instead of side view. */
  f?: boolean;
  hip: V2;
  /** Torso angle (side: 180 upright, 90 lying face down head right, -90 lying on the back head left). */
  t: number;
  /** Arm angles turn with the torso (crossed arms, hands at the chest). */
  arel?: boolean;
  arm: Limb; arm2?: Limb;
  leg: Limb; leg2?: Limb;
  /** Foot angles; default straight out from the shin. */
  ft?: number; ft2?: number;
  /** Head tilt, shrug lift, torso length (front view bent over), thigh length (front view seated). */
  hd?: number; up?: number; tl?: number; thl?: number;
  /** Wrist bend for the held weight (wrist curls). */
  wr?: number;
  /** Turns the whole figure about the hip (side plank). */
  rot?: number;
}

export const L = { T: 22, UA: 12.5, FA: 11.5, TH: 15, SH: 15, FT: 5, NECK: 7.2, HEAD: 4.6, SHW: 6.5, HPW: 4 } as const;
export const FLOOR = 84;

const rad = (d: number) => (d * Math.PI) / 180;
export const dir = (a: number, l = 1): V2 => [Math.sin(rad(a)) * l, Math.cos(rad(a)) * l];
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const len = (a: V2) => Math.hypot(a[0], a[1]);
const lerpN = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpV = (a: V2, b: V2, k: number): V2 => [lerpN(a[0], b[0], k), lerpN(a[1], b[1], k)];
const angleOf = (v: V2) => (Math.atan2(v[0], v[1]) * 180) / Math.PI;
const rotV = (v: V2, deg: number): V2 => { const c = Math.cos(rad(deg)), s = Math.sin(rad(deg)); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c]; };

/** Two bone IK: the middle joint for a root, a target and two lengths (`b` picks the side). */
export function ik(root: V2, target: V2, a: number, c: number, b: number): { mid: V2; end: V2 } {
  const d = sub(target, root);
  let dist = len(d);
  if (dist < 1e-6) return { mid: add(root, [0, a]), end: add(root, [0, a - c]) };
  const u: V2 = [d[0] / dist, d[1] / dist];
  const max = a + c - 1e-3, min = Math.abs(a - c) + 1e-3;
  dist = Math.min(max, Math.max(min, dist));
  const cosA = Math.min(1, Math.max(-1, (a * a + dist * dist - c * c) / (2 * a * dist)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const perp: V2 = [-u[1], u[0]];
  const mid = add(root, add(mul(u, a * cosA), mul(perp, a * sinA * b)));
  return { mid, end: add(root, mul(u, dist)) };
}

export interface Joints {
  f: boolean;
  hip: V2; hipL: V2; hipR: V2; neck: V2; head: V2;
  /** Shoulders: near (side view) or screen left (front view), then far / screen right. */
  sh: V2; sh2: V2; el: V2; el2: V2; wr: V2; wr2: V2;
  kn: V2; kn2: V2; an: V2; an2: V2; toe: V2; toe2: V2;
  /** Where a held weight sits (the hand, or a little past it with a wrist bend). */
  grip: V2; grip2: V2;
  /** Torso direction and its front normal, forearm direction (for a dumbbell's angle). */
  td: V2; tn: V2; fa: number; fa2: number;
  /** Upper arm, forearm, thigh, shin directions of the near limbs (muscle marks). */
  dUA: V2; dFA: V2; dTH: V2; dSH: V2;
}

// Front view: angles are "outward" (the screen left limb is mirrored), IK bends mirror on the screen right.
function limb(root: V2, l: Limb, a: number, c: number, defB: number, side: 0 | 1 | 2, anchors: { S: V2; H: V2 }, trot: number, arel: number): { mid: V2; end: V2 } {
  if (Array.isArray(l)) {
    const s = side === 1 ? -1 : 1;
    const mid = add(root, dir((l[0] + arel) * s, a));
    return { mid, end: add(mid, dir((l[1] + arel) * s, c)) };
  }
  const tgt = l.rel ? add(anchors[l.rel], rotV(l.at, -trot)) : l.at;
  return ik(root, tgt, a, c, (l.b ?? defB) * (side === 2 ? -1 : 1));
}

/** Where every joint is for a pose. */
export function solve(p: Pose): Joints {
  const f = !!p.f;
  const H = p.hip;
  const td = dir(p.t);
  const tn: V2 = [-td[1], td[0]];
  const tl = L.T * (p.tl ?? 1);
  const neck = add(H, mul(td, tl));
  const head = add(neck, dir(p.t + (p.hd ?? 0), L.NECK * (f ? Math.max(0.8, p.tl ?? 1) : 1)));
  const shBase = add(neck, mul(td, -2.5 + (p.up ?? 0)));
  const right: V2 = tn;   // front view: screen right of an upright figure
  const sh = f ? add(shBase, mul(right, -L.SHW)) : shBase;
  const sh2 = f ? add(shBase, mul(right, L.SHW)) : shBase;
  const hipL = f ? add(H, mul(right, -L.HPW)) : H;
  const hipR = f ? add(H, mul(right, L.HPW)) : H;
  const trot = p.t - 180;
  const arel = p.arel ? trot : 0;
  const anchors = { S: shBase, H };
  const s1 = f ? 1 : 0, s2 = f ? 2 : 0;
  const A = limb(sh, p.arm, L.UA, L.FA, 1, s1, anchors, trot, arel);
  const A2 = limb(sh2, p.arm2 ?? p.arm, L.UA, L.FA, 1, s2, anchors, trot, arel);
  const thl = L.TH * (p.thl ?? 1);
  const G = limb(hipL, p.leg, thl, L.SH, f ? 1 : -1, s1, anchors, trot, 0);
  const G2 = limb(hipR, p.leg2 ?? p.leg, thl, L.SH, f ? 1 : -1, s2, anchors, trot, 0);
  const shinA = angleOf(sub(G.end, G.mid)), shinA2 = angleOf(sub(G2.end, G2.mid));
  const toe = f ? add(G.end, [-3, 0.5]) : add(G.end, dir(p.ft ?? shinA + 90, L.FT));
  const toe2 = f ? add(G2.end, [3, 0.5]) : add(G2.end, dir(p.ft2 ?? p.ft ?? shinA2 + 90, L.FT));
  const fa = angleOf(sub(A.end, A.mid)), fa2 = angleOf(sub(A2.end, A2.mid));
  const grip = p.wr != null ? add(A.end, dir(fa + p.wr, 2.4)) : A.end;
  const grip2 = p.wr != null ? add(A2.end, dir(fa2 + (f ? -p.wr : p.wr), 2.4)) : A2.end;
  const unit = (a: V2, b: V2): V2 => { const d = sub(b, a); const n = len(d) || 1; return [d[0] / n, d[1] / n]; };
  let j: Joints = {
    f, hip: H, hipL, hipR, neck, head, sh, sh2, el: A.mid, el2: A2.mid, wr: A.end, wr2: A2.end,
    kn: G.mid, kn2: G2.mid, an: G.end, an2: G2.end, toe, toe2, grip, grip2, td, tn, fa, fa2,
    dUA: unit(sh, A.mid), dFA: unit(A.mid, A.end), dTH: unit(hipL, G.mid), dSH: unit(G.mid, G.end),
  };
  if (p.rot) j = rotateJoints(j, H, p.rot);
  return j;
}

function rotateJoints(j: Joints, c: V2, deg: number): Joints {
  const pt = (v: V2): V2 => add(c, rotV(sub(v, c), deg));
  const dv = (v: V2): V2 => rotV(v, deg);
  const out = { ...j } as Joints;
  for (const k of ["hip", "hipL", "hipR", "neck", "head", "sh", "sh2", "el", "el2", "wr", "wr2", "kn", "kn2", "an", "an2", "toe", "toe2", "grip", "grip2"] as const) out[k] = pt(j[k]);
  for (const k of ["td", "tn", "dUA", "dFA", "dTH", "dSH"] as const) out[k] = dv(j[k]);
  out.fa = j.fa + deg; out.fa2 = j.fa2 + deg;
  return out;
}

function lerpLimb(a: Limb, b: Limb, k: number): Limb {
  if (Array.isArray(a) && Array.isArray(b)) return [lerpN(a[0], b[0], k), lerpN(a[1], b[1], k)];
  if (!Array.isArray(a) && !Array.isArray(b)) return { at: lerpV(a.at, b.at, k), rel: a.rel, b: a.b };
  return k < 0.5 ? a : b;
}
const lo = (a: number | undefined, b: number | undefined, k: number, d?: number) => (a == null && b == null ? d : lerpN(a ?? b ?? 0, b ?? a ?? 0, k));

/** A pose between two (k 0 = a, 1 = b). */
export function blend(a: Pose, b: Pose, k: number): Pose {
  return {
    f: a.f, arel: a.arel,
    hip: lerpV(a.hip, b.hip, k), t: lerpN(a.t, b.t, k),
    arm: lerpLimb(a.arm, b.arm, k), arm2: a.arm2 || b.arm2 ? lerpLimb(a.arm2 ?? a.arm, b.arm2 ?? b.arm, k) : undefined,
    leg: lerpLimb(a.leg, b.leg, k), leg2: a.leg2 || b.leg2 ? lerpLimb(a.leg2 ?? a.leg, b.leg2 ?? b.leg, k) : undefined,
    ft: lo(a.ft, b.ft, k), ft2: lo(a.ft2, b.ft2, k), hd: lo(a.hd, b.hd, k), up: lo(a.up, b.up, k),
    tl: lo(a.tl, b.tl, k), thl: lo(a.thl, b.thl, k), wr: lo(a.wr, b.wr, k), rot: lo(a.rot, b.rot, k),
  };
}

/** One rep as time goes round (0 to 1): hold at the start, lift (a bit quicker), hold, lower (slower). */
export function repK(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  if (p < 0.12) return 0;
  if (p < 0.46) return ease((p - 0.12) / 0.34);
  if (p < 0.6) return 1;
  return 1 - ease((p - 0.6) / 0.4);
}

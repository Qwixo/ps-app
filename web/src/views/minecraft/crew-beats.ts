// Minecraft mode crew: the choreography of each working beat. Pure (no DOM): given a beat, a worker and the time
// inside the beat, it says where he stands and how he holds his arms and tools; each beat also carries a list of
// timed cues (a bubble, a grunt, a spark, the bulb) that the painter fires as the clock passes them.
// Every beat starts and ends with everyone at his spot, so any beat can follow any other.
import { SWING, swingAngle } from "./scene-logic.ts";
import { BEATS, HOME, IDS, beatMs, castFor, type BeatId, type OpenPlan, type WorkerId } from "./crew-plan.ts";

export type Tool = "none" | "pick" | "wrench" | "light" | "torch";
export type Voice = "hmm" | "hrrm" | "huh" | "oof" | "grr" | "yay" | "zzz";

/** How one worker looks right now. Angles in degrees: arms 0 = hanging down, 90 = forward, 180 = up. */
export interface Body {
  x: number;
  /** Pixels above the ground (a jump, a flight, lying on the toolbox). */
  lift: number;
  face: 1 | -1;
  legF: number; legB: number;
  armF: number; armB: number;
  toolF: Tool; toolB: Tool;
  bob: number;
  hatUp: number;
  hatOff: boolean;
  shocked: boolean;
  headDx: number;
  /** Whole body lean around the feet: + falls forward, - falls back. */
  tilt: number;
}

export type Fx = "hit" | "zapHit" | "tap" | "bigspark" | "bolt" | "bulbOn" | "bulbAuto" | "bulbPop" | "thud" | "dust" | "bighit";
export interface Cue { at: number; who?: WorkerId | "box"; say?: string; voice?: Voice; vol?: number; fx?: Fx }

export interface World { poleX: number; W: number; gy: number; /** Toolbox centre, or null when the panel is too narrow for one. */ toolbox: number | null }

export interface Beat {
  id: BeatId;
  dur: number;
  cast: [WorkerId, WorkerId, WorkerId];
  cues: Cue[];
  reduced: boolean;
  /** Beat specific numbers (meeting point, bed, timings), worked out once when the beat starts. */
  n: Record<string, number>;
  end: "makeup" | "stomp";
}

export const WALK = 46; // px a second
const home = (w: World, id: WorkerId) => w.poleX + HOME[id].spot;
const ease = (x: number) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };
const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.max(0, Math.min(1, k));
const walkMs = (a: number, b: number, speed = WALK) => (Math.abs(b - a) / speed) * 1000;

/** The resting look of each worker: Gus carries the pickaxe, Bram has his on his shoulder, Pip has the wrench. */
export function base(w: World, id: WorkerId): Body {
  const b: Body = { x: home(w, id), lift: 0, face: HOME[id].face, legF: 14, legB: -10, armF: 40, armB: 20, toolF: "none", toolB: "none", bob: 0, hatUp: 0, hatOff: false, shocked: false, headDx: 0, tilt: 0 };
  if (id === "gus") b.toolF = "pick";
  if (id === "bram") { b.toolB = "pick"; b.armB = 150; b.armF = 30; }
  if (id === "pip") { b.toolF = "wrench"; b.armF = 45; }
  return b;
}

/** Walk along keyframes [time, x]: position, and the legs move while x changes. */
function track(b: Body, keys: [number, number][], lt: number) {
  let x = keys[0][1], moving = 0;
  for (let i = 1; i < keys.length; i++) {
    const [t0, x0] = keys[i - 1], [t1, x1] = keys[i];
    if (lt >= t1) { x = x1; continue; }
    if (lt > t0) { const k = (lt - t0) / Math.max(1, t1 - t0); x = x0 + (x1 - x0) * k; moving = Math.sign(x1 - x0); }
    break;
  }
  b.x = x;
  if (moving) { const s = Math.sin(x / 3.2); b.legF = s * 30; b.legB = -s * 30; b.bob = Math.abs(Math.cos(x / 3.2)) > 0.8 ? 1 : 0; b.face = moving as 1 | -1; }
  return moving;
}
const scratch = (b: Body, lt: number) => {
  if (b.toolF !== "none") { b.toolB = b.toolF; b.toolF = "none"; b.armB = 150; }
  b.armF = 196 + Math.sin(lt / 55) * 9; b.headDx = Math.floor(lt / 600) % 2 ? 0 : -1;
};
const tapPose = (b: Body, lt: number, period = 760) => {
  const p = (((lt % period) + period) % period) / period;
  b.armF = p < 0.25 ? 95 - p * 4 * 50 : 45 + Math.min(1, (p - 0.25) / 0.5) * 50;
};
const facePole = (w: World, b: Body) => { b.face = b.x < w.poleX ? 1 : -1; };

// ---------- making a beat ----------

export function makeBeat(id: BeatId, r: () => number, w: World, plan: OpenPlan | null, reduced: boolean): Beat {
  const cast = castFor(r, id);
  const cues: Cue[] = [];
  const n: Record<string, number> = {};
  let dur = beatMs(id, r);
  const say = (at: number, who: Cue["who"], text: string, voice?: Voice, vol?: number) => cues.push({ at, who, say: text, voice, vol });
  const fx = (at: number, f: Fx, who?: Cue["who"]) => cues.push({ at, fx: f, who });
  const H = (id2: WorkerId) => home(w, id2);
  /** A few low key grunts across a calm beat (every 3 to 7 s), questioning or thoughtful. */
  const murmur = (from: number, to: number, who: WorkerId[] = IDS) => {
    for (let t = from + 900 + r() * 1800; t < to - 600; t += 3000 + r() * 4000) {
      const k = who[Math.floor(r() * who.length)];
      const v = (["hmm", "hmm", "huh", "hrrm"] as Voice[])[Math.floor(r() * 4)];
      say(t, k, v === "hmm" ? "HMM" : v === "huh" ? "HUH?" : "HRRM", v, 0.8);
    }
  };

  switch (id) {
    case "hit": {
      // Gus swings at the box; every few strikes the box bites back. Pip taps the meter, Bram wonders.
      n.zapEvery = 4 + Math.floor(r() * 3);
      n.offset = Math.floor(r() * n.zapEvery);
      let k = 0;
      for (let t = SWING.hit * SWING.period; t < dur - 300; t += SWING.period, k++) fx(t, (k + n.offset) % n.zapEvery === n.zapEvery - 1 ? "zapHit" : "hit", "gus");
      for (let t = 760; t < dur - 200; t += 760) fx(t, "tap", "pip");
      say(500, "bram", "?");
      murmur(0, dur);
      break;
    }
    case "scratch": {
      const order = cast;
      say(300, order[0], "HMM", "hmm");
      say(1400, order[1], "?");
      say(2500, order[2], "HUH?", "huh", 0.8);
      say(dur - 1100, order[0], "...");
      break;
    }
    case "torch": {
      // cast[0] holds a torch up to the box, cast[1] works on it, cast[2] watches.
      for (let t = 600; t < dur - 300; t += 620) fx(t, "tap", cast[1]);
      say(400, cast[0], "!");
      say(dur * 0.55, cast[2], "HMM", "hmm", 0.8);
      break;
    }
    case "pass": {
      // cast[0] and cast[1] throw the wrench back and forth; each catch clinks.
      n.throws = 3 + Math.floor(r() * 2);
      n.flight = 650; n.hold = 450;
      dur = Math.max(dur, 400 + n.throws * (n.flight + n.hold) + 400);
      for (let i = 0; i < n.throws; i++) fx(400 + i * (n.flight + n.hold) + n.flight, "tap", i % 2 ? cast[0] : cast[1]);
      say(300, cast[0], "HUP");
      say(400 + (n.throws - 1) * (n.flight + n.hold) + n.flight + 150, i2(cast, n.throws), "HMM", "hmm", 0.7);
      if (cast[2] === "gus") for (let t = SWING.hit * SWING.period; t < dur - 300; t += SWING.period) fx(t, "hit", "gus");
      break;
    }
    case "nap": {
      const napper = cast[0], nudger = cast[1];
      const bed = w.toolbox ?? H(napper) - 16;
      n.bed = bed;
      n.tLie = walkMs(H(napper), bed + 10);
      n.tNudgeGo = n.tLie + 3600;
      const side = Math.sign(H(nudger) - bed) || 1;
      n.side = side;
      n.nudgeX = bed + side * 22;
      n.tPoke = n.tNudgeGo + walkMs(H(nudger), n.nudgeX);
      n.tUp = n.tPoke + 450;
      n.tBack = n.tPoke + 900;
      dur = Math.max(dur, n.tBack + Math.max(walkMs(bed + 10, H(napper)), walkMs(n.nudgeX, H(nudger))) + 400);
      say(150, napper, "HRRM", "hrrm", 0.7);
      for (let t = n.tLie + 500, i = 0; t < n.tPoke - 200; t += 1300, i++) say(t, napper, ["Z", "ZZ", "ZZZ"][i % 3], i === 0 ? "zzz" : undefined, 0.6);
      say(n.tPoke + 380, napper, "!", "huh");
      say(n.tBack + 200, nudger, "HRRM", "grr", 0.7);
      if (cast[2] === "gus") for (let t = SWING.hit * SWING.period; t < dur - 300; t += SWING.period) fx(t, "hit", "gus");
      break;
    }
    case "blowback": {
      const v = cast[0];
      n.dir = H(v) < w.poleX ? -1 : 1;
      fx(300, "bolt", v); fx(300, "bigspark", "box");
      say(320, "box", "ZAP!");
      say(860, v, "OOF", "oof");
      fx(860, "dust", v);
      say(500, cast[1], "!");
      say(2300, v, "HRRM", "grr", 0.8);
      say(2800, cast[2], "HUH?", "huh", 0.6);
      n.tBack = 2300;
      dur = Math.max(dur, n.tBack + walkMs(H(v) + n.dir * 34, H(v)) + 400);
      break;
    }
    case "cheer": {
      fx(0, "bulbOn");
      say(150, cast[0], "!");
      say(550, cast[1], "YAY!", "yay");
      say(1000, cast[2], "YAY!", "yay", 0.7);
      n.pop = 2900;
      fx(n.pop, "bulbPop");
      say(n.pop + 400, cast[1], "...");
      say(n.pop + 900, cast[2], "HRRM", "grr", 0.7);
      fx(dur - 50, "bulbAuto");
      break;
    }
    case "argue": {
      // Two of them face off; the third quietly fixes it while they shout.
      const [x, y] = [cast[0], cast[1]].sort((a, b) => H(a) - H(b)) as [WorkerId, WorkerId];
      cast[0] = x; cast[1] = y;
      n.M = Math.max(26, Math.min(w.W - 40, w.poleX - 86)); // left of the toolbox, clear of the box and the crew
      n.ax = reduced ? H(x) : n.M - 9; n.bx = reduced ? H(y) : n.M + 9;
      n.tMeet = reduced ? 300 : Math.max(walkMs(H(x), n.ax), walkMs(H(y), n.bx)) + 150;
      const SYM = ["!?", "#@!", "~", "!!", "?!", "@#!", "~!", "#!"];
      let t = n.tMeet + 200, who = 0, i = 0;
      n.tShout = t;
      for (; i < 8; i++, t += 640, who ^= 1) say(t, who ? y : x, SYM[Math.floor(r() * SYM.length)], i % 2 === 0 ? "grr" : undefined, 0.6);
      n.tShoutEnd = t;
      const third = cast[2];
      for (let tt = n.tMeet; tt < n.tShoutEnd; tt += 700) fx(tt, "tap", third);
      fx(n.tShoutEnd - 300, "bulbOn");
      say(n.tShoutEnd - 250, third, "!", "yay", 0.6);
      n.stomp = reduced ? 0 : (plan?.argueEnd ?? (r() < 0.5 ? "makeup" : "stomp")) === "stomp" ? 1 : 0;
      if (!n.stomp) {
        say(n.tShoutEnd + 200, x, "...");
        say(n.tShoutEnd + 500, y, "...");
        say(n.tShoutEnd + 1100, x, "<");
        say(n.tShoutEnd + 1300, y, "<", "hmm", 0.6);
        n.tHome = n.tShoutEnd + 1900;
        dur = n.tHome + Math.max(walkMs(n.ax, H(x)), walkMs(n.bx, H(y))) + 500;
      } else {
        // The one nearest an edge stomps off, comes back sheepish.
        n.off = n.ax < w.W - n.bx ? 0 : 1; // 0: x goes left, 1: y goes right
        const leaver = n.off ? y : x, from = n.off ? n.bx : n.ax, edge = n.off ? w.W + 20 : -20;
        say(n.tShoutEnd + 150, leaver, "HRRM", "grr", 0.8);
        n.tGo = n.tShoutEnd + 500;
        n.tGone = n.tGo + walkMs(from, edge, 62);
        n.tReturn = n.tGone + 1300;
        n.tBackHome = n.tReturn + walkMs(edge, H(leaver), 58);
        say(n.tGo + 400, n.off ? x : y, "?");
        say(n.tBackHome - 200, leaver, "...", "hmm", 0.6);
        n.tHome = n.tShoutEnd + 900;
        dur = Math.max(n.tBackHome + 500, n.tHome + walkMs(n.off ? n.ax : n.bx, H(n.off ? x : y)) + 500);
      }
      fx(dur - 50, "bulbAuto");
      break;
    }
    case "hugePick": {
      const hero = cast[0];
      say(0, hero, "!");
      say(500, cast[1], "?");
      say(950, hero, "HRRM", "hrrm");
      n.tSmash = 2450;
      fx(n.tSmash, "bighit", "box"); fx(n.tSmash, "bulbOn");
      say(n.tSmash + 80, "box", "ZAP!");
      say(n.tSmash + 600, cast[1], "!!");
      say(n.tSmash + 1000, cast[2], "YAY!", "yay", 0.7);
      say(n.tSmash + 1600, hero, "HMM", "hmm");
      fx(n.tSmash + 1500, "bulbPop");
      fx(dur - 50, "bulbAuto");
      break;
    }
    case "poleFalls": {
      n.tFall = 700; n.tThud = 1500; n.tGather = 2700; n.tLift = 3600; n.tUp = 5800;
      say(200, cast[0], "?");
      say(560, "pip", "!", "huh");
      fx(n.tThud, "thud");
      say(n.tThud + 60, cast[1], "!!");
      say(n.tThud + 400, cast[2], "...");
      say(n.tLift + 200, cast[0], "HRRM", "grr", 0.8);
      say(n.tLift + 1200, cast[1], "HRRM", "grr", 0.8);
      say(n.tUp + 100, cast[2], "YAY!", "yay", 0.7);
      n.tHome = n.tUp + 300;
      dur = Math.max(dur, n.tHome + Math.max(...IDS.map((k) => walkMs(liftSpot(w, k), H(k)))) + 400);
      break;
    }
  }
  cues.sort((a, b) => a.at - b.at);
  return { id, dur, cast, cues, reduced, n, end: plan?.argueEnd ?? "makeup" };
}
const i2 = (cast: [WorkerId, WorkerId, WorkerId], throws: number) => (throws % 2 ? cast[1] : cast[0]);
/** Where each one stands to lift the fallen pole (to the right of its foot, under it). */
const liftSpot = (w: World, id: WorkerId) => w.poleX + ({ gus: 14, bram: 26, pip: 38 } as const)[id];

// ---------- the world during a beat ----------

export interface WorldNow {
  poleAngle: number;
  shake: number;
  /** The huge pickaxe: whose, how grown (0..1), its angle. */
  huge: { who: WorkerId; scale: number; angle: number } | null;
  /** The wrench in the air. */
  flying: { x: number; y: number; spin: number } | null;
  /** The blown off hat on the ground (or in the air). */
  hat: { who: WorkerId; x: number; lift: number } | null;
}

export function worldIn(b: Beat, lt: number, w: World): WorldNow {
  const out: WorldNow = { poleAngle: 0, shake: 0, huge: null, flying: null, hat: null };
  const n = b.n;
  if (b.id === "poleFalls") {
    if (lt < n.tFall) out.poleAngle = Math.sin(lt / 70) * 3 * (lt / n.tFall);
    else if (lt < n.tThud) { const k = (lt - n.tFall) / (n.tThud - n.tFall); out.poleAngle = 82 * k * k; }
    else if (lt < n.tLift) out.poleAngle = 82 - (lt - n.tThud < 160 ? Math.sin(((lt - n.tThud) / 160) * Math.PI) * 5 : 0);
    else out.poleAngle = 82 * (1 - ease((lt - n.tLift) / (n.tUp - n.tLift)));
    if (lt >= n.tThud && lt < n.tThud + 260) out.shake = 1;
  }
  if (b.id === "hugePick") {
    const hero = b.cast[0];
    const scale = lt < 700 ? ease(lt / 700) : lt < n.tSmash + 2000 ? 1 : 1 - ease((lt - n.tSmash - 2000) / 800);
    out.huge = { who: hero, scale: Math.max(0, scale), angle: hugeAngle(lt, n.tSmash) };
    if (lt >= n.tSmash && lt < n.tSmash + 380) out.shake = 1;
  }
  if (b.id === "pass") {
    const [a, c] = [b.cast[0], b.cast[1]];
    const cyc = n.flight + n.hold;
    const tt = lt - 400;
    if (tt >= 0 && tt < n.throws * cyc) {
      const i = Math.floor(tt / cyc), k = (tt - i * cyc) / n.flight;
      if (k < 1) {
        const from = i % 2 ? c : a, to = i % 2 ? a : c;
        const hx = (id: WorkerId) => home(w, id) + (home(w, id) < home(w, i % 2 ? a : c) ? 4 : -4);
        const x0 = hx(from), x1 = hx(to);
        out.flying = { x: lerp(x0, x1, k), y: w.gy - 16 - Math.sin(k * Math.PI) * 18, spin: k * 720 };
      }
    }
  }
  if (b.id === "blowback") {
    const v = b.cast[0], H0 = home(w, v), dir = n.dir;
    if (lt >= 300) {
      const k = Math.min(1, (lt - 300) / 520);
      const pickedUp = lt > n.tBack && (lt - n.tBack) / walkMs(H0 + dir * 34, H0) > 0.72;
      if (!pickedUp) out.hat = { who: v, x: H0 + dir * 12 * k, lift: Math.max(0, Math.sin(k * Math.PI) * 22) + 23 * (1 - k) * (k < 0.08 ? 1 : 0) };
    }
  }
  return out;
}

function hugeAngle(lt: number, tSmash: number) {
  if (lt < 700) return 40;
  if (lt < tSmash - 250) return 40 + (215 - 40) * ease((lt - 700) / (tSmash - 250 - 700));
  if (lt < tSmash) return 215 - (215 - 64) * ((lt - (tSmash - 250)) / 250) ** 1.5; // down onto the ground by the pole
  if (lt < tSmash + 2000) return 64;
  return 64 - (64 - 40) * ease((lt - tSmash - 2000) / 800);
}

// ---------- each worker during a beat ----------

export function poseIn(b: Beat, id: WorkerId, lt: number, w: World): Body {
  const p = base(w, id);
  const n = b.n, H0 = home(w, id);
  const [c0, c1, c2] = b.cast;
  const calmIdle = () => { p.headDx = Math.floor((lt + H0 * 37) / 2600) % 3 === 0 ? -1 : 0; };
  switch (b.id) {
    case "hit": {
      if (id === "gus") { const ph = ((lt % SWING.period) + SWING.period) % SWING.period / SWING.period; p.armF = swingAngle(ph); p.armB = 25 + (ph > 0.45 && ph < 0.65 ? 30 : 0); }
      else if (id === "pip") tapPose(p, lt);
      else { const c = (lt % 4200) / 4200; if (c < 0.6) scratch(p, lt); else p.armF = c < 0.68 ? 196 - ((c - 0.6) / 0.08) * 156 : 40; }
      break;
    }
    case "scratch": {
      const off = id === c0 ? 0 : id === c1 ? 700 : 1400;
      if (lt > off && lt < b.dur - 900) scratch(p, lt - off);
      else if (lt >= b.dur - 900 && id === c0) { p.armF = 120; p.armB = 120; p.bob = lt % 400 < 200 ? 1 : 0; } // the shrug
      else calmIdle();
      break;
    }
    case "torch": {
      if (id === c0) { if (p.toolF !== "none") { p.toolB = p.toolF; p.armB = 150; } p.toolF = "torch"; p.armF = 150 + Math.sin(lt / 400) * 6; facePole(w, p); }
      else if (id === c1) { if (id === "gus") { const ph = (lt % 620) / 620; p.armF = 80 + Math.sin(ph * Math.PI * 2) * 18; } else tapPose(p, lt, 620); }
      else if (lt > b.dur * 0.5 && lt < b.dur * 0.5 + 2600) scratch(p, lt); else calmIdle();
      break;
    }
    case "pass": {
      const a = c0, c = c1;
      if (id === a || id === c) {
        const other = id === a ? c : a;
        const cyc = n.flight + n.hold, tt = lt - 400;
        p.face = tt >= n.throws * cyc + 150 ? HOME[id].face : home(w, other) > H0 ? 1 : -1;
        if (p.toolF !== "none") { p.toolB = p.toolF; p.armB = 150; p.toolF = "none"; }
        const i = Math.floor(tt / cyc), k = (tt - i * cyc) / n.flight;
        const thrower = i % 2 ? c : a;
        if (tt < 0) p.armF = id === a ? 90 : 60;
        else if (i >= n.throws) p.armF = 40;
        else if (k < 1) p.armF = id === thrower ? lerp(140, 60, k * 3) : 95;
        else p.armF = id === thrower ? 60 : 95;
        // The one holding it between throws shows the wrench in his hand.
        const holding = tt < 0 ? a : i >= n.throws ? (n.throws % 2 ? c : a) : k >= 1 ? (i % 2 ? a : c) : null;
        if (holding === id) p.toolF = "wrench";
        if (id === "pip" && holding !== "pip") p.toolF = "none";
      } else if (id === "gus") { const ph = ((lt % SWING.period) + SWING.period) % SWING.period / SWING.period; p.armF = swingAngle(ph); }
      else if (id === "pip") tapPose(p, lt); else calmIdle();
      break;
    }
    case "nap": {
      if (id === c0) {
        const bed = n.bed;
        if (lt < n.tLie) track(p, [[0, H0], [n.tLie, bed + 10]], lt);
        else if (lt < n.tUp) {
          // Lie down on his back on the toolbox, then sleep, chest going up and down.
          const k = Math.min(1, (lt - n.tLie) / 300);
          p.face = 1; p.x = bed + 10; p.tilt = -88 * ease(k); p.lift = w.toolbox !== null ? 6 * k : 0;
          p.armF = 10; p.armB = 0; p.legF = 0; p.legB = 0; p.bob = Math.floor(lt / 700) % 2;
          if (lt > n.tPoke + 300) { p.shocked = true; p.hatUp = 2; }
        } else if (lt < n.tBack) {
          const k = Math.min(1, (lt - n.tUp) / 200);
          p.face = 1; p.x = bed + 10; p.tilt = -88 * (1 - k); p.lift = (w.toolbox !== null ? 6 : 0) * (1 - k) + Math.sin(k * Math.PI) * 5; p.shocked = true; p.armF = 170; p.armB = 170;
        } else track(p, [[n.tBack, bed + 10], [n.tBack + walkMs(bed + 10, H0), H0]], lt);
        if (lt >= n.tBack + walkMs(bed + 10, H0)) p.face = HOME[id].face;
      } else if (id === c1) {
        if (lt < n.tPoke) { track(p, [[0, H0], [n.tNudgeGo, H0], [n.tPoke, n.nudgeX]], lt); if (lt < n.tNudgeGo) calmIdle(); }
        else if (lt < n.tBack) { p.x = n.nudgeX; p.face = (n.bed + 10 > n.nudgeX ? 1 : -1); p.armF = 80 + Math.abs(Math.sin(((lt - n.tPoke) / 220) * Math.PI)) * 30; }
        else { track(p, [[n.tBack, n.nudgeX], [n.tBack + walkMs(n.nudgeX, H0), H0]], lt); if (lt >= n.tBack + walkMs(n.nudgeX, H0)) p.face = HOME[id].face; }
      } else if (id === "gus") { const ph = ((lt % SWING.period) + SWING.period) % SWING.period / SWING.period; p.armF = swingAngle(ph); }
      else if (id === "pip") tapPose(p, lt); else calmIdle();
      break;
    }
    case "blowback": {
      if (id === c0) {
        const dir = n.dir;
        if (lt < 300) { p.armF = 95; }
        else if (lt < 820) {
          const k = (lt - 300) / 520;
          p.x = H0 + dir * 34 * ease(k); p.lift = Math.sin(k * Math.PI) * 14; p.tilt = -88 * k; p.shocked = true; p.armF = 170; p.armB = 190; p.legF = 40; p.legB = -30; p.hatOff = true;
        } else if (lt < 1900) { p.x = H0 + dir * 34; p.tilt = -88; p.shocked = lt < 1300; p.armF = 160; p.armB = 120; p.legF = 10; p.hatOff = true; }
        else if (lt < n.tBack) { const k = (lt - 1900) / (n.tBack - 1900); p.x = H0 + dir * 34; p.tilt = -88 * (1 - ease(k)); p.hatOff = true; }
        else {
          const tw = walkMs(H0 + dir * 34, H0);
          track(p, [[n.tBack, H0 + dir * 34], [n.tBack + tw, H0]], lt);
          p.hatOff = (lt - n.tBack) / tw <= 0.72;
          if (lt >= n.tBack + tw) p.face = HOME[id].face; else p.face = (-dir) as 1 | -1;
        }
        if (lt >= n.tBack && lt < n.tBack + 10) p.face = (-dir) as 1 | -1;
      } else {
        if (lt > 300 && lt < 900) { p.shocked = true; p.hatUp = lt < 600 ? 2 : 1; p.bob = 1; }
        if (id === "pip" && lt > 1200) tapPose(p, lt); else calmIdle();
      }
      break;
    }
    case "cheer": {
      const off = id === c0 ? 0 : id === c1 ? 120 : 240;
      if (lt > 250 && lt < n.pop) {
        if (!b.reduced) p.lift = Math.abs(Math.sin((lt - off) / 170)) * 5;
        if (p.toolF !== "none") { p.toolB = p.toolF; p.toolF = "none"; }
        p.armF = 178 + Math.sin(lt / 90) * 6; p.armB = 186; p.legF = 20; p.legB = -20;
      } else if (lt >= n.pop && lt < n.pop + 300) { p.shocked = true; p.hatUp = 1; }
      else if (lt >= n.pop + 300 && lt < b.dur - 300) { p.armF = 10; p.armB = 5; p.headDx = -1; p.bob = 1; } // the slump
      break;
    }
    case "argue": {
      const [x, y, third] = [c0, c1, c2];
      if (id === x || id === y) {
        const spot = id === x ? n.ax : n.bx;
        const meet: [number, number][] = [[0, H0], [n.tMeet, spot]];
        const leaver = n.stomp ? (n.off ? y : x) : null;
        if (lt < n.tShoutEnd) {
          if (!track(p, meet, lt) && lt >= n.tMeet) {
            p.face = id === x ? 1 : -1;
            if (p.toolF !== "none") { p.toolB = p.toolF; p.toolF = "none"; p.armB = 150; }
            const i = Math.floor((lt - n.tShout) / 640), speaking = lt >= n.tShout && (i % 2 === 0) === (id === x);
            if (speaking && !b.reduced) { p.armF = 130 + Math.sin(lt / 60) * 45; p.bob = Math.floor(lt / 120) % 2; p.legF = 14 + (Math.floor(lt / 240) % 2) * 16; }
            else { p.armF = 70; p.armB = 70; } // arms folded, waiting for his turn
          }
        } else if (!n.stomp) {
          p.x = spot; p.face = id === x ? 1 : -1;
          if (p.toolF !== "none") { p.toolB = p.toolF; p.toolF = "none"; p.armB = 150; }
          if (lt > n.tShoutEnd + 1000 && lt < n.tHome) { p.lift = Math.abs(Math.sin((lt - n.tShoutEnd) / 140)) * 2; p.armF = 120; }
          if (lt >= n.tHome) { track(p, [[n.tHome, spot], [n.tHome + walkMs(spot, H0), H0]], lt); if (lt >= n.tHome + walkMs(spot, H0)) p.face = HOME[id].face; }
        } else if (id === leaver) {
          const edge = n.off ? w.W + 20 : -20;
          if (lt < n.tGo) { p.x = spot; p.face = id === x ? 1 : -1; p.armF = 20; p.headDx = -1; }
          else { track(p, [[n.tGo, spot], [n.tGone, edge], [n.tReturn, edge], [n.tBackHome, H0]], lt); if (lt >= n.tGone && lt < n.tReturn) p.x = edge; if (lt >= n.tBackHome) p.face = HOME[id].face; else if (lt > n.tReturn) p.headDx = -1; }
        } else {
          if (lt < n.tHome) { p.x = spot; p.face = (n.off ? 1 : -1); p.armF = 30; }
          else { track(p, [[n.tHome, spot], [n.tHome + walkMs(spot, H0), H0]], lt); if (lt >= n.tHome + walkMs(spot, H0)) p.face = HOME[id].face; }
        }
      } else if (id === third) {
        // Quietly fixing it while they shout.
        if (id === "gus") { const ph = (lt % 700) / 700; p.armF = 82 + Math.sin(ph * Math.PI * 2) * 14; }
        else if (id === "pip") tapPose(p, lt, 700);
        else { p.face = 1; p.armF = 82 + Math.sin(lt / 110) * 14; }
        if (lt > n.tShoutEnd - 250 && lt < n.tShoutEnd + 600) { p.lift = b.reduced ? 0 : Math.abs(Math.sin((lt - n.tShoutEnd) / 120)) * 3; p.armF = 175; }
      }
      break;
    }
    case "hugePick": {
      const hero = c0;
      if (id === hero) {
        p.toolF = "none"; p.toolB = "none";
        p.armF = hugeAngle(lt, n.tSmash); p.armB = 40;
        if (lt >= n.tSmash && lt < n.tSmash + 300) p.shocked = true;
      } else {
        p.face = home(w, hero) > H0 ? 1 : -1;
        if (lt >= n.tSmash && lt < n.tSmash + 700) { p.shocked = true; p.hatUp = lt < n.tSmash + 300 ? 3 : 1; p.lift = Math.max(0, Math.sin(((lt - n.tSmash) / 300) * Math.PI) * 3); }
        if (lt > b.dur - 600) p.face = HOME[id].face;
      }
      break;
    }
    case "poleFalls": {
      const spot = liftSpot(w, id);
      if (id === "pip" && lt > 560 && lt < n.tGather) {
        // Dives out of the way to the left.
        track(p, [[560, H0], [1000, w.poleX - 34]], lt); if (lt >= 1000) { p.face = 1; p.shocked = lt < n.tThud + 500; }
      }
      if (lt >= n.tThud && lt < n.tThud + 600 && id !== "pip") { p.shocked = true; p.hatUp = 2; }
      const from = id === "pip" ? w.poleX - 34 : H0;
      if (lt >= n.tGather && lt < n.tLift) track(p, [[n.tGather, from], [n.tLift - 100, spot]], lt);
      if (lt >= n.tLift - 100 && lt < n.tHome) { p.x = spot; p.face = 1; if (p.toolF !== "none") { p.toolB = p.toolF; p.toolF = "none"; } p.armF = 165 + Math.sin(lt / 90) * 3; p.armB = 165; p.legF = 24; p.legB = -18; }
      if (lt >= n.tHome) { track(p, [[n.tHome, spot], [n.tHome + walkMs(spot, H0), H0]], lt); if (lt >= n.tHome + walkMs(spot, H0)) p.face = HOME[id].face; }
      break;
    }
  }
  return p;
}

// PS Fitness exercise pictures: every library exercise as a start pose, an end pose and its equipment, drawn
// by the one rig in pic-rig.ts. About 50 movement patterns cover all 153 exercises; the equipment (barbell,
// dumbbell, cable, machine, smith...) comes from the library, so "Incline dumbbell press" and "Smith machine
// incline press" share one pattern. Names PS does not know are matched to a close library exercise, then to a
// rough guess by key words ("pull down", "curl"), else a neutral placeholder. Pure: no DOM, unit tested.
import { getExercise, matchExercise } from "./library.ts";
import type { Equipment, Exercise, Muscle } from "./types.ts";
import { blend, solve, FLOOR as FL, type Limb, type Pose, type V2 } from "./pic-rig.ts";

/** Static equipment: frame line, cushion, weight stack, pulley or bar end, box, smith rail. */
export type Prim = ["l" | "pad" | "rail", number, number, number, number] | ["stack" | "box", number, number, number, number] | ["c", number, number, number];
export type Hold = "bar" | "db" | "kb" | "plate" | "handle" | "rope" | "none";
export type Spot = "grip" | "nape" | "rack" | "hip" | "chest" | "an" | "kn" | "el" | "sh" | "toe";

export interface Scene {
  a: Pose;
  b: Pose;
  eq: Prim[];
  hold?: Hold;
  /** Where the weight sits (default the hands). */
  at?: Spot;
  /** Front view: a bar spans both hands; side view: draw the weight at the far hand too. */
  two?: boolean;
  /** Cable from a pulley to a spot (default the grip). */
  cable?: V2; cableTo?: Spot; cable2?: V2;
  /** A machine arm from a pivot to a spot. */
  lever?: { p: V2; to: Spot };
  /** A pad or platform riding on a spot, at an angle, this long. */
  plat?: { at: Spot; ang: number; len: number; off?: number };
  /** A wheel under the hands (ab wheel). */
  wheel?: boolean;
  /** A hold (plank): the loop breathes instead of doing reps. */
  hold2?: boolean;
}

// ---------- building blocks ----------
type P = Partial<Pose>;
const side = (o: P): Pose => ({ hip: [50, 54.5], t: 180, arm: [0, 0], leg: { at: [50, FL] }, ...o });
const front = (o: P): Pose => ({ f: true, hip: [50, 54.5], t: 180, arm: [6, 4], leg: { at: [45, FL] }, leg2: { at: [55, FL] }, ...o });
const at = (x: number, y: number, b?: number): Limb => (b == null ? { at: [x, y] } : { at: [x, y], b });
const relS = (x: number, y: number, b?: number): Limb => ({ at: [x, y], rel: "S", ...(b == null ? {} : { b }) });

const flatBench = (y = 60.5, x1 = 22, x2 = 66): Prim[] => [["pad", x1, y, x2, y], ["l", x1 + 5, y + 1.6, x1 + 5, FL], ["l", x2 - 5, y + 1.6, x2 - 5, FL]];
const tower = (x: number, py: number, top = 8): Prim[] => [["l", x, top, x, FL], ["stack", x + (x > 50 ? 1.5 : -9.5), 52, 8, 26], ["c", x, py, 1.8]];
const rails = (x: number): Prim[] => [["rail", x - 2.5, 8, x - 2.5, FL], ["rail", x + 2.5, 8, x + 2.5, FL]];
const seatUp = (hx: number, hy: number, back = true): Prim[] => [
  ["pad", hx - 8, hy + 3.5, hx + 7, hy + 3.5], ["l", hx, hy + 5, hx, FL],
  ...(back ? ([["pad", hx - 4.5, hy + 2, hx - 6.5, hy - 22]] as Prim[]) : []),
];
const bar = (x1: number, y: number, x2: number): Prim => ["l", x1, y, x2, y];
const holdFor = (e: Equipment): Hold =>
  e === "barbell" || e === "ezbar" || e === "trapbar" || e === "smith" ? "bar" : e === "dumbbell" ? "db" : e === "kettlebell" ? "kb"
    : e === "plate" ? "plate" : e === "cable" || e === "machine" ? "handle" : "none";

interface Ctx { e: Equipment; v: string }
type Make = (c: Ctx) => Scene;

// ---------- the patterns ----------
const PAT: Record<string, Make> = {
  // Chest
  bench: ({ e, v }) => {
    const sm = e === "smith";
    if (v === "incline") {
      const a = side({ hip: [62, 62], t: -125, arm: at(sm ? 47 : 50, 46), leg: { at: [78, FL] } });
      return { a, b: { ...a, arm: at(47, 27) }, eq: [["pad", 60.3, 65, 39, 50], ["pad", 58, 65.3, 72, 65.3], ["l", 56, 66.5, 56, FL], ["l", 44, 54, 44, FL], ...(sm ? rails(47) : [])], hold: holdFor(e) };
    }
    if (v === "decline") {
      const a = side({ hip: [60, 55], t: -75, arm: at(45, 53), leg: { at: [74, 72] }, ft: 160 });
      return { a, b: { ...a, arm: at(43, 37) }, eq: [["pad", 61, 58, 30, 66.6], ["l", 52, 61, 52, FL], ["l", 34, 66, 34, FL], ["pad", 70, 76, 78, 76], ["l", 72, 77, 64, FL]], hold: holdFor(e) };
    }
    if (v === "floor") {
      const a = side({ hip: [60, 80.5], t: -90, arm: at(45, 74), leg: { at: [74, FL] } });
      return { a, b: { ...a, arm: at(41, 57) }, eq: [], hold: holdFor(e) };
    }
    const a = side({ hip: [60, 57], t: -90, arm: at(sm ? 47 : 49, 51.5), leg: { at: [73, FL] } });
    return { a, b: { ...a, arm: at(sm ? 47 : 42, 33.5) }, eq: [...flatBench(), ...(sm ? rails(47) : [])], hold: holdFor(e) };
  },
  chestPress: ({ e, v }) => {
    if (e === "cable") {
      const a = side({ hip: [50, 54.5], t: 172, arm: at(54, 40), leg: { at: [58, FL] }, leg2: { at: [42, FL] } });
      return { a, b: { ...a, arm: at(73, 40) }, eq: tower(14, 40), hold: "handle", cable: [14, 40] };
    }
    const a = side({ hip: [42, 64], t: 188, arm: at(46, 44), leg: { at: [56, FL] } });
    const end: V2 = v === "incline" ? [58, 31] : [64, 45];
    return { a, b: { ...a, arm: at(end[0], end[1]) }, eq: [...seatUp(42, 64), ["stack", 82, 34, 9, 50]], hold: "handle", lever: { p: v === "incline" ? [76, 72] : [70, 16], to: "grip" } };
  },
  fly: ({ e, v }) => {
    // Seen from above the bench (lying) or from the front (standing cable crossover).
    if (e === "cable") {
      const hy = v === "low" ? 22 : v === "high" ? 64 : 52;
      const py = v === "low" ? 78 : v === "high" ? 16 : 34;
      const sy = v === "low" ? 60 : v === "high" ? 26 : 38;
      const a = front({ arm: at(22, sy, -1), arm2: at(78, sy, -1) });
      return { a, b: { ...a, arm: at(47.5, hy), arm2: at(52.5, hy) }, eq: [...tower(8, py), ...tower(92, py)], hold: "handle", cable: [8, py], cable2: [92, py], two: true };
    }
    const top = v === "incline" ? 18 : 22;
    const a = front({ hip: [50, 58], arm: at(22, 40, -1), arm2: at(78, 40, -1), leg: { at: [45, 86] }, leg2: { at: [55, 86] } });
    return { a, b: { ...a, arm: at(48, 42), arm2: at(52, 42) }, eq: [["box", 43, top, 14, 62 - top]], hold: "db", two: true };
  },
  pecDeck: ({ v }) => {
    const a = front({ hip: [50, 63], thl: 0.4, arm: [90, 180], leg: [25, 0], leg2: [25, 0] });
    if (v === "rev") {
      const r = { ...a, arm: at(47, 38) as Limb, arm2: at(53, 38) as Limb };
      return { a: r, b: { ...a, arm: [90, 90] }, eq: [["box", 42, 30, 16, 36], ["l", 50, 66, 50, FL]], hold: "handle", two: true };
    }
    return { a, b: { ...a, arm: [-28, 180] }, eq: [["box", 42, 30, 16, 36], ["l", 50, 66, 50, FL]], plat: { at: "el", ang: 0, len: 9 }, two: true };
  },
  pushUp: ({ v }) => {
    const hy = v === "incline" ? 64 : FL;
    const a = side({ hip: [52, v === "incline" ? 62 : 68], t: v === "incline" ? 120 : 112, arm: at(72, hy), leg: { at: [24, 80] }, ft: 22 });
    const b = { ...a, hip: [52, v === "incline" ? 68 : 74] as V2, t: v === "incline" ? 108 : 98 };
    return { a, b, eq: v === "incline" ? flatBench(64.5, 64, 92) : [] };
  },
  dip: ({ e, v }) => {
    if (v === "bench") {
      const a = side({ hip: [47, 62], t: 180, arm: at(38, 64.5), leg: { at: [80, 82] } });
      return { a, b: { ...a, hip: [46, 74], t: 176 }, eq: flatBench(66, 16, 40) };
    }
    if (e === "machine") {
      const a = side({ hip: [48, 63], t: 180, arm: at(53, 44), leg: { at: [62, FL] } });
      return { a, b: { ...a, arm: at(53, 64) }, eq: seatUp(48, 63), hold: "handle", lever: { p: [30, 50], to: "grip" } };
    }
    const lean = v === "chest" ? 160 : 176;
    const a = side({ hip: [49, 41], t: 178, arm: at(51, 46), leg: [8, -60] });
    return { a, b: { ...a, hip: [46, 53], t: lean }, eq: [bar(38, 46, 64), ["l", 40, 46, 40, FL], ["l", 62, 46, 62, FL]] };
  },
  pullover: () => {
    const a = side({ hip: [60, 57], t: -90, arm: [-100, -100], leg: { at: [73, FL] } });
    return { a, b: { ...a, arm: [180, 180] }, eq: flatBench(), hold: "db" };
  },

  // Hinge and back
  deadlift: ({ e, v }) => {
    const st = v === "rdl" || v === "stiff";
    const rack = v === "rack";
    const hand: V2 = st ? [56, 73] : rack ? [55, 63] : [55, 78.5];
    const a = st ? side({ hip: [41, 56.5], t: 112, arm: at(hand[0], hand[1]), leg: { at: [52, FL] } })
      : rack ? side({ hip: [43, 61], t: 142, arm: at(hand[0], hand[1]), leg: { at: [52, FL] } })
      : side({ hip: [38, 67], t: v === "sumo" ? 132 : 122, arm: at(hand[0], hand[1]), leg: { at: [52, FL] } });
    const b = side({ arm: at(52, 59), leg: { at: [52, FL] } });
    const eq: Prim[] = rack ? [["l", 62, 64, 62, FL], ["l", 58, 66.5, 66, 66.5]] : [];
    return { a, b, eq, hold: holdFor(e) };
  },
  slRdl: ({ e }) => {
    const a = side({ hip: [47, 55], t: 98, arm: at(62, 74), leg: { at: [50, FL] }, leg2: [-82, -82] });
    return { a, b: side({ arm: at(52, 59), leg: { at: [50, FL] }, leg2: [-6, -10] }), eq: [], hold: holdFor(e) };
  },
  goodMorning: () => {
    const a = side({ arm: relS(-2, 1.5, -1), leg: { at: [51, FL] } });
    return { a, b: { ...a, hip: [44, 55], t: 100 }, eq: [], hold: "bar", at: "nape" };
  },
  backExt: () => {
    const a = side({ hip: [52, 62], t: 30, arel: true, arm: [-25, 150], leg: { at: [30, 80] }, ft: 0 });
    return { a, b: { ...a, t: 129 }, eq: [["pad", 50, 66.5, 57, 60], ["l", 52, 66, 36, FL], ["c", 29, 83, 2.2]] };
  },
  reverseHyper: () => {
    const a = side({ hip: [44, 47], t: 90, arm: at(74, 52), leg: [2, 0] });
    return { a, b: { ...a, leg: [-80, -84] }, eq: [["pad", 44, 50.5, 78, 50.5], ["l", 70, 52, 70, FL], ["l", 50, 52, 50, FL]] };
  },
  pullUp: ({ e }) => {
    const a = side({ hip: [50, 55], t: 180, arm: at(52, 12), leg: [12, -55] });
    const b = { ...a, hip: [50, 38] as V2 };
    return { a, b, eq: [bar(36, 12, 68)], ...(e === "machine" ? { plat: { at: "kn", ang: 90, len: 8, off: 2.5 } } : {}) };
  },
  pulldown: ({ e, v }) => {
    const a = side({ hip: [44, 64], t: 180, arm: at(47, 21.5), leg: { at: [60, FL] } });
    const b = { ...a, t: 188, arm: at(v === "close" ? 49 : 47, 43) };
    return { a, b, eq: [["l", 30, 6, 30, FL], ["l", 30, 6, 50, 6], ["c", 46, 6, 1.8], ["stack", 18, 50, 9, 34], ["pad", 36, 67.5, 54, 67.5], ["l", 44, 69, 44, FL], ["pad", 52, 57, 60, 57]], hold: e === "machine" ? "handle" : v === "close" ? "handle" : "bar", cable: [46, 6] };
  },
  straightPulldown: () => {
    const a = side({ hip: [44, 55], t: 162, arm: at(68, 22), leg: { at: [48, FL] } });
    return { a, b: { ...a, arm: at(56, 60) }, eq: tower(86, 10), hold: "bar", cable: [86, 10] };
  },
  bentRow: ({ e, v }) => {
    const t = v === "pendlay" ? 100 : 115;
    const a = side({ hip: [45, 55], t, arm: relS(0, 23), leg: { at: [52, FL] } });
    const b = { ...a, arm: at(54, v === "pendlay" ? 56 : 52) };
    if (v === "tbar" || v === "meadows") {
      return { a, b, eq: [], hold: "plate", lever: { p: [10, FL], to: "grip" } };
    }
    return { a, b, eq: [], hold: holdFor(e) };
  },
  dbRow: ({ e }) => {
    const a = side({ hip: [40, 58], t: 95, arm: at(60, 79), arm2: at(64, 72), leg: { at: [46, FL] }, leg2: [8, -90] });
    return { a, b: { ...a, arm: at(51, 64) }, eq: flatBench(75, 16, 70), hold: holdFor(e) };
  },
  proneRow: ({ e, v }) => {
    if (v === "incline") {
      const a = side({ hip: [40, 62], t: 135, arm: relS(0, 23), leg: { at: [30, FL] } });
      return { a, b: { ...a, arm: at(56, 58) }, eq: [["pad", 42.5, 65, 59, 49], ["l", 46, 64, 46, FL], ["l", 38, 70, 50, 70]], hold: holdFor(e) };
    }
    const a = side({ hip: [36, 44], t: 90, arm: at(56, 67.5), leg: [-90, -90] });
    return { a, b: { ...a, arm: at(49, 50) }, eq: [["pad", 14, 47.8, 64, 47.8], ["l", 20, 49, 20, FL], ["l", 58, 49, 58, FL]], hold: holdFor(e) };
  },
  cableRow: ({ e, v }) => {
    if (e === "machine") {
      const a = side({ hip: [40, 64], t: 180, arm: at(64, 46), leg: { at: [54, FL] } });
      return { a, b: { ...a, arm: at(43, 49) }, eq: [...seatUp(40, 64, false), ["pad", 49, 40, 49, 54], ["l", 49, 54, 56, FL]], hold: "handle", lever: { p: [74, 80], to: "grip" } };
    }
    const a = side({ hip: [30, 74], t: 168, arm: at(55, 61), leg: { at: [56, 72] }, ft: 180 });
    const b = { ...a, t: 184, arm: at(37, 64) };
    return { a, b, eq: [["pad", 18, 77.5, 44, 77.5], ["l", 22, 79, 22, FL], ["l", 40, 79, 40, FL], ["l", 60, 64, 60, FL], ...tower(88, 62)], hold: v === "single" ? "handle" : "handle", cable: [88, 62] };
  },
  invRow: () => {
    const a = side({ hip: [56, 74], t: -103, arm: at(36, 46), leg: { at: [86, FL] }, ft: 180 });
    return { a, b: { ...a, hip: [56, 66], t: -112 }, eq: [["l", 30, 44, 30, FL], ["c", 36, 46, 1.6], bar(28, 46, 38)] };
  },
  facePull: () => {
    const a = side({ arm: at(72, 30), leg: { at: [52, FL] }, leg2: { at: [44, FL] } });
    return { a, b: { ...a, arm: at(57, 26, -1) }, eq: tower(90, 28), hold: "rope", cable: [90, 28] };
  },
  shrug: ({ e }) => {
    const a = side({ arm: [2, 2] });
    return { a, b: { ...a, up: 3.6 }, eq: [], hold: holdFor(e) };
  },

  // Shoulders
  ohp: ({ e, v }) => {
    if (v === "landmine") {
      const a = side({ arm: at(55, 33), leg: { at: [56, FL] }, leg2: { at: [44, FL] } });
      return { a, b: { ...a, arm: at(70, 19) }, eq: [], hold: "plate", lever: { p: [96, FL], to: "grip" } };
    }
    if (v === "seated" || e === "machine" || e === "smith") {
      const a = side({ hip: [46, 64], t: 180, arm: at(50, 42), leg: { at: [62, FL] } });
      const b = { ...a, arm: at(47, 21) };
      if (e === "machine") return { a, b, eq: seatUp(46, 64), hold: "handle", lever: { p: [28, 52], to: "grip" } };
      return { a, b, eq: [...seatUp(46, 64), ...(e === "smith" ? rails(49) : [])], hold: holdFor(e) };
    }
    const a = side({ arm: at(54, 33.5), leg: { at: [51, FL] } });
    const b = { ...a, arm: at(51, 11.5) };
    if (v === "push") return { a: { ...a, hip: [49, 59] }, b, eq: [], hold: "bar" };
    return { a, b, eq: [], hold: holdFor(e) };
  },
  lateral: ({ e }) => {
    if (e === "machine") {
      const a = front({ hip: [50, 63], thl: 0.4, leg: [25, 0], leg2: [25, 0], arm: [8, 60] });
      return { a, b: { ...a, arm: [86, 110] }, eq: [["box", 42, 30, 16, 36], ["l", 50, 66, 50, FL]], plat: { at: "el", ang: 90, len: 7 }, two: true };
    }
    if (e === "cable") {
      const a = front({ arm: [6, 4], arm2: [-14, -18] });
      return { a, b: { ...a, arm2: [84, 92] }, eq: tower(10, 80), hold: "handle", cable: [10, 80], cableTo: "grip" };
    }
    const a = front({ arm: [8, 6] });
    return { a, b: { ...a, arm: [84, 92] }, eq: [], hold: holdFor(e), two: true };
  },
  frontRaise: ({ e }) => {
    const a = side({ arm: [6, 6], leg: { at: [51, FL] } });
    const b = { ...a, arm: [92, 92] as Limb };
    if (e === "cable") return { a, b, eq: tower(34, 82, 60), hold: "handle", cable: [34, 82] };
    return { a, b, eq: [], hold: holdFor(e) };
  },
  rearFly: ({ e }) => {
    if (e === "cable") {
      const a = front({ arm: at(56, 38), arm2: at(44, 38) });
      return { a, b: { ...a, arm: [88, 90], arm2: [88, 90] }, eq: [...tower(8, 30), ...tower(92, 30)], hold: "handle", cable: [92, 30], cable2: [8, 30], two: true };
    }
    const a = front({ hip: [50, 60], tl: 0.55, hd: 0, arm: [4, 4], leg: { at: [45, FL] }, leg2: { at: [55, FL] } });
    return { a, b: { ...a, arm: [84, 88] }, eq: [], hold: holdFor(e), two: true };
  },
  uprightRow: ({ e }) => {
    const a = side({ arm: at(54, 59), leg: { at: [51, FL] } });
    return { a, b: { ...a, arm: at(54, 38, -1) }, eq: e === "cable" ? tower(72, 82, 62) : [], hold: holdFor(e), ...(e === "cable" ? { cable: [72, 82] as V2 } : {}) };
  },

  // Arms
  curl: ({ e, v }) => {
    if (v === "incline") {
      const a = side({ hip: [54, 64], t: 210, arm: [0, 0], leg: { at: [70, FL] } });
      return { a, b: { ...a, arm: [0, 150] }, eq: [["pad", 50, 67, 37, 44], ["pad", 52, 67.6, 64, 67.6], ["l", 54, 69, 54, FL], ["l", 42, 56, 38, FL]], hold: holdFor(e) };
    }
    if (v === "preacher") {
      const a = side({ hip: [40, 64], t: 175, arm: [50, 62], leg: { at: [52, FL] } });
      return { a, b: { ...a, arm: [50, 168] }, eq: [["pad", 41, 40, 53, 51], ["l", 50, 50, 50, FL], ...seatUp(40, 64, false)], hold: holdFor(e), ...(e === "machine" ? { lever: { p: [60, 50], to: "grip" as Spot } } : {}) };
    }
    if (v === "conc") {
      const a = side({ hip: [44, 64], t: 140, arm: [8, 4], leg: { at: [60, FL] } });
      return { a, b: { ...a, arm: [8, 165] }, eq: flatBench(67.8, 28, 52), hold: "db" };
    }
    if (v === "spider") {
      const a = side({ hip: [40, 62], t: 135, arm: [0, 0], leg: { at: [30, FL] } });
      return { a, b: { ...a, arm: [0, 150] }, eq: [["pad", 42.5, 65, 59, 49], ["l", 46, 64, 46, FL]], hold: holdFor(e) };
    }
    if (v === "bayes") {
      const a = side({ arm: [-28, -26], leg: { at: [54, FL] }, leg2: { at: [44, FL] } });
      return { a, b: { ...a, arm: [-28, 135] }, eq: tower(14, 80, 60), hold: "handle", cable: [14, 80] };
    }
    if (v === "wrist") {
      const a = side({ hip: [44, 64], t: 160, arm: [40, 92], leg: { at: [60, FL] }, wr: -45 });
      return { a, b: { ...a, wr: 45 }, eq: flatBench(67.8, 28, 52), hold: "db" };
    }
    const a = side({ arm: [4, 6], leg: { at: [51, FL] } });
    const b = { ...a, arm: [2, 150] as Limb };
    if (e === "cable") return { a, b, eq: tower(80, 82, 60), hold: v === "rope" ? "rope" : "handle", cable: [80, 82] };
    return { a, b, eq: [], hold: holdFor(e) };
  },
  pushdown: ({ v }) => {
    const a = side({ arm: [8, 150], leg: { at: [51, FL] }, t: 172 });
    return { a, b: { ...a, arm: [8, 8] }, eq: tower(76, 10), hold: v === "rope" ? "rope" : "handle", cable: [76, 10] };
  },
  overheadExt: ({ e }) => {
    if (e === "cable") {
      const a = side({ hip: [52, 55], t: 150, arm: [150, -20], leg: { at: [60, FL] }, leg2: { at: [44, FL] } });
      return { a, b: { ...a, arm: [150, 150] }, eq: tower(16, 40), hold: "rope", cable: [16, 40] };
    }
    const a = side({ hip: [46, 64], t: 180, arm: [172, -10], leg: { at: [62, FL] } });
    return { a, b: { ...a, arm: [172, 172] }, eq: seatUp(46, 64), hold: holdFor(e) };
  },
  skull: ({ e }) => {
    const a = side({ hip: [60, 57], t: -90, arm: [195, 262], leg: { at: [73, FL] } });
    return { a, b: { ...a, arm: [195, 192] }, eq: flatBench(), hold: holdFor(e) };
  },
  kickback: ({ e }) => {
    if (e === "cable") {
      const a = side({ hip: [44, 55], t: 125, arm: [-70, 0], leg: { at: [54, FL] }, leg2: { at: [40, FL] } });
      return { a, b: { ...a, arm: [-70, -62] }, eq: tower(88, 80, 60), hold: "handle", cable: [88, 80] };
    }
    const a = side({ hip: [40, 58], t: 95, arm: [-78, 2], arm2: at(64, 72), leg: { at: [46, FL] }, leg2: [8, -90] });
    return { a, b: { ...a, arm: [-78, -80] }, eq: flatBench(75, 16, 70), hold: "db" };
  },
  triMachine: () => {
    const a = side({ hip: [42, 64], t: 180, arm: [70, 170], leg: { at: [56, FL] } });
    return { a, b: { ...a, arm: [70, 80] }, eq: [...seatUp(42, 64), ["pad", 45, 52, 56, 46]], hold: "handle", lever: { p: [54, 46], to: "grip" } };
  },

  // Legs
  squat: ({ e, v }) => {
    const hold: Hold = v === "goblet" ? holdFor(e) : v === "belt" ? "none" : "bar";
    const spot: Spot = v === "front" ? "rack" : v === "goblet" ? "chest" : "nape";
    const arm = v === "front" ? relS(4, -1, 1) : v === "goblet" ? relS(5, 6) : v === "belt" ? [30, 60] as Limb : relS(-2, 1.5, -1);
    const a = side({ arm, leg: { at: [51, FL] } });
    const b = { ...a, hip: [40, 71] as V2, t: v === "front" || v === "goblet" ? 150 : 140 };
    const eq: Prim[] = e === "smith" ? rails(48) : v === "belt" ? [["l", 50, 64, 50, FL]] : [];
    return { a, b, eq, hold, at: spot };
  },
  hack: ({ v }) => {
    const a = side({ hip: [52, 54], t: 200, arel: true, arm: [0, 90], leg: { at: [64, 81] }, ft: 80 });
    const b = { ...a, hip: [44, 68] as V2 };
    return { a, b, eq: [["rail", 72, 18, 34, FL], ...(v === "pendulum" ? [] : [])] as Prim[], plat: { at: "sh", ang: 20, len: 22, off: -3 } };
  },
  legPress: ({ v }) => {
    const calf = v === "calf";
    const a = side({ hip: [32, 68], t: 215, arel: true, arm: [10, 60], leg: { at: calf ? [52.5, 48] : [45, 55] }, ft: calf ? 235 : 225 });
    const b = { ...a, leg: { at: calf ? [55.5, 45] : [53, 47.5] } as Limb, ft: calf ? 190 : 225 };
    return { a, b, eq: [["pad", 30, 72, 22, 52], ["pad", 30, 72, 42, 72], ["l", 32, 74, 32, FL], ["rail", 50, 66, 86, 30], ["l", 76, 40, 76, FL]], plat: { at: calf ? "toe" : "an", ang: 135, len: 15, off: -1.8 } };
  },
  lunge: ({ e, v }) => {
    const bb = e === "barbell";
    const arm: Limb = bb ? relS(-2, 1.5, -1) : [4, 2];
    const hold: Hold = bb ? "bar" : holdFor(e);
    const at2: Spot = bb ? "nape" : "grip";
    if (v === "bss") {
      const a = side({ hip: [46, 57], arm, leg: { at: [60, FL] }, leg2: { at: [26, 63] }, ft2: -80 });
      return { a, b: { ...a, hip: [44, 68] }, eq: flatBench(66, 12, 32), hold, at: at2 };
    }
    if (v === "step") {
      const a = side({ hip: [44, 56], arm, leg: { at: [62, 70] }, leg2: { at: [44, FL] } });
      return { a, b: { ...a, hip: [60, 41], leg2: { at: [58, 62] } }, eq: [["box", 54, 70, 22, 14]], hold, at: at2 };
    }
    if (v === "split") {
      const a = side({ hip: [48, 56], arm, leg: { at: [62, FL] }, leg2: { at: [34, 81] }, ft2: 60 });
      return { a, b: { ...a, hip: [48, 68] }, eq: [], hold, at: at2 };
    }
    const a = side({ arm, leg: { at: [50, FL] }, leg2: { at: [50, FL] } });
    const b = v === "reverse"
      ? { ...a, hip: [52, 68] as V2, leg: { at: [64, FL] } as Limb, leg2: { at: [36, 81] } as Limb, ft2: 60 }
      : { ...a, hip: [52, 68] as V2, leg: { at: [66, FL] } as Limb, leg2: { at: [38, 81] } as Limb, ft2: 60 };
    return { a, b, eq: [], hold, at: at2 };
  },
  legExt: () => {
    const a = side({ hip: [42, 62], t: 186, arel: true, arm: [10, 40], leg: [90, 0] });
    return { a, b: { ...a, leg: [90, 84] }, eq: [...seatUp(42, 62), ["l", 57, 66, 57, FL]], plat: { at: "an", ang: 90, len: 2, off: 2 }, lever: { p: [57, 62], to: "an" } };
  },
  legCurl: ({ v }) => {
    if (v === "seated") {
      const a = side({ hip: [42, 62], t: 186, arel: true, arm: [10, 40], leg: [90, 86] });
      return { a, b: { ...a, leg: [90, -10] }, eq: [...seatUp(42, 62), ["pad", 50, 57, 58, 57]], lever: { p: [57, 62], to: "an" }, plat: { at: "an", ang: 90, len: 2, off: -2.5 } };
    }
    const a = side({ hip: [44, 58], t: 90, arm: at(76, 64), leg: [-90, -90], hd: 10 });
    return { a, b: { ...a, leg: [-90, 168] }, eq: [["pad", 30, 61.5, 82, 61.5], ["l", 38, 63, 38, FL], ["l", 74, 63, 74, FL]], lever: { p: [29, 58], to: "an" } };
  },
  nordic: () => {
    const a = side({ hip: [48, 68], t: 180, arel: true, arm: [60, 140], leg: [0, -90] });
    return { a, b: { ...a, hip: [59.5, 73.4], t: 130, leg: [-50, -90] }, eq: [["pad", 28, 86, 52, 86], ["c", 33, 79.5, 2]] };
  },
  sissy: () => {
    const a = side({ arel: true, arm: [60, 120], leg: { at: [50, FL] } });
    return { a, b: { ...a, hip: [44, 66], t: 202, leg: { at: [50, 81] }, ft: 40 }, eq: [] };
  },
  hipThrust: ({ e, v }) => {
    const floor = v === "bridge";
    const a = floor ? side({ hip: [50, 80.5], t: -92, arel: true, arm: [0, 0], leg: { at: [68, FL] } })
      : side({ hip: [50, 76], t: -124, arel: true, arm: [0, 0], leg: { at: [70, FL] } });
    const b = floor ? { ...a, hip: [50, 71] as V2, t: -110 } : { ...a, hip: [54, 62] as V2, t: -95 };
    const eq: Prim[] = floor ? [] : [["pad", 14, 66.5, 32, 66.5], ["l", 20, 68, 20, FL]];
    return { a, b, eq, hold: e === "machine" ? "none" : floor ? "none" : "bar", at: "hip", ...(e === "machine" ? { plat: { at: "hip" as Spot, ang: 90, len: 10, off: -4 } } : {}) };
  },
  pullThrough: () => {
    const a = side({ hip: [52, 56], t: 112, arm: at(50, 70), leg: { at: [56, FL] }, leg2: { at: [46, FL] } });
    return { a, b: side({ hip: [52, 54.5], arm: at(54, 60), leg: { at: [56, FL] }, leg2: { at: [46, FL] } }), eq: tower(14, 80, 60), hold: "rope", cable: [14, 80] };
  },
  kickBack: () => {
    const a = side({ hip: [48, 55], t: 150, arm: at(68, 46), leg: [4, 0], leg2: { at: [50, FL] } });
    return { a, b: { ...a, leg: [-50, -36] }, eq: [...tower(86, 80, 30), ["l", 70, 30, 70, FL]], cable: [86, 80], cableTo: "an" };
  },
  hipAb: ({ v }) => {
    const a = front({ hip: [50, 63], thl: 0.4, arm: [16, 4], leg: [v === "in" ? 70 : 8, 0], leg2: [v === "in" ? 70 : 8, 0] });
    return { a, b: { ...a, leg: [v === "in" ? 8 : 70, 0], leg2: [v === "in" ? 8 : 70, 0] }, eq: [["box", 42, 36, 16, 30], ["l", 50, 66, 50, FL]], plat: { at: "kn", ang: 0, len: 6, off: v === "in" ? 2 : -2 } };
  },
  calf: ({ e, v }) => {
    if (v === "seated") {
      const a = side({ hip: [44, 64], t: 180, arel: true, arm: [40, 80], leg: { at: [60, 79] }, ft: 100 });
      return { a, b: { ...a, leg: { at: [60, 75] }, ft: 55 }, eq: [...seatUp(44, 64, false), ["box", 58, 80.5, 12, 3.5], ["pad", 52, 63.5, 62, 63.5]] };
    }
    const a = side({ arm: [2, 2], leg: { at: [50, 80] }, ft: 92 });
    const b = { ...a, hip: [50, 50] as V2, leg: { at: [50, 75.5] } as Limb, ft: 40 };
    const eq: Prim[] = [["box", 50, 80.5, 10, 3.5], ...(e === "smith" ? rails(50) : [])];
    if (e === "machine") return { a: { ...a, arm: relS(2, -1, -1) }, b: { ...b, arm: relS(2, -1, -1) }, eq: [...eq, ["l", 40, 10, 40, FL]], plat: { at: "sh", ang: 90, len: 9, off: -2.5 } };
    return { a, b, eq, hold: e === "smith" ? "bar" : holdFor(e), at: e === "smith" ? "nape" : "grip" };
  },
  swing: () => {
    const a = side({ hip: [40, 61], t: 120, arm: at(46, 72), leg: { at: [52, FL] }, leg2: { at: [46, FL] } });
    return { a, b: side({ arm: at(73, 36), leg: { at: [52, FL] }, leg2: { at: [46, FL] } }), eq: [], hold: "kb" };
  },

  // Core
  plank: () => {
    const a = side({ hip: [52, 74], t: 98, arm: [0, 90], leg: { at: [22, 81] }, ft: 22 });
    return { a, b: { ...a, hip: [52, 72.6] }, eq: [], hold2: true };
  },
  sidePlank: () => {
    const a = front({ hip: [50, 64], arm: [20, 10], arm2: [6, 6], leg: { at: [47, 94] }, leg2: { at: [53, 94] }, rot: 72 });
    return { a, b: { ...a, hip: [50, 62.5] }, eq: [], hold2: true };
  },
  crunch: ({ e, v }) => {
    if (v === "kneel") {
      // Kneeling on a mat facing a high cable, rope by the head. The trunk curls down, the hips stay put.
      const a = side({ hip: [43, 64], t: 172, arm: relS(5, -2, -1), leg: [0, -90] });
      return { a, b: { ...a, t: 100, hd: -12 }, eq: [...tower(80, 8), ["pad", 22, 82.6, 52, 82.6]], hold: "rope", cable: [80, 8] };
    }
    if (e === "cable") {
      const a = side({ hip: [44, 66], t: 168, arm: relS(4, -4, -1), leg: [0, -90] });
      return { a, b: { ...a, t: 105 }, eq: [...tower(78, 8), ["pad", 26, 82.5, 48, 82.5]], hold: "rope", cable: [78, 8] };
    }
    if (e === "machine") {
      const a = side({ hip: [42, 64], t: 182, arm: relS(5, 2, -1), leg: { at: [58, FL] } });
      return { a, b: { ...a, t: 140 }, eq: seatUp(42, 64, false), plat: { at: "sh", ang: 0, len: 7, off: 2.5 } };
    }
    if (v === "decline") {
      const a = side({ hip: [56, 56], t: -72, arm: relS(-3, -4, -1), leg: { at: [74, 70] }, ft: 150 });
      return { a, b: { ...a, t: -172 }, eq: [["pad", 57, 59.5, 26, 69], ["l", 50, 61.5, 50, FL], ["c", 77, 67, 2]] };
    }
    const a = side({ hip: [52, 80.5], t: -90, arm: relS(-3, -4, -1), leg: { at: [70, FL] } });
    return { a, b: { ...a, t: -122 }, eq: [] };
  },
  legRaise: ({ v }) => {
    if (v === "lying") {
      const a = side({ hip: [52, 80.5], t: -90, arel: true, arm: [0, 0], leg: [90, 90] });
      return { a, b: { ...a, leg: [172, 172] }, eq: [] };
    }
    if (v === "captain") {
      const a = side({ hip: [44, 58], t: 180, arm: [0, 90], leg: [2, 0] });
      return { a, b: { ...a, leg: [100, 10] }, eq: [["pad", 36, 51, 36, 72], ["pad", 44, 45, 56, 45], ["l", 34, 20, 34, FL]] };
    }
    const a = side({ hip: [50, 55], t: 180, arm: at(52, 12), leg: [2, 0] });
    return { a, b: { ...a, leg: [92, 92] }, eq: [bar(36, 12, 68)] };
  },
  abWheel: () => {
    const a = side({ hip: [40, 67], t: 150, arm: at(56, 80), leg: { at: [24, 82] }, ft: 0 });
    return { a, b: { ...a, hip: [52, 74], t: 100, arm: at(80, 80) }, eq: [["pad", 20, 86, 50, 86]], wheel: true };
  },
  twist: ({ e }) => {
    const a = front({ hip: [50, 72], t: 192, thl: 0.4, arm: at(36, 55), arm2: at(40, 53), leg: [20, 78], leg2: [20, 78] });
    return { a, b: { ...a, t: 168, arm: at(60, 53), arm2: at(64, 55) }, eq: [], hold: e === "bodyweight" ? "none" : holdFor(e) };
  },
  pallof: () => {
    const a = side({ arm: at(56, 42), leg: { at: [56, FL] }, leg2: { at: [44, FL] } });
    return { a, b: { ...a, arm: at(73, 41) }, eq: tower(12, 42), hold: "handle", cable: [12, 42], hold2: false };
  },
  chop: () => {
    const a = front({ t: 192, arm: at(30, 22), arm2: at(34, 24) });
    return { a, b: { ...a, t: 170, arm: at(64, 62), arm2: at(68, 64) }, eq: tower(8, 14), hold: "handle", cable: [8, 14] };
  },
  deadBug: () => {
    const a = side({ hip: [52, 80.5], t: -90, arm: [180, 180], leg: [180, 90] });
    return { a, b: { ...a, arm: [-100, -100], leg2: [94, 92] }, eq: [] };
  },
  carry: ({ e }) => {
    const a = side({ arm: [2, 2], leg: { at: [43, FL] }, leg2: { at: [57, FL] } });
    return { a, b: { ...a, leg: { at: [57, FL] }, leg2: { at: [43, FL] } }, eq: [], hold: holdFor(e) };
  },
};

/** Exercise id -> [pattern, variant]. Every library exercise has one (tests/fitness-pics.test.ts checks). */
const MAP: Record<string, [string, string?]> = {
  "barbell-bench-press": ["bench"], "incline-barbell-bench-press": ["bench", "incline"], "decline-barbell-bench-press": ["bench", "decline"],
  "close-grip-bench-press": ["bench"], "dumbbell-bench-press": ["bench"], "incline-dumbbell-press": ["bench", "incline"],
  "decline-dumbbell-press": ["bench", "decline"], "dumbbell-floor-press": ["bench", "floor"], "machine-chest-press": ["chestPress"],
  "incline-machine-press": ["chestPress", "incline"], "cable-chest-press": ["chestPress"], "smith-machine-bench-press": ["bench"],
  "smith-machine-incline-press": ["bench", "incline"], "dumbbell-fly": ["fly"], "incline-dumbbell-fly": ["fly", "incline"],
  "cable-fly": ["fly"], "low-to-high-cable-fly": ["fly", "low"], "high-to-low-cable-fly": ["fly", "high"], "pec-deck": ["pecDeck"],
  "push-up": ["pushUp"], "incline-push-up": ["pushUp", "incline"], "chest-dip": ["dip", "chest"], "dumbbell-pullover": ["pullover"],

  "deadlift": ["deadlift"], "sumo-deadlift": ["deadlift", "sumo"], "trap-bar-deadlift": ["deadlift"], "romanian-deadlift": ["deadlift", "rdl"],
  "dumbbell-romanian-deadlift": ["deadlift", "rdl"], "stiff-leg-deadlift": ["deadlift", "stiff"], "single-leg-romanian-deadlift": ["slRdl"],
  "rack-pull": ["deadlift", "rack"], "good-morning": ["goodMorning"], "back-extension": ["backExt"], "reverse-hyperextension": ["reverseHyper"],
  "pull-up": ["pullUp"], "chin-up": ["pullUp"], "assisted-pull-up": ["pullUp"], "lat-pulldown": ["pulldown"],
  "close-grip-lat-pulldown": ["pulldown", "close"], "underhand-lat-pulldown": ["pulldown"], "single-arm-lat-pulldown": ["pulldown", "close"],
  "straight-arm-pulldown": ["straightPulldown"], "barbell-row": ["bentRow"], "pendlay-row": ["bentRow", "pendlay"], "seal-row": ["proneRow"],
  "meadows-row": ["bentRow", "meadows"], "dumbbell-row": ["dbRow"], "chest-supported-dumbbell-row": ["proneRow", "incline"],
  "seated-cable-row": ["cableRow"], "single-arm-cable-row": ["cableRow", "single"], "t-bar-row": ["bentRow", "tbar"], "machine-row": ["cableRow"],
  "inverted-row": ["invRow"], "face-pull": ["facePull"], "barbell-shrug": ["shrug"], "dumbbell-shrug": ["shrug"],

  "overhead-press": ["ohp"], "seated-dumbbell-shoulder-press": ["ohp", "seated"], "standing-dumbbell-overhead-press": ["ohp"],
  "arnold-press": ["ohp", "seated"], "machine-shoulder-press": ["ohp"], "smith-machine-shoulder-press": ["ohp"], "push-press": ["ohp", "push"],
  "landmine-press": ["ohp", "landmine"], "dumbbell-lateral-raise": ["lateral"], "cable-lateral-raise": ["lateral"], "machine-lateral-raise": ["lateral"],
  "dumbbell-front-raise": ["frontRaise"], "cable-front-raise": ["frontRaise"], "plate-front-raise": ["frontRaise"], "rear-delt-fly": ["rearFly"],
  "reverse-pec-deck": ["pecDeck", "rev"], "cable-rear-delt-fly": ["rearFly"], "upright-row": ["uprightRow"], "dumbbell-upright-row": ["uprightRow"],
  "cable-upright-row": ["uprightRow"],

  "barbell-curl": ["curl"], "ez-bar-curl": ["curl"], "dumbbell-curl": ["curl"], "hammer-curl": ["curl"], "incline-dumbbell-curl": ["curl", "incline"],
  "preacher-curl": ["curl", "preacher"], "dumbbell-preacher-curl": ["curl", "preacher"], "machine-preacher-curl": ["curl", "preacher"],
  "concentration-curl": ["curl", "conc"], "spider-curl": ["curl", "spider"], "cable-curl": ["curl"], "rope-hammer-curl": ["curl", "rope"],
  "bayesian-curl": ["curl", "bayes"], "reverse-curl": ["curl"], "wrist-curl": ["curl", "wrist"],

  "triceps-pushdown": ["pushdown"], "rope-pushdown": ["pushdown", "rope"], "overhead-cable-triceps-extension": ["overheadExt"],
  "overhead-dumbbell-triceps-extension": ["overheadExt"], "skull-crusher": ["skull"], "dumbbell-skull-crusher": ["skull"],
  "triceps-kickback": ["kickback"], "cable-triceps-kickback": ["kickback"], "machine-triceps-extension": ["triMachine"],
  "triceps-dip": ["dip"], "bench-dip": ["dip", "bench"], "machine-dip": ["dip"], "diamond-push-up": ["pushUp"],

  "back-squat": ["squat"], "front-squat": ["squat", "front"], "goblet-squat": ["squat", "goblet"], "smith-machine-squat": ["squat"],
  "hack-squat": ["hack"], "leg-press": ["legPress"], "single-leg-press": ["legPress"], "pendulum-squat": ["hack", "pendulum"],
  "belt-squat": ["squat", "belt"], "bulgarian-split-squat": ["lunge", "bss"], "split-squat": ["lunge", "split"], "forward-lunge": ["lunge"],
  "walking-lunge": ["lunge"], "reverse-lunge": ["lunge", "reverse"], "barbell-lunge": ["lunge"], "step-up": ["lunge", "step"],
  "leg-extension": ["legExt"], "lying-leg-curl": ["legCurl"], "seated-leg-curl": ["legCurl", "seated"], "nordic-curl": ["nordic"],
  "sissy-squat": ["sissy"], "hip-thrust": ["hipThrust"], "machine-hip-thrust": ["hipThrust"], "glute-bridge": ["hipThrust", "bridge"],
  "cable-pull-through": ["pullThrough"], "cable-glute-kickback": ["kickBack"], "hip-abduction-machine": ["hipAb"],
  "hip-adduction-machine": ["hipAb", "in"], "standing-calf-raise": ["calf"], "seated-calf-raise": ["calf", "seated"],
  "leg-press-calf-raise": ["legPress", "calf"], "smith-machine-calf-raise": ["calf"], "dumbbell-calf-raise": ["calf"],
  "kettlebell-swing": ["swing"],

  "plank": ["plank"], "side-plank": ["sidePlank"], "crunch": ["crunch"], "decline-sit-up": ["crunch", "decline"], "cable-crunch": ["crunch"], "abs-cable-crunch": ["crunch", "kneel"],
  "machine-crunch": ["crunch"], "hanging-leg-raise": ["legRaise"], "captains-chair-knee-raise": ["legRaise", "captain"],
  "lying-leg-raise": ["legRaise", "lying"], "ab-wheel-rollout": ["abWheel"], "russian-twist": ["twist"], "pallof-press": ["pallof"],
  "cable-woodchop": ["chop"], "dead-bug": ["deadBug"], "farmers-carry": ["carry"],
};

export interface Pic {
  scene: Scene;
  muscles: Muscle[];
  /** The library exercise the picture shows. */
  exercise: Exercise;
  /** exact: the exercise itself; close: a library name close to what was typed; guess: a key word guess. */
  how: "exact" | "close" | "guess";
}

const cache = new Map<string, Scene>();
function sceneFor(x: Exercise): Scene | null {
  const hit = cache.get(x.id);
  if (hit) return hit;
  const m = MAP[x.id];
  const make = m && PAT[m[0]];
  if (!make) return null;
  const s = make({ e: x.equipment, v: m[1] ?? "" });
  cache.set(x.id, s);
  return s;
}

/** Rough key word guesses for names nobody wrote the same way twice ("Metal bar pull down", "Abs Abductor machine"). */
const GUESS: [RegExp, string][] = [
  [/abduct/, "hip-abduction-machine"], [/adduct/, "hip-adduction-machine"], [/\bjm\b/, "close-grip-bench-press"],
  [/behind (the )?(back|body).*curl/, "bayesian-curl"], [/\babs?\b.*(pull ?up|hang)|hanging/, "hanging-leg-raise"],
  [/shoulder.*cable|cable.*shoulder/, "cable-lateral-raise"],
  [/pull ?down|lat bar/, "lat-pulldown"], [/pull ?up|chin ?up/, "pull-up"], [/push ?down|press ?down|rope.*tri|tri.*rope/, "rope-pushdown"],
  [/tricep|skull/, "triceps-pushdown"], [/hammer/, "hammer-curl"], [/preacher/, "preacher-curl"], [/curl/, "dumbbell-curl"],
  [/lateral|side raise/, "dumbbell-lateral-raise"], [/rear delt|reverse fly/, "reverse-pec-deck"], [/fly|pec/, "pec-deck"],
  [/shoulder.*press|press.*shoulder|overhead/, "machine-shoulder-press"], [/chest.*press|press.*chest|bench/, "machine-chest-press"],
  [/leg press/, "leg-press"], [/leg ext|quad/, "leg-extension"], [/leg curl|hamstring/, "seated-leg-curl"], [/calf|calves/, "standing-calf-raise"],
  [/squat/, "back-squat"], [/lunge/, "forward-lunge"], [/deadlift|rdl/, "romanian-deadlift"], [/hip thrust|glute/, "hip-thrust"],
  [/row/, "seated-cable-row"], [/dip/, "triceps-dip"], [/shrug/, "dumbbell-shrug"], [/plank/, "plank"],
  [/crunch|sit ?up|\babs?\b|core/, "machine-crunch"], [/leg raise|knee raise/, "hanging-leg-raise"], [/forearm|wrist/, "wrist-curl"],
  [/push ?up|press ?up/, "push-up"], [/raise/, "dumbbell-front-raise"], [/press/, "machine-chest-press"],
];

/** The picture for an exercise: its library id when known, else the name matched to a close library exercise,
 *  else a key word guess, else null (the placeholder). */
export function picFor(exId: string | null | undefined, name: string): Pic | null {
  const own = getExercise(exId);
  const make = (x: Exercise, how: Pic["how"]): Pic | null => { const s = sceneFor(x); return s ? { scene: s, muscles: x.muscles, exercise: x, how } : null; };
  if (own) return make(own, "exact");
  const clean = name.trim();
  if (!clean) return null;
  const low = clean.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const m = matchExercise(clean, 0.6);
  // The search forgives one letter, so "pull down" and "push down" look alike: never cross pull and push.
  const pp = (t: string) => (/\bpull/.test(t) ? "pull" : /\bpush|press ?down/.test(t) ? "push" : "");
  const crossed = m && pp(low) && pp(m.exercise.name.toLowerCase().replace(/[^a-z0-9]+/g, " ")) && pp(low) !== pp(m.exercise.name.toLowerCase());
  if (m && !crossed) return make(m.exercise, m.score >= 0.98 ? "exact" : "close");
  for (const [re, id] of GUESS) {
    if (re.test(low)) { const x = getExercise(id); if (x) return make(x, "guess"); }
  }
  return null;
}

/** The part of the 100 x 90 space a scene uses (both poses, mid rep, equipment), padded, at the tile's 10:9
 *  shape, so a small picture is all figure and no empty room. */
const boxes = new WeakMap<Scene, string>();
export function sceneBox(s: Scene): string {
  const hit = boxes.get(s);
  if (hit) return hit;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const put = (x: number, y: number, r = 0) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
  for (const p of [s.a, s.b, blend(s.a, s.b, 0.5)]) {
    const j = solve(p);
    for (const v of [j.hip, j.neck, j.sh, j.sh2, j.el, j.el2, j.wr, j.wr2, j.kn, j.kn2, j.an, j.an2, j.toe, j.toe2]) put(v[0], v[1], 2);
    put(j.head[0], j.head[1], 5);
    put(j.grip[0], j.grip[1], s.hold && s.hold !== "none" ? 6 : 2);
    if (s.two) put(j.grip2[0], j.grip2[1], 6);
  }
  for (const p of s.eq) {
    if (p[0] === "c") put(p[1], p[2], p[3]);
    else if (p[0] === "stack" || p[0] === "box") { put(p[1], p[2]); put(p[1] + p[3], p[2] + p[4]); }
    else { put(p[1], p[2], 2); put(p[3], p[4], 2); }
  }
  if (s.cable) put(s.cable[0], s.cable[1], 2);
  if (s.cable2) put(s.cable2[0], s.cable2[1], 2);
  if (s.lever) put(s.lever.p[0], s.lever.p[1], 1);
  y1 = Math.max(y1, FL + 1);
  const pad = 4;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += 2;
  let w = x1 - x0, h = y1 - y0;
  // Never zoom in so far that a small move fills the tile.
  const minW = 56;
  if (w < minW) { x0 -= (minW - w) / 2; w = minW; }
  if (w / h > 10 / 9) { const nh = (w * 9) / 10; y0 -= nh - h; h = nh; } else { const nw = (h * 10) / 9; x0 -= (nw - w) / 2; w = nw; }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const box = `${r2(x0)} ${r2(y0)} ${r2(w)} ${r2(h)}`;
  boxes.set(s, box);
  return box;
}

/** For tests and the dev gallery. */
export const PIC_IDS = Object.keys(MAP);
export const scenePattern = (id: string) => MAP[id]?.[0] ?? null;

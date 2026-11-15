// PS Fitness: the little stick figure for the phone's island (V1.60). The exercise picture's own rig (pic-rig.ts) solved for
// the start and the end of a rep, flattened to 17 points each (head, neck, hip, shoulders, elbows, wrists, hips, knees,
// ankles, toes: x,y pairs) in a 0 to 100 box, so the shell can draw it with a few lines and play the rep. Only for an
// exercise that is in the exercise list. Pure; tested in tests/fitisland.test.ts.
import { solve, L, type Joints } from "./pic-rig.ts";
import { picFor } from "./pics.ts";
import { getExercise } from "./library.ts";
import type { FitFig } from "../core/fitisland.ts";

/** The order the shell reads the points in (IslandFig.kt): keep both in step. */
export const FIG_POINTS = ["head", "neck", "hip", "sh", "sh2", "el", "el2", "wr", "wr2", "hipL", "hipR", "kn", "kn2", "an", "an2", "toe", "toe2"] as const;
const pts = (j: Joints): [number, number][] => FIG_POINTS.map((k) => j[k] as [number, number]);

/** The figure for an exercise id that is in the list (null for anything else, so the island shows the name alone). */
export function figFor(exId: string | null | undefined, name: string): FitFig | null {
  if (!exId || !getExercise(exId)) return null;
  const pic = picFor(exId, name);
  return pic ? figOf(pic.scene.a, pic.scene.b) : null;
}

export function figOf(a: Parameters<typeof solve>[0], b: Parameters<typeof solve>[0]): FitFig {
  const pa = pts(solve(a)), pb = pts(solve(b));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of [...pa, ...pb]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const span = Math.max(x1 - x0, y1 - y0, 1);
  const k = 88 / span;                                   // one scale for both poses and both axes: the figure keeps its shape
  const ox = 50 - ((x0 + x1) / 2) * k, oy = 50 - ((y0 + y1) / 2) * k;
  const flat = (p: [number, number][]) => p.flatMap(([x, y]) => [r1(x * k + ox), r1(y * k + oy)]);
  return { a: flat(pa), b: flat(pb), hr: r1(L.HEAD * k) };
}
const r1 = (n: number) => Math.round(n * 10) / 10;

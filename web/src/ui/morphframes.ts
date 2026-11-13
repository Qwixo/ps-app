// The keyframes of the window that grows out of its button and shrinks back into it (morph() in views/DimensionX.tsx).
// Pure, so a test can hold the one rule that matters on the phone: `flat` keyframes move by transform only (V1.47).
// A single property the GPU cannot animate (border-radius) keeps the WHOLE animation on the page's main thread,
// where any work at the same moment (building Fitness, a sync, a re-render) froze it.

/** cubic-bezier(x1, y1, x2, y2) as a function of time (0..1), for sampling keyframes by hand. */
export function bezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, u: number) => 3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0, hi = 1, u = t;
    for (let i = 0; i < 22; i++) { u = (lo + hi) / 2; if (at(x1, x2, u) < t) lo = u; else hi = u; }
    return at(y1, y2, u);
  };
}
export const EASE = bezier(0.22, 1, 0.36, 1);

type Box = { left: number; top: number; width: number; height: number };
export type MorphFrame = { transform: string; borderRadius?: string };

/** The window `p` and the button `b`: 27 samples along the easing curve. Not flat (the Mac): the corners stay truly
 *  round at every step (radii of r/sx by r/sy). Flat (the phone): transform only. */
export function morphFrames(p: Box, b: Box, dir: "in" | "out", flat: boolean, radius = 26): MorphFrame[] {
  const N = 26, frames: MorphFrame[] = [];
  for (let k = 0; k <= N; k++) {
    const e = EASE(k / N);
    const t = dir === "in" ? 1 - e : e;             // 0 = the window, 1 = the button
    const sx = 1 + (b.width / p.width - 1) * t, sy = 1 + (b.height / p.height - 1) * t;
    const r = radius + (b.height / 2 - radius) * t;
    const transform = `translate(${(b.left - p.left) * t}px, ${(b.top - p.top) * t}px) scale(${sx}, ${sy})`;
    frames.push(flat ? { transform } : { transform, borderRadius: `${r / sx}px / ${r / sy}px` });
  }
  return frames;
}

/** Flat only: the window comes in from faint over the first 14%, and goes out from 36%, gone at 80%, so its
 *  squashed corners at the small end never show (the Fitness bubble fades in where it lands, FitnessPop.tsx). */
export function morphFade(dir: "in" | "out"): { opacity: number; offset?: number }[] {
  return dir === "in"
    ? [{ opacity: 0.35 }, { opacity: 1, offset: 0.14 }, { opacity: 1 }]
    : [{ opacity: 1 }, { opacity: 1, offset: 0.36 }, { opacity: 0, offset: 0.8 }, { opacity: 0 }];
}

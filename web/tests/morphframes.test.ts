// The window that grows out of its button (morph() in views/DimensionX.tsx, keyframes in ui/morphframes.ts), V1.47.
// The developer: opening, minimising and closing Fitness on the phone "very laggy". The phone's keyframes must move by transform
// only: one border-radius in them kept the whole animation off the GPU. The Mac keeps its truly round corners.
// Run: node --experimental-strip-types tests/morphframes.test.ts
import assert from "node:assert/strict";
import { EASE, bezier, morphFade, morphFrames } from "../src/ui/morphframes.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

const win = { left: 8, top: 40, width: 396, height: 860 };
const btn = { left: 180, top: 850, width: 58, height: 52 };

ok("flat (the phone): every keyframe is transform only, no border-radius", () => {
  for (const dir of ["in", "out"] as const) {
    const f = morphFrames(win, btn, dir, true);
    assert.equal(f.length, 27);
    for (const k of f) assert.deepEqual(Object.keys(k), ["transform"]);
  }
});

ok("not flat (the Mac): every keyframe keeps its round corners", () => {
  const f = morphFrames(win, btn, "in", false);
  for (const k of f) { assert.ok(k.borderRadius); assert.match(k.borderRadius!, /px \/ .*px$/); }
});

ok("in starts at the button and ends at the window; out the other way round", () => {
  const i = morphFrames(win, btn, "in", true), o = morphFrames(win, btn, "out", true);
  const nums = (t: string) => (t.match(/-?[\d.]+(e-?\d+)?/g) ?? []).map(Number);
  const near = (a: number[], b: number[]) => { assert.equal(a.length, b.length); a.forEach((x, j) => assert.ok(Math.abs(x - b[j]) < 1e-9, `${x} vs ${b[j]}`)); };
  near(nums(i[0].transform), [btn.left - win.left, btn.top - win.top, btn.width / win.width, btn.height / win.height]);
  assert.equal(i[26].transform, "translate(0px, 0px) scale(1, 1)");
  assert.equal(o[0].transform, "translate(0px, 0px) scale(1, 1)");
  assert.equal(o[26].transform, i[0].transform);
});

ok("flat and round corners move along the same path", () => {
  const a = morphFrames(win, btn, "out", true), b = morphFrames(win, btn, "out", false);
  assert.deepEqual(a.map((k) => k.transform), b.map((k) => k.transform));
});

ok("the fade hides the squashed corners at the small end only", () => {
  const i = morphFade("in"), o = morphFade("out");
  assert.ok(i[0].opacity < 0.5); assert.equal(i[i.length - 1].opacity, 1);
  assert.equal(o[0].opacity, 1); assert.equal(o[o.length - 1].opacity, 0);
  // in: fully shown after the first seventh; out: fully shown for the first third, gone before the end
  assert.ok((i[1].offset ?? 1) <= 0.2);
  assert.ok((o[1].offset ?? 0) >= 0.3);
  assert.ok((o[2].offset ?? 1) < 1 && o[2].opacity === 0);
  for (const f of [i, o]) for (let k = 1; k < f.length; k++) assert.ok((f[k].offset ?? 1) >= (f[k - 1].offset ?? 0));
});

ok("easing: 0 at the start, 1 at the end, never backwards", () => {
  assert.equal(EASE(0), 0); assert.equal(EASE(1), 1);
  let last = 0;
  for (let t = 0; t <= 1; t += 0.01) { const v = EASE(t); assert.ok(v >= last - 1e-9); last = v; }
  assert.ok(Math.abs(bezier(0, 0, 1, 1)(0.5) - 0.5) < 1e-3);
});

console.log(`\n${n} checks passed`);

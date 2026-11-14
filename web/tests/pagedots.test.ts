// Run: node --experimental-strip-types tests/pagedots.test.ts
// PS 1.60 phone fixes: the iPhone style page dots (core/pagedots.ts, views/ListPager.tsx, views/listpager.css).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LONG_MS, MIN_H, PLUS_GAP, SLIDE_PX, dotAt, move, press, release, tapTarget, type Geo } from "../src/core/pagedots.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const g: Geo = { left: 100, width: 100, n: 5 };   // five dots, 20 wide each: 100..200

ok("a finger lands on the dot under it, clamped at both ends", () => {
  assert.equal(dotAt(100, g), 0); assert.equal(dotAt(119, g), 0); assert.equal(dotAt(120, g), 1);
  assert.equal(dotAt(199, g), 4); assert.equal(dotAt(5, g), 0); assert.equal(dotAt(900, g), 4);
});
ok("nothing to hit hits page 0 and never divides by zero", () => {
  assert.equal(dotAt(50, { left: 0, width: 0, n: 3 }), 0); assert.equal(dotAt(50, { left: 0, width: 80, n: 0 }), 0);
});
ok("tap the left half goes back, the right half goes forward", () => {
  assert.equal(tapTarget(110, g, 2), 1); assert.equal(tapTarget(190, g, 2), 3);
});
ok("a tap stops at the first and the last page", () => {
  assert.equal(tapTarget(110, g, 0), 0); assert.equal(tapTarget(190, g, 4), 4);
  assert.equal(tapTarget(190, g, 99), 4); assert.equal(tapTarget(110, g, -3), 0);
});
ok("the middle of the pill counts as the right half", () => { assert.equal(tapTarget(150, g, 1), 2); });
ok("a small wobble is not a scrub", () => {
  const p = press(150, 0, 2);
  const m = move(p, 150 + SLIDE_PX - 1, g);
  assert.equal(m.to, null); assert.equal(m.p.scrubbing, false); assert.equal(m.started, false);
});
ok("a slide scrubs: the page under the finger shows and ticks once per new page", () => {
  let p = press(150, 0, 2); const seen: number[] = [];
  for (const x of [160, 170, 175, 185, 195, 196, 197, 150, 110, 105]) {
    const m = move(p, x, g); p = m.p; if (m.to != null) seen.push(m.to);
  }
  assert.deepEqual(seen, [3, 4, 2, 0]);   // 150 is page 2, 110 is page 0: no repeats while a finger stays on one dot
});
ok("the slide starts exactly once", () => {
  let p = press(150, 0, 2), starts = 0;
  for (const x of [151, 159, 165, 170]) { const m = move(p, x, g); p = m.p; if (m.started) starts++; }
  assert.equal(starts, 1);
});
ok("sliding past the end clamps and does not tick again", () => {
  let p = press(190, 0, 4); const seen: number[] = [];
  for (const x of [199, 240, 300]) { const m = move(p, x, g); p = m.p; if (m.to != null) seen.push(m.to); }
  assert.deepEqual(seen, []);
});
ok("lifting after a slide is not a tap", () => {
  let p = press(150, 0, 2); p = move(p, 190, g).p;
  assert.deepEqual(release(p, 190, 100, g), { kind: "scrub" });
});
ok("a quick press without a slide is a tap, a very long one is left to the long press menu", () => {
  const p = press(190, 0, 2);
  assert.deepEqual(release(p, 190, 120, g), { kind: "tap", to: 3 });
  assert.deepEqual(release(p, 190, LONG_MS, g), { kind: "none" });
});
ok("the sizes: 44 tall, the + buttons clearly apart", () => {
  assert.equal(MIN_H, 44); assert.ok(PLUS_GAP >= 12);
  const css = read("src/views/listpager.css");
  assert.match(css, /\.tl-phone \.tl-bed \{[^}]*height: 44px/);
  assert.match(css, /\.tl-dots\.tl-phone \{[^}]*gap: 14px/);
  assert.match(css, /\.tl-phone \.tl-dot\.plus \{[^}]*width: 44px; height: 44px/);
  assert.match(css, /\.tl-phone\.held \.tl-bed \{ transform: scale/);
});
ok("the dots stay above the gesture bar and the navbar", () => {
  const css = read("src/views/listpager.css");
  assert.match(css, /html\.gos \.tl-dots \{ bottom: calc\(var\(--gos-bottom, 0px\) \+ var\(--gos-dock-h, 0px\) \+ 16px\)/);
});
ok("the page wires the gestures only on the phone, with one haptic tick and the pill's own pointer capture", () => {
  const t = read("src/views/ListPager.tsx");
  assert.match(t, /const phone = GOS \|\| MWEB/);
  assert.match(t, /pd\.move\(p, e\.clientX, geo\(\)\)/); assert.match(t, /gosHaptic\("tick"\)/); assert.match(t, /setPointerCapture/);
  assert.match(t, /if \(phone && !isPlus\(id\)\) return;/);   // a page dot's own click never double fires
});
ok("reduced motion turns the growing off", () => { assert.match(read("src/views/listpager.css"), /prefers-reduced-motion: reduce\) \{ \.tl-phone \.tl-bed \{ transition: none/); });
ok("no long dashes in the new files", () => { for (const f of ["src/core/pagedots.ts", "src/views/listpager.css"]) assert.ok(!/[\u2013\u2014]/.test(read(f)), f); });
console.log(`${n} passed`);

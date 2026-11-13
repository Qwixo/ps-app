// Run: node --experimental-strip-types tests/menuspot.test.ts
// The Dynamic Island menu and its look editor stay fully on the screen (the developer, 5 Nov 2026).
import assert from "node:assert/strict";
import { islandMenuSpot } from "../src/ui/menuspot.ts";

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const btn = (left: number, top: number) => ({ left, right: left + 34, top, bottom: top + 34 });
const inside = (s: { top: number; left: number; maxH: number }, w: number, vw: number, vh: number) => {
  assert.ok(s.left >= 8, `left ${s.left}`); assert.ok(s.left + w <= vw - 8, `right ${s.left + w}`);
  assert.ok(s.top >= 8); assert.ok(s.top + s.maxH <= vh - 8 + 0.5);
};

ok("button near the left edge: the editor starts 8 px in, never off screen", () => {
  for (const w of [292, 340]) { const s = islandMenuSpot(btn(30, 300), w, 1512, 982); assert.equal(s.left, 8); inside(s, w, 1512, 982); }
});
ok("button with room: the right edges line up as before", () => {
  const b = btn(900, 60); const s = islandMenuSpot(b, 340, 1512, 982); assert.equal(s.left + 340, b.right); inside(s, 340, 1512, 982);
});
ok("button near the right edge: kept inside", () => { const s = islandMenuSpot(btn(1490, 60), 340, 1512, 982); inside(s, 340, 1512, 982); });
ok("near the bottom: moves up and scrolls inside", () => { const s = islandMenuSpot(btn(400, 900), 340, 1512, 982); inside(s, 340, 1512, 982); assert.ok(s.maxH >= 160); });
ok("every spot on a small screen stays inside", () => {
  for (let x = 0; x <= 1246; x += 41) for (let y = 0; y <= 734; y += 37) for (const w of [292, 340]) inside(islandMenuSpot(btn(x, y), w, 1280, 800), w, 1280, 800);
});
console.log(`menuspot: ${n} passed`);

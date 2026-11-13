// Run: node --experimental-strip-types tests/overview-phone.test.ts
// V1.56 the Mac's Edit overview with both the edit-nav bar (core/overviewnav.ts barSpot) and phone-editor's phone button
// (core/phonedevices.ts phoneButtonSpot) in it. The developer's standing rule: nothing over anything, the island covers nothing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { barSpot } from "../src/core/overviewnav.ts";
import { phoneButtonSpot } from "../src/core/phonedevices.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
type Box = { left: number; top: number; right: number; bottom: number };
const apart = (a: Box, b: Box) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

const vw = 1512, bw = 300, bh = 44;
function layout(island: Box | null) {
  const ph = phoneButtonSpot(island, vw);
  const phone: Box = { left: ph.left, top: ph.top, right: ph.left + 40, bottom: ph.top + 40 };
  const sp = barSpot(island, vw, bw, bh, 16, 24, 12, [phone]);
  const bar: Box = { left: sp.left, top: sp.top, right: sp.left + bw, bottom: sp.top + bh };
  return { phone, bar };
}
const islands: [string, Box | null][] = [
  ["no island", null],
  ["top middle (the usual place)", { left: 680, top: 0, right: 832, bottom: 38 }],
  ["top left", { left: 0, top: 0, right: 340, bottom: 40 }],
  ["open over the middle and the left", { left: 0, top: 0, right: 900, bottom: 40 }],
  ["open wide across the top", { left: 0, top: 0, right: vw, bottom: 120 }],
  ["top right", { left: 1200, top: 0, right: vw, bottom: 40 }],
  ["moved to the bottom", { left: 680, top: 860, right: 832, bottom: 898 }],
];

ok("the phone button and the bar never overlap, and the island covers neither, wherever the island is", () => {
  for (const [name, isl] of islands) {
    const { phone, bar } = layout(isl);
    assert.ok(apart(phone, bar), `${name}: ${JSON.stringify({ phone, bar })}`);
    if (isl) { assert.ok(apart(phone, isl), `${name}: phone under the island`); assert.ok(apart(bar, isl), `${name}: bar under the island`); }
    assert.ok(bar.left >= 0 && bar.right <= vw, `${name}: bar on screen`);
  }
});
ok("with the island at the top middle the bar keeps the developer's top left place, just right of the phone button", () => {
  const { phone, bar } = layout(islands[1][1]);
  assert.deepEqual([phone.left, phone.top], [20, 16]);
  assert.equal(bar.left, phone.right + 12);
  assert.equal(bar.top, 16);
});
ok("without anything to avoid the bar is exactly where edit-nav put it", () => {
  assert.deepEqual(barSpot({ left: 680, top: 0, right: 832, bottom: 38 }, vw, bw, bh), { left: 24, top: 16 });
  assert.deepEqual(barSpot(null, vw, bw, bh), { left: (vw - bw) / 2, top: 16 });
});
ok("the overview passes the phone button to the bar, and its wheel and edge scroll leave the phone editor alone", () => {
  const src = read("src/views/EditMode.tsx");
  assert.match(src, /const ph = phoneButtonSpot\(box, vw\); const sp = barSpot\([\s\S]*?\[\{ left: ph\.left, top: ph\.top, right: ph\.left \+ 40, bottom: ph\.top \+ 40 \}\]\)/);
  assert.match(src, /\|\| phoneUi\(over\);/);
  assert.match(src, /\|\| phoneUi\(t\)\) return;/);
  assert.match(src, /<PhoneMount live=\{live\} leaving=\{leaving\} red=\{red\} onDone=\{onDone\} \/>/);
});
ok("the Looks panel's classes never clash with the Link your phone card's (lk- and pl- apart)", () => {
  const cls = (f: string) => new Set([...read(f).matchAll(/\.((?:pl|lk)-[a-z0-9-]+)/g)].map((m) => m[1]));
  const looks = cls("src/views/phonelooks.css"), editor = cls("src/views/phoneeditor.css");
  for (const c of looks) assert.ok(!editor.has(c), c);
  assert.ok([...looks].every((c) => c.startsWith("lk-")));
});

console.log(`\n${n} passed`);

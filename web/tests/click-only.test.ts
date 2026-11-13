// Run: node --experimental-strip-types tests/click-only.test.ts
// V1.57: the task edit panel's options change only on a real click or tap. One-off / Every day / Repeat (and the
// away-reason chips) were DwellButtons that picked themselves after the mouse rested on them ("hover to choose"); a
// friend of the developer's hovered over the panel and it switched by itself. Reads the sources with comments taken out (the
// page code is JSX, which node cannot load, so no DOM here).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const strip = (t: string) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const src = (f: string) => strip(readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"));
const dwell = src("ui/Dwell.tsx"), tm = src("views/TaskMap.tsx"), css = src("views/taskmap.css");

ok("the option button has no hover, pointer or timer code at all", () => {
  for (const bad of [/onMouseEnter/, /onMouseOver/, /onPointerEnter/, /onMouseMove/, /setTimeout/, /useEffect/, /useRef/, /arming/]) assert.doesNotMatch(dwell, bad, String(bad));
});
ok("a click picks it, once, and only when it is not already picked", () => {
  assert.match(dwell, /onClick=\{\(\) => \{ if \(!selected\) onPick\(\); \}\}/);
});
ok("every DwellButton in the list code is plain: no hover time (ms) is passed any more", () => {
  const uses = tm.match(/<DwellButton\b[^\n]*/g) ?? [];
  assert.ok(uses.length >= 5, "the three task types and the two away-reason buttons");
  for (const u of uses) assert.doesNotMatch(u, /\bms=/, u);
});
ok("the edit panel (Editor) switches nothing on hover", () => {
  const i = tm.search(/export function Editor\(/);
  assert.ok(i >= 0);
  const body = tm.slice(i, tm.indexOf("function ClientMail(", i));
  for (const bad of [/onMouseEnter/, /onMouseOver/, /onPointerEnter/, /onMouseMove/, /onPointerOver/]) assert.doesNotMatch(body, bad, String(bad));
});
ok("the priority place picker (- and +) and the date, Today and Tomorrow chips are plain clicks", () => {
  const i = tm.search(/function PriorityPicker\(/);
  const body = tm.slice(i, tm.indexOf("export const taskMapActions", i));
  assert.doesNotMatch(body, /onMouseEnter|onMouseOver|onPointerEnter|setTimeout/);
});
ok("hovering still highlights an option, and the pink hover fill is gone", () => {
  assert.match(css, /\.tm-ed-seg button:not\(\.on\):hover/);
  assert.doesNotMatch(css, /dwell-fill|\.dwell\.arming/);
});
console.log(`${n} of ${n} ok`);

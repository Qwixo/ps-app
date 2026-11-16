// Run: node --experimental-strip-types tests/tzpinned.test.ts
// V1.65 Time zones kept open arrive already open (core/tzpinned.ts, views/TimeZones.tsx, views/tz.css).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { panelMountsStill } from "../src/core/tzpinned.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

ok("kept open and arriving with its page: drawn open, no loop out", () => assert.equal(panelMountsStill(true, false), true));
ok("not kept open: hover opens it the way it always did", () => { assert.equal(panelMountsStill(false, true), false); assert.equal(panelMountsStill(false, false), false); });
ok("kept open but you just opened it (hover, the pin click, Find): the loop out still plays", () => assert.equal(panelMountsStill(true, true), false));
ok("the panel and the css use it", () => {
  const tsx = read("src/views/TimeZones.tsx"), css = read("src/views/tz.css");
  assert.ok(tsx.includes("panelMountsStill(pinned, youOpened.current)") && tsx.includes("instant={instant}"));
  assert.ok(tsx.includes("useState(instant)"), "decided at the first draw, not per render");
  assert.ok(/\.tm-ckdock \.tm-clocks\.still \{ animation: none; \}/.test(css));
  assert.ok(/\.tm-ckdock\.calm \.tz-pin-on \{ animation: none; \}/.test(css));
  for (const k of ["enter = () =>", "togglePin = () =>", "sfx.hover();"]) assert.ok(tsx.includes(k));
  assert.equal((tsx.match(/youOpened\.current = true/g) ?? []).length, 3, "hover, the pin click and Find all count as you opening it");
});
console.log(`\n${n} passed`);

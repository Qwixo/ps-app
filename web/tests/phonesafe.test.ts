// Run: node --experimental-strip-types tests/phonesafe.test.ts
// PS 1.60 phone fixes: full screen panels respect the top safe area, close and minimise are 44 points (core/phonesafe.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TARGET, barTop, clearOfStatusBar, targetOk, targetSize, topInset } from "../src/core/phonesafe.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

ok("the inset is a whole, non negative number", () => {
  assert.equal(topInset(24.4), 25); assert.equal(topInset("31.5px"), 32); assert.equal(topInset(-3), 0);
  assert.equal(topInset(undefined), 0); assert.equal(topInset(NaN), 0); assert.equal(topInset("x"), 0); assert.equal(topInset(0), 0);
});
ok("a bar starts below the status bar plus its gap", () => {
  assert.equal(barTop(30), 38); assert.equal(barTop(0), 8); assert.equal(barTop(30, -5), 30);
  assert.ok(clearOfStatusBar(barTop(30), 30)); assert.ok(!clearOfStatusBar(0, 30)); assert.ok(clearOfStatusBar(0, 0));
});
ok("a close or minimise button is never under 44 points", () => {
  assert.equal(TARGET, 44);
  assert.deepEqual(targetSize(38, 38), { w: 44, h: 44 }); assert.deepEqual(targetSize(34, 60), { w: 44, h: 60 }); assert.deepEqual(targetSize(0, 0), { w: 44, h: 44 });
  assert.ok(targetOk(44, 44)); assert.ok(!targetOk(43, 44)); assert.ok(!targetOk(38, 38));
});
ok("every phone panel gets the real status bar height from one place", () => {
  const css = read("src/gos/gos.css");
  assert.match(css, /--sat: var\(--gos-inset-top, env\(safe-area-inset-top, 0px\)\);/);
  assert.match(css, /--safe-top: var\(--sat\);/);
});
ok("the Soundboard's bar and the other full screen panels use it (never env alone, which is 0 in the Android WebView)", () => {
  const sb = read("src/soundboard/soundboard.css");
  assert.match(sb, /\.sb-layer\.gos \.sb-body \{ padding: calc\(var\(--safe-top, 0px\) \+ 10px\)/);
  assert.match(read("src/gos/gos.css"), /\.sb-layer\.gos \.sb-body \{ padding-top: calc\(var\(--sat, 0px\) \+ 10px\)/);
  for (const f of ["src/views/notes.css", "src/views/sleepmode.css"]) assert.match(read(f), /var\(--sat, env\(safe-area-inset-top, 0px\)\)/, f);
  assert.match(read("src/views/series.css"), /var\(--sat, 0px\)/);
  for (const f of ["src/views/notes.css", "src/views/sleepmode.css"]) assert.ok(!/[^,(\s]\s*env\(safe-area-inset-top\)/.test(read(f).replace(/var\(--sat, env\(safe-area-inset-top, 0px\)\)/g, "")), f);
});
ok("the Soundboard's close button and its neighbours are 44 points on the phone", () => {
  assert.match(read("src/gos/gos.css"), /\.sb-layer\.gos \.sb-icon, \.sb-layer\.gos \.sb-icon\.sb-sm \{ width: 44px; height: 44px; \}/);
  assert.match(read("src/gos/gos.css"), /html\.gos \.fit-bar-b, html\.gos \.fit-chrome-b, html\.gos \.fit-bar-back \{ min-width: 44px; min-height: 44px; \}/);
});
ok("the Mac and the website are untouched: the new variables live only under html.gos", () => {
  const css = read("src/gos/gos.css"); const i = css.indexOf("--sat:");
  assert.ok(css.lastIndexOf("html.gos {", i) > css.lastIndexOf("}", i - 1) - 1 || css.lastIndexOf("html.gos {", i) > 0);
});
console.log(`${n} passed`);

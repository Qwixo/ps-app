// List transparency (core/bgfade.ts, V1.43; the glass slider from V1.34 to V1.42, and again from V1.44). FICTIONAL values.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { backdropFor, backdropLook, backdropOf, bgFade, transparencyOf } from "../src/core/bgfade.ts";
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
ok("fully gone at 100% transparency (saved 0)", () => assert.equal(bgFade(0), 0));
ok("all of it at the usual look", () => { assert.equal(bgFade(50), 1); assert.equal(bgFade(80), 1); });
ok("in between it fades in a straight line, so the first step already shows", () => {
  let last = 0;
  for (let v = 1; v <= 50; v++) { const f = bgFade(v); assert.ok(f > last && f - last <= 0.021, `at ${v}`); last = f; }
  assert.equal(bgFade(25), 0.5);
  assert.equal(bgFade(45), 0.9, "10% transparency already fades the background by a tenth");
});
ok("an unreadable value is the usual look", () => { assert.equal(bgFade(NaN), 1); assert.equal(backdropOf("x"), 50); assert.equal(backdropOf(undefined), 50); });
ok("old saved values from the slider's right half (more solid) now count as the usual look", () => {
  assert.equal(backdropOf(80), 50); assert.equal(backdropOf(100), 50); assert.equal(transparencyOf(100), 0);
  assert.deepEqual(backdropLook(100), backdropLook(50));
});
ok("Settings' percent and the saved value go both ways", () => {
  assert.equal(transparencyOf(50), 0); assert.equal(transparencyOf(0), 100); assert.equal(transparencyOf(25), 50);
  for (let p = 0; p <= 100; p += 10) assert.equal(transparencyOf(backdropFor(p)), p, `at ${p}%`);
  assert.equal(backdropFor(-10), 50); assert.equal(backdropFor(400), 0);
});
ok("the tint and blur: the old usual look at 0%, nothing at 100%", () => {
  assert.deepEqual(backdropLook(50), { tint: "0.580", blur: "16.0px" });
  assert.deepEqual(backdropLook(0), { tint: "0.000", blur: "0.0px" });
});
ok("V1.44: the slider is back at the top of the Tab list, and Settings, Looks keeps List transparency too (PS on a Mac)", () => {
  const map = readFileSync("src/views/TaskMap.tsx", "utf8");
  const bar = map.slice(map.indexOf("function GlassBar("), map.indexOf("// ---------- undo:"));
  // The slider in the top bar: the same saved value as Settings (0 see through to 50 the usual look), left = see through.
  assert.match(bar, /<input type="range" min=\{0\} max=\{BACKDROP_USUAL\} step=\{1\} value=\{value\} className="tm-glass-range" aria-label="List transparency"/);
  assert.match(map, /<GlassBar saved=\{savedBackdrop\} kept=\{kept\}/, "it gets the saved value");
  assert.match(bar, /if \(!PS\) return null;/, "PS on a Mac only, like the Settings row");
  assert.ok(bar.indexOf("if (!PS) return null;") > bar.lastIndexOf("useEffect("), "every hook runs before the early return");
  // Live while dragging (one update per frame, straight on the page and the Mac's glass), saved when let go.
  assert.match(bar, /requestAnimationFrame\(\(\) => \{ previewBackdrop\(v\); void taskMapActions\.backdrop\(v, false\); \}\)/);
  assert.match(bar, /onPointerUp=\{\(e\) => commit\(/);
  assert.match(bar, /void taskMapActions\.backdrop\(v, true\);/);
  // The reset button goes back to the usual look; no public or private gate on the bar (both builds have it).
  assert.match(bar, /setValue\(BACKDROP_USUAL\); commit\(BACKDROP_USUAL\);/);
  assert.ok(!/\bred\b|isRed|PS_RED/.test(bar), "not the developer only");
  // The two sliders follow each other live.
  assert.match(bar, /watchBackdrop\(\(pv\) => setValue\(pv \?\? savedRef\.current\)\)/);
  const lt = readFileSync("src/views/ListTransparency.tsx", "utf8");
  assert.match(lt, /export function previewBackdrop\(v: number \| null\) \{ live\?\.\(v\); watchers\.forEach\(\(w\) => w\(v\)\); \}/);
  assert.match(lt, /watchBackdrop\(\(pv\) => setV\(transparencyOf\(pv \?\? kept\.current\)\)\)/);
  // Its Edit mode name says what it holds.
  assert.match(readFileSync("src/core/tablayout.ts", "utf8"), /\{ id: "glass", label: "Transparency slider, Keep overlay and Hover mode" \}/);
  // V1.43: its own row in Settings, Appearance (views/SettingsGroups.tsx); the index keeps it to PS on a Mac.
  assert.match(readFileSync("src/views/SettingsGroups.tsx", "utf8"), /<ListTransparency saved=\{st\.tmBackdrop\}/);
  assert.match(readFileSync("src/core/settingsindex.ts", "utf8"), /id: "transparency", group: "looks", name: "List transparency", [^\n]*on: MAC/);
  assert.match(map, /const savedBackdrop = backdropOf\(st\.tmBackdrop\);/);
  assert.match(map, /return setLiveBackdrop\(\(pv\) => \{/, "live preview on the list");
  assert.match(readFileSync("src/core/looksoptions.ts", "utf8"), /id: "transparency", title: "List transparency"/);
});
ok("the Light look's backing follows it too (it was solid, so the slider did nothing there)", () => {
  const css = readFileSync("src/views/moresettings.css", "utf8");
  assert.match(css, /\.tm-overlay\.tm-light \{ background: rgba\(14, 11, 13, calc\(var\(--tm-tint, \.58\) \/ \.58\)\);/);
  assert.ok(!/\.tm-overlay\.tm-light \{ background: rgb\(14, 11, 13\);/.test(css));
});
ok("solid looks (Light, Midnight, the productivity looks) thin their cover with it too: the main reason it failed", () => {
  const css = readFileSync("src/looks/looks.css", "utf8");
  assert.match(css, /html\[data-solid\] \.tm-overlay\.tm-see:not\(\.tm-docked\):not\(\.tm-hovermode\) \{\n  background-color: color-mix\(in srgb, var\(--k-base\) var\(--tm-cover, var\(--k-cover, 96%\)\), transparent\);/);
  const map = readFileSync("src/views/TaskMap.tsx", "utf8");
  assert.match(map, /const coverAt = \(v: number\) => opaque \? `\$\{Math\.round\(opaque \* 100 \* backdropOf\(v\) \/ BACKDROP_USUAL\)\}%` : null;/);
  assert.match(map, /\$\{opaque \? " tm-see" : ""\}/);
  assert.ok(!/calc\([^)]*\)[^;]*\) *, *transparent/.test(css.split("tm-see")[1] ?? ""), "no calc inside color-mix");
});
console.log(`${n} of ${n} ok`);

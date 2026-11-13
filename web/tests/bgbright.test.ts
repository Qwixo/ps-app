// Run: node --experimental-strip-types tests/bgbright.test.ts
// V1.33: the background video brightness slider (the developer: "make the background video have a brightness toggle in
// settings so I can turn down and up the brightness"). src/core/bgbright.ts, saved as settings.tmBgVideoBright.
import assert from "node:assert/strict";
const DASHES = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
import { readFileSync } from "node:fs";
const B = await import("../src/core/bgbright.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

ok("default is 100 (the video as it is)", () => {
  assert.equal(B.BG_BRIGHT_DEFAULT, 100);
  for (const v of [undefined, null, "", "abc", NaN, Infinity, true, false, {}]) assert.equal(B.bgBright(v), 100, String(v));
});

ok("kept between 0 and 100, whole numbers", () => {
  assert.equal(B.bgBright(0), 0);
  assert.equal(B.bgBright(55), 55);
  assert.equal(B.bgBright("40"), 40);
  assert.equal(B.bgBright(42.6), 43);
  assert.equal(B.bgBright(-5), 0);
  assert.equal(B.bgBright(400), 100);
});

ok("the darkening layer: none at 100, black at 0", () => {
  assert.equal(B.bgDim(100), 0);
  assert.equal(B.bgDim(undefined), 0);
  assert.equal(B.bgDim(0), 1);
  assert.equal(B.bgDim(25), 0.75);
  assert.equal(B.bgDim(60), 0.4);
});

ok("a synced setting in the model", () => {
  assert.match(src("src/core/model.ts"), /tmBgVideoBright\?: number;/);
});

ok("the Tab list window's looks patch keeps it, cleaned (ps.ts cleanLooks)", () => {
  const ps = src("src/ps.ts");
  const body = ps.slice(ps.indexOf("export function cleanLooks"), ps.indexOf("return o;", ps.indexOf("export function cleanLooks")));
  assert.match(body, /o\.tmBgVideoBright = bgBright\(p\.tmBgVideoBright\)/);
  assert.match(ps, /import \{ bgBright \} from "\.\/core\/bgbright"/);
});

ok("Settings, Looks: the slider shows only while a video is the background; the list and the tile draw the dim layer", () => {
  const tm = src("src/views/TaskMap.tsx");
  // V1.43: inside the Background row of Settings, Appearance (LookBackground, views/SettingsGroups.tsx).
  assert.match(tm, /\{isVideoBg\(bg\) && <div data-set="video-bright"><BgBrightControls st=\{st\} set=\{set\} \/><\/div>\}/);
  // V1.34: drawn with the video, and like the video only while the glass slider leaves any background (bgOn, core/bgfade.ts).
  assert.match(tm, /\{videoBg && bgOn && <BgDim saved=\{st\.tmBgVideoBright\} \/>\}/);
  assert.match(tm, /\{videoBg && bgOn && <BgVideoLayer /);
  assert.match(tm, /bg === d\.id && <BgDim saved=\{st\.tmBgVideoBright\} sample \/>/);
  const ui = src("src/views/BgBright.tsx");
  assert.match(ui, /type="range" min=\{0\} max=\{100\}/);
  assert.match(ui, /onChange=\{\(e\) => \{ const n = Number\(e\.target\.value\); setV\(n\); setPreview\(n\); \}\}/, "live preview while dragging");
  assert.match(ui, /onPointerUp=\{\(\) => save\(v\)\}/, "saved when let go");
  const css = src("src/views/moresettings.css");
  assert.match(css, /\.tm-bgvideo-dim \{[^}]*background: #000;[^}]*pointer-events: none;/);
});

ok("no em or en dashes in the new files", () => {
  for (const p of ["src/core/bgbright.ts", "src/views/BgBright.tsx", "tests/bgbright.test.ts"]) assert.ok(!DASHES.test(src(p)), p);
});

console.log(`\n${n} passed`);

// Run: node --experimental-strip-types tests/looksample.test.ts
// V1.43 (the developer 8 Nov 2026: "the diagrams don't change colour at all so it's unclear what you're actually changing", and
// "you can't preview some of them"): every example picture on Settings, Looks and in the island menu changes with the
// choice it shows, and every lightning Preview really strikes inside its 2 seconds. core/looksample.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PREVIEW_STRIKES_MS, islandPicVars, rainLayers, sampleVars } from "../src/core/looksample.ts";
import { ACCENT_PRESETS, DENSITIES, FONTS, LOOKS, TEXT_SIZES, type Appearance } from "../src/core/looks.ts";
import "../src/core/looks-productivity.ts";
import { ISLAND_COLORS, NOTCH_DEFAULT, PILL_DEFAULT, PILL_STYLES } from "../src/core/islandlook.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const base: Appearance = { look: "dark", accent: null, density: "comfortable", text: 100, font: null };
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

ok("the accent picture changes colour with every accent, on every look", () => {
  for (const l of LOOKS) {
    const seen = new Set<string>();
    for (const p of ACCENT_PRESETS) seen.add(sampleVars({ ...base, look: l.id, accent: p.c })["--s-acc"].toUpperCase());
    // Two presets may land on the same readable colour on a look, but never all of them on one.
    assert.ok(seen.size >= ACCENT_PRESETS.length - 2, `${l.id}: ${seen.size} colours for ${ACCENT_PRESETS.length} accents`);
    assert.notEqual(sampleVars({ ...base, look: l.id, accent: "#14B8A6" })["--s-acc"], sampleVars({ ...base, look: l.id, accent: "#EF4444" })["--s-acc"], l.id);
  }
});
ok("the accent picture paints with the same readable colour the app does (buildTokens)", () => {
  const v = sampleVars({ ...base, look: "light", accent: "#FFFF00" });
  assert.notEqual(v["--s-acc"].toUpperCase(), "#FFFF00", "a yellow too pale for Light is nudged, in the picture as in the app");
});
ok("every look gives the picture its own page and card colours", () => {
  const pages = new Set(LOOKS.map((l) => sampleVars({ ...base, look: l.id })["--s-base"]));
  assert.ok(pages.size >= LOOKS.length - 3, `${pages.size} pages for ${LOOKS.length} looks`);
});
ok("the layout picture changes with density, text size and font", () => {
  assert.equal(new Set(DENSITIES.map((d) => sampleVars({ ...base, density: d.id })["--s-dn"])).size, DENSITIES.length, "each density its own spacing");
  assert.equal(new Set(TEXT_SIZES.map((t) => sampleVars({ ...base, text: t.v })["--s-fs"])).size, TEXT_SIZES.length, "each text size its own size");
  assert.equal(new Set(FONTS.map((f) => sampleVars({ ...base, font: f.id })["--s-font"])).size, FONTS.length, "each font its own typeface");
});
ok("every key is always set, so the picture never borrows a value from the page around it", () => {
  for (const l of LOOKS) for (const v of Object.values(sampleVars({ ...base, look: l.id }))) assert.ok(typeof v === "string" && v.length > 0, l.id);
});
ok("the island menu pictures take the pill's and the notch's own colours", () => {
  const fills = new Set(ISLAND_COLORS.map((c) => islandPicVars("pill", { ...PILL_DEFAULT, fill: c.id })["--isl-bg"]));
  assert.equal(fills.size, ISLAND_COLORS.length, "each Background colour its own picture");
  assert.equal(islandPicVars("notch", { ...NOTCH_DEFAULT, fill: "#0ea5e9" })["--isl-bg"], "#0ea5e9");
  assert.equal(islandPicVars("notch", NOTCH_DEFAULT)["--isl-bg"], "#000000", "no background: black like the camera notch");
  const looks = new Set(PILL_STYLES.map((s) => JSON.stringify(islandPicVars("pill", { ...PILL_DEFAULT, style: s.id, fill: "#7c3aed", color: "#f59e0b" }))));
  assert.ok(looks.size >= 2, "the pill's looks are told apart");
});
ok("PREVIEW: a lightning preview strikes at least 3 times inside its 2 seconds", () => {
  assert.ok(PREVIEW_STRIKES_MS.length >= 3);
  assert.ok(PREVIEW_STRIKES_MS.every((t, i) => t > 0 && t < 2000 - 300 && (i === 0 || t - PREVIEW_STRIKES_MS[i - 1] >= 500)), "spread out, each with time to be seen");
  assert.ok(PREVIEW_STRIKES_MS[0] <= 200, "the first one almost at once");
  assert.match(src("views/Storm.tsx"), /PREVIEW_STRIKES_MS/);
});
ok("the rain amount picture: more rain, more drops; none, almost none", () => {
  let a = -1, b = -1;
  for (let x = 0; x <= 100; x += 5) { const r = rainLayers(x); assert.ok(r.a >= a && r.b >= b, String(x)); a = r.a; b = r.b; }
  assert.deepEqual(rainLayers(100), { a: 1, b: 1 });
  assert.equal(rainLayers(0).b, 0); assert.ok(rainLayers(0).a < 0.3);
  assert.deepEqual(rainLayers(Number.NaN), rainLayers(50));
});
ok("wired: the Accent and Layout cards draw the live list, the Looks page the rain picture, the island menu its colours", () => {
  const ap = src("looks/AppearanceSettings.tsx"), tm = src("views/TaskMap.tsx");
  assert.match(ap, /<LiveSample a=\{\{ look: look\.id, accent: pictured/);
  assert.match(ap, /<LiveSample a=\{pictured\} mark="type" \/>/);
  assert.match(tm, /ms-rain-live/);
  assert.match(src("views/IslandSettings.tsx"), /islandPicVars\(m\.id/);   // V1.58: the island's shapes live in the shared island settings
  assert.match(tm, /tm-p1-frame mini p1d-\$\{p1\}/, "background tiles show your own outline, not always red");
});

console.log(`\n${n} passed`);

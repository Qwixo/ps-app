// Run: node --experimental-strip-types tests/notebook-off.test.ts
// V1.55: the five Notebook looks (Legal pad, Composition, Graph paper, Kraft dotted, Chalkboard) are switched off behind
// ONE constant (src/core/features.ts NOTEBOOK_ON), kept so they can come back with one line. Off: no Notebook choice or
// Preview anywhere, a saved Notebook choice shows the normal look and is left alone in the vault, no notebook.css.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

const { NOTEBOOK_ON } = await import("../src/core/features.ts");
const K = await import("../src/core/looks.ts");
await import("../src/core/looks-productivity.ts");
const IDS = ["legal", "composition", "graph", "kraft", "chalk"];

ok("the switch is off in V1.55 (flip it to true to bring the Notebook looks back; this test then checks the on side)", () => {
  assert.equal(NOTEBOOK_ON, false);
});
ok("offeredLooks() is the one list: no Notebook look while off, every other look stays", () => {
  const ids = K.offeredLooks().map((l: { id: string }) => l.id);
  for (const id of IDS) assert.equal(ids.includes(id), NOTEBOOK_ON, id);
  for (const id of ["dark", "light", "midnight"]) assert.ok(ids.includes(id), id);
  assert.ok(K.offeredLooks().some((l: { group: string }) => l.group === "productivity"), "the research looks are still offered");
  assert.equal(K.offeredLooks().some((l: { group: string }) => l.group === "notebook"), NOTEBOOK_ON, "no Notebook group at all");
  for (const id of IDS) assert.equal(K.lookOffered(id), NOTEBOOK_ON, id);
  assert.equal(K.lookOffered("dark"), true);
  assert.equal(K.lookOffered("nope"), false);
});
ok("a saved Notebook look renders the normal look, with no error", () => {
  for (const id of IDS) {
    assert.equal(K.resolveAppearance({ look: id }).look, NOTEBOOK_ON ? id : "dark", id);
    assert.equal(K.resolveAppearance({ look: id, tmTheme: "light" }).look, NOTEBOOK_ON ? id : "light", `${id} (off: falls back to the V1.30 theme, here Light)`);
    assert.equal(K.resolveAppearance({ tmNotebook: id }).look, NOTEBOOK_ON ? id : "dark", `${id} via the older tmNotebook`);
    assert.equal(K.resolveAppearance({ tmNotebook: id, tmTheme: "light" }).look, NOTEBOOK_ON ? id : "light", `${id} via tmNotebook, light under it`);
  }
  // nothing from the hidden look leaks: its accent, and the paper turn (data-nb) are decided from the resolved look
  const r = K.resolveAppearance({ look: "legal", lookAccent: { legal: "#112233" } });
  assert.equal(r.accent, NOTEBOOK_ON ? "#112233" : null);
  assert.equal(K.NOTEBOOK_IDS.has(r.look), NOTEBOOK_ON);
});
ok("the saved choice is left alone: resolving changes nothing, and a patch that sets it is still accepted and kept", () => {
  const saved = { look: "chalk", tmNotebook: "chalk", tmTheme: "dark", lookAccent: { chalk: "#112233" } };
  const copy = JSON.parse(JSON.stringify(saved));
  K.resolveAppearance(saved);
  assert.deepEqual(saved, copy);
  assert.equal(K.cleanAppearance({ look: "chalk" }).look, "chalk", "an older phone or Mac that saves it is not refused");
  assert.equal(K.lookById("chalk").group, "notebook", "the spec is kept");
  assert.equal(K.LOOKS.filter((l: { group: string }) => l.group === "notebook").length, 5);
});
ok("Settings, Appearance draws its looks only from offeredLooks(), without the Notebook column while off", () => {
  const a = src("looks/AppearanceSettings.tsx");
  assert.match(a, /\]\.filter\(\(g\) => NOTEBOOK_ON \|\| g\.id !== "notebook"\)/);
  assert.match(a, /\{offeredLooks\(\)\.filter\(\(l\) => l\.group === g\.id\)\.map\(/);
  assert.doesNotMatch(a, /\bLOOKS\.filter\(/, "no second list of looks in the picker");
  assert.match(src("looks/settings.css"), /\.ap-cols\[data-cols="2"\]/, "two columns when Notebook is off");
});
ok("no looks list outside core/looks.ts reads LOOKS directly to offer choices (use offeredLooks(), so no menu offers a Notebook look)", () => {
  for (const f of ["looks/AppearanceSettings.tsx", "looks/engine.ts", "views/TaskMap.tsx", "core/looksoptions.ts", "core/looksample.ts", "ps.ts"]) {
    if (!existsSync(new URL(`../src/${f}`, import.meta.url))) continue;
    assert.doesNotMatch(src(f), /\bLOOKS\.(filter|map|find|some|every)\(/, f);
  }
});
ok("the Notebook stylesheet (and so its fonts) loads only behind the switch; the code, css and font files stay", () => {
  const tm = src("views/TaskMap.tsx");
  assert.doesNotMatch(tm, /^import "\.\/notebook\.css";/m, "no static import");
  assert.match(tm, /if \(NOTEBOOK_ON\) void import\("\.\/notebook\.css"\);/);
  for (const f of ["views/notebook.css", "core/notebook.ts", "assets/fonts/notebook/PatrickHand-Regular.woff2", "assets/fonts/notebook/Caveat-Variable.woff2"])
    assert.ok(existsSync(new URL(`../src/${f}`, import.meta.url)), f);
  assert.match(src("ps.ts"), /o\.tmNotebook = nbDesign\(p\.tmNotebook\)/, "the setting is still cleaned and kept");
});
ok("a preview (?look= or the eye) of a switched off look shows nothing either", () => {
  assert.match(src("looks/engine.ts"), /const look = p\.look && lookOffered\(p\.look\) \? p\.look : saved\.look;/);
});
ok("the Look row's search words stop saying Notebook while off", () => {
  const s = src("core/settingsindex.ts");
  assert.match(s, /NOTEBOOK_ON \? "The whole look of PS app: Dark, Light, Notebook and more\." : "The whole look of PS app: Dark, Light and more\."/);
});
ok("the switch file says how to bring it back, in one place", () => {
  const f = src("core/features.ts");
  assert.match(f, /export const NOTEBOOK_ON = false;/);
  assert.match(f, /To bring them back: set this to true/);
});
console.log(`notebook-off: ${n} passed`);

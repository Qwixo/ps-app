// The PS appearance engine (core/looks.ts): every built in look, with every accent preset, every density and text
// size, passes WCAG AA (4.5:1 body text, 3:1 large text and lines); a custom accent is made readable automatically;
// the settings are cleaned; the CSS names no colour of its own outside a token fallback.
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import {
  ACCENT_PRESETS, DEFAULT_LOOK, DENSITIES, LOOKS, TEXT_SIZES, buildTokens, cleanAppearance, contrast, guardFails, guardPairs,
  readable, resolveAppearance, WORK_STYLES, OWN_WORK, workStyle, type Appearance,
} from "../src/core/looks.ts";
import "../src/core/looks-productivity.ts";
import { NOTEBOOK_ON } from "../src/core/features.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const base = (look: string, accent: string | null = null): Appearance => ({ look, accent, density: "comfortable", text: 100, font: null });
const show = (f: ReturnType<typeof guardFails>) => f.map((p) => `${p.what} ${p.fg} on ${p.bg} = ${p.ratio} (needs ${p.min})`).join("\n");

ok("there are classic, notebook and productivity looks, each with a name, a note and a swatch", () => {
  for (const g of ["classic", "notebook"]) assert.ok(LOOKS.some((l) => l.group === g), g);
  for (const l of LOOKS) assert.ok(l.label && l.note && /^[a-z0-9-]+$/.test(l.id), l.id);
  assert.equal(new Set(LOOKS.map((l) => l.id)).size, LOOKS.length, "ids are unique");
});
ok("every built in look passes the contrast guard (text 7:1, muted 4.5:1, faint 3:1, every family)", () => {
  for (const l of LOOKS) { const f = guardFails(base(l.id)); assert.equal(f.length, 0, `${l.id}:\n${show(f)}`); }
});
ok("every look with every accent preset still passes", () => {
  for (const l of LOOKS) for (const p of ACCENT_PRESETS) {
    const f = guardFails(base(l.id, p.c)); assert.equal(f.length, 0, `${l.id} + ${p.c}:\n${show(f)}`);
  }
});
ok("a custom accent that would be unreadable is fixed (yellow on white, navy on black, grey on grey)", () => {
  for (const [look, c] of [["light", "#FFFF00"], ["midnight", "#000080"], ["dark", "#222222"], ["legal", "#FFF200"], ["chalk", "#2D3B35"]] as const) {
    const f = guardFails(base(look, c)); assert.equal(f.length, 0, `${look} + ${c}:\n${show(f)}`);
  }
  assert.ok(contrast(readable("#FFFF00", ["#FFFFFF"], 4.5), "#FFFFFF") >= 4.5);
});
ok("random custom accents on every look always pass", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 300; i++) {
    const c = "#" + Array.from({ length: 3 }, () => Math.floor(rnd() * 256).toString(16).padStart(2, "0")).join("").toUpperCase();
    for (const l of LOOKS) { const f = guardFails(base(l.id, c)); assert.equal(f.length, 0, `${l.id} + ${c}:\n${show(f)}`); }
  }
});
ok("the guard checks real pairs (text, muted, faint, each family on page, card and fill)", () => {
  const pairs = guardPairs(base("light"));
  assert.ok(pairs.length > 30);
  assert.ok(pairs.some((p) => p.what.startsWith("muted")) && pairs.some((p) => p.what.startsWith("text on the acc fill")));
});
ok("the default look with nothing chosen sets no colour token the page uses: it stays the old dark glass", () => {
  const t = buildTokens(base(DEFAULT_LOOK));
  // only the Working on looks' own colours, which nothing else reads
  assert.deepEqual(Object.keys(t).sort(), ["--k-hl", "--k-work-bg", "--k-work-card", "--k-work-edge"]);
});
ok("Working on looks: every style has a name and a note, unknown values fall back to the white glow", () => {
  assert.equal(WORK_STYLES[0].id, "white");
  assert.ok(WORK_STYLES.length >= 7);
  for (const w of WORK_STYLES) assert.ok(w.label && w.note, w.id);
  for (const w of WORK_STYLES) assert.equal(workStyle(w.id), w.id);
  for (const bad of [undefined, null, 3, "", "White", "<x>"]) assert.equal(workStyle(bad), "white");
  const css = readFileSync("src/looks/working.css", "utf8");
  for (const id of OWN_WORK) assert.ok(css.includes(`.ws-${id} `), `working.css draws ${id}`);
  assert.ok(/tm-paused/.test(readFileSync("src/views/taskmap.css", "utf8")), "animations pause while the list is hidden");
});
ok("density and text size become the size tokens", () => {
  for (const d of DENSITIES) for (const s of TEXT_SIZES) {
    const t = buildTokens({ ...base("dark"), density: d.id, text: s.v });
    const fs = Number(t["--k-fs"] ?? 1), dn = Number(t["--k-dn"] ?? 1);
    assert.ok(Math.abs(fs - (s.v / 100) * d.text) < 0.002, `${d.id} ${s.v}`);
    assert.equal(dn, d.space);
  }
});
ok("settings: the V1.30 Light and Notebook choices carry over, unknown values are dropped", () => {
  assert.equal(resolveAppearance({}).look, "dark");
  assert.equal(resolveAppearance({ tmTheme: "light" }).look, "light");
  // Notebook looks are switched off in V1.55 (NOTEBOOK_ON, core/features.ts): then the normal look shows. With it on they win.
  assert.equal(resolveAppearance({ tmNotebook: "kraft", tmTheme: "light" }).look, NOTEBOOK_ON ? "kraft" : "light");
  assert.equal(resolveAppearance({ look: "graph", tmNotebook: "kraft" }).look, NOTEBOOK_ON ? "graph" : "dark");
  assert.equal(resolveAppearance({ look: "nope" }).look, "dark");
  assert.equal(resolveAppearance({ look: "light", lookAccent: { light: "#14B8A6", dark: "#000000" } }).accent, "#14B8A6");
  assert.equal(resolveAppearance({ look: NOTEBOOK_ON ? "graph" : "midnight" }).density, NOTEBOOK_ON ? "dense" : "comfortable");
  assert.deepEqual(cleanAppearance({ look: "x", lookAccent: { light: "red", dark: "#14b8a6", "a b": "#000000" }, lookDensity: "huge", lookText: 400, lookFont: "comic" }),
    { lookAccent: { dark: "#14B8A6" }, lookText: 150 });
  assert.deepEqual(cleanAppearance({ look: "chalk", lookDensity: "dense", lookText: 112, lookFont: null }), { look: "chalk", lookDensity: "dense", lookText: 112, lookFont: null });
});

// ---------- the CSS: no colour outside a token ----------
ok("every PS stylesheet takes its colours, sizes and fonts from the look tokens (the codemod finds nothing left)", () => {
  const r = spawnSync(process.execPath, ["scripts/looks-codemod.mjs", "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
ok("the bundled look fonts are local files with their licences", () => {
  const css = readFileSync("src/looks/looks.css", "utf8");
  assert.ok(!/https?:\/\//.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "no font from the internet");
  for (const m of css.matchAll(/url\("\.\.\/assets\/fonts\/looks\/([^"]+)"\)/g)) assert.ok(statSync(join("src/assets/fonts/looks", m[1])).size > 1000, m[1]);
  for (const f of ["AtkinsonHyperlegibleNext", "AtkinsonHyperlegibleMono", "IBMPlexSans", "IBMPlexMono", "JetBrainsMono", "SourceSerif4"])
    assert.match(readFileSync(`src/assets/fonts/looks/OFL-${f}.txt`, "utf8"), /SIL Open Font License/);
});

console.log(`${n} passed`);

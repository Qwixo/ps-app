// Run: node --experimental-strip-types tests/timelines-classes.test.ts
// V1.64: the Timelines screen (src/views/timelines.css) must be the only stylesheet that defines its own class names.
// V1.55 gave the Lists 'Create a to-do list' pop-up the same global names (.tl-card, .tl-sub, .tl-card-in and the
// keyframes tl-card-in), so the Timelines cards sat on top of each other, centred and half off the left edge. The
// pop-up and the submenu lists now use lp-make* / lp-sub*, and ListPager's list name and empty page use lp-name* /
// lp-empty. No DOM here: the stylesheets and sources are read as text.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const root = new URL("../src/", import.meta.url).pathname;
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(root);
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "");
const css = files.filter((f) => f.endsWith(".css")).map((f) => ({ f: f.slice(root.length), t: strip(readFileSync(f, "utf8")) }));
const defines = (t: string, cls: string) => new RegExp(`\\.${cls}(?![\\w-])`).test(t);
const mine = "views/timelines.css";

ok("timelines.css defines .tl-card and .tl-sub itself", () => {
  const t = css.find((c) => c.f === mine)!.t;
  assert.ok(defines(t, "tl-card") && defines(t, "tl-sub"));
});
for (const cls of ["tl-card", "tl-sub", "tl-name", "tl-empty", "tl-card-in", "tl-card-row", "tl-card-no", "tl-card-go", "tl-sub-i", "tl-sub-none", "tl-name-in"]) {
  ok(`no stylesheet except timelines.css defines .${cls}`, () => {
    const hit = css.filter((c) => c.f !== mine && defines(c.t, cls)).map((c) => c.f);
    assert.deepEqual(hit, [], `.${cls} is also defined in ${hit.join(", ")}`);
  });
}
ok("no stylesheet except timelines.css defines the keyframes tl-card-in", () => {
  const hit = css.filter((c) => c.f !== mine && /@keyframes\s+tl-card-in\b/.test(c.t)).map((c) => c.f);
  assert.deepEqual(hit, []);
});
ok("the Lists pop-up and submenu use their own lp- names, in the stylesheet and in ListPager.tsx", () => {
  const lp = css.find((c) => c.f === "views/listpager.css")!.t;
  for (const cls of ["lp-make", "lp-make-in", "lp-make-row", "lp-make-no", "lp-make-go", "lp-sub", "lp-sub-i", "lp-sub-none"]) assert.ok(defines(lp, cls), cls);
  assert.match(lp, /@keyframes\s+lp-make-in\b/);
  const tsx = readFileSync(join(root, "views/ListPager.tsx"), "utf8");
  assert.doesNotMatch(tsx, /\btl-(card|sub)\b/, "ListPager.tsx still names a Timelines class");
  assert.match(tsx, /\.closest\("[^"]*\.lp-make[^"]*"\)/);
  assert.match(tsx, /document\.querySelector\("[^"]*\.lp-make[^"]*"\)/);
});
ok("the pages that look for the Create pop-up look for .lp-make, not .tl-card", () => {
  for (const f of ["core/overviewnav.ts", "views/Tips.tsx"]) {
    const t = readFileSync(join(root, f), "utf8");
    assert.doesNotMatch(t, /\.tl-card\b/, f);
    assert.match(t, /\.lp-make\b/, f);
  }
});
console.log(`${n} passed`);

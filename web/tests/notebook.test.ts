// Notebook looks for the Tab list (core/notebook.ts, views/notebook.css): the setting is cleaned, every look is
// drawn, the fonts are bundled with their licences, nothing comes from the internet.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { NB_DESIGNS, nbDesign } from "../src/core/notebook.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const css = readFileSync("src/views/notebook.css", "utf8");
/** A selector list split at its top level commas only (not inside :is(...) or [...]). */
const topLevel = (sel: string) => {
  const out: string[] = []; let depth = 0, cur = "";
  for (const ch of sel) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  return [...out, cur];
};
const looks = NB_DESIGNS.map((d) => d.id).filter((id) => id !== "off");

ok("off plus at least four paper looks, each with a name and a note", () => {
  assert.equal(NB_DESIGNS[0].id, "off");
  assert.ok(looks.length >= 4);
  for (const d of NB_DESIGNS) assert.ok(d.label && d.note, d.id);
});
ok("a saved or posted value: known looks pass, anything else is off", () => {
  for (const id of looks) assert.equal(nbDesign(id), id);
  for (const bad of [undefined, null, 3, "", "Legal", "legal ", "<script>", {}]) assert.equal(nbDesign(bad), "off");
});
ok("every look has its tokens, its own artwork and a sample tile", () => {
  for (const id of looks) {
    assert.ok(css.includes(`html[data-nb="${id}"] {`), `tokens for ${id}`);
    assert.ok(css.includes(`html[data-nb="${id}"] .tm-inner`), `page art for ${id}`);
    assert.ok(css.includes(`.nbs-${id} {`), `sample tile for ${id}`);
  }
});
ok("the look only lives under html[data-nb] (the tiles excepted), so the website never changes", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.split("{")[0].trim()).filter((sel) => sel && !sel.startsWith("@") && !/^(from|to|\d+%)$/.test(sel));
  for (const sel of rules) {
    if (sel.startsWith(".nb-sample") || sel.startsWith(".nbs-") || sel.startsWith("src:") || sel.startsWith("font-")) continue;
    for (const part of topLevel(sel)) assert.match(part.trim(), /^html(\.[a-z-]+)?(\[data-nb|\.nb-)/, part.trim());
  }
});
ok("fonts are bundled with their licences, nothing is loaded from the internet", () => {
  const urls = [...css.matchAll(/url\("(\.\.\/assets\/fonts\/notebook\/[^"]+)"\)/g)].map((m) => m[1]);
  assert.equal(urls.length, 4);
  for (const u of urls) assert.ok(existsSync(`src/views/${u}`), u);
  for (const f of ["GochiHand", "PatrickHand", "ArchitectsDaughter", "Caveat"]) assert.ok(readFileSync(`src/assets/fonts/notebook/OFL-${f}.txt`, "utf8").includes("SIL Open Font License"), f);
  assert.doesNotMatch(css, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
});
ok("the Tab list window's looks patch keeps the setting (ps.ts cleanLooks)", () => {
  assert.match(readFileSync("src/ps.ts", "utf8"), /o\.tmNotebook = nbDesign\(p\.tmNotebook\)/);
});
ok("no em or en dashes", () => {
  for (const f of ["src/views/notebook.css", "src/core/notebook.ts", "src/assets/fonts/notebook/README.txt"]) assert.doesNotMatch(readFileSync(f, "utf8"), /[–—]/, f);
});
console.log(`\n${n} passed`);

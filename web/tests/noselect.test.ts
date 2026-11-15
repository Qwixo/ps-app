// Run: node --experimental-strip-types tests/noselect.test.ts
// V1.43 No stray highlighting. The developer, 8 Nov 2026: "occasionally I accidentally select a lot of text ... Stop that and
// fix it so I can't do that again." One base rule (src/ui/noselect.css, imported by styles.css) turns selection off
// on every screen; text boxes and ".selectable" areas keep it; src/ui/noselect.ts stops Cmd A painting the screen.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };

const css = noComments(read("ui/noselect.css"));
const block = (selector: RegExp) => {
  const m = css.match(new RegExp(`${selector.source}[^{]*\\{([^}]*)\\}`));
  assert.ok(m, `no rule for ${selector}`);
  return m[1];
};

ok("the base rule turns selection off on the whole page, WebKit prefix included", () => {
  const b = block(/(?:^|\n)html, body\s*/);
  assert.match(b, /-webkit-user-select:\s*none/);
  assert.match(b, /(^|[^-])user-select:\s*none/);
  assert.match(b, /-webkit-touch-callout:\s*none/);
});

ok("text boxes, editable titles and .selectable areas keep selection", () => {
  const m = css.match(/\n(input[^{]*)\{([^}]*)\}/);
  assert.ok(m, "no opt in rule");
  const [, sel, body] = m;
  for (const part of [/(^|\s)input\b/, /\btextarea\b/, /\[contenteditable\]:not\(\[contenteditable="false"\]\)/, /\.selectable\b/]) assert.match(sel, part);
  assert.doesNotMatch(sel, /:where\(/);   // plain specificity, so a component's own "none" on a container cannot reach the box
  assert.match(body, /-webkit-user-select:\s*text/);
  assert.match(body, /(^|[^-])user-select:\s*text/);
});

ok("styles.css loads the rule before anything else, so every screen gets it", () => {
  const s = noComments(read("styles.css"));
  const imports = [...s.matchAll(/@import\s+"([^"]+)"/g)].map((x) => x[1]);
  assert.ok(imports.includes("./ui/noselect.css"));
  const before = s.slice(0, s.indexOf('@import "./ui/noselect.css"'));
  assert.doesNotMatch(before, /\{/);   // no rule ahead of it (CSS drops an @import that comes after a rule)
});

ok("every entry (Mac overlay and website, PS GOS, mobile web) loads styles.css and starts the Cmd A guard", () => {
  for (const [f, rel] of [["main.tsx", "./"], ["gos/main.tsx", "../"], ["mobile/main.tsx", "../"]] as const) {
    const s = read(f);
    assert.ok(s.includes(`import "${rel}styles.css";`), `${f} does not load styles.css`);
    assert.ok(s.includes(`import { startNoSelect } from "${rel}ui/noselect";`), `${f} does not import the guard`);
    assert.match(s, /\nstartNoSelect\(\);/, `${f} does not start the guard`);
  }
});

ok("nothing switches selection off for the whole page a second way", () => {
  // The old page wide rules (gos.css body, mobile.css screens) are fine; this only guards against a later rule that
  // turns the opt in off for every text box.
  for (const f of ["styles.css", "gos/gos.css", "mobile/mobile.css"]) {
    assert.doesNotMatch(noComments(read(f)), /(^|[\s,}])(input|textarea)\s*\{[^}]*user-select:\s*none/);
  }
});

ok("the areas worth copying opt in: G Squad chat messages, the client's page, approved email words", () => {
  assert.match(read("views/GSquadChat.tsx"), /className="gc-text selectable"/);
  assert.equal((read("views/ClientPortal.tsx").match(/className="cp stack loose selectable"/g) || []).length, 2);
  assert.equal((read("views/Emails.tsx").match(/className="x-frozen selectable"/g) || []).length, 2);
});
ok("Reply from PS: the email being answered can be copied, and every box you type in is a text box", () => {
  const r = read("views/ReplyWindow.tsx");
  assert.match(r, /className="rw-theirs selectable"/);
  assert.match(r, /<textarea ref=\{area\} className="rw-msg"/);
  assert.match(r, /<textarea className="rw-sig-in"/);
  assert.ok(!/contentEditable=\{false\}|user-select:\s*none/.test(r + read("views/reply.css")), "nothing in the panel turns selection off again");
});

// The keyboard half, run for real.
const { isSelectAll } = await import("../src/ui/noselect.ts");
const key = (k: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
ok("Cmd A is select all on a Mac, Ctrl A elsewhere, nothing else is", () => {
  assert.equal(isSelectAll(key("a", { metaKey: true }), true), true);
  assert.equal(isSelectAll(key("A", { metaKey: true }), true), true);
  assert.equal(isSelectAll(key("a", { ctrlKey: true }), true), false);
  assert.equal(isSelectAll(key("a", { ctrlKey: true }), false), true);
  assert.equal(isSelectAll(key("a", { metaKey: true, shiftKey: true }), true), false);
  assert.equal(isSelectAll(key("a", { metaKey: true, altKey: true }), true), false);
  assert.equal(isSelectAll(key("a"), true), false);
  assert.equal(isSelectAll(key("s", { metaKey: true }), true), false);
});

console.log(`\n${n} passed`);

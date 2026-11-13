// Run: node --experimental-strip-types tests/tabstays.test.ts
// Tab keeps the list open (the developer, 7 Nov 2026): on by default for everyone but the developer, off for the developer, a choice kept,
// and its switch visible to everyone in Mac settings (the developer's rule: no feature on without its switch shown).
// PS for Mac holds the setting itself (ps-mac TabWatch.stays, self test area `tabstays`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TAB_STAYS_HINT, tabStaysDefault, tabStaysShown } from "../src/core/tabstays.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

ok("the default is off for the developer and on for anyone else", () => {
  assert.equal(tabStaysDefault(true), false);
  assert.equal(tabStaysDefault(false), true);
});
ok("before PS answers, the switch shows the default for this account (nobody signed in counts as not the developer)", () => {
  assert.equal(tabStaysShown(null, true), false);
  assert.equal(tabStaysShown(undefined, false), true);
  assert.equal(tabStaysShown({}, false), true);
});
ok("once PS answers, its value wins, whoever is signed in (a choice made on this Mac is kept)", () => {
  assert.equal(tabStaysShown({ tabStays: true }, true), true);
  assert.equal(tabStaysShown({ tabStays: false }, false), false);
});
ok("the switch is in Mac settings with the other Tab options, for everyone, and sends the message PS reads", () => {
  const s = read("views/PsSettings.tsx");
  assert.equal((s.match(/<TabStaysSetting \/>/g) || []).length, 1);
  // V1.47: the / then . switch is one of the Tab overlay shortcuts now (views/OpenShortcuts.tsx), above this switch.
  assert.match(s, /<h2 className="h2" id="tk-h">Task list over other apps<\/h2>[\s\S]*<OpenShortcuts permission=\{false\} \/>[\s\S]*<TabStaysSetting \/>/);
  assert.doesNotMatch(s, /red\s*&&\s*<TabStaysSetting/);
  assert.equal((s.match(/type: "psSettings:tabStays", on: (true|false)/g) || []).length, 2);
  assert.match(s, /Tab keeps the list open/);
});
ok("the explanation is one plain line with no dashes", () => {
  assert.doesNotMatch(TAB_STAYS_HINT, /[–—]/);
  assert.doesNotMatch(TAB_STAYS_HINT, /\n/);
});
console.log(`tabstays: ${n} passed`);

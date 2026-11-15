// Run: node --experimental-strip-types tests/updatecard.test.ts
// PS 1.60 phone fixes: the update card's rules (core/updatecard.ts) and its layout (gos/GosUpdate.tsx, gos/gos.css).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardShape, noteLines, sizeText } from "../src/core/updatecard.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

ok("notes become one point per line, never joined", () => {
  assert.deepEqual(noteLines("The camera works in Gym scan\nThe update card is easier to read\n\nPage dots like an iPhone"),
    ["The camera works in Gym scan", "The update card is easier to read", "Page dots like an iPhone"]);
});
ok("bullets and spaces are removed, windows line ends work", () => {
  assert.deepEqual(noteLines("- one\r\n* two\r\n\u2022 three\r\n   four  "), ["one", "two", "three", "four"]);
});
ok("a line with a long dash or a tag is dropped, nothing invented", () => {
  assert.deepEqual(noteLines("fine\nbad \u2014 dash\n<b>tag</b>"), ["fine"]);
});
ok("not text means no notes", () => {
  assert.deepEqual(noteLines(undefined), []); assert.deepEqual(noteLines(42), []); assert.deepEqual(noteLines(""), []);
});
ok("size: one decimal under 10 MB, whole number above, empty for none", () => {
  assert.equal(sizeText(5 * 1048576), "5.0 MB"); assert.equal(sizeText(23 * 1048576), "23 MB");
  assert.equal(sizeText(0), ""); assert.equal(sizeText(undefined), ""); assert.equal(sizeText(-4), "");
});
ok("an update that waits: notes list, size on its own, button full width", () => {
  const s = cardShape("available", "a\nb", 12 * 1048576, 1);
  assert.deepEqual(s.notes, ["a", "b"]); assert.equal(s.size, "12 MB"); assert.equal(s.wide, true);
});
ok("several versions: the grouped list shows the notes, not the card's own", () => {
  assert.deepEqual(cardShape("available", "a\nb", 1048576, 3).notes, []);
});
ok("ready to install has the wide button and no notes; up to date has neither", () => {
  assert.equal(cardShape("ready", "a", 1, 1).wide, true); assert.deepEqual(cardShape("ready", "a", 1, 1).notes, []);
  assert.equal(cardShape("none", "a", 1, 1).wide, false);
});
ok("the card puts the button under the notes, full width, and the notes are a list", () => {
  const t = read("src/gos/GosUpdate.tsx"), css = read("src/gos/gos.css");
  assert.ok(t.indexOf('className="gos-upd-notes"') < t.indexOf("gos-upd-go"), "notes, then the button");
  assert.ok(!/gos-upd-top[\s\S]{0,2000}Update now[\s\S]{0,200}<\/div>\s*\n\s*\{blocks/.test(t) || t.indexOf("gos-upd-go") > t.indexOf("gos-upd-notes"));
  assert.match(css, /\.gos-upd \.gos-upd-go \{ width: 100%/);
  assert.match(css, /\.gos-upd-notes li/);
});
ok("no long dashes in the new files", () => {
  for (const f of ["src/core/updatecard.ts", "src/gos/GosUpdate.tsx"]) assert.ok(!/[\u2013\u2014]/.test(read(f)), f);
});
console.log(`${n} passed`);

// Run: node --experimental-strip-types tests/invertswipe.test.ts
// V1.57 Settings, Controls, Invert swipe (the developer, 13 Nov 2026: "make an option in settings ... to make it inverted. And
// make that accessible via the API as well"): the sign, every place a page swipe moves, the setting row and search,
// and that it is synced like other settings. Reads sources with comments taken out; no DOM.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const L = await import("../src/core/lists.ts");
const S = await import("../src/core/settingsindex.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const src = (f: string) => strip(readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"));

ok("off by default: nothing changes; on: every move goes the other way", () => {
  for (const v of [undefined, null, false, "true", 1]) assert.equal(L.swipeSign(v), 1, String(v));
  assert.equal(L.swipeSign(true), -1);
  assert.equal(L.swiped(120, undefined), 120);
  assert.equal(L.swiped(120, true), -120);
  assert.equal(L.swiped(-0.8, true), 0.8);
});
ok("the Mac trackpad (both list menu directions) flips with it", () => {
  for (const dir of ["push", "drag"] as const) {
    const plain = L.pageDx(50, dir);
    assert.equal(L.swiped(L.pageDx(50, dir), true), -plain, dir);
  }
});
ok("every page swipe goes through it: trackpad and its release, a finger and its release, the phone's panes and pages of panels", () => {
  const lp = src("views/ListPager.tsx");
  assert.equal((lp.match(/swiped\(pageDx\(/g) || []).length, 3, "the trackpad: start, move and release");
  assert.match(lp, /g\.pager\.move\(swiped\(dx, ctx\.st\.swipeInvert\)\)/, "a finger");
  assert.match(lp, /swiped\(speed\(g\.samples\), ctx\.st\.swipeInvert\)/, "a finger's release");
  assert.ok(!/g\.pager!?\.move\(pageDx\(/.test(lp) && !/g\.pager\.move\(dx\)/.test(lp), "no move left unflipped");
  assert.match(src("gos/GosLayer.tsx"), /const x = swiped\(e\.touches\[0\]\.clientX - sx, invert\)/, "the phone's panes");
  assert.match(src("gos/GosLayer.tsx"), /invert=\{settingsData\(s\)\.swipeInvert === true\}/);
  assert.match(src("gos/PhonePages.tsx"), /const x = swiped\(e\.touches\[0\]\.clientX - sx, invert\)/, "the phone's pages of panels");
});
ok("synced like other settings: in the settings record, and the Tab list's save is let through on the main page", () => {
  assert.match(src("core/model.ts"), /swipeInvert\?: boolean;/);
  assert.match(src("ps.ts"), /if \(typeof p\.swipeInvert === "boolean"\) o\.swipeInvert = p\.swipeInvert;/);
});
ok("Settings: a Controls tab with the Invert swipe row on every device, and search finds it", () => {
  const g = S.GROUPS.find((x) => x.id === "controls")!;
  assert.equal(g.label, "Controls");
  const e = S.settingById("invert-swipe")!;
  assert.equal(e.group, "controls");
  assert.equal(e.name, "Invert swipe");
  for (const where of ["mac", "web", "phone"] as const) {
    const ctx = { where, red: false };
    assert.ok(S.visibleTo(e, ctx), where);
    for (const q of ["invert swipe", "swipe direction", "reverse swipe", "flip swipe"]) assert.equal(S.searchSettings(q, ctx)[0]?.e.id, "invert-swipe", `${where}: ${q}`);
  }
  assert.match(src("views/SettingsGroups.tsx"), /"invert-swipe": function InvertSwipe/);
  assert.match(src("views/SettingsGroups.tsx"), /on=\{settingsData\(v\)\.swipeInvert === true\}/, "off unless switched on");
});

console.log(`\n${n} invert swipe tests passed`);

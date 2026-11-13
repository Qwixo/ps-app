// Run: node --experimental-strip-types tests/islandfullscreen.test.ts
// Over a full screen app the Dynamic Island glides to the top left black band beside the notch (the developer, 12 Nov 2026: "make
// it so the dynamic island does a fancy animation so it moves itself up to the top left of the screen instead"). The
// glide, the place and the full screen check are native (ps-mac tests/island-place-test.swift); this checks the setting:
// on by default, only an explicit false switches it off, it reaches the Mac, and it shows in both settings places for
// every account (public build included).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const I = await import("../src/core/island.ts");
const X = await import("../src/core/settingsindex.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const base = { todos: [], today: "2026-11-12", mail: 0, leads: 0, event: null };
const S = (island: unknown) => I.islandState({ ...base, settings: { island } as never });
const src = (p: string) => readFileSync(p, "utf8");

ok("on by default (nothing saved yet)", () => {
  assert.equal(I.islandPrefs(undefined).fsMove, true);
  assert.equal(I.islandPrefs({}).fsMove, true);
  assert.equal(I.ISLAND_DEFAULT.fsMove, true);
});
ok("only an explicit false switches it off", () => {
  assert.equal(I.islandPrefs({ fsMove: false }).fsMove, false);
  for (const v of [true, "false", 0, null, 1, "off", {}]) assert.equal(I.islandPrefs({ fsMove: v }).fsMove, true, String(v));
});
ok("it travels to the Mac in the island state, on and off, also with the island off", () => {
  assert.equal(S({}).fsMove, true);
  assert.equal(S({ fsMove: false }).fsMove, false);
  assert.equal(S({ mode: "off", fsMove: false }).fsMove, false);
});
ok("other island choices are untouched by it", () => {
  const p = I.islandPrefs({ fsMove: false, cards: false, hide: 300 });
  assert.equal(p.cards, false);
  assert.equal(p.hide, 300);
});
ok("the row is in Settings > Mac > Dynamic Island and in the Tab list's island menu, for everyone", () => {
  const set = src("src/views/PsSettings.tsx"), tm = src("src/views/TaskMap.tsx"), row = src("src/views/IslandCards.tsx");
  assert.match(set, /<IslandFullScreenRow prefs=\{prefs\}/);
  assert.match(tm, /\{PS && <IslandFullScreenRow /);
  // no account gate on the row itself (public build has every feature)
  const fn = row.slice(row.indexOf("export function IslandFullScreenRow"), row.indexOf("export const ISLAND_CARDS_LABEL"));
  assert.ok(fn.length > 0 && !/isRedAccount|red\b/.test(fn));
  assert.match(row, /ISLAND_FS_LABEL = "Move to the top left in full screen"/);
});
ok("Settings search finds it by full screen words", () => {
  const e = X.settingById("island")!;
  for (const w of ["full screen", "fullscreen", "top left"]) assert.ok(e.words!.includes(w), w);
});
ok("no em or en dashes in the new words", () => {
  const row = src("src/views/IslandCards.tsx");
  assert.ok(!/[–—]/.test(row));
});
console.log(`${n} ok`);

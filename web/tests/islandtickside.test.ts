// Run: node --experimental-strip-types tests/islandtickside.test.ts
// The developer, 12 Nov 2026: "when the circle to tick is on the right when the dynamic island is left alone. But when I hover my
// mouse over the dynamic island, the circle moves from the right to the left WHY??? Make it so it's always on the left.
// Make this adjustable in the dynamic island settings too". Cause: the resting row (pill and Drop) drew the tick last
// and the open row drew it first. Now one setting, left by default, places it in every state (ps-mac Island.swift,
// tickLeft); this checks the setting, that it reaches the Mac, and the rows in both settings places.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const I = await import("../src/core/island.ts");
const X = await import("../src/core/settingsindex.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const base = { todos: [], today: "2026-11-12", mail: 0, leads: 0, event: null };
const S = (island: unknown) => I.islandState({ ...base, settings: { island } as never });
const src = (p: string) => readFileSync(p, "utf8");

ok("left by default", () => {
  assert.equal(I.ISLAND_DEFAULT.tickSide, "left");
  assert.equal(I.islandPrefs(undefined).tickSide, "left");
  assert.equal(I.islandPrefs({}).tickSide, "left");
});
ok("only \"right\" puts it on the right; anything else is left", () => {
  assert.equal(I.islandPrefs({ tickSide: "right" }).tickSide, "right");
  for (const v of ["left", "Right", "RIGHT", 1, null, true, {}, "middle"]) assert.equal(I.islandPrefs({ tickSide: v }).tickSide, "left", String(v));
});
ok("it reaches the Mac in the island state, also with the island off", () => {
  assert.equal(S({}).tickSide, "left");
  assert.equal(S({ tickSide: "right" }).tickSide, "right");
  assert.equal(S({ mode: "off", tickSide: "right" }).tickSide, "right");
});
ok("other island choices are untouched", () => {
  const p = I.islandPrefs({ tickSide: "right", fsMove: false, hide: 300 });
  assert.equal(p.fsMove, false);
  assert.equal(p.hide, 300);
});
ok("the row is in Settings > Mac > Dynamic Island and in the Tab list's island menu, for everyone", () => {
  // V1.58: in the shared island settings (views/IslandSettings.tsx): the window, Settings > Dynamic Island, the Mac page.
  assert.match(src("src/views/IslandSettings.tsx"), /\{PS && <IslandTickSideRow /);
  assert.match(src("src/views/PsSettings.tsx"), /<IslandSettingsPage prefs=\{prefs\}/);
  const row = src("src/views/IslandCards.tsx");
  const fn = row.slice(row.indexOf("export function IslandTickSideRow"), row.indexOf("export const ISLAND_CARDS_LABEL"));
  assert.ok(fn.length > 0 && !/isRedAccount|\bred\b/.test(fn));
  assert.match(row, /ISLAND_TICK_LABEL = "Tick circle side"/);
  assert.match(fn, />Left</); assert.match(fn, />Right</);
});
ok("Settings search finds it", () => {
  const e = X.settingById("island")!;
  for (const w of ["tick", "circle", "side"]) assert.ok(e.words!.includes(w), w);
});
ok("no em or en dashes", () => {
  for (const f of ["src/views/IslandCards.tsx", "src/core/island.ts"]) assert.ok(!/[–—]/.test(src(f)), f);
});
console.log(`${n} ok`);

// A rest time you can type (V1.47, src/fitness/RestNum.tsx, core/fitness.ts parseRest): what it reads, the limits,
// and that every place a rest time is set uses it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REST_MAX, REST_MIN, clampRest, parseRest } from "../src/core/fitness.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

ok("minutes and seconds: 1:45, 0:30, 10:00", () => {
  assert.equal(parseRest("1:45"), 105);
  assert.equal(parseRest(" 0:30 "), 30);
  assert.equal(parseRest("10:00"), 600);
  assert.equal(parseRest("2:5"), 125);
});
ok("a bare number is seconds: 105, 105 s, 90sec, 45 seconds", () => {
  assert.equal(parseRest("105"), 105);
  assert.equal(parseRest("105 s"), 105);
  assert.equal(parseRest("90sec"), 90);
  assert.equal(parseRest("45 seconds"), 45);
});
ok("minutes: 2m, 2 min, 1.5 min, 1,5m", () => {
  assert.equal(parseRest("2m"), 120);
  assert.equal(parseRest("2 MIN"), 120);
  assert.equal(parseRest("1.5 min"), 90);
  assert.equal(parseRest("1,5m"), 90);
});
ok("minutes and seconds in words: 1m30, 1 min 30 s", () => {
  assert.equal(parseRest("1m30"), 90);
  assert.equal(parseRest("1 min 30 s"), 90);
  assert.equal(parseRest("2m 5s"), 125);
});
ok("kept to 5 s to 15 min, to the second", () => {
  assert.deepEqual([REST_MIN, REST_MAX], [5, 900]);
  assert.equal(parseRest("2"), 5);
  assert.equal(parseRest("1:07"), 67, "no rounding to 5 s any more");
  assert.equal(parseRest("20:00"), 900);
  assert.equal(parseRest("99m"), 900);
  assert.equal(clampRest(NaN), 5);
});
ok("bad input is not read (the old time stays)", () => {
  for (const t of ["", "   ", "abc", "1:75", "-30", "0", "0:00", "1:2:3", "2h", "m", "1:", ":30", "1 m 30 m"]) assert.equal(parseRest(t), null, JSON.stringify(t));
});
ok("tap the number, Enter or tap away saves, Esc cancels, the wheel steps 15 s", () => {
  const r = src("fitness/RestNum.tsx");
  assert.match(r, /if \(e\.key === "Enter"\) \{ e\.preventDefault\(\); e\.currentTarget\.blur\(\); \}/);
  assert.match(r, /else if \(e\.key === "Escape"\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); skip\.current = true;/);
  assert.match(r, /onBlur=\{save\}/);
  assert.match(r, /onWheel=\{wheel\}/);
  assert.doesNotMatch(r, /[–—]/);
});
ok("every place a rest time is set uses it, and keeps -15 and +15", () => {
  const s = src("fitness/FitSettings.tsx"), p = src("fitness/Programs.tsx"), g = src("fitness/Gym.tsx");
  assert.match(s, /<RestNum value=\{value\} label=\{title\}/);
  assert.match(s, />-15<\/button>[\s\S]{0,200}<RestNum[\s\S]{0,300}>\+15<\/button>/);
  assert.match(p, /<RestNum value=\{rest \?\? defRest\} label="Rest between sets"/);
  assert.match(g, /-15 s<\/button>\s*<RestNum value=\{secs\} label="Rest for this exercise"[^\n]*\n\s*<button[^\n]*>\+15 s<\/button>/);
});
console.log(`${n} checks passed`);

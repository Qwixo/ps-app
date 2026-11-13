// V1.47: the analogue clocks in Time zones (src/core/clockface.ts, src/views/TimeZones.tsx Face). On a friend's Mac
// with a "Larger text" display PS zooms the page to 0.8 to 0.9, and WebKit scaled the hands' px pivot with it: the
// hands swung around a point up and left of the centre. These hold the hand angles and the 0,0 pivot.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FACE, handAngles } from "../src/core/clockface.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const at = (h: number, m: number, s = 0) => Date.UTC(2026, 10, 10, h, m, s);
const near = (a: number, b: number, why: string) => assert.ok(Math.abs(a - b) < 1e-6, `${why}: ${a} vs ${b}`);

ok("12:00:00 UTC: every hand straight up", () => {
  const a = handAngles(at(12, 0), 0);
  near(a.h, 0, "hour"); near(a.m, 0, "minute"); near(a.s, 0, "second");
});
ok("6:28 PM UTC (the photo): hour just past half way to 7, minute just before 6, both pointing down", () => {
  const a = handAngles(at(18, 28), 0);
  near(a.h, 6 * 30 + 28 * 0.5, "hour 194"); near(a.m, 28 * 6, "minute 168");
});
ok("Dubai is 4 hours ahead: 10:28 PM there, the hour hand near 10", () => {
  const a = handAngles(at(18, 28), 240);
  near(a.h, 10 * 30 + 28 * 0.5, "hour 314"); near(a.m, 168, "minute the same");
});
ok("half hour and 45 minute zones (India, Nepal) move the minute hand too", () => {
  near(handAngles(at(12, 0), 330).m, 180, "India +5:30: minute on 6");
  near(handAngles(at(12, 0), 345).m, 270, "Nepal +5:45: minute on 9");
});
ok("behind UTC (Pacific, -8): angles stay 0 to 360", () => {
  const a = handAngles(at(2, 15), -480);   // 6:15 PM the day before
  near(a.h, 6 * 30 + 15 * 0.5, "hour"); near(a.m, 90, "minute on 3");
  for (const v of [a.h, a.m, a.s]) assert.ok(v >= 0 && v < 360);
});
ok("the second hand jumps whole seconds; hour and minute sweep", () => {
  assert.equal(handAngles(at(12, 0, 7) + 900, 0).s, 42);
  near(handAngles(at(12, 30, 30), 0).m, 183, "minute sweeps with the seconds");
});
ok("every moment of a day: angles in range, and the hour hand moves 1/12 as fast as the minute hand", () => {
  for (let t = at(0, 0); t < at(24, 0); t += 97_000) {
    const a = handAngles(t, 0);
    for (const v of [a.h, a.m, a.s]) assert.ok(v >= 0 && v < 360, `${t}`);
    near((a.h * 12) % 360, a.m, "12 to 1");
  }
});

// The faces: hands drawn from 0,0 in a group moved to the centre, turned around 0,0 (no px pivot anywhere).
const tsx = readFileSync(new URL("../src/views/TimeZones.tsx", import.meta.url), "utf8");
const css = ["tz.css", "tz-people.css"].map((f) => readFileSync(new URL(`../src/views/${f}`, import.meta.url), "utf8")).join("\n");
ok("the hands sit in a group translated to the face's centre and start at 0,0", () => {
  assert.ok(tsx.includes(`<g className="ck-hands" transform="translate(${FACE.c} ${FACE.c})">`));
  for (const k of ["ck-h", "ck-m", "ck-s"]) assert.match(tsx, new RegExp(`<line x1="0" y1="[0-9.]+" x2="0" y2="-[0-9.]+" className="${k}"`), k);
  assert.ok(tsx.includes(`viewBox="0 0 ${FACE.size} ${FACE.size}"`));
});
ok("no hand turns around a px pivot (WebKit scales it with the page zoom)", () => {
  assert.doesNotMatch(css, /line\.ck-[hms][^{]*\{[^}]*transform-origin:\s*[0-9.]+px/);
  const rules = css.match(/line\.ck-h, [^{]*\{[^}]*\}/g) ?? [];
  assert.equal(rules.length, 3, "list, compare card and found person faces");
  for (const r of rules) assert.match(r, /transform-origin: 0 0/);
});
ok("no other SVG part pivots on px either (Fitness donut, the update arrow)", () => {
  const nav = readFileSync(new URL("../src/fitness/nav.css", import.meta.url), "utf8");
  const mu = readFileSync(new URL("../src/views/macupdate.css", import.meta.url), "utf8");
  assert.doesNotMatch(nav, /\.fit-donut-hole \{[^}]*transform-origin: *[0-9.]+px/);
  assert.doesNotMatch(mu, /\.mu-i-ref g \{[^}]*transform-origin: *[0-9.]+px/);
});
ok("your own clock reads You with the city underneath, never cut short in the name", () => {
  assert.ok(tsx.includes('name="You" gap={homeLabel()} you'));
});

console.log(`clockface: ${n} passed`);

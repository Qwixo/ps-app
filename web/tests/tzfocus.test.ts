// Run: node --experimental-strip-types tests/tzfocus.test.ts
// V1.65 Time zones: click a zone (core/tzfocus.ts), and the 30 minute arrows on Convert a time (core/tzconvert.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusReduce, isRowClick, tallBox, relBox, springAt, springDuration, springFrames, lerpBox } from "../src/core/tzfocus.ts";
import { stepTyped, shiftTime, parseTyped, HALF_STEP } from "../src/core/tzconvert.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const NY = { tz: "America/New_York", name: "New York" }, LA = { tz: "America/Los_Angeles", name: "Pacific" };

ok("a click focuses the zone", () => assert.deepEqual(focusReduce(null, { type: "click", ...NY }), NY));
ok("clicking another zone switches", () => assert.deepEqual(focusReduce(NY, { type: "click", ...LA }), LA));
ok("clicking the same zone again goes back to the list", () => assert.equal(focusReduce(NY, { type: "click", ...NY }), null));
ok("back (chevron or Esc) goes to the list, and from the list it stays there", () => {
  assert.equal(focusReduce(NY, { type: "back" }), null);
  assert.equal(focusReduce(null, { type: "back" }), null);
});
ok("a zone taken off the list while focused goes back, others stay", () => {
  assert.equal(focusReduce(NY, { type: "gone", zones: [LA.tz] }), null);
  assert.deepEqual(focusReduce(NY, { type: "gone", zones: [NY.tz, LA.tz] }), NY);
});
ok("only a real click on a row counts: not buttons, boxes, a drag tail or the You row", () => {
  const plain = { closest: () => null }, btn = { closest: () => ({}) };
  assert.equal(isRowClick(plain, 1000, true), true);
  assert.equal(isRowClick(btn, 1000, true), false);
  assert.equal(isRowClick(plain, 100, true), false);
  assert.equal(isRowClick(plain, 1000, false), false);
  assert.equal(isRowClick(null, 1000, true), false);
});
ok("the tall card covers the list's box exactly, and grows only as far as the content and the room allow", () => {
  const list = { left: 24, top: 20, width: 300, height: 420 };
  assert.deepEqual(tallBox(list, 300, 800), list);
  assert.equal(tallBox(list, 600, 800).height, 600);
  assert.equal(tallBox(list, 900, 700).height, 700);
  assert.equal(tallBox(list, 900, 200).height, 420, "never shorter than the list");
  assert.deepEqual(relBox({ left: 50, top: 70, width: 10, height: 20 }, { left: 20, top: 30 }), { left: 30, top: 40, width: 10, height: 20 });
});
ok("the spring starts at 0, overshoots a little, settles at 1 and ends exactly on 1", () => {
  const f = springFrames(36);
  assert.equal(f[0], 0); assert.equal(f[36], 1);
  const peak = Math.max(...f);
  assert.ok(peak > 1.005 && peak < 1.15, `overshoot ${peak}`);
  assert.ok(springDuration() > 0.2 && springDuration() < 1.2, `duration ${springDuration()}`);
  assert.ok(springAt(0.1) > 0 && springAt(0.1) < 1);
  assert.equal(springAt(-1), 0);
  assert.ok(f.slice(0, 8).every((v, i, a) => i === 0 || v > a[i - 1]), "rises at the start");
});
ok("lerpBox goes from one box to the other", () => {
  const a = { left: 0, top: 0, width: 100, height: 50 }, b = { left: 10, top: 20, width: 300, height: 400 };
  assert.deepEqual(lerpBox(a, b, 0), a); assert.deepEqual(lerpBox(a, b, 1), b);
  assert.equal(lerpBox(a, b, 0.5).width, 200);
  assert.equal(lerpBox(a, { ...b, width: 0 }, 5).width, 0, "never negative");
});

// ----- the 30 minute arrows -----
const up = (t: string, from?: { h: number; mi: number; h12: boolean }) => stepTyped(t, "half", 1, from);
const down = (t: string, from?: { h: number; mi: number; h12: boolean }) => stepTyped(t, "half", -1, from);
ok("the step is 30 minutes", () => assert.equal(HALF_STEP, 30));
ok("3pm up is 3:30pm, again 4pm; the 12 hour look stays", () => {
  assert.deepEqual(up("3pm"), { text: "3:30pm", days: 0 });
  assert.deepEqual(up("3:30pm"), { text: "4:00pm", days: 0 });
  assert.deepEqual(down("3pm"), { text: "2:30pm", days: 0 });
  assert.deepEqual(up("3 PM"), { text: "3:30 PM", days: 0 });
  assert.deepEqual(up("3:30 p.m."), { text: "4:00 pm", days: 0 });
});
ok("the 24 hour look stays: 14:00 and 1430", () => {
  assert.deepEqual(up("14:00"), { text: "14:30", days: 0 });
  assert.deepEqual(down("14:00"), { text: "13:30", days: 0 });
  assert.deepEqual(up("1430"), { text: "1500", days: 0 });
  assert.deepEqual(up("09:30"), { text: "10:00", days: 0 });
  assert.deepEqual(down("9:30"), { text: "9:00", days: 0 });
});
ok("a zone word stays: 2pm PT", () => assert.deepEqual(up("2pm PT"), { text: "2:30pm PT", days: 0 }));
ok("across midnight the day moves: 11:30pm up is 12am, the next day; 12am down is 11:30pm, the day before", () => {
  assert.deepEqual(up("11:30pm"), { text: "12:00am", days: 1 });
  assert.deepEqual(down("12am"), { text: "11:30pm", days: -1 });
  assert.deepEqual(up("23:30"), { text: "0:00", days: 1 });
  assert.deepEqual(down("0:00"), { text: "23:30", days: -1 });
  assert.deepEqual(down("00:15"), { text: "00:00", days: 0 });
});
ok("noon and midnight words work, and 12pm up is 12:30pm", () => {
  assert.deepEqual(up("noon"), { text: "12:30pm", days: 0 });
  assert.deepEqual(up("12pm"), { text: "12:30pm", days: 0 });
  assert.deepEqual(down("12:30am"), { text: "12:00am", days: 0 });
});
ok("off the half hour snaps to it first, in the direction of the click", () => {
  assert.deepEqual(up("2:07pm"), { text: "2:30pm", days: 0 });
  assert.deepEqual(down("2:07pm"), { text: "2:00pm", days: 0 });
  assert.deepEqual(up("2:45pm"), { text: "3:00pm", days: 0 });
  assert.deepEqual(down("2:45pm"), { text: "2:30pm", days: 0 });
});
ok("many clicks add up exactly, and the result still reads as a time", () => {
  let text = "3pm", days = 0;
  for (let i = 0; i < 100; i++) { const r = up(text)!; text = r.text; days += r.days; }
  const p = parseTyped(text)!;
  assert.equal(days, 2); assert.equal(p.h * 60 + p.mi, (15 * 60 + 100 * 30) % 1440);
  for (let i = 0; i < 100; i++) { const r = down(text)!; text = r.text; days += r.days; }
  assert.equal(text, "3:00pm"); assert.equal(days, 0);
});
ok("an empty box starts from the clock now on the half hour, in the panel's clock style", () => {
  assert.deepEqual(up("", { h: 14, mi: 12, h12: true }), { text: "2:30pm", days: 0 });
  assert.deepEqual(down("", { h: 14, mi: 12, h12: true }), { text: "2pm", days: 0 });
  assert.deepEqual(up("", { h: 14, mi: 12, h12: false }), { text: "14:30", days: 0 });
  assert.equal(up(""), null, "nothing to start from");
});
ok("text that is not a time is left alone", () => { assert.equal(up("banana", { h: 1, mi: 0, h12: true }), null); });
ok("hour and quarter hour steps still work as before", () => {
  assert.deepEqual(shiftTime(14, 0, "hour", 1), { h: 15, mi: 0, days: 0 });
  assert.deepEqual(shiftTime(14, 7, "min", 1), { h: 14, mi: 15, days: 0 });
  assert.deepEqual(stepTyped("3pm", "min", 1), { text: "3:15pm", days: 0 });
});

// ----- the view uses them -----
ok("the view wires click, back, Esc, the arrows and the arrow keys", () => {
  const tsx = read("src/views/TimeZones.tsx"), css = read("src/views/tz.css");
  for (const k of ["focusReduce(", "isRowClick(", "tallBox(", "springFrames(", "tm-cv-half", 'nudge("half"', "Back to the list", "prefers-reduced-motion"]) assert.ok(tsx.includes(k), k);
  assert.ok(css.includes(".tm-cmp.focus") && css.includes(".tm-cv-half"));
});
console.log(`\n${n} passed`);

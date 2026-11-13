// Scrolling the time on the converter (core/tzconvert.ts, the developer 7 Nov 2026): an hour a notch over the
// hour, a quarter hour over the minutes, a day over the date, up is later, the day moves past midnight,
// the typed look is kept, and a trackpad swipe never fires dozens of steps.
import assert from "node:assert/strict";
import { DRAG_PX, MIN_STEP, WHEEL_GAP, WHEEL_MS, WHEEL_PX, convertWall, dragSteps, newWheel, notchesOf, parseTyped, partAt, shiftTime, stepTyped, timeSpans, wheelStep } from "../src/core/tzconvert.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const step = (s: string, part: "hour" | "min", k: number) => stepTyped(s, part, k);

ok("the minutes step a quarter hour", () => assert.equal(MIN_STEP, 15));

ok("an hour up and down", () => {
  assert.deepEqual(shiftTime(14, 0, "hour", 1), { h: 15, mi: 0, days: 0 });
  assert.deepEqual(shiftTime(14, 30, "hour", -3), { h: 11, mi: 30, days: 0 });
});
ok("past midnight the day moves with it, both ways", () => {
  assert.deepEqual(shiftTime(23, 0, "hour", 1), { h: 0, mi: 0, days: 1 });
  assert.deepEqual(shiftTime(0, 30, "hour", -1), { h: 23, mi: 30, days: -1 });
  assert.deepEqual(shiftTime(23, 45, "min", 1), { h: 0, mi: 0, days: 1 });
  assert.deepEqual(shiftTime(0, 0, "min", -1), { h: 23, mi: 45, days: -1 });
  assert.deepEqual(shiftTime(22, 0, "hour", 30), { h: 4, mi: 0, days: 2 });
});
ok("minutes off the quarter snap to it first", () => {
  assert.deepEqual(shiftTime(14, 7, "min", 1), { h: 14, mi: 15, days: 0 });
  assert.deepEqual(shiftTime(14, 7, "min", -1), { h: 14, mi: 0, days: 0 });
  assert.deepEqual(shiftTime(14, 7, "min", 2), { h: 14, mi: 30, days: 0 });
  assert.deepEqual(shiftTime(14, 15, "min", 1), { h: 14, mi: 30, days: 0 });
});
ok("an hour step keeps odd minutes unless asked to snap", () => {
  assert.deepEqual(shiftTime(14, 37, "hour", 1), { h: 15, mi: 37, days: 0 });
  assert.deepEqual(shiftTime(14, 37, "hour", 1, true), { h: 15, mi: 0, days: 0 });
  assert.deepEqual(shiftTime(14, 37, "hour", -1, true), { h: 14, mi: 0, days: 0 });
});

ok("12 hour times keep their look", () => {
  assert.deepEqual(step("2pm", "hour", 1), { text: "3pm", days: 0 });
  assert.deepEqual(step("11am", "hour", 1), { text: "12pm", days: 0 });
  assert.deepEqual(step("12pm", "hour", -1), { text: "11am", days: 0 });
  assert.deepEqual(step("2 PM", "hour", 1), { text: "3 PM", days: 0 });
  assert.deepEqual(step("2p", "hour", -1), { text: "1p", days: 0 });
  assert.deepEqual(step("2:30pm", "hour", 1), { text: "3:30pm", days: 0 });
  assert.deepEqual(step("2 p.m.", "hour", 1), { text: "3 pm", days: 0 });
});
ok("12 hour across midnight", () => {
  assert.deepEqual(step("11pm", "hour", 1), { text: "12am", days: 1 });
  assert.deepEqual(step("12am", "hour", -1), { text: "11pm", days: -1 });
  assert.deepEqual(step("11:45pm", "min", 1), { text: "12:00am", days: 1 });
});
ok("minutes on a time with none add them", () => {
  assert.deepEqual(step("2pm", "min", 1), { text: "2:15pm", days: 0 });
  assert.deepEqual(step("2pm", "min", -1), { text: "1:45pm", days: 0 });
  assert.deepEqual(step("14", "min", 1), { text: "14:15", days: 0 });
  assert.deepEqual(step("2:45pm", "min", 1), { text: "3:00pm", days: 0 });
});
ok("24 hour times keep their separator and padding", () => {
  assert.deepEqual(step("14:00", "hour", 1), { text: "15:00", days: 0 });
  assert.deepEqual(step("14.30", "min", 1), { text: "14.45", days: 0 });
  assert.deepEqual(step("14h00", "hour", -1), { text: "13h00", days: 0 });
  assert.deepEqual(step("1430", "min", 1), { text: "1445", days: 0 });
  assert.deepEqual(step("930", "hour", 1), { text: "1030", days: 0 });
  assert.deepEqual(step("0930", "hour", -1), { text: "08:30".replace(":", ""), days: 0 });
  assert.deepEqual(step("23:00", "hour", 1), { text: "0:00", days: 1 });
  assert.deepEqual(step("0030", "min", -3), { text: "2345", days: -1 });
});
ok("noon and midnight become clock times", () => {
  assert.deepEqual(step("noon", "hour", 1), { text: "1pm", days: 0 });
  assert.deepEqual(step("midnight", "min", -1), { text: "11:45pm", days: -1 });
});
ok("a zone word at the end stays", () => {
  assert.deepEqual(step("2pm PT", "hour", 1), { text: "3pm PT", days: 0 });
  assert.deepEqual(step("9am eastern time", "min", 1), { text: "9:15am eastern time", days: 0 });
  assert.equal(parseTyped("3pm PT")?.zone, "America/Los_Angeles");
});
ok("every stepped text still reads as the time it should be", () => {
  const starts = ["2pm", "2:30pm", "14:00", "1430", "930", "0930", "14h00", "2 PM", "noon", "11:45pm", "2pm PT", "12am", "0", "00:00"];
  for (const s of starts) for (const part of ["hour", "min"] as const) for (const k of [-5, -1, 1, 7]) {
    const r = step(s, part, k)!;
    const a = parseTyped(s)!, b = parseTyped(r.text);
    assert.ok(b, `${s} ${part} ${k} gave ${r.text}`);
    const want = shiftTime(a.h, a.mi, part, k);
    assert.deepEqual([b.h, b.mi, r.days], [want.h, want.mi, want.days], `${s} ${part} ${k} gave ${r.text}`);
    assert.equal(b.zone, a.zone, `${s} kept its zone`);
  }
});
ok("an empty box starts from the clock now, on the hour", () => {
  assert.deepEqual(stepTyped("", "hour", 1, { h: 14, mi: 37, h12: true }), { text: "3pm", days: 0 });
  assert.deepEqual(stepTyped("", "hour", -1, { h: 14, mi: 37, h12: true }), { text: "2pm", days: 0 });
  assert.deepEqual(stepTyped("", "min", 1, { h: 14, mi: 37, h12: true }), { text: "2:45pm", days: 0 });
  assert.deepEqual(stepTyped("", "hour", 1, { h: 23, mi: 10, h12: false }), { text: "0:00", days: 1 });
  assert.deepEqual(stepTyped("  ", "hour", 1, { h: 9, mi: 0, h12: false }), { text: "10:00", days: 0 });
});
ok("half typed text is left alone", () => {
  assert.equal(stepTyped("2:3", "hour", 1, { h: 9, mi: 0, h12: true }), null);
  assert.equal(stepTyped("abc", "min", 1), null);
});

ok("where the hour and minutes are in the text", () => {
  assert.deepEqual(timeSpans("2:30pm"), { hour: [0, 1], min: [2, 4], end: 6 });
  assert.deepEqual(timeSpans("1430"), { hour: [0, 2], min: [2, 4], end: 4 });
  assert.deepEqual(timeSpans("930"), { hour: [0, 1], min: [1, 3], end: 3 });
  assert.deepEqual(timeSpans("2pm PT"), { hour: [0, 1], min: null, end: 3 });
  assert.deepEqual(timeSpans("2 30 pm"), { hour: [0, 1], min: [2, 4], end: 7 });
  assert.deepEqual(timeSpans("noon"), { hour: [0, 4], min: null, end: 4 });
  assert.equal(timeSpans("nope"), null);
});
ok("pointing at the minutes or the am/pm moves minutes, anything else the hour", () => {
  assert.equal(partAt("2:30pm", 0), "hour");
  assert.equal(partAt("2:30pm", 2), "min");
  assert.equal(partAt("2:30pm", 5), "min");
  assert.equal(partAt("2:30pm", 6), "hour");    // the empty box after the text
  assert.equal(partAt("11pm", 1), "hour");
  assert.equal(partAt("11pm", 2), "min");
  assert.equal(partAt("1430", 3), "min");
  assert.equal(partAt("2pm PT", 4), "hour");    // the zone word
  assert.equal(partAt("", 0), "hour");
});

ok("a mouse notch is one step, up is later", () => {
  const w = newWheel();
  assert.equal(wheelStep(w, 3, 0, 1), 1);
  assert.equal(wheelStep(w, -3, 10, 1), -1);
  assert.equal(wheelStep(w, 0, 20, 1), 0);
});
ok("how many notches a wheel event is", () => {
  assert.equal(notchesOf(-100, 0), 1);                 // Chrome, one notch
  assert.equal(notchesOf(300, 0), 3);                  // a fast spin in one event
  assert.equal(notchesOf(-1200, 0), 5);                // never more than 5 at once
  assert.equal(notchesOf(3, 1), 1);                    // Firefox lines
  assert.equal(notchesOf(37.5, 0), 0);                 // a trackpad
  assert.equal(notchesOf(40, 0), 0);
  assert.equal(notchesOf(0, 1), 0);
});
ok("a fast spin sent as one event moves every notch", () => {
  assert.equal(wheelStep(newWheel(), -300, 0, notchesOf(-300, 0)), -3);
});
ok("the first move of a trackpad gesture steps at once, then it takes a while", () => {
  const w = newWheel();
  assert.equal(wheelStep(w, 6, 1000), 1);
  let s = 0;
  for (let i = 1; i <= 5; i++) s += wheelStep(w, 6, 1000 + i * 16);
  assert.equal(s, 0);
});
ok("a feather light touch alone does nothing, a little more steps once", () => {
  const w = newWheel();
  assert.equal(wheelStep(w, 1, 0), 0);
  assert.equal(wheelStep(w, 2, 16), 0);
  let s = 0;
  for (let i = 2; i < 12; i++) s += wheelStep(w, 2, i * 16);
  assert.equal(s, 1);
});
ok("slow mouse notches as small pixel moves (WebKit) still step one each", () => {
  const w = newWheel();
  let s = 0;
  for (let i = 0; i < 4; i++) s += wheelStep(w, 40, i * (WHEEL_GAP + 80));
  assert.equal(s, 4);
});
ok("a long trackpad swipe with momentum stays a handful of steps", () => {
  const w = newWheel();
  let s = 0, t = 0, px = 0;
  // A hard swipe: 20 events of 30 px, then a momentum tail that slowly dies (about 1200 px in all).
  for (let i = 0; i < 20; i++) { s += wheelStep(w, 30, t); t += 16; px += 30; }
  for (let v = 30; v >= 1; v *= 0.9) { s += wheelStep(w, v, t); t += 16; px += v; }
  assert.ok(s >= 5 && s <= Math.ceil(px / WHEEL_PX) + 1, `steps ${s} for ${Math.round(px)} px`);
  assert.ok(s < 24, `steps ${s}`);
});
ok("never more than one smooth step every WHEEL_MS", () => {
  const w = newWheel();
  let s = 0;
  for (let i = 0; i < 10; i++) s += wheelStep(w, 500.5, i * 5);   // 10 huge smooth events in 45 ms
  assert.ok(s <= 2, `steps ${s}`);
  assert.ok(WHEEL_MS >= 40);
});
ok("turning round mid swipe goes the other way without a jump", () => {
  const w = newWheel();
  assert.equal(wheelStep(w, 40, 0), 1);
  assert.equal(wheelStep(w, -20, 100), 0);
  assert.equal(wheelStep(w, -35, 200), 0);
  assert.equal(wheelStep(w, -20, 260), -1);
});
ok("after a pause it starts afresh", () => {
  const w = newWheel();
  wheelStep(w, 2, 0);
  assert.equal(wheelStep(w, 25, WHEEL_GAP + 50), 1);
});

ok("phone drag: a step every DRAG_PX up or down", () => {
  assert.equal(dragSteps(DRAG_PX - 1, 0), 0);
  assert.equal(dragSteps(DRAG_PX, 0), 1);
  assert.equal(dragSteps(DRAG_PX * 3 + 5, 1), 2);
  assert.equal(dragSteps(-DRAG_PX * 2, 0), -2);
  assert.equal(dragSteps(-DRAG_PX, -2), 1);
});

ok("a stepped time converts live: 11pm Pacific to midnight moves Dubai too", () => {
  const r = step("11pm", "hour", 1)!;
  const t = parseTyped(r.text)!;
  const c = convertWall({ y: 2026, mo: 11, d: 7 + r.days }, t.h, t.mi, "America/Los_Angeles", "Asia/Dubai");
  assert.equal(c.kind, "ok");
  if (c.kind === "ok") assert.deepEqual([c.hit.at.d, c.hit.at.h], [8, 12]);
});

console.log(`\n${n} passed`);

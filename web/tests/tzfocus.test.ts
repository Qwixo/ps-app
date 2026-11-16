// Run: node --experimental-strip-types tests/tzfocus.test.ts
// V1.65 Time zones: click a zone (core/tzfocus.ts), and the 30 minute arrows on Convert a time (core/tzconvert.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { focusReduce, isRowClick, tallBox, relBox, springAt, springDuration, springFrames, lerpBox, morphFrames, repeatGap, swapDir, focusOnMount, TZ_TONES } from "../src/core/tzfocus.ts";
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
  for (const k of ["focusReduce(", "isRowClick(", "tallBox(", "morphFrames(", "repeatGap(", "swapDir(", "focusOnMount(", "tm-cv-half", 'nudge("half"', "Back to the list", "prefers-reduced-motion", 'feature("tz-focus")', 'sfx.tz("open")', 'sfx.tz("back")']) assert.ok(tsx.includes(k), k);
  assert.ok(css.includes(".tm-cmp.focus") && css.includes(".tm-cv-half"));
  // reduced motion: big motion and sounds become a plain swap
  assert.ok(/if \(next && !reducedMotion\(\)\) sfx\.tz\("open"\)/.test(tsx), "no chime with reduced motion");
  assert.ok(/if \(reducedMotion\(\)\) \{ finishBack\(\); return; \}/.test(tsx), "back is a plain swap with reduced motion");
  assert.ok(css.includes(".tm-cmp.focus::after, .tz-f-glow, .tm-ck.tz-landed, .tm-cv-half { animation: none; }"), "the glow rests with reduced motion");
  // never takes the keyboard: nothing in the tall card calls focus()
  const card = tsx.slice(tsx.indexOf("function FocusCard("), tsx.indexOf("// ---------- the person found"));
  assert.ok(card.length > 1000 && !/\.focus\(\)/.test(card) && !/autoFocus/.test(card));
  // hover is untouched: the hover card still opens from the row's mouse enter, and only while no zone is open tall
  assert.ok(tsx.includes("if (focusRef.current) return;   // V1.65") && tsx.includes("{cmp && !focus && <Compare"));
});

// ----- the morph, the hold, switching, the sounds -----
const A = { left: 400, top: 120, width: 900, height: 420 }, B = { left: 0, top: 80, width: 300, height: 700 };
ok("the morph starts on the first box, squeezes a little, springs and ends exactly on the second", () => {
  const { frames, ms } = morphFrames(A, B, { r0: 28, r1: 20 });
  assert.deepEqual({ ...frames[0], offset: 0, radius: 28 }, frames[0]);
  assert.equal(frames[0].left, A.left); assert.equal(frames[0].width, A.width);
  const sq = frames[1];
  assert.ok(sq.width < A.width && sq.width > A.width * 0.95 && sq.left > A.left, "a small squeeze around the middle");
  const last = frames[frames.length - 1];
  assert.deepEqual([last.left, last.top, last.width, last.height, last.offset, last.radius], [B.left, B.top, B.width, B.height, 1, 20]);
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].offset >= frames[i - 1].offset, "offsets only go up");
  assert.ok(frames.every((f) => f.width >= 0 && f.height >= 0));
  assert.ok(ms > 300 && ms < 1400, `a calm length (${ms} ms)`);
  assert.ok(frames.some((f) => f.width < B.width), "the spring overshoots a little");
});
ok("back into the row: no squeeze, no wobble under the row, shorter", () => {
  const row = { left: 18, top: 300, width: 288, height: 64 };
  const out = morphFrames(B, row, { out: true, r0: 20, r1: 12 }), inn = morphFrames(A, B);
  assert.equal(out.frames[1].offset > 0.02, true);
  assert.ok(out.frames.every((f) => f.height >= row.height - 12), "never folds far past the row");
  assert.ok(out.ms < inn.ms);
});
ok("hold an arrow: one step, a pause, then quicker and quicker, never faster than 55 ms", () => {
  assert.equal(repeatGap(0), 380);
  assert.ok(repeatGap(1) < repeatGap(0) && repeatGap(5) < repeatGap(1));
  assert.equal(repeatGap(100), 55);
  // twenty steps of 30 minutes held from 11pm land 10 hours later, the next day
  let t = "11pm", days = 0;
  for (let i = 0; i < 20; i++) { const r = stepTyped(t, "half", 1)!; t = r.text; days += r.days; }
  assert.deepEqual([t, days], ["9:00am", 1]);   // once it has minutes it keeps them, so the width never jumps while held
});
ok("switching zones slides the way the list runs", () => {
  const ids = ["a", "b", "c"];
  assert.equal(swapDir(ids, "a", "c"), 1);
  assert.equal(swapDir(ids, "c", "a"), -1);
});
ok("a panel kept open comes back with the open zone, only while it is still on the list", () => {
  assert.deepEqual(focusOnMount(true, NY, [NY.tz]), NY);
  assert.equal(focusOnMount(false, NY, [NY.tz]), null);
  assert.equal(focusOnMount(true, NY, [LA.tz]), null);
  assert.equal(focusOnMount(true, null, [NY.tz]), null);
});
ok("the sounds are soft, and the Mac has the same numbers", () => {
  for (const k of ["open", "back", "up", "down"] as const) {
    assert.ok(TZ_TONES[k].length > 0 && TZ_TONES[k].every((t) => t.peak <= 0.08 && t.dur <= 0.6));
  }
  assert.ok(TZ_TONES.up[0].dur < 0.05 && TZ_TONES.down[0].dur < 0.05, "the tick is tiny");
  const swift = readFileSync(new URL("../../mac/Sources/Sfx.swift", import.meta.url), "utf8");
  for (const k of ["open", "back", "up", "down"] as const) {
    const line = swift.slice(swift.indexOf(`"tz-${k}": [`), swift.indexOf("],", swift.indexOf(`"tz-${k}": [`)));
    assert.ok(line.length > 10, `tz-${k} in Sfx.swift`);
    for (const t of TZ_TONES[k]) assert.ok(line.includes(`f: ${t.f}, to: ${t.to ?? "nil"}, dur: ${t.dur}, peak: ${t.peak}, wave: ${t.wave}, at: ${t.at}`), `tz-${k} ${t.f}`);
  }
  assert.ok(read("src/ui/sfx.ts").includes("viaApp(`tz-${kind}`)"));
});
ok("registered: features.json, a Settings switch, the tour", () => {
  const reg = JSON.parse(readFileSync(new URL("../../features.json", import.meta.url), "utf8")).features;
  const f = reg.find((x: { id: string }) => x.id === "tz-focus");
  assert.ok(f && f.owner === "jan" && f.scope === "shared" && f.since === "1.65" && f.default === "on");
  assert.ok(read("src/core/settingsindex.ts").includes('id: "tz-focus", group: "time"'));
  assert.ok(read("src/views/SettingsGroups.tsx").includes('"tz-focus": function TzFocus'));
  assert.ok(read("src/core/tour.ts").includes('ids: ["tz-focus"]'));
});
console.log(`\n${n} passed`);

// Looks (V1.40): every Preview shows the part it changes (the preview bug), the plain words for each setting, colour
// backgrounds and rain. Pure modules only: core/lookspreview.ts, core/looksoptions.ts, core/bgcolour.ts, core/rain.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NO_STAGE, SCENES, bgLayers, previewStage, type StageCtx } from "../src/core/lookspreview.ts";
import { LOOKS_OPTIONS, PART_SHOWN, looksOption } from "../src/core/looksoptions.ts";
import { BG_COLOURS, colourBgCss, colourBgLabel, customColourBg, customOf, hexColour, isColourBg, pickerColour, pickerOf } from "../src/core/bgcolour.ts";
import { BG_DESIGNS, bgDesign } from "../src/core/prio.ts";
import { MAX_DROPS, RAIN_KINDS, rainAmount, rainKind, rainRuns, rainSpec } from "../src/core/rain.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

// The state where the developer saw the wrong thing: nothing in Priority 1, nothing marked working on, glass slider at the bottom.
const bare: StageCtx = { hasP1: false, hasWorking: false, hasTasks: true, bgFade: 0, notebook: false, reduced: false };
const busy: StageCtx = { hasP1: true, hasWorking: true, hasTasks: true, bgFade: 1, notebook: false, reduced: false };
const draw = (bg: string, c: StageCtx, previewing: boolean) => bgLayers({ bg, docked: false, hasP1: c.hasP1, fade: c.bgFade, sliding: false, rain: false,
  stage: previewing ? previewStage("bg", bg, c) : NO_STAGE });

ok("PREVIEW BUG: every background preview is on screen, even with no Priority 1 and the glass slider at the bottom", () => {
  const ids = [...BG_DESIGNS.map((d) => d.id), ...BG_COLOURS.map((c) => `color:${c.id}`), customColourBg("#336699")].filter((id) => id !== "none");
  for (const id of ids) {
    const l = draw(id, bare, true);
    assert.ok(l.drawn, `${id} preview draws nothing`);
    assert.equal(l.fade, 1, `${id} preview is invisible (fade ${l.fade})`);
  }
  for (const id of SCENES) assert.ok(draw(id, bare, true).p1, `${id} points at a Priority 1 group that is not there`);
});
ok("PREVIEW BUG: an Outline preview always has a Priority 1 group to draw round", () => {
  const s = previewStage("outline", null, bare);
  assert.equal(s.sampleP1, true);
  assert.ok(s.note && /example Priority 1 group/.test(s.note));
  assert.equal(previewStage("outline", null, busy).sampleP1, false, "real Priority 1 tasks: no example");
  assert.match(previewStage("outline", null, { ...busy, notebook: true }).note ?? "", /Notebook/);
});
ok("PREVIEW BUG: a Working on preview always has a task to show it on", () => {
  assert.equal(previewStage("work", null, bare).sampleWorking, true);
  assert.equal(previewStage("work", null, busy).sampleWorking, false);
  assert.equal(previewStage("work", null, { ...bare, hasTasks: false }).sampleWorking, false, "an empty list has no task to mark");
});
ok("outside a preview nothing is staged and the glass slider still hides backgrounds", () => {
  assert.deepEqual(previewStage(null, null, bare), NO_STAGE);
  assert.equal(draw("storm-forked", bare, false).drawn, false);
  assert.equal(draw("spotlight", bare, false).drawn, false, "no Priority 1, no scene");
  assert.equal(draw("spotlight", busy, false).drawn, true);
  assert.equal(draw("color:ocean", busy, false).fade, 1);
  assert.equal(draw("none", busy, true).drawn, false);
});
ok("the slider being dragged keeps a background drawn; something filling the screen gives the list solid cards", () => {
  const l = bgLayers({ bg: "color:plum", docked: false, hasP1: false, fade: 0, sliding: true, rain: false, stage: NO_STAGE });
  assert.ok(l.drawn && l.colour && l.calm);
  assert.ok(bgLayers({ bg: "none", docked: false, hasP1: false, fade: 1, sliding: false, rain: true, stage: NO_STAGE }).calm, "rain gives solid cards");
  assert.equal(bgLayers({ bg: "color:plum", docked: true, hasP1: false, fade: 1, sliding: false, rain: true, stage: NO_STAGE }).drawn, false, "never on the website's To-do page");
});
ok("the Tab list draws what these rules say (not its own copy of them)", () => {
  const src = readFileSync(new URL("../src/views/TaskMap.tsx", import.meta.url), "utf8");
  assert.ok(src.includes("bgLayers({ bg: bgLook"), "TaskMap uses bgLayers");
  assert.ok(src.includes("previewStage(peekNow.part"), "TaskMap uses previewStage");
  assert.ok(src.includes('list={p1List}'), "the Priority 1 section gets the example group");
  assert.ok(src.includes("working: workingShown"), "the sections get the staged working task");
  assert.ok(!/hasP1 && \["spotlight"/.test(src), "the old scene rule is gone");
  const scr = readFileSync(new URL("../src/views/SettingsScreen.tsx", import.meta.url), "utf8");
  assert.ok(scr.includes("setPeekPart(part)") && scr.includes("setPeekPart(null)"), "a preview names its part and clears it");
});

ok("every Looks option says what it changes: unique ids, one plain line, no dashes, for everyone", () => {
  const ids = new Set<string>();
  for (const o of LOOKS_OPTIONS) {
    assert.ok(!ids.has(o.id), `duplicate ${o.id}`); ids.add(o.id);
    assert.ok(o.changes.length > 30 && o.changes.length < 140, `${o.id}: one line`);
    assert.ok(/^(Changes|Adds|Fills|Plays|Shows)\b/.test(o.changes), `${o.id}: starts with what it does`);
    for (const t of [o.title, o.changes, o.when ?? ""]) assert.ok(!/[–—]/.test(t), `${o.id}: no em or en dash`);
    assert.ok(o.everyone, `${o.id} is in the public build`);
    assert.ok(o.part in PART_SHOWN);
  }
  for (const id of ["look", "accent", "working", "density", "textSize", "font", "outline", "background", "bgColour", "rain", "rainAmount"]) looksOption(id);
  assert.throws(() => looksOption("nope"));
  for (const t of Object.values(PART_SHOWN)) assert.ok(!/[–—]/.test(t));
});

ok("colour backgrounds: presets and custom colours are backgrounds, anything else is not", () => {
  for (const c of BG_COLOURS) {
    assert.ok(isColourBg(`color:${c.id}`));
    assert.equal(bgDesign(`color:${c.id}`), `color:${c.id}`);
    assert.equal(colourBgCss(`color:${c.id}`), c.css);
    assert.ok(!/[–—]/.test(c.label));
  }
  assert.equal(BG_COLOURS.filter((c) => c.kind === "gradient").length >= 6 && BG_COLOURS.filter((c) => c.kind === "solid").length >= 8, true);
  assert.equal(customColourBg("#ABC"), "color:#aabbcc");
  assert.equal(bgDesign("color:#aabbcc"), "color:#aabbcc");
  assert.equal(colourBgCss("color:#aabbcc"), "#aabbcc");
  assert.equal(customOf("color:#aabbcc"), "#aabbcc");
  assert.equal(customOf("color:ocean"), null);
  assert.match(colourBgLabel("color:#aabbcc"), /AABBCC/);
  for (const bad of ["color:url(x)", "color:#12345", "color:red;}", "colour:ocean", "color:", 5, null]) {
    assert.equal(isColourBg(bad), false, String(bad));
    assert.equal(bgDesign(bad as string), "none");
  }
  assert.equal(hexColour("zz"), null);
});
ok("the colour picker gives a real colour and finds its sliders again", () => {
  for (let h = 0; h < 360; h += 15) for (const sh of [0, 25, 50, 75, 100]) {
    const c = pickerColour(h, sh);
    assert.match(c, /^#[0-9a-f]{6}$/);
    const back = pickerOf(c);
    assert.ok(Math.abs(back.shade - sh) <= 2, `shade ${sh} came back ${back.shade}`);
    if (sh > 0 && sh < 100) assert.ok(Math.min(Math.abs(back.hue - h), 360 - Math.abs(back.hue - h)) <= 3, `hue ${h} came back ${back.hue}`);
  }
});

ok("rain: at least 4 kinds, off by default, amount 0 to 100 with 50 by default", () => {
  assert.ok(RAIN_KINDS.filter((k) => k.id !== "off").length >= 4);
  assert.equal(rainKind(undefined), "off");
  assert.equal(rainKind("hail"), "off");
  assert.equal(rainKind("glass"), "glass");
  assert.equal(rainAmount(undefined), 50);
  assert.equal(rainAmount(""), 50);
  assert.equal(rainAmount(140), 100);
  assert.equal(rainAmount(-3), 0);
  assert.equal(rainAmount("33.6"), 34);
  for (const k of RAIN_KINDS) assert.ok(!/[–—]/.test(k.label + k.note));
});
ok("rain stays cheap: off draws nothing, more rain means more drops, never over the cap", () => {
  assert.equal(rainSpec("off", 100, 1440, 900).drops, 0);
  for (const k of RAIN_KINDS.filter((x) => x.id !== "off")) {
    const lo = rainSpec(k.id, 0, 1440, 900).drops, hi = rainSpec(k.id, 100, 1440, 900).drops;
    assert.ok(lo > 0 && hi > lo, `${k.id}: ${lo} to ${hi}`);
    assert.ok(rainSpec(k.id, 100, 7680, 4320).drops <= MAX_DROPS, `${k.id} on a huge screen`);
  }
  assert.ok(rainSpec("storm", 50, 1440, 900).flash, "the storm flashes");
  assert.equal(rainSpec("steady", 50, 1440, 900).flash, null);
  assert.ok(rainSpec("glass", 50, 1440, 900).glass);
});
ok("rain runs only while the list is showing, the page is visible and Reduce motion is off", () => {
  const on = { kind: "steady" as const, shown: true, visible: true, reduced: false, docked: false };
  assert.equal(rainRuns(on), true);
  assert.equal(rainRuns({ ...on, shown: false }), false);
  assert.equal(rainRuns({ ...on, visible: false }), false);
  assert.equal(rainRuns({ ...on, reduced: true }), false);
  assert.equal(rainRuns({ ...on, docked: true }), false);
  assert.equal(rainRuns({ ...on, kind: "off" }), false);
  assert.match(previewStage("rain", null, { ...busy, reduced: true }).note ?? "", /Reduce motion/);
});

console.log(`\n${n} passed`);

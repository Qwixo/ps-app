// The Overdue card's own look (core/overduelook.ts, views/OverdueLook.tsx, V1.44): Settings, Appearance, Overdue card.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OVERDUE_BGS, OVERDUE_DEFAULT, OVERDUE_FX, OVERDUE_TEXTS, cleanOverdue, cleanOverdueLook, isDefaultOverdue, overdueFx,
  overdueFxShown, overdueLookOf, overdueSaved, overdueSummary, overdueVars, readableOn, sameOverdue,
} from "../src/core/overduelook.ts";
import { contrast } from "../src/core/prio.ts";
import { SETTINGS } from "../src/core/settingsindex.ts";
import { LOOKS_OPTIONS, PART_SHOWN, looksOption } from "../src/core/looksoptions.ts";
import { previewStage } from "../src/core/lookspreview.ts";
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

ok("defaults: no colour, automatic text, no effect, and the card gets no colours at all (it looks exactly as before)", () => {
  assert.deepEqual(OVERDUE_DEFAULT, { bg: null, text: null, fx: "none" });
  assert.deepEqual(overdueLookOf({}), OVERDUE_DEFAULT);
  assert.deepEqual(overdueLookOf(undefined), OVERDUE_DEFAULT);
  assert.deepEqual(overdueLookOf(null), OVERDUE_DEFAULT);
  assert.ok(isDefaultOverdue(overdueLookOf({})));
  assert.deepEqual(overdueVars(OVERDUE_DEFAULT), {});
  assert.equal(overdueFxShown("none", false), "none");
});

ok("migration: settings from before V1.44 (no tmOverdue) and every odd saved value read as the default", () => {
  for (const v of [undefined, null, "red", 5, true, [], ["#ff0000"], () => 1]) assert.deepEqual(cleanOverdue(v), OVERDUE_DEFAULT, String(v));
  assert.deepEqual(overdueLookOf({ tmOverdue: undefined }), OVERDUE_DEFAULT);
  assert.deepEqual(overdueLookOf({ tmOverdue: null }), OVERDUE_DEFAULT);
  // a part of it: the rest is the default
  assert.deepEqual(cleanOverdue({ bg: "#E0182D" }), { bg: "#e0182d", text: null, fx: "none" });
  assert.deepEqual(cleanOverdue({ fx: "lightning" }), { bg: null, text: null, fx: "lightning" });
  // colours in any case, "#rgb" and no "#", cleaned; anything that is not a colour dropped
  assert.deepEqual(cleanOverdue({ bg: "abc", text: "#FFF", fx: "glow" }), { bg: "#aabbcc", text: "#ffffff", fx: "glow" });
  assert.deepEqual(cleanOverdue({ bg: "url(x)", text: "red;}", fx: "glow" }), { bg: null, text: null, fx: "glow" });
  // an effect this build does not know (say from a newer PS on the other Mac) shows as None, never breaks the card
  assert.equal(cleanOverdue({ fx: "tornado" }).fx, "none");
  assert.equal(overdueFx(7), "none");
  // unknown keys are not kept
  assert.deepEqual(Object.keys(cleanOverdue({ bg: "#000000", extra: 1 })).sort(), ["bg", "fx", "text"]);
});

ok("saving: only what is needed, the default saves as null, and a bad patch saves nothing", () => {
  assert.equal(overdueSaved(OVERDUE_DEFAULT), null);
  assert.deepEqual(cleanOverdueLook({ tmOverdue: null }), { tmOverdue: null });
  assert.deepEqual(cleanOverdueLook({ tmOverdue: { bg: null, text: null, fx: "none" } }), { tmOverdue: null });
  assert.deepEqual(cleanOverdueLook({ tmOverdue: { bg: "#2563EB", fx: "fire", x: 1 } }), { tmOverdue: { bg: "#2563eb", text: null, fx: "fire" } });
  assert.deepEqual(cleanOverdueLook({ tmOverdue: "blue" }), {});
  assert.deepEqual(cleanOverdueLook({ tmOverdue: [1] }), {});
  assert.deepEqual(cleanOverdueLook({ somethingElse: 1 }), {});
  assert.ok(sameOverdue(cleanOverdue({ bg: "#ABC" }), { bg: "#aabbcc", text: null, fx: "none" }));
  assert.ok(!sameOverdue(OVERDUE_DEFAULT, { ...OVERDUE_DEFAULT, fx: "glow" }));
});

ok("the main window's save path cleans it (ps.ts cleanLooks), and the setting is in the settings record type", () => {
  const ps = src("src/ps.ts");
  assert.ok(/Object\.assign\(o, cleanOverdueLook\(p\)\)/.test(ps));
  assert.ok(/tmOverdue\?: import\("\.\/overduelook"\)\.OverdueLook \| null/.test(src("src/core/model.ts")));
});

ok("every preset card colour gets words that read on it (4.5:1) and an edge that shows", () => {
  for (const c of [...OVERDUE_BGS.map((x) => x.id), "#000000", "#ffffff", "#777777", "#ffff00", "#123456"]) {
    const v = overdueVars({ bg: c, text: null, fx: "none" });
    assert.equal(v["--k-bad-bg"], c);
    assert.ok(contrast(v["--k-fg"], c) >= 4.5, `${c}: task words`);
    assert.ok(contrast(v["--k-bad-t"], c) >= 4.5, `${c}: the Overdue heading`);
    assert.match(v["--k-bad"], /^#[0-9a-f]{6}$/);
    assert.match(v["--od-glow"], /^\d+, \d+, \d+$/);
  }
  assert.ok(contrast(readableOn("#0d0d10", "#e0182d", 4.5), "#0d0d10") >= 4.5);
});

ok("a picked text colour paints every word on the card, with or without a card colour", () => {
  assert.deepEqual(overdueVars({ bg: null, text: "#ffd21f", fx: "none" }), { "--k-fg": "#ffd21f", "--k-bad-t": "#ffd21f" });
  const both = overdueVars({ bg: "#1e2a5a", text: "#67e8f9", fx: "none" });
  assert.equal(both["--k-fg"], "#67e8f9");
  assert.equal(both["--k-bad-t"], "#67e8f9");
  assert.equal(both["--k-bad-bg"], "#1e2a5a");
});

ok("presets and effects: unique, plain words, no dashes, None first, the effects the developer asked about are there", () => {
  for (const list of [OVERDUE_BGS, OVERDUE_TEXTS, OVERDUE_FX]) {
    const ids = list.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const x of list) assert.ok(!/[–—]/.test(x.label + ("note" in x ? (x as { note: string }).note : "")), x.id);
  }
  for (const c of [...OVERDUE_BGS, ...OVERDUE_TEXTS]) assert.match(c.id, /^#[0-9a-f]{6}$/);
  assert.equal(OVERDUE_FX[0].id, "none");
  for (const id of ["glow", "pulse", "shimmer", "lightning", "fire"]) assert.ok(OVERDUE_FX.some((f) => f.id === id), id);
  assert.match(overdueSummary(OVERDUE_DEFAULT), /As before/);
  assert.match(overdueSummary({ bg: "#2563eb", text: null, fx: "lightning" }), /Blue card, automatic text, Lightning effect/);
  for (const t of [overdueSummary({ bg: "#abcdef", text: "#ffffff", fx: "fire" })]) assert.ok(!/[–—]/.test(t));
});

ok("Reduce motion: nothing moves (moving effects turn into a still glow, the shine is not drawn)", () => {
  for (const f of OVERDUE_FX) {
    const shown = overdueFxShown(f.id, true);
    assert.ok(!OVERDUE_FX.find((x) => x.id === shown)!.moving, `${f.id} -> ${shown}`);
    assert.equal(overdueFxShown(f.id, false), f.id);
  }
  const css = src("src/views/overduelook.css");
  assert.ok(/prefers-reduced-motion: reduce\)[^}]*\.od-layer[^}]*animation: none !important/s.test(css));
  assert.ok(/\.tm-overlay\.tm-paused \.od-layer::before/.test(css), "the effect stops while the list is hidden");
  // the effects only animate transform and opacity (no layout or paint heavy properties in a keyframe)
  const frames = [...css.matchAll(/@keyframes od-[a-z]+ \{([^@]*?)\}\s*\n/g)];
  assert.ok(frames.length >= 7, `found ${frames.length} effect keyframes`);
  for (const m of frames) assert.ok(!/(width|height|top|left|box-shadow|background)\s*:/.test(m[1]), m[0].slice(0, 30));
});

ok("Settings: one searchable row in Appearance, for everyone everywhere, with its control and a live sample", () => {
  const e = SETTINGS.find((x) => x.id === "overdue-tab")!;
  assert.ok(e);
  assert.equal(e.group, "looks");
  assert.ok(!e.red && !e.on && !e.more, "public build, Mac, website and phone, not under More");
  for (const w of ["overdue", "lightning", "colour", "text colour", "effect"]) assert.ok(e.words!.includes(w), w);
  assert.ok(!/[–—]/.test(e.name + e.line));
  const groups = src("src/views/SettingsGroups.tsx");
  assert.ok(/"overdue-tab": \(p\) => <SetRow e=\{p\.e\} body=\{<div className="gs-looks ms-win"><OverdueLookSettings preview=\{p\.preview\} \/>/.test(groups));
  const view = src("src/views/OverdueLook.tsx");
  assert.ok(view.includes("<SampleCard look={look} />"), "a live sample of the look being tried");
  assert.ok(view.includes('"overdue")'), "See it on screen previews the real card");
  assert.ok(view.includes("Reset to default"));
  assert.ok(view.includes("<ColorWheel"), "the colour wheel for your own colour");
  assert.ok(/set\(\{ bg: hex \}, 450\)/.test(view) && /set\(\{ text: hex \}, 450\)/.test(view), "the wheel saves once you stop");
  assert.ok(/if \(sameOverdue\(next, lastSaved\)\) \{ setTried\(undefined\); return; \}/.test(view), "nothing is saved when nothing changed");
  for (const f of ["src/views/OverdueLook.tsx", "src/views/overduelook.css", "src/core/overduelook.ts"]) assert.ok(!/[–—]/.test(src(f)), f);
});

ok("the real card takes the look (and the one being tried), and a preview with nothing overdue shows an example card", () => {
  const tm = src("src/views/TaskMap.tsx");
  assert.ok(tm.includes("const card = useOverdueCard(useOverdueLook(savedLook));"));
  assert.ok(tm.includes("className={`tm-aware tm-overdue${card.className}`} style={card.style}"));
  assert.ok(tm.includes("<OverdueFxLayer fx={card.fx} />"));
  assert.ok(tm.includes("list={stage.sampleOverdue ? SAMPLE_OVERDUE : overdue}"));
  assert.ok(tm.includes("look={overdueLookOf(st)}"));
  const base = { hasP1: true, hasWorking: true, hasTasks: true, bgFade: 1, notebook: false, reduced: false };
  assert.equal(previewStage("overdue", null, { ...base, hasOverdue: false }).sampleOverdue, true);
  assert.ok(previewStage("overdue", null, { ...base, hasOverdue: false }).note);
  assert.equal(previewStage("overdue", null, { ...base, hasOverdue: true }).sampleOverdue, undefined);
  assert.ok(previewStage("overdue", null, { ...base, hasOverdue: true, reduced: true }).note);
  assert.equal(looksOption("overdue").part, "overdue");
  assert.ok(LOOKS_OPTIONS.find((o) => o.id === "overdue")!.everyone);
  assert.ok(PART_SHOWN.overdue);
  assert.ok(/html\[data-pv="overdue"\]/.test(src("src/looks/peek.css")));
});

console.log(`${n} of ${n} ok`);

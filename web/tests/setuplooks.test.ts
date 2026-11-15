// Run: node --experimental-strip-types tests/setuplooks.test.ts
// V1.62 the setup menu's last step, Make PS yours (core/setuplooks.ts, views/SetupLooks.tsx, views/Welcome.tsx). The developer: "right at
// the very end, it's a requirement before you get to use the app to pick a colour background and also click on a rain effect",
// "Just click a background colour that isn't just blank basically", with More for the other backgrounds and effects.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const file = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const L = await import("../src/core/setuplooks.ts");
const Wc = await import("../src/core/welcome.ts");
const { BG_COLOURS } = await import("../src/core/bgcolour.ts");
const { BG_DESIGNS } = await import("../src/core/prio.ts");
const { RAIN_KINDS } = await import("../src/core/rain.ts");
const { TRAIL_KINDS } = await import("../src/core/trail.ts");

ok("The developer's approved words, exactly, with no dashes", () => {
  assert.deepEqual(L.SETUP_LOOKS_WORDS, {
    title: "Make PS yours",
    line: "Pick a background colour and a rain effect. You can change both any time in Settings, Looks.",
    bg: "Background colour", fx: "Rain effect", more: "More", done: "Done",
  });
  assert.doesNotMatch(JSON.stringify(L.SETUP_LOOKS_WORDS), /[–—]/);
});

ok("background: the blank one never counts; any colour, own colour, scene, lightning or video does", () => {
  for (const v of [undefined, null, "", "none", "nonsense", "color:nope", "video:"]) assert.equal(L.bgPicked(v as never), false, String(v));
  for (const c of BG_COLOURS) assert.equal(L.bgPicked(`color:${c.id}`), true, c.id);
  assert.equal(L.bgPicked("color:#3a2f5c"), true, "your own colour (More)");
  for (const d of BG_DESIGNS.filter((x) => x.id !== "none")) assert.equal(L.bgPicked(d.id), true, d.id);
  assert.equal(L.bgPicked("video:my-clip"), true, "a video (More)");
});

ok("effect: No rain alone never counts; any rain style does; More's mouse trail counts, but not its Off or the default Glow", () => {
  assert.equal(L.effectPicked({}), false, "a fresh account: no rain, the default Glow");
  assert.equal(L.effectPicked({ tmRain: "off" }), false);
  assert.equal(L.effectPicked({ tmRain: "off", tmTrail: "off" }), false);
  assert.equal(L.effectPicked({ tmRain: "off", tmTrail: "glow" }), false);
  assert.equal(L.effectPicked({ tmRain: "made-up" }), false);
  for (const k of RAIN_KINDS.filter((x) => x.id !== "off")) assert.equal(L.effectPicked({ tmRain: k.id }), true, k.id);
  for (const t of TRAIL_KINDS.filter((x) => x.id !== "glow" && x.id !== "off")) assert.equal(L.effectPicked({ tmTrail: t.id }), true, t.id);
});

ok("Done is off until both are met", () => {
  assert.equal(L.setupLooksDone({ bg: "none", st: {} }), false);
  assert.equal(L.setupLooksDone({ bg: "color:ocean", st: {} }), false, "a colour but no effect");
  assert.equal(L.setupLooksDone({ bg: "none", st: { tmRain: "steady" } }), false, "rain but a blank background");
  assert.equal(L.setupLooksDone({ bg: "none", st: { tmRain: "off" } }), false);
  assert.equal(L.setupLooksDone({ bg: "color:ocean", st: { tmRain: "off" } }), false, "No rain is not a pick");
  assert.equal(L.setupLooksDone({ bg: "color:ocean", st: { tmRain: "steady" } }), true);
  assert.equal(L.setupLooksDone({ bg: "spotlight", st: { tmTrail: "sparks" } }), true, "both from More");
  assert.equal(L.setupLooksDone({ bg: "color:plum", st: { tmRain: "glass", tmTrail: "off" } }), true, "already picked in Settings: one click finishes");
  const v = file("src/views/SetupLooks.tsx");
  assert.match(v, /const ready = setupLooksDone\(\{ bg: shownBg\(st\), st \}\);\n\s+return <button type="button" className="wt-btn go" disabled=\{!ready\} aria-disabled=\{!ready\} onClick=\{\(\) => \{ if \(!ready\) return; sfx\.done\(\); onDone\(\); \}\}>\{W\.done\}<\/button>;/);
});

ok("the picks are saved where Settings, Looks saves them (synced settings), at the moment they are clicked", () => {
  const v = file("src/views/SetupLooks.tsx");
  assert.match(v, /<LookBgColour st=\{st\} preview=\{preview\} \/>/);
  assert.match(v, /<LookRain st=\{st\} preview=\{preview\} \/>/);
  assert.match(v, /<LookBackground st=\{st\} preview=\{preview\} \/><LookOwnColour st=\{st\} preview=\{preview\} \/>/, "More: the other backgrounds");
  assert.match(v, /<MouseTrailSettings st=\{st\} set=\{save\} \/>/, "More: the other effects");
  assert.match(v, /const save = \(patch: Parameters<typeof taskMapActions\.looks>\[0\]\) => void taskMapActions\.looks\(patch\);/);
  const tm = file("src/views/TaskMap.tsx");
  assert.match(tm, /const setLooks = \(patch: Partial<Settings>\) => void taskMapActions\.looks\(patch\);/);
  assert.match(tm, /onPick=\{\(\) => setLooks\(bgPatch\(st, `color:\$\{c\.id\}`\)\)\}/, "a colour tile saves the background");
  assert.match(tm, /onPick=\{\(\) => set\(\{ tmRain: k\.id \}\)\}/, "a rain tile saves the rain");
  assert.match(v, /\{moreBg && /); assert.match(v, /\{moreFx && /);
  assert.match(v, /aria-expanded=\{moreBg\}[^\n]*>\{W\.more\}<\/button>/);
});

ok("it comes after Create, and the 'setup done' mark waits until it closes (Done or Esc)", () => {
  const deck = Wc.tourDeck({});
  const ops = Wc.tourPlan(deck, {}, {}, { gym: { on: false } }, "2026-11-15T20:00:00.000Z");
  assert.ok(ops.some((o) => o.to === "looks" && "welcomeDone" in o.patch), "Create's plan carries the mark");
  const held = Wc.holdDone(ops);
  assert.ok(!held.some((o) => o.to === "looks" && "welcomeDone" in o.patch), "held back while the last step shows");
  const withGym = Wc.holdDone(Wc.tourPlan(deck, { gym: false }, { gym: true }, { gym: { on: false } }, "2026-11-15T20:00:00.000Z"));
  assert.deepEqual(withGym.find((o) => o.to === "looks"), { to: "looks", patch: { gym: { on: true } } }, "the other choices still go at Create");
  assert.deepEqual(Wc.tourSeenOnly("2026-11-15T20:01:00.000Z"), [{ to: "looks", patch: { welcomeDone: "2026-11-15T20:01:00.000Z" } }], "Done or Esc writes it");
  const w = file("src/views/Welcome.tsx");
  assert.match(w, /window\.setTimeout\(\(\) => \{ run\(holdDone\(ops\)\); phaseRef\.current = "in"; setPhase\("in"\); setDir\(1\); setLooks\(true\); \}, 1900\);/);
  assert.match(w, /<SetupLooksDoneButton onDone=\{\(\) => close\(null\)\} \/>/);
  assert.match(w, /if \(e\.key === "Escape"\) \{ e\.preventDefault\(\); e\.stopImmediatePropagation\(\); k\.close\(null\); \}\n\s+else if \(k\.looks\) return;/, "Esc still closes it; arrows do nothing there");
  assert.equal((w.match(/setLooks\(true\)/g) || []).length, 1, "only Create leads to it");
});

ok("someone who finished setup before is never forced: the menu never opens by itself for them", () => {
  const base = { ps: true, owner: true, synced: true };
  assert.equal(Wc.welcomeStep({ ...base, localDone: null, syncedDone: "2026-11-01T10:00:00.000Z" }), "quiet");
  assert.equal(Wc.welcomeStep({ ...base, localDone: "2026-11-01T10:00:00.000Z", syncedDone: null }), "quiet");
  assert.equal(Wc.welcomeStep({ ...base, localDone: null, syncedDone: null }), "show", "a new account gets the menu, and so the step");
  assert.equal(Wc.SETUP_GEN, 2, "the update offer is not raised by this step");
});

ok("reduced motion: the preview's rain stands still; the step is wider and Done looks off while it is off", () => {
  const css = file("src/views/welcome.css");
  const rm = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(rm, /\.wt-lk-prev \.ms-rain-sample\.wt-lk-rain i, \.wt-lk-extra \{ animation: none; \}/);
  assert.match(css, /\.wt-lk-prev \.ms-rain-sample\.wt-lk-rain i \{ inset: -60px 0 0 0; animation: wt-lk-fall 1\.1s linear infinite; \}/);
  assert.match(css, /\.wt-foot \.wt-btn\.go:disabled \{ opacity: \.45; cursor: not-allowed; \}/);
});

console.log(`${n} ok`);

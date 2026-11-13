// Run: node --experimental-strip-types tests/trail.test.ts
// Mouse trail (V1.43, core/trail.ts). The developer, 8 Nov 2026: "when I hover over tasks I see a little white shadow that follows
// me, which I really like, but I want to edit it in Settings: multiple options, like red lightning sparks... a fire
// sparkler, a blade that follows you around... a bunch of different effects, 10 to 20."
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FX_INTENSITY, FX_SIZE, MAX_PARTICLES, MAX_PER_MOVE, Pool, TRAIL_DEFAULT, TRAIL_KINDS, TRAIL_PRESETS, burstCount, cleanFx, emitCount, fxOf,
  glowVars, inkFor, intensityScale, particleCap, sizeScale, trailInfo, trailKind, trailPrefs, trailRuns, trailShown, withFx, type TrailId,
} from "../src/core/trail.ts";
import { SETTINGS, searchSettings, visibleTo } from "../src/core/settingsindex.ts";
import { looksOption } from "../src/core/looksoptions.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const ids = TRAIL_KINDS.map((k) => k.id);
const effects = TRAIL_KINDS.filter((k) => k.canvas).map((k) => k.id);

ok("Glow and Off plus 12 to 18 effects, unique, each with a name, a sentence and a colour", () => {
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("glow") && ids.includes("off"));
  assert.ok(effects.length >= 12 && effects.length <= 18, `${effects.length} effects`);
  for (const id of ["sparks", "lightning", "sparkler", "blade", "stardust", "embers", "orb", "comet"] as TrailId[]) assert.ok(ids.includes(id), `${id} (the sparkly ones)`);
  for (const id of ["leaves", "ink", "ripples", "confetti"]) assert.ok(!ids.includes(id as TrailId), `${id} dropped (the developer: keep it small)`);
  assert.equal(trailKind("confetti"), "glow", "a dropped effect falls back to Glow");
  for (const k of TRAIL_KINDS) {
    assert.ok(k.label.length > 1 && k.label.length <= 16, k.id);
    assert.ok(/[.!]$/.test(k.note) && k.note.length < 90, `${k.id}: one sentence`);
    assert.ok(k.colour === "multi" ? !!k.multi : /^#[0-9a-f]{6}$/.test(k.colour), `${k.id}: colour`);
  }
  assert.equal(trailInfo("lightning").colour.slice(0, 3), "#ff", "lightning is red by default");
  assert.ok(TRAIL_PRESETS.every((c) => /^#[0-9a-f]{6}$/.test(c)));
});

ok("nothing changes for anyone who never touched it: unset is Glow at its own colour, size and brightness", () => {
  assert.deepEqual(trailPrefs(undefined), TRAIL_DEFAULT);
  assert.deepEqual(trailPrefs(null), TRAIL_DEFAULT);
  assert.equal(trailPrefs({}).kind, "glow");
  assert.equal(trailKind("nonsense"), "glow");
  assert.equal(glowVars(fxOf(TRAIL_DEFAULT, "glow")), null, "no style variables at the defaults, so the CSS is as before");
  const css = readFileSync(new URL("../src/views/taskmap.css", import.meta.url), "utf8");
  assert.ok(css.includes("var(--trail-glow-r, 260px)") && css.includes("var(--trail-glow-a, 16%)") && css.includes("var(--trail-glow-c, var(--k-fg, #FFFFFF))"), "the glow falls back to its old values");
});

ok("the saved setting is checked: bad colours, sizes and effects never get through", () => {
  const p = trailPrefs({ kind: "sparks", burst: "yes", fx: { sparks: { c: "red", s: 900, i: -4 }, nope: { c: "#000000" }, off: { s: 10 }, rainbow: { c: "multi", s: "40" } } });
  assert.equal(p.kind, "sparks");
  assert.equal(p.burst, false, "only true turns Burst on");
  assert.deepEqual(p.fx.sparks, { c: trailInfo("sparks").colour, s: 100, i: 0 });
  assert.ok(!("nope" in p.fx) && !("off" in p.fx));
  assert.deepEqual(p.fx.rainbow, { c: "multi", s: 40, i: 50 });
  assert.equal(cleanFx("sparks", { c: "multi" }).c, trailInfo("sparks").colour, "one colour effects cannot be multi");
  assert.equal(cleanFx("neon", { c: "#ABCDEF" }).c, "#abcdef");
  assert.equal(cleanFx("neon", { s: true }).s, FX_SIZE);
});

ok("each effect keeps its own colour, size and intensity; back to the defaults drops it", () => {
  let p = withFx(TRAIL_DEFAULT, "sparks", { c: "#55d6ff" });
  p = withFx(p, "blade", { s: 80 });
  assert.equal(fxOf(p, "sparks").c, "#55d6ff");
  assert.equal(fxOf(p, "blade").s, 80);
  assert.equal(fxOf(p, "comet").c, trailInfo("comet").colour);
  p = withFx(p, "blade", { s: FX_SIZE });
  assert.ok(!("blade" in p.fx));
  assert.deepEqual(trailPrefs(JSON.parse(JSON.stringify({ ...p, kind: "blade" }))), { ...p, kind: "blade" }, "round trips through the vault");
});

ok("reduced motion falls back to Glow (Off stays Off), a touch screen draws nothing", () => {
  for (const id of effects) assert.equal(trailShown(id, { reduced: true }), "glow");
  assert.equal(trailShown("off", { reduced: true }), "off");
  assert.equal(trailShown("glow", { reduced: true }), "glow");
  assert.equal(trailShown("sparks", { reduced: false, touchOnly: true }), "off");
  assert.equal(trailShown("sparks", { reduced: false }), "sparks");
});

ok("the canvas runs only for a canvas effect, while the list shows and the page is visible", () => {
  assert.equal(trailRuns({ kind: "sparks", shown: true, visible: true }), true);
  assert.equal(trailRuns({ kind: "glow", shown: true, visible: true }), false, "Glow is CSS: no canvas, no frames");
  assert.equal(trailRuns({ kind: "off", shown: true, visible: true }), false);
  assert.equal(trailRuns({ kind: "sparks", shown: false, visible: true }), false);
  assert.equal(trailRuns({ kind: "sparks", shown: true, visible: false }), false);
  assert.equal(particleCap("glow", 100), 0);
  assert.equal(particleCap("off", 100), 0);
});

ok("particle caps: never over MAX_PARTICLES, more with intensity, never over the cap per move", () => {
  for (const id of effects) {
    const lo = particleCap(id, 0), mid = particleCap(id, FX_INTENSITY), hi = particleCap(id, 100);
    assert.ok(lo > 0 && lo <= mid && mid <= hi && hi <= MAX_PARTICLES, `${id}: ${lo} ${mid} ${hi}`);
    for (const live of [0, Math.floor(hi / 2), hi - 1, hi, hi + 50]) {
      const e = emitCount(id, 5000, 100, 0, live);
      assert.ok(e.n >= 0 && e.n <= MAX_PER_MOVE && live + e.n <= Math.max(hi, live), `${id}: ${live} + ${e.n} within ${hi}`);
      const b = burstCount(id, 100, live);
      assert.ok(b >= 0 && live + b <= Math.max(hi, live), `${id}: burst ${b} at ${live}`);
    }
  }
  const still = emitCount("sparks", 0, 50, 0, 0);
  assert.equal(still.n, 0, "a mouse that does not move adds nothing");
});

ok("slow moves still add a little (the leftover fraction carries over), and never more than asked", () => {
  let carry = 0, total = 0;
  for (let j = 0; j < 100; j++) { const e = emitCount("sparks", 1, 50, carry, 0); carry = e.carry; total += e.n; }
  assert.ok(total >= 25 && total <= 40, `${total} sparks for 100 px`);
  assert.ok(carry >= 0 && carry < 1);
});

ok("the particle store refuses past its cap and keeps live ones packed", () => {
  const p = new Pool(5);
  for (let j = 0; j < 8; j++) p.add(j, j, 0, 0, 1, 1);
  assert.equal(p.n, 5);
  assert.equal(p.add(9, 9, 0, 0, 1, 1), -1);
  p.kill(1);
  assert.equal(p.n, 4);
  assert.equal(p.x[1], 4, "the last one moves into the gap");
  p.clear();
  assert.equal(p.n, 0);
  assert.equal(new Pool(1e9).cap, MAX_PARTICLES, "never bigger than the hard cap");
});

ok("size and intensity scale around 1 at 50, and pale colours are deepened on paper looks", () => {
  assert.equal(sizeScale(50), 1); assert.equal(intensityScale(50), 1);
  assert.ok(sizeScale(0) < sizeScale(100) && intensityScale(0) < intensityScale(100));
  assert.deepEqual(inkFor([255, 255, 255], false), [255, 255, 255]);
  assert.notDeepEqual(inkFor([255, 255, 255], true), [255, 255, 255]);
  assert.deepEqual(inkFor([200, 20, 20], true), [200, 20, 20]);
  const g = glowVars({ c: "#ff2e4c", s: 100, i: 100 })!;
  assert.equal(g["--trail-glow-c"], "#ff2e4c");
  assert.equal(g["--trail-glow-r"], "455px");
  assert.equal(g["--trail-glow-a"], "32%");
});

ok("Settings: Mouse trail is in Appearance, for everyone on a Mac and the website, and the search finds it", () => {
  const e = SETTINGS.find((s) => s.id === "mouse-trail")!;
  assert.equal(e.group, "looks");
  assert.ok(!e.red, "the same in the private and public builds");
  assert.ok(visibleTo(e, { red: false, where: "mac" }) && visibleTo(e, { red: false, where: "web" }) && visibleTo(e, { red: true, where: "mac" }));
  for (const q of ["mouse trail", "cursor", "sparks", "sparkler", "blade", "mouse"]) assert.equal(searchSettings(q, { red: false, where: "mac" })[0]?.e.id, "mouse-trail", q);
  assert.ok(looksOption("trail").settings.includes("tmTrail"));
  const groups = readFileSync(new URL("../src/views/SettingsGroups.tsx", import.meta.url), "utf8");
  assert.ok(groups.includes('"mouse-trail": looks("trail")'), "it has a control");
});

ok("cheap by design: one canvas only for canvas effects, pointer events pass through, Glow and Off mount nothing", () => {
  const tm = readFileSync(new URL("../src/views/TaskMap.tsx", import.meta.url), "utf8");
  assert.ok(tm.includes('trail.attr === "fx" && <TrailLayer'), "the layer mounts only for a canvas effect");
  const css = readFileSync(new URL("../src/views/trail.css", import.meta.url), "utf8");
  assert.ok(/\.tm-trail \{[^}]*pointer-events: none/.test(css));
  const layer = readFileSync(new URL("../src/views/Trail.tsx", import.meta.url), "utf8");
  assert.ok(layer.includes("{ passive: true }") && layer.includes("eng.clear()"), "passive listeners, cleared when it stops");
  const fx = readFileSync(new URL("../src/views/trailfx.ts", import.meta.url), "utf8");
  assert.ok(!/shadowBlur|webgl/i.test(fx.replace(/\/\/.*$/gm, "")), "no shadowBlur, no WebGL");
});

ok("saved and synced: the Tab list's looks patch keeps tmTrail, cleaned (ps.ts cleanLooks)", () => {
  const ps = readFileSync(new URL("../src/ps.ts", import.meta.url), "utf8");
  const body = ps.slice(ps.indexOf("export function cleanLooks"), ps.indexOf("return o;", ps.indexOf("export function cleanLooks")));
  assert.ok(body.includes("o.tmTrail = trailPrefs(p.tmTrail)"));
  const model = readFileSync(new URL("../src/core/model.ts", import.meta.url), "utf8");
  assert.ok(model.includes("tmTrail?: TrailPrefs;"));
});

ok("no em or en dashes in any of it", () => {
  for (const f of ["../src/core/trail.ts", "../src/views/trailfx.ts", "../src/views/Trail.tsx", "../src/views/MouseTrail.tsx", "../src/views/trail.css"]) {
    assert.ok(!/[\u2013\u2014]/.test(readFileSync(new URL(f, import.meta.url), "utf8")), f);
  }
});

console.log(`\n${n} passed`);

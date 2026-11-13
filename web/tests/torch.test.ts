// Run: node --experimental-strip-types tests/torch.test.ts
// Minecraft mode, the torch (src/views/minecraft/torch-logic.ts): the colour row, the developer never raising the
// brightness, colours cleaned, the custom colour maths both ways, what is remembered (and a broken or
// missing store), and the shell's state message cleaned. FICTIONAL data, no network.
import assert from "node:assert/strict";
import fs from "node:fs";
const T = await import("../src/views/minecraft/torch-logic.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };

ok("the colour row is White, Warm, the developer, Green, Blue (Custom comes after)", () => {
  assert.deepEqual(T.TORCH_PRESETS.map((p) => p.name), ["White", "Warm", "Red", "Green", "Blue"]);
  assert.equal(T.TORCH_PRESETS[0].color, "#ffffff");
  for (const p of T.TORCH_PRESETS) assert.equal(T.cleanColor(p.color), p.color, p.id);
  assert.equal(new Set(T.TORCH_PRESETS.map((p) => p.id)).size, T.TORCH_PRESETS.length);
  assert.ok(!T.TORCH_PRESETS.some((p) => p.id === T.CUSTOM_ID));
});

ok("red is dim friendly: it never raises the brightness, even with the setting on", () => {
  const red = T.lightFor({ pick: "red", custom: "#123456", bright: true });
  assert.equal(red.bright, false);
  assert.match(red.color, /^#[0-9a-f]{6}$/);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(red.color.slice(i, i + 2), 16));
  assert.ok(r > 150 && g < 40 && b < 40, "a deep red");
});

ok("white, warm, green and blue raise it only while the setting is on", () => {
  for (const id of ["white", "warm", "green", "blue"]) {
    assert.equal(T.lightFor({ pick: id, custom: "#000000", bright: true }).bright, true, id);
    assert.equal(T.lightFor({ pick: id, custom: "#000000", bright: false }).bright, false, id);
  }
  assert.deepEqual(T.lightFor({ pick: "custom", custom: "#00ffaa", bright: true }), { color: "#00ffaa", bright: true });
});

ok("colours are cleaned: short forms grow, anything else is refused", () => {
  assert.equal(T.cleanColor("#FFF"), "#ffffff");
  assert.equal(T.cleanColor("aBc"), "#aabbcc");
  assert.equal(T.cleanColor(" #12AB9f "), "#12ab9f");
  for (const bad of ["", "#12345", "#1234567", "red", "url(javascript:alert(1))", "#ff00zz", null, undefined, 42, {}]) assert.equal(T.cleanColor(bad), null, String(bad));
});

ok("the custom colour: pure at no pale, white at full pale, always valid", () => {
  assert.equal(T.customColor(0, 0), "#ff0000");
  assert.equal(T.customColor(120, 0), "#00ff00");
  assert.equal(T.customColor(240, 0), "#0000ff");
  assert.equal(T.customColor(77, 100), "#ffffff");
  assert.equal(T.customColor(360, 0), "#ff0000");
  assert.equal(T.customColor(-120, 0), "#0000ff");
  for (const [h, p] of [[NaN, NaN], [Infinity, -5], [999, 300]]) assert.match(T.customColor(h, p), /^#[0-9a-f]{6}$/);
});

ok("a remembered custom colour comes back to the same sliders", () => {
  for (let h = 0; h < 360; h += 37) for (const p of [0, 25, 60, 90]) {
    const back = T.toHuePale(T.customColor(h, p));
    assert.ok(Math.abs(back.pale - p) <= 1, `pale ${p} -> ${back.pale}`);
    if (p < 90) assert.ok(Math.min(Math.abs(back.hue - h), 360 - Math.abs(back.hue - h)) <= 2, `hue ${h} -> ${back.hue}`);
    assert.equal(T.customColor(back.hue, back.pale).length, 7);
  }
  assert.deepEqual(T.toHuePale("#ffffff"), { hue: 0, pale: 100 });
  assert.deepEqual(T.toHuePale("nonsense"), { hue: 0, pale: 100 });
});

ok("the last colour is remembered on this device", () => {
  const m = new Map<string, string>();
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  assert.deepEqual(T.loadPrefs(store), T.DEFAULT_PREFS);
  T.savePrefs(store, { pick: "green", custom: "#ABCDEF", bright: false });
  assert.deepEqual(T.loadPrefs(store), { pick: "green", custom: "#abcdef", bright: false });
  T.savePrefs(store, { pick: "custom", custom: "#00ff88", bright: true });
  assert.equal(T.lightFor(T.loadPrefs(store)).color, "#00ff88");
});

ok("a broken, foreign or missing store never breaks the torch", () => {
  const bad = { getItem: () => "{not json", setItem: () => { throw new Error("full"); } };
  assert.deepEqual(T.loadPrefs(bad), T.DEFAULT_PREFS);
  T.savePrefs(bad, T.DEFAULT_PREFS);                         // does not throw
  const thrower = { getItem: () => { throw new Error("blocked"); }, setItem: () => {} };
  assert.deepEqual(T.loadPrefs(thrower), T.DEFAULT_PREFS);
  assert.deepEqual(T.loadPrefs(null), T.DEFAULT_PREFS);
  assert.deepEqual(T.cleanPrefs({ pick: "purple", custom: "javascript:", bright: "yes" }), T.DEFAULT_PREFS);
  assert.equal(T.cleanPrefs({ pick: "custom" }).pick, "custom");
});

ok("the default is white with full brightness on", () => {
  assert.deepEqual(T.lightFor(T.DEFAULT_PREFS), { color: "#ffffff", bright: true });
});

ok("the shell's state message is cleaned", () => {
  assert.deepEqual(T.cleanTorchState(null), T.EMPTY_TORCH);
  assert.deepEqual(T.cleanTorchState({ open: true, color: "#00FF00", bright: false, canBright: false, refused: "protected" }),
    { open: true, color: "#00ff00", bright: false, canBright: false, refused: "protected" });
  const odd = T.cleanTorchState({ open: "yes", color: "<script>", refused: "nope", extra: 1 });
  assert.deepEqual(odd, { open: false, color: "#ffffff", bright: true, canBright: true, refused: null });
});

ok("swatch text stays readable on light and dark colours", () => {
  assert.equal(T.inkOn("#ffffff"), "#1a1a1a");
  assert.equal(T.inkOn("#ffd59e"), "#1a1a1a");
  assert.equal(T.inkOn("#2f6bff"), "#ffffff");
  assert.equal(T.inkOn("#d10a00"), "#ffffff");
});

ok("the hint says Press Esc and stays faint but readable on every colour", () => {
  assert.equal(T.TORCH_HINT, "Press Esc to turn off");
  assert.equal(T.hintInk("#ffffff"), "rgba(0,0,0,.38)");
  assert.equal(T.hintInk("#ffd59e"), "rgba(0,0,0,.38)");
  assert.equal(T.hintInk("#1fe04a"), "rgba(0,0,0,.38)");
  assert.equal(T.hintInk("#d10a00"), "rgba(255,255,255,.5)");
  assert.equal(T.hintInk("#2f6bff"), "rgba(255,255,255,.5)");
  assert.equal(T.hintInk("bad"), "rgba(0,0,0,.38)");
});

ok("the page fallback turns off with Esc only (and a double tap on touch, the phone has no Esc)", () => {
  const src = fs.readFileSync(new URL("../src/views/minecraft/torch-bridge.ts", import.meta.url), "utf8");
  assert.match(src, /key === "Escape"\) webClose\(\)/);
  assert.match(src, /pointerType !== "touch"/);
  const ui = fs.readFileSync(new URL("../src/views/minecraft/Torch.tsx", import.meta.url), "utf8");
  assert.ok(ui.includes("Press Esc to turn it off") && !/any key or click/i.test(ui));
});

ok("the icon's lighter flame layer is the colour mixed toward white", () => {
  assert.equal(T.mixColor("#ff0000", "#ffffff", 0.5), "#ff8080");
  assert.equal(T.mixColor("#000000", "#ffffff", 0), "#000000");
  assert.equal(T.mixColor("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(T.mixColor("bad", "#000000", 2), "#000000");
  assert.match(T.mixColor("#2f6bff", "#ffffff", NaN), /^#[0-9a-f]{6}$/);
});

ok("the torch and the gems are our own pixel drawings (no image files, crisp pixels)", () => {
  const ui = fs.readFileSync(new URL("../src/views/minecraft/Torch.tsx", import.meta.url), "utf8");
  assert.ok(ui.includes('shapeRendering="crispEdges"') && ui.includes("export function TorchGem") && ui.includes("export function TorchIcon"));
  assert.ok(!/\.(png|jpe?g|gif|webp)["']/i.test(ui), "no texture files");
  const css = fs.readFileSync(new URL("../src/views/minecraft/torch.css", import.meta.url), "utf8");
  assert.ok(css.includes("var(--mcm-panel") && css.includes("var(--mcm-edge") && css.includes(".mct-swatch:active"));
});

ok("no em or en dashes in the torch files", () => {
  for (const f of ["torch-logic.ts", "torch-bridge.ts", "Torch.tsx", "torch.css"]) {
    const t = fs.readFileSync(new URL(`../src/views/minecraft/${f}`, import.meta.url), "utf8");
    assert.ok(!/[\u2013\u2014]/.test(t), f);
  }
});

console.log(`torch: ${n} passed`);

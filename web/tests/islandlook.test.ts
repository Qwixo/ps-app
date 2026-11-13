// Run: node --experimental-strip-types tests/islandlook.test.ts
// The Dynamic Island's looks (src/core/islandlook.ts): defaults keep the pill exactly as it was, saved
// choices are cleaned, and every look keeps its words readable (WCAG AA) whatever colour is picked.
import assert from "node:assert/strict";
const L = await import("../src/core/islandlook.ts");
const I = await import("../src/core/island.ts");
const { contrast } = await import("../src/core/prio.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };

ok("the default pill is the black pill it always was", () => {
  assert.deepEqual(L.pillLook(undefined), { style: "classic", fill: null, color: null, size: "regular", icon: false });
  const t = L.pillTones(L.PILL_DEFAULT);
  // The colours the native side painted before: white at 95, 50 and 75 percent on black.
  assert.equal(t.bg, "#000000"); assert.equal(t.fg, "#f2f2f2"); assert.equal(t.dim, "#808080"); assert.equal(t.accent, "#bfbfbf");
  assert.equal(t.glass, 0); assert.equal(t.edge, null);
  assert.equal(t.mail, "#ed4f87"); assert.equal(t.lead, "#61a6fa");
});
ok("around the notch defaults to the Drop (the old wide wings are gone)", () => {
  assert.deepEqual(L.notchLook(undefined), { style: "drop", fill: null, color: null, icon: false });
  assert.deepEqual(L.notchLook({ style: "wings" }), { style: "drop", fill: null, color: null, icon: false });
});
ok("saved choices are cleaned", () => {
  assert.deepEqual(L.pillLook({ style: "glow", color: "#ABC", size: "compact", icon: true }), { style: "glow", fill: null, color: "#aabbcc", size: "compact", icon: true });
  assert.deepEqual(L.pillLook({ style: "evil", fill: "red", color: "url(x)", size: 3, icon: "yes" }), L.PILL_DEFAULT);
  assert.deepEqual(L.notchLook({ style: "halo", color: "1fe0ff", icon: true }), { style: "halo", fill: null, color: "#1fe0ff", icon: true });
  assert.deepEqual(L.notchLook({ style: "slim", fill: "#0F4C3A", color: "javascript:x" }), { style: "slim", fill: "#0f4c3a", color: null, icon: false });
});
ok("the island state carries both looks' tones, also when off", () => {
  const base = { todos: [], today: "2026-11-04", mail: 0, leads: 0, event: null };
  const s = I.islandState({ ...base, settings: { island: { mode: "pill", idle: "next", pill: { style: "solid", color: "#ffd21f" } } } as never });
  assert.equal(s.pill.style, "solid"); assert.equal(s.pill.bg, "#ffd21f"); assert.equal(s.notch.style, "drop");
  assert.equal("backs" in s.pill, false);
  const off = I.islandState({ ...base, settings: { island: { mode: "off" } } as never });
  assert.equal(off.pill.style, "classic");
});

// Every preset and 400 random colours, in every look: words at 4.5 to 1 or more on every backing they can
// sit on, the dimmed "next up" words too, and rings and counts at 3 to 1 or more.
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const colours: (string | null)[] = [null, ...L.ISLAND_COLORS.map((c) => c.id), "#000000", "#777777", "#808080", "#767676"];
for (let i = 0; i < 400; i++) colours.push("#" + Math.floor(rnd() * 0xffffff).toString(16).padStart(6, "0"));
// Background (fill) and Accent (color) together: every fill against a spread of accents, and the reverse.
const accents: (string | null)[] = [null, ...L.ISLAND_COLORS.map((c) => c.id), "#777777"];
const pairs: [string | null, string | null][] = [];
for (const fill of colours) for (const color of fill && !L.ISLAND_COLORS.some((c) => c.id === fill) && fill !== null ? [null, "#3d7bff"] : accents) pairs.push([fill, color]);
ok(`every pill look reads at AA with ${pairs.length} background and accent pairs`, () => {
  for (const style of L.PILL_STYLES.map((s) => s.id)) for (const [fill, color] of pairs) {
    const t = L.pillTones({ style, fill, color, size: "regular", icon: true });
    const min = (c: string) => Math.min(...t.backs.map((b) => contrast(c, b)));
    const at = `${style} fill ${fill} accent ${color}`;
    assert.ok(min(t.fg) >= 4.5, `words ${at}: ${min(t.fg).toFixed(2)}`);
    assert.ok(min(t.dim) >= 4.5, `dim words ${at}: ${min(t.dim).toFixed(2)}`);
    assert.ok(min(t.accent) >= 3, `ring ${at}: ${min(t.accent).toFixed(2)}`);
    for (const k of ["mail", "lead", "done", "chat"] as const) assert.ok(min(t[k]) >= 3, `${k} ${at}`);
    if (t.edge) assert.ok(min(t.edge) >= 3, `edge ${at}`);
    if (style === "glass") assert.ok(t.glass > 0 && t.glass <= 1 && t.backs.length === 2);
    else assert.equal(t.glass, 0);
  }
});
ok("glass reads over a pure black and a pure white screen alike", () => {
  for (const fill of colours) {
    const t = L.pillTones({ style: "glass", fill, color: null, size: "regular", icon: false });
    assert.ok(contrast(t.fg, L.mix("#000000", t.bg, t.glass)) >= 4.5 && contrast(t.fg, L.mix("#ffffff", t.bg, t.glass)) >= 4.5, `glass ${fill}`);
  }
});
ok("a light solid pill gets dark words, a dark one white words", () => {
  assert.equal(L.pillTones({ style: "solid", fill: "#ffd21f", color: null, size: "regular", icon: false }).fg, "#121216");
  assert.equal(L.pillTones({ style: "solid", fill: "#1d2b53", color: null, size: "regular", icon: false }).fg, "#ffffff");
});
ok("pink and blue counts on a pink or blue pill fall back to the words' colour", () => {
  const t = L.pillTones({ style: "solid", fill: "#ed4f87", color: null, size: "regular", icon: false });
  assert.equal(t.mail, t.fg);
});
ok("around the notch with no background stays black: its colour is only the accent, at 3 to 1 or more", () => {
  for (const color of colours) for (const style of L.NOTCH_STYLES.map((s) => s.id)) {
    const t = L.notchTones({ style, fill: null, color, icon: false });
    assert.equal(t.fill, null);
    assert.ok(contrast(t.accent, "#000000") >= 3, `notch ${color}`);
    assert.ok(contrast(t.fg, "#000000") >= 4.5 && contrast(t.dim, "#000000") >= 4.5);
  }
});

// ---------- V1.36: a Background colour (the developer, 5 Nov 2026) ----------
ok("defaults unchanged: no background means exactly the old tones, pill and notch", () => {
  // The tones V1.35 sent for the default looks and for a few saved ones, byte for byte.
  assert.deepEqual(L.notchTones(L.NOTCH_DEFAULT), { style: "drop", icon: false, tinted: false, fill: null, fg: "#f2f2f2", dim: "#808080", accent: "#bfbfbf", glow: "#8ab4ff",
    mail: "#ed4f87", lead: "#61a6fa", done: "#33d499", chat: "#d97857", backs: ["#000000"] });
  const halo = L.notchTones(L.notchLook({ style: "halo", color: "#ff3dc8" }));
  assert.equal(halo.accent, "#ff3dc8"); assert.equal(halo.glow, "#ff3dc8"); assert.equal(halo.fg, "#f2f2f2"); assert.equal(halo.fill, null);
  const classicCyan = L.pillTones(L.pillLook({ style: "classic", color: "#1fe0ff" }));
  assert.equal(classicCyan.bg, "#000000"); assert.equal(classicCyan.accent, "#1fe0ff"); assert.equal(classicCyan.fg, "#f2f2f2"); assert.equal(classicCyan.dim, "#808080");
  const outline = L.pillTones(L.pillLook({ style: "outline", color: "#1fe0ff" }));
  assert.equal(outline.bg, "#0c0c0f"); assert.equal(outline.fg, "#ffffff"); assert.equal(outline.edge, "#1fe0ff");
});
ok("a look saved before V1.36 reads its one colour as the background, so it looks the same", () => {
  // Solid, Gradient and Glass used their colour as the fill: same tones as V1.35 (values from V1.35's fixtures).
  const solid = L.pillLook({ style: "solid", color: "#1d2b53", size: "regular", icon: false });
  assert.deepEqual(solid, { style: "solid", fill: "#1d2b53", color: null, size: "regular", icon: false });
  const st = L.pillTones(solid);
  assert.equal(st.bg, "#1d2b53"); assert.equal(st.fg, "#ffffff"); assert.equal(st.dim, "#8e95a9"); assert.equal(st.accent, "#ffffff");
  const gr = L.pillTones(L.pillLook({ style: "gradient", color: "#a35bff" }));
  assert.equal(gr.bg, "#9352e6"); assert.equal(gr.bg2, "#553085"); assert.equal(gr.fg, "#ffffff");
  const gl = L.pillTones(L.pillLook({ style: "glass", color: "#3d7bff" }));
  assert.equal(gl.bg, "#254a99"); assert.equal(gl.glass, 0.8);
  // Saved by the new editor (fill present, even null): taken as it is.
  assert.deepEqual(L.pillLook({ style: "solid", fill: null, color: "#ff2e3e" }), { style: "solid", fill: null, color: "#ff2e3e", size: "regular", icon: false });
});
ok("Classic with a background is filled with it, and black without one", () => {
  const t = L.pillTones({ style: "classic", fill: "#0f4c3a", color: null, size: "regular", icon: false });
  assert.equal(t.bg, "#0f4c3a"); assert.equal(t.bg2, "#0f4c3a"); assert.equal(t.fg, "#ffffff");
  assert.equal(L.pillTones({ ...L.PILL_DEFAULT }).bg, "#000000");
  // Outline and Glow take the background inside their coloured edge.
  const o = L.pillTones({ style: "outline", fill: "#f4f1ea", color: "#ff2e3e", size: "regular", icon: false });
  assert.equal(o.bg, "#f4f1ea"); assert.equal(o.fg, "#121216"); assert.ok(o.edge && contrast(o.edge, o.bg) >= 3);
});
ok(`around the notch with a background reads at AA in every look with ${pairs.filter((x) => x[0]).length} background and accent pairs`, () => {
  for (const style of L.NOTCH_STYLES.map((s) => s.id)) for (const [fill, color] of pairs) {
    if (!fill) continue;
    const t = L.notchTones({ style, fill, color, icon: true });
    const at = `${style} fill ${fill} accent ${color}`;
    assert.equal(t.fill, fill); assert.deepEqual(t.backs, [fill]);
    assert.ok(contrast(t.fg, fill) >= 4.5, `words ${at}: ${contrast(t.fg, fill).toFixed(2)}`);
    assert.ok(contrast(t.dim, fill) >= 4.5, `dim words ${at}`);
    assert.ok(contrast(t.accent, fill) >= 3, `ring ${at}: ${contrast(t.accent, fill).toFixed(2)}`);
    for (const k of ["mail", "lead", "done", "chat"] as const) assert.ok(contrast(t[k], fill) >= 3, `${k} ${at}`);
    // The Halo's glow sits round the black notch in the menu bar: still worked out on black.
    assert.ok(contrast(t.glow, "#000000") >= 3, `glow ${at}`);
    assert.equal(t.tinted, !!color);
  }
});
ok("every preset background, pill and notch: the words' contrast (report)", () => {
  const rows: string[] = [];
  for (const c of L.ISLAND_COLORS) {
    const nt = L.notchTones({ style: "drop", fill: c.id, color: null, icon: false });
    const pt = L.pillTones({ style: "classic", fill: c.id, color: null, size: "regular", icon: false });
    assert.ok(contrast(nt.fg, c.id) >= 4.5 && contrast(pt.fg, c.id) >= 4.5, c.label);
    rows.push(`${c.label} ${contrast(nt.fg, c.id).toFixed(1)}`);
  }
  console.log("   ", rows.join(", "));
});
ok("the island state sends the notch background to the Mac, without the test only backings", () => {
  const base = { todos: [], today: "2026-11-05", mail: 0, leads: 0, event: null };
  const s = I.islandState({ ...base, settings: { island: { mode: "notch", idle: "next", notch: { style: "drop", fill: "#5b1a2e", color: "#ffd21f" } } } as never });
  assert.equal(s.notch.fill, "#5b1a2e"); assert.equal(s.notch.fg, "#ffffff"); assert.equal("backs" in s.notch, false);
  const d = I.islandState({ ...base, settings: {} as never });
  assert.equal(d.notch.fill, null); assert.equal(d.pill.bg, "#000000");
});

// ---------- V1.36: the grab line (the developer, 6 Nov 2026: "a tiny little grey line ... if you click that I want the dynamic
// island to disappear for let's say five seconds") ----------
const isGrey = (c: string) => c.slice(1, 3) === c.slice(3, 5) && c.slice(3, 5) === c.slice(5, 7);
ok("the grab line is a grey that shows on every look and colour, brighter on hover", () => {
  let checked = 0;
  const check = (t: { backs: string[]; fill?: string | null }, kind: "pill" | "notch", at: string) => {
    const g = L.gripTones(t, kind);
    const backs = kind === "notch" && t.fill ? [...t.backs, L.mix(t.fill, "#000000", L.GRIP_FADE)] : t.backs;
    const min = (c: string) => Math.min(...backs.map((b) => contrast(c, b)));
    assert.ok(isGrey(g.grip) && isGrey(g.gripHi), `grey ${at}`);
    // At the ratio, or the strongest a grey can be there (white or black) when no grey reaches it.
    const best = Math.max(min("#ffffff"), min("#000000"));
    assert.ok(min(g.grip) >= Math.min(L.GRIP_RATIO, best) - 0.01, `line ${at}: ${min(g.grip).toFixed(2)}`);
    assert.ok(min(g.gripHi) >= Math.min(L.GRIP_HI_RATIO, best) - 0.01 && min(g.gripHi) >= min(g.grip) - 0.01, `hover ${at}`);
    checked++;
  };
  for (const style of L.PILL_STYLES.map((s) => s.id)) for (const fill of colours) check(L.pillTones({ style, fill, color: null, size: "regular", icon: false }), "pill", `${style} ${fill}`);
  for (const fill of colours) check(L.notchTones({ style: "drop", fill, color: null, icon: false }), "notch", `notch ${fill}`);
  console.log(`    ${checked} looks and colours`);
});
ok("the grab line: lighter than a dark island, darker than a light one", () => {
  const black = L.gripTones(L.pillTones(L.PILL_DEFAULT), "pill");
  assert.ok(contrast(black.grip, "#000000") >= 3.5 && contrast(black.grip, "#000000") < 4, "subtle on black");
  const cream = L.gripTones(L.pillTones({ style: "solid", fill: "#f4f1ea", color: null, size: "regular", icon: false }), "pill");
  assert.ok(parseInt(cream.grip.slice(1, 3), 16) < 0xf4 && parseInt(cream.gripHi.slice(1, 3), 16) < parseInt(cream.grip.slice(1, 3), 16));
});
// The same greys Island.swift IslandGrip works out (its self test, grip-tones-match-page, checks these exact values).
ok("the grab line's greys match the Mac's table", () => {
  const P = (style: string, fill: string | null) => L.gripTones(L.pillTones({ style: style as never, fill, color: null, size: "regular", icon: false }), "pill");
  const N = (fill: string | null) => L.gripTones(L.notchTones({ style: "drop", fill, color: null, icon: false }), "notch");
  assert.deepEqual(P("classic", null), { grip: "#646464", gripHi: "#898989" });
  assert.deepEqual(P("solid", "#f4f1ea"), { grip: "#808080", gripHi: "#5b5b5b" });
  assert.deepEqual(P("solid", "#ff2e3e"), { grip: "#313131", gripHi: "#000000" });
  assert.deepEqual(P("glass", "#3d7bff"), { grip: "#d8d8d8", gripHi: "#ffffff" });
  assert.deepEqual(P("gradient", "#3d7bff"), { grip: "#e1e1e1", gripHi: "#ffffff" });
  assert.deepEqual(N(null), { grip: "#646464", gripHi: "#898989" });
  assert.deepEqual(N("#f4f1ea"), { grip: "#3b3b3b", gripHi: "#101010" });
  assert.deepEqual(N("#5b1a2e"), { grip: "#868686", gripHi: "#b1b1b1" });
});

console.log(`\n${n} passed`);

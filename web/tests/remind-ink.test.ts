// Run: node --experimental-strip-types tests/remind-ink.test.ts
// The reminder pop-up's colours (V1.58, src/core/remind.ts remLook and alarmLook). The developer, 13 Nov 2026: "when you choose
// the white coloured theme for the fifteen minute reminder, the text almost becomes invisible. The text doesn't adapt
// to the colour." Every theme, light custom colours and a sweep of backgrounds: the words read at 4.5 to 1 (WCAG AA).
import assert from "node:assert/strict";
const R = await import("../src/core/remind.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const AA = 4.5;
const c = R.contrast;
const at = (want: number, got: number, what: string) => assert.ok(got >= want, `${what}: ${got.toFixed(2)} to 1, wanted ${want}`);

// Every preset, plus light custom colours picked on the wheel (white, cream, pale yellow, light grey, pastel pink,
// mint, sky) with the default pink, a white and a matching accent.
const themes: [string, string, string][] = R.REM_COLOURS.map((t) => [t.label, t.bg, t.accent]);
for (const bg of ["#ffffff", "#fff8e1", "#fffde7", "#e5e7eb", "#d4d4d8", "#fbcfe8", "#bbf7d0", "#bae6fd", "#c8c8c8", "#b0b0b0", "#9a9a9a", "#ec4e86", "#f59e0b", "#22c55e"])
  for (const acc of ["#ec4e86", "#ffffff", "#f59e0b", "#e5e7eb", "#3b82f6"]) themes.push([`custom ${bg} / ${acc}`, bg, acc]);

ok("contrast: black on white is 21, a colour on itself is 1", () => {
  assert.equal(Math.round(c("#000000", "#ffffff")), 21);
  assert.equal(c("#ec4e86", "#ec4e86"), 1);
});
ok("mixHex draws like CSS color-mix in srgb", () => {
  assert.equal(R.mixHex("#ffffff", "#000000", 0.5), "#808080");
  assert.equal(R.mixHex("#ec4e86", "#28121e", 1), "#ec4e86");
  assert.equal(R.mixHex("#ec4e86", "#28121e", 0), "#28121e");
});
ok("ink: white on the dark themes, near black on Paper and white (the old ones kept)", () => {
  for (const t of R.REM_COLOURS.filter((x) => x.id !== "paper")) assert.equal(R.inkFor(t.bg), "#ffffff", t.id);
  assert.equal(R.inkFor("#f6f3ee"), "#17121a");
  assert.equal(R.inkFor("#ffffff"), "#17121a");
  assert.equal(R.inkFor("#fff8e1"), "#17121a");
});
ok("ink: a light grey or a mid colour gets dark words now (white on them was 2 to 1, the bug)", () => {
  // The old rule (white below luminance 0.45) gave white words on these.
  for (const bg of ["#b0b0b0", "#a0a0a0", "#ec4e86", "#f59e0b", "#22c55e", "#9a9a9a"]) {
    assert.ok(R.luma(bg) <= 0.45, bg);
    assert.notEqual(R.inkFor(bg), "#ffffff", bg);
    at(AA, c(R.inkFor(bg), bg), bg);
  }
});
ok("ink reads at 4.5 to 1 on ANY background (every 8th step of each channel)", () => {
  for (let r = 0; r < 256; r += 8) for (let g = 0; g < 256; g += 8) for (let b = 0; b < 256; b += 8) {
    const bg = R.mixHex(`#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`, "#000000", 1);
    const L = R.remLook(bg, "#ec4e86");
    if (c(L.ink, bg) < AA || c(L.ink, L.top) < AA || c(L.sub, bg) < AA || c(L.sub, L.top) < AA || c(L.ph, L.fieldTone) < AA || c(L.hint, bg) < AA || c(L.ink, L.fieldTone) < AA)
      assert.fail(`${bg}: ink ${c(L.ink, bg).toFixed(2)} top ${c(L.ink, L.top).toFixed(2)} sub ${c(L.sub, bg).toFixed(2)} ph ${c(L.ph, L.fieldTone).toFixed(2)} hint ${c(L.hint, bg).toFixed(2)}`);
  }
});
for (const [name, bg, acc] of themes) {
  ok(`card on ${name}: question, smaller words, buttons, box, placeholder, hint and pill all read`, () => {
    const L = R.remLook(bg, acc);
    const glowTop = R.mixHex(acc, L.top, L.glow / 100);
    at(AA, c(L.ink, bg), "question on the background");
    at(AA, c(L.ink, L.top), "question on the top sheen");
    at(AA, c(L.ink, glowTop), "question under the accent glow");
    at(AA, Math.min(c(L.sub, bg), c(L.sub, L.top)), "smaller words");
    at(AA, Math.min(c(L.ink, R.mixHex(L.ink, bg, L.btn / 100)), c(L.ink, R.mixHex(L.ink, L.top, L.btn / 100))), "Remind me / Open task buttons");
    at(R.REM_MIN_BUTTON, c(L.on, L.mainTone), "main button");
    at(AA, c(L.ink, L.fieldTone), "typed words in the box");
    at(AA, c(L.ph, L.fieldTone), "placeholder");
    at(AA, Math.min(c(L.hint, bg), c(L.hint, L.top)), "Only Yes closes this");
    at(AA, c(L.pill, L.pillBg), "pill");
  });
  ok(`alarm screen on ${name}: time, words, orb and stop button read`, () => {
    const A = R.alarmLook(bg, acc);
    at(AA, c(A.ink, bg), "time");
    at(AA, c(A.sub, bg), "words");
    at(R.REM_MIN_BUTTON, c(A.on, acc), "orb and stop button (big bold words)");
  });
}
ok("the main button keeps white words where they read (pink, ocean, violet, red, Paper), never on a light accent", () => {
  for (const id of ["pink", "ocean", "violet", "red", "paper"]) { const t = R.REM_COLOURS.find((x) => x.id === id)!; assert.equal(R.remLook(t.bg, t.accent).on, "#ffffff", id); }
  for (const acc of ["#e5e7eb", "#ffffff", "#fff8e1", "#f59e0b", "#22c55e"]) {
    const L = R.remLook("#18181b", acc);
    assert.notEqual(L.on, "#ffffff", acc);
    at(AA, c(L.on, L.mainTone), `main button on ${acc}`);
  }
});
ok("the dark themes look as before: white words, the 8% sheen, the full glow and button fill", () => {
  for (const t of R.REM_COLOURS.filter((x) => x.id !== "paper")) {
    const L = R.remLook(t.bg, t.accent);
    assert.equal(L.ink, "#ffffff"); assert.equal(L.lift, "#ffffff"); assert.equal(L.glow, 22); assert.equal(L.btn, 13);
    assert.equal(L.field, "rgba(0,0,0,.28)"); assert.equal(L.hint, "#fca5a5");
  }
});
ok("the alarm orb keeps the background's colour on its accent where it reads (every dark theme)", () => {
  for (const t of R.REM_COLOURS.filter((x) => x.id !== "paper")) assert.equal(R.alarmLook(t.bg, t.accent).on, t.bg, t.id);
});
ok("the plan hands every shell the readable ink", () => {
  const rec = R.cleanRemind({ list: [{ id: "a", bg: "#b0b0b0" }, { id: "b", bg: "#f6f3ee" }, { id: "c", bg: "#28121e" }] })!;
  const p = R.remPlan(rec, false);
  assert.deepEqual(p.items.map((i) => i.ink), [R.inkFor("#b0b0b0"), "#17121a", "#ffffff"]);
  assert.notEqual(p.items[0].ink, "#ffffff");
});

console.log(`\n${n} passed`);

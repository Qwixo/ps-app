// Screen fit (V1.40): the Tab list on any screen size and display scaling (src/core/screenfit.ts, src/ui/popfit.ts,
// ps-mac Sources/ScreenFit.swift).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { FIT_REF, cleanScreen, fitZoom, glassPlace, screenVars } from "../src/core/screenfit.ts";
import { popNudge } from "../src/ui/popfit.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };

ok("zoom: 1 on the developer's MacBook and every screen at least 1440 x 860, smaller below, never under 0.8", () => {
  for (const [w, h] of [[1710, 1112], [1440, 900], [1512, 982], [1470, 956], [1920, 1080], [2560, 1440], [3008, 1692], [1440, 860]]) assert.equal(fitZoom(w, h), 1, `${w}x${h}`);
  assert.equal(fitZoom(1280, 800), 0.889);
  assert.equal(fitZoom(1280, 720), 0.837);
  for (const [w, h] of [[1152, 720], [1024, 640], [1024, 576], [800, 500]]) assert.equal(fitZoom(w, h), 0.8, `${w}x${h}`);
  assert.equal(fitZoom(1, 1), 1, "the tucked 1 x 1 window is left alone");
  assert.equal(fitZoom(NaN, 900), 1);
});

// The Mac app's copy of the rule (ps-mac, a separate repo): PS_MAC_DIR, else ~/Projects/ps/mac. Skipped where it is not there.
const swiftAt = [process.env.PS_MAC_DIR, `${homedir()}/Projects/ps-mac`].filter(Boolean).map((d) => `${d}/Sources/ScreenFit.swift`).find((f) => existsSync(f));
if (swiftAt) ok("the Swift rule and this one are the same numbers", () => {
  const m = readFileSync(swiftAt, "utf8").match(/refW: CGFloat = (\d+), refH: CGFloat = (\d+), floor: CGFloat = ([\d.]+)/);
  assert.ok(m, "ScreenFit.swift constants");
  assert.deepEqual([Number(m[1]), Number(m[2]), Number(m[3])], [FIT_REF.w, FIT_REF.h, FIT_REF.floor]);
});
else console.log("skip - ScreenFit.swift not found (set PS_MAC_DIR to the ps-mac checkout)");

ok("what PS sends is checked; nonsense is refused", () => {
  assert.equal(cleanScreen(null), null);
  assert.equal(cleanScreen({ w: "1440", h: 900 }), null);
  assert.equal(cleanScreen({ w: 0, h: 900 }), null);
  const s = cleanScreen({ w: 1152, h: 720, scale: 2, zoom: 0.8, top: 25, bottom: 66, left: 0, right: 0, extra: "x" });
  assert.deepEqual(s, { w: 1152, h: 720, scale: 2, zoom: 0.8, top: 25, bottom: 66, left: 0, right: 0, native: 0, ui: 1, ax: false });
  assert.equal(cleanScreen({ w: 1440, h: 900, zoom: 99 })!.zoom, 2, "clamped");
});

ok("V1.47: the display scaling PS reads (native panel, how much bigger macOS draws, Accessibility Zoom)", () => {
  const s = cleanScreen({ w: 1152, h: 720, scale: 2, zoom: 0.8, top: 25, native: 2880, ui: 1.25, ax: 1 })!;
  assert.equal(s.native, 2880); assert.equal(s.ui, 1.25); assert.equal(s.ax, true);
  assert.equal(screenVars(s)["--scr-ui"], "1.25");
  const old = cleanScreen({ w: 1710, h: 1112, zoom: 1 })!;   // an older PS: nothing about the scaling
  assert.deepEqual([old.native, old.ui, old.ax], [0, 1, false]);
  assert.equal(cleanScreen({ w: 1440, h: 900, ui: 99, native: -5, ax: "yes" })!.ui, 4, "clamped");
  assert.equal(cleanScreen({ w: 1440, h: 900, native: -5, ax: "yes" })!.ax, false, "only 1 or true is on");
});

ok("--safe-top is the menu bar in page pixels (points divided by the zoom), as PS set it before at zoom 1", () => {
  assert.equal(screenVars(cleanScreen({ w: 1710, h: 1112, zoom: 1, top: 37.5 })!)["--safe-top"], "37px");
  assert.equal(screenVars(cleanScreen({ w: 1152, h: 720, zoom: 0.8, top: 25 })!)["--safe-top"], "31.25px");
  assert.equal(screenVars(cleanScreen({ w: 1152, h: 720, zoom: 0.8, top: 25, bottom: 66 })!)["--safe-bottom"], "82.5px");
});

// Measured on the fictional list (Playwright WebKit): clock pill right edge 296, glass bar 336 x 86.
const base = { gw: 336, gh: 86, leftRight: 296, top: 37 };
ok("glass bar: stays in the middle when it clears both sides (the developer's 1710 x 1112, every big screen)", () => {
  assert.deepEqual(glassPlace({ ...base, vw: 1710, trLeft: 1115, trBottom: 97, listL: 360, listR: 1374 }), { cx: 855, top: 37, spot: "middle" });
  assert.equal(glassPlace({ ...base, vw: 3008, trLeft: 2400, trBottom: 97, listL: 360, listR: 2672 }).spot, "middle");
});
ok("glass bar: a 1440 wide page with the top right row reaching the middle moves it into the free room", () => {
  const p = glassPlace({ ...base, vw: 1440, trLeft: 845, trBottom: 97, listL: 360, listR: 1104 });
  assert.equal(p.spot, "free");
  assert.ok(p.cx - 168 >= 296 + 12 && p.cx + 168 <= 845 - 12, `between the clock and the buttons: ${p.cx}`);
  assert.equal(p.top, 37);
});
ok("glass bar: no room in the top row puts it under the buttons, over the list, never off screen", () => {
  const p = glassPlace({ ...base, vw: 1152, trLeft: 558, trBottom: 85, listL: 336, listR: 816 });
  assert.deepEqual(p, { cx: 576, top: 97, spot: "below" });
  const q = glassPlace({ ...base, vw: 400, trLeft: 10, trBottom: 85, listL: 0, listR: 0 });
  assert.ok(q.cx - 168 >= 8, "left edge on screen");
});

ok("pop-ups: nudged back on screen sideways, height capped above the bottom; on a big screen nothing moves", () => {
  assert.deepEqual(popNudge({ left: 900, right: 1200, top: 100 }, 1710, 1112), { dx: 0, maxH: 1004 });
  assert.equal(popNudge({ left: -200, right: 560, top: 100 }, 1152, 720).dx, 208, "screen time pop-up off the left");
  assert.equal(popNudge({ left: 1000, right: 1300, top: 100 }, 1280, 800).dx, -28, "off the right");
  assert.equal(popNudge({ left: 0, right: 1400, top: 100 }, 1280, 800).dx, 8, "wider than the page: the left edge wins");
  assert.equal(popNudge({ left: 10, right: 20, top: 700 }, 1280, 720).maxH, 160, "always some room");
});

ok("the CSS: columns narrow only under about 1430 px, pop-ups from the top right come over the glass bar", () => {
  const css = readFileSync(new URL("../src/views/taskmap.css", import.meta.url), "utf8");
  assert.match(css, /--tm-colw: clamp\(240px, 21vw, 300px\)/);
  assert.match(css, /\.tm-tr \{ position: absolute;[^}]*z-index: 5;/);
  assert.match(css, /\.tm-glass-wrap \{ position: absolute; top: var\(--tm-gy,[^}]*z-index: 4;/);
  assert.match(css, /\.tm-side:has\(\.tm-tl\.open, \.tm-clocks\) \{ z-index: 6; \}/);
  assert.doesNotMatch(css, /@media \(max-width: 1100px\) \{ \.tm-scroll \{ padding-right: 0; \}/, "the old rule that slid the right column over the list");
});

ok("V1.55 small screens: the rules start under 920 px tall only, touch only the floating list, and pop-ups keep room", () => {
  const css = readFileSync(new URL("../src/views/smallscreen.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const media = [...css.matchAll(/@media\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(media.length >= 1);
  for (const m of media) {
    const h = m.match(/^max-height:\s*(\d+)px$/);
    assert.ok(h, `only max-height queries: ${m}`);
    assert.ok(Number(h[1]) < 982, `a 14 inch (982 points) and anything taller keep the layout: ${m}`);
    assert.ok(Number(h[1]) >= 900 || Number(h[1]) < 800, "the 13 inch default (900) gets the main block");
  }
  // Nothing outside a media query, and every rule is the floating list on the Mac (never the phone or the docked list).
  const outside = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "").trim();
  assert.equal(outside, "", "no rule applies at every size");
  for (const sel of [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim()).filter((x) => !x.startsWith("@media")))
    for (const one of sel.split(",")) assert.match(one.trim(), /^html:not\(\.gos\) \.tm-overlay:not\(\.tm-docked\) /, one);
  // The friend's screen: a pop-up's top is capped so at least 320 px stay free below it, whatever pushed it down.
  const tm = readFileSync(new URL("../src/views/taskmap.css", import.meta.url), "utf8");
  assert.match(tm, /--tm-pop-top: min\(max\([^;]*calc\(100vh - 320px\)\)\)/);
  // TaskMap and the update card read the island through topIsland, never the raw box.
  const tsx = readFileSync(new URL("../src/views/TaskMap.tsx", import.meta.url), "utf8");
  assert.match(tsx, /const up = topIsland\(island, root\.clientHeight\);/);
  assert.match(tsx, /import "\.\/smallscreen\.css";/);
  assert.match(readFileSync(new URL("../src/views/UpdateFace.tsx", import.meta.url), "utf8"), /topIsland\(islandBox\(\), window\.innerHeight\)/);
});

console.log(`screenfit: ${n} passed`);

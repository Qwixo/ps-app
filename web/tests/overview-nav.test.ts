// Run: node --experimental-strip-types tests/overview-nav.test.ts
// V1.56 moving around the Edit overview (core/overviewnav.ts, views/EditMode.tsx): click versus drag, which page a
// click picks, the edge scroll speed, the room going back to the starting page, the camera keeping still when the page
// in the middle changes, the rubber band, and the bar and hint keeping clear of the Dynamic Island.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLICK_SLOP, EDGE_MAX, EDGE_ZONE, REACH, barSpot, camBounds, clampCam, clickPick, easeInOut, edgePan, edgeRamp, flickTo, follow,
  glideMs, hintSpot, hitOf, isClick, keepInPlace, pansFrom, rubber,
} from "../src/core/overviewnav.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// A stand in for a DOM element: it "is inside" every selector part listed in `in`, with an optional page id.
function el(inside: string[], ovPage?: string) {
  return {
    closest(sel: string) {
      const parts = sel.split(",").map((x) => x.trim());
      const hit = parts.some((p) => inside.includes(p));
      if (!hit) return null;
      return parts.includes("[data-ov-page]") ? { dataset: { ovPage } } : {};
    },
  };
}

ok("a press that hardly moves is a click; more is a drag (never both)", () => {
  assert.equal(isClick(0, 0), true);
  assert.equal(isClick(3, 3), true);          // 4.2 px
  assert.equal(isClick(CLICK_SLOP - 0.1, 0), true);
  assert.equal(isClick(CLICK_SLOP, 0), false);
  assert.equal(isClick(-5, 5), false);        // 7 px
  assert.equal(isClick(0, -40), false);
});

ok("which page a click picks: a page beside, the page in the middle, the room, a control", () => {
  const ids = ["left", "main", "p2", "p3"];
  // A card beside (three pages along, say): that page.
  assert.equal(clickPick(hitOf(el(["[data-ov-page]", ".ov-card", ".ov-room"], "p3"), "main"), "main", ids), "p3");
  // The empty part of the page in the middle (its edit layer): the page showing.
  assert.equal(clickPick(hitOf(el([".tm-overlay.ed-able", ".tm-overlay", ".ed-layer"]), "main"), "main", ids), "main");
  assert.equal(clickPick(hitOf(el([".tm-overlay.ed-able", ".tm-overlay", ".ed-layer"]), "p2"), "main", ids), "p2");
  // A panel's outline, a button, a field, the bar, a name pill, a + card, the Add panels button on a card: their own click.
  for (const c of [[".tm-overlay.ed-able", ".ed-box"], [".tm-overlay.ed-able", "button"], [".tm-overlay.ed-able", "input"], [".ov-top"], [".ov-pill"], [".ov-plus"], [".ov-card-add", "[data-ov-page]"]]) {
    assert.deepEqual(hitOf(el(c, "p2"), "main"), { kind: "control" }, c.join(" "));
    assert.equal(clickPick(hitOf(el(c, "p2"), "main"), "main", ids), null);
  }
  // A page that was deleted meanwhile is never picked.
  assert.equal(clickPick({ kind: "page", id: "gone" }, "main", ids), null);
  // Anything that is not the overview at all (another pop-up) is left alone.
  assert.deepEqual(hitOf(el([".tl-menu"]), "main"), { kind: "control" });
});

ok("a click on the room goes back to the page that was showing when Edit opened", () => {
  const ids = ["left", "main", "p2", "p3"];
  const room = hitOf(el([".ov-room", ".ov-dim"]), "p3");   // the camera has moved on to p3 since
  assert.deepEqual(room, { kind: "room" });
  assert.equal(clickPick(room, "p2", ids), "p2");
  assert.equal(clickPick(room, "main", ids), "main");
  // That page was deleted in the overview: the main page.
  assert.equal(clickPick(room, "p9", ids), "main");
  assert.equal(clickPick(room, "p9", ["a", "b"]), "a");
});

ok("pans from the room, the pages beside, the + cards and the empty part of the page in the middle, never a control", () => {
  assert.equal(pansFrom(el([".ov-room", ".ov-dim"])), true);
  assert.equal(pansFrom(el([".ov-room", "[data-ov-page]", ".ov-card"])), true);
  assert.equal(pansFrom(el([".ov-room", ".ov-plus"])), true);
  assert.equal(pansFrom(el([".tm-overlay", ".ed-layer"])), true);
  assert.equal(pansFrom(el([".tm-overlay", ".ed-layer", ".ed-box"])), false);   // a panel drags itself
  assert.equal(pansFrom(el([".tm-overlay", ".tm-row"])), false);
  for (const c of [".ov-top", ".ov-pill", ".ov-cal", ".ov-card-add"]) assert.equal(pansFrom(el([".ov-room", c])), false, c);
  assert.equal(pansFrom(null), false);
});

ok("the edge scroll: the to-do list's bottom edge zone and curve, faster the closer, both sides", () => {
  const vw = 1440;
  assert.equal(EDGE_ZONE, 110); assert.equal(EDGE_MAX, 16);
  assert.equal(edgePan(vw / 2, vw), 0);
  assert.equal(edgePan(EDGE_ZONE, vw), 0);
  assert.equal(edgePan(vw - EDGE_ZONE, vw), 0);
  assert.ok(edgePan(100, vw) < 0 && edgePan(vw - 100, vw) > 0, "left goes left, right goes right");
  assert.equal(edgePan(0, vw), -EDGE_MAX);
  assert.equal(edgePan(vw, vw), EDGE_MAX);
  // Faster the closer, smoothly (no step).
  let last = 0;
  for (let x = 109; x >= 0; x--) { const v = -edgePan(x, vw); assert.ok(v >= last && v - last < 0.4, `${x}`); last = v; }
  // The same numbers the list used before (TaskMap.tsx): ((110 - d) / 110)^2 * 16.
  for (const d of [0, 10, 37, 55, 99, 109.5]) assert.ok(Math.abs(edgeRamp(d) - Math.pow((110 - d) / 110, 2) * 16) < 1e-9, String(d));
  assert.equal(edgeRamp(110), 0); assert.equal(edgeRamp(500), 0);
  // Off the screen, or a screen too narrow for two zones: nothing.
  assert.equal(edgePan(-3, vw), 0); assert.equal(edgePan(vw + 3, vw), 0); assert.equal(edgePan(NaN, vw), 0); assert.equal(edgePan(5, 200), 0);
  // The list's own edge scroll now uses the same function.
  const tm = src("views/TaskMap.tsx");
  assert.match(tm, /const EDGE = EDGE_ZONE;/);
  assert.match(tm, /const ramp = \(d: number\) => edgeRamp\(d\);/);
});

ok("the camera: half a page past each end, a rubber band beyond, a flick lands inside", () => {
  assert.deepEqual(camBounds(1), { min: 0, max: 0 });
  assert.deepEqual(camBounds(4), { min: -REACH, max: 3 + REACH });
  assert.equal(rubber(1.2, 0, 3), 1.2);
  const over = rubber(4, 0, 3, 0.35);
  assert.ok(over > 3 && over < 3.35, String(over));
  assert.ok(rubber(10, 0, 3, 0.35) < 3.35, "never further than one band");
  assert.ok(rubber(-1, 0, 3, 0.35) > -0.35 && rubber(-1, 0, 3, 0.35) < 0);
  assert.equal(clampCam(9, 3), 2.5); assert.equal(clampCam(-9, 3), -0.5);
  assert.equal(flickTo(1, 0, 4), 1);
  assert.ok(flickTo(1, 0.004, 4) > 1.9, "a quick flick carries on");
  assert.equal(flickTo(1, 1, 4), 3.5);
  assert.equal(flickTo(1, -1, 4), -0.5);
});

ok("glides are smooth: eased at both ends, a little longer the further, never slow", () => {
  assert.equal(easeInOut(0), 0); assert.equal(easeInOut(1), 1); assert.equal(easeInOut(0.5), 0.5);
  assert.ok(easeInOut(0.1) < 0.1 && easeInOut(0.9) > 0.9, "soft start and soft landing");
  assert.equal(easeInOut(-1), 0); assert.equal(easeInOut(2), 1);
  assert.equal(glideMs(0), 360); assert.ok(glideMs(1) < glideMs(3)); assert.equal(glideMs(20), 760);
  // Following a target does not depend on the frame rate: two 8 ms frames land where one 16 ms frame does.
  const a = follow(follow(0, 1, 8), 1, 8), b = follow(0, 1, 16);
  assert.ok(Math.abs(a - b) < 1e-12);
  assert.ok(Math.abs(follow(0.3, 1, 0) - 0.3) < 1e-12, "no time, no move");
});

ok("the page in the middle changes: whatever is on screen stays where it is (then the camera glides)", () => {
  const ids = ["a", "main", "b", "c"];
  // A click on c, two pages right of main: the camera is now two pages left of c, exactly where it was.
  assert.equal(keepInPlace(0, ids, "main", ids, "c"), -2);
  // The row was slid half a page right first.
  assert.equal(keepInPlace(0.5, ids, "main", ids, "c"), -1.5);
  // Back to a page on the left.
  assert.equal(keepInPlace(0, ids, "b", ids, "a"), 2);
  // A new page past the right end while looking at the right + card.
  assert.equal(keepInPlace(0.5, ["main", "b"], "b", ["main", "b", "n"], "n"), -0.5);
  // A new page on the left: every page moved one place along, the camera too.
  assert.equal(keepInPlace(0, ["main", "b"], "main", ["n", "main", "b"], "n"), 1);
  // The page showing was deleted: held on to the new one (main), which keeps its place.
  assert.equal(keepInPlace(0, ["a", "main", "b"], "b", ["a", "main"], "main"), 1);
  // Unknown pages: centred.
  assert.equal(keepInPlace(0.7, ["x"], "x", ["y"], "y"), 0);
});

ok("nothing over anything: the bar keeps clear of the Dynamic Island", () => {
  const vw = 1512, bw = 280, bh = 44;
  // No island on this screen: top middle.
  assert.deepEqual(barSpot(null, vw, bw, bh), { left: (vw - bw) / 2, top: 16 });
  // The island at the top middle (the developer's screenshot): the top left corner, where the Edit button was.
  const island = { left: 680, top: 0, right: 832, bottom: 38 };
  const at = barSpot(island, vw, bw, bh);
  assert.deepEqual(at, { left: 24, top: 16 });
  const clear = (s: { left: number; top: number }, i: typeof island) => s.left + bw <= i.left || s.left >= i.right || s.top + bh <= i.top || s.top >= i.bottom;
  assert.ok(clear(at, island));
  // Moved to the top left: the top middle is free again.
  assert.deepEqual(barSpot({ left: 0, top: 0, right: 340, bottom: 40 }, vw, bw, bh), { left: (vw - bw) / 2, top: 16 });
  // Open over the middle and the left: the top right.
  const tl = { left: 0, top: 0, right: 900, bottom: 40 };
  assert.deepEqual(barSpot(tl, vw, bw, bh), { left: vw - 24 - bw, top: 16 });
  // Open wide right across the top: under it, in the middle.
  const wide = { left: 0, top: 0, right: vw, bottom: 120 };
  const u = barSpot(wide, vw, bw, bh);
  assert.ok(clear(u, wide) && u.top >= 120, JSON.stringify(u));
  // Moved down to the bottom: the bar stays top middle.
  assert.deepEqual(barSpot({ left: 680, top: 860, right: 832, bottom: 898 }, vw, bw, bh), { left: (vw - bw) / 2, top: 16 });
});

ok("nothing over anything: the hint keeps clear of an island moved down to the bottom", () => {
  const vw = 1512, vh = 945, hw = 600, hh = 18;
  const base = hintSpot(null, vw, vh, hw, hh);
  assert.deepEqual(base, { left: (vw - hw) / 2, top: vh - 16 - hh });
  assert.deepEqual(hintSpot({ left: 680, top: 0, right: 832, bottom: 38 }, vw, vh, hw, hh), base);
  const low = { left: 680, top: 880, right: 832, bottom: 930 };
  const s = hintSpot(low, vw, vh, hw, hh);
  assert.ok(s.top + hh <= low.top, JSON.stringify(s));
});

ok("the drawing code: one frame loop that stops by itself, the list's own swipes off in the overview", () => {
  const em = src("views/EditMode.tsx"), lp = src("views/ListPager.tsx"), css = src("views/editmode.css");
  // The loop only asks for another frame while something moves; at an end of the row it rests.
  assert.match(em, /if \(busy\) cam\.raf = requestAnimationFrame\(camTick\);/);
  assert.match(em, /busy = cam\.off !== was;   \/\/ stopped at an end/);
  // The row moves by writing translate on two elements, never a CSS variable on <html> each frame.
  const paint = em.slice(em.indexOf("function camPaint()"), em.indexOf("function camTick("));
  assert.match(paint, /style\.translate = /);
  assert.doesNotMatch(paint, /documentElement|setProperty|setState/);
  // Done and Esc glide home before the card is full size.
  assert.match(em, /camGlide\(0, undefined, 1, 440\); onDone\(\);/);
  // A far page: glides to the middle, then zooms in.
  assert.match(em, /camGlide\(0, leave, 0\.72\)/);
  // The room's click goes back to the start page; a drag eats its click.
  assert.match(em, /clickPick\(hit, start\.current, api\.current\.ids\)/);
  assert.match(em, /if \(p\.moved\) eatClick = performance\.now\(\);/);
  // A carried panel: the drop target is checked again as the row slides under it.
  assert.match(em, /cam\.onPan = \(\) => \{ if \(live\.current\?\.moved && lastPt\.current\) moveNow\.current\(lastPt\.current\); \};/);
  // The list's own wheel, finger and arrow swipes leave the overview alone.
  assert.match(lp, /if \(e\.ctrlKey \|\| overviewOn\(\)\) return;/);
  assert.match(lp, /tg \|\| overviewOn\(\)\) return;/);
  assert.match(lp, /e\.shiftKey \|\| overviewOn\(\)\) return;/);
  // The spotlight is still: no animation runs while the overview sits open.
  const spot = css.slice(css.indexOf("V1.56, the spotlight"), css.indexOf("/* The row of pages slides"));
  assert.doesNotMatch(spot, /animation:|infinite/);
  assert.match(spot, /\.ov-beam/); assert.match(spot, /\.ov-floor/);
});

ok("no em or en dashes in the new code", () => {
  for (const f of ["core/overviewnav.ts", "views/EditMode.tsx", "views/editmode.css"]) assert.doesNotMatch(src(f), /[–—]/, f);
});

console.log(`\n${n} passed`);

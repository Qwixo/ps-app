// Island clearance (V1.53, src/core/islandclear.ts): Keep overlay and Hover mode slide out of the Dynamic Island's way.
// The numbers are measured from the Tab list in the browser (1512 x 945, a 14 inch MacBook Pro with its 32 point notch).
import assert from "node:assert/strict";
import { ISLAND_GAP, BLOCK_GAP, EDGE_GAP, NO_CLEAR, cleanSpot, islandClear, near, spotBox, topClear, topIsland, type Box, type ClearIn, type ClearOut } from "../src/core/islandclear.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
const centred = (cx: number, w: number, top: number, h: number) => box(cx - w / 2, top, cx + w / 2, top + h);

// The Tab list at 1512 wide as measured: the glass bar placed in the free room left of the top right buttons.
const MBP: Omit<ClearIn, "island"> = {
  vw: 1512,
  keep: box(490, 44, 620, 77), hover: box(628, 44, 752, 77), slider: box(453, 85, 790, 131),
  blocks: [box(917, 52, 1488, 95), box(1370, 103, 1488, 137), box(24, 52, 100, 84)],   // top right buttons, second row, Edit
};
// A big screen (1920, an external display) with the bar in the middle: room on both sides of the island.
const WIDE: Omit<ClearIn, "island"> = {
  vw: 1920,
  keep: box(825, 44, 955, 77), hover: box(963, 44, 1087, 77), slider: box(791, 85, 1128, 131),
  blocks: [box(1325, 52, 1896, 95), box(24, 52, 100, 84)],
};
const NOTCH_H = 32, MID = 756, MID_WIDE = 960;
// Island shapes from Island.swift shapeRect (top left origin, points = page pixels at zoom 1).
const drop = (cx: number) => centred(cx, 300, 0, NOTCH_H + 30);                    // Drop, collapsed: body 300 x 30 under the notch
const slim = (cx: number) => centred(cx, 185 + 68, 0, NOTCH_H);                     // Slim, collapsed: wings in the menu bar only
const halo = (cx: number) => centred(cx, 185, 0, NOTCH_H);                          // Halo, collapsed: just the notch
const pillOnNotch = (cx: number) => centred(cx, 330, NOTCH_H + 6, 34);             // the pill under a notch
const open = (cx: number, rows = 3) => centred(cx, 400, 0, NOTCH_H + 18 + 34 + rows * 42);   // the hover view, open
const news = (cx: number) => centred(cx, 400, 0, NOTCH_H + 78);                    // a new email popped open

/** What every answer must hold: shown buttons never touch the island, anything on the row, or the screen's edge, and
 *  Keep overlay always stays left of Hover mode. */
function sound(i: ClearIn, o: ClearOut) {
  const k = { ...i.keep, left: i.keep.left + o.keepDx, right: i.keep.right + o.keepDx };
  const h = { ...i.hover, left: i.hover.left + o.hoverDx, right: i.hover.right + o.hoverDx };
  for (const [b, hidden, name] of [[k, o.keepHide, "Keep overlay"], [h, o.hoverHide, "Hover mode"]] as const) {
    if (hidden) continue;
    if (i.island) assert.ok(!near(b, i.island, ISLAND_GAP - 1), `${name} touches the island ${JSON.stringify(b)}`);
    if (o.layout !== "none") {
      assert.ok(b.left >= EDGE_GAP - 0.5 && b.right <= i.vw - EDGE_GAP + 0.5, `${name} off the screen`);
      for (const x of i.blocks) assert.ok(!near(b, x, BLOCK_GAP - 1, 0), `${name} slid onto ${JSON.stringify(x)}`);
    }
  }
  if (!o.keepHide && !o.hoverHide) assert.ok(k.right <= h.left - 7.5, "the two buttons never cross or touch");
  if (i.slider && i.island && !o.sliderHide) assert.ok(!near(i.slider, i.island, 0), "the slider is never under the island");
}
const run = (base: Omit<ClearIn, "island">, island: Box | null) => { const i = { ...base, island }; const o = islandClear(i); sound(i, o); return o; };

ok("no island (off, hidden by its grab line, over 1Password, another screen): nothing moves", () => {
  assert.deepEqual(run(MBP, null), NO_CLEAR);
  assert.deepEqual(run(WIDE, null), NO_CLEAR);
});

ok("Slim and Halo end in the menu bar, 12 points above the buttons: nothing moves", () => {
  assert.deepEqual(run(MBP, slim(MID)), NO_CLEAR);
  assert.deepEqual(run(MBP, halo(MID)), NO_CLEAR);
  assert.deepEqual(run(WIDE, slim(MID_WIDE)), NO_CLEAR);
});

ok("Drop under the notch on a big screen: Keep overlay slides left, Hover mode right", () => {
  const o = run(WIDE, drop(MID_WIDE));
  assert.equal(o.layout, "split");
  assert.ok(o.keepDx < 0 && o.hoverDx > 0);
  assert.equal(955 + o.keepDx, MID_WIDE - 150 - ISLAND_GAP, "Keep overlay ends just left of the island");
  assert.equal(963 + o.hoverDx, MID_WIDE + 150 + ISLAND_GAP, "Hover mode starts just right of it");
  assert.equal(o.sliderHide, false, "the collapsed island never reaches the slider");
});

ok("the pill under a notch: the same split, a little further out (it is 330 wide)", () => {
  const d = run(WIDE, drop(MID_WIDE)), p = run(WIDE, pillOnNotch(MID_WIDE));
  assert.equal(p.layout, "split");
  assert.ok(p.keepDx < d.keepDx && p.hoverDx > d.hoverDx);
});

ok("The developer's photo, the pill on a 14 inch screen: the top right buttons leave no room for Hover mode on the right, so both slide left together", () => {
  for (const isl of [drop(MID), pillOnNotch(MID)]) {
    const o = run(MBP, isl);
    assert.equal(o.layout, "left");
    assert.equal(o.keepDx, o.hoverDx, "they move as one");
    assert.equal(752 + o.hoverDx, isl.left - ISLAND_GAP);
  }
});

ok("the island open (hover view, three tasks): buttons clear its 400 point width and the slider fades under it", () => {
  const o = run(MBP, open(MID));
  assert.equal(o.layout, "left");
  assert.equal(o.sliderHide, true);
  const w = run(WIDE, open(MID_WIDE));
  assert.equal(w.layout, "split");
  assert.equal(w.sliderHide, true);
  assert.equal(run(WIDE, news(MID_WIDE)).sliderHide, true, "a new email popping it open for a few seconds too");
});

ok("the island back to collapsed: the slider shows again and the buttons go back to the collapsed spots", () => {
  const a = run(WIDE, drop(MID_WIDE)), b = run(WIDE, open(MID_WIDE)), c = run(WIDE, drop(MID_WIDE));
  assert.deepEqual(c, a);
  assert.ok(b.keepDx < a.keepDx && b.hoverDx > a.hoverDx);
});

ok("a Mac without a notch (the M1): the pill sits under a 24 point menu bar and still clears the buttons", () => {
  const M1: Omit<ClearIn, "island"> = { ...WIDE, vw: 1440, keep: box(590, 36, 720, 69), hover: box(728, 36, 852, 69), slider: box(553, 77, 890, 123), blocks: [box(1000, 44, 1416, 87)] };
  const o = run(M1, centred(720, 330, 30, 34));
  assert.notEqual(o.layout, "none");
  assert.equal(o.keepHide || o.hoverHide, false);
});

ok("the island moved in Edit mode: away from the bar nothing moves; over one button only that side reacts", () => {
  assert.deepEqual(run(MBP, centred(300, 330, 600, 34)), NO_CLEAR, "moved down to the lower left");
  const right = run(WIDE, box(1000, 40, 1230, 74));   // dropped over Hover mode only
  assert.equal(right.keepHide || right.hoverHide, false);
  assert.ok(right.hoverDx <= 0, "it goes left, the top right buttons are in the way on the right");
  const left = run(WIDE, box(600, 40, 830, 74));      // dropped over Keep overlay only
  assert.equal(left.layout, "split"); assert.ok(left.keepDx < 0); assert.equal(left.hoverDx, 0, "Hover mode was clear: it stays");
});

ok("the island moved onto the slider alone: only the slider fades", () => {
  const o = run(WIDE, centred(960, 270, 92, 28));
  assert.equal(o.sliderHide, true);
  assert.equal(o.keepDx, 0); assert.equal(o.hoverDx, 0);
});

ok("a tiny screen with the island open: what cannot fit anywhere fades instead of sitting under it", () => {
  const SMALL: Omit<ClearIn, "island"> = { vw: 900, keep: box(320, 44, 450, 77), hover: box(458, 44, 582, 77), slider: box(283, 85, 620, 131), blocks: [box(700, 52, 888, 95), box(12, 52, 100, 84)] };
  const o = run(SMALL, open(450));
  assert.equal(o.layout, "partial");
  assert.equal(o.hoverHide, true);
  assert.equal(o.sliderHide, true);
});

ok("never touches anything, for any island anywhere (12,000 random islands on three layouts)", () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (const base of [MBP, WIDE, { ...MBP, vw: 1100, blocks: [box(800, 52, 1088, 95)] }]) {
    for (let k = 0; k < 4000; k++) {
      const w = 180 + rnd() * 240, h = 28 + rnd() * 200, cx = rnd() * base.vw, top = rnd() * 160;
      run(base, centred(cx, w, top, h));
    }
  }
});

ok("what the Mac sends is checked; nonsense is no island", () => {
  assert.deepEqual(cleanSpot({ x: 606, y: 0, w: 300, h: 62, vw: 1512, vh: 982 }), { x: 606, y: 0, w: 300, h: 62, vw: 1512, vh: 982 });
  for (const bad of [null, 5, "x", {}, { x: 1, y: 1, w: 0, h: 5, vw: 10, vh: 10 }, { x: NaN, y: 0, w: 5, h: 5, vw: 10, vh: 10 }, { x: "1", y: 0, w: 5, h: 5, vw: 10, vh: 10 }, { x: 1, y: 1, w: 5, h: 5, vw: 0, vh: 10 }])
    assert.equal(cleanSpot(bad), null, JSON.stringify(bad));
});

ok("points become page pixels on a zoomed page (a small screen fits the list at 0.8)", () => {
  const s = cleanSpot({ x: 500, y: 0, w: 300, h: 60, vw: 1280, vh: 800 });
  assert.deepEqual(spotBox(s, 1280), box(500, 0, 800, 60));
  assert.deepEqual(spotBox(s, 1600), box(625, 0, 1000, 75), "page zoom 0.8: 1280 points are 1600 page pixels");
  assert.equal(spotBox(null, 1000), null);
  assert.equal(spotBox(s, 0), null, "the tucked window measures nothing");
});

ok("the update card at the top centre opens below the top bar and the island, never on them", () => {
  const span = { left: 536, right: 976 }, min = 54;
  const bar = [box(490, 44, 620, 77), box(628, 44, 752, 77), box(453, 85, 790, 131), box(917, 52, 1011, 85)];
  assert.equal(topClear(span, [], min), min, "nothing there: its usual place");
  assert.equal(topClear(span, bar, min), 131 + 12, "below the slider, the lowest piece under it");
  assert.equal(topClear(span, [...bar, open(MID)], min), open(MID).bottom + 12, "below the island while it is open");
  assert.equal(topClear(span, [box(1370, 103, 1488, 137), box(24, 52, 100, 84)], min), min, "pieces beside it do not count");
  assert.equal(topClear(span, [null, box(NaN, 0, 1, 1)], min), min, "no island, nonsense ignored");
});

ok("V1.55 small screens: only an island up top pushes the pop-ups down; dragged to a corner it never pushes them off screen", () => {
  const pill = (top: number, left = 1180) => box(left, top, left + 220, top + 38);
  assert.deepEqual(topIsland(pill(0, 610), 900), pill(0, 610), "the usual island at the top centre counts");
  assert.deepEqual(topIsland(pill(320), 900), pill(320), "still in the top part of the page");
  assert.equal(topIsland(pill(842), 900), null, "the friend's 13 inch Air: the pill at the bottom right corner does not count");
  assert.equal(topIsland(pill(742), 800), null, "the same at 1024 x 640 (an 800 px page)");
  assert.equal(topIsland(pill(2100), 2160), null, "and on a 4K screen");
  assert.equal(topIsland(pill(360), 900), null, "the top part ends at 40 percent of the page");
  assert.equal(topIsland(null, 900), null, "no island");
  assert.equal(topIsland(pill(0), 0), null, "the tucked window measures nothing");
  assert.equal(topIsland(box(NaN, 0, 1, 1), 900), null, "nonsense ignored");
  // The update card uses the same rule: an island at the bottom is not "above" it.
  assert.equal(topClear({ left: 1100, right: 1500 }, [topIsland(pill(842), 900)], 54), 54, "the update card keeps its place");
});

console.log(`islandclear tests: ${n} passed`);

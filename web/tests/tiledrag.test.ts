// Run: node --experimental-strip-types tests/tiledrag.test.ts
// V1.65 smooth dragging in the phone editors (core/tiledrag.ts, views/tiledrive.ts, gos/PhoneEditMode.tsx, views/PhoneEditor.tsx).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cellBox } from "../src/core/phonelayout.ts";
import { dragDelta, dragSig, frameQueue, ghostFor, moveTransform, navTransform, outsideBox, settleVars, tileVars } from "../src/core/tiledrag.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const W = 390;
const t = { id: "meetings", c: 0, r: 0, w: 2, h: 2 };

ok("the pointer travel is in the page's own pixels (undone scale, plus how far the row slid)", () => {
  assert.deepEqual(dragDelta(100, 100, 160, 130, 0.5), { dx: 120, dy: 60 });
  assert.deepEqual(dragDelta(100, 100, 160, 130, 0.5, 30), { dx: 180, dy: 60 });
  assert.deepEqual(dragDelta(0, 0, 10, 10, 0), { dx: 10, dy: 10 });
});
ok("the ghost is the cell the panel would land on, kept on the grid", () => {
  const b = cellBox(t, W);
  const g = ghostFor(t, "move", 0, 0, W);
  assert.equal(g.c, 0); assert.equal(g.r, 0);
  const far = ghostFor(t, "move", 5000, 5000, W);
  assert.equal(far.c, 2);   // 4 columns, 2 wide
  assert.ok(far.r > 0);
  const right = ghostFor(t, "move", b.width + 20, 0, W);
  assert.ok(right.c >= 1);
});
ok("sizing gives whole cells and never past the right edge", () => {
  const g = ghostFor({ ...t, c: 3, w: 1, h: 1 }, "size", 400, 0, W);
  assert.ok(g.c + g.w <= 4);
  const small = ghostFor(t, "size", -9999, -9999, W);
  assert.equal(small.w, 1); assert.equal(small.h, 1);
});
ok("React hears only when the landing cell, the page over it, or going out changes", () => {
  const a = dragSig(t, "move", 1, 1, W, null);
  assert.equal(a, dragSig(t, "move", 2, 3, W, null));   // a few px inside the same cell: same signature, no draw
  assert.notEqual(a, dragSig(t, "move", 2, 3, W, "page2"));
  assert.notEqual(a, dragSig(t, "move", 2, 3, W, null, true));
  assert.notEqual(a, dragSig(t, "move", 500, 400, W, null));
  let draws = 0, last = "";
  for (let i = 0; i < 60; i++) { const s = dragSig(t, "move", i * 0.5, i * 0.5, W, null); if (s !== last) { last = s; draws++; } }
  assert.ok(draws <= 3, `60 moves inside one or two cells drew ${draws} times`);
});
ok("a sized panel adds width and height by variables (never below the minimum), a moved one by a transform", () => {
  assert.deepEqual(tileVars(t, "move", 12, -4, W), { "--dx": "12px", "--dy": "-4px", "--dw": "0px", "--dh": "0px" });
  const b = cellBox(t, W);
  const v = tileVars(t, "size", 20, 30, W);
  assert.equal(v["--dw"], "20px"); assert.equal(v["--dh"], "30px"); assert.equal(v["--dx"], "0px");
  assert.equal(tileVars(t, "size", -9999, -9999, W)["--dw"], `${30 - b.width}px`);
});
ok("on let go the panel glides: the start offset is the carried spot minus the landing spot", () => {
  const from = cellBox(t, W);
  const landed = { ...t, c: 2, r: 1 };
  const to = cellBox(landed, W);
  const v = settleVars(t, "move", 100, 50, landed, W);
  assert.equal(parseFloat(v["--dx"]), from.left + 100 - to.left);
  assert.equal(parseFloat(v["--dy"]), from.top + 50 - to.top);
  assert.equal(parseFloat(settleVars(t, "move", 0, 0, t, W)["--dx"]), 0);   // dropped where it was: nothing to glide
  const sz = settleVars(t, "size", 40, 0, { ...t, w: 3 }, W);
  assert.equal(parseFloat(sz["--dw"]), Math.max(30, from.width + 40) - cellBox({ ...t, w: 3 }, W).width);
});
ok("the navbar transforms: the bar leans, a button follows the finger", () => {
  assert.equal(navTransform({ kind: "bar", dx: 100, dy: -40 }), "translate3d(15px, -6px, 0)");
  assert.equal(navTransform({ kind: "item", dx: 33 }), "translate3d(33px, 0, 0)");
  assert.equal(moveTransform(12, -4), "translate3d(12px, -4px, 0)");
});
ok("the page under the finger is looked up only once the finger leaves the page in the middle", () => {
  const r = { left: 10, top: 10, right: 100, bottom: 200 };
  assert.equal(outsideBox(50, 50, r), false);
  assert.equal(outsideBox(150, 50, r), true);
  assert.equal(outsideBox(50, 50, null), true);
});
ok("frameQueue: a hundred moves in a frame run once, newest first wins, flush runs it now, cancel drops it", () => {
  const frames: (() => void)[] = [];
  const q = frameQueue((cb) => frames.push(cb), (id) => { frames[id - 1] = () => {}; });
  const seen: number[] = [];
  for (let i = 0; i < 100; i++) q.push(() => seen.push(i));
  assert.equal(frames.length, 1);
  frames[0]();
  assert.deepEqual(seen, [99]);
  q.push(() => seen.push(1)); q.flush();
  assert.deepEqual(seen, [99, 1]);
  assert.equal(q.pending(), false);
  q.push(() => seen.push(2)); q.cancel();
  assert.equal(q.pending(), false);
  frames.at(-1)!();
  assert.deepEqual(seen, [99, 1]);
});
ok("the phone editors drag without a state write per pointer move (source check)", () => {
  for (const f of ["src/gos/PhoneEditMode.tsx", "src/views/PhoneEditor.tsx"]) {
    const src = read(f);
    assert.ok(src.includes("frameQueue") && src.includes("carry(") && src.includes("carryNav("), `${f} carries by frame`);
    assert.ok(!/setTile\(\{ \.\.\.tile, dx:/.test(src), `${f}: no setTile per move`);
    assert.ok(!/setNav\(\{ \.\.\.nav, dx:/.test(src), `${f}: no setNav per move`);
  }
  const grid = read("src/views/PhoneEditor.tsx");
  assert.ok(grid.includes("var(--dw, 0px)") && grid.includes("data-tid"), "a tile is sized and carried by variables");
  assert.ok(!/left: b\.left \+ drag\.dx/.test(grid), "a carried tile no longer moves by left and top");
  const css = read("src/views/phoneeditor.css");
  assert.ok(/\.pe-tile \{[^}]*transition: transform/.test(css), "it glides home by a transform transition");
  assert.ok(read("src/views/tiledrive.ts").includes("el.style.transform = moveTransform"), "a move writes a transform, not a variable");
});
console.log(`\n${n} passed`);

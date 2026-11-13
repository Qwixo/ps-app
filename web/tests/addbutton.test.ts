// The Add task button's colour and click animation (core/addbutton.ts, V1.34).
import assert from "node:assert/strict";
import { ADD_ANIMS, ADD_COLORS, ADD_COLOR_DEFAULT, addAnimOf, addColorOf, addInkOn, cleanAddLooks } from "../src/core/addbutton.ts";
import { contrast } from "../src/core/prio.ts";
let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
ok("defaults: Mint and Spin 360", () => { assert.equal(addColorOf({}), ADD_COLOR_DEFAULT); assert.equal(addAnimOf(undefined), "spin"); });
ok("cleaned on read: an odd colour or animation is the default", () => {
  assert.equal(addColorOf({ tmAddColor: "blue" }), ADD_COLOR_DEFAULT);
  assert.equal(addColorOf({ tmAddColor: "#ABC" }), "#aabbcc");
  assert.equal(addAnimOf({ tmAddAnim: "explode" as never }), "spin");
  assert.equal(addAnimOf({ tmAddAnim: "none" }), "none");
});
ok("cleaned on save", () => {
  assert.deepEqual(cleanAddLooks({ tmAddColor: "#38BDF8", tmAddAnim: "pop" }), { tmAddColor: "#38bdf8", tmAddAnim: "pop" });
  assert.deepEqual(cleanAddLooks({ tmAddColor: null }), { tmAddColor: null });
  assert.deepEqual(cleanAddLooks({ tmAddColor: "url(x)", tmAddAnim: 3 }), {});
});
ok("the + always reads on its colour (at least 3:1), presets and any custom colour", () => {
  for (const c of [...ADD_COLORS.map((x) => x.id), "#000000", "#777777", "#123456", "#ffff00"]) assert.ok(contrast(c, addInkOn(c)) >= 3, c);
});
ok("Spin 360 first, None last, five choices", () => { assert.deepEqual(ADD_ANIMS.map((a) => a.id), ["spin", "pop", "bounce", "pulse", "none"]); });
console.log(`${n} of ${n} ok`);

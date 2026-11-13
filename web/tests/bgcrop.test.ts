// Run: node --experimental-strip-types tests/bgcrop.test.ts
// V1.47: the phone's own background and how a video fits the phone (the developer: "make it so the backgrounds don't mimic what
// you have on the desktop ... make it so you can crop the video, with different options for how you crop it").
// src/core/bgcrop.ts (rules and maths), src/core/bgsync.ts pickStandIns, src/ps.ts cleanLooks, views/BgFit.tsx.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const C = await import("../src/core/bgcrop.ts");
const S = await import("../src/core/bgsync.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const close = (a: number, b: number, msg?: string) => assert.ok(Math.abs(a - b) < 1e-3, `${msg ?? ""} ${a} != ${b}`);
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const DASHES = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");
const isBg = (v: string) => /^(none|spotlight|video:[a-z0-9-]{1,48}|color:[a-z#0-9]+)$/.test(v);

const LAND = { w: 1920, h: 1080 };   // The developer's Mac video
const PHONE = { w: 412, h: 915 };    // the Pixel 10a in CSS pixels

ok("nothing saved: fill at the automatic portrait crop, as before V1.47", () => {
  assert.deepEqual(C.defaultCrop(0.3), { mode: "fill", x: 0.3, y: 0.5, zoom: 1, bars: "blur" });
  assert.deepEqual(C.cropFor(undefined, "video:abc", 0.7), C.defaultCrop(0.7));
  assert.deepEqual(C.cropFor({ "video:other": { mode: "fit" } }, "video:abc", 0.2).mode, "fill");
  assert.deepEqual(C.cropCss(C.defaultCrop(0.3)), { objectFit: "cover", objectPosition: "30% 50%" }, "no transform at zoom 1");
});

ok("a saved crop is checked: modes, 0 to 1, zoom 1 to 3, bars", () => {
  const c = C.cleanCrop({ mode: "fit", x: 2, y: -1, zoom: 9, bars: "colour" })!;
  assert.deepEqual(c, { mode: "fit", x: 1, y: 0, zoom: 3, bars: "colour" });
  assert.deepEqual(C.cleanCrop({ mode: "weird", x: "0.25", zoom: 0.2, bars: "pink" })!, { mode: "fill", x: 0.25, y: 0.5, zoom: 1, bars: "blur" });
  assert.equal(C.cleanCrop(null), null);
  assert.equal(C.cleanCrop([1, 2]), null);
  assert.equal(C.cleanCrop({ x: 0.123456 })!.x, 0.123, "three decimals");
});

ok("the saved list: only background ids, at most 40", () => {
  const raw: Record<string, unknown> = { "video:a": { mode: "fit" }, "bad key": { mode: "fit" }, "video:../x": {}, "spotlight": {} };
  assert.deepEqual(Object.keys(C.cleanCrops(raw)), ["video:a"]);
  const many: Record<string, unknown> = {};
  for (let i = 0; i < 60; i++) many[`video:v${i}`] = { x: 0.1 };
  const kept = Object.keys(C.cleanCrops(many));
  assert.equal(kept.length, C.CROPS_MAX);
  assert.equal(kept[kept.length - 1], "video:v59", "the newest are kept");
  assert.deepEqual(C.cleanCrops("x"), {});
});

ok("saving one crop keeps the others, forgets ones for videos gone from the vault", () => {
  const was = { "video:a": { mode: "fit", x: 0.2, y: 0.5, zoom: 1, bars: "black" }, "video:gone": { mode: "fill", x: 0.9, y: 0.5, zoom: 1, bars: "blur" } };
  const next = C.withCrop(was, "video:b", { mode: "fill", x: 0.4, y: 0.6, zoom: 1.5, bars: "blur" }, ["a", "b"]);
  assert.deepEqual(Object.keys(next).sort(), ["video:a", "video:b"]);
  assert.equal(next["video:b"].zoom, 1.5);
  assert.deepEqual(Object.keys(C.withCrop(next, "video:a", null)), ["video:b"], "null forgets it (Automatic)");
});

ok("Fill: a landscape video on a portrait phone shows a portrait slice, full height", () => {
  const win = C.cropWindow(LAND, PHONE, C.defaultCrop(0.5));
  close(win.h, 1, "full height");
  close(win.w, (412 / 915) / (1920 / 1080), "width is the phone's shape");
  close(win.left, (1 - win.w) / 2, "centred");
  close(win.top, 0);
});

ok("Fill: the focus point moves the slice from the left edge to the right edge", () => {
  const l = C.cropWindow(LAND, PHONE, { ...C.defaultCrop(), x: 0 }), r = C.cropWindow(LAND, PHONE, { ...C.defaultCrop(), x: 1 });
  close(l.left, 0); close(r.left + r.w, 1);
});

ok("Zoom: twice the zoom shows half as much round the same point", () => {
  const c = { ...C.defaultCrop(0.3), y: 0.4 };
  const a = C.cropWindow(LAND, PHONE, c), b = C.cropWindow(LAND, PHONE, { ...c, zoom: 2 });
  close(b.w, a.w / 2); close(b.h, a.h / 2);
  // The focus point stays at the same place on screen: fraction p of the window is the video's point p.
  close(b.left + 0.3 * b.w, 0.3); close(b.top + 0.4 * b.h, 0.4);
  close(a.left + 0.3 * a.w, 0.3);
  assert.deepEqual(C.cropCss({ ...c, zoom: 2 }), { objectFit: "cover", objectPosition: "30% 40%", transform: "scale(2)", transformOrigin: "30% 40%" });
});

ok("Fit: the whole video shows, with bars above and below on a portrait phone", () => {
  const c = { ...C.defaultCrop(), mode: "fit" as const };
  const win = C.cropWindow(LAND, PHONE, c);
  close(win.w, 1, "the full width");
  assert.ok(win.h > 1, "more than the video's height: bars");
  assert.equal(C.hasBars(LAND, PHONE, c), true);
  assert.equal(C.hasBars(LAND, PHONE, C.defaultCrop()), false, "Fill never has bars");
  assert.equal(C.cropCss(c).objectFit, "contain");
  // Zoomed in far enough, Fit covers the screen and the bars go.
  assert.equal(C.hasBars(LAND, PHONE, { ...c, zoom: 3 }), true, "3x of a 16:9 video is still not tall enough");
  assert.equal(C.hasBars({ w: 1000, h: 1200 }, PHONE, { ...c, zoom: 2 }), false);
});

ok("a portrait video on a portrait phone needs no crop", () => {
  const win = C.cropWindow({ w: 1080, h: 1920 }, { w: 1080, h: 1920 }, C.defaultCrop());
  close(win.w, 1); close(win.h, 1); close(win.left, 0);
});

ok("the maths does not mind the screen's size, only its shape (the editor's small preview matches the phone)", () => {
  const c = { ...C.defaultCrop(0.8), zoom: 1.7 };
  const big = C.cropWindow(LAND, PHONE, c), small = C.cropWindow(LAND, { w: PHONE.w / 4, h: PHONE.h / 4 }, c);
  for (const k of ["left", "top", "w", "h"] as const) close(big[k], small[k], k);
});

ok("odd sizes never break it", () => {
  assert.deepEqual(C.cropWindow({ w: 0, h: 0 }, PHONE, C.defaultCrop()), { left: 0, top: 0, w: 1, h: 1 });
  assert.deepEqual(C.cropWindow(LAND, { w: NaN, h: 5 }, C.defaultCrop()), { left: 0, top: 0, w: 1, h: 1 });
  assert.equal(C.baseScale({ w: 0, h: 1 }, PHONE, "fill"), 1);
});

ok("dragging the preview: the picture follows the finger, and stays inside the video", () => {
  const c = C.defaultCrop(0.5);
  const right = C.dragFocus(LAND, PHONE, c, 100, 0);
  assert.ok(right.x < 0.5, "drag right shows more of the left");
  const far = C.dragFocus(LAND, PHONE, c, 100000, 0);
  assert.equal(far.x, 0, "never past the edge");
  assert.equal(C.dragFocus(LAND, PHONE, c, -100000, 0).x, 1);
  assert.equal(right.y, 0.5, "a full height window can not move up or down: y stays");
  // Zoomed, up and down moves too.
  const z = C.dragFocus(LAND, PHONE, { ...c, zoom: 2 }, 0, 50);
  assert.ok(z.y < 0.5);
});

ok("dragging in Fit moves the video between the bars", () => {
  const c = { ...C.defaultCrop(), mode: "fit" as const };
  const up = C.dragFocus(LAND, PHONE, c, 0, -2000);
  assert.equal(up.y, 0, "dragged up: the video at the top");
  const down = C.dragFocus(LAND, PHONE, c, 0, 2000);
  assert.equal(down.y, 1, "dragged down: the video at the bottom");
});

ok("a tap on the whole video puts that spot in the middle where it can", () => {
  const c = C.defaultCrop();
  const t = C.tapFocus(LAND, PHONE, c, 0.25, 0.5);
  const win = C.cropWindow(LAND, PHONE, { ...c, ...t });
  close(win.left + win.w / 2, 0.25, "centred on the tap");
  assert.equal(C.tapFocus(LAND, PHONE, c, 0, 0.5).x, 0, "at the edge it stops at the edge");
  // Round trip: the window of a focus gives the focus back.
  const f = { x: 0.37, y: 0.5 };
  assert.deepEqual(C.focusFor(C.cropWindow(LAND, PHONE, { ...c, ...f }), { x: 0, y: 0.5 }), f);
});

ok("the bars' colour is the video's average, darkened; empty is black", () => {
  assert.equal(C.barColour([200, 100, 50, 255, 200, 100, 50, 255]), "#6e371c");
  assert.equal(C.barColour([]), "#000000");
  assert.equal(C.barColour([255, 255, 255, 0]), "#000000", "see through pixels do not count");
});

ok("the phone's own background: unset or null is Same as my Mac", () => {
  assert.equal(C.phoneBg({ tmBg: "spotlight" }, isBg), "spotlight");
  assert.equal(C.phoneBg({ tmBg: "spotlight", tmBgPhone: null }, isBg), "spotlight");
  assert.equal(C.phoneBg({ tmBg: "spotlight", tmBgPhone: "video:abc" }, isBg), "video:abc");
  assert.equal(C.phoneBg({ tmBg: "spotlight", tmBgPhone: "rubbish!" }, isBg), "spotlight", "an unknown value is ignored");
  assert.equal(C.phoneOwn({ tmBgPhone: "none" }, isBg), true, "None is a choice of its own");
});

ok("a pick on the phone goes to the phone's own setting only once it has one; the Mac always the shared one", () => {
  assert.equal(C.bgKey({}, true, isBg), "tmBg", "Same as my Mac: picking changes both, as before");
  assert.equal(C.bgKey({ tmBgPhone: "video:a" }, true, isBg), "tmBgPhone");
  assert.equal(C.bgKey({ tmBgPhone: "video:a" }, false, isBg), "tmBg", "the Mac never writes the phone's");
});

ok("a video replaced by a newer copy: the phone's pick and its crop follow it", () => {
  const crop = { mode: "fit", x: 0.2, y: 0.3, zoom: 1.2, bars: "black" };
  const r = C.followReplaced({ tmBgPhone: "video:old", tmBgCrop: { "video:old": crop, "video:x": crop } }, "old", "new");
  assert.equal(r.tmBgPhone, "video:new");
  assert.deepEqual(Object.keys(r.tmBgCrop!).sort(), ["video:new", "video:x"]);
  assert.deepEqual(C.followReplaced({ tmBgPhone: "video:x" }, "old", "new"), {}, "nothing to follow");
});

ok("an older copy stands in while the newest downloads (same name, no longer in the vault, on the phone)", () => {
  const list = [{ id: "new1", name: "Timeline 2" }, { id: "t1", name: "Timeline 1" }];
  const names = { old2: "Timeline 2", t1: "Timeline 1", stray: "Something" };
  const m = S.pickStandIns(list, new Set(["old2", "t1", "stray"]), names);
  assert.deepEqual([...m.entries()], [["new1", "old2"]]);
  assert.equal(S.pickStandIns(list, new Set(["new1", "old2", "t1"]), names).size, 0, "the new copy is here: no stand in");
  assert.equal(S.pickStandIns(list, new Set(["t1"]), names).size, 0, "no older copy on the phone");
});

ok("cleanLooks saves the two new settings only when they are good", () => {
  const ps = src("src/ps.ts");
  assert.match(ps, /if \(p\.tmBgPhone === null\) o\.tmBgPhone = null;/);
  assert.match(ps, /typeof p\.tmBgPhone === "string" && bgDesign\(p\.tmBgPhone\) === p\.tmBgPhone\) o\.tmBgPhone = p\.tmBgPhone;/);
  assert.match(ps, /o\.tmBgCrop = cleanCrops\(p\.tmBgCrop\)/);
});

ok("the list: a phone reads its own background and fits the video; the Mac draws it as before", () => {
  const tm = src("src/views/TaskMap.tsx");
  // V1.55: a list page's own background first (views/ListPager.tsx pageBg), else the phone's own as before.
  // V1.56: the phone layout's own background for the page the phone shows comes first (null on the Mac and the website).
  assert.match(tm, /const bgLook = bgPrev \?\? bgDesign\(phoneBg \?\? pageBg\(pg\.pages, curPage\.id\) \?\? shownBg\(st\)\);/);
  assert.match(tm, /<BgVideoLayer id=\{videoBg\.id\} file=\{videoBg\.file\} shown=\{shown\} crop=\{bgCrop\} \/>/);
  assert.match(tm, /return crop \? <BgClip crop=\{crop\} video=\{v\} on=\{shown && ready\}>\{video\}<\/BgClip> : video;/);
  assert.match(tm, /onPick=\{\(\) => set\(bgPatch\(st, d\.id\)\)\}/);
  const fit = src("src/views/BgFit.tsx");
  assert.match(fit, /if \(!PHONE_BG \|\| !isVideoBg\(bg\)\) return null;/, "usePhoneCrop is null on the Mac");
  assert.match(fit, /export function shownBg\(st: Settings\)[^\n]*PHONE_BG \? phoneBg\(st, isBg\) : st\.tmBg/);
  assert.match(fit, /addEventListener\("gos-back", b, true\)/, "the back gesture closes the editor first");
  assert.match(fit, /e\.key === "Escape"/, "Esc closes the editor");
});

ok("Settings: both rows are found by search on a phone only", () => {
  const idx = src("src/core/settingsindex.ts");
  assert.match(idx, /\{ id: "phone-bg", group: "looks"[^\n]*on: PHONE, parent: "background"/);
  assert.match(idx, /\{ id: "phone-fit", group: "looks"[^\n]*on: PHONE, parent: "background"/);
});

ok("no en or em dashes in the new code", () => {
  for (const f of ["src/core/bgcrop.ts", "src/core/bgwatch.ts", "src/views/BgFit.tsx", "tests/bgcrop.test.ts", "tests/bgwatch.test.ts"]) assert.ok(!DASHES.test(src(f)), f);
});

console.log(`\n${n} passed`);

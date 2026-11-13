// Run: node --experimental-strip-types tests/pageswipe.test.ts
// V1.58 smooth page swipe (the developer, 13 Nov 2026: "the buttons all around the display just follow you when you move to the
// other page and then suddenly disappear all at once ... I want you to smooth it all off"): the numbers in
// core/pageswipe.ts (thresholds, snap back, the layer's move and fade, invert, Reduce Motion), and the rules that live
// in the drawing code (read from the sources with comments taken out; no DOM).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const P = await import("../src/core/pageswipe.ts");
const L = await import("../src/core/lists.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const src = (f: string) => strip(readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8"));
const near = (a: number, b: number, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

const W = 800;   // one page's width in px

// ---------- where the pages are ----------
ok("at: the page number with a fraction, from the strip's move", () => {
  near(P.pageAt(2, 0, W), 2);
  near(P.pageAt(2, -W / 2, W), 2.5);    // pages moved left half a page: half way to the next
  near(P.pageAt(2, W / 4, W), 1.75);
  near(P.pageAt(2, 300, 0), 2);         // not measured yet: stays put
});
ok("a page's own things move exactly with its list (one layer, 1:1 with the fingers)", () => {
  for (const x of [-W, -333, -1, 0, 1, 250, W]) {
    const at = P.pageAt(3, x, W);
    // The track moves x; the page it started on sits at (3 - at) * W, which is x again.
    near(P.layerX(3, at, W), x, 1e-6);
    near(P.layerX(4, at, W), x + W, 1e-6);   // the next page rides one page to the right of it
  }
});

// ---------- the fades ----------
ok("panels: full on their page, gone by FADE_END, smooth in between, never above 1 or below 0", () => {
  assert.equal(P.panelFade(0), 1);
  assert.equal(P.panelFade(P.FADE_END), 0);
  assert.equal(P.panelFade(1), 0);
  assert.equal(P.panelFade(-1), 0);
  let last = 1;
  for (let d = 0; d <= 1; d += 0.02) { const o = P.panelFade(d); assert.ok(o <= last + 1e-12 && o >= 0 && o <= 1); last = o; }
  near(P.panelFade(0.3), P.panelFade(-0.3));
});
ok("the two pages' panels never pile up: at half way both are well under half", () => {
  assert.ok(P.panelFade(0.5) < 0.2, String(P.panelFade(0.5)));
});
ok("the wave: a lag only moves the fade later, by at most STAGGER", () => {
  assert.equal(P.lagFor(0, 1000, true), 0);
  near(P.lagFor(1000, 1000, true), P.STAGGER);
  near(P.lagFor(1000, 1000, false), 0);
  near(P.lagFor(0, 1000, false), P.STAGGER);
  assert.equal(P.lagFor(500, 0, true), 0);
  assert.ok(P.panelFade(0.3, P.STAGGER) > P.panelFade(0.3, 0));
  assert.equal(P.panelFade(P.FADE_END + P.STAGGER, P.STAGGER), 0);
});
ok("list pages beside the one showing are dimmed, never hidden; the name fades out by half way", () => {
  assert.equal(P.pageFade(0), 1);
  near(P.pageFade(1), 1 - P.PAGE_DIM);
  assert.ok(P.pageFade(1) > 0);
  assert.equal(P.stripFade(3), 1);
  assert.equal(P.stripFade(3.5), 0);
  near(P.stripFade(3.25), 0.5);
  near(P.stripFade(2.75), 0.5);
  assert.equal(P.stripX(3), 0);
  assert.ok(P.stripX(3.2) < 0 && P.stripX(2.8) > 0, "slides the way the pages go");
});
ok("the name changes at half way, to the page nearest, clamped", () => {
  assert.equal(P.nearIndex(2.49, 5), 2);
  assert.equal(P.nearIndex(2.51, 5), 3);
  assert.equal(P.nearIndex(-0.3, 5), 0);
  assert.equal(P.nearIndex(4.4, 5), 4);
});

// ---------- one frame of a part ----------
ok("a part of the next page comes in from the side and fades up as it arrives", () => {
  const from = 1, i = 2;
  const start = P.partFrame(i, 1, from, W, false), mid = P.partFrame(i, 1.5, from, W, false), end = P.partFrame(i, 2, from, W, false);
  assert.equal(start.x, W); assert.equal(start.o, 0);
  assert.equal(mid.x, W / 2);
  assert.equal(end.x, 0); assert.equal(end.o, 1);
});
ok("Reduce Motion: nothing slides; the first page dims a little with the fingers, never past REDUCED_DIM; the next stays hidden", () => {
  for (const at of [1, 1.2, 1.5, 2, 2.6]) {
    const a = P.partFrame(1, at, 1, W, true), b = P.partFrame(2, at, 1, W, true);
    assert.equal(a.x, 0); assert.equal(b.x, 0); assert.equal(b.o, 0);
    assert.ok(a.o >= 1 - P.REDUCED_DIM - 1e-12 && a.o <= 1);
  }
  near(P.reducedFade(1.5, 1), 1 - P.REDUCED_DIM / 2);
  assert.ok(P.REDUCED_OUT_MS + P.REDUCED_IN_MS <= 300, "a quick cross fade");
});

// ---------- letting go ----------
ok("a short slow swipe snaps back; past a third goes one page; a flick goes even when short", () => {
  assert.equal(P.releasePlan(2, 5, -100, 0, W, false).to, 2);              // short and slow: back
  assert.equal(P.releasePlan(2, 5, -W / 3 - 1, 0, W, false).to, 3);        // past a third: next
  assert.equal(P.releasePlan(2, 5, W / 3 + 1, 0, W, false).to, 1);         // the other way: previous
  assert.equal(P.releasePlan(2, 5, -40, -0.9, W, false).to, 3);            // a flick
  assert.equal(P.releasePlan(2, 5, -40, 0.9, W, false).to, 2);             // a flick back against the move: stays
  assert.equal(P.releasePlan(2, 5, -20, -2, W, false).to, 2);              // a twitch under 24px is never a flick
});
ok("the ends: never past the first or the last page", () => {
  assert.equal(P.releasePlan(0, 5, W, 3, W, false).to, 0);
  assert.equal(P.releasePlan(4, 5, -W, -3, W, false).to, 4);
  // And the rubber band past an end gives less and less, never a whole page.
  assert.ok(Math.abs(L.pageOffset(5000, W, 0, 5)) < W);
  assert.ok(Math.abs(L.pageOffset(400, W, 0, 5)) < 400);
});
ok("momentum: the glide starts with the finger's speed, capped so it never flies past its place", () => {
  const slow = P.releasePlan(2, 5, -W / 2, -0.2, W, false), fast = P.releasePlan(2, 5, -W / 2, -3, W, false);
  assert.equal(slow.how, "spring");
  assert.ok(Math.abs(fast.v0) > Math.abs(slow.v0));
  assert.ok(Math.abs(fast.v0) <= (W / 2) * 5 + 250);
  // And the spring carries it home: from half way with that speed it lands within a second, overshoot a few px at most.
  let x = -W / 2, v = fast.v0, t = 0, most = 0;
  const to = -W;
  while (!L.springDone(x, v, to) && t < 2) { const r = L.springStep(x, v, to, 1 / 120); x = r.x; v = r.v; t += 1 / 120; most = Math.max(most, Math.abs(Math.min(0, x - to))); }
  assert.ok(t < 1, `took ${t}s`);
  assert.ok(most < 40, `overshoot ${most}px`);
});
ok("Reduce Motion lets go with a fade, to the same page a swipe would land on", () => {
  for (const [x, v] of [[-100, 0], [-W / 2, 0], [-40, -0.9], [W / 2, 0]] as const) {
    const a = P.releasePlan(2, 5, x, v, W, true), b = P.releasePlan(2, 5, x, v, W, false);
    assert.equal(a.how, "fade"); assert.equal(a.to, b.to); assert.equal(a.v0, 0);
  }
});
ok("Invert swipe flips the move and the release the same way, so the layer follows whichever way the pages go", () => {
  const x = L.swiped(L.pageDx(-300, "push"), true), plain = L.pageDx(-300, "push");
  assert.equal(x, -plain);
  const a = P.releasePlan(2, 5, L.pageOffset(x, W, 2, 5), L.swiped(-1, true), W, false);
  const b = P.releasePlan(2, 5, L.pageOffset(plain, W, 2, 5), -1, W, false);
  assert.equal(a.to - 2, -(b.to - 2), "the other page");
  // The layer follows the strip whichever way it went.
  near(P.layerX(2, P.pageAt(2, x, W), W), x, 1e-6);
});

// ---------- the drawing code ----------
const lp = src("views/ListPager.tsx"), pl = src("views/pagelayer.ts"), em = src("views/EditMode.tsx"), css = src("views/editmode.css"), lcss = src("views/listpager.css");
ok("every frame of a move paints the layer and the pages, and the release goes through releasePlan", () => {
  const paint = lp.slice(lp.indexOf("const paint = (x: number) =>"), lp.indexOf("const finish = (to: number) =>"));
  assert.match(paint, /layerPaint\(s\.layer,/);
  assert.match(paint, /pagesPaint\(track\.current,/);
  assert.doesNotMatch(paint, /setState|setNear|getBoundingClientRect|getComputedStyle|offsetWidth/);
  assert.match(lp, /releasePlan\(s\.from, live\.current\.ids\.length, s\.x, v, s\.span, reduced\(\)\)/);
  assert.match(lp, /if \(reduced\(\)\) \{ fadeTo\(to\); return; \}/);
});
ok("a frame only writes translate and opacity (no layout): reads happen once, when the move begins", () => {
  const frame = pl.slice(pl.indexOf("export function layerPaint"), pl.indexOf("export function layerDim"));
  assert.doesNotMatch(frame, /getBoundingClientRect|getComputedStyle|offset(Width|Left|Top)|querySelector|classList/);
  assert.match(frame, /style\.translate = /);
  assert.match(frame, /style\.opacity = /);
  const begin = pl.slice(pl.indexOf("export function layerBegin"), pl.indexOf("export function layerPaint"));
  assert.ok(begin.indexOf("slot.dataset.pgp") < begin.indexOf("getBoundingClientRect"), "all the writes before the one read");
});
ok("the next page's panels are painted at once when a move starts, never shown for a frame first", () => {
  assert.match(lp, /startLayer\(\(i\) => Math\.abs\(i - s\.from\) <= 1\);\s*paint\(s\.x\);/);
  assert.match(lp, /startLayer\(\(j\) => j === s\.from \|\| j === i[^;]*;\s*paint\(s\.x\);/);
});
ok("the gear and Tab and Lock (on every page) never take part; a removed panel neither", () => {
  assert.match(em, /const pg = slotInfo\(id\)\?\.keep \|\| removed \? undefined : pageOf\(c\.layout, id, c\.pages\);/);
  assert.match(em, /data-pg=\{pg\}/);
  assert.match(pl, /querySelectorAll<HTMLElement>\("\.ed-slot\[data-pg\]"\)/);
});
ok("a page's column panels keep their room on other pages, so nothing reflows; removed ones still go (display none)", () => {
  assert.match(em, /const box = !here && !removed && !p && pg === MAIN_PAGE;/);
  assert.match(css, /\.ed-slot\.ed-hidden\.ed-box \{ display: contents; \}/);
  assert.match(css, /\.ed-slot\.ed-hidden\.ed-box:not\(\[data-pgp\]\) \* \{ visibility: hidden !important; \}/);
  assert.match(css, /\.ed-slot\.ed-hidden \{ display: none; \}/);
  // A hidden one in a column without its room is never shown mid move (it would push its neighbours).
  assert.match(pl, /!slot\.classList\.contains\("ed-moved"\) && !slot\.classList\.contains\("ed-box"\)\) continue;/);
});
ok("React never wipes the swipe's marks: data attributes, not classes React owns", () => {
  assert.match(pl, /overlay\.dataset\.pgsw = ""/);
  assert.match(pl, /slot\.dataset\.pgp = ""/);
  assert.doesNotMatch(pl, /classList\.(add|remove|toggle)/);
  // While moving, the parts' own transitions are off (a hover fade would lag behind the fingers).
  assert.match(css, /\.tm-overlay\.tm-overlay\[data-pgsw\] \.ed-slot\[data-pgp\] > \* \{ will-change: translate, opacity; transition: none; \}/);
  // A part that is hidden on its own (New tasks with nothing new) stays hidden mid swipe: nothing forces it visible.
  assert.doesNotMatch(css, /data-pgp\][^{]*\{[^}]*visibility: visible/);
});
ok("landing: everything goes back as it was in the same frame, and what did not ride in fades in", () => {
  const settle = lp.slice(lp.indexOf("const settle = () =>"), lp.indexOf("useLayoutEffect(() => { settle(); }, [index]);"));
  assert.match(settle, /const rode = layerEnd\(s\.layer\);/);
  assert.match(settle, /pagesClear\(track\.current\);/);
  assert.match(settle, /setStripNear\(null\);/);
  assert.match(settle, /layerArrive\(overlay,/);
  assert.match(lp, /useLayoutEffect\(\(\) => \{ settle\(\); \}, \[index\]\);/);
});
ok("a page with its own background cross fades as it lands; the look joins that fade", () => {
  assert.match(lp, /pageBg\(ctx\.pages, fromId\) !== pageBg\(ctx\.pages, id\)/);
  assert.match(lp, /doc\.startViewTransition\(\(\) => \{ flushSync\(\(\) => setActive\(id\)\); \}\)/);
  assert.match(src("looks/engine.ts"), /if \(root\.classList\.contains\("pg-turning"\)\) \{ put\(a\); return; \}/);
  assert.match(lcss, /html\.pg-turning::view-transition-new\(root\)/);
});
ok("keys, dots and Esc are as they were: the arrows still go one page, a dot still glides", () => {
  assert.match(lp, /const to = stepIndex\(p\.index\(\), p\.count\(\), e\.key === "ArrowRight" \? 1 : -1\);/);
  assert.match(lp, /if \(to !== p\.index\(\)\) p\.go\(to\); else bump\(p\);/);
  assert.match(lp, /e\.key === "Escape"/);
  // Invert swipe still on every trackpad move (V1.57).
  assert.equal((lp.match(/swiped\(pageDx\(/g) || []).length, 3);
});
ok("a hidden window still lands (no frames): the glide and the fade each have a timer", () => {
  assert.match(lp, /REDUCED_OUT_MS \+ 800\);/);
  assert.match(lp, /if \(s\.gen === gen && s\.moving\) \{ cancelAnimationFrame\(s\.raf\); s\.x = target; paint\(target\); finish\(to\); \} \}, 1200\);/);
});

console.log(`\n${n} passed`);

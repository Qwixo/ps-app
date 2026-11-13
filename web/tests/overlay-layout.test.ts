// Run: node --experimental-strip-types tests/overlay-layout.test.ts
// The floating Tab list never piles up (V1.44 #9). The developer: "this thing still keeps breaking sometimes, i go away from this
// view with tab, go back and that fixes it every time": Coming up over the task list, the Priorities header and a task
// under each other, Keep overlay and Hover mode sitting on a task.
//
// The real list is drawn in WebKit (the engine PS uses, headless, nothing on the screen) with the fictional data of the
// dev server, at many page sizes, and then put through what PS does to it:
//  - hide: PS shrinks the hidden list's window to one pixel (ps-mac main.swift tuck()), and the page lays out at 1 x 1;
//  - show: PS sizes the window back and hands in the screen and the data, and the page's JavaScript can run before the
//    new size has reached it; a window that was hidden can hold animation frames back for a while;
//  - a sideways trackpad move or a swipe that slides the list box sideways;
//  - the list scrolled down under the top bar.
// After each, nothing the list shows may overlap a side panel, the top right buttons or the Keep overlay bar.
//
// WebKit comes from Playwright: PS_PLAYWRIGHT (a playwright-core folder), else any playwright-core in the npx cache whose
// WebKit is installed (~/Library/Caches/ms-playwright). Where there is none the browser part is skipped, as
// tests/screenfit.test.ts skips its Swift check; the rules below still run.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log("ok -", name); };
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// ---------- the rules (no browser) ----------
const { tucked, TUCKED, topBand } = await import("../src/ui/relayout.ts");
await ok("a window under 200 x 200 is PS's tucked one pixel window: nothing is measured there", () => {
  assert.equal(TUCKED, 200);
  assert.ok(tucked(1, 1) && tucked(1710, 1) && tucked(150, 900) && tucked(NaN, 900));
  assert.ok(!tucked(200, 200) && !tucked(1710, 1112) && !tucked(800, 500));
});
await ok("the top band is the lowest top bar piece over the list column, plus a gap; none over it: no band", () => {
  const list = { left: 405, right: 1305 };
  assert.equal(topBand([{ left: 724, right: 986, bottom: 81 }, { left: 1162, right: 1686, bottom: 99 }], list), 105);
  assert.equal(topBand([{ left: 1400, right: 1686, bottom: 150 }], list), 0, "only beside the list (the row under the bar)");
  assert.equal(topBand([{ left: 0, right: 0, bottom: 300 }], list), 0, "a hidden one (no width)");
  assert.equal(topBand([], list), 0);
});
await ok("the source keeps to it: no measuring while tucked, a measure on every size, screen, font and show", () => {
  const tm = src("views/TaskMap.tsx"), ps = src("ps.ts"), fit = src("ui/popfit.ts"), css = src("views/taskmap.css");
  assert.match(tm, /if \(tucked\(\)\) return;\s*\/\/ PS's hidden one pixel window/, "the glass bar keeps its last good place while hidden");
  assert.match(tm, /onRelayout\(place\)/, "and is placed again on every relayout, at once, not on a later frame");
  assert.doesNotMatch(tm.slice(tm.indexOf("function useGlassPlace"), tm.indexOf("function GlassBar")), /requestAnimationFrame/);
  assert.match(fit, /if \(tucked\(\)\) return;/);
  assert.match(ps, /relayoutNow\(\);\s*\/\/ shown again/);
  const rl = src("ui/relayout.ts");
  for (const ev of ["resize", "ps-screen", "tm-relayout", "pageshow", "visibilitychange"]) assert.match(rl, new RegExp(`"${ev}"`), ev);
  assert.match(rl, /document\.fonts/, "fonts that arrive late");
  assert.match(css, /\.tm-scroll \{ position: absolute; inset: 0; overflow-x: hidden; overflow-y: auto;/, "the list box never scrolls sideways");
  assert.match(tm, /if \(el\.scrollLeft\) el\.scrollLeft = 0;/);
});

// ---------- the real list in WebKit ----------
function findPlaywright(): string | null {
  const cache = `${homedir()}/Library/Caches/ms-playwright`;
  const have = (dir: string) => {
    try {
      const b = JSON.parse(readFileSync(`${dir}/browsers.json`, "utf8")) as { browsers: { name: string; revision: string }[] };
      const w = b.browsers.find((x) => x.name === "webkit");
      return !!w && existsSync(`${cache}/webkit-${w.revision}`);
    } catch { return false; }
  };
  if (process.env.PS_PLAYWRIGHT) return have(process.env.PS_PLAYWRIGHT) ? process.env.PS_PLAYWRIGHT : null;
  const npx = `${homedir()}/.npm/_npx`;
  if (!existsSync(npx)) return null;
  for (const d of readdirSync(npx)) { const p = `${npx}/${d}/node_modules/playwright-core`; if (have(p)) return p; }
  return null;
}

// Runs in the page: every overlap between what the list shows and what sits around it.
const CHECK = () => {
  const vis = (e: Element) => { const s = getComputedStyle(e); return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0.05; };
  const flat = (el: Element | null, out: Element[] = []) => {
    if (!el) return out;
    for (const c of Array.from(el.children)) {
      const d = getComputedStyle(c).display;
      if (d === "contents" || c.classList.contains("tm-tr2")) flat(c, out); else if (vis(c)) out.push(c);
    }
    return out;
  };
  const root = document.querySelector(".tm-overlay") as HTMLElement;
  const sc = document.querySelector(".tm-scroll") as HTMLElement;
  const R = sc.getBoundingClientRect();
  const band = parseFloat(getComputedStyle(root).getPropertyValue("--tm-top-band")) || 0;
  const name = (e: Element) => (e.className && typeof e.className === "string" ? e.className.split(" ")[0] : e.tagName) + (e.textContent ? ` "${e.textContent.trim().slice(0, 24)}"` : "");
  const around = [...flat(document.querySelector(".tm-left")), ...flat(document.querySelector(".tm-right")), ...flat(document.querySelector(".tm-tr")),
    ...Array.from(document.querySelectorAll(".tm-glass-row > button"))].filter(vis).map((e) => ({ e, r: e.getBoundingClientRect() })).filter((x) => x.r.width > 1 && x.r.height > 1);
  const list = Array.from(sc.querySelectorAll(".tm-row, .tm-sec-h, .tm-title, .tm-head > *")).filter(vis);
  // Only the part of the list that shows: inside the list box, below the band the top bar fades it out in.
  const top = Math.max(R.top, band), bad: string[] = [];
  for (const el of list) {
    const r = el.getBoundingClientRect();
    const t = Math.max(r.top, top), b = Math.min(r.bottom, R.bottom), l = Math.max(r.left, R.left), rr = Math.min(r.right, R.right);
    if (b - t < 2 || rr - l < 2) continue;
    for (const a of around) {
      const w = Math.min(rr, a.r.right) - Math.max(l, a.r.left), h = Math.min(b, a.r.bottom) - Math.max(t, a.r.top);
      if (w > 2 && h > 2) bad.push(`${name(el)} under ${name(a.e)} (${Math.round(w)} x ${Math.round(h)})`);
    }
  }
  // The top right buttons never on a side panel (a button's shape gone wrong, a row too long for the screen).
  const sides = [...flat(document.querySelector(".tm-left")), ...flat(document.querySelector(".tm-right"))].filter(vis).map((e) => ({ e, r: e.getBoundingClientRect() }));
  for (const t of flat(document.querySelector(".tm-tr")).filter(vis)) {
    const r = t.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    for (const a of sides) {
      const w = Math.min(r.right, a.r.right) - Math.max(r.left, a.r.left), h = Math.min(r.bottom, a.r.bottom) - Math.max(r.top, a.r.top);
      if (w > 2 && h > 2) bad.push(`${name(t)} on ${name(a.e)} (${Math.round(w)} x ${Math.round(h)})`);
    }
  }
  // What the band hides takes no clicks either (a task you cannot see must never be ticked by a click there).
  if (band > 4) {
    const ir = (document.querySelector(".tm-inner") as HTMLElement).getBoundingClientRect();
    hits: for (let y = band - 2; y > Math.max(2, band - 60); y -= 6) for (let x = ir.left + 8; x < ir.right - 8; x += 24) {
      const hit = document.elementFromPoint(x, y)?.closest(".tm-row, .tm-sec-h, .tm-head");
      if (hit && sc.contains(hit)) { bad.push(`a hidden ${name(hit)} takes clicks in the band at ${Math.round(x)}, ${Math.round(y)}`); break hits; }
    }
  }
  // Inside Coming up: the "From your Mac's Calendar" line never on the meetings under it.
  const upd = document.querySelector(".tm-meet .tm-cal-upd"), ml = document.querySelector(".tm-meet .tm-meet-list");
  if (upd && ml && vis(upd)) {
    const a = upd.getBoundingClientRect(), b = ml.getBoundingClientRect();
    if (a.bottom > b.top + 1) bad.push(`tm-cal-upd on tm-meet-list (${Math.round(a.bottom - b.top)} px)`);
  }
  // The Keep overlay bar itself: fully on the screen, and never on a side panel or the top right buttons.
  for (const g of Array.from(document.querySelectorAll(".tm-glass-row > button")).filter(vis)) {
    const r = g.getBoundingClientRect();
    if (r.left < 0 || r.right > innerWidth || r.top < 0) bad.push(`${name(g)} off the screen (${Math.round(r.left)}, ${Math.round(r.top)})`);
    for (const a of around) {
      if (a.e.closest(".tm-glass-row")) continue;
      const w = Math.min(r.right, a.r.right) - Math.max(r.left, a.r.left), h = Math.min(r.bottom, a.r.bottom) - Math.max(r.top, a.r.top);
      if (w > 2 && h > 2) bad.push(`${name(g)} on ${name(a.e)} (${Math.round(w)} x ${Math.round(h)})`);
    }
  }
  return { bad: [...new Set(bad)].slice(0, 6), scrollLeft: sc.scrollLeft, vw: innerWidth };
};

const pwDir = findPlaywright();
if (!pwDir) console.log("skip - no Playwright WebKit here (set PS_PLAYWRIGHT to a playwright-core folder)");
else {
  const { webkit } = createRequire(import.meta.url)(pwDir) as typeof import("playwright-core");
  process.env.VITE_SUPABASE_URL ||= "http://127.0.0.1:9";   // the fictional list never goes online
  process.env.VITE_SUPABASE_KEY ||= "sb_publishable_test";
  const { createServer } = await import(`${ROOT}node_modules/vite/dist/node/index.js`) as typeof import("vite");
  const server = await createServer({ root: ROOT, mode: "ps", configFile: `${ROOT}vite.config.ts`, server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
  await server.listen();
  const base = server.resolvedUrls!.local[0];
  const browser = await webkit.launch();
  try {
    const open = async (w: number, h: number) => {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      page.on("pageerror", (e) => console.log("  page error:", e.message));
      // Keep what PS hands in, to hand it in again on the next show, as PS does.
      await page.addInitScript(() => {
        let o: { load: (s: unknown, op?: boolean) => void } | undefined;
        Object.defineProperty(window, "__psOverlay", { configurable: true, get: () => o, set: (v) => {
          o = v;
          const load = v.load.bind(v);
          v.load = (s: unknown, op?: boolean) => { (window as unknown as { __lastState: unknown }).__lastState = s; load(s, op); };
        } });
      });
      await page.goto(`${base}overlay?fake`);
      await page.waitForFunction(() => document.querySelectorAll(".tm-row").length > 4 && (window as unknown as { __lastState?: unknown }).__lastState, null, { timeout: 30000 });
      await notNow(page);
      await page.waitForTimeout(400);
      return page;
    };
    type Page = Awaited<ReturnType<typeof open>>;
    // The first run welcome (Let's set PS up) covers the page and would take every click: Not now (it comes back with
    // the fictional data each time it is handed in).
    async function notNow(page: Page) {
      await page.evaluate(() => { for (const b of Array.from(document.querySelectorAll("button"))) if (b.textContent?.trim() === "Not now") b.click(); });
    }
    // OVERLAY_LAYOUT_REPORT=1: list every failure and go on (to see the whole picture before a fix).
    const report = process.env.OVERLAY_LAYOUT_REPORT === "1";
    const check = async (page: Page, what: string) => {
      const r = await page.evaluate(CHECK);
      if (report) { if (r.bad.length || r.scrollLeft) console.log(`  FAIL ${what} (${r.vw} wide): ${r.bad.join("; ")}${r.scrollLeft ? ` slid ${r.scrollLeft} px` : ""}`); return; }
      assert.deepEqual(r.bad, [], `${what} (${r.vw} wide): ${r.bad.join("; ")}`);
      assert.equal(r.scrollLeft, 0, `${what}: the list slid sideways by ${r.scrollLeft} px`);
    };
    // PS hides the list (it shrinks the window to one pixel), then shows it again on the same screen. Its JavaScript
    // runs while the page is still one pixel wide, and frames are held back for a while after.
    const hideShow = async (page: Page, w: number, h: number, hold: boolean) => {
      await page.evaluate(() => (window as unknown as { __psOverlayHidden?: () => void }).__psOverlayHidden?.());
      await page.setViewportSize({ width: 1, height: 1 });
      await page.waitForTimeout(250);
      await page.evaluate(([w, h, hold]) => {
        const win = window as unknown as Record<string, unknown> & { __psScreen?: (v: unknown) => void; __psOverlay: { load(s: unknown, o: boolean): void } };
        if (hold) { win.__heldRaf = window.requestAnimationFrame; win.__held = []; window.requestAnimationFrame = (f) => { (win.__held as FrameRequestCallback[]).push(f); return 0; }; }
        win.__psScreen?.({ w, h, scale: 2, zoom: 1, top: 37, bottom: 0, left: 0, right: 0 });
        win.__psOverlay.load(win.__lastState, true);
      }, [w, h, hold] as const);
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(300);
      await notNow(page);
    };
    const release = (page: Page) => page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>;
      if (!win.__heldRaf) return;
      window.requestAnimationFrame = win.__heldRaf as typeof requestAnimationFrame;
      const q = win.__held as FrameRequestCallback[];
      win.__heldRaf = undefined; win.__held = [];
      q.forEach((f) => f(performance.now()));
    });

    // Page sizes in CSS pixels: the developer's MacBook, every screen PS zooms to (1440 x 900 at zoom 0.8 to 1), and what a
    // "Larger Text" scaling at the 0.8 floor leaves (1280 x 800, 1000 x 625), down to a narrow 800 x 600.
    const SIZES: [number, number][] = [[1710, 1112], [1600, 1000], [1440, 900], [1280, 800], [1100, 700], [1000, 625], [800, 600]];
    for (const [w, h] of SIZES) {
      await ok(`${w} x ${h}: first open, after hide and show with frames held back, after frames, scrolled down, never piled up`, async () => {
        const page = await open(w, h);
        try {
          await check(page, "first open");
          await hideShow(page, w, h, true);
          await check(page, "shown again, frames still held");
          await release(page);
          await page.waitForTimeout(150);
          await check(page, "shown again");
          await page.evaluate(() => { document.querySelector(".tm-scroll")!.scrollTop = 260; });
          await page.waitForTimeout(150);
          await check(page, "scrolled down under the top bar");
        } finally { await page.close(); }
      });
    }
    await ok("a list opened on one screen and shown on another (a different size) lays out for the new one", async () => {
      const page = await open(1710, 1112);
      try {
        await hideShow(page, 1100, 700, true);
        await check(page, "moved to a smaller screen, frames held");
        await release(page);
        await hideShow(page, 2560, 1440, false);
        await check(page, "moved to a big screen");
      } finally { await page.close(); }
    });
    await ok("a sideways trackpad move or a swipe never slides the whole list under Coming up", async () => {
      const page = await open(1600, 1000);
      try {
        const x0 = await page.evaluate(() => document.querySelector(".tm-row")!.getBoundingClientRect().left);
        // Something far right of the list (a moved row, a page sliding in) gives the list box room to scroll sideways; a sideways
        // scroll outside the row (between rows, on a header, the glide after a scroll) then scrolls the box itself.
        await page.evaluate(() => {
          const rows = document.querySelectorAll<HTMLElement>(".tm-row");
          rows[1].style.transform = "translate3d(420px, 0, 0)";
          const sc = document.querySelector<HTMLElement>(".tm-scroll")!;
          sc.scrollLeft = 300;
          sc.dispatchEvent(new Event("scroll"));
        });
        await page.waitForTimeout(100);
        const x1 = await page.evaluate(() => document.querySelector(".tm-row")!.getBoundingClientRect().left);
        if (report && x1 !== x0) console.log(`  FAIL the list moved sideways ${x0 - x1} px`); else assert.equal(x1, x0, `the list moved sideways ${x0 - x1} px`);
        await page.evaluate(() => { document.querySelectorAll<HTMLElement>(".tm-row")[1].style.transform = ""; });
        await check(page, "after a sideways scroll");
      } finally { await page.close(); }
    });
  } finally {
    await browser.close();
    await server.close();
  }
}

console.log(`overlay-layout: ${n} passed`);

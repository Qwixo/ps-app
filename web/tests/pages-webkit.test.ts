// The V1.55 list pages in real WebKit (the engine PS's Tab list runs in), with fictional data: a sideways trackpad
// wheel that starts on a task row moves to the next page (the V1.34 row swipe is gone), an up and down scroll never
// does, the Left and Right keys do, a page's own look goes on as it lands, and the empty + page puts its + in the
// middle of the screen. Uses Playwright's WebKit like tests/overlay-layout.test.ts; skipped where there is none.
// No window shows, no mouse or keyboard of this Mac is used, nothing is saved.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
let n = 0;
const ok = async (name: string, fn: () => Promise<void>) => { await fn(); n++; console.log("ok -", name); };

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

const pwDir = findPlaywright();
if (!pwDir) console.log("skip - no Playwright WebKit here (set PS_PLAYWRIGHT to a playwright-core folder)");
else {
  const { webkit } = createRequire(import.meta.url)(pwDir) as typeof import("playwright-core");
  process.env.VITE_SUPABASE_URL ||= "http://127.0.0.1:9";
  process.env.VITE_SUPABASE_KEY ||= "sb_publishable_test";
  const { createServer } = await import(`${ROOT}node_modules/vite/dist/node/index.js`) as typeof import("vite");
  const server = await createServer({ root: ROOT, mode: "ps", configFile: `${ROOT}vite.config.ts`, server: { port: 0, host: "127.0.0.1" }, logLevel: "error" });
  await server.listen();
  const base = server.resolvedUrls!.local[0];
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", (e) => console.log("  page error:", e.message));
    await page.goto(`${base}overlay?fake`);
    await page.waitForFunction(() => document.querySelectorAll(".tm-row").length > 4, null, { timeout: 30000 });
    // Hand in the same fictional list with one more list, Streaks (Every day on it, its own look), right of home.
    await page.evaluate(async (url) => {
      const f = await import(url) as { fakeDocs: () => { kind: string; data: Record<string, unknown> }[] };
      const docs = f.fakeDocs();
      const st = docs.find((d) => d.kind === "settings")!;
      st.data = { ...st.data, welcomeDone: new Date().toISOString(), tmPages: [{ id: "strk1", name: "Streaks", secs: ["daily"], look: "midnight" }], tmPageOrder: ["main", "strk1"] };
      (window as unknown as { __psOverlay: { load(s: unknown, o: boolean): void } }).__psOverlay.load({ unlocked: true, docs, lastSync: new Date().toISOString(), red: true }, true);
    }, `${base}src/dev/fake.ts`);
    await page.waitForTimeout(800);
    await page.evaluate(() => { for (const b of Array.from(document.querySelectorAll("button"))) if (b.textContent?.trim() === "Not now") b.click(); });
    const name = () => page.evaluate(() => document.querySelector(".tl-strip")?.textContent || "");
    const look = () => page.evaluate(() => document.documentElement.dataset.look || "dark");
    const rowAt = () => page.evaluate(() => { const r = document.querySelector(".tl-page .tm-row[data-id]")!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });

    await ok("the dots: + on the left, home, Streaks, + on the right; the main list showing", async () => {
      const dots = await page.evaluate(() => Array.from(document.querySelectorAll(".tl-dot")).map((d) => (d.classList.contains("on") ? "*" : "") + (d as HTMLElement).title));
      assert.deepEqual(dots, ["New list on the left", "*Main list", "Streaks", "New list on the right"]);
      assert.equal(await name(), "Main list");
    });
    await ok("an up and down scroll on the list never moves pages, even when it drifts sideways", async () => {
      const p = await rowAt();
      await page.mouse.move(p.x, p.y);
      for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 60); await page.waitForTimeout(16); }
      for (let i = 0; i < 4; i++) { await page.mouse.wheel(i * 4, 40); await page.waitForTimeout(16); }
      await page.waitForTimeout(900);
      assert.equal(await name(), "Main list");
      await page.evaluate(() => { document.querySelector(".tm-scroll")!.scrollTop = 0; });
      await page.waitForTimeout(400);
    });
    await ok("a sideways trackpad wheel that starts on a task row moves to the next page (no row swipe any more)", async () => {
      const p = await rowAt();
      await page.mouse.move(p.x, p.y);
      const toRight = await page.evaluate(() => { const e = new WheelEvent("wheel", { deltaX: 1 }); return (e as WheelEvent & { webkitDirectionInvertedFromDevice?: boolean }).webkitDirectionInvertedFromDevice; });
      // Fingers to the right (push, the default) go to the page on the right. WebKit says how deltaX maps to fingers.
      const d = toRight === false ? 30 : -30;
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(d, 0); await page.waitForTimeout(16); }
      await page.waitForTimeout(1500);
      assert.equal(await name(), "Streaks");
      assert.equal(await page.evaluate(() => !!document.querySelector(".tm-row.swiping, .tm-swipe-under")), false, "no row swipe");
    });
    await ok("Streaks' own look went on as it landed; home's comes back", async () => {
      assert.equal(await look(), "midnight");
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(1500);
      assert.equal(await name(), "Main list");
      assert.equal(await look(), "dark");
    });
    await ok("Left from the first page: the empty + page, its + in the middle of the screen", async () => {
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => { const b = document.querySelector(".tl-page:not(.tl-near) .tl-plus-big")?.getBoundingClientRect(); return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null; });
      assert.ok(r, "the big + shows");
      assert.ok(Math.abs(r!.x - 720) < 3 && Math.abs(r!.y - 450) < 3, `in the middle: ${JSON.stringify(r)}`);
    });
    await page.close();
  } finally {
    await browser.close();
    await server.close();
  }
}
console.log(`pages-webkit: ${n} passed`);

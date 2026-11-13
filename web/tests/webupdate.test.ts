// Run: node --experimental-strip-types tests/webupdate.test.ts
// The website never reloads itself (src/core/webupdate.ts): it only shows "New version, Reload", or, when
// the live build needs a page this one cannot be, "Update needed". FICTIONAL stamps.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const W = await import("../src/core/webupdate.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const mine = { src: "aaaa1111bbbb2222", compat: 1 };

ok("the same build live: no note", () => {
  assert.equal(W.webNote(mine, { src: "aaaa1111bbbb2222", built: "2026-11-04T10:00:00Z", compat: 1 }), null);
});
ok("a different build live: New version", () => {
  assert.deepEqual(W.webNote(mine, { src: "cccc3333dddd4444", built: "2026-11-05T10:00:00Z", compat: 1 }), { kind: "new" });
});
ok("an older version.json without compat counts as 1", () => {
  assert.deepEqual(W.webNote(mine, { src: "cccc3333dddd4444", built: "x" }), { kind: "new" });
});
ok("a live build that needs a newer page: Update needed (still only a note)", () => {
  assert.deepEqual(W.webNote(mine, { src: "cccc3333dddd4444", compat: 2 }), { kind: "must" });
});
ok("a live build with a LOWER compat (a roll back) is only a new version", () => {
  assert.deepEqual(W.webNote({ src: "aaaa1111bbbb2222", compat: 3 }, { src: "cccc3333dddd4444", compat: 2 }), { kind: "new" });
});
ok("anything odd says nothing", () => {
  for (const x of [null, "x", 5, {}, { src: 7 }, { src: "<script>" }, { src: "" }]) assert.equal(W.webNote(mine, x), null);
  assert.equal(W.readLive({ src: "cccc3333dddd4444", compat: -4 })!.compat, 1);
  assert.equal(W.readLive({ src: "cccc3333dddd4444", compat: 1.5 })!.compat, 1);
});
ok("the dev server (no stamp of its own) never shows a note", () => {
  assert.equal(W.webNote({ src: "", compat: 1 }, { src: "cccc3333dddd4444", compat: 9 }), null);
});
ok("the build reads WEB_COMPAT from the same file (vite.config.ts pattern)", () => {
  const m = readFileSync(new URL("../src/core/webupdate.ts", import.meta.url), "utf8").match(/export const WEB_COMPAT = (\d+);/);
  assert.ok(m, "the pattern vite.config.ts uses still matches");
  assert.equal(Number(m![1]), W.WEB_COMPAT);
});
ok("the page never reloads itself: location.reload only behind a click", () => {
  const note = readFileSync(new URL("../src/views/WebUpdateNote.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  // WebUpdateNote: one reloadNow, called only from onClick handlers.
  assert.equal((note.match(/location\.reload\(/g) || []).length, 1);
  assert.ok(!/useEffect\([^)]*reloadNow/.test(note));
  assert.ok(/onClick=\{\(\) => void reloadNow\(\)\}/.test(note) && /const go = \(\) => \{ if \(busy\) return; setBusy\(true\); void reloadNow\(\); \}/.test(note));
  // App.tsx: the only reload is PS's own (a build already installed on the Mac), never the website.
  const reloads = app.split("\n").filter((l) => /location\.reload\(/.test(l));
  assert.equal(reloads.length, 1);
  assert.ok(/PS && psUpdateReady\(\)/.test(reloads[0]));
});
ok("the page looks every 5 minutes and backs off 5, 10, 20, 30 after failed looks (V1.54)", () => {
  const min = 60_000;
  assert.equal(W.LOOK_EVERY, 5 * min);
  assert.deepEqual([0, 1, 2, 3, 4, 9, 500].map((f) => W.lookDelay(f) / min), [5, 10, 20, 30, 30, 30, 30]);
  assert.equal(W.lookDelay(-2), 5 * min);
  assert.equal(W.lookDelay(Number.NaN), 5 * min);
});
ok("back on the tab: at least a minute, and not before the back off is over", () => {
  const t = 1_000_000, min = 60_000;
  assert.equal(W.lookOnReturn(t + 30_000, t, 0), false);
  assert.equal(W.lookOnReturn(t + 61_000, t, 0), true);
  assert.equal(W.lookOnReturn(t + 9 * min, t, 2), false);    // two failures: wait 20 minutes
  assert.equal(W.lookOnReturn(t + 21 * min, t, 2), true);
  assert.equal(W.lookOnReturn(t - 5, t, 3), true);           // a clock that jumped back
});
ok("the page runs one look at a time, only from a timer chain, never a fixed interval", () => {
  const note = readFileSync(new URL("../src/views/WebUpdateNote.tsx", import.meta.url), "utf8");
  assert.ok(!/setInterval/.test(note));
  assert.ok(/if \(running( \|\| off\(\))?\) return;/.test(note) && /lookDelay\(fails, updateEvery\(\)\)/.test(note) && /fails = failed \? fails \+ 1 : 0/.test(note));
  assert.ok(/AbortSignal\.timeout\(15_000\)/.test(note));
  assert.ok(!/supabase/i.test(note));
});
console.log(`\n${n} checks passed`);

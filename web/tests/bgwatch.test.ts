// Run: node --experimental-strip-types tests/bgwatch.test.ts
// V1.47: the phone's background video no longer stops for good (the developer: "the video background on the GOS app sometimes
// just stops working, completely ... Fix that"). src/core/bgwatch.ts decides; views/BgFit.tsx useBgKeeper acts and logs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const W = await import("../src/core/bgwatch.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
type Now = Parameters<typeof W.look>[1];
const playing = (t: number): Now => ({ wanted: true, ready: true, paused: false, error: 0, t });

/** Runs looks one second apart; returns every action that was not "none". */
function run(states: Now[], start = 0) {
  let w = W.newWatch(start);
  const acts: { at: number; kind: string; why?: string }[] = [];
  states.forEach((s, i) => {
    const at = start + i * 1000;
    const r = W.look(w, s, at);
    w = r.w;
    if (r.act.kind !== "none") acts.push({ at, kind: r.act.kind, why: "why" in r.act ? r.act.why : undefined });
  });
  return { acts, w };
}

ok("a video playing normally: nothing happens", () => {
  const { acts } = run(Array.from({ length: 30 }, (_, i) => playing(i)));
  assert.deepEqual(acts, []);
});

ok("hidden or still starting: nothing is judged, however long", () => {
  const hidden = Array.from({ length: 40 }, () => ({ ...playing(3), wanted: false, paused: true }));
  assert.deepEqual(run(hidden).acts, []);
  const starting = Array.from({ length: 40 }, () => ({ ...playing(0), ready: false, error: 2 }));
  assert.deepEqual(run(starting).acts, [], "the layer is still seeking: its own failsafe shows it first");
});

ok("an error (the shell said 503, a piece could not be read): reload at once, then backed off", () => {
  const states = Array.from({ length: 40 }, () => ({ ...playing(0), error: 2 }));
  const { acts } = run(states);
  assert.equal(acts[0].kind, "reload");
  assert.equal(acts[0].why, "error (network)");
  assert.equal(acts[0].at, 0, "the first try is at once");
  const gaps = acts.slice(1).map((a, i) => a.at - acts[i].at);
  assert.ok(gaps.every((g, i) => i === 0 || g >= gaps[i - 1]), `waits grow: ${gaps}`);
  assert.ok(acts.length <= 6, `not spinning: ${acts.length} tries in 40 s`);
});

ok("the back off: 2 s, 4 s, 8 s ... never more than a minute", () => {
  assert.equal(W.backoff(1), 0);
  assert.equal(W.backoff(2), 2000);
  assert.equal(W.backoff(3), 4000);
  assert.equal(W.backoff(30), 60_000);
});

ok("paused on its own: play() first, a reload if that did not take", () => {
  const states = [playing(0), playing(1), ...Array.from({ length: 10 }, () => ({ ...playing(1), paused: true }))];
  const { acts } = run(states);
  assert.equal(acts[0].kind, "play");
  assert.equal(acts[0].why, "paused on its own");
  assert.equal(acts[1].kind, "reload");
});

ok("a frozen frame (playing on paper, time not moving) is reloaded after 5 s", () => {
  const states = [playing(0), playing(1), playing(2), ...Array.from({ length: 10 }, () => playing(2))];
  const { acts } = run(states);
  assert.equal(acts[0].kind, "reload");
  assert.equal(acts[0].why, "frozen frame");
  assert.ok(acts[0].at - 2000 >= W.STUCK_MS, `not before ${W.STUCK_MS} ms: at ${acts[0].at}`);
});

ok("once it plays again: one recovered line with why, how long and how many tries", () => {
  const states = [{ ...playing(0), error: 3 }, { ...playing(0), error: 3 }, { ...playing(0), error: 3 }, playing(0), playing(1), playing(2)];
  let w = W.newWatch(0);
  const out: string[] = [];
  states.forEach((s, i) => { const r = W.look(w, s, i * 1000); w = r.w; if (r.act.kind === "recovered") out.push(`${r.act.why}|${r.act.ms}|${r.act.tries}`); });
  assert.deepEqual(out, ["error (decode)|4000|2"]);
  assert.equal(w.tries, 0); assert.equal(w.why, "");
});

ok("a show after a hide starts the frozen frame clock again (no reload right after coming back)", () => {
  const states = [playing(5), ...Array.from({ length: 20 }, () => ({ ...playing(5), wanted: false })), playing(5), playing(5)];
  assert.deepEqual(run(states).acts, []);
});

ok("the layer uses it on the phone only, reloads the same way it shows, and logs through the shell", () => {
  const tm = src("src/views/TaskMap.tsx");
  assert.match(tm, /useBgKeeper\(v, \{ on: !!crop && shown, ready, id, reload:/);
  assert.match(tm, /\}, \[shown, src, id, restart\]\);/, "a reload runs the show again (seek to the playhead, then play)");
  const fit = src("src/views/BgFit.tsx");
  assert.match(fit, /gosPost\(\{ type: "log", text: `bg video: \$\{text\}` \}\)/);
  assert.match(fit, /recovered on \$\{o\.id\} after/);
  assert.match(fit, /const t = window\.setInterval\(tick, 1000\);/);
  assert.match(fit, /if \(!o\.on \|\| !el\) return;/, "nothing runs while hidden");
});

console.log(`\n${n} passed`);

// A background video carries on where it would be (core/bgplayhead.ts, V1.40): the virtual playhead maths.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { notePlayhead, resumeAt } from "../src/core/bgplayhead.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const close = (a: number, b: number, why: string) => assert.ok(Math.abs(a - b) < 1e-6, `${why}: ${a} vs ${b}`);

ok("the first show starts at the beginning", () => {
  assert.equal(resumeAt(null, 1000, 20), 0);
  assert.equal(resumeAt(undefined, 1000, NaN), 0);
});
ok("it carries on as if it had played the whole time it was hidden", () => {
  const p = notePlayhead(5, 1_000_000, 20);
  close(resumeAt(p, 1_000_000, 20), 5, "shown again at once");
  close(resumeAt(p, 1_003_500, 20), 8.5, "3.5 s away");
});
ok("it goes round the loop, however long it was away", () => {
  const p = notePlayhead(15, 0, 20);
  close(resumeAt(p, 10_000, 20), 5, "past the end once");
  close(resumeAt(p, 3_600_000 * 9 + 2_000, 20), (15 + 9 * 3600 + 2) % 20, "nine hours, over the Mac's sleep");
});
ok("it never lands on the loop point, where a stutter would show", () => {
  const p = notePlayhead(19.95, 0, 20);
  assert.equal(resumeAt(p, 0, 20), 0);
});
ok("odd values are safe: no length yet, a clock going backwards, a time past the end", () => {
  close(resumeAt(notePlayhead(4, 0, NaN), 2000, NaN), 6, "unknown length: just carry on");
  close(resumeAt(notePlayhead(4, 5000, 20), 1000, 20), 4, "clock went back: no time away");
  close(notePlayhead(45, 0, 20).t, 5, "saved time is inside the video");
  close(resumeAt(notePlayhead(4, 0, 0), 1000, 30), 5, "the reloaded video knows its length");
  assert.equal(notePlayhead(NaN, 0, 20).t, 0);
});
ok("the Tab list uses it, and keeps the playhead outside the list (the list is rebuilt on every show)", () => {
  const src = readFileSync(new URL("../src/views/TaskMap.tsx", import.meta.url), "utf8");
  assert.ok(/^const bgPlayheads = new Map/m.test(src), "a module level store, not component state");
  assert.ok(src.includes("resumeAt(bgPlayheads.get(id)"), "the layer seeks to the virtual playhead");
  assert.ok(src.includes("notePlayhead(el.currentTime"), "the layer notes where it was on hide");
  assert.ok(src.includes('ready ? "" : " wait"'), "the video stays hidden until it has seeked");
});

console.log(`\n${n} passed`);

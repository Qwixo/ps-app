// Run: node --experimental-strip-types tests/helperwords.test.ts
// What the Security window and the Auto reboot card say when the restart helper is not running (src/core/helperwords.ts,
// V1.45): after an update macOS can switch it off, and PS says exactly that, never just "waiting".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { helperWords } from "../src/core/helperwords.ts";

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };

ok("running, not set up, or not in this build: nothing to say here", () => {
  for (const h of ["on", "off", "missing", "test"] as const) assert.equal(helperWords(h, "update", "PS"), null);
});

ok("after an update: says macOS switched it off, where to switch it on, and that the settings carry on", () => {
  const w = helperWords("approve", "update", "PS")!;
  assert.equal(w.pill, "Switched off by macOS");
  assert.match(w.banner, /^macOS switched off the restart helper after the update\. Find PS under Allow in the Background/);
  assert.match(w.banner, /System Settings, General, Login Items and Extensions/);
  assert.match(w.banner, /carries on with your settings by itself/);
  assert.equal(w.button, "Open System Settings");
  assert.equal(w.clock, "Not running: macOS switched off the restart helper after the update");
  assert.equal(w.row, "Switched off by macOS after the update");
});

ok("switched off in System Settings in this same build: says so, no update blamed", () => {
  const w = helperWords("approve", "settings", "PS")!;
  assert.equal(w.pill, "Switched off in System Settings");
  assert.doesNotMatch(w.banner + w.clock + w.row, /update/);
  assert.match(w.banner, /Find PS under Allow in the Background/);
});

ok("first set up (no offBy): the old words and the Open it again button the self test clicks", () => {
  const w = helperWords("approve", undefined, "PS")!;
  assert.equal(w.pill, "Needs your OK in System Settings");
  assert.equal(w.button, "Open it again");
  assert.match(w.banner, /find PS under Allow in the Background and switch it on/);
});

ok("a renamed app is named as it is, with the hint for macOS's own list", () => {
  const w = helperWords("approve", "update", "Focus", " (macOS may list it as PS)")!;
  assert.match(w.banner, /Find Focus \(macOS may list it as PS\) under Allow in the Background/);
  assert.equal(w.autoRow, "Off until you switch Focus on again");
});

ok("plain words: no dashes, never just waiting", () => {
  for (const o of ["update", "settings", undefined] as const) {
    const w = helperWords("approve", o, "PS")!;
    const all = Object.values(w).join(" ");
    assert.doesNotMatch(all, /[\u2013\u2014]/);
    assert.doesNotMatch(all, /^Waiting/i);
  }
});

ok("the card and the Security window use these words (no old hard coded line left)", () => {
  const card = readFileSync(new URL("../src/views/RebootCard.tsx", import.meta.url), "utf8");
  const sec = readFileSync(new URL("../src/views/Security.tsx", import.meta.url), "utf8");
  assert.match(card, /helperWords\(r\.helper, r\.offBy/);
  assert.match(sec, /helperWords\(r\.helper, r\.offBy/);
  assert.doesNotMatch(card, /"Waiting for the helper"/);
  assert.doesNotMatch(sec, /"Not running: switch PS on in Login Items first"/);
});

console.log(`${n} passed`);

ok("every helper guide line says to switch it off and then on again when it already looks on (V1.52, the developer)", () => {
  for (const o of ["update", "settings", undefined] as const) {
    const w = helperWords("approve", o, "PS app")!;
    assert.match(w.banner, /If it already looks on, switch it off and then on again\./);
  }
});

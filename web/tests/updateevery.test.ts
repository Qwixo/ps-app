// Run: node --experimental-strip-types tests/updateevery.test.ts
// Settings, "Check for updates every" (src/core/updateevery.ts, V1.54): 5, 10, 15 or 30 minutes, default 5, bad values
// fall back to 5, and the back off after failed looks (5, 10, 20, 30) only ever makes the wait longer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const U = await import("../src/core/updateevery.ts");
const W = await import("../src/core/webupdate.ts");
const min = 60_000;

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };

ok("the four choices and the default", () => {
  assert.deepEqual([...U.UPDATE_EVERY_CHOICES], [5, 10, 15, 30]);
  assert.equal(U.UPDATE_EVERY_DEFAULT, 5);
  assert.equal(U.cleanUpdateEvery(undefined), 5);
});
ok("each choice is kept as it is", () => { for (const m of [5, 10, 15, 30]) assert.equal(U.cleanUpdateEvery(m), m); });
ok("bad values fall back to 5", () => {
  for (const x of [null, undefined, "", "10", "abc", "0", "off", -0.5, -5, 1, 7, 20, 31, 60, 1800, 5.5, NaN, Infinity, {}, [], [10], true]) assert.equal(U.cleanUpdateEvery(x), 5, String(x));
});
ok("each choice sets the wait between looks", () => {
  for (const m of [5, 10, 15, 30]) assert.equal(U.everyDelayMs(m, 0), m * min);
  assert.equal(U.everyDelayMs(undefined, 0), 5 * min);
  assert.equal(U.everyDelayMs("junk", 0), 5 * min);
});
ok("the back off stays: 5, 10, 20, 30 on the default, and never shorter than the choice", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 99].map((f) => U.everyDelayMs(5, f) / min), [5, 10, 20, 30, 30, 30]);
  assert.deepEqual([0, 1, 2, 3, 4].map((f) => U.everyDelayMs(10, f) / min), [10, 10, 20, 30, 30]);
  assert.deepEqual([0, 1, 2, 3].map((f) => U.everyDelayMs(15, f) / min), [15, 15, 20, 30]);
  assert.deepEqual([0, 1, 2, 3, 9].map((f) => U.everyDelayMs(30, f) / min), [30, 30, 30, 30, 30]);
});
ok("the website pill uses the same rules (lookDelay and lookOnReturn)", () => {
  assert.equal(W.lookDelay(0), 5 * min);
  for (const m of [5, 10, 15, 30]) { assert.equal(W.lookDelay(0, m), m * min); assert.equal(W.lookDelay(1, m), U.everyDelayMs(m, 1)); }
  assert.equal(W.lookDelay(0, 7), 5 * min);
  const t = 1_000_000;
  assert.equal(W.lookOnReturn(t + 61_000, t, 0, 30), true);          // coming back to the tab still looks after a minute
  assert.equal(W.lookOnReturn(t + 9 * min, t, 2, 30), false);        // ... but not inside a back off
  assert.equal(W.lookOnReturn(t + 31 * min, t, 2, 30), true);
});
ok("one synced setting, read by all three: the field, the row, the pill and the shell messages", () => {
  const rd = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  assert.ok(/updateEvery\?: number;/.test(rd("../src/core/model.ts")));
  assert.ok(/id: "update-every", group: "about", name: "Check for updates every"/.test(rd("../src/core/settingsindex.ts")));
  assert.ok(!/id: "update-every"[^\n]*(red: true|on: |shell:)/.test(rd("../src/core/settingsindex.ts")), "visible to everyone, on every device (the public build too)");
  const g = rd("../src/views/SettingsGroups.tsx");
  assert.ok(/"update-every": function UpdateEvery/.test(g) && /save\(\{ updateEvery: m \}\)/.test(g) && /GOS \? `\$\{e\.line\} With the app closed/.test(g), "the grey phone line only on the GrapheneOS phone");
  const rt = rd("../src/updateevery.ts");
  assert.ok(/psPost\(\{ type: "update:every", min \}\)/.test(rt) && /gosPost\(\{ type: "update:every", min \}\)/.test(rt));
  assert.ok(/s\.status !== "unlocked"\) return;/.test(rt), "nothing is sent while locked");
  const pill = rd("../src/views/WebUpdateNote.tsx");
  assert.ok(/lookDelay\(fails, updateEvery\(\)\)/.test(pill) && /onUpdateEvery\(repace\)/.test(pill));
  assert.ok(/startUpdateEvery\(\);/.test(rd("../src/main.tsx")));
});
ok("Off (0): no automatic looks anywhere, Check now still works", () => {
  assert.equal(U.UPDATE_EVERY_OFF, 0);
  assert.equal(U.cleanUpdateEvery(0), 0);
  assert.equal(U.updateChecksOff(0), true);
  for (const x of [undefined, null, 5, 10, 15, 30, 7, "0"]) assert.equal(U.updateChecksOff(x), false, String(x));
  assert.equal(U.everyDelayMs(0, 0), 5 * min, "a safe number, never 0");
  assert.equal(W.lookDelay(0, 0), 5 * min, "the website never spins on 0");
  const rd = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  const g = rd("../src/views/SettingsGroups.tsx");
  assert.ok(/save\(\{ updateEvery: UPDATE_EVERY_OFF \}\)/.test(g) && />Off<\/Choice>/.test(g), "the row has an Off choice");
  const pill = rd("../src/views/WebUpdateNote.tsx");
  assert.ok(/const off = \(\) => updateChecksOff\(updateEvery\(\)\);/.test(pill) && /if \(running \|\| off\(\)\) return;/.test(pill) && /subs\.size && !off\(\)/.test(pill), "the website note never looks while Off");
});
console.log(`\n${n} checks passed`);

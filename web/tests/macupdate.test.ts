// Run: node --experimental-strip-types tests/macupdate.test.ts
// Mac PS updates in the gear menu (src/core/macupdate.ts): only known states and plain values reach the
// menu, and the gear's dot shows only while something waits for the developer. FICTIONAL versions.
import assert from "node:assert/strict";
const U = await import("../src/core/macupdate.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };

ok("an unknown state is idle, nothing else comes through", () => {
  assert.deepEqual(U.cleanMacUpdate({ state: "hacked", version: 5 }).state, "idle");
  assert.equal(U.cleanMacUpdate(null).state, "idle");
  assert.equal(U.cleanMacUpdate("available").state, "idle");
});

ok("an update keeps its version, word, size and notes", () => {
  const u = U.cleanMacUpdate({ state: "available", version: "V1.23", keyword: "Fitness", kind: "app", size: 14_200_000, notes: ["One", "", 3, "Two"] });
  assert.equal(u.state, "available");
  assert.equal(u.version, "V1.23");
  assert.equal(u.keyword, "Fitness");
  assert.equal(u.kind, "app");
  assert.equal(u.size, 14_200_000);
  assert.deepEqual(u.notes, ["One", "Two"]);
});

ok("progress stays between 0 and 1, a bad number is dropped", () => {
  assert.equal(U.cleanMacUpdate({ state: "downloading", progress: 1.7 }).progress, 1);
  assert.equal(U.cleanMacUpdate({ state: "downloading", progress: -2 }).progress, 0);
  assert.equal(U.cleanMacUpdate({ state: "downloading", progress: NaN }).progress, undefined);
  assert.equal(U.cleanMacUpdate({ state: "downloading", progress: "0.5" }).progress, undefined);
});

ok("text is cut short and notes are at most six", () => {
  const u = U.cleanMacUpdate({ state: "error", error: "x".repeat(900), notes: Array.from({ length: 12 }, (_, i) => `note ${i}`) });
  assert.equal(u.error!.length, 240);
  assert.equal(u.notes!.length, 6);
  assert.equal(U.cleanMacUpdate({ state: "available", kind: "both" }).kind, undefined);
});

ok("the gear's dot: an update to take or finish", () => {
  assert.equal(U.macUpdateBadge({ state: "available" }), "update");
  assert.equal(U.macUpdateBadge({ state: "ready" }), "update");
  for (const s of ["idle", "checking", "none", "downloading", "verifying", "installing", "relaunching"] as const) assert.equal(U.macUpdateBadge({ state: s }), null, s);
});

ok("the gear's dot: news only until the developer has seen it", () => {
  assert.equal(U.macUpdateBadge({ state: "done", unseen: true }), "done");
  assert.equal(U.macUpdateBadge({ state: "done" }), null);
  assert.equal(U.macUpdateBadge({ state: "error", unseen: true }), "error");
  assert.equal(U.macUpdateBadge({ state: "error", unseen: false }), null);
});

console.log(`\n${n} passed`);

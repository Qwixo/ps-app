// Run: node --experimental-strip-types tests/fitness-scanstate.test.ts
// PS Fitness, Gym scan states (src/fitness/scan-state.ts, V1.60): scanning, found, not found, added, as plain events the island
// moments hook into. Also checks Scan.tsx says them in the right places. FICTIONAL names.
import assert from "node:assert/strict";
import fs from "node:fs";
const X = await import("../src/fitness/scan-state.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { X.scanStateReset(); fn(); n++; console.log("ok -", name); };

ok("starts idle", () => {
  assert.deepEqual(X.scanState(), { state: "idle", n: 0 });
});
ok("a scan goes scanning, found, added, idle, and a listener hears each", () => {
  const seen: string[] = [];
  const off = X.onScanState((s) => seen.push(`${s.state}${s.hit ? ":" + s.hit.name : ""}`));
  X.scanSay("scanning");
  X.scanSay("found", { hit: { name: "Leg press", exId: "leg-press" }, text: "BEINPRESSE" });
  X.scanSay("added", { hit: { name: "Leg press", exId: "leg-press" } });
  X.scanSay("idle");
  off();
  X.scanSay("scanning");
  assert.deepEqual(seen, ["scanning", "found:Leg press", "added:Leg press", "idle"]);
});
ok("not found carries what the label said, and no hit", () => {
  const s = X.scanSay("notfound", { hit: null, text: "XYZZY" });
  assert.equal(s.state, "notfound");
  assert.equal(s.hit, null);
  assert.equal(s.text, "XYZZY");
});
ok("each event has its own number, so two founds in a row are two events", () => {
  const a = X.scanSay("found", { hit: { name: "A", exId: null } });
  const b = X.scanSay("found", { hit: { name: "B", exId: null } });
  assert.equal(b.n, a.n + 1);
});
ok("idle after idle is not an event", () => {
  let calls = 0;
  X.onScanState(() => calls++);
  X.scanSay("idle"); X.scanSay("idle");
  assert.equal(calls, 0);
  X.scanSay("scanning"); X.scanSay("idle"); X.scanSay("idle");
  assert.equal(calls, 2);
});
ok("a listener that throws does not stop the others or the scan", () => {
  let heard = 0;
  X.onScanState(() => { throw new Error("boom"); });
  X.onScanState(() => heard++);
  assert.doesNotThrow(() => X.scanSay("scanning"));
  assert.equal(heard, 1);
  assert.equal(X.scanState().state, "scanning");
});
ok("stopping a listener twice is fine", () => {
  const off = X.onScanState(() => {});
  off(); off();
});
ok("the Scan screen says every state (scanning, found, not found, added) and idle when it goes", () => {
  const src = fs.readFileSync(new URL("../src/fitness/Scan.tsx", import.meta.url), "utf8");
  for (const s of ['scanSay("scanning")', 'scanSay(r.best ? "found" : "notfound"', 'scanSay("added"', 'scanSay("idle")']) assert.ok(src.includes(s), s);
});
console.log(`\n${n} checks passed`);

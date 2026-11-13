// Run: node --experimental-strip-types tests/updatetick.test.ts
// The tick beside the version looks for updates when clicked (src/core/updatetick.ts): the arrow spins at
// least a moment, nothing found turns it back to the tick, a failed or silent look says "Could not check"
// briefly and then shows the tick, an update found is offered (never installed).
import assert from "node:assert/strict";
const T = await import("../src/core/updatetick.ts");
const { TICK_SPIN_MIN: MIN, TICK_TIMEOUT: OUT, TICK_FAIL_SHOW: FAIL } = T;

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const at = 1_000_000;
const click = () => ({ at });

ok("no click: the tick rests and nothing waits", () => {
  assert.equal(T.tickPhase(null, at), "tick");
  assert.equal(T.tickNext(null, at), null);
  assert.equal(T.tickRecord(null, "none", at), null);
});

ok("only none, error and available are answers; checking and the old done are not", () => {
  assert.equal(T.tickResult("none"), "none");
  assert.equal(T.tickResult("error"), "error");
  assert.equal(T.tickResult("available"), "offer");
  for (const s of ["checking", "done", "idle", "downloading", "ready"]) assert.equal(T.tickResult(s), undefined, s);
  const c = click();
  assert.equal(T.tickRecord(c, "checking", at + 10), c);
  assert.equal(T.tickRecord(c, "done", at + 10), c);
});

ok("the first answer is kept, later ones are ignored", () => {
  const c = T.tickRecord(click(), "none", at + 100)!;
  assert.deepEqual(c, { at, result: "none", resultAt: at + 100 });
  assert.equal(T.tickRecord(c, "error", at + 200), c);
});

ok("a quick answer still spins the minimum, then the tick comes back", () => {
  const c = T.tickRecord(click(), "none", at + 40)!;
  assert.equal(T.tickPhase(c, at + 40), "spin");
  assert.equal(T.tickPhase(c, at + MIN - 1), "spin");
  assert.equal(T.tickPhase(c, at + MIN), "tick");
  assert.equal(T.tickNext(c, at + 40), at + MIN);
});

ok("a slow answer spins until it comes", () => {
  const c = click();
  assert.equal(T.tickPhase(c, at + 3000), "spin");
  const d = T.tickRecord(c, "none", at + 3000)!;
  assert.equal(T.tickPhase(d, at + 3000), "tick");
});

ok("a failed look: spin, then Could not check for a moment, then the tick", () => {
  const c = T.tickRecord(click(), "error", at + 200)!;
  assert.equal(T.tickPhase(c, at + 300), "spin");
  assert.equal(T.tickPhase(c, at + MIN), "fail");
  assert.equal(T.tickPhase(c, at + MIN + FAIL - 1), "fail");
  assert.equal(T.tickPhase(c, at + MIN + FAIL), "tick");
  assert.equal(T.tickNext(c, at + MIN), at + MIN + FAIL);
});

ok("no answer at all: Could not check at the timeout, then the tick", () => {
  const c = click();
  assert.equal(T.tickPhase(c, at + OUT - 1), "spin");
  assert.equal(T.tickPhase(c, at + OUT), "fail");
  assert.equal(T.tickPhase(c, at + OUT + FAIL), "tick");
  assert.equal(T.tickNext(c, at + MIN + 1), at + OUT);
  assert.equal(T.tickNext(c, at + OUT + FAIL), null);
});

ok("a late none or error after the timeout does not flash again", () => {
  for (const s of ["none", "error"]) {
    const c = T.tickRecord(click(), s, at + OUT + FAIL + 500)!;
    assert.equal(T.tickPhase(c, at + OUT + FAIL + 600), "tick", s);
  }
});

ok("an update found is offered after the minimum spin, even a late one", () => {
  const c = T.tickRecord(click(), "available", at + 100)!;
  assert.equal(T.tickPhase(c, at + 200), "spin");
  assert.equal(T.tickPhase(c, at + MIN), "offer");
  const late = T.tickRecord(click(), "available", at + OUT + 4000)!;
  assert.equal(T.tickPhase(late, at + OUT + 4000), "offer");
});

ok("the card holds the tick while looking, after nothing, and after its own failed look only", () => {
  const c = click();
  assert.equal(T.tickHolds("checking", "spin", c), true);
  assert.equal(T.tickHolds("available", "spin", c), true);       // the offer waits for the minimum spin
  assert.equal(T.tickHolds("none", "tick", c), true);
  assert.equal(T.tickHolds("idle", "tick", c), true);
  assert.equal(T.tickHolds("available", "offer", c), false);
  assert.equal(T.tickHolds("error", "tick", T.tickRecord(click(), "error", at + 1)), true);
  assert.equal(T.tickHolds("error", "tick", T.tickRecord(click(), "none", at + 1)), false);   // a later real error shows
  assert.equal(T.tickHolds("none", "tick", null), false);
});

ok("an update that starts ends the tick's part", () => {
  for (const s of ["downloading", "verifying", "installing", "ready", "relaunching"]) assert.equal(T.tickKeeps(s), false, s);
  for (const s of ["done", "none", "idle", "checking", "error", "available"]) assert.equal(T.tickKeeps(s), true, s);
});

console.log(`\n${n} passed`);

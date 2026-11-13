// Run: node --experimental-strip-types tests/fitness-sync.test.ts
// PS Fitness V1.29 sync rules (src/fitness/sync-logic.ts): every change saved on the device first and only then a
// debounced push; a failed or offline push tried again with a growing wait; the Sync button's words ("Synced 2 min
// ago", "Syncing", "Not synced yet", "Offline, will sync"). Fake clock, no network. FICTIONAL data.
import assert from "node:assert/strict";
const L = await import("../src/fitness/sync-logic.ts");

let n = 0;
const ok = async (name: string, fn: () => unknown) => { await fn(); n++; console.log("ok -", name); };
const flush = () => new Promise<void>((r) => setImmediate(r));

/** A fake clock and a fake vault: push() answers from a script, and every call is recorded. */
function rig(answers: (boolean | "throw")[] = [], online = true) {
  let now = 0, seq = 0;
  const timers = new Map<number, { at: number; f: () => void }>();
  const log: string[] = [];
  const net = { online };
  const p = L.createPusher({
    push: async () => {
      const a = answers.length ? answers.shift()! : true;
      log.push(`push@${now}`);
      if (a === "throw") throw new Error("network");
      return a;
    },
    online: () => net.online,
    setTimer: (f, ms) => { const id = ++seq; timers.set(id, { at: now + ms, f }); return id; },
    clearTimer: (t) => { timers.delete(t as number); },
  }, { debounceMs: 1000, backoffMs: [2000, 4000, 8000] });
  /** Moves the clock on, firing due timers in order (and letting their promises settle). */
  async function tick(ms: number) {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].f();
      await flush(); await flush();
    }
    now = end;
  }
  return { p, log, net, tick, pending: () => timers.size, now: () => now };
}

// ---------- save first, then push ----------
await ok("a change is saved on the device before any push is booked", async () => {
  const r = rig();
  const order: string[] = [];
  let release!: () => void;
  const saving = new Promise<void>((res) => { release = res; });
  const w = r.p.write(async () => { await saving; order.push("saved"); return 7; });
  await r.tick(5000);
  assert.deepEqual(r.log, [], "nothing pushed while the save is still running");
  release();
  assert.equal(await w, 7, "the save's own answer comes back");
  await r.tick(999);
  assert.deepEqual(r.log, []);
  await r.tick(1);
  assert.deepEqual(r.log, ["push@6000"]);
});
await ok("a failed save books no push and the error reaches the caller", async () => {
  const r = rig();
  await assert.rejects(r.p.write(async () => { throw new Error("disk full"); }), /disk full/);
  await r.tick(60_000);
  assert.deepEqual(r.log, []);
  assert.equal(r.pending(), 0);
});
await ok("taps close together push once (debounce), so only the changed records travel once", async () => {
  const r = rig();
  for (let i = 0; i < 5; i++) { await r.p.write(async () => i); await r.tick(300); }
  await r.tick(5000);
  assert.deepEqual(r.log, ["push@2200"]);
});

// ---------- retry ----------
await ok("a failed push is tried again with a growing wait, then the wait resets after it goes through", async () => {
  const r = rig([false, "throw", false, true, true]);
  await r.p.write(async () => 1);
  await r.tick(1000);                 // 1st push at 1000 fails
  await r.tick(2000);                 // retry after 2 s
  await r.tick(4000);                 // then 4 s
  await r.tick(8000);                 // then 8 s: goes through
  assert.deepEqual(r.log, ["push@1000", "push@3000", "push@7000", "push@15000"]);
  assert.equal(r.p.state().failures, 0);
  await r.p.write(async () => 2);
  await r.tick(1000);
  assert.equal(r.log.at(-1), "push@16000", "the next change pushes after the normal debounce");
});
await ok("the wait stops growing at the last step", async () => {
  const r = rig([false, false, false, false, false, true]);
  r.p.kick();
  await r.tick(1000 + 2000 + 4000 + 8000 + 8000 + 8000);
  assert.deepEqual(r.log, ["push@1000", "push@3000", "push@7000", "push@15000", "push@23000", "push@31000"]);
});
await ok("offline: no network call at all, and it keeps trying until the signal is back", async () => {
  const r = rig([], false);
  await r.p.write(async () => 1);
  await r.tick(30_000);
  assert.deepEqual(r.log, [], "nothing sent while offline");
  assert.ok(r.p.state().failures >= 3);
  assert.ok(r.pending() > 0, "a retry is still booked");
  r.net.online = true;
  await r.tick(8000);
  assert.equal(r.log.length, 1, "pushed once the signal came back");
  assert.equal(r.p.state().failures, 0);
});
await ok("the signal coming back (kick) pushes after the short debounce, not the long wait", async () => {
  const r = rig([], false);
  await r.p.write(async () => 1);
  await r.tick(20_000);
  r.net.online = true;
  r.p.kick();
  await r.tick(1000);
  assert.equal(r.log.length, 1);
});

// ---------- the Sync button ----------
await ok("Sync now pushes at once, skipping the debounce and any long wait", async () => {
  const r = rig([false, true]);
  await r.p.write(async () => 1);
  await r.tick(1000);                 // fails, retry booked in 2 s
  assert.equal(await r.p.force(), true);
  assert.deepEqual(r.log, ["push@1000", "push@1000"]);
  assert.equal(r.pending(), 0, "the old retry is cancelled");
});
await ok("a push asked for while one is running runs again after it (nothing is lost in between)", async () => {
  let release!: (v: boolean) => void;
  let calls = 0;
  let now = 0;
  const timers: { at: number; f: () => void }[] = [];
  const p = L.createPusher({
    push: () => { calls++; return calls === 1 ? new Promise<boolean>((res) => { release = res; }) : Promise.resolve(true); },
    online: () => true,
    setTimer: (f, ms) => { const t = { at: now + ms, f }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t as never); if (i >= 0) timers.splice(i, 1); },
  }, { debounceMs: 100, backoffMs: [1000] });
  const first = p.force();
  assert.equal(p.state().pushing, true);
  assert.equal(await p.force(), false, "a second one does not run on top");
  release(true);
  assert.equal(await first, true);
  assert.equal(timers.length, 1, "a follow up push is booked");
  now = 100; timers.shift()!.f();
  await flush();
  assert.equal(calls, 2);
});

// ---------- the words ----------
const base = { now: 1_000_000, lastSync: 1_000_000, pending: false, pendingSince: null, online: true, syncing: false, error: false };
await ok("Synced X ago", () => {
  assert.deepEqual(L.syncLabel(base), { text: "Synced just now", tone: "ok" });
  assert.equal(L.syncLabel({ ...base, now: base.now + 2 * 60_000 }).text, "Synced 2 min ago");
  assert.equal(L.syncLabel({ ...base, now: base.now + 3 * 3600_000 }).text, "Synced 3 h ago");
  assert.equal(L.syncLabel({ ...base, now: base.now + 26 * 3600_000 }).text, "Synced 1 day ago");
  assert.equal(L.syncLabel({ ...base, now: base.now + 72 * 3600_000 }).text, "Synced 3 days ago");
});
await ok("agoText edges", () => {
  assert.equal(L.agoText(-5000), "just now");
  assert.equal(L.agoText(44_000), "just now");
  assert.equal(L.agoText(45_000), "1 min ago");
  assert.equal(L.agoText(59 * 60_000), "59 min ago");
  assert.equal(L.agoText(60 * 60_000), "1 h ago");
});
await ok("offline says so, even with a change waiting", () => {
  assert.deepEqual(L.syncLabel({ ...base, online: false }), { text: "Offline, will sync", tone: "warn" });
  assert.deepEqual(L.syncLabel({ ...base, online: false, pending: true, pendingSince: base.now }), { text: "Offline, will sync", tone: "warn" });
});
await ok("a fresh change says Syncing; still waiting after the grace it says Not synced yet", () => {
  const p = { ...base, pending: true, pendingSince: base.now };
  assert.deepEqual(L.syncLabel(p), { text: "Syncing", tone: "busy" });
  assert.deepEqual(L.syncLabel({ ...p, now: base.now + L.SYNC_GRACE_MS }), { text: "Not synced yet", tone: "warn" });
  assert.deepEqual(L.syncLabel({ ...p, error: true }), { text: "Not synced yet", tone: "warn" }, "a failed try never says Syncing");
});
await ok("never says Synced while a change waits, after an error, or before the first sync", () => {
  assert.equal(L.syncLabel({ ...base, error: true }).text, "Not synced yet");
  assert.equal(L.syncLabel({ ...base, lastSync: null }).text, "Not synced yet");
  assert.equal(L.syncLabel({ ...base, pending: true, pendingSince: null }).text, "Not synced yet");
  assert.equal(L.syncLabel({ ...base, syncing: true }).text, "Syncing");
});
await ok("the label redraws when its words change, not every second", () => {
  assert.equal(L.nextLabelIn(base), 45_050);
  assert.equal(L.nextLabelIn({ ...base, now: base.now + 10 * 60_000 }), 15_000);
  assert.equal(L.nextLabelIn({ ...base, lastSync: null }), 30_000);
  assert.equal(L.nextLabelIn({ ...base, pending: true, pendingSince: base.now }), L.SYNC_GRACE_MS + 50);
  assert.equal(L.nextLabelIn({ ...base, pending: true, pendingSince: base.now - 60_000 }), 250);
});

console.log(`\n${n} passed`);

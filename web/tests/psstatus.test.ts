// Run: node --experimental-strip-types tests/psstatus.test.ts
// The "PS is active" pop-up's status (src/core/psstatus.ts): locked says nothing, the next meeting
// within a day (one on now wins), all day events skipped, private mode hides the title. FICTIONAL data.
import assert from "node:assert/strict";
const P = await import("../src/core/psstatus.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const T0 = Date.parse("2026-10-31T12:00:00.000Z");
const H = 3600_000, M = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const ev = (id: string, title: string, start: number | null, end: number | null, allDay = false) =>
  ({ id, title, start: start === null ? null : iso(start), end: end === null ? null : iso(end), allDay, attendees: [] });
const base = { open: true, online: true, lastSync: iso(T0 - M), pending: 0, syncError: null, events: [], privateMode: false, now: T0 };

ok("locked or signed out: only that, no sync time and no meeting", () => {
  const s = P.psStatus({ ...base, open: false, events: [ev("e1", "Call with Northwind Silk", T0 + H, T0 + 2 * H)] });
  assert.deepEqual(s, { open: false, online: true, lastSync: null, pending: 0, error: false, next: null, private: false });
});

ok("open: sync state passes through, pending is capped, an error is only a flag", () => {
  const s = P.psStatus({ ...base, pending: 4000, syncError: "token expired for user x" });
  assert.equal(s.open, true);
  assert.equal(s.pending, 999);
  assert.equal(s.error, true);
  assert.equal(s.lastSync, base.lastSync);
  assert.equal(JSON.stringify(s).includes("token"), false);
});

ok("the soonest meeting within a day", () => {
  const s = P.psStatus({ ...base, events: [ev("e2", "Later call", T0 + 5 * H, T0 + 6 * H), ev("e1", "Call with Northwind Silk", T0 + H, T0 + 2 * H)] });
  assert.equal(s.next?.title, "Call with Northwind Silk");
  assert.equal(s.next?.now, false);
});

ok("a meeting on now wins over the next one", () => {
  const s = P.psStatus({ ...base, events: [ev("e1", "Soon", T0 + 10 * M, T0 + H), ev("e0", "Weekly check in", T0 - 10 * M, T0 + 20 * M)] });
  assert.equal(s.next?.title, "Weekly check in");
  assert.equal(s.next?.now, true);
});

ok("all day events, past ones and ones over a day away never count", () => {
  const s = P.psStatus({ ...base, events: [ev("a", "Holiday", T0 + H, T0 + 2 * H, true), ev("b", "Done", T0 - 2 * H, T0 - H), ev("c", "Next week", T0 + 30 * H, T0 + 31 * H), ev("d", "No start", null, null)] });
  assert.equal(s.next, null);
});

ok("private mode keeps the time and hides the title", () => {
  const s = P.psStatus({ ...base, privateMode: true, events: [ev("e1", "Call with Northwind Silk", T0 + H, T0 + 2 * H)] });
  assert.equal(s.next?.title, null);
  assert.equal(s.next?.start, iso(T0 + H));
  assert.equal(s.private, true);
});

ok("long titles are cut and tidied", () => {
  const s = P.psStatus({ ...base, events: [ev("e1", "  A\n" + "x".repeat(200), T0 + H, T0 + 2 * H)] });
  assert.equal(s.next?.title?.length, 80);
  assert.ok(s.next?.title?.startsWith("A x"));
});

console.log(`${n} of ${n} passed`);

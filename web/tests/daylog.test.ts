// Run: node tests/daylog.test.ts  (TZ fixed so the hours are predictable)
process.env.TZ = "Asia/Dubai";
import assert from "node:assert/strict";
const L = await import("../src/core/daylog.ts");

// The developer's example: Friday 16 Oct, 5am GST, belongs to Thursday the 15th.
assert.equal(L.workDayOf("2026-10-16T05:00:00+04:00"), "2026-10-15");
assert.equal(L.workDayOf("2026-10-16T10:00:00+04:00"), "2026-10-15");
assert.equal(L.workDayOf("2026-10-16T02:00:00+04:00"), "2026-10-15");
assert.equal(L.workDayOf("2026-10-15T23:00:00+04:00"), "2026-10-15");
assert.equal(L.workDayOf("2026-10-15T16:00:00+04:00"), "2026-10-15");
assert.equal(L.workDayOf("2026-10-16T15:00:00+04:00"), "2026-10-16");
assert.equal(L.workDayOf("2026-10-16T10:00:00+04:00", 9), "2026-10-16");

const at = "2026-10-16T05:00:00.000Z";
const items = [
  { todoId: "a", title: "Gym", at: "2026-10-15T20:00:00+04:00", repeat: true },
  { todoId: "b", title: "Invoice", at: "2026-10-16T03:00:00+04:00" },
];
const log = L.addToLog(undefined, "2026-10-15", items, at)!;
assert.equal(log.items.length, 2);
assert.equal(L.addToLog(log, "2026-10-15", items, at), null, "the same ticks are never logged twice");
const log2 = L.addToLog(log, "2026-10-15", [{ todoId: "a", title: "Gym", at: "2026-10-16T09:00:00+04:00", repeat: true }], at)!;
assert.equal(log2.items.length, 3);
console.log("daylog: passed");

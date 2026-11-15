// Run: node --experimental-strip-types tests/rempush.test.ts
// The reminder sender's rules (supabase/functions/rem-push/logic.ts) with a fake push service. Nothing is sent anywhere.
import assert from "node:assert/strict";
import { authorised, isGone, payloadOf, sendBatch, MAX_BATCH, type DueRow } from "../supabase/functions/rem-push/logic.ts";
import { readFileSync } from "node:fs";

let n = 0;
const ok = async (name: string, fn: () => Promise<void> | void) => { await fn(); n++; console.log("ok -", name); };
const NOW = Date.parse("2026-11-10T05:00:00Z");
const row = (id: number, sub = "s1", late = 0): DueRow => ({ id, rem_id: "ab1", fire_at: new Date(NOW - late).toISOString(), sub: { id: sub, endpoint: `https://push.example.com/${sub}`, p256dh: "k", auth: "a" } });

await ok("only the project's own scheduler may call it", () => {
  assert.ok(authorised("abc", "abc"));
  assert.ok(!authorised("abc", "abd") && !authorised("", "") && !authorised(null, "abc") && !authorised("abc", undefined) && !authorised("ab", "abc"));
});
await ok("the push body holds the id and time only", () => {
  const b = JSON.parse(payloadOf(row(1)));
  assert.deepEqual(Object.keys(b).sort(), ["at", "id", "t"]);
  assert.equal(b.id, "ab1");
});
await ok("sent rows are marked, a gone address is dropped with its subscription, a failure is kept to retry", async () => {
  const sent: string[] = [];
  const out = await sendBatch([row(1), row(2, "s2"), row(3, "s3"), row(4, "s2")], async (s) => { sent.push(s.id); return { status: s.id === "s2" ? 410 : s.id === "s3" ? 503 : 201 }; }, NOW);
  assert.deepEqual(out.sent, [1]); assert.deepEqual(out.failed, [3]); assert.deepEqual(out.goneSubs, ["s2"]);
  assert.deepEqual(sent, ["s1", "s2", "s3"], "no second try at an address that is gone");
});
await ok("a thrown error is a failure, never a crash; stale rows are closed out without sending", async () => {
  const out = await sendBatch([row(1), row(2, "s1", 2 * 3_600_000)], async () => { throw new Error("offline"); }, NOW);
  assert.deepEqual(out.failed, [1]); assert.deepEqual(out.sent, [2]);
});
await ok("never more than one batch", async () => {
  const rows = Array.from({ length: MAX_BATCH + 50 }, (_, i) => row(i));
  const out = await sendBatch(rows, async () => ({ status: 201 }), NOW);
  assert.equal(out.sent.length, MAX_BATCH);
  assert.ok(isGone(404) && isGone(410) && !isGone(500));
});
await ok("the migration keeps no words and nothing on a schedule inside it", () => {
  const sql = readFileSync(new URL("../supabase/migrations/040_web_push.sql", import.meta.url), "utf8").replace(/--[^\n]*/g, "").toLowerCase();
  for (const bad of ["text_of", "reminder_text", "cron.", "net.http"]) assert.ok(!sql.includes(bad), bad);
  assert.ok(sql.includes("enable row level security") && sql.includes("on public.push_queue"));
  assert.ok(!/create table[^;]*\b(title|body|words|label)\b/.test(sql), "no column for the reminder's words");
});
console.log(`${n} passed`);

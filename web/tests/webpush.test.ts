// Run: node --experimental-strip-types tests/webpush.test.ts
// Reminders on the iPhone web app (core/webpush.ts, core/remind.ts remNextRing and remRingTimes). Fictional days, no network.
import assert from "node:assert/strict";
import * as W from "../src/core/webpush.ts";
import * as R from "../src/core/remind.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const DXB = "Asia/Dubai";
const ts = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+04:00`);
const item = (o: Partial<R.PlanItem> = {}): R.PlanItem => ({ id: "ab1", on: true, pill: "Water", text: "DRINK WATER?", at: "09:00", until: "12:00", days: [0, 1, 2, 3, 4, 5, 6], tz: DXB,
  snooze: 15, later: "Remind me in 15 mins", yes: "Yes", word: "Yes", click: true, bg: "#28121e", accent: "#ec4e86", ink: "#ffffff", sound: "none", vol: 0.8, done: "", snoozeUntil: 0, stateAt: 0, task: "", date: "", open: "", ...o });
const asR = (i: R.PlanItem) => i as unknown as R.Reminder;

ok("it rings when its window opens, then every snooze length until answered, only inside the window", () => {
  const r = asR(item());
  assert.equal(R.remNextRing(r, undefined, ts("2026-11-10", "08:00"), DXB, 0), ts("2026-11-10", "09:00"));
  const rang = ts("2026-11-10", "09:00");
  assert.equal(R.remNextRing(r, undefined, rang, DXB, 0), rang);
  assert.equal(R.remNextRing(r, undefined, ts("2026-11-10", "09:05"), DXB, rang), ts("2026-11-10", "09:15"));
  assert.equal(R.remNextRing(r, undefined, ts("2026-11-10", "11:50"), DXB, ts("2026-11-10", "11:50")), 0);
  assert.equal(R.remNextRing(r, undefined, ts("2026-11-10", "13:00"), DXB, ts("2026-11-10", "11:45")), ts("2026-11-11", "09:00"));
});
ok("done, off and a snooze past the window never ring; a snooze rings when it is over", () => {
  const now = ts("2026-11-10", "09:30");
  assert.equal(R.remNextRing(asR(item()), { done: "2026-11-10", at: 1 }, now, DXB, 0), 0);
  assert.equal(R.remNextRing(asR(item({ on: false })), undefined, now, DXB, 0), 0);
  const sn: R.RemState = { snoozeUntil: ts("2026-11-10", "09:45"), at: 1 };
  assert.equal(R.remNextRing(asR(item()), sn, now, DXB, ts("2026-11-10", "09:00")), ts("2026-11-10", "09:45"));
  assert.equal(R.remNextRing(asR(item()), sn, ts("2026-11-10", "09:46"), DXB, ts("2026-11-10", "09:00")), ts("2026-11-10", "09:46"));
  assert.equal(R.remNextRing(asR(item({ until: "10:00" })), { snoozeUntil: ts("2026-11-10", "10:30"), at: 1 }, ts("2026-11-10", "09:50"), DXB, ts("2026-11-10", "09:00")), 0);
});
ok("the push schedule: future ring moments only, in order, capped, nothing for a confirmed window", () => {
  const now = ts("2026-11-10", "08:00");
  const t = W.pushTimes([item()], now, DXB);
  assert.equal(t[0].at, ts("2026-11-10", "09:00"));
  assert.equal(t[1].at, ts("2026-11-10", "09:15"));
  assert.ok(t.length <= W.PUSH_PER_REMINDER && t.every((x) => x.at > now && x.at <= now + W.PUSH_HORIZON_MS));
  assert.deepEqual(t.map((x) => x.at), [...t.map((x) => x.at)].sort((a, b) => a - b));
  const done = W.pushTimes([item({ done: "2026-11-10", stateAt: 5 })], now, DXB);
  assert.ok(done.every((x) => x.at >= ts("2026-11-11", "09:00")));
  assert.deepEqual(W.pushTimes([item({ on: false })], now, DXB), []);
  const many = W.pushTimes(Array.from({ length: 30 }, (_, i) => item({ id: `r${i}` })), now, DXB);
  assert.ok(many.length <= W.PUSH_MAX);
  assert.ok(W.sameTimes(t, W.pushTimes([item()], now, DXB)) && !W.sameTimes(t, done));
});
ok("a snooze that is running starts the next window's pushes at its end", () => {
  const now = ts("2026-11-10", "09:20");
  const t = W.pushTimes([item({ snoozeUntil: ts("2026-11-10", "09:40"), stateAt: 5 })], now, DXB);
  assert.equal(t[0].at, ts("2026-11-10", "09:40"));
});
ok("what is sent to the server holds ids and times, never words", () => {
  const t = W.pushTimes([item({ text: "SECRET WORDS", pill: "PRIVATE" })], ts("2026-11-10", "08:00"), DXB);
  assert.ok(!JSON.stringify(t).includes("SECRET") && !JSON.stringify(t).includes("PRIVATE"));
  assert.deepEqual(Object.keys(t[0]).sort(), ["at", "id"]);
  assert.deepEqual(W.wordsOf([item({ id: "BAD!" }), item()]), { ab1: { pill: "Water", text: "DRINK WATER?" } });
});
ok("the card shows once per ring and comes back after a snooze length; none while one is up", () => {
  const list = [item()];
  const last = new Map<string, number>();
  const t0 = ts("2026-11-10", "09:00");
  assert.equal(W.dueCard(list, t0 - 60_000, DXB, last, null), null);
  assert.equal(W.dueCard(list, t0, DXB, last, null)?.id, "ab1");
  assert.equal(W.dueCard(list, t0, DXB, last, list[0]), null);
  last.set("ab1", t0);
  assert.equal(W.dueCard(list, t0 + 60_000, DXB, last, null), null);
  assert.equal(W.dueCard(list, t0 + 15 * 60_000, DXB, last, null)?.id, "ab1");
  assert.equal(W.dueCard([item({ done: "2026-11-10", stateAt: 1 })], t0 + 15 * 60_000, DXB, last, null), null);   // Done on another device
});
ok("the button's states: Home Screen first on an iPhone, then the tap, then on or blocked", () => {
  const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15";
  const e: W.PushEnv = { feature: true, hasApi: true, ua, standalone: true, permission: "default", subscribed: false };
  assert.equal(W.pushState(e), "ask");
  assert.equal(W.pushState({ ...e, standalone: false }), "needs-home-screen");
  assert.equal(W.pushState({ ...e, ua: ua.replace("17_2", "16_3") }), "old-ios");
  assert.equal(W.pushState({ ...e, ua: ua.replace("17_2", "16_4") }), "ask");
  assert.equal(W.pushState({ ...e, permission: "denied" }), "blocked");
  assert.equal(W.pushState({ ...e, permission: "granted", subscribed: true }), "on");
  assert.equal(W.pushState({ ...e, permission: "granted", subscribed: false }), "ask");
  assert.equal(W.pushState({ ...e, feature: false }), "feature-off");
  assert.equal(W.pushState({ ...e, hasApi: false }), "unsupported");
});
ok("push bodies and subscriptions are checked", () => {
  assert.deepEqual(W.parsePush('{"t":"rem","id":"ab1","at":5}'), { id: "ab1", at: 5 });
  for (const bad of ['{"t":"x","id":"ab1"}', '{"t":"rem","id":"BAD ID"}', "nope", "", null, undefined]) assert.equal(W.parsePush(bad as string), null);
  assert.deepEqual(W.cleanSub({ endpoint: "https://push.example.com/x", keys: { p256dh: "a", auth: "b" } }), { endpoint: "https://push.example.com/x", p256dh: "a", auth: "b" });
  assert.equal(W.cleanSub({ endpoint: "http://insecure", keys: { p256dh: "a", auth: "b" } }), null);
  assert.equal(W.cleanSub({ endpoint: "https://x", keys: { p256dh: "a" } }), null);
  assert.equal(W.cleanSub(null), null);
  assert.deepEqual([...W.keyBytes("AQID")], [1, 2, 3]);
});
console.log(`${n} passed`);

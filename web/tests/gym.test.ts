// Run: node --experimental-strip-types tests/gym.test.ts
// The gym reminder timing (src/core/gym.ts): 2 h, 1 h, 30 min and 10 min cards, the ring at minus 16,
// stale reminders after sleep, acknowledging, days and time changes. FICTIONAL days only.
import assert from "node:assert/strict";
const G = await import("../src/core/gym.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const TZ = "Asia/Dubai";                       // UTC+4, no daylight saving
const at = (hm: string, day = "2026-11-03") => Date.parse(`${day}T${hm}:00+04:00`);
const P = G.gymPrefs(undefined);

ok("defaults: on, every day, 08:00", () => {
  assert.deepEqual(P, { on: true, time: "08:00", days: [0, 1, 2, 3, 4, 5, 6] });
});
ok("broken prefs fall back field by field", () => {
  assert.deepEqual(G.gymPrefs({ on: false, time: "25:00", days: [1, 1, 9, "x", 3] }), { on: false, time: "08:00", days: [1, 3] });
});
ok("the day's steps: 06:00, 07:00, 07:30, 07:44 ring, 07:50", () => {
  const s = G.gymSteps(P, at("05:00"), TZ).filter((x) => x.day === "2026-11-03");
  assert.deepEqual(s.map((x) => [new Date(x.due).toISOString().slice(11, 16), x.ring]), [
    ["02:00", false], ["03:00", false], ["03:30", false], ["03:44", true], ["03:50", false]]);   // UTC: 06:00, 07:00, 07:30, 07:44, 07:50 Dubai
});
ok("each card is due at its time and only once", () => {
  for (const [hm, mins] of [["06:00", 120], ["07:00", 60], ["07:30", 30], ["07:50", 10]] as const) {
    const d = G.gymDue(P, at(hm) + 20_000, TZ, [], []);
    assert.equal(d?.mins, mins, hm);
    assert.equal(G.gymDue(P, at(hm) + 20_000, TZ, [], [d!.id]), null, hm + " twice");
  }
});
ok("the ring is never a Mac card", () => {
  assert.equal(G.gymDue(P, at("07:44") + 10_000, TZ, [], ["2026-11-03:120", "2026-11-03:60", "2026-11-03:30"]), null);
});
ok("nothing is due between steps", () => {
  assert.equal(G.gymDue(P, at("06:30"), TZ, [], []), null);
});
ok("slept through 06:00 and 07:00: waking at 07:10 fires nothing stale", () => {
  assert.equal(G.gymDue(P, at("07:10"), TZ, [], []), null);
  assert.equal(G.gymCard(P, at("07:10"), TZ, [], []), null);   // never shown, so no card either
});
ok("a step 1 minute late still fires, 3 minutes late is skipped", () => {
  assert.equal(G.gymDue(P, at("07:01"), TZ, [], [])?.mins, 60);
  assert.equal(G.gymDue(P, at("07:03"), TZ, [], []), null);
});
ok("woke at 07:30:30: only the 30 minute card, not the two before", () => {
  const d = G.gymDue(P, at("07:30") + 30_000, TZ, [], []);
  assert.equal(d?.mins, 30);
});
ok("the card follows the newest reminder shown and survives a restart (fired list)", () => {
  const fired = ["2026-11-03:120", "2026-11-03:60"];
  assert.equal(G.gymCard(P, at("07:20"), TZ, [], fired)?.mins, 60);
  const t = G.gymCardText(G.gymCard(P, at("07:20"), TZ, [], fired)!, at("07:20"), TZ, P.time);
  assert.deepEqual(t, { title: "Gym in 40 min", sub: "08:00 today" });
});
ok("card words at each step", () => {
  const c = (mins: number) => G.gymCardText({ at: at("08:00"), mins }, at("08:00") - mins * 60_000, TZ, "08:00").title;
  assert.deepEqual([c(120), c(60), c(30), c(10)], ["Gym in 2 h", "Gym in 1 h", "Gym in 30 min", "Gym in 10 min"]);
  assert.equal(G.gymCardText({ at: at("08:00"), mins: 10 }, at("08:05"), TZ, "08:00").title, "Gym time");
});
ok("the card leaves by itself 90 minutes after gym time", () => {
  const fired = ["2026-11-03:10"];
  assert.ok(G.gymCard(P, at("09:29"), TZ, [], fired));
  assert.equal(G.gymCard(P, at("09:31"), TZ, [], fired), null);
});
ok("acknowledged: the card goes and the day's later reminders stay quiet", () => {
  const acked = G.ackGym([], "2026-11-03", at("07:00"), TZ);
  assert.equal(G.gymCard(P, at("07:20"), TZ, acked, ["2026-11-03:60"]), null);
  assert.equal(G.gymDue(P, at("07:30") + 5000, TZ, acked, []), null);
  assert.ok(!G.gymSteps(P, at("07:20"), TZ, acked).some((s) => s.day === "2026-11-03"));
  assert.equal(G.gymSteps(P, at("07:20"), TZ, acked)[0].day, "2026-11-04");   // tomorrow still rings
});
ok("old acknowledged days are dropped", () => {
  const l = G.ackGym(["2026-10-01", "2026-11-01", "bad"], "2026-11-03", at("07:00"), TZ);
  assert.deepEqual(l, ["2026-11-01", "2026-11-03"]);
});
ok("off: nothing at all", () => {
  const off = { ...P, on: false };
  assert.equal(G.gymSteps(off, at("05:00"), TZ).length, 0);
  assert.equal(G.gymPlan(off, at("05:00"), TZ, []).items.length, 0);
});
ok("only the chosen days (Mon, Wed, Fri)", () => {
  const p = { ...P, days: [1, 3, 5] };
  const days = G.gymTimes(p, at("09:40", "2026-11-02"), TZ, 7).map((g) => g.day);   // Mon 2 Nov after the card left
  assert.deepEqual(days, ["2026-11-04", "2026-11-06", "2026-11-09"]);
});
ok("another time: 18:30 rings at 18:14", () => {
  const p = { ...P, time: "18:30" };
  const ring = G.gymSteps(p, at("12:00"), TZ).find((s) => s.ring)!;
  assert.equal(ring.due, at("18:14"));
});
ok("next wake: the next step, then the card leaving", () => {
  assert.equal(G.gymNextWake(P, at("06:10"), TZ, [], ["2026-11-03:120"]), at("07:00"));
  assert.equal(G.gymNextWake(P, at("07:55"), TZ, [], ["2026-11-03:10"]), at("09:30"));
});
ok("daylight saving: 08:00 London stays 08:00 on the change day", () => {
  const L = "Europe/London";
  const t = G.gymTimes(P, Date.parse("2026-10-25T00:30:00Z"), L, 1).find((g) => g.day === "2026-10-25")!;
  assert.equal(new Date(t.at).toISOString(), "2026-10-25T08:00:00.000Z");   // GMT again after 01:00 UTC
  const s = G.gymTimes(P, Date.parse("2026-10-24T00:30:00Z"), L, 0).find((g) => g.day === "2026-10-24")!;
  assert.equal(new Date(s.at).toISOString(), "2026-10-24T07:00:00.000Z");   // BST the day before
});
ok("the phone plan: times only, acknowledged days left out", () => {
  const plan = G.gymPlan(P, at("07:00"), TZ, ["2026-11-03"]);
  assert.equal(plan.items[0].day, "2026-11-04");
  assert.equal(plan.ring, 16);
  assert.deepEqual(plan.before, [120, 60, 30, 10]);
  assert.ok(plan.items.length >= 7);
  assert.ok(!JSON.stringify(plan).includes("Gym"));
});
// The developer's choices (2 Nov 2026). The phone ring's 10 minutes and its Later are in ps-gos GymClockTest.
const D = await import("../src/core/dnd.ts");
ok("Mac Later: the card is put away 5 minutes, then back (the next look is armed for it)", () => {
  const s = G.gymLater("2026-11-03", at("07:31"));
  assert.equal(s.until, at("07:36"));
  assert.equal(G.gymSnoozed(s, "2026-11-03", at("07:35")), true);
  assert.equal(G.gymSnoozed(s, "2026-11-03", at("07:36")), false);
  assert.equal(G.gymSnoozed(s, "2026-11-04", at("07:35")), false);   // another day's card is not put away
  assert.equal(G.gymNextWake(P, at("07:31"), TZ, [], ["2026-11-03:30"], s), at("07:36"));
  assert.equal(G.gymNextWake(P, at("07:37"), TZ, [], ["2026-11-03:30"], s), at("07:50"));
});
ok("PS Do Not Disturb: the Mac card stays quiet, the ring never does (it is an alarm)", () => {
  const all = D.dndApply(undefined, { op: "on" }, at("07:00"));          // everything muted
  assert.equal(G.gymQuiet("card", all, at("07:30")), true);
  assert.equal(G.gymQuiet("ring", all, at("07:44")), false);
  assert.equal(G.gymQuiet("card", { on: false }, at("07:30")), false);
  const letMeetings = D.dndApply(all, { op: "pass", kind: "meetings", pass: true }, at("07:01"));
  assert.equal(G.gymQuiet("card", letMeetings, at("07:30")), false);
  // The phone's plan has no DND in it at all, so the shell rings whatever DND says.
  assert.equal(G.gymPlan.length, 4);
  assert.ok(!/dnd/i.test(JSON.stringify(G.gymPlan(P, at("07:00"), TZ, []))));
});
ok("fired ids older than yesterday are pruned", () => {
  assert.deepEqual(G.pruneFired(["2026-11-01:60", "2026-11-02:10", "2026-11-03:120"], at("07:00"), TZ), ["2026-11-02:10", "2026-11-03:120"]);
});

console.log(`\n${n} gym tests passed`);

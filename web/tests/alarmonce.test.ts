// Run: node --experimental-strip-types tests/alarmonce.test.ts
// Just tomorrow (PS 1.65, src/core/alarmonce.ts and its use in src/core/sleepmode.ts): the override applies once and clears
// itself, crossing midnight, time zones and a clock change, skip, undo, a main alarm changed while it is set, backups of the same
// morning, the plan's line for the shells, and the Touch ID gate with a fake authenticator. FICTIONAL data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const O = await import("../src/core/alarmonce.ts");
const M = await import("../src/core/sleepmode.ts");
const T = await import("../src/core/tour.ts");
const SS = await import("../src/core/sleepsettings.ts");

let n = 0;
const ok = async (name: string, fn: () => unknown) => { await fn(); n++; console.log("ok -", name); };
const TZ = "Europe/London";
const at = (iso: string, tz = TZ) => { const [d, t] = iso.split("T"); return O.tsOn(d, t, tz); };
const A = (id: string, t: string, on = true) => ({ id, at: t, on });
const rings = (alarms: ReturnType<typeof A>[], since: number, once: unknown, tz = TZ) => M.ringsFor(alarms, since, tz, undefined, null, O.cleanOnce(once));
const clocks = (r: { at: number }[], tz = TZ) => r.map((x) => O.wallOf(x.at, tz));

const base = [A("a1", "09:00")];
const night = at("2026-11-17T23:40");   // went to bed late

await ok("no override: the usual ring", () => {
  assert.deepEqual(clocks(rings(base, night, null)), ["2026-11-18T09:00"]);
});
await ok("Later +90 moves tomorrow only, the day after is the usual again", () => {
  const once = O.onceChoose(base, null, night, TZ, { kind: "later", mins: 90 });
  assert.ok(once && typeof once === "object");
  assert.deepEqual(clocks(rings(base, night, once)), ["2026-11-18T10:30"]);
  assert.equal(rings(base, night, once)[0].once, true);
  assert.equal(rings(base, night, once)[0].label, "10:30");
  // between the usual 09:00 and the new 10:30: the moved ring is still next (a nap, or the alarm plan made from now)
  assert.deepEqual(clocks(rings(base, at("2026-11-18T09:20"), once)), ["2026-11-18T10:30"]);
  // after it rang: the next day is the usual time, the main alarm untouched
  assert.deepEqual(clocks(rings(base, at("2026-11-18T10:31"), once)), ["2026-11-19T09:00"]);
  assert.equal(base[0].at, "09:00");
});
await ok("the override clears itself once its morning is over", () => {
  const once = O.onceChoose(base, null, night, TZ, { kind: "later", mins: 60 }) as InstanceType<never>;
  assert.equal(O.onceSpent(base, once, at("2026-11-18T09:30"), TZ), false);
  assert.equal(O.onceSpent(base, once, at("2026-11-18T10:20"), TZ), false);
  assert.equal(O.onceSpent(base, once, at("2026-11-18T10:30"), TZ), true);
  // spent: the view offers the next morning again
  const v = O.onceView(base, once, at("2026-11-18T11:00"), TZ)!;
  assert.equal(v.state, "none");
  // and it never matches another day, even if nobody cleared it
  assert.deepEqual(clocks(rings(base, at("2026-11-19T00:30"), once)), ["2026-11-19T09:00"]);
});
await ok("skip: nothing rings that morning, the next day rings", () => {
  const once = O.onceChoose(base, null, night, TZ, { kind: "skip" });
  assert.deepEqual(once && typeof once === "object" && once.to, null);
  assert.deepEqual(rings(base, night, once), []);
  assert.deepEqual(clocks(rings(base, at("2026-11-18T09:01"), once)), ["2026-11-19T09:00"]);
  assert.equal(O.onceSpent(base, once as never, at("2026-11-18T09:30"), TZ), true);
});
await ok("undo puts the usual alarm back", () => {
  const once = O.onceChoose(base, null, night, TZ, { kind: "skip" });
  const back = O.onceChoose(base, once as never, night, TZ, { kind: "undo" });
  assert.equal(back, null);
  assert.deepEqual(clocks(rings(base, night, back)), ["2026-11-18T09:00"]);
});
await ok("changing a set override keeps the same morning (skip then +60)", () => {
  const skip = O.onceChoose(base, null, night, TZ, { kind: "skip" }) as never;
  const later = O.onceChoose(base, skip, at("2026-11-18T09:10"), TZ, { kind: "later", mins: 60 });
  assert.ok(later && typeof later === "object");
  assert.equal(later.rings[0].day, "2026-11-18");
  assert.deepEqual(clocks(rings(base, at("2026-11-18T09:10"), later)), ["2026-11-18T10:00"]);
});
await ok("crossing midnight: a 23:30 alarm moved +60 rings at 00:30 the next date", () => {
  const late = [A("a2", "23:30")];
  const now = at("2026-11-17T22:00");
  const once = O.onceChoose(late, null, now, TZ, { kind: "later", mins: 60 });
  assert.deepEqual(clocks(rings(late, now, once)), ["2026-11-18T00:30"]);
  assert.deepEqual(clocks(rings(late, at("2026-11-18T00:31"), once)), ["2026-11-18T23:30"]);
  // a picked time after midnight is the next time the clock reads it
  const pick = O.onceChoose(late, null, now, TZ, { kind: "pick", at: "01:15" });
  assert.deepEqual(clocks(rings(late, now, pick)), ["2026-11-18T01:15"]);
});
await ok("bedtime after midnight still says tomorrow, after 04:00 it says today", () => {
  assert.equal(O.dayWord(at("2026-11-18T09:00"), at("2026-11-18T01:30"), TZ), "Tomorrow");
  assert.equal(O.dayWord(at("2026-11-18T09:00"), at("2026-11-18T06:30"), TZ), "Today");
  assert.equal(O.dayWord(at("2026-11-18T09:00"), at("2026-11-17T23:00"), TZ), "Tomorrow");
  assert.equal(O.onceWords("Today").skip, "Skip today");
});
await ok("time zones: the override follows this device's clock like the main alarms", () => {
  const ny = "America/New_York";
  const now = at("2026-11-17T22:00", ny);
  const once = O.onceChoose(base, null, now, ny, { kind: "later", mins: 30 });
  assert.deepEqual(clocks(rings(base, now, once, ny), ny), ["2026-11-18T09:30"]);
  // the same override read on a device in another zone means 09:30 on that clock, on that date
  const tk = "Asia/Tokyo";
  assert.deepEqual(clocks(rings(base, at("2026-11-17T23:00", tk), once, tk), tk), ["2026-11-18T09:30"]);
});
await ok("a clock change (DST) night: the moved ring keeps the wall time", () => {
  // UK clocks go back on 25 Oct 2026 at 02:00: the night is an hour longer
  const now = at("2026-10-24T23:30");
  const early = [A("e", "01:30")];
  const once = O.onceChoose(early, null, now, TZ, { kind: "later", mins: 90 });
  assert.ok(once && typeof once === "object");
  const r = rings(early, now, once);
  assert.equal(r.length, 1);
  assert.equal(O.clockOf(r[0].at, TZ), O.clockOf(O.tsOfWall(once.to!, TZ), TZ));
  // spring forward (29 Mar 2026): 09:00 + 60 is 10:00 on the clock that morning
  const sp = at("2026-03-28T23:00");
  const o2 = O.onceChoose(base, null, sp, TZ, { kind: "later", mins: 60 });
  assert.deepEqual(clocks(rings(base, sp, o2)), ["2026-03-29T10:00"]);
  assert.equal(rings(base, sp, o2)[0].at - rings(base, sp, null)[0].at, 3600_000);
});
await ok("a main alarm changed while an override is set: that morning keeps the override, the new usual comes back after", () => {
  const once = O.onceChoose(base, null, night, TZ, { kind: "later", mins: 90 });
  const moved = [A("a1", "08:00")];
  assert.deepEqual(clocks(rings(moved, night, once)), ["2026-11-18T10:30"]);
  assert.deepEqual(clocks(rings(moved, at("2026-11-18T10:31"), once)), ["2026-11-19T08:00"]);
  const v = O.onceView(moved, once as never, night, TZ)!;
  assert.equal(O.onceLine(v), "Tomorrow only: 10:30 (your usual 08:00 is back the day after)");
  // switched off: nothing rings, the override cannot ring it either
  assert.deepEqual(rings([A("a1", "09:00", false)], night, once), []);
  // deleted: the override is gone with it
  assert.equal(O.onceTimes([A("zz", "09:00")], once as never, TZ).size, 0);
  assert.equal(O.onceSpent([A("zz", "09:00")], once as never, night, TZ), true);
});
await ok("backup alarms of the same morning move or skip with it, a later alarm does not", () => {
  const al = [A("a1", "09:00"), A("b", "09:10"), A("c", "17:00")];
  const once = O.onceChoose(al, null, night, TZ, { kind: "later", mins: 90 });
  assert.ok(once && typeof once === "object");
  assert.deepEqual(once.rings.map((r) => r.id), ["a1", "b"]);
  assert.deepEqual(clocks(rings(al, night, once)), ["2026-11-18T10:30", "2026-11-18T10:40", "2026-11-18T17:00"]);
  const skip = O.onceChoose(al, null, night, TZ, { kind: "skip" });
  assert.deepEqual(clocks(rings(al, night, skip)), ["2026-11-18T17:00"]);
  assert.equal(O.onceLine(O.onceView(al, skip as never, night, TZ)!), "Tomorrow skipped, 2 alarms (your usual 09:00 and 09:10 are back the day after)");
});
await ok("choices that make no sense change nothing", () => {
  assert.equal(O.onceChoose([], null, night, TZ, { kind: "skip" }), "none");
  assert.equal(O.onceChoose([A("x", "09:00", false)], null, night, TZ, { kind: "skip" }), "none");
  assert.equal(O.onceChoose(base, null, night, TZ, { kind: "later", mins: 13 * 60 }), "far");
  assert.equal(O.onceChoose(base, null, night, TZ, { kind: "later", mins: -5 }), "far");
  assert.equal(O.onceChoose(base, null, night, TZ, { kind: "pick", at: "09:00" }), null);   // the usual time: nothing to keep
  assert.equal(O.onceChoose(base, null, at("2026-11-18T08:59"), TZ, { kind: "pick", at: "08:59" }), "far");
  assert.equal(O.cleanOnce({ rings: [{ id: "bad id!", day: "2026-11-18" }], to: null }), null);
  assert.equal(O.cleanOnce({ rings: [{ id: "a1", day: "2026-11-18" }], to: "10:30" }), null);
  assert.equal(O.cleanOnce("x"), null);
});
await ok("the settings keep the override and the plan carries its line and words", () => {
  const once = O.onceChoose(base, null, night, TZ, { kind: "later", mins: 90 });
  const p = M.sleepModeOf({ sleepMode: { alarms: base, once } });
  assert.deepEqual(p.once, once);
  assert.deepEqual(M.cleanSleepMode(M.prefsOf(p)).once, once);
  const plan = M.buildPlan({ since: night, tz: TZ, prefs: p, tasks: [], squad: null, now: night, onceOn: true });
  assert.equal(plan.once?.line, "Tomorrow only: 10:30 (your usual 09:00 is back the day after)");
  assert.equal(plan.once?.set, true);
  assert.equal(plan.once?.usual, "09:00");
  assert.equal(plan.words.alarm, "Alarm 10:30");
  assert.deepEqual(plan.once?.words.mins.map((m) => m.label), ["+30 min", "+1 h", "+1 h 30"]);
  // switched off: the override is ignored and the plan has no line
  const off = M.buildPlan({ since: night, tz: TZ, prefs: p, tasks: [], squad: null, now: night });
  assert.equal(off.once, undefined);
  assert.equal(off.words.alarm, "Alarm 09:00");
  // with no override the line offers it
  const none = M.buildPlan({ since: night, tz: TZ, prefs: M.sleepModeOf({ sleepMode: { alarms: base } }), tasks: [], squad: null, now: night, onceOn: true });
  assert.equal(none.once?.line, "Just tomorrow: 09:00");
  // an alarm with Sleep mode off (alarmOnly) rings the moved time but carries no control
  const ao = M.buildPlan({ since: night, tz: TZ, prefs: p, tasks: [], squad: null, now: night, onceOn: true, alarmOnly: true });
  assert.equal(ao.once, undefined);
  assert.deepEqual(clocks(ao.rings), ["2026-11-18T10:30"]);
});
await ok("the Touch ID gate: nothing changes unless the fake authenticator passes", async () => {
  let saved = 0;
  const act = () => { saved++; return "saved"; };
  for (const a of ["no", "none", "old"] as const) {
    const r = await O.withOwner(async () => a, "change tomorrow's alarm", act);
    assert.deepEqual(r, { ok: false, why: a });
  }
  const thrown = await O.withOwner(async () => { throw new Error("sheet failed"); }, "x", act);
  assert.deepEqual(thrown, { ok: false, why: "no" });
  assert.equal(saved, 0);
  let asked = "";
  const r = await O.withOwner(async (reason) => { asked = reason; return "ok"; }, "change tomorrow's alarm", act);
  assert.deepEqual(r, { ok: true, value: "saved" });
  assert.equal(asked, "change tomorrow's alarm");
  assert.equal(saved, 1);
});
await ok("registered: feature, Sleep settings row, tour step, no dashes in the words", () => {
  const reg = JSON.parse(readFileSync(new URL("../../features.json", import.meta.url), "utf8")).features as { id: string; owner: string; since: string; default: string; parts: string[] }[];
  const f = reg.find((x) => x.id === O.ONCE_FEATURE)!;
  assert.equal(f.owner, "jan"); assert.equal(f.since, "1.65"); assert.equal(f.default, "on");
  assert.deepEqual(f.parts, ["web", "mac", "phone"]);
  assert.equal(SS.sleepEntry("once")?.group, "alarms");
  assert.ok(SS.searchSleep("skip tomorrow", "mac").some((e) => e.id === "once"));
  assert.ok(T.TOUR_STEPS.some((s) => s.ids.includes(O.ONCE_FEATURE)));
  assert.ok(readFileSync(new URL("../../FEATURES.md", import.meta.url), "utf8").includes("| Just tomorrow |"));
  for (const file of ["../src/core/alarmonce.ts", "../src/sleepmode/once.ts", "../src/views/AlarmOnce.tsx", "../src/views/alarmonce.css"]) {
    assert.ok(!/[–—]/.test(readFileSync(new URL(file, import.meta.url), "utf8")), file);
  }
  // the engine hands both shells' answers and choices to sleepmode/once.ts
  const eng = readFileSync(new URL("../src/sleepmode/engine.ts", import.meta.url), "utf8");
  assert.ok(eng.includes("onceAuthAnswer(m.authId") && eng.includes('m.type === "sleep:auth"') && eng.includes('m.type === "sleep:once"'));
  // the web control closes its Later row on Esc
  assert.ok(readFileSync(new URL("../src/views/AlarmOnce.tsx", import.meta.url), "utf8").includes('e.key === "Escape"'));
  // and Sleep settings lets that row take the Esc first (one Esc, one layer)
  assert.ok(readFileSync(new URL("../src/views/SleepSettings.tsx", import.meta.url), "utf8").includes("|| onceRowOpen()"));
});
console.log(`\n${n} passed`);

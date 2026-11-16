// Run: node --experimental-strip-types tests/posture.test.ts
// The Posture reminder (src/core/posture.ts, PS 1.65): the settings, the hours (past midnight too), the slots on the clock,
// every reason a slot is skipped or waits (meeting, Sleep mode, away, a long idle, a sleeping Mac), the figure's animation.
// Times are built from the local clock, so the tests give the same answer in any time zone. FICTIONAL data only.
import assert from "node:assert/strict";
const P = await import("../src/core/posture.ts");
const F = await import("../src/core/posturefigure.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const MIN = 60_000;
const at = (h: number, m = 0, s = 0, day = 17) => new Date(2026, 10, day, h, m, s).getTime();
const prefs = (o: Record<string, unknown> = {}) => P.posturePrefs(o);
const env = (now: number, o: Partial<Parameters<typeof P.postureStep>[2]> = {}) =>
  ({ now, idleMs: 0, meeting: false, covered: false, shown: false, lastTick: now - 20_000, ...o });

ok("defaults: on, every 45, 09:00 to 18:00", () => {
  assert.deepEqual(P.posturePrefs(undefined), { on: true, every: 45, from: "09:00", to: "18:00" });
  assert.deepEqual(P.posturePrefs("junk"), P.POSTURE_DEFAULT);
});
ok("only 30, 45, 60 and 90 minutes are taken, text numbers too", () => {
  for (const e of [30, 45, 60, 90]) assert.equal(prefs({ every: e }).every, e);
  assert.equal(prefs({ every: "60" }).every, 60);
  for (const bad of [0, 15, 31, 120, -5, NaN, null, "x"]) assert.equal(prefs({ every: bad }).every, 45);
});
ok("bad times fall back, good ones stay, off stays off", () => {
  assert.equal(prefs({ from: "25:00" }).from, "09:00");
  assert.equal(prefs({ to: "9:5" }).to, "18:00");
  assert.equal(prefs({ from: "07:30", to: "22:15" }).to, "22:15");
  assert.equal(prefs({ on: false }).on, false);
  assert.equal(prefs({ on: 0 }).on, true);   // only an exact false switches it off
});
ok("the hours: inside, edges, and past midnight", () => {
  const day = { from: "09:00", to: "18:00" };
  assert.equal(P.inWindow(day, 9 * 60), true);
  assert.equal(P.inWindow(day, 18 * 60), false);
  assert.equal(P.inWindow(day, 8 * 60 + 59), false);
  const night = { from: "22:00", to: "06:00" };
  assert.equal(P.inWindow(night, 23 * 60), true);
  assert.equal(P.inWindow(night, 0), true);
  assert.equal(P.inWindow(night, 5 * 60 + 59), true);
  assert.equal(P.inWindow(night, 6 * 60), false);
  assert.equal(P.inWindow(night, 12 * 60), false);
  assert.equal(P.inWindow({ from: "08:00", to: "08:00" }, 3 * 60), true);   // same time: the whole day
});
ok("slots sit on the clock from midnight", () => {
  const p = prefs({ every: 45 });
  assert.equal(P.latestSlot(p, at(9, 0)), at(9, 0));
  assert.equal(P.latestSlot(p, at(9, 30)), at(9, 0));
  assert.equal(P.latestSlot(p, at(9, 44, 59)), at(9, 0));
  assert.equal(P.latestSlot(p, at(9, 45)), at(9, 45));
  assert.equal(P.latestSlot(prefs({ every: 90 }), at(10, 40)), at(10, 30));
  assert.equal(P.latestSlot(prefs({ every: 30 }), at(14, 31)), at(14, 30));
  assert.equal(P.latestSlot(prefs({ every: 60 }), at(14, 59)), at(14, 0));
});
ok("no slot outside the hours, or when off", () => {
  assert.equal(P.latestSlot(prefs(), at(8, 30)), null);
  assert.equal(P.latestSlot(prefs(), at(18, 0)), null);
  assert.equal(P.latestSlot(prefs(), at(23, 0)), null);
  assert.equal(P.latestSlot(prefs({ on: false }), at(10, 0)), null);
});
ok("hours past midnight give slots after midnight", () => {
  const p = prefs({ from: "22:00", to: "02:00", every: 60 });
  assert.equal(P.latestSlot(p, at(23, 10)), at(23, 0));
  assert.equal(P.latestSlot(p, at(0, 5)), at(0, 0));
  assert.equal(P.latestSlot(p, at(1, 59)), at(1, 0));
  assert.equal(P.latestSlot(p, at(2, 5)), null);
  assert.equal(P.latestSlot(p, at(21, 5)), null);
});
ok("the next slot: inside the hours, over the evening, past midnight, off", () => {
  const p = prefs({ every: 60 });
  assert.equal(P.nextSlot(p, at(10, 20)), at(11, 0));
  assert.equal(P.nextSlot(p, at(17, 20)), at(9, 0, 0, 18));   // 18:00 is outside: tomorrow 09:00
  assert.equal(P.nextSlot(p, at(7, 0)), at(9, 0));
  assert.equal(P.nextSlot(prefs({ on: false }), at(10, 0)), null);
  assert.equal(P.nextSlot(prefs({ from: "22:00", to: "02:00", every: 60 }), at(23, 30)), at(0, 0, 0, 18));
});
ok("a good moment shows it, once", () => {
  const p = prefs();
  const a = P.postureStep(p, 0, env(at(9, 45, 5)));
  assert.equal(a.show, true); assert.equal(a.handled, at(9, 45));
  const b = P.postureStep(p, a.handled, env(at(9, 45, 25)));
  assert.equal(b.show, false); assert.equal(b.why, "done");
  const c = P.postureStep(p, a.handled, env(at(10, 30, 5)));
  assert.equal(c.show, true); assert.equal(c.handled, at(10, 30));
});
ok("a meeting holds it, and it shows when the meeting ends if still fresh", () => {
  const p = prefs();
  const m = P.postureStep(p, 0, env(at(9, 45, 5), { meeting: true }));
  assert.deepEqual([m.show, m.handled, m.why], [false, 0, "meeting"]);
  const after = P.postureStep(p, 0, env(at(9, 50)));   // 5 minutes late, grace is 22.5 minutes
  assert.equal(after.show, true);
});
ok("a late slot is skipped, never queued (grace is half an interval, at most 10 minutes)", () => {
  const p = prefs({ every: 45 });
  assert.equal(P.postureStep(p, 0, env(at(9, 45, 0) + 10 * MIN + 1)).why, "stale");   // 10 min cap beats 22.5
  assert.equal(P.postureStep(p, 0, env(at(9, 45, 0) + 10 * MIN - 1000)).show, true);
  const s = P.postureStep(prefs({ every: 30 }), 0, env(at(9, 30) + 10 * MIN + 5));
  assert.equal(s.show, false); assert.equal(s.handled, at(9, 30));
  assert.equal(P.postureStep(prefs({ every: 30 }), s.handled, env(at(9, 50))).why, "done");   // not shown late later
});
ok("Sleep mode or Sentry mode covering the screen holds it", () => {
  const r = P.postureStep(prefs(), 0, env(at(9, 45, 5), { covered: true }));
  assert.deepEqual([r.show, r.why, r.handled], [false, "covered", 0]);
  assert.equal(P.postureStep(prefs(), 0, env(at(9, 50), { covered: false })).show, true);
});
ok("away from the keyboard holds it, back in time shows it", () => {
  const p = prefs();
  const r = P.postureStep(p, 0, env(at(9, 45, 5), { idleMs: P.AWAY_MS }));
  assert.deepEqual([r.show, r.why], [false, "away"]);
  assert.equal(P.postureStep(p, 0, env(at(9, 45, 5), { idleMs: P.AWAY_MS - 1 })).show, true);
  assert.equal(P.postureStep(p, 0, env(at(9, 47), { idleMs: 3000 })).show, true);
});
ok("a long idle means the person got up: the slot is skipped", () => {
  const r = P.postureStep(prefs(), 0, env(at(9, 45, 5), { idleMs: P.LONG_AWAY_MS }));
  assert.deepEqual([r.show, r.why, r.handled], [false, "got up", at(9, 45)]);
  assert.equal(P.postureStep(prefs(), r.handled, env(at(9, 46))).show, false);
});
ok("a Mac that slept (no tick for 3 minutes) skips the slot it missed", () => {
  const r = P.postureStep(prefs(), 0, env(at(9, 46), { lastTick: at(9, 20) }));
  assert.deepEqual([r.show, r.why, r.handled], [false, "slept", at(9, 45)]);
  assert.equal(P.postureStep(prefs(), r.handled, env(at(9, 46, 20), { lastTick: at(9, 46) })).show, false);
  assert.equal(P.postureStep(prefs(), 0, env(at(9, 46), { lastTick: at(9, 46) - P.SLEEP_GAP_MS })).show, true);   // exactly 3 min is a tick
  assert.equal(P.postureStep(prefs(), 0, env(at(9, 46), { lastTick: 0 })).show, true);   // the first tick ever
});
ok("a pop-up that is up gets no second one", () => {
  const r = P.postureStep(prefs(), 0, env(at(9, 45, 5), { shown: true }));
  assert.deepEqual([r.show, r.why, r.handled], [false, "shown", at(9, 45)]);
});
ok("off, or outside the hours: nothing, and the handled slot stays", () => {
  assert.equal(P.postureStep(prefs({ on: false }), 7, env(at(9, 45))).why, "off");
  assert.equal(P.postureStep(prefs({ on: false }), 7, env(at(9, 45))).handled, 7);
  assert.equal(P.postureStep(prefs(), 7, env(at(19, 0))).why, "no slot");
});
ok("a new day with the same slot time is a new slot", () => {
  const d1 = P.postureStep(prefs(), 0, env(at(9, 0, 5)));
  const d2 = P.postureStep(prefs(), d1.handled, env(at(9, 0, 5, 18)));
  assert.equal(d2.show, true);
});
ok("the figure: straight, slouches, holds, sits up, stays straight", () => {
  const { slouch, hold, up } = P.FIGURE_MS;
  assert.equal(P.slouchAt(0), 0);
  assert.equal(P.slouchAt(slouch / 2) > 0.3 && P.slouchAt(slouch / 2) < 0.7, true);
  assert.equal(P.slouchAt(slouch), 1);
  assert.equal(P.slouchAt(slouch + hold / 2), 1);
  assert.equal(P.slouchAt(slouch + hold + up / 2) > 0.3 && P.slouchAt(slouch + hold + up / 2) < 0.7, true);
  assert.equal(P.slouchAt(slouch + hold + up), 0);
  assert.equal(P.slouchAt(99999), 0);
  assert.equal(P.slouchAt(-5), 0);
  let prev = 0;
  for (let t = 0; t <= slouch; t += 50) { const v = P.slouchAt(t); assert.ok(v >= prev); prev = v; }   // smooth, never jumps back
});
ok("reduced motion: always straight", () => {
  for (const t of [0, 500, 1600, 2000, 3000]) assert.equal(P.slouchAt(t, true), 0);
  assert.match(F.FIGURE_CSS, /prefers-reduced-motion:reduce\)\{\.pf-torso,\.pf-head\{animation:none\}/);
});
ok("the figure is plain SVG: no script, no link, no outside address, no on handlers", () => {
  assert.match(F.FIGURE_SVG, /^<svg /);
  assert.doesNotMatch(F.FIGURE_SVG + F.FIGURE_CSS, /<script|href|xlink|https?:|url\(|@import|\son[a-z]+=/i);
  assert.equal(F.FIGURE_TOTAL_MS, P.FIGURE_MS.slouch + P.FIGURE_MS.hold + P.FIGURE_MS.up);
  assert.match(F.FIGURE_CSS, /@keyframes pf-torso/);
});
ok("no dashes in the words", () => {
  for (const w of Object.values(P.POSTURE_WORDS)) assert.doesNotMatch(w, /[–—]/);
});
ok("the Settings line says an end before the start runs past midnight", async () => {
  const { readFileSync } = await import("node:fs");
  const t = readFileSync(new URL("../src/core/settingsindex.ts", import.meta.url), "utf8");
  assert.match(t, /An end time before the start time runs past midnight/);
  assert.doesNotMatch(t, /later end time than start/);
});
ok("the first pop-up asks once: due only while unseen and on", () => {
  assert.equal(P.postureAskDue({}), true);
  assert.equal(P.postureAskDue({ postureAsk: false, posture: {} }), true);
  assert.equal(P.postureAskDue({ postureAsk: true }), false);
  assert.equal(P.postureAskDue({ posture: { on: false } }), false);
});
ok("answers: Turn off saves the switch off and seen, Keep it on only seen, junk is nothing", () => {
  assert.deepEqual(P.postureAskPatch("off", { every: 60, from: "08:00", to: "17:00" }), { postureAsk: true, posture: { on: false, every: 60, from: "08:00", to: "17:00" } });
  assert.deepEqual(P.postureAskPatch("off", undefined), { postureAsk: true, posture: { ...P.POSTURE_DEFAULT, on: false } });
  assert.deepEqual(P.postureAskPatch("keep", { every: 30 }), { postureAsk: true });
  for (const bad of ["seen", "", null, undefined, 1, {}]) assert.equal(P.postureAskPatch(bad, {}), null);
});
ok("the question words are short, plain and dash free", () => {
  for (const w of Object.values(P.POSTURE_ASK_WORDS)) { assert.doesNotMatch(w, /[–—;!]/); assert.ok(w.length <= 60); }
  assert.equal(P.POSTURE_ASK_WORDS.off, "Turn off");
});
ok("the Mac card refuses and says so, the button waits for its fade, the question is wired", async () => {
  const { readFileSync } = await import("node:fs");
  const sw = readFileSync(new URL("../../mac/Sources/Posture.swift", import.meta.url), "utf8");
  assert.match(sw, /guard !coveredNow\(\) else \{ onMessage\?\(.*skipped/);
  assert.match(sw, /#b:not\(\.rdy\)\{pointer-events:none\}/);
  assert.match(sw, /postureAsk/);
  const w = readFileSync(new URL("../src/posturewatch.ts", import.meta.url), "utf8");
  assert.match(w, /o\.act === "skipped"/);
  assert.match(w, /o\.type === "postureAsk"/);
});
console.log(`${n} passed`);

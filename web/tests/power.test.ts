// Run: node --experimental-strip-types tests/power.test.ts
// Minecraft mode's power out stopwatch (src/views/minecraft/power-format.ts): the clock face, lengths in
// words, what the panel says while out, just back and on, the outage rows, and that only clean values from
// PS get through. FICTIONAL times, Dubai time zone.
process.env.TZ = "Asia/Dubai";
import assert from "node:assert/strict";
const P = await import("../src/views/minecraft/power-format.ts");

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const at = (s: string) => new Date(s).getTime();
const NOW = at("2026-11-04T18:30:00+04:00");

ok("the clock face", () => {
  assert.equal(P.clock(0), "00:00:00");
  assert.equal(P.clock((42 * 60 + 13) * 1000), "00:42:13");
  assert.equal(P.clock((26 * 3600 + 5 * 60 + 9) * 1000 + 999), "26:05:09");
  assert.equal(P.clock(-5000), "00:00:00");
  assert.equal(P.clock(Number.NaN), "00:00:00");
});

ok("lengths in words", () => {
  assert.equal(P.human(45_000), "45 s");
  assert.equal(P.human(42 * 60_000 + 59_000), "42 min");
  assert.equal(P.human(72 * 60_000), "1 h 12 min");
  assert.equal(P.human(2 * 3600_000), "2 h");
  assert.equal(P.human(28 * 3600_000), "1 d 4 h");
  assert.equal(P.human(48 * 3600_000), "2 d");
  assert.equal(P.leftText(214), "3 h 34 min left");
  assert.equal(P.leftText(null), null);
  assert.equal(P.leftText(-1), null);
});

ok("no dashes anywhere in what the panel says", () => {
  const s = P.cleanPower({ type: "power:state", hasBattery: true, onBattery: false, batteryPct: 80, history: [{ start: NOW - 9e6, end: NOW - 4e6 }] });
  const texts = [P.powerView(s, NOW), P.powerView(s, NOW - 4e6 + 1000), P.outageRow(s.history[0], NOW)].map((x) => JSON.stringify(x));
  for (const t of texts) assert.ok(!/[\u2013\u2014]/.test(t), t);
});

ok("while out: the stopwatch, battery and time left", () => {
  const s = P.cleanPower({ type: "power:state", known: true, hasBattery: true, onBattery: true, since: NOW - (42 * 60 + 13) * 1000, batteryPct: 63, minutesLeft: 214, lastOutage: null, history: [] });
  const v = P.powerView(s, NOW);
  assert.equal(v.mode, "out");
  assert.equal(v.title, "Power has been out for");
  assert.ok(v.mode === "out" && v.clock === "00:42:13");
  assert.ok(v.mode === "out" && v.sub === "Since 17:47, battery 63%, 3 h 34 min left", v.mode === "out" ? v.sub : "");
  assert.equal(P.needsTick(s, NOW), true);
});

ok("while out, macOS still working out the time left", () => {
  const s = P.cleanPower({ hasBattery: true, onBattery: true, since: NOW - 5000, batteryPct: 99, minutesLeft: null });
  const v = P.powerView(s, NOW);
  assert.ok(v.mode === "out" && v.sub === "Since 18:29, battery 99%");
});

ok("just back: Power came back after ..., for 10 minutes", () => {
  const lo = { start: NOW - 9 * 60_000 - 72 * 60_000, end: NOW - 9 * 60_000 };
  const s = P.cleanPower({ type: "power:state", hasBattery: true, onBattery: false, batteryPct: 41, lastOutage: lo, history: [lo] });
  const v = P.powerView(s, NOW);
  assert.equal(v.mode, "back");
  assert.equal(v.title, "Power came back after 1 h 12 min");
  assert.ok(v.mode === "back" && v.sub === "Out from 17:09 to 18:21");
  assert.equal(P.needsTick(s, NOW), true);
  const later = P.powerView(s, NOW + 60_001);
  assert.equal(later.mode, "on");
  assert.equal(later.title, "Power on");
  assert.ok(later.mode === "on" && later.sub === "Last cut today, 1 h 12 min");
  assert.equal(P.needsTick(s, NOW + 60_001), false);
});

ok("an outage that ended while PS was closed says about", () => {
  const lo = { start: NOW - 3 * 3600_000, end: NOW - 60_000, approx: true };
  const s = P.cleanPower({ hasBattery: true, onBattery: false, lastOutage: lo, history: [lo] });
  assert.equal(P.powerView(s, NOW).title, "Power came back after about 2 h 59 min");
  assert.equal(P.outageRow(s.history[0], NOW).approx, true);
});

ok("power on with no cuts, and older cuts", () => {
  const s = P.cleanPower({ hasBattery: true, onBattery: false, batteryPct: 100, history: [] });
  const v = P.powerView(s, NOW);
  assert.ok(v.mode === "on" && v.sub === null);
  assert.equal(P.needsTick(s, NOW), false);
  const y = { start: at("2026-11-03T09:15:00+04:00"), end: at("2026-11-03T10:00:00+04:00") };
  const s2 = P.cleanPower({ hasBattery: true, onBattery: false, history: [y] });
  assert.equal((P.powerView(s2, NOW) as { sub: string }).sub, "Last cut yesterday, 45 min");
  const old = { start: at("2026-11-02T21:40:00+04:00"), end: at("2026-11-02T22:05:00+04:00") };
  const s3 = P.cleanPower({ hasBattery: true, onBattery: false, history: [old] });
  assert.equal((P.powerView(s3, NOW) as { sub: string }).sub, "Last cut Mon 2 Nov, 25 min");
});

ok("outage rows", () => {
  const r = P.outageRow({ start: at("2026-11-04T14:02:00+04:00"), end: at("2026-11-04T15:14:00+04:00"), duration: 72 * 60_000 }, NOW);
  assert.deepEqual({ day: r.day, span: r.span, length: r.length, approx: r.approx }, { day: "Today", span: "14:02 to 15:14", length: "1 h 12 min", approx: false });
  const past = P.outageRow({ start: at("2026-10-30T23:50:00+04:00"), end: at("2026-10-31T00:20:00+04:00"), duration: 30 * 60_000 }, NOW);
  assert.equal(past.day, "Fri 30 Oct");
  assert.equal(past.span, "23:50 to 00:20");
});

ok("waiting, outside PS, and no battery", () => {
  assert.equal(P.powerView(P.EMPTY_POWER, NOW).title, "Waiting for PS app...");
  assert.equal(P.powerView(P.EMPTY_POWER, NOW, false).title, "Only in PS app on the Mac");
  const d = P.cleanPower({ type: "power:state", known: true, hasBattery: false, onBattery: false });
  assert.equal(P.powerView(d, NOW).mode, "nobattery");
});

ok("only clean values from PS get through", () => {
  assert.deepEqual(P.cleanPower(null), P.EMPTY_POWER);
  assert.deepEqual(P.cleanPower("power"), P.EMPTY_POWER);
  assert.deepEqual(P.cleanPower({ type: "mixer", onBattery: true }), P.EMPTY_POWER);
  const s = P.cleanPower({ type: "power:state", hasBattery: true, onBattery: true, since: "yesterday", batteryPct: 140, minutesLeft: -1,
    history: [{ start: 5, end: 2 }, { start: NOW - 1000, end: NOW }, "x", null, ...Array.from({ length: 70 }, (_, i) => ({ start: NOW - 1e6 - i, end: NOW - i }))] });
  assert.equal(s.since, null);
  assert.equal(s.batteryPct, 100);
  assert.equal(s.minutesLeft, null);
  assert.equal(s.history.length, 50);
  assert.equal(s.history[0].duration, 1000);
  assert.equal(s.lastOutage?.end, NOW);
  // since is ignored while on mains
  assert.equal(P.cleanPower({ onBattery: false, since: NOW }).since, null);
  // out but with no start time: not the stopwatch
  assert.notEqual(P.powerView(s, NOW).mode, "out");
});

ok("internet out next to the power clock", () => {
  assert.equal(P.internetText(NOW - 12 * 60_000 - 3000, NOW), "Internet out for 00:12:03");
  assert.equal(P.internetText(null, NOW), null);
  assert.equal(P.internetText(undefined, NOW), null);
  assert.equal(P.internetText(NOW + 5000, NOW), null);
  assert.equal(P.needsTick(P.cleanPower({ hasBattery: true }), NOW, NOW - 1000), true);
});

console.log(`${n} power checks passed`);

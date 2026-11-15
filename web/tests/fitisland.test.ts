// Run: node --experimental-strip-types tests/fitisland.test.ts
// PS Fitness on the phone's island (V1.60, src/core/fitisland.ts, src/fitness/island-fig.ts): the scan moments, the
// progress hints (past days only), the nudge, the rest countdown, the figure and the switches. FICTIONAL data.
import assert from "node:assert/strict";
import fs from "node:fs";
const X = await import("../src/core/fitisland.ts");
const F = await import("../src/fitness/island-fig.ts");
let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };

const T = 1_800_000_000_000;
const S = (id: string, kg: number | null, over: Record<string, unknown> = {}) => ({ id, kg, reps: 8, done: true, ...over });
const ex = (sets: unknown[], over: Record<string, unknown> = {}) => ({ id: "e1", name: "Bench press", exId: "bench-press", sets, ...over });
const wk = (id: string, date: string, sets: unknown[], over: Record<string, unknown> = {}) =>
  ({ id, data: { date, startedAt: `${date}T08:00:00.000Z`, exercises: [ex(sets, over)] } }) as never;
const KEY = X.lastTime ? "bench-press" : "";
const TODAY = "2026-11-14";

// ---------- scan moments ----------
const scan = (state: string, hit: unknown = null, nn = 1) => ({ state, hit, n: nn }) as never;
const o = { fig: null, sound: true };
ok("scanning says Scanning, found says the name, not found says so", () => {
  const a = X.momentOnScan(null, scan("scanning"), T, o)!;
  assert.equal(a.kind, "scanning"); assert.equal(a.title, "Scanning");
  const b = X.momentOnScan(a, scan("found", { name: "Leg press", exId: "leg-press" }, 2), T + 900, { fig: { a: [], b: [], hr: 4 }, sound: true })!;
  assert.equal(b.kind, "found"); assert.equal(b.title, "Leg press"); assert.ok(b.fig);
  const c = X.momentOnScan(b, scan("notfound", null, 3), T + 2000, o)!;
  assert.equal(c.kind, "notfound"); assert.equal(c.title, "Not found"); assert.equal(c.until - c.at, X.MOMENT_MS.notfound);
});
ok("found with no hit is a Not found, never a blank", () => {
  assert.equal(X.momentOnScan(null, scan("found", null), T, o)!.kind, "notfound");
});
ok("added is Workout added with the name and the figure", () => {
  const m = X.momentOnScan(null, scan("added", { name: "Leg press", exId: "leg-press" }, 4), T, { fig: { a: [1], b: [2], hr: 5 }, sound: false })!;
  assert.equal(m.kind, "added"); assert.equal(m.title, "Workout added"); assert.equal(m.sub, "Leg press"); assert.equal(m.sound, false); assert.deepEqual(m.fig, { a: [1], b: [2], hr: 5 });
});
ok("idle clears scanning, found and not found, but never a Workout added on its way", () => {
  for (const k of ["scanning", "found", "notfound"]) { const m = X.momentOnScan(null, scan(k, k === "found" ? { name: "A", exId: null } : null), T, o); assert.equal(X.momentOnScan(m, scan("idle"), T + 5, o), null); }
  const added = X.momentOnScan(null, scan("added", { name: "A", exId: null }), T, o);
  assert.equal(X.momentOnScan(added, scan("idle"), T + 5, o), added);
  const hint = X.momentOfHint({ kind: "better", title: "t", sub: "s", daysAgo: 1 }, 1, T, true);
  assert.equal(X.momentOnScan(hint, scan("idle"), T + 5, o), hint);
});
ok("long names are cut and ids differ per scan", () => {
  const m = X.momentOnScan(null, scan("found", { name: "x".repeat(200), exId: null }, 9), T, o)!;
  assert.equal(m.title.length, 60); assert.equal(m.id, "scan-9");
});

// ---------- progress hints ----------
ok("days between dates, across a month end and a leap day", () => {
  assert.equal(X.daysBetween("2026-11-07", "2026-11-14"), 7);
  assert.equal(X.daysBetween("2026-10-31", "2026-11-02"), 2);
  assert.equal(X.daysBetween("2028-02-28", "2028-03-01"), 2);
});
ok("last time is the newest PAST day, never today", () => {
  const ws = [wk("a", "2026-11-07", [S("1", 60)]), wk("b", "2026-11-10", [S("1", 57.5), S("2", 62.5)]), wk("today", TODAY, [S("1", 100)])];
  const l = X.lastTime("id:bench-press", ws, TODAY, null)!;
  assert.deepEqual(l, { kg: 62.5, date: "2026-11-10", daysAgo: 4 });
});
ok("today's own earlier sets and the open workout are never last time", () => {
  const ws = [wk("cur", "2026-11-13", [S("1", 90)]), wk("older", "2026-11-01", [S("1", 50)])];
  assert.equal(X.lastTime("id:bench-press", ws, TODAY, "cur")!.kg, 50);
  assert.equal(X.lastTime("id:bench-press", [wk("t", TODAY, [S("1", 70)])], TODAY, null), null);
});
ok("warm up, drop, gone and not done sets and removed exercises do not count", () => {
  const ws = [wk("a", "2026-11-10", [S("1", 100, { warm: true }), S("2", 99, { drop: true }), S("3", 98, { gone: true }), S("4", 97, { done: false }), S("5", 40)])];
  assert.equal(X.lastTime("id:bench-press", ws, TODAY, null)!.kg, 40);
  const removed = { id: "r", data: { date: "2026-11-10", startedAt: "2026-11-10T08:00:00.000Z", exercises: [{ ...ex([S("1", 80)]), removed: true }] } } as never;
  assert.equal(X.lastTime("id:bench-press", [removed], TODAY, null), null);
  assert.equal(X.lastTime("id:squat", [wk("a", "2026-11-10", [S("1", 40)])], TODAY, null), null);
});
ok("heavier than last time: Higher than last time and how many days ago", () => {
  const l = { kg: 60, date: "2026-11-07", daysAgo: 7 };
  const h = X.setHint(62.5, l)!;
  assert.equal(h.kind, "better"); assert.equal(h.title, "Higher than last time"); assert.equal(h.sub, "7 days ago");
  assert.equal(X.setHint(60.5, { ...l, daysAgo: 1 })!.sub, "yesterday");
});
ok("the same weight: says so with the days, and Try going up next time", () => {
  const h = X.setHint(60, { kg: 60, date: "2026-11-07", daysAgo: 7 })!;
  assert.equal(h.kind, "same"); assert.equal(`${h.title}. ${h.sub}`, "Same weight as 7 days ago. Try going up next time.");
});
ok("lighter, no history, no weight, warm up and drop say nothing", () => {
  const l = { kg: 60, date: "2026-11-07", daysAgo: 7 };
  assert.equal(X.setHint(57.5, l), null); assert.equal(X.setHint(60, null), null); assert.equal(X.setHint(null, l), null);
  assert.equal(X.setHint(0, l), null); assert.equal(X.setHint(70, l, { warm: true }), null); assert.equal(X.setHint(70, l, { drop: true }), null);
});
ok("the nudge: only when last time was matched, and the next set is not already heavier", () => {
  const l = { kg: 60, date: "2026-11-07", daysAgo: 7 };
  const nd = X.nudgeBefore(60, 60, l, 2.5)!;
  assert.equal(nd.kg, 62.5); assert.equal(nd.title, "Try 62.5 kg");
  assert.equal(X.nudgeBefore(62.5, 62.5, l, 2.5), null);   // beat it: no nudge
  assert.equal(X.nudgeBefore(57.5, 57.5, l, 2.5), null);   // under it: no nudge
  assert.equal(X.nudgeBefore(60, 65, l, 2.5), null);       // already going up
  assert.equal(X.nudgeBefore(60, null, l, 2.5)!.kg, 62.5);
  assert.equal(X.nudgeBefore(60, 60, null, 2.5), null);
  assert.equal(X.nudgeBefore(60, 60, l, 1.25)!.kg, 61.25);
});
ok("onSetDone: a same weight set with a set to come gives the hint and the nudge", () => {
  const hist = [wk("old", "2026-11-07", [S("1", 60)])];
  const cur = ex([S("a", 60), S("b", 60, { done: false }), S("c", 60, { done: false })]) as never;
  const r = X.onSetDone(cur, (cur as never as { sets: never[] }).sets[0], hist, TODAY, "cur");
  assert.equal(r.hint!.kind, "same"); assert.equal(r.nudge!.title, "Try 62.5 kg");
});
ok("onSetDone: the last set of an exercise gives a hint but no nudge; a heavier one no nudge", () => {
  const hist = [wk("old", "2026-11-07", [S("1", 60)])];
  const last = ex([S("a", 60)]) as never;
  const r = X.onSetDone(last, (last as never as { sets: never[] }).sets[0], hist, TODAY, "cur");
  assert.equal(r.hint!.kind, "same"); assert.equal(r.nudge, null);
  const up = ex([S("a", 65), S("b", 65, { done: false })]) as never;
  const r2 = X.onSetDone(up, (up as never as { sets: never[] }).sets[0], hist, TODAY, "cur");
  assert.equal(r2.hint!.kind, "better"); assert.equal(r2.nudge, null);
});
ok("onSetDone: an earlier set today never counts as history", () => {
  // the same workout, earlier today at 100 kg, must not make 60 kg look lighter or the same
  const hist = [wk("cur", TODAY, [S("1", 100)]), wk("old", "2026-11-07", [S("1", 60)])];
  const cur = ex([S("a", 62.5)]) as never;
  assert.equal(X.onSetDone(cur, (cur as never as { sets: never[] }).sets[0], hist, TODAY, "cur").hint!.kind, "better");
  assert.equal(X.onSetDone(cur, (cur as never as { sets: never[] }).sets[0], [wk("cur", TODAY, [S("1", 100)])], TODAY, "cur").hint, null);
});

// ---------- rest ----------
ok("a running rest goes to the island, an ended one for 3 seconds, then nothing", () => {
  const r = { endsAt: T + 90_000, exercise: "Bench press", set: 2, of: 4, over: false, overAt: 0 };
  assert.deepEqual(X.restForIsland(r, T), r);
  assert.equal(X.restForIsland(r, T + 90_001), null);   // ran out and the shell has not said so yet
  const over = { ...r, over: true, overAt: T + 90_000 };
  assert.equal(X.restForIsland(over, T + 91_000)!.over, true);
  assert.equal(X.restForIsland(over, T + 93_000), null);
  assert.equal(X.restForIsland(null, T), null);
});
ok("+15 s moves the end the island counts to", () => {
  assert.equal(X.restForIsland({ endsAt: T + 105_000, exercise: "x", set: 1, of: 3, over: false, overAt: 0 }, T)!.endsAt, T + 105_000);
});
ok("a rest ending (or skipped) is told apart from +15 and from a new rest", () => {
  const a = { endsAt: T + 5000, exercise: "Bench press", set: 2, of: 4, over: false, overAt: 0 };
  assert.equal(X.restJustEnded(a, { ...a, over: true, overAt: T + 5000 }), true);
  assert.equal(X.restJustEnded(a, { ...a, endsAt: T + 20_000 }), false);
  assert.equal(X.restJustEnded(a, null), false);
  assert.equal(X.restJustEnded(null, { ...a, over: true }), false);
  assert.equal(X.restJustEnded({ ...a, over: true }, { ...a, over: true }), false);
  assert.equal(X.restJustEnded(a, { ...a, set: 3, over: true }), false);
});

// ---------- what goes to the island ----------
ok("the fit block: moment and rest together, expired moments dropped, nothing when off or empty", () => {
  const m = X.momentOfHint({ kind: "better", title: "Higher than last time", sub: "7 days ago", daysAgo: 7 }, 1, T, true);
  const r = { endsAt: T + 60_000, exercise: "Bench press", set: 1, of: 3, over: false, overAt: 0 };
  const s = X.fitIslandState(m, r, T + 1000, true)!;
  assert.equal(s.moment!.kind, "better"); assert.equal(s.rest!.set, 1);
  assert.equal(X.fitIslandState(m, null, T + m.until - T + 1, true), null);
  assert.equal(X.fitIslandState(m, r, T + 1000, false), null);
  assert.equal(X.fitIslandState(null, null, T, true), null);
});
ok("the page wakes itself when a moment or Rest over runs out", () => {
  const m = X.momentOfHint({ kind: "same", title: "t", sub: "s", daysAgo: 7 }, 1, T, true);
  assert.equal(X.fitWakeAt(m, null, T), m.until);
  const r = { endsAt: T + 1000, exercise: "x", set: 1, of: 3, over: false, overAt: 0 };
  assert.equal(X.fitWakeAt(m, r, T), T + 1000);
  assert.equal(X.fitWakeAt({ ...m, until: T - 1 }, null, T), null);
  assert.equal(X.fitWakeAt(null, { ...r, over: true, overAt: T - 100 }, T), T - 100 + X.REST_OVER_MS);
});
ok("both switches default on and turn off", () => {
  assert.equal(X.islandOn({}), true); assert.equal(X.islandOn(null), true); assert.equal(X.islandOn({ island: false }), false);
  assert.equal(X.islandSoundOn({}), true); assert.equal(X.islandSoundOn({ islandSound: false }), false);
});
ok("each moment has its own time and the hint ids are unique", () => {
  assert.ok(X.MOMENT_MS.added < X.MOMENT_MS.better && X.MOMENT_MS.better < X.MOMENT_MS.same);
  assert.notEqual(X.momentOfHint({ kind: "same", title: "", sub: "", daysAgo: 1 }, 1, T, true).id, X.momentOfNudge({ title: "", sub: "" }, 2, T, true).id);
});

// ---------- the figure ----------
ok("a figure only for an exercise in the list", () => {
  const f = F.figFor("leg-press", "Leg press")!;
  assert.ok(f, "leg press has a figure");
  assert.equal(f.a.length, 34); assert.equal(f.b.length, 34); assert.ok(f.hr > 1);
  assert.equal(F.figFor("not-in-the-list", "Mystery"), null);
  assert.equal(F.figFor(null, "Leg press"), null);
});
ok("the figure sits inside the 0 to 100 box and the two poses differ", () => {
  const f = F.figFor("barbell-bench-press", "Bench press")!;
  for (const v of [...f.a, ...f.b]) assert.ok(v >= 0 && v <= 100, `${v} in the box`);
  assert.notDeepEqual(f.a, f.b);
  assert.equal(F.FIG_POINTS.length * 2, f.a.length);
});

// ---------- wiring ----------
ok("the page wires the island: fit in the island state, the settings switches, the tick", () => {
  const read = (p: string) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
  assert.match(read("island.ts"), /fit: fitIslandPart\(now\)/);
  assert.match(read("fitness/FitSettings.tsx"), /Island in workouts/);
  assert.match(read("fitness/FitSettings.tsx"), /islandSound/);
  assert.match(read("fitness/Gym.tsx"), /fitIslandSetDone/);
  assert.match(read("fitness/fitisland.ts"), /onScanState/);
  assert.match(read("fitness/fitisland.ts"), /rest\.onChange/);
});
void KEY;
console.log(`${n} passed`);

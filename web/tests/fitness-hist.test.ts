// Run: node --experimental-strip-types tests/fitness-hist.test.ts
// PS Fitness History and Settings helpers (src/fitness/hist-logic.ts): dates, week groups, durations,
// thousands separators, the chart's scale, bests at the time, session lines, typed numbers. FICTIONAL data.
import assert from "node:assert/strict";
const H = await import("../src/fitness/hist-logic.ts");
type W = { id: string; data: import("../src/core/fitness.ts").FitWorkout };

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };

function w(id: string, date: string, sets: [number, number][], opts: { ex?: string; perSide?: boolean; end?: string | null } = {}): W {
  const startedAt = `${date}T15:00:00.000Z`;
  return { id, data: { programId: "p1", dayId: "d1", dayName: "Day 1", week: 1, date, startedAt, endedAt: opts.end === undefined ? `${date}T16:05:00.000Z` : opts.end, at: startedAt, exercises: [
    { id: `${id}-x`, exId: opts.ex ?? "bench", name: "Bench press", perSide: opts.perSide, at: startedAt, sets: sets.map(([kg, reps], i) => ({ id: `${id}-s${i}`, kg, reps, rir: 2, done: true, at: startedAt })) },
  ] } };
}

// ---------- words ----------
ok("dates read like Tue 28 Oct", () => {
  assert.equal(H.fmtDay("2026-10-27"), "Tue 27 Oct");
  assert.equal(H.fmtDay("2026-11-01"), "Sun 1 Nov");
  assert.equal(H.fmtDayShort("2026-10-12"), "12 Oct");
});
ok("thousands get commas", () => {
  assert.equal(H.fmtThousands(4320), "4,320");
  assert.equal(H.fmtThousands(1234567.4), "1,234,567");
  assert.equal(H.fmtThousands(999), "999");
  assert.equal(H.fmtThousands(0), "0");
  assert.equal(H.fmtVolume(12500), "12,500 kg");
});
ok("durations in minutes and hours", () => {
  assert.equal(H.fmtDuration("2026-10-27T15:00:00Z", "2026-10-27T15:48:00Z"), "48 min");
  assert.equal(H.fmtDuration("2026-10-27T15:00:00Z", "2026-10-27T16:05:00Z"), "1 h 5 min");
  assert.equal(H.fmtDuration("2026-10-27T15:00:00Z", "2026-10-27T17:00:00Z"), "2 h");
  assert.equal(H.fmtDuration("2026-10-27T15:00:00Z", "2026-10-27T15:00:10Z"), "1 min");
  assert.equal(H.fmtDuration("2026-10-27T15:00:00Z", null), "");
  assert.equal(H.fmtDuration("2026-10-27T15:00:00Z", "2026-10-27T14:00:00Z"), "");
});
ok("plural", () => {
  assert.equal(H.plural(1, "week"), "1 week");
  assert.equal(H.plural(4, "week"), "4 weeks");
  assert.equal(H.plural(0, "day"), "0 days");
});

// ---------- the week ----------
ok("week dots run Monday to Sunday with today and trained days marked", () => {
  const d = H.weekDots("2026-10-29", ["2026-10-27", "2026-10-29", "2026-10-20"]);   // Thursday
  assert.equal(d.length, 7);
  assert.equal(d[0].date, "2026-10-26");
  assert.equal(d[6].date, "2026-11-01");
  assert.deepEqual(d.map((x) => x.trained), [false, true, false, true, false, false, false]);
  assert.deepEqual(d.map((x) => x.today), [false, false, false, true, false, false, false]);
  assert.deepEqual(d.map((x) => x.future), [false, false, false, false, true, true, true]);
  assert.equal(d.map((x) => x.letter).join(""), "MTWTFSS");
});
ok("workouts group by week, newest first, with plain labels", () => {
  const list = [w("a", "2026-10-13", [[50, 10]]), w("b", "2026-10-28", [[50, 10]]), w("c", "2026-10-21", [[50, 10]]), w("d", "2026-10-26", [[50, 10]])];
  const g = H.groupByWeek(list, "2026-10-29");
  assert.deepEqual(g.map((x) => x.label), ["This week", "Last week", "Week of 12 Oct"]);
  assert.deepEqual(g[0].items.map((x) => x.id), ["b", "d"]);
  assert.deepEqual(g.map((x) => x.monday), ["2026-10-26", "2026-10-19", "2026-10-12"]);
  assert.deepEqual(H.groupByWeek([], "2026-10-29"), []);
});
ok("a Sunday belongs to the week that started the Monday before", () => {
  const g = H.groupByWeek([w("a", "2026-11-01", [[50, 10]])], "2026-10-27");
  assert.equal(g[0].label, "This week");
});

// ---------- bests at the time ----------
ok("an old best keeps its gold after a heavier day later", () => {
  const all = [w("w1", "2026-10-01", [[50, 10]]), w("w2", "2026-10-08", [[55, 8]]), w("w3", "2026-10-15", [[60, 6]])];
  assert.equal(H.bestCount(all[1], all), 1);
  assert.equal(H.bestCount(all[2], all), 1);
  assert.equal(H.bestCount(all[0], all), 0);   // the first time is never a best (nothing to beat)
});
ok("a lighter day is not a best", () => {
  const all = [w("w1", "2026-10-01", [[50, 10]]), w("w2", "2026-10-08", [[45, 8]])];
  assert.equal(H.bestCount(all[1], all), 0);
});
ok("best words", () => { assert.equal(H.BEST_WORDS.kg, "Heaviest yet"); });

// ---------- sessions ----------
ok("last sessions as plain lines, newest first, at most n", () => {
  const all = [1, 2, 3, 4, 5, 6].map((i) => w(`w${i}`, `2026-10-0${i}`, [[50 + i, 10], [52.5, 8]]));
  const s = H.sessionLines("id:bench", all, 5);
  assert.equal(s.length, 5);
  assert.equal(s[0].date, "2026-10-06");
  assert.equal(s[0].line, "56 x 10, 52.5 x 8");
  assert.equal(s[0].workoutId, "w6");
  assert.equal(H.sessionLines("id:squat", all).length, 0);
});
ok("dumbbells say each", () => {
  const s = H.sessionLines("id:curl", [w("w1", "2026-10-01", [[12, 10]], { ex: "curl", perSide: true })]);
  assert.equal(s[0].line, "12 each x 10");
});

// ---------- the chart ----------
ok("nice ticks cover the values in tidy steps", () => {
  assert.deepEqual(H.niceTicks(52, 68, 4), [50, 55, 60, 65, 70]);
  assert.deepEqual(H.niceTicks(0, 10, 4), [0, 2.5, 5, 7.5, 10]);
  const one = H.niceTicks(60, 60, 4);
  assert.ok(one[0] <= 60 && one[one.length - 1] >= 60 && one.length >= 2);
  assert.deepEqual(H.niceTicks(NaN, 1), []);
});
ok("chart scale: oldest left, newest right, higher is up, best marked", () => {
  const c = H.chartScale([50, 55, 52.5], 300, 200, { l: 30, r: 10, t: 10, b: 30 });
  assert.equal(c.points[0].x, 30);
  assert.equal(c.points[2].x, 290);
  assert.ok(c.points[1].y < c.points[0].y);
  assert.ok(c.points[1].y < c.points[2].y);
  assert.equal(c.best, 1);
  assert.ok(c.line.startsWith("M30 "));
  assert.ok(c.area.endsWith("Z"));
  for (const t of c.ticks) assert.ok(t.y >= 10 && t.y <= 170);
  assert.ok(c.lo <= 50 && c.hi >= 55);
});
ok("chart scale: equal values keep the newest as best; one value sits in the middle", () => {
  assert.equal(H.chartScale([50, 55, 55], 300, 200, { l: 0, r: 0, t: 0, b: 0 }).best, 2);
  const one = H.chartScale([60], 300, 200, { l: 0, r: 0, t: 0, b: 0 });
  assert.equal(one.points[0].x, 150);
  assert.equal(one.area, "");
  assert.equal(H.chartScale([], 300, 200, { l: 0, r: 0, t: 0, b: 0 }).best, -1);
});
ok("date labels: first, last and evenly between", () => {
  assert.deepEqual(H.labelIndexes(3, 5), [0, 1, 2]);
  assert.deepEqual(H.labelIndexes(9, 5), [0, 2, 4, 6, 8]);
  assert.deepEqual(H.labelIndexes(0), []);
  const l = H.labelIndexes(20, 5);
  assert.equal(l[0], 0); assert.equal(l[l.length - 1], 19); assert.equal(l.length, 5);
});
ok("sparkline needs two points", () => {
  assert.equal(H.sparkPath([50], 72, 28), "");
  assert.ok(H.sparkPath([50, 55], 72, 28).startsWith("M"));
});

// ---------- typed numbers ----------
ok("kg input takes a comma or a dot", () => {
  assert.equal(H.parseKgInput("22,5"), 22.5);
  assert.equal(H.parseKgInput(" 60 "), 60);
  assert.equal(H.parseKgInput(""), null);
  assert.equal(H.parseKgInput("abc"), undefined);
  assert.equal(H.parseKgInput("-5"), undefined);
});
ok("reps input takes whole numbers only", () => {
  assert.equal(H.parseRepsInput("8"), 8);
  assert.equal(H.parseRepsInput(""), null);
  assert.equal(H.parseRepsInput("8.5"), undefined);
  assert.equal(H.parseRepsInput("x"), undefined);
});

console.log(`\n${n} passed`);

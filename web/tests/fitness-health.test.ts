// Run: node --experimental-strip-types tests/fitness-health.test.ts
// PS Fitness Health history and export (V1.44, src/fitness/health-logic.ts): the day by day view, the month calendar,
// ranges, week and month summaries, new bests in a range, rest between sets, the sleep window chart, and the three
// exports (Copy for Claude, CSV per kind, one JSON). FICTIONAL data only.
import assert from "node:assert/strict";
const H = await import("../src/fitness/health-logic.ts");
const S = await import("../src/core/sleep.ts");
type W = import("../src/fitness/health-logic.ts").Dated;
type Data = import("../src/fitness/health-logic.ts").HealthData;
type L = import("../src/core/sleep.ts").SleepLog;

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const TB = "Asia/Dubai";

/** A workout on `date` at 15:00 UTC (19:00 Dubai): one exercise per entry, sets ticked 150 s apart. */
function work(id: string, date: string, exs: { name: string; ex?: string; sets: [number, number, number?][]; perSide?: boolean; warm?: boolean; note?: string }[], o: { note?: string; mins?: number; dayName?: string; week?: number } = {}): W {
  const startedAt = `${date}T15:00:00.000Z`;
  let t = Date.parse(startedAt) + 120_000;
  return { id, data: {
    programId: "p1", dayId: "d1", dayName: o.dayName ?? "Day 1", week: o.week ?? 1, date, startedAt,
    endedAt: new Date(Date.parse(startedAt) + (o.mins ?? 60) * 60000).toISOString(), at: startedAt, note: o.note ?? null,
    exercises: exs.map((e, i) => ({
      id: `${id}-x${i}`, exId: e.ex ?? null, name: e.name, perSide: e.perSide, at: startedAt, note: e.note ?? null,
      target: [{ reps: 10, kg: null }, { reps: 10, kg: null }, { reps: 8, kg: null }], rir: 2,
      sets: e.sets.map(([kg, reps, rir], j) => { t += 150_000; return { id: `${id}-x${i}-s${j}`, kg, reps, rir: rir ?? null, done: true, at: startedAt, doneAt: new Date(t).toISOString(), warm: !!e.warm && j === 0 }; }),
    })),
  } };
}
function sleep(day: string, asleep: string, wake: string, extra: Partial<L> = {}): { id: string; log: L } {
  const s = S.spanFromClock(day, asleep, wake, TB)!;
  return { id: `s-${day}`, log: { ...S.makeLog({ start: s.start, end: s.end, tz: TB }, new Date(`${day}T20:00:00Z`))!, ...extra } };
}
const run = (id: string, date: string, km: number, secs: number) => ({ id, data: { kind: "run" as const, date, km, secs, at: `${date}T10:00:00.000Z` } });

// A fictional two weeks: Mon 2 Nov 2026 to Sun 15 Nov 2026 (today is Wed 11 Nov).
const TODAY = "2026-11-11";
const data: Data = {
  tz: TB, target: 7 * 60, weekGoal: 3,
  workouts: [
    work("w1", "2026-11-02", [{ name: "Bench press", ex: "bench", sets: [[60, 10, 2], [60, 9, 1], [60, 8, 1]] }, { name: "Lateral raise", ex: "lat-raise", perSide: true, sets: [[8, 15, 2], [8, 14, 1]] }], { note: "Felt strong" }),
    work("w2", "2026-11-04", [{ name: "Bench press", ex: "bench", sets: [[62.5, 8, 1], [62.5, 8, 0]] }]),
    work("w3", "2026-11-09", [{ name: "Bench press", ex: "bench", sets: [[40, 10], [65, 6, 1]], warm: true, note: "seat on 4" }], { mins: 45, week: 2 }),
    work("w4", "2026-11-10", [{ name: "Smith machine", sets: [[50, 10, 2]] }], { week: 2, dayName: "Day 2" }),
  ],
  sleeps: [
    sleep("2026-11-02", "23:30", "07:00"),
    sleep("2026-11-03", "00:30", "06:00"),
    sleep("2026-11-09", "23:00", "07:30", { rested: 4 }),
    sleep("2026-11-10", "23:15", "07:15"),
    sleep("2026-11-11", "23:00", "06:45"),
  ],
  acts: [run("a1", "2026-11-05", 5, 1710)],
};

// ---------- calendar and ranges ----------
ok("month grid: November 2026 starts on a Sunday, so the first week has six empty cells", () => {
  const g = H.monthGrid("2026-11");
  assert.equal(g.length, 6);
  assert.deepEqual(g[0], [null, null, null, null, null, null, "2026-11-01"]);
  assert.equal(g[5][0], "2026-11-30");
  assert.equal(g[5][1], null);
  assert.equal(H.monthLabel("2026-11"), "November 2026");
  assert.equal(H.addMonth("2026-01", -1), "2025-12");
  assert.equal(H.lastOfMonth("2028-02"), "2028-02-29");
});
ok("ranges: this week from Monday, last month whole, everything from the first log", () => {
  assert.deepEqual(H.rangeFor("week", TODAY), { from: "2026-11-09", to: TODAY });
  assert.deepEqual(H.rangeFor("lastweek", TODAY), { from: "2026-11-02", to: "2026-11-08" });
  assert.deepEqual(H.rangeFor("month", TODAY), { from: "2026-11-01", to: TODAY });
  assert.deepEqual(H.rangeFor("lastmonth", TODAY), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(H.rangeFor("4w", TODAY), { from: "2026-10-15", to: TODAY });
  assert.deepEqual(H.rangeFor("all", TODAY, data), { from: "2026-11-02", to: TODAY });
  assert.deepEqual(H.rangeFor("all", TODAY, { ...data, workouts: [], sleeps: [], acts: [] }), { from: TODAY, to: TODAY });
  assert.equal(H.rangeWords("2026-11-02", "2026-11-08"), "2 Nov 2026 to 8 Nov 2026");
});

// ---------- one day ----------
ok("day by day: every date, with its sleep, workouts and run", () => {
  const days = H.healthDays(data, "2026-11-02", "2026-11-05");
  assert.equal(days.length, 4);
  assert.equal(days[0].date, "2026-11-02");
  assert.equal(days[0].mins, 450);
  assert.equal(days[0].asleep, "23:30");
  assert.equal(days[0].wake, "07:00");
  assert.ok(days[0].onTarget);
  assert.equal(days[0].sets, 5);
  assert.equal(days[0].volume, 60 * 27 + 8 * 29);
  assert.equal(days[1].mins, 330);
  assert.ok(!days[1].onTarget, "5 h 30 is under 7 h");
  assert.equal(days[1].workouts.length, 0);
  assert.ok(days[1].any);
  assert.equal(days[3].km, 5);
  assert.ok(!H.healthDays(data, "2026-11-06", "2026-11-06")[0].any);
});
ok("a workout with no ticked set is not a day trained", () => {
  const empty = work("w0", "2026-11-06", [{ name: "Bench press", sets: [] }]);
  const days = H.healthDays({ ...data, workouts: [...data.workouts, empty] }, "2026-11-06", "2026-11-06");
  assert.equal(days[0].workouts.length, 0);
});

// ---------- bests, rest ----------
ok("new bests in a range are judged against everything before, never the first time", () => {
  const all = H.newBests(data.workouts, "2026-11-01", "2026-11-30");
  assert.deepEqual(all.map((b) => [b.date, b.name, b.kind, b.kg, b.reps]), [["2026-11-04", "Bench press", "kg", 62.5, 8], ["2026-11-09", "Bench press", "kg", 65, 6]]);
  assert.deepEqual(H.newBests(data.workouts, "2026-11-09", "2026-11-15").map((b) => b.kg), [65], "earlier workouts still set the bar");
  assert.equal(H.newBests(data.workouts, "2026-11-02", "2026-11-02").length, 0, "the first time is not a best");
});
ok("rest between sets comes from when they were ticked; over 15 min is not a rest", () => {
  const ex = data.workouts[0].data.exercises[0];
  assert.deepEqual([...H.restBefore(ex).values()], [150, 150]);
  assert.equal(H.typicalRest(ex), 150);
  const long = { sets: [{ ...ex.sets[0], doneAt: "2026-11-02T15:00:00.000Z" }, { ...ex.sets[1], doneAt: "2026-11-02T15:20:00.000Z" }] };
  assert.equal(H.typicalRest(long), null);
});

// ---------- summaries ----------
ok("week summary: days trained, sets, volume, sleep average, nights on target, runs", () => {
  const s = H.summarize(data, "2026-11-02", "2026-11-08");
  assert.equal(s.days, 7);
  assert.equal(s.trained, 2);
  assert.equal(s.workouts, 2);
  assert.equal(s.sets, 7);
  assert.equal(s.volume, 60 * 27 + 8 * 29 + 62.5 * 16);
  assert.equal(s.nights, 2);
  assert.equal(s.onTarget, 1);
  assert.equal(s.avgSleep, Math.round((450 + 330) / 2));
  assert.equal(s.acts, 1);
  assert.equal(s.km, 5);
  assert.deepEqual(s.byKind.run, { n: 1, km: 5, secs: 1710 });
  assert.equal(s.trainMins, 120);
  assert.deepEqual(s.longest, { date: "2026-11-02", mins: 450 });
  assert.deepEqual(s.shortest, { date: "2026-11-03", mins: 330 });
});
ok("month summary: weeks Monday to Sunday, the longest runs, usual times", () => {
  const s = H.summarize(data, "2026-11-01", "2026-11-11");
  assert.deepEqual(s.weeks.map((w) => [w.monday, w.from, w.to, w.trained, w.nights]), [
    ["2026-10-26", "2026-11-01", "2026-11-01", 0, 0], ["2026-11-02", "2026-11-02", "2026-11-08", 2, 2], ["2026-11-09", "2026-11-09", "2026-11-11", 2, 3],
  ]);
  assert.equal(s.weeks[2].avgSleep, Math.round((510 + 480 + 465) / 3));
  assert.equal(s.trainRun, 2, "9 and 10 Nov");
  assert.equal(s.sleepRun, 3, "9, 10 and 11 Nov");
  assert.equal(s.usualAsleep, "23:15");
  assert.equal(s.usualWake, "07:00");
  assert.equal(s.bests.length, 2);
});
ok("streaks as of today: sleep nights on target, days trained in a row, weeks on goal", () => {
  const st = H.streaksNow(data, TODAY);
  assert.equal(st.sleep, 3);
  assert.equal(st.trainDays, 2, "yesterday and the day before (today not trained yet)");
  assert.equal(st.goalWeeks, 0);
  assert.equal(st.goal, 3);
});

// ---------- the sleep window chart ----------
ok("sleep window axis: a night sleeper's axis starts mid afternoon, a day sleeper's late evening", () => {
  assert.equal(H.sleepAxis(data.sleeps.map((s) => s.log)), 15 * 60);
  const day = [sleep("2026-11-08", "07:00", "15:00").log, sleep("2026-11-09", "07:30", "15:00").log];
  assert.equal(H.sleepAxis(day), 23 * 60);
  const bar = H.sleepBar(data.sleeps[0].log, 15 * 60);
  assert.deepEqual([bar.from, bar.to], [8.5 * 60, 8.5 * 60 + 450]);
  assert.deepEqual(H.axisLabels(15 * 60).map((x) => x.t), ["15:00", "21:00", "03:00", "09:00", "15:00"]);
  assert.equal(H.sleepAxis([]), 18 * 60);
});

// ---------- (a) Copy for Claude ----------
ok("Copy for Claude: the ask, units, summary, bests, weeks and every day with sets, RIR, rest, notes and sleep", () => {
  const t = H.claudeText(data, "2026-11-02", "2026-11-11");
  assert.match(t, /^My training and sleep log, 2 Nov 2026 to 11 Nov 2026 \(10 days\)\./);
  assert.match(t, /Please act as my personal trainer/);
  assert.match(t, /RIR is reps in reserve/);
  assert.match(t, /My sleep target is 7 h\./);
  assert.match(t, /- Trained 4 of 10 days \(4 workouts\), 9 working sets/);
  assert.match(t, /- Sleep: 5 of 10 nights logged/);
  assert.match(t, /- Other activity: 1 run \(5 km, 28:30\)\./);
  assert.match(t, /NEW PERSONAL BESTS\n- 4 Nov 2026: Bench press, 62\.5 kg x 8 \(heaviest yet\)/);
  assert.match(t, /EACH WEEK/);
  assert.match(t, /Mon 2 Nov 2026\n  Sleep: 23:30 to 07:00 \(Dubai time\), about 7 h 30 asleep, on target/);
  assert.match(t, /  Workout: Week 1, Day 1 \(19:00 to 20:00, 1 h\)/);
  assert.match(t, /    Bench press \(plan: 3 x 10, 10, 8 at RIR 2\): 60 kg x 10 \(RIR 2\), 60 kg x 9 \(RIR 1\), 60 kg x 8 \(RIR 1\)\. Rest about 2:30\./);
  assert.match(t, /Lateral raise \(plan: [^)]*\): 8 kg each side x 15 \(RIR 2\)/);
  assert.match(t, /    Note: Felt strong/);
  assert.match(t, /Tue 3 Nov 2026\n  Sleep: 00:30 to 06:00 \(Dubai time\), about 5 h 30 asleep, under my 7 h target\n  No gym workout/);
  assert.match(t, /  Run: 5 km in 28:30 \(5:42 \/km\)/);
  assert.match(t, /Fri 6 Nov 2026 to Sun 8 Nov 2026: nothing logged/);
  assert.match(t, /warm up 40 kg x 10, 65 kg x 6 \(RIR 1\)/);
  assert.match(t, /      Plan note: seat on 4/);
  assert.match(t, /Mon 9 Nov 2026\n  Sleep: [^\n]*felt rested 4 of 5/);
  assert.ok(!/[\u2013\u2014]/.test(t), "no long dashes");
});
ok("Copy for Claude can leave a kind out", () => {
  const t = H.claudeText(data, "2026-11-02", "2026-11-08", { fitness: false, sleep: true, acts: false });
  assert.ok(!/Workout:|RIR is|Trained|Run:/.test(t));
  assert.match(t, /Sleep: 23:30 to 07:00/);
  assert.match(t, /Wed 4 Nov 2026 to Sun 8 Nov 2026: nothing logged/);
});
ok("Copy for Claude for an empty range still reads plainly", () => {
  const t = H.claudeText({ ...data, workouts: [], sleeps: [], acts: [] }, "2026-11-02", "2026-11-03");
  assert.match(t, /Sleep: nothing logged in this range\./);
  assert.match(t, /Mon 2 Nov 2026 to Tue 3 Nov 2026: nothing logged/);
});

// ---------- (b) CSV ----------
ok("CSV cells: quotes, commas, new lines, and text a sheet would run as a formula", () => {
  assert.equal(H.csvCell('He said "go"'), '"He said ""go"""');
  assert.equal(H.csvCell("a,b"), '"a,b"');
  assert.equal(H.csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(H.csvCell("+1"), "'+1");
  assert.equal(H.csvCell(-20), "-20", "a number is never touched");
  assert.equal(H.csvCell(null), "");
  assert.equal(H.csvCell(true), "yes");
  assert.equal(H.toCsv([["a", 1], ["b", null]]), "a,1\r\nb,\r\n");
});
ok("sets CSV: one row per done set, with rest, warm up, per side and notes", () => {
  const rows = H.setsCsv(data, "2026-11-02", "2026-11-09").trim().split("\r\n");
  assert.equal(rows[0], "date,workout,started,ended,exercise,set,warm_up,kg,per_side,reps,rir,drop_set,rest_before_secs,planned,plan_note,workout_note");
  assert.equal(rows.length, 1 + 5 + 2 + 2);
  assert.equal(rows[1], '2026-11-02,"Week 1, Day 1",19:00,20:00,Bench press,1,no,60,no,10,2,no,,"3 x 10, 10, 8",,Felt strong');
  assert.equal(rows[2].split(",")[13], "150", "rest_before_secs (the quoted workout name holds one comma)");
  assert.match(rows[4], /Lateral raise,1,no,8,yes,15/);
  assert.match(rows[8], /Bench press,1,yes,40,no,10,,no,,"3 x 10, 10, 8",seat on 4,/);
});
ok("sleep CSV: one row per night, hours and minutes, on target", () => {
  const rows = H.sleepCsv(data, "2026-11-01", "2026-11-11").trim().split("\r\n");
  assert.equal(rows.length, 6);
  assert.equal(rows[0], "date_woke,fell_asleep,woke_up,time_zone,hours_asleep,minutes_asleep,minutes_awake_in_night,rested_1_to_5,on_target,logged_by");
  assert.equal(rows[1], "2026-11-02,23:30,07:00,Asia/Dubai,7.5,450,0,,yes,typed");
  assert.equal(rows[2], "2026-11-03,00:30,06:00,Asia/Dubai,5.5,330,0,,no,typed");
  assert.match(rows[3], /,4,yes,typed$/);
});
ok("activities CSV", () => {
  assert.equal(H.actsCsv(data, "2026-11-01", "2026-11-30"), "date,activity,km,time,seconds,pace\r\n2026-11-05,Run,5,28:30,1710,5:42 /km\r\n");
  assert.equal(H.actsCsv(data, "2026-11-06", "2026-11-30"), "date,activity,km,time,seconds,pace\r\n");
});

// ---------- (c) JSON ----------
ok("JSON: format, range, summary, only days with something, and the raw records in the backup's shape", () => {
  const j = H.healthJson(data, "2026-11-02", "2026-11-08", H.ALL, new Date("2026-11-11T12:00:00Z"));
  assert.equal(j.app, "PS");
  assert.equal(j.format, "ps-health");
  assert.equal(j.v, 1);
  assert.equal(j.exportedAt, "2026-11-11T12:00:00.000Z");
  assert.deepEqual(j.range, { from: "2026-11-02", to: "2026-11-08" });
  assert.equal(j.sleepTargetMins, 420);
  assert.deepEqual(j.days.map((d) => d.date), ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
  assert.equal(j.days[0].sleep!.minsAsleep, 450);
  assert.equal(j.days[0].workouts![0].exercises[0].sets[1].restBeforeSecs, 150);
  assert.equal(j.days[0].workouts![0].note, "Felt strong");
  assert.deepEqual(j.days[3].activities, [{ kind: "run", km: 5, secs: 1710, pace: "5:42 /km" }]);
  assert.deepEqual(j.records.map((r) => `${r.kind}:${r.id}`), ["fact:a1", "fsleep:s-2026-11-02", "fsleep:s-2026-11-03", "fwork:w1", "fwork:w2"]);
  for (const r of j.records) assert.deepEqual(Object.keys(r), ["id", "kind", "data"]);
  assert.equal(j.summary.weeks.length, 1);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(j)));
});
ok("JSON leaves a kind out completely when it is not picked", () => {
  const j = H.healthJson(data, "2026-11-02", "2026-11-08", { fitness: false, sleep: true, acts: false });
  assert.ok(j.records.every((r) => r.kind === "fsleep"));
  assert.ok(j.days.every((d) => !d.workouts && !d.activities));
  assert.equal(j.summary.bests.length, 0);
});

// ---------- small words ----------
ok("file names and counts", () => {
  assert.equal(H.exportName("sleep", "2026-11-02", "2026-11-08"), "PS sleep 2026-11-02 to 2026-11-08.csv");
  assert.equal(H.exportName("sets", "2026-11-02", "2026-11-02"), "PS workout sets 2026-11-02.csv");
  assert.equal(H.exportName("health", "2026-11-02", "2026-11-08"), "PS health 2026-11-02 to 2026-11-08.json");
  assert.equal(H.rangeCount(data, "2026-11-02", "2026-11-08"), "2 workouts, 2 nights, 1 run or walk");
  assert.equal(H.rangeCount(data, "2026-11-02", "2026-11-08", { fitness: true, sleep: false, acts: false }), "2 workouts");
  assert.equal(H.fmtDayLong("2026-11-09"), "Mon 9 Nov 2026");
});

console.log(`\n${n} checks passed`);

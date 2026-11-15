// Run: node --experimental-strip-types tests/workoutsummary.test.ts
// Workout summary on the Mac (core/workoutsummary.ts, PS 1.60): best set, up, same or down, days ago, total time, once per workout.
import { SUMMARY_MAX_ROWS, SUMMARY_WINDOW_MS, agoWords, bestLine, bestSet, daysBetween, gymMinutes, pendingSummary, summarize, summaryPrefs, trendOf, withShown } from "../src/core/workoutsummary.ts";
import { mergeWorkout, type FitLogEx, type FitSet, type FitWorkout } from "../src/core/fitness.ts";

let fails = 0, n = 0;
const ok = (name: string, c: boolean) => { n++; if (!c) { fails++; console.log(`FAIL ${name}`); } };
const set = (kg: number | null, reps: number | null, x: Partial<FitSet> = {}): FitSet => ({ id: Math.random().toString(36).slice(2), kg, reps, rir: null, done: true, at: "2026-11-14T10:00:00Z", ...x });
const ex = (name: string, sets: FitSet[], x: Partial<FitLogEx> = {}): FitLogEx => ({ id: "ex-" + name, exId: null, name, sets, at: "2026-11-14T10:00:00Z", ...x });
const wk = (date: string, exercises: FitLogEx[], x: Partial<FitWorkout> = {}): FitWorkout => ({ programId: null, dayId: null, dayName: "Day 1", week: 1, date, startedAt: date + "T09:00:00.000Z", endedAt: date + "T10:05:00.000Z", exercises, at: date + "T10:05:00.000Z", device: "phone", ...x });

ok("best set: heaviest, then most reps", bestSet([set(60, 10), set(80, 5), set(80, 6), set(70, 12)])?.reps === 6 && bestSet([set(60, 10), set(80, 5)])?.kg === 80);
ok("best set ignores warm up, drop, gone, undone and empty sets", bestSet([set(100, 5, { warm: true }), set(90, 5, { drop: true }), set(95, 5, { gone: true }), set(99, 5, { done: false }), set(null, 5), set(50, 0), set(40, 8)])?.kg === 40);
ok("no sets, no best", bestSet([]) === null);

ok("up: clearly stronger", trendOf(set(82.5, 8), set(80, 8)) === "up");
ok("down: clearly weaker", trendOf(set(77.5, 8), set(80, 8)) === "down");
ok("same: a rounding wobble", trendOf(set(80, 8), set(80, 8)) === "same" && trendOf(set(80.25, 8), set(80, 8)) === "same");
ok("more reps at the same weight is up", trendOf(set(80, 10), set(80, 8)) === "up");
ok("a heavier set with fewer reps is judged by estimated max", trendOf(set(90, 5), set(80, 8)) === "up" && trendOf(set(60, 5), set(80, 8)) === "down");
ok("no last time is new", trendOf(set(80, 8), null) === "new");
ok("light weights: half a kilo is the smallest step", trendOf(set(10, 10), set(9.9, 10)) === "same" && trendOf(set(12.5, 10), set(10, 10)) === "up");

ok("days between", daysBetween("2026-11-07", "2026-11-14") === 7 && daysBetween("2026-11-14", "2026-11-14") === 0 && daysBetween("2026-12-31", "2027-01-02") === 2);
ok("days between never goes negative and survives junk", daysBetween("2026-11-14", "2026-11-07") === 0 && daysBetween("x", "y") === 0);
ok("days across the clock change", daysBetween("2026-03-28", "2026-03-30") === 2 && daysBetween("2026-10-24", "2026-10-26") === 2);
ok("ago words", agoWords(0) === "today" && agoWords(1) === "yesterday" && agoWords(6) === "6 days ago");

ok("gym minutes", gymMinutes({ startedAt: "2026-11-14T09:00:00Z", endedAt: "2026-11-14T10:05:00Z" }) === 65);
ok("gym minutes: under a minute is 1, no end is 0, backwards is 0", gymMinutes({ startedAt: "2026-11-14T09:00:00Z", endedAt: "2026-11-14T09:00:20Z" }) === 1 && gymMinutes({ startedAt: "2026-11-14T09:00:00Z", endedAt: null }) === 0 && gymMinutes({ startedAt: "2026-11-14T10:00:00Z", endedAt: "2026-11-14T09:00:00Z" }) === 0);

const past = { id: "w-old", data: wk("2026-11-07", [ex("Bench", [set(80, 8), set(75, 8)]), ex("Squat", [set(100, 5)])]) };
const now = { id: "w-now", data: wk("2026-11-14", [
  ex("Bench", [set(82.5, 8, { rir: 2, comment: "left knee felt off" }), set(80, 8, { rir: 1 }), set(60, 12, { warm: true })]),
  ex("Squat", [set(95, 5, { rir: 3 })]),
  ex("Curl", [set(20, 12)]),
  ex("Removed", [set(5, 5)], { removed: true }),
  ex("Nothing", [set(50, 8, { done: false })]),
]) };
const all = [now, past];
const s = summarize("w-now", now.data, all)!;
ok("one row per exercise that was done", s.rows.map((r) => r.name).join() === "Bench,Squat,Curl");
ok("sets count working sets only", s.rows[0].sets === 2 && s.sets === 4);
ok("best weight and reps", s.rows[0].bestKg === 82.5 && s.rows[0].bestReps === 8 && bestLine(s.rows[0]) === "82.5 kg x 8");
ok("RIR of the best set", s.rows[0].rir === "2" && s.rows[2].rir === null);
ok("set comments come through", s.rows[0].comment === "left knee felt off" && s.rows[1].comment === null);
ok("up, down and new against the last time", s.rows[0].trend === "up" && s.rows[1].trend === "down" && s.rows[2].trend === "new");
ok("days ago comes from the last time's date", s.rows[0].daysAgo === 7 && s.rows[2].daysAgo === null);
ok("total time", s.minutes === 65);
ok("the last time never means this same workout", summarize("w-now", now.data, [now]) !== null && summarize("w-now", now.data, [now])!.rows[0].trend === "new");
ok("a workout with no done sets has no summary", summarize("x", wk("2026-11-14", [ex("A", [set(50, 8, { done: false })])]), []) === null);
ok("a long workout lists six and counts the rest", (() => { const w = wk("2026-11-14", Array.from({ length: 9 }, (_, i) => ex("E" + i, [set(50, 8)]))); const r = summarize("x", w, [])!; return r.rows.length === SUMMARY_MAX_ROWS && r.more === 3; })());
ok("a long comment is cut", (() => { const r = summarize("x", wk("2026-11-14", [ex("A", [set(50, 8, { comment: "y".repeat(300) })])]), [])!; return (r.rows[0].comment || "").length === 80; })());
ok("RIR 4 reads 4+", summarize("x", wk("2026-11-14", [ex("A", [set(50, 8, { rir: 4 })])]), [])!.rows[0].rir === "4+");
ok("the lowest RIR is used when the best set has none", summarize("x", wk("2026-11-14", [ex("A", [set(50, 8), set(40, 8, { rir: 3 }), set(40, 8, { rir: 1 })])]), [])!.rows[0].rir === "1");

const T = Date.parse("2026-11-14T11:00:00Z");
const on = summaryPrefs(undefined);
ok("switch: on unless set to false", on.on && !summaryPrefs({ on: false }).on && summaryPrefs({ on: "no" }).on);
ok("pending: the workout finished on the phone", pendingSummary(all, T, on)?.id === "w-now");
ok("pending: nothing when the switch is off", pendingSummary(all, T, { on: false }) === null);
ok("pending: a Mac or web workout is not announced", pendingSummary([{ id: "m", data: wk("2026-11-14", now.data.exercises, { device: "mac" }) }], T, on) === null && pendingSummary([{ id: "m", data: wk("2026-11-14", now.data.exercises, { device: "web" }) }], T, on) === null);
ok("pending: a workout still going has no summary", pendingSummary([{ id: "m", data: wk("2026-11-14", now.data.exercises, { endedAt: null }) }], T, on) === null);
ok("pending: too old (over 12 hours) is never shown", pendingSummary(all, Date.parse("2026-11-14T10:05:00Z") + SUMMARY_WINDOW_MS + 1000, on) === null);
ok("pending: just inside the window is shown", pendingSummary(all, Date.parse("2026-11-14T10:05:00Z") + SUMMARY_WINDOW_MS - 1000, on) !== null);
ok("pending: an end time in the future (clock off) is not shown", pendingSummary(all, Date.parse("2026-11-14T09:00:00Z"), on) === null);
ok("pending: the newest finished one wins", (() => { const a = { id: "a", data: wk("2026-11-14", [ex("A", [set(50, 8)])], { endedAt: "2026-11-14T08:00:00Z", startedAt: "2026-11-14T07:00:00Z" }) }; return pendingSummary([a, now], T, on)?.id === "w-now"; })());

// once per workout, across Macs
const marked = { ...now, data: withShown(now.data, "2026-11-14T10:30:00.000Z") };
ok("shown: the mark is set once and never moves", withShown(marked.data, "2026-11-14T12:00:00.000Z").macShown === "2026-11-14T10:30:00.000Z");
ok("shown: a marked workout is never pending again", pendingSummary([marked, past], T, on) === null);
ok("shown: the next older unmarked one is not announced either (window and phone rules)", pendingSummary([marked, { id: "p2", data: wk("2026-11-13", [ex("A", [set(50, 8)])], { endedAt: "2026-11-13T09:00:00Z" }) }], T, on) === null);
// Mac A marks it, Mac B (which had not synced yet) writes its own copy later: the merge keeps the mark
const b = { ...now.data, at: "2026-11-14T10:40:00.000Z" };
ok("merge: a newer copy without the mark keeps the mark of the other", mergeWorkout(marked.data, b).macShown === "2026-11-14T10:30:00.000Z" && mergeWorkout(b, marked.data).macShown === "2026-11-14T10:30:00.000Z");
ok("merge: two marks keep the earliest", mergeWorkout({ ...now.data, macShown: "2026-11-14T10:50:00.000Z" }, { ...now.data, macShown: "2026-11-14T10:31:00.000Z" }).macShown === "2026-11-14T10:31:00.000Z");
ok("merge: no mark stays no mark (no stray key)", !("macShown" in mergeWorkout(now.data, { ...now.data })));

if (fails) { console.log(`${fails} of ${n} failed`); process.exit(1); }
console.log(`ok, ${n} checks`);

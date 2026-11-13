// The trainer's sheet (src/fitness/sheet.ts): messy cells read into a plan, and a logged week written back.
import assert from "node:assert/strict";
import {
  exportWeekRows, importTrainerSheet, importTrainerText, parseDelimited, parseRest, parseRir, parseSetsReps,
  parseTrainerSheet, parseWeight, rowsToCsv, rowsToTsv,
} from "../src/fitness/sheet.ts";
import type { LoggedWeek } from "../src/fitness/types.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const reps = (s: string) => parseSetsReps(s).sets.map((x) => (x.repsMax ? `${x.reps}-${x.repsMax}` : x.amrap ? "amrap" : x.seconds ? `${x.seconds}s` : x.reps ?? "?"));
const blank = () => ["", "", "", "", ""];
const row = (...c: string[]) => ["", ...c, ...Array(4 - c.length).fill("")];

// The real "Current split" template (31 Oct 2026): column A empty, DAY blocks in B to E.
const TEMPLATE: string[][] = [
  blank(), blank(),
  row("DAY 1", "DAY 1", "DAY 1", "DAY 1"), row("Exercise", "Sets and Reps", "Weight", "RIR"),
  blank(), blank(), blank(), blank(), blank(),
  row("e.g. Overhead dumbbell press ", "e.g.: 3 sets x 12, 10, 10", "e.g.: 20kg each side", "rir 2"),
  blank(), blank(),
  row("DAY 2", "DAY 2", "DAY 2", "DAY 2"), row("Exercise", "Sets and Reps", "Weight", "RIR"),
  blank(), blank(), blank(), blank(), blank(), blank(), blank(), blank(),
  row("DAY 3", "DAY 3", "DAY 3", "DAY 3"), row("Exercise", "Sets and Reps", "Weight", "RIR"),
  blank(), blank(), blank(), blank(), blank(), blank(), blank(),
  row("DAY 4", "DAY 4", "DAY 4", "DAY 4"), row("Exercise", "Sets and Reps", "Weight", "RIR"),
];

ok("sets and reps: the usual shapes", () => {
  assert.deepEqual(reps("3x10"), [10, 10, 10]);
  assert.deepEqual(reps("3 sets x 12, 10, 10"), [12, 10, 10]);
  assert.deepEqual(reps("4 x 8-10"), ["8-10", "8-10", "8-10", "8-10"]);
  assert.deepEqual(reps("4 x 8\u201310"), ["8-10", "8-10", "8-10", "8-10"], "a pasted dash reads as a range");
  assert.deepEqual(reps("3 sets of 12"), [12, 12, 12]);
  assert.deepEqual(reps("3 × 15"), [15, 15, 15]);
  assert.deepEqual(reps("e.g.: 3 sets x 12, 10, 10"), [12, 10, 10]);
  assert.deepEqual(reps("12/10/8"), [12, 10, 8]);
  assert.deepEqual(reps("3 x 10 reps"), [10, 10, 10]);
  assert.deepEqual(reps("3 x 8 to 12"), ["8-12", "8-12", "8-12"]);
});
ok("sets and reps: timed, AMRAP, each side, extra sets", () => {
  assert.deepEqual(reps("3 x 30s"), ["30s", "30s", "30s"]);
  assert.deepEqual(reps("3 x 1 min"), ["60s", "60s", "60s"]);
  assert.deepEqual(reps("3x10 + 1 x amrap"), [10, 10, 10, "amrap"]);
  const s = parseSetsReps("3 x 10 each leg");
  assert.equal(s.eachSide, true);
  assert.deepEqual(reps("3 x 10 each leg"), [10, 10, 10]);
  assert.equal(parseSetsReps("3 x 12 per arm").eachSide, true);
});
ok("sets and reps: odd cases are read and noted, not dropped", () => {
  const short = parseSetsReps("4 sets x 12, 10");
  assert.deepEqual(short.sets.map((x) => x.reps), [12, 10, 10, 10]);
  assert.match(short.note!, /4 sets but 2/);
  const swapped = parseSetsReps("12x3");
  assert.deepEqual(swapped.sets.map((x) => x.reps), [12, 12, 12]);
  assert.match(swapped.note!, /read as 3 sets of 12/);
  assert.equal(parseSetsReps("3 sets").sets.length, 3);
  assert.equal(parseSetsReps("2-3 x 10").sets.length, 3);
  assert.match(parseSetsReps("10").note!, /set count missing/);
  const bad = parseSetsReps("see video");
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.sets, []);
  assert.equal(parseSetsReps("").ok, false);
});
ok("weight: kg, each side, bodyweight, ranges, lists, lb", () => {
  assert.deepEqual([parseWeight("20kg each side").kg, parseWeight("20kg each side").perSide], [20, true]);
  assert.equal(parseWeight("e.g.: 20kg each side").kg, 20);
  assert.deepEqual([parseWeight("60 kg").kg, parseWeight("60 kg").perSide], [60, null]);
  assert.equal(parseWeight("22,5kg").kg, 22.5);
  assert.equal(parseWeight("17.5 kgs per hand").perSide, true);
  assert.equal(parseWeight("2 x 16kg").kg, 16);
  assert.equal(parseWeight("2 x 16kg").perSide, true);
  assert.equal(parseWeight("40kg total").perSide, false);
  const bw = parseWeight("bodyweight");
  assert.deepEqual([bw.bodyweight, bw.kg, bw.note], [true, undefined, undefined]);
  assert.equal(parseWeight("BW + 10kg").kg, 10);
  assert.deepEqual([parseWeight("assisted 20kg").kg, parseWeight("assisted 20kg").bodyweight], [-20, true]);
  assert.equal(parseWeight("bw - 15kg").kg, -15);
  assert.equal(parseWeight("bodyweight, assisted 20kg").kg, -20);
  const r = parseWeight("20-25kg");
  assert.deepEqual([r.kg, r.kgMax], [20, 25]);
  assert.deepEqual(parseWeight("20, 22.5, 25kg").perSet, [20, 22.5, 25]);
  const lb = parseWeight("45 lbs");
  assert.deepEqual([lb.kg, lb.fromLb], [20.4, true]);
});
ok("weight: words a machine or a trainer uses become a note", () => {
  const lvl = parseWeight("level 8");
  assert.deepEqual([lvl.kg, lvl.note], [undefined, "level 8"]);
  assert.equal(parseWeight("light").note, "light");
  assert.equal(parseWeight("").kg, undefined);
});
ok("RIR: single, range, RPE, failure, per set", () => {
  assert.deepEqual(parseRir("rir 2"), { min: 2, max: 2, raw: "rir 2" });
  const r = parseRir("rir 1-2")!;
  assert.deepEqual([r.min, r.max], [1, 2]);
  assert.equal(parseRir("RIR 1\u20132")!.min, 1);
  assert.equal(parseRir("2")!.min, 2);
  assert.deepEqual([parseRir("rpe 8")!.min, parseRir("rpe 8")!.fromRpe], [2, true]);
  const rpe = parseRir("RPE 7-8")!;
  assert.deepEqual([rpe.min, rpe.max], [2, 3]);
  assert.equal(parseRir("to failure")!.max, 0);
  assert.deepEqual(parseRir("2, 1, 0")!.perSet, [2, 1, 0]);
  assert.equal(parseRir(""), null);
  assert.equal(parseRir("easy"), null);
  assert.equal(parseRir("rir 15"), null);
});
ok("rest cells", () => {
  assert.equal(parseRest("90s"), 90);
  assert.equal(parseRest("2 min"), 120);
  assert.equal(parseRest("1:30"), 90);
  assert.equal(parseRest("2-3 mins"), 120);
  assert.equal(parseRest("3"), 180);
  assert.equal(parseRest("120"), 120);
  assert.equal(parseRest(""), null);
});
ok("the real template: four empty days, the e.g. row skipped", () => {
  const p = parseTrainerSheet(TEMPLATE);
  assert.deepEqual(p.days.map((d) => [d.index, d.title, d.exercises.length]), [[1, "Day 1", 0], [2, "Day 2", 0], [3, "Day 3", 0], [4, "Day 4", 0]]);
  assert.deepEqual(p.warnings, []);
});
ok("the template's example row, kept on request, reads in full", () => {
  const ex = importTrainerSheet(TEMPLATE, { keepExamples: true }).days[0].exercises[0];
  assert.equal(ex.name, "Overhead dumbbell press");
  assert.equal(ex.exerciseId, "standing-dumbbell-overhead-press");
  assert.deepEqual(ex.sets, [
    { reps: 12, kg: 20, rirMin: 2, rirMax: 2 }, { reps: 10, kg: 20, rirMin: 2, rirMax: 2 }, { reps: 10, kg: 20, rirMin: 2, rirMax: 2 },
  ]);
  assert.equal(ex.perSide, true);
  assert.equal(ex.restSec, 120);
  assert.equal(ex.row, 9);
});
ok("a filled in week: messy rows, rough names, warnings for what needs a look", () => {
  const rows = TEMPLATE.map((r) => [...r]);
  rows[4] = row("Bench press", "4 x 8-10", "60kg", "rir 1-2");
  rows[5] = row("Incline DB press", "3x10", "22,5kg", "2");
  rows[6] = row("Pec dec", "3 sets x 15, 12, 12", "level 8", "");
  rows[7] = row("", "3x10", "", "");
  rows[8] = row("Mystery move", "3x10", "light", "rir 2");
  rows[14] = row("A1. Lat pull-downs", "3 x 12", "50 kg", "RPE 8");
  rows[15] = row("A2. Face pulls", "3x15", "20kg", "rir 2-3");
  rows[16] = row("Pull ups", "3 x AMRAP", "bodyweight", "to failure");
  rows[24] = row("Squats", "5 x 5", "80kg", "rir 2");
  rows[25] = row("Bulgarian split squats", "3 x 10 each leg", "12kg each hand", "rir 1");
  rows[26] = row("Plank", "3 x 45s", "bodyweight", "");
  const p = importTrainerSheet(rows);
  const [d1, d2, d3, d4] = p.days;
  assert.deepEqual(d1.exercises.map((e) => e.exerciseId), ["barbell-bench-press", "incline-dumbbell-press", "pec-deck", null]);
  const bench = d1.exercises[0];
  assert.deepEqual(bench.sets[0], { reps: 8, repsMax: 10, kg: 60, rirMin: 1, rirMax: 2 });
  assert.equal(bench.restSec, 180);
  assert.equal(bench.perSide, false);
  assert.equal(d1.exercises[1].sets[0].kg, 22.5);
  assert.equal(d1.exercises[1].perSide, true, "dumbbells default to each side");
  assert.equal(d1.exercises[2].note, "level 8");
  assert.equal(d1.exercises[2].rir, null);
  assert.equal(d1.exercises[3].note, "light");
  assert.deepEqual([d2.exercises[0].superset, d2.exercises[1].superset], ["A", "A"]);
  assert.equal(d2.exercises[0].name, "Lat pull-downs");
  assert.equal(d2.exercises[0].sets[0].rirMin, 2);
  assert.deepEqual(d2.exercises[2].sets.map((s) => s.amrap), [true, true, true]);
  assert.equal(d2.exercises[2].weight.bodyweight, true);
  assert.equal(d3.exercises[0].exerciseId, "back-squat");
  assert.equal(d3.exercises[1].eachSide, true);
  assert.equal(d3.exercises[1].sets[0].kg, 12);
  assert.equal(d3.exercises[2].sets[0].seconds, 45);
  assert.equal(d4.exercises.length, 0);
  assert.ok(p.warnings.some((w) => /Day 1, row 8: values but no exercise name/.test(w)), p.warnings.join("\n"));
  assert.ok(p.warnings.some((w) => /no library match for "Mystery move"/.test(w)));
  assert.equal(p.warnings.length, 2, p.warnings.join("\n"));
});
ok("no DAY headings: the whole sheet is Day 1, header still found", () => {
  const p = importTrainerSheet([["Exercise", "Sets", "Weight", "RIR"], ["Leg press", "3x12", "100kg", "2"], ["Leg extension", "3x15", "40", "1"]]);
  assert.equal(p.days.length, 1);
  assert.deepEqual(p.days[0].exercises.map((e) => e.exerciseId), ["leg-press", "leg-extension"]);
  assert.match(p.warnings[0], /No DAY headings/);
});
ok("days side by side, named days, extra columns found by their header", () => {
  const p = importTrainerSheet([
    ["DAY 1: Push", "", "", "", "", "DAY 2 - Pull", "", "", "", ""],
    ["Exercise", "Sets and Reps", "Weight", "RIR", "Rest", "Exercise", "Sets and Reps", "Weight", "RIR", "Notes"],
    ["Bench press", "3x8", "60kg", "2", "3 min", "Barbell row", "3x10", "50kg", "2", "pause at the top"],
    [1, "", "", "", "", "Hammer curls", "3 x 12", 12, "1", ""],
  ]);
  assert.deepEqual(p.days.map((d) => d.title), ["Push", "Pull"]);
  assert.equal(p.days[0].exercises[0].restSec, 180);
  assert.equal(p.days[1].exercises[0].note, "pause at the top");
  assert.equal(p.days[1].exercises[1].sets[0].kg, 12, "a number cell from the Sheets API reads fine");
  assert.ok(p.warnings.some((w) => /Day 1, row 4: values but no exercise name|no library match for "1"/.test(w)), p.warnings.join("\n"));
});
ok("CSV and a Google Sheets paste (tabs) read the same", () => {
  const csv = 'DAY 1,,,\nExercise,Sets and Reps,Weight,RIR\n"Overhead dumbbell press","3 sets x 12, 10, 10",20kg each side,rir 2\n';
  const tsv = "DAY 1\t\t\t\nExercise\tSets and Reps\tWeight\tRIR\nOverhead dumbbell press\t3 sets x 12, 10, 10\t20kg each side\trir 2\n";
  assert.deepEqual(parseDelimited('a,"b ""c"", d"\r\n1,2'), [["a", 'b "c", d'], ["1", "2"]]);
  const a = importTrainerText(csv).days[0].exercises[0];
  const b = importTrainerText(tsv).days[0].exercises[0];
  assert.deepEqual(a.sets.map((s) => s.reps), [12, 10, 10]);
  assert.deepEqual(a.sets, b.sets);
});

const WEEK: LoggedWeek = {
  days: [
    {
      index: 1, title: "Push", date: "2026-11-02", exercises: [
        { name: "Overhead dumbbell press", exerciseId: "standing-dumbbell-overhead-press", sets: [
          { kg: 10, reps: 15, warmup: true }, { kg: 20, reps: 12, rir: 2 }, { kg: 20, reps: 10, rir: 2 }, { kg: 20, reps: 10, rir: 1 },
        ] },
        { name: "Bench press", sets: [{ kg: 60, reps: 8, rir: 2 }, { kg: 62.5, reps: 8, rir: 1 }, { kg: 62.5, reps: 7, rir: 0 }] },
        { name: "Pull ups", sets: [{ reps: 8, rir: 1 }, { reps: 6, rir: 0 }] },
        { name: "Assisted pull up", sets: [{ kg: -20, reps: 10, rir: 2 }, { kg: -20, reps: 9, rir: 1 }] },
        { name: "Plank", sets: [{ seconds: 45 }, { seconds: 40 }] },
        { name: "Cable fly", sets: [] },
      ],
    },
    { index: 2, exercises: [{ name: "Bulgarian split squat", eachSide: true, sets: [{ kg: 12, reps: 10, rir: 5 }, { kg: 12, reps: 10, rir: 4 }] }] },
  ],
};

ok("export: the trainer's layout, actual sets, weights and RIR", () => {
  const rows = exportWeekRows(WEEK);
  assert.deepEqual(rows, [
    blank(), blank(),
    row("DAY 1: Push"), row("Exercise", "Sets and Reps", "Weight", "RIR"),
    row("Overhead dumbbell press", "3 sets x 12, 10, 10", "20kg each side", "rir 2, 2, 1"),
    row("Bench press", "3 sets x 8, 8, 7", "60, 62.5, 62.5kg", "rir 2, 1, 0"),
    row("Pull ups", "2 sets x 8, 6", "bodyweight", "rir 1, 0"),
    row("Assisted pull up", "2 sets x 10, 9", "assisted 20kg", "rir 2, 1"),
    row("Plank", "2 sets x 45s, 40s", "bodyweight", ""),
    row("Cable fly", "not done", "", ""),
    blank(),
    row("DAY 2"), row("Exercise", "Sets and Reps", "Weight", "RIR"),
    row("Bulgarian split squat", "2 sets x 10 each side", "12kg each side", "rir 4+"),
  ]);
});
ok("export options: title, dates, warm ups, the days list on its own", () => {
  const rows = exportWeekRows(WEEK.days, { title: "Week 1", dates: true, warmups: true, gap: 2 });
  assert.deepEqual(rows[1], row("Week 1"));
  assert.deepEqual(rows[3], row("DAY 1: Push", "2026-11-02"));
  assert.equal(rows[5][2], "4 sets x 15, 12, 10, 10");
  assert.equal(rows[5][3], "10, 20, 20, 20kg each side");
  assert.equal(rows.filter((r) => r.every((c) => !c)).length, 4);
});
ok("export reads back through the importer to the same sets", () => {
  const p = importTrainerSheet(exportWeekRows(WEEK));
  const ohp = p.days[0].exercises[0];
  assert.deepEqual(ohp.sets.map((s) => [s.reps, s.kg, s.rirMin]), [[12, 20, 2], [10, 20, 2], [10, 20, 1]]);
  assert.deepEqual(p.days[0].exercises[1].sets.map((s) => s.kg), [60, 62.5, 62.5]);
  assert.equal(p.days[1].exercises[0].eachSide, true);
  assert.equal(p.days[0].title, "Push");
});
ok("CSV quoting, TSV for pasting, and no formula injection", () => {
  const rows = [["", "Bench, paused", 'say "hi"', "=SUM(A1)", "+1"], ["", "a\tb", "line\nbreak", "@x", "-5"]];
  assert.equal(rowsToCsv(rows), ',"Bench, paused","say ""hi""",\'=SUM(A1),\'+1\n,a\tb,"line\nbreak",\'@x,-5\n');
  assert.equal(rowsToTsv(rows), "\tBench, paused\tsay \"hi\"\t'=SUM(A1)\t'+1\n\ta b\tline break\t'@x\t-5\n");
  const csv = rowsToCsv(exportWeekRows(WEEK));
  assert.ok(!/[\u2013\u2014]/.test(csv));
  assert.deepEqual(parseDelimited(csv), exportWeekRows(WEEK), "CSV reads back to the same grid");
});

console.log(`\n${n} passed`);

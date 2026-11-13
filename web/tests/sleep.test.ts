// Run: node --experimental-strip-types tests/sleep.test.ts
// PS Fitness Sleep (V1.40, src/core/sleep.ts): the across midnight maths, day sleepers, clock changes, the streak,
// the week, steadiness, the once a day question, the private notes and the G Squad summary. FICTIONAL data.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const S = await import("../src/core/sleep.ts");
type L = import("../src/core/sleep.ts").SleepLog;

let n = 0;
const ok = (name: string, fn: () => unknown) => { fn(); n++; console.log("ok -", name); };
const TB = "Asia/Dubai", LDN = "Europe/London", NY = "America/New_York";

/** A sleep typed on the log card: woke on `day` at `wake`, fell asleep at `asleep`. */
function log(day: string, asleep: string, wake: string, tz = TB, extra: Partial<L> = {}): L {
  const s = S.spanFromClock(day, asleep, wake, tz);
  assert.ok(s, `${day} ${asleep}-${wake} is a sleep`);
  return { ...S.makeLog({ start: s.start, end: s.end, tz }, new Date(`${day}T20:00:00Z`))!, ...extra };
}
const days = (...ls: L[]) => S.byDay(ls);

// ---------- across midnight and day sleep ----------
ok("23:30 to 07:00 crosses midnight: 7 h 30, belongs to the wake date", () => {
  const s = S.spanFromClock("2026-11-08", "23:30", "07:00", TB)!;
  assert.equal(s.mins, 450);
  assert.equal(new Date(s.start).toISOString(), "2026-11-07T19:30:00.000Z");   // 23:30 Dubai (UTC+4) on the 7th
  assert.equal(new Date(s.end).toISOString(), "2026-11-08T03:00:00.000Z");
  assert.equal(log("2026-11-08", "23:30", "07:00").day, "2026-11-08");
});
ok("a day sleep (07:10 to 14:40) is a normal night on that date", () => {
  const l = log("2026-11-08", "07:10", "14:40");
  assert.equal(S.sleepMins(l), 450);
  assert.equal(l.day, "2026-11-08");
  assert.deepEqual(S.clocksOf(l), { asleep: "07:10", wake: "14:40" });
});
ok("00:30 to 08:00 is the same date, 7 h 30", () => assert.equal(S.spanFromClock("2026-11-08", "00:30", "08:00", TB)!.mins, 450));
ok("asleep at 18:00, up at 02:00 (a night shift worker's evening sleep): 8 h, the wake date", () => {
  const l = log("2026-11-09", "18:00", "02:00");
  assert.equal(S.sleepMins(l), 480);
  assert.equal(l.day, "2026-11-09");
});
ok("midnight exactly to 07:00, and 22:00 to midnight", () => {
  assert.equal(S.spanFromClock("2026-11-08", "00:00", "07:00", TB)!.mins, 420);
  assert.equal(S.spanFromClock("2026-11-08", "22:00", "00:00", TB)!.mins, 120);
});
ok("the same time twice, bad times or a bad date are not a sleep", () => {
  assert.equal(S.spanFromClock("2026-11-08", "07:00", "07:00", TB), null);   // 24 h: over the 20 h limit
  assert.equal(S.spanFromClock("2026-11-08", "25:00", "07:00", TB), null);
  assert.equal(S.spanFromClock("2026-11-08", "7:00", "07:00", TB), null);
  assert.equal(S.spanFromClock("8 Nov", "23:00", "07:00", TB), null);
});
ok("over 20 h is refused, 20 h is the most", () => {
  assert.equal(S.spanFromClock("2026-11-08", "10:00", "06:00", TB)!.mins, 1200);
  assert.equal(S.spanFromClock("2026-11-08", "09:59", "06:00", TB), null);
});
ok("month and year ends: 23:00 on 31 Dec to 07:00 on 1 Jan", () => {
  const s = S.spanFromClock("2027-01-01", "23:00", "07:00", LDN)!;
  assert.equal(s.mins, 480);
  assert.equal(new Date(s.start).toISOString(), "2026-12-31T23:00:00.000Z");
});
ok("clocks go back in London (25 Oct 2026): 23:00 to 07:00 is really 9 h", () => {
  assert.equal(S.spanFromClock("2026-10-25", "23:00", "07:00", LDN)!.mins, 540);
});
ok("clocks go forward in New York (14 Mar 2027): 23:00 to 07:00 is really 7 h", () => {
  assert.equal(S.spanFromClock("2027-03-14", "23:00", "07:00", NY)!.mins, 420);
});
ok("the wake date is the date in the zone typed in, not UTC", () => {
  // 01:30 Dubai on the 9th is still the 8th in UTC
  const s = S.spanFromClock("2026-11-09", "18:00", "01:30", TB)!;
  assert.equal(new Date(s.end).toISOString().slice(0, 10), "2026-11-08");
  assert.equal(S.makeLog({ start: s.start, end: s.end, tz: TB })!.day, "2026-11-09");
});

// ---------- hours by hand, rested, cleaning ----------
ok("hours set by hand win (lay awake), and equal hours are not kept twice", () => {
  const s = S.spanFromClock("2026-11-08", "23:00", "07:00", TB)!;
  const a = S.makeLog({ ...s, tz: TB, mins: 420 })!;
  assert.equal(a.mins, 420);
  assert.equal(S.sleepMins(a), 420);
  const b = S.makeLog({ ...s, tz: TB, mins: 480 })!;
  assert.equal(b.mins, null);
  assert.equal(S.sleepMins(b), 480);
});
ok("rested is 1 to 5 or nothing", () => {
  const s = S.spanFromClock("2026-11-08", "23:00", "07:00", TB)!;
  assert.equal(S.makeLog({ ...s, tz: TB, rested: 4 })!.rested, 4);
  assert.equal(S.makeLog({ ...s, tz: TB, rested: 0 })!.rested, null);
  assert.equal(S.makeLog({ ...s, tz: TB, rested: 9 })!.rested, null);
  assert.equal(S.makeLog({ ...s, tz: TB })!.rested, null);
});
ok("odd records from the vault are skipped, good ones kept", () => {
  const good = log("2026-11-08", "23:00", "07:00");
  assert.deepEqual(S.cleanLog(good), good);
  assert.equal(S.cleanLog(null), null);
  assert.equal(S.cleanLog({ ...good, day: "tomorrow" }), null);
  assert.equal(S.cleanLog({ ...good, end: good.start }), null);
  assert.equal(S.cleanLog({ ...good, end: "2027-01-01T00:00:00Z" }), null);   // weeks long
  assert.equal(S.cleanLog({ ...good, rested: 7 })!.rested, null);
  assert.equal(S.cleanLog({ ...good, src: "evil" })!.src, "hand");
});
ok("the newer change wins when two devices saved the same night", () => {
  const a = { ...log("2026-11-08", "23:00", "07:00"), at: "2026-11-08T08:00:00Z" };
  const b = { ...log("2026-11-08", "23:30", "07:00"), at: "2026-11-08T09:00:00Z" };
  assert.equal(S.mergeLog(a, b), b);
  assert.equal(S.mergeLog(b, a), b);
  assert.equal(S.byDay([a, b]).get("2026-11-08"), b);
  assert.equal(S.byDay([b, a]).size, 1);
});
ok("targets stay between 7 and 9 h", () => {
  assert.equal(S.clampTarget(undefined), 420);
  assert.equal(S.clampTarget(300), 420);
  assert.equal(S.clampTarget(480), 480);
  assert.equal(S.clampTarget(700), 540);
  assert.equal(S.clampTarget(487), 480);
});

// ---------- the streak (the developer: "eight hours a day, five days in a row") ----------
const run = (from: string, count: number, asleep: string, wake: string) => Array.from({ length: count }, (_, i) => log(S.addDay(from, i), asleep, wake));
ok("five nights of 8 h in a row at an 8 h target: 5", () => {
  const d = days(...run("2026-11-04", 5, "23:00", "07:00"));
  assert.equal(S.streak(d, "2026-11-08", 480), 5);
});
ok("a day sleeper gets a full streak (07:00 to 15:00)", () => {
  assert.equal(S.streak(days(...run("2026-11-02", 7, "07:00", "15:00")), "2026-11-08", 420), 7);
});
ok("one short night ends it, and the count starts again after it", () => {
  const ls = run("2026-11-01", 8, "23:00", "07:00");
  ls[4] = log("2026-11-05", "01:00", "07:00");   // 6 h
  assert.equal(S.streak(days(...ls), "2026-11-08", 420), 3);
});
ok("no extra credit: 11 h counts as one night, same as 7 h", () => {
  const d = days(log("2026-11-07", "20:00", "07:00"), log("2026-11-08", "00:00", "07:00"));
  assert.equal(S.streak(d, "2026-11-08", 420), 2);
});
ok("a higher target asks more: 7 h 30 nights do not count at 8 h", () => {
  const d = days(...run("2026-11-04", 5, "23:30", "07:00"));
  assert.equal(S.streak(d, "2026-11-08", 420), 5);
  assert.equal(S.streak(d, "2026-11-08", 480), 0);
});
ok("hours set by hand count, not the clock (lay awake an hour)", () => {
  const l = log("2026-11-08", "23:00", "06:30");   // 7 h 30 on the clock
  assert.equal(S.streak(days({ ...l, mins: 390 }), "2026-11-08", 420), 0);
});
ok("today and the 2 days before may still be empty without breaking it", () => {
  const d = days(...run("2026-11-01", 5, "23:00", "07:00"));   // 1 to 5 Nov
  assert.equal(S.streak(d, "2026-11-05", 420), 5);
  assert.equal(S.streak(d, "2026-11-06", 420), 5);
  assert.equal(S.streak(d, "2026-11-07", 420), 5);
  assert.equal(S.streak(d, "2026-11-08", 420), 5);   // 6 Nov can still be filled in
  assert.equal(S.streak(d, "2026-11-09", 420), 0);   // 6 Nov is too late to fill in now
});
ok("a gap in the middle ends it", () => {
  const d = days(...run("2026-11-01", 3, "23:00", "07:00"), ...run("2026-11-05", 4, "23:00", "07:00"));
  assert.equal(S.streak(d, "2026-11-08", 420), 4);
});
ok("a future date (clock skew) never counts", () => {
  assert.equal(S.streak(days(log("2026-11-09", "23:00", "07:00")), "2026-11-08", 420), 0);
});
ok("nothing logged: 0", () => assert.equal(S.streak(new Map(), "2026-11-08", 420), 0));
ok("badges at 3, 5, 7, 14 and 30", () => {
  assert.deepEqual(S.badge(0), { has: null, next: 3 });
  assert.deepEqual(S.badge(4), { has: 3, next: 5 });
  assert.deepEqual(S.badge(5), { has: 5, next: 7 });
  assert.deepEqual(S.badge(29), { has: 14, next: 30 });
  assert.deepEqual(S.badge(45), { has: 30, next: null });
});

// ---------- the week ----------
ok("this week: logged, on target and the average; last week beside it", () => {
  const d = days(
    log("2026-11-08", "23:00", "07:00"), log("2026-11-07", "00:00", "06:00"), log("2026-11-05", "23:30", "07:30"),
    log("2026-11-01", "22:00", "07:00"), log("2026-10-30", "23:00", "06:00"),
  );
  const w = S.weekStats(d, "2026-11-08", 420);
  assert.equal(w.logged, 3);
  assert.equal(w.onTarget, 2);
  assert.equal(w.avg, Math.round((480 + 360 + 480) / 3));
  assert.equal(w.lastAvg, Math.round((540 + 420) / 2));
  assert.deepEqual(S.weekStats(new Map(), "2026-11-08", 420), { logged: 0, onTarget: 0, avg: null, lastAvg: null });
});
ok("the 7 bars run oldest to today, empty days included", () => {
  const b = S.lastSeven(days(log("2026-11-08", "23:00", "07:00")), "2026-11-08");
  assert.equal(b.length, 7);
  assert.equal(b[0].day, "2026-11-02");
  assert.equal(b[6].day, "2026-11-08");
  assert.ok(b[6].log && !b[0].log);
});

// ---------- steady ----------
ok("clock median across midnight: 23:50, 00:10, 00:00 is 00:00", () => {
  assert.equal(S.clockMedian(["23:50", "00:10", "00:00"]), "00:00");
  assert.equal(S.clockMedian(["23:40", "00:20"]), "00:00");
  assert.equal(S.clockGap("23:50", "00:10"), 20);
  assert.equal(S.clockMedian([]), null);
});
ok("steady: both times within an hour of your usual", () => {
  const d = days(
    log("2026-11-08", "07:10", "14:40"), log("2026-11-07", "07:00", "14:30"), log("2026-11-06", "07:30", "15:00"),
    log("2026-11-05", "06:50", "14:20"), log("2026-11-04", "10:00", "17:00"),   // the late one is not steady
  );
  const s = S.steadiness(d, "2026-11-08")!;
  assert.equal(s.of, 5);
  assert.equal(s.steady, 4);
  assert.equal(s.asleep, "07:10");
  assert.equal(s.wake, "14:40");
});
ok("steady works across midnight for a normal sleeper", () => {
  const d = days(log("2026-11-08", "23:50", "07:30"), log("2026-11-07", "00:20", "07:40"), log("2026-11-06", "23:40", "07:10"));
  assert.equal(S.steadiness(d, "2026-11-08")!.steady, 3);
});
ok("steady needs 3 sleeps", () => assert.equal(S.steadiness(days(log("2026-11-08", "23:00", "07:00")), "2026-11-08"), null));
ok("usual times come from the median, or the plain defaults", () => {
  assert.deepEqual(S.usual(new Map()), { asleep: "23:00", wake: "07:00", known: false });
  const d = days(log("2026-11-08", "07:10", "14:40"), log("2026-11-07", "07:00", "14:30"), log("2026-11-06", "07:30", "15:00"));
  assert.deepEqual(S.usual(d), { asleep: "07:10", wake: "14:40", known: true });
});

// ---------- the once a day question ----------
ok("asked when nothing ended in the last 18 h; not for a night worker before bed", () => {
  const d = days(log("2026-11-07", "07:00", "14:30"));   // woke 14:30 Dubai on the 7th = 10:30 UTC
  const at = (iso: string) => Date.parse(iso);
  assert.equal(S.askNow(d, at("2026-11-07T21:00:00Z"), "2026-11-08", {}), false);   // 01:00 on the 8th, before sleep
  assert.equal(S.askNow(d, at("2026-11-08T11:00:00Z"), "2026-11-08", {}), true);    // 15:00 on the 8th, just up
  assert.equal(S.askNow(new Map(), at("2026-11-08T11:00:00Z"), "2026-11-08", {}), true);
});
ok("not asked once logged, when put off today, or when switched off", () => {
  const now = Date.parse("2026-11-08T11:00:00Z");
  assert.equal(S.askNow(days(log("2026-11-08", "07:00", "08:00")), now + 30 * 3600_000, "2026-11-08", {}), false);
  assert.equal(S.askNow(new Map(), now, "2026-11-08", { sleepSkip: "2026-11-08" }), false);
  assert.equal(S.askNow(new Map(), now, "2026-11-09", { sleepSkip: "2026-11-08" }), true);
  assert.equal(S.askNow(new Map(), now, "2026-11-08", { sleepAsk: false }), false);
});

// ---------- private notes ----------
ok("a short week gets one calm note; a normal week none", () => {
  const short = days(log("2026-11-08", "03:00", "07:00"), log("2026-11-07", "03:00", "07:30"), log("2026-11-06", "02:30", "07:00"));
  assert.match(S.sleepNote(short, "2026-11-08")!, /^That's a short week/);
  assert.equal(S.sleepNote(days(...run("2026-11-02", 7, "23:00", "07:00")), "2026-11-08"), null);
});
ok("long sleep for 2 weeks and unrested after enough sleep get their notes", () => {
  assert.match(S.sleepNote(days(...run("2026-10-26", 14, "20:00", "07:00")), "2026-11-08")!, /^Long sleep/);
  const tired = run("2026-10-26", 14, "23:00", "07:00").map((l) => ({ ...l, rested: 1 }));
  assert.match(S.sleepNote(days(...tired), "2026-11-08")!, /^Feeling unrested/);
});
ok("note words never diagnose", () => {
  const src = readFileSync(new URL("../src/core/sleep.ts", import.meta.url), "utf8") + readFileSync(new URL("../src/fitness/Sleep.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /insomnia|apnea|apnoea|disorder|sleep debt/i);
  assert.doesNotMatch(src, /[\u2013\u2014]/, "no em or en dashes");
});

// ---------- G Squad summary ----------
ok("the summary is the streak and the week's average only", () => {
  const ls = run("2026-11-04", 5, "23:00", "07:00").map((l) => ({ ...l, rested: 2 }));
  const s = S.sleepSummary(ls, {}, "2026-11-08")!;
  assert.deepEqual(s, { streak: 5, weekAvgMins: 480 });
  assert.deepEqual(Object.keys(s).sort(), ["streak", "weekAvgMins"]);
  assert.equal(JSON.stringify(s).includes("07:00"), false);
});
ok("the summary follows the personal target", () => {
  const ls = run("2026-11-04", 5, "23:30", "07:00");
  assert.equal(S.sleepSummary(ls, { sleepTarget: 480 }, "2026-11-08")!.streak, 0);
});
ok("switched off: nothing at all", () => {
  assert.equal(S.sleepSummary(run("2026-11-04", 5, "23:00", "07:00"), { sleepShare: false }, "2026-11-08"), null);
});

// ---------- Sleep mode hook ----------
ok("Sleep mode: went to sleep then Wake up becomes a log on the wake date", () => {
  const a = Date.parse("2026-11-08T03:10:00Z"), b = Date.parse("2026-11-08T10:40:00Z");   // 07:10 to 14:40 Dubai
  const l = S.logFromSleepMode(a, b, TB)!;
  assert.equal(l.day, "2026-11-08");
  assert.equal(l.src, "sleepmode");
  assert.equal(S.sleepMins(l), 450);
  assert.equal(S.logFromSleepMode(a, a + 20 * 60000, TB), null);      // a doze
  assert.equal(S.logFromSleepMode(a, a + 21 * 3600_000, TB), null);   // a forgotten button
});

// ---------- words ----------
ok("hours read like 7 h 30", () => {
  assert.equal(S.fmtMins(450), "7 h 30");
  assert.equal(S.fmtMins(420), "7 h");
  assert.equal(S.fmtMins(425), "7 h 05");
  assert.equal(S.fmtMins(45), "45 min");
  assert.equal(S.nightsWord(1), "1 night");
  assert.equal(S.nightsWord(5), "5 nights");
});

// ---------- wiring: private, synced like the rest of Fitness ----------
ok("fsleep is an owner private kind that syncs and mirrors like Fitness", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  assert.match(read("src/core/model.ts"), /\| "fsleep"/);
  const vault = read("src/core/vault.ts");
  assert.match(vault.slice(vault.indexOf("const OWNER_KINDS"), vault.indexOf("const OWNER_KINDS") + 700), /"fsleep"/, "the vault key, never a workspace");
  assert.match(vault, /pokeKinds = new Set<string>\(\["fprog", "fwork", "fit", "fsleep"[^\]]*\]\)/);
  assert.match(read("src/ps.ts"), /FIT_KINDS = new Set<string>\(\["fprog", "fwork", "fit", "fsleep"[^\]]*\]\)/);
  assert.match(read("src/fitness/sync.ts"), /FIT = new Set\(\["fprog", "fwork", "fit", "fsleep"[^\]]*\]\)/);
  // V1.40 other activities (kind "fact", core/activity.ts) are wired the same way.
  for (const f of ["src/core/vault.ts", "src/ps.ts", "src/fitness/sync.ts"]) assert.match(read(f), /"fsleep", "fact"\]/, f);
});
ok("nothing in Sleep sends to the squad", () => {
  const src = read2("src/fitness/sleep-store.ts") + read2("src/fitness/Sleep.tsx");
  assert.doesNotMatch(src, /zxhvchchfrkfqxuyorqo|fetch\(|sb\.from|\.channel\(|psPost/);
});
function read2(p: string) { return readFileSync(new URL(`../${p}`, import.meta.url), "utf8"); }

console.log(`\n${n} checks passed`);

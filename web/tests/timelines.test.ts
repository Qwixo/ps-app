// Run: node --experimental-strip-types tests/timelines.test.ts
// V1.43 Timelines (core/timelines.ts, the developer: "add the ability to add new timelines like a birthday or a special event,
// like someone's wedding"): kinds, birthdays and anniversaries coming back every year with the age or the years,
// the order (soonest first, or yours), old timelines with no kind, and the list the Mac hands over (ps.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DAY, KINDS, MAX_TIMELINES, allLines, builtIns, cleanTimelines, copyOfBuiltIn, countOf, kindOf, nextLine, ordinal, phaseOf,
  pillText, progressOf, repeatsOf, sortLines, whenOf, wordsOf,
} from "../src/core/timelines.ts";
import type { TimelineItem } from "../src/core/model.ts";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log("ok -", name); };
const at = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();   // local, like the app
const item = (p: Partial<TimelineItem> & { date: string }): TimelineItem => ({ id: p.title || p.date, title: "Thing", createdAt: "2026-01-01T00:00:00.000Z", ...p });
const NOW = at(2026, 11, 8, 15, 0);

// ---------- kinds ----------
ok("eight kinds, each with its own colour; birthdays, anniversaries and holidays repeat by default", () => {
  assert.deepEqual(KINDS.map((k) => k.id), ["event", "birthday", "anniversary", "wedding", "trip", "deadline", "holiday", "custom"]);
  assert.equal(new Set(KINDS.map((k) => k.colour)).size, 8);
  assert.deepEqual(KINDS.filter((k) => k.repeat).map((k) => k.id), ["birthday", "anniversary", "holiday"]);
});
ok("an old timeline (no kind) is an Event and does not repeat; a kind this build does not know is an Event too", () => {
  const old = { id: "a", title: "Launch", date: "2026-12-01", createdAt: "2026-10-01T00:00:00.000Z" };
  assert.equal(kindOf(old), "event");
  assert.equal(repeatsOf(old), false);
  assert.equal(kindOf({ kind: "party" as never }), "event");
});
ok("your own choice wins over the kind's default", () => {
  assert.equal(repeatsOf({ kind: "birthday", repeat: false }), false);
  assert.equal(repeatsOf({ kind: "event", repeat: true }), true);
});

// ---------- birthdays and anniversaries: every year ----------
ok("a birthday counts to this year's day and says the age: Mum turns 60 in 12 days", () => {
  const w = whenOf(item({ title: "Mum", kind: "birthday", date: "1966-11-20" }), NOW)!;
  assert.equal(w.at, at(2026, 11, 20));
  assert.equal(w.n, 60);
  assert.equal(w.from, at(2025, 11, 20));
  const l = allLines([item({ title: "Mum", kind: "birthday", date: "1966-11-20" })], NOW, null, ["month", "year", "h-halloween", "h-thanksgiving"])[0];
  assert.equal(l.title, "Mum's birthday");
  assert.equal(l.sub, "Turns 60");
  assert.equal(pillText(l, NOW), "Mum turns 60 in 11d");
  assert.equal(countOf(l.at, NOW).big, "11");
});
ok("once this year's birthday is over it rolls to next year and the age goes up", () => {
  const w = whenOf(item({ kind: "birthday", date: "1990-03-02" }), NOW)!;
  assert.equal(w.at, at(2027, 3, 2));
  assert.equal(w.n, 37);
});
ok("on the day itself it stays Today until midnight, then counts to next year", () => {
  const b = item({ kind: "birthday", date: "1990-11-08" });
  const w = whenOf(b, NOW)!;
  assert.equal(w.at, at(2026, 11, 8));
  assert.equal(phaseOf(w.at, NOW), "today");
  const after = whenOf(b, at(2026, 11, 9, 0, 1))!;
  assert.equal(after.at, at(2027, 11, 8));
  assert.equal(after.n, 37);
});
ok("a birthday picked with this year's date (year not known) counts down with no age", () => {
  const l = allLines([item({ title: "Sam", kind: "birthday", date: "2026-12-24" })], NOW, null, ["month", "year", "h-halloween", "h-thanksgiving"])[0];
  assert.equal(l.n, 0);
  assert.equal(l.sub, null);
  assert.equal(l.short, "Sam's birthday");
  // and next year it is the same day again
  assert.equal(whenOf(item({ kind: "birthday", date: "2026-12-24" }), at(2026, 12, 26))!.at, at(2027, 12, 24));
});
ok("a yearly one never counts to before its first day", () => {
  const w = whenOf(item({ kind: "anniversary", date: "2027-05-01" }), NOW)!;
  assert.equal(w.at, at(2027, 5, 1));
  assert.equal(w.n, 0);
  assert.equal(w.from, null);
});
ok("29 February falls on 28 February in other years", () => {
  const w = whenOf(item({ kind: "birthday", date: "2000-02-29" }), NOW)!;
  assert.equal(w.at, at(2027, 2, 28));
  assert.equal(w.n, 27);
  assert.equal(whenOf(item({ kind: "birthday", date: "2000-02-29" }), at(2027, 6, 1))!.at, at(2028, 2, 29));
});
ok("anniversaries count the years: 30th anniversary", () => {
  const w = whenOf(item({ kind: "anniversary", date: "1996-12-14" }), NOW)!;
  assert.equal(w.n, 30);
  assert.deepEqual(wordsOf("anniversary", "Mum and Dad", 30), { title: "Mum and Dad's anniversary", sub: "30th anniversary", short: "Mum and Dad's anniversary, 30th" });
  assert.equal(wordsOf("anniversary", "Our wedding", 5).title, "Our wedding anniversary");
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
});
ok("a time is used when there is one", () => {
  const w = whenOf(item({ kind: "wedding", date: "2026-11-21", time: "14:30" }), NOW)!;
  assert.equal(w.at, at(2026, 11, 21, 14, 30));
  const bad = whenOf(item({ date: "2026-11-21", time: "25:99" }), NOW)!;
  assert.equal(bad.at, at(2026, 11, 21));
});
ok("words for weddings and trips, and You for your own birthday", () => {
  assert.equal(wordsOf("wedding", "Sam and Alex", 0).title, "Sam and Alex's wedding");
  assert.equal(wordsOf("wedding", "Sam's wedding", 0).title, "Sam's wedding");
  assert.equal(wordsOf("trip", "Tokyo", 0).title, "Trip to Tokyo");
  assert.equal(wordsOf("trip", "Ski trip", 0).title, "Ski trip");
  assert.deepEqual(wordsOf("birthday", "You", 24), { title: "Your birthday", sub: "You turn 24", short: "You turn 24" });
});

// ---------- one offs ----------
ok("a one off counts to its day, its bar runs from when you added it, then it is Done", () => {
  const e = item({ kind: "event", date: "2026-11-18", createdAt: new Date(at(2026, 11, 1)).toISOString() });
  const w = whenOf(e, NOW)!;
  assert.equal(w.at, at(2026, 11, 18));
  assert.equal(w.repeat, false);
  const p = progressOf(w, NOW)!;
  assert.ok(p > 35 && p < 45, String(p));
  assert.equal(phaseOf(w.at, at(2026, 11, 19, 1)), "past");
  assert.equal(whenOf(e, at(2027, 1, 1))!.at, at(2026, 11, 18), "a one off never rolls over");
});
ok("the countdown: days, then hours, then minutes on the last day", () => {
  assert.deepEqual(countOf(NOW + 18 * DAY + 3600_000, NOW).big + " " + countOf(NOW + 18 * DAY, NOW).unit, "18 days");
  assert.equal(countOf(NOW + DAY + 5, NOW).unit, "day");
  assert.deepEqual([countOf(NOW + 5 * 3600_000 + 1000, NOW).big, countOf(NOW + 5 * 3600_000, NOW).unit], ["5", "hours"]);
  assert.deepEqual([countOf(NOW + 90_000, NOW).big, countOf(NOW + 90_000, NOW).unit], ["2", "min"]);
  assert.equal(countOf(NOW + 3661_000, NOW).hms, "01:01:01");
});

// ---------- the order ----------
const MIX = [
  item({ title: "Trip", kind: "trip", date: "2027-02-01" }),
  item({ title: "Mum", kind: "birthday", date: "1966-11-20" }),
  item({ title: "Done one", date: "2026-10-01" }),
  item({ title: "Older one", date: "2026-09-01" }),
  item({ title: "Today one", date: "2026-11-08" }),
];
const NO_BUILT = ["month", "year", "h-halloween", "h-thanksgiving"];
ok("soonest first: today's at the top, then what is coming, then the ones that are over (latest first)", () => {
  const s = sortLines(allLines(MIX, NOW, null, NO_BUILT), NOW).map((l) => l.id);
  assert.deepEqual(s, ["Today one", "Mum", "Trip", "Done one", "Older one"]);
});
ok("your order (from dragging) wins; anything new joins after it, soonest first", () => {
  const s = sortLines(allLines(MIX, NOW, null, NO_BUILT), NOW, ["Trip", "Older one"]).map((l) => l.id);
  assert.deepEqual(s, ["Trip", "Older one", "Today one", "Mum", "Done one"]);
  assert.deepEqual(sortLines(allLines(MIX, NOW, null, NO_BUILT), NOW, []).map((l) => l.id)[0], "Today one", "an empty order is Soonest");
});
ok("the pill shows the next one still to come (or today's), never one that is over", () => {
  const lines = allLines(MIX.filter((i) => i.title !== "Today one"), NOW, null, NO_BUILT);
  assert.equal(nextLine(lines, NOW)!.id, "Mum");
  assert.equal(nextLine(allLines([item({ date: "2020-01-01" })], NOW, null, NO_BUILT), NOW), null);
  assert.equal(pillText(allLines(MIX, NOW, null, NO_BUILT).find((l) => l.id === "Today one")!, NOW), "Today one today");
});

// ---------- built in ----------
ok("built in: month end, your birthday (with your age), New Year, Halloween, Thanksgiving; removed ones stay hidden", () => {
  const b = builtIns(NOW, "2002-01-15");
  assert.deepEqual(b.map((l) => l.id), ["month", "birthday", "year", "h-halloween", "h-thanksgiving"]);
  const me = b.find((l) => l.id === "birthday")!;
  assert.equal(me.at, at(2027, 1, 15));
  assert.equal(me.sub, "You turn 25");
  assert.equal(b.find((l) => l.id === "h-thanksgiving")!.at, at(2026, 11, 26));
  assert.equal(b.find((l) => l.id === "h-halloween")!.at, at(2027, 10, 31));
  assert.deepEqual(allLines([], NOW, null, ["month", "h-halloween"]).map((l) => l.id), ["year", "h-thanksgiving"]);
});
ok("editing a built in one makes your own copy: your birthday keeps your birth date so the age keeps counting", () => {
  const me = builtIns(NOW, "2002-01-15").find((l) => l.id === "birthday")!;
  assert.deepEqual(copyOfBuiltIn(me, "2002-01-15", "x", "t"), { id: "x", title: "You", date: "2002-01-15", createdAt: "t", kind: "birthday", repeat: true });
  const ny = builtIns(NOW, null).find((l) => l.id === "year")!;
  assert.deepEqual(copyOfBuiltIn(ny, null, "y", "t"), { id: "y", title: "New Year 2027", date: "2027-01-01", createdAt: "t", kind: "holiday", repeat: true });
});

// ---------- the list from another device, or the Mac's hand over ----------
ok("old timelines (V1.42, no kind) come through unchanged and still count", () => {
  const old = [{ id: "a", title: "Launch", date: "2026-12-01", createdAt: "2026-10-01T00:00:00.000Z" }];
  assert.deepEqual(cleanTimelines(old), old);
  const l = allLines(old, NOW, null, NO_BUILT)[0];
  assert.equal(l.kind, "event");
  assert.equal(l.title, "Launch");
  assert.equal(l.at, at(2026, 12, 1));
});
ok("the kind, the time and the repeat come through; junk is dropped; at most 100", () => {
  const got = cleanTimelines([
    { id: "b", title: "Mum", date: "1966-11-20", createdAt: "x", kind: "birthday", time: "09:30", repeat: true, extra: "gone" },
    { id: "c", title: "Bad kind", date: "2026-12-01", createdAt: "x", kind: "party", time: "9:30", repeat: "yes" },
    { id: "d", title: "No date", date: "soon", createdAt: "x" },
    null, 7, { title: "No id", date: "2026-12-01" },
  ]);
  assert.deepEqual(got, [
    { id: "b", title: "Mum", date: "1966-11-20", createdAt: "x", kind: "birthday", time: "09:30", repeat: true },
    { id: "c", title: "Bad kind", date: "2026-12-01", createdAt: "x" },
  ]);
  assert.equal(cleanTimelines(Array.from({ length: 140 }, (_, i) => ({ id: `t${i}`, title: "T", date: "2026-12-01", createdAt: "x" }))).length, MAX_TIMELINES);
  assert.deepEqual(cleanTimelines("nope"), []);
});
ok("the Mac's main page saves the overlay's list through cleanTimelines (so the new fields are not stripped)", () => {
  const ps = readFileSync(new URL("../src/ps.ts", import.meta.url), "utf8");
  assert.match(ps, /m\.type === "timelines" && Array\.isArray\(m\.list\)\) \{[\s\S]{0,200}saveSettings\(\{ timelines: cleanTimelines\(m\.list\) \}\)/);
});
ok("no em or en dashes in the Timelines files", () => {
  for (const f of ["core/timelines.ts", "views/Timelines.tsx", "views/timelines.css"]) assert.equal(/[\u2013\u2014]/.test(readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8")), false, f);
});

console.log(`\n${n} checks passed`);

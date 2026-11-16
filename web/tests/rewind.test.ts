// Run: node --experimental-strip-types tests/rewind.test.ts
// Rewind (PS 1.64, core/rewind.ts): the rollup maths, the merge of two devices' days, the backfill from what PS already
// holds, the year boundary in the person's own zone, the 1 January lock, and the privacy guards around it (never in a
// backup, never mirrored, never on the hub, no screen reads it, the switch is public on every device).
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const R = await import("../src/core/rewind.ts");
const B = await import("../src/core/backup.ts");
const I = await import("../src/core/settingsindex.ts");

let n = 0;
const ok = async (name: string, fn: () => unknown) => { await fn(); n++; console.log("ok -", name); };
const TBS = "Asia/Dubai", NY = "America/New_York";
const T = (iso: string) => Date.parse(iso);
const doc = <D,>(id: string, kind: string, data: D) => ({ id, ws: null, kind, data, author: "me", updatedAt: null }) as never;
const empty = (): Parameters<typeof R.derive>[0] => ({ todos: [], daylogs: [], workouts: [], screentime: [], calendars: [], meetings: [], awayLog: [], gymAck: [], gym: null, money: {} });
const NOW = T("2026-11-16T12:00:00Z");   // 16:00 in Dubai

await ok("year boundary: the day and the year are the person's own, not the device's or UTC", () => {
  const ts = T("2026-12-31T21:30:00Z");
  assert.equal(R.dayKey(ts, TBS), "2027-01-01");
  assert.equal(R.dayKey(ts, NY), "2026-12-31");
  assert.equal(R.dayKey(ts, "UTC"), "2026-12-31");
  assert.equal(R.yearStart(2027, TBS), T("2026-12-31T20:00:00Z"));
  assert.equal(R.yearStart(2027, NY), T("2027-01-01T05:00:00Z"));
  assert.equal(R.rwZone("Asia/Dubai", "UTC"), TBS);
  assert.equal(R.rwZone("Not/AZone", "Europe/London"), "Europe/London");
  assert.equal(R.rwZone(null, "Europe/London"), "Europe/London");
});

await ok("the recap lock: nothing opens before midnight on 1 January in the person's zone", () => {
  assert.equal(R.recapOpen(2026, T("2026-12-31T19:59:59Z"), TBS), false);
  assert.equal(R.recapOpen(2026, T("2026-12-31T20:00:00Z"), TBS), true);
  assert.equal(R.recapOpen(2026, T("2026-12-31T20:00:00Z"), NY), false, "still 31 December in New York");
  assert.equal(R.recapOpen(2026, T("2027-01-01T05:00:00Z"), NY), true);
  const stored = [doc("a", "rwd", { t: "day", v: 1, d: "2026-03-02", tk: { k1: ["Gym", 9, 2] } })];
  assert.equal(R.openYear(stored, 2026, NOW, TBS), null, "16 Nov: no peeking, not even for the owner");
  assert.equal(R.openYear(stored, 2026, T("2026-12-31T19:00:00Z"), TBS), null);
  const open = R.openYear(stored, 2026, T("2027-01-01T00:00:00Z"), TBS)!;
  assert.equal(open.days.length, 1);
  assert.equal(open.days[0].d, "2026-03-02");
});

await ok("tasks: ticks from the list and the day log count once, with title, hour and flags", () => {
  const src = empty();
  src.todos = [
    doc("t1", "todo", { title: "Gym", type: "daily", done: true, doneAt: "2026-11-16T05:10:00Z", streak: 12, bestStreak: 30, order: 0 }),
    doc("t2", "todo", { title: "Send invoice", type: "once", p1: true, done: true, doneAt: "2026-11-15T19:30:00Z", order: 1,
      subtasks: [{ id: "s1", title: "Find the PDF", done: true, doneAt: "2026-11-15T19:00:00Z" }, { id: "s2", title: "By parent", done: true, doneAt: "2026-11-15T19:30:00Z", byParent: true }] }),
    doc("t3", "todo", { title: "Open 1Password vault", type: "once", done: true, doneAt: "2026-11-16T06:00:00Z", order: 2 }),
    doc("t4", "todo", { title: "Ask Signal group", type: "once", done: true, doneAt: "2026-11-16T06:00:00Z", order: 3 }),
    doc("t5", "todo", { title: "Example", type: "once", done: true, doneAt: "2026-11-16T06:00:00Z", order: 4, example: true }),
    doc("t6", "todo", { title: "Proposal for Alex", type: "once", done: false, order: 5, claudeDoneAt: "2026-11-16T07:00:00Z" }),
  ];
  // The day log holds Gym again (the same tick: one key) and an older Gym tick before Reset.
  src.daylogs = [doc("l1", "daylog", { date: "2026-11-15", updatedAt: "x", items: [
    { todoId: "t1", title: "Gym", at: "2026-11-16T05:10:00.000Z", repeat: true },
    { todoId: "t1", title: "Gym", at: "2026-11-14T06:00:00Z", repeat: true },
  ] })];
  const { days, years } = R.derive(src, { tz: TBS, now: NOW, since: 0 });
  const d16 = days.get("2026-11-16")!, d15 = days.get("2026-11-15")!, d14 = days.get("2026-11-14")!;
  assert.deepEqual(Object.values(d16.tk!).map((x) => x[0]), ["Gym"], "1Password, Signal and example tasks are dropped, the Gym tick counts once");
  assert.deepEqual(Object.values(d16.tk!)[0], ["Gym", 9, R.F.repeat], "05:10Z is 09:10 in Dubai");
  assert.deepEqual(Object.values(d15.tk!).sort(), [["Find the PDF", 23, R.F.mini], ["Send invoice", 23, R.F.p1]]);
  assert.equal(Object.keys(d14.tk!).length, 1);
  assert.deepEqual(Object.values(d16.cl!), [["Proposal for Alex", 11]], "Claude's purple tick");
  assert.equal(d16.sk!.Gym, 12, "today's Every day streak");
  assert.equal(years.get(2026)!.bs!.Gym, 30, "best streak this year");
});

await ok("Fitness: sessions, sets, volume, personal bests and minutes", () => {
  const set = (id: string, kg: number, reps: number, warm = false) => ({ id, kg, reps, rir: 2, done: true, at: "x", warm });
  const w1 = { programId: null, dayId: null, dayName: "Day 1", week: 1, date: "2026-11-10", startedAt: "2026-11-10T08:00:00Z", endedAt: "2026-11-10T09:05:00Z", at: "x",
    exercises: [{ exId: "bench", name: "Bench press", sets: [set("a", 20, 10, true), set("b", 60, 8), set("c", 60, 8)] }] };
  const w2 = { ...w1, date: "2026-11-12", startedAt: "2026-11-12T08:00:00Z", endedAt: "2026-11-12T09:00:00Z",
    exercises: [{ exId: "bench", name: "Bench press", sets: [set("d", 65, 6), set("e", 60, 8)] }] };
  const src = empty();
  src.workouts = [{ id: "w1", data: w1 as never }, { id: "w2", data: w2 as never }];
  const { days } = R.derive(src, { tz: TBS, now: NOW, since: 0 });
  const [x] = Object.values(days.get("2026-11-10")!.wk!);
  assert.deepEqual(x, [2, 960, 0, 65], "warm up left out; the first ever session sets no bests");
  const [y] = Object.values(days.get("2026-11-12")!.wk!);
  assert.equal(y[0], 2); assert.equal(y[1], 870); assert.ok(y[2] >= 1, "65 kg is a new best");
  assert.deepEqual(days.get("2026-11-12")!.pb, { "Bench press": [65, 6] });
});

await ok("screen time, AFK, meetings and the gym reminder from what PS holds (never 1Password or Signal)", () => {
  const src = empty();
  src.screentime = [
    doc("s1", "screentime", { day: "2026-11-15", device: "mac", updatedAt: "x", apps: [{ id: "com.figma", name: "Figma", secs: 3600 }, { id: "com.1password.1password", name: "1Password", secs: 999 }, { id: "x", name: "Tiny", secs: 20 }] }),
    doc("s2", "screentime", { day: "2026-11-15", device: "gos", updatedAt: "x", apps: [{ id: "gos:org.thoughtcrime.securesms", name: "Signal", secs: 600 }, { id: "gos:yt", name: "YouTube", secs: 1800 }] }),
  ];
  src.awayLog = [{ s: T("2026-11-15T10:00:00Z") / 1000, e: T("2026-11-15T10:25:00Z") / 1000, reason: "AFK" }, { s: T("2026-11-15T12:00:00Z") / 1000, e: T("2026-11-15T12:10:00Z") / 1000, reason: "Signal call" }];
  const ev = (id: string, start: string, end: string, extra: object = {}) => ({ id, title: "Call", start, end, allDay: false, link: "https://meet.example/x", attendees: [], ...extra });
  src.calendars = [doc("c1", "calendar", { account: "a", at: "x", from: "x", to: "x", events: [
    ev("e1", "2026-11-15T09:00:00Z", "2026-11-15T09:30:00Z"),
    ev("e2", "2026-11-15T14:00:00Z", "2026-11-15T15:00:00Z", { attendees: [{ email: "me", self: true, rsvp: "declined" }] }),
    ev("e3", "2026-11-16T15:00:00Z", "2026-11-16T16:00:00Z"),   // not over yet
    { id: "e4", title: "Cooking", start: "2026-11-15T16:00:00Z", end: "2026-11-15T17:00:00Z", allDay: false, attendees: [] },
  ] })];
  src.meetings = [doc("m1", "meeting", { date: "2026-11-15T09:01:00Z" })];   // the same call from the notes: counts once
  src.gymAck = ["2026-11-14"];
  src.gym = { on: true, days: [0, 1, 2, 3, 4, 5, 6] };
  const { days } = R.derive(src, { tz: TBS, now: NOW, since: 0 });
  const d = days.get("2026-11-15")!;
  assert.deepEqual(d.st, { mac: [60, { Figma: 60 }], gos: [30, { YouTube: 30 }] }, "totals and apps without 1Password or Signal; under a minute is left out of the list");
  assert.deepEqual(Object.values(d.af!).sort(), [[10, ""], [25, "AFK"]], "a break reason about Signal is blanked");
  assert.equal(d.mt!.length, 1, "declined, unfinished and blocks without people or a link do not count");
  assert.equal(days.get("2026-11-14")!.ga, 1);
  assert.equal(d.gm, 1, "a gym day with no Yes");
  assert.equal(days.get("2026-11-16")?.gm, undefined, "today is not over");
});

await ok("Off and Delete: nothing from before `since` is collected", () => {
  const src = empty();
  src.todos = [doc("t1", "todo", { title: "Old", type: "once", done: true, doneAt: "2026-11-10T08:00:00Z", order: 0 }), doc("t2", "todo", { title: "New", type: "once", done: true, doneAt: "2026-11-16T08:00:00Z", order: 1 })];
  src.money = { "2026-02": 2316, "2026-10": 3000 };
  const { days, years } = R.derive(src, { tz: TBS, now: NOW, since: T("2026-11-12T00:00:00Z") });
  assert.deepEqual([...days.keys()], ["2026-11-16"]);
  assert.equal(years.get(2026)?.mo, undefined, "months before the deletion are not filled in again");
  assert.equal(R.rewindOn(undefined), true, "on unless switched off");
  assert.equal(R.rewindOn({ on: false }), false);
  assert.deepEqual(R.rewindSwitch(undefined, false, "2026-11-16T00:00:00Z"), { on: false, since: null });
  assert.deepEqual(R.rewindSwitch({ on: false, since: null }, true, "2026-11-20T00:00:00Z"), { on: true, since: "2026-11-20T00:00:00Z" }, "on again starts from now: the off time is never filled in");
  assert.deepEqual(R.rewindSwitch({ since: "2026-11-01T00:00:00Z" }, true, "2026-11-20T00:00:00Z"), { on: true, since: "2026-11-01T00:00:00Z" });
});

await ok("the quick look only covers the last few days", () => {
  const src = empty();
  src.todos = [doc("t1", "todo", { title: "Old", type: "once", done: true, doneAt: "2026-11-01T08:00:00Z", order: 0 }), doc("t2", "todo", { title: "New", type: "once", done: true, doneAt: "2026-11-16T08:00:00Z", order: 1 })];
  assert.deepEqual([...R.derive(src, { tz: TBS, now: NOW, since: 0, from: "2026-11-14" }).days.keys()], ["2026-11-16"]);
  assert.deepEqual([...R.derive(src, { tz: TBS, now: NOW, since: 0 }).days.keys()].sort(), ["2026-11-01", "2026-11-16"]);
});

await ok("two devices: the merge is the same either way round, merging with itself changes nothing, counts never add twice", () => {
  const mac: import("../src/core/rewind.ts").RwDay = { t: "day", v: 1, d: "2026-11-16", tk: { a: ["Gym", 9, 2], b: ["Invoice", 10, 0] }, st: { mac: [120, { Figma: 60, Xcode: 50 }] },
    dv: { m1: { k: "mac", gy: [3, 2, 0], ay: [4, 1], ac: [500, 1300] } }, gm: 1, mt: ["x"] };
  const phone: import("../src/core/rewind.ts").RwDay = { t: "day", v: 1, d: "2026-11-16", tk: { a: ["Gym", 9, 2], c: ["Call mum", 20, 0] }, st: { mac: [110, { Figma: 70 }], gos: [40, { YouTube: 40 }] },
    dv: { p1: { k: "gos", gy: [0, 0, 1], sq: 5, ac: [420, 1000] }, m1: { k: "mac", gy: [2, 1, 0] } }, ga: 1, mt: ["y", "x"] };
  const ab = R.mergeDay(mac, phone), ba = R.mergeDay(phone, mac);
  assert.equal(R.canon(ab), R.canon(ba));
  assert.equal(R.canon(R.mergeDay(ab, ab)), R.canon(ab));
  assert.equal(R.canon(R.mergeDay(ab, mac)), R.canon(ab), "an older copy coming back changes nothing");
  assert.equal(Object.keys(ab.tk!).length, 3, "Gym seen on both devices counts once");
  assert.deepEqual(ab.st!.mac, [120, { Figma: 70, Xcode: 50 }]);
  assert.deepEqual(ab.dv!.m1.gy, [3, 2, 0], "a device's own bucket: the larger copy wins, never a sum");
  assert.equal(ab.dv!.p1.sq, 5);
  assert.equal(ab.ga, 1); assert.equal(ab.gm, undefined, "a Yes always wins over missed");
  assert.deepEqual(ab.mt, ["x", "y"]);
});

await ok("a device's own counts are added onto what the vault holds, and only into its own bucket", () => {
  const stored = [doc("r1", "rwd", { t: "day", v: 1, d: "2026-11-16", dv: { m1: { k: "mac", gy: [1, 0, 0] }, p1: { k: "gos", sq: 2 } } })];
  const d = R.devRec(stored, "2026-11-16", "m1", "mac", { gy: [1, 1, 0], sq: 1, ac: [600, 600], ay: [3, 1] });
  assert.deepEqual(d.dv!.m1, { k: "mac", gy: [2, 1, 0], sq: 1, ac: [600, 600], ay: [3, 1] });
  assert.deepEqual(d.dv!.p1, { k: "gos", sq: 2 }, "the phone's bucket is untouched");
  const again = R.addDev(d, "m1", "mac", { ac: [300, 900], ay: [2, 0] });
  assert.deepEqual(again.dv!.m1.ac, [300, 900]);
  assert.deepEqual(again.dv!.m1.ay, [3, 1], "Are you sure is the Mac's own count of the day, never added");
});

await ok("what to write: new days, nothing when unchanged, two copies of a day fold into one, old years go", () => {
  const day = (d: string, extra: object = {}) => ({ t: "day", v: 1, d, ...extra }) as import("../src/core/rewind.ts").RwDay;
  const o = { now: NOW, tz: TBS };
  let p = R.plan([], [day("2026-11-16", { tk: { a: ["Gym", 9, 2] } })], o);
  assert.equal(p.puts.length, 1); assert.equal(p.puts[0].id, undefined); assert.equal(p.removes.length, 0);
  const held = [doc("b2", "rwd", day("2026-11-16", { tk: { a: ["Gym", 9, 2] } }))];
  p = R.plan(held, [day("2026-11-16", { tk: { a: ["Gym", 9, 2] } })], o);
  assert.deepEqual(p, { puts: [], removes: [] }, "unchanged: no write, no egress");
  const twice = [doc("b2", "rwd", day("2026-11-16", { tk: { a: ["Gym", 9, 2] } })), doc("a1", "rwd", day("2026-11-16", { tk: { b: ["Walk", 7, 0] } }))];
  p = R.plan(twice, [], o);
  assert.equal(p.puts.length, 1); assert.equal(p.puts[0].id, "a1", "the smallest id is kept, on both devices");
  assert.deepEqual(Object.keys((p.puts[0].data as import("../src/core/rewind.ts").RwDay).tk!).sort(), ["a", "b"]);
  assert.deepEqual(p.removes, ["b2"]);
  p = R.plan([doc("old", "rwd", day("2024-06-01")), doc("x", "rwd", { junk: true }), doc("y", "rwd", { t: "year", v: 1, y: 2024 })], [], o);
  assert.deepEqual(p.removes.sort(), ["old", "y"], "years before last year go; a damaged record is left alone");
  assert.equal(R.keptDay("2025-01-01", NOW, TBS), true, "last year is kept for its recap");
  p = R.plan([doc("k", "rwd", day("2026-11-01", { tk: { a: ["Old", 9, 0] } })), doc("m", "rwd", day("2026-11-16"))], [], { ...o, since: T("2026-11-10T00:00:00Z") });
  assert.deepEqual(p.removes, ["k"], "a day from before Delete my Rewind data that a device still had goes again");
});

await ok("money: what the person typed in PS, the board's place, write only from the person's own op", () => {
  const recs = R.moneyRecs([{ month: "2026-02", usd: 2316, rank: 1, of: 10 }, { month: "2026-05", usd: 225, rank: 8, of: 8, low: true }, { month: "2026-13", usd: 1 }, { month: "2026-03", usd: -5 }, { month: "2026-04", usd: "1800" }]);
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].mo, { "2026-02": { usd: 2316, src: "board", rank: 1, of: 10 }, "2026-05": { usd: 225, src: "board", rank: 8, of: 8, low: 1 } });
  const ps = { t: "year", v: 1, y: 2026, mo: { "2026-02": { usd: 2300, src: "ps" } } } as import("../src/core/rewind.ts").RwYear;
  const m = R.mergeYear(ps, recs[0]);
  assert.deepEqual(m.mo!["2026-02"], { usd: 2300, src: "ps", rank: 1, of: 10 }, "the amount typed in PS wins, the place comes from the board");
  assert.equal(R.canon(R.mergeYear(recs[0], ps)), R.canon(m));
  const src = empty(); src.money = { "2026-10": 3100.5, "2024-01": 9 };
  assert.deepEqual(R.derive(src, { tz: TBS, now: NOW, since: 0 }).years.get(2026)!.mo, { "2026-10": { usd: 3100.5, src: "ps" } });
});

await ok("never in a backup file, either way", async () => {
  assert.equal(B.NOT_IN_BACKUP.has("rwd"), true);
  const text = await B.makeBackup([{ id: "1", kind: "todo", data: { title: "x" } }, { id: "2", kind: "rwd", data: { t: "day" } }], "correct horse battery staple ok", { iters: 2000 });
  const back = await B.openBackup(text, "correct horse battery staple ok");
  assert.deepEqual(back.records.map((r) => r.kind), ["todo"]);
  const plan = B.planImport([{ id: "9", kind: "rwd", data: {} }, { id: "8", kind: "todo", data: {} }], new Map(), null);
  assert.deepEqual(plan.add.map((r) => r.kind), ["todo"]);
});

// ---------- the source: where Rewind may and may not go ----------
const SRC = new URL("../src/", import.meta.url).pathname;
const files: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?)$/.test(f)) files.push(p); } };
walk(SRC);
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const strip = (t: string) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

await ok("no screen reads Rewind back, and nothing sends it anywhere", () => {
  for (const f of files) {
    const t = strip(readFileSync(f, "utf8")), rel = f.slice(SRC.length);
    if (rel === "core/rewind.ts") continue;
    assert.doesNotMatch(t, /openYear/, `${rel} must not read Rewind before the recap exists`);
    if (/^squad\//.test(rel) || /squad|hub|gsquad/i.test(rel)) assert.doesNotMatch(t, /docs[^\n]*"rwd"|RW_KIND/, `${rel}: Rewind never goes to the G Squad hub`);
  }
  const ps = read("../src/ps.ts");
  assert.doesNotMatch(ps, /"rwd"/, "the Tab list window never gets a mirror of Rewind (ps.ts sends a fixed list of kinds)");
  const runner = read("../src/rewind.ts");
  assert.doesNotMatch(runner, /fetch\(|sb\.from|psPost|post\(/, "the runner only writes to the person's own vault");
  for (const s of ["../scripts/agent.ts", "../scripts/drop.ts", "../scripts/seal-ops.ts"]) {   // not all of them ship in the public core
    if (existsSync(new URL(s, import.meta.url))) assert.doesNotMatch(read(s), /rwd|rewind/i, `${s} has nothing to do with Rewind`);
  }
  assert.match(read("../src/localfirst.ts"), /!NOT_IN_BACKUP\.has\(d\.kind\)/, "Export my data skips it");
  assert.match(read("../src/views/Settings.tsx"), /filter\(\(d\) => !NOT_IN_BACKUP\.has\(d\.kind\)\)/, "the website's Export everything skips it");
  assert.match(read("../src/core/vault.ts"), /"srkey", "rwd",/, "owner only: sealed with the person's own vault key");
});

await ok("the switch is public: on the Mac, the website and the phone, for every account", () => {
  const e = I.settingById("rewind")!;
  assert.equal(e.name, "Rewind (yearly recap)");
  assert.equal(e.group, "privacy");
  assert.equal(e.red, undefined); assert.equal(e.on, undefined, "every device");
  for (const ctx of [{ red: false, where: "mac" as const }, { red: false, where: "web" as const }, { red: false, where: "phone" as const, shell: "gos" as const }, { red: true, where: "mac" as const }]) {
    assert.ok(I.searchSettings("rewind", ctx).some((h) => h.e.id === "rewind"), JSON.stringify(ctx));
    assert.ok(I.searchSettings("delete my rewind data", ctx).some((h) => h.e.id === "rewind-delete" || h.e.id === "rewind"), JSON.stringify(ctx));
  }
  const g = read("../src/views/SettingsGroups.tsx");
  assert.match(g, /"rewind": function Rewind/);
  assert.doesNotMatch(g.split('"rewind": function Rewind')[1].split("\n  },")[0], /red|isRedAccount/, "never behind a the developer only gate");
  assert.match(read("../src/views/RewindSettings.tsx"), /Delete my Rewind data/);
});

await ok("no dashes in the Rewind files", () => {
  for (const p of ["../src/core/rewind.ts", "../src/rewind.ts", "../src/views/RewindSettings.tsx", "./rewind.test.ts"]) assert.doesNotMatch(read(p), /[\u2013\u2014]/, p);
});

console.log(`rewind: ${n} passed`);

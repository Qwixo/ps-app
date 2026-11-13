// Run: node --experimental-strip-types tests/gymsquad.test.ts
// G Squad Fitness (V1.40, src/core/gymsquad.ts, src/core/activity.ts, src/squad/gymview.ts): exercise matching across
// people, what the board card and the exercise rows hold (and never hold), personal bests, percent better, sleep,
// the boards, challenges, posts, the opt-out gate, ids and tags. FICTIONAL data.
import assert from "node:assert/strict";
const G = await import("../src/core/gymsquad.ts");
const A = await import("../src/core/activity.ts");
const SS = await import("../src/core/squadshare.ts");
const C = await import("../src/core/squadcrypto.ts");
const SL = await import("../src/core/sleep.ts");
type W = import("../src/core/fitness.ts").FitWorkout;

let n = 0;
const ok = async (name: string, fn: () => unknown) => { await fn(); n++; console.log("ok -", name); };
const TODAY = "2026-11-07";   // a Saturday
const day = (k: number) => G.addDays(TODAY, k);
let sid = 0;
/** A workout on day k with exercises [name, exId, [[kg, reps]...]] */
function wk(k: number, exs: [string, string | null, [number, number][], { perSide?: boolean; note?: string }?][], extra: Partial<W> = {}) {
  const at = `${day(k)}T10:00:00.000Z`;
  const data: W = { programId: null, dayId: null, dayName: "Free workout", week: 1, date: day(k), startedAt: at, endedAt: at, at, note: "Private workout note", ...extra,
    exercises: exs.map(([name, exId, sets, o], i) => ({ id: `e${i}`, exId, name, at, perSide: o?.perSide, note: o?.note ?? null, rir: 2,
      sets: sets.map(([kg, reps]) => ({ id: `s${++sid}`, kg, reps, rir: 1, done: true, at })) })) };
  return { id: `w${k}`, data };
}
const act = (k: number, kind: "run" | "walk" | "ride" | "swim", km: number, secs: number) => ({ id: `a${k}${kind}`, data: { kind, date: day(k), km, secs, at: `${day(k)}T07:00:00.000Z` } });

// ---------- matching ----------
await ok("names match across people: case, spacing, plurals, DB/BB, glued words, word order", () => {
  const k = G.matchKey({ name: "Incline barbell bench press" });
  for (const v of ["incline  BENCH press", "Incline BB bench", "incline benchpress", "Incline barbell bench presses", "bench incline barbell", "INCLINE BENCH"]) assert.equal(G.matchKey({ name: v }), k, v);
  assert.equal(G.matchKey({ name: "x", exId: "incline-barbell-bench-press" }), k, "a library id wins over the name");
});
await ok("different exercises stay apart", () => {
  assert.notEqual(G.matchKey({ name: "Incline barbell bench press" }), G.matchKey({ name: "Incline dumbbell press" }));
  assert.notEqual(G.matchKey({ name: "Lat pulldown" }), G.matchKey({ name: "Single arm cable push downs" }));
  assert.notEqual(G.matchKey({ name: "Smith Machine" }), G.matchKey({ name: "Smith machine squat" }));
});
await ok("free names (not in the library) match by their words in any order", () => {
  assert.equal(G.matchKey({ name: "Sit-table bicep curl thing" }), G.matchKey({ name: "sit table bicep curls thing" }));
  assert.equal(G.matchKey({ name: "JM Press" }), G.matchKey({ name: "jm  press" }));
  assert.match(G.matchKey({ name: "JM Press" }), /^n:/);
});

// ---------- the board card ----------
const W1 = [
  wk(-40, [["Barbell bench press", "barbell-bench-press", [[60, 5]]]]),
  wk(-9, [["Barbell bench press", "barbell-bench-press", [[60, 8], [62.5, 6]]], ["Dumbbell curl", "dumbbell-curl", [[12, 10]], { perSide: true, note: "SECRET plan note" }]]),
  wk(-2, [["Barbell bench press", "barbell-bench-press", [[65, 5], [65, 5]]]]),
  wk(0, [["Bench press", null, [[67.5, 3]]]]),
];
W1[2].data.exercises[0].sets.push({ id: "warm1", kg: 200, reps: 1, rir: null, done: true, warm: true, at: "x" });
W1[2].data.exercises[0].sets.push({ id: "gone1", kg: 300, reps: 1, rir: null, done: true, gone: true, at: "x" });
const A1 = [act(-30, "run", 5, 1800), act(-3, "run", 5, 1700), act(-1, "run", 6, 2000)];
const S1 = G.buildSum(W1, A1, TODAY, 4);
await ok("the card has the days, each day's volume and distance, warm up and removed sets left out", () => {
  const d = new Map(S1.days.map((x) => [x[0], x]));
  assert.deepEqual(d.get(day(-2)), [day(-2), 650, 0, 1]);
  assert.deepEqual(d.get(day(-1)), [day(-1), 0, 6, 0], "a run only day counts as a day, not a gym day");
  assert.ok(!d.has(day(-70)) && d.has(day(-40)), "9 week window");
  assert.equal(S1.goal, 4);
});
await ok("personal bests: judged against the workouts before, one per exercise per workout", () => {
  const kinds = S1.pb.map((p) => `${p.d}:${p.k}:${p.kg ?? p.km}`);
  assert.ok(!kinds.includes(`${day(0)}:kg:67.5`), "a best is what the app itself flagged: today's typed Bench press has no history under that name yet");
  assert.ok(kinds.includes(`${day(-2)}:kg:65`), "65 was a best then, even though 67.5 came later");
  assert.ok(!S1.pb.some((p) => p.kg === 200 || p.kg === 300), "warm up and removed sets are never bests");
  assert.equal(S1.pb.filter((p) => p.a === "run" && p.d === day(-1)).length, 1, "one best per activity");
  assert.ok(S1.pb.some((p) => p.k === "farpace" && p.km === 6), "the run is the longest and the fastest");
  assert.ok(S1.pb.every((p) => p.d >= day(-34)));
});
await ok("percent better: best estimated max this month against the 8 weeks before, pace for runs", () => {
  const b = G.percentBetter(W1, A1, TODAY)!;
  // bench: now best e1rm max(60x8=76, 62.5x6=75, 65x5=75.8, 67.5x3=74.25) = 76; then 60x5 = 70 -> +8.57%; run: 360 s/km then, 333.3 now -> +7.41%
  assert.equal(b.n, 2);
  assert.equal(b.pct, 8);
  assert.equal(G.percentBetter([W1[3]], [], TODAY), null, "nothing to compare yet");
});
await ok("nothing private leaves: no notes, RIR, program or times in the card or the exercise rows", () => {
  const rows = G.buildExRows(W1, A1, TODAY);
  const text = JSON.stringify([S1, rows]);
  for (const bad of ["SECRET", "Private workout note", "rir", "T10:00", "programId", "Free workout"]) assert.ok(!text.includes(bad), bad);
});
await ok("exercise rows: newest session first, best set, sets with kg each", () => {
  const rows = G.buildExRows(W1, A1, TODAY);
  const bench = rows.find((r) => r.m === "id:barbell-bench-press")! as import("../src/core/gymsquad.ts").GymExLift;
  assert.equal(bench.c, 4, "Bench press (typed) joins the library's Barbell bench press");
  assert.equal(bench.s[0][0], day(0));
  assert.deepEqual(bench.b, { kg: 67.5, r: 3, d: day(0) });
  assert.equal(bench.n, "Bench press", "the name you used last");
  const curl = rows.find((r) => r.m === "id:dumbbell-curl")!;
  assert.equal((curl as { e?: number }).e, 1);
  const run = rows.find((r) => r.m === "act:run")! as import("../src/core/gymsquad.ts").GymExAct;
  assert.equal(run.c, 3); assert.equal(run.b!.km, 6); assert.equal(run.p!.s, 333);
  const many = Array.from({ length: 14 }, (_, i) => wk(-20 + i, [["Leg press", "leg-press", [[100 + i, 10]]]]));
  assert.equal((G.buildExRows(many, [], TODAY).find((r) => r.m === "id:leg-press")!.s).length, 10, "last 10 sessions only");
});

// ---------- sleep ----------
await ok("sleep card: hours and streak only, nothing when Sleep sharing is off in the Sleep settings", () => {
  const logs = [1, 2, 3].map((k) => SL.makeLog({ start: Date.parse(`${day(-k + 1)}T00:00:00Z`) - 8 * 3600e3, end: Date.parse(`${day(-k + 1)}T00:00:00Z`), tz: "UTC" })!);
  const c = G.buildSleep(logs, {}, TODAY)!;
  assert.equal(c.last, 480); assert.equal(c.streak, 3); assert.equal(c.logged, 3);
  assert.deepEqual(Object.keys(c).sort(), ["avg", "last", "lastDay", "logged", "on", "streak", "target", "v"]);
  assert.equal(G.buildSleep(logs, { sleepShare: false }, TODAY), null);
});

// ---------- the opt-out gate ----------
await ok("a switched off piece is never sealed: sealForSquad returns null for fitness and sleep", async () => {
  const key = { raw: await C.newSquadKey(), gen: 1 };
  assert.equal(await SS.sealForSquad({ fitness: false }, "fitness", key, S1, "a"), null);
  assert.equal(await SS.sealForSquad({ sleep: false }, "sleep", key, { v: 1 }, "a"), null);
  assert.ok(await SS.sealForSquad({ fitness: true }, "fitness", key, S1, "a"));
  assert.ok(SS.SHARE_PIECES.find((p) => p.id === "fitness")!.ready && SS.SHARE_PIECES.find((p) => p.id === "sleep")!.ready);
});

// ---------- reading what others share ----------
await ok("what arrives is checked: bad fields dropped, text trimmed, wrong shapes refused", () => {
  const s = G.cleanSum({ v: 1, days: [["2026-11-01", 100, 2, 1], ["bad", 1, 1, 1], ["2026-11-02", "x", -5, 7]], pb: [{ id: "a b", d: "2026-11-01", m: "x", k: "kg" }, { id: "ok1", x: "Bench\u0000press" + "x".repeat(200), d: "2026-11-01", m: "id:b", k: "kg", kg: 60, r: 5 }], better: { pct: 500, n: 1 } })!;
  assert.deepEqual(s.days, [["2026-11-01", 100, 2, 1], ["2026-11-02", 0, 0, 0]]);
  assert.equal(s.pb.length, 1); assert.equal(s.pb[0].x.length, 80); assert.ok(!s.pb[0].x.includes("\u0000"));
  assert.equal(s.better, null);
  assert.equal(G.cleanSum({ v: 2, days: [] }), null);
  assert.equal(G.cleanEx({ v: 1, t: "lift", m: "id:x", s: "no" }), null);
  const e = G.cleanEx({ v: 1, t: "lift", m: "id:x", n: "X", b: null, x: 50, c: 2, s: [["2026-11-01", [[60, 5, 0], [null, 10, 1], "bad"]]] })!;
  assert.deepEqual(e.s[0][1], [[60, 5, 0], [null, 10, 1]]);
  assert.equal(G.cleanPost({ k: "re", to: "11111111-1111-4111-8111-111111111111", pb: "s1", e: "<script>" }), null, "only the five reactions");
  assert.equal(G.cleanPost({ k: "ch", metric: "days", from: "2026-11-01", to: "2026-12-30" }), null, "a challenge is at most a month");
  assert.equal((G.cleanPost({ k: "cm", to: "11111111-1111-4111-8111-111111111111", pb: "s1", t: "  nice\n lift  " }) as { t: string }).t, "nice lift");
});

// ---------- boards and challenges ----------
await ok("boards: ranked, ties share a rank, people who do not share are counted, not shown", () => {
  const mk = (days: [number, number, number][]) => ({ v: 1 as const, days: days.map(([k, v, km]) => [day(k), v, km, 1] as [string, number, number, 0 | 1]), pb: [], better: null });
  const people = [
    { id: "a", name: "Sam", me: false, sum: mk([[-1, 1000, 0], [0, 500, 0]]), sleep: null },
    { id: "b", name: "You", me: true, sum: mk([[-2, 3000, 5], [0, 100, 0]]), sleep: { v: 1 as const, streak: 4, avg: 450, last: 480, lastDay: TODAY, on: 4, logged: 5, target: 420 } },
    { id: "c", name: "Kai", me: false, sum: null, sleep: null },
  ];
  const b = G.boards(people, TODAY);
  const showed = b.find((x) => x.id === "showed")!;
  assert.deepEqual(showed.rows.map((r) => r.rank), [1, 1]);
  assert.equal(showed.rows[0].name, "You", "you first in a tie");
  assert.equal(showed.missing, 1);
  const vol = b.find((x) => x.id === "volume")!;
  assert.equal(vol.rows[0].id, "b"); assert.equal(vol.rows[0].text, "3,100 kg"); assert.equal(vol.rows[0].sub, "and 5 km");
  assert.equal(b.find((x) => x.id === "sleep")!.rows.length, 1);
  const ch = { id: "c1", by: "a", metric: "volume" as const, from: day(-2), to: day(4), joined: ["a", "b", "c"] };
  const t = G.challengeTable(ch, people);
  assert.deepEqual(t.map((r) => [r.id, r.score]), [["b", 3100], ["a", 1500], ["c", null]]);
  assert.equal(G.challengeState(ch, TODAY), "on");
  assert.equal(G.fmtScore("km", 5.04), "5 km");
});

// ---------- ids, tags, additional data ----------
await ok("the compare tag is the same on everyone's device for one exercise and gen, and nothing else", async () => {
  const k1 = await C.newSquadKey(), k2 = await C.newSquadKey();
  const m = G.matchKey({ name: "Incline BB bench" });
  assert.equal(await G.exTag(k1, m), await G.exTag(k1, G.matchKey({ name: "incline bench press" })));
  assert.notEqual(await G.exTag(k1, m), await G.exTag(k2, m), "a new key gen gives new tags");
  assert.match(await G.exTag(k1, m), /^[0-9a-f]{16}$/);
  const s = C.newSecret();
  assert.equal(await G.gymRowId(s, "sum"), await G.gymRowId(s, "sum"));
  assert.notEqual(await G.gymRowId(s, "sum"), await G.gymRowId(C.newSecret(), "sum"), "unlinkable across members");
  assert.equal(await G.reactId(s, "m", "p"), await G.reactId(s, "m", "p"), "one reaction per best: a new pick replaces it");
});
await ok("a row sealed for one member cannot be passed off as another's", async () => {
  const k = await C.newSquadKey();
  const ct = await C.seal(k, S1, G.gymAad.row("sq", "m1", "r1", "sum", 1));
  assert.deepEqual(await C.open(k, ct, G.gymAad.row("sq", "m1", "r1", "sum", 1)), S1);
  await assert.rejects(C.open(k, ct, G.gymAad.row("sq", "m2", "r1", "sum", 1)));
  await assert.rejects(C.open(k, ct, G.gymAad.row("sq", "m1", "r1", "sleep", 1)));
});

// ---------- activities ----------
await ok("activities: time and distance as people type them, pace per kind", () => {
  assert.equal(A.parseTime("25:30"), 1530); assert.equal(A.parseTime("1:05:00"), 3900); assert.equal(A.parseTime("45"), 2700);
  assert.equal(A.parseTime("1h 5m"), 3900); assert.equal(A.parseTime("abc"), null);
  assert.equal(A.parseKm("5,2"), 5.2); assert.equal(A.parseKm("800 m"), 0.8); assert.equal(A.parseKm("-3"), null);
  assert.equal(A.fmtPace("run", 5, 1530), "5:06 /km"); assert.equal(A.fmtPace("ride", 20, 2400), "30 km/h"); assert.equal(A.fmtPace("swim", 1, 1200), "2:00 /100 m");
  assert.equal(A.cleanActivity({ kind: "fly", date: "2026-11-01", km: 1, secs: 1 }), null);
  assert.equal(A.cleanActivity({ kind: "run", date: "2026-11-01", km: 0, secs: 1 }), null);
});

// ---------- screen ops ----------
await ok("ops from the Tab list are checked field by field", async () => {
  const { cleanGymOp } = await import("../src/squad/gymview.ts");
  const u = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(cleanGymOp({ op: "react", to: u, pb: "s1", e: "🔥" }), { op: "react", to: u, pb: "s1", e: "🔥" });
  assert.equal(cleanGymOp({ op: "react", to: u, pb: "s 1", e: "🔥" }), null);
  assert.equal(cleanGymOp({ op: "share", piece: "money", on: false }), null, "only fitness and sleep from here");
  assert.equal(cleanGymOp({ op: "challenge", metric: "days", days: 5, from: TODAY }), null, "1, 2 or 4 weeks");
  assert.equal((cleanGymOp({ op: "comment", to: u, pb: "s1", t: "x".repeat(500) }) as { t: string }).t.length, 200);
});

await ok("the Tab list's copy: what the main page sends comes through, anything odd is dropped", async () => {
  const V = await import("../src/squad/gymview.ts");
  const u = "11111111-1111-4111-8111-111111111111";
  V.setGymMirror({ on: true, in: true, me: u, share: { fitness: false }, loaded: true, error: null,
    members: [{ id: u, name: "Sam", me: true, working: true }, "junk"], cards: [{ id: u, sum: S1, sleep: { v: 9 } }],
    posts: [{ id: u, by: u, at: "x", post: { k: "re", to: u, pb: "s1", e: "🔥" } }, { id: u, by: u, at: "x", post: { k: "re", to: u, pb: "s1", e: "<b>" } }],
    ex: { key: "id:x", loading: false, rows: [{ member: u, ex: { v: 1, t: "lift", m: "id:x", n: "X", b: null, x: 0, c: 1, s: [] } }, { member: u, ex: { v: 2 } }] } });
  const m = V.gymMirror.get();
  assert.equal(m.members.length, 1); assert.equal(m.share.fitness, false); assert.equal(m.share.sleep, true);
  assert.deepEqual(m.cards[0].sum, S1); assert.equal(m.cards[0].sleep, null);
  assert.equal(m.posts.length, 1); assert.equal(m.ex!.rows.length, 1);
  V.setGymMirror(null);
  assert.equal(V.gymMirror.get().on, false, "locked: nothing");
});

console.log(`\n${n} checks passed`);

// Live check of G Squad Fitness on the hub (V1.40): node --experimental-strip-types scripts/gym-hub-check.ts
// Talks ONLY to the hub project (zxhvchchfrkfqxuyorqo), with three fictional members ("Alex", "Sam", "Kit") and
// fictional workouts. Runs the same code PS runs (src/squad/gymplan.ts: what is shared, sealing, the change only plan,
// opening), checks the hub refuses what it must, then everyone leaves, which deletes the test squad and with it every
// gym row and post. Never touches any vault project. Prints the bytes each act moved (the egress estimate).
import assert from "node:assert/strict";
import { createSquad, joinSquad, makeInvite, apiFor } from "../src/squad/flows.ts";
import { HubError, hubBytes } from "../src/squad/hub.ts";
import { GYM_FN, gymCall, gymPlan, gymWanted, openGymPost, openGymRow, sealGymPost, type GymInput, type PullOut } from "../src/squad/gymplan.ts";
import { currentKey, openCard, type SquadRec } from "../src/core/squadrec.ts";
import { signRequest, newUuid } from "../src/core/squadcrypto.ts";
import { addDays, boards, cleanEx, cleanSum, exTag, matchKey, reactId, type GymSum, type GymEx } from "../src/core/gymsquad.ts";
import { makeLog } from "../src/core/sleep.ts";
import type { FitWorkout } from "../src/core/fitness.ts";

const TODAY = new Date().toISOString().slice(0, 10);
const day = (k: number) => addDays(TODAY, k);
const step = async (name: string, fn: () => Promise<void>) => { await fn(); console.log("ok -", name); };
const rejects = async (p: Promise<unknown>, status: number) => {
  try { await p; } catch (e) { assert.ok(e instanceof HubError, String(e)); assert.equal((e as HubError).status, status, (e as Error).message); return; }
  assert.fail(`expected ${status}`);
};
const who = (r: SquadRec) => ({ member: r.memberId, priv: r.sign.priv });
let sid = 0;
function wk(k: number, exs: [string, string | null, [number, number][]][]): { id: string; data: FitWorkout } {
  const at = `${day(k)}T15:00:00.000Z`;
  return { id: `w${k}${sid}`, data: { programId: null, dayId: null, dayName: "Free workout", week: 1, date: day(k), startedAt: at, endedAt: at, at, note: "FICTIONAL private note",
    exercises: exs.map(([name, exId, sets], i) => ({ id: `e${i}`, exId, name, at, note: "seat on 4", sets: sets.map(([kg, reps]) => ({ id: `s${++sid}`, kg, reps, rir: 2, done: true, at })) })) } };
}
const sleepLogs = (n: number) => Array.from({ length: n }, (_, i) => makeLog({ start: Date.parse(`${day(-i)}T00:00:00Z`) - 8 * 3600e3, end: Date.parse(`${day(-i)}T00:00:00Z`), tz: "UTC" })!);
const input = (workouts: GymInput["workouts"], acts: GymInput["acts"] = [], prefs: GymInput["prefs"] = {}, sleep = 0): GymInput =>
  ({ workouts, acts, prefs, today: TODAY, sleepLogs: sleepLogs(sleep), sleepToday: TODAY });

async function sync(r: SquadRec, opts: Record<string, boolean>, x: GymInput) {
  const have = new Map((await gymCall<{ rows: { id: string; fp: string; part: string }[] }>(who(r), "gym_mine", {})).rows.map((y) => [y.id, { fp: y.fp }]));
  const plan = await gymPlan(r, opts, await gymWanted(r, opts, x), have);
  if (plan.put.length) await gymCall(who(r), "gym_put", { rows: plan.put });
  if (plan.del.length) await gymCall(who(r), "gym_del", { ids: plan.del });
  return plan;
}
async function pull(r: SquadRec, args: Record<string, unknown> = {}) {
  const p = await gymCall<PullOut>(who(r), "gym_pull", { cards: true, ...args });
  const sums = new Map<string, GymSum | null>(), exs: { member: string; ex: GymEx }[] = [], names = new Map<string, string>();
  for (const m of p.members) names.set(m.id, (await openCard(r, m.id, m.card_ct, m.card_gen))?.n ?? "?");
  for (const row of p.rows) if (row.part === "sum") sums.set(row.member_id, row.deleted ? null : cleanSum(await openGymRow(r, row)));
  for (const row of p.ex) if (!row.deleted) { const e = cleanEx(await openGymRow(r, row)); if (e) exs.push({ member: row.member_id, ex: e }); }
  const posts = await Promise.all(p.posts.filter((x) => !x.deleted).map(async (x) => ({ id: x.id, by: x.member_id, post: await openGymPost(r, x) })));
  return { p, sums, exs, names, posts, raw: p };
}

const A = await createSquad("Gym Check Squad", "Alex");
let B = A, C = A;
const gone = new Set<string>();
try {
  B = await joinSquad((await makeInvite(A, "https://cincee.com/client/")).link, "Sam");
  C = await joinSquad((await makeInvite(A, "https://cincee.com/client/")).link, "Kit");
  const WA = [wk(-30, [["Incline barbell bench press", "incline-barbell-bench-press", [[60, 8]]]]), wk(-6, [["Incline barbell bench press", "incline-barbell-bench-press", [[75, 5]]]]),
    wk(-1, [["Incline barbell bench press", "incline-barbell-bench-press", [[45, 10], [45, 10]]], ["Lat pulldown", "lat-pulldown", [[55, 10]]]])];
  const WB = [wk(-2, [["Back squat", "back-squat", [[100, 5]]]])];
  const WC = [wk(-3, [["Incline BB bench", null, [[50, 8]]]]), wk(-1, [["incline bench", null, [[52.5, 8]]], ["Sit-table bicep curl thing", null, [[20, 12]]]])];
  const AA = [{ id: "run1", data: { kind: "run" as const, date: day(-4), km: 5, secs: 1650, at: "x" } }];

  await step("each member shares: board card, one row per exercise, sleep only where switched on", async () => {
    const pa = await sync(A, {}, input(WA, AA, { weekGoal: 4 }, 3));
    assert.deepEqual(pa.put.map((x) => x.part).sort(), ["ex", "ex", "ex", "sleep", "sum"]);
    await sync(B, {}, input(WB, [], { sleepShare: false }, 3));   // Sam's Sleep screen sharing is off: no sleep row
    await sync(C, {}, input(WC));
    const mine = await gymCall<{ rows: { part: string }[] }>(who(B), "gym_mine", {});
    assert.ok(!mine.rows.some((r) => r.part === "sleep"), "Sam's sleep never left");
  });
  await step("change only: a second sync with nothing new sends nothing", async () => {
    const again = await sync(A, {}, input(WA, AA, { weekGoal: 4 }, 3));
    assert.equal(again.put.length + again.del.length, 0);
  });
  await step("Sam's boards: everyone's card opens, names from the sealed member cards", async () => {
    const s = await pull(B);
    assert.equal(s.sums.size, 3);
    assert.deepEqual([...s.names.values()].sort(), ["Alex", "Kit", "Sam"]);
    const people = [...s.sums].map(([id, sum]) => ({ id, name: s.names.get(id)!, me: id === B.memberId, sum, sleep: null }));
    const showed = boards(people, TODAY).find((b) => b.id === "showed")!;
    assert.equal(showed.rows.length, 3);
    const alex = s.sums.get(A.memberId)!;
    assert.ok(alex.days.some((d) => d[0] === day(-4) && d[2] === 5), "Alex's run counts as a day with its km");
    assert.ok(!JSON.stringify(alex).includes("FICTIONAL private note"));
  });
  await step("compare: Sam pulls only incline bench, and Kit's own spelling matches Alex's", async () => {
    const key = matchKey({ name: "Incline barbell bench press", exId: "incline-barbell-bench-press" });
    const s = await pull(B, { boards: false, tags: [await exTag(currentKey(B).raw, key)] });
    assert.equal(s.raw.rows.length + s.raw.posts.length, 0, "boards: false pulls no boards");
    const by = new Map(s.exs.map((e) => [e.member, e.ex]));
    assert.deepEqual([...by.keys()].sort(), [A.memberId, C.memberId].sort());
    const a = by.get(A.memberId)! as Extract<GymEx, { t: "lift" }>;
    assert.equal(a.b!.kg, 75, "best 75 kg");
    assert.deepEqual(a.s[0][1], [[45, 10, 0], [45, 10, 0]], "most recent 45 kg");
    assert.equal(by.get(C.memberId)!.n, "incline bench");
    assert.ok(!JSON.stringify(s.exs).includes("seat on 4"), "plan notes never shared");
  });
  await step("posts: a challenge, a join, a reaction (one per person, replaced), a comment, taken back", async () => {
    const ch = newUuid();
    const post = async (r: SquadRec, id: string, v: Parameters<typeof sealGymPost>[3]) => { const s = await sealGymPost(r, {}, id, v); await gymCall(who(r), "gym_post", { id, ct: s!.ct, gen: s!.gen }); };
    await post(A, ch, { k: "ch", metric: "volume", from: TODAY, to: day(6) });
    await post(B, newUuid(), { k: "join", ch });
    const pb = (await pull(B)).sums.get(A.memberId)!.pb[0];
    assert.ok(pb, "Alex has a best to react to");
    const rid = await reactId(B.secret, A.memberId, pb.id);
    await post(B, rid, { k: "re", to: A.memberId, pb: pb.id, e: "🔥" });
    await post(B, rid, { k: "re", to: A.memberId, pb: pb.id, e: "💪" });
    const cm = newUuid();
    await post(B, cm, { k: "cm", to: A.memberId, pb: pb.id, t: "75 kg, nice" });
    let seen = (await pull(A)).posts;
    assert.equal(seen.filter((p) => p.post?.k === "re").length, 1);
    assert.equal((seen.find((p) => p.post?.k === "re")!.post as { e: string }).e, "💪");
    assert.ok(seen.some((p) => p.post?.k === "cm" && (p.post as { t: string }).t === "75 kg, nice"));
    assert.ok(seen.some((p) => p.post?.k === "ch") && seen.some((p) => p.post?.k === "join"));
    await gymCall(who(B), "gym_unpost", { ids: [cm] });
    seen = (await pull(A)).posts;
    assert.ok(!seen.some((p) => p.post?.k === "cm"));
    await rejects(gymCall(who(A), "gym_post", { id: rid, ct: (await sealGymPost(A, {}, rid, { k: "cm", to: B.memberId, pb: "x", t: "hijack" }))!.ct, gen: 1 }), 403);
  });
  await step("Kit switches Fitness off: nothing is sealed, the hub's copies go, Sam's next pull sees them gone", async () => {
    const s0 = await pull(B);
    const want = await gymWanted(C, { fitness: false }, input(WC));
    assert.equal(want.length, 0, "nothing of Fitness is even built");
    assert.equal(await sealGymPost(C, { fitness: false }, newUuid(), { k: "join", ch: newUuid() }), null, "no posts either");
    await gymCall(who(C), "gym_del", { parts: ["sum", "ex"] });
    const s1 = await pull(B, { r: new Date(Date.parse(s0.p.now) - 5000).toISOString(), p: s0.p.now });
    assert.equal(s1.sums.get(C.memberId), null, "Kit's card is a tombstone now");
    const key = matchKey({ name: "incline bench" });
    const s2 = await pull(B, { boards: false, tags: [await exTag(currentKey(B).raw, key)] });
    assert.ok(!s2.exs.some((e) => e.member === C.memberId));
    const mine = await gymCall<{ rows: unknown[] }>(who(C), "gym_mine", {});
    assert.equal(mine.rows.length, 0);
  });
  await step("the hub refuses: someone else's row id, a replay, a bad signature, an old request, a stranger, an untagged exercise", async () => {
    const aRow = (await gymCall<{ rows: { id: string; part: string }[] }>(who(A), "gym_mine", {})).rows.find((r) => r.part === "sum")!;
    await rejects(gymCall(who(B), "gym_put", { rows: [{ id: aRow.id, part: "sum", ct: "AAAA", gen: 1, fp: "0".repeat(32) }] }), 403);
    await rejects(gymCall(who(B), "gym_put", { rows: [{ id: newUuid(), part: "ex", ct: "AAAA", gen: 1, fp: "0".repeat(32) }] }), 400);
    const req = await signRequest(A.sign.priv, "gym_mine", A.memberId, {});
    const send = (b: unknown) => fetch(GYM_FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    assert.equal((await send(req)).status, 200);
    assert.equal((await send(req)).status, 409, "a replayed request");
    const forged = await signRequest(B.sign.priv, "gym_mine", A.memberId, {});
    assert.equal((await send(forged)).status, 401, "signed with someone else's key");
    const old = await signRequest(A.sign.priv, "gym_mine", A.memberId, {}, Date.now() - 5 * 60_000);
    assert.equal((await send(old)).status, 401, "five minutes old");
    assert.equal((await send(await signRequest(A.sign.priv, "gym_mine", newUuid(), {}))).status, 403, "not a member");
    assert.equal((await send(await signRequest(A.sign.priv, "beat", A.memberId, {}))).status, 400, "a core act is not a gym act");
  });
  await step("names travel only when asked: a pull without cards sends ids only", async () => {
    const p = await gymCall<PullOut>(who(B), "gym_pull", { boards: false });
    assert.equal(p.members.length, 3);
    assert.ok(p.members.every((m) => m.card_ct === null));
  });
  await step("a member who leaves drops off everyone's boards at once", async () => {
    await apiFor(C).leave(); gone.add(C.memberId);
    const s = await pull(B);
    assert.ok(!s.p.members.some((m) => m.id === C.memberId));
  });
} finally {
  for (const r of [C, B, A]) if (!gone.has(r.memberId)) { try { await apiFor(r).leave(); } catch { /* already out */ } }
}
console.log("\nbytes per act (this run):");
for (const [act, b] of Object.entries(hubBytes)) console.log(`  ${act.padEnd(12)} calls ${String(b.calls).padStart(3)}  up ${String(b.up).padStart(7)}  down ${String(b.down).padStart(7)}`);

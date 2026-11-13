// Live check of the G Squad Leaderboard and Screen time cards (V1.40): node --experimental-strip-types scripts/gsquad-board-hub-check.ts
// Talks ONLY to the hub project (zxhvchchfrkfqxuyorqo), function `board`, with three fictional members ("Alex", "Sam",
// "Kit"). It runs the calls PS makes (src/squad/boardhub.ts, core/squadboard.ts), checks the hub refuses what it must,
// then everyone leaves, which deletes the test squad and every card with it. Never touches any vault project.
// Prints the bytes each act moved (the egress estimate).
import assert from "node:assert/strict";
import * as S from "../src/core/squadcrypto.ts";
import { currentKey } from "../src/core/squadrec.ts";
import { buildBoard, cleanMoney, planBoardSync, type BoardKind, type HeldCard } from "../src/core/squadboard.ts";
import { HUB_URL, hubBytes, HubError } from "../src/squad/hub.ts";
import { apiFor, createSquad, joinSquad, makeInvite } from "../src/squad/flows.ts";
import { BOARD_FN, boardApi, takeBoardRows } from "../src/squad/boardhub.ts";
import type { Doc, ScreenTimeDay, Todo } from "../src/core/model.ts";

const results: string[] = [];
const step = async (name: string, fn: () => Promise<void>) => { await fn(); results.push(name); console.log("ok -", name); };
const rejects = async (p: Promise<unknown>, status: number) => {
  try { await p; } catch (e) { assert.ok(e instanceof HubError, String(e)); assert.equal((e as HubError).status, status, (e as Error).message); return; }
  assert.fail(`expected ${status}`);
};
const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const todo = (id: string, data: Partial<Todo>): Doc<Todo> => ({ id, ws: null, kind: "todo", author: null, updatedAt: null, data: { title: "Task", type: "once", done: false, order: 0, sqOn: true, ...data } as Todo });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(now);
const screen = (secs: number): Doc<ScreenTimeDay>[] => [{ id: "s", ws: null, kind: "screentime", author: null, updatedAt: null,
  data: { day: today, device: "mac", apps: [{ id: "com.example.Editor", name: "Editor", secs }, { id: "com.1password.1password", name: "1Password", secs: 999 }], updatedAt: iso(now) } }];
const lastMonth = (() => { const d = new Date(now); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();

let A = await createSquad("Board Check", "Alex");
let B = A, C = A;
const left = new Set<string>();
const sync = (r: typeof A, settings: Record<string, unknown>, todos: Doc<Todo>[], sc: Doc<ScreenTimeDay>[], have: Map<string, string>) =>
  planBoardSync({ settings, todos, screen: sc, squad: r.squadId, member: r.memberId, secret: r.secret, key: currentKey(r), have, now, deviceTz: "Asia/Dubai" });
const mine = async (r: typeof A) => new Map((await boardApi(r).mine()).rows.map((x) => [x.kind, x.fp]));
try {
  await step("setup: Sam and Kit join Alex's squad", async () => {
    B = await joinSquad((await makeInvite(A, "https://cincee.com/client/")).link, "Sam");
    C = await joinSquad((await makeInvite(A, "https://cincee.com/client/")).link, "Kit");
  });
  const aTodos = [todo("a1", { done: true, doneAt: iso(now - 60_000) }), todo("a2", { done: true, doneAt: iso(now - 120_000), sqAnon: true }), todo("a3", { done: true, doneAt: iso(now), sqOff: true })];
  await step("Alex shares all three cards, sealed; a second look sends nothing", async () => {
    const plan = await sync(A, { squadShare: { tasks: true }, squadMoney: { m: { [lastMonth]: 12500 } } }, aTodos, screen(5400), new Map());
    assert.deepEqual(plan.put.map((r) => r.kind).sort(), ["money", "screen", "tasks"]);
    await boardApi(A).put(plan.put);
    const have = await mine(A);
    assert.equal(have.size, 3);
    assert.deepEqual(await sync(A, { squadShare: { tasks: true }, squadMoney: { m: { [lastMonth]: 12500 } } }, aTodos, screen(5400), have), { put: [], del: [] });
  });
  await step("Sam has Money and Screen time switched off: only the tasks card is ever sent", async () => {
    const plan = await sync(B, { squadShare: { tasks: true, money: false, screen: false }, squadMoney: { m: { [lastMonth]: 99000 } } }, [todo("b1", { done: true, doneAt: iso(now - 60_000) })], screen(9000), new Map());
    assert.deepEqual(plan.put.map((r) => r.kind), ["tasks"]);
    await boardApi(B).put(plan.put);
    assert.deepEqual([...(await mine(B)).keys()], ["tasks"]);
  });
  const kitCards = new Map<string, Map<BoardKind, HeldCard>>();
  let since: string | null = null;
  await step("Kit pulls: Alex's three cards and Sam's one open with the squad key", async () => {
    await new Promise((r) => setTimeout(r, 6_000));   // past the pull's 5 s overlap, so the cursor check below is exact
    const p = await boardApi(C).pull(null);
    await takeBoardRows(C, p.rows, kitCards);
    since = new Date(Date.parse(p.now) - 5_000).toISOString();
    assert.deepEqual([...kitCards.get(A.memberId)!.keys()].sort(), ["money", "screen", "tasks"]);
    assert.deepEqual([...kitCards.get(B.memberId)!.keys()], ["tasks"]);
    assert.deepEqual(kitCards.get(A.memberId)!.get("tasks")!.card, { m: { [today.slice(0, 7)]: 2 }, d: { [today]: 2 } }, "Not shared never counts, anonymised does");
    assert.deepEqual((kitCards.get(A.memberId)!.get("screen")!.card as { d: Record<string, number[]> }).d[today], [5400, 0], "1Password never counted");
  });
  await step("Kit's Leaderboard (ranking only): Alex ranks, Sam shows Not shared, no amount of Alex's reaches Kit's view", async () => {
    const members = [{ id: C.memberId, me: true }, { id: A.memberId, me: false }, { id: B.memberId, me: false }];
    const v = buildBoard({ members, cards: kitCards, myMoney: cleanMoney({}), myShare: {}, now, deviceTz: "Asia/Dubai", loaded: true });
    const row = (id: string) => v.money["1"].find((e) => e.member === id)!;
    assert.deepEqual([row(A.memberId).state, row(A.memberId).rank, row(A.memberId).amount], ["ok", 1, undefined]);
    assert.equal(row(B.memberId).state, "off");
    assert.ok(!JSON.stringify(v).includes("12500"));
    assert.equal(v.tasks["7d"].find((e) => e.member === A.memberId)!.n, 2);
    assert.equal(v.screen.find((e) => e.member === A.memberId)!.today, 5400);
  });
  await step("change only: a pull with a cursor is empty when nothing changed", async () => {
    const p = await boardApi(C).pull(since);
    assert.equal(p.rows.length, 0);
  });
  await step("Alex switches Screen time off: the card is taken away and Kit's next pull sees it go", async () => {
    const plan = await sync(A, { squadShare: { tasks: true, screen: false }, squadMoney: { m: { [lastMonth]: 12500 } } }, aTodos, screen(6000), await mine(A));
    assert.deepEqual(plan, { put: [], del: ["screen"] });
    await boardApi(A).del(plan.del);
    const p = await boardApi(C).pull(since);
    assert.deepEqual(p.rows.map((r) => [r.member_id === A.memberId, r.kind, r.deleted, r.ct]), [[true, "screen", true, ""]]);
    await takeBoardRows(C, p.rows, kitCards);
    assert.ok(!kitCards.get(A.memberId)!.has("screen"));
  });
  await step("the hub refuses a bad kind, a gen it does not have, too many rows and an odd fingerprint", async () => {
    const ok = (await sync(A, { squadMoney: { m: { [lastMonth]: 1 } } }, aTodos, [], new Map())).put[0];
    await rejects(boardApi(A).put([{ ...ok, kind: "bank" as BoardKind }]), 400);
    await rejects(boardApi(A).put([{ ...ok, gen: 7 }]), 400);
    await rejects(boardApi(A).put([ok, ok, ok, ok]), 400);
    await rejects(boardApi(A).put([ok, { ...ok }]), 400);
    await rejects(boardApi(A).put([{ ...ok, fp: "not hex" }]), 400);
  });
  await step("signatures: a changed body, an old clock, a replay, someone else's key and an outsider are refused", async () => {
    const post = (b: unknown) => fetch(BOARD_FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    const req = await S.signRequest(A.sign.priv, "board_mine", A.memberId, {});
    assert.equal((await post({ ...req, args: { x: 1 } })).status, 401);
    assert.equal((await post(req)).status, 200);
    assert.equal((await post(req)).status, 409, "the same request twice");
    assert.equal((await post(await S.signRequest(A.sign.priv, "board_mine", A.memberId, {}, Date.now() - 10 * 60_000))).status, 401);
    assert.equal((await post(await S.signRequest(B.sign.priv, "board_mine", A.memberId, {}))).status, 401, "Sam's key cannot speak as Alex");
    const stranger = await S.newSignPair();
    assert.equal((await post(await S.signRequest(stranger.priv, "board_pull", S.newUuid(), { since: null }))).status, 403);
    assert.equal((await post(await S.signRequest(A.sign.priv, "count", A.memberId, {}))).status, 400, "the core's acts are not this function's");
  });
  await step("the Data API gives nothing to anyone with the public key", async () => {
    const key = "sb_publishable_33J-egy3tJQGN8oHHr1ReA_8kTfid_Y";
    for (const t of ["board_cards", "board_nonces"]) {
      const r = await fetch(`${HUB_URL}/rest/v1/${t}?select=*`, { headers: { apikey: key } });
      const body = await r.text();
      assert.ok(r.status === 401 || r.status === 403 || r.status === 404 || body === "[]", `${t}: ${r.status} ${body.slice(0, 80)}`);
    }
    const rpc = await fetch(`${HUB_URL}/rest/v1/rpc/board_tidy`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: "{}" });
    assert.ok(rpc.status === 401 || rpc.status === 403 || rpc.status === 404, `rpc ${rpc.status}`);
  });
  await step("Kit leaves: Kit's own calls are refused and the others never get Kit's cards again", async () => {
    const plan = await sync(C, {}, [], screen(60), new Map());
    await boardApi(C).put(plan.put);
    await apiFor(C).leave(); left.add("C");
    await rejects(boardApi(C).pull(null), 403);
    const p = await boardApi(A).pull(null);
    assert.ok(!p.rows.some((r) => r.member_id === C.memberId));
  });
} finally {
  for (const [r, k] of [[C, "C"], [B, "B"], [A, "A"]] as const) if (!left.has(k)) { try { await apiFor(r).leave(); } catch { /* already gone */ } }
}
console.log(`\n${results.length} live checks passed. Test squad ${A.squadId} removed (everyone left).`);
console.log("Bytes per act (up / down, calls):");
for (const [act, b] of Object.entries(hubBytes)) console.log(`  ${act.padEnd(12)} ${String(b.calls).padStart(3)} calls  up ${Math.round(b.up / b.calls)} B  down ${Math.round(b.down / b.calls)} B  per call`);

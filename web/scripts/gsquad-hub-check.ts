// Live check of the G Squad hub (V1.40): node --experimental-strip-types scripts/gsquad-hub-check.ts
// Talks ONLY to the hub project (zxhvchchfrkfqxuyorqo) with three fictional members ("Alex", "Sam", "Kit"), runs the
// same flows PS runs (src/squad/flows.ts), checks the hub refuses what it must, then everyone leaves, which deletes
// the test squad. Never touches any vault project. Prints the bytes each act moved (the egress estimate).
import assert from "node:assert/strict";
import * as S from "../src/core/squadcrypto.ts";
import { currentKey } from "../src/core/squadrec.ts";
import { NEUTRAL_TITLE } from "../src/core/squadanon.ts";
import { planTaskSync } from "../src/core/squadshare.ts";
import { HUB_FN, HUB_URL, hubBytes, hubCall, HubError } from "../src/squad/hub.ts";
import { apiFor, createSquad, handTask, handView, joinSquad, makeInvite, memberView, refreshCard, rekeyIfNeeded, squadName, takeDrops, taskView } from "../src/squad/flows.ts";
import type { Doc, Todo } from "../src/core/model.ts";

const results: string[] = [];
const step = async (name: string, fn: () => Promise<void>) => { await fn(); results.push(name); console.log("ok -", name); };
const rejects = async (p: Promise<unknown>, status: number) => {
  try { await p; } catch (e) { assert.ok(e instanceof HubError, String(e)); assert.equal((e as HubError).status, status, (e as Error).message); return; }
  assert.fail(`expected ${status}`);
};
const todo = (id: string, data: Partial<Todo>): Doc<Todo> => ({ id, ws: null, kind: "todo", author: null, updatedAt: null, data: { title: "Task", type: "once", done: false, order: 0, sqOn: true, ...data } as Todo });
const CLIENTS = [{ name: "Northwind Silk", contactName: "Odette Lind" }];

let A = await createSquad("Check Squad", "Alex");
let B = A, C = A;
const left = new Set<string>();
try {
  await step("create: squad made, name sealed, card posted", async () => {
    const p = await apiFor(A).pull(null, 1);
    assert.equal(p.squad.gen, 1);
    assert.equal(await squadName(A, p.squad), "Check Squad");
    assert.equal(p.members.length, 1);
    assert.equal((await memberView(A, p.members[0], p.squad.created_by, new Set())).name, "Alex");
  });
  let link = "";
  await step("invite and join: Sam and Kit join with one time links", async () => {
    link = (await makeInvite(A, "https://cincee.com/client/")).link;
    B = await joinSquad(link, "Sam");
    C = await joinSquad((await makeInvite(A, "https://cincee.com/client/")).link, "Kit");
    assert.equal(currentKey(B).raw, currentKey(A).raw);
    assert.equal(B.squadId, A.squadId);
  });
  await step("a used invite never works again", async () => { await rejects(joinSquad(link, "Eve"), 403); });
  await step("a wrong secret after the # is refused", async () => {
    const l2 = (await makeInvite(A, "https://cincee.com/client/")).link;
    const id = S.parseSquadInvite(l2)!.inviteId;
    await rejects(joinSquad(`${id}.${S.newSecret().replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`, "Eve"), 403);
  });
  await step("members: three names, each card checked against the hub's keys", async () => {
    const p = await apiFor(B).pull(null, 1);
    const names = (await Promise.all(p.members.map((m) => memberView(B, m, p.squad.created_by, new Set())))).map((m) => m.name).sort();
    assert.deepEqual(names, ["Alex", "Kit", "Sam"]);
  });
  await step("working: beats count, a tiny reply", async () => {
    await apiFor(A).beat(); await apiFor(B).beat();
    const n = (await apiFor(C).count()).n;
    assert.equal(n, 2);
    const p = await apiFor(C).beat();
    assert.deepEqual({ n: p.n, h: p.h, g: p.g, rk: p.rk }, { n: 3, h: 0, g: 1, rk: false }, "the pulse: working, waiting, key gen, re-key");
  });
  const todos = [todo("t1", { title: "Send Northwind Silk the draft", p1: true }), todo("t2", { title: "Plan the week", order: 1 }), todo("t3", { title: "Salary talk", sqOff: true })];
  await step("shared tasks: Sam reads Alex's tasks, the client one anonymised, the Not shared one absent", async () => {
    const plan = await planTaskSync({ todos, settings: { squadShare: { tasks: true } }, clients: CLIENTS, squad: A.squadId, member: A.memberId, secret: A.secret, key: currentKey(A), have: new Map() });
    await apiFor(A).putTasks(plan.put);
    const p = await apiFor(B).pull(null, 1);
    const seen = (await Promise.all(p.tasks.map((t) => taskView(B, t)))).filter(Boolean).map((t) => t!.t).sort();
    assert.deepEqual(seen, [NEUTRAL_TITLE, "Plan the week"]);
    const mine = await apiFor(A).mine();
    assert.equal(mine.rows.length, 2);
  });
  await step("change only: nothing to send when nothing changed; a pull with a cursor is empty", async () => {
    const mine = new Map((await apiFor(A).mine()).rows.map((r) => [r.id, r.fp]));
    const plan = await planTaskSync({ todos, settings: { squadShare: { tasks: true } }, clients: CLIENTS, squad: A.squadId, member: A.memberId, secret: A.secret, key: currentKey(A), have: mine });
    assert.equal(plan.put.length + plan.del.length, 0);
    const p = await apiFor(B).pull(null, 1);
    const again = await apiFor(B).pull({ m: p.now, t: p.now, h: p.now }, 1);
    assert.equal(again.tasks.length + again.members.length + again.hands.length, 0);
  });
  await step("Tasks switched off: Alex's copies are taken away and nothing sealed is sent", async () => {
    const mine = new Map((await apiFor(A).mine()).rows.map((r) => [r.id, r.fp]));
    const plan = await planTaskSync({ todos, settings: { squadShare: { tasks: false } }, clients: CLIENTS, squad: A.squadId, member: A.memberId, secret: A.secret, key: currentKey(A), have: mine });
    assert.equal(plan.put.length, 0);
    await apiFor(A).delTasks(plan.del);
    assert.equal((await apiFor(A).mine()).rows.length, 0);
    const back = await planTaskSync({ todos, settings: { squadShare: { tasks: true } }, clients: CLIENTS, squad: A.squadId, member: A.memberId, secret: A.secret, key: currentKey(A), have: new Map() });
    await apiFor(A).putTasks(back.put);
  });
  await step("nobody can overwrite another member's task copy", async () => {
    const id = (await apiFor(A).mine()).rows[0].id;
    await rejects(apiFor(B).putTasks([{ id, ct: "AAAA", gen: 1, fp: "0123456789abcdef" }]), 403);
  });
  let handId = "";
  await step("hand a task: Sam accepts, Alex sees it", async () => {
    handId = (await handTask(A, apiFor(A), { tasks: true }, B.memberId, { t: "Plan the week", d: null }))!;
    const pb = await apiFor(B).pull(null, 1);
    const h = await handView(B, pb.hands.find((x) => x.id === handId)!);
    assert.equal(h?.t, "Plan the week");
    assert.equal(h?.state, "open");
    assert.equal((await apiFor(B).count()).h, 1, "Sam's button knows a hand over waits, without a pull");
    await apiFor(B).answer(handId, true);
    const pa = await apiFor(A).pull(null, 1);
    assert.equal(pa.hands.find((x) => x.id === handId), undefined, "an answered one is no longer open");
    const pa2 = await apiFor(A).pull({ h: new Date(Date.now() - 60_000).toISOString() }, 1);
    assert.equal(pa2.hands.find((x) => x.id === handId)?.state, "accepted");
    assert.equal(await handTask(A, apiFor(A), { tasks: false }, B.memberId, { t: "x", d: null }), null, "Tasks off: no hand over is sealed or sent");
  });
  await step("Kit cannot answer a hand over meant for Sam", async () => {
    const id2 = (await handTask(A, apiFor(A), { tasks: true }, B.memberId, { t: "Another", d: null }))!;
    await apiFor(C).answer(id2, true);
    const pb = await apiFor(B).pull(null, 1);
    assert.equal(pb.hands.find((x) => x.id === id2)?.state, "open");
  });
  await step("signatures: a changed body, an old clock and a replay are refused", async () => {
    const req = await S.signRequest(A.sign.priv, "count", A.memberId, {});
    const post = (b: unknown) => fetch(HUB_FN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    assert.equal((await post({ ...req, args: { x: 1 } })).status, 401);
    assert.equal((await post(req)).status, 200);
    assert.equal((await post(req)).status, 409, "the same request twice");
    const old = await S.signRequest(A.sign.priv, "count", A.memberId, {}, Date.now() - 10 * 60_000);
    assert.equal((await post(old)).status, 401);
    const other = await S.signRequest(B.sign.priv, "count", A.memberId, {});
    assert.equal((await post(other)).status, 401, "Sam's key cannot speak as Alex");
  });
  await step("the Data API gives nothing to anyone with the public key", async () => {
    const key = "sb_publishable_33J-egy3tJQGN8oHHr1ReA_8kTfid_Y";
    for (const t of ["squads", "squad_members", "squad_tasks", "squad_invites", "squad_keydrops", "squad_handoffs", "squad_nonces"]) {
      const r = await fetch(`${HUB_URL}/rest/v1/${t}?select=*`, { headers: { apikey: key } });
      const body = await r.text();
      assert.ok(r.status === 401 || r.status === 403 || r.status === 404 || body === "[]", `${t}: ${r.status} ${body.slice(0, 80)}`);
    }
    const rpc = await fetch(`${HUB_URL}/rest/v1/rpc/squad_tidy`, { method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: "{}" });
    assert.ok(rpc.status === 401 || rpc.status === 403 || rpc.status === 404, `rpc ${rpc.status}`);
  });
  await step("only the creator can take someone out", async () => { await rejects(apiFor(B).leave(C.memberId), 403); });
  await step("Kit leaves: the rest re-key, Kit is shut out and gets no new key", async () => {
    await apiFor(C).leave(); left.add("C");
    assert.equal((await apiFor(B).count()).rk, true, "the pulse says a re-key is due");
    const p = await apiFor(A).pull(null, currentKey(A).gen);
    assert.equal(p.squad.rekey, true);
    await rejects(makeInvite(A, "https://cincee.com/client/"), 409);
    A = await rekeyIfNeeded(A, apiFor(A), p, p.members, await squadName(A, p.squad));
    assert.equal(currentKey(A).gen, 2);
    const pb = await apiFor(B).pull(null, currentKey(B).gen);
    B = await takeDrops(B, pb.drops);
    assert.equal(currentKey(B).gen, 2);
    assert.equal(currentKey(B).raw, currentKey(A).raw);
    assert.equal(await squadName(B, pb.squad), "Check Squad");
    await refreshCard(A, apiFor(A), undefined); await refreshCard(B, apiFor(B), undefined);
    await rejects(apiFor(C).pull(null, 1), 403);
    // Kit's old key does not open anything sealed after the re-key.
    const plan = await planTaskSync({ todos, settings: { squadShare: { tasks: true } }, clients: CLIENTS, squad: A.squadId, member: A.memberId, secret: A.secret, key: currentKey(A), have: new Map((await apiFor(A).mine()).rows.map((r) => [r.id, r.fp])) });
    assert.equal(plan.put.length, 2, "a new gen re-seals every copy");
    await apiFor(A).putTasks(plan.put);
    const pb2 = await apiFor(B).pull(null, 2);
    const views = (await Promise.all(pb2.tasks.map((t) => taskView(B, t)))).filter(Boolean);
    assert.equal(views.length, 2);
    for (const t of pb2.tasks) assert.equal(await taskView(C, t), null);
    const names = (await Promise.all(pb2.members.map((m) => memberView(B, m, pb2.squad.created_by, new Set())))).map((m) => m.name).sort();
    assert.deepEqual(names, ["Alex", "Sam"]);
  });
  await step("an unknown act and a bad id are refused", async () => {
    await rejects(hubCall({ member: A.memberId, priv: A.sign.priv }, "drop_all", {}), 400);
    await rejects(hubCall({ member: "not-a-uuid", priv: A.sign.priv }, "count", {}), 400);
  });
} finally {
  for (const [r, k] of [[C, "C"], [B, "B"], [A, "A"]] as const) if (!left.has(k)) { try { await apiFor(r).leave(); } catch { /* already gone */ } }
}
console.log(`\n${results.length} live checks passed. Test squad ${A.squadId} removed (everyone left).`);
console.log("Bytes per act (up / down, calls):");
for (const [act, b] of Object.entries(hubBytes)) console.log(`  ${act.padEnd(10)} ${String(b.calls).padStart(3)} calls  up ${Math.round(b.up / b.calls)} B  down ${Math.round(b.down / b.calls)} B  per call`);

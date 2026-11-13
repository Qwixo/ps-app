// Live check of the G Squad chat on the hub (V1.40): node --experimental-strip-types scripts/gsquad-chat-hub-check.ts
// Talks ONLY to the hub project (zxhvchchfrkfqxuyorqo) with three fictional members ("Alex", "Sam", "Kit"), runs the
// same steps PS runs (src/squad/chatflows.ts), checks the history vote and that a newcomer cannot open older messages
// without a yes, then everyone leaves, which deletes the test squad and every chat row with it. Never touches any
// vault project. Prints the bytes each act moved (the egress estimate).
import assert from "node:assert/strict";
import * as S from "../src/core/squadcrypto.ts";
import { currentKey } from "../src/core/squadrec.ts";
import { chatAad, openMessage, voteCardDue, voteWords } from "../src/core/squadchat.ts";
import { hubBytes, HubError } from "../src/squad/hub.ts";
import { apiFor, createSquad, joinSquad, makeInvite } from "../src/squad/flows.ts";
import { ChatSession } from "../src/squad/chatflows.ts";

const results: string[] = [];
const step = async (name: string, fn: () => Promise<void>) => { await fn(); results.push(name); console.log("ok -", name); };
const rejects = async (p: Promise<unknown>, status: number, word?: RegExp) => {
  try { await p; } catch (e) {
    assert.ok(e instanceof HubError, String(e)); assert.equal((e as HubError).status, status, (e as Error).message);
    if (word) assert.match((e as Error).message, word);
    return;
  }
  assert.fail(`expected ${status}`);
};
const BASE = "https://cincee.com/client/";

const A = await createSquad("Chat Check", "Alex");
let B = A, C = A;
const left = new Set<string>();
const a = new ChatSession(A);
let b: ChatSession, c: ChatSession;
const oldRows: { id: string; member_id: string; epoch: number; ct: string }[] = [];
try {
  await step("first period: Alex's PS makes it (only Alex in), nothing to vote on", async () => {
    assert.equal((await a.tick()).rot, true);
    assert.equal(await a.rotateIfDue(), true);
    assert.equal(a.status!.epoch, 1);
    assert.equal(a.status!.rot, false);
    assert.ok(a.keys.has(1));
  });
  await step("Alex sends three messages, one about a gym log", async () => {
    await a.send({ t: "Morning all" });
    await a.send({ t: "Client call at 3" });
    await a.send({ t: "What are you doing?", a: { k: "gym", l: "Incline bench press, 80 kg x 8", w: A.memberId } });
    await a.pull();
    assert.deepEqual(a.list().map((m) => m.t), ["Morning all", "Client call at 3", "What are you doing?"]);
    assert.equal(a.list()[2].a?.l, "Incline bench press, 80 kg x 8");
    const p = await a.api.pull(null);
    for (const r of p.msgs) oldRows.push(r);
    assert.equal(oldRows.length, 3);
  });
  await step("Sam joins: the old period no longer takes messages until a new one exists", async () => {
    B = await joinSquad((await makeInvite(A, BASE)).link, "Sam");
    const raw = a.keys.get(1)!;
    const id = S.newUuid();
    const { sealMessage } = await import("../src/core/squadchat.ts");
    await rejects(a.api.post(id, 1, await sealMessage(raw, A.squadId, 1, A.memberId, id, { t: "sneaky" })), 409, /epoch/);
  });
  b = new ChatSession(B);
  await step("Sam's PS makes period 2 for Alex and Sam; the hub opens a history vote for Sam", async () => {
    assert.equal((await b.tick()).rot, true);
    assert.equal(await b.rotateIfDue(), true);
    assert.equal(b.status!.epoch, 2);
    assert.deepEqual([...b.keys.keys()], [2], "Sam holds the new period only");
    await a.tick();
    const v = a.votes.find((x) => x.j === B.memberId)!;
    assert.ok(v, "Alex is asked about Sam");
    assert.deepEqual({ voter: v.voter, mine: v.mine, res: v.res, n: v.n, k: v.k, msgs: v.msgs, from: v.from, be: v.be }, { voter: true, mine: null, res: null, n: 1, k: 0, msgs: 3, from: 1, be: 2 });
    assert.equal(voteCardDue(v, () => false), "ask");
    const w = voteWords("Sam", v, "ask", "Asia/Dubai");
    assert.equal(w.title, "Sam just joined the G Squad. Do you want them to see your entire conversation history?");
    assert.match(w.body, /all 3 messages sent in this chat before they joined, from 1 person/);
  });
  await step("without a yes Sam gets no old row and cannot open one: no key, and the squad key from the invite does not open it", async () => {
    await b.pull();
    assert.equal(b.list().length, 0, "the hub sent Sam none of the 3 older messages");
    assert.equal(b.locked, 0);
    assert.equal(currentKey(B).raw, currentKey(A).raw, "Sam does hold the squad key");
    for (const r of oldRows) {
      assert.equal(await openMessage(currentKey(B).raw, A.squadId, r.epoch, r.member_id, r.id, r.ct), null, "the squad key opens no chat message");
      for (const raw of b.keys.values()) assert.equal(await openMessage(raw, A.squadId, r.epoch, r.member_id, r.id, r.ct), null, "Sam's period key opens no older message");
    }
    const mine = b.myVote()!;
    assert.equal(mine.res, null);
    assert.equal(mine.voter, false);
    assert.equal(b.hasHistory(), false);
  });
  await step("Sam cannot vote on Sam, cannot hand anything to Sam, and nobody can hand history before a yes", async () => {
    await rejects(b.api.ballot(b.myVote()!.id, true), 409, /vote/);
    await rejects(a.api.give(b.myVote()!.id, [{ epoch: 1, sealed: "x" }]), 409, /vote/);
  });
  await step("both chat in period 2, and both can read it", async () => {
    await b.send({ t: "Hi, Sam here" });
    await a.pull();
    assert.equal(a.list().at(-1)!.t, "Hi, Sam here");
    assert.equal(a.list().at(-1)!.epoch, 2);
  });
  await step("Kit joins: period 3 for all three; Kit's vote asks Alex and Sam", async () => {
    C = await joinSquad((await makeInvite(A, BASE)).link, "Kit");
    c = new ChatSession(C);
    await c.tick();
    assert.equal(await c.rotateIfDue(), true);
    assert.equal(c.status!.epoch, 3);
    await b.tick();
    const v = b.votes.find((x) => x.j === C.memberId)!;
    assert.deepEqual({ voter: v.voter, n: v.n, msgs: v.msgs, from: v.from }, { voter: true, n: 2, msgs: 4, from: 2 });
  });
  await step("Alex says Yes to Sam: decided at once (Alex was the only one asked); Alex's PS hands Sam period 1", async () => {
    const vid = b.myVote()!.id;
    await a.vote(vid, true);
    await a.tick();
    assert.deepEqual(a.status!.give.map((g) => [g.j, g.e]), [[B.memberId, [1]]]);
    assert.equal(await a.giveIfDue(), 1);
    await a.tick();
    assert.equal(a.status!.give.length, 0, "nothing left to hand over");
    await b.pull();
    assert.equal(b.myVote()!.res, "yes");
    assert.equal(b.hasHistory(), true);
    assert.deepEqual(b.list().map((m) => m.t), ["Morning all", "Client call at 3", "What are you doing?", "Hi, Sam here"]);
  });
  await step("Kit's vote: Alex says Yes, Sam says No, so it is No at once; nobody can hand Kit anything", async () => {
    const vid = c.myVote()?.id ?? (await c.tick(), c.myVote()!.id);
    await a.vote(vid, true);
    await c.tick();
    assert.equal(c.myVote()!.res, null, "one Yes of two is not enough");
    await b.vote(vid, false);
    await c.pull();
    assert.equal(c.myVote()!.res, "no");
    await rejects(a.api.give(vid, [{ epoch: 1, sealed: "x" }]), 409, /vote/);
    assert.equal((await b.api.ballot(vid, true)).res, "no", "a decided vote keeps its result");
    assert.deepEqual([...c.keys.keys()], [3]);
    assert.equal(c.list().length, 0);
  });
  await step("only the author edits or deletes; edits say edited", async () => {
    const m = a.list().find((x) => x.t === "Client call at 3")!;
    await b.api.del(m.id);                      // not Sam's: the hub changes nothing
    await a.pull();
    assert.ok(a.msgs.has(m.id));
    await rejects(b.api.edit(m.id, "QUFBQQ=="), 404);
    await a.edit(m.id, "Client call at 4");
    await b.pull();
    assert.deepEqual([b.msgs.get(m.id)!.t, b.msgs.get(m.id)!.edited], ["Client call at 4", true]);
    await a.del(m.id);
    await b.pull();
    assert.equal(b.msgs.has(m.id), false, "deleted for everyone");
  });
  await step("unread: Kit sends two, Alex's tick counts them, reading clears it", async () => {
    await a.pull(); await a.markRead();
    await c.send({ t: "Kit here" });
    await c.send({ t: "Gym at 7?" });
    assert.equal((await a.tick()).u, 2);
    await a.pull(); await a.markRead();
    assert.equal((await a.tick()).u, 0);
  });
  await step("a tampered message (moved to another author) does not open", async () => {
    const p = await a.api.pull(null);
    const r = p.msgs.find((x) => x.member_id === C.memberId)!;
    assert.equal(await openMessage(a.keys.get(r.epoch)!, A.squadId, r.epoch, A.memberId, r.id, r.ct), null);
    assert.equal(chatAad.msg(A.squadId, r.epoch, r.member_id, r.id).includes(r.member_id), true);
  });
  await step("Kit leaves: Kit is shut out; the next period leaves Kit out", async () => {
    await apiFor(C).leave(); left.add("C");
    await rejects(c.api.tick(), 403);
    assert.equal((await a.tick()).rot, true);
    await a.rotateIfDue();
    assert.equal(a.status!.epoch, 4);
    await a.send({ t: "Just us two" });
    await b.pull();
    assert.equal(b.list().at(-1)!.t, "Just us two");
  });
  await step("a request signed for the core cannot be replayed to the chat", async () => {
    const req = await S.signRequest(A.sign.priv, "c_tick", A.memberId, {});
    const send = () => fetch("https://zxhvchchfrkfqxuyorqo.supabase.co/functions/v1/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
    assert.equal((await send()).status, 200);
    assert.equal((await send()).status, 409, "the same nonce twice is refused");
    const core = await S.signRequest(A.sign.priv, "count", A.memberId, {});
    const r = await fetch("https://zxhvchchfrkfqxuyorqo.supabase.co/functions/v1/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(core) });
    assert.equal(r.status, 400, "a core act is not a chat act");
  });
} finally {
  for (const [r, k] of [[C, "C"], [B, "B"], [A, "A"]] as const) if (!left.has(k)) { try { await apiFor(r).leave(); } catch { /* already gone */ } }
}
console.log(`\n${results.length} checks passed. Bytes per act (request up, answer down):`);
for (const [act, v] of Object.entries(hubBytes)) console.log(`  ${act.padEnd(10)} calls ${String(v.calls).padStart(3)}  up ${String(v.up).padStart(7)}  down ${String(v.down).padStart(7)}  (down per call ${Math.round(v.down / v.calls)})`);

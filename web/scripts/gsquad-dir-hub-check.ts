// Live check of the G Squad directory (V1.42): GSQUAD_TEST_CLAIM=<file> node --experimental-strip-types scripts/gsquad-dir-hub-check.ts
// Talks ONLY to the hub project (zxhvchchfrkfqxuyorqo), with fictional members ("Alex" the admin, "Sam", "Kit", "Eve").
// Needs a TEST claim code whose hash was put on the hub just for this run (never the developer's real code): it lists a test
// squad, runs Ask to join, Approve, Decline, Cancel and the key handover with the same code PS runs
// (src/squad/dirflows.ts), checks the hub refuses what it must, then everyone leaves (the test squad is deleted).
// Afterwards the slot must be reset by hand on the hub (see the notes), because the lock never frees itself.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../src/core/squadcrypto.ts";
import { currentKey } from "../src/core/squadrec.ts";
import { approveMaterial, checkCode, makeAsk, openAsk, type HubAskRow } from "../src/core/squaddir.ts";
import { hubAsk, hubBytes, HubError } from "../src/squad/hub.ts";
import { apiFor, createSquad, memberView, rekeyIfNeeded, squadName } from "../src/squad/flows.ts";
import { approveAsk, askToJoin, cancelAsk, checkAsk, createListedSquad, listSquads, loadAsks } from "../src/squad/dirflows.ts";
import type { SquadRec } from "../src/core/squadrec.ts";

const CODE = readFileSync(process.env.GSQUAD_TEST_CLAIM || "", "utf8").trim();
assert.ok(CODE.length >= 20, "set GSQUAD_TEST_CLAIM to the test claim code file");
const step = async (name: string, fn: () => Promise<void>) => { await fn(); console.log("ok -", name); };
const rejects = async (p: Promise<unknown>, status: number, word?: RegExp) => {
  try { await p; } catch (e) {
    assert.ok(e instanceof HubError, String(e));
    assert.equal((e as HubError).status, status, (e as Error).message);
    if (word) assert.match((e as Error).message, word);
    return;
  }
  assert.fail(`expected ${status}`);
};

const out: SquadRec[] = [];
let plain: SquadRec | null = null;
try {
  await step("nothing is listed yet", async () => { assert.deepEqual(await listSquads(), []); });
  plain = await createSquad("Side Squad", "Pat");
  out.push(plain);
  await step("a plain squad (made with Create a squad) is never listed and cannot be asked to join", async () => {
    assert.deepEqual(await listSquads(), []);
    const a = await makeAsk({ id: plain!.squadId, name: "Side Squad", adminBox: plain!.box.pub }, "Eve");
    await rejects(hubAsk(a.rec.sign, a.hub), 404, /unlisted/);
  });
  await step("listing needs the claim code: a wrong one is refused", async () => {
    await rejects(createListedSquad(S.newSecret().replace(/[+/=]/g, "x"), "Mallory"), 403, /claim/);
    await rejects(createListedSquad("short", "Mallory"), 403, /claim/);
  });
  const A = await createListedSquad(CODE, "Alex");
  out.push(A);
  await step("the claim code lists one squad, and works once only", async () => {
    await rejects(createListedSquad(CODE, "Mallory"), 403, /claim/);
    const list = await listSquads();
    assert.equal(list.length, 1);
    assert.deepEqual(list[0], { id: A.squadId, name: "The G Squad", adminBox: A.box.pub });
    const p = await apiFor(A).pull(null, 1);
    assert.equal(await squadName(A, p.squad), "The G Squad");
    assert.equal(p.squad.created_by, A.memberId, "Alex is the admin");
  });
  const entry = (await listSquads())[0];

  // ---------- Sam asks, Alex approves, Sam is in ----------
  const samAsk = await askToJoin(entry, "Sam");
  await step("Sam asks: the hub holds his keys and a sealed blob, never his name", async () => {
    assert.equal((await checkAsk(samAsk)).state, "open");
    assert.equal((await apiFor(A).count()).q, 1, "the admin's pulse counts the request");
    assert.equal((await apiFor(plain!).count()).q, 0, "another squad's admin sees none");
    const raw = (await apiFor(A).asks()).rows[0];
    assert.ok(!raw.sealed.includes("Sam"), "no name in the clear");
  });
  await step("asking twice with the same keys while waiting is refused", async () => {
    const again = await makeAsk(entry, "Sam", { ...samAsk, state: "declined" });
    await rejects(hubAsk(samAsk.sign, again.hub), 409, /already asked/);
  });
  await step("the admin opens the request: Sam's name, and the same check code Sam sees", async () => {
    const asks = await loadAsks(A, apiFor(A));
    const sam = asks.find((x) => x.sign === samAsk.sign.pub)!;
    assert.ok(sam.ok);
    assert.equal(sam.name, "Sam");
    assert.equal(sam.code, await checkCode(entry.id, samAsk.sign.pub, samAsk.box.pub, entry.adminBox));
  });
  let B: SquadRec | null = null;
  await step("Approve: the squad key goes to Sam through the key drop, and Sam is in", async () => {
    const sam = (await loadAsks(A, apiFor(A))).find((x) => x.sign === samAsk.sign.pub)!;
    await approveAsk(A, apiFor(A), sam);
    const res = await checkAsk(samAsk);
    assert.equal(res.state, "in");
    B = (res as { rec: SquadRec }).rec;
    out.push(B);
    assert.equal(currentKey(B).raw, currentKey(A).raw, "Sam holds the same squad key");
    assert.equal(currentKey(B).gen, currentKey(A).gen);
    const p = await apiFor(B).pull(null, currentKey(B).gen);
    assert.equal(await squadName(B, p.squad), "The G Squad");
    const names = (await Promise.all(p.members.map((m) => memberView(B!, m, p.squad.created_by, new Set())))).map((m) => m.name).sort();
    assert.deepEqual(names, ["Alex", "Sam"]);
    assert.equal((await apiFor(A).count()).q, 0);
  });
  await step("only the admin sees requests, approves or declines", async () => {
    await rejects(apiFor(B!).asks(), 403);
    await rejects(apiFor(B!).decline(S.newUuid()), 403);
  });

  // ---------- Kit cancels; then Kit asks again and is declined, and must wait ----------
  const kit1 = await askToJoin(entry, "Kit");
  await step("Cancel: Kit's request goes, the admin no longer sees it", async () => {
    await cancelAsk(kit1);
    assert.equal((await checkAsk(kit1)).state, "cancelled");
    assert.equal((await loadAsks(A, apiFor(A))).length, 0);
  });
  const kit2 = await askToJoin(entry, "Kit");   // new keys after a cancel: no wait
  await step("Decline: Kit is told, the request is gone, and the same keys wait an hour", async () => {
    const k = (await loadAsks(A, apiFor(A)))[0];
    assert.equal(k.name, "Kit");
    await apiFor(A).decline(k.id);
    assert.equal((await checkAsk(kit2)).state, "declined");
    assert.equal((await loadAsks(A, apiFor(A))).length, 0);
    const again = await makeAsk(entry, "Kit", { ...kit2, state: "declined" });
    assert.equal(again.rec.sign.pub, kit2.sign.pub, "asking again after a decline keeps the keys");
    await rejects(hubAsk(again.rec.sign, again.hub), 429, /wait/);
  });

  // ---------- the hub cannot slip its own keys in ----------
  await step("a request sealed to someone else's key is refused by the hub", async () => {
    const fake = await makeAsk({ ...entry, adminBox: (await S.newBoxPair()).pub }, "Eve");
    await rejects(hubAsk(fake.rec.sign, fake.hub), 409, /admin changed/);
  });
  await step("a request whose sealed keys differ from the hub row can only be declined", async () => {
    const eve = await makeAsk(entry, "Eve");
    const swapped: HubAskRow = { id: eve.hub.id, sign_pub: eve.rec.sign.pub, box_pub: (await S.newBoxPair()).pub, admin_box: entry.adminBox, sealed: eve.hub.sealed, created_at: new Date().toISOString() };
    const v = await openAsk(A, swapped);
    assert.equal(v.ok, false);
    await assert.rejects(approveMaterial(A, v));
  });
  await step("an approval for an old key gen is refused", async () => {
    const eve = await askToJoin(entry, "Eve");
    const v = (await loadAsks(A, apiFor(A))).find((x) => x.sign === eve.sign.pub)!;
    const m = await approveMaterial(A, v);
    await rejects(apiFor(A).approve({ ...m, gen: m.gen + 1 }), 409, /rekey/);
    await apiFor(A).decline(v.id);
  });

  // ---------- removing as before: Sam out, Alex re-keys (Sam's card, sealed at Approve, let it plan) ----------
  await step("the admin can take Sam out; the re-key runs and Sam gets no new key", async () => {
    await apiFor(A).leave(B!.memberId);
    out.splice(out.indexOf(B!), 1);
    const p = await apiFor(A).pull(null, currentKey(A).gen);
    assert.ok(p.squad.rekey);
    const A2 = await rekeyIfNeeded(A, apiFor(A), p, p.members, "The G Squad");
    assert.equal(currentKey(A2).gen, 2);
    await rejects(apiFor(B!).pull(null, 1), 403, /not a member/);
  });
} finally {
  for (const r of out) { try { await apiFor(r).leave(); } catch { /* already gone */ } }
}
console.log("after everyone left, the list is empty:", JSON.stringify(await listSquads()));
const bytes = Object.entries(hubBytes).map(([k, v]) => `${k} ${v.calls}x up ${v.up} down ${v.down}`).join("; ");
console.log("bytes:", bytes);

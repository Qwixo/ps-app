// Live check of G Squad names (V1.43): node --experimental-strip-types scripts/gsquad-names-hub-check.ts
// Talks ONLY to the hub project (zxhvchchfrkfqxuyorqo) with a fictional squad ("Alex" the admin, "Sam"), never a listed
// squad: the admin renames the squad (sealed), a member is refused, a plain name for an unlisted squad is refused,
// Sam changes his name and Alex sees it in the member list and in the chat's names. Then everyone leaves (the squad is
// deleted). The listed squad's public name is checked with SQL in a transaction that always rolls back (see the notes).
import assert from "node:assert/strict";
import * as S from "../src/core/squadcrypto.ts";
import { currentKey } from "../src/core/squadrec.ts";
import { HubError, hubBytes } from "../src/squad/hub.ts";
import { apiFor, createSquad, joinSquad, makeInvite, memberView, renameMe, renameSquad, squadName } from "../src/squad/flows.ts";
import { ChatSession } from "../src/squad/chatflows.ts";
import type { SquadRec } from "../src/core/squadrec.ts";

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
const names = async (r: SquadRec) => {
  const p = await apiFor(r).pull(null, currentKey(r).gen);
  return { squad: await squadName(r, p.squad), members: (await Promise.all(p.members.map((m) => memberView(r, m, p.squad.created_by, new Set())))).map((m) => m.name).sort() };
};

const out: SquadRec[] = [];
try {
  let A = await createSquad("Name Check Squad", "Alex");
  out.push(A);
  let B = await joinSquad((await makeInvite(A, "https://cincee.com/client/")).link, "Sam");
  out.push(B);
  await step("the admin renames the squad; the member sees the new name, sealed", async () => {
    assert.equal(await renameSquad(A, apiFor(A), "  Night   Owls ", false), "Night Owls");
    assert.equal((await names(B)).squad, "Night Owls");
    const p = await apiFor(B).pull(null, 1);
    assert.ok(!JSON.stringify(p.squad).includes("Night"), "the hub holds only the sealed name");
  });
  await step("a member who is not the admin is refused", async () => {
    await rejects(renameSquad(B, apiFor(B), "Sam's Squad", false), 409, /admin/);
    assert.equal((await names(A)).squad, "Night Owls");
  });
  await step("a plain name is refused for a squad that is not listed (it is never stored)", async () => {
    await rejects(renameSquad(A, apiFor(A), "Night Owls", true), 404, /unlisted/);
  });
  await step("an empty or too long name never reaches the hub", async () => {
    await assert.rejects(renameSquad(A, apiFor(A), "   ", false));
    const key = currentKey(A);
    const meta = await S.seal(key.raw, { n: "x" }, S.sqAad.meta(A.squadId, key.gen));
    await rejects(apiFor(A).rename({ gen: key.gen, meta, name: "x".repeat(41) }), 400, /name/);
    await rejects(apiFor(A).rename({ gen: key.gen + 1, meta }), 409, /rekey/);
  });
  await step("Sam changes his name: Alex sees it in the members and in the chat's names", async () => {
    const chat = new ChatSession(A);
    await chat.pull();
    assert.equal(chat.people.get(B.memberId)?.name, "Sam");
    B = await renameMe(B, apiFor(B), "Sammy");
    assert.equal(B.me, "Sammy");
    assert.deepEqual((await names(A)).members, ["Alex", "Sammy"]);
    await chat.pull();
    assert.equal(chat.people.get(B.memberId)?.name, "Sammy", "the chat shows every message of Sam's under the new name");
  });
  await step("the admin can change their own name too", async () => {
    A = await renameMe(A, apiFor(A), "Lex");
    assert.deepEqual((await names(B)).members, ["Lex", "Sammy"]);
  });
} finally {
  for (const r of out.reverse()) { try { await apiFor(r).leave(); } catch { /* already gone */ } }
}
console.log("bytes:", Object.entries(hubBytes).map(([k, v]) => `${k} ${v.calls}x up ${v.up} down ${v.down}`).join("; "));

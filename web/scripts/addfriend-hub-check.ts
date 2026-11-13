// Live check of Add friend (V1.44): node --experimental-strip-types scripts/addfriend-hub-check.ts
// Talks ONLY to the hub project (zxhvchchfrkfqxuyorqo) with a fictional squad ("QR Check Squad") and fictional
// members ("Alex" the admin, "Sam", "Kit", "Eve" who should never get in). Runs the same code PS runs
// (src/squad/addfriend.ts), then everyone leaves, which deletes the test squad and its unused invites. Never touches
// any vault project or any other squad. Prints the sha256 of each test key so their replay nonces can be cleared.
// PAUSE_MS=<ms> waits after making one last open code, so its 24 hour expiry can be checked on the hub with SQL.
import assert from "node:assert/strict";
import { sha256hex } from "../src/core/crypto.ts";
import { currentKey, type SquadRec } from "../src/core/squadrec.ts";
import { parseFriendLink } from "../src/core/friendlink.ts";
import { acceptFriend, callOffFriendCode, makeFriendCode, type FriendDeps } from "../src/squad/addfriend.ts";
import { apiFor, createSquad, joinSquad } from "../src/squad/flows.ts";
import { HubError } from "../src/squad/hub.ts";
import { listSquads } from "../src/squad/dirflows.ts";

const results: string[] = [];
const step = async (name: string, fn: () => Promise<void>) => { await fn(); results.push(name); console.log("ok -", name); };
const keys: string[] = [];
const people: SquadRec[] = [];
const deps = (): FriendDeps & { got: SquadRec[] } => {
  const got: SquadRec[] = [];
  return { got, inSquad: () => got.length > 0, async join(l, me) { const r = await joinSquad(l, me); got.push(r); people.push(r); keys.push(r.sign.pub); return "QR Check Squad"; },
    async ask() { return null; }, say: (e) => (e instanceof HubError ? `${e.status} ${e.message}` : String(e)) };
};
const linkOf = (c: Awaited<ReturnType<typeof makeFriendCode>>) => parseFriendLink(c.kind === "join" ? c.url : "");

const A = await createSquad("QR Check Squad", "Alex");
people.push(A); keys.push(A.sign.pub);
try {
  await step("the admin's code is a one time invite; scanning it joins at once with the squad key", async () => {
    const c = await makeFriendCode(A, { admin: true, listed: false });
    assert.equal(c.kind, "join");
    const d = deps();
    const r = await acceptFriend(linkOf(c), "Sam", d);
    assert.equal(r.state, "in", JSON.stringify(r));
    assert.equal(currentKey(d.got[0]).raw, currentKey(A).raw);
    const p = await apiFor(A).pull(null, 1);
    assert.equal(p.members.filter((m) => !m.left_at).length, 2);
    // used: refused for the next person
    const again = await acceptFriend(linkOf(c), "Eve", deps());
    assert.deepEqual(again, { state: "error", message: "403 invite" });
  });
  await step("a wrong key is refused, the code still works for the right person, then calling it off kills it", async () => {
    const c = await makeFriendCode(A, { admin: true, listed: false });
    const l = linkOf(c)!;
    assert.ok(l.kind === "join");
    const bad = new Uint8Array(l.secret); bad[5] ^= 0x40;
    assert.deepEqual(await acceptFriend({ ...l, secret: bad }, "Eve", deps()), { state: "error", message: "403 invite" });
    await callOffFriendCode(A, c);
    assert.deepEqual(await acceptFriend(l, "Kit", deps()), { state: "error", message: "403 invite" }, "called off: gone at once");
  });
  await step("only your own invite can be called off; Kit then joins with a fresh code", async () => {
    const c = await makeFriendCode(A, { admin: true, listed: false });
    const sam = people[1];
    await callOffFriendCode(sam, c);   // Sam did not make it: the hub keeps it
    const d = deps();
    assert.equal((await acceptFriend(linkOf(c), "Kit", d)).state, "in");
  });
  await step("not the admin, and this squad is not on the list: no code (only the admin adds people)", async () => {
    const sam = people[1];
    const listed = (await listSquads(sam.sign)).some((e) => e.id === sam.squadId);
    assert.equal(listed, false);
    assert.deepEqual(await makeFriendCode({ ...sam, creator: false }, { admin: false, listed }), { kind: "none", why: "private" });
  });
  await step("a guessed invite id with a random key is refused", async () => {
    const r = await acceptFriend({ kind: "join", inviteId: crypto.randomUUID(), secret: crypto.getRandomValues(new Uint8Array(32)) }, "Eve", deps());
    assert.deepEqual(r, { state: "error", message: "403 invite" });
  });
  const pause = Number(process.env.PAUSE_MS || 0);
  if (pause > 0) {
    const c = await makeFriendCode(A, { admin: true, listed: false });
    const l = linkOf(c)!;
    console.log(`OPEN CODE ${l.kind === "join" ? l.inviteId : ""} expires ${c.kind === "join" ? c.expiresAt : ""}; waiting ${pause} ms`);
    await new Promise((r) => setTimeout(r, pause));
  }
} finally {
  // Everyone leaves: the last one out deletes the squad (and every unused invite with it).
  for (const p of [...people].reverse()) { try { await apiFor(p).leave(); } catch { /* already out */ } }
  console.log("test key hashes (their replay nonces):", JSON.stringify(await Promise.all(keys.map((k) => sha256hex(k)))));
  console.log("squad", A.squadId);
}
console.log(`\naddfriend hub check: ${results.length} of 5 passed`);

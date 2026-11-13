// Run: node --experimental-strip-types tests/gsquad-dir.test.ts
// G Squad directory (V1.42): the listing lock, Ask to join, Approve, Decline, Cancel and the key handover.
// Names are fictional. The live hub check (scripts/gsquad-dir-hub-check.ts) runs the same code against the hub.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../src/core/squadcrypto.ts";
import { currentKey, openCard, planRekey, type HubMember, type SquadRec } from "../src/core/squadrec.ts";
import { ASK_AGAIN_MS, approveMaterial, askAgainAt, checkCode, cleanAskRec, cleanDir, LISTED_NAME, makeAsk, openAsk, recFromApproval, type HubAskRow } from "../src/core/squaddir.ts";
import { cleanSquadOp, DIR_OPS } from "../src/squad/view.ts";

const tests: [string, () => Promise<void> | void][] = [];
const ok = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SQ = "4d3c2b1a-0f9e-4d8c-8b7a-6a5b4c3d2e1f";

async function admin(): Promise<SquadRec> {
  return { v: 1, squadId: SQ, memberId: S.newUuid(), me: "Alex", keys: [{ gen: 1, k: await S.newSquadKey() }], sign: await S.newSignPair(), box: await S.newBoxPair(),
    secret: S.newSecret(), joinedAt: new Date().toISOString(), creator: true };
}
const entryOf = (a: SquadRec) => ({ id: SQ, name: LISTED_NAME, adminBox: a.box.pub });
const rowOf = (h: { id: string; box: string; admin: string; sealed: string }, sign: string): HubAskRow =>
  ({ id: h.id, sign_pub: sign, box_pub: h.box, admin_box: h.admin, sealed: h.sealed, created_at: new Date().toISOString() });

// ---------- the listing lock ----------
ok("listing lock: one config row ever, a one-time claim, and a trigger that refuses every other change", () => {
  const m = read("supabase/hub/migrations/dir_001_directory.sql");
  assert.match(m, /id boolean primary key default true check \(id\)/, "the key is the constant true: one row only");
  assert.match(m, /listed_squad uuid,/, "no foreign key, so a deleted squad never frees the slot");
  assert.match(m, /old\.listed_squad is not null and new\.listed_squad is distinct from old\.listed_squad/, "once listed it never changes or clears");
  assert.match(m, /old\.listed_squad is not null and new\.claim_hash is not null/, "no new claim while listed");
  assert.match(m, /old\.listed_squad is null and new\.listed_squad is not null and \(old\.claim_hash is null or new\.claim_hash is not null\)/, "listing must spend the claim");
  assert.match(m, /tg_op = 'DELETE'/);
  assert.match(m, /before truncate on public\.dir_config/);
  assert.match(m, /c\.claim_hash <> p_code_hash then\s+raise exception 'claim'/, "a wrong code is refused");
  assert.match(m, /set claim_hash = null, listed_squad = p_id/, "the code is spent in the same step that makes the squad");
  assert.match(m, /revoke all on table public\.dir_config from anon, authenticated, public/);
  assert.match(m, /force row level security/);
  assert.match(m, /as restrictive for all to anon, authenticated using \(false\)/);
  assert.ok(!/grant[^;]*dir_config[^;]*to (anon|authenticated)/.test(m), "no client role is granted anything");
  assert.ok(!/[0-9a-f]{64}/.test(m), "no claim hash is committed with the migration");
});
ok("listing lock: the hub only lists through the claim, hashes the code, and lists one slot", () => {
  const f = read("supabase/hub/functions/squad/index.ts");
  assert.match(f, /dirRpc\("dir_create_listed", \{[^}]*p_code_hash: await sha256hex\(args\.code\)/);
  assert.ok(!/from\("dir_config"\)/.test(f), "the function never writes the config row itself");
  const m = read("supabase/hub/migrations/dir_001_directory.sql");
  assert.match(m, /dir_list\(\)[\s\S]*'slot', 'gsquad'/);
  assert.match(m, /if not exists \(select 1 from public\.dir_config where id and listed_squad = p_squad\) then raise exception 'unlisted'/, "only the listed squad takes asks");
});
const noComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
ok("V1.49: no Create The G Squad and no claim code anywhere in PS (the hub makes it, auto_001 spends the claim)", () => {
  const e = read("src/squad/direngine.ts");
  assert.ok(!/createListed|listable|lookListed/.test(e), "the claim step and the the developer only set up card are gone");
  assert.match(e, /canCreate: false,/);
  const g = noComments(read("src/views/GSquad.tsx"));
  assert.ok(!/claim code|Claim code|Set up \{THE_SQUAD\}|createListed/.test(g));
  assert.ok(!/isRedAccount/.test(g), "the pop-up itself has no the developer gate");
  assert.match(read("supabase/hub/migrations/auto_001_one_squad.sql"), /update public\.dir_config set claim_hash = null, listed_squad = sid, listed_at = now\(\) where id;/);
});
ok("the directory shows only slots PS knows, with a valid admin key", async () => {
  const box = (await S.newBoxPair()).pub;
  assert.deepEqual(cleanDir([{ id: SQ.toUpperCase(), slot: "gsquad", admin_box: box }]), [{ id: SQ, name: "The G Squad", adminBox: box }]);
  assert.deepEqual(cleanDir([{ id: SQ, slot: "evil", admin_box: box }]), [], "an unknown slot is not shown");
  assert.deepEqual(cleanDir([{ id: SQ, slot: "gsquad", admin_box: "nope" }]), []);
  assert.deepEqual(cleanDir("x"), []);
});

// ---------- request ----------
ok("ask: the name is sealed to the admin only; the hub row carries the public keys", async () => {
  const a = await admin();
  const ask = await makeAsk(entryOf(a), "Sam");
  assert.ok(!ask.hub.sealed.includes("Sam"));
  assert.equal(ask.hub.box, ask.rec.box.pub);
  assert.equal(ask.hub.admin, a.box.pub);
  const v = await openAsk(a, rowOf(ask.hub, ask.rec.sign.pub));
  assert.equal(v.ok, true);
  assert.equal(v.name, "Sam");
  const other = { ...a, box: await S.newBoxPair() };
  assert.equal((await openAsk(other, rowOf(ask.hub, ask.rec.sign.pub))).ok, false, "someone else's box key cannot open it");
});
ok("ask: both sides see the same check code, and a different admin key gives a different one", async () => {
  const a = await admin();
  const ask = await makeAsk(entryOf(a), "Sam");
  const v = await openAsk(a, rowOf(ask.hub, ask.rec.sign.pub));
  const mine = await checkCode(SQ, ask.rec.sign.pub, ask.rec.box.pub, ask.rec.adminBox);
  assert.match(mine, /^\d{3} \d{3}$/);
  assert.equal(v.code, mine);
  assert.notEqual(await checkCode(SQ, ask.rec.sign.pub, ask.rec.box.pub, (await S.newBoxPair()).pub), mine);
});
ok("ask: a hub that swaps the asker's box key is caught, and that request can only be declined", async () => {
  const a = await admin();
  const ask = await makeAsk(entryOf(a), "Sam");
  const swapped = { ...rowOf(ask.hub, ask.rec.sign.pub), box_pub: (await S.newBoxPair()).pub };
  const v = await openAsk(a, swapped);
  assert.equal(v.ok, false);
  await assert.rejects(approveMaterial(a, v));
  const moved = { ...rowOf(ask.hub, ask.rec.sign.pub), id: S.newUuid() };   // the blob moved onto another request id
  assert.equal((await openAsk(a, moved)).ok, false);
});
ok("ask: the record kept in your vault is checked", async () => {
  const a = await admin();
  const ask = await makeAsk(entryOf(a), "Sam");
  const back = cleanAskRec(JSON.parse(JSON.stringify(ask.rec)));
  assert.deepEqual(back, ask.rec);
  assert.equal(cleanAskRec({ ...ask.rec, squadId: "x" }), null);
  assert.equal(cleanAskRec({ ...ask.rec, sign: { pub: "x", priv: "y" } }), null);
  assert.equal(cleanAskRec({ ...ask.rec, state: "weird" })!.state, "open");
});

// ---------- approve and the key handover ----------
ok("approve: the squad key reaches the asker through the key drop, and only them", async () => {
  const a = await admin();
  const ask = await makeAsk(entryOf(a), "Sam");
  const v = await openAsk(a, rowOf(ask.hub, ask.rec.sign.pub));
  const m = await approveMaterial(a, v);
  assert.equal(m.gen, currentKey(a).gen);
  const rec = await recFromApproval(ask.rec, { squad: SQ, member: m.member, drop: { gen: m.gen, sealed: m.drop } });
  assert.equal(currentKey(rec).raw, currentKey(a).raw, "Sam holds the same squad key");
  assert.equal(rec.memberId, m.member);
  assert.equal(rec.sign.pub, ask.rec.sign.pub, "Sam joins with the keys he asked with");
  await assert.rejects(recFromApproval(ask.rec, { squad: SQ, member: S.newUuid(), drop: { gen: m.gen, sealed: m.drop } }), "a drop moved onto another member does not open");
  const eve = await makeAsk(entryOf(a), "Eve");
  await assert.rejects(recFromApproval(eve.rec, { squad: SQ, member: m.member, drop: { gen: m.gen, sealed: m.drop } }), "another asker cannot open it");
  await assert.rejects(recFromApproval(ask.rec, { squad: S.newUuid(), member: m.member, drop: { gen: m.gen, sealed: m.drop } }));
  // The Mac and the phone both take the approval: the very same record, so shared task ids never double up.
  const at = new Date().toISOString();
  const r1 = await recFromApproval(ask.rec, { squad: SQ, member: m.member, drop: { gen: m.gen, sealed: m.drop }, at });
  const r2 = await recFromApproval(ask.rec, { squad: SQ, member: m.member, drop: { gen: m.gen, sealed: m.drop }, at });
  assert.deepEqual(r1, r2);
  assert.match(r1.secret, /^[A-Za-z0-9+/]{43}=$/);
  assert.notEqual(r1.secret, (await recFromApproval(eve.rec, { squad: SQ, member: m.member, drop: { gen: m.gen, sealed: await S.sealKeyTo(eve.rec.box.pub, currentKey(a).raw, S.sqAad.drop(SQ, m.member, m.gen)) }, at })).secret);
});
ok("approve: the admin seals the new member's card, so names show at once and a re-key never waits for them", async () => {
  const a = await admin();
  const ask = await makeAsk(entryOf(a), "Sam");
  const v = await openAsk(a, rowOf(ask.hub, ask.rec.sign.pub));
  const m = await approveMaterial(a, v);
  const card = await openCard(a, m.member, m.card, m.gen);
  assert.deepEqual(card, { n: "Sam", sign: ask.rec.sign.pub, box: ask.rec.box.pub });
  const aCard = await S.seal(currentKey(a).raw, { n: "Alex", sign: a.sign.pub, box: a.box.pub }, S.sqAad.card(SQ, a.memberId, 1));
  const rows: HubMember[] = [
    { id: a.memberId, sign_pub: a.sign.pub, box_pub: a.box.pub, card_ct: aCard, card_gen: 1, left_at: null },
    { id: m.member, sign_pub: ask.rec.sign.pub, box_pub: ask.rec.box.pub, card_ct: m.card, card_gen: m.gen, left_at: null },
  ];
  const plan = await planRekey(a, rows, LISTED_NAME);
  assert.ok(plan, "the re-key can include Sam");
  assert.equal(plan!.drops.length, 2);
});

// ---------- decline and cancel ----------
ok("decline: the same keys may ask again after an hour; cancel forgets the keys", async () => {
  const a = await admin();
  const ask = await makeAsk(entryOf(a), "Sam");
  const now = Date.now();
  const declined = { ...ask.rec, state: "declined" as const, settledAt: new Date(now).toISOString() };
  assert.equal(askAgainAt(declined, now), new Date(now + ASK_AGAIN_MS).toISOString());
  assert.equal(askAgainAt(declined, now + ASK_AGAIN_MS + 1), null);
  assert.equal(askAgainAt(ask.rec, now), null, "a waiting request has no wait");
  const again = await makeAsk(entryOf(a), "Sam", declined);
  assert.equal(again.rec.sign.pub, ask.rec.sign.pub, "after a decline: the same keys (the hub's hour wait is per key)");
  assert.notEqual(again.rec.reqId, ask.rec.reqId);
  const fresh = await makeAsk(entryOf(a), "Sam", { ...ask.rec, state: "cancelled" });
  assert.notEqual(fresh.rec.sign.pub, ask.rec.sign.pub, "after a cancel: new keys");
  const otherSquad = await makeAsk({ ...entryOf(a), id: S.newUuid() }, "Sam", declined);
  assert.notEqual(otherSquad.rec.sign.pub, ask.rec.sign.pub);
});
ok("decline and cancel on the hub: the sealed name is wiped and the wait is enforced", () => {
  const f = read("supabase/hub/functions/squad/index.ts");
  assert.match(f, /case "decline": \{[\s\S]*?created_by !== m\.id\) throw new Fail\(403, "admin"\)[\s\S]*?state: "declined", sealed: ""/);
  assert.match(f, /case "ask_cancel": \{[\s\S]*?state: "cancelled", sealed: ""[\s\S]*?\.eq\("sign_pub", pub\)/);
  const m = read("supabase/hub/migrations/dir_001_directory.sql");
  assert.match(m, /old\.updated_at > now\(\) - interval '1 hour' then raise exception 'slow'/);
  assert.match(m, /n >= 20 then raise exception 'busy'/);
  assert.match(m, /n >= 60 then raise exception 'busy'/);
  assert.match(m, /if sq\.rekey or sq\.gen <> p_gen then raise exception 'rekey'/, "approve waits for a re-key and a current gen");
});

// ---------- the Tab list's requests ----------
ok("ops from the Tab list are checked", () => {
  assert.deepEqual(cleanSquadOp({ op: "dir" }), { op: "dir" });
  assert.deepEqual(cleanSquadOp({ op: "ask", squad: SQ.toUpperCase(), me: " Sam " }), { op: "ask", squad: SQ, me: "Sam" });
  assert.equal(cleanSquadOp({ op: "ask", squad: "x", me: "Sam" }), null);
  assert.equal(cleanSquadOp({ op: "ask", squad: SQ, me: "" }), null);
  assert.deepEqual(cleanSquadOp({ op: "approve", id: SQ }), { op: "approve", id: SQ });
  assert.equal(cleanSquadOp({ op: "decline", id: "1; drop" }), null);
  assert.equal(cleanSquadOp({ op: "createListed", code: "abcdefghijklmnopqrstuvwxyz_-0123456789", me: "Alex" }), null, "V1.49: gone");
  assert.deepEqual(cleanSquadOp({ op: "rejoin" }), { op: "rejoin" });
  for (const k of ["dir", "ask", "askCancel", "askClear", "approve", "decline"]) assert.ok(DIR_OPS.has(k));
  assert.ok(!DIR_OPS.has("createListed"));
});
ok("V1.49: no Ask to join, no approval: older requests are let in by the admin's PS by itself, with no card", () => {
  const g = noComments(read("src/views/GSquad.tsx"));
  for (const gone of ["Ask to join", "Waiting for approval", "Cancel request", "asked to join", "AskList", "Have an invite link", "ClaimCard", "OlderCard"]) assert.ok(!g.includes(gone), gone);
  // V1.43: the pop-up is the G Squad window; Esc steps back, then closes (views/GSquadWindow.tsx)
  assert.match(read("src/views/GSquadWindow.tsx"), /if \(e\.key !== "Escape"\) return; e\.preventDefault\(\); e\.stopImmediatePropagation\(\); step\(\);/);
  const e = read("src/squad/direngine.ts");
  assert.match(e, /for \(const a of list\) if \(a\.ok\) \{ try \{ await approveAsk\(rec, api, a\); let_in\+\+; \}/, "checked requests go in at once");
  assert.match(e, /showCards\(v\.in \? v\.name \|\| LISTED_NAME : LISTED_NAME, \[\]\);/, "no Approve card on the Mac");
  assert.match(e, /ctx\.patch\(\{ dir: v\.in \? null : dirView\(\), asks: \[\] \}\);/);
  assert.match(e, /a\.state === "open" \? cancelAsk\(a\)/, "your own old request is called off (PS joins by itself)");
});
ok("no em or en dashes in anything the directory added", () => {
  for (const p of ["src/core/squaddir.ts", "src/squad/dirflows.ts", "src/squad/direngine.ts", "supabase/hub/migrations/dir_001_directory.sql", "scripts/gsquad-dir-hub-check.ts", "src/views/GSquad.tsx", "src/views/gsquad.css", "supabase/hub/functions/squad/index.ts", "supabase/hub/migrations/auto_001_one_squad.sql"]) {
    assert.ok(!/[\u2013\u2014]/.test(read(p)), p);
  }
});

let pass = 0;
for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log("ok -", name); } catch (e) { console.error("FAIL -", name); console.error(e); process.exitCode = 1; }
}
console.log(`\ngsquad-dir: ${pass} of ${tests.length} passed`);

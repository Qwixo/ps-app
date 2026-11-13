// G Squad invite only, end to end on THIS Mac: the real `squad` edge function (v9, supabase/hub/functions/squad) in the
// local Supabase edge runtime, the real database rules (every hub migration plus invite_001) in a local Postgres, and
// PS's own join code (V1.49 to V1.56, unchanged) talking to it. Never the live hub.
//
// Setup (all local containers; see the hand over note gsquad-invite-only.md for the exact commands):
//   KEEP=1 scripts/gsquad-invite-check.sh        Postgres "gsq-invite-check" with every migration
//   PostgREST on :54301, a /rest/v1 proxy on :54400, the edge runtime serving the function on :54900
// Run: node --experimental-strip-types scripts/gsquad-invite-e2e.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as S from "../src/core/squadcrypto.ts";
import { newPending, whoHash, type Pending } from "../src/core/squadauto.ts";
import { askAdmin, autoCheck, autoJoin, handOut } from "../src/squad/autoflows.ts";
import { checkCode, openAsk, waitAsRequest } from "../src/core/squaddir.ts";
import { makeFriendCode, acceptFriend } from "../src/squad/addfriend.ts";
import { parseFriendLink } from "../src/core/friendlink.ts";
import { joinSquad } from "../src/squad/flows.ts";
import { HubError, hubApi, hubCall } from "../src/squad/hub.ts";
import type { SquadRec } from "../src/core/squadrec.ts";

const FN = process.env.FN ?? "http://127.0.0.1:54900/";
const fetcher = (_url: string, init: RequestInit) => fetch(FN, init);
const sql = (q: string) => execFileSync("docker", ["exec", "-i", "gsq-invite-check", "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
const PROJECT = "https://abcdefghijklmnopqrst.supabase.co";
const api = (r: { memberId: string; sign: { priv: string } }) => hubApi({ member: r.memberId, priv: r.sign.priv }, fetcher);
const step = (s: string) => console.log(`ok  ${s}`);
const refused = (status: number, word?: RegExp) => (e: unknown) => e instanceof HubError && e.status === status && (!word || word.test(e.message));

// A clean hub: The G Squad with nobody in it.
sql(`delete from squad_keydrops; delete from squad_invites; delete from squad_blocked; delete from squad_members;
     update squads set gen = 1, rekey = false, meta_ct = null, meta_gen = null, created_by = null; update dir_config set admin_who = null where id;`);
const sid = sql("select listed_squad from dir_config");

/** Someone who was in before the change: an admitted row, then today's code gets them in. */
async function before(name: string, holder?: SquadRec): Promise<SquadRec> {
  const p = await newPending(name);
  const id = S.newUuid();
  sql(`insert into squad_members (id, squad_id, sign_pub, box_pub, who, has_key, admitted) values ('${id}', '${sid}', '${p.sign.pub}', '${p.box.pub}', '${await whoHash(PROJECT, S.newUuid())}', false, true)`);
  if (holder) await handOut(holder, api(holder));
  const out = await autoCheck({ ...p, squadId: sid, memberId: id }, fetcher);
  assert.equal(out.state, "in", `${name} in`);
  return (out as { rec: SquadRec }).rec;
}
async function stranger(name: string, uid = S.newUuid()): Promise<Pending> {
  return (await autoJoin(await whoHash(PROJECT, uid), await newPending(name), fetcher)).pending;
}

const red = await before("Owner");
sql(`update squads set created_by = '${red.memberId}'`);
const amy = await before("Amy", red);
assert.equal(amy.keys[0].k, red.keys[0].k);
step("members in before: the developer made the key, Amy got it from the developer's PS, both in through the real function");

const mal = await stranger("Mallory");
assert.equal(sql(`select admitted from squad_members where id = '${mal.memberId}'`), "f");
for (let i = 0; i < 2; i++) {
  assert.equal(await handOut(amy, api(amy)), 0);
  assert.equal(await handOut(red, api(red)), 0);
  assert.equal((await autoCheck(mal, fetcher)).state, "wait");
}
assert.equal(sql(`select count(*) from squad_keydrops where member_id = '${mal.memberId}'`), "0");
assert.equal((await api(amy).beat()).k, 0);
assert.equal((await api(red).beat() as { w?: number }).w, 1);
step("a stranger's PS joins by itself and waits; members' PS hand it nothing; no key drop exists for it");

const m = { memberId: mal.memberId!, sign: mal.sign };
await assert.rejects(api(m).pull(null, 0), refused(403, /not let in/));
await assert.rejects(api(m).beat(), refused(403, /not let in/));
await assert.rejects(api(m).autoWaiting(), refused(403, /not let in/));
await assert.rejects(api(m).autoStart(1, "bWV0YQ=="), refused(403, /not let in/));
await assert.rejects(api(m).invite({ id: S.newUuid(), hash: "a".repeat(64), wrapped: "eA==", gen: 1 }), refused(403, /not let in/));
step("a waiting row cannot pull, beat, see who waits, make a key or make invites");

const pulled = await api(amy).pull(null, 0);
assert.equal(pulled.members.some((x) => x.id === mal.memberId), false);
step("members' pull never lists a waiting row");

await assert.rejects(api(red).approve({ id: S.newUuid(), member: S.newUuid(), gen: 1, drop: "eA==", card: "eA==" }), refused(403));
const k = await S.newSignPair();
await assert.rejects(hubCall({ member: "", priv: k.priv }, "ask", { sign: k.pub, box: (await S.newBoxPair()).pub, id: S.newUuid(), squad: sid, admin: red.box.pub, sealed: "x" }, fetcher),
  refused(404, /unlisted/));
step("old Ask to join and the V1.49+ admin's automatic Approve: refused");

await assert.rejects(hubCall({ member: amy.memberId, priv: amy.sign.priv }, "admit", { id: mal.memberId }, fetcher), refused(403, /admin/));
const list = await hubCall<{ rows: { id: string }[] }>({ member: red.memberId, priv: red.sign.priv }, "wait_list", {}, fetcher);
assert.deepEqual(list.rows.map((r) => r.id), [mal.memberId]);
await hubCall({ member: red.memberId, priv: red.sign.priv }, "admit", { id: mal.memberId }, fetcher);
assert.equal((await api(amy).beat()).k, 1);
assert.equal(await handOut(amy, api(amy)), 1);
const inNow = await autoCheck(mal, fetcher);
assert.equal(inNow.state, "in");
assert.equal((inNow as { rec: SquadRec }).rec.keys[0].k, red.keys[0].k);
step("only the admin lets someone in; then Amy's PS (today's code) hands them the key and they are in");

const eveUid = S.newUuid();
const eve = await stranger("Eve", eveUid);
await hubCall({ member: red.memberId, priv: red.sign.priv }, "turn_away", { id: eve.memberId }, fetcher);
assert.equal(sql(`select count(*) from squad_members where id = '${eve.memberId}'`), "0");
await assert.rejects(stranger("Eve", eveUid), refused(403, /removed/));
step("turned away: the row goes and that PS cannot ask again by itself");

const sam = await stranger("Sam");
await api({ memberId: sam.memberId!, sign: sam.sign }).leave();
assert.equal(sql(`select count(*) from squad_members where id = '${sam.memberId}'`), "0");
assert.equal(sql("select rekey from squads"), "f");
step("a waiting PS gives up: its row goes, no re-key");

const code = await makeFriendCode(amy, { admin: true, listed: true, fetcher });
const link = parseFriendLink(new URL((code as { url: string }).url).hash);
const deps = { inSquad: () => false, join: async (l: string, n: string) => (await joinSquad(l, n, fetcher)).squadId, ask: async () => null,
  say: (e: unknown) => (e instanceof HubError ? `${e.status} ${e.message}` : String(e)) };
assert.deepEqual(await acceptFriend(link, "Zoe", deps), { state: "in", squad: sid });
assert.deepEqual(await acceptFriend(link, "Zed", deps), { state: "error", message: "403 invite" });
assert.equal(sql("select count(*) from squad_members where admitted and has_key and card_ct is not null and left_at is null"), "4");
step("Add friend: Amy (not the admin) makes a one time invite; Zoe is straight in with the key; the code works once");

const ann = await stranger("Ann");
assert.deepEqual(await autoCheck(ann, fetcher), { state: "wait", admitted: false });
const adminBox = await askAdmin(ann, fetcher);
assert.equal(adminBox, red.box.pub);
const rows = (await api(red).waitList()).rows;
const seen = await openAsk(red, waitAsRequest(rows.find((r) => r.id === ann.memberId)!, red.box.pub));
assert.equal(seen.ok, true);
assert.equal(seen.name, "Ann");
assert.equal(seen.code, await checkCode(sid, ann.sign.pub, ann.box.pub, adminBox!));
await api(red).admit(ann.memberId!);
await handOut(red, api(red));
assert.equal((await autoCheck(ann, fetcher)).state, "in");
step("V1.57 asker: told it waits for the admin, leaves its name sealed; the developer opens it with the same check code, Approve, in");

console.log("END TO END PASSED");

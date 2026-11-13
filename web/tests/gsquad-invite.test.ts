// Run: node --experimental-strip-types tests/gsquad-invite.test.ts
// G Squad invite only (V1.57). The developer, 13 Nov 2026: "Yes, lock it." Two parts:
//   1. The edge function's join rules (supabase/hub/functions/squad/gate.ts), the very file the function runs.
//   2. PS's join code (core/squadauto.ts, squad/autoflows.ts, squad/addfriend.ts, squad/flows.ts; V1.57 only adds the
//      "waiting for the admin" answer and the sealed name) against an in-memory hub that follows migration invite_001_invite_only.sql and uses gate.ts: a
//      stranger's PS joins by itself and waits for ever, members' PS never hand it the key, a one time invite from
//      any member lets someone straight in, and the admin lets a waiting person in or turns them away.
// The same rules in a real Postgres: scripts/gsquad-invite-check.sh. No network. Names are fictional.
import assert from "node:assert/strict";
import * as S from "../src/core/squadcrypto.ts";
import { sha256hex } from "../src/core/crypto.ts";
import { sealCard, type SquadRec } from "../src/core/squadrec.ts";
import { newPending, sayAuto, whoHash, type Pending } from "../src/core/squadauto.ts";
import { askAdmin, autoCheck, autoJoin, handOut } from "../src/squad/autoflows.ts";
import { checkCode, NO_NAME_ASK, openAsk, waitAsRequest } from "../src/core/squaddir.ts";
import { cleanJoinRec } from "../src/core/squadauto.ts";
import { cleanAutoView } from "../src/squad/view.ts";
import { acceptFriend, makeFriendCode } from "../src/squad/addfriend.ts";
import { parseFriendLink } from "../src/core/friendlink.ts";
import { joinSquad } from "../src/squad/flows.ts";
import { HubError, hubApi, hubCall } from "../src/squad/hub.ts";
import { ADMIN_ACTS, allowedWhileWaiting, leaveRoute, pulseCounts, waitingKey } from "../supabase/hub/functions/squad/gate.ts";

const tests: [string, () => Promise<void> | void][] = [];
const ok = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

// ---------- 1. the function's rules ----------
ok("a waiting row may only ask about its key, leave its name, or give up (itself only)", () => {
  const me = S.newUuid();
  for (const a of ["auto_key", "auto_ask"]) assert.equal(allowedWhileWaiting(a, me, undefined), true, a);
  assert.equal(allowedWhileWaiting("leave", me, undefined), true, "give up");
  assert.equal(allowedWhileWaiting("leave", me, me), true, "give up, naming itself");
  assert.equal(allowedWhileWaiting("leave", me, S.newUuid()), false, "never take anyone else out");
  for (const a of ["pull", "beat", "count", "card", "invite", "put_tasks", "mine", "hand", "rekey", "auto_start", "auto_waiting", "auto_drop",
    "admin", "asks", "approve", "rename", "wait_list", "admit", "turn_away", "uninvite", "decline", "answer", "cancel", "del_tasks"]) {
    assert.equal(allowedWhileWaiting(a, me, undefined), false, a);
  }
  for (const a of ADMIN_ACTS) assert.equal(allowedWhileWaiting(a, me, undefined), false, a);
});
ok("a waiting row is told: no key yet, never make the first one, not the admin", () => {
  assert.deepEqual(waitingKey(7), { gen: 7, start: false, drop: null, admin: false, admitted: false });
});
ok("leave: who and whom decide what happens", () => {
  const a = { id: "a", admitted: true }, w = { id: "w", admitted: false };
  assert.equal(leaveRoute(w, null), "withdraw");
  assert.equal(leaveRoute(w, w), "withdraw");
  assert.equal(leaveRoute(w, a), "withdraw", "a waiting row naming a member still only removes itself");
  assert.equal(leaveRoute(a, null), "leave");
  assert.equal(leaveRoute(a, a), "leave");
  assert.equal(leaveRoute(a, w), "turn_away");
  assert.equal(leaveRoute(a, { id: "b", admitted: true }), "remove");
});
ok("the pulse: key handing only for key holders, asks only for the admin", () => {
  assert.deepEqual(pulseCounts({ has_key: true, admin: false }, 2, 5), { k: 2, w: 0 });
  assert.deepEqual(pulseCounts({ has_key: false, admin: true }, 2, 5), { k: 0, w: 5 });
});

// ---------- 2. an in-memory hub with invite_001's rules ----------
interface Row { id: string; sign: string; box: string; who: string | null; has_key: boolean; card_ct: string | null; card_gen: number | null; admitted: boolean; ask: string | null; joined: number }
function memHub() {
  const sq = { id: S.newUuid(), gen: 1, meta: null as string | null, created_by: null as string | null, rekey: false };
  const rows = new Map<string, Row>();
  const drops: { member: string; gen: number; sealed: string }[] = [];
  const invites = new Map<string, { hash: string; wrapped: string; gen: number; by: string; used: boolean }>();
  const blocked = new Set<string>();
  const fail = (status: number, error: string) => new Response(JSON.stringify({ error }), { status });
  const ans = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
  const all = () => [...rows.values()];
  const addRow = (r: Omit<Row, "id" | "joined">) => { const id = S.newUuid(); rows.set(id, { ...r, id, joined: Date.now() }); return rows.get(id)!; };
  const fetcher = async (_url: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body)) as S.SignedRequest;
    const args = (b.args ?? {}) as Record<string, any>;
    if (["auto_join", "dir", "join", "ask"].includes(b.act)) {
      if (!(await S.verifyRequest(args.sign, b))) return fail(401, "signature");
      if (b.act === "dir") {
        const adm = sq.created_by ? rows.get(sq.created_by) : null;
        return ans({ squads: adm ? [{ id: sq.id, slot: "gsquad", admin_box: adm.box }] : [], gs: sq.id });
      }
      if (b.act === "ask") return fail(404, "unlisted");
      if (b.act === "join") {
        const i = invites.get(args.invite);
        if (!i || i.used || i.hash !== await sha256hex(args.token) || i.gen !== sq.gen || !rows.get(i.by)?.admitted) return fail(403, "invite");
        i.used = true;
        const r = addRow({ sign: args.sign, box: args.box, who: null, has_key: true, card_ct: null, card_gen: null, admitted: true, ask: null });
        return ans({ squad: sq.id, member: r.id, gen: i.gen, wrapped: i.wrapped });
      }
      // auto_join: a stranger gets a waiting row; nothing more.
      if (!/^[0-9a-f]{64}$/.test(args.who ?? "")) return fail(403, "removed");
      const same = all().find((r) => r.sign === args.sign);
      if (same) return ans({ squad: sq.id, member: same.id, gen: sq.gen, start: same.admitted && !sq.meta && !same.has_key, key: same.has_key, admitted: same.admitted });
      if (blocked.has(args.who)) return fail(403, "removed");
      const twin = all().find((r) => r.who === args.who);
      if (twin && (twin.admitted || Date.now() - twin.joined < 10 * 60_000)) return fail(409, "already in");
      if (twin) rows.delete(twin.id);
      if (all().filter((r) => !r.admitted).length >= 20) return fail(429, "busy");
      const r = addRow({ sign: args.sign, box: args.box, who: args.who, has_key: false, card_ct: null, card_gen: null, admitted: false, ask: null });
      return ans({ squad: sq.id, member: r.id, gen: sq.gen, start: false, key: false, admitted: false });
    }
    const me = rows.get(b.member);
    if (!me) return fail(403, "not a member");
    if (!(await S.verifyRequest(me.sign, b))) return fail(401, "signature");
    if (!me.admitted && !allowedWhileWaiting(b.act, me.id, args.target)) return fail(403, "not let in");
    const admin = sq.created_by === me.id;
    switch (b.act) {
      case "auto_key": {
        if (!me.admitted) return ans(waitingKey(sq.gen));
        const d = drops.find((x) => x.member === me.id && x.gen === sq.gen) ?? null;
        return ans({ gen: sq.gen, start: !sq.meta && !me.has_key, drop: d && { gen: d.gen, sealed: d.sealed }, admin, admitted: true });
      }
      case "auto_start":
        if (sq.meta || args.gen !== sq.gen || all().some((r) => r.has_key && r.id !== me.id)) return fail(409, "started");
        sq.meta = args.meta; me.has_key = true;
        return ans({ ok: true, gen: args.gen });
      case "auto_waiting":
        if (!me.has_key || !sq.meta) return ans({ rows: [] });
        return ans({ rows: all().filter((r) => !r.has_key && r.admitted).map((r) => ({ id: r.id, box: r.box, sign: r.sign })) });
      case "auto_drop": {
        if (sq.rekey || args.gen !== sq.gen) return fail(409, "rekey first");
        let added = 0;
        for (const d of args.drops) {
          const t = rows.get(d.member);
          // invite_drop_guard: the database refuses a drop for anyone not admitted
          if (!t || t.has_key || !t.admitted) continue;
          drops.push({ member: t.id, gen: args.gen, sealed: d.sealed }); t.has_key = true; added++;
        }
        return ans({ added });
      }
      case "beat": case "count": {
        const c = pulseCounts({ has_key: me.has_key, admin }, all().filter((r) => r.admitted && !r.has_key).length, all().filter((r) => !r.admitted).length);
        return ans({ n: 0, h: 0, g: sq.gen, rk: sq.rekey, q: 0, ...c });
      }
      case "card": me.card_ct = args.ct; me.card_gen = args.gen; return ans({ ok: true });
      case "invite":
        if (args.gen !== sq.gen) return fail(409, "rekey first");
        invites.set(args.id, { hash: args.hash, wrapped: args.wrapped, gen: args.gen, by: me.id, used: false });
        return ans({ ok: true });
      case "uninvite": invites.delete(args.id); return ans({ ok: true });
      case "approve": return fail(403, "admin");
      case "auto_ask": me.ask = args.sealed; return ans({ ok: true });
      case "wait_list":
        if (!admin) return fail(403, "admin");
        return ans({ rows: all().filter((r) => !r.admitted).map((r) => ({ id: r.id, sign_pub: r.sign, box_pub: r.box, ask_ct: r.ask })) });
      case "admit": {
        const t = rows.get(args.id);
        if (!admin) return fail(403, "admin");
        if (!t || t.admitted) return fail(404, "request");
        t.admitted = true; t.ask = null;
        return ans({ ok: true });
      }
      case "turn_away": case "leave": {
        const tid = b.act === "turn_away" ? args.id : args.target ?? me.id;
        const t = rows.get(tid) ?? null;
        const route = b.act === "turn_away" ? "turn_away" : leaveRoute(me, t);
        if ((route === "turn_away" || route === "remove") && !admin) return fail(403, "admin");
        if (route === "turn_away" && (!t || t.admitted)) return fail(404, "request");
        if (route === "withdraw") { rows.delete(me.id); return ans({ gone: false }); }
        if (t?.who && route !== "leave") blocked.add(t.who);
        rows.delete(tid);
        return ans(b.act === "turn_away" ? { ok: true } : { gone: false });
      }
    }
    return fail(400, "unknown act");
  };
  return { sq, rows, drops, invites, blocked, fetcher };
}
const PROJECT = "https://abcdefghijklmnopqrst.supabase.co";
type Hub = ReturnType<typeof memHub>;

/** Someone who was in before the change (admitted), all the way in with today's code. */
async function memberBefore(h: Hub, name: string, holder?: SquadRec): Promise<SquadRec> {
  const p = await newPending(name);
  const row = { sign: p.sign.pub, box: p.box.pub, who: await whoHash(PROJECT, S.newUuid()), has_key: false, card_ct: null, card_gen: null, admitted: true, ask: null };
  const id = S.newUuid();
  h.rows.set(id, { ...row, id, joined: Date.now() - 864e5 });
  const pending: Pending = { ...p, squadId: h.sq.id, memberId: id };
  if (holder) await handOut(holder, hubApi({ member: holder.memberId, priv: holder.sign.priv }, h.fetcher));
  const out = await autoCheck(pending, h.fetcher);
  assert.equal(out.state, "in", `${name} gets in`);
  return (out as { rec: SquadRec }).rec;
}
/** A stranger's PS (V1.49 to V1.56, unchanged): joins by itself. */
async function stranger(h: Hub, name: string, uid = S.newUuid()) {
  const p = await newPending(name);
  return (await autoJoin(await whoHash(PROJECT, uid), p, h.fetcher)).pending;
}
const api = (h: Hub, r: SquadRec) => hubApi({ member: r.memberId, priv: r.sign.priv }, h.fetcher);

ok("everyone in before stays in and keeps working", async () => {
  const h = memHub();
  const red = await memberBefore(h, "Owner");
  h.sq.created_by = red.memberId;
  const amy = await memberBefore(h, "Amy", red);
  assert.equal(amy.keys[0].k, red.keys[0].k, "the same squad key");
  assert.deepEqual((await api(h, amy).beat()), { n: 0, h: 0, g: 1, rk: false, q: 0, k: 0, w: 0 });
});
ok("a stranger's PS joins by itself and then waits: no member ever hands it the key", async () => {
  const h = memHub();
  const red = await memberBefore(h, "Owner");
  h.sq.created_by = red.memberId;
  const amy = await memberBefore(h, "Amy", red);
  const p = await stranger(h, "Mallory");
  assert.ok(p.memberId, "it gets a row (its Ask to join)");
  for (let i = 0; i < 3; i++) {
    assert.equal((await api(h, amy).beat()).k, 0, "members are not told anyone is waiting for the key");
    assert.equal(await handOut(amy, api(h, amy)), 0, "Amy's PS hands nothing over");
    assert.equal(await handOut(red, api(h, red)), 0, "nor does the developer's");
    assert.equal((await autoCheck(p, h.fetcher)).state, "wait", "the stranger keeps waiting");
  }
  assert.equal(h.drops.some((d) => d.member === p.memberId), false, "no key drop for the stranger");
  assert.equal((await api(h, red).beat()).w, 1, "The developer's pulse counts one person asking");
  // Everything else is refused for a waiting row (with its own signed key).
  const as = hubApi({ member: p.memberId!, priv: p.sign.priv }, h.fetcher);
  for (const call of [() => as.pull(null, 0), () => as.beat(), () => as.autoWaiting(), () => as.autoStart(1, "bWV0YQ=="), () => as.invite({ id: S.newUuid(), hash: "a".repeat(64), wrapped: "eA==", gen: 1 })]) {
    await assert.rejects(call, (e: unknown) => e instanceof HubError && e.status === 403 && e.message === "not let in");
  }
});
ok("a stranger cannot get in by claiming a member's join id", async () => {
  const h = memHub();
  const red = await memberBefore(h, "Owner");
  h.sq.created_by = red.memberId;
  const amyUid = S.newUuid();
  const amy = await memberBefore(h, "Amy", red);
  h.rows.get(amy.memberId)!.who = await whoHash(PROJECT, amyUid);
  await assert.rejects(stranger(h, "Fake Amy", amyUid), (e: unknown) => e instanceof HubError && e.status === 409);
  assert.ok(h.rows.get(amy.memberId)?.admitted, "Amy untouched");
});
ok("the old Ask to join and the V1.49+ admin's automatic Approve are refused", async () => {
  const h = memHub();
  const red = await memberBefore(h, "Owner");
  h.sq.created_by = red.memberId;
  await assert.rejects(api(h, red).approve({ id: S.newUuid(), member: S.newUuid(), gen: 1, drop: "eA==", card: "eA==" }), (e: unknown) => e instanceof HubError && e.status === 403);
  const k = await S.newSignPair();
  await assert.rejects(hubCall({ member: "", priv: k.priv }, "ask", { sign: k.pub, box: (await S.newBoxPair()).pub, id: S.newUuid(), squad: h.sq.id, admin: red.box.pub, sealed: "x" }, h.fetcher),
    (e: unknown) => e instanceof HubError && e.status === 404);
});
ok("the admin lets a waiting person in: members' PS then hand them the key, the same as today", async () => {
  const h = memHub();
  const red = await memberBefore(h, "Owner");
  h.sq.created_by = red.memberId;
  const amy = await memberBefore(h, "Amy", red);
  const p = await stranger(h, "Sam");
  const other = await stranger(h, "Mallory");
  await assert.rejects(hubCall({ member: amy.memberId, priv: amy.sign.priv }, "admit", { id: p.memberId }, h.fetcher), (e: unknown) => e instanceof HubError && e.status === 403,
    "only the admin");
  const list = await hubCall<{ rows: { id: string }[] }>({ member: red.memberId, priv: red.sign.priv }, "wait_list", {}, h.fetcher);
  assert.deepEqual(list.rows.map((r) => r.id).sort(), [p.memberId, other.memberId].sort());
  await hubCall({ member: red.memberId, priv: red.sign.priv }, "admit", { id: p.memberId }, h.fetcher);
  assert.equal((await api(h, amy).beat()).k, 1, "now members see one person waiting for the key");
  assert.equal(await handOut(amy, api(h, amy)), 1, "Amy's PS (today's code) hands it to Sam only");
  const out = await autoCheck(p, h.fetcher);
  assert.equal(out.state, "in", "Sam's PS (today's code) is in");
  assert.equal((out as { rec: SquadRec }).rec.keys[0].k, red.keys[0].k);
  assert.equal((await autoCheck(other, h.fetcher)).state, "wait", "Mallory still waits");
});
ok("the admin turns someone away: their row goes, and they cannot ask again by themselves", async () => {
  const h = memHub();
  const red = await memberBefore(h, "Owner");
  h.sq.created_by = red.memberId;
  const uid = S.newUuid();
  const p = await stranger(h, "Mallory", uid);
  await hubCall({ member: red.memberId, priv: red.sign.priv }, "turn_away", { id: p.memberId }, h.fetcher);
  assert.equal(h.rows.has(p.memberId!), false);
  await assert.rejects(stranger(h, "Mallory", uid), (e: unknown) => e instanceof HubError && e.status === 403 && /removed/.test(e.message));
  assert.equal(sayAuto(403, "removed").problem, "removed", "today's PS stops trying by itself");
});
ok("a waiting person gives up: the row goes, nobody re-keys", async () => {
  const h = memHub();
  const red = await memberBefore(h, "Owner");
  h.sq.created_by = red.memberId;
  const p = await stranger(h, "Sam");
  await hubApi({ member: p.memberId!, priv: p.sign.priv }, h.fetcher).leave();
  assert.equal(h.rows.has(p.memberId!), false);
  assert.equal(h.sq.rekey, false);
});
ok("Add friend: an invite from ANY member (not just the admin) lets a new person straight in", async () => {
  const h = memHub();
  const red = await memberBefore(h, "Owner");
  h.sq.created_by = red.memberId;
  const amy = await memberBefore(h, "Amy", red);
  // Amy is not the admin. Today's app shows her an ask link; V1.57 makes her a one time invite with the same code.
  const code = await makeFriendCode(amy, { admin: true, listed: true, fetcher: h.fetcher });
  assert.equal(code.kind, "join");
  const link = parseFriendLink(new URL((code as { url: string }).url).hash);
  const r = await acceptFriend(link, "Sam", {
    inSquad: () => false,
    join: async (l, n) => (await joinSquad(l, n, h.fetcher)).squadId,
    ask: async () => null,
    say: (e) => String(e),
  });
  assert.deepEqual(r, { state: "in", squad: h.sq.id });
  const sam = [...h.rows.values()].find((x) => x.card_ct && ![red.memberId, amy.memberId].includes(x.id));
  assert.ok(sam?.admitted && sam.has_key, "Sam is in with the key from the link");
  // The same code again: used.
  const again = await acceptFriend(link, "Eve", { inSquad: () => false, join: async (l, n) => (await joinSquad(l, n, h.fetcher)).squadId, ask: async () => null,
    say: (e) => (e instanceof HubError ? `${e.status} ${e.message}` : String(e)) });
  assert.deepEqual(again, { state: "error", message: "403 invite" });
});
ok("an invite made by someone who is not let in is refused", async () => {
  const h = memHub();
  const red = await memberBefore(h, "Owner");
  h.sq.created_by = red.memberId;
  const amy = await memberBefore(h, "Amy", red);
  const code = await makeFriendCode(amy, { admin: true, listed: true, fetcher: h.fetcher });
  h.rows.get(amy.memberId)!.admitted = false;
  const link = parseFriendLink(new URL((code as { url: string }).url).hash);
  const r = await acceptFriend(link, "Sam", { inSquad: () => false, join: async (l, n) => (await joinSquad(l, n, h.fetcher)).squadId, ask: async () => null,
    say: (e) => (e instanceof HubError ? e.message : String(e)) });
  assert.deepEqual(r, { state: "error", message: "invite" });
});
ok("a card can only go up once in (the stranger never gets that far)", async () => {
  const h = memHub();
  const red = await memberBefore(h, "Owner");
  const p = await stranger(h, "Mallory");
  const fakeRec: SquadRec = { ...red, memberId: p.memberId!, sign: p.sign, box: p.box };
  const card = await sealCard(fakeRec, "Mallory");
  await assert.rejects(hubApi({ member: p.memberId!, priv: p.sign.priv }, h.fetcher).card(card.ct, card.gen), (e: unknown) => e instanceof HubError && e.message === "not let in");
});

// ---------- 3. the V1.57 app: asking with a name, the admin's list, the waiting screen ----------
ok("V1.57 asker: autoCheck says waiting for the admin; the name goes up sealed; the admin opens it with the same check code", async () => {
  const h = memHub();
  const red = await memberBefore(h, "Owner");
  h.sq.created_by = red.memberId;
  const p = await stranger(h, "Sam");
  assert.deepEqual(await autoCheck(p, h.fetcher), { state: "wait", admitted: false });
  const box = await askAdmin(p, h.fetcher);
  assert.equal(box, red.box.pub, "sealed to the admin's box key");
  const row = h.rows.get(p.memberId!)!;
  assert.ok(row.ask && !row.ask.includes("Sam"), "the hub holds only ciphertext");
  const list = await hubCall<{ rows: { id: string; sign_pub: string; box_pub: string; ask_ct: string | null; joined_at: string }[] }>(
    { member: red.memberId, priv: red.sign.priv }, "wait_list", {}, h.fetcher);
  const a = await openAsk(red, waitAsRequest({ ...list.rows[0], joined_at: new Date().toISOString() }, red.box.pub));
  assert.equal(a.ok, true);
  assert.equal(a.name, "Sam");
  assert.equal(a.code, await checkCode(p.squadId!, p.sign.pub, p.box.pub, box!), "the asker and the admin see the same check code");
  // The pending join keeps the admin's key it asked (so the code stays the same after a restart).
  const kept = cleanJoinRec({ v: 1, pending: { ...p, asked: box } });
  assert.equal(kept?.pending?.asked, box);
  assert.equal(cleanJoinRec({ v: 1, pending: { ...p, asked: "nope" } })?.pending?.asked, undefined);
});
ok("an ask from PS before V1.57 (no name) or with keys that do not match: Decline only", async () => {
  const h = memHub();
  const red = await memberBefore(h, "Owner");
  h.sq.created_by = red.memberId;
  const old = await stranger(h, "Old app");
  const row = h.rows.get(old.memberId!)!;
  const noName = await openAsk(red, waitAsRequest({ id: row.id, sign_pub: row.sign, box_pub: row.box, ask_ct: null, joined_at: new Date().toISOString() }, red.box.pub));
  assert.equal(noName.ok, false);
  assert.match(NO_NAME_ASK, /only be declined/);
  // A name sealed for different keys than the hub row (someone swapped them): refused too.
  const p = await stranger(h, "Sam");
  await askAdmin(p, h.fetcher);
  const r2 = h.rows.get(p.memberId!)!;
  const swapped = await openAsk(red, waitAsRequest({ id: r2.id, sign_pub: row.sign, box_pub: row.box, ask_ct: r2.ask, joined_at: new Date().toISOString() }, red.box.pub));
  assert.equal(swapped.ok, false);
});
ok("the Tab list mirror keeps the asked stage and its check code (and nothing else new)", () => {
  assert.deepEqual(cleanAutoView({ stage: "asked", code: "123 456", error: null }), { stage: "asked", error: null, code: "123 456" });
  assert.deepEqual(cleanAutoView({ stage: "joining", code: "123 456" }), { stage: "joining", error: null });
  assert.equal(cleanAutoView({ stage: "nope" }), null);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`ok  ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}\n`, e); }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);

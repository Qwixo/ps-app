// Run: node --experimental-strip-types tests/gsquad-dm.test.ts
// G Squad v3 (PS 1.65): direct messages, group chats and profile pictures, against a fake hub that keeps the very rules
// of the real one (membership, epochs, key drops, unread, change only). Names are fictional, nothing touches a network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../src/core/squadcrypto.ts";
import { sealCard, type HubMember, type SquadRec } from "../src/core/squadrec.ts";
import { cleanAvatar, dmConvId, dmKey, dmKeyWith, openConvMessage, planGroupKeys, sealConvMessage } from "../src/core/squaddm.ts";
import { HubError } from "../src/squad/hub.ts";
import type { DmApi, DmMsgRow, DmPull, DmStatus } from "../src/squad/dmhub.ts";
import { DmSession } from "../src/squad/dmflows.ts";
import { buildConvs, cleanConvs, cleanDmOp, cleanMembers } from "../src/squad/dmview.ts";
import { cleanChatOp, cleanChatView, EMPTY_CHAT } from "../src/squad/chatview.ts";

const tests: [string, () => Promise<void> | void][] = [];
const ok = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SQ = "0b6f1a52-7c1d-4b0e-9a3c-1f2e3d4c5b6a";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ" + "A".repeat(200);

// ---------- a squad of fictional people ----------
async function member(id: string, me: string, keys: { gen: number; k: string }[]): Promise<SquadRec> {
  return { v: 1, squadId: SQ, memberId: id, me, keys, sign: await S.newSignPair(), box: await S.newBoxPair(), secret: S.newSecret(), joinedAt: new Date().toISOString() };
}
async function row(r: SquadRec): Promise<HubMember> {
  const c = await sealCard(r, r.me);
  return { id: r.memberId, sign_pub: r.sign.pub, box_pub: r.box.pub, card_ct: c.ct, card_gen: c.gen, left_at: null };
}
const squadKey = await S.newSquadKey();
const A = await member(ID(1), "Alex", [{ gen: 1, k: squadKey }]);
const B = await member(ID(2), "Sam", [{ gen: 1, k: squadKey }]);
const C = await member(ID(3), "Robin", [{ gen: 1, k: squadKey }]);
const D = await member(ID(4), "Kim", [{ gen: 1, k: squadKey }]);
const rows = new Map<string, HubMember>();
for (const r of [A, B, C, D]) rows.set(r.memberId, await row(r));

// ---------- the fake hub ----------
interface FConv { id: string; kind: "dm" | "group"; epoch: number; by: string; keyMembers: string[]; title: string | null; last: string | null; upd: string; people: Map<string, { removed: boolean; joined: string }> }
class FakeHub {
  clock = Date.parse("2026-11-01T10:00:00Z");
  noDm = false;
  convs = new Map<string, FConv>();
  drops: { conv: string; epoch: number; member: string; sealed: string }[] = [];
  msgs: (DmMsgRow & { conv: string })[] = [];
  reads = new Map<string, string>();
  avatars = new Map<string, { ct: string; gen: number; at: string }>();
  left = new Set<string>();
  calls: Record<string, number> = {};
  now() { this.clock += 1000; return new Date(this.clock).toISOString(); }
  inSet(c: FConv) { return [...c.people].filter(([m, p]) => !p.removed && !this.left.has(m)).map(([m]) => m).sort(); }
  private access(me: string, id: string) {
    const c = this.convs.get(id);
    if (!c || !c.people.get(me) || c.people.get(me)!.removed || this.left.has(me)) throw new HubError(403, "not a member");
    return c;
  }
  api(me: string): DmApi {
    const h = this;
    const hit = (a: string) => { h.calls[a] = (h.calls[a] ?? 0) + 1; if (h.noDm) throw new HubError(404, "Requested function was not found"); };
    return {
      async tick(): Promise<DmStatus> {
        hit("tick");
        const convs = [...h.convs.values()].filter((c) => c.people.get(me) && !c.people.get(me)!.removed).map((c) => {
          const rd = h.reads.get(`${c.id}:${me}`) ?? c.people.get(me)!.joined;
          return { id: c.id, k: c.kind, e: c.epoch, last: c.last, upd: c.upd, rot: c.kind === "group" && c.keyMembers.join() !== h.inSet(c).join(), closed: h.inSet(c).length < 2,
            u: h.msgs.filter((m) => m.conv === c.id && m.member_id !== me && !m.deleted && Date.parse(m.created_at) > Date.parse(rd)).length };
        });
        return { convs, av: [...h.avatars.values()].map((a) => a.at).sort().pop() ?? null };
      },
      async pull(conv, since, before): Promise<DmPull> {
        hit("pull");
        const c = h.access(me, conv);
        const mine = h.drops.filter((d) => d.conv === conv && d.member === me);
        const eps = c.kind === "group" ? mine.map((d) => d.epoch) : null;
        let m = h.msgs.filter((x) => x.conv === conv && (!eps || eps.includes(x.epoch)));
        if (before) m = m.filter((x) => x.created_at < before && !x.deleted); else if (since) m = m.filter((x) => x.updated_at > since); else m = m.filter((x) => !x.deleted);
        return { now: h.now(), conv: { id: conv, kind: c.kind, epoch: c.epoch, title_ct: c.title }, people: h.inSet(c), drops: eps && !since ? mine.map((d) => ({ epoch: d.epoch, sealed: d.sealed })) : eps ? mine.filter(() => true).map((d) => ({ epoch: d.epoch, sealed: d.sealed })) : [], msgs: m.map(({ conv: _c, ...r }) => r), more: false };
      },
      async create(a) {
        hit("new");
        const existing = h.convs.get(a.id);
        if (existing) { h.access(me, a.id); return { created: false, epoch: existing.epoch }; }
        const ids = [...new Set([...a.others, me])].sort();
        if (a.kind === "dm" && ids.length !== 2) throw new HubError(409, "drops");
        if (a.kind === "group") {
          if (ids.length < 3 || ids.length > 24 || (a.drops ?? []).map((d) => d.member).sort().join() !== ids.join() || !a.title) throw new HubError(409, "drops");
        }
        if (ids.some((i) => h.left.has(i))) throw new HubError(403, "not a member");
        const t = h.now();
        h.convs.set(a.id, { id: a.id, kind: a.kind, epoch: 1, by: me, keyMembers: a.kind === "group" ? ids : [], title: a.title ?? null, last: null, upd: t, people: new Map(ids.map((i) => [i, { removed: false, joined: t }])) });
        for (const d of a.drops ?? []) h.drops.push({ conv: a.id, epoch: 1, member: d.member, sealed: d.sealed });
        return { created: true, epoch: 1 };
      },
      async change(conv, a) {
        hit("change");
        const c = h.access(me, conv);
        if (c.kind !== "group") throw new HubError(403, "not a member");
        if (a.remove) { if (a.remove !== me && c.by !== me) throw new HubError(403, "not a member"); const p = c.people.get(a.remove); if (p) p.removed = true; }
        for (const x of a.add ?? []) { if (c.by !== me) throw new HubError(403, "not a member"); c.people.set(x, { removed: false, joined: h.now() }); }
        c.upd = h.now();
        return { ok: true };
      },
      async rotate(conv, from, drops, title) {
        hit("rotate");
        const c = h.access(me, conv);
        if (c.epoch !== from) return { done: false, epoch: c.epoch };
        if (c.kind === "dm") { c.epoch++; return { done: true, epoch: c.epoch }; }
        if (c.keyMembers.join() === h.inSet(c).join()) return { done: false, epoch: c.epoch };
        if (drops.map((d) => d.member).sort().join() !== h.inSet(c).join()) throw new HubError(409, "drops");
        c.epoch++; c.keyMembers = h.inSet(c); c.title = title ?? c.title; c.upd = h.now();
        for (const d of drops) h.drops.push({ conv, epoch: c.epoch, member: d.member, sealed: d.sealed });
        return { done: true, epoch: c.epoch };
      },
      async post(conv, id, epoch, ct) {
        hit("post");
        const c = h.access(me, conv);
        if (c.epoch !== epoch || (c.kind === "group" && c.keyMembers.join() !== h.inSet(c).join())) throw new HubError(409, "epoch");
        if (c.kind === "dm" && h.inSet(c).length < 2) throw new HubError(409, "closed");
        const at = h.now();
        h.msgs.push({ conv, id, member_id: me, epoch, ct, edited: false, deleted: false, created_at: at, updated_at: at });
        c.last = at; h.reads.set(`${conv}:${me}`, at);
        return { at };
      },
      async edit(conv, id, ct) { hit("edit"); h.access(me, conv); const m = h.msgs.find((x) => x.id === id && x.member_id === me); if (!m) throw new HubError(404, "no message"); m.ct = ct; m.edited = true; m.updated_at = h.now(); return { ok: true }; },
      async del(conv, id) { hit("del"); h.access(me, conv); const m = h.msgs.find((x) => x.id === id && x.member_id === me); if (m) { m.ct = ""; m.deleted = true; m.updated_at = h.now(); } return { ok: true }; },
      async read(conv, at) { hit("read"); h.access(me, conv); h.reads.set(`${conv}:${me}`, at); return { ok: true }; },
      async avatars(since) { hit("apull"); const r = [...h.avatars].map(([member_id, a]) => ({ member_id, ct: a.ct, gen: a.gen, updated_at: a.at })).filter((x) => !since || x.updated_at > since); return { rows: r, more: false }; },
      async setAvatar(ct, gen) { hit("aset"); h.avatars.set(me, { ct, gen, at: h.now() }); return { ok: true }; },
      async clearAvatar() { hit("aset"); h.avatars.set(me, { ct: "", gen: 1, at: h.now() }); return { ok: true }; },
    };
  }
}
const mem = (m: Map<string, string>) => ({ get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => { m.set(k, v); } });
const session = (hub: FakeHub, r: SquadRec, store = new Map<string, string>()) => new DmSession(r, () => [...rows.values()], hub.api(r.memberId), mem(store));
const text = (hub: FakeHub) => JSON.stringify([hub.convs, hub.drops, hub.msgs, [...hub.avatars]], (_k, v) => (v instanceof Map ? [...v] : v));

// ---------- DMs ----------
ok("a DM key is the same on both devices, and a third member derives a different one that opens nothing", async () => {
  const conv = await dmConvId(SQ, A.memberId, B.memberId);
  assert.equal(conv, await dmConvId(SQ, B.memberId, A.memberId), "the same id from both sides");
  const ka = await dmKey(A, conv, B.memberId, B.box.pub, 1), kb = await dmKey(B, conv, A.memberId, A.box.pub, 1);
  assert.equal(ka, kb);
  const id = S.newUuid();
  const ct = await sealConvMessage(ka, SQ, conv, 1, A.memberId, id, { t: "just us" });
  assert.equal((await openConvMessage(kb, SQ, conv, 1, A.memberId, id, ct))?.t, "just us");
  // Robin tries every key she can make: with Alex's public key, with Sam's, and the squad key.
  for (const k of [await dmKey(C, conv, A.memberId, A.box.pub, 1), await dmKey(C, conv, B.memberId, B.box.pub, 1), squadKey]) {
    assert.notEqual(k, ka);
    assert.equal(await openConvMessage(k, SQ, conv, 1, A.memberId, id, ct), null);
  }
  // Bound to squad, conversation, epoch, author and message id.
  assert.equal(await openConvMessage(ka, SQ, conv, 2, A.memberId, id, ct), null, "another epoch");
  assert.equal(await openConvMessage(ka, SQ, conv, 1, B.memberId, id, ct), null, "another author");
  assert.equal(await openConvMessage(ka, SQ, conv, 1, A.memberId, S.newUuid(), ct), null, "another message id");
  assert.equal(await openConvMessage(ka, SQ, await dmConvId(SQ, A.memberId, C.memberId), 1, A.memberId, id, ct), null, "another conversation");
  assert.equal(await openConvMessage(ka, ID(99), conv, 1, A.memberId, id, ct), null, "another squad");
  assert.notEqual(await dmKey(A, conv, B.memberId, B.box.pub, 2), ka, "a new epoch is a new key");
});

ok("a DM end to end: opened by the other person, the hub holds no words and no key, a third member is refused", async () => {
  const hub = new FakeHub();
  const a = session(hub, A), b = session(hub, B), c = session(hub, C);
  const id = await a.newDm(B.memberId);
  assert.equal(id, await b.newDm(A.memberId), "both sides open the same conversation");
  await a.send(id, { t: "meet at nine, secret plan" });
  assert.deepEqual(await b.tick(), [id]);
  await b.pull(id);
  assert.equal(b.list(id)[0].t, "meet at nine, secret plan");
  assert.doesNotMatch(text(hub), /secret plan/);
  assert.equal(JSON.stringify([...hub.convs.values()].map((x) => x.title)), "[null]");
  assert.equal(hub.drops.length, 0, "the hub never holds a key for a DM");
  // Robin: the hub shows her nothing, and a pull of the id is refused.
  assert.deepEqual(await c.tick(), []);
  c.convs.set(id, { id, kind: "dm", epoch: 1, title: null, people: [A.memberId, B.memberId], keys: new Map(), msgs: new Map(), reacts: new Map(), gone: new Set(), since: null, more: false, loaded: false, status: { last: null, upd: "", rot: false, closed: false, u: 0 } });
  await c.pull(id);
  assert.equal(c.convs.has(id), false, "dropped on the hub's refusal");
  assert.equal(c.list(id).length, 0);
  // Even with the ciphertext in her hands she cannot open it.
  const row0 = hub.msgs[0];
  for (const k of [await dmKey(C, id, A.memberId, A.box.pub, 1), await dmKey(C, id, B.memberId, B.box.pub, 1)]) assert.equal(await openConvMessage(k, SQ, id, 1, row0.member_id, row0.id, row0.ct), null);
});

ok("a DM waits when the other person's card does not match the hub's key (the hub cannot slip its own key in)", async () => {
  const hub = new FakeHub();
  const evil = await S.newBoxPair();
  const bad = new Map(rows); bad.set(B.memberId, { ...rows.get(B.memberId)!, box_pub: evil.pub });
  const a = new DmSession(A, () => [...bad.values()], hub.api(A.memberId), null);
  await assert.rejects(a.newDm(B.memberId), /not ready/);
  assert.equal(await dmKeyWith(A, "x", bad.get(B.memberId)!, 1), null);
  assert.equal(hub.convs.size, 0);
  await assert.rejects(a.newGroup("Crew", [B.memberId, C.memberId]), /not ready/);
});

ok("unread counts per conversation, cleared by reading, and the list is sorted by last message", async () => {
  const hub = new FakeHub();
  const a = session(hub, A), b = session(hub, B);
  const ab = await a.newDm(B.memberId), ac = await a.newDm(C.memberId);
  await a.send(ab, { t: "one" }); await a.send(ab, { t: "two" });
  await a.send(ac, { t: "to robin" });
  await b.tick();
  assert.equal(b.convs.get(ab)!.status.u, 2);
  await b.pull(ab); await b.markRead(ab);
  assert.equal(b.convs.get(ab)!.status.u, 0);
  assert.equal((await hub.api(B.memberId).tick()).convs[0].u, 0, "the hub agrees");
  const list = buildConvs([
    { id: "squad", kind: "squad", title: "G Squad", memberIds: [], unread: 3, last: { text: "hi", at: "2026-11-01T10:00:00Z", from: "Sam" } },
    { id: ab, kind: "dm", title: "Alex", memberIds: [], unread: 0, last: { text: "two", at: "2026-11-01T11:00:00Z", from: "Alex" }, avatar: A.memberId },
    { id: ac, kind: "dm", title: "Robin", memberIds: [], unread: 1 },
  ]);
  assert.deepEqual(list.map((c) => c.id), [ab, "squad", ac]);
  assert.equal(list[0].avatar, A.memberId);
});

ok("change only sync: a quiet tick pulls nothing, a new message pulls just that conversation", async () => {
  const hub = new FakeHub();
  const a = session(hub, A), b = session(hub, B);
  const ab = await a.newDm(B.memberId), ac = await a.newDm(C.memberId);
  await a.send(ab, { t: "x" }); await a.send(ac, { t: "y" });
  assert.equal((await b.tick()).length, 1);
  await b.pull(ab);
  const pulls = hub.calls.pull;
  assert.deepEqual(await b.tick(), [], "nothing changed");
  assert.equal(hub.calls.pull, pulls, "no pull for a quiet tick");
  await a.send(ab, { t: "z" });
  assert.deepEqual(await b.tick(), [ab]);
});

ok("a DM can be rotated: new messages use the new epoch, old ones still open", async () => {
  const hub = new FakeHub();
  const a = session(hub, A), b = session(hub, B);
  const id = await a.newDm(B.memberId);
  await a.send(id, { t: "before" });
  await a.rotateDm(id);
  await a.send(id, { t: "after" });
  await b.tick(); await b.pull(id);   // Sam's session has epoch 2 from the pull
  assert.deepEqual(b.list(id).map((m) => m.t), ["before", "after"]);
  assert.deepEqual(hub.msgs.map((m) => m.epoch), [1, 2]);
});

ok("a stale epoch is retried once after a pull, never twice", async () => {
  const hub = new FakeHub();
  const a = session(hub, A), b = session(hub, B);
  const id = await a.newDm(B.memberId);
  await b.tick(); await b.pull(id);
  await a.rotateDm(id);
  await b.send(id, { t: "sent on the old epoch" });
  assert.equal(hub.msgs[0].epoch, 2);
  assert.equal((await a.pull(id), a.list(id)[0].t), "sent on the old epoch");
});

// ---------- groups ----------
ok("a group: key sealed to each member, all three read it, the hub sees no title and no words", async () => {
  const hub = new FakeHub();
  const a = session(hub, A), b = session(hub, B), c = session(hub, C);
  const g = await a.newGroup("Gym crew", [B.memberId, C.memberId]);
  await a.send(g, { t: "leg day tomorrow" });
  for (const s of [b, c]) { await s.tick(); await s.pull(g); assert.equal(s.list(g)[0].t, "leg day tomorrow"); assert.equal(s.convs.get(g)!.title, "Gym crew"); }
  assert.doesNotMatch(text(hub), /leg day|Gym crew/);
  assert.equal(hub.drops.length, 3);
  const d = session(hub, D);
  assert.deepEqual(await d.tick(), [], "an outsider sees nothing");
  await assert.rejects(a.newGroup("Solo", [B.memberId]), /two or more/);
});

ok("a removed member cannot read new group messages and holds no key for them", async () => {
  const hub = new FakeHub();
  const a = session(hub, A), b = session(hub, B), c = session(hub, C);
  const g = await a.newGroup("Crew", [B.memberId, C.memberId]);
  await a.send(g, { t: "all of us" });
  await c.tick(); await c.pull(g);
  assert.equal(c.list(g).length, 1);
  const cKeys = new Map(c.convs.get(g)!.keys);
  await a.removeMember(g, C.memberId);
  assert.equal(hub.convs.get(g)!.epoch, 2, "a new key was made");
  // Writing is blocked until the new key exists, then goes on
  await a.send(g, { t: "without robin" });
  await b.tick(); await b.pull(g);
  assert.deepEqual(b.list(g).map((m) => m.t), ["all of us", "without robin"]);
  // Robin: refused by the hub, and her old key opens nothing new
  assert.deepEqual(await c.tick(), []);
  await assert.rejects(hub.api(C.memberId).pull(g, null), /not a member/);
  const row2 = hub.msgs.find((m) => m.epoch === 2)!;
  for (const [e, k] of cKeys) assert.equal(await openConvMessage(k, SQ, g, row2.epoch, row2.member_id, row2.id, row2.ct), null, `key of epoch ${e}`);
  assert.equal(hub.drops.filter((d) => d.epoch === 2 && d.member === C.memberId).length, 0, "no new key sealed to her");
  assert.equal(hub.drops.filter((d) => d.epoch === 2).length, 2);
});

ok("leaving a group, or leaving the squad, makes the others rekey; sending is blocked until they do", async () => {
  const hub = new FakeHub();
  const a = session(hub, A), b = session(hub, B), c = session(hub, C);
  const g = await a.newGroup("Crew", [B.memberId, C.memberId]);
  await c.leave(g);
  assert.equal(c.convs.has(g), false);
  await assert.rejects(hub.api(A.memberId).post(g, S.newUuid(), 1, "AAAA"), /epoch/, "the old key no longer covers who is in");
  await b.tick();
  assert.equal(b.convs.get(g)!.status.rot, true);
  await b.rotateIfDue(g);
  await b.send(g, { t: "after she left" });
  assert.equal(hub.convs.get(g)!.epoch, 2);
  hub.left.add(B.memberId);   // Sam leaves the whole squad: Alex alone is left, still a group of one but never readable by Sam
  await a.tick();
  assert.equal(a.convs.get(g)!.status.rot, true);
});

ok("a member added later gets keys from their epoch on and never reads older messages", async () => {
  const hub = new FakeHub();
  const a = session(hub, A), b = session(hub, B), c = session(hub, C), d = session(hub, D);
  const g = await a.newGroup("Crew", [B.memberId, C.memberId]);
  await a.send(g, { t: "old news" });
  await a.addMembers(g, [D.memberId]);
  await a.send(g, { t: "new news" });
  await d.tick(); await d.pull(g);
  assert.deepEqual(d.list(g).map((m) => m.t), ["new news"]);
});

ok("the plan for a group key refuses an unchecked member and a plan without yourself", async () => {
  const evil = await S.newBoxPair();
  assert.equal(await planGroupKeys(A, S.newUuid(), 1, [rows.get(A.memberId)!, { ...rows.get(B.memberId)!, box_pub: evil.pub }], "x"), null);
  assert.equal(await planGroupKeys(A, S.newUuid(), 1, [rows.get(B.memberId)!, rows.get(C.memberId)!], "x"), null);
});

// ---------- pictures ----------
ok("profile pictures: sealed with the squad key, fetched once, cached on the device, updated on change only", async () => {
  const hub = new FakeHub();
  const store = new Map<string, string>();
  const a = session(hub, A), b = session(hub, B, store);
  await a.setAvatar(JPEG);
  assert.doesNotMatch(text(hub), /9j\/4AAQ/, "the hub holds only ciphertext");
  await b.tick();
  assert.equal(b.pics.get(A.memberId), JPEG);
  assert.equal(hub.calls.apull, 1);
  await b.tick(); await b.tick();
  assert.equal(hub.calls.apull, 1, "no second fetch while nothing changed");
  // After a restart: the picture is on screen from the device's cache with no hub call at all
  const b2 = session(hub, B, store);
  await b2.loadCache();
  assert.equal(b2.pics.get(A.memberId), JPEG);
  await b2.tick();
  assert.equal(hub.calls.apull, 1, "the stored change stamp says nothing is new");
  // A change is fetched once, a removal clears it
  await a.setAvatar(JPEG.replace("AAAA", "BBBB"));
  await b2.tick();
  assert.equal(hub.calls.apull, 2);
  await a.clearAvatar();
  await b2.tick();
  assert.equal(b2.pics.has(A.memberId), false);
  // Someone from another squad cannot open it (a different squad key)
  const other = await member(ID(9), "Eve", [{ gen: 1, k: await S.newSquadKey() }]);
  const e = new DmSession(other, () => [], hub.api(other.memberId), null);
  await a.setAvatar(JPEG);
  await e.pullAvatars();
  assert.equal(e.pics.size, 0);
});

ok("a picture must be a small jpeg or webp", async () => {
  assert.equal(cleanAvatar(JPEG), JPEG);
  assert.equal(cleanAvatar("data:image/png;base64,AAAA"), null);
  assert.equal(cleanAvatar("data:image/jpeg;base64," + "A".repeat(60_000)), null, "over 40 KB");
  assert.equal(cleanAvatar("https://example.com/a.jpg"), null);
  assert.equal(cleanAvatar("data:image/jpeg;base64,<script>"), null);
  const a = session(new FakeHub(), A);
  await assert.rejects(a.setAvatar("data:image/gif;base64,AAAA"), /too big/);
});

ok("a picture sealed under an older squad key is sealed again under the newest", async () => {
  const hub = new FakeHub();
  const a = session(hub, A);
  await a.setAvatar(JPEG);
  const k2 = await S.newSquadKey();
  const A2: SquadRec = { ...A, keys: [...A.keys, { gen: 2, k: k2 }] };
  const a2 = session(hub, A2);
  hub.avatars.set(A.memberId, { ...hub.avatars.get(A.memberId)!, at: hub.now() });
  await a2.tick();
  assert.equal(hub.avatars.get(A.memberId)!.gen, 2);
});

// ---------- old hub, old clients, the view ----------
ok("a hub without the dm function: everything stays hidden and quiet, the squad list is just the squad chat", async () => {
  const hub = new FakeHub();
  hub.noDm = true;
  const a = session(hub, A);
  assert.deepEqual(await a.tick(), []);
  assert.equal(a.available, false);
  assert.deepEqual(buildConvs([]).map((c) => c.id), ["squad"]);
  assert.equal(buildConvs([])[0].kind, "squad");
  // A server error that is not "not there" is not swallowed as "no DMs"
  const bad = new DmSession(A, () => [], { ...hub.api(A.memberId), tick: async () => { throw new HubError(500, "database"); } }, null);
  await assert.rejects(bad.tick());
});

ok("old clients keep working: the squad chat ops and an old view (no convs) are unchanged", () => {
  assert.deepEqual(cleanChatOp({ op: "send", text: "hello" }), { op: "send", text: "hello" });
  assert.deepEqual(cleanChatOp({ op: "open", on: true }), { op: "open", on: true });
  assert.equal(cleanChatOp({ op: "bogus" }), null);
  const v = cleanChatView({ in: true, ready: true, lines: [], unread: 2 });
  assert.equal(v.activeConv, "squad");
  assert.deepEqual(v.convs, []);
  assert.equal(v.dm, false);
  assert.deepEqual(EMPTY_CHAT.convs, []);
  const src = read("src/squad/chatengine.ts");
  assert.match(src, /export async function runChatOp/);
  assert.match(src, /dm\.available === true && feature\(DM_FEATURE\)/);
});

ok("the view shape matches the contract and is cleaned on the way to the Tab list", () => {
  const v = cleanChatView({
    in: true, open: true, activeConv: "squad", dm: true,
    convs: [
      { id: "squad", kind: "squad", title: "G Squad", memberIds: [ID(1), ID(2)], unread: 2, last: { text: "hi", at: "2026-11-01T10:00:00Z", from: "Sam" } },
      { id: ID(50), kind: "dm", title: "Sam", memberIds: [ID(1), ID(2)], unread: 0, avatar: ID(2) },
      { id: ID(51), kind: "group", title: "Crew", memberIds: [ID(1)], unread: 5000000 },
      { id: "x", kind: "weird", title: "no" }, null,
    ],
    members: [{ id: ID(2), name: "Sam", me: false, left: false, pic: JPEG }, { id: ID(3), name: "Robin", pic: "javascript:alert(1)" }],
  });
  assert.equal(v.convs!.length, 3);
  assert.deepEqual(Object.keys(v.convs![0]).sort(), ["id", "kind", "last", "memberIds", "title", "unread"]);
  assert.equal(v.convs![1].avatar, ID(2));
  assert.equal(v.convs![2].unread, 9999);
  assert.equal(v.members![0].pic, JPEG);
  assert.equal(v.members![1].pic, undefined, "a picture that is not a small data URL is dropped");
  assert.equal(cleanConvs("nope").length, 0);
  assert.equal(cleanMembers(null).length, 0);
});

ok("the new ops are checked field by field", () => {
  assert.deepEqual(cleanChatOp({ op: "openConv", id: "squad" }), { op: "openConv", id: "squad" });
  assert.equal(cleanChatOp({ op: "openConv", id: "../etc" }), null);
  assert.deepEqual(cleanChatOp({ op: "newDm", memberId: ID(2).toUpperCase() }), { op: "newDm", memberId: ID(2) });
  assert.equal(cleanChatOp({ op: "newDm", memberId: "nope" }), null);
  assert.equal(cleanDmOp({ op: "newGroup", title: "Crew", memberIds: [ID(2)] }), null, "needs two others");
  assert.deepEqual(cleanDmOp({ op: "newGroup", title: " Crew ", memberIds: [ID(2), ID(3), ID(2), "bad"] }), { op: "newGroup", title: "Crew", memberIds: [ID(2), ID(3)] });
  assert.equal(cleanDmOp({ op: "newGroup", title: "", memberIds: [ID(2), ID(3)] }), null);
  assert.equal(cleanDmOp({ op: "setAvatar", dataUrl: "data:text/html;base64,AAAA" }), null);
  assert.deepEqual(cleanDmOp({ op: "setAvatar", dataUrl: JPEG }), { op: "setAvatar", dataUrl: JPEG });
  assert.deepEqual(cleanChatOp({ op: "clearAvatar" }), { op: "clearAvatar" });
  assert.deepEqual(cleanDmOp({ op: "groupRemove", id: ID(5), memberId: ID(6) }), { op: "groupRemove", id: ID(5), memberId: ID(6) });
});

// ---------- the hub files ----------
ok("the hub function and migration: signed acts only, rate limits, closed tables, no dashes, switch on by default", () => {
  const fn = read("supabase/hub/functions/dm/index.ts"), sql = read("supabase/hub/migrations/dm_001_dm_groups_avatars.sql"), rb = read("supabase/hub/migrations/dm_001_rollback.sql");
  assert.match(fn, /\^d_\[a-z\]\{2,10\}\$/);
  assert.match(fn, /gsquad-v1\|\$\{act\}\|\$\{member\}\|\$\{ts\}\|\$\{nonce\}\|\$\{bodyHash\}/, "the same signed text as the core");
  assert.match(fn, /squad_nonces/);
  assert.match(fn, /admitted", true/);
  assert.match(fn, /> 120/);
  assert.match(sql, />= 30 then raise exception 'slow'/);
  assert.match(sql, />= 10 then raise exception 'slow'/);
  assert.match(sql, /interval '10 seconds'/);
  for (const t of ["dm_convs", "dm_members", "dm_keydrops", "dm_messages", "dm_reads", "dm_avatars"]) { assert.match(sql, new RegExp(`'${t}'`)); assert.match(rb, new RegExp(t)); }
  assert.match(sql, /force row level security/);
  assert.match(sql, /grant execute on function public\.%s to service_role/);
  assert.doesNotMatch(fn + sql + rb, /[–—]/);
  const f = JSON.parse(read("../features.json")).features.find((x: { id: string }) => x.id === "gsquad-dm");
  assert.equal(f.default, "on"); assert.equal(f.owner, "jan"); assert.equal(f.scope, "shared"); assert.equal(f.since, "1.65");
  assert.match(read("../FEATURES.md"), /gsquad-dm/);
  for (const p of ["src/core/squaddm.ts", "src/squad/dmflows.ts", "src/squad/dmhub.ts", "src/squad/dmview.ts"]) assert.doesNotMatch(read(p), /[–—]/, p);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log("ok -", name); }
  catch (e) { failed++; console.log("FAIL -", name); console.log(e); }
}
console.log(`\n${tests.length - failed} of ${tests.length} passed`);
if (failed) process.exit(1);

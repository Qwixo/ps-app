// G Squad v3 (PS 1.65): one member's direct messages, group chats and pictures, with no vault and no screen in it (like
// chatflows.ts), so the engine and the tests run the very same steps. Keys live in memory only: a group's keys come from
// the hub sealed to your box key, a DM's key is derived from your box key and the other member's checked one.
// Members (their box keys and sealed cards) come from the squad chat's own pull, handed in as `members()`.
import { newUuid } from "../core/squadcrypto.ts";
import { currentKey, type HubMember, type SquadRec } from "../core/squadrec.ts";
import { cleanBody, hubMicros, type ChatBody } from "../core/squadchat.ts";
import { checkGroupDrop, cleanAvatar, cleanTitle, dmConvId, dmKeyWith, MAX_GROUP, openAvatar, openConvMessage, openGroupDrop, openTitle, planGroupKeys, sealAvatar, sealConvMessage, type GroupTrust } from "../core/squaddm.ts";
import { HubError } from "./hub.ts";
import { reactPlan, type ReactEvent } from "./chatreact.ts";
import type { ChatMsg } from "./chatflows.ts";
import type { DmApi, DmMsgRow, DmStatusConv } from "./dmhub.ts";

export interface DmConv {
  id: string; kind: "dm" | "group"; epoch: number; title: string | null; people: string[];
  keys: Map<number, string>; msgs: Map<string, ChatMsg>; reacts: Map<string, ReactEvent>; gone: Set<string>;
  since: string | null; more: boolean; loaded: boolean;
  status: { last: string | null; upd: string; rot: boolean; closed: boolean; u: number };
  trust?: GroupTrust | null;   // group: the last key epoch whose signed envelope checked out (memory only, rebuilt from the signed epochs)
}
/** Where the sealed pictures and the change cursor are kept between runs (the engine hands localStorage, tests a map). */
export interface AvatarStore { get(k: string): string | null; set(k: string, v: string): void }

const RETRY_MS = 3_600_000;
const shell = (id: string, kind: "dm" | "group", epoch: number, people: string[]): DmConv => ({
  id, kind, epoch, title: null, people, keys: new Map(), msgs: new Map(), reacts: new Map(), gone: new Set(), since: null, more: false, loaded: false,
  status: { last: null, upd: "", rot: false, closed: false, u: 0 },
});

export class DmSession {
  readonly rec: SquadRec;
  readonly api: DmApi;
  convs = new Map<string, DmConv>();
  pics = new Map<string, string>();       // member id to picture (a data URL), only what opened
  available: boolean | null = null;       // null = not asked yet; false = the hub has no `dm` function (everything stays hidden)
  private members: () => HubMember[];
  private store: AvatarStore | null;
  now: () => number = () => Date.now();
  retryAt = 0;
  private avCursor: string | null = null;
  private avSeen: string | null = null;
  private avSealed = new Map<string, { ct: string; gen: number }>();   // as the hub sent them: the cache on disk

  constructor(rec: SquadRec, members: () => HubMember[], api: DmApi, store: AvatarStore | null = null) {
    this.rec = rec; this.members = members; this.api = api; this.store = store;
  }
  private get me() { return this.rec.memberId; }
  private row(id: string) { return this.members().find((m) => m.id === id && !m.left_at) ?? null; }

  // ---------- the cheap look ----------
  /** One small call. Returns the ids of conversations that are new or changed (the caller pulls only those). */
  async tick(): Promise<string[]> {
    if (this.now() < this.retryAt) return [];   // the hub had no `dm` a short while ago: look again once an hour, not every 2 minutes
    let st;
    try { st = await this.api.tick(); }
    catch (e) { if (e instanceof HubError && (e.status === 404 || e.status === 403)) { this.available = false; this.retryAt = this.now() + RETRY_MS; return []; } throw e; }
    this.retryAt = 0;
    this.available = true;
    const changed: string[] = [], seen = new Set<string>();
    for (const c of st.convs) {
      seen.add(c.id);
      const had = this.convs.get(c.id);
      const cur = had ?? shell(c.id, c.k, c.e, []);
      const was = cur.status;
      cur.kind = c.k; cur.epoch = Math.max(cur.epoch, c.e);
      cur.status = { last: c.last, upd: c.upd, rot: c.rot, closed: c.closed, u: c.u };
      this.convs.set(c.id, cur);
      if (!had || was.last !== c.last || was.upd !== c.upd) changed.push(c.id);
    }
    // Removed from it: gone for you. The hub lists at most 100, so with more than that nothing is dropped here (a pull's 403 does it).
    if (!st.more) for (const id of [...this.convs.keys()]) if (!seen.has(id)) this.convs.delete(id);
    if (st.av && st.av !== this.avSeen) await this.pullAvatars(st.av);
    return changed;
  }

  // ---------- keys ----------
  private async keyFor(c: DmConv, epoch: number): Promise<string | null> {
    const have = c.keys.get(epoch);
    if (have) return have;
    if (c.kind !== "dm") return null;
    const peer = c.people.find((p) => p !== this.me);
    const row = peer ? this.row(peer) : null;
    const k = row ? await dmKeyWith(this.rec, c.id, row, epoch) : null;
    if (k) c.keys.set(epoch, k);
    return k;
  }

  // ---------- data ----------
  /** Everything changed in one conversation since the last pull. A 403 means you are out of it: it is dropped. */
  async pull(id: string): Promise<void> {
    const c = this.convs.get(id);
    if (!c) return;
    let p;
    try { p = await this.api.pull(id, c.since); }
    catch (e) { if (e instanceof HubError && e.status === 403) { this.convs.delete(id); return; } throw e; }
    c.kind = p.conv.kind; c.epoch = p.conv.epoch; c.people = p.people;
    // A group key copy is accepted only with a signature by a checked member who may make it (checkGroupDrop): a hub that
    // swaps the keys or adds a member has no such signature, so its copy is ignored and the group just stays out of date.
    for (const d of [...p.drops].sort((a, b) => a.epoch - b.epoch)) {
      if (c.keys.has(d.epoch)) continue;
      const env = (p.epochs ?? []).find((e) => e.epoch === d.epoch);
      if (!env || typeof d.sig !== "string") continue;
      const signer = this.members().find((m) => m.id === env.signer);
      if (!(await checkGroupDrop(this.rec, id, env, d.sealed, d.sig, signer, c.trust ?? null))) continue;
      const k = await openGroupDrop(this.rec, id, d.epoch, d.sealed);
      if (!k) continue;
      c.keys.set(d.epoch, k);
      c.trust = { epoch: d.epoch, members: env.members, creator: env.creator };
      const t = await openTitle(k, this.rec.squadId, id, d.epoch, env.title_ct);
      if (t) c.title = t;
    }
    await this.take(c, p.msgs);
    if (!c.since) c.more = p.more;
    c.since = new Date(Date.parse(p.now) - 5_000).toISOString();
    c.loaded = true;
  }
  async older(id: string): Promise<number> {
    const c = this.convs.get(id);
    const oldest = c && [...c.msgs.values()].reduce<string | null>((o, m) => (!o || hubMicros(m.at) < hubMicros(o) ? m.at : o), null);
    if (!c || !oldest) return 0;
    const p = await this.api.pull(id, null, oldest);
    const n = c.msgs.size;
    await this.take(c, p.msgs);
    c.more = p.more;
    return c.msgs.size - n;
  }
  private async take(c: DmConv, rows: DmMsgRow[]) {
    for (const r of rows) {
      if (r.deleted) { c.msgs.delete(r.id); c.reacts.delete(r.id); c.gone.add(r.id); continue; }
      const raw = await this.keyFor(c, r.epoch);
      if (!raw) continue;
      const b = await openConvMessage(raw, this.rec.squadId, c.id, r.epoch, r.member_id, r.id, r.ct);
      if (!b) continue;
      if (b.r) { c.reacts.set(r.id, { id: r.id, from: r.member_id, to: b.r.to, e: b.r.e, at: r.created_at }); continue; }
      c.msgs.set(r.id, { id: r.id, from: r.member_id, epoch: r.epoch, t: b.t, ...(b.a ? { a: b.a } : {}), ...(b.q ? { q: b.q } : {}), at: r.created_at, edited: r.edited });
    }
  }
  list(id: string, limit = 150): ChatMsg[] {
    const c = this.convs.get(id);
    return c ? [...c.msgs.values()].sort((a, b) => hubMicros(a.at) - hubMicros(b.at) || a.id.localeCompare(b.id)).slice(-limit) : [];
  }

  // ---------- making conversations ----------
  /** Opens or creates the DM with a member. Refuses (throws) while their card does not check out. */
  async newDm(peerId: string): Promise<string> {
    if (peerId === this.me) throw new Error("Pick someone else.");
    const id = await dmConvId(this.rec.squadId, this.me, peerId);
    if (this.convs.has(id)) return id;
    const peer = this.row(peerId);
    if (!peer || !(await dmKeyWith(this.rec, id, peer, 1))) throw new Error("That person is not ready for messages yet.");
    const r = await this.api.create({ id, kind: "dm", others: [peerId] });
    const c = shell(id, "dm", r.epoch, [this.me, peerId].sort());
    this.convs.set(id, c);
    return id;
  }
  async newGroup(title: string, memberIds: string[]): Promise<string> {
    const others = [...new Set(memberIds)].filter((m) => m !== this.me);
    if (others.length < 2 || others.length + 1 > MAX_GROUP) throw new Error("A group needs two or more other people.");
    const name = cleanTitle(title) || "Group";
    const rows = [this.row(this.me), ...others.map((o) => this.row(o))];
    if (rows.some((r) => !r)) throw new Error("Someone in that list is not ready for messages yet.");
    const id = newUuid();
    const plan = await planGroupKeys(this.rec, id, 1, rows as HubMember[], name);
    if (!plan) throw new Error("Someone in that list is not ready for messages yet.");
    const r = await this.api.create({ id, kind: "group", others, title: plan.title_ct, drops: plan.drops });
    const c = shell(id, "group", r.epoch, [this.me, ...others].sort());
    c.keys.set(1, plan.raw); c.title = name; c.trust = { epoch: 1, members: plan.members, creator: this.me };
    this.convs.set(id, c);
    return id;
  }
  /** The creator adds people or removes anyone; anyone removes themselves (leave). Either way a member still in then
   *  makes the next key (rotateIfDue), so a removed member holds no key for anything sent after. */
  async addMembers(id: string, add: string[]): Promise<void> {
    const adds = [...new Set(add)];
    await this.api.change(id, { add: adds });
    await this.rotateIfDue(id, adds);
  }
  async removeMember(id: string, member: string): Promise<void> {
    await this.api.change(id, { remove: member });
    if (member !== this.me) await this.rotateIfDue(id);
  }
  async leave(id: string): Promise<void> {
    if (this.convs.get(id)?.kind === "dm") throw new Error("You cannot leave a private message.");
    await this.api.change(id, { remove: this.me });
    this.convs.delete(id);
  }
  /** A group whose members changed: the next epoch for exactly the members still in. A DM never needs it. */
  async rotateIfDue(id: string, adds: string[] = []): Promise<boolean> {
    const c = this.convs.get(id);
    if (!c || c.kind !== "group") return false;
    await this.pull(id);
    const t = c.trust;
    if (!t) return false;   // no key copy of yours has checked out: you cannot vouch for who is in
    // Nobody is sealed in that the last signed list does not hold, unless the creator is adding them right now. A hub that
    // adds a member by itself therefore freezes the group (nobody writes) instead of getting the next key.
    const explained = new Set([...t.members, ...(this.me === t.creator ? adds : [])]);
    if (c.people.some((p) => !explained.has(p))) return false;
    const rows = c.people.map((p) => this.row(p));
    if (rows.some((r) => !r)) return false;
    const plan = await planGroupKeys(this.rec, id, c.epoch + 1, rows as HubMember[], c.title ?? "Group", t.creator);
    if (!plan) return false;
    try {
      const r = await this.api.rotate(id, c.epoch, plan.drops, plan.title_ct);
      if (r.done) { c.keys.set(plan.epoch, plan.raw); c.epoch = plan.epoch; c.status.rot = false; c.trust = { epoch: plan.epoch, members: plan.members, creator: t.creator }; }
    } catch (e) { if (!(e instanceof HubError && e.status === 409)) throw e; }
    await this.pull(id);
    return true;
  }
  /** A DM's key can be renewed: a higher epoch, derived on both devices, bound into every later message. */
  async rotateDm(id: string): Promise<void> {
    const c = this.convs.get(id);
    if (!c || c.kind !== "dm") return;
    const r = await this.api.rotate(id, c.epoch, []);
    if (r.done) c.epoch = r.epoch;
  }

  // ---------- messages ----------
  async send(id: string, body: ChatBody, msgId = newUuid()): Promise<ChatMsg | null> {
    const b = cleanBody(body);
    const c = this.convs.get(id);
    if (!b || !c) throw new Error("Empty message.");
    for (let attempt = 0; ; attempt++) {
      if (c.kind === "group" && c.status.rot) await this.rotateIfDue(id);
      const raw = await this.keyFor(c, c.epoch);
      if (!raw) throw new Error("The chat key is not here yet.");
      const ct = await sealConvMessage(raw, this.rec.squadId, id, c.epoch, this.me, msgId, b);
      try {
        const r = await this.api.post(id, msgId, c.epoch, ct);
        if (b.r) { c.reacts.set(msgId, { id: msgId, from: this.me, to: b.r.to, e: b.r.e, at: r.at }); return null; }
        const m: ChatMsg = { id: msgId, from: this.me, epoch: c.epoch, t: b.t, ...(b.a ? { a: b.a } : {}), ...(b.q ? { q: b.q } : {}), at: r.at, edited: false };
        c.msgs.set(msgId, m);
        c.status.last = r.at;
        return m;
      } catch (e) {
        if (attempt === 0 && e instanceof HubError && e.status === 409 && /epoch/.test(e.message)) { await this.pull(id); if (c.kind === "group") c.status.rot = true; continue; }
        throw e;
      }
    }
  }
  /** An edit is sealed under the CURRENT epoch key (and the hub updates the row's epoch), never the message's old one: text written
   *  after someone was removed is not under a key they hold. The conversation must be up to date (not waiting for a rekey). */
  async edit(id: string, msgId: string, text: string): Promise<void> {
    const c = this.convs.get(id), m = c?.msgs.get(msgId);
    if (!c || !m || m.from !== this.me) return;
    if (c.kind === "group" && c.status.rot) await this.rotateIfDue(id);
    const raw = await this.keyFor(c, c.epoch);
    const b = cleanBody({ t: text, ...(m.a ? { a: m.a } : {}), ...(m.q ? { q: m.q } : {}) });
    if (!raw || !b) return;
    await this.api.edit(id, msgId, c.epoch, await sealConvMessage(raw, this.rec.squadId, id, c.epoch, m.from, msgId, b));
    c.msgs.set(msgId, { ...m, t: b.t, epoch: c.epoch, edited: true });
  }
  async del(id: string, msgId: string): Promise<void> {
    const c = this.convs.get(id), m = c?.msgs.get(msgId);
    if (!c || !m || m.from !== this.me) return;
    await this.api.del(id, msgId);
    c.msgs.delete(msgId); c.gone.add(msgId);
  }
  async react(id: string, to: string, e: string, onLocal: () => void = () => {}): Promise<void> {
    const c = this.convs.get(id);
    if (!c || !c.msgs.has(to)) return;
    const plan = reactPlan([...c.reacts.values()], this.me, to, e);
    if ("remove" in plan) {
      const gone = plan.remove.map((x) => c.reacts.get(x)!).filter(Boolean);
      for (const x of plan.remove) c.reacts.delete(x);
      onLocal();
      try { for (const x of plan.remove) await this.api.del(id, x); } catch (err) { for (const g of gone) c.reacts.set(g.id, g); throw err; }
      return;
    }
    const rid = newUuid();
    c.reacts.set(rid, { id: rid, from: this.me, to, e, at: new Date().toISOString() });
    onLocal();
    try { await this.send(id, { t: "", r: { to, e } }, rid); } catch (err) { c.reacts.delete(rid); throw err; }
  }
  async markRead(id: string): Promise<void> {
    const c = this.convs.get(id);
    if (!c) return;
    const newest = [...c.msgs.values(), ...c.reacts.values()].reduce<string | null>((o, m) => (!o || hubMicros(m.at) > hubMicros(o) ? m.at : o), null);
    if (!newest || c.status.u === 0) return;
    await this.api.read(id, newest);
    c.status.u = 0;
  }

  // ---------- pictures ----------
  /** The pictures on this device from last time (sealed, opened now with the keys you hold). No hub call. */
  async loadCache(): Promise<void> {
    if (!this.store) return;
    try {
      const j = JSON.parse(this.store.get(`ps.sqAv:${this.rec.squadId}`) || "null") as { cur?: string | null; seen?: string | null; rows?: Record<string, { ct: string; gen: number }> } | null;
      if (!j || typeof j !== "object") return;
      this.avCursor = typeof j.cur === "string" ? j.cur : null;
      this.avSeen = typeof j.seen === "string" ? j.seen : null;
      for (const [m, r] of Object.entries(j.rows ?? {})) {
        if (!r || typeof r.ct !== "string") continue;
        this.avSealed.set(m, { ct: r.ct, gen: r.gen });
        const p = await openAvatar(this.rec, m, r.ct, r.gen);
        if (p) this.pics.set(m, p);
      }
    } catch { /* a bad cache is just empty */ }
  }
  private saveCache() {
    try { this.store?.set(`ps.sqAv:${this.rec.squadId}`, JSON.stringify({ cur: this.avCursor, seen: this.avSeen, rows: Object.fromEntries(this.avSealed) })); } catch { /* storage full or off */ }
  }
  /** Only pictures changed since the last time (the hub's cursor). A picture is opened once and kept. */
  async pullAvatars(stamp: string | null = null): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const r = await this.api.avatars(this.avCursor);
      for (const row of r.rows) {
        const had = this.avSealed.get(row.member_id);
        if (row.ct && had && had.ct === row.ct && had.gen === row.gen && this.pics.has(row.member_id)) { /* the page edge repeats a row: already open */ }
        else if (!row.ct) { this.pics.delete(row.member_id); this.avSealed.delete(row.member_id); }
        else {
          this.avSealed.set(row.member_id, { ct: row.ct, gen: row.gen });
          const p = await openAvatar(this.rec, row.member_id, row.ct, row.gen);
          if (p) this.pics.set(row.member_id, p); else this.pics.delete(row.member_id);
        }
        if (!this.avCursor || Date.parse(row.updated_at) >= Date.parse(this.avCursor)) this.avCursor = row.updated_at;
      }
      if (!r.more) break;
    }
    if (stamp) this.avSeen = stamp;   // saved with the cache: after a restart a quiet hub costs no fetch
    this.saveCache();
    // The squad key changed since your picture was sealed: seal it again so newcomers (who hold only the new key) see it.
    const mine = this.avSealed.get(this.me), mypic = this.pics.get(this.me);
    if (mine && mypic && mine.gen < currentKey(this.rec).gen) { try { await this.setAvatar(mypic); } catch { /* next time */ } }
  }
  async setAvatar(dataUrl: string): Promise<void> {
    const p = cleanAvatar(dataUrl);
    if (!p) throw new Error("That picture is too big or not a jpeg or webp.");
    const s = await sealAvatar(this.rec, p);
    await this.api.setAvatar(s.ct, s.gen);
    this.pics.set(this.me, p); this.avSealed.set(this.me, s);
    this.saveCache();
  }
  async clearAvatar(): Promise<void> {
    await this.api.clearAvatar();
    this.pics.delete(this.me); this.avSealed.delete(this.me);
    this.saveCache();
  }
}
export type { DmStatusConv };

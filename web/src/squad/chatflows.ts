// G Squad chat (V1.40): one member's chat with the hub, with no vault and no screen in it, so the engine (the page
// that holds the vault) and the live hub check (scripts/gsquad-chat-hub-check.ts) run the very same steps.
// It keeps the period keys it opened IN MEMORY only: they live on the hub sealed to your box key, and your box key
// lives in your vault, so every device of yours opens them again after a restart (a few hundred bytes each).
import { cleanName, openCard, type SquadRec } from "../core/squadrec.ts";
import { newUuid } from "../core/squadcrypto.ts";
import { cleanBody, cleanVotes, hubMicros, openChatDrops, openMessage, planChatRotate, planGive, sealMessage, type ChatAbout, type ChatBody, type VoteInfo } from "../core/squadchat.ts";
import { HubError, type HubMemberRow } from "./hub.ts";
import { reactPlan, type ReactEvent } from "./chatreact.ts";
import { chatApi, type ChatApi, type ChatMsgRow, type ChatStatus } from "./chathub.ts";

type Fetcher = Parameters<typeof chatApi>[1];

export interface ChatMsg { id: string; from: string; epoch: number; t: string; a?: ChatAbout; at: string; edited: boolean }
export interface ChatPerson { id: string; name: string; left: boolean; me: boolean }

export class ChatSession {
  readonly rec: SquadRec;
  readonly api: ChatApi;
  keys = new Map<number, string>();
  rows = new Map<string, HubMemberRow>();
  people = new Map<string, ChatPerson>();
  msgs = new Map<string, ChatMsg>();
  reacts = new Map<string, ReactEvent>();   // reaction rows (PS 1.63), by row id: they are chat rows with no words
  locked = 0;                         // rows the hub sent that we could not open (should stay 0)
  status: ChatStatus | null = null;
  votes: VoteInfo[] = [];
  since: string | null = null;
  more = false;                       // older messages exist on the hub (Show older)
  loaded = false;

  constructor(rec: SquadRec, fetcher?: Fetcher) {
    this.rec = rec;
    this.api = chatApi({ member: rec.memberId, priv: rec.sign.priv }, fetcher);
  }

  /** The cheap look. Returns what changed so the caller decides whether to pull. */
  async tick(): Promise<ChatStatus> {
    const s = await this.api.tick();
    this.setStatus(s);
    return s;
  }
  private setStatus(s: ChatStatus) { this.status = s; this.votes = cleanVotes(s.votes); }

  /** Everything changed since the last pull (or the newest page on the first). New keys handed to you for OLDER
   *  periods (history after a yes) start a full load again, so those messages come in too. */
  async pull(): Promise<void> {
    const p = await this.api.pull(this.since);
    this.setStatus(p.status);
    const before = this.keys.size ? Math.min(...this.keys.keys()) : Infinity;
    const added = await openChatDrops(this.rec, p.drops, this.keys);
    for (const m of p.members) this.rows.set(m.id, m);
    await this.names(p.members);
    await this.take(p.msgs);
    if (!this.since) this.more = p.more;
    this.since = new Date(Date.parse(p.now) - 5_000).toISOString();   // a little overlap: a row written as we read is never missed
    this.loaded = true;
    if (this.loaded && added.some((e) => e < before) && before !== Infinity) { this.since = null; await this.pull(); }
  }
  /** One page of older messages. */
  async older(): Promise<number> {
    const oldest = [...this.msgs.values()].reduce<string | null>((o, m) => (!o || hubMicros(m.at) < hubMicros(o) ? m.at : o), null);
    if (!oldest) return 0;
    const p = await this.api.pull(null, oldest);
    const n = this.msgs.size;
    await this.take(p.msgs);
    this.more = p.more;
    return this.msgs.size - n;
  }
  private async names(rows: HubMemberRow[]) {
    for (const m of rows) {
      const card = await openCard(this.rec, m.id, m.card_ct, m.card_gen);
      const ok = !!card && card.sign === m.sign_pub && card.box === m.box_pub;
      const had = this.people.get(m.id);
      this.people.set(m.id, { id: m.id, name: ok ? cleanName(card!.n) || "Someone" : had?.name ?? "Someone", left: !!m.left_at, me: m.id === this.rec.memberId });
    }
  }
  private async take(rows: ChatMsgRow[]) {
    for (const r of rows) {
      if (r.deleted) { this.msgs.delete(r.id); this.reacts.delete(r.id); continue; }
      const raw = this.keys.get(r.epoch);
      if (!raw) { this.locked++; continue; }
      const b = await openMessage(raw, this.rec.squadId, r.epoch, r.member_id, r.id, r.ct);
      if (!b) { this.locked++; continue; }
      if (b.r) { this.reacts.set(r.id, { id: r.id, from: r.member_id, to: b.r.to, e: b.r.e, at: r.created_at }); continue; }
      this.msgs.set(r.id, { id: r.id, from: r.member_id, epoch: r.epoch, t: b.t, ...(b.a ? { a: b.a } : {}), at: r.created_at, edited: r.edited });
    }
  }

  /** A new period when the members changed (a join or a leave). Needs every member still in on hand. */
  async rotateIfDue(): Promise<boolean> {
    if (!this.status?.rot) return false;
    await this.pull();   // the members as they are now (someone may have just joined or left)
    if (!this.status?.rot) return false;
    // V1.49: someone without a card yet is still getting in; the hub leaves them out of the period too (chat_in).
    const live = [...this.rows.values()].filter((m) => !m.left_at && !!m.card_ct);
    const plan = await planChatRotate(this.rec, live, this.status.epoch);
    if (!plan) return false;
    try {
      const r = await this.api.rotate(this.status.epoch, plan.drops);
      if (r.done) this.keys.set(plan.epoch, plan.raw);
    } catch (e) {
      if (!(e instanceof HubError && e.status === 409)) throw e;   // the members changed again, or someone got there first
    }
    await this.pull();
    return true;
  }

  /** After a yes: the older keys you hold, to the newcomer (each checked against their card). */
  async giveIfDue(): Promise<number> {
    let n = 0;
    for (const g of this.status?.give ?? []) {
      let row = this.rows.get(g.j);
      if (!row) { await this.pull(); row = this.rows.get(g.j); }
      if (!row) continue;
      const drops = await planGive(this.rec, this.keys, row, g.e);
      if (!drops?.length) continue;
      try { n += (await this.api.give(g.vote, drops)).added; } catch { /* another member did it, or it was taken back */ }
    }
    return n;
  }

  /** Sends one message into the period now. A period that changed under us (a join or a leave) is made or fetched,
   *  then the message is sealed again under it, once. */
  async send(body: ChatBody, id = newUuid()): Promise<ChatMsg | null> {
    const b = cleanBody(body);
    if (!b) throw new Error("Empty message.");
    for (let attempt = 0; ; attempt++) {
      if (!this.status || this.status.rot || !this.keys.has(this.status.epoch)) {
        await this.pull();
        if (this.status?.rot) await this.rotateIfDue();
      }
      const epoch = this.status?.epoch ?? 0;
      const raw = this.keys.get(epoch);
      if (!raw) throw new Error("The chat key is not here yet.");
      const ct = await sealMessage(raw, this.rec.squadId, epoch, this.rec.memberId, id, b);
      try {
        const r = await this.api.post(id, epoch, ct);
        if (b.r) { this.reacts.set(id, { id, from: this.rec.memberId, to: b.r.to, e: b.r.e, at: r.at }); return null; }
        const m: ChatMsg = { id, from: this.rec.memberId, epoch, t: b.t, ...(b.a ? { a: b.a } : {}), at: r.at, edited: false };
        this.msgs.set(id, m);
        return m;
      } catch (e) {
        if (attempt === 0 && e instanceof HubError && e.status === 409 && /epoch/.test(e.message)) { if (this.status) this.status = { ...this.status, rot: true }; continue; }
        throw e;
      }
    }
  }
  /** Your own message, new words, sealed again with its own period's key (edits are marked "edited"). */
  async edit(id: string, text: string): Promise<void> {
    const m = this.msgs.get(id);
    if (!m || m.from !== this.rec.memberId) return;
    const raw = this.keys.get(m.epoch);
    const b = cleanBody({ t: text, ...(m.a ? { a: m.a } : {}) });
    if (!raw || !b) return;
    await this.api.edit(id, await sealMessage(raw, this.rec.squadId, m.epoch, m.from, id, b));
    this.msgs.set(id, { ...m, t: b.t, edited: true });
  }
  /** Your own message, gone for everyone (the hub keeps no words, only that a deleted row existed, for 30 days). */
  async del(id: string): Promise<void> {
    const m = this.msgs.get(id);
    if (!m || m.from !== this.rec.memberId) return;
    await this.api.del(id);
    this.msgs.delete(id);
  }
  /** Your reaction on a message (PS 1.63): the emoji if you have not put it there yet, taken back if you have. The screen
   *  hears at once through `onLocal` (before the hub answers); a refusal puts everything back and throws. */
  async react(to: string, e: string, onLocal: () => void = () => {}): Promise<void> {
    if (!this.msgs.has(to)) return;
    const me = this.rec.memberId;
    const plan = reactPlan([...this.reacts.values()], me, to, e);
    if ("remove" in plan) {
      const gone = plan.remove.map((id) => this.reacts.get(id)!).filter(Boolean);
      for (const id of plan.remove) this.reacts.delete(id);
      onLocal();
      try { for (const id of plan.remove) await this.api.del(id); }
      catch (err) { for (const g of gone) this.reacts.set(g.id, g); throw err; }
      return;
    }
    const id = newUuid();
    this.reacts.set(id, { id, from: me, to, e, at: new Date().toISOString() });
    onLocal();
    try { await this.send({ t: "", r: { to, e } }, id); }
    catch (err) { this.reacts.delete(id); throw err; }
  }
  async vote(voteId: string, yes: boolean): Promise<void> {
    const r = await this.api.ballot(voteId, yes);
    this.votes = this.votes.map((v) => (v.id === voteId ? { ...v, mine: yes, res: r.res ?? v.res } : v));
  }
  /** Read up to the newest message here. */
  async markRead(): Promise<void> {
    // A reaction is a row too, so it counts for "read" (else the hub would keep counting it as unread).
    const newest = [...this.msgs.values(), ...this.reacts.values()].reduce<string | null>((o, m) => (!o || hubMicros(m.at) > hubMicros(o) ? m.at : o), null);
    if (!newest || (this.status?.read && hubMicros(this.status.read) >= hubMicros(newest))) return;
    await this.api.read(newest);
    if (this.status) this.status = { ...this.status, read: newest, u: 0 };
  }

  /** Newest last. */
  list(limit = 150): ChatMsg[] {
    return [...this.msgs.values()].sort((a, b) => hubMicros(a.at) - hubMicros(b.at) || a.id.localeCompare(b.id)).slice(-limit);
  }
  /** Your history vote, if you are the newcomer. */
  myVote(): VoteInfo | undefined { return this.votes.find((v) => v.j === this.rec.memberId); }
  /** As the newcomer: whether you hold any period older than your first one (history after a yes). */
  hasHistory(): boolean { const v = this.myVote(); return !!v && [...this.keys.keys()].some((e) => e < v.be); }
}

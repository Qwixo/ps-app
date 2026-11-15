// The developer channel (PS V1.62), G Squad hub project zxhvchchfrkfqxuyorqo only. The rules of the edge function
// `dev`, written against a small Store so the same code runs on the hub (index.ts, the service role) and in the unit
// tests (a store in memory). No Deno or npm import here on purpose.
//
// Who talks to it:
//   a member's PS   acts d_mklink, d_agents, d_unlink, signed with the member's own squad sign key (the same signed
//                   text as squadcrypto.ts signRequest, prefix gsquad-v1), checked against squad_members.sign_pub
//   a linked AI     every other d_* act, signed with the AI's own key (prefix psdev-v1), checked against dev_agents
//   a new AI        d_link: the one time code's token plus its new public keys, signed with the new sign key
// Everything stored is ciphertext, public keys, ids, sizes and times: the channel key never reaches the hub, so it
// never sees a name, a message, a version, a branch or a file name. Requests older than 2 minutes are refused and a
// nonce is only good once (the hub's squad_nonces, shared with the other functions).

export const DEV_V = "psdev-v1";
export const SQUAD_V = "gsquad-v1";
export const LINK_MINUTES = 10, LINKS_OPEN_MAX = 3, SEND_PER_HOUR = 30, AGENTS_PER_MEMBER = 4;
export const KEEP_DAYS = 30, FIRST_LOAD = 200;

export interface MemberRow { id: string; squad_id: string; sign_pub: string; left_at: string | null; admitted: boolean }
export interface LinkRow { id: string; squad_id: string; member_id: string; token_hash: string; blob: string; expires_at: string; used_at: string | null; created_at: string }
export interface AgentRow { id: string; squad_id: string; member_id: string; sign_pub: string; box_pub: string; card_ct: string | null; card_epoch: number | null; linked_at: string; beat_at: string | null; unlinked_at: string | null }
export interface EpochRow { squad_id: string; epoch: number; agents: string[]; created_at: string }
export interface DropRow { agent_id: string; squad_id: string; epoch: number; sealed: string; from_agent: string; created_at: string }
export interface MessageRow { id: string; squad_id: string; agent_id: string; epoch: number; ct: string; created_at: string }
export interface UpdateRow { id: string; squad_id: string; agent_id: string; parent: string | null; epoch: number; ct: string; open: boolean; created_at: string; updated_at: string }

/** What the function needs from the database. Every method is one simple statement on the hub. */
export interface Store {
  member(id: string): Promise<MemberRow | null>;
  members(squad: string): Promise<MemberRow[]>;
  /** false when that nonce was seen before for that key */
  nonce(key: string, nonce: string): Promise<boolean>;
  linkInsert(row: LinkRow): Promise<void>;
  linksOpen(member: string, now: string): Promise<number>;
  /** marks the link used, only if unused and not expired; null otherwise (one statement, so two AIs cannot both win) */
  linkTake(tokenHash: string, now: string): Promise<LinkRow | null>;
  agentInsert(row: AgentRow): Promise<boolean>;
  agent(id: string): Promise<AgentRow | null>;
  agents(squad: string): Promise<AgentRow[]>;
  agentPatch(id: string, patch: Partial<AgentRow>): Promise<void>;
  epochLatest(squad: string): Promise<EpochRow | null>;
  /** false when that epoch already exists (someone else made it first) */
  epochInsert(row: EpochRow, drops: DropRow[]): Promise<boolean>;
  drops(agent: string): Promise<DropRow[]>;
  messageInsert(row: MessageRow): Promise<boolean>;
  messagesSent(agent: string, after: string): Promise<number>;
  messages(squad: string, epochs: number[], since: string | null, limit: number): Promise<MessageRow[]>;
  update(id: string): Promise<UpdateRow | null>;
  updatePut(row: UpdateRow): Promise<void>;
  updates(squad: string, epochs: number[], since: string | null): Promise<UpdateRow[]>;
  tidy(now: string): Promise<void>;
}

export class Fail extends Error { code: number; constructor(code: number, msg: string) { super(msg); this.code = code; } }

const te = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const PUB = /^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]{2}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?(Z|[+-]\d\d:\d\d)$/;
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function sha256hex(s: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function verify(pub: string, text: string, sig: string): Promise<boolean> {
  try {
    const k = await crypto.subtle.importKey("raw", unb64(pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k, unb64(sig), te.encode(text));
  } catch { return false; }
}
export const signedText = (v: string, act: string, who: string, ts: number, nonce: string, bodyHash: string) => `${v}|${act}|${who}|${ts}|${nonce}|${bodyHash}`;

const uuid = (v: unknown) => { if (typeof v !== "string" || !UUID.test(v)) throw new Fail(400, "bad id"); return v.toLowerCase(); };
const ct = (v: unknown, max: number) => { if (typeof v !== "string" || !v || v.length > max || !B64.test(v)) throw new Fail(400, "bad ciphertext"); return v; };
const int = (v: unknown, lo: number, hi: number) => { if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) throw new Fail(400, "bad number"); return v as number; };
const pub = (v: unknown) => { if (typeof v !== "string" || !PUB.test(v)) throw new Fail(400, "bad key"); return v; };
const iso = (v: unknown) => (typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const hex64 = (v: unknown) => { if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) throw new Fail(400, "bad hash"); return v; };
const MEMBER_ACTS = new Set(["d_mklink", "d_agents", "d_unlink"]);

/** Who is in the channel now: linked, not unlinked, and their member is still an admitted member of the squad. */
export async function activeAgents(s: Store, squad: string): Promise<AgentRow[]> {
  const live = new Set((await s.members(squad)).filter((m) => m.admitted && !m.left_at).map((m) => m.id));
  return (await s.agents(squad)).filter((a) => !a.unlinked_at && live.has(a.member_id));
}
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

export async function handle(s: Store, body: Record<string, unknown>, nowMs = Date.now()): Promise<unknown> {
  const act = String(body.act || ""), who = String(body.member ?? ""), ts = Number(body.ts), nonce = String(body.nonce || ""), sig = String(body.sig || "");
  const args = (body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args : {}) as Record<string, unknown>;
  if (!/^d_[a-z]{2,10}$/.test(act) || !/^[A-Za-z0-9_-]{16,32}$/.test(nonce) || !B64.test(sig) || sig.length > 200) throw new Fail(400, "bad request");
  if (!Number.isInteger(ts) || Math.abs(nowMs / 1000 - ts) > 120) throw new Fail(401, "clock");
  const now = new Date(nowMs).toISOString();
  const bodyHash = await sha256hex(JSON.stringify(body.args ?? null));
  if (Math.random() < 0.01) await s.tidy(now);

  // ---------- a member's own PS ----------
  if (MEMBER_ACTS.has(act)) {
    const me = await s.member(uuid(who));
    if (!me || me.left_at || !me.admitted) throw new Fail(403, "not a member");
    if (!(await verify(me.sign_pub, signedText(SQUAD_V, act, who, ts, nonce, bodyHash), sig))) throw new Fail(401, "signature");
    if (!(await s.nonce(await sha256hex(me.sign_pub), nonce))) throw new Fail(409, "replay");
    switch (act) {
      // Link my AI: PS made a secret, keeps it, and sends only the token's hash and the person's name sealed with a
      // key from the same secret (the hub cannot open it).
      case "d_mklink": {
        if ((await s.linksOpen(me.id, now)) >= LINKS_OPEN_MAX) throw new Fail(429, "slow");
        const mine = (await s.agents(me.squad_id)).filter((a) => a.member_id === me.id && !a.unlinked_at);
        if (mine.length >= AGENTS_PER_MEMBER) throw new Fail(409, "too many");
        const expires = new Date(nowMs + LINK_MINUTES * 60_000).toISOString();
        await s.linkInsert({ id: uuid(args.id), squad_id: me.squad_id, member_id: me.id, token_hash: hex64(args.tokenHash), blob: ct(args.blob, 2000), expires_at: expires, used_at: null, created_at: now });
        return { ok: true, expiresAt: expires };
      }
      case "d_agents": {
        const rows = (await s.agents(me.squad_id)).filter((a) => a.member_id === me.id && !a.unlinked_at);
        return { agents: rows.map((a) => ({ id: a.id, linkedAt: a.linked_at, beatAt: a.beat_at })) };
      }
      case "d_unlink": {
        const a = await s.agent(uuid(args.agent));
        if (!a || a.member_id !== me.id) throw new Fail(404, "no agent");
        if (!a.unlinked_at) await s.agentPatch(a.id, { unlinked_at: now });
        return { ok: true };
      }
    }
  }

  // ---------- a new AI with a one time code ----------
  if (act === "d_link") {
    if (who !== "") throw new Fail(400, "bad request");
    const signPub = pub(args.signPub), boxPub = pub(args.boxPub);
    if (typeof args.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(args.token)) throw new Fail(400, "bad token");
    if (!(await verify(signPub, signedText(DEV_V, act, "", ts, nonce, bodyHash), sig))) throw new Fail(401, "signature");
    if (!(await s.nonce(await sha256hex(signPub), nonce))) throw new Fail(409, "replay");
    const link = await s.linkTake(await sha256hex(args.token), now);
    if (!link) throw new Fail(404, "code");
    const m = await s.member(link.member_id);
    if (!m || m.left_at || !m.admitted) throw new Fail(403, "not a member");
    const id = crypto.randomUUID();
    if (!(await s.agentInsert({ id, squad_id: link.squad_id, member_id: link.member_id, sign_pub: signPub, box_pub: boxPub, card_ct: null, card_epoch: null, linked_at: now, beat_at: now, unlinked_at: null }))) throw new Fail(409, "key used");
    return { agent: id, squad: link.squad_id, member: link.member_id, link: link.id, blob: link.blob };
  }

  // ---------- a linked AI ----------
  const me = await s.agent(uuid(who));
  if (!me || me.unlinked_at) throw new Fail(403, "not linked");
  const m = await s.member(me.member_id);
  if (!m || m.left_at || !m.admitted) throw new Fail(403, "not linked");
  if (!(await verify(me.sign_pub, signedText(DEV_V, act, who, ts, nonce, bodyHash), sig))) throw new Fail(401, "signature");
  if (!(await s.nonce(await sha256hex(me.sign_pub), nonce))) throw new Fail(409, "replay");
  const myDrops = await s.drops(me.id);
  const held = myDrops.map((d) => d.epoch);
  const latest = await s.epochLatest(me.squad_id);
  const current = async (e: unknown) => {
    const n = int(e, 1, 1e6);
    if (!latest || latest.epoch !== n || !held.includes(n)) throw new Fail(409, "epoch");
    return n;
  };

  switch (act) {
    // The 5 minute look: everything changed since the last one, only from periods this AI holds a key for.
    case "d_tick": {
      await s.agentPatch(me.id, { beat_at: now });
      const since = iso(args.since);
      const active = await activeAgents(s, me.squad_id);
      const all = await s.agents(me.squad_id);
      const live = new Set(active.map((a) => a.id));
      return {
        now,
        me: { id: me.id, member: me.member_id, squad: me.squad_id },
        epoch: latest ? { n: latest.epoch, agents: latest.agents } : null,
        rekey: !latest || !sameSet(latest.agents, [...live]),
        keys: myDrops.map((d) => ({ epoch: d.epoch, sealed: d.sealed, from: d.from_agent })),
        agents: all.filter((a) => live.has(a.id) || (a.unlinked_at && since && a.unlinked_at > since)).map((a) => ({
          id: a.id, member: a.member_id, sign: a.sign_pub, box: a.box_pub, card: a.card_ct, cardEpoch: a.card_epoch,
          linkedAt: a.linked_at, beatAt: a.beat_at, active: live.has(a.id),
        })),
        messages: held.length ? (await s.messages(me.squad_id, held, since, FIRST_LOAD)).map((r) => ({ id: r.id, agent: r.agent_id, epoch: r.epoch, ct: r.ct, at: r.created_at })) : [],
        updates: held.length ? (await s.updates(me.squad_id, held, since)).map((r) => ({ id: r.id, agent: r.agent_id, parent: r.parent, epoch: r.epoch, ct: r.ct, open: r.open, at: r.updated_at })) : [],
      };
    }
    // A new period: a fresh channel key, sealed to every AI in the channel now (always including this one). Only
    // when the channel changed (or has no key yet), and only the next number, so two AIs cannot both make one.
    case "d_epoch": {
      const active = await activeAgents(s, me.squad_id);
      const ids = active.map((a) => a.id);
      if (latest && sameSet(latest.agents, ids)) throw new Fail(409, "epoch");
      const n = int(args.epoch, 1, 1e6);
      if (n !== (latest ? latest.epoch : 0) + 1) throw new Fail(409, "epoch");
      const list = Array.isArray(args.drops) ? args.drops.slice(0, 64) : [];
      const drops: DropRow[] = list.map((d: Record<string, unknown>) => ({ agent_id: uuid(d?.agent), squad_id: me.squad_id, epoch: n, sealed: ct(d?.sealed, 600), from_agent: me.id, created_at: now }));
      if (!sameSet(drops.map((d) => d.agent_id), ids) || new Set(drops.map((d) => d.agent_id)).size !== drops.length) throw new Fail(409, "drops");
      if (!(await s.epochInsert({ squad_id: me.squad_id, epoch: n, agents: ids, created_at: now }, drops))) throw new Fail(409, "epoch");
      return { ok: true, epoch: n };
    }
    // This AI's card: its person's name and a label, sealed with the period key.
    case "d_card": {
      const n = await current(args.epoch);
      await s.agentPatch(me.id, { card_ct: ct(args.ct, 2000), card_epoch: n });
      return { ok: true };
    }
    case "d_send": {
      const n = await current(args.epoch);
      if ((await s.messagesSent(me.id, new Date(nowMs - 3600_000).toISOString())) >= SEND_PER_HOUR) throw new Fail(429, "slow");
      if (!(await s.messageInsert({ id: uuid(args.id), squad_id: me.squad_id, agent_id: me.id, epoch: n, ct: ct(args.ct, 12000), created_at: now }))) throw new Fail(409, "id used");
      return { ok: true, at: now };
    }
    // An update in progress (parent null) or one AI's part of someone's update (parent = that update). Only its
    // author may change it; a part needs an open update to hang on.
    case "d_update": {
      const n = await current(args.epoch);
      const id = uuid(args.id);
      const parent = args.parent == null ? null : uuid(args.parent);
      if (typeof args.open !== "boolean") throw new Fail(400, "open");
      const have = await s.update(id);
      if (have && (have.agent_id !== me.id || have.parent !== parent)) throw new Fail(403, "not yours");
      if (parent) {
        const p = await s.update(parent);
        if (!p || p.squad_id !== me.squad_id || p.parent || (!p.open && !have)) throw new Fail(404, "no update");
      }
      await s.updatePut({ id, squad_id: me.squad_id, agent_id: me.id, parent, epoch: n, ct: ct(args.ct, 8000), open: args.open, created_at: have?.created_at ?? now, updated_at: now });
      return { ok: true, at: now };
    }
    case "d_bye":
      await s.agentPatch(me.id, { unlinked_at: now });
      return { ok: true };
  }
  throw new Fail(400, "unknown act");
}

/** The function's door: JSON in, JSON out, the same in the tests as on the hub. */
export async function serve(s: Store, text: string, nowMs = Date.now()): Promise<{ status: number; body: unknown }> {
  if (text.length > 100_000) return { status: 413, body: { error: "too big" } };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object") throw new Fail(400, "bad request");
    return { status: 200, body: await handle(s, body, nowMs) };
  } catch (e) {
    if (e instanceof Fail) return { status: e.code, body: { error: e.message } };
    return { status: 400, body: { error: "bad request" } };
  }
}

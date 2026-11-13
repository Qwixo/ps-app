// G Squad (V1.40): the steps of being in a squad, with no vault and no screen in them, so the engine (main page)
// and the live hub check (scripts/gsquad-hub-check.ts) run the very same code. Each step takes your squad record
// (core/squadrec.ts) and hands back the new one for your vault; the caller saves it.
import * as S from "../core/squadcrypto.ts";
import { cleanName, currentKey, keyFor, openCard, planRekey, sealCard, takeDrop, type SquadRec } from "../core/squadrec.ts";
import { sealForSquad, type ShareOpts, type TaskCopy } from "../core/squadshare.ts";
import { hubApi, hubCreate, hubJoin, type HubApi, type HubHandRow, type HubMemberRow, type HubPull, type HubTaskRow } from "./hub.ts";

type Fetcher = Parameters<typeof hubApi>[1];
export const apiFor = (rec: SquadRec, fetcher?: Fetcher): HubApi => hubApi({ member: rec.memberId, priv: rec.sign.priv }, fetcher);

/** A new squad: your keys, the first squad key, the name sealed, then your card. */
export async function createSquad(squadName: string, me: string, fetcher?: Fetcher): Promise<SquadRec> {
  const [sign, box, raw] = await Promise.all([S.newSignPair(), S.newBoxPair(), S.newSquadKey()]);
  const id = S.newUuid();
  const meta = await S.seal(raw, { n: cleanName(squadName) || "G Squad" }, S.sqAad.meta(id, 1));
  const r = await hubCreate(id, sign, box.pub, meta, fetcher);
  const rec: SquadRec = { v: 1, squadId: r.squad, memberId: r.member, me: cleanName(me) || "Me", keys: [{ gen: r.gen, k: raw }], sign, box,
    secret: S.newSecret(), joinedAt: new Date().toISOString(), creator: true };
  const card = await sealCard(rec, rec.me);
  await apiFor(rec, fetcher).card(card.ct, card.gen);
  return rec;
}

/** A one time invite link (7 days). The hub keeps only the token's hash and the squad key wrapped for the link. */
export async function makeInvite(rec: SquadRec, base: string, fetcher?: Fetcher): Promise<{ link: string; expiresAt: string }> {
  const secret = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const id = S.newUuid(), key = currentKey(rec);
  const m = await S.squadInviteMaterial(secret);
  const wrapped = await S.wrapForInvite(m.wrap, key.raw, S.sqAad.invite(rec.squadId, id, key.gen));
  await apiFor(rec, fetcher).invite({ id, hash: m.tokenHash, wrapped, gen: key.gen, days: 7 });
  return { link: S.inviteLink(base, id, secret), expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() };
}

/** Join with a pasted link: new keys, the hub checks the token's hash, the link's key opens the squad key. */
export async function joinSquad(text: string, me: string, fetcher?: Fetcher): Promise<SquadRec> {
  const inv = S.parseSquadInvite(text);
  if (!inv) throw new Error("That does not look like a G Squad invite link.");
  const [sign, box] = await Promise.all([S.newSignPair(), S.newBoxPair()]);
  const m = await S.squadInviteMaterial(inv.secret);
  const r = await hubJoin(sign, box.pub, inv.inviteId, m.token, fetcher);
  const raw = await S.unwrapInvite(m.wrap, r.wrapped, S.sqAad.invite(r.squad, inv.inviteId, r.gen));
  const rec: SquadRec = { v: 1, squadId: r.squad, memberId: r.member, me: cleanName(me) || "Me", keys: [{ gen: r.gen, k: raw }], sign, box,
    secret: S.newSecret(), joinedAt: new Date().toISOString() };
  const card = await sealCard(rec, rec.me);
  await apiFor(rec, fetcher).card(card.ct, card.gen);
  return rec;
}

// ---------- what a pull means ----------
export interface MemberView { id: string; name: string; me: boolean; creator: boolean; working: boolean; joinedAt: string; left: boolean; card: { sign: string; box: string } | null }
export interface TaskView extends TaskCopy { id: string; member: string }
export interface HandView { id: string; from: string; to: string; state: HubHandRow["state"]; t: string; d: string | null; at: string }
export interface HandCopy { t: string; d: string | null; n?: string | null }

/** New key gens waiting for you (after someone left): opened with your box key into a new record. */
export async function takeDrops(rec: SquadRec, drops: HubPull["drops"]): Promise<SquadRec> {
  let out = rec;
  for (const d of [...drops].sort((a, b) => a.gen - b.gen)) {
    if (keyFor(out, d.gen)) continue;
    try { out = await takeDrop(out, d.gen, d.sealed); } catch { /* not ours to open */ }
  }
  return out;
}
export async function memberView(rec: SquadRec, m: HubMemberRow, creator: string | null, working: Set<string>): Promise<MemberView> {
  const card = await openCard(rec, m.id, m.card_ct, m.card_gen);
  const ok = !!card && card.sign === m.sign_pub && card.box === m.box_pub;   // a card that does not match the hub's keys is not trusted
  return { id: m.id, name: ok ? card!.n : "Someone", me: m.id === rec.memberId, creator: creator === m.id, working: working.has(m.id), joinedAt: m.joined_at, left: !!m.left_at,
    card: ok ? { sign: card!.sign, box: card!.box } : null };
}
export async function taskView(rec: SquadRec, t: HubTaskRow): Promise<TaskView | null> {
  if (t.deleted) return null;
  const raw = keyFor(rec, t.gen);
  if (!raw) return null;
  try {
    const c = await S.open<TaskCopy>(raw, t.ct, S.sqAad.task(rec.squadId, t.member_id, t.id, t.gen));
    if (!c || typeof c.t !== "string") return null;
    return { id: t.id, member: t.member_id, t: c.t.slice(0, 300), p: Number.isInteger(c.p) ? c.p : null, d: typeof c.d === "string" ? c.d.slice(0, 10) : null, x: c.x === true,
      ...(typeof c.xa === "string" ? { xa: c.xa } : {}), ...(c.e ? { e: true } : {}), ...(c.a ? { a: true } : {}) };
  } catch { return null; }
}
export async function handView(rec: SquadRec, h: HubHandRow): Promise<HandView | null> {
  const raw = keyFor(rec, h.gen);
  if (!raw) return null;
  try {
    const c = await S.open<HandCopy>(raw, h.ct, S.sqAad.hand(rec.squadId, h.from_member, h.to_member, h.id, h.gen));
    return { id: h.id, from: h.from_member, to: h.to_member, state: h.state, t: String(c.t || "").slice(0, 300), d: typeof c.d === "string" ? c.d.slice(0, 10) : null, at: h.created_at };
  } catch { return null; }
}
export async function squadName(rec: SquadRec, sq: HubPull["squad"]): Promise<string> {
  const raw = sq.meta_gen ? keyFor(rec, sq.meta_gen) : null;
  if (!raw || !sq.meta_ct) return "G Squad";
  try { return cleanName((await S.open<{ n: string }>(raw, sq.meta_ct, S.sqAad.meta(rec.squadId, sq.meta_gen!))).n) || "G Squad"; } catch { return "G Squad"; }
}

/** Someone left: make the next key gen for everyone still in (or do nothing if another member got there first). */
export async function rekeyIfNeeded(rec: SquadRec, api: HubApi, pull: HubPull, members: HubMemberRow[], name: string): Promise<SquadRec> {
  if (!pull.squad.rekey || currentKey(rec).gen !== pull.squad.gen) return rec;
  // V1.49: only members with a card (anyone still getting in is handed the new key by a member's PS instead).
  const plan = await planRekey(rec, members.filter((m) => !m.left_at && !!m.card_ct).map((m) => ({ ...m })), name);
  if (!plan) return rec;
  try {
    const r = await api.rekey(pull.squad.gen, plan.drops, plan.meta);
    if (!r.done) return rec;
  } catch { return rec; }
  return { ...rec, keys: [...rec.keys, { gen: plan.gen, k: plan.raw }] };
}
/** After a new gen: your card again under it (a member card must open with the newest key). */
export async function refreshCard(rec: SquadRec, api: HubApi, mine: HubMemberRow | undefined): Promise<void> {
  const key = currentKey(rec);
  if (mine && mine.card_gen === key.gen && mine.card_ct) return;
  const card = await sealCard(rec, rec.me);
  await api.card(card.ct, card.gen);
}

/** Hand one of your tasks to someone: only the title (or the neutral one) and the date travel, sealed through
 *  the same gate as shared tasks (Tasks switched off: nothing is sealed or sent). */
export async function handTask(rec: SquadRec, api: HubApi, opts: ShareOpts | null | undefined, to: string, copy: HandCopy): Promise<string | null> {
  const id = S.newUuid(), key = currentKey(rec);
  const s = await sealForSquad(opts, "tasks", key, { t: copy.t.slice(0, 300), d: copy.d ?? null }, S.sqAad.hand(rec.squadId, rec.memberId, to, id, key.gen));
  if (!s) return null;
  await api.hand({ id, to, ct: s.ct, gen: s.gen });
  return id;
}

// ---------- V1.43: names ----------
/** The admin renames the squad: the new name sealed under the current key gen. For the listed squad (See available
 *  squads) the same name also goes in plain text, because the list shows it to everyone; any other squad's name is
 *  never sent unsealed. */
export async function renameSquad(rec: SquadRec, api: HubApi, name: string, listed: boolean): Promise<string> {
  const n = cleanName(name);
  if (!n) throw new Error("Give the squad a name.");
  const key = currentKey(rec);
  const meta = await S.seal(key.raw, { n }, S.sqAad.meta(rec.squadId, key.gen));
  await api.rename(listed ? { gen: key.gen, meta, name: n } : { gen: key.gen, meta });
  return n;
}
/** Your own name in the squad: your card sealed again with the new name. Everyone sees it on their next pull, on
 *  every member list and on every chat message (names come from cards, by member id). Returns your new record. */
export async function renameMe(rec: SquadRec, api: HubApi, name: string): Promise<SquadRec> {
  const n = cleanName(name);
  if (!n) throw new Error("Type a name.");
  const next = { ...rec, me: n };
  const card = await sealCard(next, n);
  await api.card(card.ct, card.gen);
  return next;
}

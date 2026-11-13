// G Squad chat (V1.40): the keys, the sealing and the history vote's words. No screen and no hub calls here, so the
// unit tests, the engine and the live hub check all run this very code.
//
// Why a newcomer cannot open older messages without a yes:
//   The chat runs in periods. Each period has its own random chat key (32 bytes), made on one member's device and
//   sealed SEPARATELY to each member's box key (P-256 ECDH, HKDF, AES-256-GCM, the same seal as the core's key drops,
//   with its own aad naming squad, member and period). A new period starts whenever someone joins or leaves.
//   So a newcomer is handed the keys of the periods from their join on and nothing older. The invite link hands over
//   the SQUAD key, which never seals a chat key or a message, so it opens nothing in the chat.
//   After a yes, a member from before seals the older period keys to the newcomer's box key (planGive). After a no,
//   nobody ever does, and the hub also never sends the newcomer the rows of a period they hold no key for.
// Messages: AES-256-GCM under the period key, aad naming squad, period, author and message id, so the hub cannot
// move a message to another author, period or id.
import { open, openKeyDrop, seal, sealKeyTo, newSquadKey, V } from "./squadcrypto.ts";
import { openCard, type HubMember, type SquadRec } from "./squadrec.ts";

export const chatAad = {
  key: (squad: string, member: string, epoch: number) => `${V}:chatkey:${squad}:${member}:${epoch}`,
  msg: (squad: string, epoch: number, member: string, id: string) => `${V}:chat:${squad}:${epoch}:${member}:${id}`,
};

// ---------- period keys ----------
/** Opens the period keys sealed to you (any you cannot open are skipped). Returns the periods newly opened. */
export async function openChatDrops(rec: SquadRec, drops: { epoch: number; sealed: string }[], keys: Map<number, string>): Promise<number[]> {
  const added: number[] = [];
  for (const d of drops) {
    if (!Number.isInteger(d.epoch) || keys.has(d.epoch)) continue;
    try { keys.set(d.epoch, await openKeyDrop(rec.box.priv, d.sealed, chatAad.key(rec.squadId, rec.memberId, d.epoch))); added.push(d.epoch); }
    catch { /* not ours, or tampered: never used */ }
  }
  return added.sort((a, b) => a - b);
}

/** A member's card checked against the hub's keys (as in the core): the box key we may seal to, or null. */
export async function trustedBox(rec: SquadRec, m: HubMember): Promise<string | null> {
  if (m.left_at) return null;
  const card = await openCard(rec, m.id, m.card_ct, m.card_gen);
  return card && card.box === m.box_pub && card.sign === m.sign_pub ? m.box_pub : null;
}

/**
 * The next period: a new random key sealed to every member still in, each checked first (their sealed card must
 * open and name the same public keys the hub lists, so the hub cannot slip in a key of its own). Null when any
 * member still in cannot be checked yet, or you are not among them: then someone else does it, or later.
 */
export async function planChatRotate(rec: SquadRec, members: HubMember[], from: number): Promise<{ epoch: number; raw: string; drops: { member: string; sealed: string }[] } | null> {
  const epoch = from + 1, raw = await newSquadKey();
  const drops: { member: string; sealed: string }[] = [];
  for (const m of members) {
    if (m.left_at || !m.card_ct) continue;   // V1.49: no card yet means not in yet (the hub's chat_in agrees)
    const box = await trustedBox(rec, m);
    if (!box) return null;
    drops.push({ member: m.id, sealed: await sealKeyTo(box, raw, chatAad.key(rec.squadId, m.id, epoch)) });
  }
  if (!drops.some((d) => d.member === rec.memberId)) return null;
  return { epoch, raw, drops };
}

/** After a yes: the older period keys you hold, sealed to the newcomer's checked box key. Only periods below their
 *  first one; null when their card does not check out. */
export async function planGive(rec: SquadRec, keys: Map<number, string>, joiner: HubMember, epochs: number[]): Promise<{ epoch: number; sealed: string }[] | null> {
  const box = await trustedBox(rec, joiner);
  if (!box) return null;
  const out: { epoch: number; sealed: string }[] = [];
  for (const e of epochs) {
    const raw = keys.get(e);
    if (raw) out.push({ epoch: e, sealed: await sealKeyTo(box, raw, chatAad.key(rec.squadId, joiner.id, e)) });
  }
  return out;
}

// ---------- hub times (Postgres keeps microseconds; Date.parse drops them) ----------
/** Microseconds since 1970 for a hub time like 2026-11-07T16:20:00.123456+00:00 (0 when unreadable). */
export function hubMicros(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 0;
  const frac = /\.(\d{1,6})/.exec(iso)?.[1] ?? "";
  return (ms - (ms % 1000)) * 1000 + Number(frac.padEnd(6, "0"));
}

// ---------- messages ----------
export const MAX_TEXT = 2000;
/** What travels inside a sealed message: the words, and optionally what it is about (eg someone's gym log). */
export interface ChatAbout { k: string; l: string; w?: string }   // kind, label, whose (member id)
export interface ChatBody { t: string; a?: ChatAbout }

export function cleanText(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\n{4,}/g, "\n\n\n").trim().slice(0, MAX_TEXT);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function cleanAbout(v: unknown): ChatAbout | undefined {
  const a = v as Record<string, unknown> | null;
  if (!a || typeof a !== "object") return undefined;
  const k = typeof a.k === "string" && /^[a-z]{2,16}$/.test(a.k) ? a.k : "";
  const l = typeof a.l === "string" ? a.l.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140) : "";
  if (!k || !l) return undefined;
  return { k, l, ...(typeof a.w === "string" && UUID.test(a.w) ? { w: a.w.toLowerCase() } : {}) };
}
export function cleanBody(v: unknown): ChatBody | null {
  const b = v as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return null;
  const t = cleanText(b.t);
  if (!t) return null;
  const a = cleanAbout(b.a);
  return a ? { t, a } : { t };
}
export async function sealMessage(raw: string, squad: string, epoch: number, member: string, id: string, body: ChatBody): Promise<string> {
  const b = cleanBody(body);
  if (!b) throw new Error("Empty message.");
  return seal(raw, b, chatAad.msg(squad, epoch, member, id));
}
export async function openMessage(raw: string, squad: string, epoch: number, member: string, id: string, ct: string): Promise<ChatBody | null> {
  try { return cleanBody(await open(raw, ct, chatAad.msg(squad, epoch, member, id))); } catch { return null; }
}

// ---------- the history vote ----------
export interface VoteInfo {
  id: string; j: string; be: number; at: string; again: string | null; res: "yes" | "no" | null; voter: boolean; mine: boolean | null;
  n: number; k: number; msgs: number; from: number; first: string | null;
}
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
export function cleanVotes(v: unknown): VoteInfo[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 30).filter((x) => x && typeof x === "object" && typeof x.id === "string" && UUID.test(x.id) && typeof x.j === "string" && UUID.test(x.j))
    .map((x) => ({
      id: x.id.toLowerCase(), j: x.j.toLowerCase(), be: Number.isInteger(x.be) ? x.be : 0, at: str(x.at, 40), again: typeof x.again === "string" ? x.again.slice(0, 40) : null,
      res: x.res === "yes" || x.res === "no" ? x.res : null, voter: x.voter === true, mine: typeof x.mine === "boolean" ? x.mine : null,
      n: Number.isInteger(x.n) ? x.n : 0, k: Number.isInteger(x.k) ? x.k : 0, msgs: Number.isInteger(x.msgs) ? x.msgs : 0,
      from: Number.isInteger(x.from) ? x.from : 0, first: typeof x.first === "string" ? x.first.slice(0, 40) : null,
    }));
}

/** Whether your pop-up for this vote should be up: you were asked, it is undecided, and either you have not answered
 *  yet or it came back after 24 hours and you have not seen it come back (the developer: "comes back for everyone"). */
export function voteCardDue(v: VoteInfo, seenAgain: (id: string) => boolean): "ask" | "again" | null {
  if (v.res || !v.voter) return null;
  if (v.again && !seenAgain(v.id)) return "again";
  return v.mine === null ? "ask" : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso: string | null, tz?: string): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return "";
  try {
    const p = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: tz }).formatToParts(new Date(iso));
    const d = p.find((x) => x.type === "day")?.value, m = p.find((x) => x.type === "month")?.value, y = p.find((x) => x.type === "year")?.value;
    const thisYear = new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: tz }).format(new Date());
    return `${d} ${m}${y && y !== thisYear ? ` ${y}` : ""}`;
  } catch {
    const d = new Date(iso);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  }
}
const people = (n: number) => (n === 1 ? "1 person" : `${n} people`);
const messages = (n: number) => (n === 1 ? "1 message" : `${n} messages`);

/** The pop-up's words (the developer's question word for word, then exactly what the newcomer would see). Every line is a
 *  draft for the developer's yes. */
export function voteWords(name: string, v: VoteInfo, stage: "ask" | "again", tz?: string): { title: string; sub: string; body: string } {
  const who = name || "Someone";
  const title = `${who} just joined the G Squad. Do you want them to see your entire conversation history?`;
  const waiting = Math.max(0, v.n - v.k);
  const sub = stage === "ask"
    ? "Everyone has to say Yes. If anyone says No, they will not see it."
    : v.mine === null
      ? `This came back because ${waiting === 1 ? "1 person has" : `${waiting} people have`} not answered in 24 hours. In 12 hours, anyone who still has not answered counts as Yes.`
      : `You said ${v.mine ? "Yes" : "No"}. Still waiting on ${waiting} of ${v.n}. You can change your answer until it is decided.`;
  const what = v.msgs > 0
    ? `Yes means ${who} can read all ${messages(v.msgs)} sent in this chat before they joined, from ${people(v.from)}, going back to ${shortDate(v.first, tz)}: the words of every message, who sent it and when. Messages deleted before then stay gone.`
    : `There are no older messages left in the chat right now, so ${who} would see nothing more either way.`;
  const no = `No means ${who} only sees messages sent after they joined. The older ones stay locked to them for good.`;
  const later = stage === "ask" ? " If not everyone answers within 24 hours this comes back, and 12 hours after that anyone who has not answered counts as Yes." : "";
  return { title, sub, body: `${what} ${no}${later}` };
}

/** The line the newcomer sees at the top of the chat while the squad decides, and after. */
export function joinerLine(v: VoteInfo | undefined, haveHistory: boolean): string | null {
  if (!v) return null;
  if (v.res === null) return `The squad is deciding whether you can see the ${messages(v.msgs)} sent before you joined.`;
  if (v.res === "no") return "The squad chose to keep the messages from before you joined to themselves. You see everything from when you joined.";
  return haveHistory ? "The squad said Yes: you can read the messages from before you joined." : "The squad said Yes. The older messages arrive as soon as someone from before opens PS app.";
}

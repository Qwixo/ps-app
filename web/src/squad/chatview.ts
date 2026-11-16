// G Squad chat (V1.40): what the Tab list is told about the chat (plain, no keys, like the core's SquadView) and what
// it may ask for. The main page opens everything (squad/chatengine.ts); the Tab list sends its buttons back as one
// `sqChatOp`, checked here.
import { cleanAbout, cleanEmoji, cleanReply, cleanText, replySnippet, type ChatAbout, type ChatReply } from "../core/squadchat.ts";
import { cleanGifItems, cleanGifQuery, type GifItem } from "./chatgif.ts";
import type { ReactionPill } from "./chatreact.ts";
import { cleanConvs, cleanDmOp, cleanMembers, SQUAD_CONV, type ConvView, type DmOp, type MemberView } from "./dmview.ts";
export type { ConvView, MemberView } from "./dmview.ts";

/** PS 1.64: the quote above a reply. name: who wrote the original ("You" for yours); s: its first line (the original's
 *  words as they are now when it is loaded, else the line the reply carried); gone: deleted or not on the hub for you. */
export interface QuoteView { id: string; name: string; from: string; s: string; gone: boolean }
export interface ChatLine { id: string; from: string; name: string; mine: boolean; t: string; a?: ChatAbout; q?: QuoteView; at: string; edited: boolean; left: boolean; sending?: boolean; failed?: boolean; r?: ReactionPill[] }
/** PS 1.64: where a "go to the original" ended (n counts up so the screen acts once per ask). */
export interface ChatJump { id: string; ok: boolean; n: number }
export interface ChatVoteView {
  id: string; joiner: string; name: string; stage: "ask" | "again" | null; mine: boolean | null; n: number; k: number;
  title: string; sub: string; body: string;
}
/** The GIF picker (PS 1.63): on = the hub has the GIF function and a key (null = not asked yet, so the button stays hidden). */
export interface GifView { on: boolean | null; q: string; items: GifItem[]; next: number | null; busy: boolean; failed: boolean }
export const EMPTY_GIF: GifView = { on: null, q: "", items: [], next: null, busy: false, failed: false };
export interface ChatView {
  in: boolean;                    // you are in a squad
  ready: boolean;                 // the chat's key for now is here (you can write)
  open: boolean;                  // the chat is on screen somewhere
  unread: number;                 // messages from others since you last read (the badge)
  lines: ChatLine[];              // only while open (the Tab list's state stays small otherwise)
  more: boolean;                  // older messages on the hub
  votes: ChatVoteView[];          // history votes you are asked about, undecided
  note: string | null;            // as a newcomer: where your history vote stands
  sound: boolean;                 // a sound for new messages (off by default, the developer)
  notify: boolean;                // the feature gsquad-notify is on in this build (core/squadnotify.ts)
  notifyOn: boolean;              // Squad settings, Notifications, Message notifications (missing = on)
  noteSound: boolean;             // the sound with that card (missing = on)
  islandOk: boolean;              // PS 1.63: this is the Mac and gsquad-island-reply is on in this build (the switch below shows only then)
  noteIsland: boolean;            // Squad settings, Notifications, "Show messages on the island" (missing = on)
  sending: number;                // messages on their way
  error: string | null;
  loaded: boolean;
  gif: GifView;
  jump?: ChatJump | null;         // PS 1.64: the answer to the last "seek" (a reply's quote was clicked)
  seeking?: boolean;              // PS 1.64: older history is loading to find a reply's original
  // PS 1.65 (G Squad v3): conversations. "squad" is the main chat and is always in the list; DMs and groups only when the hub answers.
  convs?: ConvView[];             // newest last message first
  activeConv?: string;            // the conversation `lines` belong to ("squad" until another is opened)
  members?: MemberView[];         // everyone in the squad, with their picture when they have one (only while open)
  dm?: boolean;                   // the hub has DMs and groups (false = the screen shows no DM or group button)
}
export const EMPTY_CHAT: ChatView = { in: false, ready: false, open: false, unread: 0, lines: [], more: false, votes: [], note: null, sound: false, notify: false, notifyOn: true, noteSound: true, islandOk: false, noteIsland: true, sending: 0, error: null, loaded: false, gif: EMPTY_GIF, convs: [], activeConv: SQUAD_CONV, members: [], dm: false };

export type ChatOp =
  | { op: "open"; on: boolean } | { op: "send"; text: string; a?: ChatAbout; q?: ChatReply } | { op: "edit"; id: string; text: string } | { op: "del"; id: string }
  | { op: "vote"; id: string; yes: boolean } | { op: "older" } | { op: "sound"; on: boolean } | { op: "retry" }
  | { op: "notify"; on: boolean } | { op: "noteSound"; on: boolean } | { op: "noteIsland"; on: boolean }
  | { op: "react"; to: string; e: string }                    // PS 1.63: an emoji on a message (again = take it back)
  | { op: "gifs"; q: string; more?: boolean } | { op: "gifclear" }   // the GIF picker's search, and closing it
  | { op: "seek"; id: string }
  | DmOp;                                                      // PS 1.65: DMs, groups, pictures (squad/dmview.ts)                                // PS 1.64: find a reply's original (loads older history if needed)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v.toLowerCase() : null);
/** One request from the Tab list, checked field by field (anything else is dropped). */
export function cleanChatOp(v: unknown): ChatOp | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  switch (o.op) {
    case "open": return { op: "open", on: o.on === true };
    case "older": case "retry": return { op: o.op };
    case "sound": return typeof o.on === "boolean" ? { op: "sound", on: o.on } : null;
    case "notify": case "noteSound": case "noteIsland": return typeof o.on === "boolean" ? { op: o.op, on: o.on } : null;
    case "send": { const t = cleanText(o.text); if (!t) return null; const a = cleanAbout(o.a), q = cleanReply(o.q); return { op: "send", text: t, ...(a ? { a } : {}), ...(q ? { q } : {}) }; }
    case "seek": { const i = id(o.id); return i ? { op: "seek", id: i } : null; }
    case "edit": { const i = id(o.id), t = cleanText(o.text); return i && t ? { op: "edit", id: i, text: t } : null; }
    case "del": { const i = id(o.id); return i ? { op: "del", id: i } : null; }
    case "react": { const i = id(o.to), e = cleanEmoji(o.e); return i && e ? { op: "react", to: i, e } : null; }
    case "gifs": return { op: "gifs", q: cleanGifQuery(o.q), ...(o.more === true ? { more: true } : {}) };
    case "gifclear": return { op: "gifclear" };
    case "openConv": case "newDm": case "newGroup": case "setAvatar": case "clearAvatar": case "groupAdd": case "groupRemove": case "leaveConv": return cleanDmOp(v);
    case "vote": { const i = id(o.id); return i && typeof o.yes === "boolean" ? { op: "vote", id: i, yes: o.yes } : null; }
  }
  return null;
}

function cleanPills(v: unknown): ReactionPill[] {
  if (!Array.isArray(v)) return [];
  const out: ReactionPill[] = [];
  for (const p of v.slice(0, 24)) {
    const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const e = cleanEmoji(o.e);
    if (!e || !Number.isInteger(o.n) || (o.n as number) < 1) continue;
    out.push({ e, n: Math.min(o.n as number, 999), mine: o.mine === true, who: (Array.isArray(o.who) ? o.who : []).slice(0, 12).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 40)) });
  }
  return out;
}
function cleanGif(v: unknown): GifView {
  const o = (v && typeof v === "object" ? v : null) as Record<string, unknown> | null;
  if (!o) return EMPTY_GIF;
  return { on: typeof o.on === "boolean" ? o.on : null, q: cleanGifQuery(o.q), items: cleanGifItems(o.items), next: Number.isInteger(o.next) && (o.next as number) >= 0 ? (o.next as number) : null, busy: o.busy === true, failed: o.failed === true };
}

function cleanQuote(v: unknown): QuoteView | null {
  const q = v as Record<string, unknown> | null;
  if (!q || typeof q !== "object" || !id(q.id)) return null;
  return { id: id(q.id)!, name: typeof q.name === "string" ? q.name.slice(0, 40) || "Someone" : "Someone", from: typeof q.from === "string" ? q.from.slice(0, 40) : "",
    s: q.gone === true ? "" : replySnippet(q.s), gone: q.gone === true };
}

/** The Tab list's copy, checked lightly (shapes and lengths). */
export function cleanChatView(v: unknown): ChatView {
  const o = (v && typeof v === "object" ? v : null) as Record<string, unknown> | null;
  if (!o) return EMPTY_CHAT;
  const s = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");
  const n = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 ? (x as number) : 0);
  const lines = (Array.isArray(o.lines) ? o.lines.slice(-1500) : []).filter((l) => l && typeof l === "object" && typeof l.id === "string").map((l): ChatLine => ({
    id: s(l.id, 40), from: s(l.from, 40), name: s(l.name, 40) || "Someone", mine: l.mine === true, t: s(l.t, 2000), at: s(l.at, 40), edited: l.edited === true, left: l.left === true,
    ...(l.sending === true ? { sending: true } : {}), ...(l.failed === true ? { failed: true } : {}),
    ...(cleanAbout(l.a) ? { a: cleanAbout(l.a) } : {}),
    ...(cleanQuote(l.q) ? { q: cleanQuote(l.q)! } : {}),
    ...(cleanPills(l.r).length ? { r: cleanPills(l.r) } : {}),
  }));
  const j = o.jump as Record<string, unknown> | null | undefined;
  const jump = j && typeof j === "object" && id(j.id) && Number.isInteger(j.n) ? { id: id(j.id)!, ok: j.ok === true, n: j.n as number } : null;
  const votes = (Array.isArray(o.votes) ? o.votes.slice(0, 10) : []).filter((x) => x && typeof x === "object" && typeof x.id === "string").map((x): ChatVoteView => ({
    id: s(x.id, 40), joiner: s(x.joiner, 40), name: s(x.name, 40), stage: x.stage === "ask" || x.stage === "again" ? x.stage : null, mine: typeof x.mine === "boolean" ? x.mine : null,
    n: n(x.n), k: n(x.k), title: s(x.title, 200), sub: s(x.sub, 300), body: s(x.body, 900),
  }));
  return {
    in: o.in === true, ready: o.ready === true, open: o.open === true, unread: n(o.unread), lines, more: o.more === true, votes,
    note: typeof o.note === "string" ? o.note.slice(0, 300) : null, sound: o.sound === true,
    notify: o.notify === true, notifyOn: o.notifyOn !== false, noteSound: o.noteSound !== false, islandOk: o.islandOk === true, noteIsland: o.noteIsland !== false, sending: n(o.sending),
    error: typeof o.error === "string" ? o.error.slice(0, 200) : null, loaded: o.loaded === true, gif: cleanGif(o.gif),
    jump, seeking: o.seeking === true,
    convs: cleanConvs(o.convs), activeConv: typeof o.activeConv === "string" && o.activeConv ? o.activeConv.slice(0, 40) : SQUAD_CONV, members: cleanMembers(o.members), dm: o.dm === true,
  };
}

/** The badge on the G Squad icon: "9+" past nine. */
export function badgeText(n: number): string { return n <= 0 ? "" : n > 9 ? "9+" : String(n); }

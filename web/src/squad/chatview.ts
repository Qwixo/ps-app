// G Squad chat (V1.40): what the Tab list is told about the chat (plain, no keys, like the core's SquadView) and what
// it may ask for. The main page opens everything (squad/chatengine.ts); the Tab list sends its buttons back as one
// `sqChatOp`, checked here.
import { cleanAbout, cleanText, type ChatAbout } from "../core/squadchat.ts";

export interface ChatLine { id: string; from: string; name: string; mine: boolean; t: string; a?: ChatAbout; at: string; edited: boolean; left: boolean; sending?: boolean; failed?: boolean }
export interface ChatVoteView {
  id: string; joiner: string; name: string; stage: "ask" | "again" | null; mine: boolean | null; n: number; k: number;
  title: string; sub: string; body: string;
}
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
  sending: number;                // messages on their way
  error: string | null;
  loaded: boolean;
}
export const EMPTY_CHAT: ChatView = { in: false, ready: false, open: false, unread: 0, lines: [], more: false, votes: [], note: null, sound: false, notify: false, notifyOn: true, noteSound: true, sending: 0, error: null, loaded: false };

export type ChatOp =
  | { op: "open"; on: boolean } | { op: "send"; text: string; a?: ChatAbout } | { op: "edit"; id: string; text: string } | { op: "del"; id: string }
  | { op: "vote"; id: string; yes: boolean } | { op: "older" } | { op: "sound"; on: boolean } | { op: "retry" }
  | { op: "notify"; on: boolean } | { op: "noteSound"; on: boolean };

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
    case "notify": case "noteSound": return typeof o.on === "boolean" ? { op: o.op, on: o.on } : null;
    case "send": { const t = cleanText(o.text); if (!t) return null; const a = cleanAbout(o.a); return a ? { op: "send", text: t, a } : { op: "send", text: t }; }
    case "edit": { const i = id(o.id), t = cleanText(o.text); return i && t ? { op: "edit", id: i, text: t } : null; }
    case "del": { const i = id(o.id); return i ? { op: "del", id: i } : null; }
    case "vote": { const i = id(o.id); return i && typeof o.yes === "boolean" ? { op: "vote", id: i, yes: o.yes } : null; }
  }
  return null;
}

/** The Tab list's copy, checked lightly (shapes and lengths). */
export function cleanChatView(v: unknown): ChatView {
  const o = (v && typeof v === "object" ? v : null) as Record<string, unknown> | null;
  if (!o) return EMPTY_CHAT;
  const s = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");
  const n = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 ? (x as number) : 0);
  const lines = (Array.isArray(o.lines) ? o.lines.slice(-600) : []).filter((l) => l && typeof l === "object" && typeof l.id === "string").map((l): ChatLine => ({
    id: s(l.id, 40), from: s(l.from, 40), name: s(l.name, 40) || "Someone", mine: l.mine === true, t: s(l.t, 2000), at: s(l.at, 40), edited: l.edited === true, left: l.left === true,
    ...(l.sending === true ? { sending: true } : {}), ...(l.failed === true ? { failed: true } : {}),
    ...(cleanAbout(l.a) ? { a: cleanAbout(l.a) } : {}),
  }));
  const votes = (Array.isArray(o.votes) ? o.votes.slice(0, 10) : []).filter((x) => x && typeof x === "object" && typeof x.id === "string").map((x): ChatVoteView => ({
    id: s(x.id, 40), joiner: s(x.joiner, 40), name: s(x.name, 40), stage: x.stage === "ask" || x.stage === "again" ? x.stage : null, mine: typeof x.mine === "boolean" ? x.mine : null,
    n: n(x.n), k: n(x.k), title: s(x.title, 200), sub: s(x.sub, 300), body: s(x.body, 900),
  }));
  return {
    in: o.in === true, ready: o.ready === true, open: o.open === true, unread: n(o.unread), lines, more: o.more === true, votes,
    note: typeof o.note === "string" ? o.note.slice(0, 300) : null, sound: o.sound === true,
    notify: o.notify === true, notifyOn: o.notifyOn !== false, noteSound: o.noteSound !== false, sending: n(o.sending),
    error: typeof o.error === "string" ? o.error.slice(0, 200) : null, loaded: o.loaded === true,
  };
}

/** The badge on the G Squad icon: "9+" past nine. */
export function badgeText(n: number): string { return n <= 0 ? "" : n > 9 ? "9+" : String(n); }

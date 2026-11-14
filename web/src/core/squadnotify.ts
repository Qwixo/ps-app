// G Squad message notifications (PS 1.60, PR 10, feature "gsquad-notify"). A message from someone else in the squad chat
// pops up as a card you can Reply to from the card itself, like a client email card (src/mailcards.ts): the Mac's card stack
// (top right), a card in the corner of the website, a notification on the phone (no words on the lock screen).
//
// Pure rules only, no screen and no network, so tests/gsquad-notify.test.ts checks every one:
//  * which messages notify: not yours, not muted, not already read anywhere, not dismissed on another device, not when the
//    chat is open and in front, never older than a few hours, never from before notifications were switched on here;
//  * each message notifies exactly once per device (a small ledger keyed by the message id, kept across restarts);
//  * a Dismiss (or a sent Reply) on one device is a "seen up to here" mark in the settings, so the other devices drop the
//    card too; opening the chat reads the messages on the hub, which does the same;
//  * muted while Do Not Disturb is on (Sleep mode turns Do Not Disturb on by itself; the Mac also holds the card back while
//    Sentry mode or Sleep mode covers the screen, ps-mac SquadMessageCard.swift);
//  * the reply box's steps: type, Send, a short Undo, then it goes. Escape and Back close it.
import { buildSend } from "../squad/chatsend.ts";
import type { ChatOp } from "../squad/chatview.ts";
import { hubMicros } from "./squadchat.ts";
import { cleanLedger, ledgerDecide, type Ledger } from "./maildedupe.ts";
import { dndMutes, type Dnd } from "./dnd.ts";

export const NOTIFY_FEATURE = "gsquad-notify";
/** The most cards one look puts up (the rest are marked as announced, never queued). */
export const NOTE_SHOW_MAX = 3;
/** A message older than this never pops up (a Mac that slept all night does not announce yesterday). */
export const NOTE_MAX_AGE_MS = 6 * 3_600_000;
/** The words on a card, cut. */
export const NOTE_BODY_MAX = 240;
export const NOTE_NAME_MAX = 60;
/** How long Undo stays after Send (milliseconds), before the reply really goes. */
export const REPLY_UNDO_MS = 5_000;
export const NOTE_DISCREET = "New G Squad message";
export const NOTE_PREFIX = "g:";

/** A message of someone in the squad, as the card logic needs it. */
export interface NoteMsg { id: string; from: string; name: string; t: string; at: string }

export interface NoteSettings { squadNotify?: boolean; squadNotifySound?: boolean; squadNoteSeen?: string; tmNotify?: boolean; tmMuted?: boolean; dnd?: Dnd }

/** Notifications for G Squad messages are on: the feature, this person's switch (missing = on) and the pop-ups gear. */
export function noteOn(featureOn: boolean, st: NoteSettings | null | undefined): boolean {
  return featureOn && st?.squadNotify !== false && st?.tmNotify !== false;
}
/** The sound with a card: the switch (missing = on), the Tab list sounds speaker, and Do Not Disturb's sounds. */
export function noteSound(st: NoteSettings | null | undefined, now: number, device: "mac" | "phone" | "web"): boolean {
  if (st?.squadNotifySound === false || st?.tmMuted) return false;
  return !dndMutes(st?.dnd, "sounds", now, device) && !noteMuted(st, now, device);
}
/** Muted: Do Not Disturb (any focus mode, Sleep mode's included) is on and does not let G Squad through. */
export function noteMuted(st: NoteSettings | null | undefined, now: number, device: "mac" | "phone" | "web"): boolean {
  return dndMutes(st?.dnd, "gsquad", now, device);
}

export type NoteWhy = "own" | "old" | "before" | "read" | "dismissed" | "open" | "muted" | "again" | "capped";
export interface NoteInput {
  me: string;
  /** What this device knows: the moment notifications started here (ISO), the hub's read mark, the settings' seen mark. */
  since: string | null; read: string | null; seen: string | null;
  chatOpen: boolean; muted: boolean;
  now: number;
  ledger: Ledger;
}
export interface NotePlan { show: NoteMsg[]; ledger: Ledger; skipped: { id: string; why: NoteWhy }[] }

/** Which of the messages notify now. Newest cards win when more than NOTE_SHOW_MAX are new at once. */
export function planNotes(msgs: NoteMsg[], inp: NoteInput): NotePlan {
  const sorted = [...msgs].sort((a, b) => hubMicros(a.at) - hubMicros(b.at) || a.id.localeCompare(b.id));
  const fresh: NoteMsg[] = [];
  const skipped: NotePlan["skipped"] = [];
  let ledger = inp.ledger;
  const since = hubMicros(inp.since), read = hubMicros(inp.read), seen = hubMicros(inp.seen);
  for (const m of sorted) {
    const at = hubMicros(m.at);
    const skip = (why: NoteWhy) => skipped.push({ id: m.id, why });
    if (m.from === inp.me) { skip("own"); continue; }
    if (!inp.since || at <= since) { skip("before"); continue; }
    if (inp.now - Date.parse(m.at) > NOTE_MAX_AGE_MS) { skip("old"); continue; }
    if (read && at <= read) { skip("read"); continue; }
    if (seen && at <= seen) { skip("dismissed"); continue; }
    if (Object.prototype.hasOwnProperty.call(ledger, noteLedgerKey(m.id))) { skip("again"); continue; }
    // From here the message counts as announced on this device, shown or not: it never comes up later by itself.
    const d = ledgerDecide(ledger, noteLedgerKey(m.id), inp.now);
    ledger = d.ledger;
    if (inp.chatOpen) { skip("open"); continue; }
    if (inp.muted) { skip("muted"); continue; }
    fresh.push(m);
  }
  const show = fresh.slice(-NOTE_SHOW_MAX);
  for (const m of fresh.slice(0, Math.max(0, fresh.length - NOTE_SHOW_MAX))) skipped.push({ id: m.id, why: "capped" });
  return { show, ledger, skipped };
}
export const noteLedgerKey = (id: string) => `gsq:${id}`;
export const cleanNoteLedger = cleanLedger;

/** A card already on screen that should go: read on the hub (here or on another device), dismissed elsewhere, the chat is
 *  open, muted by Do Not Disturb, or the switch went off. */
export function staleNotes(on: { id: string; at: string }[], o: { read: string | null; seen: string | null; chatOpen: boolean; muted: boolean; enabled: boolean }): string[] {
  const read = hubMicros(o.read), seen = hubMicros(o.seen);
  return on.filter((c) => {
    const at = hubMicros(c.at);
    return !o.enabled || o.chatOpen || o.muted || (!!read && at <= read) || (!!seen && at <= seen);
  }).map((c) => c.id);
}

/** The newer of two "seen up to here" times (a Dismiss never moves it back). */
export function laterSeen(cur: string | null | undefined, at: string): string {
  return hubMicros(at) > hubMicros(cur) ? at : cur || at;
}

const oneLine = (v: string, max: number) => v.replace(/\s+/g, " ").trim().slice(0, max);

/** The card the Mac's stack, the website and the phone show. id "g:<message id>", the rev is the message id too, so the
 *  phone's own per card memory (NoteLedger) also shows it once. reply: true makes the Mac's card draw its Reply button. */
export function noteCard(m: NoteMsg) {
  return {
    id: `${NOTE_PREFIX}${m.id}`.slice(0, 40), rev: m.id, tone: "squad", icon: "chat", title: oneLine(m.name || "Someone", NOTE_NAME_MAX) || "Someone",
    sub: "G Squad", body: m.t.trim().slice(0, NOTE_BODY_MAX), at: m.at, discreetText: NOTE_DISCREET, reply: true,
  };
}
export type NoteCard = ReturnType<typeof noteCard>;
export const isNoteCard = (id: unknown): id is string => typeof id === "string" && id.startsWith(NOTE_PREFIX) && id.length > 2 && id.length <= 40;

/** Cards to draw: the live ones, then any card that left while its reply waits out the Undo (it stays, with its Undo, until
 *  the Undo ends: a swipe, or another device reading the chat, must not send the reply early or lose it). */
export function withHeld<T extends { id: string }>(live: T[], held: T[]): T[] {
  const have = new Set(live.map((c) => c.id));
  return [...live, ...held.filter((h) => !have.has(h.id))];
}

// ---------- the reply box ----------
export type ReplyState =
  | { k: "idle" }
  | { k: "typing"; text: string }
  | { k: "undo"; text: string; until: number };
export type ReplyEvent =
  | { e: "open" } | { e: "type"; text: string } | { e: "send" } | { e: "undo" } | { e: "tick" } | { e: "close" };
export interface ReplyStep { state: ReplyState; /** The reply goes now (the composer's send request). */ send: ChatOp | null; /** The card is finished (sent or closed). */ done: boolean }

export const REPLY_IDLE: ReplyState = { k: "idle" };
/** One step of the reply box. Send starts the short Undo; the reply goes only when it runs out (a tick at or after
 *  `until`), and Close (Escape, Back) in the Undo stretch cancels it: nothing goes unless the time ran out. */
export function replyStep(s: ReplyState, ev: ReplyEvent, now: number): ReplyStep {
  const stay = (state: ReplyState): ReplyStep => ({ state, send: null, done: false });
  switch (ev.e) {
    case "open": return s.k === "idle" ? stay({ k: "typing", text: "" }) : stay(s);
    case "type": return s.k === "typing" ? stay({ k: "typing", text: ev.text }) : stay(s);
    case "send": {
      if (s.k !== "typing") return stay(s);
      return buildSend(s.text) ? stay({ k: "undo", text: s.text, until: now + REPLY_UNDO_MS }) : stay(s);
    }
    case "undo": return s.k === "undo" ? stay({ k: "typing", text: s.text }) : stay(s);
    case "tick": {
      if (s.k !== "undo" || now < s.until) return stay(s);
      const op = buildSend(s.text);
      return { state: REPLY_IDLE, send: op, done: !!op };
    }
    case "close": return s.k === "typing" || s.k === "undo" ? stay(REPLY_IDLE) : { state: s, send: null, done: true };
  }
}

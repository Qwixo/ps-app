// Reply in the email panel (V1.59, the developer 14 Nov 2026: "make it so you can click to reply IN the email panel, same thing
// on the desktop too"). Each email in the email panel (the Inbox tab on the phone, the website, the Mac's Tab list) gets
// a Reply button that opens a small reply box right there: the last message, a text box, Send and Cancel. The developer types
// the words himself. Send asks nothing more, but shows "Sending in 10 s, Undo" first; only when that runs out does the
// reply leave this page. It goes from the same account and in the same thread the email came in on (Gmail for Gmail,
// Instantly for Instantly), through the one sender PS already has: the Mac's queue (ps-mac MailSend.swift), which
// holds the Gmail sign ins and the Instantly key in the Mac's Keychain.
//  - On the Mac (main window or Tab list) the reply goes straight to that Mac's queue when the account can send there.
//  - On the phone and the website, and on a Mac that cannot send from that account, the reply is written to the vault
//    as a "rout" record (encrypted with the vault key, owner only), and a Mac that CAN send from that account picks it
//    up, claims it, and hands it to its queue. Two Macs never both send it: a claim, a wait, a fresh read, and only the
//    Mac whose claim stands sends it; a record handed over once is never handed over again.
//  - The record says how it went (sent, or not sent and why), so every device shows "Replied" or the problem.
// PS never sends by itself: a record exists only because the developer pressed Send in the box and let the Undo run out.
// This file is pure (no DOM, no network, no vault): the rules, so they can be tested with a fake sender.
import { makeJob, sigFor, fillPlaceholders, fillOf, UNDO_SECONDS, type MailReplyPrefs, type ReplyCtx, type ReplyJob, type Via } from "./mailreply.ts";

// ---------- the switch ----------
/** Settings, Notifications, "Reply in the email panel": on unless switched off. */
export const replyInPanelOn = (st: { replyInPanel?: boolean } | null | undefined) => st?.replyInPanel !== false;

// ---------- drafts ----------
/** What a draft store needs (localStorage on a real page, a Map in the tests). */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
const DRAFT_KEY = "ps-reply-drafts";
const DRAFT_MAX = 30;          // emails with a draft kept
export const DRAFT_DAYS = 14;  // a draft not touched for this long is let go
export const MESSAGE_MAX = 20_000;
type DraftMap = Record<string, { t: string; at: number }>;

/** The words typed for each email, kept on this device when the box closes by accident (Cancel, Esc, Back, the page
 *  reloading, the Tab list hiding). Cleared only when the reply has really been handed over, or the box is emptied. */
export function makeDrafts(kv: KV | null, now: () => number = Date.now) {
  let mem: DraftMap = {};
  const read = (): DraftMap => {
    if (!kv) return mem;
    try { const o = JSON.parse(kv.getItem(DRAFT_KEY) || "{}"); return o && typeof o === "object" && !Array.isArray(o) ? o as DraftMap : {}; } catch { return {}; }
  };
  const write = (m: DraftMap) => {
    const cut = now() - DRAFT_DAYS * 86_400_000;
    const keep = Object.entries(m).filter(([, d]) => d && typeof d.t === "string" && d.t.trim() && d.at > cut)
      .sort((a, b) => b[1].at - a[1].at).slice(0, DRAFT_MAX);
    const out = Object.fromEntries(keep);
    mem = out;
    if (kv) { try { kv.setItem(DRAFT_KEY, JSON.stringify(out)); } catch { /* storage full or blocked: the copy in memory still holds it */ } }
  };
  return {
    get: (cardId: string): string => { const d = read()[cardId]; return d && typeof d.t === "string" ? d.t : ""; },
    set: (cardId: string, text: string) => { const m = read(); if (text.trim()) m[cardId] = { t: text.slice(0, MESSAGE_MAX), at: now() }; else delete m[cardId]; write(m); },
    clear: (cardId: string) => { const m = read(); delete m[cardId]; write(m); },
    has: (cardId: string) => !!read()[cardId]?.t?.trim(),
  };
}
export type Drafts = ReturnType<typeof makeDrafts>;

// ---------- Send with Undo ----------
export const UNDO_MS = UNDO_SECONDS * 1000;
export interface Timers { set(f: () => void, ms: number): unknown; clear(h: unknown): void }
const realTimers: Timers = { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** Send pressed: nothing leaves until the Undo window runs out, then `go` runs exactly once. Undo before that and it
 *  never runs. Returns the handle the box shows ("Sending in 8 s, Undo"). */
export function startUndoSend(go: () => void, o: { ms?: number; timers?: Timers; now?: () => number } = {}) {
  const ms = o.ms ?? UNDO_MS, t = o.timers ?? realTimers, now = o.now ?? Date.now;
  const until = now() + ms;
  let state: "waiting" | "gone" | "undone" = "waiting";
  const h = t.set(() => { if (state !== "waiting") return; state = "gone"; go(); }, ms);
  return {
    until,
    /** True when it was stopped in time (nothing was sent). */
    undo(): boolean { if (state !== "waiting") return false; state = "undone"; t.clear(h); return true; },
    get state() { return state; },
    left: () => Math.max(0, Math.ceil((until - now()) / 1000)),
  };
}
export type UndoSend = ReturnType<typeof startUndoSend>;

// ---------- the reply itself ----------
/** The job for the queue: the developer's words (the {first name} style placeholders filled in), his signature for that account,
 *  and the email answered quoted under it, from the account it came to, in its thread. Throws a plain sentence when
 *  something is missing (no words, no thread). */
export function inlineJob(ctx: ReplyCtx, message: string, prefs: MailReplyPrefs | undefined, id: string, now: number): ReplyJob {
  const words = fillPlaceholders(message, fillOf(ctx));
  return makeJob(ctx, { message: words, sig: sigFor(prefs, ctx.account), quote: true }, now, now, id);
}

/** Where a job goes: the routing every sender must keep (tests check it on the fake sender). */
export function routeOf(j: Pick<ReplyJob, "via" | "account" | "threadId" | "emailId">): { via: Via; account: string; thread: string } {
  if (j.via === "gmail") { if (!j.threadId) throw new Error("no Gmail thread"); return { via: "gmail", account: j.account, thread: j.threadId }; }
  if (!j.emailId) throw new Error("no Instantly email"); return { via: "instantly", account: j.account, thread: j.emailId };
}

// ---------- the vault record (phone and website, or a Mac that cannot send from that account) ----------
export type OutState = "waiting" | "claimed" | "handed" | "sent" | "failed";
export interface ReplyOut {
  v: 1;
  cardId: string;
  via: Via;
  account: string;
  who: string;             // for the "Replied" row once the email has left the panel
  subject: string;
  state: OutState;
  at: string;              // when Send's Undo ran out
  from: "mac" | "phone" | "web";
  by?: string;             // the Mac that claimed it (a random id per Mac, never a name)
  claimAt?: string;
  error?: string;
  doneAt?: string;
  /** The reply. Dropped once it has gone (the words stay in Sent, not in the vault). */
  job?: ReplyJob;
}

/** Not handed over this long after Send: it is not sent at all (the developer sees "Not sent", and can send it again). */
export const STALE_MS = 6 * 3600_000;
/** A Mac claimed it and then went quiet: another Mac may take it after this. */
export const CLAIM_STALE_MS = 2 * 60_000;
/** The wait between a claim and the fresh read that decides which Mac sends it. */
export const CLAIM_WAIT_MS = 6_000;
/** How long a "Replied" row stays at the bottom of the panel, and when a finished record is removed. */
export const REPLIED_SHOW_MS = 60 * 60_000;
export const KEEP_MS = 2 * 86_400_000;

export function newOut(job: ReplyJob, who: string, subject: string, from: ReplyOut["from"], now: number): ReplyOut {
  return { v: 1, cardId: job.cardId, via: job.via, account: job.account, who: who.slice(0, 80), subject: subject.slice(0, 200), state: "waiting", at: new Date(now).toISOString(), from, job };
}

/** The box's Send could not even build the reply (no thread, the email gone): a record that says so, so every
 *  surface (the Tab list too, which learns only through the vault) shows "Not sent" and why, never a stuck "Sending". */
export function failedOut(cardId: string, error: string, from: ReplyOut["from"], now: number): ReplyOut {
  const t = new Date(now).toISOString();
  return { v: 1, cardId, via: cardId.startsWith("n:") ? "instantly" : "gmail", account: "", who: "", subject: "", state: "failed", at: t, doneAt: t, from, error: error.slice(0, 300) };
}

/** A record from the vault, checked (another device wrote it). Null when anything is off. */
export function cleanOut(v: unknown): ReplyOut | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const s = (k: string, max: number) => typeof o[k] === "string" ? (o[k] as string).slice(0, max) : null;
  const cardId = s("cardId", 40), via = o.via, account = s("account", 254), at = s("at", 40), state = o.state;
  if (o.v !== 1 || !cardId || !/^[mn]:[\w-]{1,38}$/.test(cardId) || (via !== "gmail" && via !== "instantly") || account === null || !at || Number.isNaN(Date.parse(at))) return null;
  if (!["waiting", "claimed", "handed", "sent", "failed"].includes(state as string)) return null;
  const from = o.from === "mac" || o.from === "phone" || o.from === "web" ? o.from : "web";
  const out: ReplyOut = { v: 1, cardId, via, account: account.toLowerCase(), who: s("who", 80) || "", subject: s("subject", 200) || "", state: state as OutState, at, from };
  const by = s("by", 40); if (by) out.by = by;
  const claimAt = s("claimAt", 40); if (claimAt) out.claimAt = claimAt;
  const error = s("error", 300); if (error) out.error = error;
  const doneAt = s("doneAt", 40); if (doneAt) out.doneAt = doneAt;
  const j = o.job as ReplyJob | undefined;
  if (j && typeof j === "object" && j.cardId === cardId && j.via === via && typeof j.id === "string" && typeof j.text === "string") out.job = j;
  return out;
}

/** Can this Mac send from that account right now (from the Mac's own MailSend status)? */
export interface SendStatus { gmail: { account: string; connected: boolean; problem?: string }[]; instantly: { saved: boolean; problem?: string } }
export function canSendFrom(st: SendStatus | null | undefined, via: Via, account: string): boolean {
  if (!st) return false;
  if (via === "instantly") return !!st.instantly?.saved && !st.instantly.problem;
  const a = account.toLowerCase();
  return (st.gmail || []).some((g) => g.account.toLowerCase() === a && g.connected && !g.problem);
}

/** The records this Mac should claim: waiting ones (or ones another Mac claimed and then went quiet on), with the
 *  reply in them, not older than STALE_MS, from an account this Mac can send from. */
export function relayPicks(outs: { id: string; out: ReplyOut }[], me: string, can: (via: Via, account: string) => boolean, now: number): string[] {
  return outs.filter(({ out }) => {
    if (!out.job || now - Date.parse(out.at) > STALE_MS || !can(out.via, out.account)) return false;
    if (out.state === "waiting") return true;
    return out.state === "claimed" && out.by !== me && now - Date.parse(out.claimAt || out.at) > CLAIM_STALE_MS;
  }).map((x) => x.id);
}
/** Waiting records too old to send: they become "Not sent" (never sent late by surprise). */
export function staleOnes(outs: { id: string; out: ReplyOut }[], now: number): string[] {
  return outs.filter(({ out }) => (out.state === "waiting" || out.state === "claimed") && now - Date.parse(out.at) > STALE_MS).map((x) => x.id);
}
export const claim = (o: ReplyOut, me: string, now: number): ReplyOut => ({ ...o, state: "claimed", by: me, claimAt: new Date(now).toISOString() });
/** After the wait and a fresh read: this Mac sends it only if its own claim still stands. */
export const claimWon = (o: ReplyOut | null, me: string) => !!o && o.state === "claimed" && o.by === me && !!o.job;
/** Written (and saved) before the job goes to the queue: never handed over twice. */
export const handed = (o: ReplyOut, me: string, now: number): ReplyOut => ({ ...o, state: "handed", by: me, claimAt: o.claimAt || new Date(now).toISOString() });

/** What the Mac's queue said about the job: sent (the words are dropped from the vault), failed (with why). */
export function fromQueue(o: ReplyOut, row: { state: string; error?: string } | null, now: number): ReplyOut | null {
  if (!row || (o.state !== "handed" && o.state !== "claimed")) return null;
  const done = new Date(now).toISOString();
  if (row.state === "sent") { const { job: _j, error: _e, ...rest } = o; return { ...rest, state: "sent", doneAt: done }; }
  if (row.state === "failed" || row.state === "cancelled") return { ...o, state: "failed", doneAt: done, error: (row.error || (row.state === "cancelled" ? "Stopped before it went." : "Not sent.")).slice(0, 300) };
  return null;
}
export const markStale = (o: ReplyOut, now: number): ReplyOut =>
  ({ ...o, state: "failed", doneAt: new Date(now).toISOString(), error: "No Mac sent it within 6 hours (PS app on a Mac that can send from this account was off). Your words are still in the box." });

// ---------- what the panel shows ----------
export type RowStatus = { kind: "sending" | "replied" | "failed"; text: string; error?: string };
/** One line per email that has a reply record: Sending (waiting for a Mac, or on its way), Replied, or Not sent. */
export function panelStatus(outs: ReplyOut[]): Map<string, RowStatus> {
  const m = new Map<string, RowStatus>();
  for (const o of [...outs].sort((a, b) => a.at.localeCompare(b.at))) {   // the newest record for an email wins
    if (o.state === "sent") m.set(o.cardId, { kind: "replied", text: "Replied" });
    else if (o.state === "failed") m.set(o.cardId, { kind: "failed", text: "Not sent", error: o.error });
    else m.set(o.cardId, { kind: "sending", text: o.state === "waiting" ? (o.from === "mac" ? "Sending" : "Sending through your Mac") : "Sending" });
  }
  return m;
}
/** "Replied" rows for emails that have left the open list, newest first, for an hour after they went. */
export function repliedRows(outs: ReplyOut[], openIds: Set<string>, now: number): { cardId: string; who: string; subject: string; at: string }[] {
  const seen = new Set<string>();
  return [...outs].filter((o) => o.state === "sent" && !openIds.has(o.cardId) && now - Date.parse(o.doneAt || o.at) < REPLIED_SHOW_MS)
    .sort((a, b) => (b.doneAt || b.at).localeCompare(a.doneAt || a.at))
    .filter((o) => !seen.has(o.cardId) && !!seen.add(o.cardId))
    .map((o) => ({ cardId: o.cardId, who: o.who, subject: o.subject, at: o.doneAt || o.at }));
}
/** Replied rows sink below the open ones (like a ticked task); the rest keep their order. */
export function sinkReplied<T extends { cardId: string }>(rows: T[], st: Map<string, RowStatus>): T[] {
  const up = rows.filter((r) => st.get(r.cardId)?.kind !== "replied"), down = rows.filter((r) => st.get(r.cardId)?.kind === "replied");
  return [...up, ...down];
}
/** Finished records to remove (two days after they finished), so the vault does not fill up. */
export function sweepIds(outs: { id: string; out: ReplyOut }[], now: number): string[] {
  return outs.filter(({ out }) => (out.state === "sent" || out.state === "failed") && now - Date.parse(out.doneAt || out.at) > KEEP_MS).map((x) => x.id);
}

/** The Tab list's Send, as it crosses to the main window: the email, the words, and the id for the reply. */
export function cleanInlineSend(v: unknown): { cardId: string; text: string; id: string } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.cardId !== "string" || !/^[mn]:[\w-]{1,38}$/.test(o.cardId)) return null;
  if (typeof o.id !== "string" || !/^[\w-]{8,40}$/.test(o.id)) return null;
  if (typeof o.text !== "string" || !o.text.trim() || o.text.length > MESSAGE_MAX) return null;
  return { cardId: o.cardId, text: o.text, id: o.id };
}

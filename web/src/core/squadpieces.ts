// G Squad pieces (PS 1.65, feature "gsquad-pieces", the developer 17 Nov 2026: "divide the G Squad interface up into elements
// too... put a part of the G Squad chat on your page... it all stays in sync"). In Edit mode the person can place parts of G Squad
// on any page of the Tab list, each as its own panel: the squad chat, the conversation list, the leaderboard, tasks done and
// who is working now (Squad Priority 1 was already a panel). Pure rules only, so tests/squadpieces.test.ts can check them.
//
// ONE engine, many views: no piece keeps data of its own. Each draws from the same plain views the G Squad window draws from
// (squad/mirror.ts useSquad, squad/chatmirror.ts useChat) and sends its buttons through the same ops (squadOp, chatOp, boardOp),
// so a message sent in a piece shows in every other piece and in the window at once. No keys in a piece (the Tab list holds none).
// Off the page by default: the person adds them in Edit mode (core/tablayout.ts optIn).
import type { BoardEntry, BoardView, TasksPeriod } from "./squadboard.ts";
import { moneyRows, type MoneyRow } from "./gsboard.ts";

export const PIECES_FEATURE = "gsquad-pieces";

/** Which plain view a piece draws from. squad = squad/view.ts SquadView, chat = squad/chatview.ts ChatView. */
export type PieceNeed = "squad" | "chat";
export interface PieceDef {
  /** The Slot id in core/tablayout.ts SLOTS. */
  id: string;
  label: string;
  needs: readonly PieceNeed[];
  /** The G Squad window section a click opens (squad/tabs.ts ids), or null when the piece does its own clicking. */
  opens: string | null;
  /** Needs the chat to be open (the main page pulls the chat every 5 s only while a screen shows it). */
  live: boolean;
}
/** The pieces, in the order of the Add panel gallery. Squad Priority 1 (id squadp1, PS 1.63) is the sixth piece and keeps its place. */
export const PIECES: readonly PieceDef[] = [
  { id: "sqchat", label: "Squad chat", needs: ["squad", "chat"], opens: "chat", live: true },
  { id: "sqconvs", label: "Conversations", needs: ["squad", "chat"], opens: "chat", live: false },
  { id: "sqboard", label: "Squad leaderboard", needs: ["squad"], opens: "leaderboard", live: false },
  { id: "sqdone", label: "Squad tasks done", needs: ["squad"], opens: "leaderboard", live: false },
  { id: "sqnow", label: "Working now", needs: ["squad"], opens: "members", live: false },
];
export const PIECE_IDS: readonly string[] = PIECES.map((p) => p.id);
export const pieceOf = (id: string): PieceDef | null => PIECES.find((p) => p.id === id.split(".")[0]) ?? null;
/** Every piece, Squad Priority 1 included (its own switch and rules stay in core/squadp1.ts). */
export const ALL_PIECE_IDS: readonly string[] = [...PIECE_IDS, "squadp1"];

/** A piece shows only for someone in a squad and only while the feature is on; otherwise it draws nothing (and asks for nothing). */
export const pieceShows = (on: boolean, inSquad: boolean): boolean => on && inSquad;

// ---------- the chat: which screens keep it open ----------
// The window and every chat piece each say "open" while they are on screen. The main page needs ONE open, and a close only when the
// last screen is gone, so closing one piece never stops the chat under the window or another piece.
export interface OpenCount { add(): void; drop(): void; n(): number }
export function openCounter(send: (on: boolean) => void): OpenCount {
  let n = 0;
  return {
    add() { n += 1; if (n === 1) send(true); },
    drop() { if (n === 0) return; n -= 1; if (n === 0) send(false); },
    n: () => n,
  };
}

// ---------- the conversation list ----------
/** What a click on a conversation does. A chat piece on a page shows the conversation, so the click only switches it (every chat
 *  piece and the window follow); with no chat piece on screen the click also opens the window on the chat so it has somewhere to go. */
export function convClick(chatPieceShown: boolean): "switch" | "switch-open" { return chatPieceShown ? "switch" : "switch-open"; }
/** The unread total on the list's header (9+ past nine). */
export const unreadTotal = (list: { unread: number }[]): number => list.reduce((n, c) => n + (c.unread > 0 ? c.unread : 0), 0);

// ---------- the leaderboard ----------
/** Money only, last month on top (the same rows the window's Leaderboard draws, core/gsboard.ts). Nothing when the board is not here. */
export function boardRows(b: BoardView | null | undefined, max = 6): { rows: MoneyRow[]; more: number; exact: boolean } {
  if (!b) return { rows: [], more: 0, exact: false };
  const all = moneyRows(b.money["1"] ?? []);
  return { rows: all.slice(0, Math.max(1, max)), more: Math.max(0, all.length - Math.max(1, max)), exact: b.rules.show === "exact" };
}

// ---------- tasks done ----------
export const DONE_PERIODS: { id: TasksPeriod; label: string }[] = [{ id: "7d", label: "7 days" }, { id: "month", label: "This month" }];
export interface DoneRow { member: string; n: number; rank: number | null; state: BoardEntry["state"] }
/** Who finished the most tasks over a stretch: people with a number first (most first, equal numbers share a place), then the ones who do not share. */
export function doneRows(b: BoardView | null | undefined, period: TasksPeriod, max = 6): { rows: DoneRow[]; more: number } {
  const list: BoardEntry[] = b?.tasks?.[period] ?? [];
  const rows: DoneRow[] = list.map((e) => ({ member: e.member, n: e.state === "ok" && Number.isFinite(e.n) ? (e.n as number) : 0, rank: e.state === "ok" ? e.rank : null, state: e.state }));
  const order = (r: DoneRow) => (r.state === "ok" ? 0 : r.state === "off" ? 1 : 2);
  rows.sort((a, c) => order(a) - order(c) || c.n - a.n);
  let prev: DoneRow | null = null;
  rows.forEach((r, i) => { if (r.state !== "ok") return; r.rank = prev && prev.n === r.n ? prev.rank : i + 1; prev = r; });
  const cut = Math.max(1, max);
  return { rows: rows.slice(0, cut), more: Math.max(0, rows.length - cut) };
}
/** The bar under a name: a share of the biggest number, never invisible; null with nothing done. */
export const doneShare = (n: number, top: number): number | null => (n > 0 && top > 0 ? Math.max(0.04, Math.min(1, n / top)) : null);

// ---------- who is working now ----------
export interface WorkRow { id: string; name: string; me: boolean; working: boolean }
/** Everyone in the squad who is working right now first (you on top of them), then the rest quietly. A member who does not share
 *  their status is never shown as not working: only `working === true` counts (squad/view.ts SquadMember.working). */
export function workRows(members: { id: string; name: string; me: boolean; working: boolean; shares?: boolean }[]): { working: WorkRow[]; rest: WorkRow[] } {
  const rows = members.map((m) => ({ id: m.id, name: m.name, me: m.me, working: m.working === true }));
  const by = (a: WorkRow, b: WorkRow) => (a.me === b.me ? a.name.localeCompare(b.name) : a.me ? -1 : 1);
  return { working: rows.filter((r) => r.working).sort(by), rest: rows.filter((r) => !r.working).sort(by) };
}
/** "3 working now" / "Nobody is working right now". */
export function workHeadline(n: number): string { return n <= 0 ? "Nobody is working right now" : `${n} working now`; }

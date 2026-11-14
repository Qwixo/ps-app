// G Squad chat, the new look (PR 11): the rules for how messages are grouped, where the day lines go, and the short
// times, with no screen code. Messages from one person close together are one group (the first shows the name, the
// last shows the picture); a new day starts a new group and gets a day line; a long pause starts a new group too.
import type { ChatLine } from "./chatview.ts";
import { dayLabel, sameDay } from "./window.ts";

/** A pause this long between two messages from one person starts a new group (the new look only). */
export const GROUP_GAP_MS = 5 * 60 * 1000;

export type ChatItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "msg"; key: string; line: ChatLine; first: boolean; last: boolean };

const ms = (iso: string) => { const t = new Date(iso).getTime(); return Number.isNaN(t) ? 0 : t; };

/** The messages in order, with a day line wherever the day changes and first and last marked per group.
 *  gapMs: Infinity keeps the classic grouping (sender and day only). */
export function groupChat(lines: ChatLine[], opts: { gapMs?: number; now?: Date } = {}): ChatItem[] {
  const gap = opts.gapMs ?? GROUP_GAP_MS;
  const joined = (a: ChatLine, b: ChatLine) => a.from === b.from && a.mine === b.mine && sameDay(a.at, b.at) && Math.abs(ms(b.at) - ms(a.at)) <= gap;
  const out: ChatItem[] = [];
  lines.forEach((l, i) => {
    const prev = lines[i - 1], next = lines[i + 1];
    if (!prev || !sameDay(prev.at, l.at)) out.push({ kind: "day", key: `day-${l.id}`, label: dayLabel(l.at, opts.now) });
    out.push({ kind: "msg", key: l.id, line: l, first: !prev || !joined(prev, l), last: !next || !joined(l, next) });
  });
  return out;
}

/** The time in a bubble: 14:05. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** The time on a list row: 14:05 today, Yesterday, else 6 Nov. */
export function listTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.toDateString() === now.toDateString()) return clockTime(iso);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** The unread count on a list row: nothing at 0 (or bad numbers), "99+" past ninety nine. */
export function unreadText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  const k = Math.floor(n);
  return k > 99 ? "99+" : String(k);
}

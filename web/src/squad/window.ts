// G Squad window (V1.43), the developer 8 Nov 2026: "I want the G Squad to be more like a Telegram looking kind of thing. And I
// want a Fitness tab within the G Squad button in the Tab overlay, and a maximize and minimize button, so maximize
// launches it full screen, and you can minimize it at the top left. Currently it looks like a dull pop-up."
// The rules of the window, with no DOM: its size and how it is remembered, the order of the sections, what each row
// in the left column says, the initials and colour of an avatar, and what one Esc does. views/GSquadWindow.tsx draws it.
import type { SquadView } from "./view.ts";
import type { GymSquadView } from "./gymview.ts";

// ---------- layout ----------
// V1.47 (the developer, 10 Nov 2026: "Make it a full screen thing"): one size only, the whole Tab list screen. The small pop-up,
// Minimize and Maximize are gone, and so is the remembered size (the old "gsquad.size" key is simply never read).
/** Under this width the screen shows one pane at a time (the list, or a section with a back arrow). The phone always does. */
export const NARROW_PX = 760;

// ---------- sections ----------
export const SECTION_IDS = ["chat", "tasks", "fitness", "leaderboard", "screen", "members"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
/** The section that opens: one asked for (the chat hook), else a hand over waiting, else the last one, else Chat. */
export function firstSection(o: { asked: string | null; waiting: number; last: string | null; ids: string[] }): string {
  const has = (id: string | null): id is string => !!id && o.ids.includes(id);
  if (has(o.asked)) return o.asked;
  if (o.waiting > 0 && has("tasks")) return "tasks";
  if (has(o.last)) return o.last;
  return o.ids[0] ?? "chat";
}

// ---------- the left column: one row per section ----------
export interface RowInfo { line: string; strong: boolean; time: string; count: number; dot: boolean }
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** The last message seen, kept only in memory (never written to disk: the chat is end to end encrypted). */
export interface LastLine { name: string; mine: boolean; t: string; at: string }

export function chatRow(unread: number, last: LastLine | null, time: (iso: string) => string): RowInfo {
  if (unread > 0) return { line: plural(unread, "new message", "new messages"), strong: true, time: last ? time(last.at) : "", count: unread, dot: false };
  if (last) return { line: `${last.mine ? "You" : last.name}: ${oneLine(last.t)}`, strong: false, time: time(last.at), count: 0, dot: false };
  return { line: "Say hi to the squad", strong: false, time: "", count: 0, dot: false };
}
export function tasksRow(v: SquadView): RowInfo {
  if (v.waiting > 0) return { line: `${plural(v.waiting, "task", "tasks")} handed to you`, strong: true, time: "", count: v.waiting, dot: false };
  const open = v.tasks.filter((t) => !t.x).length;
  return { line: open ? `${plural(open, "open task", "open tasks")} shared` : "No shared tasks yet", strong: false, time: "", count: 0, dot: false };
}
/** Fitness: the newest personal best by someone else; a dot while it is newer than your last look at Fitness. */
export function fitnessRow(g: GymSquadView, seen: string | null): RowInfo {
  let best: { name: string; x: string; d: string } | null = null;
  for (const c of g.cards) {
    const m = g.members.find((x) => x.id === c.id);
    if (!m || m.me) continue;
    for (const pb of c.sum?.pb ?? []) if (!best || pb.d > best.d) best = { name: m.name, x: pb.x, d: pb.d };
  }
  if (!best) return { line: "Gym boards, bests and challenges", strong: false, time: "", count: 0, dot: false };
  const fresh = !seen || best.d > seen;
  return { line: `${best.name} set a new best: ${best.x}`, strong: fresh, time: "", count: 0, dot: fresh };
}
export function boardRow(v: SquadView, moneyOnly = false): RowInfo {
  // V1.43: last month's amount not added yet: a quiet line and a dot (no sound, no pop-up).
  if (v.board?.due && v.board.mine.on) return { line: `Add what you made in ${v.board.due.label}`, strong: true, time: "", count: 0, dot: true };
  if (moneyOnly) {   // PS 1.65 (gsquad-v3): the board is money only
    const top = v.board?.money?.["1"]?.find((e) => e.state === "ok" && e.rank === 1);
    const w = top ? (top.member === v.me ? "You" : v.members.find((m) => m.id === top.member)?.name) : null;
    return { line: w ? `${w} ${w === "You" ? "lead" : "leads"} last month` : "Money made", strong: false, time: "", count: 0, dot: false };
  }
  const lead = v.board?.tasks?.month?.find((e) => e.state === "ok" && e.rank === 1);
  const who = lead ? (lead.member === v.me ? "You" : v.members.find((m) => m.id === lead.member)?.name) : null;
  return { line: who ? `${who} ${who === "You" ? "lead" : "leads"} tasks done this month` : "Money made and tasks done", strong: false, time: "", count: 0, dot: false };
}
export function screenRow(): RowInfo { return { line: "Daily totals, never which apps", strong: false, time: "", count: 0, dot: false }; }
/** V1.47: Squad settings, the last row on the left. */
export function settingsRow(): RowInfo { return { line: "Sharing, name, notifications, appearance", strong: false, time: "", count: 0, dot: false }; }
export function membersRow(v: SquadView): RowInfo {
  const asks = v.asks?.length ?? 0;
  if (asks > 0) return { line: asks === 1 ? `${v.asks![0].name} asked to join` : `${asks} people asked to join`, strong: true, time: "", count: asks, dot: false };
  const working = v.members.filter((m) => m.working).length;
  return { line: `${plural(v.members.length, "member", "members")}, ${working} working`, strong: false, time: "", count: 0, dot: false };
}
const oneLine = (t: string) => t.replace(/\s+/g, " ").trim();

// ---------- avatars ----------
/** Up to two letters: the first of the first two words ("Sam Lee" SL, "kit" K), or the first character. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = (w: string) => [...w][0] ?? "";
  const letters = words.length > 1 ? first(words[0]) + first(words[1]) : first(words[0]);
  return letters.toLocaleUpperCase();
}
/** Six colours, each from the current look (views/gswin.css .gsa.t0 to .t5), picked by the member id, so one person
 *  keeps one colour on every Mac in the squad. */
export const TONES = 6;
export function toneOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % TONES;
}

// ---------- chat: a day line between messages from different days ----------
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: d.getFullYear() === now.getFullYear() && now.getTime() - d.getTime() < 6 * 864e5 ? "long" : undefined, day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
export const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();

// ---------- Esc ----------
/** One Esc steps back one layer: an open sheet (Fitness), then a step inside a section (an edit, a form), then from a
 *  section back to the list when only one pane shows, and only then the window closes. It never only changes size. */
export type EscStep = "sheet" | "back" | "list" | "close";
export function escStep(o: { sheet: boolean; back: boolean; narrowInSection: boolean }): EscStep {
  if (o.sheet) return "sheet";
  if (o.back) return "back";
  if (o.narrowInSection) return "list";
  return "close";
}

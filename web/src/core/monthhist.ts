// Money and leaderboard history for a future recap (PS 1.65, the developer's friend, 17 Nov 2026: "in the past six months you did X").
// One small record per month (kind "mhist"), owner only, sealed with the vault key and synced to the person's own Supabase like the
// day log. Nothing here is sent to the G Squad or the hub: it only COPIES, on this device, what the person already had.
//
//   mine    what you made that month: the amount you typed into the G Squad Leaderboard ("Add what you made in October"),
//           in the squad's currency. That answer is the only earnings figure PS holds (settings.squadMoney, last 24 months);
//           the money Payments of a client project belong to that project and are not read here.
//   boards  the Leaderboard as you saw it for that month: who was ranked (opaque member id, never a name), their place, and the
//           values the squad had already shared with you: your own amount, and others' amounts only when the squad rule is
//           "exact" (core/squadboard.ts BOARD_RULES). Tasks done that month, which everyone sees.
// One record per month per person: its id is fixed by the person and the month (monthRecId), two devices merge (mergeMonth), and the
// boards copy is written once, when the squad's cards are loaded, then frozen (a member who leaves later does not change it).
// Pure, tested in tests/monthhist.test.ts.
import type { BoardKind, HeldCard, MoneyCard, TasksCard, SquadMoney } from "./squadboard.ts";
import { addMonths, BOARD_RULES, monthKey, moneyTz, ranked } from "./squadboard.ts";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MH = { rows: 30, keepMonths: 24 };

export interface BoardRow { m: string; me?: 1; r: number; a?: number; n?: number }
export interface MonthRec {
  t: "month"; v: 1; month: string; at: string;
  mine?: { amount: number; currency: string; source: "squad-answer" };
  boards?: { money?: BoardRow[]; tasks?: BoardRow[] };
}

/** A stored month record read safely (anything unreadable is null). */
export function cleanMonth(v: unknown): MonthRec | null {
  const o = v as Partial<MonthRec> | null;
  if (!o || typeof o !== "object" || o.t !== "month" || typeof o.month !== "string" || !MONTH.test(o.month)) return null;
  const rows = (l: unknown): BoardRow[] | undefined => Array.isArray(l) ? l.filter((x) => x && typeof x.m === "string" && Number.isFinite(x.r)).slice(0, MH.rows) : undefined;
  const out: MonthRec = { t: "month", v: 1, month: o.month, at: typeof o.at === "string" ? o.at : "" };
  if (o.mine && Number.isFinite(o.mine.amount)) out.mine = { amount: o.mine.amount, currency: String(o.mine.currency || ""), source: "squad-answer" };
  if (o.boards) { const money = rows(o.boards.money), tasks = rows(o.boards.tasks); if (money || tasks) out.boards = { ...(money ? { money } : {}), ...(tasks ? { tasks } : {}) }; }
  return out;
}

/** The one record id of a month for a person (a valid v4 shaped id made from both, so two devices, or one device twice, write the same record). */
export function monthRecId(userId: string, month: string): string {
  const str = `mhist|${userId}|${month}`;
  const h = [0x811c9dc5, 0x1b873593, 0xcc9e2d51, 0x85ebca6b];
  for (let i = 0; i < str.length; i++) for (let k = 0; k < 4; k++) { h[k] = Math.imul(h[k] ^ (str.charCodeAt(i) + k * 31), 0x01000193 + 2 * k) >>> 0; h[k] ^= h[(k + 1) % 4] >>> 13; }
  const x = h.map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-4${x.slice(13, 16)}-8${x.slice(17, 20)}-${x.slice(20, 32)}`;
}

/** Two copies of one month become one: your answer from the newer copy, the boards from the first copy that has them (frozen). */
export function mergeMonth(a: MonthRec, b: MonthRec): MonthRec {
  const [older, newer] = (a.at || "") <= (b.at || "") ? [a, b] : [b, a];
  const out: MonthRec = { t: "month", v: 1, month: a.month, at: newer.at };
  const mine = newer.mine ?? older.mine; if (mine) out.mine = mine;
  const boards = older.boards ?? newer.boards; if (boards) out.boards = boards;
  return out;
}
/** Every stored copy of every month folded into one each (older PS builds or two devices may have made several). */
export function foldMonths(stored: { id: string; data: unknown }[]): Map<string, { rec: MonthRec; ids: string[] }> {
  const out = new Map<string, { rec: MonthRec; ids: string[] }>();
  for (const d of stored) {
    const r = cleanMonth(d.data); if (!r) continue;
    const had = out.get(r.month);
    out.set(r.month, had ? { rec: mergeMonth(had.rec, r), ids: [...had.ids, d.id] } : { rec: r, ids: [d.id] });
  }
  return out;
}

/** The month records that need writing now. `have` is what is stored (by month). Only changed ones come back. */
export function planMonths(i: {
  have: Map<string, MonthRec>; money: SquadMoney; members: { id: string; me: boolean }[]; cards: Map<string, Map<BoardKind, HeldCard>>;
  show?: "rank" | "exact"; currency?: string; now: number; loaded: boolean;
}): MonthRec[] {
  const show = i.show ?? BOARD_RULES.show, currency = i.currency ?? BOARD_RULES.currency;
  const last = addMonths(monthKey(i.now, moneyTz(i.money)), -1);
  const at = new Date(i.now).toISOString();
  const out = new Map<string, MonthRec>();
  const get = (month: string): MonthRec => out.get(month) ?? structuredClone(i.have.get(month)) ?? { t: "month", v: 1, month, at };
  const same = (a: MonthRec, b: MonthRec | undefined) => !!b && JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });

  // Your own earnings: every answered month, kept.
  const answered = Object.entries(i.money.m || {}).filter(([k, v]) => MONTH.test(k) && Number.isFinite(v)).sort().slice(-MH.keepMonths);
  for (const [month, amount] of answered) {
    const r = get(month);
    r.mine = { amount, currency, source: "squad-answer" };
    if (!same(r, i.have.get(month))) { r.at = at; out.set(month, r); }
  }
  // The boards as you saw them, for the month that just ended, once the squad's cards are loaded.
  // Frozen: once a month has its boards copy it is never made again.
  if (i.loaded && i.members.length > 1 && !i.have.get(last)?.boards) {
    const r = get(last);
    const card = (m: string, k: BoardKind) => i.cards.get(m)?.get(k)?.card;
    const money: { member: string; v: number; me: boolean }[] = [], tasks: { member: string; v: number; me: boolean }[] = [];
    for (const mem of i.members) {
      const mc = card(mem.id, "money") as MoneyCard | undefined; if (mc?.m && last in mc.m) money.push({ member: mem.id, v: mc.m[last], me: mem.me });
      const tc = card(mem.id, "tasks") as TasksCard | undefined; if (tc?.m && last in tc.m) tasks.push({ member: mem.id, v: tc.m[last], me: mem.me });
    }
    const rows = (l: typeof money, kind: "money" | "tasks"): BoardRow[] => {
      const rk = ranked(l);
      return l.map((x) => ({ m: x.member, ...(x.me ? { me: 1 as const } : {}), r: rk.get(x.member)!,
        ...(kind === "money" ? (x.me || show === "exact" ? { a: x.v } : {}) : { n: x.v }) })).sort((a, b) => a.r - b.r).slice(0, MH.rows);
    };
    if (money.length || tasks.length) {
      r.boards = { ...(money.length ? { money: rows(money, "money") } : {}), ...(tasks.length ? { tasks: rows(tasks, "tasks") } : {}) };
      if (!same(r, i.have.get(last))) { r.at = at; out.set(last, r); }
    }
  }
  return [...out.values()];
}

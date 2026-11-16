// G Squad v3 (PS 1.65): the simple Leaderboard, money only. One list, best first, last month at the top.
import type { BoardEntry } from "./squadboard.ts";

export interface MoneyRow { member: string; rank: number | null; amount: number | null; state: "ok" | "off" | "none" }
/** Everyone, in order: people with a number first (biggest first, equal amounts share a place), then "Not shared", then
 *  "Not added yet". When the rule hides amounts the hub already sends ranks and no numbers: then the rank is the order. */
export function moneyRows(entries: BoardEntry[]): MoneyRow[] {
  const rows: MoneyRow[] = entries.map((e) => ({ member: e.member, rank: e.state === "ok" ? e.rank : null, amount: e.state === "ok" && typeof e.amount === "number" ? e.amount : null, state: e.state }));
  const order = (r: MoneyRow) => (r.state === "ok" ? 0 : r.state === "off" ? 1 : 2);
  rows.sort((a, b) => order(a) - order(b) || (a.state === "ok" && b.state === "ok" ? (a.amount !== null && b.amount !== null && a.amount !== b.amount ? b.amount - a.amount : (a.rank ?? 99) - (b.rank ?? 99)) : 0));
  // equal amounts keep one place (standard ranks), ranks from the hub are used as they come
  let prev: MoneyRow | null = null;
  rows.forEach((r, i) => {
    if (r.state !== "ok") return;
    if (r.amount !== null) r.rank = prev && prev.amount === r.amount ? prev.rank : i + 1;
    prev = r;
  });
  return rows;
}
/** The bar under a name: a share of the biggest amount, never invisible. Null with no amounts. */
export const barShare = (amount: number | null, max: number): number | null => (amount === null || !(max > 0) ? null : Math.max(0.03, Math.min(1, amount / max)));

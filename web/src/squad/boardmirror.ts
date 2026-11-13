// G Squad (V1.40) in the Tab list: the Leaderboard and Screen time view as the main page sent it, checked lightly
// (shapes and lengths only). It holds no key and no other person's money amount unless the rule is "exact".
import type { BoardEntry, BoardView, ScreenEntry } from "../core/squadboard.ts";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === "object") as Record<string, unknown>[] : []);
const entries = (v: unknown): BoardEntry[] => arr(v, 40).map((e) => {
  const out: BoardEntry = { member: str(e.member, 40), state: e.state === "ok" || e.state === "none" ? e.state : "off", rank: num(e.rank) };
  if (num(e.n) !== null) out.n = num(e.n)!;
  if (num(e.amount) !== null) out.amount = num(e.amount)!;
  if (num(e.months) !== null) out.months = num(e.months)!;
  return out;
});
const group = <K extends string>(v: unknown, keys: readonly K[]) => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(keys.map((k) => [k, entries(o[k])])) as Record<K, BoardEntry[]>;
};

export function cleanBoardView(v: unknown): BoardView | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const r = (o.rules && typeof o.rules === "object" ? o.rules : {}) as Record<string, unknown>;
  const mine = (o.mine && typeof o.mine === "object" ? o.mine : {}) as Record<string, unknown>;
  const due = o.due && typeof o.due === "object" ? o.due as Record<string, unknown> : null;
  return {
    rules: { money: r.money === "profit" ? "profit" : "revenue", show: r.show === "exact" ? "exact" : "rank", currency: str(r.currency, 3) || "USD" },
    money: group(o.money, ["1", "3", "6"] as const),
    tasks: group(o.tasks, ["7d", "month", "3m"] as const),
    screen: arr(o.screen, 40).map((e): ScreenEntry => ({
      member: str(e.member, 40), state: e.state === "ok" ? "ok" : "off", today: num(e.today), mac: num(e.mac), phone: num(e.phone), avg: num(e.avg),
      week: (Array.isArray(e.week) ? e.week.slice(0, 7) : []).map(num), at: typeof e.at === "string" ? e.at.slice(0, 40) : null,
    })),
    days: (Array.isArray(o.days) ? o.days.slice(0, 7) : []).map((d) => str(d, 10)),
    mine: { tz: str(mine.tz, 64) || "Asia/Dubai", on: mine.on !== false, months: arr(mine.months, 12).map((m) => ({ month: str(m.month, 7), label: str(m.label, 30), amount: num(m.amount), skipped: m.skipped === true })) },
    due: due && typeof due.month === "string" ? { month: str(due.month, 7), label: str(due.label, 20) } : null,
    loaded: o.loaded === true,
  };
}

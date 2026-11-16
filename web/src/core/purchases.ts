// Purchases (PS 1.65): the numbers behind the finance screen, from the person's saved receipts. Pure (no vault, no DOM, no clock
// unless handed one), tested in tests/purchases.test.ts. Everything is added up in minor units, in ONE currency (the one most
// receipts use, or the person's choice); a receipt in another currency stays in the list and the table but is left out of the sums,
// and the screen says how many were left out.
import type { Receipt } from "./receipts.ts";

export interface Rc { id: string; r: Receipt }

/** The month of a day, "2026-11". */
export const monthOf = (ymd: string) => ymd.slice(0, 7);
const prevMonth = (ym: string) => { const [y, m] = ym.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

/** Newest first: by the day on the receipt, then by when it was saved. */
export const newestFirst = (a: Rc, b: Rc) => (a.r.date < b.r.date ? 1 : a.r.date > b.r.date ? -1 : a.r.at < b.r.at ? 1 : a.r.at > b.r.at ? -1 : a.id < b.id ? 1 : -1);

/** The currency the sums use: the preferred one when any receipt has it, else the one most receipts have. */
export function mainCurrency(list: Rc[], prefer: string): string {
  const n = new Map<string, number>();
  for (const x of list) n.set(x.r.cur, (n.get(x.r.cur) ?? 0) + 1);
  if (n.has(prefer)) return prefer;
  let best = prefer, bn = 0;
  for (const [c, k] of n) if (k > bn) { best = c; bn = k; }
  return best;
}

export const recent = (list: Rc[], n = 6): Rc[] => [...list].sort(newestFirst).slice(0, n);

/** The name of an item as the same thing each time: lower case, no digits or sizes or punctuation, one space. */
export function itemKey(name: string): string {
  return name.toLowerCase().replace(/\d+([.,]\d+)?\s*(ml|l|kg|g|gr|cl|pcs|pc|ც|ლ|კგ|გრ|მლ)?/giu, " ").replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

export interface TopItem { key: string; name: string; times: number; qty: number; spent: number }
/** The items bought most often: how many receipts they are on, how many in all, how much they cost in all. */
export function topItems(list: Rc[], cur: string, n = 8): TopItem[] {
  const m = new Map<string, TopItem & { names: Map<string, number> }>();
  for (const { r } of list) {
    if (r.cur !== cur) continue;
    const seenHere = new Set<string>();
    for (const it of r.items) {
      const key = itemKey(it.n);
      if (key.length < 2) continue;
      const e = m.get(key) ?? { key, name: it.n, times: 0, qty: 0, spent: 0, names: new Map() };
      if (!seenHere.has(key)) { e.times++; seenHere.add(key); }
      e.qty += it.q ?? 1;
      e.spent += it.p;
      e.names.set(it.n, (e.names.get(it.n) ?? 0) + 1);
      m.set(key, e);
    }
  }
  const out = [...m.values()].map((e) => {
    let name = e.name, best = 0;
    for (const [k, c] of e.names) if (c > best) { best = c; name = k; }
    return { key: e.key, name, times: e.times, qty: Math.round(e.qty * 1000) / 1000, spent: e.spent };
  });
  return out.sort((a, b) => b.times - a.times || b.spent - a.spent || (a.key < b.key ? -1 : 1)).slice(0, n);
}

export interface MonthCompare { month: string; prev: string; spent: number; before: number; diff: number; pct: number | null }
/** Spent this month and last month, and the difference. `today` is YYYY-MM-DD in the person's zone. pct is null when last month was nothing. */
export function monthCompare(list: Rc[], cur: string, today: string): MonthCompare {
  const month = monthOf(today), prev = prevMonth(month);
  let spent = 0, before = 0;
  for (const { r } of list) {
    if (r.cur !== cur) continue;
    const m = monthOf(r.date);
    if (m === month) spent += r.total; else if (m === prev) before += r.total;
  }
  return { month, prev, spent, before, diff: spent - before, pct: before > 0 ? Math.round(((spent - before) / before) * 1000) / 10 : null };
}

export interface Slice { label: string; value: number }
/** Spending by shop, biggest first; the small ones past `n` are one "Other". An unnamed shop is "No shop name". */
export function byShop(list: Rc[], cur: string, n = 6, noName = "No shop name", other = "Other"): Slice[] {
  const m = new Map<string, number>();
  for (const { r } of list) if (r.cur === cur) { const k = r.shop || noName; m.set(k, (m.get(k) ?? 0) + r.total); }
  const all = [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || (a.label < b.label ? -1 : 1));
  if (all.length <= n) return all;
  return [...all.slice(0, n - 1), { label: other, value: all.slice(n - 1).reduce((a, x) => a + x.value, 0) }];
}

/** Spending by month for the last `n` months ending with this one, oldest first, empty months included (so the chart has no gaps). */
export function byMonth(list: Rc[], cur: string, today: string, n = 12): Slice[] {
  const months: string[] = [];
  let m = monthOf(today);
  for (let i = 0; i < n; i++) { months.unshift(m); m = prevMonth(m); }
  const sums = new Map(months.map((x) => [x, 0]));
  for (const { r } of list) if (r.cur === cur) { const k = monthOf(r.date); if (sums.has(k)) sums.set(k, sums.get(k)! + r.total); }
  return months.map((label) => ({ label, value: sums.get(label)! }));
}

/** How many receipts are in another currency than the sums use. */
export const leftOut = (list: Rc[], cur: string) => list.filter((x) => x.r.cur !== cur).length;

// ---------- the table: receipts or items, sorted, filtered, searched ----------
export type TableMode = "receipts" | "items";
export type SortKey = "date" | "shop" | "name" | "amount" | "qty";
export interface Row { id: string; date: string; shop: string; name: string; qty: number | null; amount: number; cur: string; count: number }
export interface TableQuery { mode: TableMode; sort: SortKey; dir: "asc" | "desc"; text: string; shop: string; from: string; to: string }
export const defaultQuery = (): TableQuery => ({ mode: "receipts", sort: "date", dir: "desc", text: "", shop: "", from: "", to: "" });

/** The rows to show. Search matches the shop, the date and any item name (receipts) or the item and shop (items). Case does not matter. */
export function tableRows(list: Rc[], q: TableQuery): Row[] {
  const text = q.text.trim().toLowerCase();
  const rows: Row[] = [];
  for (const { id, r } of list) {
    if (q.shop && (r.shop || "") !== q.shop) continue;
    if (q.from && r.date < q.from) continue;
    if (q.to && r.date > q.to) continue;
    if (q.mode === "receipts") {
      if (text && !(r.shop.toLowerCase().includes(text) || r.date.includes(text) || r.items.some((i) => i.n.toLowerCase().includes(text)))) continue;
      rows.push({ id, date: r.date, shop: r.shop, name: "", qty: null, amount: r.total, cur: r.cur, count: r.items.length });
    } else {
      for (const i of r.items) {
        if (text && !(i.n.toLowerCase().includes(text) || r.shop.toLowerCase().includes(text))) continue;
        rows.push({ id, date: r.date, shop: r.shop, name: i.n, qty: i.q ?? 1, amount: i.p, cur: r.cur, count: 1 });
      }
    }
  }
  const s = q.dir === "asc" ? 1 : -1;
  const val = (x: Row) => (q.sort === "date" ? x.date : q.sort === "shop" ? x.shop.toLowerCase() : q.sort === "name" ? x.name.toLowerCase() : q.sort === "qty" ? (x.qty ?? 0) : x.amount);
  rows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * s || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (a.id < b.id ? -1 : 1); });
  return rows;
}

/** The shops to offer in the filter, each once, A to Z. */
export const shopsOf = (list: Rc[]): string[] => [...new Set(list.map((x) => x.r.shop).filter(Boolean))].sort((a, b) => a.localeCompare(b));

/** Clicking a column heading: the same column flips, a new one starts at its natural direction (dates and money big first, words A to Z). */
export function clickSort(q: TableQuery, key: SortKey): TableQuery {
  if (q.sort === key) return { ...q, dir: q.dir === "asc" ? "desc" : "asc" };
  return { ...q, sort: key, dir: key === "shop" || key === "name" ? "asc" : "desc" };
}

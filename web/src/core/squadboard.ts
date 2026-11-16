// G Squad Leaderboard and Screen time (V1.40): the rules, the cards each member shares, and what the pop-up shows.
// Pure (no vault, no hub, no screen) so the main page, the live hub check and the tests run the same code.
//
// Each member shares at most three small cards, each sealed with the squad key through the opt-out gate
// (core/squadshare.ts sealForSquad), so a piece switched off is never sealed or sent:
//   money   piece "money"   { m: { "2026-10": 12500, ... } }   what they answered for each month, last 12 months
//   tasks   piece "tasks"   { m: { "2026-11": 14 }, d: { "2026-11-07": 3 } }   shared tasks done per month and per day
//   screen  piece "screen"  { d: { "2026-11-07": [macSecs, phoneSecs] } }   the daily total per device, last 7 days,
//                           never an app, never an app name (1Password and Signal are dropped before anything is added)
import type { Doc, ScreenTimeDay, Settings, Todo } from "./model.ts";
import { belongsTo, daysOf } from "./screentime.ts";
import { copyFp, V } from "./squadcrypto.ts";
import { sealForSquad, shareOn, taskShared, type SharePiece, type ShareOpts, type SquadKeyRef } from "./squadshare.ts";
import { validTz, wall } from "./tz.ts";
import { resetDayOf, resetMinOf } from "./resetday.ts";

// =====================================================================================================================
// THE ONE SETTING (still open with the developer, 7 Nov 2026). Change these two words, nothing else:
//   money: "revenue"  the prompt asks for everything that came in, before costs
//          "profit"   the prompt asks for what was left after costs (a loss can be typed as a minus amount)
//   show:  "rank"     the squad sees only the order (1st, 2nd, ...); each person sees their own exact amount
//          "exact"    everyone sees everyone's amounts, with bars
// Both are read on the main page when the Leaderboard is built, so the Tab list never even receives another
// person's amount in "rank". (Each member's PS still opens the sealed amounts to work out the order: see the
// report. Hiding them from the members' own PS too would need bands instead of amounts.)
// =====================================================================================================================
export const BOARD_RULES: { money: "revenue" | "profit"; show: "rank" | "exact"; currency: string } = {
  money: "revenue",
  show: "rank",
  currency: "USD",   // one currency for the whole squad, so amounts can be compared
};

export type BoardKind = "money" | "tasks" | "screen";
export const BOARD_KINDS: BoardKind[] = ["money", "tasks", "screen"];
export const PIECE_OF: Record<BoardKind, SharePiece> = { money: "money", tasks: "tasks", screen: "screen" };
/** The default time zone for when a month starts and ends (the developer: GST, Dubai). Each person can change theirs. */
export const DEFAULT_MONEY_TZ = "Asia/Dubai";
export const boardAad = (squad: string, member: string, kind: BoardKind, gen: number) => `${V}:board:${squad}:${member}:${kind}:${gen}`;

// ---------- dates ----------
const pad = (n: number) => String(n).padStart(2, "0");
export function monthKey(ts: number, tz: string): string { const w = wall(ts, tz); return `${w.y}-${pad(w.mo)}`; }
export function dayKey(ts: number, tz: string): string { const w = wall(ts, tz); return `${w.y}-${pad(w.mo)}-${pad(w.d)}`; }
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${pad((i % 12 + 12) % 12 + 1)}`;
}
export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/, DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** "October 2026". */
export function monthLabel(key: string, year = true): string {
  const [y, m] = key.split("-").map(Number);
  const name = new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return year ? `${name} ${y}` : name;
}

// ---------- your money answers (settings.squadMoney, your own vault, synced to your devices) ----------
export interface SquadMoney {
  tz?: string;                                   // where a month starts and ends for you; missing = DEFAULT_MONEY_TZ
  m?: Record<string, number>;                    // what you added per month, whole units of BOARD_RULES.currency
  skip?: string[];                               // months you chose Skip this month for
}   // V1.43: no snooze any more (there is no pop-up to snooze); an old stored snooze is dropped by cleanMoney
const MAX_AMOUNT = 1e10;
export function cleanAmount(v: unknown, rules = BOARD_RULES): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[,\s$€£₾]/g, "")) : NaN;
  if (!Number.isFinite(n) || Math.abs(n) > MAX_AMOUNT) return null;
  if (n < 0 && rules.money !== "profit") return null;
  return Math.round(n);
}
export function cleanMoney(v: unknown): SquadMoney {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: SquadMoney = {};
  if (typeof o.tz === "string" && validTz(o.tz)) out.tz = o.tz;
  const m: Record<string, number> = {};
  if (o.m && typeof o.m === "object") for (const [k, x] of Object.entries(o.m as Record<string, unknown>)) {
    if (!MONTH.test(k) || typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) > MAX_AMOUNT) continue;
    m[k] = Math.round(x);
  }
  const keep = Object.keys(m).sort().slice(-24);
  if (keep.length) out.m = Object.fromEntries(keep.map((k) => [k, m[k]]));
  if (Array.isArray(o.skip)) { const s = o.skip.filter((x): x is string => typeof x === "string" && MONTH.test(x)).sort().slice(-24); if (s.length) out.skip = s; }
  return out;
}
export const moneyTz = (m: SquadMoney) => m.tz && validTz(m.tz) ? m.tz : DEFAULT_MONEY_TZ;

/** V1.43 (the developer, 8 Nov 2026: "I don't want it to pop up for everyone. Sometimes people take a few days"): no pop-up.
 *  The month that just ended, while you have not added it: from the 1st at 00:00 in your zone, for the whole month,
 *  so you can add it any day. The Leaderboard shows "Add what you made in October" and a quiet dot; nothing pops up,
 *  rings or notifies. Null once added or skipped (and from the next 1st it is the next month's turn). */
export function moneyDue(money: SquadMoney, now: number): string | null {
  const month = addMonths(monthKey(now, moneyTz(money)), -1);
  if (money.m && month in money.m) return null;
  if (money.skip?.includes(month)) return null;
  return month;
}
/** Months you may add or fix: any month that has ended, back 12 months (what your card carries). Never this month
 *  or one ahead (it is not over yet). */
export function moneyMonthOk(month: string, money: SquadMoney, now: number): boolean {
  if (!MONTH.test(month)) return false;
  const cur = monthKey(now, moneyTz(money));
  return month < cur && month >= addMonths(cur, -12);
}
/** What you made in a month: saved (also late, or to fix a past month), any skip for it cleared. */
export function answerMoney(money: SquadMoney, month: string, amount: number): SquadMoney {
  const m = { ...(money.m || {}), [month]: amount };
  return cleanMoney({ ...money, m, skip: (money.skip || []).filter((x) => x !== month) });
}
export function skipMoney(money: SquadMoney, month: string): SquadMoney {
  const m = { ...(money.m || {}) };
  delete m[month];
  return cleanMoney({ ...money, m, skip: [...(money.skip || []).filter((x) => x !== month), month] });
}

// ---------- the cards ----------
export interface MoneyCard { m: Record<string, number> }
export interface TasksCard { m: Record<string, number>; d: Record<string, number> }
export interface ScreenCard { d: Record<string, [number, number]> }
export type BoardCard = MoneyCard | TasksCard | ScreenCard;

export function moneyCard(money: SquadMoney, now: number): MoneyCard {
  const from = addMonths(monthKey(now, moneyTz(money)), -12);
  return { m: Object.fromEntries(Object.entries(money.m || {}).filter(([k]) => k >= from).sort()) };
}
/** Your shared tasks done, counted per month (12) and per day (7) in your G Squad time zone. Only tasks you marked
 *  Share with G Squad count (V1.43); an anonymised one does (only the count travels). Repeating tasks are not counted (a reset
 *  unticks them, so there is no record of each round). */
export function tasksCard(todos: Doc<Todo>[], now: number, tz: string, atMin = 0): TasksCard {
  // Days start at your reset time (core/resetday.ts): with 04:00, a 2am tick counts for the day (and month) before.
  const dayOf = (ts: number) => resetDayOf(ts, tz, atMin);
  const today = dayOf(now), fromM = addMonths(today.slice(0, 7), -11), fromD = addDaysKey(today, -6);
  const m: Record<string, number> = {}, d: Record<string, number> = {};
  for (const doc of todos) {
    const t = doc.data;
    if (doc.kind !== "todo" || !t || !t.done || !t.doneAt || !taskShared(t) || t.type === "daily" || (t as { example?: boolean }).example === true) continue;
    const at = Date.parse(t.doneAt);
    if (!Number.isFinite(at) || at > now + 60_000) continue;
    const dk = dayOf(at), mk = dk.slice(0, 7);
    if (mk >= fromM) m[mk] = (m[mk] || 0) + 1;
    if (dk >= fromD && dk <= today) d[dk] = (d[dk] || 0) + 1;
  }
  return { m: sortObj(m), d: sortObj(d) };
}
/** Your screen time, the daily total only, per device, last 7 days. App names and ids never leave this function. */
export function screenCard(docs: Doc<ScreenTimeDay>[], now: number, tz: string): ScreenCard {
  const today = dayKey(now, tz), from = addDaysKey(today, -6);
  const out: Record<string, [number, number]> = {};
  (["mac", "gos"] as const).forEach((device, i) => {
    const keep = belongsTo(device);   // never 1Password or Signal, never the other device's apps
    for (const [day, doc] of daysOf(docs, device)) {
      if (!DAY.test(day) || day < from || day > today) continue;
      const secs = Math.round(doc.data.apps.filter(keep).reduce((n, a) => n + (Number.isFinite(a.secs) && a.secs > 0 ? a.secs : 0), 0));
      const row = out[day] ?? [0, 0];
      row[i] = Math.min(86_400, secs);
      out[day] = row;
    }
  });
  return { d: sortObj(out) };
}
function sortObj<T>(o: Record<string, T>): Record<string, T> { return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))); }

/** A card opened from the hub, checked field by field (anything odd is dropped). */
export function cleanCard(kind: BoardKind, v: unknown): BoardCard | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const nums = (x: unknown, key: RegExp, lo: number, hi: number) => {
    const r: Record<string, number> = {};
    if (x && typeof x === "object") for (const [k, n] of Object.entries(x as Record<string, unknown>).slice(0, 40)) if (key.test(k) && typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi) r[k] = Math.round(n);
    return r;
  };
  if (kind === "money") return { m: nums(o.m, MONTH, -MAX_AMOUNT, MAX_AMOUNT) };
  if (kind === "tasks") return { m: nums(o.m, MONTH, 0, 1e6), d: nums(o.d, DAY, 0, 1e5) };
  const d: Record<string, [number, number]> = {};
  if (o.d && typeof o.d === "object") for (const [k, x] of Object.entries(o.d as Record<string, unknown>).slice(0, 14)) {
    if (!DAY.test(k) || !Array.isArray(x)) continue;
    const a = Number(x[0]), b = Number(x[1]);
    if (Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0 && a <= 86_400 && b <= 86_400) d[k] = [Math.round(a), Math.round(b)];
  }
  return { d };
}

// ---------- what to send: change only, through the gate ----------
export interface BoardRow { kind: BoardKind; ct: string; gen: number; fp: string }
export async function planBoardSync(input: {
  settings: Pick<Settings, "squadShare" | "squadMoney" | "autoResetAt"> | null | undefined; todos: Doc<Todo>[]; screen: Doc<ScreenTimeDay>[];
  squad: string; member: string; secret: string; key: SquadKeyRef; have: Map<string, string>; now: number; deviceTz: string;
  only?: BoardKind[];
}): Promise<{ put: BoardRow[]; del: BoardKind[] }> {
  const opts: ShareOpts | undefined = input.settings?.squadShare;
  const money = cleanMoney(input.settings?.squadMoney);
  const put: BoardRow[] = [], del: BoardKind[] = [];
  for (const kind of input.only ?? BOARD_KINDS) {
    if (!shareOn(opts, PIECE_OF[kind])) { if (input.have.has(kind)) del.push(kind); continue; }
    const card: BoardCard = kind === "money" ? moneyCard(money, input.now)
      : kind === "tasks" ? tasksCard(input.todos, input.now, moneyTz(money), resetMinOf(input.settings))
      : screenCard(input.screen, input.now, input.deviceTz);
    const fp = await copyFp(input.secret, { board: kind, card }, input.key.gen);
    if (input.have.get(kind) === fp) continue;
    const s = await sealForSquad(opts, PIECE_OF[kind], input.key, card, boardAad(input.squad, input.member, kind, input.key.gen));
    if (!s) continue;
    put.push({ kind, ct: s.ct, gen: s.gen, fp });
  }
  return { put, del };
}

// ---------- what the pop-up shows (built on the main page; the Tab list gets only this) ----------
export type MoneyPeriod = "1" | "3" | "6";
export type TasksPeriod = "7d" | "month" | "3m";
export const MONEY_PERIODS: { id: MoneyPeriod; label: string }[] = [{ id: "1", label: "Last month" }, { id: "3", label: "3 months" }, { id: "6", label: "6 months" }];
export const TASKS_PERIODS: { id: TasksPeriod; label: string }[] = [{ id: "7d", label: "7 days" }, { id: "month", label: "This month" }, { id: "3m", label: "3 months" }];
/** One member on a board. off: not shared (switched off, or nothing from them yet); none: shared, no answer in
 *  that stretch. amount is there only for you, or for everyone when the rule is "exact". */
export interface BoardEntry { member: string; state: "ok" | "off" | "none"; rank: number | null; n?: number; amount?: number; months?: number }
export interface ScreenEntry { member: string; state: "ok" | "off"; today: number | null; mac: number | null; phone: number | null; avg: number | null; week: (number | null)[]; at: string | null }
export interface BoardView {
  rules: { money: "revenue" | "profit"; show: "rank" | "exact"; currency: string };
  money: Record<MoneyPeriod, BoardEntry[]>;
  tasks: Record<TasksPeriod, BoardEntry[]>;
  screen: ScreenEntry[];
  days: string[];                         // the 7 days of the Screen time week, oldest first (your dates)
  mine: { tz: string; on: boolean; months: { month: string; label: string; amount: number | null; skipped: boolean }[] };
  due: { month: string; label: string } | null;   // V1.43: the month that just ended, not added yet (the entry and the dot)
  loaded: boolean;
  past?: PastMonth[];                     // PS 1.64 Past boards (core/squadpast.ts), newest first; none until the owner adds them
}
import type { PastMonth } from "./squadpast.ts";
export interface HeldCard { kind: BoardKind; card: BoardCard; at: string }

/** Standard ranks: equal values share a place (1, 1, 3). */
function ranked(list: { member: string; v: number }[]): Map<string, number> {
  const s = [...list].sort((a, b) => b.v - a.v);
  const out = new Map<string, number>();
  s.forEach((x, i) => out.set(x.member, i > 0 && s[i - 1].v === x.v ? out.get(s[i - 1].member)! : i + 1));
  return out;
}

export function buildBoard(input: {
  members: { id: string; me: boolean }[]; cards: Map<string, Map<BoardKind, HeldCard>>; myMoney: SquadMoney; myShare: ShareOpts | null | undefined;
  now: number; deviceTz: string; loaded: boolean; rules?: typeof BOARD_RULES;
}): BoardView {
  const rules = input.rules ?? BOARD_RULES;
  const tz = moneyTz(input.myMoney);
  const cur = monthKey(input.now, tz), today = dayKey(input.now, tz);
  const card = <T extends BoardCard>(m: string, k: BoardKind) => input.cards.get(m)?.get(k) as (HeldCard & { card: T }) | undefined;
  const money = {} as Record<MoneyPeriod, BoardEntry[]>;
  for (const p of MONEY_PERIODS) {
    const months = Array.from({ length: Number(p.id) }, (_, i) => addMonths(cur, -1 - i));
    const vals: { member: string; v: number; months: number }[] = [];
    const rows: BoardEntry[] = input.members.map((mem) => {
      const c = card<MoneyCard>(mem.id, "money");
      if (!c) return { member: mem.id, state: "off", rank: null };
      const got = months.filter((k) => k in c.card.m);
      if (!got.length) return { member: mem.id, state: "none", rank: null };
      const v = got.reduce((n, k) => n + c.card.m[k], 0);
      vals.push({ member: mem.id, v, months: got.length });
      return { member: mem.id, state: "ok", rank: null, months: got.length, ...(rules.show === "exact" || mem.me ? { amount: v } : {}) };
    });
    const r = ranked(vals);
    money[p.id] = sortRows(rows.map((x) => ({ ...x, rank: r.get(x.member) ?? null })));
  }
  const tasks = {} as Record<TasksPeriod, BoardEntry[]>;
  const week = Array.from({ length: 7 }, (_, i) => addDaysKey(today, i - 6));
  for (const p of TASKS_PERIODS) {
    const vals: { member: string; v: number }[] = [];
    const rows: BoardEntry[] = input.members.map((mem) => {
      const c = card<TasksCard>(mem.id, "tasks");
      if (!c) return { member: mem.id, state: "off", rank: null };
      const n = p.id === "7d" ? week.reduce((s, k) => s + (c.card.d[k] || 0), 0)
        : p.id === "month" ? c.card.m[cur] || 0
        : [0, -1, -2].reduce((s, i) => s + (c.card.m[addMonths(cur, i)] || 0), 0);
      vals.push({ member: mem.id, v: n });
      return { member: mem.id, state: "ok", rank: null, n };
    });
    const r = ranked(vals);
    tasks[p.id] = sortRows(rows.map((x) => ({ ...x, rank: r.get(x.member) ?? null })));
  }
  const screen: ScreenEntry[] = input.members.map((mem): ScreenEntry => {
    const c = card<ScreenCard>(mem.id, "screen");
    if (!c) return { member: mem.id, state: "off", today: null, mac: null, phone: null, avg: null, week: [], at: null };
    const tot = (k: string) => (c.card.d[k] ? c.card.d[k][0] + c.card.d[k][1] : null);
    const t = c.card.d[today];
    const past = week.slice(0, 6).map(tot).filter((x): x is number => x !== null);
    return { member: mem.id, state: "ok", today: t ? t[0] + t[1] : null, mac: t ? t[0] : null, phone: t ? t[1] : null,
      avg: past.length ? Math.round(past.reduce((a, b) => a + b, 0) / past.length) : null, week: week.map(tot), at: c.at };
  }).sort((a, b) => Number(b.state === "ok") - Number(a.state === "ok") || (b.today ?? -1) - (a.today ?? -1));
  const due = shareOn(input.myShare, "money") ? moneyDue(input.myMoney, input.now) : null;   // Money off: nothing shown
  return {
    rules: { ...rules }, money, tasks, screen, days: week,
    mine: { tz, on: shareOn(input.myShare, "money"), months: Array.from({ length: 6 }, (_, i) => addMonths(cur, -1 - i)).map((k) => ({
      month: k, label: monthLabel(k), amount: input.myMoney.m && k in input.myMoney.m ? input.myMoney.m[k] : null, skipped: !!input.myMoney.skip?.includes(k) })) },
    due: due ? { month: due, label: monthLabel(due, false) } : null,
    loaded: input.loaded,
  };
}
const ORDER = { ok: 0, none: 1, off: 2 } as const;
function sortRows(rows: BoardEntry[]): BoardEntry[] {
  return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.rank ?? 99) - (b.rank ?? 99));
}

// ---------- the Tab list's requests (checked again on the main page) ----------
export type BoardOp =
  | { op: "money"; month: string; amount: number }
  | { op: "skip"; month: string }
  | { op: "tz"; tz: string };
export function cleanBoardOp(v: unknown): BoardOp | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const month = typeof o.month === "string" && MONTH.test(o.month) ? o.month : null;
  switch (o.op) {
    case "money": { const a = cleanAmount(o.amount); return month && a !== null ? { op: "money", month, amount: a } : null; }
    case "skip": return month ? { op: "skip", month } : null;
    case "tz": return typeof o.tz === "string" && o.tz.length <= 64 && validTz(o.tz) ? { op: "tz", tz: o.tz } : null;
  }
  return null;
}

/** "$12,400" (whole units). */
export function fmtMoney(n: number, currency = BOARD_RULES.currency): string {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n); } catch { return `${Math.round(n).toLocaleString("en-US")} ${currency}`; }
}
export function placeLabel(rank: number): string {
  const s = rank % 100 >= 11 && rank % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][rank % 10] ?? "th";
  return `${rank}${rank % 10 > 3 ? "th" : s}`;
}

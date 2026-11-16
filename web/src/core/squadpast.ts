// G Squad Past boards (PS 1.64), the developer 16 Nov 2026: the monthly leaderboards the group posted in its chat before PS
// (December 2025 to July 2026), kept read only in the Leaderboard. Per month: a ranked list (names, an amount in USD,
// sometimes a note such as "joint" or "exempt"), then the Gulag list (names, some with an amount) and one free text line.
//
// Where it lives: one record per month on the G Squad hub (board_past, migration board_002_past.sql), sealed with the
// squad key like every other card, written ONLY by the squad's owner (the hub checks), and only when it changed (a
// fingerprint). The owner's PS publishes what is in the owner's own vault (records "sqpast"); the manager puts months
// there with scripts/gsquad-past.ts (sealed to the owner's vault, the same way release notes travel), only after the developer
// approved the exact entries. PS 1.64 ships with none. This file is pure: the shape, its checks, the sync plan.
import * as S from "./squadcrypto.ts";
import { currentKey, keyFor, type SquadRec } from "./squadrec.ts";

export interface PastEntry {
  place: number | null;           // 1, 2, 3 ... (null: listed without a place, eg "exempt", or in the Gulag)
  names: string[];                // one name, or two or more for a joint place
  usd: number | null;             // the amount in US dollars (null: none given)
  amount?: string;                // what to show instead of a USD amount, eg "400 EUR" or "Awaiting total"
  note?: string;                  // a short note, eg "joint" or "Exempt due to unforeseen circumstances"
}
export interface PastMonth {
  month: string;                  // "2025-12"
  title?: string;                 // what was counted, eg "Revenue in USD" (shown under the month)
  ranked: PastEntry[];            // places follow the order when not given (1, 2, 3 ...)
  notes?: PastEntry[];            // listed without a place, eg "awaiting total", "exempt"
  lineNote?: string;              // a word on the cut line, eg "First month the line was $2K"
  gulagTitle?: string;            // default "Gulag"
  gulag: PastEntry[];
  line?: string;                  // one free text line under the Gulag, eg "The rest didn't post" (the file may call it gulagLine)
}
export const MAX_MONTHS = 36, MAX_ENTRIES = 40;
const MONTH = /^(20\d\d)-(0[1-9]|1[0-2])$/;
const DASHES = /[\u2012\u2013\u2014\u2015\u2212]/g;   // long dashes never show in PS: a plain hyphen instead
const HAS_DASH = /[\u2012\u2013\u2014\u2015\u2212]/;

/** One line of text: no control characters, no long dashes, no HTML brackets, cut to max. */
export function pastText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(DASHES, "-").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e9 ? Math.round(v * 100) / 100 : null);
/** One person (or a joint place). Takes "names" or "name"; the amount as "usd", or as "amount" (a number is US dollars
 *  unless "currency" names another, then it shows as eg "400 EUR"; words show as they are). */
function cleanEntry(v: unknown, place: number | null): PastEntry | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  const raw = Array.isArray(o.names) ? o.names : typeof o.name === "string" ? [o.name] : [];
  const names = raw.map((n) => pastText(n, 40)).filter(Boolean).slice(0, 4);
  if (!names.length) return null;
  const at = place !== null && Number.isInteger(o.place) && (o.place as number) >= 1 && (o.place as number) <= 99 ? o.place as number : place;
  const cur = typeof o.currency === "string" && /^[A-Za-z]{3}$/.test(o.currency) ? o.currency.toUpperCase() : "USD";
  let usd = num(o.usd), amount = typeof o.amount === "string" ? pastText(o.amount, 40) : "";
  const n = num(o.amount);
  if (n !== null) { if (cur === "USD") usd = usd ?? n; else amount = `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${cur}`; }
  const note = pastText(o.note, 120);
  return { place: at, names, usd, ...(amount ? { amount } : {}), ...(note ? { note } : {}) };
}
const entries = (v: unknown, ranked: boolean) => (Array.isArray(v) ? v : []).slice(0, MAX_ENTRIES)
  .map((e, i) => cleanEntry(e, ranked ? i + 1 : null)).filter((e): e is PastEntry => !!e);
export function cleanPastMonth(v: unknown): PastMonth | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || typeof o.month !== "string" || !MONTH.test(o.month)) return null;
  const ranked = entries(o.ranked, true), notes = entries(o.notes, false), gulag = entries(o.gulag, false);
  const title = pastText(o.title, 120), gulagTitle = pastText(o.gulagTitle, 60), line = pastText(o.line ?? o.gulagLine, 200), lineNote = pastText(o.lineNote, 120);
  if (!ranked.length && !gulag.length && !notes.length && !line) return null;
  return { month: o.month, ...(title ? { title } : {}), ranked, ...(notes.length ? { notes } : {}), ...(lineNote ? { lineNote } : {}), ...(gulagTitle ? { gulagTitle } : {}), gulag, ...(line ? { line } : {}) };
}
/** A file of months: a list, or { "months": [...] }. Newest first, one per month (the later one in the file wins). */
export function cleanPastMonths(v: unknown): PastMonth[] {
  const list = Array.isArray(v) ? v : v && typeof v === "object" && Array.isArray((v as { months?: unknown }).months) ? (v as { months: unknown[] }).months : [];
  const by = new Map<string, PastMonth>();
  for (const x of list.slice(0, MAX_MONTHS * 2)) { const m = cleanPastMonth(x); if (m) by.set(m.month, m); }
  return [...by.values()].sort((a, b) => b.month.localeCompare(a.month)).slice(0, MAX_MONTHS);
}
const MONTH_KEYS = new Set(["month", "title", "ranked", "notes", "lineNote", "gulagTitle", "gulag", "line", "gulagLine"]);
const ENTRY_KEYS = new Set(["name", "names", "place", "usd", "amount", "currency", "note"]);
/** What in a file would be changed or dropped by the checks (the manager's script refuses such a file). */
export function pastProblems(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v && typeof v === "object" && Array.isArray((v as { months?: unknown }).months) ? (v as { months: unknown[] }).months : null;
  if (!list) return ["the file is not a list of months (or { \"months\": [...] })"];
  const out: string[] = [];
  const json = JSON.stringify(v);
  if (HAS_DASH.test(json)) out.push("a long dash (use a plain hyphen)");
  if (/[<>]/.test(json)) out.push("< or > (no HTML)");
  const seen = new Set<string>();
  list.forEach((x, i) => {
    const o = x as Record<string, unknown> | null;
    const m = typeof o?.month === "string" ? o.month : `#${i + 1}`;
    if (!cleanPastMonth(x)) { out.push(`${m}: not a month this file format knows (month "YYYY-MM" and at least one entry)`); return; }
    if (seen.has(m)) out.push(`${m}: twice`);
    seen.add(m);
    for (const k of Object.keys(o!)) if (!MONTH_KEYS.has(k)) out.push(`${m}: "${k}" is not a field this format knows (its words would not show)`);
    for (const k of ["ranked", "notes", "gulag"] as const) {
      const list = Array.isArray(o?.[k]) ? o![k] as unknown[] : [];
      const kept = cleanPastMonth(x)![k]?.length ?? 0;
      if (list.length !== kept) out.push(`${m}: ${list.length - kept} ${k} entr${list.length - kept === 1 ? "y" : "ies"} without a name`);
      for (const e of list) for (const f of Object.keys((e ?? {}) as object)) if (!ENTRY_KEYS.has(f)) out.push(`${m}: "${f}" in ${k} is not a field this format knows`);
    }
  });
  if (list.length > MAX_MONTHS) out.push(`${list.length} months, ${MAX_MONTHS} at most`);
  return out;
}
/** "December 2025". */
export function monthLabel(month: string): string {
  const m = MONTH.exec(month);
  if (!m) return month;
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(m[2]) - 1]} ${m[1]}`;
}
/** "Dec 25" for the month chips. */
export function monthShort(month: string): string {
  const m = MONTH.exec(month);
  return m ? `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m[2]) - 1]} ${m[1].slice(2)}` : month;
}
/** "$3,470.66", "$950". */
export function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

// ---------- sealing, and what the owner's PS sends ----------
export const pastAad = (squad: string, month: string, gen: number) => `${S.V}:past:${squad}:${month}:${gen}`;
export interface PastRow { month: string; ct: string; gen: number; fp: string }
/** The owner's vault record: one month, or a month taken back (removed). */
export interface PastDoc { month: string; data?: PastMonth | null; removed?: boolean }
export function cleanPastDoc(v: unknown): PastDoc | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || typeof o.month !== "string" || !MONTH.test(o.month)) return null;
  if (o.removed === true) return { month: o.month, removed: true };
  const data = cleanPastMonth(o.data);
  return data && data.month === o.month ? { month: o.month, data } : null;
}
/** What the owner's PS sends: months whose sealed copy changed (fingerprint), and months taken back that the hub still
 *  has. A month the vault does not mention is left alone (never deleted because a vault looked empty). */
export async function planPastSync(rec: SquadRec, docs: PastDoc[], have: Map<string, string>): Promise<{ put: PastRow[]; del: string[] }> {
  const key = currentKey(rec);
  const put: PastRow[] = [], del: string[] = [];
  for (const d of docs) {
    if (d.removed) { if (have.has(d.month)) del.push(d.month); continue; }
    if (!d.data) continue;
    const fp = await S.copyFp(rec.secret, { past: d.data }, key.gen);
    if (have.get(d.month) === fp) continue;
    put.push({ month: d.month, ct: await S.seal(key.raw, d.data, pastAad(rec.squadId, d.month, key.gen)), gen: key.gen, fp });
  }
  return { put, del };
}
/** A month from the hub, opened (null: a key you do not hold, a swapped row, or not a month). */
export async function openPast(rec: SquadRec, month: string, ct: string, gen: number): Promise<PastMonth | null> {
  const raw = keyFor(rec, gen);
  if (!raw) return null;
  try { const m = cleanPastMonth(await S.open(raw, ct, pastAad(rec.squadId, month, gen))); return m && m.month === month ? m : null; } catch { return null; }
}

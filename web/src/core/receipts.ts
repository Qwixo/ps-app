// Receipts (PS 1.65): what one saved receipt is, and the rules around the feature. Pure (no vault, no DOM), tested in
// tests/purchases.test.ts. The reading of the text is core/receiptparse.ts, the sums and the table are core/purchases.ts.
//
// One owner only vault record per receipt (kind "rcpt"): sealed with the person's own vault key like every owner record, so the
// server holds ciphertext only. The photo is NOT inside it: it is a small compressed picture kept as its own sealed file (a vault
// blob, `ph` is its id) that is fetched only when that one receipt is opened. So the list, the sums and the Tab overlay never carry
// a picture. Change only sync: a receipt is written once when saved and again only when the person edits it.
import { amountToMinor, cleanCurrency, DEFAULT_CURRENCY, type RcItem } from "./receiptparse.ts";

export const RCPT_KIND = "rcpt";
export const RCPT_FEATURE = "receipts";

/** What is kept for one receipt. Money in minor units (1250 is 12.50). */
export interface Receipt {
  v: 1;
  shop: string;
  /** YYYY-MM-DD, the day on the receipt. */
  date: string;
  total: number;
  cur: string;
  items: RcItem[];
  /** The id of the sealed photo file, when there is one. */
  ph?: string;
  /** A word of the person's own. */
  note?: string;
  /** When it was saved (ISO). */
  at: string;
  src: "scan" | "typed";
}

export const RC = {
  shopMax: 60, nameMax: 80, noteMax: 200, itemsMax: 200,
  /** The photo is shrunk to this many pixels on its long side and this many bytes (a JPEG, about 80 KB), then sealed. */
  photoSide: 1100, photoBytes: 90_000,
} as const;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const money = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) < 1e11 ? v : null);

/** One saved receipt, cleaned (anything odd is forgotten, never trusted), or null when it is not a receipt. */
export function cleanReceipt(v: unknown): Receipt | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const total = money(o.total);
  if (total === null || typeof o.date !== "string" || !YMD.test(o.date)) return null;
  const items: RcItem[] = [];
  if (Array.isArray(o.items)) for (const it of o.items.slice(0, RC.itemsMax)) {
    if (!it || typeof it !== "object") continue;
    const x = it as Record<string, unknown>;
    const n = str(x.n, RC.nameMax), p = money(x.p);
    if (!n || p === null) continue;
    const q = typeof x.q === "number" && Number.isFinite(x.q) && x.q > 0 && x.q < 100000 ? x.q : undefined;
    items.push({ n, ...(q && q !== 1 ? { q } : {}), p });
  }
  const out: Receipt = {
    v: 1, shop: str(o.shop, RC.shopMax), date: o.date, total, cur: cleanCurrency(o.cur), items,
    at: typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)) ? o.at : new Date(0).toISOString(),
    src: o.src === "typed" ? "typed" : "scan",
  };
  if (typeof o.ph === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(o.ph)) out.ph = o.ph;
  const note = str(o.note, RC.noteMax);
  if (note) out.note = note;
  return out;
}

/** What the check screen holds while the person edits: every field as text, so half typed numbers are allowed. */
export interface RcDraft {
  shop: string; date: string; total: string; cur: string; note: string;
  items: { n: string; q: string; p: string }[];
}
export const minorText = (m: number): string => `${m < 0 ? "-" : ""}${Math.floor(Math.abs(m) / 100)}.${String(Math.abs(m) % 100).padStart(2, "0")}`;

export function draftOf(r: { shop: string; date: string; total: number | null; cur: string; items: RcItem[] }, note = ""): RcDraft {
  return { shop: r.shop, date: r.date, total: r.total === null ? "" : minorText(r.total), cur: r.cur, note, items: r.items.map((i) => ({ n: i.n, q: i.q ? String(i.q) : "", p: minorText(i.p) })) };
}

/** The money the person typed, in minor units, or null when it is not a number ("12", "12.5", "12,50", "1 234.50"). */
export function typedMoney(s: string): number | null {
  const t = String(s ?? "").trim();
  if (!t) return null;
  return amountToMinor(t, true);
}

export type DraftProblem = "date" | "total" | "item-price";
/** The receipt a draft makes, or what is wrong with it (the check screen points at it). */
export function receiptOfDraft(d: RcDraft, now: Date, src: Receipt["src"], ph?: string): { ok: Receipt } | { bad: DraftProblem[] } {
  const bad: DraftProblem[] = [];
  if (!YMD.test(d.date)) bad.push("date");
  const total = typedMoney(d.total);
  if (total === null) bad.push("total");
  const items: RcItem[] = [];
  for (const i of d.items) {
    if (!i.n.trim() && !i.p.trim()) continue;
    const p = typedMoney(i.p);
    if (p === null) { if (!bad.includes("item-price")) bad.push("item-price"); continue; }
    const q = i.q.trim() ? Number(i.q.replace(",", ".")) : undefined;
    items.push({ n: i.n, ...(q && Number.isFinite(q) && q > 0 && q !== 1 ? { q } : {}), p });
  }
  if (bad.length || total === null) return { bad };
  const r = cleanReceipt({ v: 1, shop: d.shop, date: d.date, total, cur: d.cur, items, note: d.note, at: now.toISOString(), src, ...(ph ? { ph } : {}) });
  return r ? { ok: r } : { bad: ["date"] };
}

/** The feature is on: the registry's answer (features.json, From the squad) and the person's own switch in Settings (missing is on). */
export const receiptsOn = (featureAnswer: boolean, settingsSwitch: unknown): boolean => featureAnswer && settingsSwitch !== false;

/** The currency a new receipt starts with: the person's choice in Settings, else lari. */
export const defaultCurrency = (settingsCur: unknown): string => cleanCurrency(settingsCur, DEFAULT_CURRENCY);

/** "12.50 GEL" for a screen: the number with its thousands spaced, the code after it. */
export function fmtMoney(minor: number, cur: string): string {
  const neg = minor < 0;
  const a = Math.abs(minor);
  const whole = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${neg ? "-" : ""}${whole}.${String(a % 100).padStart(2, "0")} ${cur}`;
}

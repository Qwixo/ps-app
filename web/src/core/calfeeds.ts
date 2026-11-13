// Each Meetings panel its own calendar (V1.55, the Edit mode overview). The developer, 12 Nov 2026: "If you have three different
// Google accounts then you can link three different meeting panels as well."
//
// - the developer (his Google calendars, through his own server): the usual panel shows his usual calendar, as before. Any other
//   Meetings panel can link one more calendar's secret iCal address. calendar-inbox keeps it in Supabase Vault under a
//   feed id (calendar_ics_feeds), reads it every minute like the usual one, and seals a copy to the developer only when an event
//   changed (Supabase egress rule: change only), as inbox source "calendar:<feed>" with account "feed:<feed>".
// - Anyone else (the public PS, the Mac's Calendar app): every event carries the account it comes from (ps-mac
//   LocalCalendar.swift "acct"), so a panel can show one account, or all of them (the usual).
// A panel's choice lives in the Edit mode layout record (core/tablayout.ts cfg.cal): "" the usual, "g:<feed>" one
// more Google calendar, "m:<account>" one account of the Mac's Calendar. Pure.
import type { CalEvent, CalendarSnap } from "./model";

const FEED = /^[a-z0-9]{4,24}$/;
export const okFeedId = (v: unknown): v is string => typeof v === "string" && FEED.test(v);
/** A new feed id for a panel's own Google calendar. */
export function newFeedId(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => (x % 36).toString(36)).join("");
}
/** The feed a calendar copy belongs to: "" for the usual one (any account that is not "feed:<id>"). */
export function feedOfAccount(account: unknown): string {
  const m = typeof account === "string" ? /^feed:([a-z0-9]{4,24})$/.exec(account) : null;
  return m ? m[1] : "";
}
export const isFeedSource = (src: unknown) => typeof src === "string" && /^calendar:[a-z0-9]{4,24}$/.test(src);

type Doc = { data: CalendarSnap };
const newest = <D extends Doc>(list: D[]) => [...list].sort((a, b) => (b.data.at || "").localeCompare(a.data.at || ""))[0] ?? null;
/** The usual calendar copy (never one linked to a single panel). */
export function mainCalendar<D extends Doc>(list: D[]): D | null {
  return newest(list.filter((d) => feedOfAccount(d.data.account) === ""));
}
/** The copy of the calendar linked to one panel, or null until it has arrived. */
export function feedCalendar<D extends Doc>(list: D[], feed: string): D | null {
  return okFeedId(feed) ? newest(list.filter((d) => feedOfAccount(d.data.account) === feed)) : null;
}

/** What a panel's setting (cfg.cal) names. */
export type PanelCal = { kind: "usual" } | { kind: "google"; feed: string } | { kind: "mac"; account: string };
export function panelCal(v: unknown): PanelCal {
  if (typeof v === "string" && v.startsWith("g:") && okFeedId(v.slice(2))) return { kind: "google", feed: v.slice(2) };
  if (typeof v === "string" && v.startsWith("m:") && v.length > 2 && v.length <= 82) return { kind: "mac", account: v.slice(2) };
  return { kind: "usual" };
}
/** The calendar copy a panel shows: the usual, its own Google feed, or the usual one cut to one Mac account. */
export function calendarFor<D extends Doc>(list: D[], cal: PanelCal): { doc: D | null; events: CalEvent[] } {
  if (cal.kind === "google") { const d = feedCalendar(list, cal.feed); return { doc: d, events: d?.data.events ?? [] }; }
  const d = mainCalendar(list);
  const ev = d?.data.events ?? [];
  return { doc: d, events: cal.kind === "mac" ? ev.filter((e) => e.acct === cal.account) : ev };
}
/** The accounts of the Mac's Calendar seen in the copy (for a panel's picker), in a steady order. */
export function macAccounts(snap: CalendarSnap | null | undefined): string[] {
  const out = new Set<string>();
  for (const e of snap?.events ?? []) if (typeof e.acct === "string" && e.acct) out.add(e.acct);
  return [...out].sort((a, b) => a.localeCompare(b));
}

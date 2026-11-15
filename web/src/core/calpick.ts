// Which calendars PS works with (the developer's friend, 15 Nov 2026: "some of those entries are real events and some are routines,
// not meetings. I keep them separated by calendar"). Everyone but the developer gets their events from the Mac's Calendar app
// (core/localcal.ts), which can have several calendars. Each calendar gets one choice:
//   "meeting"  shown, and counts as a meeting everywhere (the default, also for a calendar PS has never seen)
//   "show"     shown in the calendar and the Meetings panel, never treated as a meeting (no alert, no private mode ask,
//              not the island's next meeting, not the AFK or Do Not Disturb "in a meeting", not busy in the time converter)
//   "off"      not shown and not used at all
// Only the choices that are not "meeting" are stored (settings.calChoices, encrypted with the rest of the settings and synced
// by the vault), keyed by the calendar's own identifier, so a renamed calendar keeps its choice. A choice for a calendar that is
// gone costs nothing (no events carry it); it also carries the day it was last seen in the list and is dropped after
// CAL_PICK.forgetDays. An event with no calendar (an older copy, the developer's Google feeds) is always a meeting. Pure.
import type { CalEvent } from "./model";

export type CalUse = "meeting" | "show" | "off";
/** One calendar of the Mac's Calendar app: only its name and colour travel, nothing else. */
export interface CalInfo { id: string; name: string; color: string | null; acct: string }
export interface CalChoice { u: "show" | "off"; seen: string }
export type CalChoices = Record<string, CalChoice>;

export const CAL_PICK = { maxCals: 60, maxChoices: 80, forgetDays: 60, touchDays: 7 } as const;
const DAY = 86400_000;

const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
const iso = (v: unknown) => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);
const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null);

/** The Mac's list of calendars, cleaned: ids, names, colours, accounts; duplicates and junk dropped. */
export function cleanCals(v: unknown): CalInfo[] {
  const out: CalInfo[] = [], seen = new Set<string>();
  for (const x of Array.isArray(v) ? v : []) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const id = str(o.id, 200);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: str(o.name, 120) || "Calendar", color: hex(o.color), acct: str(o.acct, 80) || "" });
    if (out.length >= CAL_PICK.maxCals) break;
  }
  return out;
}

/** The saved choices, cleaned (a bad value is dropped, so a damaged setting can never hide everything). */
export function cleanChoices(v: unknown): CalChoices {
  const out: CalChoices = {};
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  for (const [id, c] of Object.entries(o)) {
    const x = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    if (!id || id.length > 200 || (x.u !== "show" && x.u !== "off")) continue;
    out[id] = { u: x.u, seen: iso(x.seen) ?? new Date(0).toISOString() };
    if (Object.keys(out).length >= CAL_PICK.maxChoices) break;
  }
  return out;
}

/** What a calendar is set to. No id (an older copy) or a calendar never chosen: a meeting. */
export function calUse(choices: unknown, id: string | null | undefined): CalUse {
  if (!id || !choices || typeof choices !== "object") return "meeting";
  const c = (choices as Record<string, { u?: unknown }>)[id];
  return c && (c.u === "show" || c.u === "off") ? c.u : "meeting";
}
export const hasOff = (choices: unknown) => !!choices && typeof choices === "object" && Object.values(choices as Record<string, { u?: unknown }>).some((c) => c?.u === "off");
export const hasAny = (choices: unknown) => !!choices && typeof choices === "object" && Object.keys(choices).length > 0;

type Ev = Pick<CalEvent, "cal">;
/** The events PS shows: everything but the calendars set to Off. */
export function shownEvents<E extends Ev>(events: E[], choices: unknown): E[] {
  if (!hasOff(choices)) return events;
  return events.filter((e) => calUse(choices, e.cal) !== "off");
}
/** The events that count as meetings: only the calendars set to Meetings (and events with no calendar). */
export function meetingEvents<E extends Ev>(events: E[], choices: unknown): E[] {
  if (!hasAny(choices)) return events;
  return events.filter((e) => calUse(choices, e.cal) === "meeting");
}

/** One calendar's new choice. "meeting" is the default, so it removes the entry. */
export function setChoice(choices: unknown, id: string, use: CalUse, now = Date.now()): CalChoices {
  const next = cleanChoices(choices);
  if (!id || id.length > 200) return next;
  if (use === "meeting") delete next[id];
  else next[id] = { u: use, seen: new Date(now).toISOString() };
  return next;
}

/** Keeps the list tidy: a choice whose calendar is in the Mac's list is marked seen (at most once a week, so it is not rewritten
 *  all the time); one whose calendar has been gone for forgetDays is dropped. An empty list (nothing read) changes nothing. */
export function tidyChoices(choices: unknown, cals: CalInfo[], now = Date.now()): CalChoices {
  const cur = cleanChoices(choices);
  if (!cals.length) return cur;
  const here = new Set(cals.map((c) => c.id));
  const out: CalChoices = {};
  for (const [id, c] of Object.entries(cur)) {
    const last = Date.parse(c.seen);
    if (here.has(id)) out[id] = now - last >= CAL_PICK.touchDays * DAY ? { u: c.u, seen: new Date(now).toISOString() } : c;
    else if (now - last < CAL_PICK.forgetDays * DAY) out[id] = c;
  }
  return out;
}
export const sameChoices = (a: unknown, b: unknown) => JSON.stringify(cleanChoices(a)) === JSON.stringify(cleanChoices(b));

/** The picker's groups: the Mac's calendars by account (steady order), each with its use. */
export function groupCals(cals: CalInfo[], choices: unknown): { acct: string; cals: (CalInfo & { use: CalUse })[] }[] {
  const by = new Map<string, (CalInfo & { use: CalUse })[]>();
  for (const c of cals) by.set(c.acct, [...(by.get(c.acct) ?? []), { ...c, use: calUse(choices, c.id) }]);
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([acct, list]) => ({ acct, cals: list.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** Words on screen. */
export const CAL_PICK_WORDS = {
  title: "Calendars",
  line: "Choose which calendars PS works with.",
  button: "Choose calendars",
  meeting: "Meetings", show: "Show only", off: "Off",
  hint: { meeting: "Shown, and counts as a meeting", show: "Shown, never a meeting", off: "Not shown, not used" },
  none: "Your calendars show here once PS has read your Calendar.",
} as const;

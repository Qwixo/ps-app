// Meeting notes pop-up (the developer, 22 Oct 2026): a few minutes after a meeting starts (5 by default), the
// notes the developer wrote for it (this call's own plus his "every call like this" ones, Tab list > Meetings)
// pop up as a checklist at the top left of the screen. Ticking an item saves it and it disappears;
// when all are ticked the card closes. "Remind me in" (mouse wheel to pick, click to confirm) hides
// it for that long while the meeting lasts; "Don't remind me" closes it for that meeting. No open
// notes, no card. Pure: the PS main window (src/notescard.ts) feeds it and shows what it returns.
import type { CalEvent, MeetingNote, StandingNote } from "./model";

export interface NotesPrefs { on: boolean; after: number; snooze: number[] }
export const NOTES_DEFAULTS: NotesPrefs = { on: true, after: 5, snooze: [5, 10, 15, 20, 25, 30, 40, 45, 50, 60] };
/** This Mac's own memory per meeting: snoozed until, or Don't remind me. */
export type NotesLocal = Record<string, { snoozeUntil?: number; quiet?: boolean; at: number }>;
export interface NotesRow { id: string; text: string; every: boolean }
export interface NotesCardData { id: string; key: string; title: string; end: string; items: NotesRow[]; snooze: number[] }

const titleKey = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
/** The meeting key the notes use (Tab list): event id plus its start. */
export const meetingKey = (e: CalEvent) => e.id + e.start;
/** 32 bit FNV-1a: card ids must fit 40 characters. */
function hash(s: string) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }
export const cardId = (key: string) => `nc:${hash(key)}`;

/** A real meeting: timed, with someone else invited or a video link. */
export const isMeeting = (e: CalEvent) => !e.allDay && !!e.start && !!e.end && (!!e.link || e.attendees.some((a) => !a.self));

/** The open notes for one meeting (every call ones first), ticked ones left out. */
export function openRows(e: CalEvent, notes: MeetingNote[], standing: StandingNote[]): NotesRow[] {
  const own = notes.find((n) => n.key === meetingKey(e));
  const ds = new Set(own?.doneStanding || []);
  const every = standing.find((s) => s.title === titleKey(e.title))?.items || [];
  return [
    ...every.filter((x) => !ds.has(x.id)).map((x) => ({ id: x.id, text: x.text, every: true })),
    ...(own?.items || []).filter((x) => !x.done).map((x) => ({ id: x.id, text: x.text, every: false })),
  ];
}

/** The card to show now (at most one: the meeting that started first), or null. */
export function notesCard(now: number, events: CalEvent[], notes: MeetingNote[], standing: StandingNote[], local: NotesLocal, prefs: NotesPrefs): NotesCardData | null {
  if (!prefs.on) return null;
  const live = events
    .filter((e) => isMeeting(e) && Date.parse(e.start!) + prefs.after * 60_000 <= now && Date.parse(e.end!) > now)
    .sort((a, b) => Date.parse(a.start!) - Date.parse(b.start!));
  for (const e of live) {
    const key = meetingKey(e), l = local[key];
    if (l?.quiet || (l?.snoozeUntil && l.snoozeUntil > now)) continue;
    const items = openRows(e, notes, standing);
    if (!items.length) continue;
    return { id: cardId(key), key, title: e.title, end: e.end!, items, snooze: prefs.snooze.filter((m) => m >= 5 && m <= 60).sort((a, b) => a - b) };
  }
  return null;
}

/** Meetings that ended in the last 2 days with notes still open: one click turns them into tasks. */
export function leftovers(now: number, events: CalEvent[], notes: MeetingNote[]): { key: string; title: string; end: string; items: { id: string; text: string }[] }[] {
  const ended = new Map(events.filter((e) => e.end && Date.parse(e.end) <= now && Date.parse(e.end) > now - 2 * 864e5).map((e) => [meetingKey(e), e]));
  return notes
    .filter((n) => ended.has(n.key) && n.items.some((x) => !x.done))
    .map((n) => ({ key: n.key, title: n.title, end: ended.get(n.key)!.end!, items: n.items.filter((x) => !x.done).map((x) => ({ id: x.id, text: x.text })) }));
}

/** Drops this Mac's memory for meetings over 2 days old. */
export function pruneLocal(local: NotesLocal, now: number): NotesLocal {
  return Object.fromEntries(Object.entries(local).filter(([, v]) => v.at > now - 2 * 864e5));
}

/** Claude's sealed op {op:"meetingNotes", eventId?, title?, start?, items: string[], every?: boolean}:
 *  notes for a meeting, matched by event id, else by title and a start within 15 minutes. "every"
 *  puts them on every call with that title. Items already there (same words) are not added twice.
 *  Returns the new lists, or null when no meeting matched (the package then waits in the inbox). */
export function applyNotesOp(op: { eventId?: string; title?: string; start?: string; items?: unknown; every?: boolean },
  events: CalEvent[], notes: MeetingNote[], standing: StandingNote[], newId: () => string) {
  const texts = (Array.isArray(op.items) ? op.items : []).filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().slice(0, 300)).slice(0, 30);
  if (!texts.length) return { meetingNotes: notes, standingNotes: standing };
  const at = op.start ? Date.parse(op.start) : NaN;
  const e = events.find((x) => op.eventId && x.id === op.eventId)
    ?? events.find((x) => !!op.title && titleKey(x.title) === titleKey(op.title) && !!x.start && Number.isFinite(at) && Math.abs(Date.parse(x.start) - at) < 15 * 60_000);
  if (!e && !(op.every && op.title)) return null;
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  if (op.every) {
    const t = titleKey(e?.title || op.title!);
    const cur = standing.find((s) => s.title === t)?.items || [];
    const add = texts.filter((x) => !cur.some((c) => same(c.text, x))).map((x) => ({ id: newId(), text: x }));
    return { meetingNotes: notes, standingNotes: [...standing.filter((s) => s.title !== t), { title: t, items: [...cur, ...add] }] };
  }
  const key = meetingKey(e!);
  const own = notes.find((n) => n.key === key);
  const cur = own?.items || [];
  const add = texts.filter((x) => !cur.some((c) => same(c.text, x))).map((x) => ({ id: newId(), text: x, done: false }));
  const next: MeetingNote = { key, title: e!.title, start: e!.start!, items: [...cur, ...add], doneStanding: own?.doneStanding || [] };
  return { meetingNotes: [...notes.filter((n) => n.key !== key), next], standingNotes: standing };
}

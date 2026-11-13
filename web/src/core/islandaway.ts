// V1.58 the island's right click menu (ps-mac Island.swift): "Disappear for this meeting" hides the island until the
// meeting on now ends, per the calendar. The meetings are the same ones the Meetings panel shows (the developer's Google calendar
// feed for the developer, this Mac's Calendar for everyone else, both kept in the vault as the calendar snapshot; meetings taken
// off the panel left out). No new calendar read: the page sends the Mac the timed events from now to 12 hours ahead,
// only their id, start and end (never a title or a name), and the Mac decides with its own clock which one is on now, so a
// meeting that starts later needs no new message. A moved or longer meeting arrives with the next calendar copy and the
// island follows its new end (IslandAwayCore.swift). Pure.
import type { CalEvent } from "./model";
import { isMeeting } from "./notescard.ts";

/** At most this many events, this far ahead. */
export const ISLAND_MEETS = { max: 12, aheadMs: 12 * 3600_000, idMax: 200 } as const;
/** One event for the Mac: its id, start and end (ms), and whether it is a real meeting (people or a call link). */
export interface IslandMeet { id: string; start: number; end: number; real: boolean }

/** The timed events not over yet that start within 12 hours, earliest first. */
export function islandMeetings(events: CalEvent[] | undefined, now: number): IslandMeet[] {
  const out: IslandMeet[] = [];
  for (const e of events ?? []) {
    if (e.allDay || !e.start || !e.end || !e.id) continue;
    const start = Date.parse(e.start), end = Date.parse(e.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= now || start > now + ISLAND_MEETS.aheadMs) continue;
    out.push({ id: e.id.slice(0, ISLAND_MEETS.idMax), start, end, real: isMeeting(e) });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end).slice(0, ISLAND_MEETS.max);
}

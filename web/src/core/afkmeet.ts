// The AFK timer stays off during meetings (the developer, 7 Nov 2026, V1.40: "if you use the meeting panel and then
// see that I'm in a meeting right now, don't pop up with the AFK timer"). Pure: no vault, no clock.
//
// The main window (src/meetwatch.ts) turns the Meetings panel's events into time windows and hands them to
// the Mac side ({type:"afkMeetings"}, Sources/MeetingTime.swift). The Mac checks them every second with its
// own clock, so a slow or sleeping web page never lets a pop-up through, and a meeting that starts while the
// page is busy still counts on time.
//
// What counts as a meeting (the same rule as "Are you sure" and the meeting notes card, core/notescard.ts):
// - a start and an end on the calendar, not an all day event
// - a call link (the panel's Join button) or at least one other person invited
// - not taken off the Meetings panel with its delete (core/meethide.ts)
// - not declined, and not longer than 12 hours (a multi day conference block is not "in a call")
// So a plain block ("Cooking", "INTERLINK work", "Getting closer to God", bed time) never counts: it has
// neither a link nor other people.
// Each meeting's window runs from 5 minutes before its start (joining early) to 10 minutes after its end
// (running over). Calendar data only: PS never looks at which app uses the microphone or camera here.
import type { CalEvent } from "./model";
import { isMeeting } from "./notescard.ts";
import { visibleEvents, type MeetHide } from "./meethide.ts";

export const AFK_MEET = {
  beforeMs: 5 * 60_000,       // joining early
  afterMs: 10 * 60_000,       // running over
  longestMs: 12 * 3600_000,   // longer than this is not a meeting
  pastMs: 24 * 3600_000,      // windows kept after they end (a Mac asleep across a meeting is sorted out on wake)
  aheadMs: 48 * 3600_000,     // how far ahead the Mac is told
  max: 60,
} as const;

/** A meeting window in ms since 1970: [from, to). */
export type MeetWindow = [number, number];

/** Does this calendar event count as a meeting for the AFK timer? */
export function countsAsMeeting(e: CalEvent): boolean {
  if (!e || typeof e !== "object") return false;
  const attendees = Array.isArray(e.attendees) ? e.attendees : [];
  if (!isMeeting({ ...e, attendees })) return false;
  const s = Date.parse(e.start!), en = Date.parse(e.end!);
  if (!Number.isFinite(s) || !Number.isFinite(en) || en <= s || en - s > AFK_MEET.longestMs) return false;
  if (attendees.some((a) => a?.self && a.rsvp === "declined")) return false;
  return true;
}

/** The windows to send to the Mac: meetings from the last day to the next two, early and late minutes added,
 *  overlapping ones joined, oldest first. Meetings hidden on the Meetings panel are left out. */
export function afkMeetWindows(events: CalEvent[] | null | undefined, hidden: MeetHide[] | undefined, now: number): MeetWindow[] {
  const list: MeetWindow[] = [];
  for (const e of visibleEvents(Array.isArray(events) ? events : [], hidden)) {
    if (!countsAsMeeting(e)) continue;
    const from = Date.parse(e.start!) - AFK_MEET.beforeMs, to = Date.parse(e.end!) + AFK_MEET.afterMs;
    if (to <= now - AFK_MEET.pastMs || from >= now + AFK_MEET.aheadMs) continue;
    list.push([from, to]);
  }
  list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: MeetWindow[] = [];
  for (const w of list) {
    const last = out[out.length - 1];
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else out.push([w[0], w[1]]);
  }
  return out.slice(-AFK_MEET.max);
}

/** The window that holds this moment, or null. */
export function meetWindowAt(windows: MeetWindow[], now: number): MeetWindow | null {
  return windows.find((w) => w[0] <= now && now < w[1]) || null;
}

/** Same windows (so the page only tells the Mac when something changed). */
export function sameWindows(a: MeetWindow[] | null, b: MeetWindow[]): boolean {
  return !!a && a.length === b.length && a.every((w, i) => w[0] === b[i][0] && w[1] === b[i][1]);
}

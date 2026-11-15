// The Meetings panel for everyone but the developer (7 Nov 2026). The developer's meetings come from his Google calendar through his
// own server (calendar-inbox). Anyone else using the public PS gets theirs from the Calendar app on their Mac:
// ps-mac Sources/LocalCalendar.swift reads it through EventKit (read only) and sends
// {type:"localCal", status, events}. This file checks that answer and turns it into the same CalendarSnap the
// Google copy is, so the panel, the island, the meeting alerts and the notes pop-up read both the same way.
// The page keeps it in that person's own vault (encrypted, only when an event changed). Pure.
import type { CalAttendee, CalEvent, CalendarSnap } from "./model";
import { agoText, type CalStatus } from "./calstatus.ts";
import { cleanCals } from "./calpick.ts";

export type LocalCalStatus = "ok" | "denied" | "ask" | "test" | "red" | "error";
const STATUSES = new Set<LocalCalStatus>(["ok", "denied", "ask", "test", "red", "error"]);
export const LOCAL_CAL = { maxEvents: 200, maxAttendees: 60, account: "mac" } as const;

const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
const iso = (v: unknown) => (typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);

export function localStatus(v: unknown): LocalCalStatus {
  return typeof v === "string" && STATUSES.has(v as LocalCalStatus) ? (v as LocalCalStatus) : "error";
}

function attendee(v: unknown): CalAttendee | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const email = str(o.email, 200);
  if (!email || !email.includes("@")) return null;
  const rsvp = ["accepted", "declined", "tentative", "needsAction"].includes(o.rsvp as string) ? (o.rsvp as string) : "needsAction";
  return { email, name: str(o.name, 120), rsvp, self: o.self === true, organizer: o.organizer === true };
}

/** One event from the Mac, or null when it is not well formed. Only https call links are kept. */
export function localEvent(v: unknown): CalEvent | null {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const id = str(o.id, 300), start = iso(o.start);
  if (!id || !start) return null;
  const link = str(o.link, 500);
  return {
    id, title: str(o.title, 300) || "(no title)", start, end: iso(o.end) ?? start, allDay: o.allDay === true,
    link: link && link.startsWith("https://") ? link : null, place: str(o.place, 300),
    ...(str(o.acct, 80) ? { acct: str(o.acct, 80) } : {}),
    ...(str(o.cal, 200) ? { cal: str(o.cal, 200) } : {}),   // the calendar it is in (core/calpick.ts); an older Mac sends none
    attendees: (Array.isArray(o.attendees) ? o.attendees : []).slice(0, LOCAL_CAL.maxAttendees).map(attendee).filter((a): a is CalAttendee => !!a),
  };
}

/** The Mac's answer as a calendar copy for the vault, or null (refused, a test copy, nothing usable). */
export function localSnap(m: unknown): CalendarSnap | null {
  const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
  if (localStatus(o.status) !== "ok" || !Array.isArray(o.events)) return null;
  const at = iso(o.at), from = iso(o.from), to = iso(o.to);
  if (!at || !from || !to) return null;
  const events = o.events.slice(0, LOCAL_CAL.maxEvents).map(localEvent).filter((e): e is CalEvent => !!e)
    .sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  const cals = cleanCals(o.cals);   // the Mac's calendars, names and colours only (core/calpick.ts); an older Mac sends none
  return { account: LOCAL_CAL.account, at, from, to, events, ...(cals.length ? { cals } : {}) };
}

/** The Calendar switch (G Squad, the developer's rule: every feature that runs for friends has its own switch, and macOS is asked
 *  only when the person switches it on). "on": read, and the switch click may ask macOS once. "off": never read, never
 *  ask. "quiet" (never chosen, an account from before the switch): read only if macOS already allows it, never ask. */
export type CalMode = "on" | "off" | "quiet";
export const calMode = (v: unknown): CalMode => (v === true ? "on" : v === false ? "off" : "quiet");
/** May this read ask macOS? Only a click on the switch (or the refresh icon) while it is on. */
export const calMayAsk = (mode: CalMode, clicked: boolean) => mode === "on" && clicked;
/** The empty copy saved when the switch goes off, so no old meeting stays on screen. */
export const CAL_OFF_SNAP = (at: string): CalendarSnap => ({ account: LOCAL_CAL.account, at, from: at, to: at, events: [] });

/** The Mac's answer as the Meetings panel's status (core/calstatus.ts): connected false = Calendar access is off. */
export function localStatusPatch(m: unknown, now: number): Partial<CalStatus> {
  const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
  const st = localStatus(o.status);
  if (st === "ok") return { connected: true, checkedAt: iso(o.at), error: null, busy: false, doneAt: now };
  if (st === "denied") return { connected: false, error: null, busy: false, doneAt: now };
  if (st === "ask" || st === "test" || st === "red") return { connected: null, error: null, busy: false, doneAt: now };
  return { error: "Could not read Calendar", busy: false, doneAt: now };
}

/** The small line under the Meetings heading when the meetings come from this Mac's Calendar. `settings`: show
 *  the button that opens System Settings (access refused). */
export function localLine(st: Pick<CalStatus, "connected" | "checkedAt" | "error" | "busy">, copyAt: string | null, now: number, mode: CalMode = "on"): { text: string; tone: "ok" | "warn" | "bad"; settings: boolean; turnOn?: boolean } {
  if (mode === "off") return { text: CAL_WORDS.off, tone: "warn", settings: false, turnOn: true };
  if (st.busy) return { text: "Updating...", tone: "ok", settings: false };
  if (st.connected === false) return { text: "Calendar access is off", tone: "bad", settings: true };
  const at = st.checkedAt || copyAt;
  if (st.error) return { text: st.error, tone: "warn", settings: false };
  if (!at) return { text: "From your Mac's Calendar", tone: "ok", settings: false };
  return { text: `From your Mac's Calendar · ${agoText(at, now)}`, tone: "ok", settings: false };
}

/** Words for the switch (shown to other people: Rule Zero, gsquad-welcome-copy.md). */
export const CAL_WORDS = {
  title: "Meetings from your Calendar",
  note: "On: today's and the next 7 days' meetings from the Calendar app on this Mac, read only. Off: never read, and macOS never asks.",
  off: "Calendar is off",
  turnOn: "Turn on",
} as const;

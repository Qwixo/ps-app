// Hidden meetings (the developer, 2 Nov 2026: "Even if they're on my calendar, I want you to be able to delete them
// off my panel"). The X on a meeting in the Meetings panel hides it from PS only: Google Calendar and every
// other calendar are never touched (calendar-inbox is read only). The list lives in settings.meetHidden,
// encrypted with the rest of the settings, so a meeting hidden on the Mac is hidden on the phone too.
// The key is the event id plus its start: Google gives each occurrence of a repeating event its own id
// (singleEvents), so hiding one Psychology lesson leaves next week's alone, and a moved meeting comes back.
// Hidden meetings also stay quiet: no "10 minutes before" card, no phone alarm, not the next meeting anywhere.
// Pure: no vault, no clock.

export interface MeetHide { key: string; at: string; end: string }   // at: when it was hidden; end: when the meeting ends
export const MEET_HIDE = { undoMs: 6000, keepAfterEnd: 2 * 86400_000, max: 300 } as const;

export const meetKey = (e: { id: string; start: string | null }) => e.id + (e.start || "");

const tidy = (list: MeetHide[] | undefined, now: number) =>
  (list || []).filter((h) => h && typeof h.key === "string" && h.key && !(Date.parse(h.end) + MEET_HIDE.keepAfterEnd < now));

/** The list with this meeting hidden. Meetings over for a while are dropped, so the list never grows. */
export function hideMeeting(list: MeetHide[] | undefined, key: string, end: string | null, now = Date.now()): MeetHide[] {
  const e = end && !Number.isNaN(Date.parse(end)) ? new Date(end).toISOString() : new Date(now + 86400_000).toISOString();
  const rest = tidy(list, now).filter((h) => h.key !== key);
  return [...rest, { key: key.slice(0, 400), at: new Date(now).toISOString(), end: e }].slice(-MEET_HIDE.max);
}
/** Undo: the list without it. */
export function unhideMeeting(list: MeetHide[] | undefined, key: string, now = Date.now()): MeetHide[] {
  return tidy(list, now).filter((h) => h.key !== key);
}
export const hiddenKeys = (list: MeetHide[] | undefined) => new Set((list || []).map((h) => h.key));
/** Calendar events without the hidden ones. */
export function visibleEvents<E extends { id: string; start: string | null }>(events: E[], list: MeetHide[] | undefined): E[] {
  if (!list?.length) return events;
  const h = hiddenKeys(list);
  return events.filter((e) => !h.has(meetKey(e)));
}

/** One hide or undo, as it travels from the Tab list to the page that holds the vault. Null when malformed. */
export type MeetHideOp = { op: "hide"; key: string; end: string | null } | { op: "unhide"; key: string };
export function cleanMeetHideOp(o: unknown): MeetHideOp | null {
  const x = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  if (typeof x.key !== "string" || !x.key || x.key.length > 400) return null;
  if (x.op === "unhide") return { op: "unhide", key: x.key };
  if (x.op === "hide") return { op: "hide", key: x.key, end: typeof x.end === "string" && !Number.isNaN(Date.parse(x.end)) ? x.end : null };
  return null;
}
export function applyMeetHide(list: MeetHide[] | undefined, op: MeetHideOp, now = Date.now()): MeetHide[] {
  return op.op === "hide" ? hideMeeting(list, op.key, op.end, now) : unhideMeeting(list, op.key, now);
}

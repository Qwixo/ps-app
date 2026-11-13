// Create event from Time zones (V1.47). The developer picks a time in Convert a time and PS opens Google Calendar's own
// "new event" page with it filled in. PS only opens a link: no calendar access, nothing written anywhere.
//
//   https://calendar.google.com/calendar/render?action=TEMPLATE&text=Call%20with%20Sarah&dates=20261110T140000Z/20261110T143000Z&ctz=America/New_York
//
// dates: the start and end in UTC (YYYYMMDDTHHMMSSZ), so the moment is exact whatever zone the browser is in.
// ctz: the zone the event page shows the times in (the zone the developer was looking at).
// authuser: only when PS knows which Google account; otherwise Google picks (or asks).

export const GCAL_NEW = "https://calendar.google.com/calendar/render";
export const EVENT_MINUTES = 30;

/** A moment as Google Calendar wants it: 20261110T140000Z (UTC, whole seconds). */
export function gcalStamp(ts: number): string {
  const d = new Date(Math.floor(ts / 1000) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** The event's name: "Call with Sarah" when the time is for a person, else "Call". */
export function eventTitle(who?: string | null): string {
  const w = (who ?? "").replace(/\s+/g, " ").trim();
  return w ? `Call with ${w}` : "Call";
}

export interface EventLink {
  /** The start, a real moment (ms). */
  start: number;
  /** Length in minutes (30 unless said). */
  minutes?: number;
  /** The zone the times are shown in on Google's page (IANA, like America/New_York). */
  tz?: string;
  title?: string;
  /** A Google account (its email or its number) when PS knows which one. */
  authuser?: string | number | null;
}

/** Google Calendar's new event page for that time. */
export function gcalLink(e: EventLink): string {
  const mins = e.minutes && e.minutes > 0 ? e.minutes : EVENT_MINUTES;
  const q = [
    "action=TEMPLATE",
    `text=${encodeURIComponent(e.title ?? eventTitle())}`,
    `dates=${gcalStamp(e.start)}/${gcalStamp(e.start + mins * 60000)}`,   // the slash stays: Google reads it as is
  ];
  if (e.tz && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(e.tz)) q.push(`ctz=${encodeURIComponent(e.tz).replace(/%2F/g, "/")}`);
  if (e.authuser !== undefined && e.authuser !== null && String(e.authuser).trim()) q.push(`authuser=${encodeURIComponent(String(e.authuser).trim())}`);
  return `${GCAL_NEW}?${q.join("&")}`;
}

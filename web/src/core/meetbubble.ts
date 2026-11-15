// The next meeting on the island (V1.58, the developer 13 Nov 2026). A small bubble on the island's right side, "<meeting> in
// 12m", counting down once the next meeting is within the lead time (15 minutes unless changed); in the last 2 minutes
// it is a Join button when the meeting has a link; during the meeting it shows the time left. A click opens the island
// bigger with the meeting's name, its time and Join. It reads the meetings the Meetings panel already has (the calendar
// in the vault: the developer's Google feed, or this Mac's Calendar for everyone else); it never reads a calendar of its own.
// Pomodoro breaks and stand-ups win over it while they run (core/islandtimers.ts); it comes back after.
import type { CalEvent } from "./model";
import { visibleEvents, type MeetHide } from "./meethide.ts";

/** style: "blob" is the small stacked blob on the end of the island (PS 1.60), "pill" the older long pill. */
export type MeetStyle = "blob" | "pill";
export interface MeetBubblePrefs { on: boolean; lead: number; style: MeetStyle }
export const MEET_BUBBLE_DEFAULT: MeetBubblePrefs = { on: true, lead: 15, style: "blob" };
export const MEET_LEAD_LIMITS = [1, 120] as const;
/** In the last 2 minutes before it starts, the bubble is a Join button (when the meeting has a link). */
export const MEET_JOIN_MS = 120_000;

export const MEET_WORDS = {
  in: (name: string, left: string) => `${name} in ${left}`,
  left: (left: string) => `${left} left`,
  join: "Join",
  meeting: "Meeting",
  settingOn: "Next meeting on the island",
  settingLead: "Show it this long before",
  settingStyle: "Look of the meeting countdown",
  styleBlob: "Small blob",
  stylePill: "Long pill",
} as const;

export function meetBubblePrefs(v: unknown): MeetBubblePrefs {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
  const n = typeof o.lead === "number" ? o.lead : Number(o.lead);
  return { on: o.on !== false, style: o.style === "pill" ? "pill" : "blob", lead: Number.isFinite(n) ? Math.min(MEET_LEAD_LIMITS[1], Math.max(MEET_LEAD_LIMITS[0], Math.round(n))) : MEET_BUBBLE_DEFAULT.lead };
}

/** Sent this long before the bubble shows, so the island (which the page tells once a minute) starts it on time. */
export const SEND_EARLY_MS = 120_000;
/** What the island is told. from: when the bubble starts showing (start less the lead time). link: https only. */
export interface MeetIsland { id: string; title: string; start: number; end: number; from: number; link: string | null; style: MeetStyle }

const safeLink = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s]{3,1500}$/.test(v) ? v : null);

/** The meeting the bubble is about: the one going on now, else the next to start within the lead time (the same list
 *  the Meetings panel shows: meetings taken off the panel stay off, all day events are not meetings). Private mode
 *  hides the name. */
export function meetIsland(events: CalEvent[] | null | undefined, hidden: MeetHide[] | undefined, p: MeetBubblePrefs, now: number, priv: boolean): MeetIsland | null {
  if (!p.on || !events?.length) return null;
  const lead = p.lead * 60_000;
  const list = visibleEvents(events, hidden)
    .filter((e) => !e.allDay && e.start)
    .map((e) => { const start = Date.parse(e.start!), end = Date.parse(e.end || e.start!); return { e, start, end: end > start ? end : start + 30 * 60_000 }; })
    .filter((m) => Number.isFinite(m.start) && m.end > now && m.start - lead - SEND_EARLY_MS <= now)
    .sort((a, b) => a.start - b.start);
  // A meeting starting soon beats one nearly over: of those shown now, the soonest start that has not begun, else the one
  // going on; nothing shown now, the one that shows next (sent early so the island starts it on time).
  const shown = list.filter((x) => x.start - lead <= now);
  const m = shown.find((x) => x.start > now) ?? shown[0] ?? list[0];
  if (!m) return null;
  const title = priv ? MEET_WORDS.meeting : (m.e.title || "").replace(/\s+/g, " ").trim().slice(0, 80) || MEET_WORDS.meeting;
  return { id: m.e.id.slice(0, 120), title, start: m.start, end: m.end, from: m.start - lead, link: safeLink(m.e.link), style: p.style };
}

/** "12m", "1h 5m", "45s" (under a minute). Rounded up, so it never says 0m while time is left. */
export function shortLeft(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.ceil(ms / 1000))}s`;
  const m = Math.ceil(ms / 60_000), h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

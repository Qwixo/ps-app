// Screen recorder, the page's part of the island moments (PS 1.60, pull request 12b). Pure: no React, no DOM, no bridge.
// The Mac decides the rest (ps-mac ScreenRecIslandCore.swift, tested in mac/tests/screenrec-island-test.sh): the meeting found rule
// with an app window and the mic, the order of the questions, the cards, private mode hiding every sign, the performance watch.
// What the page knows and the Mac does not is the Meetings panel, and who still counts as "not answered" for the feature intro.
import type { CalEvent } from "./model.ts";
import type { ScreenRecState } from "./screenrec.ts";

/** A meeting counts as "starting now" from its start until 15 minutes after, while it is still on. Not earlier: "Start private mode?" (core/meetalerts.ts
 *  privateAskFor) begins AT the start, and the record question always comes after it, never before it and never together with it. */
export const BEFORE_MS = 0, AFTER_MS = 15 * 60_000;

/** The meeting on in the Meetings panel right now (people or a video link, like the private mode question), or null. Hidden meetings
 *  are already left out by the caller (core/meethide.ts). */
export function liveMeeting(events: CalEvent[], now: number): { name: string; key: string; attendees: string[] } | null {
  const e = events.find((x) => !x.allDay && !!x.start && !!x.end && (!!x.link || x.attendees.some((a) => !a.self))
    && Date.parse(x.start) - BEFORE_MS <= now && now < Date.parse(x.start) + AFTER_MS && Date.parse(x.end) > now);
  if (!e) return null;
  // 12c: the other people's addresses, kept with the recording only to match it to a client afterwards
  const attendees = e.attendees.filter((a) => !a.self && typeof a.email === "string" && a.email.includes("@")).map((a) => String(a.email).toLowerCase()).slice(0, 20);
  return { name: (e.title || "").replace(/\s+/g, " ").trim().slice(0, 120) || "Meeting", key: e.id + e.start, attendees };
}

/** What the page tells the Mac about the Meetings panel (every run). Null when screen recording is off: while it is off nothing here is sent,
 *  so no meeting is looked at for recording. `privateAskPending`: "Start private mode?" is on the island or about to come, so the Mac
 *  waits and asks the record question right after (never both at once). */
export function meetingMessage(a: { st: Pick<ScreenRecState, "enabled" | "featureOn"> | null; events: CalEvent[]; now: number; privateAskPending: boolean }):
  { type: "screenrec"; op: "meeting"; name: string | null; key: string | null; privateAsk: boolean; attendees: string[] } | null {
  if (!a.st || !a.st.featureOn || !a.st.enabled) return null;
  const m = liveMeeting(a.events, a.now);
  return { type: "screenrec", op: "meeting", name: m?.name ?? null, key: m?.key ?? null, privateAsk: a.privateAskPending, attendees: m?.attendees ?? [] };
}

/** The feature intro "Screen recording now in PS" is for people who said No or have not answered yet. Yes means they know (done, never
 *  again). Not the Mac, or the Mac's state not here yet: unknown (waits, never guesses). The feature switched off in this build: unknown too. */
export function introAudience(a: { mac: boolean; st: Pick<ScreenRecState, "enabled" | "featureOn"> | null }): "done" | "open" | "unknown" {
  if (!a.mac) return "done";
  if (!a.st) return "unknown";
  if (!a.st.featureOn) return "unknown";
  return a.st.enabled ? "done" : "open";
}

/** The island part and the Mac's cards, in the words the page also shows (the no-dash test reads this). */
export const SR_INTRO = {
  headline: "Screen recording now in PS",
  ask: "Did you know PS can record your sales calls and client calls?",
  steps: [
    "A Record button shows below your email panel once you switch it on.",
    "When a meeting starts, the island asks if you want to record it.",
    "While it records, the island shows a red dot and the time. Private mode hides it.",
    "Switch it on in Settings, Screen recording. It is off until you do.",
  ],
  settings: "Settings, Screen recording",
} as const;
export function screenRecIslandCopy(): string[] {
  return [SR_INTRO.headline, SR_INTRO.ask, ...SR_INTRO.steps, SR_INTRO.settings];
}

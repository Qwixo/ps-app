// The website's To-do page in web form (V1.44, the developer 8 Nov 2026: "make the web app much better, almost mimicking what
// the PS app overlay is, in the to-do list section of my web app ... The same design as the Tab overlay but in web
// app form. Something that doesn't require all the permissions."). The page draws the Tab list itself
// (views/WebTodo.tsx, views/TaskMap.tsx Overlay `web`). These are its rules, with no DOM, so the unit test checks them.

/** Tab list parts (their Edit mode slot ids) the web form leaves out: each needs PS on a Mac. */
export const WEB_HIDDEN: ReadonlySet<string> = new Set([
  "afk",          // the AFK timer watches the keyboard and mouse of the whole Mac
  "screentime",   // screen time is counted by PS on the Mac (or the phone app)
  "mixer",        // the audio mixer and headphones talk to macOS audio
  "net",          // the network monitor reads the Mac's connections
  "activity",     // PS 1.65: the Activity monitor reads the Mac's processes
  "security",     // the padlock: auto reboot, Are you sure, sign out of this Mac
  "second",       // Second Computer pairs two Macs (the developer only anyway)
  "glass",        // Keep overlay and Hover mode belong to holding Tab
]);
/** Does the web form show this slot? Everything not in WEB_HIDDEN shows, as in the Tab list. */
export const webShows = (slot: string): boolean => !WEB_HIDDEN.has(slot);

/** What the Mac app adds, in the words of the quiet "Get the Mac app" note (drafts for the developer's yes, public copy). */
export const MAC_ONLY = [
  "Hold Tab over any app",
  "Dynamic Island",
  "Screen time",
  "AFK timer",
  "Audio mixer and headphones",
  "Network monitor",
  "Are you sure and auto reboot",
] as const;
export const MAC_NOTE = {
  title: "Get the Mac app",
  line: "Hold Tab over any app for this list, plus the Dynamic Island, screen time and the AFK timer.",
  link: "https://cincee.com/ps-app-mac/",
} as const;
/** The note stays away for this long after its x. */
export const MAC_NOTE_SNOOZE_MS = 30 * 24 * 3600_000;
export function macNoteShown(dismissedAt: number | null, now: number): boolean {
  return dismissedAt == null || !Number.isFinite(dismissedAt) || now - dismissedAt >= MAC_NOTE_SNOOZE_MS || dismissedAt > now;
}

/** Coming up on the web for anyone but the developer: their meetings come from the Calendar app on their Mac (PS reads it there
 *  and keeps a copy in the vault). No Mac yet: one plain line, never a button that cannot work in a browser. */
export const WEB_CAL_NONE = "Your meetings show here once PS app runs on your Mac";
export function webCalLine(copyAt: string | null, now: number): { text: string; tone: "ok"; settings: false; turnOn?: boolean } {
  const at = copyAt ? Date.parse(copyAt) : NaN;
  if (!Number.isFinite(at)) return { text: WEB_CAL_NONE, tone: "ok", settings: false };
  const min = Math.max(0, Math.round((now - at) / 60_000));
  const ago = min < 1 ? "just now" : min < 60 ? `${min} min ago` : min < 1440 ? `${Math.round(min / 60)} h ago` : `${Math.round(min / 1440)} d ago`;
  return { text: `From your Mac's Calendar · ${ago}`, tone: "ok", settings: false };
}

/** Whether this build starts G Squad in the page itself (squad/webhost.ts): the website only, never PS on a Mac, the
 *  phone app or the mobile web app (each starts its own). */
export function webSquadAllowed(o: { mode: string; mobileWeb: boolean }): boolean {
  return o.mode !== "ps" && o.mode !== "gos" && !o.mobileWeb;
}

/** The website's page with no hash: the developer's Today as before; everyone else lands on their list (the QR code's landing). */
export function landingPage(page: string, red: boolean): string {
  return page || (red ? "today" : "todo");
}

/** Browser Back (ui/webback.ts): history entries this page added for open windows (`pushed`) against the windows open
 *  now (`open`). More open: add entries. Fewer (closed with Esc, a click or its x): take ours off again. */
export type BackPlan = { push: number } | { pop: number } | null;
export function backPlan(open: number, pushed: number): BackPlan {
  const o = Math.max(0, Math.floor(open)), p = Math.max(0, Math.floor(pushed));
  if (o > p) return { push: o - p };
  if (o < p) return { pop: p - o };
  return null;
}

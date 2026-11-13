// The website (cincee.com/client) never reloads itself into a new version (the developer, 4 Nov 2026: "click update
// now or something to actually update instead of it just automatically updating for me"). It looks at
// version.json now and then and, when a different build is live, shows a small "New version, Reload" note.
// Pure, so tests/webupdate.test.ts can run it; the note itself is views/WebUpdateNote.tsx.
//
// WEB_COMPAT: raise it by one in the same release as a server change an OLDER page cannot work with
// (a new table shape, a new required field, a changed edge function contract). The build writes it into
// version.json, so a page that is still open with a lower number knows it must be reloaded and says why.
// It still waits for the developer's click.
import { cleanUpdateEvery } from "./updateevery.ts";
export const WEB_COMPAT = 1;

export type WebNote = { kind: "new" } | { kind: "must" } | null;

/** What the live version.json says, taken apart safely (anything odd means "say nothing"). */
export function readLive(x: unknown): { src: string; compat: number } | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.src !== "string" || !/^[0-9a-f]{8,64}$/.test(o.src)) return null;
  const compat = typeof o.compat === "number" && Number.isInteger(o.compat) && o.compat > 0 ? o.compat : 1;
  return { src: o.src, compat };
}

/** The note for this page: none while it runs the live build, "must" when the live build needs a page
 *  this one cannot be, else "new". `mine.src` empty (the dev server) never shows a note. */
export function webNote(mine: { src: string; compat: number }, live: unknown): WebNote {
  const l = readLive(live);
  if (!l || !mine.src || l.src === mine.src) return null;
  return l.compat > mine.compat ? { kind: "must" } : { kind: "new" };
}

/** How often the page looks (version.json is a few bytes on Netlify, not Supabase). 5 minutes since V1.54 on every
 *  platform (the developer, 12 Nov 2026: "can you not change it to every five minutes the update instead of every 30 minutes?"). */
export const LOOK_EVERY = 5 * 60_000;
/** After a look that failed (offline, a server error) the wait doubles: 5, 10, 20, then 30 minutes at most. A look that works goes back to 5. */
export const LOOK_LONGEST = 30 * 60_000;
export function lookDelay(fails: number, everyMin: number = LOOK_EVERY / 60_000): number {
  const base = (cleanUpdateEvery(everyMin) || LOOK_EVERY / 60_000) * 60_000;   // Settings, "Check for updates every" (core/updateevery.ts); Off is never armed (WebUpdateNote)
  if (!(fails > 0)) return base;
  return Math.max(base, Math.min(LOOK_LONGEST, LOOK_EVERY * 2 ** Math.min(Math.floor(fails), 6)));
}
/** Back on the tab: look again only when the wait since the last look is over (at least a minute, and the back off after failures). */
export function lookOnReturn(now: number, last: number, fails: number, everyMin: number = LOOK_EVERY / 60_000): boolean {
  if (now < last) return true;   // a clock that jumped back never stops the looks
  return now - last > Math.max(60_000, fails > 0 ? lookDelay(fails, everyMin) : 0);
}

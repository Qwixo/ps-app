// How often PS looks for an update (V1.54, the developer, 12 Nov 2026: "In the settings options have the option to have the
// different time delays between checking for updates. Have it by default as five minutes, but you can have up to 30
// minutes as well."). One setting for every device, synced in the vault's settings as `updateEvery` (minutes).
// The Mac timer, the website's "New version, Reload" pill and the phone's timer while PS is open all read it; the
// back off after failed looks (5, 10, 20, 30 minutes) stays on top of it, and only ever makes the wait longer.
// Pure (no imports), so tests/updateevery.test.ts can run it.
// Off (0, open source build): no automatic looks anywhere, only a click on Check now (older builds read 0 as 5).
export const UPDATE_EVERY_CHOICES = [5, 10, 15, 30] as const;
export const UPDATE_EVERY_DEFAULT = 5;
export const UPDATE_EVERY_OFF = 0;

/** The minutes to use for whatever was stored: one of the four choices or 0 (Off), anything else (missing, odd, a
 *  number from a newer or older build, a string) is the default 5. */
export function cleanUpdateEvery(x: unknown): number {
  if (x === UPDATE_EVERY_OFF) return UPDATE_EVERY_OFF;
  return typeof x === "number" && (UPDATE_EVERY_CHOICES as readonly number[]).includes(x) ? x : UPDATE_EVERY_DEFAULT;
}

/** "Check for updates every" is Off: nothing looks by itself. */
export const updateChecksOff = (x: unknown): boolean => cleanUpdateEvery(x) === UPDATE_EVERY_OFF;

/** The wait before the next look: the chosen minutes, or the back off after failed looks if that is longer
 *  (5, 10, 20, then 30 minutes at most). Off is never armed by the callers; 5 here only as a safe number. */
export function everyDelayMs(everyMin: unknown, fails: number): number {
  const base = (cleanUpdateEvery(everyMin) || UPDATE_EVERY_DEFAULT) * 60_000;
  if (!(fails > 0)) return base;
  return Math.max(base, Math.min(30 * 60_000, 5 * 60_000 * 2 ** Math.min(Math.floor(fails), 6)));
}

// What's new (V1.36, the developer 5 Nov 2026: "whenever I do an update... I actually want a what's new panel to pop up
// now as well. And it gives a few bullet points as what's new"). After PS (the Mac's Tab list) or the website
// runs a version for the first time, a panel shows that version's patch notes once. Pure, so
// tests/whatsnew.test.ts can run it; the panel is views/WhatsNew.tsx.
//
// The words: ONLY the patch notes the developer approved word for word (Rule Zero, scripts/ps-public.mjs). The build
// bundles them (vite.config.ts, __PS_WHATSNEW__); with none approved for this version there is no panel.
// Once per version: the last version handled is kept on this device (localStorage) and in the synced
// settings (settings.whatsNewSeen), so a panel seen on one device does not come back on another.
// Never on a first install: a device that never ran PS before (no offline copy, no record) only records this version.
// V1.53: an update from ANY older version lists every version it skipped (whatsNewPlan below); a device that ran
// PS before but kept no record of which version (a build before V1.36, the phone, cleared storage) lists the last
// five. tests/notesfromany.test.ts runs every old version's stored state through it.

import { cleanMade } from "./releaseby.ts";

/** `by` (V1.58): who made this release; missing for releases from before V1.58. */
export type WhatsNew = { version: string; keyword: string; notes: string[]; by?: string };
export type WhatsNewStep = "show" | "record" | "quiet";

/** The panel shows at most this many points (the developer: "a few bullet points"; the gate asks for 3 to 6). */
export const MAX_POINTS = 6;
const VER = /^\d{1,3}\.\d{1,3}$/;

/** A version as the developer writes it ("1.36"), anything else is not one. */
export function cleanVersion(v: unknown): string | null {
  return typeof v === "string" && VER.test(v.trim()) ? v.trim() : null;
}

/** 1.9 < 1.10 < 1.36: by numbers, not text. Unknown sorts first. */
export function cmpVersion(a: string | null | undefined, b: string | null | undefined): number {
  const p = (v: string | null | undefined) => (v && VER.test(v) ? v.split(".").map(Number) : [-1, -1]);
  const [x, y] = [p(a), p(b)];
  return x[0] - y[0] || x[1] - y[1];
}
const newest = (...v: (string | null | undefined)[]) => v.reduce<string | null>((m, x) => (x && cmpVersion(x, m) > 0 ? x : m), null);

/** The version last handled on this device or in the synced settings (the newer of the two), or null. */
export function lastSeen(local: unknown, synced: unknown): string | null {
  return newest(cleanVersion(local), cleanVersion(synced));
}

/** The bundled notes, checked again before anything shows: a real version, plain short sentences, no long
 *  dashes (the developer bans them) and nothing that looks like HTML. Any bad point means no panel at all, never a
 *  partly shown list. */
export function cleanWhatsNew(x: unknown): WhatsNew | null {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const version = cleanVersion(o.version);
  if (!version || !Array.isArray(o.notes)) return null;
  const notes = o.notes.filter((n): n is string => typeof n === "string" && !!n.trim()).map((n) => n.trim());
  if (!notes.length || notes.length !== o.notes.length) return null;
  if (notes.some((n) => /[\u2013\u2014<>]/.test(n) || n.length > 300)) return null;
  const keyword = typeof o.keyword === "string" && !/[\u2013\u2014<>]/.test(o.keyword) ? o.keyword.trim().slice(0, 30) : "";
  const made = cleanMade(o);
  return { version, keyword, notes: notes.slice(0, MAX_POINTS), ...(made ? { by: made.by } : {}) };
}

/** The heading: "What's new in V1.36 · Keyword". */
export function whatsNewTitle(w: { version: string; keyword: string }): string {
  return `What's new in V${w.version}${w.keyword ? ` · ${w.keyword}` : ""}`;
}

/** Did this account run PS before this build existed? Any record last changed before the build was made. */
export function accountOlderThan(built: string, updatedAts: Iterable<string | null | undefined>): boolean {
  const b = Date.parse(built);
  if (!Number.isFinite(b)) return false;
  for (const u of updatedAts) { const t = u ? Date.parse(u) : NaN; if (Number.isFinite(t) && t < b) return true; }
  return false;
}

/** How many of the latest versions a device gets when it ran PS before but cannot say which version (V1.53). */
export const UNKNOWN_BACK = 5;

/** What to do for the version this page runs, and which versions to list (V1.53, the developer: an update from ANY older
 *  version lists every version it skipped, newest first, "even if 1.48 for example didn't actually support this"):
 *  show:   an update to a version with approved notes. `since` is the version this device last handled (every
 *          version after it shows); with no `since` and `back` set, this device ran PS before but kept no record
 *          (a build older than V1.36, a phone, cleared storage): the last `back` versions show instead of only the
 *          newest. A version shown on another device (synced record) is not repeated where this device has its
 *          own record; where it has none, the device never showed anything itself, so it lists them anyway.
 *  record: nothing to show (a brand new install, or no approved notes), but remember the version as handled;
 *  quiet:  already handled here or on another device, or an older build than the record.
 *  `deviceRan`: this device had its offline copy before this build first opened it (core/vault.ts, noteDevice).
 *  Where nobody can say (undefined) an account holding data older than this build stands in for it. */
export type WhatsNewPlan = { step: WhatsNewStep; since: string | null; back: number };
export function whatsNewPlan(i: {
  version: string; hasNotes: boolean; localSeen?: string | null; syncedSeen?: string | null; accountOlder: boolean; deviceRan?: boolean;
}): WhatsNewPlan {
  const L = cleanVersion(i.localSeen), S = cleanVersion(i.syncedSeen);
  const rec = newest(L, S);
  const ran = i.deviceRan ?? i.accountOlder;
  const lostRecord = !L && ran;   // ran before, no record of its own
  const none = { since: null, back: 0 };
  if (rec && cmpVersion(rec, i.version) > 0) return { step: "quiet", ...none };            // an older build than the record
  if (rec && !lostRecord && cmpVersion(rec, i.version) >= 0) return { step: "quiet", ...none };   // handled here or elsewhere
  if (lostRecord) return i.hasNotes ? { step: "show", since: S, back: UNKNOWN_BACK } : { step: "record", ...none };
  if (L || (S && i.deviceRan === undefined)) return i.hasNotes ? { step: "show", since: rec, back: 0 } : { step: "record", ...none };   // a known starting point
  return { step: "record", ...none };   // nothing ran here before: a first install shows nothing old
}
export function whatsNewStep(i: {
  version: string; hasNotes: boolean; localSeen?: string | null; syncedSeen?: string | null; accountOlder: boolean; deviceRan?: boolean;
}): WhatsNewStep {
  return whatsNewPlan(i).step;
}

/** The device's own marker that it ran PS before this build first opened its offline copy (localStorage). Written once,
 *  by the first unlock after the page has these rules: "1" the copy was there already, "0" a brand new device. */
export const DEVICE_KEY = "ps.deviceRan";
export function noteDevice(hadCopy: boolean, store: { getItem(k: string): string | null; setItem(k: string, v: string): void }) {
  try { if (store.getItem(DEVICE_KEY) === null) store.setItem(DEVICE_KEY, hadCopy ? "1" : "0"); } catch { /* private window */ }
}
/** true / false as written, undefined when nothing was written (or storage is not there). */
export function deviceRan(store: { getItem(k: string): string | null }): boolean | undefined {
  try { const v = store.getItem(DEVICE_KEY); return v === "1" ? true : v === "0" ? false : undefined; } catch { return undefined; }
}

/** The synced record never goes backwards (an older build on another device must not undo a newer one). */
export function seenToSave(version: string, syncedSeen: string | null | undefined): string | null {
  const s = cleanVersion(syncedSeen);
  return s && cmpVersion(s, version) >= 0 ? null : version;
}

/** settings.whatsNewSeen from the Tab list window (ps.ts cleanLooks): a version, or nothing. */
export function cleanSeen(v: unknown): string | undefined {
  return cleanVersion(v) ?? undefined;
}

/** The device's own record (localStorage key). */
export const LOCAL_KEY = "ps.whatsNewSeen";

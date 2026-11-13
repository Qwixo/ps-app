// Screen time, one record per local day per device: the Mac (PS, bundle ids) and the phone (PS GOS,
// "gos:" + Android package names). Pure helpers so saving, the selectors and the one time split of
// the days both devices wrote into one record can be tested without a vault.
import type { Doc, ScreenTimeApp, ScreenTimeDay, ScreenTimeDevice } from "./model";
import { isProtectedApp } from "./protected.ts";

/** Records from before the phone have no device: they are the Mac's. */
export const stDevice = (d: Pick<ScreenTimeDay, "device">): ScreenTimeDevice => d.device === "gos" ? "gos" : "mac";
/** The phone's app ids always start "gos:" (bridge.ts adds it), so a Mac bundle id never does. */
export const isPhoneApp = (id: string) => id.startsWith("gos:");
/** Which apps a device's record may hold: never 1Password or Signal (golden rule), never the other device's. */
export const belongsTo = (device: ScreenTimeDevice) => (a: ScreenTimeApp) => !isProtectedApp(a.id) && !isProtectedApp(a.name) && isPhoneApp(a.id) === (device === "gos");
const secsOf = (apps: ScreenTimeApp[]) => apps.reduce((n, a) => n + a.secs, 0);

/** One device's records by day (the biggest one if a day was ever saved twice). */
export function daysOf(docs: Doc<ScreenTimeDay>[], device: ScreenTimeDevice): Map<string, Doc<ScreenTimeDay>> {
  const m = new Map<string, Doc<ScreenTimeDay>>();
  for (const d of docs) {
    if (stDevice(d.data) !== device) continue;
    const prev = m.get(d.data.day);
    if (!prev || secsOf(d.data.apps) > secsOf(prev.data.apps)) m.set(d.data.day, d);
  }
  return m;
}

/** Keep the larger count per app (a day's totals only grow). The new list, or null if nothing changed. */
export function mergeApps(old: ScreenTimeApp[], incoming: ScreenTimeApp[], device: ScreenTimeDevice): ScreenTimeApp[] | null {
  const keep = belongsTo(device);
  // Anything the record should not hold (an older record with Signal, say) is a change on its own.
  const kept = old.filter((a) => keep(a) || (device === "mac" && isPhoneApp(a.id) && !isProtectedApp(a.id) && !isProtectedApp(a.name)));
  const merged = new Map(kept.map((a) => [a.id, { ...a }]));
  let changed = kept.length !== old.length;
  for (const a of incoming.filter(keep)) {
    const was = merged.get(a.id);
    if (!was) { merged.set(a.id, { ...a }); changed = true; }
    else if (a.secs > was.secs || a.name !== was.name) { merged.set(a.id, { id: a.id, name: a.name, secs: Math.max(a.secs, was.secs) }); changed = true; }
  }
  return changed ? [...merged.values()].sort((x, y) => y.secs - x.secs) : null;
}

/**
 * The app list to save for a day, or null if nothing changed. A count from the phone's usage events
 * (`exact`, PS GOS V1.31) replaces, once, a count of the same day made the old way: the old way
 * could hold too much (yesterday's evening) and "keep the larger" would have kept that all day.
 * After that the larger count per app wins again, as before.
 */
export function nextApps(ex: Pick<ScreenTimeDay, "apps" | "exact"> | undefined, incoming: ScreenTimeApp[], device: ScreenTimeDevice, exact = false): ScreenTimeApp[] | null {
  if (exact && ex && !ex.exact) return mergeApps([], incoming, device) ?? [];
  return mergeApps(ex?.apps || [], incoming, device);
}

export type StWrite = { id?: string; data: ScreenTimeDay };
/**
 * The days before this fix: both devices wrote one record, so the Mac's record (no device) also
 * holds the phone's apps. Every phone app id starts "gos:", so they are told apart exactly, never
 * by guessing from the name. Idempotent: once a Mac record holds no "gos:" id there is nothing to do.
 * - On the phone: the phone's apps move into that day's phone record (larger count kept), then
 *   leave the Mac's record. Only the phone ever creates a phone record, so two devices never make two.
 * - On the Mac: an app leaves the Mac's record only once that day's phone record already holds it,
 *   so nothing the phone counted is ever lost, and no Mac app is ever touched.
 */
export function planSplit(docs: Doc<ScreenTimeDay>[], device: ScreenTimeDevice, at: string): StWrite[] {
  const phone = daysOf(docs, "gos");
  const out: StWrite[] = [];
  const phoneWrites = new Map<string, StWrite>();
  for (const d of docs) {
    if (stDevice(d.data) !== "mac" || !d.data.apps.some((a) => isPhoneApp(a.id))) continue;
    const day = d.data.day;
    const moving = d.data.apps.filter((a) => isPhoneApp(a.id));
    let gone: Set<string>;
    if (device === "gos") {
      const ex = phoneWrites.get(day)?.data ?? phone.get(day)?.data;
      const merged = mergeApps(ex?.apps || [], moving, "gos");
      if (merged || !ex) {
        const w: StWrite = phoneWrites.get(day) ?? { id: phone.get(day)?.id, data: { day, device: "gos", apps: [], updatedAt: at } };
        w.data = { day, device: "gos", apps: merged ?? ex?.apps ?? [], updatedAt: at };
        phoneWrites.set(day, w);
      }
      gone = new Set(moving.map((a) => a.id));
    } else {
      const held = new Set((phone.get(day)?.data.apps || []).map((a) => a.id));
      gone = new Set(moving.filter((a) => held.has(a.id)).map((a) => a.id));
    }
    if (!gone.size) continue;
    out.push({ id: d.id, data: { ...d.data, device: "mac", apps: d.data.apps.filter((a) => !gone.has(a.id)), updatedAt: at } });
  }
  // The phone record first: the Mac's copy only goes once the phone's is safe.
  return [...[...phoneWrites.values()].filter((w) => w.data.apps.length), ...out];
}

// ---- What the Mac's screen time pop-up says (public PS, 7 Nov 2026) ----
// A friend's PS showed "under 1m", 0m and an empty week: screen time was off on that Mac (ps-mac ScreenTime.swift; until
// V1.40 it was off until someone switched it on) and nothing said so. `on` is PS's switch as PS last reported it
// (psSettings.screenTime): undefined while not known (the website, or a PS too old to say).

/** Screen time is known to be off on this Mac: the pop-up shows the off note with Turn on, the button reads Off. */
export const macStOff = (isPsMac: boolean, on: boolean | undefined) => isPsMac && on === false;
/** The top bar button: today's total, Off when it is off and nothing was counted, else 0m. */
export const macStChip = (secs: number, off: boolean, fmt: (s: number) => string) => secs ? fmt(secs) : off ? "Off" : "0m";
/** The off note, above the Turn on button. */
export const macStOffText = (app: string) => `Screen time is off on this Mac, so nothing is counted. Turn it on and ${app} shows your apps here within a few minutes.`;
/** The Mac's empty day when it is not off: counting (wait a few minutes), or not known (where the switch is). */
export const macStEmptyText = (on: boolean | undefined, app: string) => on
  ? `Screen time is on. ${app} adds your apps here a few minutes after you use them.`
  : `Nothing counted on the Mac yet today. Check screen time is on in ${app}: Settings, Mac settings, Screen time.`;

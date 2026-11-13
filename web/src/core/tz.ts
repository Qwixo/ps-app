// Time zone maths for the Tab list clocks. Everything goes through Intl with the IANA zone names,
// so daylight saving is always right. Formatters are cached: making them is the slow part.

// label: the name the clock shows. orig (V1.43): the name it had before you renamed it, so Reset name can bring
// it back; only there while the clock carries a name of your own.
export type Zone = { id: string; label: string; short: string; orig?: string };
export const ZONES: Zone[] = [
  { id: "America/New_York", label: "Eastern", short: "ET" },
  { id: "America/Chicago", label: "Central", short: "CT" },
  { id: "America/Denver", label: "Mountain", short: "MT" },
  { id: "America/Los_Angeles", label: "Pacific", short: "PT" },
  { id: "Europe/London", label: "London", short: "UK" },
];

// The clocks being shown (V1.40: a list you choose, core/tzzones.ts). The Time zones screen sets it each time it
// draws, so the converter and the people cards name zones the way the list does.
let shown: Zone[] = ZONES;
export function setZoneList(list: Zone[]) { shown = list; }
export function zoneList() { return shown; }
/** True while a clock carries a name of your own (V1.43, core/tzzones.ts renameZone). */
export const isRenamed = (z: Zone) => !!z.orig && z.orig !== z.label;
/** The short name in the top bar, the converter and the clock change lines: a short name of your own when you
 *  gave one ("CET", "Mum"), else the zone's tag ("ET"), else its name. */
export function tagOf(z: Zone): string {
  if (isRenamed(z) && z.label.length <= 8) return z.label;
  return z.short || z.label;
}

/** This device's own zone. */
export const DEVICE_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();

export function validTz(id: string) { try { new Intl.DateTimeFormat("en-US", { timeZone: id }); return true; } catch { return false; } }

// "Your" zone: what every other clock is compared with. Settings > Your time zone (settings.tmHomeTz);
// empty means this device's zone. The Tab list sets it each time it draws.
let home = DEVICE_TZ;
export function setHomeTz(id?: string | null) { home = id && validTz(id) ? id : DEVICE_TZ; }
export function homeTz() { return home; }

const KNOWN: Record<string, string> = {
  "Asia/Dubai": "Dubai (GST)", "Europe/London": "London", "America/New_York": "Eastern",
  "America/Chicago": "Central", "America/Denver": "Mountain", "America/Los_Angeles": "Pacific",
};
const abbrFmt = new Map<string, Intl.DateTimeFormat>();
/** "Dubai (GST)", "Paris (GMT+2)", "Eastern". */
export function tzLabel(id: string) {
  if (KNOWN[id]) return KNOWN[id];
  let f = abbrFmt.get(id);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: id, timeZoneName: "short" }); abbrFmt.set(id, f); }
  const abbr = f.formatToParts(Date.now()).find((p) => p.type === "timeZoneName")?.value || "";
  return `${id.split("/").pop()!.replace(/_/g, " ")}${abbr ? ` (${abbr})` : ""}`;
}
export function homeLabel() { return tzLabel(home); }

/** Zones for the "Your time zone" picker: common ones first, then every zone. */
export const HOME_COMMON = ["Asia/Dubai", "Europe/London", "Europe/Paris", "Europe/Istanbul", "Europe/Moscow",
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Asia/Bangkok", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];
export function allZones(): string[] {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone"); } catch { return HOME_COMMON; }
}

const partsFmt = new Map<string, Intl.DateTimeFormat>();
function pf(tz: string) {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    partsFmt.set(tz, f);
  }
  return f;
}

export type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };
export function wall(ts: number, tz: string): Wall {
  const o: Record<string, number> = {};
  for (const p of pf(tz).formatToParts(ts)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, mo: o.month, d: o.day, h: o.hour % 24, mi: o.minute, s: o.second };
}

/** Minutes ahead of UTC at that moment (London in summer = 60, New York in winter = -300). */
export function offsetMin(ts: number, tz: string) {
  const w = wall(ts, tz);
  return Math.round((Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ts / 1000) * 1000) / 60000);
}

/** A wall clock time in a zone ("17 Oct, 14:00 in New York") to the real moment. */
export function zonedToTs(y: number, mo: number, d: number, h: number, mi: number, tz: string) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ts = guess - offsetMin(guess, tz) * 60000;
  ts = guess - offsetMin(ts, tz) * 60000;   // second pass settles daylight saving edges
  return ts;
}

/** "8h behind", "1h ahead", "same time" (half hours too). */
export function gapLabel(mins: number) {
  if (mins === 0) return "same time";
  const h = Math.abs(mins) / 60;
  const n = Number.isInteger(h) ? `${h}h` : `${Math.floor(h)}h ${Math.abs(mins) % 60}m`;
  return mins < 0 ? `${n} behind` : `${n} ahead`;
}

const timeFmt = new Map<string, Intl.DateTimeFormat>();
export function fmtTime(ts: number, tz: string) {
  let f = timeFmt.get(tz);
  if (!f) { f = new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit" }); timeFmt.set(tz, f); }
  return f.format(ts);
}
const dayFmt = new Map<string, Intl.DateTimeFormat>();
export function fmtDay(ts: number, tz: string) {
  let f = dayFmt.get(tz);
  if (!f) { f = new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }); dayFmt.set(tz, f); }
  return f.format(ts);
}

/** Yesterday / today / tomorrow of a zone compared with yours. */
export function dayShift(ts: number, tz: string) {
  const a = wall(ts, tz), b = wall(ts, home);
  const da = Date.UTC(a.y, a.mo - 1, a.d), db = Date.UTC(b.y, b.mo - 1, b.d);
  return da < db ? "yesterday" : da > db ? "tomorrow" : "";
}

export type Change = { tz: string; at: number; before: number; after: number };
/** The clock time on the wall just before a change, in the old time ("2:00"). */
export function wallBefore(c: Change) {
  const d = new Date(c.at + c.before * 60000);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
export function wallAfter(c: Change) {
  const d = new Date(c.at + c.after * 60000);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
const changeCache = new Map<string, { day: string; c: Change | null }>();
/** The next daylight saving change in a zone (within a year), to the minute. Cached per day. */
export function nextChange(tz: string, now = Date.now()): Change | null {
  const day = new Date(now).toISOString().slice(0, 10);
  const hit = changeCache.get(tz);
  if (hit && hit.day === day) return hit.c && hit.c.at > now ? hit.c : null;
  const start = offsetMin(now, tz);
  let lo = now, hi = 0;
  for (let i = 1; i <= 400; i++) {
    const t = now + i * 86400000;
    if (offsetMin(t, tz) !== start) { hi = t; lo = t - 86400000; break; }
  }
  let c: Change | null = null;
  if (hi) {
    while (hi - lo > 60000) { const m = Math.floor((lo + hi) / 2); if (offsetMin(m, tz) === start) lo = m; else hi = m; }
    const at = Math.floor(hi / 60000) * 60000;   // changes happen on the minute
    c = { tz, at, before: start, after: offsetMin(at, tz) };
  }
  changeCache.set(tz, { day, c });
  return c;
}

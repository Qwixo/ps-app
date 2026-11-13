// PS Fitness other activities (V1.40): a run, a walk, a ride or a swim, logged by hand with its distance and time.
// One small record per activity (kind "fact", owner private, vault key, synced like every Fitness record). Pure
// rules only; the vault side is src/fitness/activity-store.ts. Not a GPS tracker: you type what your watch said.

export type ActKind = "run" | "walk" | "ride" | "swim";
export const ACT_KINDS: { k: ActKind; t: string; one: string }[] = [
  { k: "run", t: "Run", one: "run" }, { k: "walk", t: "Walk", one: "walk" }, { k: "ride", t: "Ride", one: "ride" }, { k: "swim", t: "Swim", one: "swim" },
];
export interface FitActivity {
  kind: ActKind;
  date: string;          // YYYY-MM-DD, your own day
  km: number;            // distance
  secs: number;          // moving time
  at: string;            // last change (the merge keeps the newer)
  device?: "phone" | "mac" | "web";
}
export const MAX_KM = 500, MAX_SECS = 48 * 3600;

export const isAct = (v: unknown): v is ActKind => v === "run" || v === "walk" || v === "ride" || v === "swim";
const okDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function cleanActivity(v: unknown): FitActivity | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || !isAct(o.kind) || !okDay(o.date)) return null;
  const km = Number(o.km), secs = Number(o.secs);
  if (!Number.isFinite(km) || km <= 0 || km > MAX_KM || !Number.isFinite(secs) || secs <= 0 || secs > MAX_SECS) return null;
  const out: FitActivity = { kind: o.kind, date: o.date, km: Math.round(km * 1000) / 1000, secs: Math.round(secs), at: typeof o.at === "string" ? o.at : new Date(0).toISOString() };
  if (o.device === "phone" || o.device === "mac" || o.device === "web") out.device = o.device;
  return out;
}
export const mergeActivity = (a: FitActivity, b: FitActivity) => ((b.at || "") > (a.at || "") ? b : a);

/** "25:30", "1:05:00", "45" (minutes), "45m", "1h 5m", "1h05" -> seconds; null when it cannot be read. */
export function parseTime(s: string): number | null {
  const t = String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  let m = /^(\d{1,2}):([0-5]?\d):([0-5]\d)$/.exec(t);
  if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  m = /^(\d{1,3}):([0-5]\d)$/.exec(t);
  if (m) return +m[1] * 60 + +m[2];
  m = /^(\d{1,3})(?:\.(\d+))?\s*(?:m|min|mins|minutes)?$/.exec(t);
  if (m) return Math.round(parseFloat(`${m[1]}.${m[2] ?? 0}`) * 60) || null;
  m = /^(\d{1,2})\s*h(?:ours?|rs?)?\s*(?:(\d{1,2})\s*(?:m|min|mins|minutes)?)?$/.exec(t);
  if (m) return (+m[1] * 3600 + (m[2] ? +m[2] * 60 : 0)) || null;
  return null;
}
/** "5", "5.2", "5,2", "5 km", "800 m" -> km. */
export function parseKm(s: string): number | null {
  const t = String(s || "").trim().toLowerCase().replace(",", ".");
  let m = /^(\d+(?:\.\d+)?)\s*(?:km|k)?$/.exec(t);
  if (m) { const n = parseFloat(m[1]); return n > 0 && n <= MAX_KM ? n : null; }
  m = /^(\d+(?:\.\d+)?)\s*m$/.exec(t);
  if (m) { const n = parseFloat(m[1]) / 1000; return n > 0 ? n : null; }
  return null;
}
export function fmtTime(secs: number): string {
  const s = Math.max(0, Math.round(secs)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
export function fmtKm(km: number): string {
  return km >= 100 ? String(Math.round(km)) : String(Math.round(km * 100) / 100);
}
/** Seconds per km (lower is faster). */
export const paceOf = (km: number, secs: number) => (km > 0 ? secs / km : Infinity);
/** How it reads for each kind: run and walk "5:06 /km", ride "28.4 km/h", swim "2:05 /100 m". */
export function fmtPace(kind: ActKind, km: number, secs: number): string {
  if (!(km > 0) || !(secs > 0)) return "";
  if (kind === "ride") return `${Math.round((km / (secs / 3600)) * 10) / 10} km/h`;
  if (kind === "swim") return `${fmtTime(secs / (km * 10))} /100 m`;
  return `${fmtTime(secs / km)} /km`;
}
/** The shortest distance a pace best counts for (a 200 m jog is not a pace best). */
export const PACE_MIN_KM: Record<ActKind, number> = { run: 1, walk: 1, ride: 5, swim: 0.2 };
export const actName = (k: ActKind) => ACT_KINDS.find((a) => a.k === k)?.t ?? "Activity";

// Your time zones (V1.40, every account): the clocks on the Time zones screen are a list you choose. Add any
// zone by city, country, name or abbreviation ("Dubai", "UK", "Central European", "CET", "GST"), take off
// any you do not want (the built in Eastern, Central, Mountain, Pacific and London too) and drag them into
// the order you like. Pure functions only, so tests/tzzones.test.ts can check them.
//
// Storage: the whole list is ONE small encrypted vault record (kind "tzzones", owner private, vault key):
// a few dozen bytes per zone, so adding, removing or moving a zone uploads that one small record and nothing
// else. No record yet means the built in list (core/tz.ts ZONES).
//
// V1.43: any clock can be renamed ("Central European" to "CET", "Pacific" to "Mum"). The new name is the zone's
// `label`, so everything that names a zone (the clocks, the top bar, the converter, people on that clock) shows
// it; `orig` keeps the name it had, for Reset name. An old copy of PS that rewrites the list keeps the new name
// and drops `orig` (Reset name then has nothing to go back to, and the name just stays).
import { ZONES, allZones, isRenamed, validTz, type Zone } from "./tz.ts";
export { isRenamed, tagOf } from "./tz.ts";
import { cityOf, cleanName, findZones, fold, near } from "./tzpeople.ts";
import { CITIES, COUNTRIES, OLD_TZ, countryOf } from "./tzplaces.ts";

export type TzZones = { zones: Zone[]; at: string };
export const TZ_ZONES_MAX = 24;
const LABEL_MAX = 40;

// ---------- the record ----------
const ZONE_ID = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/;
const SHORT = /^[A-Za-z0-9+\-:]{0,9}$/;
/** One zone checked: a real IANA zone, a tidy name and a short tag ("CET", "GMT+4"), or null. */
export function cleanZone(v: unknown): Zone | null {
  const o = (v && typeof v === "object" ? v : {}) as { id?: unknown; label?: unknown; short?: unknown; orig?: unknown };
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!ZONE_ID.test(id) || !validTz(id)) return null;
  const orig = cleanName(o.orig).slice(0, LABEL_MAX).trim();
  const label = cleanName(o.label).slice(0, LABEL_MAX).trim() || orig || cityOf(id);
  const short = typeof o.short === "string" && SHORT.test(o.short.trim()) ? o.short.trim() : "";
  return orig && orig !== label ? { id, label, short, orig } : { id, label, short };
}
/** The list checked: real zones only, each once, at most 24, in the order given. */
export function cleanTzZones(v: unknown, at = new Date().toISOString()): TzZones | null {
  const o = (v && typeof v === "object" ? v : {}) as { zones?: unknown; at?: unknown };
  if (!Array.isArray(o.zones)) return null;
  const seen = new Set<string>(), zones: Zone[] = [];
  for (const z of o.zones) {
    const c = cleanZone(z);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id); zones.push(c);
    if (zones.length >= TZ_ZONES_MAX) break;
  }
  const when = typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)) ? o.at : at;
  return { zones, at: when };
}
/** The clocks to show: the saved list, or the built in one when nothing has been saved yet. */
export function zonesOf(rec: TzZones | null | undefined): Zone[] {
  return rec && Array.isArray(rec.zones) ? rec.zones : ZONES;
}
export const sameZones = (a: Zone[], b: Zone[]) =>
  a.length === b.length && a.every((z, i) => z.id === b[i].id && z.label === b[i].label && z.short === b[i].short && (z.orig ?? "") === (b[i].orig ?? ""));

// PS: the Tab list holds no keys, so its saves travel to the main page as one of these (ps.ts runs them).
export type TzZonesOp = { op: "put"; id: string; data: TzZones } | { op: "remove"; id: string };
const okId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v);
export function cleanTzZonesOp(v: unknown): TzZonesOp | null {
  const o = (v && typeof v === "object" ? v : {}) as { op?: unknown; id?: unknown; data?: unknown; kind?: unknown };
  if (!okId(o.id)) return null;
  if (o.op === "remove") return { op: "remove", id: o.id };
  if (o.op !== "put" || o.kind !== "tzzones") return null;
  const data = cleanTzZones(o.data);
  return data ? { op: "put", id: o.id, data } : null;
}

// ---------- changing the list ----------
/** Added at the end (nothing changes when it is already there or the list is full). */
export function addZone(list: Zone[], z: Zone): Zone[] {
  if (list.some((x) => x.id === z.id) || list.length >= TZ_ZONES_MAX) return list;
  return [...list, z];
}
/** Taken off, with where it was (for Undo). */
export function removeZone(list: Zone[], id: string): { list: Zone[]; index: number; zone: Zone | null } {
  const index = list.findIndex((z) => z.id === id);
  if (index < 0) return { list, index: -1, zone: null };
  return { list: list.filter((_, i) => i !== index), index, zone: list[index] };
}
/** Undo: back where it was (or at the end when the list has changed since). */
export function restoreZone(list: Zone[], z: Zone, index: number): Zone[] {
  if (list.some((x) => x.id === z.id) || list.length >= TZ_ZONES_MAX) return list;
  const at = Math.max(0, Math.min(list.length, index));
  return [...list.slice(0, at), z, ...list.slice(at)];
}
/** Dragged: `id` moves to just before `before` (null: to the end). */
export function moveZone(list: Zone[], id: string, before: string | null): Zone[] {
  const z = list.find((x) => x.id === id);
  if (!z || id === before) return list;
  const rest = list.filter((x) => x.id !== id);
  const at = before === null ? rest.length : rest.findIndex((x) => x.id === before);
  if (at < 0) return list;
  const next = [...rest.slice(0, at), z, ...rest.slice(at)];
  return next.every((x, i) => x.id === list[i].id) ? list : next;
}

// ---------- your own names (V1.43) ----------
export const ZONE_NAME_MAX = LABEL_MAX;
/** The name a clock had before you renamed it (its own name when it was never renamed). */
export const defaultName = (z: Zone) => z.orig || z.label;
/** Renamed: the name tidied (spaces, hidden characters) and cut to 40 characters. Empty, or the name it had,
 *  brings the name it had back. Nothing changes for a zone not on the list or a name that is already its name. */
export function renameZone(list: Zone[], id: string, name: string): Zone[] {
  const i = list.findIndex((z) => z.id === id);
  if (i < 0) return list;
  const z = list[i], was = defaultName(z);
  const label = cleanName(name).slice(0, LABEL_MAX).trim() || was;
  if (label === z.label) return list;
  const next: Zone = label === was ? { id: z.id, label, short: z.short } : { id: z.id, label, short: z.short, orig: was };
  return list.map((x, k) => (k === i ? next : x));
}
/** Reset name: the clock's own name back. */
export function resetZoneName(list: Zone[], id: string): Zone[] {
  const z = list.find((x) => x.id === id);
  return z && isRenamed(z) ? renameZone(list, id, "") : list;
}

// ---------- finding a zone to add ----------
// Zones by name and abbreviation. Many abbreviations mean more than one place (IST is India, Israel and
// Ireland; GST is the Gulf, and what the developer calls Dubai), so each one lists every zone it can mean. Each entry:
// the abbreviations, the zone's long name, the name the clock gets, its short tag, and the zones to try in
// order (the first one this device knows wins).
type Named = { abbr: string[]; name: string; label: string; short: string; tz: string[] };
const NAMED: Named[] = [
  { abbr: ["ET", "EST", "EDT"], name: "Eastern Time", label: "Eastern", short: "ET", tz: ["America/New_York"] },
  { abbr: ["CT", "CST", "CDT"], name: "Central Time", label: "Central", short: "CT", tz: ["America/Chicago"] },
  { abbr: ["MT", "MST", "MDT"], name: "Mountain Time", label: "Mountain", short: "MT", tz: ["America/Denver"] },
  { abbr: ["MST"], name: "Arizona Time", label: "Arizona", short: "MST", tz: ["America/Phoenix"] },
  { abbr: ["PT", "PST", "PDT"], name: "Pacific Time", label: "Pacific", short: "PT", tz: ["America/Los_Angeles"] },
  { abbr: ["AKT", "AKST", "AKDT"], name: "Alaska Time", label: "Alaska", short: "AKT", tz: ["America/Anchorage"] },
  { abbr: ["HST", "HT"], name: "Hawaii Time", label: "Hawaii", short: "HST", tz: ["Pacific/Honolulu"] },
  { abbr: ["AT", "AST", "ADT"], name: "Atlantic Time", label: "Atlantic", short: "AT", tz: ["America/Halifax"] },
  { abbr: ["NT", "NST", "NDT"], name: "Newfoundland Time", label: "Newfoundland", short: "NT", tz: ["America/St_Johns"] },
  { abbr: ["GMT", "BST", "UK"], name: "UK Time", label: "London", short: "UK", tz: ["Europe/London"] },
  { abbr: ["UTC", "Z"], name: "Coordinated Universal Time", label: "UTC", short: "UTC", tz: ["UTC", "Etc/UTC"] },
  { abbr: ["WET", "WEST"], name: "Western European Time", label: "Western European", short: "WET", tz: ["Europe/Lisbon"] },
  { abbr: ["CET", "CEST", "MEZ"], name: "Central European Time", label: "Central European", short: "CET", tz: ["Europe/Berlin", "Europe/Paris"] },
  { abbr: ["EET", "EEST"], name: "Eastern European Time", label: "Eastern European", short: "EET", tz: ["Europe/Athens"] },
  { abbr: ["MSK"], name: "Moscow Time", label: "Moscow", short: "MSK", tz: ["Europe/Moscow"] },
  { abbr: ["TRT"], name: "Turkey Time", label: "Turkey", short: "TRT", tz: ["Europe/Istanbul"] },
  { abbr: ["GST"], name: "Gulf Standard Time", label: "Gulf", short: "GST", tz: ["Asia/Dubai"] },
  { abbr: ["GET", "GST"], name: "Georgia Time", label: "Georgia", short: "GET", tz: ["Asia/Yerevan"] },
  { abbr: ["AMT"], name: "Armenia Time", label: "Armenia", short: "AMT", tz: ["Asia/Yerevan"] },
  { abbr: ["AZT"], name: "Azerbaijan Time", label: "Azerbaijan", short: "AZT", tz: ["Asia/Baku"] },
  { abbr: ["PKT"], name: "Pakistan Time", label: "Pakistan", short: "PKT", tz: ["Asia/Karachi"] },
  { abbr: ["IST"], name: "India Standard Time", label: "India", short: "IST", tz: ["Asia/Kolkata", "Asia/Calcutta"] },
  { abbr: ["IST"], name: "Irish Time", label: "Ireland", short: "IST", tz: ["Europe/Dublin"] },
  { abbr: ["IDT", "IST"], name: "Israel Time", label: "Israel", short: "IST", tz: ["Asia/Jerusalem"] },
  { abbr: ["NPT"], name: "Nepal Time", label: "Nepal", short: "NPT", tz: ["Asia/Kathmandu", "Asia/Katmandu"] },
  { abbr: ["BST"], name: "Bangladesh Time", label: "Bangladesh", short: "BST", tz: ["Asia/Dhaka"] },
  { abbr: ["ICT"], name: "Indochina Time", label: "Indochina", short: "ICT", tz: ["Asia/Bangkok"] },
  { abbr: ["WIB"], name: "Western Indonesia Time", label: "Jakarta", short: "WIB", tz: ["Asia/Jakarta"] },
  { abbr: ["SGT"], name: "Singapore Time", label: "Singapore", short: "SGT", tz: ["Asia/Singapore"] },
  { abbr: ["MYT"], name: "Malaysia Time", label: "Malaysia", short: "MYT", tz: ["Asia/Kuala_Lumpur"] },
  { abbr: ["HKT"], name: "Hong Kong Time", label: "Hong Kong", short: "HKT", tz: ["Asia/Hong_Kong"] },
  { abbr: ["PHT", "PST"], name: "Philippine Time", label: "Philippines", short: "PHT", tz: ["Asia/Manila"] },
  { abbr: ["CST"], name: "China Standard Time", label: "China", short: "CST", tz: ["Asia/Shanghai"] },
  { abbr: ["JST"], name: "Japan Time", label: "Japan", short: "JST", tz: ["Asia/Tokyo"] },
  { abbr: ["KST"], name: "Korea Time", label: "Korea", short: "KST", tz: ["Asia/Seoul"] },
  { abbr: ["AWST"], name: "Western Australia Time", label: "Perth", short: "AWST", tz: ["Australia/Perth"] },
  { abbr: ["ACST", "ACDT"], name: "Central Australia Time", label: "Adelaide", short: "ACT", tz: ["Australia/Adelaide"] },
  { abbr: ["AEST", "AEDT", "AET"], name: "Eastern Australia Time", label: "Sydney", short: "AET", tz: ["Australia/Sydney"] },
  { abbr: ["NZST", "NZDT", "NZT"], name: "New Zealand Time", label: "New Zealand", short: "NZT", tz: ["Pacific/Auckland"] },
  { abbr: ["WAT"], name: "West Africa Time", label: "West Africa", short: "WAT", tz: ["Africa/Lagos"] },
  { abbr: ["CAT"], name: "Central Africa Time", label: "Central Africa", short: "CAT", tz: ["Africa/Maputo"] },
  { abbr: ["EAT"], name: "East Africa Time", label: "East Africa", short: "EAT", tz: ["Africa/Nairobi"] },
  { abbr: ["SAST"], name: "South Africa Time", label: "South Africa", short: "SAST", tz: ["Africa/Johannesburg"] },
  { abbr: ["BRT"], name: "Brasilia Time", label: "Brazil", short: "BRT", tz: ["America/Sao_Paulo"] },
  { abbr: ["ART"], name: "Argentina Time", label: "Argentina", short: "ART", tz: ["America/Argentina/Buenos_Aires", "America/Buenos_Aires"] },
  { abbr: ["CLT"], name: "Chile Time", label: "Chile", short: "CLT", tz: ["America/Santiago"] },
  { abbr: ["COT"], name: "Colombia Time", label: "Colombia", short: "COT", tz: ["America/Bogota"] },
  { abbr: ["PET"], name: "Peru Time", label: "Peru", short: "PET", tz: ["America/Lima"] },
  { abbr: ["CST"], name: "Mexico City Time", label: "Mexico City", short: "CST", tz: ["America/Mexico_City"] },
];

const shortFmt = new Map<string, Intl.DateTimeFormat>();
/** A zone's short tag: its usual abbreviation when it has one, else what the system says ("GMT+4"). */
export function shortOf(tz: string, ts = Date.now()): string {
  const own = NAMED.find((n) => n.tz[0] === tz || n.tz.includes(tz));
  if (own) return own.short;
  let f = shortFmt.get(tz);
  try {
    if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }); shortFmt.set(tz, f); }
    const v = f.formatToParts(ts).find((p) => p.type === "timeZoneName")?.value || "";
    return SHORT.test(v) ? v : "";
  } catch { return ""; }
}

/** A zone you can add: the clock's name, its tag, and a line saying what it is ("Central European Time"). */
export type ZoneChoice = { tz: string; label: string; short: string; about: string };
// Countries and cities folded once (core/tzplaces.ts), not on every key typed.
const NEW_TZ = new Map(Object.entries(OLD_TZ).map(([now, old]) => [old, now]));
let folded: { countries: { names: string[]; tz: string[]; name: string }[]; cities: { label: string; f: string; find: string; tz: string }[] } | null = null;
function places() {
  return folded ??= {
    countries: COUNTRIES.map((c) => ({ names: [c.name, ...c.also].map(fold), tz: c.tz, name: c.name })),
    cities: CITIES.map((c) => ({ label: c.label, f: fold(c.label), find: fold(c.find), tz: c.tz })),
  };
}
/** How well a typed place matches a place's names: the whole name, the start of it, the start of a word, one slip. */
function placeScore(q: string, names: string[], top: number): number {
  if (names.some((n) => n === q)) return top;
  if (q.length < 3) return 0;
  if (names.some((n) => n.startsWith(q))) return top - 10;
  if (names.some((n) => n.split(" ").some((w) => w.startsWith(q)))) return top - 20;
  if (q.length >= 5 && names.some((n) => near(q, n.slice(0, q.length + 1), 1) || near(q, n.slice(0, q.length), 1))) return top - 44;
  return 0;
}

/** Zones for what was typed: an abbreviation ("CET", "GST", "pst"), a zone's name ("central european"), a
 *  country ("Thailand", "USA", "Australia": every zone it has, the main cities first), a city in any country
 *  ("Chiang Mai", "Houston", "Hanoi"), a region ("Pacific", "Bali") or part of the zone's id. Best first, each
 *  zone once. Works offline: the countries and cities ship with the app (core/tzplaces.ts). */
export function findZoneChoices(query: string, zones: string[] = allZones(), limit = 8): ZoneChoice[] {
  const q = fold(query);
  if (!q) return [];
  const known = new Set(zones);
  const has = (id: string) => known.has(id) || validTz(id);
  // A zone by the name this device uses for it (some still say Asia/Saigon for Asia/Ho_Chi_Minh).
  const pick = (id: string) => {
    const old = OLD_TZ[id];
    return known.has(id) ? id : old && known.has(old) ? old : validTz(id) ? id : old && validTz(old) ? old : null;
  };
  const out = new Map<string, { c: ZoneChoice; score: number; i: number }>();
  let i = 0;
  const add = (c: ZoneChoice, score: number) => {
    if (!score) return;
    const key = NEW_TZ.get(c.tz) ?? c.tz;   // one line per zone, whatever name it came by
    const have = out.get(key);
    if (!have || score > have.score) out.set(key, { c, score, i: i++ });
  };
  const namedOf = (tz: string) => NAMED.find((n) => n.tz.find(has) === tz);
  const what = (tz: string) => {
    const country = countryOf(NEW_TZ.get(tz) ?? tz), named = namedOf(tz);
    return [country?.name, named ? named.name : cityOf(NEW_TZ.get(tz) ?? tz)].filter(Boolean).join(" · ");
  };
  for (const n of NAMED) {
    const tz = n.tz.find(has);
    if (!tz) continue;
    const name = fold(n.name), label = fold(n.label);
    const qw = q.split(" ");
    const score = n.abbr.some((a) => fold(a) === q) ? 100
      : label === q ? 97
      : q.length >= 3 && name.startsWith(q) ? 90
      : q.length >= 3 && label.startsWith(q) ? 88
      : q.length >= 3 && qw.every((w) => name.split(" ").some((x) => x.startsWith(w))) ? 72 : 0;
    add({ tz, label: n.label, short: n.short, about: `${n.name} · ${cityOf(tz)}` }, score);
  }
  // Cities, countries and regions (core/tzpeople.ts findZones): a place typed exactly first, then in its order.
  // When what was typed is an abbreviation ("ist"), only places whose name starts with it, not every zone id
  // that happens to hold those letters (America/Boa_Vista).
  const abbr = NAMED.some((n) => n.abbr.some((a) => fold(a) === q));
  findZones(query, zones, limit + 4).forEach((h, k) => {
    const place = h.via || h.city;
    if (abbr && !fold(place).split(" ").some((w) => w.startsWith(q))) return;
    add({ tz: h.tz, label: place, short: shortOf(h.tz), about: what(h.tz) || h.tz }, fold(place) === q ? 98 : 80 - k);
  });
  // Countries: every zone of the country, in the order of the table (main cities first, rare zones last). A
  // country with one zone gives a clock named after the country ("Thailand"), else after each city.
  const { countries, cities } = places();
  for (const c of countries) {
    const s = placeScore(q, c.names, 96);
    if (!s) continue;
    const tzs = c.tz.map(pick).filter((x): x is string => !!x);
    tzs.forEach((tz, k) => add({ tz, label: tzs.length === 1 ? c.name : cityOf(NEW_TZ.get(tz) ?? tz), short: shortOf(tz), about: what(tz) }, s - k / 10));
  }
  // Big cities in every country that are not a zone of their own ("Chiang Mai", "Houston", "Hanoi").
  for (const c of cities) {
    const s = placeScore(q, c.f === c.find ? [c.f] : [c.f, c.find], 95);
    if (!s) continue;
    const tz = pick(c.tz);
    if (tz) add({ tz, label: c.label, short: shortOf(tz), about: what(tz) }, s);
  }
  return [...out.values()].sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map((x) => x.c);
}

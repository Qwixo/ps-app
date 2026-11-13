// Time zone people (V1.39): names the developer (or anyone) adds on the Time zones screen, each with the zone they
// live in, so "Alex" or "Mum" shows up next to the real clients and can be searched for. Pure
// functions only, so tests/tzpeople.test.ts can check them: the forgiving name matching, the city to
// zone lookup ("Vancouver" finds America/Vancouver) and the record checks.
//
// Storage: one small encrypted vault record per person (kind "tzperson", owner private, vault key), so
// adding, renaming or moving one person uploads that one record and nothing else. They are never client
// records: nothing appears in the client vault, no workspace is made.
import { allZones, validTz, zoneList } from "./tz.ts";

export type TzPerson = { name: string; tz: string; at: string };
export const TZ_NAME_MAX = 80;

// ---------- the record ----------
const ZONE_ID = /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/;
/** A name as it is kept: spaces tidied, no control characters, at most 80 characters. Empty when nothing is left. */
export function cleanName(v: unknown): string {
  if (typeof v !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, " ").replace(/\s+/g, " ").trim().slice(0, TZ_NAME_MAX).trim();
}
/** A person record checked: a name and a real IANA zone, or null. */
export function cleanTzPerson(v: unknown, at = new Date().toISOString()): TzPerson | null {
  const o = (v && typeof v === "object" ? v : {}) as { name?: unknown; tz?: unknown; at?: unknown };
  const name = cleanName(o.name);
  const tz = typeof o.tz === "string" ? o.tz.trim() : "";
  if (!name || !ZONE_ID.test(tz) || !validTz(tz)) return null;
  const when = typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)) ? o.at : at;
  return { name, tz, at: when };
}

// PS: the Tab list holds no keys, so its saves travel to the main page as one of these (ps.ts runs them).
export type TzOp = { op: "put"; id: string; data: TzPerson } | { op: "remove"; id: string };
const okId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v);
export function cleanTzOp(v: unknown): TzOp | null {
  const o = (v && typeof v === "object" ? v : {}) as { op?: unknown; id?: unknown; data?: unknown; kind?: unknown };
  if (!okId(o.id)) return null;
  if (o.op === "remove") return { op: "remove", id: o.id };
  if (o.op !== "put" || (o.kind !== undefined && o.kind !== "tzperson")) return null;
  const data = cleanTzPerson(o.data);
  return data ? { op: "put", id: o.id, data } : null;
}

// ---------- forgiving text ----------
/** Lower case, accents off ("Zoë" is "zoe", "Łukasz" is "lukasz"), anything else between words is one space. */
export function fold(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ł/gi, "l").replace(/ø/gi, "o").replace(/ß/g, "ss").replace(/æ/gi, "ae")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
/** Edit distance with a swap of two letters counting as one (stops early past `max`). */
export function near(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      best = Math.min(best, d[i][j]);
    }
    if (best > max) return false;
  }
  return d[a.length][b.length] <= max;
}
/** The letters typed appear in order and close together ("pltte" in "alex"), not scattered across a long name. */
function tightSubseq(q: string, s: string): boolean {
  for (let start = s.indexOf(q[0]); start >= 0; start = s.indexOf(q[0], start + 1)) {
    let i = 0, j = start;
    for (; j < s.length && i < q.length; j++) if (s[j] === q[i]) i++;
    if (i === q.length && j - start <= Math.ceil(q.length * 1.6)) return true;
  }
  return false;
}

/** How well a typed name matches a name: 0 is no match, 100 the same name. Case, accents, word order,
 *  part words, initials ("pk") and one slip of the finger ("pualette") all still match. */
export function nameScore(query: string, name: string): number {
  const q = fold(query), n = fold(name);
  if (!q || !n) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 92 - Math.min(10, n.length - q.length) / 10;
  const qw = q.split(" "), nw = n.split(" ");
  // Every word typed starts a word of the name, in any order ("kap paul", "paul k").
  if (qw.every((w) => nw.some((x) => x.startsWith(w)))) return 80 - (nw.findIndex((x) => x.startsWith(qw[0])) > 0 ? 4 : 0);
  const qc = q.replace(/ /g, ""), nc = n.replace(/ /g, "");
  if (qc.length >= 2 && nc.includes(qc)) return 64;
  if (qc.length >= 2 && nw.length > 1 && nw.map((x) => x[0]).join("").startsWith(qc)) return 56;   // initials
  // One slip per word typed (two in a long word, none under 4 letters), against the start of a word of the name.
  if (qw.every((w) => w.length >= 4 && nw.some((x) => {
    const max = w.length >= 7 ? 2 : 1;
    return [w.length - 1, w.length, w.length + 1].some((k) => k >= 4 && near(w, x.slice(0, k), max));
  }))) return 40;
  if (qc.length >= 3 && tightSubseq(qc, nc)) return 20 + Math.round(10 * qc.length / nc.length);
  return 0;
}

export type PersonEntry = { key: string; name: string; tz: string | null; kind: "client" | "person"; id: string };
/** The best matches for what was typed, best first (equal ones by name). */
export function searchPeople(query: string, list: PersonEntry[], limit = 8): (PersonEntry & { score: number })[] {
  return list.map((e) => ({ ...e, score: nameScore(query, e.name) })).filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || (a.tz ? 0 : 1) - (b.tz ? 0 : 1) || a.name.localeCompare(b.name)).slice(0, limit);
}

// ---------- finding a zone by city ----------
// Places people type that are not a zone's own city. Each points at zones to try in order (the first one this
// device knows wins, since older systems name a few zones differently).
const CITY_ALIASES: [string, string[]][] = [
  ["San Francisco", ["America/Los_Angeles"]], ["Seattle", ["America/Los_Angeles"]], ["Portland", ["America/Los_Angeles"]], ["San Diego", ["America/Los_Angeles"]],
  ["Las Vegas", ["America/Los_Angeles"]], ["Los Angeles", ["America/Los_Angeles"]], ["LA", ["America/Los_Angeles"]], ["SF", ["America/Los_Angeles"]],
  ["Salt Lake City", ["America/Denver"]], ["Calgary", ["America/Edmonton"]], ["Dallas", ["America/Chicago"]], ["Houston", ["America/Chicago"]],
  ["Austin", ["America/Chicago"]], ["Minneapolis", ["America/Chicago"]], ["Nashville", ["America/Chicago"]], ["New Orleans", ["America/Chicago"]],
  ["Boston", ["America/New_York"]], ["Miami", ["America/New_York"]], ["Atlanta", ["America/New_York"]], ["Washington", ["America/New_York"]],
  ["Philadelphia", ["America/New_York"]], ["NYC", ["America/New_York"]], ["Orlando", ["America/New_York"]], ["Ottawa", ["America/Toronto"]],
  ["Montreal", ["America/Toronto"]], ["Honolulu", ["Pacific/Honolulu"]], ["Hawaii", ["Pacific/Honolulu"]],
  ["Manchester", ["Europe/London"]], ["Birmingham", ["Europe/London"]], ["Edinburgh", ["Europe/London"]], ["Glasgow", ["Europe/London"]],
  ["Liverpool", ["Europe/London"]], ["Leeds", ["Europe/London"]], ["Bristol", ["Europe/London"]], ["Cardiff", ["Europe/London"]],
  ["Munich", ["Europe/Berlin"]], ["Hamburg", ["Europe/Berlin"]], ["Frankfurt", ["Europe/Berlin"]], ["Barcelona", ["Europe/Madrid"]],
  ["Milan", ["Europe/Rome"]], ["Geneva", ["Europe/Zurich"]], ["Kyiv", ["Europe/Kyiv", "Europe/Kiev"]], ["Kiev", ["Europe/Kyiv", "Europe/Kiev"]],
  ["St Petersburg", ["Europe/Moscow"]], ["Saint Petersburg", ["Europe/Moscow"]], ["Batumi", ["Asia/Yerevan"]],
  ["Abu Dhabi", ["Asia/Dubai"]], ["Doha", ["Asia/Qatar"]], ["Tel Aviv", ["Asia/Jerusalem"]], ["Mumbai", ["Asia/Kolkata", "Asia/Calcutta"]],
  ["Delhi", ["Asia/Kolkata", "Asia/Calcutta"]], ["New Delhi", ["Asia/Kolkata", "Asia/Calcutta"]], ["Bangalore", ["Asia/Kolkata", "Asia/Calcutta"]],
  ["Kolkata", ["Asia/Kolkata", "Asia/Calcutta"]], ["Beijing", ["Asia/Shanghai"]], ["Shenzhen", ["Asia/Shanghai"]], ["Osaka", ["Asia/Tokyo"]],
  ["Ho Chi Minh City", ["Asia/Ho_Chi_Minh", "Asia/Saigon"]], ["Saigon", ["Asia/Ho_Chi_Minh", "Asia/Saigon"]], ["Bali", ["Asia/Makassar"]],
  ["Canberra", ["Australia/Sydney"]], ["Gold Coast", ["Australia/Brisbane"]], ["Wellington", ["Pacific/Auckland"]], ["Cape Town", ["Africa/Johannesburg"]],
  ["Rio de Janeiro", ["America/Sao_Paulo"]], ["Rio", ["America/Sao_Paulo"]], ["Buenos Aires", ["America/Argentina/Buenos_Aires", "America/Buenos_Aires"]],
  ["Medellin", ["America/Bogota"]], ["Cancun", ["America/Cancun"]], ["Kathmandu", ["Asia/Kathmandu", "Asia/Katmandu"]],
  ["Eastern", ["America/New_York"]], ["Central", ["America/Chicago"]], ["Mountain", ["America/Denver"]], ["Pacific", ["America/Los_Angeles"]],
  ["UK", ["Europe/London"]], ["England", ["Europe/London"]], ["Scotland", ["Europe/London"]], ["Ireland", ["Europe/Dublin"]],
  ["Georgia", ["Asia/Yerevan"]], ["UAE", ["Asia/Dubai"]], ["Japan", ["Asia/Tokyo"]], ["India", ["Asia/Kolkata", "Asia/Calcutta"]],
  ["China", ["Asia/Shanghai"]], ["France", ["Europe/Paris"]], ["Germany", ["Europe/Berlin"]], ["Spain", ["Europe/Madrid"]], ["Italy", ["Europe/Rome"]],
];

/** "Vancouver" from "America/Vancouver", "Buenos Aires" from "America/Argentina/Buenos_Aires". */
export function cityOf(tz: string) { return tz.split("/").pop()!.replace(/_/g, " "); }

export type ZoneHit = { tz: string; city: string; via?: string };
let zoneCache: { list: string[]; names: { tz: string; city: string; f: string; id: string }[] } | null = null;
function zoneNames(zones: string[]) {
  if (zoneCache && zoneCache.list === zones) return zoneCache.names;
  const names = zones.filter((z) => z.includes("/") && !z.startsWith("Etc/") && !z.startsWith("SystemV/"))
    .map((tz) => ({ tz, city: cityOf(tz), f: fold(cityOf(tz)), id: fold(tz) }));
  zoneCache = { list: zones, names };
  return names;
}
/** Zones for what was typed: a city ("Vancouver", "san fran", "zurich"), a country or region word from the
 *  list above ("UK", "Pacific"), or part of the zone's own name ("Europe/Lis"). Best first. */
export function findZones(query: string, zones: string[] = allZones(), limit = 8): ZoneHit[] {
  const q = fold(query);
  if (!q) return [];
  const best = new Map<string, { hit: ZoneHit; score: number }>();
  const add = (tz: string, city: string, score: number, via?: string) => {
    if (!score) return;
    const have = best.get(tz);
    if (via && fold(via) === fold(city)) via = undefined;
    if (!have || score > have.score) best.set(tz, { hit: via ? { tz, city, via } : { tz, city }, score });
  };
  const known = new Set(zones);
  const score = (f: string) => {
    if (f === q) return 100;
    if (f.startsWith(q)) return 85;
    if (f.split(" ").some((w) => w.startsWith(q))) return 70;
    return 0;
  };
  for (const z of zoneNames(zones)) {
    add(z.tz, z.city, score(z.f) || (q.length >= 3 && z.id.includes(q) ? 45 : 0) || (q.length >= 4 && near(q, z.f.slice(0, q.length + 1), 1) ? 30 : 0));
  }
  for (const [place, ids] of CITY_ALIASES) {
    const tz = ids.find((id) => known.has(id) || validTz(id));
    if (!tz) continue;
    const f = fold(place);
    // Short words (UK, LA, SF, NYC) only match exactly, so "la" still finds La Paz first.
    const s = f.length <= 3 ? (f === q ? 99 : 0) : score(f);
    add(tz, cityOf(tz), s && s - 1, place);
  }
  // One line per place: some systems list an old name too (America/Buenos_Aires and America/Argentina/Buenos_Aires).
  const seen = new Set<string>();
  return [...best.values()].sort((a, b) => b.score - a.score || a.hit.city.length - b.hit.city.length || a.hit.city.localeCompare(b.hit.city))
    .filter((x) => { const k = fold(x.hit.via || x.hit.city); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, limit).map((x) => x.hit);
}

// ---------- words ----------
/** "7 h behind you", "5 h 30 m ahead of you", "same time as you". */
export function gapWords(mins: number) {
  if (mins === 0) return "same time as you";
  const a = Math.abs(mins), h = Math.floor(a / 60), m = a % 60;
  const n = h && m ? `${h} h ${m} m` : h ? `${h} h` : `${m} m`;
  return mins < 0 ? `${n} behind you` : `${n} ahead of you`;
}
/** A zone's name for people: the name it has on your list of clocks ("Eastern"), else the city. */
export function zoneTitle(tz: string) { return zoneList().find((z) => z.id === tz)?.label || cityOf(tz); }

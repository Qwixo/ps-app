// Alarm playlists (V1.47). The developer, 10 Nov 2026: "add a bunch of audio files so it goes through all these audio files one
// after another, randomly or in order, so every day there is a different audio file, so we can wake up to a
// motivational speaker and it automatically plays it as an alarm sound."
// Pure rules here (tests/alarmlist.test.ts). The page (sleepmode/list.ts, views/SleepWake.tsx) keeps the list, the Mac
// (ps-mac SleepSound.swift, SleepScreen.swift) and the phone (ps-gos Sleep.kt) play the day's file from the plan.
//
// How the day's file is chosen: by the calendar, so every device works it out alone and always agrees, with nothing
// to sync each morning. The list holds one "cycle": `start` (a day) and `order` (the files in the order they play, one
// a day). Day `start` plays order[0], the next day order[1], and so on. When a cycle is used up the next one begins
// the day after: in order, the list again from file 1; random, the files shuffled again (from a seed every device
// shares, so they shuffle the same way), never the same file twice in a row across the change.
// Days pass whether an alarm rang or not: "every day there is a different audio file".
// Editing keeps today's file where it is: a file added mid cycle joins what is still to play this cycle, a removed one
// leaves it (and today's moves on to the next one only when today's own file was removed), reordering in order mode
// changes only what is still to come.
//
// The files: each device keeps its own copy (like your own sound, V1.44), never uploaded, never in the vault, so the
// free Supabase egress does not move at all. The list itself (names, lengths, the order, the cycle) is synced in the
// vault settings (sleepMode.wake.list, a few KB). A file's id is the start of its SHA-256, so the same file added on
// the Mac and on the phone is the same entry, and each device shows which files it has.

export type ListOrder = "seq" | "random";
export type ListEnd = "whole" | "loop";
export interface Track { id: string; name: string; secs: number; bytes: number; ext: string }
export interface AlarmList {
  on: boolean;           // the alarms play today's file instead of your own sound or the built in one
  order: ListOrder;      // "A different one each day, in order" or "Random each day"
  end: ListEnd;          // "Play the whole file" or "Loop until I stop it"
  fade: number;          // seconds the file fades in over (0: none; FADES)
  tracks: Track[];       // My library: every alarm audio added, in the user's order (V1.47, the developer: "a library of these alarms")
  skip: string[];        // library files NOT ticked into the playlist (new ones go in unless added as "library only")
  seed: string;          // random mode's shuffles start from it (every device the same)
  start: string;         // the day the current cycle began, YYYY-MM-DD (empty: no cycle yet)
  cycle: string[];       // the current cycle's order: ids, one a day from `start`
}
export const MAX_TRACKS = 60;
export const MAX_MB = 100;
export const FADES = [0, 10, 30, 60];
export const EXTS = ["mp3", "m4a", "wav", "aac", "aiff", "aif", "flac", "ogg", "oga", "opus", "caf"];
export const ACCEPT = ".mp3,.m4a,.wav,.aac,.aiff,.aif,.flac,.ogg,.oga,.opus,.caf,audio/*";
/** The longest a "Play the whole file" alarm keeps ringing (a 3 hour talk is cut there). Loop rings the usual 10 min. */
export const WHOLE_MAX_MS = 3 * 3600_000;
export const RING_MS = 10 * 60_000;
/** How long a Preview of one file plays (Stop and Esc end it sooner). */
export const PREVIEW_MS = 30_000;
export const LIST_DEF: AlarmList = { on: false, order: "seq", end: "loop", fade: 0, tracks: [], skip: [], seed: "", start: "", cycle: [] };

// ---------- days ----------
const DAY = 86_400_000;
const okDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d\d-\d\d$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`));
/** A day as a whole number (days since 1970), for the maths. */
export const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);
export const dayStr = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
/** The day it is at `ms` on the clock of `tz` (the alarm's own clock). */
export function dayIn(ms: number, tz: string): string {
  try {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    return `${g("year")}-${g("month")}-${g("day")}`;
  } catch { return new Date(ms).toISOString().slice(0, 10); }
}

// ---------- a shared shuffle ----------
/** A small hash of a string (FNV-1a), the seed of the shuffle. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** A random number maker from a seed (mulberry32): the same seed gives the same numbers on every device. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** The ids shuffled from `seed` (Fisher Yates). */
export function shuffle(ids: string[], seed: string): string[] {
  const out = ids.slice(), r = rng(hash32(seed));
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

// ---------- cycles ----------
/** The playlist: the library's files that are ticked, in library order. Every day's pick comes from these. */
export const playlistOf = (l: Pick<AlarmList, "tracks" | "skip">): Track[] => l.tracks.filter((t) => !l.skip.includes(t.id));
/** A new cycle's order, beginning on `day`. In order: the playlist. Random: shuffled, and never starting with `last`
 *  (the file the cycle before ended on) when there are two or more. */
export function newCycle(l: Pick<AlarmList, "order" | "tracks" | "skip" | "seed">, day: string, last?: string | null): string[] {
  const ids = playlistOf(l).map((t) => t.id);
  if (l.order === "seq") return ids;
  const o = shuffle(ids, `${l.seed}|${day}`);
  if (o.length > 1 && last && o[0] === last) [o[0], o[1]] = [o[1], o[0]];
  return o;
}
/** The list moved on to `day`: whole cycles that ended before it are replaced by the next ones (as many as needed).
 *  Nothing changes when `day` is inside the current cycle. A playlist with no files has no cycle. */
export function rollTo(l: AlarmList, day: string): AlarmList {
  const pl = playlistOf(l);
  if (!pl.length) return l.start || l.cycle.length ? { ...l, start: "", cycle: [] } : l;
  let start = okDay(l.start) ? l.start : day, cycle = l.cycle.length ? l.cycle : newCycle(l, start);
  if (!okDay(l.start) || !l.cycle.length) return { ...l, start, cycle };
  const target = dayNum(day);
  let s = dayNum(start);
  if (target < s) return l;   // a clock behind the one that started it: the cycle's first day plays (pickFor)
  // In order every cycle is the same, so long gaps jump straight there; random rolls one cycle at a time (bounded).
  if (l.order === "seq" && target - s >= cycle.length) {
    const ids = pl.map((t) => t.id);
    const skip = Math.floor((target - s - cycle.length) / ids.length);
    s = s + cycle.length + skip * ids.length;
    return { ...l, start: dayStr(s), cycle: ids };
  }
  for (let i = 0; i < 5000 && target - s >= cycle.length; i++) {
    const last = cycle[cycle.length - 1];
    s += cycle.length;
    cycle = newCycle(l, dayStr(s), last);
  }
  start = dayStr(s);
  return start === l.start && cycle === l.cycle ? l : { ...l, start, cycle };
}
export interface DayPick { id: string; name: string; secs: number; n: number; of: number; day: string }
/** The file for `day`: its name, and where it sits in the playlist ("file 3 of 7"). Null: no files. */
export function pickFor(l: AlarmList, day: string): DayPick | null {
  const r = rollTo(l, day);
  if (!r.cycle.length) return null;
  const k = Math.max(0, dayNum(day) - dayNum(r.start));
  const id = r.cycle[Math.min(k, r.cycle.length - 1)];
  const pl = playlistOf(r), i = pl.findIndex((t) => t.id === id);
  if (i < 0) return null;
  return { id, name: pl[i].name, secs: pl[i].secs, n: i + 1, of: pl.length, day };
}

// ---------- editing (`today`: the editing device's day) ----------
const dedupe = (ids: string[]) => ids.filter((x, i) => ids.indexOf(x) === i);
/** Where today sits in the (rolled) cycle. */
const todayK = (l: AlarmList, today: string) => Math.max(0, dayNum(today) - dayNum(l.start));
/** Files that just joined the playlist go into what is still to play this cycle: in order at the end, random each at
 *  a shared random spot. Today's file stays today's. `l` already holds them in tracks and not in skip. */
function joinCycle(l0: AlarmList, ids: string[], today: string): AlarmList {
  const fresh = ids.filter((x) => !l0.cycle.includes(x));
  if (!fresh.length) return rollTo(l0, today);
  const before = { ...l0, skip: [...l0.skip, ...fresh] };   // the cycle as it was, without them
  const l = rollTo(before, today);
  if (!l.cycle.length) return rollTo({ ...l, skip: l0.skip, start: today, cycle: [] }, today);
  const k = todayK(l, today);
  const done = l.cycle.slice(0, k + 1), rest = l.cycle.slice(k + 1);
  for (const id of fresh) {
    if (l.order === "seq") rest.push(id);
    else rest.splice(Math.floor(rng(hash32(`${l.seed}|add|${id}`))() * (rest.length + 1)), 0, id);
  }
  return { ...l, skip: l0.skip, cycle: [...done, ...rest] };
}
/** A file that left the playlist: one that already played this cycle shifts the start a day so today's stays today's;
 *  one still to come just leaves; today's own file leaves and the next one plays today. `l` no longer has it on the
 *  playlist (taken off the library, or into skip). */
function leaveCycle(l0: AlarmList, id: string, today: string, after: (l: AlarmList) => AlarmList): AlarmList {
  const l = rollTo(l0, today);
  const at = l.cycle.indexOf(id), k = todayK(l, today);
  const start = at >= 0 && at < k ? dayStr(dayNum(l.start) + 1) : l.start;
  const n = after({ ...l, start, cycle: l.cycle.filter((x) => x !== id) });
  return playlistOf(n).length ? rollTo(n, today) : { ...n, start: "", cycle: [] };
}
/** New files at the end of the library. `play` true (the usual): they also join the playlist this cycle; false: in the
 *  library only. The same file again (matched by its id, from any device) changes nothing. */
export function addTracks(l0: AlarmList, add: Track[], today: string, play = true): AlarmList {
  const have = new Set(l0.tracks.map((t) => t.id));
  const fresh = add.filter((t, i) => !have.has(t.id) && add.findIndex((x) => x.id === t.id) === i).slice(0, Math.max(0, MAX_TRACKS - l0.tracks.length));
  if (!fresh.length) return l0;
  const seed = l0.seed || seedFrom(fresh.map((t) => t.id).join(""));
  const ids = fresh.map((t) => t.id);
  const l = { ...rollTo({ ...l0, seed }, today), tracks: [...l0.tracks, ...fresh] };
  if (!play) return { ...l, skip: dedupe([...l.skip, ...ids]) };
  return joinCycle(l, ids, today);
}
/** Ticks a library file into the playlist, or takes it off (it stays in the library). */
export function setInPlaylist(l: AlarmList, id: string, on: boolean, today: string): AlarmList {
  if (!l.tracks.some((t) => t.id === id) || l.skip.includes(id) !== on) return l;
  if (on) return joinCycle({ ...l, skip: l.skip.filter((x) => x !== id) }, [id], today);
  return leaveCycle(l, id, today, (n) => ({ ...n, skip: dedupe([...n.skip, id]) }));
}
/** "Use the whole library": every file into the playlist. */
export function useWholeLibrary(l: AlarmList, today: string): AlarmList {
  if (!l.skip.length) return l;
  const ids = l.skip.filter((x) => l.tracks.some((t) => t.id === x));
  return joinCycle({ ...l, skip: [] }, ids, today);
}
/** A file deleted from the library (and so from the playlist). */
export function removeTrack(l: AlarmList, id: string, today: string): AlarmList {
  if (!l.tracks.some((t) => t.id === id)) return l;
  if (l.skip.includes(id)) return { ...l, tracks: l.tracks.filter((t) => t.id !== id), skip: l.skip.filter((x) => x !== id) };
  return leaveCycle(l, id, today, (n) => ({ ...n, tracks: n.tracks.filter((t) => t.id !== id) }));
}
/** The library in a new order (Move up and down). In order mode what is still to play this cycle follows it. */
export function reorder(l0: AlarmList, ids: string[], today: string): AlarmList {
  const byId = new Map(l0.tracks.map((t) => [t.id, t]));
  const tracks = dedupe(ids).map((i) => byId.get(i)).filter((t): t is Track => !!t);
  for (const t of l0.tracks) if (!tracks.includes(t)) tracks.push(t);
  const l = rollTo({ ...l0, tracks }, today);
  if (l.order !== "seq" || !l.cycle.length) return l;
  const k = todayK(l, today), done = l.cycle.slice(0, k + 1);
  // What is left: the playlist's files after today's in the new order (in order mode the cycle follows the list).
  const pl = playlistOf(l), pos = pl.findIndex((t) => t.id === l.cycle[Math.min(k, l.cycle.length - 1)]);
  const after = pl.slice(pos + 1).map((t) => t.id).filter((x) => !done.includes(x));
  return { ...l, cycle: [...done, ...after] };
}
export function moveTrack(l: AlarmList, id: string, by: -1 | 1, today: string): AlarmList {
  const ids = l.tracks.map((t) => t.id), i = ids.indexOf(id), j = i + by;
  if (i < 0 || j < 0 || j >= ids.length) return l;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return reorder(l, ids, today);
}
/** In order or random: a fresh cycle from today (in order it starts at file 1). */
export function setOrder(l: AlarmList, order: ListOrder, today: string): AlarmList {
  if (l.order === order) return l;
  const n = { ...l, order };
  return playlistOf(n).length ? { ...n, start: today, cycle: newCycle(n, today) } : n;
}

// ---------- checking ----------
const okId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{16}$/.test(v);
export const seedFrom = (s: string) => hash32(`${s}|${Date.now()}|${Math.random()}`).toString(16).padStart(8, "0");
/** The name shown for a file: its name without the ending, tidy and short ("Les Brown - It's Possible"). */
export function trackName(file: string): string {
  const base = file.replace(/\.[^.]+$/, "").replace(/[\u0000-\u001f]/g, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return (base || "Audio file").slice(0, 60);
}
export function cleanTrack(v: unknown): Track | null {
  const o = (v && typeof v === "object" ? v : null) as Record<string, unknown> | null;
  if (!o || !okId(o.id) || typeof o.name !== "string" || !o.name.trim()) return null;
  const secs = Number(o.secs), bytes = Number(o.bytes), ext = String(o.ext ?? "").toLowerCase();
  return {
    id: o.id, name: o.name.slice(0, 60),
    secs: Number.isFinite(secs) && secs > 0 ? Math.min(24 * 3600, Math.round(secs)) : 0,
    bytes: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0,
    ext: EXTS.includes(ext) ? ext : "mp3",
  };
}
/** The list from the settings record, checked: every field known, in range, the cycle only of files on the list. */
export function cleanList(v: unknown): AlarmList {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const raw = Array.isArray(o.tracks) ? o.tracks : [];
  const tracks: Track[] = [];
  for (const r of raw) { const t = cleanTrack(r); if (t && !tracks.some((x) => x.id === t.id) && tracks.length < MAX_TRACKS) tracks.push(t); }
  const ids = new Set(tracks.map((t) => t.id));
  const skip = dedupe((Array.isArray(o.skip) ? o.skip : []).filter((x): x is string => okId(x) && ids.has(x)));
  const cycle = dedupe((Array.isArray(o.cycle) ? o.cycle : []).filter((x): x is string => okId(x) && ids.has(x) && !skip.includes(x)));
  const fade = Number(o.fade);
  return {
    on: o.on === true,
    order: o.order === "random" ? "random" : "seq",
    end: o.end === "whole" ? "whole" : "loop",
    fade: FADES.includes(fade) ? fade : 0,
    tracks,
    skip,
    seed: typeof o.seed === "string" && /^[0-9a-f]{1,16}$/.test(o.seed) ? o.seed : "",
    start: okDay(o.start) && cycle.length ? o.start : "",
    cycle: tracks.length > skip.length ? cycle : [],
  };
}
/** Can this file go on the list? A plain sentence when not. `head`: its first bytes (never the name alone). */
export function checkFile(name: string, size: number, head: Uint8Array): { ok: true; ext: string } | { ok: false; why: string } {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (!EXTS.includes(ext)) return { ok: false, why: `${trackName(name)}: pick an mp3, m4a, wav, aac, flac or ogg file.` };
  if (!(size > 0)) return { ok: false, why: `${trackName(name)} is empty.` };
  if (size > MAX_MB * 1024 * 1024) return { ok: false, why: `${trackName(name)} is over ${MAX_MB} MB.` };
  if (!sniff(head)) return { ok: false, why: `${trackName(name)} does not look like a sound file PS app can play.` };
  return { ok: true, ext };
}
const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));
/** What the first bytes say: mp3 (a tag or an MPEG frame), AAC in ADTS (also an 0xFFF frame), m4a, wav, aiff. */
export function sniff(h: Uint8Array): boolean {
  if (h.length < 12) return false;
  if (ascii(h, 0, 4) === "RIFF" && ascii(h, 8, 4) === "WAVE") return true;
  if (ascii(h, 0, 4) === "FORM" && (ascii(h, 8, 4) === "AIFF" || ascii(h, 8, 4) === "AIFC")) return true;
  if (ascii(h, 4, 4) === "ftyp") return true;
  if (ascii(h, 0, 3) === "ID3") return true;
  if (ascii(h, 0, 4) === "fLaC" || ascii(h, 0, 4) === "OggS" || ascii(h, 0, 4) === "caff") return true;   // flac, ogg and opus, caf
  return h[0] === 0xff && (h[1] & 0xe0) === 0xe0;
}

// ---------- the plan and the words ----------
/** What a shell needs to ring today's file: the ending, the fade, and the file for each day the plan may ring on. */
export interface PlanList {
  end: ListEnd; fade: number; days: Record<string, { id: string; name: string; secs: number; n: number; of: number }>;
  files: Record<string, { name: string; secs: number }>;   // every library file, for an alarm that picked one ("t:<id>")
  on?: boolean;   // V1.47 (Sleep settings): false when only alarms set to it play it (core/sleepmode.ts ringPlay)
}
/** An alarm's own sound choice on its ring (the Sleep chat's per alarm Sound picker owns the words): "list" (the day's
 *  file), "t:<id>" (that one library file every day), "builtin", "own", "style" (own or built in), or none (the
 *  playlist when its switch is on, else your own sound, else built in). */
export const okRingSound = (v: unknown): v is string => typeof v === "string" && /^(list|style|builtin|own|t:[0-9a-f]{16})$/.test(v);
/** Does this ring need the playlist in the plan? */
export const ringWantsList = (v: unknown) => v === "list" || (typeof v === "string" && /^t:[0-9a-f]{16}$/.test(v));
/** For the plan: null when the playlist is off (and no alarm asks for it) or empty, else today's file and the next
 *  days' (`count` days from the day of `now`, and each ring's day), so a shell can ring a timer it set itself, and
 *  every library file (an alarm that picked one). Each ring may carry its own choice (okRingSound). */
export function planList(l: AlarmList, now: number, tz: string, ringAts: number[] = [], count = 3, wanted = false): PlanList | null {
  // `wanted`: an alarm picked the playlist or one of its files as its own sound, even with the main switch off.
  if ((!l.on && !wanted) || !l.tracks.length) return null;
  const first = dayNum(dayIn(now, tz));
  const days = new Set<string>();
  for (let i = 0; i < count; i++) days.add(dayStr(first + i));
  for (const at of ringAts) days.add(dayIn(at, tz));
  const out: PlanList["days"] = {};
  for (const d of [...days].sort()) { const p = pickFor(l, d); if (p) out[d] = { id: p.id, name: p.name, secs: p.secs, n: p.n, of: p.of }; }
  const files: PlanList["files"] = {};
  for (const t of l.tracks) files[t.id] = { name: t.name, secs: t.secs };
  return { end: l.end, fade: l.fade, days: out, files };
}
/** How long the alarm rings with this file: the whole file (at least the usual 10 min, at most WHOLE_MAX_MS), or the
 *  usual 10 min while it loops. */
export function ringMs(end: ListEnd, secs: number): number {
  if (end !== "whole" || !(secs > 0)) return RING_MS;
  return Math.min(WHOLE_MAX_MS, Math.max(RING_MS, Math.round(secs * 1000) + 3000));
}
/** The fade in: 0.05 rising to 1 over `fade` seconds (0: none). Multiplied into the style's own rise; never on Loud. */
export function fadeAt(ms: number, fade: number): number {
  if (!(fade > 0)) return 1;
  return Math.min(1, 0.05 + 0.95 * Math.max(0, ms) / (fade * 1000));
}
/** "Today: Les Brown, file 3 of 7". */
export function pickLine(p: DayPick | null, when: string): string {
  return p ? `${when}: ${p.name}, file ${p.n} of ${p.of}` : `${when}: no files yet`;
}
/** "4:05", "1:02:30". */
export function lenText(secs: number): string {
  const s = Math.max(0, Math.round(secs)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
export function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
/** The id of a file: the first 16 hex characters of its SHA-256 (the Mac and the phone work it out the same way). */
export const idFromDigest = (d: ArrayBuffer | Uint8Array) => Array.from(d instanceof Uint8Array ? d : new Uint8Array(d)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");

// ---------- libraries to add from (V1.47, the developer: "a library of these alarms, like motivational audios ... or we add them
// for the users so everybody can choose 'I want this and this and this', or a full library") ----------
/** The PS starter packs: a list in the web build itself (public/alarm-packs/index.json, empty until the developer publishes
 *  some), with their files next to it, so every PS (Mac, phone, website) reads them from its own copy of the build:
 *  no Supabase egress, works offline, and nobody else's recordings ship unless the developer puts them there. */
export interface PackFile { file: string; name: string; secs: number }
export interface Pack { id: string; name: string; note: string; files: PackFile[] }
const okPath = (v: unknown): v is string => typeof v === "string" && v.length <= 200 && /^[A-Za-z0-9 _.()'&,+-]+(\/[A-Za-z0-9 _.()'&,+-]+)*$/.test(v) && !v.split("/").some((x) => x === ".." || x === ".") && EXTS.includes((v.split(".").pop() ?? "").toLowerCase());
export function cleanPacks(v: unknown): Pack[] {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out: Pack[] = [];
  for (const r of Array.isArray(o.packs) ? o.packs.slice(0, 20) : []) {
    const p = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    if (typeof p.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(p.id) || typeof p.name !== "string" || !p.name.trim()) continue;
    const files: PackFile[] = [];
    for (const f of Array.isArray(p.files) ? p.files.slice(0, MAX_TRACKS) : []) {
      const x = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      if (!okPath(x.file)) continue;
      const secs = Number(x.secs);
      files.push({ file: x.file, name: typeof x.name === "string" && x.name.trim() ? x.name.slice(0, 60) : trackName(x.file.split("/").pop() ?? ""), secs: Number.isFinite(secs) && secs > 0 ? Math.round(secs) : 0 });
    }
    if (files.length) out.push({ id: p.id, name: p.name.slice(0, 60), note: typeof p.note === "string" ? p.note.slice(0, 200) : "", files });
  }
  return out;
}
/** Sharing in the G Squad goes through the Soundboard's share (one upload path, its limits): up to 10 MB a file. */
export const SHARE_MAX_MB = 10;
export const SHARE_NOTE = "Only share audio you made or have the right to share.";
/** The squad's shared sounds grouped by pack ("" packs show as "Shared sounds"), newest packs first as given. */
export function byPack<T extends { pack: string }>(files: T[]): { pack: string; files: T[] }[] {
  const out: { pack: string; files: T[] }[] = [];
  for (const f of files) {
    const k = f.pack.trim() || "Shared sounds";
    const g = out.find((x) => x.pack === k);
    if (g) g.files.push(f); else out.push({ pack: k, files: [f] });
  }
  return out;
}

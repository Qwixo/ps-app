// Rewind (PS 1.64): the private history kept for a yearly recap on 1 January. The developer, 16 Nov 2026: start collecting what the
// person does (most common tasks done, most productive days, consistency like the gym every day, behaviour such as a day
// where the gym reminder keeps being put off), kept private and encrypted, for a New Year recap later. "Make sure that I
// myself can't access that data." The recap screens do not exist yet: this module only collects and merges.
//
// Where it lives: one owner only vault record (kind "rwd") per day of the person's own zone, plus one small record per
// year (monthly money, best streaks). Sealed with the person's own vault key like every owner record, so the server holds
// ciphertext only, Claude's agent account is refused owner records by the database, the drop channel can only add sealed
// packages (it has no op that reads or writes Rewind) and the G Squad hub never gets any of it. It is never in the backup
// export (src/localfirst.ts) and never mirrored to the Tab list window (src/ps.ts sends a fixed list of kinds).
// Nothing in PS reads it back: the only reader is `openYear`, which returns nothing before 1 January of the next year in
// the person's own zone, and no screen calls it yet.
//
// Compact rollups, not an event log: a day holds what the recap needs (a tick's title, hour and flags; a workout's sets,
// volume and bests; screen time per app in minutes) and nothing else. Two devices merge without double counting:
// - what both devices can see (tasks, workouts, screen time, AFK breaks, meetings) is keyed (a short hash of the task id
//   and tick time, the workout id, the break start), so a merge is a plain union, and a count can only go up;
// - what only one device sees (gym reminder answers on that device, Are you sure cards, G Squad messages sent, first and
//   last active minute) sits in that device's own bucket, written by that device only, merged by taking the larger.
// So merging is the same whichever device writes first, and merging a record with itself changes nothing.
//
// Golden rule: anything about 1Password or Signal (an app, a task title, a break reason) is dropped at the first read.
// Pure: no vault, no clock, no storage, no DOM. src/rewind.ts runs it and saves.
import type { AwayEntry, CalendarSnap, Doc, ScreenTimeDay, Todo } from "./model";
import type { DayLog } from "./daylog";
import type { FitWorkout } from "./fitness";
import { bestsInWorkout, exKey, workoutSetsDone, workoutVolume } from "./fitness.ts";
import { isProtectedApp } from "./protected.ts";
import { isMeeting } from "./notescard.ts";
import { validTz, wall, zonedToTs } from "./tz.ts";

export const RW_KIND = "rwd";
export const RW = {
  titleMax: 60,        // a task title is cut to this
  nameMax: 40,         // an app, exercise or break reason is cut to this
  appsPerDay: 12,      // screen time: the biggest apps per device per day
  bestsPerDay: 6,      // Fitness: personal bests kept per day
  streaksPerDay: 40,   // repeating tasks with a streak kept per day
  ticksPerDay: 400,    // a day never holds more ticks than this
  keepYears: 2,        // this year and last year; anything older is deleted
} as const;

/** Tick flags. */
export const F = { p1: 1, repeat: 2, mini: 4 } as const;

/** One device's own counts for a day. Only that device writes its bucket, so merging takes the larger of each. */
export interface RwDev {
  k?: "mac" | "gos" | "web" | "mweb";
  ac?: [number, number];              // first and last active minute of the day (0 to 1439), on this device
  gy?: [number, number, number];      // gym reminders shown, Later, Yes (on this device)
  ay?: [number, number];              // Are you sure: cards shown, passes taken (this Mac)
  sq?: number;                        // G Squad messages sent
}
export type RwDevKey = keyof Omit<RwDev, "k">;

export interface RwDay {
  t: "day";
  v: 1;
  d: string;                                                   // YYYY-MM-DD in the person's zone
  tk?: Record<string, [string, number, number]>;               // tick key: [title, hour 0 to 23, flags]
  cl?: Record<string, [string, number]>;                       // Claude purple tick key: [title, hour]
  sk?: Record<string, number>;                                 // repeating task title: its streak that day
  wk?: Record<string, [number, number, number, number]>;       // workout key: [sets done, volume kg, personal bests, minutes]
  pb?: Record<string, [number, number]>;                       // exercise: [kg, reps] of that day's best set that was a personal best
  ga?: 1;                                                      // said Yes to the gym that day
  gm?: 1;                                                      // a gym day with no Yes (missed)
  st?: Partial<Record<"mac" | "gos", [number, Record<string, number>]>>;   // screen time: [total minutes, app: minutes]
  af?: Record<string, [number, string]>;                       // break start (base 36 seconds): [minutes, reason]
  mt?: string[];                                               // meetings (keys)
  tm?: Record<string, [string, number, number]>;               // time spent (PS 1.65, core/timeest.ts), tick key as in tk: [title, minutes, estimate minutes or 0]
  dv?: Record<string, RwDev>;                                  // each device's own counts
}
export interface RwMoney { usd: number; rank?: number; of?: number; low?: 1; src?: "ps" | "board" }
export interface RwYear {
  t: "year";
  v: 1;
  y: number;
  mo?: Record<string, RwMoney>;   // "2026-02": money in, in USD (and the place on the squad's board when known)
  bs?: Record<string, number>;    // repeating task title: its best streak seen this year
}
export type RwRec = RwDay | RwYear;

// ---------- small helpers ----------
const pad = (n: number) => String(n).padStart(2, "0");
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (s: unknown): s is string => typeof s === "string" && DAY.test(s);
/** FNV-1a, 32 bit, base 36: a short key that says nothing about what it stands for. */
export function hkey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
const cut = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
/** A title or name that may be kept: not empty, nothing about 1Password or Signal. */
export const keepName = (s: string) => !!s && !isProtectedApp(s);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const tsOf = (iso: unknown) => (typeof iso === "string" ? Date.parse(iso) : NaN);

/** The zone Rewind counts days in: the person's own (settings.tmHomeTz), else this device's. */
export const rwZone = (home: unknown, device: string) => (typeof home === "string" && home && validTz(home) ? home : device);
/** The person's own day for a moment. */
export function dayKey(ts: number, tz: string): string { const w = wall(ts, tz); return `${w.y}-${pad(w.mo)}-${pad(w.d)}`; }
export const hourOf = (ts: number, tz: string) => wall(ts, tz).h;
export const minuteOf = (ts: number, tz: string) => { const w = wall(ts, tz); return w.h * 60 + w.mi; };
/** Midnight at the start of 1 January of a year, in the person's zone. */
export const yearStart = (y: number, tz: string) => zonedToTs(y, 1, 1, 0, 0, tz);
/** The recap for a year may open: from midnight on 1 January of the next year in the person's own zone. */
export const recapOpen = (y: number, now: number, tz: string) => now >= yearStart(y + 1, tz);
const yearOf = (day: string) => Number(day.slice(0, 4));
/** Days kept: this year and last year (in the person's zone). */
export const keptDay = (day: string, now: number, tz: string) => isDay(day) && yearOf(day) > yearOf(dayKey(now, tz)) - RW.keepYears && day <= dayKey(now + 86_400_000, tz);

// ---------- the switch ----------
export interface RwPrefs { on?: boolean; since?: string | null }
/** On unless switched off (Settings, Privacy and sharing: "Rewind (yearly recap)"). */
export const rewindOn = (p: unknown) => !(p && typeof p === "object" && (p as RwPrefs).on === false);
/** Nothing from before this moment is collected (set by Delete my Rewind data, and when it is switched back on). */
export const rewindSince = (p: unknown): number => { const s = p && typeof p === "object" ? tsOf((p as RwPrefs).since) : NaN; return Number.isFinite(s) ? s : 0; };
/** Switching on or off: off keeps nothing new; on again starts from now, so the time it was off is never filled in. */
export function rewindSwitch(cur: unknown, on: boolean, nowIso: string): RwPrefs {
  const was = rewindOn(cur);
  const since = (cur && typeof cur === "object" ? (cur as RwPrefs).since : null) ?? null;
  if (on === was) return { on, since };
  return on ? { on: true, since: nowIso } : { on: false, since };
}

// ---------- merging ----------
const emptyDay = (d: string): RwDay => ({ t: "day", v: 1, d });
function union<T>(a: Record<string, T> | undefined, b: Record<string, T> | undefined, pick: (x: T, y: T) => T): Record<string, T> | undefined {
  if (!a && !b) return undefined;
  const out: Record<string, T> = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) out[k] = k in out ? pick(out[k], v) : v;
  return out;
}
const maxT = <T extends number[]>(x: T, y: T) => x.map((v, i) => Math.max(v, num(y[i]))) as T;
const maxN = (x: number, y: number) => Math.max(x, y);
const topN = (o: Record<string, number>, n: number) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n));

function mergeDev(a: RwDev, b: RwDev): RwDev {
  const out: RwDev = { ...(a.k || b.k ? { k: a.k ?? b.k } : {}) };
  if (a.ac || b.ac) out.ac = a.ac && b.ac ? [Math.min(a.ac[0], b.ac[0]), Math.max(a.ac[1], b.ac[1])] : (a.ac ?? b.ac)!;
  if (a.gy || b.gy) out.gy = a.gy && b.gy ? maxT(a.gy, b.gy) : (a.gy ?? b.gy)!;
  if (a.ay || b.ay) out.ay = a.ay && b.ay ? maxT(a.ay, b.ay) : (a.ay ?? b.ay)!;
  if (a.sq || b.sq) out.sq = Math.max(num(a.sq), num(b.sq));
  return out;
}
function mergeSt(a: RwDay["st"], b: RwDay["st"]): RwDay["st"] {
  if (!a && !b) return undefined;
  const out: NonNullable<RwDay["st"]> = {};
  for (const dev of ["mac", "gos"] as const) {
    const x = a?.[dev], y = b?.[dev];
    if (!x && !y) continue;
    const apps = union(x?.[1], y?.[1], maxN) || {};
    out[dev] = [Math.max(num(x?.[0]), num(y?.[0])), topN(apps, RW.appsPerDay)];
  }
  return out;
}
/** Two copies of the same day into one. Order does not matter; merging with itself changes nothing. */
export function mergeDay(a: RwDay, b: RwDay): RwDay {
  const out: RwDay = emptyDay(a.d || b.d);
  const tk = union(a.tk, b.tk, (x, y): [string, number, number] => [x[0] <= y[0] ? x[0] : y[0], Math.min(x[1], y[1]), x[2] | y[2]]);
  if (tk) out.tk = capTicks(tk);
  const cl = union(a.cl, b.cl, (x, y) => (x[0] <= y[0] ? x : y)); if (cl) out.cl = cl;
  const sk = union(a.sk, b.sk, maxN); if (sk) out.sk = topN(sk, RW.streaksPerDay);
  const wk = union(a.wk, b.wk, maxT); if (wk) out.wk = wk;
  const pb = union(a.pb, b.pb, (x, y) => (x[0] > y[0] || (x[0] === y[0] && x[1] >= y[1]) ? x : y));
  if (pb) out.pb = Object.fromEntries(Object.entries(pb).sort((p, q) => q[1][0] - p[1][0] || (p[0] < q[0] ? -1 : 1)).slice(0, RW.bestsPerDay));
  if (a.ga || b.ga) out.ga = 1;
  else if (a.gm || b.gm) out.gm = 1;   // a Yes (even a late one) always wins over missed
  const st = mergeSt(a.st, b.st); if (st && Object.keys(st).length) out.st = st;
  const af = union(a.af, b.af, (x, y) => (x[0] >= y[0] ? x : y)); if (af) out.af = af;
  if (a.mt || b.mt) out.mt = [...new Set([...(a.mt || []), ...(b.mt || [])])].sort();
  const tm = union(a.tm, b.tm, (x, y): [string, number, number] => [x[0] <= y[0] ? x[0] : y[0], Math.max(x[1], y[1]), Math.max(x[2], y[2])]); if (tm) out.tm = tm;
  const dv = union(a.dv, b.dv, mergeDev); if (dv) out.dv = dv;
  return out;
}
function capTicks(tk: Record<string, [string, number, number]>) {
  const keys = Object.keys(tk);
  if (keys.length <= RW.ticksPerDay) return tk;
  return Object.fromEntries(keys.sort().slice(0, RW.ticksPerDay).map((k) => [k, tk[k]]));
}
export function mergeYear(a: RwYear, b: RwYear): RwYear {
  const out: RwYear = { t: "year", v: 1, y: a.y || b.y };
  const mo = union(a.mo, b.mo, (x, y) => {
    // What the person typed in PS is their amount; the board's place (rank) is kept from the board.
    const ps = x.src === "ps" ? x : y.src === "ps" ? y : null, bd = x.src === "board" ? x : y.src === "board" ? y : null;
    const base = ps ?? (x.usd >= y.usd ? x : y);
    const m: RwMoney = { usd: base.usd, ...(base.src ? { src: base.src } : {}) };
    const r = bd ?? (x.rank ? x : y);
    if (r.rank) { m.rank = r.rank; if (r.of) m.of = r.of; }
    if (x.low || y.low) m.low = 1;
    return m;
  });
  if (mo) out.mo = mo;
  const bs = union(a.bs, b.bs, maxN); if (bs) out.bs = topN(bs, 200);
  return out;
}
export function mergeRec(a: RwRec, b: RwRec): RwRec {
  if (a.t === "day" && b.t === "day") return mergeDay(a, b);
  if (a.t === "year" && b.t === "year") return mergeYear(a, b);
  return a;
}
/** A record from the vault, checked; null for anything that is not one (a damaged or foreign copy is skipped, never thrown). */
export function cleanRec(x: unknown): RwRec | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Partial<RwRec>;
  if (r.v !== 1) return null;
  if (r.t === "day" && isDay((r as RwDay).d)) return r as RwDay;
  if (r.t === "year" && Number.isInteger((r as RwYear).y)) return r as RwYear;
  return null;
}
export const recKey = (r: RwRec) => (r.t === "day" ? `d:${r.d}` : `y:${r.y}`);

/** Canonical JSON (keys sorted), to tell whether a merge changed anything. */
export function canon(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") return Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, norm((x as Record<string, unknown>)[k])]));
    return x;
  };
  return JSON.stringify(norm(v));
}

// ---------- one device's own counts ----------
/** Adds this device's counts since its last save into its bucket of the day (a delta: only this device ever writes it). */
export function addDev(day: RwDay, dev: string, kind: RwDev["k"], delta: { gy?: [number, number, number]; sq?: number; ac?: [number, number]; ay?: [number, number] }): RwDay {
  const out = structuredClone(day);
  const cur: RwDev = { ...(out.dv?.[dev] || {}), ...(kind ? { k: kind } : {}) };
  if (delta.gy) cur.gy = [0, 1, 2].map((i) => num(cur.gy?.[i]) + num(delta.gy![i])) as [number, number, number];
  if (delta.sq) cur.sq = num(cur.sq) + delta.sq;
  if (delta.ac) cur.ac = cur.ac ? [Math.min(cur.ac[0], delta.ac[0]), Math.max(cur.ac[1], delta.ac[1])] : delta.ac;
  if (delta.ay) cur.ay = cur.ay ? maxT(cur.ay, delta.ay) : delta.ay;   // the Mac's own count of the day: absolute, never added
  out.dv = { ...(out.dv || {}), [dev]: cur };
  return out;
}

/** This device's counts since its last save, added onto the day as the vault holds it now (every copy merged). */
export function devRec(stored: Doc<unknown>[], d: string, dev: string, kind: RwDev["k"], delta: Parameters<typeof addDev>[3]): RwDay {
  let day: RwDay = emptyDay(d);
  for (const x of stored) { const r = cleanRec(x.data); if (r?.t === "day" && r.d === d) day = mergeDay(day, r); }
  return addDev(day, dev, kind, delta);
}

// ---------- what PS already holds, as days ----------
export interface RwSources {
  todos: Doc<Todo>[];
  daylogs: Doc<DayLog>[];
  workouts: { id: string; data: FitWorkout }[];
  screentime: Doc<ScreenTimeDay>[];
  calendars: Doc<CalendarSnap>[];
  meetings: Doc<{ date?: string }>[];
  awayLog: AwayEntry[];
  gymAck: string[];
  gym: { on: boolean; days: number[] } | null;
  money: Record<string, number>;
  /** Time spent (PS 1.65, core/timeest.ts): each finished task's minutes, from the "ttime" month records. */
  timed?: { id: string; n: string; m: number; e: number; at: number }[];
}
export interface DeriveOpts {
  tz: string; now: number; since: number;
  /** Only days from this one on (a quick look at the last few days); the full year when missing. */
  from?: string;
}

/** Every day of the kept years that PS already holds something for (the backfill is just the first run of this). */
export function derive(src: RwSources, o: DeriveOpts): { days: Map<string, RwDay>; years: Map<number, RwYear> } {
  const days = new Map<string, RwDay>();
  const years = new Map<number, RwYear>();
  const sinceDay = [o.since ? dayKey(o.since, o.tz) : "", o.from && isDay(o.from) ? o.from : ""].sort().pop() || "";
  const okTs = (ts: number) => Number.isFinite(ts) && ts >= o.since && ts <= o.now + 60_000 && dayKey(ts, o.tz) >= sinceDay && keptDay(dayKey(ts, o.tz), o.now, o.tz);
  const okDay = (d: string) => isDay(d) && d >= sinceDay && keptDay(d, o.now, o.tz) && d <= dayKey(o.now, o.tz);
  const day = (d: string) => { let x = days.get(d); if (!x) { x = emptyDay(d); days.set(d, x); } return x; };
  const year = (y: number) => { let x = years.get(y); if (!x) { x = { t: "year", v: 1, y }; years.set(y, x); } return x; };

  // Tasks: every tick PS knows of, from the list itself and from the day log (repeating tasks lose their tick on Reset).
  const todoById = new Map(src.todos.map((t) => [t.id, t.data]));
  const tick = (todoId: string, title: string, at: string | null | undefined, flags: number) => {
    const ts = tsOf(at);
    const name = cut(title, RW.titleMax);
    if (!okTs(ts) || !keepName(name)) return;
    const d = day(dayKey(ts, o.tz));
    (d.tk ??= {})[hkey(`${todoId}|${new Date(ts).toISOString()}`)] = [name, hourOf(ts, o.tz), flags];
  };
  const claude = (todoId: string, title: string, at: string | null | undefined) => {
    const ts = tsOf(at);
    const name = cut(title, RW.titleMax);
    if (!okTs(ts) || !keepName(name)) return;
    (day(dayKey(ts, o.tz)).cl ??= {})[hkey(`c|${todoId}|${new Date(ts).toISOString()}`)] = [name, hourOf(ts, o.tz)];
  };
  for (const { id, data: t } of src.todos) {
    if (!t || typeof t.title !== "string" || t.example) continue;
    const flags = (t.p1 ? F.p1 : 0) | (t.type === "daily" ? F.repeat : 0);
    if (t.done && t.doneAt) tick(id, t.title, t.doneAt, flags);
    if (t.claudeDoneAt) claude(id, t.title, t.claudeDoneAt);
    for (const s of t.subtasks || []) {
      if (s.done && s.doneAt && !s.byParent) tick(`${id}/${s.id}`, s.title, s.doneAt, F.mini);
      if (s.claudeDoneAt) claude(`${id}/${s.id}`, s.title, s.claudeDoneAt);
    }
    // Every day streaks: today's streak, and the best this year.
    if (t.type === "daily" && keepName(cut(t.title, RW.titleMax))) {
      const name = cut(t.title, RW.titleMax);
      const today = dayKey(o.now, o.tz);
      if (num(t.streak) >= 1 && okDay(today)) (day(today).sk ??= {})[name] = Math.max(num(day(today).sk?.[name]), num(t.streak));
      const best = Math.max(num(t.bestStreak), num(t.streak));
      if (best >= 2 && o.now >= o.since) { const yr = year(yearOf(today)); (yr.bs ??= {})[name] = Math.max(num(yr.bs?.[name]), best); }
    }
  }
  for (const { data: log } of src.daylogs) {
    for (const i of log?.items || []) {
      if (!i || typeof i.todoId !== "string") continue;
      const isMini = !!i.parentId || i.todoId.includes("/");
      const t = todoById.get(isMini ? i.todoId.split("/")[0] : i.todoId);
      tick(i.todoId, i.title, i.at, isMini ? F.mini : ((i.repeat ? F.repeat : 0) | (t?.p1 ? F.p1 : 0)));
    }
  }

  // Fitness: sessions, sets, volume, personal bests.
  const ws = src.workouts.filter((w) => w?.data && isDay(w.data.date));
  for (const w of ws) {
    const sets = workoutSetsDone(w.data);
    if (!sets || !okDay(w.data.date) || !(tsOf(w.data.startedAt) >= o.since)) continue;
    let bests = 0;
    const d = day(w.data.date);
    for (const e of w.data.exercises) {
      if (e.removed) continue;
      const found = bestsInWorkout(e, w.id, ws);
      bests += found.size;
      let top: [number, number] | null = null;
      for (const s of e.sets) if (found.has(s.id) && s.kg != null && s.reps) { if (!top || s.kg > top[0] || (s.kg === top[0] && s.reps > top[1])) top = [s.kg, s.reps]; }
      const name = cut(e.name || exKey(e), RW.nameMax);
      if (top && keepName(name)) {
        const was = d.pb?.[name];
        if (!was || top[0] > was[0] || (top[0] === was[0] && top[1] > was[1])) (d.pb ??= {})[name] = top;
      }
    }
    const mins = w.data.endedAt ? Math.max(0, Math.round((tsOf(w.data.endedAt) - tsOf(w.data.startedAt)) / 60_000)) : 0;
    (d.wk ??= {})[hkey(`w|${w.id}`)] = [sets, Math.round(workoutVolume(w.data)), bests, Number.isFinite(mins) && mins < 24 * 60 ? mins : 0];
  }
  for (const d of days.values()) if (d.pb) d.pb = Object.fromEntries(Object.entries(d.pb).sort((p, q) => q[1][0] - p[1][0]).slice(0, RW.bestsPerDay));

  // The gym reminder: a Yes, or a gym day that ended with none (the vault keeps Yes days for two weeks).
  const acked = new Set(src.gymAck.filter(isDay));
  for (const a of acked) if (okDay(a)) day(a).ga = 1;
  if (src.gym?.on) {
    for (let i = 1; i <= 13; i++) {
      const ts = o.now - i * 86_400_000;
      const d = dayKey(ts, o.tz);
      if (!okDay(d) || acked.has(d) || dayKey(o.since, o.tz) >= d) continue;
      const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (src.gym.days.includes(wd)) day(d).gm = 1;
    }
  }

  // Screen time per app per day (both devices; never 1Password or Signal).
  for (const { data: s } of src.screentime) {
    if (!s || !okDay(s.day) || !Array.isArray(s.apps)) continue;
    const dev = s.device === "gos" ? "gos" : "mac";
    const apps: Record<string, number> = {};
    let total = 0;
    for (const a of s.apps) {
      if (!a || isProtectedApp(String(a.id)) || isProtectedApp(String(a.name))) continue;
      const mins = Math.round(num(a.secs) / 60);
      total += num(a.secs);
      const name = cut(a.name || a.id, RW.nameMax);
      if (mins >= 1 && keepName(name)) apps[name] = (apps[name] || 0) + mins;
    }
    const d = day(s.day);
    const was = d.st?.[dev];
    (d.st ??= {})[dev] = [Math.max(num(was?.[0]), Math.round(total / 60)), topN(union(was?.[1], apps, maxN) || {}, RW.appsPerDay)];
  }

  // Time spent on finished tasks (PS 1.65): keyed like the tick itself, so the recap can put the two together.
  for (const x of src.timed || []) {
    const name = cut(x.n, RW.titleMax);
    if (!okTs(x.at) || !keepName(name) || !(x.m > 0)) continue;
    (day(dayKey(x.at, o.tz)).tm ??= {})[hkey(`${x.id}|${new Date(x.at).toISOString()}`)] = [name, Math.round(x.m), Math.round(x.e) || 0];
  }

  // AFK and other breaks.
  for (const a of src.awayLog) {
    if (!a || !Number.isFinite(a.s) || !Number.isFinite(a.e) || a.e < a.s) continue;
    const ts = a.s * 1000;
    const reason = cut(a.reason, RW.nameMax);
    if (!okTs(ts)) continue;
    (day(dayKey(ts, o.tz)).af ??= {})[Math.round(a.s).toString(36)] = [Math.round((a.e - a.s) / 60), keepName(reason) ? reason : ""];
  }

  // Meetings: calendar events with a call link or other people (the same rule as AFK and Are you sure), once over.
  // Keyed by start time, so the same call from the calendar and from the meeting notes counts once.
  const meet = (startTs: number) => {
    if (!okTs(startTs) || startTs > o.now) return;
    const d = day(dayKey(startTs, o.tz));
    const k = hkey(`m|${Math.round(startTs / 300_000)}`);
    if (!(d.mt ??= []).includes(k)) d.mt.push(k);
  };
  for (const { data: c } of src.calendars) {
    for (const e of c?.events || []) {
      if (!e || !isMeeting(e) || e.attendees?.some((x) => x.self && x.rsvp === "declined")) continue;
      const end = tsOf(e.end);
      if (!Number.isFinite(end) || end > o.now || end - tsOf(e.start) > 12 * 3600_000) continue;
      meet(tsOf(e.start));
    }
  }
  for (const { data: m } of src.meetings) if (m?.date && /T\d/.test(m.date)) meet(tsOf(m.date));
  for (const d of days.values()) if (d.mt) d.mt.sort();

  // Money in, per month (the G Squad Leaderboard's money card: what the person typed in PS).
  for (const [month, usd] of Object.entries(src.money || {})) {
    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(usd)) continue;
    const y = yearOf(month);
    if (!keptDay(`${month}-01`, o.now, o.tz) || `${month}-31` < sinceDay) continue;
    (year(y).mo ??= {})[month] = { usd: Math.round(usd * 100) / 100, src: "ps" };
  }

  for (const [k, d] of days) if (Object.keys(d).length <= 3) days.delete(k);
  return { days, years };
}

// ---------- what to write ----------
export interface RwWrite { id?: string; data: RwRec }
export interface RwPlan { puts: RwWrite[]; removes: string[] }
/**
 * Folds what was derived into what the vault holds: one record per day and per year. A day the vault does not hold
 * yet is a new record; a day held twice (two devices made it at once) is merged into the copy with the smallest id
 * and the other goes, so both devices settle on the same one. A record is written only when the merge changed it.
 * Records of years no longer kept are removed.
 */
export function plan(stored: Doc<unknown>[], derived: Iterable<RwRec>, o: { now: number; tz: string; since?: number; pending?: Map<string, RwRec> }): RwPlan {
  const sinceDay = o.since ? dayKey(o.since, o.tz) : "";
  const held = new Map<string, { ids: string[]; rec: RwRec; first: string }>();
  const removes: string[] = [];
  for (const d of [...stored].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const r = cleanRec(d.data);
    if (!r) continue;
    // Gone: years no longer kept, and days before a Delete my Rewind data (a copy a device still had offline).
    if (r.t === "day" ? !keptDay(r.d, o.now, o.tz) || r.d < sinceDay : r.y <= yearOf(dayKey(o.now, o.tz)) - RW.keepYears) { removes.push(d.id); continue; }
    const k = recKey(r), h = held.get(k);
    if (!h) held.set(k, { ids: [d.id], rec: r, first: canon(r) });
    else { h.ids.push(d.id); h.rec = mergeRec(h.rec, r); }
  }
  const want = new Map<string, RwRec>();
  for (const r of [...derived, ...(o.pending?.values() || [])]) { const k = recKey(r), w = want.get(k); want.set(k, w ? mergeRec(w, r) : r); }
  const puts: RwWrite[] = [];
  for (const [k, h] of held) {
    const w = want.get(k);
    const next = w ? mergeRec(h.rec, w) : h.rec;
    if (h.ids.length > 1 || canon(next) !== h.first) puts.push({ id: h.ids[0], data: next });
    removes.push(...h.ids.slice(1));
    want.delete(k);
  }
  for (const r of want.values()) puts.push({ data: r });
  return { puts, removes };
}

// ---------- the only reader (for the recap screens, later) ----------
export interface RwYearView { year: number; days: RwDay[]; info: RwYear | null }
/**
 * A year's Rewind, merged, for the recap. Null before midnight on 1 January of the next year in the person's own
 * zone: nothing in PS can look at it sooner, not even the person whose year it is.
 */
export function openYear(stored: Doc<unknown>[], y: number, now: number, tz: string): RwYearView | null {
  if (!recapOpen(y, now, tz)) return null;
  const days = new Map<string, RwDay>();
  let info: RwYear | null = null;
  for (const d of stored) {
    const r = cleanRec(d.data);
    if (!r) continue;
    if (r.t === "day" && yearOf(r.d) === y) { const w = days.get(r.d); days.set(r.d, w ? mergeDay(w, r) : r); }
    else if (r.t === "year" && r.y === y) info = info ? mergeYear(info, r) : r;
  }
  return { year: y, days: [...days.values()].sort((a, b) => (a.d < b.d ? -1 : 1)), info };
}

// ---------- the leaderboard's monthly money, written by the person's own op (never read back) ----------
/** Months of money in (with the place on the board) into the year record. Only adds: what PS has is never lowered. */
export function moneyRecs(list: unknown): RwYear[] {
  const out = new Map<number, RwYear>();
  for (const x of Array.isArray(list) ? list : []) {
    const m = x as { month?: unknown; usd?: unknown; rank?: unknown; of?: unknown; low?: unknown };
    if (typeof m?.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m.month) || typeof m.usd !== "number" || !Number.isFinite(m.usd) || m.usd < 0 || m.usd > 1e9) continue;
    const y = yearOf(m.month);
    const rec = out.get(y) ?? { t: "year", v: 1, y };
    const money: RwMoney = { usd: Math.round(m.usd * 100) / 100, src: "board" };
    if (Number.isInteger(m.rank) && (m.rank as number) > 0 && (m.rank as number) < 1000) money.rank = m.rank as number;
    if (Number.isInteger(m.of) && (m.of as number) >= (money.rank ?? 1) && (m.of as number) < 1000) money.of = m.of as number;
    if (m.low === true) money.low = 1;
    (rec.mo ??= {})[m.month] = money;
    out.set(y, rec);
  }
  return [...out.values()];
}

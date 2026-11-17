// Rewind (PS 1.64), the page half: collects the person's year into their own vault for the recap on 1 January
// (core/rewind.ts says what is kept and how two devices merge). Runs in the main page on the Mac, the phone and the
// website; never in the Tab list window (it cannot write) and only for the vault's owner.
//
// Quiet and cheap:
// - the first look after the vault's first download goes over the whole year (the backfill: everything PS already holds),
//   then again every 6 hours; in between only the last few days are looked at, a while after something changes;
// - a record is written only when it changed, today's at most once every 30 minutes (and when the page is hidden), so
//   the egress stays tiny: about one small sealed record per day;
// - the work is cut into small steps that give the page back in between, so nothing ever stutters.
// Off (Settings, Privacy and sharing, "Rewind (yearly recap)") means nothing at all is collected or written.
// Nothing here reads Rewind back to show it: there is no view of it before the recap (core/rewind.ts openYear).
import { allDone, foldTime } from "./core/timeest";
import { docs, put, remove, vaultStore, type Snapshot } from "./core/vault";
import { settingsData } from "./core/select";
import { saveSettings } from "./core/actions";
import { DEVICE_TZ } from "./core/tz";
import { gymPrefs } from "./core/gym";
import * as R from "./core/rewind";
import type { CalendarSnap, ScreenTimeDay, Todo } from "./core/model";
import type { DayLog } from "./core/daylog";
import type { FitWorkout } from "./core/fitness";

const MODE = import.meta.env.MODE;
const KIND: R.RwDev["k"] = MODE === "ps" ? "mac" : MODE === "gos" ? "gos" : (globalThis as { __psMobile?: unknown }).__psMobile === true ? "mweb" : "web";
const QUICK_DAYS = 3;               // a quick look covers today and the two days before
const FULL_EVERY = 6 * 3600_000;    // the whole year again (a day the other device filled in, a late screen time count)
const TODAY_EVERY = 30 * 60_000;    // today's record at most this often
const SETTLE = 20_000;              // after a change, wait this long for things to settle
const STEP = 8;                     // records written per step

/** This device's own name in a day's buckets: random, kept in this browser only, says nothing about the device. */
const devId = (() => {
  let id = "";
  try { id = localStorage.getItem("ps.rwd.dev") || ""; } catch { /* private window: a new one each time is fine */ }
  if (!/^[a-z0-9]{8}$/.test(id)) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
    try { localStorage.setItem("ps.rwd.dev", id); } catch { /* fine */ }
  }
  return id;
})();

type Delta = { gy?: [number, number, number]; sq?: number; ac?: [number, number]; ay?: [number, number] };
const deltas = new Map<string, Delta>();   // this device's counts not saved yet, by day (memory only)
let started = false, running = false, deleting = false;
let timer = 0, lastFull = 0, lastToday = 0, lastActive = 0, wantFull = true;

const ready = (s: Snapshot) => s.status === "unlocked" && s.role === "owner" && (!!s.local || !!s.lastSync);
function context() {
  const s = vaultStore.get();
  if (!ready(s)) return null;
  const st = settingsData(s);
  if (!R.rewindOn(st.rewind)) return null;
  return { s, st, tz: R.rwZone(st.tmHomeTz, DEVICE_TZ), since: R.rewindSince(st.rewind) };
}
const today = () => { const c = context(); return c ? R.dayKey(Date.now(), c.tz) : null; };

function bump(f: (d: Delta) => void) {
  const d = today();
  if (!d) return;
  const cur = deltas.get(d) ?? {};
  f(cur);
  deltas.set(d, cur);
  schedule(SETTLE);
}

/** Something to remember on this device: a gym reminder shown (Mac), Later or Yes, a G Squad message sent. */
export function rewindNote(what: "gymShown" | "gymLater" | "gymYes" | "squadSent") {
  bump((d) => {
    if (what === "squadSent") { d.sq = (d.sq ?? 0) + 1; return; }
    const g = d.gy ?? [0, 0, 0];
    g[what === "gymShown" ? 0 : what === "gymLater" ? 1 : 2]++;
    d.gy = g;
  });
}
/** The person did something on this device just now (Tab held, a click, a key): first and last active minute of the day. */
export function rewindActive() {
  const now = Date.now();
  if (now - lastActive < 60_000) return;
  lastActive = now;
  const c = context();
  if (!c || now < c.since) return;
  const m = R.minuteOf(now, c.tz), d = R.dayKey(now, c.tz);
  const cur = deltas.get(d) ?? {};
  cur.ac = cur.ac ? [Math.min(cur.ac[0], m), Math.max(cur.ac[1], m)] : [m, m];
  deltas.set(d, cur);
  schedule(SETTLE);
}
/** The Mac's "Are you sure" count of today (ps-mac AreYouSure.swift, sent with its settings): cards shown, passes taken. */
let lastAys = "";
export function rewindAys(t: unknown) {
  const x = t as { prompts?: unknown; passes?: unknown } | null;
  if (!x || !Number.isInteger(x.prompts) || !Number.isInteger(x.passes) || !((x.prompts as number) > 0)) return;
  const seen = `${today()}|${x.prompts}|${x.passes}`;
  if (seen === lastAys) return;   // the Mac sends its settings often; only a new count matters
  lastAys = seen;
  bump((d) => { d.ay = [Math.max(d.ay?.[0] ?? 0, x.prompts as number), Math.max(d.ay?.[1] ?? 0, x.passes as number)]; });
}

function schedule(ms: number) {
  if (!started) return;
  clearTimeout(timer);
  const due = Math.max(ms, wantFull ? 0 : lastToday + TODAY_EVERY - Date.now());
  timer = window.setTimeout(() => void run(), Math.min(due, TODAY_EVERY));
}
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));

function sources(s: Snapshot, st: ReturnType<typeof settingsData>): R.RwSources {
  const gp = gymPrefs(st.gym, !!s.red);
  return {
    todos: docs<Todo>("todo", null),
    daylogs: docs<DayLog>("daylog", null),
    workouts: docs<FitWorkout>("fwork", null).map((d) => ({ id: d.id, data: d.data })),
    screentime: docs<ScreenTimeDay>("screentime", null),
    calendars: docs<CalendarSnap>("calendar", null),
    meetings: docs<{ date?: string }>("meeting", null),
    awayLog: st.awayLog || [],
    gymAck: st.gymAck || [],
    gym: gp.on ? { on: true, days: gp.days } : null,
    money: st.squadMoney?.m || {},
    timed: allDone([...foldTime(docs<unknown>("ttime", null)).months.values()].map((m) => m.rec)),   // time spent (core/timeest.ts)
  };
}

async function run() {
  if (running || deleting) { schedule(SETTLE); return; }
  const c = context();
  if (!c) { if (vaultStore.get().status === "unlocked" && !R.rewindOn(settingsData(vaultStore.get()).rewind)) deltas.clear(); return; }
  running = true;
  try {
    const now = Date.now(), full = wantFull || now - lastFull > FULL_EVERY;
    const from = full ? undefined : R.dayKey(now - (QUICK_DAYS - 1) * 86_400_000, c.tz);
    const src = sources(c.s, c.st);
    await breathe();
    const { days, years } = R.derive(src, { tz: c.tz, now, since: c.since, from });
    await breathe();
    // This device's own counts, added onto each day as the vault holds it now.
    const taken = new Map(deltas);
    const stored = docs<unknown>("rwd", null);
    const mine = [...taken].filter(([d]) => d >= (c.since ? R.dayKey(c.since, c.tz) : "")).map(([d, x]) => R.devRec(stored, d, devId, KIND, x));
    const p = R.plan(stored, [...days.values(), ...years.values(), ...mine], { now, tz: c.tz, since: c.since });
    for (let i = 0; i < p.removes.length; i += STEP) { for (const id of p.removes.slice(i, i + STEP)) await remove(id); await breathe(); }
    for (let i = 0; i < p.puts.length; i += STEP) {
      if (deleting || !context()) break;   // switched off or deleting while writing: stop at once
      for (const w of p.puts.slice(i, i + STEP)) await put("rwd", w.data, { id: w.id, ws: null });
      await breathe();
    }
    for (const [d, x] of taken) if (deltas.get(d) === x) deltas.delete(d);   // saved (a newer count of the day stays)
    if (full) { lastFull = now; wantFull = false; }
    lastToday = now;
  } catch {
    // Never in the way: the next look tries again.
  } finally {
    running = false;
  }
  clearTimeout(timer);
  timer = window.setTimeout(() => void run(), deltas.size ? TODAY_EVERY : Math.max(60_000, Math.min(FULL_EVERY, lastFull + FULL_EVERY - Date.now())));
}

/** Months of money in from the squad's board (a sealed op from the person's own drop): added into the year record, write
 *  only, never lowering what PS has. Skipped when Rewind is off, or for months before Delete my Rewind data. */
export async function rewindAddMoney(list: unknown) {
  const c = context();
  if (!c) return;
  const sinceMonth = c.since ? R.dayKey(c.since, c.tz).slice(0, 7) : "";
  const recs = R.moneyRecs(list).map((y) => ({ ...y, mo: Object.fromEntries(Object.entries(y.mo || {}).filter(([m]) => m >= sinceMonth)) }));
  const p = R.plan(docs<unknown>("rwd", null), recs, { now: Date.now(), tz: c.tz, since: c.since });
  for (const w of p.puts) await put("rwd", w.data, { id: w.id, ws: null });
  for (const id of p.removes) await remove(id);
}

/** Delete my Rewind data: every Rewind record goes, and nothing from before now is collected again. */
export async function deleteRewind(): Promise<number> {
  const s = vaultStore.get();
  if (s.status !== "unlocked" || s.role !== "owner") throw new Error("Open PS first.");
  deleting = true;
  deltas.clear();
  try {
    while (running) await new Promise((r) => setTimeout(r, 50));   // a look in progress stops at its next step

    const ids = docs<unknown>("rwd", null).map((d) => d.id);
    const cur = settingsData(vaultStore.get()).rewind;
    await saveSettings({ rewind: { on: R.rewindOn(cur), since: new Date().toISOString() } });
    for (let i = 0; i < ids.length; i += STEP) { for (const id of ids.slice(i, i + STEP)) await remove(id); await breathe(); }
    return ids.length;
  } finally {
    deleting = false;
  }
}
/** The switch. Off: nothing more is collected (what is kept stays until deleted). On again: from now on. */
export async function setRewindOn(on: boolean) {
  const cur = settingsData(vaultStore.get()).rewind;
  if (!on) deltas.clear();
  await saveSettings({ rewind: R.rewindSwitch(cur, on, new Date().toISOString()) });
}

/** Starts once per page: the main page on the Mac, the phone and the website. */
export function startRewind() {
  if (started) return;
  started = true;
  let was = false;
  vaultStore.subscribe(() => {
    const now = ready(vaultStore.get());
    if (now && !was) { wantFull = true; schedule(5_000); }   // unlocked and downloaded: the full look (the backfill) soon
    else if (now) schedule(SETTLE);
    was = now;
  });
  const act = () => rewindActive();
  for (const ev of ["pointerdown", "keydown", "focus"]) window.addEventListener(ev, act, { passive: true, capture: true });
  const hidden = () => { if (deltas.size) { clearTimeout(timer); void run(); } };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") hidden(); });
  window.addEventListener("pagehide", hidden);
  if (ready(vaultStore.get())) { was = true; schedule(5_000); }
}

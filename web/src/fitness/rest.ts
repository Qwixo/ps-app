// PS Fitness: the rest timer between sets (the developer: "currently in the gym I have a stopwatch on my phone and I
// do it on and off. Often I forget about it"). Ticking a set starts it by itself.
// Phone (PS GOS): the shell owns it (src/gos/fitness.ts, ps-gos Fitness.kt): a lock screen countdown that
// keeps running with the screen off, a strong buzz at zero, +15 s and Skip on the notification. This page
// only mirrors what the shell says. Mac PS and the website: an in-page timer that ends with PS's own
// sound and a card (Toast.swift "cardShow"), or a sound and a buzz in a browser.
// Times are absolute (endsAt, epoch ms): a reload, sleep or a paused WebView never makes it drift.
import { useEffect, useState, useSyncExternalStore } from "react";
import { fitness, type FitnessEvent } from "../gos/fitness";
import { PS, psInOverlay, psPost } from "../ps";
import { sfx } from "../ui/sfx";
import { restNudge, type RestState } from "../core/fitness";

export interface RestNow extends RestState {
  exercise: string;
  set: number;          // the set just finished (1 based)
  of: number;
  over: boolean;        // ran out (or skipped): "Rest over" until the next set
  overAt: number;
}
const KEY = "fit.rest";
const GOS = import.meta.env.MODE === "gos";
const native = () => GOS && fitness.available();

let cur: RestNow | null = load();
let perms = { notifications: true, exactAlarm: true };
let sound = true;   // Fitness settings: a sound when a rest ends (the phone always buzzes)
const subs = new Set<() => void>();
function set(r: RestNow | null) {
  cur = r;
  try { if (r) localStorage.setItem(KEY, JSON.stringify(r)); else localStorage.removeItem(KEY); } catch { /* storage off */ }
  arm();
  subs.forEach((f) => f());
}
function load(): RestNow | null {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || "null") as RestNow | null;
    // A rest that ended long ago is not worth showing again.
    return r && Number.isFinite(r.endsAt) && Date.now() - r.endsAt < 30 * 60_000 ? r : null;
  } catch { return null; }
}

// ---------- the in-page end (Mac and website; the phone's shell ends its own) ----------
let endTimer = 0;
function arm() {
  clearTimeout(endTimer);
  if (!cur || cur.over || native()) return;
  endTimer = window.setTimeout(ended, Math.max(0, cur.endsAt - Date.now()));
}
function ended() {
  if (!cur || cur.over) return;
  const r = cur;
  set({ ...r, over: true, overAt: Date.now() });
  if (sound) { sfx.done(); window.setTimeout(() => sfx.done(), 260); }
  // Fitness lives in the Tab list on the Mac: PS's main page shows the card for it (ps.ts fitCard).
  const card = { title: "Rest over: next set", sub: `${r.exercise}: set ${Math.min(r.set + 1, r.of || r.set + 1)}${r.of ? ` of ${r.of}` : ""}` };
  if (PS && psInOverlay()) psPost({ type: "looks", patch: { fitCard: card } });
  else if (PS) psPost({ type: "cardShow", card: { id: "f-rest", ...card } });
  else try { navigator.vibrate?.([300, 120, 300, 120, 500]); } catch { /* no vibration here */ }
  endListeners.forEach((f) => f(r));
}
const hideCard = () => { if (PS && psInOverlay()) psPost({ type: "looks", patch: { fitCard: { hide: true } } }); else if (PS) psPost({ type: "cardHide", id: "f-rest" }); };

// ---------- the phone shell's word is final ----------
let started = false;
function startNative() {
  if (started || !native()) return;
  started = true;
  fitness.onEvent((e: FitnessEvent) => {
    perms = e.perms || perms;
    const r = e.rest;
    if (!r || e.event === "cancelled") { set(null); return; }
    const was = cur;
    set({ endsAt: r.endsAt, total: r.sec, exId: was?.exId ?? "", setId: r.id, exercise: r.exercise, set: r.set, of: r.of, over: r.over, overAt: r.overAt });
    if (e.event === "ended" && was && !was.over) endListeners.forEach((f) => f(cur!));
  });
  fitness.refresh();
}

// ---------- what the screens call ----------
const endListeners = new Set<(r: RestNow) => void>();
export const rest = {
  /** A set was ticked: rest for `sec`, with what to show on the lock screen. */
  start(o: { sec: number; exercise: string; set: number; of: number; exId: string; setId: string }) {
    startNative();
    const now = Date.now();
    set({ endsAt: now + o.sec * 1000, total: o.sec, exId: o.exId, setId: o.setId, exercise: o.exercise, set: o.set, of: o.of, over: false, overAt: 0 });
    hideCard();
    if (native()) fitness.startRest({ sec: o.sec, exercise: o.exercise, set: o.set, of: o.of, id: o.setId, sound });
  },
  /** +15 s or -15 s. Less than 5 s left after -15 s ends it. */
  add(sec: number) {
    if (!cur || cur.over) return;
    const n = restNudge(cur, sec, Date.now());
    if (!n) { this.skip(); return; }
    set({ ...cur, ...n });
    if (native()) fitness.addRest(sec);
  },
  skip() {
    if (!cur) return;
    set({ ...cur, over: true, overAt: Date.now(), endsAt: Math.min(cur.endsAt, Date.now()) });
    hideCard();
    if (native()) fitness.skipRest();
  },
  /** The set was un-ticked or the workout ended: no rest at all. */
  cancel() {
    if (!cur) return;
    set(null);
    hideCard();
    if (native()) fitness.cancelRest();
  },
  /** "Rest over" seen (the next set started): gone from the screen. */
  clear() { if (cur?.over) { set(null); hideCard(); } },
  onEnd(f: (r: RestNow) => void) { endListeners.add(f); return () => { endListeners.delete(f); }; },
  /** The rest as it is now (null: none). */
  now: (): RestNow | null => cur,
  /** Any change to the rest: started, +15, skipped, over, cancelled. Returns the function that stops listening. */
  onChange(f: (r: RestNow | null) => void) { const g = () => f(cur); subs.add(g); return () => { subs.delete(g); }; },
  perms: () => perms,
  setSound(on: boolean) { sound = on; },
};

export function useRest(): RestNow | null {
  useEffect(() => { startNative(); }, []);
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => cur, () => cur);
}
/** Seconds left, redrawn on each whole second (in step with the lock screen's clock). */
export function useRestLeft(r: RestNow | null): number {
  const [, force] = useState(0);
  useEffect(() => {
    if (!r || r.over) return;
    let t = 0;
    const tick = () => { force((n) => n + 1); const ms = (r.endsAt - Date.now()) % 1000; t = window.setTimeout(tick, ms > 20 ? ms : ms + 1000); };
    tick();
    return () => clearTimeout(t);
  }, [r]);
  return r ? Math.max(0, Math.ceil((r.endsAt - Date.now()) / 1000)) : 0;
}

/** Keeps the screen on while the gym screen is open (the shell on the phone, a wake lock in a browser). */
export function useKeepAwake(on: boolean) {
  useEffect(() => {
    if (!on) return;
    if (GOS) { fitness.keepAwake(true); const again = () => { if (document.visibilityState === "visible") fitness.keepAwake(true); }; document.addEventListener("visibilitychange", again); return () => { document.removeEventListener("visibilitychange", again); fitness.keepAwake(false); }; }
    let lock: { release(): Promise<void> } | null = null, gone = false;
    const get = () => { (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock?.request("screen").then((l) => { if (gone) void l.release(); else lock = l; }).catch(() => {}); };
    const again = () => { if (document.visibilityState === "visible") get(); };
    get();
    document.addEventListener("visibilitychange", again);
    return () => { gone = true; document.removeEventListener("visibilitychange", again); void lock?.release().catch(() => {}); };
  }, [on]);
}

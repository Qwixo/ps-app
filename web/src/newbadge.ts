// The NEW badge's live side (rule in core/newbadge.ts, badge and settings in views/NewBadge.tsx).
// One timer for the whole list: it is set for the soonest badge to run out, fires, and is set again for the next
// one. Each badge reads a boolean from this store, so only the rows whose badge appears or goes draw again; the
// list itself is never redrawn on a clock.
import { useSyncExternalStore } from "react";
import { vaultStore } from "./core/vault";
import { settingsData, todos } from "./core/select";
import { cleanNewLooks, isNewTask, newPrefs, nextNewExpiry, type NewPrefs } from "./core/newbadge";
import type { Settings } from "./core/model";

let clock = Date.now();
let prefs: NewPrefs = newPrefs(null);
let timer = 0;
let stopVault: (() => void) | null = null;
const subs = new Set<() => void>();

/** Read the newest list and settings, and set the one timer for the soonest badge to go. */
function refresh() {
  window.clearTimeout(timer);
  timer = 0;
  const s = vaultStore.get();
  clock = Date.now();
  prefs = newPrefs(settingsData(s));
  const next = nextNewExpiry(todos(s), clock, prefs);
  if (next != null) timer = window.setTimeout(() => { refresh(); emit(); }, Math.min(2_147_000_000, Math.max(0, next - clock) + 250));
}
function emit() { subs.forEach((l) => l()); }
function onVault() { refresh(); emit(); }
// Back from sleep or a hidden tab: timers may have run late, so look again at once.
function onVisible() { if (document.visibilityState === "visible") onVault(); }

function subscribe(l: () => void) {
  subs.add(l);
  if (!stopVault) {
    const un = vaultStore.subscribe(onVault);
    document.addEventListener("visibilitychange", onVisible);
    stopVault = () => { un(); document.removeEventListener("visibilitychange", onVisible); };
    refresh();
  }
  return () => {
    subs.delete(l);
    if (!subs.size && stopVault) { stopVault(); stopVault = null; window.clearTimeout(timer); timer = 0; }
  };
}

/** Does this task show NEW right now? Only this row draws again when the answer changes. */
export function useIsNew(id: string, t: { createdAt?: string; done: boolean; clearedAt?: string | null }): boolean {
  return useSyncExternalStore(subscribe, () => isNewTask(t, id, clock, prefs), () => false);
}

/** The badge settings as they are now (on, minutes), for the Settings controls. */
export function newBadgeSettings(s: Settings) { const p = newPrefs(s); return { on: p.on, min: p.min }; }

/** The badge part of a "looks" patch, checked against this window's vault (ps.ts cleanLooks). */
export function newLooks(p: Record<string, unknown>): Partial<Settings> {
  const s = vaultStore.get();
  return cleanNewLooks(p, settingsData(s), (id) => {
    const d = todos(s).find((x) => x.id === id);
    return d ? (d.data.createdAt ?? null) : undefined;
  }, Date.now());
}

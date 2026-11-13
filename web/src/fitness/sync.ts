// PS Fitness, near live backup and sync (V1.29). The rules are in sync-logic.ts (tested); this wires them up:
// - every Fitness write (store.ts) goes through fitPush.write: saved on this device first (the vault's encrypted
//   outbox, kept in IndexedDB), then a debounced push (change only), retried with a growing wait when it fails;
// - a pull when Fitness opens, when the window gets focus, every 15 s while a workout is open and on screen (the
//   vault's tiny probe: records come down only when something changed), plus the vault's own pulls (wake, its paced
//   probe) and the Realtime poke: a Fitness save on one device pokes the others to pull now (core/vault.ts);
// - the Sync button's state: "Synced 2 min ago", "Syncing", "Not synced yet", "Offline, will sync".
// PS's Tab list on the Mac holds no keys: its writes already go to PS's main page (ps.ts runFitOp), so its push and
// pull are a "fitSync" message to that page, and its state comes from the main page's copy (pending flags, lastSync).
import { useEffect, useState, useSyncExternalStore } from "react";
import { listenFitPoke, sync, vaultStore, type Snapshot } from "../core/vault";
import { PS, psInOverlay, psPost } from "../ps";
import { createPusher, nextLabelIn, syncLabel, type SyncInfo } from "./sync-logic";

const FIT = new Set(["fprog", "fwork", "fit", "fsleep", "fact"]);
const overlay = () => PS && psInOverlay();
const online = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false) && vaultStore.get().online !== false;

async function pushNow(): Promise<boolean> {
  if (overlay()) { psPost({ type: "looks", patch: { fitSync: true } }); return true; }   // PS's main page sends and pulls
  if (vaultStore.get().status !== "unlocked") return false;
  await sync();                                     // flush (what is waiting) then pull (a tiny probe when nothing moved)
  const s = vaultStore.get();
  const ok = !s.syncError && !fitPending(s);
  emit();
  return ok;
}
export const fitPush = createPusher({
  push: pushNow,
  online,
  setTimer: (f, ms) => window.setTimeout(f, ms),
  clearTimer: (t) => window.clearTimeout(t as number),
});

/** A Fitness record on this device that the vault does not have yet. */
export function fitPending(s: Snapshot = vaultStore.get()): boolean {
  for (const d of s.docs.values()) if (d.pending && FIT.has(d.kind as string)) return true;
  return false;
}

// ---------- state for the Sync button ----------
let spinning = false, pendingSince: number | null = null;
const subs = new Set<() => void>();
let ver = 0;
function emit() { ver++; subs.forEach((f) => f()); }
let watching = false;
function watch() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  let was = fitPending();
  if (was) pendingSince = Date.now();
  vaultStore.subscribe(() => {
    const now = fitPending();
    if (now && !was) pendingSince = Date.now();
    if (!now) pendingSince = null;
    was = now;
    emit();
  });
  window.addEventListener("online", () => { fitPush.kick(); emit(); });
  window.addEventListener("offline", emit);
}

export function fitSyncInfo(now = Date.now()): SyncInfo {
  const s = vaultStore.get();
  const last = s.lastSync ? Date.parse(s.lastSync) : null;
  const pending = fitPending(s);
  // Only the vault's own error counts: a push that met the vault's own flush half way is just "Syncing", and a change
  // still waiting after the grace says "Not synced yet" by itself.
  const error = !!s.syncError;
  return { now, lastSync: Number.isFinite(last) ? last : null, pending, pendingSince, online: online(), syncing: spinning, error };
}

/** The label, redrawn when its words change (not every second). */
export function useFitSync(): { text: string; tone: "ok" | "busy" | "warn"; spinning: boolean; force: () => void } {
  useEffect(watch, []);
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => ver, () => ver);
  const [, tick] = useState(0);
  const info = fitSyncInfo();
  const wait = nextLabelIn(info);
  useEffect(() => { const t = window.setTimeout(() => tick((n) => n + 1), wait); return () => clearTimeout(t); });
  return { ...syncLabel(info), spinning, force: () => void forceSync() };
}

/** The Sync button: push and pull now, with a short spin (at least 700 ms so it reads as "it did something"). */
export async function forceSync() {
  if (spinning) return;
  spinning = true; emit();
  const t0 = Date.now();
  try { await fitPush.force(); } finally {
    // The Tab list's main page answers through its state copy: give it a moment to arrive.
    const min = overlay() ? 1400 : 700;
    window.setTimeout(() => { spinning = false; emit(); }, Math.max(0, min - (Date.now() - t0)));
  }
}

/** While Fitness is on screen: a pull when it opens and on focus, and every 15 s during a workout (probe only). */
export function useFitPulls(on: boolean, live: boolean) {
  useEffect(() => {
    if (!on) return;
    if (!overlay()) listenFitPoke();   // the other device's saves arrive within seconds (core/vault.ts)
    let last = 0;
    const pull = () => {
      if (document.visibilityState === "hidden" || Date.now() - last < 5000) return;
      last = Date.now();
      fitPush.kick();
    };
    pull();
    window.addEventListener("focus", pull);
    document.addEventListener("visibilitychange", pull);
    const t = live ? window.setInterval(pull, 15_000) : 0;
    return () => { window.removeEventListener("focus", pull); document.removeEventListener("visibilitychange", pull); if (t) clearInterval(t); };
  }, [on, live]);
}

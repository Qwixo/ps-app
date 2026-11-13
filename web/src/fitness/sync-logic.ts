// PS Fitness, near live backup (V1.29, the developer: every set, edit, extra set, drop set and finish saved on the device at
// once and in the vault within a few seconds). Pure, so the order is unit tested (tests/fitness-sync.test.ts):
//   1. save: the change is written on this device first (the vault's encrypted outbox, kept in IndexedDB), so a
//      phone killed mid workout loses nothing;
//   2. push: only after the save has landed, a debounced push sends the changed records (change only, so the
//      Supabase egress stays tiny). A push that fails, or no signal, is tried again with a growing wait.
// Nothing here waits on the network before the save, and nothing blocks: every step is a promise or a timer.
// Imported with the .ts extension so node can run the tests straight from the source.

export interface PushDeps {
  /** Sends what is waiting and pulls what changed. True when it went through. */
  push: () => Promise<boolean>;
  online: () => boolean;
  setTimer: (f: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
}
export interface PushOpts { debounceMs: number; backoffMs: number[] }
export const PUSH_DEFAULTS: PushOpts = { debounceMs: 1200, backoffMs: [2000, 4000, 8000, 16000, 30000, 60000] };

export interface Pusher {
  /** Saves first; only once the save has landed is a push booked. A failed save books nothing and throws. */
  write<T>(save: () => Promise<T>): Promise<T>;
  /** A push soon (after the debounce), eg when the signal comes back. */
  kick(): void;
  /** Push and pull now (the Sync button). True when it went through. */
  force(): Promise<boolean>;
  state(): { waiting: boolean; failures: number; pushing: boolean };
}

export function createPusher(d: PushDeps, o: PushOpts = PUSH_DEFAULTS): Pusher {
  let timer: unknown = null, failures = 0, pushing = false, again = false, waiting = false;
  const book = (ms: number) => { if (timer != null) d.clearTimer(timer); waiting = true; timer = d.setTimer(() => { timer = null; void run(); }, ms); };
  const retry = () => { failures++; book(o.backoffMs[Math.min(failures - 1, o.backoffMs.length - 1)]); };
  async function run(): Promise<boolean> {
    if (pushing) { again = true; return false; }
    if (!d.online()) { retry(); return false; }
    pushing = true; waiting = false;
    let ok = false;
    try { ok = await d.push(); } catch { ok = false; }
    pushing = false;
    if (ok) failures = 0; else retry();
    if (again) { again = false; book(o.debounceMs); }
    return ok;
  }
  return {
    async write(save) {
      const out = await save();          // the device copy first, always
      book(o.debounceMs);                // then the push, once taps settle
      return out;
    },
    kick() { book(o.debounceMs); },
    force() { if (timer != null) { d.clearTimer(timer); timer = null; } failures = 0; return run(); },
    state: () => ({ waiting, failures, pushing }),
  };
}

// ---------- "Synced 2 min ago" ----------
export type SyncTone = "ok" | "busy" | "warn";
export interface SyncInfo {
  now: number;
  lastSync: number | null;     // the last time this device and the vault matched (ms)
  pending: boolean;            // a Fitness change on this device not in the vault yet
  pendingSince: number | null; // when that started (ms)
  online: boolean;
  syncing: boolean;            // the Sync button's own spin
  error: boolean;              // the last try failed
}
/** How long a fresh change may be on its way before the label stops saying "Syncing" and says "Not synced yet". */
export const SYNC_GRACE_MS = 8000;

/** "Synced just now", "Synced 2 min ago", "Synced 3 h ago", "Synced 2 days ago". */
export function agoText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** The Sync button's words and colour. Never says "Synced" while a change is waiting or the last try failed. */
export function syncLabel(i: SyncInfo): { text: string; tone: SyncTone } {
  if (i.syncing) return { text: "Syncing", tone: "busy" };
  if (!i.online) return { text: "Offline, will sync", tone: "warn" };
  if (i.pending) {
    const fresh = !i.error && i.pendingSince != null && i.now - i.pendingSince < SYNC_GRACE_MS;
    return fresh ? { text: "Syncing", tone: "busy" } : { text: "Not synced yet", tone: "warn" };
  }
  if (i.error || i.lastSync == null) return { text: "Not synced yet", tone: "warn" };
  return { text: `Synced ${agoText(i.now - i.lastSync)}`, tone: "ok" };
}
/** When the words next change (ms from now), so the label redraws on time and not every second. */
export function nextLabelIn(i: SyncInfo): number {
  if (i.pending && i.pendingSince != null) return Math.max(250, SYNC_GRACE_MS - (i.now - i.pendingSince) + 50);
  if (i.lastSync == null) return 30_000;
  const s = (i.now - i.lastSync) / 1000;
  return s < 45 ? (45 - s) * 1000 + 50 : 15_000;
}

// The page's side of the recordings list and the cloud settings (PS 1.60, pull request 12c). The Mac sends three kinds of message through
// window.__psScreenRec (src/screenrec.ts forwards them here): the list ("screenrecLib"), the cloud state ("screenrecCloud") and the
// delete question ("screenrecAsk"). Every click goes back as {type: "screenrec", op: "rec..." | "cloud..."}.
// Sync: this Mac's rows go to the encrypted vault as small "srec" records (core/recordings.ts syncPlan: only rows that changed, never the
// media), so the phone and the website can show the same list. Nothing is sent while the vault is locked or screen recording is off.
import { useSyncExternalStore } from "react";
import { psPost, PS } from "./ps";
import { docs, put, remove } from "./core/vault";
import { vaultStore } from "./core/vault";
import { cleanAsk, cleanCloud, cleanLib, syncPlan, type CloudState, type RecAsk, type RecDoc, type RecRow } from "./core/recordings";

let lib: { device: string | null; rows: RecRow[] } | null = null;
let cloud: CloudState | null = null;
let ask: RecAsk | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Called by src/screenrec.ts for every message from the Mac. Returns true when it was one of ours. */
export function recMessage(m: unknown): boolean {
  const l = cleanLib(m);
  if (l) { lib = l; emit(); void syncToVault(l); return true; }
  const c = cleanCloud(m);
  if (c) { cloud = c; emit(); return true; }
  const a = cleanAsk(m);
  if (a) { ask = a; emit(); return true; }
  return false;
}
export const useMacRecs = () => useSyncExternalStore(subscribe, () => lib);
export const useCloud = () => useSyncExternalStore(subscribe, () => cloud);
export const useAsk = () => useSyncExternalStore(subscribe, () => ask);
export const clearAsk = () => { ask = null; emit(); };

export function recSend(op: string, extra: Record<string, unknown> = {}): void { if (PS) psPost({ type: "screenrec", op, ...extra }); }
let asked = false;
/** Ask the Mac for the list and the cloud state, once (in PS only, and the Mac answers nothing while screen recording is off). */
export function askRecordings(): void { if (PS && !asked) { asked = true; recSend("recList"); recSend("cloudGet"); } }

type Lib = { device: string | null; rows: RecRow[] };
let syncing = false, again: Lib | null = null;
async function syncToVault(l: Lib): Promise<void> {
  if (!PS) return;
  if (syncing) { again = l; return; }
  syncing = true;
  try {
    if (vaultStore.get().status !== "unlocked") return;
    const have = docs<RecDoc>("srec", null).map((d) => ({ id: d.id, data: d.data }));
    const plan = syncPlan(have, l.rows, l.device);
    for (const r of plan.put) {
      const old = have.find((d) => d.data.id === r.id);
      await put<RecDoc>("srec", r, { id: old?.id, ws: null });
    }
    for (const id of plan.remove) { const old = have.find((d) => d.data.id === id); if (old) await remove(old.id); }
  } catch { /* the vault is busy or offline: the next list message tries again */ }
  finally { syncing = false; if (again) { const n = again; again = null; void syncToVault(n); } }
}

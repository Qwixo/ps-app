// PS Fitness Sleep (V1.40): the vault side. One small encrypted record per sleep (kind "fsleep", owner private,
// vault key, change only sync like every Fitness record: saved on this device first, pushed within seconds, the
// other devices poked to pull). The rules are in core/sleep.ts; this file reads and writes, and hands out the
// read only summary a G Squad board may use later. It never sends anything anywhere itself.
import { useMemo } from "react";
import { put, remove, setMerger, vaultStore, type Snapshot } from "../core/vault";
import { homeTz } from "../core/tz";
import { useVault } from "../ui/kit";
import { fitPush } from "./sync";
import { fitnessNow, savePrefs } from "./store";
import { byDay, cleanLog, dayIn, logFromSleepMode, mergeLog, sleepSummary, type SleepLog, type SleepSummary } from "../core/sleep";

setMerger("fsleep", (a, b) => mergeLog(a as SleepLog, b as SleepLog));

export interface SleepDoc { id: string; log: SleepLog }
export interface SleepView { docs: SleepDoc[]; days: Map<string, SleepLog>; ids: Map<string, string>; tz: string; today: string }

function view(s: Snapshot, now = Date.now()): SleepView {
  const docs: SleepDoc[] = [];
  for (const d of s.docs.values()) {
    if ((d.kind as string) !== "fsleep") continue;
    const log = cleanLog(d.data);
    if (log) docs.push({ id: d.id, log });
  }
  const days = byDay(docs.map((d) => d.log));
  const ids = new Map<string, string>();
  for (const d of docs) if (days.get(d.log.day) === d.log) ids.set(d.log.day, d.id);
  const tz = homeTz();
  return { docs, days, ids, tz, today: dayIn(now, tz) };
}
/** Every sleep in the open vault, one per wake date. */
export function useSleep(): SleepView {
  const s = useVault();
  return useMemo(() => view(s), [s]);
}
export const sleepNow = () => view(vaultStore.get());

/** Saves a sleep (new, or an edit of `id`). If the wake date moved onto a date that already has a sleep, that one
 *  is replaced, so there is never more than one sleep per date. */
export function saveSleep(log: SleepLog, id?: string | null): Promise<unknown> {
  return fitPush.write(async () => {
    const v = sleepNow();
    const there = v.ids.get(log.day);
    const keep = there ?? id ?? undefined;
    await put<SleepLog>("fsleep", log, { id: keep, ws: null });
    if (id && keep !== id && vaultStore.get().docs.get(id)?.kind === "fsleep") await remove(id);
  });
}
export function deleteSleep(id: string): Promise<unknown> {
  return fitPush.write(async () => { if (vaultStore.get().docs.get(id)?.kind === "fsleep") await remove(id); });
}

// ---------- for a G Squad board (read only; another part of PS decides whether and how to share it) ----------
/** The streak and this week's average only, or null when the owner switched sleep sharing off (prefs.sleepShare). */
export function sleepSummaryNow(now = Date.now()): SleepSummary | null {
  const s = vaultStore.get();
  if (s.status !== "unlocked") return null;
  const v = view(s, now);
  return sleepSummary(v.days.values(), fitnessNow().prefs, v.today);
}

// ---------- hook for a future bedside Sleep mode (future-ideas.md, M1 bedside version) ----------
/** Sleep mode's bed button: remembers "went to sleep about now" in the Fitness settings record (synced, so the phone
 *  or another Mac can press Wake up). */
export function sleepModeAsleep(at = Date.now()) {
  return savePrefs({ sleepOpen: { at: new Date(at).toISOString(), tz: homeTz() } });
}
/** Sleep mode's Wake up: turns the open "went to sleep" into that date's sleep. A sleep the person typed for that date
 *  is never overwritten. Returns the saved log, or null (no open sleep, a doze under 30 min, or a forgotten button). */
export async function sleepModeWake(at = Date.now()): Promise<SleepLog | null> {
  const open = fitnessNow().prefs.sleepOpen;
  if (!open) return null;
  await savePrefs({ sleepOpen: null });
  const log = logFromSleepMode(Date.parse(open.at), at, open.tz);
  if (!log) return null;
  const had = sleepNow().days.get(log.day);
  if (had && had.src !== "sleepmode") return null;
  await saveSleep(log);
  return log;
}

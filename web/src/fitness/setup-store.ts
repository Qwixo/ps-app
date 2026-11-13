// PS Fitness setup: where the draft lives (V1.47). Every tap is written to this device at once (localStorage, so closing
// Fitness, the app or the phone mid answer loses nothing, even before the vault has opened) and to the synced Fitness
// settings a moment later (prefs.setup, encrypted like the rest, so the Mac and the phone carry on from each other).
// Which copy wins is setup-logic.ts pickDraft: the newer one.
import { useMemo, useSyncExternalStore } from "react";
import { addProgram, savePrefs, type FitView } from "./store";
import { newDraft, pickDraft, planToProgram, resolved, sanitizeDraft, type SetupDraft, type Step } from "./setup-logic";

const KEY = "fit.setup", LATER = "fit.setupLater";
const SAVE_MS = 450;

let local: SetupDraft | null = read();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
function read(): SetupDraft | null {
  try { const s = localStorage.getItem(KEY); return s ? sanitizeDraft(JSON.parse(s)) : null; } catch { return null; }
}
function writeLocal(d: SetupDraft | null) {
  local = d;
  try { if (d) localStorage.setItem(KEY, JSON.stringify(d)); else localStorage.removeItem(KEY); } catch { /* storage off: the vault copy still saves */ }
  emit();
}

// ---------- the vault copy, a moment after the last tap (and at once when the page hides) ----------
let pending: SetupDraft | null = null, timer = 0;
function flush() {
  window.clearTimeout(timer);
  const d = pending;
  pending = null;
  if (d) void savePrefs({ setup: d }).catch(() => { /* still on this device; sent next time setup opens */ });
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
}

/** The draft to show: this device's or the synced one, whichever is newer. Null when there is none. */
export function draftOf(v: FitView): SetupDraft | null {
  const synced = sanitizeDraft(v.prefs.setup ?? null);
  const clearedAt = v.prefs.setup == null ? v.prefs.at?.setup ?? null : null;
  return pickDraft(local, synced, { clearedAt, doneAt: v.prefs.setupDone ?? null });
}
export function useSetupDraft(v: FitView): SetupDraft | null {
  const l = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => local, () => local);
  return useMemo(() => draftOf(v), [v, l]); // eslint-disable-line react-hooks/exhaustive-deps
}
/** Saves one change: here at once, the vault shortly after. */
export function saveDraft(d: SetupDraft) {
  writeLocal(d);
  pending = d;
  window.clearTimeout(timer);
  timer = window.setTimeout(flush, SAVE_MS);
}
/** This device has a newer copy than the vault (it was closed before the vault copy went): send it now. */
export function pushIfNewer(v: FitView) {
  const d = local;
  if (!v.ready || !d) return;
  const synced = sanitizeDraft(v.prefs.setup ?? null);
  if (draftOf(v) === d && (!synced || synced.at < d.at)) { pending = d; flush(); }
}
/** Begins setup (or carries on with the draft there is). */
export function beginSetup(v: FitView, step: Step = "start"): SetupDraft {
  const d = draftOf(v) ?? newDraft(new Date().toISOString(), step);
  if (!draftOf(v)) saveDraft(d);
  setLater(false);
  return d;
}
/** Finished, or put away for good: no draft anywhere, and setup never opens by itself again. */
export function endSetup() {
  window.clearTimeout(timer);
  pending = null;
  writeLocal(null);
  return savePrefs({ setup: null, setupDone: new Date().toISOString() });
}
/** Saves the plan as the active program, the days per week as the week goal, and ends setup. */
export async function saveSetup(d: SetupDraft): Promise<string | null> {
  if (!d.plan) return null;
  const id = await addProgram(planToProgram(d.plan), { activate: true });
  const days = d.plan.scratch ? d.plan.days.length : resolved(d.a).days;
  await savePrefs({ weekGoal: Math.max(1, Math.min(7, days)) });
  await endSetup();
  return id;
}

/** "Not now": setup stops opening by itself on this device (Home keeps its Continue card). */
export function setLater(on: boolean) { try { if (on) localStorage.setItem(LATER, "1"); else localStorage.removeItem(LATER); } catch { /* storage off */ } }
export function isLater() { try { return localStorage.getItem(LATER) === "1"; } catch { return false; } }

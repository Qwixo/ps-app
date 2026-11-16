// Which Checklist reminder screen is open in the Tab list (PS 1.65, core/chkremind.ts): "rethink" (the big headline, the counter and
// every task with Delete and Send to Dimension X) or "forgot" (pick one task, then "Add it to the Dynamic Island?"). One small store so the
// engine (src/chkwatch.ts, the website) and the Mac (window.__psChk, called by Sources/main.swift after a choice on its card) open the same
// screen, which views/ChecklistReminder.tsx draws inside the list. Nothing is saved: a screen is only ever open or not.
import { useSyncExternalStore } from "react";
import { isScreen, type ChkScreen } from "./core/chkremind";

let now: ChkScreen | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const chkScreenNow = () => now;
export function openChkScreen(s: unknown) { if (isScreen(s) && s !== now) { now = s; emit(); } }
export function closeChkScreen() { if (now) { now = null; emit(); } }
export function useChkScreen(): ChkScreen | null { return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, chkScreenNow, chkScreenNow); }

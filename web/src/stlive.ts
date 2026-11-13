// This phone's own screen time line, live from the PS GOS shell (V1.31). A tiny store with no other
// imports so the shared screen time pop-up (views/TaskMap.tsx) can read it without pulling the
// phone's bridge into the Mac or website builds. src/gos/bridge.ts fills it and sets the ask.
import { useSyncExternalStore } from "react";
import type { Timeline } from "./core/stline";

let line: Timeline | null = null;
let ask: (() => void) | null = null;
const subs = new Set<() => void>();
export function setPhoneLine(tl: Timeline) { line = tl; subs.forEach((f) => f()); }
export function setPhoneAsk(f: () => void) { ask = f; }
/** Ask the shell to count now (the pop-up opening). Nothing outside the phone build. */
export function askPhoneLine() { ask?.(); }
export function usePhoneLine(): Timeline | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => line);
}

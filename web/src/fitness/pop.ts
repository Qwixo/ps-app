// PS Fitness as a pop up (V1.29, the developer: "a large pop up over the app with a clear Close and a Minimise button.
// Minimised it shrinks to a small floating bubble showing the live rest timer and set progress; tap it to bring
// the pop up back"). One small state per page: closed, open or min. The phone (FitnessPop.tsx) and the Mac's Tab
// list (FitnessButton.tsx) each draw it their own way; the bubble is FitMini.tsx.
// "min" is remembered on this device, so a minimised workout keeps its bubble after PS restarts.
import { useSyncExternalStore } from "react";

export type PopState = "closed" | "open" | "min";
const KEY = "fit.pop";
const subs = new Set<() => void>();
function load(): PopState { try { return localStorage.getItem(KEY) === "min" ? "min" : "closed"; } catch { return "closed"; } }
let cur: PopState = typeof window === "undefined" ? "closed" : load();
/** Where the next open grows from (the Gym button, the bubble): a rect, read at the moment of the tap. */
let from: DOMRect | null = null;

function set(s: PopState, origin?: Element | null) {
  if (origin) from = origin.getBoundingClientRect();
  if (s === cur) return;
  cur = s;
  try { if (s === "min") localStorage.setItem(KEY, "min"); else localStorage.removeItem(KEY); } catch { /* storage off */ }
  subs.forEach((f) => f());
}
export const fitPop = {
  get: () => cur,
  open: (origin?: Element | null) => set("open", origin),
  min: () => set("min"),
  close: () => set("closed"),
  /** The rect to grow from, used once. */
  takeOrigin: () => { const r = from; from = null; return r; },
};
export function useFitPop(): PopState {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => cur, () => cur);
}

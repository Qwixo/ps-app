// PS Fitness light and dark (V1.29, the developer: a sun / moon button at the top of Fitness, readable in bright sunlight).
// Fitness only: the rest of PS keeps its own theme. Remembered PER DEVICE (localStorage "fit.theme"), never synced:
// the phone in a bright gym and the Mac at night each keep their own choice, and it costs no vault traffic.
// No choice yet: Chalk (already the white high contrast look) starts light, Volt and Pulse start dark.
import { useSyncExternalStore } from "react";
import type { FitStyle } from "../core/fitness";

export type FitTheme = "light" | "dark";
const KEY = "fit.theme";
const subs = new Set<() => void>();
function read(): FitTheme | null {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; } catch { return null; }
}
let cur: FitTheme | null = typeof window === "undefined" ? null : read();
if (typeof window !== "undefined") {
  // PS's Tab list and its main page share this storage: a switch in one shows in the other.
  window.addEventListener("storage", (e) => { if (e.key === KEY) { cur = read(); subs.forEach((f) => f()); } });
}
/** The light or dark picked on this device, or null when nobody picked one yet (the setup menu, V1.40). */
export const fitThemeChosen = (): FitTheme | null => cur;
export const themeFor = (style: string, chosen: FitTheme | null): FitTheme => chosen ?? (style === "chalk" ? "light" : "dark");
export function setFitTheme(t: FitTheme) {
  cur = t;
  try { localStorage.setItem(KEY, t); } catch { /* storage off: this session only */ }
  subs.forEach((f) => f());
}
/** The theme for this look on this device. The self test page can force one with ?theme=. */
export function useFitTheme(style: FitStyle | string): FitTheme {
  const chosen = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => cur, () => cur);
  const forced = typeof location !== "undefined" && location.pathname.endsWith("/fitview") ? new URLSearchParams(location.search).get("theme") : null;
  if (forced === "light" || forced === "dark") return forced;
  return themeFor(style, chosen);
}

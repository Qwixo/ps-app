// G Squad members list (PS 1.64): "At the gym" on this device. The Fitness screen tells this file when it opens and
// closes; on the Mac that screen lives in the Tab list (no keys there), so it hands the news to PS's main page as a
// `sqGym` looks patch (ps.ts), where the beat runs (squad/engine.ts). The website and the phone run both in one page.
// A running workout counts too (it is in the vault, so the engine reads it itself: fitness/store.ts fitnessNow().open).
const PS = import.meta.env.MODE === "ps";
let screen = false;
const subs = new Set<() => void>();
/** The main page (or the one page): the Fitness screen is open or closed. */
export function setGymScreen(on: boolean) {
  if (screen === on) return;
  screen = on;
  subs.forEach((f) => { try { f(); } catch { /* a listener's own problem */ } });
}
export const gymScreen = () => screen;
export function onGymScreen(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

type W = Window & { webkit?: { messageHandlers?: { ps?: { postMessage(m: string): void } } } };
/** From a Fitness screen anywhere: PS's Tab list hands it over; everywhere else it is this page. */
export function noteGymScreen(on: boolean) {
  if (!PS) { setGymScreen(on); return; }
  try { (window as W).webkit?.messageHandlers?.ps?.postMessage(JSON.stringify({ type: "looks", patch: { sqGym: on } })); } catch { /* not inside PS */ }
}

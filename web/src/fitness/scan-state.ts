// PS Fitness, Gym scan (V1.60): the four things a scan goes through, as plain events anything can listen to. The Scan screen
// (Scan.tsx) says them; the island moments (scanning, found, not found, workout added) hook in here without touching the
// screen. Pure: no React, no DOM. Tested in tests/fitness-scanstate.test.ts.
//   idle     nothing is happening (the scan screen is closed, or it is back to the camera)
//   scanning the camera took a still and the phone is reading it
//   found    the label matched an exercise: `hit` is the best one (the person has not said yes yet)
//   notfound the label matched nothing: `text` is what it said (Add as written and Try again are on screen)
//   added    the person said yes (or Add as written): the exercise is in the workout, `hit` is what was added
export type ScanStateName = "idle" | "scanning" | "found" | "notfound" | "added";
export interface ScanSeen { name: string; exId: string | null }
export interface ScanState {
  state: ScanStateName;
  /** The exercise found or added. */
  hit?: ScanSeen | null;
  /** What the label said (cleaned), for found and notfound. */
  text?: string;
  /** Counts up with every event, so a listener can tell two events in a row of the same kind apart. */
  n: number;
}

type Listener = (s: ScanState) => void;
const listeners = new Set<Listener>();
let cur: ScanState = { state: "idle", n: 0 };

/** The latest state. */
export const scanState = (): ScanState => cur;
/** Say a new state. A second "idle" in a row is not an event. Listeners that throw never stop the others. */
export function scanSay(state: ScanStateName, extra: { hit?: ScanSeen | null; text?: string } = {}): ScanState {
  if (state === "idle" && cur.state === "idle") return cur;
  cur = { state, n: cur.n + 1, ...(extra.hit !== undefined ? { hit: extra.hit } : {}), ...(extra.text !== undefined ? { text: extra.text } : {}) };
  for (const l of [...listeners]) { try { l(cur); } catch { /* one listener's mistake never stops the scan */ } }
  return cur;
}
/** Listen to every change. Returns the function that stops listening. */
export function onScanState(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
/** Tests only: back to idle with no listeners. */
export function scanStateReset() { listeners.clear(); cur = { state: "idle", n: 0 }; }

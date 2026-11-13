// Sleep mode's G Squad line ("4 people are working"), V1.40. G Squad (the hub, src/squad/ on its own branch) is
// still being built, so Sleep mode never imports it: the squad side plugs a reader in here once, at start up:
//
//   import { setSleepSquad } from "../sleepmode/squad";
//   setSleepSquad(() => squadView()?.joined ? squadView()!.workingNow : null);   // number of OTHER members working now
//   // and, whenever that number changes: sleepSquadChanged();
//
// Rules for the reader: return null while there is no squad (the line is then hidden on every device), a whole
// number otherwise; never names (the sleep screen sits next to a bed, often unlocked). Nothing here sends anything.
let reader: () => number | null = () => null;
const subs = new Set<() => void>();

export function setSleepSquad(f: (() => number | null) | null) { reader = f ?? (() => null); sleepSquadChanged(); }
/** People in your G Squad working right now, or null with no squad (or a reader that failed). */
export function sleepSquadNow(): number | null {
  try {
    const n = reader();
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  } catch { return null; }
}
export function sleepSquadChanged() { subs.forEach((f) => f()); }
export function onSleepSquad(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

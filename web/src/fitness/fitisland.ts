// PS Fitness: the glue between a workout and the phone's island (V1.60). Listens to the scan (scan-state.ts) and the rest
// timer (rest.ts), is told when a set is ticked, and hands the island its `fit` block (src/island.ts sends it with the island
// state; ps-gos IslandShow.kt draws it). The rules are in core/fitisland.ts. Phone only: with no shell there is no island.
import { onScanState, scanState } from "./scan-state";
import { rest, type RestNow } from "./rest";
import { fitness } from "../gos/fitness";
import { islandNow } from "../island";
import { todayISO } from "../ui/kit";
import { figFor } from "./island-fig";
import { fitIslandState, fitWakeAt, momentOfHint, momentOfNudge, momentOnScan, onSetDone, restJustEnded, type FitIsland, type FitMoment } from "../core/fitisland";
import type { FitLogEx, FitSet, FitWorkout } from "../core/fitness";

let moment: FitMoment | null = null;
let prefs = { on: true, sound: true };
let nudge: { title: string; sub: string; ex: string; set: number } | null = null;
let n = 0, timer = 0, started = false;

const here = () => fitness.available();
function changed() {
  clearTimeout(timer);
  const at = fitWakeAt(moment, rest.now(), Date.now());
  if (at != null) timer = window.setTimeout(() => { if (moment && Date.now() >= moment.until) moment = null; changed(); }, Math.max(50, at - Date.now() + 30));
  islandNow();
}

/** Settings, Fitness: the two switches. Turning the island off clears whatever it was showing. */
export function fitIslandPrefs(p: { on: boolean; sound: boolean }) {
  const was = prefs.on;
  prefs = p;
  if (was !== p.on) { if (!p.on) moment = null; if (here()) changed(); }
}

/** The `fit` block for the island state, or null. */
export function fitIslandPart(now = Date.now()): FitIsland | null {
  return here() ? fitIslandState(moment, rest.now(), now, prefs.on) : null;
}

/** A set was ticked in a workout: its hint now, its nudge when the rest is over. Call after the tick is saved. */
export function fitIslandSetDone(o: { ex: FitLogEx; set: FitSet; workouts: { id: string; data: FitWorkout }[]; workoutId: string }) {
  if (!here() || !prefs.on) return;
  const r = onSetDone(o.ex, o.set, o.workouts, todayISO(), o.workoutId);
  nudge = r.nudge ? { title: r.nudge.title, sub: r.nudge.sub, ex: o.ex.name, set: o.ex.sets.filter((s) => !s.gone).findIndex((s) => s.id === o.set.id) + 1 } : null;
  if (r.hint) { moment = momentOfHint(r.hint, ++n, Date.now(), prefs.sound); changed(); }
}
/** The set was un-ticked: whatever was held for it goes. */
export function fitIslandSetUndone() { nudge = null; if (moment && (moment.kind === "better" || moment.kind === "same")) { moment = null; changed(); } }

/** Starts listening (once). Safe to call from anywhere on every render. */
export function startFitIsland() {
  if (started || !here()) return;
  started = true;
  onScanState((s) => {
    if (!prefs.on) return;
    const next = momentOnScan(moment, s, Date.now(), { fig: s.hit?.exId ? figFor(s.hit.exId, s.hit.name) : null, sound: prefs.sound });
    if (next !== moment) { moment = next; changed(); }
  });
  let prev: RestNow | null = rest.now();
  rest.onChange((cur) => {
    if (prefs.on && nudge && restJustEnded(prev, cur) && cur && cur.exercise === nudge.ex && cur.set === nudge.set) {
      moment = momentOfNudge(nudge, ++n, Date.now(), prefs.sound); nudge = null;
    } else if (!cur) nudge = null;
    prev = cur;
    changed();
  });
  if (scanState().state !== "idle") moment = null;
}

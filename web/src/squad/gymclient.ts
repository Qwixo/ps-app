// G Squad Fitness (V1.40): how a Fitness screen reaches the squad. On PS's Tab list (no keys) it reads the copy the
// main page sends and asks the main page; on the phone app's page and PS's main page it talks to the engine itself.
// On the website the engine never starts, so the view says "off" and the screens say where G Squad lives.
import { useEffect, useSyncExternalStore } from "react";
import { PS, psInOverlay, psPost } from "../ps";
import { gymStore, runGymOp } from "./gym";
import { gymMirror, type GymOp, type GymSquadView } from "./gymview";
import { lpClear, lpInterval } from "../core/lowpower.ts";   // PS 1.65 Low power mode: these timers stop while asleep

const viaMain = () => PS && psInOverlay();
export function useGymSquad(): GymSquadView {
  const store = viaMain() ? gymMirror : gymStore;
  return useSyncExternalStore(store.subscribe, store.get);
}
export function gymOp(o: GymOp) {
  if (viaMain()) { psPost({ type: "looks", patch: { gymOp: o } }); return; }
  void runGymOp(o);
}

// ---------- who has the squad on screen ----------
// Each screen that shows squad data holds a lease while it is mounted (the Squad screen, a compare sheet over it).
// The engine pulls only while someone holds one, and only the exercise of the newest compare sheet.
const holders = new Map<number, string | null>();
let seq = 0, resend: number | undefined;
function sendLease() {
  if (!holders.size) {
    if (resend !== undefined) { lpClear(resend); resend = undefined; }
    gymOp({ op: "open", on: false });
    return;
  }
  const ex = [...holders.values()].reverse().find((x) => !!x) ?? null;
  gymOp({ op: "open", on: true, ex });
  if (resend === undefined) resend = lpInterval("squad-gym", () => { const e = [...holders.values()].reverse().find((x) => !!x) ?? null; gymOp({ op: "open", on: true, ex: e }); }, 60_000);
}
export function useGymLease(on: boolean, ex: string | null = null) {
  useEffect(() => {
    if (!on) return;
    const id = ++seq;
    holders.set(id, ex);
    sendLease();
    return () => { holders.delete(id); sendLease(); };
  }, [on, ex]);
}

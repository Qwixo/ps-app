// Minecraft mode, power out stopwatch: the bridge to PS (ps-mac Sources/PowerWatch.swift).
//   shell -> page: window.__psPower({type:"power:state", known, hasBattery, onBattery, since, batteryPct,
//                  minutesLeft, lastOutage, history})   pushed on every change, to the overlay AND the main page
//   page -> shell: {type:"power:get"}                   askPower(), when the panel opens
// Installs itself on import, like the network monitor, so ps.ts needs no line for it. Nothing is stored or
// sent anywhere: the history lives in PS's own local settings on this Mac.
import { useSyncExternalStore } from "react";
import { PS, psPost } from "../../ps";
import { cleanPower, EMPTY_POWER, type PowerState } from "./power-format";

export type { PowerState, Outage } from "./power-format";

let cur: PowerState = EMPTY_POWER;
const subs = new Set<() => void>();
function set(s: PowerState) { cur = s; subs.forEach((f) => f()); }

if (PS && typeof window !== "undefined") {
  (window as Window & { __psPower?: (m: unknown) => void }).__psPower = (m) => set(cleanPower(m));
}

export function usePower(): PowerState {
  return useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => cur);
}

/** Ask PS for the state now (the panel does this when it mounts). */
export function askPower() { if (PS) psPost({ type: "power:get" }); }

export const powerBridge = {
  /** Previews and the self test only: show a state without the shell. */
  _set: (raw: unknown) => set(cleanPower(raw)),
  get: () => cur,
};

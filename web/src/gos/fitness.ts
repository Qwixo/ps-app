// PS Fitness: the native rest timer and screen wake of PS GOS (~/Projects/ps/phone, Fitness.kt).
// Contract: side-session-notes/.../fitness/android-bridge.md. Every call is a safe no-op where the
// shell is missing (PS on the Mac, the website, a plain browser): check available() and run the
// in-page countdown there.
import { gosPost, onShell } from "./bridge";

export type FitnessRest = {
  id: string; exercise: string; set: number; of: number;
  sec: number; startedAt: number; endsAt: number; over: boolean; overAt: number;
};
export type FitnessEvent = {
  type: "fitness";
  event: "state" | "started" | "added" | "skipped" | "ended" | "cancelled";
  from: "page" | "notification" | "alarm" | "system";
  rest: FitnessRest | null;
  awake: boolean;
  perms: { notifications: boolean; exactAlarm: boolean };
};
export type StartRest = { sec: number; exercise: string; set: number; of?: number; id?: string; sound?: boolean };

const hasShell = () => typeof window !== "undefined" && !!(window as Window & { gosNative?: unknown }).gosNative;

export const fitness = {
  available: hasShell,
  startRest(r: StartRest) { if (hasShell()) gosPost({ type: "fitness:start", ...r }); },
  addRest(sec: number) { if (hasShell()) gosPost({ type: "fitness:add", sec }); },
  skipRest() { if (hasShell()) gosPost({ type: "fitness:skip" }); },
  cancelRest() { if (hasShell()) gosPost({ type: "fitness:cancel" }); },
  keepAwake(on: boolean) { if (hasShell()) gosPost({ type: "fitness:awake", on }); },
  refresh() { if (hasShell()) gosPost({ type: "fitness:get" }); },
  onEvent(f: (e: FitnessEvent) => void): () => void {
    if (!hasShell()) return () => {};
    return onShell((m) => { if (m.type === "fitness") f(m as unknown as FitnessEvent); });
  },
};

// window.GOS.fitness, as the brief named it (startRest also takes a JSON string).
type GosGlobal = { fitness?: typeof fitness & { startRest(r: StartRest | string): void } };
if (typeof window !== "undefined") {
  const w = window as Window & { GOS?: GosGlobal };
  w.GOS = w.GOS || {};
  w.GOS.fitness = { ...fitness, startRest: (r: StartRest | string) => fitness.startRest(typeof r === "string" ? JSON.parse(r) : r) };
}

// The page's side of the screen recorder (PS 1.60, pull request 12a): keeps the Mac's state (ps-mac ScreenRec.swift pushes
// it to window.__psScreenRec) and sends the person's clicks back as {type: "screenrec", op, ...}. The rules are in
// core/screenrec.ts. The island (12b) and the Soundboard (12c) read the same store (useScreenRec, screenRecNow).
// Nothing is asked of the Mac until a component that needs it mounts, and the Mac answers "off" until the person says yes.
import { useSyncExternalStore } from "react";
import { psPost, PS } from "./ps";
import { recMessage } from "./recstore";
import { cleanList, cleanState, patchFor, type PickList, type SRChoices, type ScreenRecState } from "./core/screenrec";
export type { PickList };

let state: ScreenRecState | null = null;
let list: PickList | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

if (typeof window !== "undefined") {
  (window as Window & { __psScreenRec?: (m: unknown) => void }).__psScreenRec = (m: unknown) => {
    if (recMessage(m)) return;   // 12c: the recordings list, the cloud state and the delete question
    const l = cleanList(m);
    if (l) { list = l; emit(); return; }
    const s = cleanState(m);
    if (s) { state = s; emit(); }
  };
}

export const screenRecNow = () => state;
export function useScreenRec(): ScreenRecState | null {
  return useSyncExternalStore(subscribe, () => state);
}
export function usePickList(): PickList | null { return useSyncExternalStore(subscribe, () => list); }

/** Ask the Mac for its state once (in PS only). It reads saved choices and asks macOS for nothing. */
let asked = false;
export function askScreenRec(): void { if (PS && !asked) { asked = true; send("get"); } }
export function send(op: string, extra: Record<string, unknown> = {}): void { psPost({ type: "screenrec", op, ...extra }); }
export function change<K extends keyof SRChoices>(key: K, value: SRChoices[K]): void { send("set", { patch: patchFor(key, value) }); }
export function optIn(on: boolean): void { send("optin", { on }); }

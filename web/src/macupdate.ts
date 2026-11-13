// Mac PS updates in the Tab list's gear menu (the developer, 31 Oct 2026: "copy the same kind of update feature as
// I have on mobile"). The native updater (ps-mac Sources/Updater.swift) does every check: the signed note,
// each file's SHA-256, the developer's code signature, the atomic swap, the sign in hand over and the roll back.
// This page only shows what it reports and sends the developer's clicks back:
//   shell -> page: window.__psMacUpdate(state)   (every change; also once after macUpdate:get)
//   page -> shell: macUpdate:get | macUpdate:check | macUpdate:start | macUpdate:finish | macUpdate:seen
// The first macUpdate:get also tells the shell this page can show updates, so its old pop-up card stays
// away (it is only the fallback when the page is missing or broken).
import { useSyncExternalStore } from "react";
import { PS, psPost } from "./ps";
import { cleanMacUpdate, type MacUpdate } from "./core/macupdate";
// V1.40: window.__psOpenSetup, which PS calls after "See what's new and set it up" (the setup menu's door).
import "./setuphook";

export type { MacUpdate, MacUpdateState } from "./core/macupdate";

let cur: MacUpdate = { state: "idle" };
const subs = new Set<() => void>();
function set(u: MacUpdate) { cur = u; subs.forEach((f) => f()); }
export function useMacUpdate() {
  return useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => cur);
}

/** Overlay window only (PS on the Mac). It starts itself below, so App.tsx needs no line for it. */
let started = false;
export function startMacUpdate() {
  if (!PS || started) return;
  started = true;
  (window as Window & { __psMacUpdate?: (s: unknown) => void }).__psMacUpdate = (s) => set(cleanMacUpdate(s));
  psPost({ type: "macUpdate:get" });
}

// The floating Tab window (ps://app/client/overlay): say hello as soon as the page loads, signed in or not,
// so the shell's pop-up card stays away from the start.
if (PS && /\/overlay\/?$/.test(location.pathname)) startMacUpdate();

export const macUpdate = {
  check: () => psPost({ type: "macUpdate:check" }),
  start: () => psPost({ type: "macUpdate:start" }),
  finish: () => psPost({ type: "macUpdate:finish" }),
  seen: () => { if (cur.unseen) psPost({ type: "macUpdate:seen" }); },
  /** Self test and pictures only: show a state without the shell. */
  _set: (s: unknown) => set(cleanMacUpdate(s)),
};

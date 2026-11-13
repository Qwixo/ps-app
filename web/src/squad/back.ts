// G Squad window (V1.43): the steps Esc goes back through inside it (an edit in the chat, a step of the join flow, a
// section on a narrow screen). Each step adds itself while it is open; one Esc goes back the newest. The window's own
// Esc handler (views/GSquadWindow.tsx) asks here before it closes. Nothing here listens to keys by itself.
import { useEffect, useRef } from "react";

const stack: { id: number; fn: () => void }[] = [];
let seq = 0;
/** Adds a step; returns the way to take it off again. */
export function pushBack(fn: () => void): () => void {
  const e = { id: ++seq, fn };
  stack.push(e);
  return () => { const i = stack.indexOf(e); if (i >= 0) stack.splice(i, 1); };
}
/** Goes back the newest step. False when there is none. The step stays listed until its owner takes it off (useBack
 *  does when it is no longer on), so a flow of several steps (the squads list, then Ask to join) goes back one at a
 *  time. A step that threw is taken off, so Esc can never get stuck on it. */
export function popBack(): boolean {
  const e = stack[stack.length - 1];
  if (!e) return false;
  try { e.fn(); } catch { const i = stack.indexOf(e); if (i >= 0) stack.splice(i, 1); }
  return true;
}
export const hasBack = () => stack.length > 0;
/** While `on`, Esc runs `fn` before the window closes. */
export function useBack(on: boolean, fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => (on ? pushBack(() => ref.current()) : undefined), [on]);
}

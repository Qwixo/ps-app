// Who is on the Tab list right now, so the update card (views/UpdateFace.tsx) and the What's new panel
// (views/WhatsNew.tsx) never stack: the card waits for the panel, the panel waits for the card's "Updated to".
import { useEffect, useSyncExternalStore } from "react";
import { islandQueueRuntime, type Priority } from "./core/islandqueue";

const subs = new Set<() => void>();
const flags = { face: false, whatsNew: false };
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
function set(k: keyof typeof flags, v: boolean) { if (flags[k] !== v) { flags[k] = v; subs.forEach((f) => f()); } }

export const setFaceShowing = (v: boolean) => set("face", v);
export const setWhatsNewShowing = (v: boolean) => set("whatsNew", v);
/** The update card shows "Updated to" (with the changes): the What's new panel waits for it. */
export const useFaceShowing = () => useSyncExternalStore(sub, () => flags.face);
export const useWhatsNewShowing = () => useSyncExternalStore(sub, () => flags.whatsNew);

/** PS 1.60: the page's one queue of island cards (core/islandqueue.ts, the same rules as the Mac's). Every card of this page
 *  that hangs from the island joins it, so there is never one on top of another. */
export const islandCards = islandQueueRuntime();

/** True when it is this card's turn. `wants`: the card would show now; it joins the queue while true and leaves when false
 *  (or when the component goes away), so a card that closes always lets the next one come. */
export function useIslandTurn(id: string, wants: boolean, priority: Priority = "normal"): boolean {
  const version = useSyncExternalStore(islandCards.subscribe, () => `${islandCards.queue.active?.id ?? ""}|${islandCards.queue.waiting.length}`);
  useEffect(() => {
    if (!wants) return;
    islandCards.join({ id, kind: id, priority }, () => {});
    return () => islandCards.leave(id);
  }, [id, wants, priority]);
  void version;
  return wants && islandCards.queue.isActive(id);
}

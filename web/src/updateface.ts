// Who is on the Tab list right now, so the update card (views/UpdateFace.tsx) and the What's new panel
// (views/WhatsNew.tsx) never stack: the card waits for the panel, the panel waits for the card's "Updated to".
import { useSyncExternalStore } from "react";

const subs = new Set<() => void>();
const flags = { face: false, whatsNew: false };
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
function set(k: keyof typeof flags, v: boolean) { if (flags[k] !== v) { flags[k] = v; subs.forEach((f) => f()); } }

export const setFaceShowing = (v: boolean) => set("face", v);
export const setWhatsNewShowing = (v: boolean) => set("whatsNew", v);
/** The update card shows "Updated to" (with the changes): the What's new panel waits for it. */
export const useFaceShowing = () => useSyncExternalStore(sub, () => flags.face);
export const useWhatsNewShowing = () => useSyncExternalStore(sub, () => flags.whatsNew);

// Which part of PS a Looks preview is showing right now (V1.40), shared by the Settings screen (views/SettingsScreen.tsx
// starts and ends the preview) and the Tab list (views/TaskMap.tsx stages what the preview needs, core/lookspreview.ts,
// and hands back one sentence for the preview chip). While a preview runs <html data-pv="<part>"> is set, so
// looks.css can highlight that part and dim what does not change.
import { useSyncExternalStore } from "react";
import type { LooksPart } from "../core/looksoptions";

type Peek = { part: LooksPart | null; note: string | null };
let peek: Peek = { part: null, note: null };
const subs = new Set<() => void>();
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const emit = () => subs.forEach((f) => f());

export function setPeekPart(part: LooksPart | null) {
  if (peek.part === part) return;
  peek = { part, note: null };
  if (typeof document !== "undefined") {
    if (part && part !== "none") document.documentElement.dataset.pv = part;
    else delete document.documentElement.dataset.pv;
  }
  emit();
}
export function setPeekNote(note: string | null) {
  if (peek.note === note || !peek.part) return;
  peek = { ...peek, note };
  emit();
}
export const usePeek = () => useSyncExternalStore(sub, () => peek, () => peek);

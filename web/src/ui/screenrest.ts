// Puts core/screenrest.ts on the page: .scr-open on the Tab list while any full screen holds the rest.
import { restHolders } from "../core/screenrest";

const held = new WeakMap<Element, Set<string>>();
/** `who` (a screen's name) asks for the list's moving looks to rest (on) or lets them go (off). */
export function restBehind(root: Element | null | undefined, who: string, on: boolean) {
  if (!root) return;
  const next = restHolders(held.get(root) ?? new Set(), who, on);
  held.set(root, next);
  root.classList.toggle("scr-open", next.size > 0);
}

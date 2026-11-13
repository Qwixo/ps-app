// Where the Mac's Dynamic Island is over the Tab list (V1.53 island clearance, core/islandclear.ts). The Mac app calls
// window.__psIsland(spot, opening) whenever the island's shape changes (it grows, shrinks, opens, hides, moves) and
// once as the list opens (opening: true, so the buttons are already in place as the list appears, with no slide).
// It also leaves the latest in window.__psIslandNow, read here in case it came before this page was ready.
import { cleanSpot, spotBox, type Box, type IslandSpot } from "../core/islandclear";

type W = Window & { __psIsland?: (s: unknown, opening?: boolean) => void; __psIslandNow?: unknown };
let spot: IslandSpot | null = null;
let instantUntil = 0;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  const w = window as W;
  spot = cleanSpot(w.__psIslandNow);
  w.__psIsland = (s, opening) => {
    spot = cleanSpot(s);
    if (opening) instantUntil = performance.now() + 450;
    listeners.forEach((l) => l());
  };
}

/** The island's shape in this page's pixels, or null when it is not over this screen. */
export function islandBox(): Box | null {
  return typeof window === "undefined" ? null : spotBox(spot, window.innerWidth);
}
/** The list is opening right now: place everything at once, no slide. */
export function islandInstant(): boolean { return performance.now() < instantUntil; }
export function onIsland(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }


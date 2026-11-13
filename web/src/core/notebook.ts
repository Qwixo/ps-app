// Notebook looks for the Tab list (the developer, 3 Nov 2026: "kind of like how the Apple Notes app USED to look").
// A paper to-do list instead of the dark glass: every part of the Tab list is redrawn (src/views/notebook.css).
// Saved in the vault settings (settings.tmNotebook), so the Mac and the phone match. "off" is the normal look.
// The look is one attribute on <html> (data-nb), set only by the floating Tab list (views/TaskMap.tsx, never
// when the list is docked in the website's To-do page), so nothing on the client vault pages can change.

export const NB_DESIGNS: { id: string; label: string; note: string }[] = [
  { id: "off", label: "Off", note: "The normal dark glass list." },
  { id: "legal", label: "Legal pad", note: "Yellow ruled paper, a red double margin, a stitched leather top and a felt marker." },
  { id: "composition", label: "Composition", note: "A marbled black and white cover band, white college ruled paper and blue lines." },
  { id: "graph", label: "Graph paper", note: "A green engineering grid, a technical pencil and stamped labels." },
  { id: "kraft", label: "Kraft dotted", note: "Cream dotted paper in a kraft cover with an elastic band and a fountain pen." },
  { id: "chalk", label: "Chalkboard", note: "A dark slate with a wooden frame and white chalk. The dark notebook." },
];
const IDS = new Set(NB_DESIGNS.map((d) => d.id));

/** A saved or posted value, checked: one of the looks above, anything else is "off". */
export function nbDesign(v: unknown): string {
  return typeof v === "string" && IDS.has(v) ? v : "off";
}

type VtDoc = Document & { startViewTransition?: (f: () => void) => { finished: Promise<void> } };
let turnEnd = 0;
/** Puts a look on the page (<html data-nb>). With animate, the change turns like a page: a view transition
 *  where the web view has one (macOS 15 and Android WebView do), a short colour fade where it does not. */
export function applyNotebook(id: string, animate: boolean) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const next = nbDesign(id);
  if ((root.dataset.nb ?? "off") === next) return;
  const flip = () => { if (next === "off") delete root.dataset.nb; else root.dataset.nb = next; };
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const doc = document as VtDoc;
  window.clearTimeout(turnEnd);
  if (!animate || reduce) { flip(); return; }
  if (doc.startViewTransition) {
    root.classList.add("nb-turning");
    try {
      doc.startViewTransition(flip).finished.finally(() => root.classList.remove("nb-turning"));
    } catch { root.classList.remove("nb-turning"); flip(); }
    return;
  }
  root.classList.add("nb-fading");
  flip();
  turnEnd = window.setTimeout(() => root.classList.remove("nb-fading"), 520);
}

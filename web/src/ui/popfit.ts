// Screen fit (V1.40): pop-ups that open from the floating Tab list's buttons (End your day, screen time, the
// mixer, the network monitor...) stay on the screen. Each one is placed by its own CSS as before; this only
// nudges it sideways when it would run off an edge, and caps its height (it scrolls inside) when it would
// run off the bottom. On a big screen nothing moves, so the developer's list looks the same.

import { onRelayout, tucked } from "./relayout.ts";

const MARGIN = 8;

/** How far to move a box sideways so it fits the page, and the most height it may have below its top. */
export function popNudge(r: { left: number; right: number; top: number }, vw: number, vh: number, margin = MARGIN): { dx: number; maxH: number } {
  let dx = 0;
  if (r.right > vw - margin) dx = vw - margin - r.right;
  if (r.left + dx < margin) dx = margin - r.left;
  return { dx: Math.round(dx), maxH: Math.max(160, Math.floor(vh - margin - Math.max(r.top, margin))) };
}

function fit(el: HTMLElement) {
  el.style.removeProperty("translate");
  if (el.dataset.popfit) { el.style.removeProperty("max-height"); el.style.removeProperty("overflow-y"); delete el.dataset.popfit; }
  // Layout boxes, not the drawn one: a pop-up still in its opening animation is drawn scaled down.
  const host = el.offsetParent as HTMLElement | null;
  if (!host || el.offsetWidth < 2 || el.offsetHeight < 2) return;
  const p = host.getBoundingClientRect();
  const left = p.left + el.offsetLeft, top = p.top + el.offsetTop;
  const r = { left, top, right: left + el.offsetWidth, height: el.offsetHeight };
  const { dx, maxH } = popNudge(r, window.innerWidth, window.innerHeight);
  if (dx) el.style.setProperty("translate", `${dx}px 0`);
  if (r.height > maxH) { el.style.maxHeight = `${maxH}px`; el.style.overflowY = "auto"; el.dataset.popfit = "1"; }
}

/** Watches `root` (the floating list's top right buttons) and keeps every `.tm-pop` in it on screen. */
export function keepPopsOnScreen(root: HTMLElement, sel = ".tm-pop"): () => void {
  let raf = 0;
  const run = () => {
    raf = 0;
    if (tucked()) return;   // PS's hidden one pixel window: never measured there (V1.44 #9, ui/relayout.ts)
    root.querySelectorAll<HTMLElement>(sel).forEach(fit);
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(run); };
  const mo = new MutationObserver(queue);
  mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-expanded"] });
  // A size, screen, font or show change fits them at once: a window that was hidden can hold frames back.
  const off = onRelayout(() => { cancelAnimationFrame(raf); run(); });
  queue();
  return () => { mo.disconnect(); off(); cancelAnimationFrame(raf); };
}

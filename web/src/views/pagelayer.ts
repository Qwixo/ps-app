// V1.58 smooth page swipe: the panels and buttons that belong to a page move and fade with it (views/ListPager.tsx
// drives this, core/pageswipe.ts has the numbers). Before V1.58 they stood still while the list slid, then every one
// of them vanished in the frame the new page landed.
//
// What belongs to a page: every panel and button in a Slot (views/EditMode.tsx) that has a page (data-pg), that is
// all of them but the gear and Tab and Lock, which are on every page. Those, the headline, Add task, the Edit button,
// the dots' row and the background stand still. The list itself and the list's name under the headline move too
// (ListPager.tsx).
//
// Speed: begin() reads once (each part's place and opacity); every frame after that only writes translate and opacity
// on a handful of elements (no layout, no React). A part keeps its box the whole time (see editmode.css: a page's
// panels in the columns keep their room on other pages, so nothing reflows as pages change).
import { REDUCED_IN_MS, lagFor, partFrame, pageFade, reducedFade, stripFade, stripX } from "../core/pageswipe";

type Kid = { el: HTMLElement; base: number; lagN: number; lagP: number; was: { o: string; t: string } };
type Part = { slot: HTMLElement; i: number; kids: Kid[] };
export type Layer = { overlay: HTMLElement; parts: Part[]; strip: HTMLElement | null; stripWas: { o: string; t: string } | null };

const kidsOf = (el: Element) => [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
const num = (v: string, d: number) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

/** The page's own things, ready to move. pick: which pages take part (the one showing, its neighbours, a dot's
 *  target). null: no overlay here (the website's To-do page has no panels around the list). */
export function layerBegin(overlay: HTMLElement | null, ids: string[], pick: (i: number) => boolean): Layer | null {
  if (!overlay) return null;
  overlay.dataset.pgsw = "";
  const picked: { slot: HTMLElement; i: number }[] = [];
  for (const slot of overlay.querySelectorAll<HTMLElement>(".ed-slot[data-pg]")) {
    const i = ids.indexOf(slot.dataset.pg ?? "");
    if (i < 0 || !pick(i)) continue;
    // A hidden one in a column without its room kept (a panel of another list page that was never moved by hand)
    // would push its neighbours if it showed now: it fades in once its page has landed instead (layerArrive).
    if (slot.classList.contains("ed-hidden") && !slot.classList.contains("ed-moved") && !slot.classList.contains("ed-box")) continue;
    slot.dataset.pgp = "";
    picked.push({ slot, i });
  }
  // Every write is done; now one read for all of them.
  const w = window.innerWidth || 1;
  const parts: Part[] = picked.map(({ slot, i }) => ({
    slot, i,
    kids: kidsOf(slot).map((el) => {
      const r = el.getBoundingClientRect(), cx = r.left + r.width / 2;
      return { el, base: num(getComputedStyle(el).opacity, 1), lagN: lagFor(cx, w, true), lagP: lagFor(cx, w, false), was: { o: el.style.opacity, t: el.style.translate } };
    }),
  }));
  const strip = overlay.querySelector<HTMLElement>(".tl-strip");
  return { overlay, parts, strip, stripWas: strip ? { o: strip.style.opacity, t: strip.style.translate } : null };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** One frame: the pages are at `at` (a page number with a fraction). */
export function layerPaint(l: Layer | null, at: number, from: number, span: number, reduced: boolean) {
  if (!l) return;
  const toward = at >= from;
  for (const p of l.parts) {
    for (const k of p.kids) {
      const f = partFrame(p.i, at, from, span, reduced, toward ? k.lagN : k.lagP);
      k.el.style.translate = `${f.x.toFixed(1)}px 0`;
      k.el.style.opacity = String(r3(k.base * f.o));
    }
  }
  if (l.strip) {
    l.strip.style.opacity = String(r3(reduced ? reducedFade(at, from) : stripFade(at)));
    l.strip.style.translate = reduced ? "" : `${stripX(at).toFixed(1)}px 0`;
  }
}
/** Reduce Motion's quick fade: the page the swipe started on (its panels and the list's name) at opacity o. */
export function layerDim(l: Layer | null, from: number, o: number) {
  if (!l) return;
  for (const p of l.parts) for (const k of p.kids) k.el.style.opacity = String(r3(p.i === from ? k.base * o : 0));
  if (l.strip) l.strip.style.opacity = String(r3(o));
}
/** The list pages in the strip (ListPager's track): each dimmed by its distance, or (Reduce Motion) only the first
 *  page shown, at opacity `dim`. */
export function pagesPaint(track: HTMLElement | null, ids: string[], at: number, from: number, reduced: boolean, dim?: number) {
  if (!track) return;
  for (const el of kidsOf(track)) {
    const i = ids.indexOf(el.dataset.page ?? "");
    if (i < 0) continue;
    const o = reduced ? (i === from ? dim ?? reducedFade(at, from) : 0) : pageFade(i - at);
    el.style.opacity = String(r3(o));
  }
}
export function pagesClear(track: HTMLElement | null) {
  if (track) for (const el of kidsOf(track)) el.style.opacity = "";
}
/** Back to rest: every part as it was (React's own classes have already hidden the pages not showing). Returns the
 *  slots that took part, so layerArrive leaves them alone. */
export function layerEnd(l: Layer | null): Set<HTMLElement> {
  const done = new Set<HTMLElement>();
  if (!l) return done;
  for (const p of l.parts) {
    for (const k of p.kids) { k.el.style.opacity = k.was.o; k.el.style.translate = k.was.t; }
    delete p.slot.dataset.pgp;
    done.add(p.slot);
  }
  if (l.strip && l.stripWas) { l.strip.style.opacity = l.stripWas.o; l.strip.style.translate = l.stripWas.t; }
  delete l.overlay.dataset.pgsw;
  return done;
}

/** A page has landed: whatever of it did not ride in with the swipe fades in (a soft slide from the side it came
 *  from), never popping in one frame. reduced: everything of the new page fades in, the list and its name too (the
 *  second half of Reduce Motion's cross fade). side: 1 it came from the right, -1 from the left. */
export function layerArrive(overlay: HTMLElement | null, page: string, rode: Set<HTMLElement>, reduced: boolean, side: number, extra: (HTMLElement | null)[] = []) {
  if (!overlay || typeof Element.prototype.animate !== "function") return;
  const els: HTMLElement[] = [];
  for (const slot of overlay.querySelectorAll<HTMLElement>(".ed-slot[data-pg]")) {
    if (slot.dataset.pg !== page || slot.classList.contains("ed-hidden") || (!reduced && rode.has(slot))) continue;
    els.push(...kidsOf(slot));
  }
  if (reduced) for (const e of extra) if (e) els.push(e);
  if (!els.length) return;
  const bases = els.map((el) => num(getComputedStyle(el).opacity, 1));
  els.forEach((el, n) => {
    const to = bases[n];
    const frames: Keyframe[] = reduced
      ? [{ opacity: 0 }, { opacity: to }]
      : [{ opacity: 0, translate: `${side * 28}px 0` }, { opacity: to, translate: "0px 0" }];
    // A soft start (never more than about a quarter of the way in the first frame), then it eases in to rest.
    try { el.animate(frames, { duration: reduced ? REDUCED_IN_MS : 280, delay: reduced ? 0 : Math.min(n, 6) * 18, easing: reduced ? "ease-out" : "cubic-bezier(.3, .7, .4, 1)", fill: "backwards" }); } catch { /* old web view */ }
  });
}

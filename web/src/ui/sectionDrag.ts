// Drag whole sections of the Tab list above or below each other (the developer, 23 Oct 2026: "I can drag
// the everyday tasks up above the current tasks and vice versa"). Mouse only: grab a section by
// its header; a short move starts the drag, so a plain click still does nothing. The section
// follows the mouse on a solid backing, the other section slides out of the way (as task rows
// do), a drop line shows where it will land, and on release the sections glide
// into their new places. Tasks inside each section keep their own drag (ui/dragOrder.ts).
// Moves are written straight to the elements (data attributes and transforms), so the list does
// not re-render while the mouse moves.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Live = {
  key: string; pointerId: number; startY: number; startScroll: number; started: boolean;
  scroller: HTMLElement | null; base: string[]; mids: number[]; from: number; to: number; step: number;
  tops: number[]; bottoms: number[]; gap: number; line: HTMLElement | null; lineY: number | null;
};

const EASE = "cubic-bezier(.22, .9, .25, 1)";
const GLIDE_MS = 320;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/** opts.onMove: called whenever a section moved on screen (while dragging and gliding), so
 *  things that follow a section's position can measure again. */
export function useSectionOrder(keys: string[], commit: (next: string[]) => void, opts: { onDrop?: () => void; onMove?: () => void } = {}) {
  const els = useRef(new Map<string, HTMLElement>());
  const live = useRef<Live | null>(null);
  const flip = useRef<Map<string, number> | null>(null);
  const [pending, setPending] = useState<string[] | null>(null);
  const cb = useRef({ commit, opts });
  cb.current = { commit, opts };

  // Show the dropped order straight away, until the saved order comes back.
  const key = keys.join(",");
  useEffect(() => {
    if (!pending) return;
    if (pending.join(",") === key) { setPending(null); return; }
    const t = window.setTimeout(() => setPending(null), 6000);
    return () => window.clearTimeout(t);
  }, [key, pending]);
  const view = pending && pending.length === keys.length && pending.every((k) => keys.includes(k)) ? pending : keys;

  // Every section glides from where it was to where it is now.
  const glide = (first: Map<string, number>) => {
    let anims = 0;
    first.forEach((top, k) => {
      const el = els.current.get(k);
      if (!el) return;
      const dy = top - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 0.5) return;
      anims++;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: GLIDE_MS, easing: EASE });
    });
    if (!anims) { cb.current.opts.onMove?.(); return; }
    follow(GLIDE_MS + 40);
  };
  // Things that follow a section's position (the P1 looks) measure again while it slides.
  const follow = (ms: number) => {
    const until = performance.now() + ms;
    const tick = () => { cb.current.opts.onMove?.(); if (performance.now() < until) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    window.setTimeout(() => cb.current.opts.onMove?.(), ms + 20);   // a hidden window never runs frames
  };
  const viewKey = view.join(",");
  useLayoutEffect(() => {
    const f = flip.current;
    if (!f) return;
    flip.current = null;
    glide(f);
  }, [viewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const scrollY = (l: Live) => (l.scroller ? l.scroller.scrollTop : window.scrollY);
    const clear = () => els.current.forEach((el) => {
      el.querySelector(":scope > .tm-sec-line")?.remove(); delete el.dataset.drop; delete el.dataset.lifted; el.style.transform = ""; el.style.transition = ""; });
    const move = (e: PointerEvent) => {
      const l = live.current;
      if (!l || e.pointerId !== l.pointerId) return;
      const d = e.clientY - l.startY + (scrollY(l) - l.startScroll);
      if (!l.started) {
        if (Math.abs(e.clientY - l.startY) < 6) return;
        l.started = true;
        document.body.classList.add("is-dragging");
        const me = els.current.get(l.key);
        if (me) me.dataset.lifted = "";
      }
      e.preventDefault();
      const me = els.current.get(l.key);
      if (me) me.style.transform = `translateY(${d}px)`;
      const scrolled = scrollY(l) - l.startScroll;
      const centre = l.mids[l.from] + d;
      let to = 0;
      l.mids.forEach((m, i) => { if (i !== l.from && m < centre) to++; });
      if (to !== l.to) {
        l.to = to;
        els.current.forEach((el) => { delete el.dataset.drop; });
        // The sections between move out of the way by the dragged one's height.
        l.base.forEach((k, i) => {
          if (k === l.key) return;
          const el = els.current.get(k);
          if (!el) return;
          const shift = l.from < to && i > l.from && i <= to ? -l.step : to < l.from && i >= to && i < l.from ? l.step : 0;
          el.style.transition = `transform .26s ${EASE}`;
          el.style.transform = shift ? `translateY(${shift}px)` : "";
        });
        follow(300);
        const others = l.base.filter((k) => k !== l.key);
        // The line sits in the gap the section will drop into (none when it would stay put). It
        // rides on the dragged section's own layer, so the section never covers it.
        l.lineY = null;
        if (to !== l.from) {
          const at = to < others.length ? others[to] : others[others.length - 1];
          const j = l.base.indexOf(at), el = els.current.get(at);
          const shift = l.from < to && j > l.from && j <= to ? -l.step : to < l.from && j >= to && j < l.from ? l.step : 0;
          if (el) el.dataset.drop = to < others.length ? "before" : "after";
          l.lineY = to < others.length ? l.tops[j] + shift - l.gap / 2 : l.bottoms[j] + shift + l.gap / 2;   // where it ends up, at the start's scroll
        }
      }
      if (me) {
        if (l.lineY === null) { l.line?.remove(); l.line = null; }
        else {
          if (!l.line) { l.line = document.createElement("i"); l.line.className = "tm-sec-line"; l.line.setAttribute("aria-hidden", "true"); }
          if (l.line.parentElement !== me) me.appendChild(l.line);
          l.line.style.top = `${l.lineY - scrolled - me.getBoundingClientRect().top}px`;
        }
      }
      cb.current.opts.onMove?.();
    };
    const end = (e: PointerEvent) => {
      const l = live.current;
      if (!l || e.pointerId !== l.pointerId) return;
      live.current = null;
      if (!l.started) return;
      document.body.classList.remove("is-dragging");
      // The drag ends with a click on the header; swallow it.
      const stop = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener("click", stop, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 50);
      const first = new Map<string, number>();
      els.current.forEach((el, k) => first.set(k, el.getBoundingClientRect().top));
      clear();
      const next = l.base.filter((k) => k !== l.key);
      next.splice(l.to, 0, l.key);
      if (l.to !== l.from) {
        flip.current = first;
        setPending(next);
        cb.current.commit(next);
      } else glide(first);
      cb.current.opts.onDrop?.();
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);

  /** Spread onto each section: ref, plus head(k) on its header. */
  function section(k: string) {
    return { ref: (el: HTMLElement | null) => { if (el) els.current.set(k, el); else els.current.delete(k); } };
  }
  function head(k: string) {
    return {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0 || e.pointerType !== "mouse" || view.length < 2) return;
        if ((e.target as HTMLElement).closest("button, input, textarea, select, a, .no-drag")) return;
        const rs = view.map((x) => els.current.get(x)?.getBoundingClientRect());
        if (rs.some((r) => !r)) return;
        const scroller = scrollParent(els.current.get(k) || null);
        const r = rs as DOMRect[], i = view.indexOf(k);
        const gap = r.length > 1 ? Math.max(0, r[1].top - r[0].bottom) : 26;
        live.current = {
          key: k, pointerId: e.pointerId, startY: e.clientY, started: false, scroller,
          startScroll: scroller ? scroller.scrollTop : window.scrollY,
          base: [...view], mids: r.map((x) => x.top + x.height / 2), from: i, to: i, step: r[i].height + gap,
          tops: r.map((x) => x.top), bottoms: r.map((x) => x.bottom), gap, line: null, lineY: null,
        };
      },
    };
  }

  return { order: view, section, head, movable: view.length > 1 };
}

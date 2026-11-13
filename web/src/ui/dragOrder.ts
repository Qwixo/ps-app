// Drag rows up and down to reorder a list. Mouse: grab anywhere on the row (a short move starts
// the drag, so a plain click still works). Touch: grab the row's .drag-grip only, so the page
// still scrolls. Rows move out of the way while you drag; the new order is saved on drop.
import { useEffect, useRef, useState } from "react";

type Live = {
  id: string; pointerId: number; touch: boolean; startY: number; startScroll: number; started: boolean;
  scroller: HTMLElement | null; base: string[]; mids: number[]; step: number; from: number; to: number; x: number; y: number;
};

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

export type DragEnd = { id: string; next: string[]; moved: boolean; x: number; y: number };
/** opts.onMove: the pointer while a row is dragged. opts.onEnd: called on every drop (even when the
 *  order did not change), instead of commit, with where the pointer was let go. opts.alone: a list
 *  of one row still drags (it can be let go somewhere else, see onEnd). */
export function useDragOrder(ids: string[], commit: (ids: string[]) => void, opts: { onDrop?: () => void; onMove?: (x: number, y: number, id: string) => void; onEnd?: (e: DragEnd) => void; alone?: boolean } = {}) {
  const els = useRef(new Map<string, HTMLElement>());
  const live = useRef<Live | null>(null);
  const [dy, setDy] = useState(0);
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; step: number } | null>(null);
  const [pending, setPending] = useState<string[] | null>(null);
  const cb = useRef({ commit, opts });
  cb.current = { commit, opts };

  // Show the dropped order straight away, until the saved order comes back from the vault.
  const key = ids.join(",");
  useEffect(() => {
    if (!pending) return;
    if (pending.join(",") === key) { setPending(null); return; }
    const t = window.setTimeout(() => setPending(null), 2500);
    return () => window.clearTimeout(t);
  }, [key, pending]);
  const view = pending && pending.length === ids.length && pending.every((id) => ids.includes(id)) ? pending : ids;

  useEffect(() => {
    const scrollY = (l: Live) => (l.scroller ? l.scroller.scrollTop : window.scrollY);
    const move = (e: PointerEvent) => {
      const l = live.current;
      if (!l || e.pointerId !== l.pointerId) return;
      const d = e.clientY - l.startY + (scrollY(l) - l.startScroll);
      if (!l.started) {
        if (Math.abs(e.clientY - l.startY) < 6) return;
        l.started = true;
        document.body.classList.add("is-dragging");
      }
      e.preventDefault();
      const centre = l.mids[l.from] + d;
      let to = 0;
      l.mids.forEach((m, i) => { if (i !== l.from && m < centre) to++; });
      l.to = to;
      l.x = e.clientX; l.y = e.clientY;
      cb.current.opts.onMove?.(e.clientX, e.clientY, l.id);
      setDy(d);
      setDrag({ id: l.id, from: l.from, to, step: l.step });
    };
    const end = (e: PointerEvent) => {
      const l = live.current;
      if (!l || e.pointerId !== l.pointerId) return;
      live.current = null;
      document.body.classList.remove("is-dragging");
      if (l.started) {
        // The drag ends with a click on the row; swallow it so it doesn't also mark the task.
        const stop = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
        window.addEventListener("click", stop, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 50);
        const next = l.base.filter((x) => x !== l.id);
        next.splice(l.to, 0, l.id);
        if (l.to !== l.from) setPending(next);
        if (cb.current.opts.onEnd) cb.current.opts.onEnd({ id: l.id, next, moved: l.to !== l.from, x: e.clientX, y: e.clientY });
        else if (l.to !== l.from) cb.current.commit(next);
        cb.current.opts.onDrop?.();
      }
      setDrag(null);
      setDy(0);
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

  /** Spread onto each row: <li {...row(id)}>. */
  function row(id: string) {
    const i = view.indexOf(id);
    let shift = 0, dragging = false;
    if (drag) {
      if (id === drag.id) dragging = true;
      else if (drag.from < drag.to && i > drag.from && i <= drag.to) shift = -drag.step;
      else if (drag.to < drag.from && i >= drag.to && i < drag.from) shift = drag.step;
    }
    return {
      ref: (el: HTMLElement | null) => { if (el) els.current.set(id, el); else els.current.delete(id); },
      "data-dragging": dragging || undefined,
      style: dragging ? { transform: `translateY(${dy}px)`, zIndex: 5, transition: "none" }
        : drag ? { transform: `translateY(${shift}px)` } : undefined,
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0 || ids.length < (cb.current.opts.alone ? 1 : 2)) return;
        const target = e.target as HTMLElement;
        const touch = e.pointerType !== "mouse";
        if (touch && !target.closest(".drag-grip")) return;
        if (target.closest("input, textarea, select, a, .no-drag, [contenteditable='true']")) return;
        const rects = view.map((x) => els.current.get(x)?.getBoundingClientRect());
        if (rects.some((r) => !r)) return;
        const rs = rects as DOMRect[];
        const gap = rs.length > 1 ? Math.max(0, rs[1].top - rs[0].bottom) : 10;
        const me = rs[i];
        const scroller = scrollParent(els.current.get(id) || null);
        live.current = {
          id, pointerId: e.pointerId, touch, startY: e.clientY, started: false, scroller,
          startScroll: scroller ? scroller.scrollTop : window.scrollY,
          base: [...view], mids: rs.map((r) => r.top + r.height / 2), step: me.height + gap, from: i, to: i, x: e.clientX, y: e.clientY,
        };
      },
    };
  }

  return { order: view, row, dragging: !!drag };
}

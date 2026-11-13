// The mouse in the Mac's phone canvas (V1.57, views/PhoneEditor.tsx): drag the room or a page beside sideways, a two
// finger swipe, the mouse wheel, and the pointer resting near the left or right edge of the pages all slide the row of
// phone pages, the same feel as the Mac's Edit overview (views/EditMode.tsx). The rules are pure in core/phonepan.ts.
//
// Fast by design: the row is one element (.pe-track) moved with one `translate` written straight to it each frame,
// never through React. React draws only when the page in the middle changes (when the slide lets go). One frame loop
// runs only while the edge slides it, and stops by itself.
import { useEffect, useRef } from "react";
import { isClick, pageAfterPan, panBounds, panRubber, phoneEdge, phonePansFrom, sidewaysWheel, wheelPages, type Row } from "../core/phonepan";

export type PanApi = {
  live: boolean;           // the canvas is open and still (not zooming)
  ci: number; n: number; row: Row;
  left: number; right: number;   // the pages' part of the screen (the side sheet is right of it)
  quiet: boolean;          // a pop up is open (the gallery, a question): the edge and the wheel leave the row alone
  carrying: boolean;       // a panel is being carried: the edge slides the row under it
  go: (j: number) => void; // put page j in the middle
  onPan?: (x: number, y: number) => void;   // the row moved under a still pointer (a carried panel follows)
};
export type PanHandle = { off: () => number; settle: (toPage?: number) => void };

const QUIET_OVER = ".pe-sheet, .pe-top, .pe-gal, .pe-phone-btn, .pe-pick, .lk-panel, .lk-ask-wrap, .pe-del, .pe-undo, select, input, textarea";
const readTranslate = (el: HTMLElement) => { const t = getComputedStyle(el).translate; const v = parseFloat(t); return Number.isFinite(v) ? v : 0; };

export function usePhonePan(room: React.RefObject<HTMLElement | null>, track: React.RefObject<HTMLElement | null>, api: React.MutableRefObject<PanApi>): PanHandle {
  const st = useRef({ off: 0, raf: 0, last: 0, edge: 0, px: -1, py: -1, wheelAcc: 0, wheelAt: 0, wheelT: 0, eat: 0 });
  const handle = useRef<PanHandle>(null as unknown as PanHandle);
  if (!handle.current) {
    const s = st.current;
    const paint = () => { const t = track.current; if (t) t.style.translate = s.off ? `${(-s.off).toFixed(2)}px 0px` : "0px 0px"; };
    const free = (on: boolean) => track.current?.classList.toggle("free", on);
    /** Let the row come to rest on a page: the nearest (or the one given), gliding with the pages' own spring. */
    const settle = (toPage?: number, v = 0) => {
      const a = api.current;
      window.clearTimeout(s.wheelT); s.wheelT = 0;
      const j = toPage ?? (s.off ? pageAfterPan(s.off, v, a.ci, a.n, a.row) : a.ci);
      free(false);
      s.off = 0; paint();
      if (j !== a.ci && j >= 0 && j < a.n) a.go(j);
    };
    handle.current = { off: () => s.off, settle: (j) => settle(j) };
  }

  useEffect(() => {
    const el = room.current;
    if (!el) return;
    const s = st.current;
    const paint = () => { const t = track.current; if (t) t.style.translate = s.off ? `${(-s.off).toFixed(2)}px 0px` : "0px 0px"; };
    const free = (on: boolean) => track.current?.classList.toggle("free", on);
    const grab = () => { const t = track.current; if (!t) return; s.off = -readTranslate(t); free(true); paint(); };
    const settle = (v = 0) => {
      const a = api.current;
      const j = s.off ? pageAfterPan(s.off, v, a.ci, a.n, a.row) : a.ci;
      handle.current.settle(j);
    };
    // ---- the edge: a frame loop while the pointer rests near the left or right edge of the pages ----
    const tick = (t: number) => {
      s.raf = 0;
      const a = api.current;
      if (!s.edge || !a.live) { s.edge = 0; return; }
      const dt = Math.min(48, Math.max(1, t - (s.last || t - 16)));
      s.last = t;
      const b = panBounds(a.ci, a.n, a.row);
      const was = s.off;
      s.off = Math.max(b.min, Math.min(b.max, s.off + s.edge * dt / 16.67));
      if (s.off !== was) { paint(); a.onPan?.(s.px, s.py); }
      s.raf = requestAnimationFrame(tick);   // keeps looking while the pointer stays there (it may move on past an end)
    };
    const edgeTo = (sp: number) => {
      if (sp === s.edge) return;
      const was = s.edge;
      s.edge = sp;
      if (sp && !was) { grab(); s.last = 0; if (!s.raf) s.raf = requestAnimationFrame(tick); }
      if (!sp && was) { cancelAnimationFrame(s.raf); s.raf = 0; if (!api.current.carrying) settle(); }
    };

    type Press = { x: number; y: number; pid: number; moved: boolean; off0: number; samples: { t: number; x: number }[]; drag: boolean };
    let press: Press | null = null;
    const down = (e: PointerEvent) => {
      const a = api.current;
      if (!a.live || e.button !== 0 || !e.isPrimary || !phonePansFrom(e.target as Element | null)) { press = null; return; }
      press = { x: e.clientX, y: e.clientY, pid: e.pointerId, moved: false, off0: 0, samples: [{ t: performance.now(), x: e.clientX }], drag: false };
    };
    const move = (e: PointerEvent) => {
      const a = api.current;
      s.px = e.clientX; s.py = e.clientY;
      const over = e.target as Element | null;
      const p = press;
      if (!p || p.pid !== e.pointerId) {
        const quiet = !a.live || (a.quiet && !a.carrying) || (!a.carrying && !!over?.closest?.(QUIET_OVER)) || (e.buttons !== 0 && !a.carrying);
        edgeTo(quiet ? 0 : phoneEdge(e.clientX, e.clientY, a.left, a.right));
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (!p.moved && isClick(dx, dy)) return;
      p.moved = true;
      if (!p.drag) {
        p.drag = true; edgeTo(0); grab(); p.off0 = s.off;
        document.documentElement.classList.add("pe-panning");
        try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* let go outside: pointerup still comes to the window */ }
      }
      s.off = panRubber(p.off0 - dx, a.ci, a.n, a.row);
      const now = performance.now();
      p.samples.push({ t: now, x: e.clientX });
      while (p.samples.length > 2 && now - p.samples[0].t > 90) p.samples.shift();
      paint();
    };
    const up = (e: PointerEvent) => {
      const p = press;
      if (!p || p.pid !== e.pointerId) return;
      press = null;
      if (p.moved) s.eat = performance.now();   // a drag is never a click
      if (!p.drag) return;
      document.documentElement.classList.remove("pe-panning");
      const a0 = p.samples[0], z = p.samples[p.samples.length - 1];
      const v = e.type !== "pointercancel" && a0 && z && z.t > a0.t && performance.now() - z.t < 80 ? -(z.x - a0.x) / (z.t - a0.t) : 0;
      settle(v);
    };
    const click = (e: MouseEvent) => {
      if (performance.now() - s.eat < 400) { s.eat = 0; e.preventDefault(); e.stopPropagation(); }
    };
    const wheel = (e: WheelEvent) => {
      const a = api.current;
      if (!a.live || e.ctrlKey || a.quiet) return;
      const t = e.target as Element | null;
      if (t?.closest?.(QUIET_OVER)) return;
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * k, dy = e.deltaY * k;
      if (sidewaysWheel(dx, dy)) {
        // A trackpad swipe: the row follows the fingers, then rests on the nearest page when they stop.
        e.preventDefault();
        if (!s.wheelT) grab();
        s.off = panRubber(s.off + dx, a.ci, a.n, a.row);
        paint();
        window.clearTimeout(s.wheelT);
        s.wheelT = window.setTimeout(() => { s.wheelT = 0; settle(); }, 140);
        return;
      }
      // Up and down over the page being edited scrolls that page while it can; anywhere else it goes a page per notch.
      const sc = t?.closest?.(".pe-card.cur .pe-content") as HTMLElement | null;
      if (sc && ((dy > 0 && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1) || (dy < 0 && sc.scrollTop > 0))) return;
      e.preventDefault();
      const now = performance.now();
      const w = wheelPages(s.wheelAcc, dy, now - s.wheelAt);
      s.wheelAcc = w.acc;
      if (!w.step) return;
      s.wheelAt = now;
      const j = Math.max(0, Math.min(a.n - 1, a.ci + w.step));
      if (j !== a.ci) a.go(j);
    };
    const key = (e: KeyboardEvent) => {
      const a = api.current;
      if (!a.live || a.quiet || e.metaKey || e.ctrlKey || e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      if ((document.activeElement as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
      const j = Math.max(0, Math.min(a.n - 1, a.ci + (e.key === "ArrowRight" ? 1 : -1)));
      if (j !== a.ci) a.go(j);
    };
    const gone = () => { edgeTo(0); if (press?.drag) { press = null; document.documentElement.classList.remove("pe-panning"); settle(); } press = null; };
    const leaveWin = (e: PointerEvent) => { if (!e.relatedTarget) edgeTo(0); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("click", click, true);
    el.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", gone);
    document.addEventListener("pointerout", leaveWin);
    return () => {
      cancelAnimationFrame(s.raf); s.raf = 0; s.edge = 0; window.clearTimeout(s.wheelT); s.wheelT = 0;
      document.documentElement.classList.remove("pe-panning");
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("click", click, true);
      el.removeEventListener("wheel", wheel);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", gone);
      document.removeEventListener("pointerout", leaveWin);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return handle.current;
}

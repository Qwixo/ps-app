// Tab list, bottom left, just above Coming up: the "Timelines" pill, showing the next countdown. Click it and a big
// panel pops out of it into the middle of the screen (V1.43, the developer: "make the panel much bigger and come up to the
// right of it, in the centre of your screen"): every countdown as a card with a big number, its name, its date and
// a bar for how close it is, soonest first. Add one by choosing a kind first (Event, Birthday, Anniversary, Wedding,
// Trip, Deadline, Holiday, Custom); birthdays and anniversaries come back every year and count the age or the years.
// Edit or remove any card (Undo brings it back), drag a card to put them in your own order. Esc steps back: a form
// first, then the panel. The logic (kinds, yearly repeats, sorting, old data) is core/timelines.ts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { TimelineItem, TimelineKind } from "../core/model";
import {
  KINDS, allLines, copyOfBuiltIn, countOf, kindInfo, kindOf, nextLine, okDate, okTime, phaseOf, pillText, progressOf,
  repeatsOf, sortLines, whenOf, wordsOf, type Line,
} from "../core/timelines";
import { psPost } from "../ps";
import { sfx } from "../ui/sfx";
import "./timelines.css";

type Props = {
  birthday?: string | null; items: TimelineItem[]; order?: string[]; hidden?: string[];
  onSave: (list: TimelineItem[]) => void; onOrder: (ids: string[]) => void; onHide: (ids: string[]) => void; onMap?: () => void;
  /** The list's own Undo (and Cmd+Z), for a removed timeline. */
  undo?: (id: string, title: string, run: () => void) => void;
};

function useNow(fast: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let t = 0;
    const step = fast ? 1000 : 60000;
    const tick = () => { setNow(Date.now()); t = window.setTimeout(tick, step - (Date.now() % step) + 5); };
    tick();
    return () => window.clearTimeout(t);
  }, [fast]);
  return now;
}

/** What you just saved shows at once, until the vault sends it back (on the Mac that goes through PS and back). */
function useOpt<T>(value: T): [T, (v: T) => void] {
  const [opt, setOpt] = useState<{ v: T } | null>(null);
  const key = JSON.stringify(value);
  useEffect(() => { if (opt && JSON.stringify(opt.v) === key) setOpt(null); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!opt) return; const t = window.setTimeout(() => setOpt(null), 4000); return () => window.clearTimeout(t); }, [opt]);
  return [opt ? opt.v : value, (v: T) => setOpt({ v })];
}

// The latest list and its savers, for an Undo that runs after the panel (or the whole Tab list) has closed.
const latest: { items: TimelineItem[]; hidden: string[]; save: (l: TimelineItem[]) => void; hide: (ids: string[]) => void } =
  { items: [], hidden: [], save: () => {}, hide: () => {} };

export function Timelines(p: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useOpt(p.items);
  const [hidden, setHidden] = useOpt(p.hidden || []);
  const [order, setOrder] = useOpt(p.order || []);
  const save = (l: TimelineItem[]) => { setItems(l); latest.items = l; p.onSave(l); };
  const hide = (ids: string[]) => { setHidden(ids); latest.hidden = ids; p.onHide(ids); };
  const reorder = (ids: string[]) => { setOrder(ids); p.onOrder(ids); };
  latest.items = items; latest.hidden = hidden; latest.save = save; latest.hide = hide;
  const pill = useRef<HTMLDivElement>(null);
  const now = useNow(open);
  const lines = useMemo(() => allLines(items, now, p.birthday, hidden), [items, now, p.birthday, hidden]);
  const next = nextLine(lines, now);
  const toggle = () => { sfx.click(); setOpen((o) => !o); };

  return (
    <div className={`tm-tl${open ? " open" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
      {open && <Win lines={lines} now={now} items={items} hidden={hidden} order={order} birthday={p.birthday} from={pill.current}
        save={save} hide={hide} reorder={reorder} undo={p.undo} onMap={p.onMap} onClose={() => setOpen(false)} />}
      <div ref={pill} className="tm-tl-pill" role="button" tabIndex={0} aria-haspopup="dialog" aria-expanded={open} aria-label="Timelines (click to open)" data-tip="Timelines" data-tip-line="Click to see every countdown"
        onClick={toggle} onMouseEnter={() => sfx.hover()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 2h12M6 22h12M7 2c0 5 10 5 10 10S7 17 7 22M17 2c0 5-10 5-10 10s10 5 10 10" /></svg>
        <b>Timelines</b>
        {next && <span className="num">{pillText(next, now)}</span>}
      </div>
    </div>
  );
}

// ---------- the icons, one per kind ----------
const ICON: Record<TimelineKind, ReactNode> = {
  event: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="M12 12.6l1.1 2.2 2.4.3-1.8 1.6.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.6 2.4-.3z" /></>,
  birthday: <><path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7" /><path d="M5 16.5c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0" /><path d="M12 12V8.5M12 6c.9-.8.9-1.8 0-3-.9 1.2-.9 2.2 0 3z" /></>,
  anniversary: <path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z" />,
  wedding: <><circle cx="9" cy="14.5" r="5" /><circle cx="15" cy="14.5" r="5" /><path d="M10.2 5.5L12 3.2l1.8 2.3L12 7.8z" /></>,
  trip: <><path d="M21.5 2.5L10.8 13.2" /><path d="M21.5 2.5l-6.8 19-3.9-8.3-8.3-3.9z" /></>,
  deadline: <><path d="M5 22V3.5" /><path d="M5 4h12.5l-2.4 4.2 2.4 4.3H5" /></>,
  holiday: <><rect x="3" y="8" width="18" height="4.5" rx="1.2" /><path d="M5 12.5V21h14v-8.5M12 8v13" /><path d="M12 8C10.4 4.8 6.6 4.2 6.6 6.6 6.6 8 9 8 12 8zM12 8c1.6-3.2 5.4-3.8 5.4-1.4C17.4 8 15 8 12 8z" /></>,
  custom: <><path d="M11 3.5l2 5.4 5.5 2-5.5 2-2 5.6-2-5.6-5.5-2 5.5-2z" /><path d="M19 15v5M16.5 17.5h5" /></>,
};
export const KindIcon = ({ kind, size = 18 }: { kind: TimelineKind; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[kind]}</svg>
);

const fmtDate = (t: number, time?: string) =>
  new Date(t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) + (time ? ` at ${time}` : "");

// ---------- drag a card to a new place in the grid ----------
// Mouse: press anywhere on a card and move (a plain click still works). Touch: hold the card's icon, so the panel
// still scrolls. The other cards glide out of the way (each one animates from where it was).
type Drag = { id: string; order: string[]; x: number; y: number; ox: number; oy: number; w: number; h: number };
function useGridDrag(ids: string[], commit: (ids: string[]) => void, scroller: React.RefObject<HTMLElement | null>) {
  const els = useRef(new Map<string, HTMLElement>());
  const press = useRef<{ id: string; pid: number; x: number; y: number; r: DOMRect } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [pending, setPending] = useState<string[] | null>(null);
  const cb = useRef(commit); cb.current = commit;
  const key = ids.join(",");
  useEffect(() => { if (!pending) return; if (pending.join(",") === key) { setPending(null); return; } const t = window.setTimeout(() => setPending(null), 2500); return () => window.clearTimeout(t); }, [key, pending]);
  const view = drag ? drag.order : pending && pending.length === ids.length && pending.every((x) => ids.includes(x)) ? pending : ids;

  // The glide: every card that moved animates from its old spot to its new one.
  const rects = useRef(new Map<string, DOMRect>());
  const viewKey = view.join(",");
  useLayoutEffect(() => {
    const quick = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<string, DOMRect>();
    els.current.forEach((el, id) => {
      const r = el.getBoundingClientRect();
      next.set(id, r);
      const was = rects.current.get(id);
      if (!quick && was && dragRef.current && (Math.abs(was.left - r.left) > 1 || Math.abs(was.top - r.top) > 1) && el.animate)
        el.animate([{ transform: `translate(${was.left - r.left}px, ${was.top - r.top}px)` }, { transform: "none" }], { duration: 240, easing: "cubic-bezier(.2,.9,.3,1)" });
    });
    rects.current = next;
  }, [viewKey, !!drag]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const pr = press.current;
      if (!pr || e.pointerId !== pr.pid) return;
      let d = dragRef.current;
      if (!d) {
        if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < 6) return;
        els.current.forEach((el, id) => rects.current.set(id, el.getBoundingClientRect()));
        d = { id: pr.id, order: [...view], x: e.clientX, y: e.clientY, ox: pr.x - pr.r.left, oy: pr.y - pr.r.top, w: pr.r.width, h: pr.r.height };
        document.body.classList.add("is-dragging");
      }
      e.preventDefault();
      d = { ...d, x: e.clientX, y: e.clientY };
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-tl-id]");
      const over = under?.dataset.tlId;
      if (over && over !== d.id && d.order.includes(over)) {
        const o = d.order.filter((x) => x !== d!.id);
        const at = o.indexOf(over) + (d.order.indexOf(over) > d.order.indexOf(d.id) ? 1 : 0);
        o.splice(at, 0, d.id);
        d = { ...d, order: o };
      }
      // Near the top or bottom edge of the panel: scroll it along.
      const s = scroller.current;
      if (s) { const b = s.getBoundingClientRect(); if (e.clientY < b.top + 48) s.scrollTop -= 14; else if (e.clientY > b.bottom - 48) s.scrollTop += 14; }
      dragRef.current = d;
      setDrag(d);
    };
    const end = (e: PointerEvent) => {
      const pr = press.current;
      if (!pr || e.pointerId !== pr.pid) return;
      press.current = null;
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      document.body.classList.remove("is-dragging");
      const stop = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
      window.addEventListener("click", stop, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 50);
      setDrag(null);
      setPending(d.order);
      sfx.drop();
      cb.current(d.order);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
  }, [viewKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = (id: string) => ({
    ref: (el: HTMLElement | null) => { if (el) els.current.set(id, el); else els.current.delete(id); },
    "data-tl-id": id,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || ids.length < 2) return;
      const t = e.target as HTMLElement;
      if (t.closest("button, input, a, .no-drag")) return;
      if (e.pointerType !== "mouse" && !t.closest(".tl-ico")) return;
      press.current = { id, pid: e.pointerId, x: e.clientX, y: e.clientY, r: (e.currentTarget as HTMLElement).getBoundingClientRect() };
    },
  });
  return { view, drag, card };
}

// ---------- the panel ----------
type Draft = { kind: TimelineKind; name: string; date: string; time: string; timeOn: boolean; repeat: boolean };
type View = { v: "grid" } | { v: "pick" } | { v: "form"; draft: Draft; edit: Line | null };
const blank = (kind: TimelineKind): Draft => ({ kind, name: "", date: "", time: "18:00", timeOn: false, repeat: kindInfo(kind).repeat });

function Win({ lines, now, items, hidden, order, birthday, from, save, hide, reorder, undo, onMap, onClose }: {
  lines: Line[]; now: number; items: TimelineItem[]; hidden: string[]; order: string[]; birthday?: string | null; from: HTMLElement | null;
  save: (l: TimelineItem[]) => void; hide: (ids: string[]) => void; reorder: (ids: string[]) => void;
  undo?: Props["undo"]; onMap?: () => void; onClose: () => void;
}) {
  const [view, setView] = useState<View>({ v: "grid" });
  const [out, setOut] = useState(false);
  const [toast, setToast] = useState<{ title: string; run: () => void; key: number } | null>(null);
  const win = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const mine = order.length > 0;
  const sorted = sortLines(lines, now, order);
  const ids = sorted.map((l) => l.id);
  const byId = new Map(sorted.map((l) => [l.id, l]));
  const { view: shown, drag, card } = useGridDrag(ids, (next) => reorder(next), body);

  const close = () => {
    if (out) return;
    setOut(true);
    const quick = matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(onClose, quick ? 0 : 220);
  };
  // Esc steps back: a form or the kind picker goes back to the cards, then the panel closes. PS's own Esc asks here first.
  const esc = useRef(() => {});
  esc.current = () => { if (view.v !== "grid") { sfx.click(); setView({ v: "grid" }); } else close(); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); e.stopImmediatePropagation();
      esc.current();
    };
    const g = window as Window & { __psDimxClose?: () => boolean };
    const before = g.__psDimxClose;
    const mine = () => { esc.current(); return true; };
    window.addEventListener("keydown", key, true);
    g.__psDimxClose = mine;
    return () => {
      window.removeEventListener("keydown", key, true);
      if (g.__psDimxClose === mine) { if (before) g.__psDimxClose = before; else delete g.__psDimxClose; }
    };
  }, []);
  // PS: keep the list up and give it the keyboard while the panel is open (typing a name), let go when it closes.
  useLayoutEffect(() => {
    psPost({ type: "dimx", open: true });
    return () => { psPost({ type: "dimx", open: false }); };
  }, []);
  // The pop: the panel grows out of the Timelines pill into the middle of the screen.
  useLayoutEffect(() => {
    const w = win.current;
    if (!w) return;
    const r = w.getBoundingClientRect(), f = from?.getBoundingClientRect();
    if (f) w.style.transformOrigin = `${Math.round(f.left + f.width / 2 - r.left)}px ${Math.round(f.top + f.height / 2 - r.top)}px`;
    w.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 7000); return () => window.clearTimeout(t); }, [toast]);

  const remove = (l: Line) => {
    sfx.click();
    let run: () => void;
    if (l.custom) {
      const at = items.findIndex((i) => i.id === l.id), it = items[at];
      if (!it) return;
      save(items.filter((i) => i.id !== l.id));
      run = () => { const cur = latest.items; if (cur.some((i) => i.id === it.id)) return; const next = [...cur]; next.splice(Math.min(at, next.length), 0, it); latest.save(next); };
    } else {
      hide([...hidden, l.id]);
      run = () => latest.hide(latest.hidden.filter((x) => x !== l.id));
    }
    const once = { done: false };
    const go = () => { if (once.done) return; once.done = true; sfx.drop(); run(); };
    setToast({ title: l.title, run: go, key: Date.now() });
    undo?.(`tl:${l.id}`, `Remove ${l.title}`, go);
  };
  const edit = (l: Line) => {
    sfx.click();
    const it = l.custom ? items.find((i) => i.id === l.id) : copyOfBuiltIn(l, birthday, "", "");
    if (!it) return;
    const kind = kindOf(it);
    setView({ v: "form", edit: l, draft: { kind, name: it.title, date: it.date, time: okTime(it.time) ? it.time : "18:00", timeOn: okTime(it.time), repeat: repeatsOf(it) } });
  };
  const commit = (d: Draft, editing: Line | null) => {
    const nowIso = new Date().toISOString();
    const base: TimelineItem = { id: editing?.custom ? editing.id : crypto.randomUUID(), title: d.name.trim().slice(0, 80), date: d.date, createdAt: nowIso, kind: d.kind, repeat: d.repeat };
    if (d.timeOn && okTime(d.time)) base.time = d.time;
    sfx.drop();
    if (editing?.custom) {
      const old = items.find((i) => i.id === editing.id);
      save(items.map((i) => (i.id === editing.id ? { ...base, createdAt: old?.createdAt || nowIso } : i)));
    } else if (editing) {
      // A built in one (your birthday, New Year...): your copy takes its place, the built in one is hidden.
      save([...items, base]);
      hide([...hidden, editing.id]);
      if (mine) reorder(order.map((x) => (x === editing.id ? base.id : x)));
    } else save([...items, base]);
    setView({ v: "grid" });
  };

  const upcoming = shown.map((id) => byId.get(id)!).filter((l) => l && phaseOf(l.at, now) !== "past");
  const past = shown.map((id) => byId.get(id)!).filter((l) => l && phaseOf(l.at, now) === "past");
  // Soonest: the next one across the top, bigger. It stays there while a card is dragged, so nothing jumps under the
  // pointer (it is not dragged itself; after a drop the list is in your order and it joins the grid).
  const firstUp = sorted.filter((l) => phaseOf(l.at, now) !== "past");
  const hero = !mine && firstUp.length > 2 ? firstUp[0] : null;
  const flat = mine || !!drag;
  const cardOf = (l: Line, i: number, big = false) => (
    <Card key={l.id} l={l} now={now} i={i} big={big} dragging={drag?.id === l.id} bind={big ? null : card(l.id)} onEdit={() => edit(l)} onRemove={() => remove(l)} />
  );
  const count = lines.length;

  return createPortal(
    <div className={`tl-layer${out ? " out" : ""}`} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="tl-dim" aria-hidden="true" onMouseDown={(e) => { if (e.button === 0) close(); }} />
      <section ref={win} className="tl-win" role="dialog" aria-modal="true" aria-labelledby="tl-title" tabIndex={-1}>
        <header className="tl-head">
          <span className="tl-orb" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h12M6 22h12M7 2c0 5 10 5 10 10S7 17 7 22M17 2c0 5-10 5-10 10s10 5 10 10" /></svg>
          </span>
          <div className="tl-titles">
            <h2 id="tl-title">Timelines</h2>
            <span className="tl-count">{count === 1 ? "1 countdown" : `${count} countdowns`}</span>
          </div>
          {view.v === "grid" && (
            <div className="tl-sort" role="group" aria-label="Order">
              <button type="button" className={!mine ? "on" : ""} aria-pressed={!mine} onClick={() => { if (mine) { sfx.click(); reorder([]); } }}>Soonest</button>
              <button type="button" className={mine ? "on" : ""} aria-pressed={mine} data-tip="Your order" data-tip-line="Drag a card to put them in your own order"
                onClick={() => { if (!mine) { sfx.click(); reorder(ids); } }}>Your order</button>
            </div>
          )}
          {onMap && view.v === "grid" && (
            <button type="button" className="tl-ghost tl-goals" onClick={() => { sfx.click(); onClose(); onMap(); }} aria-label="Goals timeline" data-tip="Goals timeline" data-tip-line="Macro, meso and micro goals">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z" /><path d="M9 4v13.5M15 6.5V20" /></svg>
              <span className="tl-word">Goals</span>
            </button>
          )}
          {view.v === "grid" && (
            <button type="button" className="tl-new" onClick={() => { sfx.click(); setView({ v: "pick" }); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              New timeline
            </button>
          )}
          <button type="button" className="tl-x" onClick={() => { sfx.click(); close(); }} aria-label="Close Timelines" data-tip="Close Timelines" data-tip-line="Or press Esc">×</button>
        </header>

        {view.v === "grid" && (
          <div ref={body} className={`tl-body${drag ? " is-sorting" : ""}`}>
            {!count && (
              <div className="tl-empty">
                <b>No countdowns yet</b>
                <span>Add a birthday, a wedding, a trip or anything you are looking forward to.</span>
                <button type="button" className="tl-new" onClick={() => setView({ v: "pick" })}>New timeline</button>
              </div>
            )}
            {hero && <div className="tl-grid tl-grid-hero">{cardOf(hero, 0, true)}</div>}
            {flat ? (
              <div className="tl-grid">{shown.filter((id) => id !== hero?.id).map((id, i) => byId.get(id) && cardOf(byId.get(id)!, i))}</div>
            ) : (
              <>
                {!!upcoming.length && <div className="tl-grid">{upcoming.filter((l) => l !== hero).map((l, i) => cardOf(l, i + 1))}</div>}
                {!!past.length && <h3 className="tl-sec">Done</h3>}
                {!!past.length && <div className="tl-grid">{past.map((l, i) => cardOf(l, upcoming.length + i))}</div>}
              </>
            )}
            {count > 1 && <p className="tl-hint">{mine ? "Drag a card to move it" : "Drag a card to put them in your own order"}. Esc closes.</p>}
          </div>
        )}
        {view.v === "pick" && <Picker onPick={(k) => { sfx.click(); setView({ v: "form", edit: null, draft: blank(k) }); }} />}
        {view.v === "form" && <Form key={view.edit?.id || "new"} start={view.draft} edit={view.edit} now={now}
          onBack={() => { sfx.click(); setView(view.edit ? { v: "grid" } : { v: "pick" }); }}
          onSave={(d) => commit(d, view.edit)} onRemove={view.edit ? () => { const l = view.edit!; setView({ v: "grid" }); remove(l); } : undefined} />}

        {toast && (
          <div className="tl-toast" key={toast.key} role="status">
            <span>Removed <b>{toast.title}</b></span>
            <button type="button" onClick={() => { toast.run(); setToast(null); }}>Undo</button>
          </div>
        )}
      </section>
      {drag && (() => {
        const l = byId.get(drag.id);
        if (!l) return null;
        return <div className="tl-ghostcard" style={{ left: drag.x - drag.ox, top: drag.y - drag.oy, width: drag.w, height: drag.h }}><Card l={l} now={now} i={0} big={false} dragging={false} bind={null} /></div>;
      })()}
    </div>,
    document.body,
  );
}

function Card({ l, now, i, big, dragging, bind, onEdit, onRemove }: {
  l: Line; now: number; i: number; big: boolean; dragging: boolean;
  bind: ReturnType<ReturnType<typeof useGridDrag>["card"]> | null; onEdit?: () => void; onRemove?: () => void;
}) {
  const ph = phaseOf(l.at, now);
  const c = countOf(l.at, now);
  const pct = progressOf(l, now);
  const soon = ph === "upcoming" && l.at - now < 7 * 86400000;
  const ago = ph === "past" ? Math.max(1, Math.floor((now - l.at) / 86400000)) : 0;
  const info = kindInfo(l.kind);
  return (
    <article {...(bind || {})} className={`tl-card k-${l.kind} ${ph}${soon ? " soon" : ""}${big ? " big" : ""}${dragging ? " placeholder" : ""}`}
      style={{ "--c": info.colour, "--i": Math.min(i, 14) } as CSSProperties} aria-label={`${l.title}, ${ph === "today" ? "today" : ph === "past" ? `${ago} days ago` : `in ${c.big} ${c.unit}`}`}>
      <div className="tl-card-top">
        <span className="tl-ico" title={info.label}><KindIcon kind={l.kind} size={big ? 20 : 17} /></span>
        <span className="tl-kind">{info.label}</span>
        {l.repeat && (
          <span className="tl-rep" title="Comes back every year" aria-label="Every year">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></svg>
          </span>
        )}
        {onEdit && (
          <span className="tl-acts no-drag">
            <button type="button" data-tip="Edit" data-tip-line="Change its kind, name and date" aria-label={`Edit ${l.title}`} onClick={onEdit}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
            </button>
            <button type="button" data-tip="Remove" data-tip-line="Takes it off. Undo brings it back" aria-label={`Remove ${l.title}`} onClick={onRemove}>×</button>
          </span>
        )}
      </div>
      <div className="tl-name" title={l.title}>{l.title}</div>
      <div className="tl-big num">
        {ph === "today" ? <b className="tl-today">Today</b> : ph === "past" ? <><b>{ago}</b><span>{ago === 1 ? "day ago" : "days ago"}</span></> : (
          <><b>{c.big}</b><span>{c.unit}</span>{(big || soon) && <i className="tl-hms" key={c.hms.slice(-2)}>{c.hms}</i>}</>
        )}
      </div>
      {l.sub && <div className="tl-sub">{l.sub}</div>}
      {pct != null && ph === "upcoming" && <div className="tl-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>}
      <div className="tl-date">{fmtDate(l.at, l.time)}{l.note ? `, ${l.note}` : ""}</div>
    </article>
  );
}

// ---------- adding: the kind first ----------
function Picker({ onPick }: { onPick: (k: TimelineKind) => void }) {
  return (
    <div className="tl-body tl-pick">
      <h3 className="tl-step">What are you counting down to?</h3>
      <div className="tl-kinds">
        {KINDS.map((k, i) => (
          <button type="button" key={k.id} className="tl-kindbtn" style={{ "--c": k.colour, "--i": i } as CSSProperties} onClick={() => onPick(k.id)} autoFocus={i === 0}>
            <span className="tl-ico"><KindIcon kind={k.id} size={22} /></span>
            <b>{k.label}</b>
            <span>{k.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- then the name, the date (and a time if you want) ----------
function Form({ start, edit, now, onBack, onSave, onRemove }: {
  start: Draft; edit: Line | null; now: number; onBack: () => void; onSave: (d: Draft) => void; onRemove?: () => void;
}) {
  const [d, setD] = useState(start);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const info = kindInfo(d.kind);
  const ok = !!d.name.trim() && okDate(d.date);
  const save = () => { if (ok) onSave(d); };
  // The card as it will look.
  const preview = useMemo<Line | null>(() => {
    if (!okDate(d.date)) return null;
    const it: TimelineItem = { id: "preview", title: d.name.trim() || info.namePh, date: d.date, createdAt: new Date(now).toISOString(), kind: d.kind, repeat: d.repeat, ...(d.timeOn && okTime(d.time) ? { time: d.time } : {}) };
    const w = whenOf(it, now);
    if (!w) return null;
    return { id: "preview", kind: d.kind, name: it.title, ...wordsOf(d.kind, it.title, w.n), at: w.at, from: w.from ?? now - 86400000 * 30, n: w.n, repeat: w.repeat, time: it.time, custom: true };
  }, [d, now, info.namePh]);
  const yearly = d.kind === "birthday" || d.kind === "anniversary";
  return (
    <div className="tl-body tl-form" style={{ "--c": info.colour } as CSSProperties}
      onKeyDown={(e) => { if (e.key === "Enter" && !(e.target as HTMLElement).closest("button")) { e.preventDefault(); save(); } }}>
      <h3 className="tl-step">{edit ? "Edit timeline" : `New ${info.label.toLowerCase()}`}</h3>
      <div className="tl-form-grid">
        <div className="tl-fields">
          <div className="tl-chips" role="radiogroup" aria-label="Kind">
            {KINDS.map((k) => (
              <button type="button" key={k.id} role="radio" aria-checked={d.kind === k.id} className={d.kind === k.id ? "on" : ""} style={{ "--c": k.colour } as CSSProperties}
                onClick={() => { sfx.click(); set({ kind: k.id, repeat: k.repeat }); }}>
                <KindIcon kind={k.id} size={14} />{k.label}
              </button>
            ))}
          </div>
          <label className="tl-field"><span>{info.nameLabel}</span>
            <input value={d.name} autoFocus maxLength={80} placeholder={info.namePh} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="tl-field"><span>{info.dateLabel}</span>
            <input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} />
            {yearly && <small>{d.kind === "birthday" ? "With the year they were born, it shows the age. Not sure? Pick this year's date." : "With the year it started, it counts the years."}</small>}
          </label>
          <div className="tl-row">
            <label className="tl-switch"><input type="checkbox" checked={d.timeOn} onChange={(e) => set({ timeOn: e.target.checked })} /><i aria-hidden="true" />Add a time</label>
            {d.timeOn && <input className="tl-time" type="time" value={d.time} aria-label="Time" onChange={(e) => set({ time: e.target.value })} />}
          </div>
          <label className="tl-switch"><input type="checkbox" checked={d.repeat} onChange={(e) => set({ repeat: e.target.checked })} /><i aria-hidden="true" />Comes back every year</label>
        </div>
        <div className="tl-preview">
          <span className="tl-preview-h">Preview</span>
          {preview ? <Card l={preview} now={now} i={0} big={false} dragging={false} bind={null} />
            : <div className="tl-preview-none" style={{ "--c": info.colour } as CSSProperties}><KindIcon kind={d.kind} size={28} /><span>Pick a date to see it</span></div>}
        </div>
      </div>
      <div className="tl-foot">
        {onRemove && <button type="button" className="tl-del" onClick={onRemove}>Remove</button>}
        <button type="button" className="tl-ghost" onClick={onBack}>{edit ? "Cancel" : "Back"}</button>
        <button type="button" className="tl-save" disabled={!ok} onClick={save}>{edit ? "Save" : "Add timeline"}</button>
      </div>
    </div>
  );
}


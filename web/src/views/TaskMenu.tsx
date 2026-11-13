// The right click menu on a task (V1.34, the developer 5 Nov 2026: "I want to be able to right click on a task and have the
// options to delete edit and stuff like that. currently it just says reload which I don't like").
// On every task in the Tab list (Priority 1, the numbered ones, Every day and repeating, groups, Completed and the
// Overdue card), on the Mac and the website: Edit, Mark done (Untick in Completed), Priority 1 on or off, New date,
// Copy text and Delete (with Undo, bottom right, Cmd+Z). Keyboard: arrows move, Enter picks, the underlined letter
// picks, Esc or a click anywhere else closes it; the Menu key or Shift+F10 on a task opens it. Not on the phone: a
// long press there lifts the task to drag it (gos/touch.ts).
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Doc, Todo } from "../core/model";
import type { TabLists } from "../core/groups";
import { isEveryDay } from "../core/repeat";
import { vaultStore } from "../core/vault";
import { todayISO } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { useOverlayShown } from "../ps";
import { Editor, deleteTask, pushUndoAction, taskMapActions, tickTask, tickView } from "./TaskMap";
import { HandPicker, squadMenuItems } from "./GSquadTask";
import { ListPicker } from "./ListPager";
import { TaskRemindHost, openTaskRemind, reminderWords } from "./TaskRemind";
import { reminderOfTask } from "../core/remind";
import { remindRec } from "../core/select";
import type { ClientRec } from "../core/model";
import "./taskmenu.css";

const GOS = import.meta.env.MODE === "gos";
export type MenuFrom = "list" | "done" | "overdue";
type MenuAt = { id: string; x: number; y: number; from: MenuFrom; root: Element | null; key: number; kb: boolean };
type ClientOpt = { id: string; name: string };

let menu: MenuAt | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const setMenu = (m: MenuAt | null) => { menu = m; emit(); };
const useMenu = () => useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => menu);
export const closeTaskMenu = () => { if (menu) setMenu(null); };

/** A right click on a task: PS's own menu, never the browser's (or WebKit's "Reload"). */
export function openTaskMenu(e: React.MouseEvent, id: string, from: MenuFrom) {
  if (GOS) return;
  e.preventDefault();
  e.stopPropagation();
  sfx.hover();
  setMenu({ id, x: e.clientX, y: e.clientY, from, root: (e.currentTarget as Element).closest(".tm-overlay"), key: Date.now(), kb: false });
}
/** The Menu key or Shift+F10 on a task: the menu opens at the task, its first item ready. */
export function openTaskMenuAt(el: Element, id: string, from: MenuFrom) {
  if (GOS) return;
  const r = el.getBoundingClientRect();
  setMenu({ id, x: r.left + Math.min(60, r.width / 2), y: r.top + r.height / 2, from, root: el.closest(".tm-overlay"), key: Date.now(), kb: true });
}

const plusDays = (n: number) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toLocaleDateString("en-CA"); };
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* the older way below */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}

type Item = { key: string; label: string; hint: string; run: () => void; danger?: boolean; keep?: boolean };

/** One per list (the floating Tab list and the To-do page each have one); only the one the click came from shows. */
export function TaskMenuHost({ lists, clients, onEdit }: { lists: TabLists; clients: ClientOpt[]; onEdit: (id: string | null) => void }) {
  const m = useMenu();
  const probe = useRef<HTMLSpanElement>(null);
  const [floatEd, setFloatEd] = useState<{ id: string; x: number; y: number } | null>(null);
  const mine = !!m && !!probe.current && probe.current.closest(".tm-overlay") === m.root;
  const shown = useOverlayShown();
  useEffect(() => { if (!shown) { closeTaskMenu(); setFloatEd(null); } }, [shown]);
  useEffect(() => () => closeTaskMenu(), []);
  return (
    <>
      <span ref={probe} hidden />
      {mine && m && <Menu key={m.key} at={m} lists={lists} onEdit={(id) => {
        if (m.from === "overdue") setFloatEd({ id, x: m.x, y: m.y }); else onEdit(id);
      }} />}
      {floatEd && <FloatEditor at={floatEd} clients={clients} ranked={lists.ranked} onDone={() => setFloatEd(null)} />}
      <TaskRemindHost />
    </>
  );
}

function Menu({ at, lists, onEdit }: { at: MenuAt; lists: TabLists; onEdit: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [handOpen, setHandOpen] = useState(false);   // G Squad: Hand to someone (views/GSquadTask.tsx)
  const [listOpen, setListOpen] = useState(false);   // V1.55: Move to list (views/ListPager.tsx)
  const d = vaultStore.get().docs.get(at.id) as Doc<Todo> | undefined;
  const t = d?.kind === "todo" ? d.data : undefined;
  const [pickDay, setPickDay] = useState(() => (t?.due && /^\d{4}-\d{2}-\d{2}/.test(t.due) ? t.due.slice(0, 10) : todayISO()));
  const close = () => closeTaskMenu();

  // Sits at the pointer, inside the screen: up and to the left when there is no room below or to the right.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, W = window.innerWidth, H = window.innerHeight;
    const up = at.y + h + 8 > H && at.y - h - 4 >= 0;
    setPos({ left: Math.max(6, Math.min(W - w - 6, at.x + 2)), top: up ? at.y - h - 2 : Math.max(6, Math.min(H - h - 6, at.y + 2)), up });
  }, [at, dateOpen, handOpen, listOpen]);
  // Closes on a click anywhere else, the wheel, Esc, or the window losing focus.
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const wheel = (e: WheelEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    // Every key goes to the menu while it is open (focus may still sit on the task: a right click's mouse up can
    // put it back there), and none reaches the list behind it (Esc there would close the whole list).
    const key = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("wheel", wheel, { capture: true, passive: true });
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("wheel", wheel, { capture: true });
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", close);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Focus the first item once it is placed (a hidden menu cannot take focus), after the right click's mouse up.
  const placed = !!pos;
  useEffect(() => {
    if (!placed) return;
    const f = () => { if (!ref.current?.contains(document.activeElement)) ref.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus({ preventScroll: true }); };
    f();
    const t = window.setTimeout(f, 60);
    return () => window.clearTimeout(t);
  }, [placed]);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => { if (!t) close(); }, [t]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t || !d) return null;

  const done = tickView(at.id, !!t.done).done;
  const daily = t.type === "daily";
  const every = daily && isEveryDay(t);
  const inList = lists.ranked.some((x) => x.id === at.id) || [...lists.groups.values()].some((l) => l.some((x) => x.id === at.id));
  const setP1 = () => {
    const on = !t.p1;
    sfx.drop();
    if (inList) void taskMapActions.moveTasks({ ids: [at.id], to: on ? "p1" : "prio", index: on ? lists.p1.length : 0 });
    else void taskMapActions.update(at.id, { p1: on });
  };
  const setDue = (due: string | null) => {
    const old = t.due ?? null;
    if (due === old) { close(); return; }
    sfx.drop();
    pushUndoAction(`due:${at.id}`, t.title, () => void taskMapActions.update(at.id, { due: old }));
    void taskMapActions.update(at.id, { due });
    close();
  };
  const items: Item[] = [
    { key: "e", label: "Edit", hint: "E", run: () => { sfx.click(); onEdit(at.id); } },
    { key: "d", label: done ? "Untick" : "Mark done", hint: "D", run: () => tickTask(at.id) },
    ...(!daily && !done ? [{ key: "p", label: t.p1 ? "Take off Priority 1" : "Priority 1", hint: "P", run: setP1 }] : []),
    ...(!every && !done ? [{ key: "n", label: "New date", hint: "N", run: () => { sfx.hover(); ref.current?.querySelector<HTMLElement>("[data-k='n']")?.focus({ preventScroll: true }); setDateOpen((v) => !v); }, keep: true }] : []),
    // V1.55: to another of the developer's lists (or a new one), on the list itself only.
    ...(at.from === "list" && !done ? [{ key: "m", label: "Move to list", hint: "M", keep: true, run: () => { sfx.hover(); setListOpen((v) => !v); } }] : []),
    // V1.55: an Annoying 15 min reminder on this task (views/TaskRemind.tsx). Not on a finished one-off.
    ...(!done || daily ? [{ key: "r", label: reminderWords(!!reminderOfTask(remindRec(vaultStore.get()), at.id)), hint: "R", run: () => openTaskRemind(at.id, at.root) }] : []),
    { key: "c", label: copied ? "Copied" : "Copy text", hint: "C", keep: true, run: () => {
      void copyText(t.title).then((ok) => { if (ok) { sfx.click(); setCopied(true); window.setTimeout(close, 420); } else close(); });
    } },
    // G Squad (V1.40): Not shared, Anonymise, Hand to someone. Only while you are in a squad.
    ...squadMenuItems(at.id, t, [...vaultStore.get().docs.values()].filter((x) => x.kind === "client").map((x) => x.data as ClientRec), () => { sfx.hover(); setHandOpen((v) => !v); }),
    { key: "x", label: "Delete", hint: "⌫", danger: true, run: () => deleteTask(at.id) },
  ];
  const pick = (it: Item) => { it.run(); if (!it.keep) close(); };
  keyRef.current = (e: KeyboardEvent) => {
    const own = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    if (e.key === "Escape") { own(); if (dateOpen) setDateOpen(false); else close(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement | null)?.matches?.("input") && ref.current?.contains(e.target as Node)) return;   // typing a date
    const all = [...(ref.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { own(); all[(n + all.length) % all.length]?.focus({ preventScroll: true }); };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i < 0 ? all.length - 1 : i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "Tab") { own(); close(); }
    else if (e.key === "Enter" || e.key === " ") {
      if (i < 0 && ref.current?.contains(document.activeElement)) return;   // a date chip or Set has its own Enter
      own();
      const it = i >= 0 ? items[i] : items[0];
      if (it) pick(it);
    }
    else if (e.key === "Delete" || e.key === "Backspace") { own(); pick(items.find((x) => x.key === "x")!); }
    else if (e.key.length === 1) {
      const it = items.find((x) => x.key === e.key.toLowerCase() && x.key !== "x");
      if (it) { own(); pick(it); }
    }
  };
  return createPortal(
    <div ref={ref} className={`tm-ctx${pos?.up ? " up" : ""}${at.kb ? " kb" : ""}`} role="menu" aria-label={`Task: ${t.title}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: at.x, top: at.y, visibility: "hidden" }}
      onContextMenu={(e) => e.preventDefault()} onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <span className="tm-ctx-t">{t.title}</span>
      {items.map((it) => (
        <div key={it.key} className="tm-ctx-grp">
          <button type="button" role="menuitem" data-k={it.key} className={`tm-ctx-i${it.danger ? " bad" : ""}${(it.key === "n" && dateOpen) || (it.key === "m" && listOpen) ? " on" : ""}`}
            aria-expanded={it.key === "n" ? dateOpen : undefined}
            onMouseEnter={(e) => { e.currentTarget.focus({ preventScroll: true }); sfx.hover(); }} onClick={() => pick(it)}>
            <span>{it.label}</span><kbd>{it.hint}</kbd>
          </button>
          {it.key === "h" && handOpen && <HandPicker id={at.id} onDone={close} />}
          {it.key === "m" && listOpen && <ListPicker ids={[at.id]} onDone={close} />}
          {it.key === "n" && dateOpen && (
            <div className="tm-ctx-date" role="group" aria-label="New date">
              <button type="button" className="tm-ed-chip" onClick={() => setDue(plusDays(0))}>Today</button>
              <button type="button" className="tm-ed-chip" onClick={() => setDue(plusDays(1))}>Tomorrow</button>
              <button type="button" className="tm-ed-chip" onClick={() => setDue(plusDays(7))}>Next week</button>
              {!daily && t.due && <button type="button" className="tm-ed-chip" onClick={() => setDue(null)}>No date</button>}
              <input type="date" className="tm-ed-date" value={pickDay} aria-label="Pick a date" onChange={(e) => setPickDay(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (/^\d{4}-\d{2}-\d{2}$/.test(pickDay)) setDue(pickDay); } }} />
              <button type="button" className="tm-ed-save" disabled={!/^\d{4}-\d{2}-\d{2}$/.test(pickDay)} onClick={() => setDue(pickDay)}>Set</button>
            </div>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Edit from the Overdue card: the same editor as the list, floating where the menu was. */
function FloatEditor({ at, clients, ranked, onDone }: { at: { id: string; x: number; y: number }; clients: ClientOpt[]; ranked: Doc<Todo>[]; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const d = vaultStore.get().docs.get(at.id) as Doc<Todo> | undefined;
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onDone(); };
    window.addEventListener("pointerdown", away, true);
    return () => window.removeEventListener("pointerdown", away, true);
  }, [onDone]);
  if (!d || d.kind !== "todo") return null;
  const W = Math.min(560, window.innerWidth - 24);
  return createPortal(
    <div ref={ref} className="tm-ctx-ed" style={{ left: Math.max(12, Math.min(window.innerWidth - W - 12, at.x - W + 40)), top: Math.max(12, Math.min(window.innerHeight - 320, at.y)), width: W }}
      onPointerDown={(e) => e.stopPropagation()}>
      <ul className="tm-list"><Editor d={d} clients={clients} onDone={onDone} ranked={d.data.type === "once" ? ranked : undefined} /></ul>
    </div>,
    document.body,
  );
}

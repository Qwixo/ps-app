// Dimension X, Lists view (Task API release; the developer's friend: "rn the new pages.. i can add tasks there but i dont have a
// way in dimension x to manage that"). Every to-do list page (V1.55, core/lists.ts) side by side in its order, with its
// sections and tasks: open a list (Dimension X closes and the Tab list slides to it), rename it (double click its name),
// move it left or right, delete it (move its tasks to the main list, or delete them too, with Undo), add a new list,
// and per task: tick, move to another list, delete (with Undo). Pages that hold panels (Edit mode) are left out.
// Every change goes through the same functions as the list's own menus (views/ListPager.tsx), so it is one write each.
// Also MoveMenu: the small menu that sends a task to another list, or out of the AI Inbox (core/aiinbox.ts).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Doc, DimxZone, Todo } from "../core/model";
import { MAIN, allPages, movePage, secsByPage, shownName, LIST_NAME_MAX, PAGES_MAX } from "../core/lists";
import { groupOf, newGroupId } from "../core/groups";
import { isEveryDay } from "../core/repeat";
import { inInbox, inboxMove } from "../core/aiinbox";
import { fmtDate } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { deleteList, goToPage, listCtx, moveToList, newList, renameList, setPageOrder } from "./ListPager";
import { taskMapActions } from "./TaskMap";
import "./dimxlists.css";

/** Esc inside the Lists view: a rename, a delete question or a menu closes first (Dimension X asks this first). */
let escNow: () => boolean = () => false;
export const listsEscape = () => escNow();

const secTasks = (key: string): Doc<Todo>[] => {
  const l = listCtx().lists, g = groupOf(key);
  if (g) return l.groups.get(g) ?? [];
  return key === "p1" ? l.p1 : key === "prio" ? l.prio : key === "daily" ? l.daily : [];
};
const secName = (key: string): string => {
  const c = listCtx(), g = groupOf(key);
  if (g) return c.groups.find((x) => x.id === g)?.name || "Group";
  if (key === "daily") return shownName(c.names, "daily", c.lists.daily.every((d) => isEveryDay(d.data)));
  return shownName(c.names, key as "p1" | "prio");
};
/** The list pages (not the pages of panels), left to right, with their names. */
export function taskPages(): { id: string; name: string }[] {
  const c = listCtx();
  return allPages(c.pages, c.names, c.order).filter((p) => p.id === MAIN || c.pages.find((x) => x.id === p.id)?.kind !== "panels");
}

export function DimxLists({ onOpen, onUndo }: { onOpen: () => void; onUndo: (text: string, restore: () => void) => void }) {
  const c = listCtx();
  const byPage = secsByPage(c.full, c.pages);
  const pages = taskPages();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; page: string; at: DOMRect } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const cancelRename = useRef<() => void>(() => setRenaming(null));
  escNow = () => {
    if (menu) { setMenu(null); return true; }
    if (renaming) { cancelRename.current(); return true; }
    if (asking) { setAsking(null); return true; }
    return false;
  };
  useEffect(() => () => { escNow = () => false; }, []);

  const move = (id: string, by: -1 | 1) => { sfx.drop(); setPageOrder(movePage(c.order, id, by)); };
  const open = (id: string) => { sfx.click(); onOpen(); window.setTimeout(() => goToPage(id), 60); };
  const delTask = (d: Doc<Todo>) => {
    sfx.click();
    void taskMapActions.remove(d.id);
    onUndo(d.data.title, () => { void taskMapActions.restore(d.id, d.data); });
  };
  const order = c.order.filter((id) => pages.some((p) => p.id === id));

  return (
    <div ref={root} className="dl-wrap" aria-label="Your lists">
      <div className="dl-cols">
        {pages.map((p) => {
          const keys = byPage.get(p.id) ?? [];
          const count = keys.reduce((n, k) => n + secTasks(k).filter((d) => !d.data.done).length, 0);
          const at = order.indexOf(p.id);
          return (
            <section key={p.id} className={`dl-col${p.id === MAIN ? " home" : ""}`} aria-label={p.name}>
              <header className="dl-head">
                {renaming === p.id ? (
                  <RenameBox value={p.name} cancelRef={cancelRename} onDone={(v) => { setRenaming(null); if (v !== null && v.trim() !== p.name) { sfx.click(); renameList(p.id, v); } }} />
                ) : (
                  <h3 className="dl-name" title="Double click to rename" onDoubleClick={() => { sfx.click(); setRenaming(p.id); }}>
                    {p.id === MAIN ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-label="Home"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg> : null}
                    <span>{p.name}</span>
                  </h3>
                )}
                <span className="dx-band-n num">{count}</span>
                <span className="dl-tools">
                  <button type="button" className="dl-btn" disabled={at <= 0} onClick={() => move(p.id, -1)} aria-label={`Move ${p.name} left`} title="Move left">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
                  </button>
                  <button type="button" className="dl-btn" disabled={at < 0 || at >= order.length - 1} onClick={() => move(p.id, 1)} aria-label={`Move ${p.name} right`} title="Move right">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                  <button type="button" className="dl-btn" onClick={() => { sfx.click(); setRenaming(p.id); }} aria-label={`Rename ${p.name}`} title="Rename">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
                  </button>
                  <button type="button" className="dl-btn wide" onClick={() => open(p.id)} title="Show this list in the Tab list">Open</button>
                  {p.id !== MAIN ? <button type="button" className="dl-btn bad" onClick={() => { sfx.click(); setAsking(asking === p.id ? null : p.id); }} aria-label={`Delete ${p.name}`} title="Delete list" aria-expanded={asking === p.id}>×</button> : null}
                </span>
              </header>
              {asking === p.id ? (
                <div className="dl-ask" role="group" aria-label={`Delete ${p.name}?`}>
                  <b>Delete {p.name}?</b>
                  <button type="button" className="dl-pick" onClick={() => { setAsking(null); deleteList(p.id, false); }}>{count ? `Delete, move its ${count} ${count === 1 ? "task" : "tasks"} to the main list` : "Delete the list"}</button>
                  {count ? <button type="button" className="dl-pick bad" onClick={() => { setAsking(null); deleteList(p.id, true); }}>Delete it and its {count} {count === 1 ? "task" : "tasks"}</button> : null}
                  <button type="button" className="dl-pick ghost" onClick={() => { sfx.click(); setAsking(null); }}>Cancel</button>
                </div>
              ) : null}
              <div className="dl-body" data-scroll>
                {keys.map((k) => {
                  const list = secTasks(k);
                  if (!list.length && (k === "p1" || (p.id === MAIN && k === "daily"))) return null;
                  return (
                    <div key={k} className="dl-sec">
                      <h4>{secName(k)}</h4>
                      {list.map((d) => (
                        <div key={d.id} className={`dl-row${d.data.done ? " done" : ""}${menu?.id === d.id ? " menu-on" : ""}`}>
                          <button type="button" className="dx-tick" onClick={() => { sfx.done(); void taskMapActions.tick(d.id, !d.data.done); }} aria-label={`${d.data.done ? "Untick" : "Tick off"}: ${d.data.title}`} title={d.data.done ? "Untick" : "Tick off"}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
                          </button>
                          <span className="dl-tx"><span className="dl-t">{d.data.title}</span>
                            {d.data.ai || d.data.due ? <span className="dl-meta">{d.data.ai ? <span className="dx-ai" title="Added by an AI">AI</span> : null}{d.data.due ? <span className="dx-due num">{fmtDate(d.data.due)}</span> : null}</span> : null}</span>
                          <span className="dl-acts">
                            <button type="button" className="dx-mv" onClick={(e) => { sfx.click(); const b = root.current?.getBoundingClientRect(), r = e.currentTarget.getBoundingClientRect(); if (b) setMenu((m) => (m?.id === d.id ? null : { id: d.id, page: p.id, at: new DOMRect(r.left - b.left, r.top - b.top, r.width, r.height) })); }}
                              aria-label={`Move: ${d.data.title}`} title="Move to another list" aria-expanded={menu?.id === d.id}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                            </button>
                            <button type="button" className="dx-del" onClick={() => delTask(d)} aria-label={`Delete: ${d.data.title}`} title="Delete">×</button>
                          </span>
                        </div>
                      ))}
                      {!list.length ? <p className="dl-empty">Nothing here.</p> : null}
                    </div>
                  );
                })}
                {!keys.length ? <p className="dl-empty">No sections on this list yet.</p> : null}
              </div>
            </section>
          );
        })}
        {c.pages.length < PAGES_MAX ? (
          <button type="button" className="dl-new" onClick={() => { newList({ at: c.order.length }); }} title="A new list on the right">
            <span aria-hidden="true">+</span>New list
          </button>
        ) : null}
      </div>
      {menu && (() => {
        const d = [...listCtx().lists.ranked, ...listCtx().lists.daily, ...[...listCtx().lists.groups.values()].flat()].find((x) => x.id === menu.id);
        return d ? <MoveMenu task={d} from={menu.page} at={menu.at} bounds={root.current} onClose={() => setMenu(null)} onMoved={() => setMenu(null)} /> : null;
      })()}
    </div>
  );
}

function RenameBox({ value, onDone, cancelRef }: { value: string; onDone: (v: string | null) => void; cancelRef: React.MutableRefObject<() => void> }) {
  const done = useRef(false);
  const end = (v: string | null) => { if (done.current) return; done.current = true; taskMapActions.editing(false); onDone(v); };
  cancelRef.current = () => end(null);
  return (
    <input className="dl-rename" autoFocus defaultValue={value} maxLength={LIST_NAME_MAX} aria-label="List name" spellCheck={false}
      onFocus={(e) => { e.currentTarget.select(); taskMapActions.editing(true); }}
      onBlur={(e) => end(e.currentTarget.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); end(e.currentTarget.value); } }} />
  );
}

const BANDS: { zone: DimxZone; label: string }[] = [{ zone: "act", label: "Actionables" }, { zone: "soon", label: "The Upside Down" }, { zone: "x", label: "Dimension X" }];
/** Send a task to another list. An AI Inbox task leaves the inbox (into that list's first section that takes it, or a
 *  new "To do" group there); onBand also lets it become an idea card in a band. */
export function MoveMenu({ task, from, at, bounds, onClose, onMoved, onBand }: {
  task: Doc<Todo>; from?: string; at: DOMRect; bounds: HTMLElement | null; onClose: () => void; onMoved: () => void; onBand?: (zone: DimxZone) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !bounds) return;
    const W = bounds.clientWidth, H = bounds.clientHeight, w = el.offsetWidth, h = el.offsetHeight;
    const below = at.bottom + 6, above = at.top - 6 - h;
    setPos({ left: Math.max(4, Math.min(W - w - 4, at.right - w)), top: below + h > H && above >= 0 ? above : Math.max(4, Math.min(H - h - 4, below)) });
  }, [at, bounds]);
  useEffect(() => {
    const out = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.(".dx-mv")) onClose(); };
    window.addEventListener("pointerdown", out, true);
    return () => window.removeEventListener("pointerdown", out, true);
  }, [onClose]);
  const inbox = inInbox(task.data);
  const go = (page: string) => {
    if (!inbox) { moveToList([task.id], page); onMoved(); return; }
    const c = listCtx();
    const m = inboxMove(task.data, page, { lists: c.lists, full: c.full, pages: c.pages, groups: c.groups }, newGroupId);
    if (!m) { onClose(); return; }
    sfx.drop();
    if (m.settings) void taskMapActions.looks(m.settings);
    void taskMapActions.update(task.id, m.patch);
    onMoved();
  };
  const pages = taskPages().filter((p) => p.id !== from);
  return (
    <div ref={ref} className="dl-menu" role="menu" aria-label="Move to" style={pos ? { left: pos.left, top: pos.top } : { left: at.left, top: at.bottom + 6, visibility: "hidden" }}
      onPointerDown={(e) => e.stopPropagation()}>
      <span className="dl-menu-h">{inbox ? "Move to a list" : "Move to"}</span>
      {pages.map((p) => (
        <button key={p.id} type="button" role="menuitem" className="dl-item" onClick={() => go(p.id)}>
          {p.id === MAIN ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg> : <i aria-hidden="true" />}
          {p.name}
        </button>
      ))}
      {onBand ? <>
        <span className="dl-menu-h">Make it an idea</span>
        {BANDS.map((b) => <button key={b.zone} type="button" role="menuitem" className={`dl-item band z-${b.zone}`} onClick={() => onBand(b.zone)}><i aria-hidden="true" />{b.label}</button>)}
      </> : null}
    </div>
  );
}

// The Completed section at the bottom of the Tab list (V1.34, rules in core/completed.ts). A ticked one-off task
// slides down here: a grey area, every task crossed out, the newest tick on top. Resurrect (above the area) puts
// every task in it back on the list (V1.47: when it is empty, the ones ticked since yesterday, so Resurrect is
// always there while something can come back); Complete all ticks every open task; unticking one puts just that
// one back where it was. Clear takes them out of
// Completed. Both have Undo (bottom right, Cmd+Z). Settings, General, To do list: Move to Completed or Disappear,
// show the section or not, and how long it keeps ticks.
// V1.57: "Show all completed" at the end of the area opens every task ever ticked, a page at a time as it scrolls; Cmd +
// click (Ctrl + click off a Mac, a long press on the phone) picks tasks, and Resurrect then brings back only those.
import type { Doc, Settings, Todo } from "../core/model";
import { COMPLETE_ALL_ASK, KEEP_LABEL, LONG_PRESS_MS, historySlice, isPickClick, listPrefs, longPressMoved, moreCompleted, resurrectTargets, type KeepFor } from "../core/completed";
import { TICK_SOUNDS, tickSoundOf } from "../core/ticksound";
import { ADD_ANIMS, ADD_COLORS, ADD_COLOR_DEFAULT, addAnimOf, addColorOf, addInkOn, type AddAnim } from "../core/addbutton";
import { p1Color } from "../core/prio";
import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { fmtDay, fmtTime, homeTz, wall } from "../core/tz";
import { settingsData } from "../core/select";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { Editor, clearSel, clickTick, playAddAnim, pressTick, pushUndoAction, sendBury, sendClear, sendCompleteAll, sendRevive, sendTicks, taskMapActions, tickTask, toggleSel, useFlipIn, useSelection } from "./TaskMap";
import { openTaskMenu, openTaskMenuAt } from "./TaskMenu";

type ClientOpt = { id: string; name: string };

/** "14:05" for a tick today (the developer's zone), "Tue 4 Nov" before that. */
function tickedAt(iso: string | null | undefined) {
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return "";
  const tz = homeTz(), a = wall(ms, tz), b = wall(Date.now(), tz);
  return a.y === b.y && a.mo === b.mo && a.d === b.d ? fmtTime(ms, tz) : fmtDay(ms, tz);
}

const RESURRECT_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 19V6" /><path d="M6 11l6-6 6 6" /><path d="M5 21h14" />
  </svg>
);

const ALL_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12.5l4 4 8.5-9" /><path d="M10.5 16.5l1 0.5L21 7.5" />
  </svg>
);

/** The end of the list (V1.34, V1.47): one row with Resurrect (whenever something can come back: `back`), Clear (while
 *  Completed shows tasks), Complete all (while the list has open tasks: `open`) and Sleep (`extra`), then Completed. */
export function Completed({ list, back, history, open, keep, editing, onEdit, clients, extra, title }: { list: Doc<Todo>[]; back: Doc<Todo>[]; history: Doc<Todo>[]; open: string[]; keep: KeepFor; editing: string | null; onEdit: (id: string | null) => void; clients: ClientOpt[]; extra?: ReactNode; title?: ReactNode }) {
  const ids = list.map((d) => d.id);
  const name = (l: Doc<Todo>[]) => (l.length === 1 ? l[0].data.title : `${l.length} tasks`);
  const [all, setAll] = useState(false);
  const [pages, setPages] = useState(1);
  const picked = useSelection();
  const more = moreCompleted(history, list);
  const showAll = all && history.length > 0;
  const slice = showAll ? historySlice(history, pages) : { rows: list, more: false };
  // Resurrect: the picked completed tasks when any are picked, otherwise everything it brought back before.
  const targets = resurrectTargets(back, showAll ? history : list, picked);
  const picking = targets.some((d) => picked.has(d.id)) && targets !== back;
  const resurrect = () => {
    if (!targets.length) return;
    const r = targets.map((d) => d.id), cleared = targets.filter((d) => !!d.data.clearedAt).map((d) => d.id);
    sfx.drop();
    if (picking) clearSel();
    sendRevive(r, cleared);
    pushUndoAction(`res:${r[0]}:${r.length}`, `Resurrect ${name(targets)}`, () => sendBury(r, cleared));
  };
  const clear = () => {
    if (!ids.length) return;
    sfx.click();
    sendClear(ids, true);
    pushUndoAction(`clr:${ids[0]}:${ids.length}`, `Clear ${name(list)}`, () => sendClear(ids, false));
  };
  const backTitle = picking
    ? `Bring back only the ${targets.length === 1 ? "task" : `${targets.length} tasks`} you picked (Esc lets them go; Undo takes ${targets.length === 1 ? "it" : "them"} off again)`
    : list.length
      ? "Put every task in Completed back on your list (Undo brings them back here). Cmd + click tasks to bring back only some."
      : `Bring back the ${back.length === 1 ? "task" : `${back.length} tasks`} you ticked off lately (Undo takes ${back.length === 1 ? "it" : "them"} off again)`;
  const rows = slice.rows;
  const hasArea = list.length > 0 || more > 0 || showAll;
  // A click on the empty space around the rows lets every pick go.
  const bare = (e: React.MouseEvent<HTMLElement>) => { const t = e.target as HTMLElement; if (t === e.currentTarget || t.classList.contains("tm-done-bar") || t.classList.contains("tm-done-area")) clearSel(); };
  return (
    <section className={`tm-sec tm-sec-done${hasArea ? "" : " tm-sec-done-empty"}`} aria-label={hasArea ? "Completed" : "End of the list"} onClick={bare}>
      <div className="tm-done-bar">
        {targets.length > 0 && (
          <button type="button" className={`tm-done-res${picking ? " picking" : ""}`} onClick={resurrect} title={backTitle}>
            {RESURRECT_ICON}<span>{picking ? "Resurrect picked" : "Resurrect"}</span><b className="num">{targets.length}</b>
          </button>
        )}
        {list.length > 0 && <button type="button" className="tm-done-clear" onClick={clear} title="Take these off Completed (Undo brings them back)">Clear</button>}
        <CompleteAll open={open} />
        {extra}
      </div>
      {hasArea && (
        <div className="tm-done-area" onClick={bare}>
          <h3 className="tm-sec-h tm-done-h">{title ?? "Completed"}<span className="tm-sec-note">{showAll ? `all ${history.length}` : keep === "today" ? "today" : `last ${KEEP_LABEL[keep]}`}</span></h3>
          {rows.length > 0 && (
            <ul className="tm-list tm-done-list">
              {rows.map((d) => editing === d.id
                ? <Editor key={d.id} d={d} clients={clients} onDone={() => onEdit(null)} />
                : <DoneRow key={d.id} d={d} picked={picked.has(d.id)} any={picked.size > 0} />)}
            </ul>
          )}
          {showAll && slice.more && <HistoryEnd pages={pages} onMore={() => setPages((p) => p + 1)} />}
          {!showAll && more > 0 && (
            <button type="button" className="tm-done-all" onClick={() => { sfx.click(); setAll(true); setPages(1); }}
              title="Every task you have ever ticked off, newest first">Show all completed<b className="num">{history.length}</b></button>
          )}
          {showAll && (
            <button type="button" className="tm-done-all tm-done-less" onClick={() => { sfx.click(); setAll(false); setPages(1); }}>Show less</button>
          )}
        </div>
      )}
    </section>
  );
}

/** The end of the drawn history: when it scrolls into view (a little early), the next page is drawn. */
function HistoryEnd({ pages, onMore }: { pages: number; onMore: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const n = el.current;
    if (!n || typeof IntersectionObserver !== "function") return;
    // Made again after every page, so a page too short to push this out of view still asks for the next one.
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) onMore(); }, { rootMargin: "400px 0px" });
    io.observe(n);
    return () => io.disconnect();
  }, [pages]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={el} className="tm-done-more" aria-hidden="true">Loading more...</div>;
}

/** Complete all (V1.47): ticks every open task on the list. More than a few asks first, in place (Esc or No says no,
 *  and it lets go by itself after a few seconds). One Undo puts them all back. */
function CompleteAll({ open }: { open: string[] }) {
  const [asking, setAsking] = useState(false);
  const n = open.length;
  useEffect(() => { if (!n) setAsking(false); }, [n]);
  useEffect(() => {
    if (!asking) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setAsking(false); } };
    window.addEventListener("keydown", k, true);
    const t = window.setTimeout(() => setAsking(false), 8000);
    return () => { window.removeEventListener("keydown", k, true); window.clearTimeout(t); };
  }, [asking]);
  if (!n) return null;
  const run = () => {
    setAsking(false);
    const ids = [...open];
    sfx.done();
    sendCompleteAll(ids);
    pushUndoAction(`all:${ids[0]}:${ids.length}`, `Complete all (${ids.length === 1 ? "1 task" : `${ids.length} tasks`})`, () => sendTicks(ids, false));
  };
  if (asking) return (
    <span className="tm-all-ask" role="group" aria-label="Complete all">
      <span className="tm-all-q">Tick all {n}?</span>
      <button type="button" className="tm-all-yes" onClick={run} autoFocus>Yes, tick all</button>
      <button type="button" className="tm-all-no" onClick={() => { sfx.click(); setAsking(false); }}>No</button>
    </span>
  );
  return (
    <button type="button" className="tm-all" title={`Tick every task on your list (${n}). Undo puts them all back.`}
      onClick={() => { if (n > COMPLETE_ALL_ASK) { sfx.click(); setAsking(true); } else run(); }}>
      {ALL_ICON}<span>Complete all</span>
    </button>
  );
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** One completed task. Cmd + click (Ctrl + click off a Mac) picks it for Resurrect; on the phone a long press picks it,
 *  and while any are picked a tap picks or lets go. */
const DoneRow = memo(function DoneRow({ d, picked, any }: { d: Doc<Todo>; picked: boolean; any: boolean }) {
  const t = d.data;
  const flip = useFlipIn(d.id);
  const untick = () => tickTask(d.id);
  const at = tickedAt(t.doneAt);
  const hold = useRef<{ timer: number; x: number; y: number; pid: number } | null>(null);
  const longAt = useRef(0);
  const stopHold = () => { if (hold.current) { window.clearTimeout(hold.current.timer); hold.current = null; } };
  useEffect(() => stopHold, []);
  const justHeld = () => Date.now() - longAt.current < 900;
  return (
    <li ref={(el) => { flip.current = el; }} className={`tm-row tm-done-row done${picked ? " sel" : ""}`} data-id={d.id} data-type={t.type}
      onMouseEnter={() => sfx.hover()}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" || !e.isPrimary) return;
        stopHold();
        const timer = window.setTimeout(() => {
          hold.current = null; longAt.current = Date.now();
          sfx.click(); try { navigator.vibrate?.(15); } catch { /* no buzz */ }
          toggleSel(d.id);
        }, LONG_PRESS_MS);
        hold.current = { timer, x: e.clientX, y: e.clientY, pid: e.pointerId };
      }}
      onPointerMove={(e) => { const h = hold.current; if (h && e.pointerId === h.pid && longPressMoved(e.clientX - h.x, e.clientY - h.y)) stopHold(); }}
      onPointerUp={stopHold} onPointerCancel={stopHold} onPointerLeave={stopHold}
      onContextMenu={(e) => { if (justHeld()) { e.preventDefault(); return; } openTaskMenu(e, d.id, "done"); }}
      // Cmd + click picks (or lets go) instead of what the click would do; a plain click lets every pick go.
      onClickCapture={(e) => {
        const touch = (e.nativeEvent as PointerEvent).pointerType === "touch";
        if (justHeld()) { e.preventDefault(); e.stopPropagation(); }
        else if (isPickClick(e, MAC) || (touch && any)) { e.preventDefault(); e.stopPropagation(); sfx.click(); toggleSel(d.id); }
        else clearSel();
      }}
      onKeyDown={(e) => { if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) { e.preventDefault(); openTaskMenuAt(e.currentTarget, d.id, "done"); } }}>
      {picked && <span className="tm-sel-mark" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg></span>}
      <button type="button" className="tm-tick no-drag" aria-pressed="true" aria-label={`Untick: ${t.title}`} title="Untick: back on your list, where it was"
        onPointerDown={(e) => pressTick(e, d.id, untick)} onClick={() => clickTick(d.id, untick)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
      </button>
      <span className="tm-text">
        <span className="tm-t">{t.title}</span>
        {at && <span className="tm-due num">{at}</span>}
      </span>
    </li>
  );
});

/** Settings, General, To do list: one card each (part), or all three in a row for the small gear menu. */
export function ListBehaviourControls({ part }: { part: "mode" | "show" | "keep" | "sound" }) {
  const st = settingsData(useVault());
  const p = listPrefs(st);
  const save = (patch: Partial<Settings>) => { sfx.hover(); void taskMapActions.looks(patch); };
  const seg = (label: string, opts: { on: boolean; text: string; pick: () => void }[]) => (
    <div className="tm-ed-seg" role="radiogroup" aria-label={label}>
      {opts.map((o) => (
        <button key={o.text} type="button" role="radio" aria-checked={o.on} className={`dwell${o.on ? " on" : ""}`} onClick={() => { if (!o.on) o.pick(); }}>{o.text}</button>
      ))}
    </div>
  );
  if (part === "mode") return seg("When I tick a task", [
    { on: p.mode === "completed", text: "Move to Completed", pick: () => save({ tmTickMode: "completed" }) },
    { on: p.mode === "vanish", text: "Disappear", pick: () => save({ tmTickMode: "vanish" }) },
  ]);
  if (part === "show") return seg("Show the Completed section", [
    { on: p.show, text: "Show", pick: () => save({ tmShowDone: true }) },
    { on: !p.show, text: "Hide", pick: () => save({ tmShowDone: false }) },
  ]);
  if (part === "sound") {
    const cur = tickSoundOf(st);
    return (
      <div className="tm-snd" role="radiogroup" aria-label="Tick sound">
        {TICK_SOUNDS.map((x) => (
          <span key={x.id} className={`tm-snd-i${cur === x.id ? " on" : ""}`}>
            <button type="button" role="radio" aria-checked={cur === x.id} className="tm-snd-pick"
              onClick={() => { if (cur !== x.id) { void taskMapActions.looks({ tmTickSound: x.id }); } sfx.tickPreview(x.id); }}>{x.label}</button>
            <button type="button" className="tm-snd-play" aria-label={`Play ${x.label}`} title={`Play ${x.label}`} onClick={() => sfx.tickPreview(x.id)}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" /></svg>
            </button>
          </span>
        ))}
        <span className={`tm-snd-i${cur === "off" ? " on" : ""}`}>
          <button type="button" role="radio" aria-checked={cur === "off"} className="tm-snd-pick" onClick={() => { if (cur !== "off") save({ tmTickSound: "off" }); }}>Off</button>
        </span>
      </div>
    );
  }
  return seg("Completed keeps ticks for", (["today", "7d", "30d"] as KeepFor[]).map((k) => ({ on: p.keep === k, text: KEEP_LABEL[k], pick: () => save({ tmDoneKeep: k }) })));
}

/** Settings, To do list: the Add task button's colour (presets or your own) and its click animation, with a sample
 *  button that plays the animation in the colour (core/addbutton.ts, V1.34). */
export function AddButtonControls() {
  const st = settingsData(useVault());
  const color = addColorOf(st), anim = addAnimOf(st);
  const sample = useRef<HTMLButtonElement>(null);
  const [hex, setHex] = useState(color);
  useEffect(() => { setHex(color); }, [color]);
  const save = (patch: Partial<Settings>) => { void taskMapActions.looks(patch); };
  const play = (a: AddAnim) => { playAddAnim(sample.current?.parentElement ?? null, a); };
  const pickColor = (c: string | null) => { sfx.hover(); save({ tmAddColor: c && c !== ADD_COLOR_DEFAULT ? c : null }); };
  const typed = (v: string) => { setHex(v); const c = p1Color(v); if (c && c !== color) pickColor(c); };
  return (
    <div className="tm-addset">
      <div className="tm-addset-row">
        <div className="tm-addset-sw" role="radiogroup" aria-label="Add task button colour">
          {ADD_COLORS.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={color === c.id} aria-label={c.label} title={c.label}
              className={`tm-addset-dot${color === c.id ? " sel" : ""}`} style={{ ["--sw" as string]: c.id }} onClick={() => pickColor(c.id)} />
          ))}
          <label className="tm-addset-own" title="Your own colour">
            <input type="color" value={color} aria-label="Your own colour" onChange={(e) => typed(e.target.value)} />
          </label>
          <input type="text" className="tm-addset-hex" value={hex} maxLength={7} spellCheck={false} aria-label="Colour code"
            onChange={(e) => typed(e.target.value)} onBlur={() => setHex(color)} />
        </div>
        <span className="tm-add tm-addset-sample" style={{ ["--tm-addc" as string]: color, ["--tm-addink" as string]: addInkOn(color) }}>
          <button ref={sample} type="button" className="tm-pill-btn icon" aria-label="Try the animation" title="Try it" onClick={() => { sfx.click(); play(anim); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </span>
      </div>
      <div className="tm-ed-seg" role="radiogroup" aria-label="When it is clicked">
        {ADD_ANIMS.map((a) => (
          <button key={a.id} type="button" role="radio" aria-checked={anim === a.id} className={`dwell${anim === a.id ? " on" : ""}`}
            onClick={() => { if (anim !== a.id) { sfx.hover(); save({ tmAddAnim: a.id }); } play(a.id); }}>{a.label}</button>
        ))}
      </div>
    </div>
  );
}

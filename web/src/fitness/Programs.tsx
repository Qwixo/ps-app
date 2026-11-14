// PS Fitness, the Program screen: the developer's week of days. The phone gets it in a full height sheet (a day
// switcher on top, the day's exercises as big cards); the desk gets days on the left and the day on the
// right. Everything is editable with big targets: days (add, rename, title, move, delete), exercises
// (from the library or his own, sets, per set reps and kg, each side, target RIR, rest, note), programs
// (new, switch, archive, delete), plus the trainer's sheet import and the week export (ImportExport.tsx).
// Edits land in a local copy at once and are saved 400 ms after the last change (or on blur, on leaving,
// on closing a panel), so typing never stutters and nothing is lost.
import { ScanSearch } from "./Scan";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Doc } from "../core/model";
import {
  RIR_VALUES, RIR_WORDS, REST_STEP, exKey, fmtClock, fmtKg, restFor, rirLabel, setsDefault, targetLine,
  type FitDay, type FitKind, type FitPlanEx, type FitPrefs, type FitProgram,
} from "../core/fitness";
import { addProgram, deleteProgram, newDay, savePrefs, saveProgram, type FitView } from "./store";
import { libById, planFromLib, searchLib, type LibEx } from "./lib";
import { ExPic, picCardOpen } from "./ExPic";
import { Info } from "./Info";
import { RestNum } from "./RestNum";
import { picFor } from "./pics";
import {
  REST_CHOICES, SETS_MAX, SETS_MIN, allSame, blankProgram, clampReps, indexAfterDelete, kindHint, moveItem, nudgeRest,
  ownEx, parseKg, parseReps, programSummary, renumberDays, restWords, setAll, setAt, setCount, stepKg, weightLine,
} from "./plan-logic";
import { ExportBody, ImportBody } from "./ImportExport";
import { haptic } from "../gos/bridge";
import { useFitSub } from "./Nav";
import { dayWords } from "./nav-logic";
import "./programs.css";

type PanelK = { k: "ex"; dayId: string; exId: string } | { k: "lib"; dayId: string } | { k: "list" } | { k: "import" } | { k: "export" };
interface Ask { title: string; text?: string; yes: string; no?: string; onYes: () => void }
const PANEL_TITLE: Record<PanelK["k"], string> = {
  ex: "Edit exercise", lib: "Add an exercise", list: "My programs", import: "Import your trainer's sheet", export: "Export my week",
};

// ---------- the local copy that saves itself ----------
interface Draft { p: FitProgram | null; id: string | null; edit: (f: (p: FitProgram) => FitProgram, now?: boolean) => void; flush: () => void; drop: () => void }
function useDraft(doc: Doc<FitProgram> | null): Draft {
  const [p, setP] = useState<FitProgram | null>(doc?.data ?? null);
  const cur = useRef<FitProgram | null>(doc?.data ?? null);
  const id = useRef<string | null>(doc?.id ?? null);
  const pending = useRef(false);
  const inflight = useRef(0);
  const timer = useRef(0);
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!pending.current || !id.current || !cur.current) return;
    pending.current = false;
    inflight.current++;
    void saveProgram(cur.current, id.current).catch(() => { pending.current = true; }).finally(() => { inflight.current--; });
  }, []);
  const drop = useCallback(() => { window.clearTimeout(timer.current); pending.current = false; }, []);
  useEffect(() => {
    const nid = doc?.id ?? null;
    if (nid !== id.current) { flush(); id.current = nid; cur.current = doc?.data ?? null; setP(cur.current); return; }
    // Take the vault's copy (eg the other device's edit) only when nothing of ours is waiting or on its way.
    if (doc && !pending.current && inflight.current === 0 && doc.data !== cur.current) { cur.current = doc.data; setP(doc.data); }
  }, [doc, flush]);
  const edit = useCallback((f: (p: FitProgram) => FitProgram, now = false) => {
    if (!cur.current) return;
    const n = f(cur.current);
    if (n === cur.current) return;
    cur.current = n; pending.current = true; setP(n);
    window.clearTimeout(timer.current);
    if (now) flush(); else timer.current = window.setTimeout(flush, 400);
  }, [flush]);
  useEffect(() => {
    const vis = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", vis);
    return () => { window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", vis); flush(); };
  }, [flush]);
  return { p, id: id.current, edit, flush, drop };
}

// ---------- smooth reorder: remember where things were, then glide them from there (transform only) ----------
function useFlip() {
  const els = useRef(new Map<string, HTMLElement>());
  const before = useRef<Map<string, { x: number; y: number }> | null>(null);
  const snap = useCallback(() => {
    const m = new Map<string, { x: number; y: number }>();
    els.current.forEach((el, k) => m.set(k, { x: el.offsetLeft, y: el.offsetTop }));
    before.current = m;
  }, []);
  useLayoutEffect(() => {
    const b = before.current;
    if (!b) return;
    before.current = null;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    els.current.forEach((el, k) => {
      const o = b.get(k);
      if (!o) return;
      const dx = o.x - el.offsetLeft, dy = o.y - el.offsetTop;
      if (!dx && !dy) return;
      el.animate?.([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], { duration: 340, easing: "cubic-bezier(.22, 1, .36, 1)" });
    });
  });
  const ref = useCallback((k: string) => (el: HTMLElement | null) => { if (el) els.current.set(k, el); else els.current.delete(k); }, []);
  return { snap, ref };
}

// ---------- the screen ----------
export function Programs({ v, desk }: { v: FitView; desk?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setRoot((host.current?.closest(".fit") as HTMLElement | null) ?? document.body); }, []);
  const d = useDraft(v.program);
  const [panel, setPanel] = useState<PanelK | null>(null);
  const last = useRef<PanelK | null>(null);
  if (panel) last.current = panel;
  const [ask, setAsk] = useState<Ask | null>(null);
  const [pop, setPop] = useState<string | null>(null);

  const closePanel = useCallback(() => { d.flush(); setPanel(null); }, [d.flush]);
  // Back (phone gesture) and Escape close the top layer first: the question, then the panel.
  const top = useRef<() => boolean>(() => false);
  top.current = () => {
    if (picCardOpen()) return false;   // an exercise card over the panel closes first (its own listener)
    if (ask) { setAsk(null); return true; }
    if (panel) { closePanel(); return true; }
    return false;
  };
  useEffect(() => {
    const back = (e: Event) => { if (top.current()) { e.preventDefault(); e.stopImmediatePropagation(); } };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && top.current()) { e.preventDefault(); e.stopPropagation(); } };
    window.addEventListener("gos-back", back, true);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("gos-back", back, true); window.removeEventListener("keydown", key, true); };
  }, []);

  const p = d.p, pid = d.id;
  const editDay = (dayId: string, f: (day: FitDay) => FitDay, now = false) =>
    d.edit((x) => ({ ...x, days: x.days.map((y) => (y.id === dayId ? f(y) : y)) }), now);
  const editEx = (dayId: string, exId: string, f: (e: FitPlanEx) => FitPlanEx, now = false) =>
    editDay(dayId, (day) => ({ ...day, exercises: day.exercises.map((e) => (e.id === exId ? f(e) : e)) }), now);
  const removeEx = (dayId: string, ex: FitPlanEx, after?: () => void) => setAsk({
    title: `Remove ${ex.name}?`, text: "It comes out of this day's plan. Workouts you logged stay.", yes: "Remove",
    onYes: () => { editDay(dayId, (day) => ({ ...day, exercises: day.exercises.filter((e) => e.id !== ex.id) }), true); haptic("reject"); after?.(); },
  });
  const startBlank = async () => { d.flush(); haptic("press"); await addProgram(blankProgram(), { activate: true }); setPanel(null); };

  let body: ReactNode = null;
  const shown = panel ?? last.current;
  if (shown) {
    if (shown.k === "ex" && p) {
      const day = p.days.find((x) => x.id === shown.dayId);
      const ex = day?.exercises.find((x) => x.id === shown.exId);
      body = ex && day ? (
        <ExEditor key={ex.id} ex={ex} prefs={v.prefs} onFlush={d.flush}
          onChange={(f, now) => editEx(day.id, ex.id, f, now)}
          onRemove={() => removeEx(day.id, ex, () => setPanel(null))}
          onDone={closePanel} />
      ) : <p className="fp-empty-line">This exercise was removed.</p>;
    } else if (shown.k === "lib") {
      const dayId = shown.dayId;
      const add = (ex: FitPlanEx) => {
        editDay(dayId, (day) => ({ ...day, exercises: [...day.exercises, ex] }), true);
        haptic("press"); setPop(ex.id); setPanel(null);
        window.setTimeout(() => setPop((x) => (x === ex.id ? null : x)), 900);
      };
      body = <LibPicker prefs={v.prefs} onPick={(x) => add(planFromLib(x, setsDefault(v.prefs)))} onOwn={(name, kind) => add(ownEx(name, kind, setsDefault(v.prefs)))} desk={desk} />;
    } else if (shown.k === "list") {
      body = (
        <ProgramList v={v} activeId={pid}
          onUse={(id) => { d.flush(); void savePrefs({ programId: id, lock: null }); haptic("press"); setPanel(null); }}
          onNew={() => void startBlank()}
          onImport={() => setPanel({ k: "import" })}
          onArchive={(doc) => setAsk({
            title: `Archive ${doc.data.name}?`, text: "It is tucked away under old programs. You can bring it back any time.", yes: "Archive",
            onYes: () => {
              const isActive = doc.id === pid && p;
              if (isActive) d.flush();
              void saveProgram({ ...(isActive ? p : doc.data), archived: true }, doc.id);
              haptic("drop");
            },
          })}
          onRestore={(doc) => { void saveProgram({ ...doc.data, archived: false }, doc.id).then(() => savePrefs({ programId: doc.id, lock: null })); haptic("press"); setPanel(null); }}
          onDelete={(doc) => setAsk({
            title: `Delete ${doc.data.name}?`, text: "The program is gone for good. Workouts you logged with it stay in your history.", yes: "Delete",
            onYes: () => { if (doc.id === pid) d.drop(); void deleteProgram(doc.id); haptic("reject"); },
          })}
        />
      );
    } else if (shown.k === "import") {
      body = <ImportBody v={v} onFlush={d.flush} onSaved={() => setPanel(null)} />;
    } else if (shown.k === "export") {
      body = <ExportBody v={v} />;
    }
  }

  // V1.43: the panel names what it edits ("Add an exercise to Day 2: Arms"), and on the phone that title sits in
  // Fitness's own top bar (with its Back arrow and the menu) instead of a second bar of its own.
  const dayOf = (id: string) => p?.days.find((x) => x.id === id) ?? null;
  const panelTitle = !shown ? "" : shown.k === "lib" ? (dayOf(shown.dayId) ? `Add an exercise to ${dayWords(dayOf(shown.dayId)!)}` : PANEL_TITLE.lib)
    : shown.k === "ex" ? (dayOf(shown.dayId)?.exercises.find((x) => x.id === shown.exId)?.name ?? PANEL_TITLE.ex) : PANEL_TITLE[shown.k];
  useFitSub(panel && !desk ? panelTitle : null);
  return (
    <div ref={host} className={`fp${desk ? " fp-desk" : " fp-phone"}`}>
      {!v.ready ? <p className="fp-empty-line">Opening your vault</p>
        : p && pid ? (
          <ProgramView key={pid} v={v} p={p} pid={pid} desk={!!desk} draft={d} pop={pop}
            onPanel={setPanel} onAsk={setAsk} onRemoveEx={removeEx} editDay={editDay} />
        ) : (
          <Empty onImport={() => setPanel({ k: "import" })} onBlank={() => void startBlank()}
            old={v.programs.length} onList={() => setPanel({ k: "list" })} />
        )}
      {root && createPortal(
        <>
          <Panel open={!!panel} title={panelTitle} desk={!!desk} onClose={closePanel}>{body}</Panel>
          <Confirm ask={ask} onClose={() => setAsk(null)} />
        </>,
        root,
      )}
    </div>
  );
}

// ---------- no program yet ----------
function Empty({ onImport, onBlank, old, onList }: { onImport: () => void; onBlank: () => void; old: number; onList: () => void }) {
  return (
    <div className="fp-empty">
      <div className="fp-empty-art" aria-hidden="true"><Icon k="dumbbell" size={44} /></div>
      <h2 className="fp-empty-h">Your week of training</h2>
      <p className="fp-empty-p">Set up your days once. The gym screen then shows you what to lift, set by set.</p>
      <button type="button" className="fp-choice fp-choice-main" onClick={onImport}>
        <Icon k="import" size={30} />
        <span><b>Import my trainer's sheet</b><small>Copy the cells from Google Sheets and paste them in.</small></span>
      </button>
      <button type="button" className="fp-choice" onClick={onBlank}>
        <Icon k="edit" size={30} />
        <span><b>Build it myself</b><small>Four empty days to fill with exercises.</small></span>
      </button>
      {old > 0 && <button type="button" className="fp-btn fp-quiet fp-wide" onClick={onList}><Icon k="swap" />Old programs ({old})</button>}
    </div>
  );
}

// ---------- the program ----------
function ProgramView({ v, p, pid, desk, draft, pop, onPanel, onAsk, onRemoveEx, editDay }: {
  v: FitView; p: FitProgram; pid: string; desk: boolean; draft: Draft; pop: string | null;
  onPanel: (x: PanelK) => void; onAsk: (a: Ask) => void;
  onRemoveEx: (dayId: string, ex: FitPlanEx) => void;
  editDay: (dayId: string, f: (day: FitDay) => FitDay, now?: boolean) => void;
}) {
  const next = v.next && v.next.programId === pid ? v.next : null;
  const lock = v.prefs.lock && v.prefs.lock.programId === pid ? v.prefs.lock : null;
  const [dayId, setDayId] = useState<string | null>(next?.dayId ?? p.days[0]?.id ?? null);
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const idx = Math.max(0, p.days.findIndex((x) => x.id === dayId));
  const day = p.days[idx] ?? null;
  // The new day's cards slide in from the side the developer moved towards (set on a tap, so a reorder never replays it).
  const [dir, setDir] = useState("");
  const dayFlip = useFlip();
  const exFlip = useFlip();
  const chips = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chips.current?.querySelector<HTMLElement>(".fp-day.on");
    el?.scrollIntoView?.({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [day?.id]);

  const pick = (id: string) => {
    if (id === day?.id) return;
    setDir(p.days.findIndex((x) => x.id === id) > idx ? " from-r" : " from-l");
    setDayId(id); haptic("tick");
  };
  const moveDay = (from: number, to: number) => {
    if (to < 0 || to >= p.days.length) return;
    dayFlip.snap();
    draft.edit((x) => ({ ...x, days: renumberDays(moveItem(x.days, from, to)) }), true);
    haptic("drop");
  };
  const addDay = () => {
    const nd = newDay(p.days.length + 1);
    draft.edit((x) => ({ ...x, days: [...x.days, nd] }), true);
    setDir(" from-r"); setDayId(nd.id); haptic("press");
  };
  const delDay = (dd: FitDay) => onAsk({
    title: `Delete ${dd.name}${dd.title ? ` (${dd.title})` : ""}?`,
    text: dd.exercises.length ? `Its ${dd.exercises.length} ${dd.exercises.length === 1 ? "exercise goes" : "exercises go"} too. Workouts you logged stay.` : "It has no exercises yet.",
    yes: "Delete day",
    onYes: () => {
      const i = p.days.findIndex((x) => x.id === dd.id);
      const rest = p.days.filter((x) => x.id !== dd.id);
      draft.edit((x) => ({ ...x, days: renumberDays(x.days.filter((y) => y.id !== dd.id)) }), true);
      if (lock?.dayId === dd.id) void savePrefs({ lock: null });
      const ni = indexAfterDelete(i, rest.length);
      setDayId(ni >= 0 ? rest[ni].id : null);
      haptic("reject");
    },
  });
  const moveEx = (from: number, to: number) => {
    if (!day || to < 0 || to >= day.exercises.length) return;
    exFlip.snap();
    editDay(day.id, (x) => ({ ...x, exercises: moveItem(x.exercises, from, to) }), true);
    haptic("drop");
  };
  const doneRename = () => {
    setRenaming(false);
    if (!p.name.trim()) draft.edit((x) => ({ ...x, name: "My program" }), true); else draft.flush();
  };

  const dayItem = (dd: FitDay, i: number, list: boolean) => {
    const isNext = next?.dayId === dd.id, isLock = lock?.dayId === dd.id;
    return (
      <div key={dd.id} ref={dayFlip.ref(dd.id)} className={`fp-day-wrap${list ? " fp-day-li" : ""}`}>
        <button type="button" role="tab" aria-selected={dd.id === day?.id}
          className={`fp-day${dd.id === day?.id ? " on" : ""}${isNext ? " next" : ""}`} onClick={() => pick(dd.id)}>
          <span className="fp-day-n">{dd.name}{isLock && <Icon k="lock" size={15} />}</span>
          <span className="fp-day-t">{dd.title || (dd.exercises.length ? `${dd.exercises.length} ${dd.exercises.length === 1 ? "exercise" : "exercises"}` : "Empty")}</span>
          {list && dd.title && <span className="fp-day-c">{dd.exercises.length} {dd.exercises.length === 1 ? "exercise" : "exercises"}</span>}
          {isNext && <span className="fp-badge">{isLock ? "Repeating" : "Next"}</span>}
        </button>
        {list && editing && (
          <span className="fp-day-tools">
            <button type="button" className="fp-icon-btn" aria-label={`Move ${dd.name} up`} disabled={i === 0} onClick={() => moveDay(i, i - 1)}><Icon k="up" /></button>
            <button type="button" className="fp-icon-btn" aria-label={`Move ${dd.name} down`} disabled={i === p.days.length - 1} onClick={() => moveDay(i, i + 1)}><Icon k="down" /></button>
          </span>
        )}
      </div>
    );
  };

  const header = (
    <header className="fp-top">
      <p className="fp-kicker">{p.source === "sheet" ? "From your trainer's sheet" : "Built by you"} · {programSummary(p)}</p>
      {renaming ? (
        <input className="fp-in fp-name-in" autoFocus value={p.name} aria-label="Program name" maxLength={60}
          onFocus={(e) => e.target.select()}
          onChange={(e) => draft.edit((x) => ({ ...x, name: e.target.value }))}
          onBlur={doneRename} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      ) : (
        <button type="button" className="fp-name" onClick={() => setRenaming(true)} aria-label={`Rename ${p.name}`}>
          <span>{p.name}</span><Icon k="pencil" size={20} />
        </button>
      )}
      <div className="fp-acts">
        <button type="button" className={`fp-act${editing ? " on" : ""}`} aria-pressed={editing} onClick={() => { draft.flush(); setEditing((x) => !x); haptic("tick"); }}>
          <Icon k={editing ? "check" : "edit"} /><span>{editing ? "Done editing" : "Edit days"}</span>
        </button>
        <button type="button" className="fp-act" onClick={() => onPanel({ k: "list" })}><Icon k="swap" /><span>Switch program</span></button>
        <button type="button" className="fp-act" onClick={() => onPanel({ k: "import" })}><Icon k="import" /><span>Import a sheet</span></button>
        <button type="button" className="fp-act" onClick={() => onPanel({ k: "export" })}><Icon k="export" /><span>Export my week</span></button>
      </div>
    </header>
  );

  const dayView = day ? (
    <section className="fp-dayv" aria-label={`${day.name}${day.title ? `, ${day.title}` : ""}`}>
      {editing ? (
        <div className="fp-dayh-edit">
          <div className="fp-row fp-row-2">
            <label className="fp-field"><span className="fp-label">Day name</span>
              <input className="fp-in" value={day.name} maxLength={30} onFocus={(e) => e.target.select()} onBlur={draft.flush}
                onChange={(e) => editDay(day.id, (x) => ({ ...x, name: e.target.value }))} />
            </label>
            <label className="fp-field"><span className="fp-label">Title</span>
              <input className="fp-in" value={day.title ?? ""} placeholder="eg Push" maxLength={30} onBlur={draft.flush}
                onChange={(e) => editDay(day.id, (x) => ({ ...x, title: e.target.value || null }))} />
            </label>
          </div>
          <div className="fp-row">
            {!desk && <button type="button" className="fp-btn" disabled={idx === 0} onClick={() => moveDay(idx, idx - 1)}><Icon k="left" />Earlier</button>}
            {!desk && <button type="button" className="fp-btn" disabled={idx === p.days.length - 1} onClick={() => moveDay(idx, idx + 1)}>Later<Icon k="right" /></button>}
            <button type="button" className="fp-btn fp-danger" onClick={() => delDay(day)}><Icon k="trash" />Delete day</button>
          </div>
        </div>
      ) : (
        <div className="fp-dayh">
          <span className="fp-dayh-n">{day.name}</span>
          <h3 className="fp-dayh-t">{day.title || day.name}</h3>
          {next?.dayId === day.id && (
            <p className="fp-next">{lock?.dayId === day.id ? `Repeating: Fitness opens this day (Week ${next.week}) every time until you turn Repeat off on the Today screen.` : `Next up: Week ${next.week}`}</p>
          )}
        </div>
      )}
      <div key={day.id} className={`fp-exlist${dir}`}>
        {day.exercises.map((ex, i) => (
          <ExCard key={ex.id} cardRef={exFlip.ref(ex.id)} ex={ex} i={i} n={day.exercises.length} prefs={v.prefs} editing={editing} pop={pop === ex.id}
            onOpen={() => onPanel({ k: "ex", dayId: day.id, exId: ex.id })}
            onMove={(to) => moveEx(i, to)} onRemove={() => onRemoveEx(day.id, ex)} />
        ))}
        {!day.exercises.length && <p className="fp-hint fp-hint-box">No exercises yet. Start with the big lifts (compound), then the small ones (isolation).</p>}
      </div>
      <button type="button" className="fp-btn fp-add fp-wide" onClick={() => onPanel({ k: "lib", dayId: day.id })}><Icon k="plus" />Add an exercise to {dayWords(day)}</button>
    </section>
  ) : (
    <section className="fp-dayv">
      <p className="fp-empty-line">No days yet.</p>
      <button type="button" className="fp-btn fp-add fp-wide" onClick={addDay}><Icon k="plus" />Add a day to {p.name}</button>
    </section>
  );

  if (desk) {
    return (
      <div className="fp-cols">
        <aside className="fp-side">
          {header}
          <div className="fp-daylist" role="tablist" aria-label="Days">
            {p.days.map((dd, i) => dayItem(dd, i, true))}
          </div>
          <button type="button" className="fp-btn fp-wide" onClick={addDay}><Icon k="plus" />Add a day to {p.name}</button>
        </aside>
        <main className="fp-main">{dayView}</main>
      </div>
    );
  }
  return (
    <div className="fp-one">
      {header}
      <div ref={chips} className="fp-days" role="tablist" aria-label="Days">
        {p.days.map((dd, i) => dayItem(dd, i, false))}
        <button type="button" className="fp-day fp-day-add" onClick={addDay} aria-label={`Add a day to ${p.name}`}><Icon k="plus" size={22} /><span className="fp-day-t">Add a day</span></button>
      </div>
      {dayView}
    </div>
  );
}

// ---------- one exercise card ----------
function ExCard({ ex, i, n, prefs, editing, pop, cardRef, onOpen, onMove, onRemove }: {
  ex: FitPlanEx; i: number; n: number; prefs: FitPrefs; editing: boolean; pop: boolean; cardRef: (el: HTMLElement | null) => void;
  onOpen: () => void; onMove: (to: number) => void; onRemove: () => void;
}) {
  const kg = weightLine(ex);
  return (
    <article ref={cardRef} className={`fp-card${pop ? " pop" : ""}${editing ? " editing" : ""}`}>
      <ExPic exId={ex.exId} name={ex.name} size={60} className="fp-card-pic" />
      <button type="button" className="fp-card-main" onClick={onOpen} aria-label={`${ex.name}: edit`}>
        <span className="fp-card-top">
          <span className="fp-card-i f-num">{i + 1}</span>
          <span className="fp-card-name">{ex.name}</span>
          {ex.kind && <span className={`fp-kind${ex.kind === "isolation" ? " iso" : ""}`}>{ex.kind === "isolation" ? "Isolation" : "Compound"}</span>}
        </span>
        {ex.sets.length > 0 && <span className="fp-card-target f-num">{targetLine(ex.sets)}</span>}
        <span className="fp-facts">
          <span className={kg ? "" : "fp-soft"}>{kg || (ex.sets.length ? "Weight: pick it in the gym" : "Sets and weight: pick them in the gym")}</span>
          {ex.rir != null && <span>RIR {rirLabel(ex.rir)}</span>}
          <span>Rest {fmtClock(restFor(ex, prefs))}</span>
        </span>
        {ex.note && <span className="fp-card-note">{ex.note}</span>}
      </button>
      {editing && (
        <div className="fp-card-tools">
          <button type="button" className="fp-icon-btn" aria-label={`Move ${ex.name} up`} disabled={i === 0} onClick={() => onMove(i - 1)}><Icon k="up" /></button>
          <button type="button" className="fp-icon-btn" aria-label={`Move ${ex.name} down`} disabled={i === n - 1} onClick={() => onMove(i + 1)}><Icon k="down" /></button>
          <button type="button" className="fp-icon-btn fp-danger" aria-label={`Remove ${ex.name}`} onClick={onRemove}><Icon k="trash" /></button>
        </div>
      )}
    </article>
  );
}

// ---------- editing one exercise ----------
function ExEditor({ ex, prefs, onChange, onRemove, onDone, onFlush }: {
  ex: FitPlanEx; prefs: FitPrefs; onChange: (f: (e: FitPlanEx) => FitPlanEx, now?: boolean) => void;
  onRemove: () => void; onDone: () => void; onFlush: () => void;
}) {
  const [sameReps, setSameReps] = useState(() => allSame(ex.sets, "reps"));
  const [sameKg, setSameKg] = useState(() => allSame(ex.sets, "kg"));
  const lib = libById(ex.exId);
  const like = useMemo(() => (lib ? null : picFor(null, ex.name)?.exercise.name ?? null), [lib, ex.name]);
  const step = ex.step && ex.step > 0 ? ex.step : 2.5;
  const sets = (f: (s: FitPlanEx["sets"]) => FitPlanEx["sets"]) => onChange((e) => ({ ...e, sets: f(e.sets) }));
  const defRest = restFor({ ...ex, rest: null }, { ...prefs, restBy: undefined, restKind: undefined });
  const own = prefs.restBy?.[exKey(ex)];
  const pick = own ? null : prefs.restKind?.[exKey(ex)] ?? null;   // Short or Long, picked in the gym (V1.40)
  const ownSets = prefs.setsBy?.[exKey(ex)];
  const rest = ex.rest ?? null;
  const [custom, setCustom] = useState(() => rest != null && !(REST_CHOICES as readonly number[]).includes(rest));
  const tick = () => haptic("tick");

  return (
    <div className="fp-ed">
      <label className="fp-field">
        <span className="fp-label">Name</span>
        <input className="fp-in fp-in-big" value={ex.name} maxLength={80} onBlur={onFlush}
          onChange={(e) => onChange((x) => ({ ...x, name: e.target.value }))} />
      </label>
      <div className="fp-ed-pic">
        <ExPic exId={ex.exId} name={ex.name} size={104} />
        {lib ? <p className="fp-sub">{lib.muscles.join(", ")} · {lib.equipment}{lib.cue ? ` · ${lib.cue}` : ""}</p>
          : like ? <p className="fp-sub">Picture: looks like {like}. Tap it to see it done.</p> : <p className="fp-sub">No picture for this name yet.</p>}
      </div>

      <div className="fp-block">
        <Seg value={ex.kind ?? "compound"} options={[["compound", "Compound"], ["isolation", "Isolation"]]} label="Kind"
          onChange={(k) => { onChange((x) => ({ ...x, kind: k as FitKind }), true); tick(); }} />
        <p className="fp-hint">{kindHint(ex.kind, prefs)}</p>
      </div>

      <div className="fp-block">
        <div className="fp-block-h"><span className="fp-label">Sets<Info k="sets-reps" /></span></div>
        <div className="fp-big-step">
          <button type="button" className="fp-step-btn" aria-label="One set less" disabled={ex.sets.length <= SETS_MIN} onClick={() => { sets((s) => setCount(s, s.length - 1)); tick(); }}><Icon k="minus" size={28} /></button>
          <span className="fp-big-num f-num" aria-live="polite">{ex.sets.length}</span>
          <button type="button" className="fp-step-btn" aria-label="One set more" disabled={ex.sets.length >= SETS_MAX} onClick={() => { sets((s) => setCount(s, s.length + 1)); tick(); }}><Icon k="plus" size={28} /></button>
        </div>
        {ownSets ? <p className="fp-hint">You set {ownSets} {ownSets === 1 ? "set" : "sets"} for this in the gym, and that is what the gym uses.</p> : null}
      </div>

      <div className="fp-block">
        <div className="fp-block-h">
          <span className="fp-label">Reps</span>
          <Switch on={sameReps} label="Same for all" onChange={(on) => { setSameReps(on); if (on) sets((s) => setAll(s, "reps", s[0]?.reps ?? 10)); tick(); }} />
        </div>
        {sameReps ? (
          <div className="fp-big-step">
            <button type="button" className="fp-step-btn" aria-label="One rep less" onClick={() => { sets((s) => setAll(s, "reps", clampReps((s[0]?.reps ?? 10) - 1))); tick(); }}><Icon k="minus" size={28} /></button>
            <NumField className="fp-big-num" kind="reps" value={ex.sets[0]?.reps ?? null} label="Reps for every set" onBlur={onFlush}
              onChange={(r) => sets((s) => setAll(s, "reps", r))} />
            <button type="button" className="fp-step-btn" aria-label="One rep more" onClick={() => { sets((s) => setAll(s, "reps", clampReps((s[0]?.reps ?? 9) + 1))); tick(); }}><Icon k="plus" size={28} /></button>
          </div>
        ) : (
          <div className="fp-minis">
            {ex.sets.map((s, i) => (
              <div key={i} className="fp-mini">
                <span className="fp-mini-l">Set {i + 1}</span>
                <button type="button" className="fp-mini-btn" aria-label={`Set ${i + 1}: one rep more`} onClick={() => { sets((x) => setAt(x, i, "reps", clampReps((x[i]?.reps ?? 9) + 1))); tick(); }}><Icon k="plus" /></button>
                <NumField className="fp-mini-num" kind="reps" value={s.reps} label={`Set ${i + 1} reps`} onBlur={onFlush} onChange={(r) => sets((x) => setAt(x, i, "reps", r))} />
                <button type="button" className="fp-mini-btn" aria-label={`Set ${i + 1}: one rep less`} onClick={() => { sets((x) => setAt(x, i, "reps", clampReps((x[i]?.reps ?? 11) - 1))); tick(); }}><Icon k="minus" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="fp-block">
        <div className="fp-block-h">
          <span className="fp-label">Weight, kg{ex.perSide ? " each" : ""}</span>
          <Switch on={sameKg} label="Same for all" onChange={(on) => { setSameKg(on); if (on) sets((s) => setAll(s, "kg", s[0]?.kg ?? null)); tick(); }} />
        </div>
        {sameKg ? (
          <div className="fp-big-step">
            <button type="button" className="fp-step-btn" aria-label={`${fmtKg(step)} kg less`} onClick={() => { sets((s) => setAll(s, "kg", stepKg(s[0]?.kg ?? null, -step))); tick(); }}><Icon k="minus" size={28} /></button>
            <NumField className="fp-big-num" kind="kg" value={ex.sets[0]?.kg ?? null} label="Weight for every set, kg" onBlur={onFlush}
              onChange={(k) => sets((s) => setAll(s, "kg", k))} />
            <button type="button" className="fp-step-btn" aria-label={`${fmtKg(step)} kg more`} onClick={() => { sets((s) => setAll(s, "kg", stepKg(s[0]?.kg ?? null, step))); tick(); }}><Icon k="plus" size={28} /></button>
          </div>
        ) : (
          <div className="fp-minis">
            {ex.sets.map((s, i) => (
              <label key={i} className="fp-mini fp-mini-kg">
                <span className="fp-mini-l">Set {i + 1}</span>
                <NumField className="fp-mini-num" kind="kg" value={s.kg} label={`Set ${i + 1} kg`} onBlur={onFlush} onChange={(k) => sets((x) => setAt(x, i, "kg", k))} />
              </label>
            ))}
          </div>
        )}
        <p className="fp-hint">Empty is fine: you can pick the weight in the gym. Plus and minus jump {fmtKg(step)} kg.</p>
        <Switch on={!!ex.perSide} label="Each side" hint="Dumbbells: the weight of one dumbbell, eg 20 kg each"
          onChange={(on) => { onChange((x) => ({ ...x, perSide: on }), true); tick(); }} />
      </div>

      <div className="fp-block">
        <span className="fp-label">Target RIR<Info k="target-rir" /></span>
        <div className="fp-chips" role="radiogroup" aria-label="Target RIR">
          {RIR_VALUES.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={ex.rir === r} className={`fp-chip f-num${ex.rir === r ? " on" : ""}`}
              onClick={() => { onChange((x) => ({ ...x, rir: x.rir === r ? null : r }), true); tick(); }}>{rirLabel(r)}</button>
          ))}
        </div>
        <p className="fp-hint">{ex.rir != null ? `RIR ${rirLabel(ex.rir)}: ${RIR_WORDS[ex.rir]}.` : "No target. RIR is how many more good reps you could have done."}</p>
      </div>

      <div className="fp-block">
        <span className="fp-label">Rest between sets<Info k="rest" /></span>
        <div className="fp-chips fp-chips-rest" role="radiogroup" aria-label="Rest">
          <button type="button" role="radio" aria-checked={rest == null && !custom} className={`fp-chip${rest == null && !custom ? " on" : ""}`}
            onClick={() => { setCustom(false); onChange((x) => ({ ...x, rest: null }), true); tick(); }}>
            Default <small className="f-num">{fmtClock(defRest)}</small>
          </button>
          {REST_CHOICES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={!custom && rest === s} className={`fp-chip f-num${!custom && rest === s ? " on" : ""}`}
              onClick={() => { setCustom(false); onChange((x) => ({ ...x, rest: s }), true); tick(); }}>{fmtClock(s)}</button>
          ))}
          <button type="button" role="radio" aria-checked={custom} className={`fp-chip${custom ? " on" : ""}`}
            onClick={() => { setCustom(true); if (rest == null) onChange((x) => ({ ...x, rest: nudgeRest(defRest, REST_STEP) }), true); tick(); }}>Custom</button>
        </div>
        {custom && (
          <div className="fp-big-step fp-rest-step">
            <button type="button" className="fp-step-btn" aria-label="15 seconds less" onClick={() => { onChange((x) => ({ ...x, rest: nudgeRest(x.rest ?? defRest, -REST_STEP) })); tick(); }}><span className="f-num">-15</span></button>
            <RestNum value={rest ?? defRest} label="Rest between sets" className="fp-big-num" onSave={(n) => { onChange((x) => ({ ...x, rest: n })); tick(); }} />
            <button type="button" className="fp-step-btn" aria-label="15 seconds more" onClick={() => { onChange((x) => ({ ...x, rest: nudgeRest(x.rest ?? defRest, REST_STEP) })); tick(); }}><span className="f-num">+15</span></button>
          </div>
        )}
        <p className="fp-hint">
          {own ? `You set ${restWords(own)} for this in the gym timer, and that is what the timer uses.`
            : pick ? `You picked the ${pick} rest for this in the gym (${restWords(restFor(ex, prefs))}), and that is what the timer uses.`
            : "Big lifts need longer rest. The default comes from compound or isolation."}
        </p>
      </div>

      <label className="fp-field">
        <span className="fp-label">Note</span>
        <textarea className="fp-in fp-note-in" value={ex.note ?? ""} placeholder="eg Seat on 4, slow on the way down" maxLength={300} onBlur={onFlush}
          onChange={(e) => onChange((x) => ({ ...x, note: e.target.value || null }))} />
      </label>

      <div className="fp-row fp-row-2 fp-ed-foot">
        <button type="button" className="fp-btn fp-danger" onClick={onRemove}><Icon k="trash" />Remove</button>
        <button type="button" className="fp-btn fp-primary" onClick={onDone}><Icon k="check" />Done</button>
      </div>
    </div>
  );
}

// ---------- the library search ----------
function LibPicker({ prefs, onPick, onOwn, desk }: { prefs: FitPrefs; onPick: (x: LibEx) => void; onOwn: (name: string, kind: FitKind) => void; desk?: boolean }) {
  const [q, setQ] = useState("");
  const [own, setOwn] = useState<string | null>(null);
  const [kind, setKind] = useState<FitKind>("compound");
  const list = useMemo(() => searchLib(q, 40), [q]);
  const ownName = (own ?? q).trim();
  return (
    <div className="fp-lib">
      <ScanSearch className="fp-in fp-search" value={q} onChange={setQ} autoFocus={desk} label="Search exercises" placeholder="Search, eg press or chest" prefs={prefs} />
      <ul className="fp-lib-list">
        {list.map((x) => (
          <li key={x.id} className="fp-lib-li">
            <ExPic exId={x.id} name={x.name} size={60} className="fp-lib-pic" />
            <button type="button" className="fp-lib-row" onClick={() => onPick(x)}>
              <span className="fp-lib-name">{x.name}</span>
              <span className="fp-lib-meta">{x.muscles.join(", ")} · {x.equipment}</span>
              <span className={`fp-kind${x.kind === "isolation" ? " iso" : ""}`}>{x.kind === "isolation" ? "Isolation" : "Compound"}</span>
              <span className="fp-lib-add" aria-hidden="true"><Icon k="plus" /></span>
            </button>
          </li>
        ))}
      </ul>
      {!list.length && <p className="fp-hint fp-hint-box">Nothing called "{q.trim()}" in the library yet. Add it as your own below.</p>}
      <section className="fp-own" aria-label="Add my own">
        <h3 className="fp-h3">Add my own</h3>
        <input className="fp-in" value={own ?? q} placeholder="Exercise name" maxLength={80} aria-label="Your exercise's name"
          onChange={(e) => setOwn(e.target.value)} />
        <Seg value={kind} options={[["compound", "Compound"], ["isolation", "Isolation"]]} label="Kind" onChange={(k) => { setKind(k as FitKind); haptic("tick"); }} />
        <p className="fp-hint">{kindHint(kind, prefs)}</p>
        <button type="button" className="fp-btn fp-primary fp-wide" disabled={!ownName} onClick={() => onOwn(ownName, kind)}>
          <Icon k="plus" />{ownName ? `Add ${ownName}` : "Type a name first"}
        </button>
      </section>
    </div>
  );
}

// ---------- every program ----------
function ProgramList({ v, activeId, onUse, onNew, onImport, onArchive, onRestore, onDelete }: {
  v: FitView; activeId: string | null; onUse: (id: string) => void; onNew: () => void; onImport: () => void;
  onArchive: (d: Doc<FitProgram>) => void; onRestore: (d: Doc<FitProgram>) => void; onDelete: (d: Doc<FitProgram>) => void;
}) {
  const [showOld, setShowOld] = useState(false);
  const live = v.programs.filter((x) => !x.data.archived), old = v.programs.filter((x) => x.data.archived);
  const row = (doc: Doc<FitProgram>) => {
    const on = doc.id === activeId;
    return (
      <li key={doc.id} className={`fp-prog${on ? " on" : ""}`}>
        <div className="fp-prog-txt">
          <span className="fp-prog-name">{doc.data.name}{on && <span className="fp-badge">Active</span>}</span>
          <span className="fp-sub">{programSummary(doc.data)} · {doc.data.source === "sheet" ? "trainer's sheet" : "built by you"}</span>
        </div>
        <div className="fp-row">
          {doc.data.archived
            ? <button type="button" className="fp-btn fp-primary" onClick={() => onRestore(doc)}>Bring back</button>
            : !on && <button type="button" className="fp-btn fp-primary" onClick={() => onUse(doc.id)}>Use this</button>}
          {!doc.data.archived && <button type="button" className="fp-btn" onClick={() => onArchive(doc)}>Archive</button>}
          <button type="button" className="fp-btn fp-danger" onClick={() => onDelete(doc)}>Delete</button>
        </div>
      </li>
    );
  };
  return (
    <div className="fp-list">
      <div className="fp-row fp-row-2">
        <button type="button" className="fp-btn fp-primary" onClick={onNew}><Icon k="plus" />New program</button>
        <button type="button" className="fp-btn" onClick={onImport}><Icon k="import" />Import sheet</button>
      </div>
      <p className="fp-hint">The active program is the one the gym screen follows.</p>
      <ul className="fp-progs">{live.map(row)}</ul>
      {!live.length && <p className="fp-empty-line">No active program.</p>}
      {old.length > 0 && (
        <>
          <button type="button" className="fp-btn fp-quiet fp-wide" aria-expanded={showOld} onClick={() => setShowOld((x) => !x)}>
            <Icon k={showOld ? "up" : "down"} />Old programs ({old.length})
          </button>
          {showOld && <ul className="fp-progs fp-progs-old">{old.map(row)}</ul>}
        </>
      )}
    </div>
  );
}

// ---------- small parts ----------
/** A panel that slides in from the right over the program (phone: full screen; desk: a side drawer). */
function Panel({ open, title, desk, onClose, children }: { open: boolean; title: string; desk: boolean; onClose: () => void; children: ReactNode }) {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) { setShown(true); return; }
    const t = window.setTimeout(() => setShown(false), 340);
    return () => window.clearTimeout(t);
  }, [open]);
  if (!open && !shown) return null;
  return (
    <div className={`fp-layer${open ? " in" : " out"}${desk ? " fp-layer-desk" : ""}`}>
      <div className="fp-scrim" onClick={onClose} aria-hidden="true" />
      <section className="fp-panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="fp-panel-h">
          <button type="button" className="fp-icon-btn fp-back" onClick={onClose} aria-label="Back"><Icon k="left" size={26} /></button>
          <h2>{title}</h2>
        </header>
        <div className="fp-panel-b">{children}</div>
      </section>
    </div>
  );
}

/** A plain yes or no question with big buttons (deleting, archiving). */
function Confirm({ ask, onClose }: { ask: Ask | null; onClose: () => void }) {
  if (!ask) return null;
  return (
    <div className="fp-ask-layer" role="alertdialog" aria-modal="true" aria-label={ask.title}>
      <div className="fp-scrim" onClick={onClose} aria-hidden="true" />
      <div className="fp-ask">
        <h3>{ask.title}</h3>
        {ask.text && <p>{ask.text}</p>}
        <div className="fp-row fp-row-2">
          <button type="button" className="fp-btn" autoFocus onClick={onClose}>{ask.no ?? "Keep it"}</button>
          <button type="button" className="fp-btn fp-danger-solid" onClick={() => { onClose(); ask.onYes(); }}>{ask.yes}</button>
        </div>
      </div>
    </div>
  );
}

function Switch({ on, label, hint, onChange }: { on: boolean; label: string; hint?: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`fp-switch${on ? " on" : ""}${hint ? " fp-switch-full" : ""}`} onClick={() => onChange(!on)}>
      <span className="fp-switch-txt"><span>{label}</span>{hint && <small>{hint}</small>}</span>
      <span className="fp-switch-track" aria-hidden="true"><span className="fp-switch-knob" /></span>
    </button>
  );
}

function Seg({ value, options, label, onChange }: { value: string; options: [string, string][]; label: string; onChange: (v: string) => void }) {
  return (
    <div className="fp-seg" role="radiogroup" aria-label={label}>
      {options.map(([k, t]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? "on" : ""} onClick={() => value !== k && onChange(k)}>{t}</button>
      ))}
    </div>
  );
}

/** A number box the developer can type in (select all on focus); it shows what he types until he leaves it. */
function NumField({ value, kind, label, className, onChange, onBlur }: {
  value: number | null; kind: "kg" | "reps"; label: string; className?: string; onChange: (n: number | null) => void; onBlur?: () => void;
}) {
  const fmt = (n: number | null) => (n == null ? "" : kind === "kg" ? fmtKg(n) : String(n));
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(fmt(value)); }, [value]);
  return (
    <input className={`fp-num-in f-num ${className ?? ""}`} value={text} aria-label={label}
      inputMode={kind === "kg" ? "decimal" : "numeric"} enterKeyHint="done" placeholder={kind === "kg" ? "kg" : "reps"}
      onFocus={(e) => { focused.current = true; const el = e.target; requestAnimationFrame(() => el.select()); }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = kind === "kg" ? parseKg(t) : parseReps(t);
        if (n != null || !t.trim()) onChange(n);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      onBlur={() => { focused.current = false; setText(fmt(value)); onBlur?.(); }} />
  );
}

const ICONS: Record<string, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  left: <path d="M15 6l-6 6 6 6" />,
  right: <path d="M9 6l6 6-6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6" />,
  pencil: <path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20zM14 7.5l2.5 2.5" />,
  edit: <><path d="M4 6h10M4 12h7M4 18h6" /><path d="M14 19l1-3.5 5-5a1.8 1.8 0 0 1 2.5 2.5l-5 5L14 19z" /></>,
  swap: <path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />,
  import: <path d="M12 3v12M7 10l5 5 5-5M4 17v3h16v-3" />,
  export: <path d="M12 15V3M7 8l5-5 5 5M4 17v3h16v-3" />,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  dumbbell: <path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11" />,
};
function Icon({ k, size = 22 }: { k: keyof typeof ICONS; size?: number }) {
  return (
    <svg className="fp-ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[k]}
    </svg>
  );
}

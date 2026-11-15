// PS Fitness: the gym screen (the developer: "track the sets, track what weight I'm doing ... a nice big screen, very
// readable ... all in like one screen ... a timer between sets ... asked me if it was hard or not").
// No workout open: a start card with today's day, one giant Start (named after the day), Do a different day and Repeat.
// A workout open: one exercise at a time, big (swipe or arrows for the others), its sets with big steppers
// and a big tick. Ticking starts the rest timer and asks "How hard was that?" (RIR) without blocking it.
// The rules live in core/fitness.ts, the saving in store.ts, the timer in rest.ts; this file only draws.
// Motion is CSS (transform and opacity only); the swipe writes one CSS variable while the finger moves.
import { useGos } from "../gos/bridge";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { discardWorkout, exAdd, exEnd, exMove, exPatch, exSetCount, exSwap, finishWorkout, savePlanFrom, savePrefs, setAdd, setExtra, setPatch, setRemove, setsBack, startDay, type FitView } from "./store";
import type { FitTab } from "./FitnessApp";
import { rest, useKeepAwake, useRest, useRestLeft, type RestNow } from "./rest";
import { LIB, libById, searchLib, type LibEx } from "./lib";
import { ExPic, picCardOpen } from "./ExPic";
import { CamIcon, newExFor, ScanPanel, ScanSearch, scanOn } from "./Scan";
import { Overlay } from "./Overlay";
import { Info } from "./Info";
import { CommentBox, CommentBtn, CommentLine } from "./SetComment";
import {
  bestsInWorkout, clampRest, currentSpot, dayLabel, exKey, fmtClock, fmtKg, lastTime, liveSets, REST_STEP, restDefault, restFor,
  restLong, restShort, RIR_VALUES, RIR_WORDS, rirLabel, setLine, setsFor, SETS_HI, SETS_LO, targetLine, weekStats,
  type BestKind, type FitLogEx, type FitPrefs, type FitProgram, type FitSet, type FitWorkout, type RestPick,
} from "../core/fitness";
import { todayISO } from "../ui/kit";
import { haptic } from "../gos/bridge";
import { RestNum } from "./RestNum";
import {
  exDone, extrasDue, extrasPreview, firstOpen, fmtDur, fmtVol, lastLine, liveHintFor, liveList, parseNum, preHint, progress, restOwed, stepValue, summary, targetText, weekDots,
  yourExercises, type Summary, type YourEx,
} from "./gym-logic";
import { dayMinutes, dayWords } from "./nav-logic";
import { ActivityRow } from "./Activity";
import { PeopleIcon, SquadChip } from "./Squad";
import { useGymSquad } from "../squad/gymclient";
import "./gym.css";

type Dated = { id: string; data: FitWorkout };
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const BEST_WORDS: Record<BestKind, string> = { kg: "Heaviest yet", e1rm: "Strongest set yet", reps: "Most reps at this weight" };

export function Gym({ v, desk, onOpen, onSleep, pick }: { v: FitView; desk?: boolean; onOpen?: (t: FitTab) => void; onSleep?: () => void; pick?: boolean }) {
  useKeepAwake(!!v.open);
  const [done, setDone] = useState<{ s: Summary; label: string } | null>(null);
  return (
    <div className={cx("fg", desk && "fg-desk")}>
      {!v.ready ? null : v.open
        ? <Live key={v.open.id} v={v} onFinished={(s, label) => setDone({ s, label })} />
        : <StartCard v={v} desk={!!desk} onOpen={onOpen} onSleep={onSleep ?? (onOpen ? () => onOpen("sleep") : undefined)} pickFirst={!!pick} />}
      {done && <SummaryCard s={done.s} label={done.label} onClose={() => setDone(null)} />}
    </div>
  );
}

// ======================================================================================================
// No workout open: the start card
// ======================================================================================================
function StartCard({ v, desk, onOpen, onSleep, pickFirst }: { v: FitView; desk: boolean; onOpen?: (t: FitTab) => void; onSleep?: () => void; pickFirst?: boolean }) {
  // V1.43: the week, Sleep, the run row and the Program, History, Squad and Settings icons moved to Fitness's home and
  // its menu (FitnessApp.tsx). This screen is now only the day: its exercises, Start, and the other ways to start.
  const [pick, setPick] = useState(!!pickFirst);   // Home's "Do a different day" opens straight on the days
  const [busy, setBusy] = useState(false);
  const [lockNow, setLockNow] = useState<boolean | null>(null);
  const p = v.program, next = v.next;
  const day = p && next ? p.data.days[next.dayIndex] ?? null : null;
  const locked = lockNow ?? !!next?.locked;
  useEffect(() => { if (lockNow != null && lockNow === !!next?.locked) setLockNow(null); }, [lockNow, next?.locked]);

  const go = (dayId?: string) => {
    if (busy) return;
    setBusy(true);
    haptic("press");
    startDay(dayId === "free" ? { free: true } : dayId ? { dayId } : {}).catch(() => setBusy(false));
  };
  const toggleLock = () => {
    if (!p || !next) return;
    haptic("press");
    setLockNow(!locked);
    void savePrefs({ lock: locked ? null : { programId: p.id, dayId: next.dayId } });
  };

  // No program yet (or one with no days): build one, or just train.
  if (!p || !next || !day) {
    return (
      <>
        <div className="fg-scroll">
          <div className="fg-empty">
            <span className="fg-empty-i" aria-hidden="true"><DumbbellIcon size={44} /></span>
            <h1 className="fg-hero">{p ? "This program has no days yet" : "Ready when you are"}</h1>
            <p className="fg-lead">Add your trainer's plan once. Each visit then opens on the right day, with the weights filled in.<Info k="program" /></p>
            {!onOpen && <p className="fg-muted">Build it in the Program tab.</p>}
          </div>
        </div>
        <div className="fg-dock">
          {onOpen && <button type="button" className="fg-go" onClick={() => onOpen("plan")}>Build my program</button>}
          <button type="button" className={onOpen ? "fg-second" : "fg-go"} onClick={() => go("free")} disabled={busy}>Free workout</button>
        </div>
      </>
    );
  }

  const sets = day.exercises.reduce((n, e) => n + e.sets.length, 0);
  return (
    <>
      <div className="fg-scroll">
        <section className="fg-start" aria-label="Next workout">
          <p className="fg-kicker">
            {locked ? <span className="fg-lockbadge"><LockIcon size={15} /> Repeating this day</span> : "Today's workout"}
          </p>
          <h1 className="fg-hero f-num">{dayLabel(next.week, day.name)}</h1>
          {day.title && <p className="fg-title">{day.title}</p>}
          <p className="fg-muted">{!day.exercises.length ? "No exercises yet: add them as you go" : `${day.exercises.length} ${day.exercises.length === 1 ? "exercise" : "exercises"}${sets ? ` · ${sets} sets` : ""} · about ${dayMinutes(day, v.prefs)} min`}</p>
          <ol className="fg-slist">
            {day.exercises.map((e) => (
              <li key={e.id}>
                <ExPic exId={e.exId} name={e.name} size={48} className="fg-slist-pic" />
                <span className="fg-slist-tx">
                  <span className="fg-slist-n">{e.name}</span>
                  <span className="fg-slist-t">{[targetLine(e.sets), e.rir != null ? `RIR ${rirLabel(e.rir)}` : ""].filter(Boolean).join(" · ")}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      <div className="fg-dock">
        <button type="button" className={cx("fg-go fg-go-start", busy && "busy")} onClick={() => go()} disabled={busy}>
          <PlayIcon /> Start {dayWords(day)}
        </button>
        <div className="fg-row2">
          <button type="button" className="fg-second" onClick={() => setPick(true)}>Do a different day</button>
          <button type="button" className={cx("fg-second fg-lock", locked && "on")} role="switch" aria-checked={locked} onClick={toggleLock}>
            <LockIcon size={18} /> {locked ? "Repeat is on" : `Repeat ${day.name}`}
          </button>
        </div>
        <p className="fg-note">{locked
          ? `Fitness opens ${day.name} every time, even after you train it, until you tap Repeat again.`
          : `Repeat ${day.name}: open on this day again next time instead of moving on to the next day.`}<Info k="repeat-day" /></p>
        <button type="button" className="fg-second fg-free" onClick={() => go("free")} disabled={busy}>
          <PlusIcon size={20} /> Start a free workout
        </button>
      </div>
      {pick && (
        <Overlay label="Do a different day" onClose={() => setPick(false)}>
          {(close) => (
            <div className="fg-pick">
              <h3 className="fg-h3">Do a different day</h3>
              <p className="fg-muted">Tap a day to start it now. Your usual order carries on after it.</p>
              {p.data.days.map((d) => (
                <button key={d.id} type="button" className={cx("fg-pick-d", d.id === next.dayId && "on")} onClick={() => { close(); go(d.id); }}>
                  <span className="fg-pick-n">{d.name}{d.title ? ` · ${d.title}` : ""}{d.id === next.dayId && <em>Next in order</em>}</span>
                  <span className="fg-pick-x">{d.exercises.map((e) => e.name).join(", ") || "No exercises yet"}</span>
                </button>
              ))}
              <button type="button" className="fg-pick-d" onClick={() => { close(); go("free"); }}>
                <span className="fg-pick-n">Start a free workout</span>
                <span className="fg-pick-x">Not in the program: add exercises as you go. The next day stays as it is.</span>
              </button>
            </div>
          )}
        </Overlay>
      )}
    </>
  );
}

// ======================================================================================================
// A workout open: one screen
// ======================================================================================================
type Panel = { k: "add"; swap?: string } | { k: "scan" } | { k: "finish" } | { k: "rest" } | { k: "menu"; exId: string } | null;
interface Ask { exId: string; setId: string; fromTick: boolean }

interface Ctx {
  id: string;
  workouts: Dated[];
  prefs: FitPrefs;
  focus: Record<string, string>;
  bests: Map<string, BestKind>;
  party: ReadonlySet<string>;
  popped: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
  askId: string | null;
  tick: (e: FitLogEx, s: FitSet) => void;
  untick: (e: FitLogEx, s: FitSet) => void;
  ask: (e: FitLogEx, s: FitSet) => void;
  focusSet: (e: FitLogEx, s: FitSet) => void;
  hide: (k: string) => void;
  removeSet: (e: FitLogEx, s: FitSet) => void;
  endEx: (e: FitLogEx) => void;
  menu: (e: FitLogEx) => void;
  addEx: () => void;
  /** Gym scan (V1.59): null when it is off or this device cannot read a label. */
  scan: (() => void) | null;
  extra: (e: FitLogEx, drop: boolean, step: number) => void;
}

function Live({ v, onFinished }: { v: FitView; onFinished: (s: Summary, label: string) => void }) {
  const doc = v.open!;
  const id = doc.id, w = doc.data;
  const list = useMemo(() => liveList(w), [w]);
  const r = useRest();
  const online = useGos().online;   // PS GOS knows; elsewhere always true
  const spot = currentSpot(w);
  const spotId = spot ? w.exercises[spot.exIndex]?.id ?? null : null;
  const [pinned, setPinned] = useState<string | null>(null);
  const curId = pinned && list.some((e) => e.id === pinned) ? pinned : spotId ?? list[list.length - 1]?.id ?? null;
  const idx = Math.max(0, list.findIndex((e) => e.id === curId));
  const cur = list[idx] ?? null;
  const prog = progress(w);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [focus, setFocus] = useState<Record<string, string>>({});
  const [popped, setPopped] = useState<ReadonlySet<string>>(new Set());
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [panel, setPanel] = useState<Panel>(null);
  const [undo, setUndo] = useState<{ exId: string; ids: string[]; text: string } | null>(null);

  // Timers that die with the screen.
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);
  const later = (f: () => void, ms: number) => { timers.current.push(window.setTimeout(f, ms)); };

  // The phone buzzes when the rest runs out (the shell also buzzes on the lock screen).
  useEffect(() => rest.onEnd(() => haptic("drop")), []);

  // New bests: every set that beats history, and a one time celebration when one first appears.
  const bests = useMemo(() => {
    const m = new Map<string, BestKind>();
    for (const e of list) for (const [k, b] of bestsInWorkout(e, id, v.workouts)) m.set(k, b);
    return m;
  }, [list, id, v.workouts]);
  const seen = useRef<Set<string> | null>(null);
  const [party, setParty] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!seen.current) { seen.current = new Set(bests.keys()); return; }   // the ones already there at open: no party
    const fresh = [...bests.keys()].filter((k) => !seen.current!.has(k));
    if (!fresh.length) return;
    fresh.forEach((k) => seen.current!.add(k));
    setParty((p) => new Set([...p, ...fresh]));
    haptic("drop");
    later(() => setParty((p) => { const n = new Set(p); fresh.forEach((k) => n.delete(k)); return n; }), 1900);
  }, [bests]);

  // A new exercise was added: slide to it once it lands.
  const jump = useRef<number | null>(null);
  useEffect(() => {
    if (jump.current != null && list.length > jump.current) { setPinned(list[list.length - 1].id); jump.current = null; }
  }, [list]);

  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 5000);
    return () => clearTimeout(t);
  }, [undo]);

  // A new exercise on screen: back to its name at the top (smoothly, only when scrolled down).
  const scroller = useRef<HTMLDivElement>(null);
  const shownId = useRef(curId);
  useEffect(() => {
    if (shownId.current === curId) return;
    shownId.current = curId;
    const el = scroller.current;
    if (el && el.scrollTop > 40) el.scrollTo({ top: 0, behavior: "smooth" });
  }, [curId]);
  // The set the developer is on never hides under the dock: when the dock grows (the rest card, "Rest over", the RIR
  // question) the scroll area shrinks, so its big row is brought back into view (Android run, 31 Oct 2026).
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const keep = () => {
      raf = 0;
      const row = el.querySelector<HTMLElement>(".fg-page.cur .fg-set.big");
      if (!row) return;
      const box = el.getBoundingClientRect(), b = row.getBoundingClientRect();
      const over = b.bottom - (box.bottom - 8);
      if (over > 0 && b.top - over >= box.top) el.scrollBy({ top: over, behavior: "smooth" });
    };
    const ro = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(keep); });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  // The big timer closes itself when the rest ends or is cancelled.
  useEffect(() => { if (panel?.k === "rest" && (!r || r.over)) setPanel(null); }, [panel, r]);

  const goto = (i: number) => {
    const e = list[Math.max(0, Math.min(list.length - 1, i))];
    if (e && e.id !== curId) { haptic("press"); setPinned(e.id); }
  };

  const tick = (e: FitLogEx, s: FitSet) => {
    const sets = liveSets(e);
    const n = sets.findIndex((x) => x.id === s.id) + 1;
    haptic("tick");
    void setPatch(id, e.id, s.id, { done: true });   // saved on this device first, then pushed (store.ts)
    const more = list.some((x) => liveSets(x).some((y) => !y.done && y.id !== s.id));
    // A drop set (V1.29) never starts a rest: the developer goes straight on.
    if (more && !s.drop) rest.start({ sec: restFor(e, v.prefs), exercise: e.name, set: n, of: sets.length, exId: e.id, setId: s.id });
    else rest.cancel();   // the last set of the day, or a drop set: nothing to rest for
    setPinned(e.id);
    setFocus((f) => { const o = { ...f }; delete o[e.id]; return o; });
    setPopped((p) => new Set(p).add(s.id));
    later(() => setPopped((p) => { const q = new Set(p); q.delete(s.id); return q; }), 800);
    setAsk({ exId: e.id, setId: s.id, fromTick: true });
  };
  const untick = (e: FitLogEx, s: FitSet) => {
    haptic("press");
    void setPatch(id, e.id, s.id, { done: false });
    if (r && r.setId === s.id) rest.cancel();
    if (ask?.setId === s.id) setAsk(null);
  };
  const pickRir = (rir: number) => {
    if (!ask) return;
    haptic("press");
    void setPatch(id, ask.exId, ask.setId, { rir });
  };
  // V1.29: a complete exercise stays on screen after its last set, so Add set and Drop set can be picked; the
  // dock's "Next: ..." button (or a chip, or a swipe) moves on.
  const closeAsk = () => setAsk(null);
  // Add set: same kg and reps as the last set, and the normal rest (counted from when that set was done, so a rest
  // already running is left alone). Drop set: about 20 percent lighter, straight away, so any rest is stopped.
  const extra = (e: FitLogEx, drop: boolean, step: number) => {
    haptic("press");
    const sets = liveSets(e), last = sets[sets.length - 1];
    setExtra(id, e.id, drop, step);
    setPinned(e.id);
    setFocus((f) => { const o = { ...f }; delete o[e.id]; return o; });
    setAsk(null);
    if (drop) { if (r) rest.cancel(); return; }
    if (!last || (r && r.setId === last.id)) return;
    const owed = restOwed(last.doneAt, restFor(e, v.prefs), Date.now());
    if (owed > 0) rest.start({ sec: owed, exercise: e.name, set: sets.length, of: sets.length + 1, exId: e.id, setId: last.id });
  };

  const ctx: Ctx = {
    id, workouts: v.workouts, prefs: v.prefs, focus, bests, party, popped, hidden, askId: ask?.setId ?? null,
    tick, untick,
    ask: (e, s) => { haptic("press"); setAsk({ exId: e.id, setId: s.id, fromTick: false }); },
    focusSet: (e, s) => { rest.clear(); setFocus((f) => ({ ...f, [e.id]: s.id })); },
    hide: (k) => setHidden((h) => new Set(h).add(k)),
    removeSet: (e, s) => { haptic("press"); void setRemove(id, e.id, s.id); setUndo({ exId: e.id, ids: [s.id], text: "Set removed" }); },
    // Finish exercise (V1.40): the sets done count as normal, the rest are left out, no questions asked. The rest
    // already running carries on into the next exercise; with nothing left anywhere it stops.
    endEx: (e) => {
      const open = liveSets(e).filter((s) => !s.done).map((s) => s.id);
      const done = liveSets(e).length - open.length;
      if (!open.length || !done) return;
      haptic("drop");
      void exEnd(id, e.id);
      setPinned(null);
      setFocus((f) => { const o = { ...f }; delete o[e.id]; return o; });
      if (ask?.exId === e.id && open.includes(ask.setId)) setAsk(null);
      const left = list.some((x) => x.id !== e.id && liveSets(x).some((y) => !y.done));
      if (!left && r) rest.cancel();
      setUndo({ exId: e.id, ids: open, text: `${e.name}: done with ${done} ${done === 1 ? "set" : "sets"}` });
    },
    menu: (e) => setPanel({ k: "menu", exId: e.id }),
    addEx: () => setPanel({ k: "add" }),
    scan: scanOn(v.prefs) ? () => { haptic("press"); setPanel({ k: "scan" }); } : null,
    extra,
  };

  const finish = () => {
    const s = summary(w, id, v.workouts, Date.now());
    rest.cancel();
    haptic("drop");
    void finishWorkout(id);
    onFinished(s, label);
  };
  const discard = () => { rest.cancel(); haptic("reject"); void discardWorkout(id); };
  const [planName, setPlanName] = useState(() => `My workout ${new Date(w.startedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`);

  const dayTitle = v.programs.find((p) => p.id === w.programId)?.data.days.find((d) => d.id === w.dayId)?.title ?? null;
  const label = w.dayId ? dayLabel(w.week, w.dayName) : w.dayName;
  const askEx = ask ? w.exercises.find((e) => e.id === ask.exId) ?? null : null;
  const askSet = askEx ? liveSets(askEx).find((s) => s.id === ask!.setId) ?? null : null;
  const nextOpen = list.find((e, i) => i > idx && !exDone(e)) ?? list.find((e) => e.id !== cur?.id && !exDone(e)) ?? null;
  const frac = prog.total ? prog.done / prog.total : 0;
  const menuEx = panel?.k === "menu" ? list.find((e) => e.id === panel.exId) ?? null : null;

  return (
    <>
      <header className="fg-live-h">
        <div className="fg-live-row">
          <div className="fg-live-day">
            <span>{label}</span>
            {dayTitle && <small>{dayTitle}</small>}
            {!online && <small className="fg-offline">No signal: saved on the phone, syncs later</small>}
          </div>
          <span className="fg-live-count"><b className="f-num">{prog.done}</b> of {prog.total} sets</span>
          <button type="button" className="fg-finish-s" onClick={() => setPanel({ k: "finish" })}>Finish</button>
        </div>
        <div className="fg-prog" role="progressbar" aria-label="Sets done" aria-valuemin={0} aria-valuemax={prog.total} aria-valuenow={prog.done}>
          <i style={{ transform: `scaleX(${frac})` }} />
        </div>
      </header>

      <div className="fg-scroll fg-scroll-live" ref={scroller}>
        {list.length > 0 && (
          <nav className="fg-chips" aria-label="Exercises">
            <button type="button" className="fg-arrow" onClick={() => goto(idx - 1)} disabled={idx === 0} aria-label="Previous exercise"><ChevronIcon dir="l" /></button>
            <div className="fg-chips-in">
              {list.map((e, i) => (
                <button key={e.id} type="button" className={cx("fg-chip", i === idx && "on", exDone(e) && "done")} onClick={() => goto(i)}
                  aria-label={`${e.name}${exDone(e) ? ", done" : ""}`} aria-current={i === idx ? "true" : undefined}>
                  {exDone(e) ? <TickIcon size={20} /> : <span className="f-num">{i + 1}</span>}
                </button>
              ))}
              <button type="button" className="fg-chip add" onClick={() => setPanel({ k: "add" })} aria-label="Add an exercise"><PlusIcon size={20} /></button>
              {ctx.scan && <button type="button" className="fg-chip add" onClick={ctx.scan} aria-label="Scan a machine"><CamIcon size={20} /></button>}
            </div>
            <button type="button" className="fg-arrow" onClick={() => goto(idx + 1)} disabled={idx >= list.length - 1} aria-label="Next exercise"><ChevronIcon dir="r" /></button>
          </nav>
        )}

        {list.length ? (
          <Pager idx={idx} ids={list.map((e) => e.id)} onGo={goto}>
            {list.map((e, i) => <ExPage key={e.id} e={e} i={i} n={list.length} ctx={ctx} />)}
          </Pager>
        ) : (
          <div className="fg-empty">
            <h2 className="fg-hero">No exercises yet</h2>
            <p className="fg-lead">Add the first one: search by name or by muscle.</p>
            {scanOn(v.prefs) && <button type="button" className="fg-second fg-scan-go" onClick={() => { haptic("press"); setPanel({ k: "scan" }); }}><CamIcon /> Scan a machine</button>}
          </div>
        )}
      </div>

      <div className="fg-dock">
        {undo && (
          <div className="fg-toast" role="status">
            <span>{undo.text}</span>
            <button type="button" onClick={() => { haptic("press"); void setsBack(id, undo.exId, undo.ids); setPinned(undo.exId); setUndo(null); }}>Undo</button>
          </div>
        )}
        {r && <RestDock r={r} onBig={() => setPanel({ k: "rest" })} />}
        {askEx && askSet ? (
          <RirPanel key={askSet.id} ex={askEx} set={askSet} n={liveSets(askEx).indexOf(askSet) + 1} onPick={pickRir} onClose={closeAsk} />
        ) : !list.length ? (
          <button type="button" className="fg-go" onClick={() => setPanel({ k: "add" })}><PlusIcon /> Add an exercise</button>
        ) : !spot ? (
          <button type="button" className="fg-go fg-go-finish" onClick={() => setPanel({ k: "finish" })}><TickIcon /> Finish workout</button>
        ) : cur && exDone(cur) && nextOpen ? (
          <button type="button" className="fg-go" onClick={() => goto(list.indexOf(nextOpen))}>Next: {nextOpen.name} <ChevronIcon dir="r" /></button>
        ) : null}
      </div>

      {panel?.k === "rest" && r && (
        <Overlay label="Rest timer" kind="rest" onClose={() => setPanel(null)}>
          {(close) => <RestBig r={r} prefs={v.prefs} onClose={close} />}
        </Overlay>
      )}
      {panel?.k === "add" && (
        <Overlay label={panel.swap ? "Swap exercise" : "Add an exercise"} kind="tall" onClose={() => setPanel(null)}>
          {(close) => {
            const swap = panel.swap ? list.find((e) => e.id === panel.swap) ?? null : null;
            return <AddPanel workouts={v.workouts} programs={v.programs} prefs={v.prefs} swapFor={swap?.name ?? null} close={close}
              onScan={!swap && scanOn(v.prefs) ? () => setPanel({ k: "scan" }) : undefined} onAdd={(ex) => {
              if (swap) { if (r?.exId === swap.id) rest.cancel(); setPinned(null); void exSwap(id, swap.id, ex); return; }
              jump.current = list.length; void exAdd(id, ex);
            }} />;
          }}
        </Overlay>
      )}
      {panel?.k === "scan" && (
        <Overlay label="Scan a machine" kind="tall" onClose={() => setPanel(null)}>
          {(close) => <ScanPanel workouts={v.workouts} programs={v.programs} prefs={v.prefs} close={close} onAdd={(ex) => { jump.current = list.length; void exAdd(id, ex); }} />}
        </Overlay>
      )}
      {panel?.k === "menu" && menuEx && (
        <Overlay label={menuEx.name} onClose={() => setPanel(null)}>
          {(close) => (
            <div className="fg-confirm">
              <h3 className="fg-h3">{menuEx.name}</h3>
              <div className="fg-row2">
                <button type="button" className="fg-second" disabled={list[0]?.id === menuEx.id} onClick={() => { haptic("press"); setPinned(menuEx.id); void exMove(id, menuEx.id, -1); }}>
                  <ChevronIcon dir="l" /> Earlier
                </button>
                <button type="button" className="fg-second" disabled={list[list.length - 1]?.id === menuEx.id} onClick={() => { haptic("press"); setPinned(menuEx.id); void exMove(id, menuEx.id, 1); }}>
                  Later <ChevronIcon dir="r" />
                </button>
              </div>
              {!liveSets(menuEx).some((s) => s.done) && (
                <button type="button" className="fg-second" onClick={() => setPanel({ k: "add", swap: menuEx.id })}>Swap for another exercise</button>
              )}
              <p className="fg-muted">Not doing this one today? Take it out of today only. Your program keeps it.</p>
              <button type="button" className="fg-go fg-danger" onClick={() => { haptic("reject"); void exPatch(id, menuEx.id, { removed: true }); setPinned(null); if (r?.exId === menuEx.id) rest.cancel(); close(); }}>Remove from today</button>
              <button type="button" className="fg-second" onClick={close}>Keep it</button>
            </div>
          )}
        </Overlay>
      )}
      {panel?.k === "finish" && (
        <Overlay label="Finish workout" onClose={() => setPanel(null)}>
          {(close) => prog.done > 0 ? (
            <div className="fg-confirm">
              <h3 className="fg-h3">Finish workout?</h3>
              <p className="fg-confirm-n"><b className="f-num">{prog.done}</b> {prog.done === 1 ? "set" : "sets"} done</p>
              {prog.total > prog.done && <p className="fg-muted">{prog.total - prog.done} not ticked. They stay out of your log.</p>}
              <button type="button" className="fg-go" onClick={() => { finish(); close(); }}><TickIcon /> Finish</button>
              {!w.programId && (
                <div className="fg-saveplan">
                  <input className="fg-search" value={planName} maxLength={80} onChange={(e) => setPlanName(e.currentTarget.value)} aria-label="Plan name" />
                  <button type="button" className="fg-second" onClick={() => { void savePlanFrom(id, planName); finish(); close(); }}>Finish and save as a plan</button>
                  <p className="fg-note">Only if you want to do this again. It never changes your current program.</p>
                </div>
              )}
              <button type="button" className="fg-second" onClick={close}>Keep going</button>
            </div>
          ) : (
            <div className="fg-confirm">
              <h3 className="fg-h3">Nothing ticked yet</h3>
              <p className="fg-muted">Throw this workout away? Nothing has been logged.</p>
              <button type="button" className="fg-go fg-danger" onClick={() => { discard(); close(); }}>Discard</button>
              <button type="button" className="fg-second" onClick={close}>Keep going</button>
            </div>
          )}
        </Overlay>
      )}
    </>
  );
}

// ---------- the swipe between exercises ----------
// Every page sits side by side with transform translateX; the one on screen is in the flow (its height is
// the pager's), the others float. While a finger drags, only a CSS variable changes (no React render).
function Pager({ idx, ids, onGo, children }: { idx: number; ids: string[]; onGo: (i: number) => void; children: ReactNode[] }) {
  const count = ids.length;
  const ref = useRef<HTMLDivElement>(null);
  const muteClick = useRef(0);
  const onDown = (ev: RPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || ev.pointerType === "mouse" || count < 2) return;
    const st = { x: ev.clientX, y: ev.clientY, lock: 0 as 0 | 1 | 2, w: el.offsetWidth || 1, id: ev.pointerId, lx: ev.clientX, lt: performance.now(), vel: 0, d: 0 };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== st.id) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (st.lock === 0) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) { st.lock = 1; el.classList.add("drag"); }
        else if (Math.abs(dy) > 10) { st.lock = 2; end(); return; }
        else return;
      }
      const t = performance.now();
      st.vel = (e.clientX - st.lx) / Math.max(1, t - st.lt);
      st.lx = e.clientX; st.lt = t;
      const edge = (idx === 0 && dx > 0) || (idx === count - 1 && dx < 0);
      st.d = edge ? dx * 0.3 : dx;
      el.style.setProperty("--fg-dx", `${st.d}px`);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== st.id) return;
      end();
      if (st.lock !== 1) return;
      muteClick.current = performance.now() + 400;
      const far = Math.abs(st.d) > st.w * 0.22, fast = Math.abs(st.vel) > 0.45;
      const dir = (far ? st.d : st.vel) < 0 ? 1 : -1;
      if ((far || fast) && idx + dir >= 0 && idx + dir < count) onGo(idx + dir);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      el.classList.remove("drag");
      el.style.removeProperty("--fg-dx");
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return (
    <div className="fg-pager" ref={ref} onPointerDown={onDown}
      onClickCapture={(e) => { if (performance.now() < muteClick.current) { e.stopPropagation(); e.preventDefault(); } }}>
      {children.map((c, i) => (
        <section key={ids[i] ?? i} className={cx("fg-page", i === idx && "cur")} style={{ "--fg-off": i - idx } as CSSProperties}
          aria-hidden={i !== idx ? true : undefined} inert={i !== idx}>
          {c}
        </section>
      ))}
    </div>
  );
}

// ---------- one exercise ----------
function ExPage({ e, i, n, ctx }: { e: FitLogEx; i: number; n: number; ctx: Ctx }) {
  const lib = libById(e.exId);
  const step = e.step ?? lib?.step ?? 2.5;
  const sets = liveSets(e);
  const open = firstOpen(e);
  const doneN = sets.filter((s) => s.done).length;
  const fid = ctx.focus[e.id];
  let fi = fid ? sets.findIndex((s) => s.id === fid) : -1;
  if (fi < 0) fi = open;
  const last = useMemo(() => lastTime(exKey(e), ctx.workouts, ctx.id), [e.exId, e.name, ctx.workouts, ctx.id]);
  const pre = useMemo(() => preHint(e, ctx.workouts, ctx.id, step), [e, ctx.workouts, ctx.id, step]);
  const live = liveHintFor(e);
  const tt = targetText(e);
  const removable = [...sets].reverse().find((s) => !s.done);

  return (
    <div className="fg-ex">
      <header className="fg-ex-h">
        <p className="fg-ex-of">Exercise {i + 1} of {n}</p>
        <div className="fg-ex-title">
          <h2 className="fg-ex-name">{e.name}</h2>
          <ExPic exId={e.exId} name={e.name} size={76} className="fg-ex-pic" />
        </div>
        {e.note && <p className="fg-exnote">{e.note}</p>}
        {lib?.cue && <p className="fg-cue">{lib.cue}</p>}
        <div className="fg-ex-meta">
          {tt && <span className="fg-target"><small>Plan</small> {tt}</span>}
          {e.perSide && <span className="fg-tag">kg each</span>}
        </div>
        <div className="fg-ex-tools">
          <SetsChip ex={e} prefs={ctx.prefs} wid={ctx.id} />
          <RestChip ex={e} prefs={ctx.prefs} />
          <SquadChip workouts={ctx.workouts} ex={e} />
          <button type="button" className="fg-more" onClick={() => ctx.menu(e)} aria-label={`More for ${e.name}`}><MoreIcon /></button>
        </div>
      </header>

      {pre && !ctx.hidden.has(`pre:${e.id}`) && (
        <HintPill text={pre.text} onApply={() => {
          haptic("press");
          sets.filter((s) => !s.done).forEach((s) => { void setPatch(ctx.id, e.id, s.id, { kg: pre.kg }); });
          ctx.hide(`pre:${e.id}`);
        }} onHide={() => ctx.hide(`pre:${e.id}`)} />
      )}
      {live && !ctx.hidden.has(`live:${live.setId}`) && ctx.askId !== live.setId && (
        <HintPill text={`${live.hint.text} Try ${fmtKg(live.hint.kg)} kg`} onApply={() => {
          haptic("press");
          void setPatch(ctx.id, e.id, live.nextId, { kg: live.hint.kg });
          ctx.hide(`live:${live.setId}`);
        }} onHide={() => ctx.hide(`live:${live.setId}`)} />
      )}

      <ol className="fg-sets">
        {sets.map((s, j) => (
          <SetRow key={s.id} e={e} s={s} j={j} total={sets.length} big={j === fi} current={j === open} step={step}
            lastText={lastLine(last, j)} ctx={ctx} />
        ))}
      </ol>

      {extrasDue(e) ? <Extras e={e} step={step} ctx={ctx} /> : (
        <div className="fg-set-tools">
          <button type="button" className="fg-second" onClick={() => { haptic("press"); void setAdd(ctx.id, e.id); }}><PlusIcon size={20} /> Add set</button>
          {removable && sets.length > 1 && (
            <button type="button" className="fg-second" onClick={() => ctx.removeSet(e, removable)}><MinusIcon size={20} /> Remove set</button>
          )}
          {doneN > 0 && (
            <button type="button" className="fg-second fg-endex" onClick={() => ctx.endEx(e)}>
              <TickIcon size={20} /> Finish exercise<small>Done with {doneN} of {sets.length}. The rest are left out.</small>
            </button>
          )}
          {doneN > 0 && <Info k="finish-exercise" className="fg-endex-i" />}
        </div>
      )}
      {ctx.scan ? (
        <div className="fg-add-row">
          <button type="button" className="fg-add-ex" onClick={ctx.addEx}><PlusIcon size={20} /> Exercise</button>
          <button type="button" className="fg-add-ex" onClick={ctx.scan}><CamIcon size={20} /> Scan</button>
        </div>
      ) : <button type="button" className="fg-add-ex" onClick={ctx.addEx}><PlusIcon size={20} /> Exercise</button>}
    </div>
  );
}

// ---------- after the last set: one more, or a drop set (V1.29, unlimited) ----------
function Extras({ e, step, ctx }: { e: FitLogEx; step: number; ctx: Ctx }) {
  const p = extrasPreview(e, step);
  const unit = e.perSide ? " kg each" : " kg";
  const kg = (n: number | null) => (n == null ? "Same weight" : `${fmtKg(n)}${unit}`);
  return (
    <div className="fg-extras" role="group" aria-label="One more set">
      <p className="fg-extras-h">All {liveSets(e).length} sets done. One more?<Info k="extra-set" /><Info k="drop-set" /></p>
      <div className="fg-extras-b">
        <button type="button" className="fg-extra add" onClick={() => ctx.extra(e, false, step)}>
          <span className="fg-extra-t"><PlusIcon size={22} /> Add set</span>
          <span className="fg-extra-s">{kg(p.kg)}{p.reps != null ? ` x ${p.reps}` : ""} · rest as usual</span>
        </button>
        <button type="button" className="fg-extra drop" onClick={() => ctx.extra(e, true, step)}>
          <span className="fg-extra-t"><DropIcon /> Drop set</span>
          <span className="fg-extra-s">{p.dropKg == null ? "20 percent lighter" : kg(p.dropKg)} · no rest</span>
        </button>
      </div>
    </div>
  );
}

// ---------- one set ----------
function SetRow({ e, s, j, total, big, current, step, lastText, ctx }: {
  e: FitLogEx; s: FitSet; j: number; total: number; big: boolean; current: boolean; step: number; lastText: string; ctx: Ctx;
}) {
  const best = ctx.bests.get(s.id) ?? null;
  const party = ctx.party.has(s.id);
  const pop = ctx.popped.has(s.id);
  const unit = e.perSide ? "kg each" : "kg";
  const patch = (p: Partial<FitSet>) => { void setPatch(ctx.id, e.id, s.id, p); };
  const rirSpot = s.done && (
    <button type="button" className={cx("fg-rir-spot", s.rir == null && "ask")} onClick={() => ctx.ask(e, s)}
      aria-label={s.rir != null ? `RIR ${rirLabel(s.rir)}. Tap to change` : "How hard was it? Tap to answer"}>
      {s.rir != null ? <><small>RIR</small><b className="f-num">{rirLabel(s.rir)}</b></> : <span>How<br />hard?</span>}
    </button>
  );
  const badge = best && <BestBadge kind={best} party={party} />;
  // V1.59: a comment on a done set ("left knee felt off"). The button is on the done row, the text shows under it.
  const [cm, setCm] = useState(false);
  const cmOpen = cm && s.done;
  const cmBtn = s.done && <CommentBtn n={j + 1} has={!!s.comment} open={cmOpen} onClick={() => { haptic("press"); setCm((x) => !x); }} />;
  const cmBlock = s.done && (cmOpen
    ? <CommentBox wid={ctx.id} exId={e.id} setId={s.id} n={j + 1} value={s.comment ?? ""} onClose={() => setCm(false)} />
    : s.comment ? <CommentLine text={s.comment} onClick={() => setCm(true)} /> : null);

  if (big) {
    return (
      <li className={cx("fg-set big", current && !s.done && "cur", s.done && "done", pop && "pop", best && "best")}>
        <div className="fg-set-h">
          <span className="fg-set-no">Set <b className="f-num">{j + 1}</b> of {total}{s.drop ? <em className="fg-drop-tag">DROP</em> : s.extra ? <em className="fg-extra-tag">EXTRA</em> : null}</span>
          {lastText && <span className="fg-last">{lastText}</span>}
        </div>
        {badge}
        <Stepper label={unit} value={s.kg} step={step} onChange={(kg) => patch({ kg })} />
        <Stepper label="reps" value={s.reps} step={1} whole onChange={(reps) => patch({ reps })} />
        {s.done ? (
          <div className="fg-set-foot">
            <button type="button" className="fg-undo-tick" onClick={() => ctx.untick(e, s)} aria-pressed="true">
              <span className="fg-tick on" aria-hidden="true"><TickIcon /></span> Done. Tap to undo
            </button>
            {cmBtn}
            {rirSpot}
          </div>
        ) : (
          <button type="button" className="fg-tick-big" onClick={() => ctx.tick(e, s)}>
            <TickIcon size={30} /> <span>Done</span>
          </button>
        )}
        {cmBlock}
      </li>
    );
  }
  return (
    <li className={cx("fg-set", s.done && "done", current && !s.done && "next", pop && "pop", best && "best")}>
      <button type="button" className="fg-set-main" onClick={() => ctx.focusSet(e, s)} aria-label={`Set ${j + 1}: ${setLine(s, e.perSide) || "empty"}. Tap to change`}>
        <span className="fg-set-n f-num">{j + 1}</span>
        <span className="fg-set-txt">
          <span className="fg-set-val f-num">
            {s.kg != null ? fmtKg(s.kg) : "?"}<small> {s.done ? "kg" : unit}</small><span className="fg-times"> x </span>{s.reps ?? "?"}
            {s.drop && <em className="fg-drop-tag">DROP</em>}
          </span>
          {lastText && <span className="fg-last">{lastText}</span>}
          {badge}
        </span>
      </button>
      {cmBtn}
      {rirSpot}
      <button type="button" className={cx("fg-tick", s.done && "on")} onClick={() => (s.done ? ctx.untick(e, s) : ctx.tick(e, s))}
        aria-pressed={s.done} aria-label={s.done ? `Set ${j + 1} done. Tap to undo` : `Tick set ${j + 1} done`}>
        <TickIcon />
      </button>
      {cmBlock}
    </li>
  );
}

function BestBadge({ kind, party }: { kind: BestKind; party: boolean }) {
  return (
    <span className={cx("fg-best", party && "party")} title={BEST_WORDS[kind]}>
      <StarIcon /> New best<small> · {BEST_WORDS[kind]}</small>
      {party && <span className="fg-sparks" aria-hidden="true">{[0, 1, 2, 3, 4, 5, 6, 7].map((k) => <i key={k} style={{ "--k": k } as CSSProperties} />)}</span>}
    </span>
  );
}

// ---------- the big stepper: minus, the number (tap to type), plus; hold to repeat ----------
function Stepper({ label, value, step, whole, onChange }: { label: string; value: number | null; step: number; whole?: boolean; onChange: (n: number) => void }) {
  const [pend, setPend] = useState<number | null>(null);    // shown at once, before the vault copy lands
  const [text, setText] = useState<string | null>(null);    // while typing
  const shown = pend ?? value;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const skipBlur = useRef(false);
  useEffect(() => { if (pend != null && value === pend) setPend(null); }, [value, pend]);
  useEffect(() => { if (pend == null) return; const t = window.setTimeout(() => setPend(null), 2500); return () => clearTimeout(t); }, [pend]);

  const hold = useRef<{ dir: number; t: number; val: number; reps: boolean; x: number; y: number } | null>(null);
  useEffect(() => () => { if (hold.current) clearTimeout(hold.current.t); }, []);
  const commit = (n: number) => { setPend(n); onChange(n); };
  const stop = (tap: boolean) => {
    const h = hold.current;
    if (!h) return;
    hold.current = null;
    clearTimeout(h.t);
    if (h.reps) onChange(h.val);
    else if (tap) { haptic("press"); commit(stepValue(shownRef.current, h.dir * step)); }
  };
  const down = (dir: number) => (ev: RPointerEvent<HTMLButtonElement>) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    stop(false);
    const h = { dir, t: 0, val: shownRef.current ?? 0, reps: false, x: ev.clientX, y: ev.clientY };
    const rep = (ms: number) => {
      h.t = window.setTimeout(() => {
        h.reps = true;
        h.val = stepValue(h.val, dir * step);
        setPend(h.val);
        rep(Math.max(70, ms * 0.8));
      }, ms);
    };
    rep(420);
    hold.current = h;
  };
  const move = (ev: RPointerEvent<HTMLButtonElement>) => {
    const h = hold.current;
    if (h && (Math.abs(ev.clientX - h.x) > 12 || Math.abs(ev.clientY - h.y) > 12)) stop(false);
  };
  const btn = (dir: number) => ({
    type: "button" as const,
    className: "fg-step-b",
    onPointerDown: down(dir),
    onPointerUp: () => stop(true),
    onPointerCancel: () => stop(false),
    onPointerLeave: () => stop(false),
    onPointerMove: move,
    onContextMenu: (ev: { preventDefault(): void }) => ev.preventDefault(),
    // Keyboard (Enter or Space): a click with no pointer behind it.
    onClick: (ev: { detail: number }) => { if (ev.detail === 0) commit(stepValue(shownRef.current, dir * step)); },
  });
  const save = () => {
    if (skipBlur.current) { skipBlur.current = false; setText(null); return; }
    const n = text == null ? null : parseNum(text, whole);
    setText(null);
    if (n != null && n !== shown) commit(n);
  };

  return (
    <div className="fg-step">
      <button {...btn(-1)} aria-label={`Less ${label}`}><MinusIcon size={30} /></button>
      <label className="fg-step-v">
        <input className="fg-num f-num" type="text" inputMode={whole ? "numeric" : "decimal"} enterKeyHint="done" autoComplete="off"
          aria-label={label} placeholder="0"
          value={text ?? (shown == null ? "" : whole ? String(shown) : fmtKg(shown))}
          onFocus={(ev) => { const el = ev.currentTarget; setText(el.value); requestAnimationFrame(() => { try { el.select(); } catch { /* gone */ } }); }}
          onChange={(ev) => setText(ev.currentTarget.value)}
          onBlur={save}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") ev.currentTarget.blur();
            else if (ev.key === "Escape") { skipBlur.current = true; ev.currentTarget.blur(); }
          }} />
        <span className="fg-step-u">{label}</span>
      </label>
      <button {...btn(1)} aria-label={`More ${label}`}><PlusIcon size={30} /></button>
    </div>
  );
}

// ---------- the add weight pill ----------
function HintPill({ text, onApply, onHide }: { text: string; onApply: () => void; onHide: () => void }) {
  return (
    <div className="fg-hint" role="note">
      <div className="fg-hint-t">
        <span>{text}</span>
        <small>Only a suggestion. Your trainer knows best.</small>
      </div>
      <button type="button" className="fg-hint-a" onClick={onApply}>Apply</button>
      <button type="button" className="fg-hint-x" onClick={onHide} aria-label="Hide this tip"><XIcon size={18} /></button>
    </div>
  );
}

// ---------- rest per exercise: "Rest 2:00", tap for Short, Long, -15 / +15 (V1.40: Short and Long) ----------
function RestChip({ ex, prefs }: { ex: FitLogEx; prefs: FitPrefs }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState<number | null>(null);
  const saved = restFor(ex, prefs);
  const secs = val ?? saved;
  useEffect(() => { if (val != null && saved === val) setVal(null); }, [saved, val]);
  const key = exKey(ex);
  const time = prefs.restBy?.[key], pick = time ? null : prefs.restKind?.[key] ?? null;
  const def = restDefault(ex, prefs);
  const without = <T,>(m: Record<string, T> | undefined) => { const o = { ...m }; delete o[key]; return o; };
  const nudge = (d: number) => {
    const n = clampRest(secs + d);
    if (n === secs) { haptic("reject"); return; }
    haptic("press");
    setVal(n);
    void savePrefs({ restBy: { ...prefs.restBy, [key]: n } });
  };
  const own = (n: number) => { setVal(n); void savePrefs({ restBy: { ...prefs.restBy, [key]: n }, restKind: without(prefs.restKind) }); };   // typed (V1.47)
  const choose = (k: RestPick) => {
    haptic("press");
    setVal(k === "long" ? restLong(prefs) : restShort(prefs));
    void savePrefs({ restKind: { ...prefs.restKind, [key]: k }, restBy: without(prefs.restBy) });
  };
  const reset = () => {
    haptic("press");
    setVal(def);
    void savePrefs({ restKind: without(prefs.restKind), restBy: without(prefs.restBy) });
  };
  return (
    <div className={cx("fg-restchip", open && "open")}>
      <button type="button" className="fg-restchip-b" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ClockIcon size={18} /> Rest <b className="f-num">{fmtClock(secs)}</b>
      </button>
      {open && (
        <div className="fg-restchip-p">
          <div className="fg-restchip-row" role="group" aria-label="Rest for this exercise">
            <button type="button" className={cx(pick === "short" && "on")} aria-pressed={pick === "short"} onClick={() => choose("short")}>Short <span className="f-num">{fmtClock(restShort(prefs))}</span></button>
            <button type="button" className={cx(pick === "long" && "on")} aria-pressed={pick === "long"} onClick={() => choose("long")}>Long <span className="f-num">{fmtClock(restLong(prefs))}</span></button>
          </div>
          <div className="fg-restchip-row fg-restchip-own">
            <button type="button" onClick={() => nudge(-REST_STEP)} aria-label="15 seconds less rest">-15 s</button>
            <RestNum value={secs} label="Rest for this exercise" className="fg-restchip-num" onSave={own} />
            <button type="button" onClick={() => nudge(REST_STEP)} aria-label="15 seconds more rest">+15 s</button>
          </div>
          <p className="fg-chip-note">{time || pick ? "Kept for this exercise." : "Short, Long or your own time, kept for this exercise."}</p>
          {(time || pick) && <button type="button" className="fg-chip-reset" onClick={reset}>Back to {fmtClock(def)}</button>}
        </div>
      )}
    </div>
  );
}

// ---------- sets per exercise (V1.40, the developer: "2, 3, 5, anything"): "3 sets", tap for -1 / +1 ----------
function SetsChip({ ex, prefs, wid }: { ex: FitLogEx; prefs: FitPrefs; wid: string }) {
  const [open, setOpen] = useState(false);
  const key = exKey(ex);
  const own = prefs.setsBy?.[key];
  const plain = setsFor(ex, ex.target?.length ?? 0, { ...prefs, setsBy: undefined });
  const live = liveSets(ex), done = live.filter((s) => s.done).length;
  const n = live.length;
  const change = (d: number) => {
    const x = Math.max(SETS_LO, Math.max(done, Math.min(SETS_HI, n + d)));
    if (x === n) { haptic("reject"); return; }
    haptic("tick");
    void exSetCount(wid, ex.id, x);
    const setsBy = { ...prefs.setsBy };
    if (x === plain) delete setsBy[key]; else setsBy[key] = x;
    void savePrefs({ setsBy });
  };
  const reset = () => {
    haptic("press");
    const setsBy = { ...prefs.setsBy };
    delete setsBy[key];
    void savePrefs({ setsBy });
    if (Math.max(done, plain) !== n) void exSetCount(wid, ex.id, Math.max(done, plain));
  };
  return (
    <div className={cx("fg-restchip fg-setschip", open && "open")}>
      <button type="button" className="fg-restchip-b" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="f-num"><b>{n}</b></span> {n === 1 ? "set" : "sets"}
      </button>
      {open && (
        <div className="fg-restchip-p">
          <div className="fg-restchip-row">
            <button type="button" onClick={() => change(-1)} disabled={n <= Math.max(SETS_LO, done)} aria-label="One set less">-1</button>
            <button type="button" onClick={() => change(1)} disabled={n >= SETS_HI} aria-label="One set more">+1</button>
          </div>
          <p className="fg-chip-note">{own ? `Your number for this exercise: ${own} ${own === 1 ? "set" : "sets"}.` : "Changes today and next time for this exercise."}<Info k="own-sets" /></p>
          {own != null && <button type="button" className="fg-chip-reset" onClick={reset}>Back to {plain}</button>}
        </div>
      )}
    </div>
  );
}

// ---------- the rest timer ----------
/** The draining bar: one CSS animation over the whole rest (a negative delay starts it part way). */
function Drain({ r }: { r: RestNow }) {
  const style = useMemo(() => {
    const total = Math.max(1000, r.total * 1000);
    const left = Math.max(0, r.endsAt - Date.now());
    return { animationDuration: `${total}ms`, animationDelay: `${-(total - left)}ms` } as CSSProperties;
  }, [r.endsAt, r.total]);
  return <div className="fg-drain" aria-hidden="true"><i key={`${r.endsAt}:${r.total}`} style={style} /></div>;
}
function RestDock({ r, onBig }: { r: RestNow; onBig: () => void }) {
  const left = useRestLeft(r);
  if (r.over) {
    return (
      <button type="button" className="fg-rest over" onClick={() => rest.clear()}>
        <span className="fg-rest-over">Rest over: next set</span>
        <span className="fg-rest-sub">Tap to hide</span>
      </button>
    );
  }
  return (
    <div className="fg-rest" role="timer" aria-label={`Rest, ${fmtClock(left)} left`}>
      <Drain r={r} />
      <button type="button" className="fg-rest-clock" onClick={onBig} aria-label={`Rest, ${fmtClock(left)} left. Tap for a bigger timer`}>
        <span className="fg-rest-l">Rest · set {r.set}{r.of ? ` of ${r.of}` : ""} done</span>
        <span className="fg-rest-t f-num">{fmtClock(left)}</span>
      </button>
      <RestButtons />
    </div>
  );
}
function RestButtons() {
  return (
    <div className="fg-rest-btns">
      <button type="button" onClick={() => { haptic("press"); rest.add(-15); }} aria-label="15 seconds less">-15 s</button>
      <button type="button" onClick={() => { haptic("press"); rest.add(15); }} aria-label="15 seconds more">+15 s</button>
      <button type="button" className="skip" onClick={() => { haptic("press"); rest.skip(); }}>Skip</button>
    </div>
  );
}
function RestBig({ r, prefs, onClose }: { r: RestNow; prefs: FitPrefs; onClose: () => void }) {
  const left = useRestLeft(r);
  // V1.40: this rest only, the other length (the short and long rests are set in Fitness settings).
  const short = restShort(prefs), long = restLong(prefs);
  const other = r.total < (short + long) / 2 ? { k: "Long", s: long } : { k: "Short", s: short };
  useEffect(() => { if (r.over) onClose(); }, [r.over]);
  return (
    <div className="fg-restbig">
      <p className="fg-restbig-l">{r.exercise}</p>
      <p className="fg-restbig-s">Set {r.set}{r.of ? ` of ${r.of}` : ""} done. Breathe.</p>
      <button type="button" className="fg-restbig-t f-num" onClick={onClose} aria-label="Make the timer small">{fmtClock(left)}</button>
      <Drain r={r} />
      <RestButtons />
      {short !== long && (
        <button type="button" className="fg-second" onClick={() => { haptic("press"); rest.add(other.s - r.total); }}>
          {other.k} rest this time ({fmtClock(other.s)})
        </button>
      )}
      <button type="button" className="fg-second" onClick={onClose}>Back to my sets</button>
    </div>
  );
}

// ---------- "How hard was that?" ----------
function RirPanel({ ex, set, n, onPick, onClose }: { ex: FitLogEx; set: FitSet; n: number; onPick: (r: number) => void; onClose: () => void }) {
  const [out, setOut] = useState(false);
  const [picked, setPicked] = useState<number | null>(set.rir);
  const gone = useRef(false);
  const close = () => { if (gone.current) return; gone.current = true; setOut(true); window.setTimeout(onClose, 200); };
  const target = ex.rir != null ? Math.max(0, Math.min(4, Math.round(ex.rir))) : null;
  return (
    <section className={cx("fg-rir", out && "out")} role="dialog" aria-label="How hard was that?">
      <div className="fg-rir-h">
        <div>
          <h3>How hard was that?<Info k="rir" /></h3>
          <p>Reps in reserve: how many more you could have done</p>
        </div>
        <button type="button" className="fg-later" onClick={close}>Later</button>
      </div>
      <p className="fg-rir-for">
        {ex.name} · set {n}{target != null && <> · <b>Your trainer asked for {rirLabel(target)}</b></>}
      </p>
      <div className="fg-rir-chips">
        {RIR_VALUES.map((v) => (
          <button key={v} type="button" className={cx("fg-rir-chip", picked === v && "on", target === v && "target")} aria-pressed={picked === v}
            onClick={() => { setPicked(v); onPick(v); close(); }}>
            {target === v && <span className="fg-rir-goal">Goal</span>}
            <span className="fg-rir-n f-num">{rirLabel(v)}</span>
            <span className="fg-rir-w">{RIR_WORDS[v]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------- add an exercise mid workout ----------
type NewEx = Parameters<typeof exAdd>[1];
const LIB_NAMES: ReadonlySet<string> = new Set(LIB.map((x) => x.name.toLowerCase()));
function AddPanel({ workouts, programs, prefs, swapFor, close, onAdd, onScan }: { workouts: Dated[]; programs: { data: FitProgram }[]; prefs: FitPrefs; swapFor: string | null; close: () => void; onAdd: (ex: NewEx & { sets: FitSet[] }) => void; onScan?: () => void }) {
  const [q, setQ] = useState("");
  const res = useMemo(() => searchLib(q, 30), [q]);
  // The developer's own names first (typed in the gym before, or in his plans): one tap brings back last time's weights.
  const mine = useMemo(() => yourExercises(workouts, programs, q, LIB_NAMES), [workouts, programs, q]);
  const name = q.trim();
  const exact = res.some((x) => x.name.toLowerCase() === name.toLowerCase()) || mine.some((x) => x.name.toLowerCase() === name.toLowerCase());
  const add = (x: LibEx | null, own?: YourEx) => {
    haptic("press");
    // How many: the developer's own number for this exercise, else his default (V1.40); the weights come from last time.
    onAdd(newExFor(x, own ?? null, name, workouts, prefs));
    close();
  };
  return (
    <div className="fg-add">
      <h3 className="fg-h3">{swapFor ? `Swap ${swapFor} for` : "Add an exercise"}</h3>
      {/* The Scan button sits inside the search box (V1.60). Scanning from a workout adds the exercise (the Scan screen), a swap has no scan. */}
      {onScan ? (
        <div className="sc-field">
          <input className="fg-search sc-in-box" type="search" placeholder="Search: curl, chest, squat" value={q} autoFocus enterKeyHint="search"
            onChange={(e) => setQ(e.currentTarget.value)} aria-label="Search exercises" />
          <button type="button" className="sc-field-go" onClick={() => { haptic("press"); onScan(); }} aria-label="Scan a machine"><CamIcon size={20} /><span>Scan</span></button>
        </div>
      ) : (
        <input className="fg-search" type="search" placeholder="Search: curl, chest, squat" value={q} autoFocus enterKeyHint="search"
          onChange={(e) => setQ(e.currentTarget.value)} aria-label="Search exercises" />
      )}
      {mine.length > 0 && (
        <ul className="fg-results fg-mine" aria-label="Your exercises">
          {mine.map((x) => (
            <li key={x.name}>
              <ExPic exId={x.exId} name={x.name} size={56} className="fg-res-pic" />
              <button type="button" onClick={() => add(null, x)}>
                <b>{x.name}</b>
                <small>{x.uses ? `Yours · done ${x.uses} ${x.uses === 1 ? "time" : "times"}` : "Yours · in your plan"}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      <ul className="fg-results">
        {res.map((x) => (
          <li key={x.id}>
            <ExPic exId={x.id} name={x.name} size={56} className="fg-res-pic" />
            <button type="button" onClick={() => add(x)}>
              <b>{x.name}</b>
              <small>{x.equipment} · {x.muscles.join(", ")}</small>
            </button>
          </li>
        ))}
      </ul>
      {name && !exact && (
        <button type="button" className="fg-second fg-add-free" onClick={() => add(null)}>Add "{name}" as written</button>
      )}
      {!res.length && !name && <p className="fg-muted">Type a name to search.</p>}
      <button type="button" className="fg-second" onClick={close}>Cancel</button>
    </div>
  );
}

// ---------- after Finish ----------
function SummaryCard({ s, label, onClose }: { s: Summary; label: string; onClose: () => void }) {
  const [out, setOut] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const a = window.setTimeout(() => setOut(true), 6000);
    const b = window.setTimeout(() => closeRef.current(), 6400);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  const close = () => { setOut(true); window.setTimeout(() => closeRef.current(), 320); };
  return (
    <button type="button" className={cx("fg-sum", out && "out")} onClick={close} aria-label="Workout saved. Tap to close">
      <span className="fg-sum-card">
        <span className="fg-sum-tick"><TickIcon size={42} /></span>
        <span className="fg-sum-h">Workout saved</span>
        <span className="fg-sum-day">{label}</span>
        <span className="fg-sum-grid">
          <Stat n={String(s.sets)} l={s.sets === 1 ? "set" : "sets"} />
          <Stat n={fmtVol(s.volume)} l="kg lifted" />
          <Stat n={String(s.bests)} l={s.bests === 1 ? "new best" : "new bests"} gold={s.bests > 0} />
          <Stat n={fmtDur(s.minutes)} l="time" />
        </span>
        <span className="fg-sum-tap">Tap to close</span>
      </span>
    </button>
  );
}
function Stat({ n, l, gold }: { n: string; l: string; gold?: boolean }) {
  return <span className={cx("fg-stat", gold && "gold")}><b className="f-num">{n}</b><small>{l}</small></span>;
}

// ---------- icons ----------
function Svg({ size = 24, children, w = 2.4 }: { size?: number; children: ReactNode; w?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  );
}
const TickIcon = ({ size = 28 }: { size?: number }) => <Svg size={size} w={3}><path d="M4.5 12.5l5 5L19.5 7" /></Svg>;
const PlusIcon = ({ size = 24 }: { size?: number }) => <Svg size={size} w={2.8}><path d="M12 5v14M5 12h14" /></Svg>;
const MinusIcon = ({ size = 24 }: { size?: number }) => <Svg size={size} w={2.8}><path d="M5 12h14" /></Svg>;
const XIcon = ({ size = 22 }: { size?: number }) => <Svg size={size}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
const MoreIcon = () => <Svg><circle cx="5" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="19" cy="12" r="1.6" fill="currentColor" /></Svg>;
const ChevronIcon = ({ dir }: { dir: "l" | "r" }) => <Svg size={26} w={2.8}><path d={dir === "l" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} /></Svg>;
const PlayIcon = () => <Svg size={28}><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" /></Svg>;
const ListIcon = () => <Svg><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></Svg>;
const ClockIcon = ({ size = 24 }: { size?: number }) => <Svg size={size}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>;
const GearIcon = () => <Svg w={2}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>;
const LockIcon = ({ size = 20 }: { size?: number }) => <Svg size={size}><rect x="5" y="11" width="14" height="9.5" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Svg>;
const StarIcon = () => <Svg size={15} w={2}><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor" /></Svg>;
const DropIcon = () => <Svg size={22} w={2.6}><path d="M12 4v13M6 11l6 6 6-6M5 20h14" /></Svg>;
const DumbbellIcon = ({ size = 22 }: { size?: number }) => <Svg size={size} w={2.2}><path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11" /></Svg>;

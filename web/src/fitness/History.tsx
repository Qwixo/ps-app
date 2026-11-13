// PS Fitness: History. The week at a glance (seven day dots, "3 of 4 this week", the streaks), every
// workout by week (tap one for every set, fix a mistake, add a note, delete it) and progress per exercise
// (a hand drawn line chart of best weight, estimated max or volume). Phone: one screen at a time inside the
// History sheet, the phone's back gesture steps back. Desk: the list on the left, the detail on the right.
import { SquadChip } from "./Squad";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Doc } from "../core/model";
import {
  bestsFor, dayLabel, exKey, exerciseProgress, exercisesLogged, fmtKg, liveSets, rirLabel, RIR_VALUES,
  weekStats, workoutSetsDone, workoutVolume, type BestKind, type FitLogEx, type FitSet, type FitWorkout, type ProgressPoint,
} from "../core/fitness";
import { todayISO } from "../ui/kit";
import { haptic } from "../gos/bridge";
import { discardWorkout, setPatch, workoutPatch, type FitView } from "./store";
import {
  BEST_WORDS, bestCount, bestsThen, chartScale, fmtDay, fmtDayShort, fmtDuration, fmtThousands, fmtVolume, groupByWeek,
  labelIndexes, parseKgInput, parseRepsInput, plural, sessionLines, sparkPath, weekDots,
} from "./hist-logic";
import { useFitSub } from "./Nav";
import { picCardOpen } from "./ExPic";
import { Info } from "./Info";
import { DaysMain, DaysSide, useDaysState, useHealthData } from "./Days";
import "./history.css";

type Scr = { k: "w"; id: string } | { k: "x"; key: string };
type Pane = "days" | "workouts" | "progress";
const PAGE = 30;

export function History({ v, desk, start, onSquad }: { v: FitView; desk?: boolean; start?: Scr | null; onSquad?: () => void }) {
  const today = todayISO();
  // V1.43: Home's Last workout and a personal best open History on that workout or that exercise.
  // V1.44: otherwise it opens on Days (the calendar of sleep and training, the month's numbers, Export, Compete).
  const [pane, setPane] = useState<Pane>(start?.k === "x" ? "progress" : start?.k === "w" ? "workouts" : "days");
  const health = useHealthData(v);
  const days = useDaysState(today);
  const [stack, setStack] = useState<Scr[]>(() => (start ? [start] : []));
  const root = useRef<HTMLDivElement>(null);
  const scrolls = useRef<number[]>([]);
  const scroller = () => (root.current?.closest(".fit-view, .fit-sheet-b, .fit-desk-body") as HTMLElement | null) ?? null;

  /** From the list (`fresh`), a new screen replaces the desk's right side; from a screen it stacks on it. */
  const push = (s: Scr, fresh = false) => {
    haptic("press");
    if (desk) { setStack((st) => (fresh ? [s] : [...st, s])); return; }
    scrolls.current.push(scroller()?.scrollTop ?? 0);
    setStack((st) => [...st, s]);
  };
  const pop = () => setStack((st) => st.slice(0, -1));
  // Phone (V1.43): the screen's own Back is the one at the top of Fitness (it sends the same back event).
  // Phone: a new screen starts at the top; stepping back returns to where the list was.
  const depth = stack.length, lastDepth = useRef(0);
  useLayoutEffect(() => {
    if (desk) return;
    const el = scroller();
    if (el) {
      if (depth > lastDepth.current) el.scrollTop = 0;
      else if (depth < lastDepth.current) el.scrollTop = scrolls.current.pop() ?? 0;
    }
    lastDepth.current = depth;
  }, [depth, desk]);
  // The phone's back gesture steps back inside History before the sheet closes.
  const stackRef = useRef(stack);
  stackRef.current = stack;
  // V1.43: a screen opened from elsewhere (start) is the whole of this visit, so Back leaves History from it.
  useEffect(() => {
    if (desk) return;
    const f = (e: Event) => {
      if (!stackRef.current.length || (start && stackRef.current.length === 1) || picCardOpen()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      setStack((st) => st.slice(0, -1));
    };
    window.addEventListener("gos-back", f, true);
    return () => window.removeEventListener("gos-back", f, true);
  }, [desk]);

  const top = stack[stack.length - 1] ?? null;
  // V1.43: on the phone the open workout or exercise names Fitness's top bar (its Back arrow steps back here first).
  const topTitle = !top ? null : top.k === "w"
    ? (() => { const w = v.workouts.find((x) => x.id === top.id); return w ? fmtDay(w.data.date) : "Workout"; })()
    : (exercisesLogged(v.workouts).find((x) => x.key === top.key)?.name ?? "Exercise");
  useFitSub(!desk ? topTitle : null);
  const opens = { onWorkout: (id: string) => push({ k: "w", id }, true), onExercise: (key: string) => push({ k: "x", key }, true), onSquad };
  const list = (
    <>
      {pane !== "days" && <Glance v={v} today={today} />}
      <Switch pane={pane} onPane={(p) => { haptic("tick"); setPane(p); if (desk) setStack([]); }} />
      {pane === "days"
        ? <><DaysMain v={v} h={health} s={days} today={today} open={opens} />{!desk && <DaysSide h={health} s={days} today={today} open={opens} />}</>
        : pane === "workouts"
        ? <WorkoutList v={v} today={today} onOpen={(id) => push({ k: "w", id }, true)} selected={desk ? (top?.k === "w" ? top.id : !top ? v.workouts[0]?.id : null) : null} />
        : <ProgressList v={v} onOpen={(key) => push({ k: "x", key }, true)} selected={desk && top?.k === "x" ? top.key : null} />}
    </>
  );
  const screen = (s: Scr, back: (() => void) | null) => s.k === "w"
    ? <WorkoutDetail key={`w${s.id}`} v={v} id={s.id} onBack={back} onGone={pop} desk={desk} />
    : <ExerciseScreen key={`x${s.key}`} v={v} exKeyId={s.key} onBack={back} onWorkout={(id) => push({ k: "w", id })} />;

  if (desk) {
    const shown: Scr | null = top ?? (pane === "workouts" && v.workouts[0] ? { k: "w", id: v.workouts[0].id } : null);
    return (
      <div className="fh fh-desk" ref={root}>
        <div className="fh-col">{list}</div>
        <div className="fh-side">
          {pane === "days" && !top ? <DaysSide h={health} s={days} today={today} open={opens} /> : shown ? screen(shown, stack.length > 1 || pane === "days" ? pop : null) : (
            <Empty title={pane === "progress" ? "Pick an exercise" : "Nothing here yet"}>
              {pane === "progress" ? "Pick one on the left to see its line." : "Your workouts show up here the moment you tick a set."}
            </Empty>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="fh fh-phone" ref={root}>
      {top ? <div className="fh-push" key={depth} data-fit-owns-back={stack.length > 1 || !start ? "" : undefined}>{screen(top, null)}</div> : <div className="fh-pop" key="list">{list}</div>}
    </div>
  );
}

// ---------- the week at a glance ----------
function Glance({ v, today }: { v: FitView; today: string }) {
  const s = weekStats(v.workouts, today, v.prefs.weekGoal ?? 3);
  const dots = weekDots(today, s.days);
  const met = s.count >= s.goal;
  return (
    <section className="fh-glance" aria-label="This week">
      <div className="fh-dots" role="list">
        {dots.map((d, i) => (
          <div key={d.date} role="listitem" className={`fh-dot${d.trained ? " on" : ""}${d.today ? " today" : ""}${d.future ? " later" : ""}`} style={{ animationDelay: `${i * 40}ms` }}
            aria-label={`${fmtDay(d.date)}${d.trained ? ", trained" : ""}${d.today ? ", today" : ""}`}>
            <span className="fh-dot-c" aria-hidden="true">{d.trained && <Check />}</span>
            <span className="fh-dot-l" aria-hidden="true">{d.letter}</span>
          </div>
        ))}
      </div>
      <div className="fh-tiles">
        <div className={`fh-tile fh-tile-main${met ? " met" : ""}`}>
          <div className="fh-big"><span className="f-num">{s.count}</span><span className="fh-of">of {s.goal}</span></div>
          <div className="fh-tile-t">{met ? "this week, goal met" : "this week"}</div>
        </div>
        <div className="fh-tile">
          <div className="fh-big"><span className="f-num">{s.streakWeeks}</span></div>
          <div className="fh-tile-t">{s.streakWeeks === 1 ? "week on goal" : "weeks in a row"}</div>
        </div>
        <div className="fh-tile">
          <div className="fh-big"><span className="f-num">{s.dayStreak}</span></div>
          <div className="fh-tile-t">{s.dayStreak === 1 ? "day in a row" : "days in a row"}</div>
        </div>
      </div>
      {!met && s.streakWeeks === 0 && <p className="fh-hint">Train {plural(s.goal, "day")} this week to start a streak.</p>}
    </section>
  );
}

const PANES: { k: Pane; t: string; line: string }[] = [
  { k: "days", t: "Days", line: "Sleep and training day by day, the month, export and compete" },
  { k: "workouts", t: "Workouts", line: "Every workout by week" },
  { k: "progress", t: "Progress", line: "Each exercise's line over time" },
];
function Switch({ pane, onPane }: { pane: Pane; onPane: (p: Pane) => void }) {
  const i = PANES.findIndex((p) => p.k === pane);
  return (
    <div className="fh-switch fh-switch-3" role="tablist" aria-label="Show">
      <span className="fh-switch-pill" style={{ transform: `translateX(${i * 100}%)` }} aria-hidden="true" />
      {PANES.map((p) => (
        <button key={p.k} type="button" role="tab" aria-selected={pane === p.k} className={pane === p.k ? "on" : ""} onClick={() => onPane(p.k)} data-tip={p.t} data-tip-line={p.line}>{p.t}</button>
      ))}
    </div>
  );
}

// ---------- workouts by date ----------
function dayTitle(v: FitView, w: FitWorkout) {
  const p = v.programs.find((x) => x.id === w.programId);
  return p?.data.days.find((d) => d.id === w.dayId)?.title ?? null;
}

function WorkoutList({ v, today, onOpen, selected }: { v: FitView; today: string; onOpen: (id: string) => void; selected: string | null | undefined }) {
  const [shown, setShown] = useState(PAGE);
  const page = v.workouts.slice(0, shown);
  const groups = groupByWeek(page, today);
  // New bests per row, judged against the workouts before each one (only for the rows on screen).
  const bests = useMemo(() => new Map(v.workouts.slice(0, shown).map((w) => [w.id, bestCount(w, v.workouts)])), [v.workouts, shown]);
  if (!v.workouts.length) return <Empty title="No workouts yet">Your first one shows up here the moment you tick a set. Every set, every week, all in one place.</Empty>;
  return (
    <div className="fh-list">
      {groups.map((g) => (
        <section key={g.monday} className="fh-week">
          <h3 className="fh-week-h">{g.label}<span>{plural(g.items.length, "workout")}</span></h3>
          {g.items.map((w, i) => <WorkoutRow key={w.id} v={v} w={w} best={bests.get(w.id) ?? 0} on={selected === w.id} delay={i} onOpen={() => onOpen(w.id)} />)}
        </section>
      ))}
      {v.workouts.length > shown && (
        <button type="button" className="fh-more" onClick={() => setShown((n) => n + PAGE)}>Show older workouts</button>
      )}
    </div>
  );
}

function WorkoutRow({ v, w, best, on, delay, onOpen }: { v: FitView; w: Doc<FitWorkout>; best: number; on: boolean; delay: number; onOpen: () => void }) {
  const d = w.data, title = dayTitle(v, d);
  const sets = workoutSetsDone(d), vol = workoutVolume(d), dur = fmtDuration(d.startedAt, d.endedAt);
  const live = v.open?.id === w.id;
  return (
    <button type="button" className={`fh-row${on ? " on" : ""}`} onClick={onOpen} style={{ animationDelay: `${Math.min(delay, 8) * 30}ms` }} aria-current={on || undefined}>
      <span className="fh-row-top">
        <span className="fh-row-date">{fmtDay(d.date)}</span>
        {live && <span className="fh-tag">Going now</span>}
        {best > 0 && <span className="fh-gold"><Star /> {best === 1 ? "New best" : `${best} new bests`}</span>}
      </span>
      <span className="fh-row-day">{dayLabel(d.week, d.dayName)}{title ? ` · ${title}` : ""}</span>
      <span className="fh-row-nums">
        <span><b className="f-num">{sets}</b> {sets === 1 ? "set" : "sets"}</span>
        <span><b className="f-num">{fmtThousands(vol)}</b> kg</span>
        {dur && <span><b className="f-num">{dur.replace(/ (min|h)/g, " $1")}</b></span>}
      </span>
      <Chevron />
    </button>
  );
}

// ---------- one workout ----------
function WorkoutDetail({ v, id, onBack, onGone, desk }: { v: FitView; id: string; onBack: (() => void) | null; onGone: () => void; desk?: boolean }) {
  const w = v.workouts.find((x) => x.id === id);
  const [edit, setEdit] = useState(false);
  useEffect(() => { if (!w && v.ready) onGone(); }, [w, v.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!w) return <Empty title="This workout is gone">It was deleted.</Empty>;
  const d = w.data, title = dayTitle(v, d);
  const dur = fmtDuration(d.startedAt, d.endedAt);
  const exs = d.exercises.filter((e) => !e.removed && liveSets(e).length);
  return (
    <article className="fh-detail">
      {onBack && <BackBtn onClick={onBack} />}
      <header className="fh-detail-h">
        <h2 className="fh-detail-date">{fmtDay(d.date)}</h2>
        <p className="fh-detail-day">{dayLabel(d.week, d.dayName)}{title ? ` · ${title}` : ""}</p>
        <div className="fh-stats">
          <Stat n={String(workoutSetsDone(d))} t="sets done" />
          <Stat n={fmtThousands(workoutVolume(d))} t="kg moved" />
          {dur && <Stat n={dur} t="long" small />}
        </div>
      </header>
      <button type="button" className={`fh-edit-btn${edit ? " on" : ""}`} aria-pressed={edit} onClick={() => { haptic("press"); setEdit((x) => !x); }}>
        {edit ? <><Check /> Done fixing</> : <><Pencil /> Fix a mistake</>}
      </button>
      {!exs.length && <Empty title="Nothing logged">No sets were ticked in this one.</Empty>}
      {exs.map((e) => <ExerciseBlock key={e.id} v={v} w={w} ex={e} edit={edit} />)}
      <NoteBox id={w.id} note={d.note ?? ""} />
      <DeleteBox id={w.id} desk={desk} />
    </article>
  );
}

function ExerciseBlock({ v, w, ex, edit }: { v: FitView; w: Doc<FitWorkout>; ex: FitLogEx; edit: boolean }) {
  const bests = useMemo(() => bestsThen(ex, w, v.workouts), [ex, w, v.workouts]);
  const sets = liveSets(ex);
  return (
    <section className="fh-ex">
      <h3 className="fh-ex-name">{ex.name}{bests.size > 0 && <span className="fh-gold"><Star /> {bests.size === 1 ? "New best" : `${bests.size} new bests`}</span>}</h3>
      <ol className="fh-sets">
        {sets.map((s, i) => edit
          ? <SetEditor key={s.id} wid={w.id} exId={ex.id} s={s} n={i + 1} perSide={ex.perSide} />
          : <SetView key={s.id} s={s} n={i + 1} perSide={ex.perSide} best={bests.get(s.id) ?? null} />)}
      </ol>
    </section>
  );
}

function SetView({ s, n, perSide, best }: { s: FitSet; n: number; perSide?: boolean; best: BestKind | null }) {
  return (
    <li className={`fh-set${s.done ? "" : " undone"}${best ? " best" : ""}`}>
      <span className="fh-set-n f-num">{s.warm ? "W" : n}</span>
      <span className="fh-set-main">
        <span className="fh-set-kg"><b className="f-num">{s.kg != null ? fmtKg(s.kg) : "?"}</b> kg{perSide ? " each" : ""}</span>
        <span className="fh-set-x" aria-hidden="true">x</span>
        <span className="fh-set-reps"><b className="f-num">{s.reps ?? "?"}</b> {s.reps === 1 ? "rep" : "reps"}</span>
      </span>
      <span className="fh-set-side">
        {s.rir != null && <span className="fh-rir">RIR <b className="f-num">{rirLabel(s.rir)}</b></span>}
        {!s.done && <span className="fh-set-note">Not done</span>}
        {s.warm && <span className="fh-set-note">Warm up</span>}
        {s.drop && <span className="fh-drop">DROP</span>}
      </span>
      {best && <span className="fh-best-tag"><Star /> {BEST_WORDS[best]}</span>}
    </li>
  );
}

/** Big kg and reps boxes and the RIR chips. Each box saves when the developer leaves it; a chip saves on the tap. */
function SetEditor({ wid, exId, s, n, perSide }: { wid: string; exId: string; s: FitSet; n: number; perSide?: boolean }) {
  const [kg, setKg] = useState(fmtKg(s.kg));
  const [reps, setReps] = useState(s.reps == null ? "" : String(s.reps));
  const focus = useRef<"kg" | "reps" | null>(null);
  useEffect(() => { if (focus.current !== "kg") setKg(fmtKg(s.kg)); }, [s.kg]);
  useEffect(() => { if (focus.current !== "reps") setReps(s.reps == null ? "" : String(s.reps)); }, [s.reps]);
  const saveKg = () => {
    focus.current = null;
    const x = parseKgInput(kg);
    if (x === undefined) { haptic("reject"); setKg(fmtKg(s.kg)); return; }
    if (x !== s.kg) { haptic("tick"); void setPatch(wid, exId, s.id, { kg: x }); }
    setKg(fmtKg(x));
  };
  const saveReps = () => {
    focus.current = null;
    const x = parseRepsInput(reps);
    if (x === undefined) { haptic("reject"); setReps(s.reps == null ? "" : String(s.reps)); return; }
    if (x !== s.reps) { haptic("tick"); void setPatch(wid, exId, s.id, { reps: x }); }
  };
  const enter = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") e.currentTarget.blur(); };
  return (
    <li className="fh-set fh-set-edit">
      <span className="fh-set-n f-num">{s.warm ? "W" : n}{s.drop && <span className="fh-drop">DROP</span>}</span>
      <div className="fh-edit-grid">
        <label className="fh-field">
          <span>kg{perSide ? " each" : ""}</span>
          <input className="f-num" inputMode="decimal" value={kg} aria-label={`Set ${n} kg`}
            onFocus={(e) => { focus.current = "kg"; e.currentTarget.select(); }} onChange={(e) => setKg(e.target.value)} onBlur={saveKg} onKeyDown={enter} />
        </label>
        <label className="fh-field">
          <span>reps</span>
          <input className="f-num" inputMode="numeric" value={reps} aria-label={`Set ${n} reps`}
            onFocus={(e) => { focus.current = "reps"; e.currentTarget.select(); }} onChange={(e) => setReps(e.target.value)} onBlur={saveReps} onKeyDown={enter} />
        </label>
        <div className="fh-rir-pick" role="radiogroup" aria-label={`Set ${n} reps in reserve`}>
          {RIR_VALUES.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={s.rir === r} className={`f-num${s.rir === r ? " on" : ""}`}
              onClick={() => { haptic("tick"); void setPatch(wid, exId, s.id, { rir: s.rir === r ? null : r }); }}>{rirLabel(r)}</button>
          ))}
        </div>
      </div>
    </li>
  );
}

function NoteBox({ id, note }: { id: string; note: string }) {
  const [text, setText] = useState(note);
  const [saved, setSaved] = useState(false);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(note); }, [note]);
  const save = () => {
    focused.current = false;
    const t = text.trim();
    if (t === note.trim()) return;
    void workoutPatch(id, { note: t || null }).then(() => { setSaved(true); window.setTimeout(() => setSaved(false), 1600); });
  };
  return (
    <section className="fh-note">
      <label htmlFor={`fh-note-${id}`} className="fh-note-h">Note {saved && <span className="fh-saved">Saved</span>}</label>
      <textarea id={`fh-note-${id}`} rows={3} value={text} placeholder="How did it feel? Anything for your trainer?"
        onFocus={() => { focused.current = true; }} onChange={(e) => setText(e.target.value)} onBlur={save} />
    </section>
  );
}

/** Delete asks twice: the first tap opens the question, then "Yes, delete" arms, then one more tap deletes.
 *  Once it is gone the detail screen steps back by itself. */
function DeleteBox({ id, desk }: { id: string; desk?: boolean }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  useEffect(() => { if (step !== 2) return; const t = window.setTimeout(() => setStep(1), 4000); return () => clearTimeout(t); }, [step]);
  if (step === 0) {
    return <button type="button" className="fh-del" onClick={() => { haptic("press"); setStep(1); }}><Trash /> Delete this workout</button>;
  }
  return (
    <div className="fh-del-box" role="alertdialog" aria-label="Delete this workout?">
      <p><b>Delete this workout?</b> Every set in it goes for good, on {desk ? "this Mac" : "this phone"} and everywhere else.</p>
      <div className="fh-del-btns">
        <button type="button" className="fh-del-keep" onClick={() => setStep(0)}>Keep it</button>
        <button type="button" className={`fh-del-yes${step === 2 ? " armed" : ""}`} onClick={() => {
          if (step === 1) { haptic("press"); setStep(2); return; }
          haptic("drop");
          void discardWorkout(id);
        }}>{step === 2 ? "Tap again to delete" : "Yes, delete"}</button>
      </div>
    </div>
  );
}

// ---------- progress per exercise ----------
function ProgressList({ v, onOpen, selected }: { v: FitView; onOpen: (key: string) => void; selected: string | null }) {
  const rows = useMemo(() => exercisesLogged(v.workouts).map((x) => {
    const pts = exerciseProgress(x.key, v.workouts);
    return { ...x, best: bestsFor(x.key, v.workouts).kg, spark: pts.slice(-12).map((p) => p.bestKg), each: perSideOf(v, x.key) };
  }), [v.workouts]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return <Empty title="Nothing to chart yet">Log a few sets and each exercise gets its own line here, so you can see it go up.</Empty>;
  return (
    <div className="fh-list">
      {rows.map((r, i) => (
        <button key={r.key} type="button" className={`fh-row fh-prog${selected === r.key ? " on" : ""}`} onClick={() => onOpen(r.key)} style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
          <span className="fh-prog-name">{r.name}<small>{plural(r.count, "workout")} · last {fmtDayShort(r.last)}</small></span>
          <Spark values={r.spark} />
          <span className="fh-prog-best"><b className="f-num">{fmtKg(r.best)}</b><small>kg{r.each ? " each" : ""} best</small></span>
          <Chevron />
        </button>
      ))}
    </div>
  );
}
function perSideOf(v: FitView, key: string) {
  for (const w of v.workouts) for (const e of w.data.exercises) if (exKey(e) === key) return !!e.perSide;
  return false;
}

function Spark({ values }: { values: number[] }) {
  const d = sparkPath(values, 72, 30);
  return (
    <svg className="fh-spark" width="72" height="30" viewBox="0 0 72 30" aria-hidden="true">
      {d ? <path d={d} /> : <circle cx="36" cy="15" r="3.5" />}
    </svg>
  );
}

type Metric = "kg" | "e1rm" | "volume";
const METRICS: { k: Metric; t: string }[] = [{ k: "kg", t: "Best weight" }, { k: "e1rm", t: "Estimated max" }, { k: "volume", t: "Volume" }];
const metricOf = (p: ProgressPoint, m: Metric) => (m === "kg" ? p.bestKg : m === "e1rm" ? Math.round(p.e1rm * 2) / 2 : p.volume);
const fmtMetric = (n: number, m: Metric) => (m === "volume" ? fmtThousands(n) : fmtKg(m === "e1rm" ? Math.round(n) : n));

function ExerciseScreen({ v, exKeyId, onBack, onWorkout }: { v: FitView; exKeyId: string; onBack: (() => void) | null; onWorkout: (id: string) => void }) {
  const [m, setM] = useState<Metric>("kg");
  const pts = useMemo(() => exerciseProgress(exKeyId, v.workouts), [exKeyId, v.workouts]);
  const best = useMemo(() => bestsFor(exKeyId, v.workouts), [exKeyId, v.workouts]);
  const lines = useMemo(() => sessionLines(exKeyId, v.workouts, 5), [exKeyId, v.workouts]);
  const name = useMemo(() => exercisesLogged(v.workouts).find((x) => x.key === exKeyId)?.name ?? "Exercise", [exKeyId, v.workouts]);
  const each = perSideOf(v, exKeyId) ? " each" : "";
  if (!pts.length) return <div className="fh-detail">{onBack && <BackBtn onClick={onBack} />}<Empty title="No sets yet">Tick a set of this one and its line starts here.</Empty></div>;
  const bestReps = best.reps[fmtKg(best.kg)];
  return (
    <article className="fh-detail fh-exs">
      {onBack && <BackBtn onClick={onBack} />}
      <header className="fh-detail-h">
        <h2 className="fh-detail-date">{name}</h2>
        <p className="fh-detail-day">{plural(pts.length, "workout")} logged</p>
        <SquadChip workouts={v.workouts} ex={{ exId: exKeyId.startsWith("id:") ? exKeyId.slice(3) : null, name }} />
      </header>
      <div className="fh-metrics" role="tablist" aria-label="Chart">
        {METRICS.map((x) => (
          <button key={x.k} type="button" role="tab" aria-selected={m === x.k} className={m === x.k ? "on" : ""} onClick={() => { haptic("tick"); setM(x.k); }}>{x.t}</button>
        ))}
      </div>
      <LineChart pts={pts} metric={m} unit={m === "volume" ? "kg" : `kg${each}`} />
      {m === "e1rm" && <p className="fh-explain">Estimated max: what you could lift once, worked out from your sets.<Info k="e1rm" /></p>}
      {m === "volume" && <p className="fh-explain">Volume: kg times reps, added up over every set that day.<Info k="volume" /></p>}
      <div className="fh-stats fh-stats-2">
        <Stat n={`${fmtKg(best.kg)} x ${bestReps ?? "?"}`} t={`best ever, kg${each} x reps`} />
        <Stat n={`${Math.round(best.e1rm)}`} t={`best estimated max, kg${each}`} />
      </div>
      {m !== "e1rm" && <p className="fh-explain">Estimated max: what you could lift once, worked out from your sets.<Info k="e1rm" /></p>}
      <section className="fh-sessions">
        <h3 className="fh-week-h">{lines.length === 1 ? "Last session" : `Last ${lines.length} sessions`}</h3>
        {lines.map((l) => (
          <button key={l.workoutId} type="button" className="fh-session" onClick={() => onWorkout(l.workoutId)}>
            <span className="fh-session-d">{fmtDay(l.date)}</span>
            <span className="fh-session-l f-num">{l.line}</span>
            <Chevron />
          </button>
        ))}
      </section>
    </article>
  );
}

// ---------- the chart (hand drawn SVG; the line draws itself in) ----------
const CW = 340, CH = 210, PAD = { l: 42, r: 18, t: 30, b: 34 };
function LineChart({ pts, metric, unit }: { pts: ProgressPoint[]; metric: Metric; unit: string }) {
  const values = pts.map((p) => metricOf(p, metric));
  const c = useMemo(() => chartScale(values, CW, CH, PAD), [values.join(","), metric]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { setSel(null); }, [metric, pts.length]);
  const i = sel ?? values.length - 1;
  const at = c.points[i];
  const labels = labelIndexes(pts.length, 5);
  const bestP = c.points[c.best];
  const pick = (k: number) => { haptic("tick"); setSel(k); };
  return (
    <figure className="fh-chart">
      <figcaption className="fh-readout" aria-live="polite">
        <span className="fh-readout-n"><b className="f-num">{fmtMetric(values[i], metric)}</b> {unit}</span>
        <span className="fh-readout-d">{fmtDay(pts[i].date)}{i === c.best && values.length > 1 ? <span className="fh-gold"><Star /> Best</span> : null}</span>
      </figcaption>
      <svg viewBox={`0 0 ${CW} ${CH}`} className="fh-svg" role="img" aria-label={`${METRICS.find((x) => x.k === metric)?.t} over ${plural(pts.length, "workout")}`}>
        <g className="fh-grid">
          {c.ticks.map((t) => (
            <g key={t.v}>
              <line x1={PAD.l} x2={CW - PAD.r} y1={t.y} y2={t.y} />
              <text x={PAD.l - 8} y={t.y + 4} textAnchor="end" className="f-num">{fmtMetric(t.v, metric === "e1rm" ? "kg" : metric)}</text>
            </g>
          ))}
        </g>
        <g className="fh-xl">
          {labels.map((k) => <text key={k} x={c.points[k].x} y={CH - 10} textAnchor={labels.length > 1 && k === 0 ? "start" : labels.length > 1 && k === pts.length - 1 ? "end" : "middle"}>{fmtDayShort(pts[k].date)}</text>)}
        </g>
        <g key={metric} className="fh-plot">
          {c.area && <path className="fh-area" d={c.area} />}
          {c.points.length > 1 && <path className="fh-line" d={c.line} pathLength={1} />}
          {at && <line className="fh-cursor" x1={at.x} x2={at.x} y1={PAD.t - 6} y2={CH - PAD.b} />}
          {bestP && values.length > 1 && <circle className="fh-best-ring" cx={bestP.x} cy={bestP.y} r={11} />}
          {c.points.map((p, k) => (
            <circle key={k} className={`fh-pt${k === i ? " on" : ""}`} cx={p.x} cy={p.y} r={k === i ? 7 : 4.5} style={{ animationDelay: `${300 + (k / Math.max(1, c.points.length - 1)) * 600}ms` }} />
          ))}
          {c.points.map((p, k) => (
            <circle key={`h${k}`} className="fh-hit" cx={p.x} cy={p.y} r={18} tabIndex={0} role="button"
              aria-label={`${fmtDay(pts[k].date)}: ${fmtMetric(values[k], metric)} ${unit}`}
              onClick={() => pick(k)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(k); } }} />
          ))}
        </g>
      </svg>
      {pts.length === 1 && <p className="fh-explain">One workout so far. The line grows each time you do this one.</p>}
    </figure>
  );
}

// ---------- small parts ----------
function Stat({ n, t, small }: { n: string; t: string; small?: boolean }) {
  return <div className={`fh-stat${small ? " small" : ""}`}><b className="f-num">{n}</b><span>{t}</span></div>;
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="fh-empty"><div className="fh-empty-i" aria-hidden="true"><Dumbbell /></div><h3>{title}</h3><p>{children}</p></div>;
}
function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="fh-back" onClick={() => { haptic("tick"); onClick(); }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
      Back
    </button>
  );
}
const Chevron = () => (
  <svg className="fh-chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);
const Check = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
const Star = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3L2.8 9.5l6.4-.9z" /></svg>
);
const Pencil = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
);
const Trash = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
);
const Dumbbell = () => (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11" /></svg>
);

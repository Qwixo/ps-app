// PS Fitness "Set up your training" (V1.47, the developer: "When you open the Fitness app there should be an onboarding process
// where you can set up your training very easily, and if you're working on it, it should get saved so you can finish
// it later and don't have to start over every time. Very simple and flexible.")
// Six short questions (goal, days a week, session length, experience, equipment, areas to go easy on), each with an (i)
// and each skippable, then a suggested program from Fitness's own exercises with their pictures, which can be changed
// (swap, add, remove, move, sets, rest, names) before it is saved as the active program. Or: start from scratch with
// empty days, or use your own program (Programs). Every tap is saved (setup-store.ts), so closing anything resumes
// right here. Back, Esc and the phone's back gesture go one step; from the first step they leave setup.
import { ScanSearch } from "./Scan";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { fmtClock, restFor, type FitDay, type FitPlanEx } from "../core/fitness";
import { haptic } from "../gos/bridge";
import { ExPic } from "./ExPic";
import { Info } from "./Info";
import type { TermKey } from "./glossary";
import { LIBRARY, searchExercises } from "./library";
import { dayMinutes, type FitArg, type FitSection } from "./nav-logic";
import { plural } from "./hist-logic";
import {
  addDay, addEx, AREAS, candidates, DAY_CHOICES, GEARS, GOALS, goBack, goNext, LEVELS, MIN_CHOICES, moveEx, newDraft, planStale, progressOf,
  rebuild, removeDay, removeEx, renameDay, renamePlan, resolved, scratchPlan, setRest, setSets, setsLine, skipStep, SLOTS, swapChoices, swapEx, fitsGear, withAnswer,
  type Area, type DraftPlan, type SetupDraft, type Step,
} from "./setup-logic";
import { endSetup, pushIfNewer, saveDraft, saveSetup, setLater, useSetupDraft } from "./setup-store";
import type { FitView } from "./store";
import type { Exercise } from "./types";
import "./setup.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const now = () => new Date().toISOString();
const STEP_TERM: Partial<Record<Step, TermKey>> = { goal: "setup", days: "days-week", length: "session-length", level: "experience", gear: "equipment", avoid: "avoid", plan: "program" };
const GOAL_TERM = { muscle: "goal-muscle", strength: "goal-strength", fat: "goal-fat", fit: "goal-fit", custom: "goal-custom" } as const;

export function Setup({ v, desk, go, onExit }: { v: FitView; desk?: boolean; go: (s: FitSection, arg?: FitArg) => void; onExit: () => void }) {
  const stored = useSetupDraft(v);
  // Nothing is saved until the first real step, so opening setup and leaving at once leaves no "Continue setup" behind.
  const [fresh] = useState(() => newDraft(now()));
  const d = stored ?? fresh;
  const set = (x: SetupDraft) => saveDraft(x);
  const [sheet, setSheet] = useState<null | { k: "add"; dayId: string } | { k: "swap"; dayId: string; exId: string }>(null);
  useEffect(() => { pushIfNewer(v); }, [v.ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back one step (the top Back, Esc, the phone's gesture). The first step leaves it to the shell (back to home).
  const dRef = useRef(d);
  dRef.current = d;
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  useEffect(() => {
    const f = (e: Event) => {
      if (e.defaultPrevented || sheetRef.current || document.querySelector(".fi-card")) return;
      const b = goBack(dRef.current, now());
      if (!b) return;
      e.preventDefault();
      haptic("press");
      saveDraft(b);
    };
    window.addEventListener("gos-back", f);
    return () => window.removeEventListener("gos-back", f);
  }, []);
  // A new step starts at the top.
  const top = useRef<HTMLDivElement>(null);
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) { firstStep.current = false; return; }
    const el = top.current;
    el?.closest(".fit-view")?.scrollTo?.({ top: 0 });
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });   // the website: the page itself scrolls
  }, [d.step]);

  const next = () => { haptic("press"); set(goNext(d, now())); };
  const back = () => { const b = goBack(d, now()); haptic("press"); if (b) set(b); else onExit(); };
  const skip = () => { haptic("press"); set(skipStep(d, now())); };
  const answer = (patch: Parameters<typeof withAnswer>[1], advance = false) => {
    haptic("tick");
    const x = withAnswer(d, patch, now());
    set(x);
    if (advance) window.setTimeout(() => { if (dRef.current.at === x.at) set(goNext(x, now())); }, 260);
  };
  const ownProgram = () => { haptic("press"); void endSetup(); go("plan"); };
  const notNow = () => { haptic("press"); setLater(true); onExit(); };

  const step = d.step;
  const prog = progressOf(d);
  const term = STEP_TERM[step];
  return (
    <div ref={top} className={cx("fsu", desk && "fsu-desk")} data-fit-owns-back={step !== "start" || sheet ? "" : undefined} data-step={step}>
      {step !== "start" && (
        <div className="fsu-prog" aria-label={step === "plan" ? "Your plan" : `Question ${prog.i} of ${prog.n}`}>
          <div className="fsu-bar" aria-hidden="true">{Array.from({ length: prog.n }, (_, i) => <i key={i} className={i < prog.i ? "on" : ""} />)}</div>
          <span>{step === "plan" ? (d.plan?.scratch ? "Your program" : "Your plan") : `Question ${prog.i} of ${prog.n}`}</span>
          <span className="fsu-saved">Saved as you go</span>
        </div>
      )}

      {step === "start" && (
        <section className="fsu-start">
          <h2 className="fsu-h">Set up your training<Info k="setup" /></h2>
          <p className="fsu-lead">Six quick questions, then a plan made for you from {LIBRARY.length} exercises, each with a picture. Change anything before you save it.</p>
          <p className="fsu-lead">Every answer is saved as you go. Stop any time and carry on later, on this device or another.</p>
          <button type="button" className="fsu-go" onClick={next}>Answer a few questions</button>
          <div className="fsu-alt">
            <button type="button" className="fsu-card" onClick={() => { haptic("press"); set(scratchPlan(d, now())); }}>
              <b>Start from scratch</b><span>Empty days you fill with exercises yourself</span>
            </button>
            <button type="button" className="fsu-card" onClick={ownProgram}>
              <b>Use my own program</b><span>Type in your plan or import your trainer's sheet</span>
            </button>
          </div>
          <button type="button" className="fsu-link" onClick={notNow}>Not now</button>
        </section>
      )}

      {step === "goal" && (
        <Question title="What is your main goal?" term={term!} sub="It sets your reps, rest and how hard each set should be.">
          <div className="fsu-list" role="radiogroup" aria-label="Goal">
            {GOALS.map((g) => (
              <Choice key={g.k} on={d.a.goal === g.k} title={g.t} line={g.d} term={GOAL_TERM[g.k]} onPick={() => answer({ goal: g.k }, g.k !== "custom")} />
            ))}
          </div>
          {d.a.goal === "custom" && (
            <label className="fsu-field">
              <span>Your goal in a few words</span>
              <input type="text" maxLength={80} placeholder="For example: a stronger back for climbing" value={d.a.custom ?? ""}
                onChange={(e) => set(withAnswer(d, { custom: e.target.value }, now()))} />
            </label>
          )}
        </Question>
      )}

      {step === "days" && (
        <Question title="How many days a week can you train?" term={term!} sub="Pick what you can keep up on a busy week. It becomes your week goal.">
          <div className="fsu-nums" role="radiogroup" aria-label="Days a week">
            {DAY_CHOICES.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={d.a.days === n} className={cx("fsu-num", d.a.days === n && "on")} onClick={() => answer({ days: n }, true)}>
                <b className="f-num">{n}</b><small>{n === 1 ? "day" : "days"}</small>
              </button>
            ))}
          </div>
          <p className="fsu-note">{splitWords(resolved(d.a).days, d.a.days == null)}<Info k="split" /></p>
        </Question>
      )}

      {step === "length" && (
        <Question title="How long is one session?" term={term!} sub="About, rests included. The plan fits its exercises into this time.">
          <div className="fsu-nums" role="radiogroup" aria-label="Session length">
            {MIN_CHOICES.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={d.a.mins === m} className={cx("fsu-num", d.a.mins === m && "on")} onClick={() => answer({ mins: m }, true)}>
                <b className="f-num">{m}</b><small>min</small>
              </button>
            ))}
          </div>
        </Question>
      )}

      {step === "level" && (
        <Question title="How much lifting have you done?" term={term!} sub="Newer lifters start on machines, which are easier to learn and safer.">
          <div className="fsu-list" role="radiogroup" aria-label="Experience">
            {LEVELS.map((l) => <Choice key={l.k} on={d.a.level === l.k} title={l.t} line={l.d} onPick={() => answer({ level: l.k }, true)} />)}
          </div>
        </Question>
      )}

      {step === "gear" && (
        <Question title="Where do you train?" term={term!} sub="The plan only uses exercises you can do there.">
          <div className="fsu-list" role="radiogroup" aria-label="Equipment">
            {GEARS.map((g) => <Choice key={g.k} on={d.a.gear === g.k} title={g.t} line={g.d} onPick={() => answer({ gear: g.k }, true)} />)}
          </div>
        </Question>
      )}

      {step === "avoid" && (
        <Question title="Anything to go easy on?" term={term!} sub="Pick any joint that hurts or that you want to protect. Leave it empty if all is well.">
          <div className="fsu-chips" role="group" aria-label="Areas to go easy on">
            {AREAS.map((a) => {
              const on = (d.a.avoid ?? []).includes(a.k);
              return (
                <button key={a.k} type="button" aria-pressed={on} className={cx("fsu-chip", on && "on")}
                  onClick={() => answer({ avoid: on ? (d.a.avoid ?? []).filter((x) => x !== a.k) : [...(d.a.avoid ?? []), a.k as Area] })}>{a.t}</button>
              );
            })}
          </div>
          <p className="fsu-note">For real pain, check with a doctor or physio first.</p>
        </Question>
      )}

      {step === "plan" && d.plan && (
        <PlanStep d={d} v={v} set={set} onSheet={setSheet} />
      )}

      {/* the dock: Back, Skip, Next for the questions; Save for the plan */}
      {step !== "start" && step !== "plan" && (
        <div className="fsu-dock">
          <button type="button" className="fsu-back" onClick={back}>Back</button>
          <button type="button" className="fsu-skip" onClick={skip}>Skip</button>
          <button type="button" className="fsu-next" onClick={next}>{step === "avoid" ? "See my plan" : "Next"}</button>
        </div>
      )}
      {step === "plan" && d.plan && <SaveDock d={d} back={back} go={go} onExit={onExit} />}

      {sheet && d.plan && (
        <PickSheet host={top.current?.closest(".fit") as HTMLElement | null} d={d} v={v} sheet={sheet} onClose={() => setSheet(null)} onPick={(id) => {
          haptic("press");
          const p = sheet.k === "add" ? addEx(d.plan!, sheet.dayId, id, d.a, v.prefs) : swapEx(d.plan!, sheet.dayId, sheet.exId, id, d.a, v.prefs);
          set({ ...d, plan: p, at: now() });
          setSheet(null);
        }} />
      )}
    </div>
  );
}

/** "3 days: full body each time" for the days question. */
function splitWords(days: number, unset: boolean): string {
  const s = days <= 2 ? "full body each time" : days === 3 ? "full body, or push, pull and legs if you have some experience" : days === 4 ? "upper body and lower body, twice each"
    : days === 5 ? "upper, lower, push, pull and legs" : "push, pull and legs, twice each";
  return `${unset ? "Not sure? 3 is a great start. " : ""}${days} ${days === 1 ? "day" : "days"}: ${s}.`;
}

function Question({ title, sub, term, children }: { title: string; sub: string; term: TermKey; children: ReactNode }) {
  return (
    <section className="fsu-q">
      <h2 className="fsu-h">{title}<Info k={term} /></h2>
      <p className="fsu-lead">{sub}</p>
      {children}
    </section>
  );
}
function Choice({ on, title, line, term, onPick }: { on: boolean; title: string; line: string; term?: TermKey; onPick: () => void }) {
  return (
    <div className={cx("fsu-choice", on && "on")}>
      <button type="button" role="radio" aria-checked={on} className="fsu-choice-b" onClick={onPick}>
        <span className="fsu-dot" aria-hidden="true" />
        <span className="fsu-choice-t"><b>{title}</b><small>{line}</small></span>
      </button>
      {term && <Info k={term} className="fsu-choice-i" />}
    </div>
  );
}

// ---------- the plan: look, change, save ----------
function PlanStep({ d, v, set, onSheet }: { d: SetupDraft; v: FitView; set: (x: SetupDraft) => void; onSheet: (s: { k: "add"; dayId: string } | { k: "swap"; dayId: string; exId: string }) => void }) {
  const p = d.plan!;
  const r = resolved(d.a);
  const edit = (np: DraftPlan) => set({ ...d, plan: np, at: now() });
  const [open, setOpen] = useState<string | null>(null);
  const goal = GOALS.find((g) => g.k === r.goal)!;
  const mins = Math.max(0, ...p.days.map((x) => dayMinutes(x, v.prefs)));
  return (
    <section className="fsu-plan">
      <label className="fsu-name">
        <span className="fsu-label">Name<Info k="program" /></span>
        <input type="text" maxLength={80} value={p.name} onChange={(e) => edit(renamePlan(p, e.target.value))} aria-label="Program name" />
      </label>
      <p className="fsu-sum">
        {p.scratch
          ? `${plural(p.days.length, "day")}. Add the exercises you want on each day.`
          : `${plural(p.days.length, "day")} a week · up to about ${mins} min · ${r.goal === "custom" && r.custom ? r.custom : goal.t}`}
      </p>
      {planStale(d) && (
        <div className="fsu-stale">
          <p>You changed your answers after editing this plan.</p>
          <button type="button" className="fsu-btn" onClick={() => { haptic("press"); set(rebuild(d, now())); }}>Make a new suggestion</button>
        </div>
      )}
      <p className="fsu-note">Tap an exercise to change its sets or rest, swap it or take it out. You pick the weights in the gym the first time.</p>
      {p.days.map((day) => (
        <DayCard key={day.id} day={day} v={v} plan={p} edit={edit} open={open} setOpen={setOpen} onSheet={onSheet} />
      ))}
      {p.days.length < 7 && <button type="button" className="fsu-add-day" onClick={() => { haptic("press"); edit(addDay(p)); }}>Add a day</button>}
    </section>
  );
}
function DayCard({ day, v, plan, edit, open, setOpen, onSheet }: { day: FitDay; v: FitView; plan: DraftPlan; edit: (p: DraftPlan) => void; open: string | null; setOpen: (id: string | null) => void; onSheet: (s: { k: "add"; dayId: string } | { k: "swap"; dayId: string; exId: string }) => void }) {
  const mins = dayMinutes(day, v.prefs);
  return (
    <div className="fsu-day">
      <div className="fsu-day-h">
        <span className="fsu-day-n">{day.name}<Info k="program-day" /></span>
        <input className="fsu-day-t" type="text" maxLength={60} value={day.title ?? ""} placeholder="Name this day (optional)" aria-label={`${day.name} name`}
          onChange={(e) => edit(renameDay(plan, day.id, e.target.value))} />
        <span className="fsu-day-m">{day.exercises.length ? `about ${mins} min` : "empty"}</span>
      </div>
      <ol className="fsu-exs">
        {day.exercises.map((e, i) => (
          <ExRow key={e.id} e={e} i={i} n={day.exercises.length} day={day} v={v} plan={plan} edit={edit} open={open === e.id}
            toggle={() => { haptic("press"); setOpen(open === e.id ? null : e.id); }} onSwap={() => onSheet({ k: "swap", dayId: day.id, exId: e.id })} />
        ))}
      </ol>
      <div className="fsu-day-f">
        <button type="button" className="fsu-btn" onClick={() => { haptic("press"); onSheet({ k: "add", dayId: day.id }); }}>Add an exercise</button>
        {plan.days.length > 1 && <button type="button" className="fsu-btn quiet" onClick={() => { haptic("press"); edit(removeDay(plan, day.id)); }}>Remove {day.name}</button>}
      </div>
    </div>
  );
}
const REST_PICKS = [null, 60, 90, 120, 180] as const;
function ExRow({ e, i, n, day, v, plan, edit, open, toggle, onSwap }: { e: FitPlanEx; i: number; n: number; day: FitDay; v: FitView; plan: DraftPlan; edit: (p: DraftPlan) => void; open: boolean; toggle: () => void; onSwap: () => void }) {
  const rest = restFor(e, v.prefs);
  const def = restFor({ ...e, rest: null }, { ...v.prefs, restBy: undefined, restKind: undefined });
  const kind = e.kind === "isolation" ? "isolation" : "compound";
  return (
    <li className={cx("fsu-ex", open && "open")}>
      <div className="fsu-ex-row">
        <ExPic exId={e.exId} name={e.name} size={56} className="fsu-ex-pic" />
        <button type="button" className="fsu-ex-b" onClick={toggle} aria-expanded={open}>
          <span className="fsu-ex-n">{e.name}</span>
          <span className="fsu-ex-s">{setsLine(e)} · rest {fmtClock(rest)}{e.rir != null ? ` · RIR ${e.rir}` : ""}</span>
          <span className="fsu-ex-k">{kind === "compound" ? "Big lift" : "Small lift"}</span>
        </button>
        <Info k={kind} className="fsu-ex-i" />
      </div>
      {open && (
        <div className="fsu-ex-edit">
          <div className="fsu-row">
            <span className="fsu-label">Sets<Info k="set" /></span>
            <div className="fsu-step">
              <button type="button" onClick={() => { haptic("tick"); edit(setSets(plan, day.id, e.id, e.sets.length - 1)); }} disabled={e.sets.length <= 1} aria-label="One set less">-</button>
              <b className="f-num" aria-live="polite">{e.sets.length}</b>
              <button type="button" onClick={() => { haptic("tick"); edit(setSets(plan, day.id, e.id, e.sets.length + 1)); }} disabled={e.sets.length >= 12} aria-label="One set more">+</button>
            </div>
          </div>
          <div className="fsu-row col">
            <span className="fsu-label">Rest between sets<Info k={kind === "compound" ? "long-rest" : "short-rest"} /></span>
            <div className="fsu-rests" role="radiogroup" aria-label="Rest">
              {REST_PICKS.map((s) => {
                const on = s == null ? e.rest == null : e.rest === s;
                return (
                  <button key={String(s)} type="button" role="radio" aria-checked={on} className={cx("fsu-chip", on && "on")}
                    onClick={() => { haptic("tick"); edit(setRest(plan, day.id, e.id, s)); }}>
                    {s == null ? <>Usual <small className="f-num">{fmtClock(def)}</small></> : <span className="f-num">{fmtClock(s)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="fsu-acts">
            <button type="button" className="fsu-btn" onClick={() => { haptic("press"); onSwap(); }}>Swap</button>
            <button type="button" className="fsu-btn quiet" disabled={i === 0} onClick={() => { haptic("press"); edit(moveEx(plan, day.id, e.id, -1)); }}>Move up</button>
            <button type="button" className="fsu-btn quiet" disabled={i === n - 1} onClick={() => { haptic("press"); edit(moveEx(plan, day.id, e.id, 1)); }}>Move down</button>
            <button type="button" className="fsu-btn bad" onClick={() => { haptic("press"); edit(removeEx(plan, day.id, e.id)); }}>Remove</button>
          </div>
        </div>
      )}
    </li>
  );
}
function SaveDock({ d, back, go, onExit }: { d: SetupDraft; back: () => void; go: (s: FitSection, arg?: FitArg) => void; onExit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const empty = !d.plan!.days.some((x) => x.exercises.length);
  const save = () => {
    if (busy) return;
    setBusy(true); haptic("press");
    saveSetup(d).then(() => { haptic("press"); onExit(); }).catch(() => { setBusy(false); haptic("reject"); });
  };
  return (
    <div className="fsu-dock plan">
      <button type="button" className="fsu-back" onClick={back}>Back</button>
      <button type="button" className={cx("fsu-next", busy && "busy")} onClick={save} disabled={busy}>{empty ? "Save, add exercises later" : "Save my program"}</button>
      <button type="button" className="fsu-link small" onClick={() => {
        if (!sure) { haptic("press"); setSure(true); window.setTimeout(() => setSure(false), 3500); return; }
        haptic("press"); void endSetup(); go("home");
      }}>{sure ? "Tap again to throw this setup away" : "Discard setup"}</button>
    </div>
  );
}

// ---------- Add and Swap: library exercises that fit, with their pictures ----------
// Portalled to the Fitness root: the screen it opens from scrolls inside an animated (transformed) box, which would
// carry a fixed layer away with the scroll.
function PickSheet({ host, d, v, sheet, onClose, onPick }: { host: HTMLElement | null; d: SetupDraft; v: FitView; sheet: { k: "add"; dayId: string } | { k: "swap"; dayId: string; exId: string }; onClose: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [out, setOut] = useState(false);
  const r = resolved(d.a);
  const day = d.plan!.days.find((x) => x.id === sheet.dayId)!;
  const ex = sheet.k === "swap" ? day.exercises.find((x) => x.id === sheet.exId) ?? null : null;
  const close = () => { setOut(true); window.setTimeout(onClose, 180); };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const backF = (e: Event) => { if (document.querySelector(".fi-card, .xp-card:not(.out)")) return; e.preventDefault(); e.stopImmediatePropagation(); closeRef.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".fi-card, .xp-card:not(.out)")) { e.preventDefault(); e.stopImmediatePropagation(); closeRef.current(); } };
    window.addEventListener("gos-back", backF, true);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("gos-back", backF, true); window.removeEventListener("keydown", key, true); };
  }, []);
  const taken = new Set(day.exercises.map((x) => x.exId));
  const list: Exercise[] = useMemo(() => {
    if (q.trim()) return searchExercises(q, 40).filter((x) => fitsGear(x.equipment, r.gear) && !x.timed && !taken.has(x.id)).slice(0, 24);
    if (ex) return swapChoices(ex, day, d.a, 12);
    // Add with no search: the movements the rules use, best first, then the rest of the library that fits.
    const seen = new Set<string>(), outL: Exercise[] = [];
    for (const s of Object.keys(SLOTS) as (keyof typeof SLOTS)[]) for (const id of candidates(s, r).slice(0, 2)) {
      const x = LIBRARY.find((y) => y.id === id);
      if (x && !seen.has(id) && !taken.has(id)) { seen.add(id); outL.push(x); }
    }
    return outL.slice(0, 24);
  }, [q, ex, day, d.a]); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div className={cx("fsu-sheet", out && "out")} role="dialog" aria-modal="true" aria-label={ex ? `Swap ${ex.name}` : `Add to ${day.name}`}>
      <div className="fsu-sheet-bg" onClick={close} />
      <div className="fsu-sheet-in">
        <div className="fsu-sheet-h">
          <b>{ex ? `Swap ${ex.name}` : `Add to ${day.name}`}</b>
          <button type="button" className="fsu-x" onClick={close} aria-label="Close"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <ScanSearch className="fsu-search" value={q} onChange={setQ} label="Search exercises" placeholder="Search exercises" prefs={v.prefs} />
        <p className="fsu-note">{q.trim() ? `Exercises you can do with ${GEARS.find((g) => g.k === r.gear)!.t.toLowerCase()}.` : ex ? "Good swaps: the same movement first, then the same muscle." : "Good picks for your plan. Search for anything else."}</p>
        <ul className="fsu-picks">
          {list.map((x) => (
            <li key={x.id}>
              <ExPic exId={x.id} name={x.name} size={52} />
              <button type="button" className="fsu-pick" onClick={() => onPick(x.id)}>
                <b>{x.name}</b><small>{x.kind === "compound" ? "Big lift" : "Small lift"} · {x.equipment}</small>
              </button>
            </li>
          ))}
          {!list.length && <li className="fsu-none">Nothing found. Try another word.</li>}
        </ul>
      </div>
    </div>,
    host ?? document.body,
  );
}

/** Home's card while a setup is saved but not finished (V1.47). */
export function SetupCard({ d, onOpen, onDiscard }: { d: SetupDraft; onOpen: () => void; onDiscard: () => void }) {
  const [sure, setSure] = useState(false);
  const p = progressOf(d);
  const where = d.step === "plan" ? (d.plan?.scratch ? "Your program is waiting for exercises" : "Your plan is ready to check") : d.step === "start" ? "Just started" : `Question ${p.i} of ${p.n}`;
  return (
    <section className="fn-hero fsu-home" aria-label="Setup saved">
      <p className="fn-kick">Setup saved · {where}</p>
      <h2 className="fsu-home-h">Finish setting up your training<Info k="setup" /></h2>
      <p className="fn-sub">Carry on exactly where you left off. Nothing is lost.</p>
      <button type="button" className="fn-go" onClick={() => { haptic("press"); onOpen(); }}>Continue setup</button>
      <button type="button" className="fn-link" onClick={() => {
        if (!sure) { haptic("press"); setSure(true); window.setTimeout(() => setSure(false), 3500); return; }
        haptic("press"); onDiscard();
      }}>{sure ? "Tap again to throw it away" : "Discard setup"}</button>
    </section>
  );
}

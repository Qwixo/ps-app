// Pomodoro (V1.58, the developer 13 Nov 2026: "Add a Pomodoro timer too. Add it as a button on the display"). The button sits in
// the Tab list's bottom row next to Dimension X, Fitness and the Soundboard (TaskMap.tsx, slot "pomodoro"); the small
// screen grows out of it like they do (views/DimensionX.tsx morph) and goes back into it. Start, Pause, Skip and Stop.
// The first time it opens on the Mac, a card recommends the Dynamic Island ("It recommends using the dynamic island
// when you first launch it, but it's not a requirement"), with a button that turns it on; Not now and Esc skip it.
// The rules are core/pomodoro.ts; the buttons run where the vault is (src/pomodoro.ts). Not on the phone.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PS, psPost } from "../ps";
import { GOS } from "../gos/bridge";
import { sfx } from "../ui/sfx";
import { useVault } from "../ui/kit";
import { restBehind } from "../ui/screenrest";
import { settingsData } from "../core/select";
import { islandPrefs } from "../core/island";
import { POMO_LIMITS, POMO_WORDS as W, clock, cleanRun, isBreak, msLeft, pomoPrefs, progress, resolve, sessionLine, type PomoOp, type PomoPrefs, type PomoRun } from "../core/pomodoro";
import { runPomoOp, startPomodoro } from "../pomodoro";
import type { Settings } from "../core/model";
import { morph } from "./DimensionX";
import { Choice, taskMapActions } from "./TaskMap";
import { openSettings } from "./SettingsScreen";
import { Stepper } from "./IslandTimersSettings";
import "./pomodoro.css";

const MORPH = { body: ".pm-body", tint: ".pm-morph" };
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
let isOpen = false;
export const pomodoroIsOpen = () => isOpen;

/** A button: on PS the Tab list sends it to the main window (it has the vault), the website runs it here. */
export function pomoAct(op: PomoOp) {
  if (PS) void taskMapActions.looks({ pomoOp: { op } } as Partial<Settings>);
  else void runPomoOp(op);
}

/** The time now, every `ms` while `on` (the screen ticks 4 times a second so a second never shows late). */
function useNow(on: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [on, ms]);
  return on ? now : Date.now();
}

function usePomo(tick: boolean, ms?: number): { st: Settings; prefs: PomoPrefs; run: PomoRun | null; now: number } {
  const v = useVault();
  const st = settingsData(v);
  const prefs = pomoPrefs(st.pomodoro);
  const saved = cleanRun(st.pomoRun);
  const now = useNow(tick || !!saved, ms);
  return { st, prefs, run: prefs.on ? resolve(saved, prefs, now) : null, now };
}

export const TomatoIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="13.5" r="7.5" /><path d="M12 6V3.5M9 4.5l3 1.5 3-1.5M12 13.5V10.5M12 13.5l2.2 1.6" />
  </svg>
);

type Phase = "closed" | "open" | "closing";

/** The bottom row button (Mac Tab list, website), and the screen it opens. Hidden with Pomodoro off in Settings. */
export function PomodoroButton({ docked }: { docked?: boolean }) {
  const btn = useRef<HTMLButtonElement>(null);
  const { st, prefs, run, now } = usePomo(false);
  // The website runs its own Pomodoro (PS runs it in the main window, src/ps.ts): each phase saved as it ends.
  useEffect(() => { if (!PS && !GOS) startPomodoro(); }, []);
  useWebSounds(run, prefs);
  if (GOS || !prefs.on) return null;
  const live = run && !run.wait;
  const label = live ? `${clock(msLeft(run, now))}${run.left !== null ? ` ${W.paused}` : ""}` : W.button;
  const kind = run ? (isBreak(run.phase) ? " brk" : " wrk") : "";
  return (
    <>
      <button ref={btn} type="button" className={`pm-tab-btn${kind}${live ? " on" : ""}`} onMouseDown={(e) => e.stopPropagation()}
        onClick={() => openPomodoro(btn.current)} aria-label={live ? `Open Pomodoro, ${W.phase[run.phase]}, ${label} left` : "Open Pomodoro"} title={W.button}>
        <TomatoIcon /><span className="pm-tab-label">{label}</span>
      </button>
      <PomodoroHost anchor={() => btn.current} docked={docked} st={st} />
    </>
  );
}

/** The website plays the chimes itself (PS plays them from the island, ps-mac IslandPomo.swift, with Do Not Disturb). */
function useWebSounds(run: PomoRun | null, prefs: PomoPrefs) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    const key = run ? `${run.id}${run.wait ? "w" : ""}` : null;
    const was = last.current;
    last.current = key;
    if (PS || GOS || !prefs.sound || !run || was === null || was === key) return;
    if (!run.wait && run.phase === "work" && run.back) sfx.island("done");
    else if (isBreak(run.phase)) sfx.island("start");
  }, [run?.id, run?.wait]);   // eslint-disable-line react-hooks/exhaustive-deps
}

const OPEN_EV = "ps-pomo-open";
/** Opens the Pomodoro screen from anywhere (Settings, a search). */
export function openPomodoro(from?: HTMLElement | null) { window.dispatchEvent(new CustomEvent(OPEN_EV, { detail: from ?? null })); }

function PomodoroHost({ anchor, docked, st }: { anchor: () => HTMLElement | null; docked?: boolean; st: Settings }) {
  const [phase, setPhase] = useState<Phase>("closed");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const win = useRef<HTMLDivElement>(null), dim = useRef<HTMLDivElement>(null);
  const from = useRef<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  // The first card: on the Mac only (the island is the Mac's), once, until it is answered.
  const [intro, setIntro] = useState(false);
  useLayoutEffect(() => { setHost(docked ? document.body : anchor()?.closest<HTMLElement>(".tm-overlay") ?? document.body); }, [docked]);   // eslint-disable-line react-hooks/exhaustive-deps

  const open = (el?: HTMLElement | null) => {
    if (phaseRef.current === "open") return;
    from.current = el ?? anchor();
    setIntro(PS && st.pomoIntro !== true);
    sfx.click(); setPhase("open");
  };
  const close = () => { if (phaseRef.current !== "open") return; sfx.drop(); setPhase("closing"); };
  useEffect(() => {
    const f = (e: Event) => open((e as CustomEvent<HTMLElement | null>).detail);
    window.addEventListener(OPEN_EV, f);
    return () => window.removeEventListener(OPEN_EV, f);
  });
  useLayoutEffect(() => {
    const root = anchor()?.closest<HTMLElement>(".tm-overlay");
    if (phase === "open") {
      isOpen = true;
      restBehind(root, "pomodoro", true);
      if (PS) psPost({ type: "dimx", open: true }); else taskMapActions.editing(true);   // the list stays when Tab is let go
      void morph(win.current, from.current ?? anchor(), dim.current, "in", MORPH);
    } else if (phase === "closing") {
      isOpen = false;
      if (PS) psPost({ type: "dimx", open: false }); else taskMapActions.editing(false);
      const a = document.activeElement as HTMLElement | null;
      if (a && win.current?.contains(a)) a.blur();
      void morph(win.current, anchor(), dim.current, "out", MORPH).then(() => {
        restBehind(root, "pomodoro", false);
        setPhase((p) => (p === "closing" ? "closed" : p));
      });
    }
  }, [phase]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (isOpen) { isOpen = false; if (PS) psPost({ type: "dimx", open: false }); } }, []);

  const answer = (turnOn: boolean) => {
    setIntro(false);
    sfx.drop();
    const patch: Partial<Settings> = { pomoIntro: true };
    if (turnOn) patch.island = { ...islandPrefs(st.island), mode: "notch" } as Settings["island"];
    void taskMapActions.looks(patch);
  };
  // Esc: the first card first (as Not now), then the screen.
  const introRef = useRef(intro);
  introRef.current = intro;
  useEffect(() => {
    if (phase !== "open") return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault(); e.stopImmediatePropagation();
        if (introRef.current) answer(false); else close();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (introRef.current || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON"))) return;
      if (e.key === " " && !e.metaKey && !e.ctrlKey) { e.preventDefault(); spaceRef.current(); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [phase]);   // eslint-disable-line react-hooks/exhaustive-deps
  const spaceRef = useRef<() => void>(() => {});

  if (!host || phase === "closed") return null;
  return createPortal(
    <div className={`pm-layer${docked ? " docked" : ""}`} onMouseDown={(e) => e.stopPropagation()}>
      <div ref={dim} className="pm-dim" aria-hidden="true" onClick={close} />
      <div ref={win} className="pm-win" role="dialog" aria-modal="true" aria-label={W.title}>
        <div className="pm-morph" aria-hidden="true" />
        <PomodoroScreen onClose={close} space={spaceRef} docked={docked} />
        {intro && <IntroCard islandOn={islandPrefs(st.island).mode !== "off"} onAnswer={answer} />}
      </div>
    </div>,
    host,
  );
}

/** The screen: the phase, a ring with the time left, the session, and the buttons for this moment. */
function PomodoroScreen({ onClose, space, docked }: { onClose: () => void; space: { current: () => void }; docked?: boolean }) {
  const { prefs, run, now } = usePomo(true, 250);
  const press = (op: PomoOp) => { sfx.click(); pomoAct(op); };
  const kind = run ? run.phase : "work";
  const left = run ? msLeft(run, now) : prefs.work * 60_000;
  const frac = run ? progress(run, prefs, now) : 0;
  const paused = !!run && !run.wait && run.left !== null;
  const title = !run ? W.idle : run.wait ? W.ready[run.phase] : paused ? `${W.phase[run.phase]}, ${W.paused.toLowerCase()}` : W.phase[run.phase];
  space.current = () => press(!run ? "start" : run.wait ? "begin" : paused ? "resume" : "pause");
  const R = 88, C = 2 * Math.PI * R;
  const dots = Array.from({ length: prefs.rounds }, (_, i) => {
    const done = run ? (run.phase === "long" ? prefs.rounds : run.done) : 0;
    return i < done ? "done" : run && run.phase === "work" && i === run.done ? "now" : "";
  });
  return (
    <div className={`pm-body pm-${kind}${paused ? " pm-paused" : ""}`}>
      <header className="pm-head">
        <span className="pm-title"><TomatoIcon size={17} />{W.title}</span>
        <span className="pm-head-r">
          <button type="button" className="pm-icon" onClick={() => { onClose(); window.setTimeout(() => openSettings("pomodoro", { owner: docked ? "docked" : "tab" }), 170); }}
            aria-label={W.settings} title={W.settings}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
          </button>
          <button type="button" className="pm-icon" onClick={onClose} aria-label="Close" title="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </span>
      </header>
      <div className="pm-phase" key={`${run?.id ?? "idle"}${run?.wait ? "w" : ""}`}>{title}</div>
      <div className="pm-ring">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle className="pm-track" cx="100" cy="100" r={R} />
          <circle className="pm-arc" cx="100" cy="100" r={R} strokeDasharray={C} strokeDashoffset={C * frac} transform="rotate(-90 100 100)" />
        </svg>
        <div className="pm-mid">
          <div className="pm-time" role="timer" aria-live="off">{clock(left)}</div>
          <div className="pm-sess">{sessionLine(run, prefs)}</div>
        </div>
      </div>
      <div className="pm-dots" aria-hidden="true">{dots.map((d, i) => <i key={i} className={d} />)}</div>
      <div className="pm-actions">
        {!run && <button type="button" className="pm-btn main" onClick={() => press("start")}>{W.start}</button>}
        {run && run.wait && <button type="button" className="pm-btn main" onClick={() => press("begin")}>{isBreak(run.phase) ? W.startBreak : W.startWork}</button>}
        {run && !run.wait && (paused
          ? <button type="button" className="pm-btn main" onClick={() => press("resume")}>{W.resume}</button>
          : <button type="button" className="pm-btn main" onClick={() => press("pause")}>{W.pause}</button>)}
        {run && <button type="button" className="pm-btn" onClick={() => press("skip")}>{W.skip}</button>}
        {run && <button type="button" className="pm-btn quiet" onClick={() => press("stop")}>{W.stop}</button>}
      </div>
    </div>
  );
}

/** The first card: what the island does in a break, and a button that turns it on. Skippable; Esc is Not now. */
function IntroCard({ islandOn, onAnswer }: { islandOn: boolean; onAnswer: (turnOn: boolean) => void }) {
  return (
    <div className="pm-intro" role="dialog" aria-modal="true" aria-labelledby="pm-intro-h">
      <div className={`pm-intro-card${reduced() ? " calm" : ""}`}>
        <div className="pm-demo" aria-hidden="true">
          <div className="pm-demo-isl">
            <span className="pm-demo-task"><i className="pm-demo-ring" />Write the proposal</span>
            <span className="pm-demo-timer">4:59</span>
            <span className="pm-demo-back"><i className="pm-demo-tick" />{W.back}</span>
          </div>
        </div>
        <h3 id="pm-intro-h">{W.introTitle}</h3>
        <p>{W.introBody}</p>
        <p className="pm-intro-dim">{islandOn ? W.introOn : W.introSkip}</p>
        <div className="pm-intro-acts">
          {islandOn
            ? <button type="button" className="pm-btn main" onClick={() => onAnswer(false)} autoFocus>{W.introGotIt}</button>
            : <>
                <button type="button" className="pm-btn main" onClick={() => onAnswer(true)} autoFocus>{W.introTurnOn}</button>
                <button type="button" className="pm-btn quiet" onClick={() => onAnswer(false)}>{W.introNotNow}</button>
              </>}
        </div>
      </div>
    </div>
  );
}

// ---------- Settings, Pomodoro (core/settingsindex.ts "pomo-*", drawn by views/SettingsGroups.tsx) ----------
type PomoKey = keyof PomoPrefs;
const MINUTES: Partial<Record<PomoKey, readonly [number, number]>> = { work: POMO_LIMITS.work, short: POMO_LIMITS.short, long: POMO_LIMITS.long, rounds: POMO_LIMITS.rounds };
/** One Pomodoro setting: On and Off, or a number with minus and plus. Saved for every device. */
export function PomoSetting({ k }: { k: PomoKey }) {
  const v = useVault();
  const prefs = pomoPrefs(settingsData(v).pomodoro);
  const ready = v.status === "unlocked";
  const set = (val: boolean | number) => { if (ready) void taskMapActions.looks({ pomodoro: { ...prefs, [k]: val } }); };
  const range = MINUTES[k];
  if (range) return <Stepper n={prefs[k] as number} range={range} unit={k === "rounds" ? "" : " min"} ready={ready} label={k} set={set} />;
  const on = prefs[k] as boolean;
  return (
    <span className="pm-set-row">
      {k === "sound" && <button type="button" className="pm-play" onClick={() => sfx.island("done")} aria-label="Play the sound" title="Play">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
      </button>}
      <span className={`tm-ed-seg${ready ? "" : " gs-notyet"}`} role="radiogroup" aria-label={k}>
        <Choice selected={ready && on} onPick={() => { sfx.hover(); set(true); }}>On</Choice>
        <Choice selected={ready && !on} onPick={() => { sfx.hover(); set(false); }}>Off</Choice>
      </span>
    </span>
  );
}

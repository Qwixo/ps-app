// PS Fitness: Fitness settings. The look (three live previews; a tap switches the whole Fitness screen with
// a crossfade), rest times, the week goal, which day is next and its lock, the Mac's rest sound, a short
// "How this works" for a beginner, and the privacy line. Everything saves to the vault's "fit" record, except the
// gym reminder (core/gym.ts), which lives in the settings record with the cards it drives.
import { isRedAccount } from "../core/account";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { settingsData } from "../core/select";
import { gymEnd, gymPrefs, gymRingAt, gymToday, GYM, YES_WORDS, type GymPrefs } from "../core/gym";
import { homeTz } from "../core/tz";
import { useVault } from "../ui/kit";
import { taskMapActions } from "../views/TaskMap";
import { clampRest, dayLabel, fmtClock, ownRestCount, rirLabel, REST_COMPOUND, REST_ISOLATION, REST_MAX, REST_MIN, REST_STEP, RIR_VALUES, SETS_HI, SETS_LO, setsDefault, type FitPrefs, type FitStyle } from "../core/fitness";
import { haptic } from "../gos/bridge";
import { RestNum } from "./RestNum";
import { savePrefs, type FitView } from "./store";
import { plural } from "./hist-logic";
import { useFitTheme } from "./theme";
import { SleepPrefs } from "./Sleep";
import { SquadShareSettings } from "./Squad";
import { Glossary, Info } from "./Info";
import type { TermKey } from "./glossary";
import { progressOf } from "./setup-logic";
import { useSetupDraft } from "./setup-store";
import "./settings.css";
import { appName } from "../core/appname";

const LOOKS: { k: FitStyle; t: string; d: string }[] = [
  { k: "volt", t: "Volt", d: "dark and gold" },
  { k: "chalk", t: "Chalk", d: "high contrast for a bright gym" },
  { k: "pulse", t: "Pulse", d: "deep blue glow" },
];

export function FitSettings({ v, desk, onLooks, onSetup }: { v: FitView; desk?: boolean; onLooks?: () => void; onSetup?: () => void }) {
  return (
    <div className={`fs ${desk ? "fs-desk" : "fs-phone"}`}>
      <Jump desk={!!desk} setup={!!onSetup} />
      {onSetup && <SetupAgain v={v} onSetup={onSetup} />}
      <Look v={v} onLooks={onLooks} />
      <Rest v={v} />
      <Sets v={v} />
      <Goal v={v} />
      <Day v={v} />
      <GymReminder />
      <Section title="Gym scan" term="gym-scan">
        <p className="fs-help fs-help-top">A Scan button in a workout on the phone: point the camera at a machine's label and {appName()} finds the exercise. The picture stays on the phone and is never saved.</p>
        <Toggle label="Show Scan in a workout" on={v.prefs.scan ?? true} onChange={(on) => void savePrefs({ scan: on })} />
      </Section>
      <Section title="Sleep" term="sleep-settings"><SleepPrefs v={v} /></Section>
      {desk && (
        <Section title="On the Mac" term="rest-sound">
          <p className="fs-help fs-help-top">When a rest ends {appName()} plays a sound and shows a card.</p>
          <Toggle label="Play a sound" on={v.prefs.sound ?? true} onChange={(on) => void savePrefs({ sound: on })} />
        </Section>
      )}
      <Section title="G Squad sharing" term="squad-sharing"><SquadShareSettings /></Section>
      <Words />
      <p className="fs-privacy"><LockIcon /> Everything here is encrypted in your vault, like the rest of {appName()}. It works with no signal and syncs later.</p>
    </div>
  );
}

// ---------- look ----------
function Look({ v, onLooks }: { v: FitView; onLooks?: () => void }) {
  const saved = v.prefs.style ?? "volt";
  const [pick, setPick] = useState<FitStyle | null>(null);
  useEffect(() => { setPick(null); }, [saved]);
  const cur = pick ?? saved;
  const choose = (k: FitStyle, el: HTMLElement) => {
    if (k === cur) return;
    haptic("press");
    setPick(k);
    // The Fitness root takes the new look at once (inside a view transition, so it crossfades); the vault
    // copy follows, and the shell then sets the same value.
    const root = (el.closest(".fit-phone, .fit-desk") ?? el.closest(".fit")) as HTMLElement | null;
    const before = root?.dataset.fitStyle;
    const apply = (s: string | undefined) => { if (root && s) root.dataset.fitStyle = s; };
    const doc = document as Document & { startViewTransition?: (f: () => void) => unknown };
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (doc.startViewTransition && !reduce) doc.startViewTransition(() => apply(k));
    else apply(k);
    savePrefs({ style: k }).catch(() => { apply(before); setPick(null); haptic("reject"); });
  };
  return (
    <Section title="Look" term="look">
      <div className="fs-looks" role="radiogroup" aria-label="Look">
        {LOOKS.map((l) => (
          <button key={l.k} type="button" role="radio" aria-checked={cur === l.k} className={`fs-look${cur === l.k ? " on" : ""}`} onClick={(e) => choose(l.k, e.currentTarget)}>
            <Mock k={l.k} />
            <span className="fs-look-t"><b>{l.t}</b>: {l.d}</span>
            <span className="fs-look-check" aria-hidden="true"><Check /></span>
          </button>
        ))}
      </div>
      {onLooks && <button type="button" className="fs-looks-all" onClick={() => { haptic("press"); onLooks(); }}>See every look in light and dark</button>}
    </Section>
  );
}
/** A small live set row drawn with that look's own tokens. */
function Mock({ k }: { k: FitStyle }) {
  const theme = useFitTheme(k);   // each preview in the light or dark this device uses (V1.29)
  return (
    <span className="fit fs-mock" data-fit-style={k} data-fit-theme={theme} aria-hidden="true">
      <span className="fs-mock-top"><span>Bench press</span><span className="fs-mock-set">Set 2 of 3</span></span>
      <span className="fs-mock-row">
        <span className="fs-mock-num"><b className="f-num">52.5</b><small>kg</small></span>
        <span className="fs-mock-x">x</span>
        <span className="fs-mock-num"><b className="f-num">8</b><small>reps</small></span>
        <span className="fs-mock-tick"><Check /></span>
      </span>
      <span className="fs-mock-rir">
        {RIR_VALUES.map((r) => <span key={r} className={`f-num${r === 2 ? " on" : ""}`}>{rirLabel(r)}</span>)}
      </span>
    </span>
  );
}

// ---------- rest ----------
/** A number in the prefs with quick taps: shows the tapped value at once, saves each one in order, and only
 *  follows the vault again once every save has landed (so it never jumps back mid tapping). */
function usePrefNum(saved: number, key: "restCompound" | "restIsolation" | "weekGoal" | "setsDefault") {
  const [n, setN] = useState(saved);
  const pending = useRef(0);
  useEffect(() => { if (!pending.current) setN(saved); }, [saved]);
  const set = (x: number) => {
    setN(x);
    pending.current++;
    void savePrefs({ [key]: x } as Partial<FitPrefs>).finally(() => { pending.current--; });
  };
  return [n, set] as const;
}
function Rest({ v }: { v: FitView }) {
  const [rc, setRc] = usePrefNum(v.prefs.restCompound ?? REST_COMPOUND, "restCompound");
  const [ri, setRi] = usePrefNum(v.prefs.restIsolation ?? REST_ISOLATION, "restIsolation");
  const own = ownRestCount(v.prefs);
  const [cleared, setCleared] = useState(false);
  useEffect(() => { if (own) setCleared(false); }, [own]);
  return (
    <Section title="Rest between sets" term="rest">
      <RestRow title="Long rest" term="long-rest" help="Big lifts use it: squat, bench, rows, pulldowns. Many joints, more tiring." value={rc}
        onChange={(x) => setRc(x)} />
      <RestRow title="Short rest" term="short-rest" help="Small lifts use it: curls, raises, pushdowns. One joint, less tiring." value={ri}
        onChange={(x) => setRi(x)} />
      <p className="fs-help">Want one rest for everything? Set both to the same time.</p>
      <div className="fs-own">
        {own > 0 ? (
          <>
            <p className="fs-help">You picked a rest in the gym for {plural(own, "exercise")}. Those keep it.<Info k="own-rest" /></p>
            <button type="button" className="fs-btn" onClick={() => { haptic("press"); void savePrefs({ restBy: {}, restKind: {} }).then(() => setCleared(true)); }}>
              Reset my per exercise rests ({own})
            </button>
          </>
        ) : (
          <p className="fs-help">{cleared ? "Done. Every exercise uses the times above again." : "No exercise has its own rest yet. In the gym, tap Rest on an exercise to pick Short, Long or your own time. It keeps it."}<Info k="own-rest" /></p>
        )}
      </div>
    </Section>
  );
}

// ---------- sets (V1.40, the developer: "2, 3, 5, anything", as a default and per exercise) ----------
function Sets({ v }: { v: FitView }) {
  const [n, setN] = usePrefNum(setsDefault(v.prefs), "setsDefault");
  const own = Object.keys(v.prefs.setsBy ?? {}).length;
  const [cleared, setCleared] = useState(false);
  useEffect(() => { if (own) setCleared(false); }, [own]);
  const step = (d: number) => {
    const x = Math.max(SETS_LO, Math.min(SETS_HI, n + d));
    if (x === n) { haptic("reject"); return; }
    haptic("tick");
    setN(x);
  };
  return (
    <Section title="Sets" term="sets-default">
      <div className="fs-stepper">
        <button type="button" className="fs-step" onClick={() => step(-1)} disabled={n <= SETS_LO} aria-label="One set less"><Minus /></button>
        <span className="fs-step-v" aria-live="polite">
          <b className="f-num" key={n}>{n}</b><small>{n === 1 ? "set per exercise" : "sets per exercise"}</small>
        </span>
        <button type="button" className="fs-step" onClick={() => step(1)} disabled={n >= SETS_HI} aria-label="One set more"><Plus /></button>
      </div>
      <p className="fs-help">New exercises start with this many. A program's own number comes first.<Info k="set" /></p>
      <Toggle label="New sets start at your last weight" on={v.prefs.startLast ?? true} onChange={(on) => void savePrefs({ startLast: on })} />
      <p className="fs-help">Each new set starts with the weight and reps of the last set you did on that exercise: this workout first, else the last time.<Info k="start-last" /></p>
      <div className="fs-own">
        {own > 0 ? (
          <>
            <p className="fs-help">You set your own number in the gym for {plural(own, "exercise")}. Those keep it.<Info k="own-sets" /></p>
            <button type="button" className="fs-btn" onClick={() => { haptic("press"); void savePrefs({ setsBy: {} }).then(() => setCleared(true)); }}>
              Reset my per exercise sets ({own})
            </button>
          </>
        ) : (
          <p className="fs-help">{cleared ? "Done. Every exercise uses its program or the number above again." : "In the gym, tap the sets on an exercise to change it for that exercise. It keeps your number."}</p>
        )}
      </div>
      <p className="fs-help">Doing fewer today? Tap Finish exercise. The sets you did count as normal, and next time starts with your usual number.<Info k="finish-exercise" /></p>
    </Section>
  );
}
function RestRow({ title, term, help, value, onChange }: { title: string; term: TermKey; help: string; value: number; onChange: (x: number) => void }) {
  const step = (d: number) => {
    const x = clampRest(value + d);
    if (x === value) { haptic("reject"); return; }
    haptic("tick");
    onChange(x);
  };
  const m = Math.floor(value / 60), s = value % 60;
  const words = m && s ? `${m} min ${s} s` : m ? `${m} min` : `${s} s`;
  return (
    <div className="fs-rest">
      <div className="fs-rest-h"><b className="fs-term">{title}<Info k={term} /></b><span>{help}</span></div>
      <div className="fs-stepper">
        <button type="button" className="fs-step" onClick={() => step(-REST_STEP)} disabled={value <= REST_MIN} aria-label={`${title}: 15 seconds less`}>-15</button>
        <RestNum value={value} label={title} className="fs-step-v" onSave={(x) => onChange(clampRest(x))}><small>{words}</small></RestNum>
        <button type="button" className="fs-step" onClick={() => step(REST_STEP)} disabled={value >= REST_MAX} aria-label={`${title}: 15 seconds more`}>+15</button>
      </div>
    </div>
  );
}

// ---------- week goal ----------
function Goal({ v }: { v: FitView }) {
  const [g, setG] = usePrefNum(Math.max(1, Math.min(7, v.prefs.weekGoal ?? 3)), "weekGoal");
  const step = (d: number) => {
    const x = Math.max(1, Math.min(7, g + d));
    if (x === g) { haptic("reject"); return; }
    haptic("tick");
    setG(x);
  };
  return (
    <Section title="Week goal" term="week-goal">
      <div className="fs-stepper">
        <button type="button" className="fs-step" onClick={() => step(-1)} disabled={g <= 1} aria-label="One day less">
          <Minus />
        </button>
        <span className="fs-step-v" aria-live="polite">
          <b className="f-num" key={g}>{g}</b><small>{g === 1 ? "day a week" : "days a week"}</small>
        </span>
        <button type="button" className="fs-step" onClick={() => step(1)} disabled={g >= 7} aria-label="One day more">
          <Plus />
        </button>
      </div>
      <div className="fs-goal-dots" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => <span key={i} className={i < g ? "on" : ""} style={{ transitionDelay: `${i * 30}ms` }} />)}
      </div>
      <p className="fs-help">History counts the days you train each week, Monday to Sunday, and how many weeks in a row you hit this.</p>
    </Section>
  );
}

// ---------- which day ----------
function Day({ v }: { v: FitView }) {
  const p = v.program, n = v.next;
  const day = p && n ? p.data.days[n.dayIndex] : null;
  if (!p || !n || !day) {
    return <Section title="Which day" term="repeat-day"><p className="fs-help fs-help-top">No program yet. Add one in Programs and the next day shows here.<Info k="program-day" /></p></Section>;
  }
  const locked = n.locked;
  const toggle = (on: boolean) => {
    void savePrefs({ lock: on ? { programId: p.id, dayId: n.dayId, week: n.week } : null });
  };
  return (
    <Section title="Which day" term="repeat-day">
      <div className={`fs-next${locked ? " locked" : ""}`}>
        <span className="fs-next-k">{locked ? "Repeating" : "Next up"}<Info k="program-day" /></span>
        <b>{dayLabel(n.week, day.name)}</b>
        {day.title && <span className="fs-next-t">{day.title}</span>}
        <span className="fs-next-p">{p.data.name}</span>
      </div>
      <Toggle label="Repeat this day" on={locked} onChange={toggle} />
      <p className="fs-help">{locked
        ? "Fitness keeps showing this day, even after you train, until you turn this off."
        : "Off: after each workout the next day comes up by itself, and after the last day a new week starts."}<Info k="repeat-day" /></p>
    </Section>
  );
}

// ---------- the gym reminder (the developer, 2 Nov 2026) ----------
// Monday first, as the developer's week runs; the values are JavaScript's days (0 Sunday).
const WEEK: { d: number; t: string; full: string }[] = [
  { d: 1, t: "M", full: "Monday" }, { d: 2, t: "T", full: "Tuesday" }, { d: 3, t: "W", full: "Wednesday" }, { d: 4, t: "T", full: "Thursday" },
  { d: 5, t: "F", full: "Friday" }, { d: 6, t: "S", full: "Saturday" }, { d: 0, t: "S", full: "Sunday" },
];
const NAG_STEPS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const mins = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
/** One time box in the gym reminder (saves when a whole time is picked). */
function GymTime({ label, value, on, set }: { label: string; value: string; on: boolean; set: (v: string) => void }) {
  return (
    <label className="fs-gym-time">
      <span>{label}</span>
      <input type="time" step={300} value={value} disabled={!on}
        onChange={(e) => { if (/^\d{2}:\d{2}$/.test(e.target.value) && e.target.value !== value) { haptic("tick"); set(e.target.value); } }} />
    </label>
  );
}
function GymReminder() {
  const s = useVault();
  const st = settingsData(s);
  const defOn = isRedAccount(s);   // anyone else's reminder starts off (core/gym.ts)
  const saved = gymPrefs(st.gym, defOn);
  const [p, setP] = useState<GymPrefs>(saved);
  const pending = useRef(0);
  const savedJson = JSON.stringify(saved);
  useEffect(() => { if (!pending.current) setP(gymPrefs(JSON.parse(savedJson), defOn)); }, [savedJson]);
  const save = (patch: Partial<GymPrefs>) => {
    const next = gymPrefs({ ...p, ...patch }, defOn);
    setP(next);
    pending.current++;
    void taskMapActions.looks({ gym: next }).finally(() => { window.setTimeout(() => { pending.current--; }, 1500); });
  };
  const tz = homeTz(), now = Date.now();
  const today = gymToday(p, now, tz);
  const ackedToday = !!today && (st.gymAck || []).includes(today.day);
  const end = gymEnd(p), ring = gymRingAt(p);
  const overMidnight = mins(end) <= mins(p.time);
  const nextMorning = p.nag && mins(p.time) < mins(p.nagStart);
  return (
    <Section title="Gym reminder" term="gym-reminder">
      <Toggle label="Remind me" on={p.on} onChange={(on) => save({ on })} />
      <div className={`fs-gym${p.on ? "" : " off"}`}>
        <GymTime label="Gym time" value={p.time} on={p.on} set={(time) => save({ time, ...(time === p.end ? { end: "" } : {}) })} />
        <GymTime label="Ends" value={end} on={p.on} set={(v) => save({ end: v === p.time ? "" : v })} />
        <GymTime label="Phone rings at" value={ring} on={p.on} set={(ringAt) => save({ ringAt })} />
        <div className="fs-gym-days" role="group" aria-label="Gym days">
          {WEEK.map((w) => {
            const on = p.days.includes(w.d);
            return (
              <button key={w.d} type="button" className={on ? "on" : ""} aria-pressed={on} aria-label={w.full} disabled={!p.on}
                onClick={() => { haptic("tick"); save({ days: on ? p.days.filter((x) => x !== w.d) : [...p.days, w.d] }); }}>{w.t}</button>
            );
          })}
        </div>
      </div>
      {p.on && p.ringAt && <button type="button" className="fs-gym-reset" onClick={() => { haptic("tick"); save({ ringAt: "" }); }}>Ring {GYM.ring} min before the gym again</button>}
      <div className={`fs-gym-nag${p.on ? "" : " off"}`}>
        <Toggle label="Nag me until I say Yes" on={p.nag} onChange={(nag) => { if (p.on) save({ nag }); }} />
        {p.nag && (
          <div className="fs-gym">
            <GymTime label="Starts" value={p.nagStart} on={p.on} set={(nagStart) => save({ nagStart })} />
            <label className="fs-gym-time">
              <span>Every</span>
              <select value={p.nagEvery} disabled={!p.on} onChange={(e) => { haptic("tick"); save({ nagEvery: Number(e.target.value) }); }}>
                {[...new Set([...NAG_STEPS, p.nagEvery])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </label>
          </div>
        )}
      </div>
      <p className="fs-help">{!p.on ? "Off: no gym cards, notifications or ring."
        : p.nag
          ? `From ${p.nagStart}, your Mac shows a card and your phone a notification every ${p.nagEvery} min until you say ${YES_WORDS}. If you have not, your phone rings at ${ring}, even in Do Not Disturb, for up to 10 minutes (Later rings again in 5). Yes on either one stops everything for that day.`
          : `Your Mac shows a card 2 h, 1 h, 30 min and 10 min before ${p.time}. Your phone gets a notification at the same times and rings at ${ring}, even in Do Not Disturb, for up to 10 minutes (Later rings again in 5). ${YES_WORDS} on either one stops both.`}
        {!p.on ? "" : nextMorning ? ` Gym at ${p.time} is the morning after the nagging starts: Yes counts for the day the nagging starts.`
          : overMidnight ? ` The gym ends after midnight: Yes counts for the day ${p.nag ? "the nagging starts" : "it starts"}.` : ""}
        <Info k="gym-reminder" /></p>
      {today && p.on && (ackedToday
        ? <p className="fs-help fs-gym-done"><Check /> You said Yes for today</p>
        : <button type="button" className="fs-btn fs-gym-ack" onClick={() => { haptic("press"); void taskMapActions.gymAck(today.day); }}>{YES_WORDS}</button>)}
    </Section>
  );
}

// ---------- set up your training (V1.47) ----------
function SetupAgain({ v, onSetup }: { v: FitView; onSetup: () => void }) {
  const d = useSetupDraft(v);
  const p = d ? progressOf(d) : null;
  return (
    <Section title="Set up your training" term="setup">
      <p className="fs-help fs-help-top">{d
        ? `A setup is saved${d.step === "plan" ? " with your plan ready to check" : p && p.i ? ` at question ${p.i} of ${p.n}` : ""}. Carry on where you left off.`
        : "Answer a few questions and get a plan made for you, which you can change before saving. Your current program stays in Programs."}</p>
      <button type="button" className="fs-btn" onClick={() => { haptic("press"); onSetup(); }}>{d ? "Continue setup" : v.programs.length ? "Set up again" : "Set up my training"}</button>
    </Section>
  );
}

// ---------- every word explained (V1.47: the one glossary, the same words as every (i)) ----------
function Words() {
  return (
    <section className="fs-sec" id={secId("Every word explained")}>
      <h3 className="fs-sec-h">Every word explained</h3>
      <div className="fs-card">
        <p className="fs-help fs-help-top fs-words-lead">Tap a word to see what it means, an example and why it matters. The same words are behind every (i) in Fitness.</p>
        <Glossary />
      </div>
    </section>
  );
}

// ---------- small parts ----------
const secId = (t: string) => `fs-${t.toLowerCase().replace(/[^a-z]+/g, "-")}`;
/** A settings group. Every one names its glossary word (V1.47): the (i) beside the title opens it. */
function Section({ title, term, children }: { title: string; term: TermKey; children: ReactNode }) {
  return <section className="fs-sec" id={secId(title)}><h3 className="fs-sec-h">{title}<Info k={term} className="fs-sec-i" /></h3><div className="fs-card">{children}</div></section>;
}
/** V1.43: every setting group named at the top, a tap scrolls to it, so nothing hides at the bottom of the page. */
function Jump({ desk, setup }: { desk: boolean; setup: boolean }) {
  const groups = [...(setup ? ["Set up your training"] : []), "Look", "Rest between sets", "Sets", "Week goal", "Which day", "Gym reminder", "Gym scan", "Sleep", ...(desk ? ["On the Mac"] : []), "G Squad sharing", "Every word explained"];
  return (
    <nav className="fs-jump" aria-label="Settings groups">
      {groups.map((t) => (
        <button key={t} type="button" onClick={(e) => { haptic("tick"); (e.currentTarget.closest(".fs")?.querySelector(`#${secId(t)}`) as HTMLElement | null)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{t}</button>
      ))}
    </nav>
  );
}
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`fs-toggle${on ? " on" : ""}`} onClick={() => { haptic("press"); onChange(!on); }}>
      <span className="fs-toggle-l">{label}</span>
      <span className="fs-toggle-t" aria-hidden="true"><span className="fs-toggle-k" /></span>
    </button>
  );
}
const Check = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
const Minus = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
);
const Plus = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);
const LockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);

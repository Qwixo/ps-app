// PS Fitness Sleep (V1.40). The developer: "how many hours sleep did you get last night ... so you can see someone slept eight
// hours a day, five days in a row". Drawn here; the rules are in core/sleep.ts, the saving in sleep-store.ts.
// - Today screen: once a day, "How did you sleep?" (the 10 second log, with Not today and Stop asking), else one
//   small row (last sleep and the streak) that opens the Sleep screen.
// - Sleep screen (phone: a sheet; Mac and website: a tab): last sleep big, the week's bars with the 7 to 9 h band,
//   average against last week, nights on target, the streak and its badges, Steady, one calm note at most, the recent
//   sleeps (edit any), the target and the daily question's switch, and the plain caveats.
// Never red for a short night, no bank of lost hours, no medical words. Day sleep is a night like any other.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { haptic } from "../gos/bridge";
import { savePrefs, type FitView } from "./store";
import { deleteSleep, saveSleep, useSleep, type SleepDoc, type SleepView } from "./sleep-store";
import { fmtDay } from "./hist-logic";
import {
  addDay, askNow, badge, breakLine, breaksMins, clampTarget, clocksOf, fmtMins, lastSeven, makeLog, nightsWord, onTarget, sleepMins, sleepNote, spanFromClock, steadiness,
  streak, TARGET_MAX, TARGET_MIN, TARGET_STEP, usual, weekStats, BACKFILL_DAYS,
} from "../core/sleep";
import "./sleep.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const RESTED: { n: number; t: string }[] = [
  { n: 1, t: "Not at all" }, { n: 2, t: "A little" }, { n: 3, t: "OK" }, { n: 4, t: "Well" }, { n: 5, t: "Very" },
];
const dayWord = (day: string, today: string) => (day === today ? "Today" : day === addDay(today, -1) ? "Yesterday" : fmtDay(day));
/** Hours that never break across two lines ("7 h 30" stays together). */
const hrs = (m: number) => fmtMins(m).replace(/ /g, "\u00a0");
const targetWord = (t: number) => `${hrs(t)}+`;

// ======================================================================================================
// Today screen
// ======================================================================================================
/** The daily question when it is due, else one small row into the Sleep screen. */
/** compact (V1.43, Fitness home, the developer: the sleep question first felt random): never the full question card, only a
 *  small row that asks, and a tap opens Sleep to log it. */
export function SleepToday({ v, onOpen, compact }: { v: FitView; onOpen: () => void; compact?: boolean }) {
  const sv = useSleep();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const [justSaved, setJustSaved] = useState(false);
  const target = clampTarget(v.prefs.sleepTarget);
  const asking = askNow(sv.days, now, sv.today, v.prefs) && !justSaved;
  if (asking && !compact) {
    return (
      <div className="fz fz-today">
        <LogCard v={v} sv={sv} ask onDone={() => setJustSaved(true)} />
      </div>
    );
  }
  const last = [...sv.days.values()][0] ?? null;
  const n = streak(sv.days, sv.today, target);
  return (
    <div className="fz fz-today">
      <button type="button" className="fz-row" onClick={() => { haptic("press"); onOpen(); }} aria-label="Open Sleep">
        <span className="fz-row-i" aria-hidden="true"><MoonIcon /></span>
        <span className="fz-row-t">
          <b>Sleep</b>
          <span>{asking ? "Last night is not logged yet. Tap to log it (optional)"
            : last ? `Last sleep ${hrs(sleepMins(last))}${n ? ` · ${nightsWord(n)} in a row ${targetWord(target)}` : ""}`
            : "Log how long you slept"}</span>
        </span>
        <span className="fz-row-go" aria-hidden="true"><ChevronIcon /></span>
      </button>
    </div>
  );
}

// ======================================================================================================
// The 10 second log (new or edit)
// ======================================================================================================
function LogCard({ v, sv, edit, ask, onDone }: { v: FitView; sv: SleepView; edit?: SleepDoc | null; ask?: boolean; onDone: () => void }) {
  const u = useMemo(() => usual(sv.days), [sv.days]);
  const tz = edit?.log.tz ?? sv.tz;
  const start = edit ? clocksOf(edit.log) : { asleep: u.asleep, wake: u.wake };
  const choices = edit && edit.log.day < addDay(sv.today, -BACKFILL_DAYS) ? [edit.log.day] : Array.from({ length: BACKFILL_DAYS + 1 }, (_, i) => addDay(sv.today, -i));
  const [day, setDay] = useState(edit?.log.day ?? sv.today);
  const [asleep, setAsleep] = useState(start.asleep);
  const [wake, setWake] = useState(start.wake);
  const [own, setOwn] = useState<number | null>(edit?.log.mins ?? null);
  const [rested, setRested] = useState<number | null>(edit?.log.rested ?? null);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const span = spanFromClock(day, asleep, wake, tz);
  // V1.43: Sleep mode's breaks stay with the sleep when it is edited (those still inside the times), and are not sleep.
  const brk = edit?.log.breaks ?? null;
  const inBreaks = span && brk ? breaksMins({ start: new Date(span.start).toISOString(), end: new Date(span.end).toISOString(), breaks: brk }) : 0;
  const mins = own ?? (span ? Math.max(0, span.mins - inBreaks) : 0);
  const taken = sv.days.has(day) && day !== edit?.log.day;   // saving replaces the sleep already on that date

  const save = (s = span, m: number | null = own) => {
    if (!s || busy) { haptic("reject"); return; }
    const log = makeLog({ start: s.start, end: s.end, tz, mins: m, rested, src: "hand", breaks: brk });
    if (!log) { haptic("reject"); return; }
    setBusy(true);
    haptic("drop");
    void saveSleep(log, edit?.id ?? sv.ids.get(day) ?? null).then(onDone, () => { setBusy(false); haptic("reject"); });
  };
  const sameAsUsual = () => { const s = spanFromClock(day, u.asleep, u.wake, tz); if (s) save(s, null); };
  const nudge = (d: number) => {
    if (!span) return;
    const next = Math.max(30, Math.min(span.mins, mins + d));
    haptic("tick");
    setOwn(next === Math.max(0, span.mins - inBreaks) ? null : next);
  };

  return (
    <section className={cx("fz-log", ask && "ask")} aria-label={edit ? "Edit sleep" : "Log your sleep"}>
      <h2 className="fz-log-h">{edit ? "Edit sleep" : "How did you sleep?"}</h2>
      {choices.length > 1 && (
        <div className="fz-days" role="radiogroup" aria-label="The day you woke up">
          {choices.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={d === day} className={d === day ? "on" : ""} onClick={() => { haptic("tick"); setDay(d); }}>
              {d === sv.today ? "Woke today" : dayWord(d, sv.today)}
            </button>
          ))}
        </div>
      )}
      {choices.length === 1 && <p className="fz-help">Woke up {fmtDay(day)}</p>}
      {!edit && u.known && (
        <button type="button" className="fz-same" onClick={sameAsUsual} disabled={busy}>
          <b>Same as usual</b><span>{u.asleep} to {u.wake} · {fmtMins(spanFromClock(day, u.asleep, u.wake, tz)?.mins ?? 0)}</span>
        </button>
      )}
      <div className="fz-times">
        <label className="fz-time">
          <span>Fell asleep</span>
          <input type="time" step={300} value={asleep} onChange={(e) => { if (e.target.value) { setAsleep(e.target.value); setOwn(null); } }} />
        </label>
        <label className="fz-time">
          <span>Woke up</span>
          <input type="time" step={300} value={wake} onChange={(e) => { if (e.target.value) { setWake(e.target.value); setOwn(null); } }} />
        </label>
      </div>
      <div className="fz-hours">
        <button type="button" className="fz-step" onClick={() => nudge(-15)} disabled={!span || mins <= 30} aria-label="15 minutes less">-15</button>
        <span className="fz-hours-v" aria-live="polite">
          {span ? <><b className="f-num">{fmtMins(mins)}</b><small>{own != null ? "asleep (set by you)" : "asleep, about"}</small></> : <small className="fz-bad">Check the times</small>}
        </span>
        <button type="button" className="fz-step" onClick={() => nudge(15)} disabled={!span || mins >= span.mins} aria-label="15 minutes more">+15</button>
      </div>
      <p className="fz-help">Lay awake for a while? Take it off with -15.</p>
      <div className="fz-rested" role="radiogroup" aria-label="How rested do you feel? Optional">
        <span className="fz-rested-h">How rested? <small>optional</small></span>
        <div className="fz-rested-b">
          {RESTED.map((r) => (
            <button key={r.n} type="button" role="radio" aria-checked={rested === r.n} aria-label={`${r.n}: ${r.t}`} className={rested === r.n ? "on" : ""}
              onClick={() => { haptic("tick"); setRested(rested === r.n ? null : r.n); }}>
              <b className="f-num">{r.n}</b><small>{r.t}</small>
            </button>
          ))}
        </div>
      </div>
      {taken && <p className="fz-help">You already logged {dayWord(day, sv.today).toLowerCase()}. Saving replaces it.</p>}
      <button type="button" className="fz-save" onClick={() => save()} disabled={!span || busy}>Save</button>
      <div className="fz-log-foot">
        {ask && <button type="button" className="fz-link" onClick={() => { haptic("press"); void savePrefs({ sleepSkip: sv.today }); }}>Not today</button>}
        {ask && <button type="button" className="fz-link" onClick={() => { haptic("press"); void savePrefs({ sleepAsk: false }); }}>Stop asking</button>}
        {edit && <button type="button" className="fz-link" onClick={onDone}>Cancel</button>}
        {edit && (
          <button type="button" className={cx("fz-link", sure && "warn")} onClick={() => {
            if (!sure) { setSure(true); haptic("press"); return; }
            haptic("drop"); void deleteSleep(edit.id).then(onDone);
          }}>{sure ? "Tap again to remove" : "Remove"}</button>
        )}
      </div>
      {ask && <p className="fz-help fz-center">Stop asking turns this question off. Turn it back on in Sleep.</p>}
    </section>
  );
}

// ======================================================================================================
// The Sleep screen
// ======================================================================================================
export function SleepScreen({ v, desk }: { v: FitView; desk?: boolean }) {
  const sv = useSleep();
  const [editing, setEditing] = useState<SleepDoc | "new" | null>(null);
  const target = clampTarget(v.prefs.sleepTarget);
  const list = [...sv.days.entries()].slice(0, 14);
  const last = list[0]?.[1] ?? null;
  const docFor = (day: string): SleepDoc | null => { const id = sv.ids.get(day), log = sv.days.get(day); return id && log ? { id, log } : null; };
  const open = (d: SleepDoc | "new") => { haptic("press"); setEditing(d); if (typeof window !== "undefined") window.scrollTo?.({ top: 0 }); };
  const n = streak(sv.days, sv.today, target), b = badge(n);
  const w = weekStats(sv.days, sv.today, target);
  const st = steadiness(sv.days, sv.today);
  const note = sleepNote(sv.days, sv.today);

  return (
    <div className={cx("fz fz-screen", desk && "fz-desk")}>
      {editing
        ? <LogCard key={editing === "new" ? "new" : editing.id} v={v} sv={sv} edit={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
        : (
          <section className="fz-last" aria-label="Last sleep">
            <p className="fz-kick">{last ? `Last sleep · ${dayWord(last.day, sv.today)}` : "Sleep"}</p>
            {last ? (
              <>
                <p className="fz-hero"><b className="f-num">{fmtMins(sleepMins(last))}</b><small>about</small></p>
                <p className="fz-sub">{[`${clocksOf(last).asleep} to ${clocksOf(last).wake}`, breakLine(last) ?? "", last.rested ? `rested ${last.rested} of 5` : ""].filter(Boolean).join(" · ")}</p>
              </>
            ) : <p className="fz-sub">Log when you fell asleep and woke up. It takes about 10 seconds, and works for day sleep too.</p>}
            <div className="fz-row2">
              <button type="button" className="fz-save" onClick={() => open("new")}>Log a sleep</button>
              {last && docFor(last.day) && <button type="button" className="fz-second" onClick={() => open(docFor(last.day)!)}>Edit</button>}
            </div>
          </section>
        )}

      {sv.days.size > 0 && (
        <>
          <Bars sv={sv} target={target} />
          <div className="fz-stats">
            <Stat k="Average" n={w.avg != null ? fmtMins(w.avg) : "None"} s={w.lastAvg != null ? `this week · last week ${hrs(w.lastAvg)}` : "this week"} />
            <Stat k="On target" n={`${w.onTarget} of 7`} s={`nights ${targetWord(target)}`} />
            <Stat k="Streak" n={String(n)} s={`${n === 1 ? "night" : "nights"} in a row ${targetWord(target)}`}
              extra={b.has ? `${b.has}\u00a0night badge${b.next ? ` · next\u00a0${b.next}` : ""}` : b.next ? `First badge at\u00a0${b.next}` : null} gold={!!b.has} />
            <Stat k="Steady" n={st ? `${st.steady} of ${st.of}` : "Soon"} s={st ? `near your usual ${st.asleep} to ${st.wake}` : "after 3 sleeps"}
              extra={st && st.wakeMoved != null && st.wakeMoved >= 10 ? `wake time moved about ${hrs(st.wakeMoved)}` : null} />
          </div>
          {note && <p className="fz-note" role="note">{note}</p>}
          <section className="fz-sec" aria-label="Recent sleeps">
            <h3 className="fz-sec-h">Recent</h3>
            <ul className="fz-list">
              {list.map(([day, l]) => {
                const d = docFor(day);
                return (
                  <li key={day}>
                    <span className="fz-list-d">{dayWord(day, sv.today)}</span>
                    <span className={cx("fz-list-h f-num", onTarget(l, target) && "on")}>{fmtMins(sleepMins(l))}</span>
                    <span className="fz-list-t">{`${clocksOf(l).asleep}\u00a0to\u00a0${clocksOf(l).wake}`}{breakLine(l) ? ` · ${breakLine(l)}` : ""}{l.rested ? ` · ${l.rested}/5` : ""}</span>
                    {d && <button type="button" className="fz-link" onClick={() => open(d)} aria-label={`Edit ${dayWord(day, sv.today)}`}>Edit</button>}
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      <section className="fz-sec" aria-label="Sleep settings">
        <h3 className="fz-sec-h">Settings</h3>
        <SleepPrefs v={v} />
      </section>
      <section className="fz-sec fz-about" aria-label="About these numbers">
        <h3 className="fz-sec-h">About these numbers</h3>
        <p>Hours are about. Most people sleep a little less than they think, and the time from falling asleep to waking includes a few minutes awake.</p>
        <p>Adults do best on 7 h or more, regularly. Going to sleep and waking at about the same times matters about as much as the hours.</p>
        <p>Night shift? A sleep belongs to the day you wake up, at any hour, so a day sleep counts like any night.</p>
        <p>A streak counts nights in a row at your target or more. Today and the 2 days before can still be filled in, so a missed log only ends it after that.</p>
        <p>Loud snoring with gasps or pauses, or nodding off while driving, are reasons to see a doctor.</p>
        <p className="fz-priv"><LockIcon /> Your sleep is encrypted in your vault, like the rest of Fitness.</p>
      </section>
    </div>
  );
}

/** The target (7 to 9 h) and the daily question's switch. Also in Fitness settings. */
export function SleepPrefs({ v }: { v: FitView }) {
  const target = clampTarget(v.prefs.sleepTarget);
  const ask = v.prefs.sleepAsk !== false;
  const step = (d: number) => { const t = clampTarget(target + d); if (t !== target) { haptic("tick"); void savePrefs({ sleepTarget: t }); } };
  return (
    <div className="fz fz-prefs">
      <div className="fz-pref">
        <div className="fz-pref-t"><b>Target</b><span>A night counts for your streak at this or more. 7 to 9 h.</span></div>
        <div className="fz-hours fz-hours-s">
          <button type="button" className="fz-step" onClick={() => step(-TARGET_STEP)} disabled={target <= TARGET_MIN} aria-label="Target 30 minutes less">-30</button>
          <span className="fz-hours-v" aria-live="polite"><b className="f-num">{hrs(target)}</b></span>
          <button type="button" className="fz-step" onClick={() => step(TARGET_STEP)} disabled={target >= TARGET_MAX} aria-label="Target 30 minutes more">+30</button>
        </div>
      </div>
      <button type="button" role="switch" aria-checked={ask} className={cx("fz-toggle", ask && "on")}
        onClick={() => { haptic("press"); void savePrefs({ sleepAsk: !ask, ...(!ask ? { sleepSkip: null } : {}) }); }}>
        <span className="fz-toggle-l"><b>Ask how I slept</b><span>Once a day in Fitness, after you wake up.</span></span>
        <span className="fz-toggle-t" aria-hidden="true"><span className="fz-toggle-k" /></span>
      </button>
    </div>
  );
}

// ---------- parts ----------
function Bars({ sv, target }: { sv: SleepView; target: number }) {
  const seven = lastSeven(sv.days, sv.today);
  const top = Math.max(10 * 60, ...seven.map((x) => (x.log ? sleepMins(x.log) : 0)));
  const pct = (m: number) => `${Math.min(100, (m / top) * 100)}%`;
  const letter = (day: string) => "SMTWTFS"[new Date(`${day}T12:00:00Z`).getUTCDay()];
  return (
    <section className="fz-bars" aria-label="The last 7 days">
      <div className="fz-bars-plot">
        <span className="fz-band" style={{ bottom: pct(7 * 60), height: `calc(${pct(9 * 60)} - ${pct(7 * 60)})` }} aria-hidden="true" />
        <span className="fz-line" style={{ bottom: pct(target) }} aria-hidden="true"><i>{hrs(target)}</i></span>
        {seven.map(({ day, log }) => {
          const m = log ? sleepMins(log) : 0;
          return (
            <div key={day} className="fz-bar-c" aria-label={`${dayWord(day, sv.today)}: ${log ? fmtMins(m) : "not logged"}`}>
              {log && <span className="fz-bar-v f-num">{fmtMins(m).replace(" h ", "h").replace(" h", "h")}</span>}
              <span className={cx("fz-bar", log && m >= target && "on", !log && "empty")} style={{ height: log ? pct(m) : "4px" }} />
            </div>
          );
        })}
      </div>
      <div className="fz-bars-x" aria-hidden="true">{seven.map(({ day }) => <span key={day} className={day === sv.today ? "today" : ""}>{letter(day)}</span>)}</div>
      <p className="fz-help">Shaded: 7 to 9 h. Line: your target.</p>
    </section>
  );
}
function Stat({ k, n, s, extra, gold }: { k: string; n: string; s: string; extra?: string | null; gold?: boolean }) {
  return (
    <div className={cx("fz-stat", gold && "gold")}>
      <span className="fz-stat-k">{k}</span>
      <b className="fz-stat-n f-num">{n}</b>
      <span className="fz-stat-s">{s}</span>
      {extra && <span className="fz-stat-x">{extra}</span>}
    </div>
  );
}
const I = ({ children, size = 22 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
export const MoonIcon = ({ size = 22 }: { size?: number }) => <I size={size}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></I>;
const ChevronIcon = () => <I size={20}><path d="M9 6l6 6-6 6" /></I>;
const LockIcon = () => <I size={16}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></I>;

// PS Fitness, History > Days (V1.44, a friend's request passed on by the developer: "see history, like the sleep data, fitness
// data ... to be able to see it nicely, day by day and export it" and "obviously compete"). A month calendar where each
// day shows its sleep and training, the chosen day in full, the month's numbers and charts (hours asleep, bed and wake
// times, training volume), each week, new bests, the squad boards for this week, and Export (Copy for Claude, CSV per
// kind, one JSON). Everything is read from the open vault and made on this device. Pure rules: health-logic.ts.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GOS, haptic } from "../gos/bridge";
import { homeTz } from "../core/tz";
import { fmtMins } from "../core/sleep";
import { fmtKg, dayLabel } from "../core/fitness";
import { actName, fmtKm, fmtPace, fmtTime } from "../core/activity";
import { boards } from "../core/gymsquad";
import { useGymLease, useGymSquad } from "../squad/gymclient";
import { useSleep } from "./sleep-store";
import { useActivities } from "./activity-store";
import type { FitView } from "./store";
import { fmtThousands } from "./hist-logic";
import { copyText } from "./ImportExport";
import { Modal, peopleOf, PeopleIcon } from "./Squad";
import {
  ALL, RANGES, actsCsv, addMonth, axisLabels, claudeText, exportName, fmtDayLong, healthDays, healthJson, hoursShort, lastOfMonth, firstOfMonth,
  monthGrid, monthLabel, monthOf, rangeCount, rangeFor, rangeWords, setsCsv, sleepAxis, sleepBar, sleepCsv, streaksNow, summarize, BEST_SHORT,
  type HealthData, type HealthDay, type Include, type RangeKey,
} from "./health-logic";
import "./days.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const nb = (s: string) => s.replace(/ /g, " ");

/** Everything the Days view reads, from the open vault (one sleep per wake date). */
export function useHealthData(v: FitView): HealthData {
  const sv = useSleep();
  const acts = useActivities();
  return useMemo(() => ({
    workouts: v.workouts, acts, tz: homeTz(), target: v.prefs.sleepTarget, weekGoal: v.prefs.weekGoal ?? 3,
    sleeps: sv.docs.filter((d) => sv.ids.get(d.log.day) === d.id),
  }), [v.workouts, v.prefs.sleepTarget, v.prefs.weekGoal, sv, acts]);
}

/** The month on screen and the day picked, shared by both halves on the Mac. */
export interface DaysState { month: string; day: string; setMonth: (m: string) => void; setDay: (d: string) => void }
export function useDaysState(today: string): DaysState {
  const [month, setMonthRaw] = useState(monthOf(today));
  const [day, setDay] = useState(today);
  const setMonth = (m: string) => {
    const cap = m > monthOf(today) ? monthOf(today) : m;
    setMonthRaw(cap);
    // The picked day follows into the month: today in this month, else its last day.
    setDay(cap === monthOf(today) ? today : lastOfMonth(cap));
  };
  return { month, day, setMonth, setDay };
}

interface Opens { onWorkout: (id: string) => void; onExercise: (key: string) => void; onSquad?: () => void }

// ======================================================================================================
// The left half (phone: the top): Export, the calendar and the picked day
// ======================================================================================================
export function DaysMain({ v, h, s, today, open }: { v: FitView; h: HealthData; s: DaysState; today: string; open: Opens }) {
  const [exp, setExp] = useState(false);
  const from = firstOfMonth(s.month), to = s.month === monthOf(today) ? today : lastOfMonth(s.month);
  const days = useMemo(() => healthDays(h, firstOfMonth(s.month), lastOfMonth(s.month)), [h, s.month]);
  const bests = useMemo(() => new Set(summarize(h, from, to).bests.map((b) => b.date)), [h, from, to]);
  const picked = days.find((d) => d.date === s.day) ?? null;
  return (
    <div className="fd">
      <button type="button" className="fd-export-b" onClick={() => { haptic("press"); setExp(true); }}
        data-tip="Export" data-tip-line="Copy for Claude, CSV or JSON. Made on this device">
        <ExportIcon /><span><b>Export</b><small>Copy for Claude, CSV or JSON</small></span>
      </button>
      <Calendar s={s} days={days} today={today} target={h.target ?? 420} bests={bests} />
      {picked && <DayCard v={v} d={picked} today={today} open={open} target={h.target} />}
      {exp && <ExportSheet h={h} today={today} month={s.month} onClose={() => setExp(false)} />}
    </div>
  );
}

function Calendar({ s, days, today, target, bests }: { s: DaysState; days: HealthDay[]; today: string; target: number; bests: Set<string> }) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const grid = useMemo(() => monthGrid(s.month), [s.month]);
  const atNow = s.month >= monthOf(today);
  const [dir, setDir] = useState<"l" | "r" | "">("");
  const go = (n: number) => { haptic("tick"); setDir(n < 0 ? "l" : "r"); s.setMonth(addMonth(s.month, n)); };
  return (
    <section className="fd-cal" aria-label={`Calendar, ${monthLabel(s.month)}`}>
      <header className="fd-cal-h">
        <button type="button" className="fd-arrow" onClick={() => go(-1)} aria-label="Month before" data-tip="Month before"><Chev left /></button>
        <h3 aria-live="polite">{monthLabel(s.month)}</h3>
        <button type="button" className="fd-arrow" onClick={() => go(1)} disabled={atNow} aria-label="Next month" data-tip="Next month"><Chev /></button>
      </header>
      <div className="fd-cal-wd" aria-hidden="true">{["M", "T", "W", "T", "F", "S", "S"].map((l, i) => <span key={i}>{l}</span>)}</div>
      <div className={cx("fd-cal-g", dir && `in-${dir}`)} key={s.month} role="grid">
        {grid.map((wk, i) => (
          <div key={i} className="fd-cal-r" role="row">
            {wk.map((date, j) => {
              if (!date) return <span key={j} className="fd-cell blank" role="gridcell" />;
              const d = byDate.get(date)!;
              const later = date > today;
              const fill = d.mins != null ? Math.min(1, d.mins / target) : 0;
              const words = [fmtDayLong(date), d.mins != null ? `slept ${fmtMins(d.mins)}` : "", d.workouts.length ? `trained, ${d.sets} sets` : "", d.acts.length ? d.acts.map((a) => actName(a.kind).toLowerCase()).join(", ") : "", bests.has(date) ? "new best" : ""].filter(Boolean).join(", ");
              return (
                <button key={date} type="button" role="gridcell" disabled={later} aria-selected={s.day === date} aria-label={words}
                  className={cx("fd-cell", date === today && "today", s.day === date && "on", later && "later", d.workouts.length > 0 && "trained")}
                  onClick={() => { haptic("tick"); s.setDay(date); }}>
                  <span className="fd-cell-n f-num">{Number(date.slice(8))}</span>
                  <span className="fd-cell-m" aria-hidden="true">
                    {d.workouts.length > 0 && <i className="fd-m-gym" />}
                    {d.acts.length > 0 && <i className="fd-m-act" />}
                    {bests.has(date) && <i className="fd-m-best" />}
                  </span>
                  <span className="fd-cell-sl" aria-hidden="true"><i className={cx(d.onTarget && "ok")} style={{ transform: `scaleX(${fill})` }} /></span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="fd-key"><span><i className="fd-m-gym" /> Trained</span><span><i className="fd-m-act" /> Run or walk</span><span><i className="fd-m-best" /> New best</span><span><i className="fd-key-sl" /> Sleep, full at your target</span></p>
    </section>
  );
}

function DayCard({ v, d, today, open, target }: { v: FitView; d: HealthDay; today: string; open: Opens; target?: number }) {
  const ref = useRef<HTMLElement>(null);
  const first = useRef(true);
  // A day picked from the charts further down: bring its card into view (not on the first draw).
  useEffect(() => { if (first.current) { first.current = false; return; } ref.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }); }, [d.date]);
  const title = d.date === today ? "Today" : fmtDayLong(d.date);
  const t = target ?? 420;
  return (
    <section ref={ref} className="fd-day" key={d.date} aria-label={title}>
      <h3 className="fd-day-h">{title}</h3>
      <div className={cx("fd-line", "fd-sleep", !d.sleep && "none")}>
        <span className="fd-line-i" aria-hidden="true"><Moon /></span>
        {d.sleep ? (
          <span className="fd-line-t">
            <b className="f-num">{nb(fmtMins(d.mins!))}</b> asleep{d.onTarget ? "" : `, under your ${fmtMins(t)}`}
            <small>{d.asleep} to {d.wake}{d.sleep.rested != null ? ` · rested ${d.sleep.rested} of 5` : ""}{d.sleep.src === "sleepmode" ? " · from Sleep mode" : ""}</small>
          </span>
        ) : <span className="fd-line-t">No sleep logged<small>Log a night in Sleep, up to 2 days back</small></span>}
      </div>
      {d.workouts.map((w) => {
        const title = v.programs.find((p) => p.id === w.data.programId)?.data.days.find((x) => x.id === w.data.dayId)?.title;
        const exs = w.data.exercises.filter((e) => !e.removed && e.sets.some((x) => x.done && !x.gone)).map((e) => e.name);
        return (
          <button key={w.id} type="button" className="fd-line fd-work" onClick={() => open.onWorkout(w.id)} data-tip="Open this workout" data-tip-line="Every set, fix a mistake, add a note">
            <span className="fd-line-i" aria-hidden="true"><Dumbbell /></span>
            <span className="fd-line-t">
              <b>{w.data.programId ? dayLabel(w.data.week, w.data.dayName) : w.data.dayName}{title ? ` · ${title}` : ""}</b>
              <small>{exs.slice(0, 4).join(", ")}{exs.length > 4 ? ` and ${exs.length - 4} more` : ""}</small>
            </span>
            <span className="fd-line-n f-num">{fmtThousands(w.data.exercises.reduce((n, e) => n + (e.removed ? 0 : e.sets.filter((x) => x.done && !x.warm).length), 0))}<small>sets</small></span>
            <Chev />
          </button>
        );
      })}
      {d.acts.map((a, i) => (
        <div key={i} className="fd-line fd-act">
          <span className="fd-line-i" aria-hidden="true"><Shoe /></span>
          <span className="fd-line-t"><b>{actName(a.kind)}</b><small>{fmtKm(a.km)} km in {fmtTime(a.secs)} · {fmtPace(a.kind, a.km, a.secs)}</small></span>
        </div>
      ))}
      {!d.workouts.length && !d.acts.length && <p className="fd-muted">{d.date > today ? "Still to come." : "No training logged."}</p>}
    </section>
  );
}

// ======================================================================================================
// The right half (phone: further down): the month in numbers, charts, weeks, bests and the squad
// ======================================================================================================
export function DaysSide({ h, s, today, open }: { h: HealthData; s: DaysState; today: string; open: Opens }) {
  const from = firstOfMonth(s.month), to = s.month === monthOf(today) ? today : lastOfMonth(s.month);
  const sum = useMemo(() => summarize(h, from, to), [h, from, to]);
  const days = useMemo(() => healthDays(h, firstOfMonth(s.month), lastOfMonth(s.month)), [h, s.month]);
  const now = s.month === monthOf(today) ? streaksNow(h, today) : null;
  const target = h.target ?? 420;
  return (
    <div className="fd fd-side">
      <section className="fd-card" aria-label={`${monthLabel(s.month)} in numbers`}>
        <h3 className="fd-h">{s.month === monthOf(today) ? "This month" : monthLabel(s.month)}</h3>
        <div className="fd-tiles">
          <Tile n={`${sum.trained}`} t={sum.trained === 1 ? "day trained" : "days trained"} />
          <Tile n={`${sum.sets}`} t="working sets" />
          <Tile n={fmtThousands(sum.volume)} t="kg moved" />
          <Tile n={sum.avgSleep != null ? fmtMins(sum.avgSleep) : "?"} t="average sleep" />
          <Tile n={`${sum.onTarget} of ${sum.nights}`} t="nights on target" />
          {sum.acts > 0 ? <Tile n={fmtKm(sum.km)} t={`km over ${sum.acts} ${sum.acts === 1 ? "run or walk" : "runs and walks"}`} /> : <Tile n={`${sum.bests.length}`} t={sum.bests.length === 1 ? "new best" : "new bests"} gold={sum.bests.length > 0} />}
        </div>
        {now && (
          <div className="fd-streaks">
            <Streak n={now.sleep} t={now.sleep === 1 ? "night on target in a row" : "nights on target in a row"} />
            <Streak n={now.trainDays} t={now.trainDays === 1 ? "day trained in a row" : "days trained in a row"} />
            <Streak n={now.goalWeeks} t={now.goalWeeks === 1 ? `week on your ${now.goal} day goal` : `weeks on your ${now.goal} day goal`} />
          </div>
        )}
        {sum.usualAsleep && sum.usualWake && <p className="fd-muted">Usually asleep about {sum.usualAsleep}, up about {sum.usualWake}.</p>}
      </section>

      <MonthCharts days={days} today={today} target={target} s={s} />

      {sum.weeks.length > 0 && (
        <section className="fd-card" aria-label="Each week">
          <h3 className="fd-h">Each week</h3>
          <ol className="fd-weeks">
            {sum.weeks.map((w) => (
              <li key={w.monday}>
                <span className="fd-wk-d">{w.from === w.to ? fmtDayLong(w.from).slice(0, -5) : `${fmtDayLong(w.from).slice(4, -5)} to ${fmtDayLong(w.to).slice(4, -5)}`}</span>
                <span className="fd-wk-n"><b className="f-num">{w.trained}</b> days · <b className="f-num">{w.sets}</b> sets · <b className="f-num">{fmtThousands(w.volume)}</b> kg</span>
                <span className="fd-wk-n">{w.nights ? <><b className="f-num">{nb(fmtMins(w.avgSleep ?? 0))}</b> average sleep · <b className="f-num">{w.onTarget}</b> of {w.nights} on target</> : "No sleep logged"}{w.km ? <> · <b className="f-num">{fmtKm(w.km)}</b> km</> : null}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {sum.bests.length > 0 && (
        <section className="fd-card" aria-label="New bests">
          <h3 className="fd-h">New bests</h3>
          {sum.bests.slice().reverse().map((b) => (
            <button key={`${b.workoutId}${b.key}`} type="button" className="fd-best" onClick={() => open.onExercise(b.key)} data-tip="See this exercise" data-tip-line="Its line over time">
              <Star />
              <span><b>{b.name}</b><small>{fmtKg(b.kg)} kg{b.perSide ? " each side" : ""} x {b.reps}, {BEST_SHORT[b.kind]} · {fmtDayLong(b.date).slice(0, -5)}</small></span>
              <Chev />
            </button>
          ))}
        </section>
      )}

      <Compete today={today} onSquad={open.onSquad} />
    </div>
  );
}

function Tile({ n, t, gold }: { n: string; t: string; gold?: boolean }) {
  return <div className={cx("fd-tile", gold && "gold")}><b className="f-num">{nb(n)}</b><span>{t}</span></div>;
}
function Streak({ n, t }: { n: number; t: string }) {
  return <div className={cx("fd-streak", n > 0 && "on")}><b className="f-num">{n}</b><span>{t}</span></div>;
}

// ---------- the three charts, one column per day, a tap picks the day ----------
const CW = 340, PL = 34, PR = 6;
function MonthCharts({ days, today, target, s }: { days: HealthDay[]; today: string; target: number; s: DaysState }) {
  const n = days.length, colW = (CW - PL - PR) / n;
  const x = (i: number) => PL + i * colW + colW / 2;
  const bw = Math.max(3, colW * 0.62);
  const sel = days.findIndex((d) => d.date === s.day);
  const pick = (i: number) => { if (days[i].date > today) return; haptic("tick"); s.setDay(days[i].date); };
  const labels = days.map((d, i) => ({ i, t: String(Number(d.date.slice(8))) })).filter((l) => l.i === 0 || (l.i + 1) % 7 === 0 || l.i === n - 1);
  const xAxis = (y: number) => <g className="fd-ax">{labels.map((l) => <text key={l.i} x={x(l.i)} y={y} textAnchor="middle">{l.t}</text>)}</g>;
  const hits = (h: number) => days.map((d, i) => (
    <rect key={d.date} className="fd-hit" x={PL + i * colW} y={0} width={colW} height={h} onClick={() => pick(i)}
      tabIndex={d.date > today ? -1 : 0} role="button" aria-label={fmtDayLong(d.date)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(i); } }} />
  ));
  const cursor = (h: number) => (sel >= 0 ? <rect className="fd-sel" x={PL + sel * colW + 0.5} y={2} width={Math.max(1, colW - 1)} height={h - 4} rx={3} /> : null);

  // Hours asleep
  const maxM = Math.max(10 * 60, ...days.map((d) => d.mins ?? 0));
  const H1 = 150, B1 = 128, yM = (m: number) => B1 - (m / maxM) * (B1 - 12);
  // Bed and wake times
  const logs = days.flatMap((d) => (d.sleep ? [d.sleep] : []));
  const axis = sleepAxis(logs);
  const H2 = 190, T2 = 10, B2 = 168, yT = (min: number) => T2 + (min / 1440) * (B2 - T2);
  // Training volume, km as a dot
  const maxV = Math.max(1, ...days.map((d) => d.volume));
  const H3 = 130, B3 = 108, yV = (v: number) => B3 - (v / maxV) * (B3 - 14);
  const d = sel >= 0 ? days[sel] : null;
  return (
    <section className="fd-card fd-charts" aria-label="Charts for the month">
      <h3 className="fd-h">Hours asleep</h3>
      <p className="fd-read" aria-live="polite">{d ? <>{fmtDayLong(d.date).slice(0, -5)}: <b className="f-num">{d.mins != null ? nb(fmtMins(d.mins)) : "not logged"}</b></> : null}</p>
      <svg viewBox={`0 0 ${CW} ${H1}`} className="fd-svg" role="img" aria-label="Hours asleep each day">
        {cursor(H1 - 18)}
        <g className="fd-grid">{[0, 4, 8].filter((h) => h * 60 <= maxM).map((h) => <g key={h}><line x1={PL} x2={CW - PR} y1={yM(h * 60)} y2={yM(h * 60)} /><text x={PL - 6} y={yM(h * 60) + 4} textAnchor="end">{h} h</text></g>)}</g>
        <line className="fd-target" x1={PL} x2={CW - PR} y1={yM(target)} y2={yM(target)} />
        <g className="fd-bars">
          {days.map((dd, i) => dd.mins != null && (
            <rect key={dd.date} className={cx("fd-bar", dd.onTarget && "ok")} x={x(i) - bw / 2} y={yM(dd.mins)} width={bw} height={B1 - yM(dd.mins)} rx={Math.min(3, bw / 2)} style={{ animationDelay: `${i * 12}ms` }} />
          ))}
        </g>
        {xAxis(H1 - 4)}
        {hits(H1 - 18)}
      </svg>
      <p className="fd-help">Line: your {fmtMins(target)} target. Gold: on target. {d?.mins != null ? `${hoursShort(d.mins)} h on the picked day.` : ""}</p>

      <h3 className="fd-h">Bed and wake times</h3>
      <svg viewBox={`0 0 ${CW} ${H2}`} className="fd-svg" role="img" aria-label="When each sleep started and ended">
        {cursor(H2 - 18)}
        <g className="fd-grid">{axisLabels(axis).map((l) => <g key={l.at}><line x1={PL} x2={CW - PR} y1={yT(l.at)} y2={yT(l.at)} /><text x={PL - 6} y={yT(l.at) + 4} textAnchor="end">{l.t}</text></g>)}</g>
        <g className="fd-bars">
          {days.map((dd, i) => {
            if (!dd.sleep) return null;
            const b = sleepBar(dd.sleep, axis);
            return (
              <g key={dd.date} style={{ animationDelay: `${i * 12}ms` }} className="fd-win">
                <rect className={cx("fd-bar", dd.onTarget && "ok")} x={x(i) - bw / 2} y={yT(b.from)} width={bw} height={Math.max(2, yT(b.to) - yT(b.from))} rx={Math.min(3, bw / 2)} />
                {b.breaks.map((br, k) => <rect key={k} className="fd-break" x={x(i) - bw / 2} y={yT(br.from)} width={bw} height={Math.max(1.5, yT(br.to) - yT(br.from))} />)}
              </g>
            );
          })}
        </g>
        {xAxis(H2 - 4)}
        {hits(H2 - 18)}
      </svg>
      <p className="fd-help">Each bar runs from falling asleep (top) to waking (bottom). Gaps are time awake in the night.{d?.sleep ? ` Picked: ${d.asleep} to ${d.wake}.` : ""}</p>

      <h3 className="fd-h">Training</h3>
      <svg viewBox={`0 0 ${CW} ${H3}`} className="fd-svg" role="img" aria-label="Kilograms moved each day">
        {cursor(H3 - 18)}
        <g className="fd-grid"><line x1={PL} x2={CW - PR} y1={B3} y2={B3} /><text x={PL - 6} y={yV(maxV) + 4} textAnchor="end">{maxV >= 1000 ? `${Math.round(maxV / 1000)}k` : Math.round(maxV)}</text></g>
        <g className="fd-bars">
          {days.map((dd, i) => dd.volume > 0 && <rect key={dd.date} className="fd-bar ok" x={x(i) - bw / 2} y={yV(dd.volume)} width={bw} height={B3 - yV(dd.volume)} rx={Math.min(3, bw / 2)} style={{ animationDelay: `${i * 12}ms` }} />)}
          {days.map((dd, i) => dd.km > 0 && <circle key={`k${dd.date}`} className="fd-km" cx={x(i)} cy={B3 - 6} r={Math.min(4, bw / 2 + 0.5)} />)}
        </g>
        {xAxis(H3 - 4)}
        {hits(H3 - 18)}
      </svg>
      <p className="fd-help">Bars: kg moved (kg times reps over every working set). Dots: a run, walk, ride or swim.{d && d.volume ? ` Picked: ${fmtThousands(d.volume)} kg.` : ""}</p>
    </section>
  );
}

// ---------- compete: the squad's boards for this week, from what each person shares ----------
function Compete({ today, onSquad }: { today: string; onSquad?: () => void }) {
  const g = useGymSquad();
  useGymLease(g.on && g.in);
  const all = useMemo(() => boards(peopleOf(g), today), [g, today]);
  if (!g.on) return null;
  if (!g.in) {
    return (
      <section className="fd-card fd-vs" aria-label="Compete">
        <h3 className="fd-h">Compete</h3>
        <p className="fd-muted">Join or make a G Squad with the G Squad button in PS app, then this week's boards show here.</p>
      </section>
    );
  }
  const pick = (["showed", "sleep"] as const).map((id) => all.find((b) => b.id === id)!).filter(Boolean);
  return (
    <section className="fd-card fd-vs" aria-label="Compete with your squad">
      <h3 className="fd-h">Compete this week</h3>
      {pick.map((b) => {
        const mine = b.rows.find((r) => r.me);
        const shared = b.id === "sleep" ? g.share.sleep : g.share.fitness;
        return (
          <div key={b.id} className="fd-vs-b">
            <p className="fd-vs-t"><b>{b.id === "showed" ? "Showed up" : "Sleep"}</b>
              <span>{!shared ? "You do not share this, so you are not on it" : mine ? `You are ${ordinal(mine.rank)} of ${b.rows.length}` : "Nothing yet this week"}</span></p>
            {b.rows.length ? (
              <ol className="fd-vs-l">
                {b.rows.slice(0, 3).map((r) => <li key={r.id} className={cx(r.me && "me")}><span className="f-num">{r.rank}</span><b>{r.name}</b><em className="f-num">{nb(r.text)}</em></li>)}
                {mine && mine.rank > 3 && <li className="me"><span className="f-num">{mine.rank}</span><b>{mine.name}</b><em className="f-num">{nb(mine.text)}</em></li>}
              </ol>
            ) : <p className="fd-muted">{b.id === "sleep" ? "Nobody shares sleep yet." : "Nobody shares Fitness yet."}</p>}
          </div>
        );
      })}
      <p className="fd-muted">Only what each person shares is on the boards. Switched off, nothing of it is sent. Per exercise: open one in Progress and press Squad.</p>
      {onSquad && <button type="button" className="fd-btn" onClick={() => { haptic("press"); onSquad(); }}><PeopleIcon size={18} /> All squad boards and challenges</button>}
    </section>
  );
}
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;

// ======================================================================================================
// Export: Copy for Claude, CSV per kind, one JSON. Made here; PS never sends it anywhere.
// ======================================================================================================
/** Saves a text file the way the Fitness week export does (PS on the Mac shows its own Save panel). */
function saveFile(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ExportSheet({ h, today, month, onClose }: { h: HealthData; today: string; month?: string; onClose: () => void }) {
  const [range, setRange] = useState<RangeKey | "shown">(month && month !== monthOf(today) ? "shown" : "4w");
  const [inc, setInc] = useState<Include>(ALL);
  const [msg, setMsg] = useState("");
  const [peek, setPeek] = useState(false);
  const r = range === "shown" && month ? { from: firstOfMonth(month), to: lastOfMonth(month) } : rangeFor(range === "shown" ? "4w" : range, today, h);
  const count = rangeCount(h, r.from, r.to, inc);
  const text = useMemo(() => (peek ? claudeText(h, r.from, r.to, inc) : ""), [peek, h, r.from, r.to, inc]);
  const none = !inc.fitness && !inc.sleep && !inc.acts;
  const flip = (k: keyof Include) => { haptic("tick"); setMsg(""); setInc((x) => ({ ...x, [k]: !x[k] })); };
  const copy = async () => {
    const ok = await copyText(claudeText(h, r.from, r.to, inc));
    haptic(ok ? "press" : "reject");
    setMsg(ok ? "Copied. Paste it into Claude and ask what to do next." : "Copy did not work here. Use a download below instead.");
  };
  const save = async (what: "sets" | "sleep" | "activities" | "health") => {
    const name = exportName(what, r.from, r.to);
    const json = what === "health";
    const text = json ? JSON.stringify(healthJson(h, r.from, r.to, inc), null, 2) : what === "sets" ? setsCsv(h, r.from, r.to) : what === "sleep" ? sleepCsv(h, r.from, r.to) : actsCsv(h, r.from, r.to);
    // The phone app saves only encrypted backups to Downloads, so there the file's text is copied instead.
    if (GOS) {
      const ok = await copyText(text);
      haptic(ok ? "press" : "reject");
      setMsg(ok ? `Copied the ${json ? "JSON" : "CSV"}. Paste it into ${json ? "a note or a file" : "Google Sheets or a note"}.` : "Copy did not work here.");
      return;
    }
    saveFile(text, name, json ? "application/json" : "text/csv;charset=utf-8");
    haptic("press");
    setMsg(`Saved as ${name}.`);
  };
  const dl = GOS ? "Copy" : "";
  return (
    <Modal label="Export" onClose={onClose} tall>
      {() => (
        <div className="fd-exp">
          <h2 className="fd-title">Export</h2>
          <p className="fd-muted">For your trainer, a sheet, or Claude as your coach. Made on this device: PS app never sends it anywhere, you paste or save it yourself.</p>
          <h3 className="fd-h">Which days</h3>
          <div className="fd-chips" role="radiogroup" aria-label="Which days">
            {month && month !== monthOf(today) && <Chip on={range === "shown"} onClick={() => { setRange("shown"); setMsg(""); }}>{monthLabel(month)}</Chip>}
            {RANGES.map((x) => <Chip key={x.k} on={range === x.k} onClick={() => { setRange(x.k); setMsg(""); }}>{x.t}</Chip>)}
          </div>
          <p className="fd-range f-num">{rangeWords(r.from, r.to)}</p>
          <h3 className="fd-h">What to put in</h3>
          <div className="fd-chips" role="group" aria-label="What to put in">
            <Chip on={inc.fitness} check onClick={() => flip("fitness")}>Workouts</Chip>
            <Chip on={inc.sleep} check onClick={() => flip("sleep")}>Sleep</Chip>
            <Chip on={inc.acts} check onClick={() => flip("acts")}>Runs and walks</Chip>
          </div>
          <p className="fd-count" aria-live="polite">{count}</p>
          <button type="button" className="fd-btn fd-primary" disabled={none} onClick={() => void copy()} data-tip="Copy for Claude" data-tip-line="A plain text log to paste into Claude">
            <CopyIcon /> Copy for Claude
          </button>
          <button type="button" className="fd-link" aria-expanded={peek} onClick={() => { haptic("tick"); setPeek((p) => !p); }}>{peek ? "Hide what gets copied" : "See what gets copied"}</button>
          {peek && <pre className="fd-peek" tabIndex={0}>{text}</pre>}
          <h3 className="fd-h">{GOS ? "Copy as a file" : "Download"}</h3>
          <div className="fd-dl">
            <button type="button" className="fd-btn" disabled={!inc.fitness} onClick={() => void save("sets")}>{dl ? `${dl} workout sets` : "Workout sets"} (CSV)</button>
            <button type="button" className="fd-btn" disabled={!inc.sleep} onClick={() => void save("sleep")}>{dl ? `${dl} sleep` : "Sleep"} (CSV)</button>
            <button type="button" className="fd-btn" disabled={!inc.acts} onClick={() => void save("activities")}>{dl ? `${dl} runs and walks` : "Runs and walks"} (CSV)</button>
            <button type="button" className="fd-btn" disabled={none} onClick={() => void save("health")}>{dl ? `${dl} everything` : "Everything"} (JSON)</button>
          </div>
          {msg && <p className="fd-ok" role="status">{msg}</p>}
          <p className="fd-muted">CSV opens in Google Sheets, Numbers or Excel. JSON keeps every detail for another app.</p>
        </div>
      )}
    </Modal>
  );
}
function Chip({ on, check, onClick, children }: { on: boolean; check?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role={check ? "checkbox" : "radio"} aria-checked={on} className={cx("fd-chip", on && "on")} onClick={() => { haptic("tick"); onClick(); }}>
      {check && <span className="fd-chip-c" aria-hidden="true">{on && <Tick />}</span>}{children}
    </button>
  );
}

// ---------- icons ----------
function Svg({ size = 20, w = 2.2, children, fill }: { size?: number; w?: number; children: ReactNode; fill?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}
const Chev = ({ left }: { left?: boolean }) => <Svg size={20} w={2.6}><path d={left ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} /></Svg>;
const Moon = () => <Svg><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></Svg>;
const Dumbbell = () => <Svg><path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11" /></Svg>;
const Shoe = () => <Svg><path d="M3 16.5V9.5l4 1.5 2.5-3 3 4.5 5 1.5a3 3 0 0 1 3.5 3v1H3z" /><path d="M3 19.5h18" /></Svg>;
const Star = () => <Svg size={18} fill><path d="M12 2.8l2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.3l-5.7 3 1.1-6.3L2.8 9.5l6.4-.9z" /></Svg>;
const ExportIcon = () => <Svg size={22}><path d="M12 3v12" /><path d="M7.5 7.5L12 3l4.5 4.5" /><path d="M5 13v6.5h14V13" /></Svg>;
const CopyIcon = () => <Svg size={20}><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></Svg>;
const Tick = () => <Svg size={14} w={3.4}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>;

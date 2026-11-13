// PS Fitness home (V1.43, the developer: "make it much simpler"). What matters right now first: one big Start (or Continue while a
// workout is open). Under it a short summary: this week, the last workout, the next session. Then the two daily rows
// that used to sit on the gym screen: last night's sleep and a run, walk, ride or swim. Everything else is in the menu.
import { useMemo, useState } from "react";
import { dayLabel, weekStats } from "../core/fitness";
import { dayKey, gymPrefs, gymTimes } from "../core/gym";
import { settingsData } from "../core/select";
import { isRedAccount } from "../core/account";
import { homeTz } from "../core/tz";
import { todayISO, useVault } from "../ui/kit";
import { haptic } from "../gos/bridge";
import { startDay, type FitView } from "./store";
import { progress, weekDots } from "./gym-logic";
import { fmtDay, fmtDayShort, plural } from "./hist-logic";
import { agoWord, dayAfter, dayMinutes, dayWords, lastFinished, soonWord, type FitArg, type FitSection } from "./nav-logic";
import { SleepToday } from "./Sleep";
import { ActivityRow } from "./Activity";
import { NavIcons } from "./Nav";
import { SetupCard } from "./Setup";
import { endSetup, useSetupDraft } from "./setup-store";
import { Info } from "./Info";
import "./nav.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Home({ v, go }: { v: FitView; go: (s: FitSection, arg?: FitArg) => void }) {
  const today = todayISO();
  const [busy, setBusy] = useState(false);
  const p = v.program, next = v.next;
  const day = p && next ? p.data.days[next.dayIndex] ?? null : null;
  const stats = weekStats(v.workouts, today, v.prefs.weekGoal ?? 3);
  const last = useMemo(() => lastFinished(v.workouts), [v.workouts]);
  const vault = useVault();
  const gym = gymPrefs(settingsData(vault).gym, isRedAccount(vault));
  const draft = useSetupDraft(v);   // V1.47: a setup saved but not finished shows on top until finished or discarded

  const start = (free?: boolean) => {
    if (busy) return;
    setBusy(true); haptic("press");
    startDay(free ? { free: true } : {}).then(() => go("gym")).catch(() => { setBusy(false); haptic("reject"); });
  };

  // ---------- the one big thing ----------
  let hero;
  if (v.open) {
    const w = v.open.data, pr = progress(w);
    hero = (
      <section className="fn-hero live" aria-label="Workout in progress">
        <p className="fn-kick"><span className="fn-live-dot" aria-hidden="true" />Workout in progress</p>
        <h2 className="fn-h f-num">{dayLabel(w.week, w.dayName)}</h2>
        <p className="fn-sub">{pr.total ? `${pr.done} of ${plural(pr.total, "set")} done` : "No sets yet: add an exercise"}</p>
        {pr.total > 0 && <span className="fn-bar" aria-hidden="true"><i style={{ transform: `scaleX(${pr.done / pr.total})` }} /></span>}
        <button type="button" className="fn-go" onClick={() => { haptic("press"); go("gym"); }}>Continue {dayWords({ name: w.dayName, title: p?.data.days.find((d) => d.id === w.dayId)?.title })}</button>
      </section>
    );
  } else if (p && next && day) {
    const sets = day.exercises.reduce((n, e) => n + e.sets.length, 0);
    hero = (
      <section className="fn-hero" aria-label="Today's workout">
        <p className="fn-kick">{next.locked ? "Today's workout · repeating this day" : "Today's workout"}</p>
        <h2 className="fn-h f-num">{dayLabel(next.week, day.name)}{day.title && <span className="fn-h-t">{day.title}</span>}</h2>
        {day.exercises.length > 0 && <p className="fn-exs">{day.exercises.map((e) => e.name).join(" · ")}</p>}
        <p className="fn-sub">
          {day.exercises.length ? [plural(day.exercises.length, "exercise"), sets ? plural(sets, "set") : "", `about ${dayMinutes(day, v.prefs)} min`].filter(Boolean).join(" · ") : "No exercises yet: add them as you go"}
        </p>
        <button type="button" className={cx("fn-go", busy && "busy")} onClick={() => start()} disabled={busy}>Start {dayWords(day)}</button>
        <button type="button" className="fn-link" onClick={() => { haptic("press"); go("gym", { k: "pick" }); }}>Do a different day or a free workout</button>
      </section>
    );
  } else {
    hero = (
      <section className="fn-hero" aria-label="Start">
        <p className="fn-kick">Ready when you are</p>
        <h2 className="fn-h">{p ? "This program has no days yet" : "No program yet"}</h2>
        <p className="fn-sub">Answer a few questions for a plan made for you, train now and add exercises as you go, or add your trainer's plan once so each visit opens on the right day.<Info k="program" /></p>
        {!p && !draft && <button type="button" className="fn-go" onClick={() => { haptic("press"); go("setup"); }}>Set up my training</button>}
        <button type="button" className={cx(!p && !draft ? "fn-link" : "fn-go", busy && "busy")} onClick={() => start(true)} disabled={busy}>Start a free workout</button>
        <button type="button" className="fn-link" onClick={() => { haptic("press"); go("plan"); }}>Build my program</button>
      </section>
    );
  }

  // ---------- the summary ----------
  const trainedToday = v.workouts.some((w) => w.data.date === today && (w.data.endedAt || w.id === v.open?.id));
  const tz = homeTz(), now = Date.now(), todayKey = dayKey(now, tz);
  const slot = gymTimes(gym, now, tz, 8).find((g) => g.at > now && !(trainedToday && g.day === todayKey)) ?? null;
  const slotWord = slot ? `${soonWord(slot.day, todayKey, (d) => fmtDay(d).split(" ")[0])} ${gym.time}` : null;
  const after = v.open
    ? (next && day && next.dayId !== v.open.data.dayId ? { week: next.week, name: day.name } : dayAfter(p, next))
    : dayAfter(p, next);
  const W = NavIcons.history, L = NavIcons.gym, Nx = NavIcons.plan;
  return (
    <div className="fn">
      {draft && !v.open && <SetupCard d={draft} onOpen={() => go("setup")} onDiscard={() => { void endSetup(); }} />}
      {hero}
      <div className="fn-tiles">
        <button type="button" className="fn-tile" onClick={() => { haptic("press"); go("history"); }} aria-label={`This week: ${stats.count} of ${stats.goal} days. Open History`}>
          <span className="fn-tile-k"><W size={16} />This week</span>
          <span className="fn-tile-big"><b className="f-num">{stats.count}</b><small>of {stats.goal}</small></span>
          <span className="fn-dots" aria-hidden="true">{weekDots(stats.count, stats.goal).map((on, i) => <i key={i} className={on ? "on" : ""} />)}</span>
          <span className="fn-tile-s">{stats.streakWeeks > 1 ? `${stats.streakWeeks} weeks in a row` : stats.count >= stats.goal ? "Goal met" : "days trained"}</span>
        </button>
        <button type="button" className="fn-tile" disabled={!last} onClick={() => { if (!last) return; haptic("press"); go("history", { k: "w", id: last.id }); }}
          aria-label={last ? `Last workout ${fmtDay(last.data.date)}. Open it` : "No workout yet"}>
          <span className="fn-tile-k"><L size={16} />Last workout</span>
          {last ? (
            <>
              <span className="fn-tile-m">{agoWord(last.data.date, today, fmtDayShort)}</span>
              <span className="fn-tile-s">{last.data.dayName}{(() => { const n = last.data.exercises.reduce((c, e) => c + (e.removed ? 0 : e.sets.filter((s) => s.done && !s.warm && !s.gone).length), 0); return n ? ` · ${plural(n, "set")}` : ""; })()}</span>
            </>
          ) : <span className="fn-tile-m dim">None yet</span>}
        </button>
        <button type="button" className="fn-tile" onClick={() => { haptic("press"); go(slot ? "settings" : "plan"); }}
          aria-label={`Next session${slotWord ? ` ${slotWord}` : ""}${after ? `, ${after.name}` : ""}`}>
          <span className="fn-tile-k"><Nx size={16} />Next session</span>
          <span className="fn-tile-m">{slotWord ?? (after ? after.name : "Any time")}</span>
          <span className="fn-tile-s">{slotWord ? (after ? dayLabel(after.week, after.name) : "Gym reminder") : after ? `Week ${after.week}${after.title ? ` · ${after.title}` : ""}` : "Set a gym reminder in Settings"}</span>
        </button>
      </div>
      <div className="fn-rows">
        <SleepToday v={v} onOpen={() => go("sleep")} compact />
        <ActivityRow v={v} />
      </div>
    </div>
  );
}

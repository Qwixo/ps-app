// Settings for the island timers that are not Pomodoro (V1.58): Stand-up reminders (its own tab, core/standup.ts) and the
// next meeting bubble (Notifications, under Meetings, core/meetbubble.ts). Pomodoro's own are views/Pomodoro.tsx.
// Each is saved for every device; Try it now shows a stand-up on this Mac's island 15 seconds later (never saved).
import { useState } from "react";
import { PS } from "../ps";
import { sfx } from "../ui/sfx";
import { useVault } from "../ui/kit";
import { settingsData } from "../core/select";
import { STAND_LIMITS, STAND_WORDS, standPrefs, type StandPrefs } from "../core/standup";
import { MEET_LEAD_LIMITS, MEET_WORDS, meetBubblePrefs } from "../core/meetbubble";
import { WELCOME_LIMITS, welcomePrefs } from "../core/welcomeback";
import { summaryPrefs } from "../core/workoutsummary";
import type { Settings } from "../core/model";
import { Choice, taskMapActions } from "./TaskMap";
import "./pomodoro.css";

const save = (patch: Partial<Settings>) => void taskMapActions.looks(patch);

function OnOff({ on, ready, set, label, play }: { on: boolean; ready: boolean; set: (v: boolean) => void; label: string; play?: () => void }) {
  return (
    <span className="pm-set-row">
      {play && <button type="button" className="pm-play" onClick={play} aria-label="Play the sound" title="Play">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
      </button>}
      <span className={`tm-ed-seg${ready ? "" : " gs-notyet"}`} role="radiogroup" aria-label={label}>
        <Choice selected={ready && on} onPick={() => { if (ready) { sfx.hover(); set(true); } }}>On</Choice>
        <Choice selected={ready && !on} onPick={() => { if (ready) { sfx.hover(); set(false); } }}>Off</Choice>
      </span>
    </span>
  );
}
export function Stepper({ n, range, unit, set, ready, label }: { n: number; range: readonly [number, number]; unit: string; set: (v: number) => void; ready: boolean; label: string }) {
  const step = (d: number) => { if (!ready) return; sfx.hover(); set(Math.min(range[1], Math.max(range[0], n + d))); };
  return (
    <div className={`pm-step${ready ? "" : " gs-notyet"}`} role="group" aria-label={label}>
      <button type="button" onClick={() => step(-1)} disabled={n <= range[0]} aria-label="Less">-</button>
      <span className="pm-step-v">{n}{unit}</span>
      <button type="button" onClick={() => step(1)} disabled={n >= range[1]} aria-label="More">+</button>
    </div>
  );
}

/** One Stand-up reminders setting. */
export function StandSetting({ k }: { k: "on" | "every" | "len" | "sound" | "hours" | "test" }) {
  const v = useVault();
  const p = standPrefs(settingsData(v).standup);
  const ready = v.status === "unlocked";
  const set = (patch: Partial<StandPrefs>) => save({ standup: { ...p, ...patch } });
  const [tried, setTried] = useState(false);
  if (k === "every") return <Stepper n={p.every} range={STAND_LIMITS.every} unit=" min" ready={ready} label="How often" set={(every) => set({ every })} />;
  if (k === "len") return <Stepper n={p.len} range={STAND_LIMITS.len} unit=" min" ready={ready} label="How long to stand" set={(len) => set({ len })} />;
  if (k === "sound") return <OnOff on={p.sound} ready={ready} label="Stand-up sound" set={(sound) => set({ sound })} play={() => sfx.island("done")} />;
  if (k === "test") {
    return (
      <button type="button" className="pm-btn pm-try" disabled={!PS || !p.on || tried}
        onClick={() => { sfx.click(); setTried(true); save({ standTest: true } as Partial<Settings>); window.setTimeout(() => setTried(false), 15_000); }}>
        {tried ? STAND_WORDS.testing : STAND_WORDS.test}
      </button>
    );
  }
  if (k === "hours") {
    return (
      <span className="pm-set-row pm-hours">
        {p.hours && <>
          <input type="time" value={p.from} aria-label="From" onChange={(e) => set({ from: e.target.value })} />
          <span className="pm-to">to</span>
          <input type="time" value={p.to} aria-label="To" onChange={(e) => set({ to: e.target.value })} />
        </>}
        <OnOff on={p.hours} ready={ready} label="Only between these times" set={(hours) => set({ hours })} />
      </span>
    );
  }
  return <OnOff on={p.on} ready={ready} label="Stand-up reminders" set={(on) => set({ on })} />;
}

/** The next meeting bubble: on and off, and how long before. */
export function MeetBubbleSetting({ k }: { k: "on" | "lead" | "style" }) {
  const v = useVault();
  const p = meetBubblePrefs(settingsData(v).meetBubble);
  const ready = v.status === "unlocked";
  if (k === "style") {
    return (
      <span className={`tm-ed-seg${ready ? "" : " gs-notyet"}`} role="radiogroup" aria-label={MEET_WORDS.settingStyle}>
        <Choice selected={ready && p.style === "blob"} onPick={() => { if (ready) { sfx.hover(); save({ meetBubble: { ...p, style: "blob" } }); } }}>{MEET_WORDS.styleBlob}</Choice>
        <Choice selected={ready && p.style === "pill"} onPick={() => { if (ready) { sfx.hover(); save({ meetBubble: { ...p, style: "pill" } }); } }}>{MEET_WORDS.stylePill}</Choice>
      </span>
    );
  }
  if (k === "lead") return <Stepper n={p.lead} range={MEET_LEAD_LIMITS} unit=" min" ready={ready} label="Show it this long before" set={(lead) => save({ meetBubble: { ...p, lead } })} />;
  return <OnOff on={p.on} ready={ready} label="Next meeting on the island" set={(on) => save({ meetBubble: { ...p, on } })} />;
}

/** Welcome back after being away (PS 1.60): the switch and how many minutes away it takes. */
export function WelcomeBackSetting({ k }: { k: "on" | "minutes" }) {
  const v = useVault();
  const p = welcomePrefs(settingsData(v).welcomeBack);
  const ready = v.status === "unlocked";
  if (k === "minutes") return <Stepper n={p.minutes} range={WELCOME_LIMITS} unit=" min" ready={ready} label="Show it after being away this long" set={(minutes) => save({ welcomeBack: { ...p, minutes } })} />;
  return <OnOff on={p.on} ready={ready} label="Welcome back on the island" set={(on) => save({ welcomeBack: { ...p, on } })} />;
}

/** The workout summary on the Mac after a workout on the phone (PS 1.60). */
export function WorkoutMacSetting() {
  const v = useVault();
  const p = summaryPrefs(settingsData(v).workoutMac);
  return <OnOff on={p.on} ready={v.status === "unlocked"} label="Workout summary on the Mac" set={(on) => save({ workoutMac: { on } })} />;
}

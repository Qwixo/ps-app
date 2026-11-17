// Low power mode (PS 1.65, feature "low-power"): the Tab list's on/off button (top right, next to Network; a Slot, so
// Edit mode can move it) and its rows in Settings, Low power mode. The logic: core/lowpower.ts; the app half: src/lowpower.ts.
// One click turns it on or off. On, the leaf fills in and the button turns a calm green, so it shows clearly.
import { useState, type ReactNode } from "react";
import { asleepLine, asleepNames, lowPower } from "../core/lowpower.ts";
import { feature } from "../core/features";
import { setLowPower, useLowPower } from "../lowpower";
import { sfx } from "../ui/sfx";

const PS = import.meta.env.MODE === "ps";
import "./lowpower.css";

export const LP_WORDS = {
  on: "Low power mode is on. Click to wake everything",
  off: "Low power mode: put the background to sleep, keep your list",
  why: { hand: "Turned on by you", mac: "Turned on by the Mac's Low Power Mode", phone: "Turned on by Battery Saver" } as const,
  wake: "Wake everything",
};

const LEAF = "M4.5 19.5c.6-8.6 6-14.4 15-15-.4 9-6.4 14.4-15 15zM4.5 19.5l7.5-7.5";

export function LowPowerButton() {
  const st = useLowPower();
  const [bump, setBump] = useState(0);
  if (!feature("low-power")) return null;
  const click = () => {
    sfx.click();
    setBump((b) => b + 1);
    setLowPower(st.on ? "wake" : { hand: true });
  };
  return (
    <button type="button" className={`tm-pill-btn icon lp-btn${st.on ? " lp-on" : ""}`} onClick={(e) => { if (e.button === 0) click(); }}
      aria-pressed={st.on} aria-label={st.on ? LP_WORDS.on : LP_WORDS.off} title={st.on ? `${LP_WORDS.on}. ${asleepLine(asleepNames(st, lowPower.feeds(), PS))}` : LP_WORDS.off} data-lp-keep="">
      <svg key={bump} className="lp-leaf" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path className="lp-fill" d={LEAF} />
      </svg>
    </button>
  );
}

/** Settings, Low power mode: the main switch, with what is asleep and why. */
export function LowPowerMain({ OnOff }: { OnOff: (p: { on: boolean; set: (v: boolean) => void; label: string; ready?: boolean }) => ReactNode }) {
  const st = useLowPower();
  return <OnOff label="Low power mode" on={st.on} ready={feature("low-power")} set={(v) => setLowPower(v ? { hand: true } : "wake")} />;
}
export function LowPowerStatus() {
  const st = useLowPower();
  if (!st.on) return null;
  const names = asleepNames(st, lowPower.feeds(), PS);
  return (
    <div className="lp-status" role="status">
      <div className="lp-status-line">{st.why ? `${LP_WORDS.why[st.why]}. ` : ""}{asleepLine(names, 6)}</div>
      <button type="button" className="lp-wake" onClick={() => { sfx.click(); setLowPower("wake"); }}>{LP_WORDS.wake}</button>
    </div>
  );
}
/** One of the person's own switches (auto with the Mac, auto with Battery Saver, alarms keep ringing). */
export function LowPowerPref({ k, label, OnOff }: { k: "autoMac" | "autoPhone" | "alarms"; label: string; OnOff: (p: { on: boolean; set: (v: boolean) => void; label: string; ready?: boolean }) => ReactNode }) {
  const st = useLowPower();
  return <OnOff label={label} on={st.prefs[k]} ready={feature("low-power")} set={(v) => setLowPower({ [k]: v })} />;
}

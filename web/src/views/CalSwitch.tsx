// Meetings from your Calendar, on or off (G Squad, the developer's rule: every feature that runs for friends has its own switch,
// and no permission is asked before it is wanted). Anyone but the developer, PS on a Mac: Settings, General, Alerts, and the
// setup menu. On reads the Calendar app and may ask macOS once, right then; Off never reads it again and macOS is
// never asked (ps.ts "calendarOn", core/localcal.ts calMode). Click only.
import { useSyncExternalStore } from "react";
import { PS } from "../ps";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { settingsData } from "../core/select";
import { isRedAccount } from "../core/account";
import { calStatus } from "../core/calstatus";
import { CAL_WORDS, calMode } from "../core/localcal";
import { taskMapActions } from "./TaskMap";
import type { Settings } from "../core/model";
import { GsCard, GsRow } from "./SettingsScreen";

/** Is the switch on now: chosen on, or never chosen but macOS already allows it (and PS reads it). */
export function useCalendarOn(): boolean {
  const s = useVault();
  const st = useSyncExternalStore(calStatus.subscribe, calStatus.get);
  const mode = calMode(s.status === "unlocked" ? settingsData(s).macCalendar : undefined);
  return mode === "on" || (mode === "quiet" && st.connected === true);
}
export const setCalendarOn = (on: boolean) => { void taskMapActions.looks({ calendarOn: on } as Partial<Settings>); };

export function CalSwitch() {
  const s = useVault();
  const on = useCalendarOn();
  if (!PS || s.status !== "unlocked" || isRedAccount(s)) return null;
  return (
    <div className="tm-ed-seg" role="radiogroup" aria-label={CAL_WORDS.title}>
      <button type="button" role="radio" aria-checked={on} className={`dwell${on ? " on" : ""}`} onClick={() => { if (!on) { sfx.hover(); setCalendarOn(true); } }}>On</button>
      <button type="button" role="radio" aria-checked={!on} className={`dwell${!on ? " on" : ""}`} onClick={() => { if (on) { sfx.hover(); setCalendarOn(false); } }}>Off</button>
    </div>
  );
}

/** Settings, General, Alerts: the card (nothing on the developer's account or outside PS). */
export function CalSwitchCard() {
  const s = useVault();
  if (!PS || s.status !== "unlocked" || isRedAccount(s)) return null;
  return <GsRow><GsCard title={CAL_WORDS.title} note={CAL_WORDS.note}><CalSwitch /></GsCard></GsRow>;
}

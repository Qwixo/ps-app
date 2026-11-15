// Which calendars PS works with (core/calpick.ts, 15 Nov 2026). The picker: calendars grouped by account, a colour dot, the name and
// one three way choice each (Meetings, Show only, Off). It is the "Calendars" row in Settings, Notifications and Do Not Disturb,
// and CalGear (the small button in the Meetings panel) lands on that row. Click only; Esc closes Settings as always.
import { useEffect, useRef, useState } from "react";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { calendarList, settingsData } from "../core/select";
import { CAL_PICK_WORDS as W, groupCals, sameChoices, setChoice, type CalChoices, type CalUse } from "../core/calpick";
import { taskMapActions } from "./TaskMap";
import { openSettings } from "./SettingsScreen";
import "./calpick.css";

const USES: CalUse[] = ["meeting", "show", "off"];

export function CalPicker() {
  const s = useVault();
  const saved = s.status === "unlocked" ? settingsData(s).calChoices : undefined;
  // What was just clicked shows at once; the saved copy arrives a moment later and takes over.
  const [mine, setMine] = useState<CalChoices | null>(null);
  const timer = useRef(0);
  useEffect(() => { if (mine && sameChoices(mine, saved)) setMine(null); }, [saved]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (s.status !== "unlocked") return null;
  const choices = mine ?? saved;
  const groups = groupCals(calendarList(s), choices);
  const pick = (id: string, use: CalUse) => {
    sfx.hover();
    const next = setChoice(choices, id, use);
    setMine(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMine(null), 5000);
    void taskMapActions.looks({ calChoices: next });
  };
  if (!groups.length) return <p className="cp-none">{W.none}</p>;
  return (
    <div className="cp">
      <p className="cp-line">{W.line}</p>
      {groups.map((g) => (
        <section key={g.acct} className="cp-group" aria-label={g.acct || W.title}>
          {g.acct && <h4 className="cp-acct">{g.acct}</h4>}
          <ul className="cp-list">
            {g.cals.map((c) => (
              <li key={c.id} className={`cp-row cp-${c.use}`}>
                <span className="cp-dot" style={c.color ? { background: c.color } : undefined} aria-hidden="true" />
                <span className="cp-name" title={c.name}>{c.name}</span>
                <span className="cp-seg" role="radiogroup" aria-label={`${c.name}: ${W.hint[c.use]}`}>
                  {USES.map((u) => (
                    <button key={u} type="button" role="radio" aria-checked={c.use === u} className={c.use === u ? "on" : ""} title={W.hint[u]}
                      onClick={() => { if (c.use !== u) pick(c.id, u); }}>{W[u]}</button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The small button in the Meetings panel: lands on the Calendars row in Settings (it lights up). */
export function CalGear({ solo }: { solo?: boolean }) {
  return (
    <button type="button" className={`tm-cal-ref tm-cal-pick${solo ? " solo" : ""}`} onClick={() => { sfx.click(); openSettings("notify", { jump: "calendars" }); }}
      aria-label="Choose calendars" title="Choose calendars">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" />
      </svg>
    </button>
  );
}

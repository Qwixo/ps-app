// The NEW badge on fresh tasks (V1.33; rule core/newbadge.ts, one timer src/newbadge.ts, looks newbadge.css).
// The badge sits on the task's top left corner. A click (a tap on the phone) hides it for that task on every device;
// it never opens, picks or drags the task. Settings, General: on or off, and for how many minutes.
import { useEffect, useState } from "react";
import type { Doc, Settings, Todo } from "../core/model";
import { NEW_MIN_HIGH, NEW_MIN_LOW, NEW_MIN_PICKS } from "../core/newbadge";
import { newBadgeSettings, useIsNew } from "../newbadge";
import { sfx } from "../ui/sfx";
import { useVault } from "../ui/kit";
import { settingsData } from "../core/select";
import { taskMapActions } from "./TaskMap";
import "./newbadge.css";

/** "30 min", "1 h", "1 h 30 min". */
export function fmtNewMin(m: number) {
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ""}` : `${r} min`;
}

/** The badge itself, or nothing when the task is not new. */
export function NewBadge({ d }: { d: Doc<Todo> }) {
  const on = useIsNew(d.id, d.data);
  if (!on) return null;
  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); };
  return (
    <button type="button" className="tm-new no-drag" title="New task. Click to hide this badge" aria-label={`New task: ${d.data.title}. Hide the NEW badge`}
      onPointerDown={stop} onMouseDown={stop} onTouchStart={stop} onDoubleClick={stop}
      onClick={(e) => {
        e.stopPropagation(); e.preventDefault();
        if (e.metaKey) return;   // Cmd-click picks tasks (the row's own capture handler); never hide on it
        sfx.click();
        void taskMapActions.looks({ newGoneId: d.id } as unknown as Partial<Settings>);
      }}>
      NEW
    </button>
  );
}

/** Settings, General (Mac and website) and the small gear menu: NEW badges on or off, and for how long. */
export function NewBadgeControls() {
  const { on, min } = newBadgeSettings(settingsData(useVault()));
  const [v, setV] = useState(min);
  useEffect(() => { setV(min); }, [min]);
  const save = (patch: Partial<Settings>) => { void taskMapActions.looks(patch); };
  const commit = (n: number) => { if (n !== min) save({ newBadgeMin: n }); };
  return (<>
    <div className="tm-ed-seg" role="radiogroup" aria-label="NEW badges">
      <button type="button" role="radio" aria-checked={on} className={`dwell${on ? " on" : ""}`} onClick={() => { if (!on) { sfx.hover(); save({ newBadges: true }); } }}>On</button>
      <button type="button" role="radio" aria-checked={!on} className={`dwell${!on ? " on" : ""}`} onClick={() => { if (on) { sfx.hover(); save({ newBadges: false }); } }}>Off</button>
    </div>
    {on && (<>
      <div className="tm-pop-row">
        <input type="range" min={NEW_MIN_LOW} max={NEW_MIN_HIGH} step={5} value={v} aria-label="Minutes a new task shows NEW" className="tm-pop-range"
          onChange={(e) => setV(Number(e.target.value))}
          onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))} onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))} />
        <b className="num tm-pop-v tm-new-v">{fmtNewMin(v)}</b>
      </div>
      <div className="tm-ed-seg" role="radiogroup" aria-label="Quick picks">
        {NEW_MIN_PICKS.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={min === m} className={`dwell${min === m ? " on" : ""}`}
            onClick={() => { if (min !== m) { sfx.hover(); setV(m); save({ newBadgeMin: m }); } }}>{fmtNewMin(m)}</button>
        ))}
      </div>
    </>)}
  </>);
}

// PS Fitness other activities (V1.40): log a run, walk, ride or swim by hand (distance and time; the pace is worked
// out). On the Today screen as one row; the sheet holds the log form and the recent ones. A run counts on the G Squad
// boards where it makes sense: Showed up (a day), Percent better (pace), personal bests (longest, fastest pace),
// Weekly volume (its km beside the kg) and the Distance challenge. Rules: core/activity.ts.
import { useMemo, useState } from "react";
import { haptic } from "../gos/bridge";
import { todayISO } from "../ui/kit";
import type { FitView } from "./store";
import { deleteActivity, saveActivity, useActivities, type ActDoc } from "./activity-store";
import { fmtDayShort } from "./hist-logic";
import { ACT_KINDS, actName, fmtKm, fmtPace, fmtTime, parseKm, parseTime, type ActKind } from "../core/activity";
import { addDays } from "../core/gymsquad";
import { Modal, SquadCompare } from "./Squad";
import { useGymSquad } from "../squad/gymclient";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const line = (a: ActDoc["data"]) => `${fmtKm(a.km)} km in ${fmtTime(a.secs)} · ${fmtPace(a.kind, a.km, a.secs)}`;

/** The Today screen's row: the last activity, tap to log one. */
export function ActivityRow({ v }: { v: FitView }) {
  const acts = useActivities();
  const [open, setOpen] = useState(false);
  const last = acts[0]?.data ?? null;
  return (
    <div className="fq fq-today">
      <button type="button" className="fq-row" onClick={() => { haptic("press"); setOpen(true); }} aria-label="Log a run, walk, ride or swim">
        <span className="fq-row-i" aria-hidden="true"><ShoeIcon /></span>
        <span className="fq-row-t">
          <b>Run, walk, ride or swim</b>
          <span>{last ? `Last ${actName(last.kind).toLowerCase()} ${line(last)}` : "Log one with its distance and time"}</span>
        </span>
        <span className="fq-row-go" aria-hidden="true">+</span>
      </button>
      {open && <ActivitySheet v={v} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function ActivitySheet({ v, onClose }: { v: FitView; onClose: () => void }) {
  const acts = useActivities();
  const today = todayISO();
  const [kind, setKind] = useState<ActKind>(() => acts[0]?.data.kind ?? "run");
  const [km, setKm] = useState("");
  const [time, setTime] = useState("");
  const [day, setDay] = useState(today);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cmp, setCmp] = useState(false);
  const g = useGymSquad();
  const k = parseKm(km), s = parseTime(time);
  const ok = k != null && s != null;
  const days = useMemo(() => [today, addDays(today, -1), addDays(today, -2)], [today]);
  const save = async (close: () => void) => {
    if (!ok || busy) return;
    setBusy(true); setErr(null); haptic("press");
    try { await saveActivity({ kind, date: day, km: k!, secs: s! }); setKm(""); setTime(""); close(); }
    catch { setErr("That could not be saved. Check the distance and time."); setBusy(false); }
  };
  return (
    <Modal label="Log an activity" onClose={onClose} tall>
      {(close) => (
        <div className="fq-form fq-act">
          <h3 className="fq-h">Log an activity</h3>
          <div className="fq-chips row" role="radiogroup" aria-label="Kind">
            {ACT_KINDS.map((a) => <button key={a.k} type="button" role="radio" aria-checked={kind === a.k} className={cx(kind === a.k && "on")} onClick={() => setKind(a.k)}>{a.t}</button>)}
          </div>
          <div className="fq-two">
            <label className="fq-lab">Distance (km)
              <input className="fq-input fq-big f-num" inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} placeholder="5.0" aria-invalid={!!km && k == null} />
            </label>
            <label className="fq-lab">Time
              <input className="fq-input fq-big f-num" inputMode="text" value={time} onChange={(e) => setTime(e.target.value)} placeholder="25:30" aria-invalid={!!time && s == null} />
            </label>
          </div>
          <p className="fq-line" aria-live="polite">{ok ? fmtPace(kind, k!, s!) : "Time as minutes:seconds, or hours:minutes:seconds."}</p>
          <p className="fq-lab">Day</p>
          <div className="fq-chips row">
            {days.map((d, i) => <button key={d} type="button" className={cx(day === d && "on")} aria-pressed={day === d} onClick={() => setDay(d)}>{i === 0 ? "Today" : i === 1 ? "Yesterday" : fmtDayShort(d)}</button>)}
          </div>
          {err && <p className="fq-err">{err}</p>}
          <button type="button" className="fq-btn fq-btn-go" disabled={!ok || busy} onClick={() => void save(close)}>Save {actName(kind).toLowerCase()}</button>
          {g.on && g.in && <button type="button" className="fq-link" onClick={() => setCmp(true)}>Compare {actName(kind).toLowerCase()}s with the squad</button>}
          {acts.length > 0 && (
            <>
              <p className="fq-lab">Recent</p>
              <ul className="fq-acts">
                {acts.slice(0, 10).map((a) => (
                  <li key={a.id}>
                    <span><b>{actName(a.data.kind)}</b> <small>{fmtDayShort(a.data.date)}</small><span className="f-num">{line(a.data)}</span></span>
                    <button type="button" className="fq-x" onClick={() => { haptic("press"); void deleteActivity(a.id); }} aria-label={`Remove the ${actName(a.data.kind).toLowerCase()} of ${fmtDayShort(a.data.date)}`}>Remove</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {cmp && <SquadCompare workouts={v.workouts} ex={{ exId: null, name: actName(kind), act: kind }} onClose={() => setCmp(false)} />}
        </div>
      )}
    </Modal>
  );
}

const ShoeIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 16.5V9l4 1 2.5-3 3 4.5 5 1.5c2 .6 3.5 2 3.5 3.5v0H3z" /><path d="M3 19.5h18" />
  </svg>
);

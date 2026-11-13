// Screen time, counted by PS on the developer's Mac instead of macOS (PS > Settings > Screen time), and by
// PS GOS on his phone (UsageStatsManager). Only app names, ids and seconds per local day and device;
// saved end-to-end encrypted like the rest.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ScreenTimeApp, ScreenTimeDevice } from "../core/model";
import { screenTimeDays } from "../core/select";
import { PS, askScreenTime, psPost, usePsSettings } from "../ps";
import { addDays, todayISO, useVault } from "../ui/kit";
import "./screentime.css";
import { appName } from "../core/appname";

/** 3h 12m, 45m, under a minute. */
export function fmtDur(secs: number) {
  const m = Math.floor(secs / 60);
  if (m < 1) return "under 1m";
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
export const totalSecs = (apps: ScreenTimeApp[]) => apps.reduce((n, a) => n + a.secs, 0);

/** The device this page runs on: the phone build is PS GOS, everything else counts as the Mac. */
export const ST_HERE: ScreenTimeDevice = import.meta.env.MODE === "gos" ? "gos" : "mac";
export const ST_LABEL: Record<ScreenTimeDevice, string> = { mac: "Mac", gos: "Phone" };

/** Mac | Phone: a two-way switch with a sliding thumb. Tap or click only. */
export function StDeviceSwitch({ value, onPick }: { value: ScreenTimeDevice; onPick: (d: ScreenTimeDevice) => void }) {
  return (
    <div className={`st-dev${value === "gos" ? " right" : ""}`} role="radiogroup" aria-label="Which device">
      <span className="st-dev-thumb" aria-hidden="true" />
      {(["mac", "gos"] as const).map((d) => (
        <button key={d} type="button" role="radio" aria-checked={value === d} className={value === d ? "on" : ""} onClick={() => { if (d !== value) onPick(d); }}>
          {d === "mac"
            ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19h20" /></svg>
            : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.2" /><path d="M11 18.5h2" /></svg>}
          {ST_LABEL[d]}
        </button>
      ))}
    </div>
  );
}

/** Holds one device's view: its height glides to the new content and the content slides in from
 *  the side of the switch it came from. Clipped only while it moves, so nothing hanging out is cut. */
export function StSwap({ k, dir, children }: { k: string; dir: "left" | "right"; children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const last = useRef<number | null>(null);
  const [h, setH] = useState<number | null>(null);
  const [moving, setMoving] = useState(false);
  // The view it opened on just shows; only a switch slides.
  const first = useRef(k), switched = useRef(false);
  if (k !== first.current) switched.current = true;
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    let done = 0;
    const ro = new ResizeObserver(() => {
      const next = el.offsetHeight;
      if (next === last.current) return;
      if (last.current !== null) { setMoving(true); clearTimeout(done); done = window.setTimeout(() => setMoving(false), 420); }
      last.current = next;
      setH(next);
    });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(done); };
  }, []);
  return (
    <div className={`st-swap${moving ? " moving" : ""}`} style={h === null ? undefined : { height: h }}>
      <div ref={inner} className="st-swap-in">
        <div key={k} className={`st-swap-view${switched.current ? ` from-${dir}` : ""}`}>{children}</div>
      </div>
    </div>
  );
}

/** One bar per app, longest first, widths relative to the top app. */
export function ScreenTimeBars({ apps, limit = 6, icons }: { apps: ScreenTimeApp[]; limit?: number; icons?: Record<string, string> }) {
  const list = [...apps].sort((a, b) => b.secs - a.secs);
  const top = list[0]?.secs || 1;
  const shown = list.slice(0, limit);
  const rest = list.slice(limit);
  return (
    <ul className={`st-bars${icons ? " with-icons" : ""}`}>
      {shown.map((a) => (
        <li key={a.id} title={`${a.name}: ${fmtDur(a.secs)}`}>
          {icons && (icons[a.id]
            ? <img className="st-icon" src={icons[a.id]} alt="" width={22} height={22} />
            : <span className="st-icon st-letter" aria-hidden="true">{a.name.slice(0, 1).toUpperCase()}</span>)}
          <span className="st-name">{a.name}</span>
          <span className="st-track" aria-hidden="true"><span className="st-fill" style={{ width: `${Math.max(2, (a.secs / top) * 100)}%` }} /></span>
          <span className="st-time num">{fmtDur(a.secs)}</span>
        </li>
      ))}
      {rest.length > 0 && <li className="st-more xs muted">and {rest.length} more app{rest.length === 1 ? "" : "s"}, {fmtDur(totalSecs(rest))}</li>}
    </ul>
  );
}

/** To-do page: today's total and the top apps. */
export function ScreenTimeCard() {
  const s = useVault();
  const ps = usePsSettings();
  const days = screenTimeDays(s, ST_HERE);
  const t = todayISO();
  const today = days.get(t)?.data.apps || [];
  const yest = days.get(addDays(t, -1))?.data.apps || [];
  useEffect(() => { if (PS) { psPost({ type: "psSettings:get" }); askScreenTime(); } }, []);

  // The website shows the card once PS has saved something; PS also shows how to switch it on.
  if (!today.length && !yest.length && !(PS && ps)) return null;
  const on = ps?.screenTime;
  const total = totalSecs(today);
  const diff = yest.length ? total - totalSecs(yest) : null;

  return (
    <section className="panel st-card" aria-labelledby="st-h">
      <div className="st-head">
        <div className="stack tight" style={{ gap: 2 }}>
          <h2 className="h2" id="st-h">Screen time</h2>
          <span className="xs muted">Counted by {appName()} on your {ST_HERE === "gos" ? "phone" : "Mac"}, encrypted in your vault</span>
        </div>
        {today.length > 0 && (
          <div className="st-total">
            <b className="num">{fmtDur(total)}</b>
            {diff !== null && <span className="xs muted num">{fmtDur(Math.abs(diff))} {diff >= 0 ? "more" : "less"} than yesterday</span>}
          </div>
        )}
      </div>
      {today.length > 0 ? <ScreenTimeBars apps={today} /> : (
        <p className="muted small" style={{ margin: 0 }}>
          {PS && on === false ? "Off. Switch it on in Settings (the gear, top right) and PS app starts counting."
            : PS ? "Counting. The first numbers show in a few minutes."
            : `Nothing yet today. ${appName()} on your Mac sends it every few minutes.`}
        </p>
      )}
    </section>
  );
}

// PS > Settings > AFK timer (the developer, 22 Oct 2026). Kept by the PS app on this Mac (Sources/Afk.swift):
// on or off, after how long with no input, a sound, apps where it never starts, and an optional
// "don't count while a video is playing". 1Password and Signal are always exempt and never listed.
// "Stay off during meetings" (V1.40, on unless switched off): no card while a calendar meeting is on
// (src/core/afkmeet.ts for what counts, Sources/MeetingTime.swift on the Mac), and that time is not away.
// Click only: every change is a click on a button or a choice in a list.
import { useState } from "react";
import { psPost, usePsSettings, type PsSettings } from "../ps";
import { appName } from "../core/appname";

type AfkPrefs = { on: boolean; threshold: number; sound: boolean; video: boolean; startPassive?: boolean; meetings?: boolean; exempt: { id: string; name: string }[] };
const TIMES: [number, string][] = [[60, "1 min"], [120, "2 min"], [180, "3 min"], [300, "5 min"], [600, "10 min"], [900, "15 min"], [1800, "30 min"]];
const set = (patch: Record<string, unknown>) => psPost({ type: "afk", ...patch });

export function AfkSettings() {
  const st = usePsSettings() as (PsSettings & { afk?: AfkPrefs }) | null;
  const a = st?.afk;
  const [pick, setPick] = useState("");
  const exempt = a?.exempt ?? [];
  const options = (st?.runningApps ?? []).filter((x) => !exempt.some((e) => e.id === x.id));
  const ids = exempt.map((e) => e.id);
  return (
    <section className="panel stack" aria-labelledby="afk-h">
      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h2 className="h2" id="afk-h">AFK timer</h2>
        {a && <span className={`pill ${a.on ? "good" : "ink"}`}>{a.on ? "On" : "Off"}</span>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        When you leave the keyboard and mouse alone, a card comes down at the top of the screen with a stopwatch of the whole
        time you were away. It stays until you click Back in the game, and each break shows on your screen time timeline as AFK.
        {" "}{appName()} only reads how long it has been since your last input, never which keys.
      </p>
      <div className="tabs" role="radiogroup" aria-label="AFK timer on or off" style={{ justifySelf: "start" }}>
        <button className="tab" role="radio" aria-checked={!!a?.on} aria-selected={!!a?.on} disabled={!a} onClick={() => { if (!a?.on) set({ on: true }); }}>On</button>
        <button className="tab" role="radio" aria-checked={!!a && !a.on} aria-selected={!!a && !a.on} disabled={!a} onClick={() => { if (a?.on) set({ on: false }); }}>Off</button>
      </div>
      <div className="stack tight">
        <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }} id="afk-t">Start after no input for</span>
        <div className="tabs" role="radiogroup" aria-labelledby="afk-t" style={{ justifySelf: "start", flexWrap: "wrap" }}>
          {TIMES.map(([s, l]) => (
            <button key={s} className="tab" role="radio" aria-checked={a?.threshold === s} aria-selected={a?.threshold === s} disabled={!a}
              onClick={() => { if (a?.threshold !== s) set({ threshold: s }); }}>{l}</button>
          ))}
        </div>
      </div>
      <div className="row" style={{ gap: 18, flexWrap: "wrap" }}>
        <Toggle label="Sound when it starts" on={!!a?.sound} disabled={!a} onChange={(v) => set({ sound: v })} />
        <Toggle label="Don't count while a video is playing" on={!!a?.video} disabled={!a} onChange={(v) => set({ video: v })} />
        <Toggle label="Start in passive (a tiny stopwatch top left)" on={!!a?.startPassive} disabled={!a} onChange={(v) => set({ startPassive: v })} />
      </div>
      <div className="stack tight">
        <div className="row" style={{ gap: 18, flexWrap: "wrap" }}>
          <Toggle label="Stay off during meetings" on={a?.meetings !== false} disabled={!a} onChange={(v) => set({ meetings: v })} />
        </div>
        <small className="hint">
          A meeting is an event in your calendar with a call link or other people invited, from 5 minutes before it starts
          to 10 minutes after it ends. Blocks with only you on them do not count. Meeting time shows as Meetings in screen time,
          not as time away.
        </small>
      </div>
      <div className="stack tight">
        <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }}>Never start while these apps are in front</span>
        {exempt.length === 0 && <small className="hint">None yet. 1Password and Signal are always left out.</small>}
        {exempt.map((e) => (
          <div key={e.id} className="row" style={{ gap: 8 }}>
            <span>{e.name}</span>
            <button className="btn quiet sm" onClick={() => set({ exempt: ids.filter((i) => i !== e.id) })}>Remove</button>
          </div>
        ))}
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select className="input" value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: 260 }} disabled={!a}>
            <option value="">Pick an open app</option>
            {options.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <button className="btn ghost sm" disabled={!pick} onClick={() => { set({ exempt: [...ids, pick] }); setPick(""); }}>Add</button>
          <button className="btn ghost sm" disabled={!a} onClick={() => set({ pick: true })}>Choose an app...</button>
          <button className="btn quiet sm" onClick={() => psPost({ type: "psSettings:get" })}>Refresh list</button>
        </div>
      </div>
    </section>
  );
}

function Toggle({ label, on, disabled, onChange }: { label: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`btn ${on ? "" : "ghost"} sm`} disabled={disabled} onClick={() => onChange(!on)}>
      {on ? "On: " : "Off: "}{label}
    </button>
  );
}

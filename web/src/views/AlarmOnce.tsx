// Just tomorrow (PS 1.65): the calm control under the alarms, in Settings, Sleep mode, and on the web sleep screen. Rules in
// core/alarmonce.ts, the owner check and the save in sleepmode/once.ts. Every change and Undo ask Touch ID (a Mac), the
// phone's unlock (the phone) first; a browser cannot ask, so there it only shows the line and says where to change it.
// Esc closes the open Later row (one layer). It never takes the focus by itself.
import { useEffect, useState } from "react";
import "./alarmonce.css";
import { sfx } from "../ui/sfx";
import { useVault } from "../ui/kit";
import { settingsData } from "../core/select";
import { sleepModeOf } from "../core/sleepmode";
import { ONCE_MINS, ONCE_NOTES, laterLabel, onceLine, onceView, onceWords, type OnceChoice } from "../core/alarmonce";
import { changeOnce, holdOnceRow, onceOn, onceTz, shellAuth, useOnceBump } from "../sleepmode/once";
import { WHERE } from "../sleepmode/engine";

const reduced = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const plus60 = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); const t = (h * 60 + m + 60) % 1440; return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
/** While the owner check is up: the words of this device's own check. */
const WAIT = WHERE === "phone" ? "Waiting for your phone's unlock" : "Waiting for Touch ID";

export function AlarmOnce({ screen = false }: { screen?: boolean }) {
  const v = useVault();
  useOnceBump();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); setPick(null); } };
    const release = holdOnceRow();
    window.addEventListener("keydown", esc);
    return () => { release(); window.removeEventListener("keydown", esc); };
  }, [open]);
  useEffect(() => { if (!note) return; const t = window.setTimeout(() => setNote(null), 6000); return () => window.clearTimeout(t); }, [note]);
  if (!onceOn() || v.status !== "unlocked") return null;
  const p = sleepModeOf(settingsData(v));
  const view = onceView(p.alarms, p.once, now, onceTz());
  if (!view) return null;
  const w = onceWords(view.day);
  const set = view.state === "set";
  const usual = view.usual[0];
  const run = async (c: OnceChoice) => {
    if (busy) return;
    sfx.click();
    if (WHERE === "web") { setNote(ONCE_NOTES.none); return; }
    setBusy(true); setNote(null);
    const r = await changeOnce(c, shellAuth(WHERE)).catch(() => ONCE_NOTES.no);
    setBusy(false);
    if (r) { setNote(r); if (!reduced()) setShake((n) => n + 1); return; }
    sfx.island("done");
    setOpen(false); setPick(null); setLit((n) => n + 1);
  };
  return (
    <div className={`aon${screen ? " aon-screen" : ""}${set ? " is-set" : ""}${busy ? " is-busy" : ""}`} aria-busy={busy || undefined}>
      <div className="aon-row" key={`s${shake}`} data-shake={shake ? "1" : undefined}>
        <svg className="aon-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {set ? <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /> : <><circle cx="12" cy="13" r="7.5" /><path d="M12 9.5V13l2.2 1.6M5 3.5L2.5 6M19 3.5L21.5 6" /></>}
        </svg>
        <span className="aon-line" key={`l${lit}-${onceLine(view)}`} role="status">{onceLine(view)}</span>
        <span className="aon-acts">
          {set
            ? <button type="button" className="aon-pill" disabled={busy} onClick={() => void run({ kind: "undo" })}>{w.undo}</button>
            : <>
                <button type="button" className="aon-pill" disabled={busy} onClick={() => void run({ kind: "skip" })}>{w.skip}</button>
                <button type="button" className={`aon-pill${open ? " on" : ""}`} aria-expanded={open} disabled={busy} onClick={() => { sfx.hover(); setOpen((o) => !o); setPick(null); }}>{w.later}</button>
              </>}
          {set && <button type="button" className={`aon-pill aon-ghost${open ? " on" : ""}`} aria-expanded={open} disabled={busy} onClick={() => { sfx.hover(); setOpen((o) => !o); setPick(null); }}>{w.later}</button>}
        </span>
      </div>
      <div className={`aon-more${open ? " open" : ""}`} aria-hidden={!open}>
        <div className="aon-more-in">
          {pick == null
            ? <>
                {ONCE_MINS.map((m) => <button key={m} type="button" tabIndex={open ? 0 : -1} className="aon-pill" disabled={busy} onClick={() => void run({ kind: "later", mins: m })}>{laterLabel(m)}</button>)}
                {set && <button type="button" tabIndex={open ? 0 : -1} className="aon-pill" disabled={busy} onClick={() => void run({ kind: "skip" })}>{w.skip}</button>}
                <button type="button" tabIndex={open ? 0 : -1} className="aon-pill aon-ghost" disabled={busy} onClick={() => { sfx.hover(); setPick(plus60(usual)); }}>{w.pick}</button>
              </>
            : <>
                <input type="time" className="aon-time" value={pick} aria-label={w.pick} tabIndex={open ? 0 : -1} onChange={(e) => setPick(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && /^\d\d:\d\d$/.test(pick)) void run({ kind: "pick", at: pick }); }} />
                <button type="button" tabIndex={open ? 0 : -1} className="aon-pill aon-go" disabled={busy || !/^\d\d:\d\d$/.test(pick)} onClick={() => void run({ kind: "pick", at: pick })}>{w.save}</button>
              </>}
        </div>
      </div>
      {(busy || note) && <span className="aon-note" role="status">{busy ? WAIT : note}</span>}
    </div>
  );
}

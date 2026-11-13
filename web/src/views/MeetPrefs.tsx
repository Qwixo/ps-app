// Gear menu > Meeting alerts (PS only): each card type on or off, its sound on or off, and "Hide
// details during meetings" (on by default: the developer may be sharing his screen). Click only, like the
// rest of the gear menu. Saved in the vault settings (settings.meetAlerts); the PS main window
// reads them in src/meetwatch.ts. In the floating list the change goes to the main window.
import { PS, psPost } from "../ps";
import { saveSettings } from "../core/actions";
import { settingsData } from "../core/select";
import { useVault } from "../ui/kit";
import { isRedAccount } from "../core/account";
import { sfx } from "../ui/sfx";
import { meetPrefs } from "../meetwatch";
import "./meetprefs.css";

type Prefs = ReturnType<typeof meetPrefs>;
const ROWS: { k: keyof Prefs; s?: keyof Prefs; label: string; note: string }[] = [
  { k: "booked", s: "sBooked", label: "Call booked", note: "A lead books or accepts a call (green)" },
  { k: "msg", s: "sMsg", label: "Lead wrote before a call", note: "A lead messages in the hours before a call; red if it reads as a cancel" },
  { k: "soon", s: "sSoon", label: "Call in 10 minutes", note: "With the invite state, flagged if they never accepted" },
];

export function MeetPrefsPanel() {
  const s = useVault();
  const p = meetPrefs(settingsData(s));
  // "Lead wrote before a call" reads the developer's mail and Instantly feeds: any other account has neither (7 Nov 2026).
  const red = isRedAccount(s);
  const set = (patch: Partial<Prefs>) => {
    sfx.click();
    const next = { ...p, ...patch };
    if (PS && document.documentElement.classList.contains("ps-overlay")) psPost({ type: "meetPrefs", prefs: next });
    else void saveSettings({ meetAlerts: next });
  };
  return (
    // Two halves (alerts, notes pop-up): display: contents in the small menus, side by side in full screen Settings.
    <div className="mp">
      <div className="mp-part">
      <span className="tm-panel-h">Meeting alerts</span>
      {ROWS.filter((r) => red || r.k !== "msg").map((r) => (
        <div key={r.k} className={`mp-row${p[r.k] ? " on" : ""}`}>
          <button type="button" role="switch" aria-checked={!!p[r.k]} className="mp-main" onClick={() => set({ [r.k]: !p[r.k] } as Partial<Prefs>)}>
            <span className="mp-t"><b>{r.label}</b><em>{r.note}</em></span><span className="mp-k" aria-hidden="true"><i /></span>
          </button>
          {r.s && p[r.k] && (
            <button type="button" className={`mp-snd${p[r.s] ? " on" : ""}`} aria-pressed={!!p[r.s]} title={p[r.s] ? "Sound on" : "Sound off"}
              aria-label={`${r.label} sound ${p[r.s] ? "on" : "off"}`} onClick={() => set({ [r.s!]: !p[r.s!] } as Partial<Prefs>)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M11 5L6 9H2v6h4l5 4z" />{p[r.s] ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="M22 9l-6 6M16 9l6 6" />}
              </svg>
            </button>
          )}
        </div>
      ))}
      <div className={`mp-row${p.privacy ? " on" : ""}`}>
        <button type="button" role="switch" aria-checked={p.privacy} className="mp-main" onClick={() => set({ privacy: !p.privacy })}>
          <span className="mp-t"><b>Ask to start private mode</b><em>When a meeting starts, a card asks "Start private mode?". The mask on the Meetings panel turns it on or off any time</em></span>
          <span className="mp-k" aria-hidden="true"><i /></span>
        </button>
      </div>
      </div>
      <div className="mp-part">
      <span className="tm-panel-h">Meeting notes pop-up</span>
      <div className={`mp-row${p.notes ? " on" : ""}`}>
        <button type="button" role="switch" aria-checked={p.notes} className="mp-main" onClick={() => set({ notes: !p.notes })}>
          <span className="mp-t"><b>Show my notes during a call</b><em>Your notes for the meeting as a checklist, top left of the screen</em></span>
          <span className="mp-k" aria-hidden="true"><i /></span>
        </button>
      </div>
      {p.notes && <>
        <span className="mp-l">Minutes after the call starts</span>
        <div className="mp-chips">{[1, 2, 3, 5, 10, 15].map((v) => (
          <button key={v} type="button" className={p.notesAfter === v ? "on" : ""} aria-pressed={p.notesAfter === v} onClick={() => { if (p.notesAfter !== v) set({ notesAfter: v }); }}>{v}</button>))}</div>
        <span className="mp-l">Remind me in (choices for the wheel)</span>
        <div className="mp-chips">{SNOOZE.map((v) => {
          const on = p.notesSnooze.includes(v);
          return <button key={v} type="button" className={on ? "on" : ""} aria-pressed={on}
            onClick={() => { const next = on ? p.notesSnooze.filter((x) => x !== v) : [...p.notesSnooze, v].sort((a, b) => a - b); if (next.length) set({ notesSnooze: next }); }}>{v}</button>;
        })}</div>
        <div className={`mp-row${p.notesBlur ? " on" : ""}`}>
          <button type="button" role="switch" aria-checked={p.notesBlur} className="mp-main" onClick={() => set({ notesBlur: !p.notesBlur })}>
            <span className="mp-t"><b>Blur my notes until I hover</b><em>In case you are sharing your screen</em></span>
            <span className="mp-k" aria-hidden="true"><i /></span>
          </button>
        </div>
      </>}
      </div>
    </div>
  );
}
const SNOOZE = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

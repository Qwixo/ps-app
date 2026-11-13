// Sleep mode (V1.40, rules in core/sleepmode.ts, engine in sleepmode/engine.ts). What this file draws:
// - SleepRow: the Sleep button (a bed with floating Z's) at the end of the task list, next to Resurrect, with a
//   pencil for its settings (a right click on the button opens them too). While a sleep runs on another device it
//   says "Asleep since 03:10" with a Wake up button instead.
// - V1.47: the pencil (and a right click on the button) opens Sleep mode's own full screen settings
//   (views/SleepSettings.tsx). Settings, Sleep mode opens them too, so they stay reachable with the button hidden.
//   The pieces they are made of live here: AlarmList, WakeInSettings, sleepDeviceNote, savePrefs.
// - SleepHost (once, in the Tab list): the web sleep screen (iPhone web app, website), the sleep to confirm after
//   Wake up, and a one time note.
// The Mac and the phone draw their own sleep screens (ps-mac SleepScreen.swift, ps-gos Sleep.kt).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Settings } from "../core/model";
import { settingsData } from "../core/select";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { useFitness } from "../fitness/store";
import { useSleep } from "../fitness/sleep-store";
import { fmtMins, sleepMins } from "../core/sleep";
import { MAX_ALARMS, clockText, dawnRing, editedLog, newAlarmId, ringPlay, planLook, prefsOf, propose, ringDue, ringKey, sleepModeOf,
  stillRinging, type SleepAlarm, type SleepModeView, type Ring } from "../core/sleepmode";
import { WHERE, breakBack, breakMore, breakUp, chooseBreak, chooseUp, clearSleepNote, confirmSleep, currentPlan, customiseJustClosed, discardSleep, goToSleep,
  hideBreakAsk, leaveScreen, openCustomise, setWakeIn, sleepLog, sleepPsBase, sleepState, startSleepEngine, useSleepMode, useWakeInBump, wakeInNow, wokeUp } from "../sleepmode/engine";
import { durText, styleOf, wakeInPick } from "../core/sleepwake";
import { SoundPick, StylePick, WakeInPicker, WakeLightLayer, useWakeSound } from "./SleepWake";
import { okLevel } from "../core/alarmsound";
import { alarmSoundNow, useAlarmSound } from "../sleepmode/sound";
import { BREAK_DEF, BREAK_STEPS } from "../core/sleepmode";
import { breakLine, type SleepBreak } from "../core/sleep";
import { SleepFace, faceStyle, useHiddenPointer } from "./SleepFace";
import { CustomiseHost, useLiveDraft } from "./SleepCustomise";
import { SleepSettingsHost, openSleepSettings, sleepSettingsOpen, useSleepSettingsOpen } from "./SleepSettings";
import { onSleepSquad } from "../sleepmode/squad";
import { dayIn as listDay } from "../core/alarmlist";
import { taskMapActions } from "./TaskMap";
import "./sleepmode.css";

const hm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
function useNow(every = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), every); return () => window.clearInterval(t); }, [every]);
  return now;
}
export const savePrefs = (p: SleepModeView, patch: Partial<SleepModeView>) => {
  void taskMapActions.looks({ sleepMode: prefsOf({ ...p, ...patch }) } as Partial<Settings>);
};

const BED = (
  <svg className="slp-bed" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7v12" /><path d="M3 15h18v4" /><path d="M21 15v-2a3 3 0 0 0-3-3h-7v5" /><circle cx="7" cy="11.5" r="1.8" />
  </svg>
);
/** V1.47: the gear in a corner of the web sleep screen (the Mac and phone draw their own). */
const GEAR = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
const PENCIL = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M14 6l4 4" />
  </svg>
);

// ---------- the button at the end of the list ----------
/** The Sleep button and its pencil (inside the Completed bar next to Resurrect, or on its own when Completed is empty). */
/** where: "side" the bottom of the right column of the Tab list and the website (V1.47, the developer: "Put the Sleep tab on the
 *  bottom right instead, on the same level of the screen as the Dimension X tab, because no one is going to scroll to
 *  the bottom of the to-do list to find it"); "thumb" the phone's thumb row next to the moon (a round button, the
 *  pencil left out: Settings has the same controls); "end" the end of the list, only where the side column is hidden
 *  (a narrow website window). */
export function SleepRow({ standalone, where }: { standalone?: boolean; where?: "side" | "thumb" | "end" }) {
  const st = settingsData(useVault());
  const p = sleepModeOf(st);
  const s = useSleepMode();
  const fit = useFitness();
  useEffect(() => { startSleepEngine(); }, []);
  if (!p.show) return null;
  const o = fit.prefs.sleepOpen;
  const fresh = !!o && !o.woke && Date.now() - Date.parse(o.at) < 20 * 3600_000;
  // V1.43: a break running (any device): when it ends, and Back to sleep or I'm up right here.
  const onBreak = fresh && !!o!.brk && !s.here && !s.woke;
  // V1.41: a Wake up pressed here hides the row at once (s.woke, s.choose), whether or not the vault write has landed yet.
  const elsewhere = fresh && !o!.brk && !o!.paused && !s.here && !s.woke && !s.choose;
  const body = (
    <span className="slp-row">
      {onBreak ? (
        <span className="slp-away">
          <span className="slp-away-t">{BED}<span>On a break, back to sleep at {hm(Date.parse(o!.brk!.until))}</span></span>
          <button type="button" className="slp-wake-btn" onClick={() => { sfx.drop(); void breakBack(); }}>Back to sleep</button>
          <button type="button" className="slp-away-up" onClick={() => { sfx.click(); void breakUp(); }}>I'm up</button>
        </span>
      ) : elsewhere ? (
        <span className="slp-away">
          <span className="slp-away-t">{BED}<span>Asleep since {hm(Date.parse(o!.at))}</span></span>
          <button type="button" className="slp-wake-btn" onClick={() => { sfx.click(); void wokeUp(); }}>Wake up</button>
        </span>
      ) : (
        <button type="button" className={`slp-btn${s.asking ? " busy" : ""}`} onClick={() => { sfx.drop(); void goToSleep(); }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); sfx.click(); openSleepSettings(); }}
          aria-label="Sleep mode" data-tip="Sleep mode" data-tip-line="A calm clock, your alarms, and your sleep logged when you wake up. Right click for its settings.">
          <span className="slp-icon">{BED}<span className="slp-z" aria-hidden="true"><i>z</i><i>z</i><i>Z</i></span></span>
          <span>Sleep</span>
        </button>
      )}
      {where !== "thumb" && <button type="button" className="slp-pen" aria-label="Sleep mode settings" title="Sleep mode settings" onClick={() => { sfx.click(); openSleepSettings(); }}>{PENCIL}</button>}
    </span>
  );
  if (where) return <div className={`slp-place slp-${where}`}>{body}</div>;
  return standalone ? <div className="tm-done-bar slp-bar">{body}</div> : body;
}

// ---------- the pieces Sleep mode's own settings are made of (views/SleepSettings.tsx) ----------
/** What this device does with Sleep mode, in plain words (drafts for the developer's yes). */
export function sleepDeviceNote(where = WHERE): string {
  if (where === "mac") return "On a Mac, PS app keeps the screen on while Sleep mode is up. Plug in first: on battery it warns you and stops at 20%. "
    + "Your Mac stays unlocked underneath, because macOS does not let any app draw over the lock screen, so auto reboot does not count down "
    + "while it is up. Leaving Sleep mode asks for Touch ID or your Mac password. Esc always leaves too, and locks PS app, so opening "
    + "your list again asks for Touch ID or your password.";
  if (where === "phone") return "On your phone, the clock shows over the lock screen like an alarm clock, so the phone stays locked underneath. "
    + "Alarms ring on time, even with PS app Do Not Disturb on.";
  return "In a browser or the iPhone web app, the screen stays on while the page is open. Alarms only ring while this page stays open and on screen, "
    + "so keep it plugged in and in front.";
}
/** The alarms: each one's time, its wake style, on or off, remove; and a new one (up to MAX_ALARMS). */
export function AlarmList({ p }: { p: SleepModeView }) {
  const [adding, setAdding] = useState("07:00");
  const setAlarms = (alarms: SleepAlarm[]) => savePrefs(p, { alarms });
  return (
    <div className="slp-set-b">
      {p.alarms.length === 0 && <span className="slp-set-n">None. Sleep mode is silent all night.</span>}
      <ul className="slp-alarms">
        {p.alarms.map((a) => (
          <li key={a.id} className={a.on ? "on" : ""}>
            <input type="time" value={a.at} aria-label="Alarm time" onChange={(e) => { if (/^\d\d:\d\d$/.test(e.target.value)) setAlarms(p.alarms.map((x) => x.id === a.id ? { ...x, at: e.target.value } : x)); }} />
            <StylePick value={a.style ?? "chime"} label={`How the ${a.at} alarm wakes you`} strobe={p.wake.strobe} onChange={(v) => setAlarms(p.alarms.map((x) => x.id === a.id ? { ...x, style: v } : x))} />
            <SoundPick value={a.sound ?? "auto"} label={`What the ${a.at} alarm plays`} wake={p.wake} onChange={(v) => setAlarms(p.alarms.map((x) => x.id === a.id ? (v === "auto" ? { id: x.id, at: x.at, on: x.on, ...(x.style ? { style: x.style } : {}) } : { ...x, sound: v }) : x))} />
            <button type="button" role="switch" aria-checked={a.on} className={`slp-sw${a.on ? " on" : ""}`} aria-label={a.on ? "Alarm on" : "Alarm off"}
              onClick={() => { sfx.hover(); setAlarms(p.alarms.map((x) => x.id === a.id ? { ...x, on: !x.on } : x)); }}><i /></button>
            <button type="button" className="slp-del" aria-label="Remove this alarm" title="Remove" onClick={() => { sfx.click(); setAlarms(p.alarms.filter((x) => x.id !== a.id)); }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </li>
        ))}
      </ul>
      {p.alarms.length < MAX_ALARMS && (
        <span className="slp-add">
          <input type="time" value={adding} aria-label="New alarm time" onChange={(e) => setAdding(e.target.value)} />
          <button type="button" className="tm-pill-btn" onClick={() => { if (!/^\d\d:\d\d$/.test(adding)) return; sfx.click(); setAlarms([...p.alarms, { id: newAlarmId(), at: adding, on: true }]); }}>Add alarm</button>
        </span>
      )}
      {WHERE === "web" && <span className="slp-set-n">Alarms only ring while this page stays open and on screen.</span>}
    </div>
  );
}

/** V1.43 "Wake me up in": pick a time from the sleep cycles (or your own), see when it wakes you, and Sleep now. While
 *  a sleep is open (any device), it changes that sleep's timer instead. */
export function WakeInSettings({ p }: { p: SleepModeView }) {
  const fit = useFitness();
  useWakeInBump();
  const o = fit.prefs.sleepOpen;
  const open = !!o && !o.woke && Date.now() - Date.parse(o.at) < 20 * 3600_000;
  const cur = wakeInNow();
  const [mins, setMins] = useState<number | null>(cur?.mins ?? wakeInPick());   // 7 h 30 of sleep picked first
  return (
    <div className="slp-set-b">
      <span className="slp-set-n">Sleep runs in loops of roughly 90 minutes, different for everyone and from night to night, so these are good guesses, not promises. 15 minutes are added to a sleep and 5 to a nap, because falling asleep takes a little while. Getting enough sleep matters more than a perfect time.</span>
      <WakeInPicker current={open ? cur?.mins ?? null : mins} onPick={(m) => { if (open) void setWakeIn(m); else setMins(m); }} onClear={() => { if (open) void setWakeIn(null); else setMins(null); }} />
      <span className="slp-two">
        <span className="slp-set-n">Rings with</span>
        <StylePick value={p.wake.timer} label="How Wake me up in wakes you" strobe={p.wake.strobe} onChange={(v) => savePrefs(p, { wake: { ...p.wake, timer: v } })} />
        {open
          ? <span className="slp-set-n">{cur ? `Set for this sleep: wakes you at ${hm(Date.parse(cur.at))}.` : "No timer on this sleep."}</span>
          : <button type="button" className="tm-pill-btn" disabled={mins == null} onClick={() => { if (mins == null) return; sfx.drop(); void goToSleep({ wakeIn: mins }); }}>
              {mins == null ? "Pick a time" : `Sleep now, rings after ${durText(mins)}`}
            </button>}
      </span>
    </div>
  );
}

// ---------- the web sleep screen, the card after Wake up, the note ----------
export function SleepHost() {
  const s = useSleepMode();
  const fit = useFitness();
  useEffect(() => { startSleepEngine(); }, []);
  const o = fit.prefs.sleepOpen;
  // The card: this device's own Wake up first (shows at once, V1.41), else a wake saved by any device.
  const c = s.woke ?? (o?.woke ? { at: o.at, tz: o.tz, woke: o.woke, breaks: o.breaks ?? null } : null);
  // V1.43: "Up for the day, or just checking something?" after Wake up (any device can answer a paused sleep).
  const choose = !s.here && !c && (s.choose != null || (!!o?.paused && !o.woke));
  // V1.43: "Go back to sleep?" when the break taken on this device is up.
  const ask = !s.here && !c && !!o?.brk && !o.woke && s.breakAsk > 0 && s.breakAsk !== s.breakHidden;
  return (
    <>
      <SleepSettingsHost />
      {WHERE === "web" && s.here && s.since != null && <WebSleepScreen since={s.since} wakeLock={s.wakeLock} />}
      <CustomiseHost overScreen={WHERE === "web" && s.here} />
      {c && !s.here && <SleepWakeCard key={c.at + c.woke} open={c} woke={Date.parse(c.woke)} />}
      {choose && <SleepChooser />}
      {ask && o?.brk && <BreakAsk until={Date.parse(o.brk.until)} />}
      {s.note && <SleepNote text={s.note} />}
    </>
  );
}

function SleepNote({ text }: { text: string }) {
  useEffect(() => { const t = window.setTimeout(clearSleepNote, 9000); return () => window.clearTimeout(t); }, [text]);
  return (
    <div className="slp-note" role="status">
      <span>{text}</span>
      <button type="button" className="slp-x" onClick={clearSleepNote} aria-label="Close" data-tip="Close">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}

function WebSleepScreen({ since, wakeLock }: { since: number; wakeLock: "on" | "off" | "none" }) {
  const now = useNow(1000);
  const [, bump] = useState(0);
  useVault();                                   // new tasks or settings redraw the panel
  useEffect(() => onSleepSquad(() => bump((n) => n + 1)), []);
  const bumps = useWakeInBump();               // V1.43: "Wake me up in" changed: a new plan at once
  const plan = useMemo(() => currentPlan(since), [since, Math.floor(now / 30_000), bumps]);   // eslint-disable-line react-hooks/exhaustive-deps
  const s = useSleepMode();
  // V1.42: Customise over this screen shows its changes here at once (the draft), before they are saved.
  const draft = useLiveDraft();
  const look = draft ? planLook(draft, sleepPsBase()) : plan.look;
  const chime = useWakeSound();                // V1.43: each alarm's own wake style (core/sleepwake.ts)
  useAlarmSound();                             // V1.44: your own sound, if this browser keeps one (sleepmode/sound.ts)
  const done = useRef(new Set<string>());
  const [ring, setRing] = useState<{ r: Ring; start: number; len?: number } | null>(null);
  const [peek, setPeek] = useState(0);         // a tap brightens the panel for 8 seconds
  const [picking, setPicking] = useState(false);   // "Wake me up in" open on the screen
  const [dark, setDark] = useState(false);     // the light is bright: the words turn dark
  const setOpen = useSleepSettingsOpen();
  const hidden = useHiddenPointer(look.pointer, s.customising || picking || setOpen);
  const pickRef = useRef(false);
  pickRef.current = picking;
  useEffect(() => { chime.prime(); }, []);      // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (ring && !stillRinging(ring.start, now, ring.len)) { chime.stop(); setRing(null); return; }
    if (ring) return;
    const due = ringDue(plan.rings, now, done.current);
    if (due) {
      // V1.47: this alarm's own sound (core/sleepmode.ts ringPlay): built in, your own, the day's playlist file or one
      // file. A custom sound that loops rings until Stop; a playlist file this browser does not have rings the usual.
      const play = ringPlay(due, plan.list, listDay(now, plan.tz), !!alarmSoundNow().own);
      done.current.add(ringKey(due)); setRing({ r: due, start: now, len: play.len });
      const st0 = styleOf(due.style, plan.styles ?? { strobe: false });
      sleepLog(`alarm rings (${st0}, ${play.kind})`);
      chime.start(st0, okLevel(plan.styles?.level), play.kind === "track"
        ? { id: play.id, fade: play.fade, loop: play.loop, onEnd: () => { chime.stop(); setRing(null); } } : null, play.kind === "builtin");
    }
  }, [now, plan, ring]);                       // eslint-disable-line react-hooks/exhaustive-deps
  // Sunrise: the light comes up before the alarm (Stop ends it, and that alarm with it).
  const dawn = ring ? null : dawnRing(plan.rings, now, done.current);
  const lit = ring ? { style: styleOf(ring.r.style, plan.styles ?? { strobe: false }), t0: ring.r.at } : dawn ? { style: "sunrise" as const, t0: dawn.at } : null;
  // V1.41 rule, kept: Esc always leaves (here: the screen goes, nothing is logged). Customise, when open, takes it first.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || sleepState().customising || customiseJustClosed() || sleepSettingsOpen()) return;   // Customise or Sleep settings over it take the Esc first
      if (pickRef.current) { e.preventDefault(); e.stopPropagation(); setPicking(false); return; }   // then "Wake me up in"
      e.preventDefault(); e.stopPropagation(); chime.stop(); leaveScreen();
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, []);                                       // eslint-disable-line react-hooks/exhaustive-deps
  const stop = () => { chime.stop(); setRing(null); if (dawn) done.current.add(ringKey(dawn)); setDark(false); };
  const wake = () => { stop(); sfx.click(); void wokeUp(); };
  const c = clockText(now, look);
  const timer = plan.timer;
  return createPortal(
    <div className={`slp-screen${ring ? " ringing" : ""}${dawn ? " dawn" : ""}${dark && lit ? " lit-dark" : ""}${hidden ? " nocursor" : ""}`} role="dialog" aria-label="Sleep mode"
      style={faceStyle(look, c.time.length + (c.ampm ? 2 : 0))} onClick={() => setPeek(Date.now() + 8000)}>
      {lit && <WakeLightLayer style={lit.style} t0={lit.t0} dawnMs={(plan.styles?.sunrise ?? 20) * 60_000} wave={plan.styles?.wave ?? "#4f7cff"} ink={look.ink} onInk={(k) => setDark(k === "dark")} />}
      {/* V1.47 (the developer's friend: "a settings gear icon in a corner"): Sleep mode's settings, over this screen */}
      {!s.customising && !setOpen && <button type="button" className="slp-gear" aria-label="Sleep settings" title="Sleep settings"
        onClick={(e) => { e.stopPropagation(); sfx.click(); openSleepSettings(); }}>{GEAR}</button>}
      <SleepFace plan={plan} look={look} since={since} now={now} ringing={!!ring} peek={now < peek} />
      <div className="slp-foot">
        {(ring || dawn) && <button type="button" className="slp-stop big" onClick={(e) => { e.stopPropagation(); stop(); }}>{plan.words.stop}</button>}
        <button type="button" className="slp-wake" onClick={(e) => { e.stopPropagation(); wake(); }}>{plan.words.wakeUp}</button>
        <span className="slp-foot-row">
          {!s.customising && <button type="button" className="slp-wi-btn" onClick={(e) => { e.stopPropagation(); sfx.click(); setPicking(true); }}>
            {timer ? `${plan.words.wakeIn}: ${hm(timer.at)}` : plan.words.wakeIn}</button>}
          {!s.customising && <button type="button" className="slp-cust-btn" onClick={(e) => { e.stopPropagation(); sfx.click(); openCustomise(); }}>{plan.words.customise}</button>}
        </span>
        <span className="slp-honest">
          {plan.rings.length > 0 ? "Alarms only ring while this page stays open and on screen. " : ""}
          {wakeLock === "on" ? "The screen stays on while this page is open." : wakeLock === "off" ? "This browser may let the screen turn off. Keep it plugged in." : "This browser cannot keep the screen on by itself."}
        </span>
      </div>
      {picking && (
        <div className="slp-wi-layer" onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) setPicking(false); }}>
          <div className="slp-wi-sheet" role="dialog" aria-label={plan.words.wakeIn}>
            <span className="slp-sheet-t">{plan.words.wakeIn}</span>
            <WakeInPicker compact current={timer?.mins ?? null} onPick={(m) => { void setWakeIn(m); setPicking(false); }} onClear={() => { void setWakeIn(null); setPicking(false); }} />
            <button type="button" className="slp-wake" onClick={() => { sfx.click(); setPicking(false); }}>Back</button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

/** V1.43 (the developer): after Wake up, "Up for the day, or just checking something?". "I'm up" ends the sleep (then the Sleep
 *  log card); "Back to sleep in" a few minutes keeps the sleep open as a break. Esc counts as "I'm up". */
function SleepChooser() {
  const [mins, setMins] = useState(BREAK_DEF);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); void chooseUp(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, []);
  return createPortal(
    <div className="slp-card slp-choose" role="dialog" aria-label="Up for the day, or just checking something?">
      <span className="slp-card-t">{BED}Up for the day, or just checking something?</span>
      <button type="button" className="slp-card-save" onClick={() => { sfx.click(); void chooseUp(); }}>I'm up</button>
      <span className="slp-card-n slp-choose-l">Back to sleep in</span>
      <div className="slp-mins" role="radiogroup" aria-label="Back to sleep in how many minutes">
        {BREAK_STEPS.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mins === m} className={`slp-min${mins === m ? " on" : ""}`}
            onClick={(e) => { sfx.hover(); setMins(m); e.currentTarget.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); }}>
            <b className="num">{m}</b><small>min</small>
          </button>
        ))}
      </div>
      <button type="button" className="slp-card-skip" onClick={() => { sfx.drop(); void chooseBreak(mins); }}>Back to sleep in {mins} min</button>
    </div>,
    document.body,
  );
}

/** V1.43: the break is up. Asked again every 5 minutes, then the sleep ends at the last moment of activity. Esc puts
 *  it away until the next ask. */
function BreakAsk({ until }: { until: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); hideBreakAsk(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, []);
  return createPortal(
    <div className="slp-card slp-ask" role="dialog" aria-label="Go back to sleep?">
      <span className="slp-card-t">{BED}Go back to sleep?</span>
      <span className="slp-card-s">Your break ended at {hm(until)}.</span>
      <button type="button" className="slp-card-save" onClick={() => { sfx.drop(); void breakBack(); }}>Back to sleep</button>
      <span className="slp-card-b">
        <button type="button" className="slp-card-skip" onClick={() => { sfx.click(); void breakMore(); }}>5 more minutes</button>
        <button type="button" className="slp-card-skip" onClick={() => { sfx.click(); void breakUp(); }}>I'm up now</button>
      </span>
    </div>,
    document.body,
  );
}

/** After Wake up: the sleep to save, with its times editable. Nothing is saved until Save. */
function SleepWakeCard({ open, woke }: { open: { at: string; tz: string; breaks?: SleepBreak[] | null }; woke: number }) {
  const p = useMemo(() => propose(open, woke), [open, woke]);
  const sleep = useSleep();
  const [asleep, setAsleep] = useState(p?.asleep ?? "23:00");
  const [wake, setWake] = useState(p?.wake ?? "07:00");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!p) void discardSleep(); }, [p]);   // an unreadable open sleep is closed, never drawn
  if (!p) return null;
  const log = asleep === p.asleep && wake === p.wake ? p.log : editedLog(p.day, asleep, wake, open.tz, new Date(), open.breaks);
  const brk = log ? breakLine(log) : null;
  const had = sleep.days.get(p.day);
  const save = async () => { if (!log || busy) return; setBusy(true); sfx.drop(); try { await confirmSleep(log); } finally { setBusy(false); } };
  const skip = () => { sfx.click(); void discardSleep(); };
  const day = new Date(`${p.day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return createPortal(
    <div className="slp-card" role="dialog" aria-label="Save last night's sleep">
      <span className="slp-card-t">{BED}Good morning</span>
      {p.why === "short" && asleep === p.asleep && wake === p.wake
        ? <span className="slp-card-s">That was under 30 minutes, so it is not counted as a night's sleep. Change the times if that is wrong.</span>
        : <span className="slp-card-s">{log ? <>You slept <b className="num">{fmtMins(sleepMins(log))}</b>.{brk ? ` ${brk}.` : ""} Save it to your Sleep log for {day}?</> : "Those times do not make a sleep. Change them, or don't log it."}</span>}
      <span className="slp-card-times">
        <label>Fell asleep<input type="time" value={asleep} onChange={(e) => setAsleep(e.target.value)} /></label>
        <label>Woke up<input type="time" value={wake} onChange={(e) => setWake(e.target.value)} /></label>
      </span>
      {had && had.src !== "sleepmode" && <span className="slp-card-n">You already typed a sleep for this date. Saving replaces it.</span>}
      <span className="slp-card-b">
        <button type="button" className="slp-card-save" disabled={!log || busy} onClick={() => void save()}>Save</button>
        <button type="button" className="slp-card-skip" onClick={skip}>Don't log</button>
      </span>
    </div>,
    document.body,
  );
}


// Sentry mode (V1.48, rules in core/sentry.ts, the Mac side in ps-mac Sentry.swift). What this file draws:
// - SentryButton: the big AI button in the Tab list's left column, between Time zones and Timelines, with a small gear
//   at its top right for the settings. PS on a Mac only (every build, public and private); the phone has no Sentry mode.
// - RestartWarning (V1.52): before engaging, the check that the restart to BFU would really happen (the restart helper
//   is on and answering, "Restart if not unlocked" is not Off). If not, it warns first with the fix and Engage anyway.
//   V1.54: the Mac checks the helper fresh first (a few seconds at most, "Checking the restart helper" under the button),
//   so a helper switched on a moment ago never reads as off.
// - V1.52 (the developer): the heat and bag warning is gone (never on the first engage, the lid or the sleep screen).
// - V1.54 (the developer; lid-notice-154): with Keep awake with the lid closed on, the AI button first asks the Mac whether it
//   really works (sentry:lidCheck). A gap adds a lid line to RestartWarning, or shows LidWarning on its own, with Set up
//   the helper, Engage anyway and Cancel. The Sentry screen never shows lid text; a stop is a Tab list note after.
// - The settings (views/SettingsGroups.tsx draws them in Settings, Sentry mode): Stop when battery is low, Restart if not
//   unlocked, Restart if not unlocked during Sleep mode (V1.52, also in Sleep mode's settings), Keep awake with the lid
//   closed.
// The Mac tells the page its state through window.__psSentry (both pages); the Tab list shows a one line note when the
// Mac said no (a protected app in front, the battery under the stop level) or stopped.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { PS, onPsSettings, psPost, psSettingsNow, usePsSettings } from "../ps";
import { useVault } from "../ui/kit";
import { settingsData } from "../core/select";
import { vaultStore } from "../core/vault";
import { sfx } from "../ui/sfx";
import type { Settings } from "../core/model";
import { HELPER_CHECK, LOW_PCTS, RESTART_HOURS, RESTART_ON_HOURS, RESTART_ON_SLEEP_HOURS, RESTART_WARN, WORDS, checkId, checksFresh, freshHelperCheck, helperFixable, restartCheck, restartLabel, restartWarnLines, checkTitle, planOf, sentryOf, stateOf, type RestartCheck, type RestartFacts, type SentryPrefs, type SentryState } from "../core/sentry";
import { LID_CHECK_WAIT_MS, LID_WARN, lidLine, lidNote, okLidGap, preEngage, preEngageLines, preEngageTitle, type LidGap } from "../core/sentry";
import { openSettings } from "./SettingsScreen";
import { openSecurity } from "./Security";
import { Choice, taskMapActions } from "./TaskMap";
import "./sentry.css";

// ---------- the Mac's state (window.__psSentry) ----------
let state: SentryState = { phase: "off", since: null, note: null };
/** stay: a lid note (said after the unlock, V1.54) stays until it is closed, so it is never missed. */
let note: { text: string; at: number; stay?: boolean } | null = null;
let busyUntil = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
/** Each answer the Mac sends (only window.__psSentry, never the page's own redraws): the Task API waits on it. */
const answers = new Set<() => void>();
if (typeof window !== "undefined") {
  (window as unknown as { __psSentry?: (m: unknown) => void }).__psSentry = (m: unknown) => {
    state = stateOf(m);
    busyUntil = 0;
    if (state.note) note = { text: state.note, at: Date.now(), stay: state.note === lidNote((m as { lid?: unknown } | null)?.lid) };
    emit();
    answers.forEach((f) => f());
  };
}
/** Is Sentry mode on (the PS cover is up, or the Mac is on its lock screen)? The first use tips stay away (views/Tips.tsx). */
export const sentryUp = () => state.phase !== "off";
const snap = () => ({ state, note, busy: busyUntil > Date.now() });
let last = snap();
function useSentry() {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => {
    const n = snap();
    if (n.state !== last.state || n.note !== last.note || n.busy !== last.busy) last = n;
    return last;
  });
}
const clearNote = () => { if (note) { note = null; emit(); } };

// ---------- V1.54: the lid check before engaging (lid-notice-154) ----------
let lidSeq = 0;
const lidWaiting = new Map<string, (g: LidGap | null) => void>();
if (typeof window !== "undefined") {
  (window as unknown as { __psSentryLid?: (m: unknown) => void }).__psSentryLid = (m: unknown) => {
    const o = (m && typeof m === "object" ? m : {}) as { id?: unknown; gap?: unknown };
    const id = String(o.id ?? ""), f = lidWaiting.get(id);
    if (f) { lidWaiting.delete(id); f(okLidGap(o.gap)); }
  };
}
/** Asks the Mac whether keeping awake with the lid closed really works (a few seconds at most). No answer: null. */
function checkLid(): Promise<LidGap | null> {
  return new Promise((res) => {
    const id = `lid${++lidSeq}`;
    const t = window.setTimeout(() => { if (lidWaiting.delete(id)) res(null); }, LID_CHECK_WAIT_MS);
    lidWaiting.set(id, (g) => { window.clearTimeout(t); res(g); });
    psPost({ type: "sentry:lidCheck", id });
  });
}

const save = (p: SentryPrefs, patch: Partial<SentryPrefs>) => void taskMapActions.looks({ sentry: { ...p, ...patch } } as Partial<Settings>);

// ---------- V1.52: the AI Sentry mode button on the Mac's sleep screen (ps-mac SleepSentry.swift) ----------
// The sleep screen covers this page, so its own warnings are drawn by the Mac from the sleep plan (core/sentry.ts
// sleepSentry); what they change is saved here: Turn on restart sets the Sleep mode time (restartSleepH).
// "Set up the helper" closes the sleep screen (after Touch ID, like its Settings) and opens Security here.
if (typeof window !== "undefined") {
  (window as unknown as { __psSentryAsk?: (m: unknown) => void }).__psSentryAsk = (m: unknown) => {
    const what = (m && typeof m === "object" ? (m as { do?: unknown }).do : null);
    const p = sentryOf(settingsData(vaultStore.get()));
    if (what === "restartOn") save(p, { restartSleepH: RESTART_ON_SLEEP_HOURS });
  };
  window.addEventListener("ps-sentry-security", () => { openSettings(null); window.setTimeout(() => openSecurity(true), 170); });
}

/** Engage: the Mac covers every screen and keeps itself awake (ps-mac Sentry.swift). */
function engage(p: SentryPrefs) {
  if (!PS) return;
  busyUntil = Date.now() + 4000;
  note = null;
  emit();
  window.setTimeout(emit, 4100);   // the busy look never sticks if the Mac does not answer
  psPost({ type: "sentry:start", plan: planOf(p) });
}

// ---------- the Task API: Start Sentry mode (core/taskapi.ts POST /v1/sentry/start) ----------
// The developer, 13 Nov 2026: "I literally want to be able to tell Claude Code to deploy Sentry Mode and it will get the PS app to
// deploy Sentry mode too." Exactly what the AI button does, with this person's own Sentry settings: the fresh restart
// helper check and (with Keep awake with the lid closed on) the lid check, then engage. Where the button would show a
// warning with Engage anyway, the API does NOT engage: nobody is at the screen to choose, so it answers with the warning
// for the person to fix it or start Sentry mode themselves. START ONLY: nothing here, in the API or on the Mac stops,
// pauses or weakens Sentry mode; leaving it still needs the Mac password or Touch ID on the real lock screen.
export type SentryStart = { result: "engaged" | "already"; phase: "covered" | "locked" } | { result: "blocked"; title: string; lines: string[] }
  | { result: "refused"; note: string } | { result: "notStarted" } | { result: "noAnswer" } | { result: "unavailable" };
const ENGAGE_WAIT_MS = 8000;
export async function startSentryForApi(): Promise<SentryStart> {
  if (!PS) return { result: "unavailable" };
  if (state.phase !== "off") return { result: "already", phase: state.phase };
  const p = sentryOf(settingsData(vaultStore.get()));
  const reboot = psSettingsNow()?.reboot;
  let facts: RestartFacts | null | undefined = reboot, g: LidGap | null = null;
  if (checksFresh(reboot)) {
    [facts, g] = await Promise.all([
      freshHelperCheck({ id: checkId(Date.now(), Math.random()), post: psPost, now: () => psSettingsNow()?.reboot, listen: onPsSettings, later: (f, ms) => window.setTimeout(f, ms) }),
      p.lid ? checkLid() : Promise.resolve(null),
    ]);
  }
  const w = preEngage(restartCheck(facts, p.restartH), p.lid, g);
  if (w) return { result: "blocked", title: preEngageTitle(w), lines: preEngageLines(w) };
  if (state.phase !== "off") return { result: "already", phase: state.phase };
  return new Promise((resolve) => {
    let over = false;
    const end = (r: SentryStart) => { if (over) return; over = true; answers.delete(heard); window.clearTimeout(t); resolve(r); };
    const heard = () => end(state.phase !== "off" ? { result: "engaged", phase: state.phase } : state.note ? { result: "refused", note: state.note } : { result: "notStarted" });
    const t = window.setTimeout(() => end({ result: "noAnswer" }), ENGAGE_WAIT_MS);
    answers.add(heard);
    engage(p);
  });
}

// ---------- the pieces of the button ----------
const SHIELD = (
  <svg className="sn-shield" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9.5 12l2 2 3.5-3.5" />
  </svg>
);
const GEAR = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

/** The big AI button and its gear. PS on a Mac only; never on the website's To-do page or the phone. */
export function SentryButton({ docked }: { docked?: boolean }) {
  const p = sentryOf(settingsData(useVault()));
  const s = useSentry();
  const [ask, setAsk] = useState(false);   // V1.52: the restart check's warning is up
  const [checking, setChecking] = useState(false);   // V1.54: the Mac is checking the helper (and the lid) fresh
  const [lid, setLid] = useState<LidGap | null>(null);   // V1.54 (lid-notice-154): what the lid check found for this press
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const reboot = usePsSettings()?.reboot;
  if (!PS || docked) return null;
  // V1.52: check the restart to BFU first; engage with no extra step when it will work. V1.54: one decision on both
  // checks: RestartWarning (with the lid line), LidWarning alone, or engage now.
  const decide = (pr: SentryPrefs, facts: RestartFacts | null | undefined, g: LidGap | null) => {
    setLid(g);
    if (restartCheck(facts, pr.restartH) || preEngage(null, pr.lid, g)) { sfx.click(); setAsk(true); return; }
    sfx.drop();
    engage(pr);
  };
  // V1.54: ask the Mac to check the helper now (helper-check-154: macOS and the helper itself, again for a few seconds
  // before it says off) and, with the lid option on, whether the lid keep awake really works (lid-notice-154: the helper
  // turns it on and straight back off, retried for a few seconds). Both at once: one short busy state under the same
  // "Checking the restart helper" line (both are the restart helper). Then one decision on both. Nothing engages if the
  // button went away meanwhile (the Tab list closed). An older PS app on the Mac (no fresh checks, and no lid check
  // either): it decides at once on what is known, as before.
  const go = (pr: SentryPrefs) => {
    const fresh = checksFresh(reboot);
    if (!fresh) { decide(pr, reboot, null); return; }
    setChecking(true);
    const helperNow = freshHelperCheck({
      id: checkId(Date.now(), Math.random()), post: psPost, now: () => psSettingsNow()?.reboot, listen: onPsSettings,
      later: (f, ms) => window.setTimeout(f, ms),
    });
    const lidNow: Promise<LidGap | null> = pr.lid ? checkLid() : Promise.resolve(null);
    void Promise.all([helperNow, lidNow]).then(([facts, g]) => {
      if (!alive.current) return;
      setChecking(false);
      decide(pr, facts, g);
    });
  };
  const click = () => {
    if (s.busy || checking) return;
    go(p);
  };
  const check = ask ? restartCheck(reboot, p.restartH) : null;
  const lidGap = ask && p.lid ? lid : null;
  const close = () => { setAsk(false); setLid(null); };
  return (
    <div className="sn-dock">
      <button type="button" className={`sn-btn${s.busy || checking ? " busy" : ""}`} onClick={click} onMouseDown={(e) => e.stopPropagation()}
        aria-label="Sentry mode: lock this Mac and keep AI jobs running" data-tip={WORDS.buttonTip} data-tip-line={WORDS.buttonLine}>
        <span className="sn-glow" aria-hidden="true" />
        {SHIELD}
        <span className="sn-ai">{WORDS.button}</span>
        <span className="sn-sub">Sentry mode</span>
      </button>
      <button type="button" className="sn-gear" aria-label={WORDS.gear} data-tip={WORDS.gear}
        onMouseDown={(e) => e.stopPropagation()} onClick={() => { sfx.click(); openSettings("sentry"); }}>{GEAR}</button>
      {checking ? <div className="sn-note" role="status"><span>{HELPER_CHECK.words}</span></div> : s.note && <SentryNote text={s.note.text} stay={s.note.stay} />}
      {check && (
        <RestartWarning check={check} lid={lidGap} onClose={close}
          onHelper={() => { close(); openSettings(null); window.setTimeout(() => openSecurity(true), 170); }}
          onTurnOn={() => {
            save(p, { restartH: RESTART_ON_HOURS });
            // Nothing else missing: the fix was the last step, so engage now. Otherwise the warning stays, on what is left
            // (V1.54: only the lid row left shows LidWarning).
            if (!restartCheck(reboot, RESTART_ON_HOURS) && !lidGap) { close(); sfx.drop(); engage({ ...p, restartH: RESTART_ON_HOURS }); }
          }}
          onAnyway={() => { close(); sfx.drop(); engage(p); }} />
      )}
      {!check && lidGap && (
        <LidWarning gap={lidGap} onClose={close}
          onHelper={() => { close(); openSettings(null); window.setTimeout(() => openSecurity(true), 170); }}
          onAnyway={() => { close(); sfx.drop(); engage(p); }} />
      )}
    </div>
  );
}

function SentryNote({ text, stay }: { text: string; stay?: boolean }) {
  useEffect(() => { if (stay) return; const t = window.setTimeout(clearNote, 9000); return () => window.clearTimeout(t); }, [text, stay]);
  return (
    <div className="sn-note" role="status">
      <span>{text}</span>
      <button type="button" className="sn-x" onClick={clearNote} aria-label="Close" data-tip="Close">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
  );
}

/** V1.52: "Auto restart is off". The restart to BFU would not happen, so say so before engaging. The fix button(s), Engage
 *  anyway, or Esc, the outside or Cancel (nothing engages). PS's own panel in the Tab list.
 *  sentry-real-lock: also "FileVault is off" (the disk is not encrypted, so the restart protects nothing). Its button only
 *  opens System Settings at FileVault (the Mac does it, sentry:fileVault); PS never switches FileVault itself. */
export function RestartWarning({ check, lid, onClose, onHelper, onTurnOn, onAnyway }: {
  check: RestartCheck; lid?: LidGap | null; onClose: () => void; onHelper: () => void; onTurnOn: () => void; onAnyway: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  const fixHelper = helperFixable(check.helper) || !!lid;   // V1.54: a lid gap is fixed by Set up the helper too
  const title = checkTitle(check);
  const fv = check.fileVaultOff && !fixHelper && !check.restartOff;   // the FileVault button gets the focus when it is the only fix
  return createPortal(
    <div className="sn-warn-layer" onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="sn-warn" role="alertdialog" aria-modal="true" aria-label={title}>
        <span className="sn-warn-icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" /><path d="M21 3v5h-5" /><path d="M12 8v4" /><path d="M12 16h.01" />
          </svg>
        </span>
        <span className="sn-warn-t">{title}</span>
        {restartWarnLines(check).map((t) => <p key={t} className="sn-warn-p">{t}</p>)}
        {lid && <p className="sn-warn-p">{lidLine(lid)}</p>}
        <div className="sn-warn-btns">
          {fixHelper && <button ref={first} type="button" className="sn-warn-ok" onClick={() => { sfx.click(); onHelper(); }}>{RESTART_WARN.setUpHelper}</button>}
          {check.restartOff && <button ref={fixHelper ? undefined : first} type="button" className="sn-warn-ok" onClick={() => { sfx.click(); onTurnOn(); }}>{RESTART_WARN.turnOn}</button>}
          {check.fileVaultOff && <button ref={fv ? first : undefined} type="button" className="sn-warn-ok" onClick={() => { sfx.click(); onClose(); psPost({ type: "sentry:fileVault" }); }}>{RESTART_WARN.openFileVault}</button>}
          <button ref={!fixHelper && !check.restartOff && !check.fileVaultOff ? first : undefined} type="button" className="sn-warn-alt" onClick={() => { sfx.click(); onAnyway(); }}>{RESTART_WARN.engageAnyway}</button>
        </div>
        <button type="button" className="sn-warn-cancel" onClick={() => { sfx.click(); onClose(); }}>{RESTART_WARN.cancel}</button>
      </div>
    </div>,
    document.body,
  );
}

/** V1.54: the pop up with only the lid row (the restart check had nothing to say): why, Set up the helper, Engage
 *  anyway, or Esc, the outside or Cancel (nothing engages). The same look as RestartWarning. */
export function LidWarning({ gap, onClose, onHelper, onAnyway }: { gap: LidGap; onClose: () => void; onHelper: () => void; onAnyway: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  const w = { restart: null, lid: gap };
  return createPortal(
    <div className="sn-warn-layer" onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="sn-warn" role="alertdialog" aria-modal="true" aria-label={preEngageTitle(w)}>
        <span className="sn-warn-icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 17h18" /><path d="M5 17l2-10h10l2 10" /><path d="M12 10v3" /><path d="M12 15.5h.01" />
          </svg>
        </span>
        <span className="sn-warn-t">{preEngageTitle(w)}</span>
        {preEngageLines(w).map((t) => <p key={t} className="sn-warn-p">{t}</p>)}
        <div className="sn-warn-btns">
          <button ref={first} type="button" className="sn-warn-ok" onClick={() => { sfx.click(); onHelper(); }}>{LID_WARN.setUp}</button>
          <button type="button" className="sn-warn-alt" onClick={() => { sfx.click(); onAnyway(); }}>{LID_WARN.anyway}</button>
        </div>
        <button type="button" className="sn-warn-cancel" onClick={() => { sfx.click(); onClose(); }}>{LID_WARN.cancel}</button>
      </div>
    </div>,
    document.body,
  );
}

// ---------- the settings (Settings, Sentry mode; views/SettingsGroups.tsx) ----------
function usePrefs() { return sentryOf(settingsData(useVault())); }

/** Stop when battery is low: Off, or a level (default 10%). */
export function SentryBatterySetting() {
  const p = usePrefs();
  return (
    <div className="tm-ed-seg sn-pcts" role="radiogroup" aria-label="Stop when battery is low">
      <Choice selected={!p.lowStop} onPick={() => { sfx.hover(); save(p, { lowStop: false }); }} title="Sentry mode keeps going until the battery runs out.">Off</Choice>
      {LOW_PCTS.map((n) => (
        <Choice key={n} selected={p.lowStop && p.lowPct === n} onPick={() => { sfx.hover(); save(p, { lowStop: true, lowPct: n }); }}>{n}%</Choice>
      ))}
    </div>
  );
}

/** "Restarting needs the PS app helper. Set it up in Security." with Set up the helper (opens Security). */
function HelperHint({ text }: { text: string }) {
  return (
    <div className="sn-helper">
      <span>{text}</span>
      <button type="button" className="gs-open" onClick={() => { sfx.click(); openSettings(null); window.setTimeout(() => openSecurity(true), 170); }}>{WORDS.setUpHelper}</button>
    </div>
  );
}
/** The PS helper (the restart helper, set up in Security) is known to be missing on this Mac. */
function useNoHelper() {
  const helper = usePsSettings()?.reboot?.helper;
  return helper !== undefined && helper !== "on" && helper !== "test";
}

/** Restart if not unlocked: Off or a time (default 8 h). The restart itself is the PS helper's (the restart helper, set
 *  up in Security): without it this says so and offers to set it up, never failing silently. */
export function SentryRestartSetting() { return <RestartPicker which="restartH" label="Restart if not unlocked" />; }
/** V1.52 (the developer): Restart if not unlocked during Sleep mode, the time armed when Sentry mode is turned on from Sleep mode's
 *  AI Sentry mode button (default 18 h). The same synced value in Settings, Sentry mode and in Sleep mode's settings. */
export function SentryRestartSleepSetting() { return <RestartPicker which="restartSleepH" label="Restart if not unlocked during Sleep mode" />; }
function RestartPicker({ which, label }: { which: "restartH" | "restartSleepH"; label: string }) {
  const p = usePrefs();
  const needsHelper = p[which] > 0 && useNoHelper();
  return (
    <div className="sn-restart">
      <div className="tm-ed-seg sn-pcts" role="radiogroup" aria-label={label}>
        {RESTART_HOURS.map((h) => (
          <Choice key={h} selected={p[which] === h} onPick={() => { sfx.hover(); save(p, { [which]: h }); }}>{restartLabel(h)}</Choice>
        ))}
      </div>
      {needsHelper && <HelperHint text={WORDS.helperNeeded} />}
    </div>
  );
}

/** Keep awake with the lid closed: on by default (V1.49). Without the PS helper Sentry mode still engages; this row says
 *  so and offers to set it up. */
export function SentryLidSetting() {
  const p = usePrefs();
  const needsHelper = p.lid && useNoHelper();
  const on = () => { sfx.hover(); save(p, { lid: true, lidSet: true }); };
  return (
    <div className="sn-restart">
      <div className="tm-ed-seg" role="radiogroup" aria-label="Keep awake with the lid closed">
        <Choice selected={p.lid} onPick={on}>On</Choice>
        <Choice selected={!p.lid} onPick={() => { sfx.hover(); save(p, { lid: false, lidSet: true }); }}>Off</Choice>
      </div>
      {needsHelper && <HelperHint text={WORDS.lidHelperNeeded} />}
    </div>
  );
}

/** For Settings search and the gear: opens Settings on Sentry mode. */
export const openSentrySettings = () => openSettings("sentry");

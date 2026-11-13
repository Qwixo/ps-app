// Auto reboot and the restart helper, for THIS Mac (the Tab list's Security window, views/Security.tsx,
// and the Second Computer Machine pane show this one card). The native side is ps-mac
// Sources/AutoReboot.swift and the root helper Helper/rebootd.swift; the timer's rules are
// Helper/RebootCore.swift, mirroring GrapheneOS: it counts only while this Mac is locked or asleep,
// every unlock starts it again, and it never restarts a Mac that is unlocked. Watch only logs "would
// have restarted" and never restarts; the developer switches it to Active himself. From V1.28 it works like
// GrapheneOS's own (the developer, 2 Nov 2026): Active really restarts a Mac that stays locked for the time chosen,
// 10 minutes to 72 hours (18 hours unless changed), nothing else holds it back, it never runs in Before
// First Unlock ("all it takes is one reboot or one shutdown"), the other Mac or the phone can postpone it
// an hour at a time (at most 12 hours), and the main Mac can choose its settings.
// Its own classes all start with arb (tests/rebootcard.test.ts): in V1.24 they were rb, the rule book's
// full screen page (rulebook.css .rb), which pinned this card over the top of Mac settings and took every click.
import { useEffect, useState } from "react";
import { psPost, usePsSettings, type RebootSettings } from "../ps";
import "./reboot.css";
import { appName, macListHint } from "../core/appname";
import { isRedAccount } from "../core/account";
import { useVault } from "../ui/kit";
import { helperWords } from "../core/helperwords";

/** The lengths offered, as GrapheneOS offers them: 10 minutes to 72 hours (ps-mac AutoReboot.minuteChoices). */
export const REBOOT_CHOICES = [10, 30, 60, 120, 240, 480, 720, 1080, 1440, 2160, 2880, 4320];
/** "10 minutes", "1 hour", "18 hours" (an older setting in whole hours reads the same). */
export const lengthText = (m: number) => m < 60 ? `${m} minutes` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : m === 60 ? "1 hour" : `${m / 60} hours`;
/** Said plainly on the card while Active (G Squad): the restart gives no app a chance to save, and this Mac shows no
 *  warning first (it is locked, and unlocking already stops it). Shown to everyone; nothing about how it runs changes. */
export const REBOOT_UNSAVED = "Anything you have not saved is lost when it restarts, and this Mac shows no warning first, so save before you walk away.";
export const chipText = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h`);
const shorter = (m: number) => [...REBOOT_CHOICES].reverse().find((c) => c < m);
const longer = (m: number) => REBOOT_CHOICES.find((c) => c > m);
function clock(at: number) {
  return new Date(at * 1000).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}
function left(s: number) {
  const m = Math.max(0, Math.round(s / 60)), h = Math.floor(m / 60);
  return h ? (m % 60 ? `${h} h ${m % 60} min` : `${h} h`) : `${m} min`;
}
const KIND: Record<string, string> = { refused: "Not done", restart: "Restarted", attempt: "Restarting", would: "Would have", skipped: "Not restarted", remote: "Remote", shutdown: "Shut down", gaveup: "Did not restart", held: "Waited", postponed: "Postponed", sentry: "Sentry restart" };

export function RebootCard({ title = "Auto reboot" }: { title?: string }) {
  const st = usePsSettings();
  const red = isRedAccount(useVault());   // Second Computer words on the developer's account only (V1.42)
  const r: RebootSettings | undefined = st?.reboot;
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { psPost({ type: "reboot:refresh" }); }, []);
  useEffect(() => { setBusy(false); }, [st]);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t); }, []);
  if (!r) return null;

  const s = r.status;
  const on = r.helper === "on";
  const set = (patch: { mode?: "off" | "watch" | "active"; minutes?: number }) => psPost({ type: "reboot:set", ...patch });
  const now = Date.now() / 1000;
  const off = helperWords(r.helper, r.offBy, appName(), macListHint());   // V1.45: why it is not running, in plain words

  let next: string;
  if (s?.safeMode) next = "Safe Mode: the helper does nothing";
  else if (!on) next = "Not running";
  else if (r.mode === "off") next = "Off";
  else if (!s) next = r.error ? `The restart helper does not answer: ${r.error}` : "Asking the restart helper";
  else if (s.session === "unlocked") next = `Starts when you lock this Mac (${lengthText(r.minutes)})`;
  else if (!s.seenUnlock || s.signedIn === false) next = "Waits for your first sign in since this Mac started (Before First Unlock)";
  else if (s.counting && s.deadline) next = `${s.effectiveMode === "active" ? "Restarts" : "Would restart"} ${clock(s.deadline)}, in ${left(s.deadline - now)}`;
  else if (s.bootTried && s.effectiveMode === "active") next = "Already restarted once since this Mac started: not again until it restarts";
  else next = r.mode === "watch" ? "Logged for this lock" : "Restart started";

  return (
    <section className="panel stack arb" aria-labelledby="arb-title">
      <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h2 className="h2" id="arb-title">{title}</h2>
        {r.helper === "on" && <span className={`pill ${r.mode === "active" ? "good" : r.mode === "watch" ? "warn" : "ink"}`}>{r.mode === "active" ? "Active" : r.mode === "watch" ? "Watch only" : "Off"}</span>}
        {off && <span className="pill warn">{off.pill}</span>}
        {r.helper === "off" && <span className="pill ink">Not set up</span>}
        {r.helper === "missing" && <span className="pill ink">Not in this build</span>}
      </div>
      {s?.safeMode && <div className="banner">This Mac started in Safe Mode, so the restart helper does nothing until a normal start.</div>}
      <p className="muted" style={{ margin: 0 }}>
        Like GrapheneOS: the countdown starts the moment you lock this Mac (or close the lid) and keeps going through sleep.
        Restarts once if this Mac stays locked for {lengthText(r.minutes)}, so your disk is locked again until your
        password; unlocking any account before then cancels it, and it never restarts a Mac that is unlocked. It works with
        the lid shut and on battery: the Mac wakes itself at the right time. After a restart it waits for you to sign in
        before the timer can run again (Before First Unlock), so it can never restart over and over. It never restarts in
        the first 30 minutes after the Mac starts. To stop it at any time: Off here, or switch {appName()} off in System Settings,
        General, Login Items and Extensions, or start the Mac in Safe Mode.
      </p>

      {r.helper === "off" && (
        <div className="stack tight">
          <button className="btn primary" style={{ justifySelf: "start" }} disabled={busy} onClick={() => { setBusy(true); psPost({ type: "reboot:setup" }); }}>
            Set up the restart helper
          </button>
          <small className="hint">macOS then opens Login Items and Extensions: find {appName()}{macListHint()} under Allow in the Background and switch it on. If it already looks on, switch it off and then on again. Nothing can restart this Mac until you do.</small>
        </div>
      )}
      {off && (
        <div className="banner arb-col" role="status">
          <span>{off.banner}</span>
          <button className={`btn sm ${r.offBy ? "primary" : "ghost"}`} style={{ justifySelf: "start" }} onClick={() => psPost({ type: "reboot:setup" })}>{off.button}</button>
        </div>
      )}

      {on && (
        <>
          <div className="stack tight">
            <span className="small arb-l" id="arb-mode">Mode</span>
            <div className="tabs" role="radiogroup" aria-labelledby="arb-mode" style={{ justifySelf: "start" }}>
              {(["off", "watch", "active"] as const).map((m) => (
                <button key={m} className="tab" role="radio" aria-checked={r.mode === m} aria-selected={r.mode === m}
                  onClick={() => { if (m === "active" && r.mode !== "active") { setSure(true); return; } setSure(false); set({ mode: m }); }}>
                  {m === "off" ? "Off" : m === "watch" ? "Watch only" : "Active"}
                </button>
              ))}
            </div>
            {sure && (
              <div className="banner arb-col">
                <span>
                  Active really restarts this Mac once it has stayed locked for {lengthText(r.minutes)}, even with a call or a job
                  running. Anything unsaved in other apps is lost then. After the restart it waits for your password{red
                    ? ", so Second Computer cannot reach it until you log in at it." : "."}
                </span>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn primary sm" onClick={() => { setSure(false); set({ mode: "active" }); }}>Yes, make it Active</button>
                  <button className="btn ghost sm" onClick={() => setSure(false)}>Not yet</button>
                </div>
              </div>
            )}
            <small className="hint">Watch only never restarts: it only writes down when it would have.</small>
            {r.mode === "active" && (
              <p className="small muted" style={{ margin: 0 }}>
                Active: restarts once if this Mac stays locked for {lengthText(r.minutes)}, counted from the moment you lock it
                (asleep or not). Unlocking it cancels the countdown. After a restart it waits for you to sign in before the
                timer can run again. <b>{REBOOT_UNSAVED}</b>
              </p>
            )}
            {r.mode === "active" && s?.watchOnlyBecause && s.activeAllowed !== false && (
              <div className="banner">Automatic login is on for this Mac, so Active works as Watch only: after a restart nobody would have to unlock it, and it could restart again. Turn off automatic login in System Settings, Users and Groups to use Active.</div>
            )}
            {(r.helperOld || (s && s.activeAllowed === false)) && (
              <div className="banner">
                The restart helper running on this Mac is from an older PS, where Active works as Watch only and Postpone is not
                there yet. The new helper starts the next time this Mac restarts{r.mode === "active" ? "; until then Active only writes down when it would have restarted" : ""}.
              </div>
            )}
          </div>

          <div className="stack tight">
            <span className="small arb-l" id="arb-hours-l">Restart after</span>
            <div className="row arb-hours" role="group" aria-labelledby="arb-hours-l">
              <button className="btn ghost sm" aria-label="Shorter" disabled={!shorter(r.minutes)} onClick={() => { const m = shorter(r.minutes); if (m) set({ minutes: m }); }}>−</button>
              <b className="arb-h">{lengthText(r.minutes)}</b>
              <button className="btn ghost sm" aria-label="Longer" disabled={!longer(r.minutes)} onClick={() => { const m = longer(r.minutes); if (m) set({ minutes: m }); }}>+</button>
              {REBOOT_CHOICES.map((m) => (
                <button key={m} className={`btn sm ${r.minutes === m ? "primary" : "ghost"}`} onClick={() => set({ minutes: m })}>{chipText(m)}</button>
              ))}
            </div>
            <small className="hint">From 10 minutes to 72 hours, as on GrapheneOS ({lengthText(r.defaultMinutes)} unless you change it). Changing it starts the countdown again from now.</small>
          </div>

          <div className="arb-next">
            <span className="small muted">Next</span><b>{next}</b>
            {!!s?.postponed && <span className="small muted">Postponed {left(s.postponed)} from your other Mac or phone (12 hours at most)</span>}
          </div>

          {r.mode !== "off" && (
            <div className="stack tight">
              <button className="btn ghost sm" style={{ justifySelf: "start" }} disabled={!!s?.testOnce} onClick={() => psPost({ type: "reboot:test" })}>
                {s?.testOnce ? "Test ready: lock this Mac" : "5 minute test"}
              </button>
              <small className="hint">The next countdown is 5 minutes, once. {r.mode === "watch" ? "In Watch only it just logs." : "Save your work first."}</small>
            </div>
          )}
        </>
      )}

      {r.fileVault === "off" && <div className="banner">FileVault is off on this Mac, so a restart does not lock the disk. Turn it on in System Settings, Privacy and Security, FileVault.</div>}
      {r.passwordImmediately === false && <div className="banner">This Mac does not ask for the password as soon as it sleeps, so it can sleep unlocked and the timer then waits. Set it to Immediately in System Settings, Lock Screen.</div>}
      {r.error && on && <div className="banner">The helper did not answer: {r.error}</div>}
      {st?.error && <div className="banner">{st.error}</div>}

      {on && !!s?.history?.length && (
        <details className="arb-log">
          <summary className="small">Log ({s.history.length})</summary>
          <ul>
            {[...s.history].reverse().map((h, i) => (
              <li key={i} className={`arb-k-${h.kind}`}><span className="arb-kind">{KIND[h.kind] ?? h.kind}</span><span>{h.text}</span></li>
            ))}
          </ul>
        </details>
      )}
      {on && s?.bootedAt ? <small className="hint">Last started {clock(s.bootedAt)}</small> : null}
      {(on || r.helper === "approve") && (
        <button className="btn ghost sm arb-remove" onClick={() => psPost({ type: "reboot:remove" })}>Remove the helper</button>
      )}
    </section>
  );
}

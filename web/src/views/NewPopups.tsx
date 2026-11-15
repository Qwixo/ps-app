// "New in this version" pop-ups (V1.56, the developer 13 Nov 2026). After a person closes What's new: the AI task API, then (a minute
// of PS being open later) Auto approve, then (a minute later) "PS is open source". Same small card as the first use tips,
// bottom middle of the Tab list. The rules (order, wait, skips, blockers) are core/newpopups.ts and their tests are
// tests/newpopups.test.ts; the words are core/newpopupwords.ts. This reads the live facts once a second, shows at most
// one card, and saves what was seen in settings.popupsSeen (synced, once per person).
//
// Gentle by design, like the tips: nothing here takes the keyboard focus, it is only drawn inside this page (never a
// pop up window or a notification, so never over another app), and it leaves the moment a meeting, Sleep mode, Sentry mode,
// Do Not Disturb, a screen or a menu starts. Esc puts it away before anything behind it hears the key.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PS, onPsSettings, psPost, psSettingsNow, useOverlayShown } from "../ps";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { appName } from "../core/appname";
import { vaultStore } from "../core/vault";
import { calendarSnap, remindRec, settingsData } from "../core/select";
import { dndActive } from "../core/dnd";
import { afkMeetWindows } from "../core/afkmeet";
import { tipsOn } from "../core/offswitches";
import { blocker, cleanTipsSeen, hidesShowing, placeTip, type BlockFacts, type Placed } from "../core/tips";
import { sleepState } from "../sleepmode/engine";
import { useFaceShowing, useWhatsNewShowing } from "../updateface";
import { useWelcomeShowing } from "./Welcome";
import { sentryUp } from "./Sentry";
import { taskMapActions } from "./TaskMap";
import { openSettings, settingsWanted } from "./SettingsScreen";
import { frontIsProtected, screenNow, sinceLastKeyMs, typingNow } from "./Tips";
import { popupOn, setPopupOn, tipOn, walkOn, walkWaitingNow, noteSourceOpened, sourceWasOpened } from "./popupstate";
import { copyAiGuide } from "../taskapi";
import { cleanApprove, APPROVE_LINE } from "../core/autoapprove";
import { checkWithAiText, openSourceUrl } from "../core/opensource";
import { APPROVE_RISK_LABEL, POPUP_STATUS, POPUP_WORDS, type PopupWords } from "../core/newpopupwords";
import {
  NO_WAIT, POPUPS, addWait, afterShown, cleanPopupsSeen, cleanWait, fill, foundNow, gateOpen, markPopupSeen, nextPopup, openStep, tipsFinished,
  type PopupFacts, type PopupId, type PopupWait,
} from "../core/newpopups";
import type { CalendarSnap } from "../core/model";
import { meetingEvents } from "../core/calpick";
import type { ReactNode } from "react";
import "./tips.css";
import "./newpopups.css";

// ---------- kept on this device ----------
const GATE_KEY = "ps.newPopupsGate";   // "1": What's new was closed on this device (an update): the pop-ups may start
const WAIT_KEY = "ps.newPopupsWait";   // { armed, ms }: the one minute, counted only while PS is open
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } };
const loadWait = (): PopupWait => { try { return cleanWait(JSON.parse(lsGet(WAIT_KEY) || "null")); } catch { return NO_WAIT; } };

// Pop-ups seen here before the save has come back (the save is the vault's, so a moment late).
const shownHere = new Set<PopupId>();

/** Mark pop-ups seen: merged with what the vault holds right now, so another device's marks are never undone. */
function save(ids: PopupId[]) {
  const s = vaultStore.get();
  if (s.status !== "unlocked" || !ids.length) return;
  let cur = cleanPopupsSeen(settingsData(s).popupsSeen);
  const now = Date.now();
  for (const id of ids) { shownHere.add(id); cur = markPopupSeen(cur, id, now); }
  void taskMapActions.looks({ popupsSeen: cur });
}

type Phase = "ask" | "working" | "copied" | "failed";
type Showing = { id: PopupId; phase: Phase };

export function NewPopupsHost() {
  const s = useVault();
  const listShown = useOverlayShown();
  const tour = useWelcomeShowing();
  const whatsNew = useWhatsNewShowing();
  const face = useFaceShowing();
  const [show, setShow] = useState<Showing | null>(null);

  const live = useRef({ s, listShown, tour, setup: whatsNew || face });
  live.current = { s, listShown, tour, setup: whatsNew || face };
  const showRef = useRef<Showing | null>(null);
  showRef.current = show;
  const wait = useRef<PopupWait>(loadWait());
  const gate = useRef(lsGet(GATE_KEY) === "1");
  const timer = useRef(0);
  const counted = useRef(false);   // it has been up long enough to count as seen
  const quietFrom = useRef(0);     // the last moment a screen was open or a key typed: the list must then be calm again

  const saveWait = () => lsSet(WAIT_KEY, JSON.stringify(wait.current));
  const seenNow = (id: PopupId) => {
    counted.current = true;
    window.clearTimeout(timer.current); timer.current = 0;
    save([id]);
    wait.current = afterShown(); saveWait();   // the next one waits a full minute of PS being open
  };
  const hide = (mark: boolean) => {
    const cur = showRef.current;
    window.clearTimeout(timer.current); timer.current = 0;
    if (cur && mark) seenNow(cur.id);
    else if (cur && !counted.current) shownHere.delete(cur.id);   // put away before it counted: it may come back another time
    counted.current = false;
    setPopupOn(false);
    setShow(null);
  };

  // The one clock: look at the facts every second.
  useEffect(() => {
    let sinceShown = 0, last = Date.now(), wasSetup = false, lastSaved = 0;
    const tick = () => {
      const { s: snap, listShown: shown, tour: touring, setup } = live.current;
      const now = Date.now();
      // PS open time (a sleeping Mac or a stopped page never counts more than a few seconds), only while nothing is showing.
      const step = openStep(last, now); last = now;
      if (!showRef.current && step) { const w = addWait(wait.current, step); if (w !== wait.current) { wait.current = w; if (now - lastSaved > 10_000) { lastSaved = now; saveWait(); } } }
      // What's new (or the update card) was up and is gone: the pop-ups may start.
      if (setup) wasSetup = true;
      else if (wasSetup) { wasSetup = false; if (!gate.current) { gate.current = true; lsSet(GATE_KEY, "1"); } }

      if (!shown) sinceShown = 0; else if (!sinceShown) sinceShown = now;
      const unlocked = snap.status === "unlocked";
      const st = unlocked ? settingsData(snap) : null;
      const cal = unlocked ? calendarSnap(snap) : null;
      const screen = screenNow(), typing = typingNow();
      if (screen || typing || setup || touring) quietFrom.current = now;
      const facts: BlockFacts = {
        listShown: shown,
        pageVisible: document.visibilityState !== "hidden",
        shownForMs: sinceShown ? now - Math.max(sinceShown, quietFrom.current) : 0,
        sinceKeyMs: sinceLastKeyMs(),
        typing,
        screenOpen: screen,
        setupOpen: setup || touring,
        inMeeting: !!st && afkMeetWindows(meetingEvents(cal ? (cal.data as CalendarSnap).events : [], st.calChoices), st.meetHidden, now).some(([a, b]) => now >= a && now < b),
        sleepMode: sleepState().here,
        sentry: sentryUp(),
        dnd: !!st && dndActive(st.dnd, now),
        protectedFront: frontIsProtected(),
      };
      if (import.meta.env.DEV) Object.assign(facts, (window as unknown as { __popupsOverride?: Partial<BlockFacts> }).__popupsOverride);
      const block = blocker(facts);
      const cur = showRef.current;
      if (cur) { if (hidesShowing(block) || (st && !tipsOn(st.tipsShow))) hide(false); return; }
      if (!unlocked || !st) return;

      let seen = cleanPopupsSeen(st.popupsSeen);
      for (const id of shownHere) seen = markPopupSeen(seen, id, now);
      const ps = psSettingsNow();
      const aa = cleanApprove((ps as { autoApprove?: unknown } | null)?.autoApprove);
      const pf: PopupFacts = {
        seen, now, block,
        synced: !!snap.lastSync || !!snap.local || snap.role === "owner",
        owner: snap.role === "owner",
        tipShowing: false,   // set below
        enabled: tipsOn(st.tipsShow),
        gateOpen: false,
        wait: wait.current,
        mac: PS,
        api: !PS || !ps?.taskApi ? "unknown" : ps.taskApi.on ? "on" : "off",
        approve: !PS || !aa ? "unknown" : aa.ai || aa.sleep || aa.always ? "on" : "off",
        approveRowOpened: PS && settingsWanted() === "sentry",
        sourceUrl: openSourceUrl(),
        sourceOpened: sourceWasOpened(),
      };
      const phone = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
      pf.gateOpen = gateOpen(gate.current, tipsFinished(cleanTipsSeen(st.tipsSeen), { hasReminder: !!remindRec(snap)?.list?.some((r) => r.task), phone }));
      pf.tipShowing = tipOn() || walkOn() || walkWaitingNow();   // views/Tips.tsx keeps the flag; the 1.58 walkthrough (views/Walkthrough.tsx) goes first
      if (import.meta.env.DEV) { Object.assign(pf, (window as unknown as { __popupsFacts?: Partial<PopupFacts> }).__popupsFacts); (window as unknown as { __popupsSeenFacts?: unknown }).__popupsSeenFacts = pf; }
      // A feature they found by themselves needs no pop-up: mark it seen, quietly.
      const f = foundNow(pf);
      if (f.length) { save(f); for (const id of f) seen = markPopupSeen(seen, id, now); pf.seen = seen; }
      const id = nextPopup(pf);
      if (!id) return;
      shownHere.add(id);
      setPopupOn(true);
      counted.current = false;
      setShow({ id, phase: "ask" });
      timer.current = window.setTimeout(() => seenNow(id), POPUPS.seenAfterMs);
    };
    const t = window.setInterval(tick, 1000);
    const bye = () => saveWait();
    window.addEventListener("pagehide", bye);
    return () => { window.clearInterval(t); window.clearTimeout(timer.current); window.removeEventListener("pagehide", bye); saveWait(); setPopupOn(false); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The dev server only, for pictures: window.__popupsShow("api") puts that pop-up up at once (nothing is saved).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __popupsShow?: (id: PopupId | null, phase?: Phase) => void }).__popupsShow = (id, phase = "ask") => { window.clearTimeout(timer.current); counted.current = true; setPopupOn(!!id); setShow(id ? { id, phase } : null); };
  }, []);

  // Esc puts it away, before anything else hears it.
  useEffect(() => {
    if (!show) return;
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); e.stopImmediatePropagation();
      hide(true);
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [show?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- what the buttons do ----------
  const act = {
    later: () => hide(true),
    settings: (id: PopupId) => {
      hide(true);
      if (id === "api") openSettings("api");
      else if (id === "approve") openSettings("sentry", { jump: "auto-approve" });
    },
    /** API: switch it on with its own switches as they are (its defaults the first time), then copy the instructions. */
    api: async () => {
      seenNow("api");
      setShow({ id: "api", phase: "working" });
      if (!psSettingsNow()?.taskApi?.on) psPost({ type: "api:set", on: true });
      const api = await whenApiReady();
      if (!showRef.current || showRef.current.id !== "api") return;
      if (!api) { setShow({ id: "api", phase: "failed" }); return; }
      copyAiGuide(api);
      sfx.done();
      setShow({ id: "api", phase: "copied" });
    },
    approve: () => { sfx.click(); act.settings("approve"); },
    /** Open source: copy the check with AI prompt. */
    copySource: async () => {
      const url = openSourceUrl();
      seenNow("source");
      if (!url) return;
      try { await navigator.clipboard.writeText(checkWithAiText(url)); sfx.done(); setShow({ id: "source", phase: "copied" }); }
      catch { setShow({ id: "source", phase: "failed" }); }
    },
    openSource: () => {
      const url = openSourceUrl();
      noteSourceOpened();
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      hide(true);
    },
  };

  if (!show) return null;
  return createPortal(<PopupCard key={show.id} show={show} act={act} />, document.body);
}

/** After "switch on": wait for PS to say it is on, listening and has a key (up to 8 s). null: it did not. */
function whenApiReady(): Promise<{ scopes?: Record<string, boolean>; port?: number } | null> {
  return new Promise((resolve) => {
    let done = false;
    const check = () => {
      if (done) return;
      const a = psSettingsNow()?.taskApi;
      if (a?.on && a.running && a.keyTail) { finish(a); return; }
      if (a?.on && a.error) finish(null);
    };
    const finish = (v: { scopes?: Record<string, boolean>; port?: number } | null) => { if (done) return; done = true; off(); window.clearTimeout(to); window.clearInterval(poll); resolve(v); };
    const off = onPsSettings(check);
    const poll = window.setInterval(check, 200);
    const to = window.setTimeout(() => finish(null), 8000);
    check();
  });
}

// ---------- the card ----------
type Act = {
  later: () => void; settings: (id: PopupId) => void; api: () => void; approve: () => void; copySource: () => void; openSource: () => void;
};
const ICON: Record<PopupId, ReactNode> = {
  api: <><path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13.5 6l-3 12" /></>,
  approve: <><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M9 12l2.2 2.2L15.5 10" /></>,
  source: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5L7 12l2.5 2.5M14.5 9.5L17 12l-2.5 2.5" /></>,
};

function PopupCard({ show, act }: { show: Showing; act: Act }) {
  const { id, phase } = show;
  const words: PopupWords = POPUP_WORDS[id];
  const app = useMemo(() => appName(), []);
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placed | null>(null);
  const measure = () => {
    const c = box.current;
    if (!c) return;
    setPlace(placeTip(null, { w: c.offsetWidth, h: c.offsetHeight }, { w: innerWidth, h: innerHeight }, ["bottom"]));
  };
  useLayoutEffect(() => { measure(); }, [id, phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { addEventListener("resize", measure); return () => removeEventListener("resize", measure); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const copied = phase === "copied", failed = phase === "failed", working = phase === "working";
  const title = copied ? POPUP_STATUS.copiedTitle : fill(words.title, app);
  const lines = copied ? [id === "api" ? POPUP_STATUS.copiedApi : POPUP_STATUS.copiedSource]
    : failed ? [id === "api" ? POPUP_STATUS.apiFailed : POPUP_STATUS.copyFailed]
    : words.lines.map((l) => fill(l, app));
  const main = id === "api" ? act.api : id === "approve" ? act.approve : act.copySource;
  const second = id === "source" ? act.openSource : () => act.settings(id);
  const click = (f: () => void) => () => { sfx.click(); f(); };

  return (
    <div ref={box} className={`tp-card np-card np-${id}${copied ? " copied" : ""}${place ? " in" : ""}`} role="status" aria-live="polite"
      style={{ left: place?.x ?? 0, top: place?.y ?? 0 }} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <div className="np-head">
        <span className="np-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            {copied ? <path d="M5 12l5 5L20 7" /> : ICON[id]}
          </svg>
        </span>
        <div className="tp-title">{title}</div>
      </div>
      {lines.map((l, i) => <div key={i} className="tp-line">{l}</div>)}
      {id === "approve" && !copied && !failed && (
        <div className="np-risk"><b>{APPROVE_RISK_LABEL}</b> {APPROVE_LINE}</div>
      )}
      <div className="np-row">
        {copied ? (
          <button type="button" tabIndex={-1} className="np-main" onClick={click(act.later)}>{POPUP_STATUS.done}</button>
        ) : working ? (
          <button type="button" tabIndex={-1} className="np-main busy" disabled>{POPUP_STATUS.working}</button>
        ) : (
          <>
            {!failed && <button type="button" tabIndex={-1} className="np-main" onClick={click(main)}>{words.main}</button>}
            {words.second && <button type="button" tabIndex={-1} className="np-sec" onClick={click(second)}>{words.second}</button>}
            <button type="button" tabIndex={-1} className="np-later" onClick={click(act.later)}>{words.later}</button>
          </>
        )}
      </div>
    </div>
  );
}

/** For the tests and the dev page: is a pop-up up right now. */
export const popupIsUp = () => popupOn();

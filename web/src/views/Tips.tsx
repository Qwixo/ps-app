// First use tips (V1.55, the developer 12 Nov 2026). The rules are in core/tips.ts (tests/tips.test.ts); this reads the live
// facts once a second, shows at most one small card, and saves what was seen in settings.tipsSeen (synced, so a tip
// is seen once per account, not once per device).
//
// Gentle by design:
//  - It never takes the keyboard focus (nothing here is focused or focusable by a click) and it is only drawn inside
//    this page (never a pop up window or a notification), so it can never sit over 1Password or Signal.
//  - It waits for quiet: no meeting, Sleep mode, Sentry mode, Do Not Disturb, setup menu, What's new, open screen,
//    typing, or a recent key. A tip that is showing leaves the moment any of those start.
//  - Got it, Esc or a long wait puts it away; it counts as seen once it has been up a moment or was put away.
//  - Doing the thing yourself counts as knowing it: a page swipe makes the swipe tip's green tick (with a sound);
//    a swipe or a dot click before its tip silently ticks that tip off.
// Hooks from the lists chat: window events "ps-page-swiped" {from, to, how} and "ps-list-created" {id, name}.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GOS } from "../gos/bridge";
import { useOverlayShown } from "../ps";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { appName } from "../core/appname";
import { vaultStore } from "../core/vault";
import { calendarSnap, remindRec, settingsData, todos } from "../core/select";
import { tipsOn } from "../core/offswitches";
import { dndActive } from "../core/dnd";
import { afkMeetWindows } from "../core/afkmeet";
import { isProtectedApp } from "../core/protected";
import {
  LEARNED, TIPS, TIPS_NOT_ON_PHONE, TIP_BUTTON, TIP_PHONE, TIP_ORDER, TIP_SIDES, TIP_WORDS, blocker, cleanTipsSeen, hidesShowing, isSeen, learnedBy, markSeen,
  nextTip, ownTaskCount, placeTip, resetTips, type BlockFacts, type Placed, type TipId, type TipsSeen,
} from "../core/tips";
import { sleepState } from "../sleepmode/engine";
import { useFaceShowing, useWhatsNewShowing } from "../updateface";
import { useWelcomeShowing } from "./Welcome";
import { popupOn, setTipOn, walkOn } from "./popupstate";
import { sentryUp } from "./Sentry";
import { editingNow } from "./EditMode";
import { taskMapActions } from "./TaskMap";
import type { CalendarSnap } from "../core/model";
import "./tips.css";

// ---------- small live facts ----------
let lastKeyAt = 0;
let frontApp = "";
/** The Mac may say which app is in front: 1Password or Signal hides everything here. Never required, never read from the page. */
if (typeof window !== "undefined") {
  (window as Window & { __psTipsFront?: (id: unknown) => void }).__psTipsFront = (id) => { frontApp = typeof id === "string" ? id.slice(0, 200) : ""; };
}
/** For the "new in this version" pop-ups (views/NewPopups.tsx): they use the same quiet rules as the tips. */
export const sinceLastKeyMs = () => Date.now() - lastKeyAt;
export const frontIsProtected = () => !!frontApp && isProtectedApp(frontApp);
const phoneish = () => GOS || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);

// Tips already shown on this page before the save has come back (the save is the vault's, so a moment late).
const shownHere = new Set<TipId>();
let shownAt = 0;

const SCREEN =
  "[role='dialog'],[role='menu'],[role='alertdialog'],.gs-layer,.tm-ctx,.tm-pop,.tm-addwin,.tm-editor,.tl-card,.sl-sheet,.slp-sheet,.mp-layer";

function visible(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return null;
  return el;
}
/** What each tip points at, if it is on the screen right now. */
function targetOf(id: TipId): HTMLElement | null {
  const q = (s: string) => visible(document.querySelector(s));
  switch (id) {
    case "swipe": return q(".tl-pager");
    case "dots": return q(".tl-dots");
    case "look": return q(".tl-strip .tl-name") ?? q(".tl-dots");
    case "edit": return q(".ed-corner .ed-btn");
    case "remind": {
      for (const el of document.querySelectorAll(".tm-list > .tm-row[data-id]:not(.done):not(.tm-editor)")) { const v = visible(el); if (v) return v; }
      return null;
    }
  }
}

/** Typing: a text field has the cursor. */
export function typingNow(): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) return false;
  return a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable;
}
// (the list itself is a role dialog too: it is not "a screen over the list")
export const screenNow = () => editingNow() || !!Array.from(document.querySelectorAll(SCREEN)).find((e) => !e.closest(".tp-card") && !e.classList.contains("tm-overlay") && visible(e));

// ---------- saving ----------
/** Mark tips seen: merged with what the vault holds right now, so another device's marks are never undone. */
function save(ids: TipId[]) {
  const s = vaultStore.get();
  if (s.status !== "unlocked" || !ids.length) return;
  let cur: TipsSeen = cleanTipsSeen(settingsData(s).tipsSeen);
  const now = Date.now();
  for (const id of ids) { shownHere.add(id); cur = markSeen(cur, id, now); }
  void taskMapActions.looks({ tipsSeen: cur });
}

/** Settings, About and updates, "Show tips again": every tip counts as new, and the first comes after a quiet moment.
 *  A clear yes, so "Show first use tips" goes back on too. */
export function showTipsAgain() {
  shownHere.clear();
  void taskMapActions.looks({ tipsSeen: resetTips(Date.now()), tipsShow: true });
}

// ---------- the host ----------
type Showing = { id: TipId; learned: boolean };

export function TipsHost() {
  const s = useVault();
  const listShown = useOverlayShown();
  const tour = useWelcomeShowing();
  const whatsNew = useWhatsNewShowing();
  const face = useFaceShowing();
  const [show, setShow] = useState<Showing | null>(null);

  // The newest facts, for the one clock below.
  const live = useRef({ s, listShown, setup: tour || whatsNew || face });
  live.current = { s, listShown, setup: tour || whatsNew || face };
  const showRef = useRef<Showing | null>(null);
  showRef.current = show;
  const timers = useRef<{ seen: number; auto: number; learned: number }>({ seen: 0, auto: 0, learned: 0 });
  const quietFrom = useRef(0);   // the last moment a screen was open or a key typed: the list must then be calm again

  const clearTimers = () => { for (const k of ["seen", "auto", "learned"] as const) { window.clearTimeout(timers.current[k]); timers.current[k] = 0; } };
  const counted = useRef(false);   // it has been up long enough to count as seen
  const hide = (mark: boolean) => {
    const cur = showRef.current;
    clearTimers();
    if (cur && mark) save([cur.id]);
    else if (cur && !counted.current) shownHere.delete(cur.id);   // put away before it counted: it may come back another time
    counted.current = false;
    setTipOn(false);
    setShow(null);
  };

  // Keys: the last key press (the list stays quiet while someone types) and the swipe the lists chat reports.
  useEffect(() => {
    const k = () => { lastKeyAt = Date.now(); };
    window.addEventListener("keydown", k, { capture: true, passive: true });
    const swiped = (e: Event) => {
      const d = (e as CustomEvent).detail as { how?: unknown } | undefined;
      const cur = showRef.current;
      const silent = learnedBy(d ?? {}, cur?.id ?? null);
      if (silent.length) save(silent.filter((id) => !isSeen(cleanTipsSeen(settingsData(vaultStore.get()).tipsSeen), id)));
      if (cur?.id === "swipe" && !cur.learned && (d?.how === "swipe" || d?.how === "key")) {
        clearTimers();
        counted.current = true;
        sfx.done();
        setShow({ id: "swipe", learned: true });
        save(["swipe"]);
        timers.current.learned = window.setTimeout(() => hide(false), (import.meta.env.DEV && (window as unknown as { __tipsLearnedMs?: number }).__tipsLearnedMs) || TIPS.learnedMs);   // (dev server: __tipsLearnedMs holds the tick for a picture)
      }
    };
    window.addEventListener("ps-page-swiped", swiped);
    return () => { window.removeEventListener("keydown", k, true); window.removeEventListener("ps-page-swiped", swiped); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The dev server only, for pictures: window.__tipsShow("dots") puts that tip up at once (nothing is saved).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __tipsShow?: (id: TipId | null) => void }).__tipsShow = (id) => { clearTimers(); counted.current = true; setShow(id ? { id, learned: false } : null); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The one clock: look at the facts every second.
  useEffect(() => {
    let sinceShown = 0;
    const tick = () => {
      const { s: snap, listShown: shown, setup } = live.current;
      const now = Date.now();
      if (!shown) sinceShown = 0; else if (!sinceShown) sinceShown = now;
      const unlocked = snap.status === "unlocked";
      const st = unlocked ? settingsData(snap) : null;
      const cal = unlocked ? calendarSnap(snap) : null;
      const screen = screenNow(), typing = typingNow();
      if (screen || typing || setup) quietFrom.current = now;
      const facts: BlockFacts = {
        listShown: shown,
        pageVisible: document.visibilityState !== "hidden",
        shownForMs: sinceShown ? now - Math.max(sinceShown, quietFrom.current) : 0,
        sinceKeyMs: now - lastKeyAt,
        typing,
        screenOpen: screen,
        setupOpen: setup,
        inMeeting: !!st && afkMeetWindows(cal ? (cal.data as CalendarSnap).events : [], st.meetHidden, now).some(([a, b]) => now >= a && now < b),
        sleepMode: sleepState().here,
        sentry: sentryUp(),
        dnd: !!st && dndActive(st.dnd, now),
        protectedFront: !!frontApp && isProtectedApp(frontApp),
      };
      // The dev server only, for pictures and checks: window.__tipsOverride = { inMeeting: false } and so on, window.__tipsFacts is what was seen.
      if (import.meta.env.DEV) Object.assign(facts, (window as unknown as { __tipsOverride?: Partial<BlockFacts> }).__tipsOverride);
      const block = blocker(facts);
      if (import.meta.env.DEV) (window as unknown as { __tipsFacts?: unknown }).__tipsFacts = { block, ...facts };
      const cur = showRef.current;
      if (cur) { if (hidesShowing(block) || (st && !tipsOn(st.tipsShow))) hide(false); return; }
      if (!unlocked || !st) return;
      if (!tipsOn(st.tipsShow)) return;   // Settings, About and updates: "Show first use tips" Off (core/offswitches.ts)
      if (popupOn() || walkOn()) return;   // a "new in this version" pop-up or the walkthrough is up: never two at once
      // Tips seen here a moment ago count even before the save has come back.
      let seen: TipsSeen = cleanTipsSeen(st.tipsSeen);
      for (const id of shownHere) seen = markSeen(seen, id, shownAt || now);
      const targets: Partial<Record<TipId, boolean>> = {};
      const phone = phoneish();
      if (!block) for (const id of TIP_ORDER) if (!isSeen(seen, id)) targets[id] = !(phone && TIPS_NOT_ON_PHONE.includes(id)) && !!targetOf(id);
      const id = nextTip({
        seen, now, block, targets,
        synced: !!snap.lastSync || !!snap.local || snap.role === "owner",
        owner: snap.role === "owner",
        ownTasks: ownTaskCount(todos(snap).map((d) => d.data as { example?: boolean })),
        hasReminder: !!remindRec(snap)?.list?.some((r) => r.task),
      });
      if (!id) return;
      shownHere.add(id); shownAt = now;
      setTipOn(true);
      setShow({ id, learned: false });
      counted.current = false;
      timers.current.seen = window.setTimeout(() => { counted.current = true; save([id]); }, TIPS.seenAfterMs);
      timers.current.auto = window.setTimeout(() => hide(true), TIPS.autoMs);
    };
    const t = window.setInterval(tick, 1000);
    return () => { window.clearInterval(t); clearTimers(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!show) return null;
  return createPortal(<TipCard key={show.id} show={show} onOk={() => hide(true)} />, document.body);
}

// ---------- the card ----------
function TipCard({ show, onOk }: { show: Showing; onOk: () => void }) {
  const { id, learned } = show;
  const phone = useMemo(phoneish, []);
  const words = TIP_WORDS[id];
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placed | null>(null);
  const [ring, setRing] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const measure = () => {
    const c = box.current;
    if (!c) return;
    const t = id === "swipe" ? null : targetOf(id);
    const r = t?.getBoundingClientRect();
    const rect = r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    setRing(rect);
    setPlace(placeTip(rect, { w: c.offsetWidth, h: c.offsetHeight }, { w: innerWidth, h: innerHeight }, TIP_SIDES[id]));
  };
  useLayoutEffect(() => { measure(); }, [id, learned]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = window.setInterval(measure, 400);
    addEventListener("resize", measure);
    return () => { window.clearInterval(t); removeEventListener("resize", measure); };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const line = ((phone && TIP_PHONE[id]) || words.line).replace("{app}", appName());
  const side = place?.side ?? "bottom";
  return (
    <>
      {ring && id !== "swipe" && <i className="tp-ring" aria-hidden="true" style={{ left: ring.x - 5, top: ring.y - 5, width: ring.w + 10, height: ring.h + 10 }} />}
      <div ref={box} className={`tp-card no-drag tp-${id} side-${side}${learned ? " learned" : ""}${place ? " in" : ""}`} role="status" aria-live="polite"
        style={{ left: place?.x ?? 0, top: place?.y ?? 0, ["--arrow" as string]: `${place?.arrow ?? 0}px` }}
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}>
        {place?.arrow != null && <i className="tp-arrow" aria-hidden="true" />}
        <div className="tp-stage" aria-hidden="true">
          <Demo id={id} phone={phone} />
          <span className="tp-tick"><svg viewBox="0 0 24 24" width="30" height="30"><circle cx="12" cy="12" r="11" /><path d="M6.5 12.5l3.8 3.8 7.2-8" /></svg></span>
        </div>
        <div className="tp-title">{learned ? LEARNED : words.title}</div>
        {!learned && <div className="tp-line">{line}</div>}
        <div className="tp-row">
          <span className="tp-hint">{!learned && id === "swipe" && words.hint}</span>
          <button type="button" tabIndex={-1} className="tp-ok" onClick={onOk}>{TIP_BUTTON}</button>
        </div>
      </div>
    </>
  );
}

// ---------- the little pictures (all CSS, looping, still when motion is reduced) ----------
function Demo({ id, phone }: { id: TipId; phone: boolean }) {
  if (id === "swipe") {
    return (
      <div className={`tp-d tp-d-swipe${phone ? " one" : ""}`}>
        <div className="tp-pg a"><b /><b /><b /></div>
        <div className="tp-pg b"><b /><b /><b /></div>
        <span className="tp-f f1" />
        {!phone && <span className="tp-f f2" />}
      </div>
    );
  }
  if (id === "dots") {
    return (
      <div className="tp-d tp-d-dots">
        <div className="tp-pg a" /><div className="tp-pg b" />
        <div className="tp-dotrow"><i className="pill" />{[0, 1, 2, 3, 4].map((i) => <i key={i} className="d" />)}</div>
        <Cursor cls="tp-cur" />
      </div>
    );
  }
  if (id === "look") {
    return (
      <div className="tp-d tp-d-look">
        <div className="tp-pg a" /><div className="tp-pg b" />
        <div className="tp-menu">
          <span>Rename</span><span className="hi h1">Page background</span><span className="hi h2">Page look</span><span>Delete list</span>
        </div>
      </div>
    );
  }
  if (id === "edit") {
    return (
      <div className="tp-d tp-d-edit">
        <span className="tp-pill"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>Edit</span>
        <div className="tp-big"><b /><b /><b /></div>
        <div className="tp-grid"><i /><i /><i /><i className="plus">+</i></div>
      </div>
    );
  }
  return (
    <div className="tp-d tp-d-remind">
      <div className="tp-rowd"><span className="tick" /><span className="t">Call the dentist</span><span className="bell"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22a2.4 2.4 0 0 0 2.4-2.4h-4.8A2.4 2.4 0 0 0 12 22zm7-6.4V11a7 7 0 0 0-5.2-6.8V3.4a1.8 1.8 0 0 0-3.6 0v.8A7 7 0 0 0 5 11v4.6l-2 2V19h18v-1.4l-2-2z" /></svg></span></div>
      <div className="tp-menu small"><span>Edit</span><span className="hi h1">Add annoying reminder</span><span>Delete</span></div>
      <Cursor cls="tp-cur" />
    </div>
  );
}
function Cursor({ cls }: { cls: string }) {
  return <svg className={cls} width="16" height="18" viewBox="0 0 16 18" aria-hidden="true"><path d="M2 1.5l11 8.2-5 .8 2.9 5.4-2.3 1.2-2.9-5.5L2 15z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" /></svg>;
}

// ---------- Settings, About and updates ----------
/** The row's button: Show tips again. It says so for a moment, and the first tip comes when the list is calm. */
export function TipsAgainEntry() {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = window.setTimeout(() => setDone(false), 3500); return () => window.clearTimeout(t); }, [done]);
  return (
    <button type="button" className="wn-entry" onClick={() => { sfx.click(); showTipsAgain(); setDone(true); }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" /><path d="M9.8 19.5h4.4M10.6 22h2.8" />
      </svg>
      <span><b>{done ? "Done" : "Show tips again"}</b><em>{done ? "The tips will come back, one at a time" : "Bring the first use tips back"}</em></span>
    </button>
  );
}

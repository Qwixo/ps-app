// What's new (V1.36): the panel that pops up once after an update, on the Mac (the Tab list, PS) and on the
// website. "What's new in V1.36 · Keyword", up to 6 points, Got it. Esc or a click beside it also closes it.
// The rules (which words, once per version, never on a first install) are in core/whatsnew.ts.
// On the Mac it only ever shows while the Tab list is on screen: with the list hidden it waits for the next
// time the developer opens the list, so it never takes the keyboard or the screen from the app he is in. While it shows
// it asks PS for the keyboard the same way Settings does ("dimx": PS pins the list and never gives the list
// the keyboard over 1Password or Signal), so Esc and Enter come here.
// "What's new" in the gear menu (website) and in Settings > General (Mac) opens the same panel again.
// The developer's own account also gets his private notes for the version under the public ones, as "For you" (the developer, 7 Nov
// 2026). They are never in this build: they come from his vault (core/privatenotes.ts); everyone else has none.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { PS, psPost, useOverlayShown } from "../ps";
import { useVault } from "../ui/kit";
import { settingsData } from "../core/select";
import { accountOlderThan, cleanWhatsNew, deviceRan, LOCAL_KEY, seenToSave, whatsNewPlan, type WhatsNew } from "../core/whatsnew";
import { blocksFor, cleanBlocks, type NoteBlock } from "../core/notehistory";
import { NoteGroups } from "../ui/NoteGroups";
import { taskMapActions } from "./TaskMap";
import { openSettings, settingsWanted } from "./SettingsScreen";
import { sfx } from "../ui/sfx";
import "./whatsnew.css";
import { appName } from "../core/appname";
import { vaultStore } from "../core/vault";
import { PRIVATE_LABEL, privateNotesFor } from "../core/privatenotes";
import { useWelcomeShowing } from "./Welcome";
import { byLine, listable, madeOfBuild } from "../core/releaseby";
import { setWhatsNewShowing, useFaceShowing } from "../updateface";

const RAW = typeof __PS_WHATSNEW__ === "object" ? __PS_WHATSNEW__ : { version: "", keyword: "", notes: [], code: "", built: "", history: [] };
// V1.58: the multiple developers build file (vite.config.ts defines it when the build has one; older builds do not).
declare const __PS_BUILD__: unknown;
/** Who made the build this page runs ("V1.59 by Jan"): null for builds from before V1.58. */
const MADE = madeOfBuild(RAW, typeof __PS_BUILD__ !== "undefined" ? __PS_BUILD__ : null, /^V(\d+\.\d+)$/.exec(__PS_VERSION__.name)?.[1] || "");
/** This build's approved notes (null: none, so no panel and no menu entry). The version must be the one this
 *  build runs, so notes can never show under another version's name. */
let bundle: WhatsNew | null = (() => {
  const w = cleanWhatsNew(RAW);
  return w && __PS_VERSION__.name === `V${w.version}` ? { ...w, ...(MADE ? { by: MADE.by } : {}) } : null;
})();
const BUILT = RAW.built;
/** The approved notes of the earlier versions (V1.52), newest first: what a jump across several versions lists.
 *  V1.58: someone else's private release is never listed (it moved the number and brought nothing here); a private
 *  build lists its own maker's private ones. */
let history: NoteBlock[] = cleanBlocks((Array.isArray(RAW.history) ? RAW.history : []).filter((h) => listable(h, MADE && !MADE.shared ? MADE.by : "")));

/** The notes of every version newer than `since` (the one last handled) up to the one this page runs, newest
 *  first, approved ones only (a version without approved notes is simply not there). With no `since` only this
 *  version's own. With `back` (V1.53: this device ran PS before but kept no record of which version) the last
 *  `back` versions instead, or every one after `since` when that reaches further back. */
export function updateBlocks(since: string | null, back = 0): NoteBlock[] {
  const cur = runningVersion();
  if (!cur) return [];
  const all = [...(bundle ? [{ version: bundle.version, keyword: bundle.keyword, notes: bundle.notes, by: bundle.by }] : []), ...history];
  return blocksFor(all, { since, back }, cur);
}
const syncedNow = () => { const s = vaultStore.get(); return s.status === "unlocked" ? settingsData(s).whatsNewSeen : undefined; };
const deviceNow = () => { try { return deviceRan(localStorage); } catch { return undefined; } };
/** What this device should show for the version it runs now: the plan (core/whatsnew.ts) from this device's own
 *  record, the synced one and whether the device ran PS before. The account's data older than this build stands in only where the device left no marker. */
function planNow(hasNotes = true) {
  const s = vaultStore.get();
  const older = s.status === "unlocked" ? accountOlderThan(BUILT, [...s.docs.values()].map((d) => d.updatedAt)) : false;
  return whatsNewPlan({ version: runningVersion(), hasNotes, localSeen: readLocal(), syncedSeen: syncedNow(), accountOlder: older, deviceRan: deviceNow() });
}
/** The versions the update card's "Updated to" lists: the same ones the panel would (empty when there is nothing to
 *  catch up on, so the card shows this version's own lines). Read when the card appears. */
export function catchUpNow(): NoteBlock[] {
  const p = planNow();
  return p.step === "show" ? updateBlocks(p.since, p.back) : [];
}

// ---------- the open request (the menu entry) and the dev server's picture mode ----------
let manual = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const useManual = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => manual);
const useBundle = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => bundle);

/** The version this page runs ("1.39"). */
const runningVersion = () => bundle?.version ?? (/^V(\d+\.\d+)$/.exec(__PS_VERSION__.name)?.[1] || "");
/** The developer's private notes for the version this page runs, from his vault (none for anyone else). */
function privateNow(): string[] {
  const s = vaultStore.get();
  return s.status === "unlocked" ? privateNotesFor(s.docs.values(), runningVersion(), s.red) : [];
}
function usePrivate(): string[] {
  const s = useVault();
  const notes = s.status === "unlocked" ? privateNotesFor(s.docs.values(), runningVersion(), s.red) : [];
  const key = JSON.stringify(notes);
  const memo = useRef<{ key: string; notes: string[] }>({ key, notes });
  if (memo.current.key !== key) memo.current = { key, notes };
  return memo.current.notes;
}
/** What the panel shows: the approved public notes (if any) and the developer's private ones (if any). */
function shown(w: WhatsNew | null, mine: string[], earlier = false): WhatsNew | null {
  if (w) return w;
  const version = runningVersion();
  return (mine.length || earlier) && version ? { version, keyword: __PS_VERSION__.keyword || "", notes: [], ...(MADE ? { by: MADE.by } : {}) } : null;
}

/** True when this version has approved notes, or the developer has private ones (the menu entry shows only then). */
export function useWhatsNewReady() { const w = useBundle(); const mine = usePrivate(); return !!w || mine.length > 0; }

/** This build's approved notes (the update card's "Updated to" lists them). */
export const whatsNewBundle = () => bundle;

/** The update card said "Updated to" with these notes and the developer saw it: the panel for this version is handled too. */
export function whatsNewHandled() {
  const v = runningVersion();
  if (!v) return;
  const s = vaultStore.get();
  record(v, s.status === "unlocked" ? settingsData(s).whatsNewSeen : undefined);
  handled++; emit();
}
let handled = 0;
const useHandled = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => handled);

/** The menu entry: shows the panel for this version again. With Settings open (the Mac), Settings goes back
 *  into the gear first and the panel comes when it has gone (they never ask PS for the keyboard at once). */
export function openWhatsNew() {
  if (!bundle && !privateNow().length) return;
  if (!settingsWanted()) { manual++; emit(); return; }
  openSettings(null);
  const until = Date.now() + 3000;   // the morph takes about half a second; never wait forever
  const wait = () => {
    if (document.querySelector(".gs-layer") && Date.now() < until) { requestAnimationFrame(wait); return; }
    manual++; emit();
  };
  requestAnimationFrame(wait);
}

let demoSince: string | null = null;   // dev server only (?whatsnew=demo3)
let demoBack = 0;                      // dev server only (?whatsnew=demo8)
// The dev server only, for pictures: ?whatsnew=demo shows the panel with made up points (never in a build);
// ?whatsnew=auto only loads them, so the once-after-an-update rules decide (set localStorage ps.whatsNewSeen first).
const DEV_WN = import.meta.env.DEV ? new URLSearchParams(location.search).get("whatsnew") : null;
if (import.meta.env.DEV && (DEV_WN === "demo" || DEV_WN === "demo3" || DEV_WN === "demo8" || DEV_WN === "auto")) {
  void import("../dev/whatsnew-demo").then((m) => { bundle = cleanWhatsNew(m.DEMO_WHATSNEW); history = cleanBlocks(DEV_WN === "demo8" ? m.DEMO_LONG : m.DEMO_HISTORY); if (DEV_WN !== "auto") manual++; if (DEV_WN === "demo3") demoSince = m.DEMO_SINCE; if (DEV_WN === "demo8") demoBack = 5; emit(); });
}

const readLocal = () => { try { return localStorage.getItem(LOCAL_KEY); } catch { return null; } };
/** Handled: this device and the synced settings (never backwards) remember the version. */
function record(version: string, synced: string | null | undefined) {
  try { localStorage.setItem(LOCAL_KEY, version); } catch { /* private window: the synced record still counts */ }
  const save = seenToSave(version, synced);
  if (save) void taskMapActions.looks({ whatsNewSeen: save });
}

/** Mounted once: in PS's Tab list window (views/PsApp.tsx) and on the website's owner pages (App.tsx). */
export function WhatsNewHost() {
  const s = useVault();
  const pub = useBundle();
  const mine = usePrivate();
  const listShown = useOverlayShown();   // PS: the Tab list is on screen. The website: always true.
  const req = useManual();
  const [auto, setAuto] = useState(false);
  const [asked, setAsked] = useState(0);
  // V1.52: the version this device last handled when the automatic panel was decided: the panel lists every
  // version after it, up to this one (1.49 to 1.52 shows 1.50, 1.51 and 1.52).
  const [since, setSince] = useState<string | null>(null);
  // V1.53: a device that ran PS before but kept no record of its version lists the last few versions (`back`).
  const [back, setBack] = useState(0);
  const decided = useRef(false);
  // What the panel lists: after an update every version since the last one handled; from the menu entry this one.
  const blocks = useMemo(() => (auto ? updateBlocks(since, back) : updateBlocks(demoSince, demoBack)), [auto, since, back, pub]); // eslint-disable-line react-hooks/exhaustive-deps
  const w = shown(pub, mine, blocks.length > 0);
  const synced = s.status === "unlocked" ? settingsData(s).whatsNewSeen : undefined;
  // The update card showed this version's changes: the automatic panel is not needed any more.
  const h = useHandled();
  useEffect(() => { if (h) setAuto(false); }, [h]);

  // Once per page, after the vault is open and has synced (so the synced record is known), and not while a
  // sync is still running.
  useEffect(() => {
    if (decided.current || s.status !== "unlocked" || !s.lastSync || s.syncing) return;
    const t = window.setTimeout(() => {
      if (decided.current) return;
      decided.current = true;
      const cur = runningVersion();
      if (!cur) return;
      // V1.53: where this device came from. Its own record first; with none, a device that ran PS before lists the
      // last few versions; a brand new device lists nothing old (core/whatsnew.ts, whatsNewPlan).
      const first = planNow();
      const p = first.step === "show" && !updateBlocks(first.since, first.back).length && !privateNow().length ? { ...first, step: "record" as const } : first;
      if (p.step === "record") record(cur, synced);
      else if (p.step === "show") { setSince(p.since); setBack(p.back); setAuto(true); }
    }, 1200);
    return () => window.clearTimeout(t);
  }, [s.status, s.lastSync, s.status === "unlocked" && s.syncing]); // eslint-disable-line react-hooks/exhaustive-deps

  // The website: only while the tab is in front.
  const [front, setFront] = useState(() => PS || document.visibilityState === "visible");
  useEffect(() => {
    if (PS) return;
    const v = () => setFront(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", v);
    return () => document.removeEventListener("visibilitychange", v);
  }, []);

  const want = !!w && (auto || asked > 0);
  const tour = useWelcomeShowing();       // the welcome tour (views/Welcome.tsx) goes first; this waits for it
  const face = useFaceShowing();          // the update card's "Updated to" (views/UpdateFace.tsx) says it first
  const open = want && listShown && front && !tour && !face;
  useEffect(() => { setWhatsNewShowing(open); return () => setWhatsNewShowing(false); }, [open]);

  // Seen on another device before it got its turn here: it stays away.
  useEffect(() => { if (auto && !back && w && !open && seenToSave(w.version, synced) === null) setAuto(false); }, [auto, back, w, open, synced]);   // (not for a device with no record of its own: it never showed these itself)

  // A click on the menu entry.
  useEffect(() => { if (req) setAsked(req); }, [req]);
  // The list went away (PS hid it, the Mac locked): an automatic one waits for next time, a clicked one is done.
  useEffect(() => { if (!listShown && asked) setAsked(0); }, [listShown]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = () => {
    if (auto && w) record(w.version, synced);
    setAuto(false); setAsked(0);
  };
  if (!open || !w) return null;
  return <WhatsNewPanel w={w} mine={mine} fresh={auto} blocks={blocks} since={auto && !back ? since : auto ? null : demoSince} onDone={done} />;
}

function WhatsNewPanel({ w, mine, fresh, blocks, since, onDone }: { w: WhatsNew; mine: string[]; fresh: boolean; blocks: NoteBlock[]; since: string | null; onDone: () => void }) {
  // V1.52: more than one version to list (a jump such as 1.49 to 1.52): one block per version, newest open first.
  const many = blocks.length > 1;
  const cur = blocks[0]?.notes ?? w.notes;
  const t = blocks[0] ?? w;   // the one version the title names
  const [phase, setPhase] = useState<"in" | "out">("in");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => {
    if (phaseRef.current === "out") return;
    phaseRef.current = "out";
    sfx.drop();
    setPhase("out");
    const quick = matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(onDone, quick ? 0 : 240);
  };
  // PS: keep the list up and give it the keyboard while the panel is open (never over 1Password or Signal,
  // PS checks), and let go when it closes. A no-op on the website.
  useLayoutEffect(() => {
    psPost({ type: "dimx", open: true });
    return () => { psPost({ type: "dimx", open: false }); };
  }, []);
  // Esc closes the panel (and only the panel). PS's own Esc asks here first too.
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    const g = window as Window & { __psDimxClose?: () => boolean };
    const before = g.__psDimxClose;
    const esc = () => { close(); return true; };
    window.addEventListener("keydown", key, true);
    g.__psDimxClose = esc;
    btn.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", key, true);
      if (g.__psDimxClose === esc) { if (before) g.__psDimxClose = before; else delete g.__psDimxClose; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className={`wn-layer${phase === "out" ? " out" : ""}`} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="wn-dim" onMouseDown={(e) => { if (e.button === 0) close(); }} aria-hidden="true" />
      <section className="wn-card" role="dialog" aria-modal="true" aria-labelledby="wn-title">
        <div className="wn-glow" aria-hidden="true" />
        <header className="wn-head">
          <span className="wn-orb" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path className="wn-star" d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
              <path className="wn-spark" d="M19 15.5v4M17 17.5h4" />
            </svg>
          </span>
          <div className="wn-titles">
            <span className="wn-eyebrow">{fresh ? `${appName()} just updated${many ? ` · ${blocks.length} versions` : ""}` : "This version"}</span>
            {many && since
              ? <h2 id="wn-title" aria-label={`What's new since V${since}`}>What's new since <b>V{since}</b></h2>
              : many
              ? <h2 id="wn-title" aria-label={`What's new in V${blocks[blocks.length - 1].version} to V${t.version}`}>What's new in <b>V{blocks[blocks.length - 1].version}</b><i aria-hidden="true">to</i><b>V{t.version}</b></h2>
              : <h2 id="wn-title" aria-label={`What's new in V${t.version}${t.keyword ? ` ${t.keyword}` : ""}`}>
                  What's new in <b>V{t.version}</b>{t.keyword && <><i aria-hidden="true">·</i><em>{t.keyword}</em></>}
                </h2>}
            {!many && byLine(t.by) && <span className="wn-by">V{t.version} {byLine(t.by)}</span>}
          </div>
        </header>
        {many && <NoteGroups blocks={blocks} tall all className="wn-groups" />}
        {!many && !!cur.length && (
          <ul className="wn-list">
            {cur.map((n, i) => (
              <li key={i} style={{ "--i": i } as CSSProperties}><span className="wn-dot" aria-hidden="true" /><span className="wn-txt">{n}</span></li>
            ))}
          </ul>
        )}
        {!!mine.length && (
          <div className="wn-mine" style={{ "--i": cur.length } as CSSProperties}>
            <h3 className="wn-mine-h"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>{PRIVATE_LABEL}<em>Only you see these</em></h3>
            <ul className="wn-list">
              {mine.map((n, i) => (
                <li key={i} style={{ "--i": cur.length + 1 + i } as CSSProperties}><span className="wn-dot" aria-hidden="true" /><span className="wn-txt">{n}</span></li>
              ))}
            </ul>
          </div>
        )}
        <footer className="wn-foot" style={{ "--i": cur.length + (mine.length ? mine.length + 1 : 0) } as CSSProperties}>
          <button ref={btn} type="button" className="wn-btn" onClick={() => { sfx.click(); close(); }}>Got it</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

/** The menu entry, for the website's gear menu and the Mac's Settings > General. Hidden without notes. */
export function WhatsNewEntry({ onOpen, className }: { onOpen?: () => void; className?: string }) {
  const ready = useWhatsNewReady();
  if (!ready) return null;
  return (
    <button type="button" className={`wn-entry${className ? ` ${className}` : ""}`} onClick={() => { sfx.click(); onOpen?.(); openWhatsNew(); }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
      </svg>
      <span><b>What's new</b><em>The changes in {__PS_VERSION__.name}</em></span>
    </button>
  );
}

// The update card on the Tab list itself (V1.40, the developer: "whenever there's an update, make sure it comes up in the
// PS Tab overlay, like saying hey, update available, here's all the changes, update now, and do an animation when
// it updates ... I want it to be in your face"). The rules are in core/updateface.ts; the card itself is the gear
// menu's (views/MacUpdate.tsx MacUpdateCard: the version, the changes, Update now and Later, then Download, Verify,
// Install with the eased bar, then Relaunch to finish), so both always say the same. After the update it says
// "Updated to V1.xx" with the changes and a short finished animation, once. Mounted in views/PsApp.tsx.
// Only clicks reach the shell, the same ones as the gear menu (src/macupdate.ts).
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useOverlayShown } from "../ps";
import { macUpdate, useMacUpdate } from "../macupdate";
import { doneNotes, FACE_SEEN_AFTER, faceFor, faceKey } from "../core/updateface";
import { topClear, topIsland } from "../core/islandclear";
import { islandBox, onIsland } from "../ui/islandspot";
import { onRelayout, tucked } from "../ui/relayout";
import { MacUpdateCard } from "./MacUpdate";
import { useWelcomeShowing } from "./Welcome";
import { catchUpNow, whatsNewBundle, whatsNewHandled } from "./WhatsNew";
import { NoteGroups } from "../ui/NoteGroups";
import { useSettingsWanted } from "./SettingsScreen";
import { setFaceShowing, useIslandTurn } from "../updateface";
import { useVault } from "../ui/kit";
import { PRIVATE_LABEL, privateNotesFor } from "../core/privatenotes";
import { appName } from "../core/appname";
import { sfx } from "../ui/sfx";
import "./macupdate.css";
import "./updateface.css";

export function UpdateFace() {
  const u = useMacUpdate();
  const listShown = useOverlayShown();
  const tour = useWelcomeShowing();
  const settings = useSettingsWanted();
  // Later hides this update until the list goes away; the next Tab hold shows it again.
  const [later, setLater] = useState<string | null>(null);
  const [out, setOut] = useState(false);
  // V1.41 Esc always backs out (core/escape.ts): Esc puts the card away until the list goes, whatever it shows.
  const [away, setAway] = useState(false);
  const kind = faceFor(u, { later, blocked: tour || !!settings });
  const wantShow = listShown && !!kind && !away;
  // PS 1.60: one card at a time: the update card takes its turn in the page's island queue (core/islandqueue.ts).
  const turn = useIslandTurn("update-face", wantShow, "normal");
  const show = wantShow && turn;

  // A "done" or "stopped" card on screen long enough counts as seen when the list goes (or on Got it).
  const seenDue = useRef(false);
  useEffect(() => {
    if (!show || (kind !== "done" && kind !== "error")) return;
    const t = window.setTimeout(() => { seenDue.current = true; }, FACE_SEEN_AFTER);
    return () => window.clearTimeout(t);
  }, [show, kind]);
  useEffect(() => {
    if (listShown) return;
    setLater(null); setOut(false); setAway(false);
    if (seenDue.current) { seenDue.current = false; seen(); }
  }, [listShown]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Updated to" lists this version's changes, so the What's new panel waits for it (and is handled by it).
  useEffect(() => { setFaceShowing(show && kind === "done"); return () => setFaceShowing(false); }, [show, kind]);

  function seen() {
    if (u.state === "done") whatsNewHandled();
    macUpdate.seen();
  }
  const leave = (then: () => void) => {
    setOut(true);
    window.setTimeout(() => { then(); setOut(false); }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220);
  };

  // Esc: "Got it" on the done card, Close on a stopped one, Later on an offer; while it installs only the card goes.
  const escRef = useRef<() => void>(() => {});
  escRef.current = () => {
    sfx.drop();
    if (kind === "done" || kind === "error") leave(() => { seenDue.current = false; seen(); });
    else if (kind === "offer") { const k = faceKey(u); leave(() => setLater(k)); }
    else leave(() => setAway(true));
  };
  useEffect(() => {
    if (!show) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); escRef.current(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [show]);

  // V1.53 sweep (the developer: "nothing is over anything"): the card opens below the top bar (Keep overlay, Hover mode, the
  // slider, the top right buttons) and below the Dynamic Island, never on them; it glides down if the island opens.
  const layer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = layer.current;
    if (!show || !el) return;
    let placed = false;
    const place = () => {
      if (tucked()) return;
      const r = el.getBoundingClientRect();
      const min = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-top")) || 0;
      const pieces = [...document.querySelectorAll<HTMLElement>(".tm-overlay:not(.tm-docked) :is(.tm-keep:not(.isl-hide), .tm-glass:not(.isl-hide), .tm-tr > *, .tm-tr2 > *, .ed-corner)")]
        .map((n) => n.getBoundingClientRect()).map((b) => ({ left: b.left, top: b.top, right: b.right, bottom: b.bottom }));
      const top = topClear({ left: r.left, right: r.right }, [...pieces, topIsland(islandBox(), window.innerHeight)], min + 22);
      el.style.setProperty("--uf-top", `${top}px`);
      // The New tasks and Add task pop-ups open below this card while it is up (taskmap.css --tm-pop-top).
      document.documentElement.style.setProperty("--uf-bottom", `${Math.round(top + el.offsetHeight + 12)}px`);
      if (!placed) { placed = true; requestAnimationFrame(() => el.classList.add("placed")); }   // glides only after its first place
    };
    place();
    const offIsl = onIsland(place), offRe = onRelayout(place);
    const ro = new ResizeObserver(place);   // it grows while it installs (the steps and the bar)
    ro.observe(el);
    return () => { offIsl(); offRe(); ro.disconnect(); document.documentElement.style.removeProperty("--uf-bottom"); };
  }, [show, kind]);

  if (!show || !kind) return null;
  return createPortal(
    <div ref={layer} className={`uf-layer k-${kind}${out ? " out" : ""}`} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {kind === "done" ? <DoneCard current={u.current} keyword={u.currentKeyword} app={u.kind !== "web"} onOk={() => { sfx.click(); leave(() => { seenDue.current = false; seen(); }); }} />
        : <div className="uf-card">
            {(kind === "error") && (
              <button type="button" className="uf-x" aria-label="Close" onClick={() => { sfx.drop(); leave(() => { seenDue.current = false; seen(); }); }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            )}
            <MacUpdateCard u={u} onLater={() => { sfx.drop(); const k = faceKey(u); leave(() => setLater(k)); }} />
          </div>}
    </div>,
    document.body,
  );
}

/** "Updated to V1.xx · Keyword" with the changes, after the tick draws itself in a little burst. */
function DoneCard({ current, keyword, app, onOk }: { current?: string; keyword?: string; app: boolean; onOk: () => void }) {
  const s = useVault();
  // V1.52: after a jump across versions (1.49 to 1.52) it lists every version since the one last handled (V1.53: or, for a device that
  // kept no record, the last few). The record is read once, when the card appears (it moves on to this version when the card is closed).
  const [blocks] = useState(() => catchUpNow());
  const notes = doneNotes(current, whatsNewBundle());
  const mine = s.status === "unlocked" ? privateNotesFor(s.docs.values(), (current ?? "").replace(/^V/, ""), s.red) : [];
  return (
    <section className="uf-card uf-done" role="status" aria-live="polite">
      <div className="uf-head">
        <span className="uf-orb" aria-hidden="true">
          <i className="uf-ring" /><i className="uf-ring r2" />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <i key={i} className="uf-spark" style={{ "--a": `${i * 45}deg` } as CSSProperties} />)}
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path className="uf-tick" d="M5 12.5l4.2 4.2L19 7" pathLength={1} />
          </svg>
        </span>
        <div className="uf-titles">
          <span className="uf-eyebrow">{appName()} just updated</span>
          <h2>Updated to <b>{current}</b>{keyword && <><i aria-hidden="true">·</i><em>{keyword}</em></>}</h2>
          <span className="uf-sub">{app ? "You are still signed in." : "No restart needed."}</span>
        </div>
      </div>
      {blocks.length > 1 && <NoteGroups blocks={blocks} tall />}
      {blocks.length <= 1 && !!notes.length && (
        <ul className="uf-list">{notes.map((n, i) => <li key={i} style={{ "--i": i } as CSSProperties}>{n}</li>)}</ul>
      )}
      {!!mine.length && (
        <div className="mu-mine">
          <span className="mu-mine-h">{PRIVATE_LABEL}<em>Only you see these</em></span>
          <ul className="mu-notes">{mine.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
      <div className="mu-btns"><button type="button" className="mu-btn primary go" onClick={onOk}>Got it</button></div>
    </section>
  );
}

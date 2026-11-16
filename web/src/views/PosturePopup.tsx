// The Posture reminder's pop-up on the website (PS 1.65; the Mac draws its own card, Sources/Posture.swift, from the same
// picture in core/posturefigure.ts). The card is the Annoying 15 min reminder's look (views/remind.css). A stick figure
// slouches, then sits up straight, and one button appears: "Sitting straight". Esc closes it too. Never takes the keyboard:
// nothing is focused, so typing in another box carries on.
import { useEffect, useState, useSyncExternalStore } from "react";
import { sfx } from "../ui/sfx";
import { POSTURE_WORDS, POSTURE_ASK_WORDS } from "../core/posture";
import { FIGURE_CSS, FIGURE_SVG } from "../core/posturefigure";
import { postureAnswer, postureClose, postureView, startPostureWatch, subscribePosture } from "../posturewatch";
import { remLook, REM_BG, REM_ACCENT } from "../core/remind";
import type { CSSProperties } from "react";
import "./remind.css";
import "./posture.css";

/** The card itself (also used by Settings' preview). */
export function PostureCard({ live, onDone, ask, onAnswer }: { live?: boolean; onDone?: () => void; ask?: boolean; onAnswer?: (a: "off" | "keep") => void }) {
  // The button fades in after the figure's animation (3.5 s): until then it cannot be clicked either. Reduced motion: at once.
  const [ready, setReady] = useState(() => !live || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches));
  useEffect(() => { if (ready) return; const t = window.setTimeout(() => setReady(true), 3500); return () => window.clearTimeout(t); }, [ready]);
  const l = remLook(REM_BG, REM_ACCENT);
  const style = { "--rc-bg": REM_BG, "--rc-acc": REM_ACCENT, "--rc-ink": l.ink, "--rc-sub": l.sub, "--rc-lift": l.lift, "--rc-glow": `${l.glow}%`,
    "--rc-pill": l.pill, "--rc-btn": `${l.btn}%`, "--rc-on": l.on, "--rc-field": l.field, "--rc-ph": l.ph } as CSSProperties;
  return (
    <div className={`rm-card pf-card${live ? " live" : ""}`} style={style}>
      <style>{FIGURE_CSS}</style>
      <span className="rm-card-pill"><i />{POSTURE_WORDS.pill}</span>
      <h3>{POSTURE_WORDS.title}</h3>
      {/* the picture is our own constant string (core/posturefigure.ts), never anything typed or fetched */}
      <div className="pf-fig" dangerouslySetInnerHTML={{ __html: FIGURE_SVG }} />
      <button type="button" className={`pf-btn${ready ? " rdy" : ""}`} onClick={() => { sfx.click(); onDone?.(); }}>{POSTURE_WORDS.button}</button>
      {ask && (
        <div className={`pf-ask${ready ? " rdy" : ""}`}>
          <p>{POSTURE_ASK_WORDS.title}</p>
          <span>
            <button type="button" className="pf-q-off" onClick={() => { sfx.click(); onAnswer?.("off"); }}>{POSTURE_ASK_WORDS.off}</button>
            <button type="button" className="pf-q-keep" onClick={() => { sfx.click(); onAnswer?.("keep"); }}>{POSTURE_ASK_WORDS.keep}</button>
          </span>
        </div>
      )}
    </div>
  );
}

/** Mounted once in App.tsx (the website only): starts the watch and draws the pop-up when it is time. */
export function PosturePopupHost() {
  useEffect(() => { startPostureWatch(() => {}); }, []);
  const v = useSyncExternalStore(subscribePosture, postureView);
  useEffect(() => {
    if (!v.open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); postureClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [v.open, v.key]);
  if (!v.open) return null;
  return (
    <div className="rm-testcard pf-pop" role="dialog" aria-label={POSTURE_WORDS.tabTitle} key={v.key} style={{ cursor: "default" }}>
      <PostureCard live onDone={postureClose} ask={v.ask} onAnswer={postureAnswer} />
    </div>
  );
}

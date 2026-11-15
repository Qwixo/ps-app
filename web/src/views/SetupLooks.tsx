// The setup menu's last step, "Make PS yours" (V1.62, core/setuplooks.ts has the rules and the developer's words). Shown by views/Welcome.tsx
// right after Create. Two choices, each with its quick row and a More:
//  - Background colour: the colour tiles of Settings, Looks (LookBgColour); More opens the other backgrounds there (scenes,
//    lightning, videos: LookBackground) and Your own colour (LookOwnColour).
//  - Rain effect: the rain tiles (LookRain); More opens the other effects (the mouse trail, MouseTrailSettings).
// Every pick is the same setting Settings, Looks saves, saved and synced at once, so the list behind changes as you pick. A small
// live preview shows the background with the rain falling over it (still when reduced motion is on). Done stays off until a
// background that is not the blank one AND an effect are picked. Esc closes the setup as always (views/Welcome.tsx).
import { useState, type CSSProperties } from "react";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { settingsData } from "../core/select";
import { bgDesign } from "../core/prio";
import { colourBgCss } from "../core/bgcolour";
import { rainKind } from "../core/rain";
import { SETUP_LOOKS_WORDS, bgPicked, effectPicked, setupLooksDone } from "../core/setuplooks";
import { LookBackground, LookBgColour, LookOwnColour, LookRain, taskMapActions } from "./TaskMap";
import { MouseTrailSettings } from "./MouseTrail";
import { shownBg } from "./BgFit";
import type { Preview } from "./SettingsScreen";
import "../looks/peek.css";

const W = SETUP_LOOKS_WORDS;
const save = (patch: Parameters<typeof taskMapActions.looks>[0]) => void taskMapActions.looks(patch);
/** A tile's Preview here: the list behind shows it for 2 seconds, then goes back. */
const preview: Preview = (_label, set, clear) => { set(); window.setTimeout(clear, 2000); };

/** The page of the step (its Done button is SetupLooksDoneButton, in the menu's footer). */
export function SetupLooks() {
  const v = useVault();
  const st = settingsData(v);
  const bg = shownBg(st);
  const [moreBg, setMoreBg] = useState(false);
  const [moreFx, setMoreFx] = useState(false);
  return (
    <div className="wt-looks">
      <h2 id="wt-title" className="wt-h">{W.title}</h2>
      <p className="wt-body">{W.line}</p>
      <LooksPreview bg={bgDesign(bg)} rain={rainKind(st.tmRain)} />
      <section className={`wt-lk-part${bgPicked(bg) ? " met" : ""}`} aria-label={W.bg}>
        <h3 className="wt-lk-h">{W.bg}<Tick on={bgPicked(bg)} /></h3>
        <div className="gs-looks ms-win"><LookBgColour st={st} preview={preview} /></div>
        <button type="button" className="wt-btn ghost sm wt-lk-more" aria-expanded={moreBg} onClick={() => { sfx.click(); setMoreBg((x) => !x); }}>{W.more}</button>
        {moreBg && <div className="gs-looks ms-win wt-lk-extra"><LookBackground st={st} preview={preview} /><LookOwnColour st={st} preview={preview} /></div>}
      </section>
      <section className={`wt-lk-part${effectPicked(st) ? " met" : ""}`} aria-label={W.fx}>
        <h3 className="wt-lk-h">{W.fx}<Tick on={effectPicked(st)} /></h3>
        <div className="gs-looks ms-win"><LookRain st={st} preview={preview} /></div>
        <button type="button" className="wt-btn ghost sm wt-lk-more" aria-expanded={moreFx} onClick={() => { sfx.click(); setMoreFx((x) => !x); }}>{W.more}</button>
        {moreFx && <div className="gs-looks ms-win wt-lk-extra"><MouseTrailSettings st={st} set={save} /></div>}
      </section>
    </div>
  );
}

/** The Done button for the footer: off until both are picked. */
export function SetupLooksDoneButton({ onDone }: { onDone: () => void }) {
  const v = useVault();
  const st = settingsData(v);
  const ready = setupLooksDone({ bg: shownBg(st), st });
  return <button type="button" className="wt-btn go" disabled={!ready} aria-disabled={!ready} onClick={() => { if (!ready) return; sfx.done(); onDone(); }}>{W.done}</button>;
}

function Tick({ on }: { on: boolean }) {
  return on ? <svg className="wt-lk-tick" viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="m5 10.5 3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg> : null;
}

/** The live preview: the picked background behind a tiny list, with the picked rain falling over it. */
function LooksPreview({ bg, rain }: { bg: string; rain: string }) {
  const css = colourBgCss(bg);
  const scene = bg !== "none" && !css && !bg.startsWith("video:");
  return (
    <div className={`wt-lk-prev${bg === "none" ? " blank" : ""}`} style={css ? ({ "--lk-bg": css } as CSSProperties) : undefined} aria-hidden="true">
      {scene && <span className={`tm-p1-scene p1s-${bg}`}><i /></span>}
      {bg.startsWith("video:") && <span className="wt-lk-video" />}
      <span className="wt-lk-list"><i /><i /><i /></span>
      {rain !== "off" && <span className={`ms-rain-sample rs-${rain} wt-lk-rain`}><i /></span>}
    </div>
  );
}

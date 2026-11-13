// The small Fitness screen on the setup menu's Fitness cards (V1.40, the developer 7 Nov 2026: "when it reaches Fitness, people
// choose their own settings there"). Drawn with Fitness's own tokens (fitness.css, .fit[data-fit-style][data-fit-theme]),
// so it looks like the real thing in the look this Mac uses. It shows the choice being made: the rest timer counting
// down from the rest picked, the number of sets picked (and that a set you skip stays out of your log), and light or
// dark. Nothing here is saved; Create does that (core/welcome.ts tourPlan). Words: core/welcome.ts FIT_PEEK_WORDS.
import { useEffect, useState, type CSSProperties } from "react";
import { FIT_PEEK_WORDS as W, type FitPeekKind } from "../core/welcome";
import "./fitpeek.css";

export interface FitPeekProps {
  kind: FitPeekKind;
  rest: number;          // seconds, big lifts
  restSmall: number;     // seconds, small lifts
  sets: number;
  theme: "light" | "dark";
  style: string;         // volt, chalk or pulse
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const still = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts down from `total` once a second, starting again when the choice changes (still when motion is reduced). */
function useCountdown(total: number) {
  const [left, setLeft] = useState(total);
  useEffect(() => {
    setLeft(total);
    if (still()) return;
    const t = window.setInterval(() => setLeft((x) => (x <= 1 ? total : x - 1)), 1000);
    return () => window.clearInterval(t);
  }, [total]);
  return left;
}

export function FitPeek({ kind, rest, restSmall, sets, theme, style }: FitPeekProps) {
  const small = kind === "restSmall";
  const total = small ? restSmall : rest;
  const left = useCountdown(total);
  const n = Math.max(1, Math.min(12, Math.round(sets) || 3));
  const showSkip = kind === "sets";
  const done = showSkip ? Math.min(n, n >= 3 ? 2 : 1) : Math.min(1, n);
  const rows = Array.from({ length: Math.min(n, 6) }, (_, i) => i);   // at most 6 rows drawn; "Set 2 of 12" says the rest
  const frac = total ? left / total : 0;
  return (
    <div className="wfp-frame" aria-hidden="true">
      <div key={theme} className="fit wfp" data-fit-style={style} data-fit-theme={theme}>
        <div className="wfp-top">
          <span className={`wfp-ex${kind === "style" ? " hl" : ""}`}>{small ? W.small : W.big}</span>
          <span className={`wfp-mode${kind === "theme" ? " hl" : ""}`}>
            {theme === "light" ? <Sun /> : <Moon />}<span>{theme === "light" ? W.light : W.dark}</span>
          </span>
        </div>
        <div className={`wfp-setof${kind === "sets" ? " hl" : ""}`}>
          {W.set.replace("{n}", String(Math.min(done + 1, n))).replace("{of}", String(n))}
        </div>
        <ol className={`wfp-sets${n >= 5 ? " n5" : ""}`}>
          {rows.map((i) => (
            <li key={`${n}-${i}`} className={i < done ? "done" : i === done ? "cur" : showSkip ? "skip" : ""} style={{ "--i": i } as CSSProperties}>
              <b className="f-num">{small ? "12.5" : "60"}</b><small>{W.kg}</small>
              <span className="x">x</span>
              <b className="f-num">{small ? 12 : 8}</b><small>{W.reps}</small>
              <i className="tick">{i < done ? <Tick /> : null}</i>
            </li>
          ))}
        </ol>
        {showSkip
          ? (
            <div className="wfp-skip">
              <span className="wfp-next"><Tick /><span>{W.finish}</span></span>
              <p>{W.skipped.replace("{n}", String(done)).replace("{of}", String(n))}</p>
            </div>
          )
          : (
            <div className={`wfp-rest${kind === "rest" || kind === "restSmall" ? " hl" : ""}`}>
              <svg viewBox="0 0 44 44" className="wfp-ring">
                <circle cx="22" cy="22" r="19" className="bg" />
                <circle cx="22" cy="22" r="19" className="fg" pathLength={100} style={{ strokeDashoffset: 100 - frac * 100 }} />
              </svg>
              <span className="wfp-rest-t"><small>{W.rest}</small><b key={total} className="f-num">{clock(left)}</b></span>
            </div>
          )}
      </div>
    </div>
  );
}

const S = { fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const Sun = () => <svg viewBox="0 0 24 24" width="14" height="14" {...S}><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" /></svg>;
const Moon = () => <svg viewBox="0 0 24 24" width="14" height="14" {...S}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></svg>;
const Tick = () => <svg viewBox="0 0 20 20" width="12" height="12" {...S} strokeWidth={2.6}><path d="m5 10.5 3.2 3.2L15 7" /></svg>;

// PS Fitness minimised (V1.29): a small floating bubble with the live rest timer and set progress. A tap brings the
// big pop up back (it grows out of the bubble). Phone: above the thumb row. Mac: a corner of the Tab list.
// The ring drains with the rest (one CSS animation, a negative delay starts it part way), so nothing re-renders
// more than once a second, and only transform and opacity move the bubble itself.
import { forwardRef, useMemo, type CSSProperties } from "react";
import { useLookActive } from "../looks/engine";
import { useFitness } from "./store";
import { useRest, useRestLeft } from "./rest";
import { progress } from "./gym-logic";
import { fmtClock } from "../core/fitness";
import { useFitTheme } from "./theme";
import { DumbbellIcon } from "./FitnessApp";

const R = 21, C = 2 * Math.PI * R;

export const FitMini = forwardRef<HTMLButtonElement, { onOpen: (el: HTMLElement) => void; className?: string; hidden?: boolean }>(function FitMini({ onOpen, className, hidden }, ref) {
  const v = useFitness();
  const r = useRest();
  const left = useRestLeft(r);
  const style = v.prefs.style || (() => { try { return localStorage.getItem("fit.style") || "volt"; } catch { return "volt"; } })();
  const lookOn = useLookActive();   // a PS look dresses Fitness too (see FitnessApp)
  const ownTheme = useFitTheme(style);
  const theme = lookOn ? "dark" : ownTheme;
  const w = v.open?.data ?? null;
  const p = w ? progress(w) : { done: 0, total: 0 };
  const resting = !!r && !r.over && !!w;
  const ring = useMemo(() => {
    if (!r || r.over) return null;
    const total = Math.max(1000, r.total * 1000), gone = Math.max(0, total - Math.max(0, r.endsAt - Date.now()));
    return { animationDuration: `${total}ms`, animationDelay: `${-gone}ms` } as CSSProperties;
  }, [r?.endsAt, r?.total, r?.over]); // eslint-disable-line react-hooks/exhaustive-deps
  const frac = p.total ? p.done / p.total : 0;
  const big = resting ? fmtClock(left) : r?.over && w ? "Next" : w ? `${p.done}/${p.total}` : "Gym";
  const small = resting ? `Rest · set ${r!.set}${r!.of ? ` of ${r!.of}` : ""}` : r?.over && w ? "Rest over: next set" : w ? `${p.done} of ${p.total} sets` : "Tap to open";
  return (
    <button ref={ref} type="button" className={`fit fit-mini${resting ? " resting" : ""}${r?.over && w ? " over" : ""}${className ? ` ${className}` : ""}`}
      data-fit-style={lookOn ? "volt" : style} data-fit-theme={theme} aria-hidden={hidden || undefined} tabIndex={hidden ? -1 : undefined}
      onClick={(e) => onOpen(e.currentTarget)} onMouseDown={(e) => e.stopPropagation()}
      aria-label={`Fitness, ${small}${resting ? `, ${fmtClock(left)} left` : ""}. Tap to open`}>
      <span className="fit-mini-ring" aria-hidden="true">
        <svg viewBox="0 0 50 50" width="50" height="50">
          <circle className="bg" cx="25" cy="25" r={R} />
          {resting
            ? <circle key={`${r!.endsAt}:${r!.total}`} className="rest" cx="25" cy="25" r={R} style={{ strokeDasharray: C, ...ring }} />
            : <circle className="prog" cx="25" cy="25" r={R} style={{ strokeDasharray: C, strokeDashoffset: C * (1 - frac) }} />}
        </svg>
        <DumbbellIcon size={20} />
      </span>
      <span className="fit-mini-t">
        <b className="f-num">{big}</b>
        <small>{small}</small>
      </span>
    </button>
  );
});

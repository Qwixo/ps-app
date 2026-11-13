// A rest time you can type (V1.47, the developer: "make it so I can select whatever time I want, not just up or down by 15 s.
// It can work like the other parts where when you click on the number it is customisable."). The big number is a
// button: a tap turns it into a text box with the time selected; type 1:45, 105, 105 s, 2m or 1 min 30, then Enter or
// tap away saves (5 s to 15 min, core/fitness.ts parseRest), Esc puts the old time back. Something it cannot read
// shakes and keeps the old time. On a Mac, the scroll wheel over the number moves it by 15 s. The -15 and +15
// buttons around it stay as they were.
import { useEffect, useRef, useState, type ReactNode, type WheelEvent } from "react";
import { clampRest, fmtClock, parseRest, REST_STEP } from "../core/fitness";
import { haptic } from "../gos/bridge";
import "./restnum.css";

export function RestNum({ value, onSave, label, className, children }: {
  value: number; onSave: (secs: number) => void; label: string; className?: string; children?: ReactNode;
}) {
  const [text, setText] = useState<string | null>(null);
  const [bad, setBad] = useState(0);
  const skip = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const wheelAt = useRef(0);
  // The old time is selected the moment the box opens, so whatever is typed replaces it.
  useEffect(() => { if (text != null) { const el = input.current; if (el && document.activeElement !== el) el.focus(); el?.select(); } }, [text != null]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    if (skip.current) { skip.current = false; setText(null); return; }
    if (text == null) return;
    const n = parseRest(text);
    if (n == null) { haptic("reject"); setBad((b) => b + 1); setText(null); return; }
    setText(null);
    if (n !== value) { haptic("tick"); onSave(n); }
  };
  const wheel = (e: WheelEvent<HTMLElement>) => {
    if (text != null || Math.abs(e.deltaY) < 4) return;
    const now = Date.now();
    if (now - wheelAt.current < 120) return;   // one step per flick, not one per wheel event
    wheelAt.current = now;
    const n = clampRest(value + (e.deltaY < 0 ? REST_STEP : -REST_STEP));
    if (n !== value) { haptic("tick"); onSave(n); }
  };

  if (text != null) return (
    <span className={`rn rn-edit${className ? ` ${className}` : ""}`}>
      <input ref={input} className="rn-in f-num" type="text" inputMode="text" enterKeyHint="done" autoComplete="off" spellCheck={false}
        autoFocus aria-label={`${label}, type a time like 1:45`} value={text} placeholder="1:45"
        onFocus={(e) => e.currentTarget.select()} onChange={(e) => setText(e.currentTarget.value)} onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); skip.current = true; e.currentTarget.blur(); }
        }} />
      <small className="rn-hint">Type a time, like 1:45 or 90 s</small>
    </span>
  );
  return (
    <button type="button" key={bad} className={`rn rn-btn${bad ? " rn-bad" : ""}${className ? ` ${className}` : ""}`}
      onClick={() => { haptic("press"); setText(fmtClock(value)); }} onWheel={wheel}
      aria-label={`${label}: ${fmtClock(value)}. Tap to type your own time`} data-tip="Tap to type any time" data-tip-line="5 s to 15 min, like 1:45">
      <b className="f-num">{fmtClock(value)}</b>
      {children}
    </button>
  );
}

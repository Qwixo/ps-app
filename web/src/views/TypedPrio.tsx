// Typed priority in the add boxes (V1.40, rules in core/typedprio.ts). PrioInput is an ordinary text input with two
// extras drawn over it: the priority word painted in its colour (P1 in the Priority 1 colour from Settings), and a
// small "Suggested: P1" chip at the right end with an x to say no. Backspace right after the word says no too.
// Settings, To do list, "Typed priority" turns it all off (settings.tmTypedPrio, default on).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { Settings } from "../core/model";
import { p1Color, p1Tones } from "../core/prio";
import { settingsData } from "../core/select";
import { backspaceDismisses, prioDismiss, prioOnAdd, prioPicked, prioStartFor, prioTyped, type PrioState, type TypedPrio } from "../core/typedprio";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import "./typedprio.css";

/** On unless switched off in Settings. */
export const typedPrioOn = (s: Pick<Settings, "tmTypedPrio"> | null | undefined) => s?.tmTypedPrio !== false;

export type TypedPrioCtl = {
  /** What to show now (null: nothing typed, said no, or switched off). */
  offer: TypedPrio | null;
  /** At Add: the typed priority and the cleaned title, or null (use the text and the controls as they are). */
  take: (text: string) => TypedPrio | null;
  /** A priority was picked by clicking (it wins over a word typed before it). */
  picked: () => void;
  /** No thanks. */
  dismiss: () => void;
  /** After Add: start fresh. */
  reset: () => void;
  /** Backspace at this caret means no thanks (right after the word, nothing selected). */
  backspace: (text: string, caret: number | null, selEnd: number | null) => boolean;
  on: boolean;
  /** The Priority 1 colour picked in Settings, for the paint. */
  p1: string | null;
};

/** One add box's typed priority, following its text. `existing`: a name being edited (a priority word already in it is
 *  not offered until another one is typed). `allowed` false (an Every day task, which has no priority):
 *  nothing is offered or taken. */
export function useTypedPrio(text: string, allowed = true, existing = ""): TypedPrioCtl {
  const st = settingsData(useVault());
  const on = typedPrioOn(st) && allowed;
  const saved = p1Color(st.p1Color);
  const ref = useRef<PrioState>(null as unknown as PrioState);
  if (!ref.current) ref.current = prioStartFor(existing);
  const [, redraw] = useState(0);
  // Follows the text during render: the same text twice changes nothing, so this is safe to run again.
  ref.current = prioTyped(ref.current, text);
  // Shown only while Add would use it: a priority clicked after the word was typed puts the chip away.
  const offer = on ? prioOnAdd(ref.current, text) : null;
  const picked = useCallback(() => { ref.current = prioPicked(ref.current); redraw((n) => n + 1); }, []);
  const dismiss = useCallback(() => { ref.current = prioDismiss(ref.current); redraw((n) => n + 1); }, []);
  const reset = useCallback(() => { ref.current = prioStartFor(""); redraw((n) => n + 1); }, []);
  const take = useCallback((t: string) => (on ? prioOnAdd(prioTyped(ref.current, t), t) : null), [on]);
  const backspace = useCallback((t: string, caret: number | null, selEnd: number | null) => on && backspaceDismisses(ref.current, t, caret, selEnd), [on]);
  return { offer, take, picked, dismiss, reset, backspace, on, p1: saved ? p1Tones(saved).accent : null };
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { prio: TypedPrioCtl; wrapClass?: string; compact?: boolean };

/** Where each priority word sits on screen, measured with the input's own font. */
type Mark = { left: number; width: number; win: boolean; prio: number };
let canvas: HTMLCanvasElement | null = null;
function measure(el: HTMLInputElement, text: string, offer: TypedPrio): { marks: Mark[]; padL: number; padR: number } {
  const cs = getComputedStyle(el);
  const ctx = (canvas ??= document.createElement("canvas")).getContext("2d");
  const ls = parseFloat(cs.letterSpacing) || 0;
  const w = (s: string) => {
    if (!ctx) return s.length * (parseFloat(cs.fontSize) || 16) * 0.55;
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return ctx.measureText(s).width + ls * s.length;
  };
  const padL = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
  const padR = (parseFloat(cs.borderRightWidth) || 0) + (parseFloat(cs.paddingRight) || 0);
  const marks = offer.tokens.map((t) => ({ left: w(text.slice(0, t.start)) - el.scrollLeft, width: w(t.raw), win: t === offer.token, prio: t.prio }));
  return { marks, padL, padR };
}

/** A text input that spots P1, P2 and P3 as they are typed. Everything else is a plain input; the ref is the input. */
export const PrioInput = forwardRef<HTMLInputElement, InputProps>(function PrioInput({ prio, wrapClass, compact, onKeyDown, onScroll, ...rest }, fwd) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(fwd, () => input.current!, []);
  const chipRef = useRef<HTMLSpanElement>(null);
  const text = String(rest.value ?? "");
  const offer = prio.offer;
  const [box, setBox] = useState<{ marks: Mark[]; padL: number; padR: number } | null>(null);
  // The chip stays a moment after it goes, to fade out.
  const last = useRef(0);
  const [leaving, setLeaving] = useState<number | null>(null);
  if (offer) last.current = offer.prio;
  useEffect(() => {
    if (offer) { setLeaving(null); return; }
    if (!last.current) return;
    setLeaving(last.current);
    const t = window.setTimeout(() => setLeaving(null), 200);
    return () => window.clearTimeout(t);
  }, [!!offer]); // eslint-disable-line react-hooks/exhaustive-deps
  const chip = offer ? { prio: offer.prio, leaving: false } : leaving ? { prio: leaving, leaving: true } : null;

  // Room for the chip at the right end, so the caret never hides under it.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.paddingRight = "";
    if (offer && chipRef.current) {
      const base = parseFloat(getComputedStyle(el).paddingRight) || 0;
      el.style.paddingRight = `${base + chipRef.current.offsetWidth + 8}px`;
    }
  }, [offer?.prio]); // eslint-disable-line react-hooks/exhaustive-deps

  const remeasure = useCallback(() => {
    const el = input.current;
    setBox(el && offer ? measure(el, text, offer) : null);
  }, [text, offer]);
  useLayoutEffect(remeasure, [remeasure, !!offer]);
  useEffect(() => {
    const el = input.current;
    if (!el || !offer || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => remeasure());
    ro.observe(el);
    // The caret moving can scroll a long title sideways without a scroll event in every browser.
    const sel = () => requestAnimationFrame(remeasure);
    el.addEventListener("keyup", sel); el.addEventListener("click", sel);
    return () => { ro.disconnect(); el.removeEventListener("keyup", sel); el.removeEventListener("click", sel); };
  }, [remeasure, !!offer]); // eslint-disable-line react-hooks/exhaustive-deps

  const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    if (e.key === "Backspace" && !e.metaKey && !e.ctrlKey && !e.altKey && offer && prio.backspace(text, el.selectionStart, el.selectionEnd)) {
      e.preventDefault();
      prio.dismiss();
      sfx.hover();
      return;
    }
    onKeyDown?.(e);
  };
  const style = { ...(prio.p1 ? { ["--tp-p1" as string]: prio.p1 } : {}) };
  return (
    <span className={`tp-wrap${wrapClass ? ` ${wrapClass}` : ""}${compact ? " tp-compact" : ""}${offer ? " has-offer" : ""}`} style={style}>
      <input ref={input} {...rest} onKeyDown={keys} onScroll={(e) => { remeasure(); onScroll?.(e); }} />
      {offer && box && (
        <span className="tp-hl" aria-hidden="true" style={{ left: box.padL, right: box.padR }}>
          {box.marks.map((m, i) => (
            <i key={i} className={`tp-mark tp-p${m.prio}${m.win ? "" : " lose"}`} style={{ transform: `translate(${m.left}px, -50%)`, width: m.width }} />
          ))}
        </span>
      )}
      {chip && (
        <span ref={chipRef} className={`tp-chip tp-p${chip.prio}${chip.leaving ? " leaving" : ""}`} role="status" aria-live="polite">
          <span className="tp-chip-l">Suggested:</span><b>P{chip.prio}</b>
          <button type="button" className="tp-chip-x" tabIndex={-1} aria-label={`Not a priority, keep P${chip.prio} as text`} title={compact ? `Suggested: P${chip.prio}. Click to keep it as text` : "Keep it as text"}
            onMouseDown={(e) => e.preventDefault()} onClick={() => { prio.dismiss(); sfx.hover(); input.current?.focus({ preventScroll: true }); }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </span>
      )}
    </span>
  );
});

/** Settings, To do list: the switch. */
export function TypedPrioSwitch({ save }: { save: (p: Partial<Settings>) => void }) {
  const on = typedPrioOn(settingsData(useVault()));
  return (
    <div className="tm-ed-seg" role="radiogroup" aria-label="Typed priority">
      <button type="button" role="radio" aria-checked={on} className={`dwell${on ? " on" : ""}`} onClick={() => { if (!on) { sfx.hover(); save({ tmTypedPrio: true }); } }}>On</button>
      <button type="button" role="radio" aria-checked={!on} className={`dwell${!on ? " on" : ""}`} onClick={() => { if (on) { sfx.hover(); save({ tmTypedPrio: false }); } }}>Off</button>
    </div>
  );
}

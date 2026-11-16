// Sleep mode's clock face (V1.42, rules in core/sleepmode.ts): the clock, "Asleep for", the alarm line, the date,
// the stopwatch and the wake time panel, drawn the way the person set them in Customise. The web sleep screen
// (views/SleepMode.tsx) and Customise's live preview (views/SleepCustomise.tsx) both draw this, so the preview is
// exactly what the screen shows. The Mac and the phone draw the same look natively from the plan's `look`.
// The developer, 8 Nov 2026: "make it so you can actually edit the sleep mode, so you can customise the clock, make the font
// bigger, smaller, whatever. I also want a stopwatch ... And I want your mouse to disappear on screen when you
// leave it alone, and it comes back when you move your mouse again."
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { asleepFor, clockText, dialMarks, drift, handAngles, watchMs, watchPause, watchReset, watchStart, watchText, WATCH_ZERO,
  type PlanLook, type SleepPlan, type Stopwatch } from "../core/sleepmode";
import { countdownLine } from "../core/sleepwake";
import { sfx } from "../ui/sfx";

const hm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

// ---------- the stopwatch: one per page, kept as times so it stays right while the screen dims ----------
const WATCH_KEY = "ps.sleep.watch";
let watch: Stopwatch = (() => {
  try { const v = JSON.parse(sessionStorage.getItem(WATCH_KEY) || "null"); if (v && typeof v.acc === "number") return { run: !!v.run, from: typeof v.from === "number" ? v.from : null, acc: v.acc }; } catch { /* none */ }
  return { ...WATCH_ZERO };
})();
const watchSubs = new Set<() => void>();
function setWatch(w: Stopwatch) {
  watch = w;
  try { sessionStorage.setItem(WATCH_KEY, JSON.stringify(w)); } catch { /* private window: kept in memory only */ }
  watchSubs.forEach((f) => f());
}
export function useWatch(): Stopwatch {
  return useSyncExternalStore((f) => { watchSubs.add(f); return () => { watchSubs.delete(f); }; }, () => watch);
}
export const watchActions = {
  toggle: () => { const now = Date.now(); setWatch(watch.run ? watchPause(watch, now) : watchStart(watch, now)); },
  reset: () => setWatch(watchReset()),
};

const rgbOf = (hex: string) => { const n = parseInt(/^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex.slice(1) : "e7a35e", 16); return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`; };
/** The look as CSS variables on the screen (or the preview): colours, brightness, background, size, font weight and
 *  letter spacing (V1.43: the other words have their own colour). */
export function faceStyle(l: PlanLook, clockChars: number, room: { clock: number; dial: number } = { clock: 94, dial: 92 }): CSSProperties {
  // The biggest clock that still fits across: each digit is about 0.6 of the font size wide (wider with spacing). PS 1.65: `room` is
  // the share of the width it may use (less on the Mac's preview, where the AI Sentry mode button keeps its room at both edges).
  const fit = Math.max(8, Math.floor(room.clock / (Math.max(4, clockChars) * (0.6 + Math.max(0, (l.spacing ?? 0) / 100)))));
  return {
    "--slp-dial-room": `${room.dial}cqw`,
    "--slp-rgb": rgbOf(l.ink), "--slp-trgb": rgbOf(l.text ?? l.ink), "--slp-bright": String(l.bright), "--slp-night": l.bg, "--slp-size": String(l.size / 100), "--slp-fit": `${fit}cqw`,
    ...(l.weight ? { "--slp-w": String(l.weight) } : {}), "--slp-ls": `${(l.spacing ?? 0) / 100}em`,
    "--slp-face": rgbOf(l.faceInk ?? l.ink), "--slp-hand": rgbOf(l.handInk ?? l.ink), "--slp-tick": rgbOf(l.tickInk ?? l.ink),
  } as CSSProperties;
}

/** The face. `now` comes from the screen's own one second tick; `peek` lifts the panel for a moment after a tap. */
export function SleepFace({ plan, look, since, now, ringing, peek, preview }: {
  plan: SleepPlan; look: PlanLook; since: number; now: number; ringing: boolean; peek: boolean; preview?: boolean;
}) {
  const w = useWatch();
  const c = clockText(now, look);
  const d = drift(now);
  const sh = look.show;
  const panelUp = sh.panel && (ringing || peek || preview || (plan.panel != null && now >= plan.panel));
  const date = new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  const watchOn = look.watch !== "off";
  const next = plan.rings.find((r) => r.at > now);   // V1.43: the countdown to the next alarm or "Wake me up in"
  return (
    <>
      <div className={`slp-face pos-${look.pos} slp-f-${look.font}`} style={{ transform: preview ? undefined : `translate(${d.x}px, ${d.y}px)` }}>
        {look.face === "analogue"
          ? <>
              <Dial look={look} now={now} ringing={ringing} />
              {look.digi && <div className="slp-digi num">{c.time}{c.ampm && <span className="slp-ampm">{c.ampm}</span>}</div>}
            </>
          : <div className="slp-clock num">{c.time}{c.ampm && <span className="slp-ampm">{c.ampm}</span>}</div>}
        {sh.date && <div className="slp-date">{date}</div>}
        {(ringing || sh.asleep) && <div className="slp-for">{ringing ? plan.words.ringing : asleepFor(since, now)}</div>}
        {sh.alarm && <div className="slp-alarm">{plan.words.alarm}</div>}
        {sh.count && next && !ringing && <div className="slp-count">{countdownLine(next.at, now)}</div>}
        {watchOn && (
          <div className={`slp-watch ${look.watch}`} onClick={(e) => e.stopPropagation()}>
            <span className="slp-watch-t num" aria-label={plan.words.watch}>{watchText(watchMs(w, now))}</span>
            <span className="slp-watch-b">
              <button type="button" className="slp-wb" onClick={() => { sfx.click(); watchActions.toggle(); }}>{w.run ? plan.words.pause : plan.words.start}</button>
              <button type="button" className="slp-wb" disabled={!w.run && w.acc === 0} onClick={() => { sfx.click(); watchActions.reset(); }}>{plan.words.reset}</button>
            </span>
          </div>
        )}
      </div>
      {sh.panel && (
        <div className={`slp-panel-up${panelUp ? " up" : ""}`} aria-hidden={!panelUp}>
          {sh.tasks && <span className="slp-p-l">{plan.words.tasks}</span>}
          {sh.tasks && plan.tasks.titles.length > 0 && <ul className="slp-p-list">{plan.tasks.titles.map((t, i) => <li key={i}>{t}</li>)}</ul>}
          {sh.squad && plan.words.squad && <span className="slp-p-sq"><i />{plan.words.squad}</span>}
          {plan.wake != null && now < plan.wake && <span className="slp-p-n">Wake time {hm(plan.wake)}</span>}
        </div>
      )}
    </>
  );
}

/** The mouse pointer hides after `secs` still (0: never) and comes back the moment it moves. Only on this element:
 *  the class is on the sleep screen itself, so the pointer is never hidden anywhere else. */
export function useHiddenPointer(secs: number, paused: boolean) {
  const [hidden, setHidden] = useState(false);
  const t = useRef(0);
  useEffect(() => {
    if (!secs || paused) { setHidden(false); return; }
    const arm = () => { window.clearTimeout(t.current); t.current = window.setTimeout(() => setHidden(true), secs * 1000); };
    const move = () => { setHidden(false); arm(); };
    arm();
    window.addEventListener("mousemove", move, true);
    window.addEventListener("pointerdown", move, true);
    return () => { window.clearTimeout(t.current); window.removeEventListener("mousemove", move, true); window.removeEventListener("pointerdown", move, true); };
  }, [secs, paused]);
  return hidden;
}

/** V1.43 (the developer: "the option to have a clock face as well"): the analogue face. Ticks, numbers or roman numerals; the
 *  hour and minute hands move smoothly; the second hand sweeps (a CSS animation set once against the real time, so
 *  it is smooth without a redraw every frame), ticks, or is left out. Coloured face, hands and ticks, a soft glow.
 *  Reduce motion: it ticks instead of sweeping. */
function Dial({ look, now, ringing }: { look: PlanLook; now: number; ringing: boolean }) {
  const a = handAngles(new Date(now), "tick");
  const marks = useMemo(() => dialMarks(look.dial), [look.dial]);
  const calm = useMemo(() => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } }, []);
  const sweep = look.hand === "sweep" && !calm;
  // The sweep starts where the second hand is now and goes round once a minute (set once, so it never jumps).
  const delay = useMemo(() => { const d = new Date(); return -(d.getSeconds() + d.getMilliseconds() / 1000); }, [sweep]);   // eslint-disable-line react-hooks/exhaustive-deps
  const R = 92;
  return (
    <svg className={`slp-dial dial-${look.dial}${ringing ? " ring" : ""}`} viewBox="-100 -100 200 200" role="img" aria-label="Clock face">
      <circle className="slp-dial-face" r="97" />
      {marks.map((m, i) => {
        if (m.label) {
          const r = 72, t = (m.angle - 90) * Math.PI / 180;
          return <text key={i} className="slp-dial-n" x={r * Math.cos(t)} y={r * Math.sin(t)} textAnchor="middle" dominantBaseline="central">{m.label}</text>;
        }
        if (look.dial !== "ticks" && !m.major) return <circle key={i} className="slp-dial-dot" r="0.9" cy={-R + 2} transform={`rotate(${m.angle})`} />;
        if (look.dial !== "ticks") return null;
        return <line key={i} className={m.major ? "slp-dial-maj" : "slp-dial-min"} y1={-R} y2={m.major ? -R + 13 : -R + 5} transform={`rotate(${m.angle})`} />;
      })}
      <line className="slp-dial-h" y1="8" y2="-48" transform={`rotate(${a.hour})`} />
      <line className="slp-dial-m" y1="10" y2="-74" transform={`rotate(${a.minute})`} />
      {look.hand !== "none" && (sweep
        ? <g className="slp-dial-sweep" style={{ animationDelay: `${delay}s` }}><line className="slp-dial-s" y1="14" y2="-84" /></g>
        : <line className="slp-dial-s" y1="14" y2="-84" transform={`rotate(${a.second})`} />)}
      <circle className="slp-dial-cap" r="3.6" />
    </svg>
  );
}

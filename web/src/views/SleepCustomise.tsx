// Customise the sleep screen (V1.42, rules in core/sleepmode.ts cleanLook). The developer, 8 Nov 2026: "I want everything to
// be very customisable on the sleep screen." Opens from Sleep mode's settings, from the web sleep screen's own
// Customise button, and after Customise on the Mac's or phone's clock (the sleep stays open; "Back to sleep" goes
// straight back to the same sleep). Every change shows at once in the preview (or on the live screen behind it) and
// is saved a moment later with the other Sleep mode settings, so every device draws the same look.
// Esc closes it (one layer at a time, ui/escape.ts), and nothing here can trap anyone.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Settings } from "../core/model";
import { settingsData } from "../core/select";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { BGS, BRIGHT_MIN, COLORS, COLOR_NAMES, DIAL_NAMES, HAND_NAMES, FONTS, FONT_NAMES, LOOK_DEF, PIECE_NAMES, POINTER_STEPS, SIZE_MAX, SIZE_MIN, SPACING_MAX, SPACING_MIN, WEIGHTS, WEIGHT_NAMES,
  bgHex, clockText, cleanLook, inkHex, planLook, prefsOf, sleepModeOf, type ClockColor, type Ink, type SleepLook, type SleepPieces } from "../core/sleepmode";
import { SENTRY_SIDE, SENTRY_SPOTS, SENTRY_SPOT_LINE, SENTRY_SPOT_NAMES, clockRoomPct, type SentrySpot } from "../core/sentry";
import { ColorWheel } from "./ColorWheel";
import { WHERE, closeCustomise, currentPlan, goToSleep, openSleep, sleepLog, sleepPsBase, useSleepMode } from "../sleepmode/engine";
import { SleepFace, faceStyle } from "./SleepFace";
import { taskMapActions } from "./TaskMap";

const SAVE_AFTER = 350;
const BASE_W = 1200, BASE_H = 760;   // the preview draws a whole screen this size, scaled to fit

function useNow(every = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), every); return () => window.clearInterval(t); }, [every]);
  return now;
}

/** The look being changed: shown at once, saved a moment after the last change (a slider sends many). */
export function useDraftLook(): [SleepLook, (patch: Partial<SleepLook>) => void, () => void] {
  const st = settingsData(useVault());
  const p = sleepModeOf(st);
  const [draft, setDraft] = useState<SleepLook>(p.look);
  const timer = useRef(0);
  const latest = useRef({ p, draft });
  latest.current = { p, draft };
  const save = () => {
    const { p: cur, draft: d } = latest.current;
    // Every Sleep mode setting goes with the look (a save replaces them all): the Touch ID switch and the wake styles stay.
    void taskMapActions.looks({ sleepMode: prefsOf({ ...cur, look: cleanLook(d) }) } as Partial<Settings>);
  };
  const change = (patch: Partial<SleepLook>) => {
    setDraft((d) => { const n = cleanLook({ ...d, ...patch, show: { ...d.show, ...(patch.show ?? {}) } }); latest.current = { ...latest.current, draft: n }; return n; });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, SAVE_AFTER);
  };
  const flush = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = 0; save(); } };
  useEffect(() => () => { if (timer.current) { window.clearTimeout(timer.current); save(); } }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return [draft, change, flush];
}

/** The draft look on the live web sleep screen behind Customise (so the screen itself is the preview). */
let liveDraft: SleepLook | null = null;
const liveSubs = new Set<() => void>();
export function useLiveDraft(): SleepLook | null {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((n) => n + 1); liveSubs.add(f); return () => { liveSubs.delete(f); }; }, []);
  return liveDraft;
}
function setLiveDraft(l: SleepLook | null) { liveDraft = l; liveSubs.forEach((f) => f()); }

/** Customise can be opened from places that sit on different pages (the Tab list, Settings, General): every such
 *  place mounts a host, and only the oldest one still mounted draws it, so it shows once wherever you are. */
const hosts: number[] = [];
let hostSeq = 0;
const hostSubs = new Set<() => void>();
export function CustomiseHost({ overScreen }: { overScreen?: boolean }) {
  const s = useSleepMode();
  const [id] = useState(() => ++hostSeq);
  const [, bump] = useState(0);
  useEffect(() => {
    hosts.push(id);
    const f = () => bump((n) => n + 1);
    hostSubs.add(f); hostSubs.forEach((g) => g());
    return () => { const i = hosts.indexOf(id); if (i >= 0) hosts.splice(i, 1); hostSubs.delete(f); hostSubs.forEach((g) => g()); };
  }, [id]);
  return s.customising && hosts[0] === id ? <SleepCustomise overScreen={overScreen} /> : null;
}

/** Customise. `overScreen`: the web sleep screen is up behind it, so it is a side panel with no preview of its own. */
export function SleepCustomise({ overScreen }: { overScreen?: boolean }) {
  const [look, change, flush] = useDraftLook();
  const s = useSleepMode();
  const done = () => { sfx.click(); flush(); closeCustomise(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  });
  useEffect(() => { if (overScreen) setLiveDraft(look); }, [overScreen, look]);
  useEffect(() => () => setLiveDraft(null), []);
  // Opened from the Mac's or phone's clock: the sleep is still open, so "Back to sleep" goes straight back to it.
  const o = openSleep();
  const back = !overScreen && !s.here && WHERE !== "web" && !!o && !o.woke;
  const backToSleep = () => { flush(); sleepLog("Customise: back to sleep"); closeCustomise(); window.setTimeout(() => void goToSleep(), SAVE_AFTER + 50); };
  return createPortal(
    <div className={`slp-cust-layer${overScreen ? " over" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget && !overScreen) done(); }}>
      <div className="slp-cust" role="dialog" aria-label="Customise the sleep screen">
        <div className="slp-sheet-h">
          <span className="slp-sheet-t">Customise the sleep screen</span>
          <button type="button" className="slp-x" onClick={done} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {!overScreen && <SleepPreview look={look} />}
        <LookControls look={look} change={change} />
        <div className="slp-cust-b">
          <button type="button" className="slp-cust-reset" onClick={() => { sfx.click(); change(LOOK_DEF); }}>Back to the usual look</button>
          {back && <button type="button" className="slp-cust-done" onClick={backToSleep}>Back to sleep</button>}
          <button type="button" className={back ? "slp-cust-reset" : "slp-cust-done"} onClick={done}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A whole sleep screen drawn at BASE_W by BASE_H and scaled down to the panel's width: what you see is the screen. */
export function SleepPreview({ look }: { look: SleepLook }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.4);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setK(Math.max(0.15, el.clientWidth / BASE_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const now = useNow(1000);
  const since = useMemo(() => now - (6 * 60 + 40) * 60_000, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => currentPlan(since), [since, Math.floor(now / 30_000)]);   // eslint-disable-line react-hooks/exhaustive-deps
  const pl = planLook(look, sleepPsBase());
  const c = clockText(now, look);
  // PS 1.65: on the Mac the clock keeps the AI Sentry mode button's room free at both edges (SleepScreen.swift), so the preview does too.
  const sides = WHERE === "mac" && look.sentry !== "hidden" ? SENTRY_SIDE : 0;
  const room = { clock: clockRoomPct(BASE_W, sides, 94), dial: clockRoomPct(BASE_W, sides, 92) };
  return (
    <div ref={box} className="slp-prev-box" style={{ height: Math.round(BASE_H * k) }} aria-label="Preview">
      <div className="slp-screen slp-prev" style={{ ...faceStyle(pl, c.time.length + (c.ampm ? 2 : 0), room), width: BASE_W, height: BASE_H, transform: `scale(${k})` }}>
        <SleepFace plan={plan} look={pl} since={since} now={now} ringing={false} peek={false} preview />
        <div className="slp-foot"><span className="slp-wake">{plan.words.wakeUp}</span></div>
      </div>
    </div>
  );
}

/** One look setting's control, without its label (V1.47: Sleep mode's own settings put each on its own row; the
 *  Customise sheet below puts them all together). */
export type LookKey = "face" | "size" | "font" | "colour" | "text" | "bright" | "bg" | "weight" | "spacing" | "hours" | "pos" | "pieces" | "watch" | "pointer" | "sentry";
const seg = <T extends string | boolean>(label: string, value: T, opts: [T, string][], set: (v: T) => void) => (
  <div className="tm-ed-seg slp-seg" role="radiogroup" aria-label={label}>
    {opts.map(([v, name]) => (
      <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={`dwell${value === v ? " on" : ""}`}
        onClick={() => { if (value !== v) { sfx.hover(); set(v); } }}>{name}</button>
    ))}
  </div>
);
const sub = (label: string, body: React.ReactNode) => <div className="slp-set-b slp-sub"><span className="slp-set-l">{label}</span>{body}</div>;
export function LookPiece({ k, look, change }: { k: LookKey; look: SleepLook; change: (p: Partial<SleepLook>) => void }) {
  switch (k) {
    case "size": return (
      <span className="slp-range">
        <input type="range" min={SIZE_MIN} max={SIZE_MAX} step={5} value={look.size} aria-label="Clock size" onChange={(e) => change({ size: Number(e.target.value) })} />
        <b className="num">{look.size}%</b>
      </span>
    );
    case "face": return (<>
      {seg("Clock face", look.face, [["digital", "Digital"], ["analogue", "Analogue"]], (v) => change({ face: v }))}
      {look.face === "analogue" && <>
        {sub("Face", seg("The face's marks", look.dial, Object.entries(DIAL_NAMES) as [typeof look.dial, string][], (v) => change({ dial: v })))}
        {sub("Second hand", seg("Second hand", look.hand, Object.entries(HAND_NAMES) as [typeof look.hand, string][], (v) => change({ hand: v })))}
        {sub("Time under it", seg("The time small under the face", look.digi, [[true, "Show"], [false, "Hide"]], (v) => change({ digi: v })))}
        {sub("Face colour", <InkPick label="Face colour" value={look.faceInk} same set={(c) => change({ faceInk: c })} />)}
        {sub("Hands colour", <InkPick label="Hands colour" value={look.handInk} same set={(c) => change({ handInk: c })} />)}
        {sub("Ticks colour", <InkPick label="Ticks and numbers colour" value={look.tickInk} same set={(c) => change({ tickInk: c })} />)}
      </>}
    </>);
    case "font": return (
      <div className="tm-ed-seg slp-seg slp-fonts" role="radiogroup" aria-label="Clock font">
        {FONTS.map((f) => (
          <button key={f} type="button" role="radio" aria-checked={look.font === f} className={`dwell slp-f-${f}${look.font === f ? " on" : ""}`}
            onClick={() => { if (look.font !== f) { sfx.hover(); change({ font: f }); } }}><span className="slp-fs">12:34</span>{FONT_NAMES[f]}</button>
        ))}
      </div>
    );
    case "hours": return (
      <span className="slp-two">
        {seg("12 or 24 hour", look.h12, [[false, "24 hour"], [true, "12 hour"]], (v) => change({ h12: v }))}
        {seg("Seconds", look.secs, [[false, "No seconds"], [true, "Seconds"]], (v) => change({ secs: v }))}
      </span>
    );
    case "weight": return (
      <div className="tm-ed-seg slp-seg" role="radiogroup" aria-label="Clock weight">
        {WEIGHTS.map((w) => (
          <button key={w} type="button" role="radio" aria-checked={look.weight === w} className={`dwell${look.weight === w ? " on" : ""}`}
            onClick={() => { if (look.weight !== w) { sfx.hover(); change({ weight: w }); } }}>{WEIGHT_NAMES[w]}</button>
        ))}
      </div>
    );
    case "spacing": return (
      <span className="slp-range">
        <input type="range" min={SPACING_MIN} max={SPACING_MAX} step={1} value={look.spacing} aria-label="Letter spacing" onChange={(e) => change({ spacing: Number(e.target.value) })} />
        <b className="num">{look.spacing === 0 ? "Usual" : look.spacing > 0 ? `+${look.spacing}` : look.spacing}</b>
      </span>
    );
    case "colour": return <InkPick label="Clock colour" value={look.color} set={(c) => change({ color: c })} />;
    case "text": return <InkPick label="Colour of the other words" value={look.text} same set={(c) => change({ text: c })} />;
    case "bright": return (
      <span className="slp-range">
        <input type="range" min={BRIGHT_MIN} max={100} step={1} value={look.bright} aria-label="Clock brightness" onChange={(e) => change({ bright: Number(e.target.value) })} />
        <b className="num">{look.bright}%</b>
      </span>
    );
    case "bg": return <BgPick look={look} change={change} />;
    case "pos": return seg("Where the clock sits", look.pos, [["top", "Top"], ["center", "Middle"], ["bottom", "Bottom"]], (v) => change({ pos: v }));
    case "pieces": return (
      <div className="slp-pieces">
        {(Object.keys(PIECE_NAMES) as (keyof SleepPieces)[]).map((p) => (
          <label key={p} className={`slp-piece${look.show[p] ? " on" : ""}`}>
            <input type="checkbox" checked={look.show[p]} onChange={(e) => { sfx.hover(); change({ show: { ...look.show, [p]: e.target.checked } }); }} />
            {PIECE_NAMES[p]}
          </label>
        ))}
      </div>
    );
    // V1.52 (the developer): the AI Sentry mode button on the Mac's sleep screen (core/sentry.ts SentrySpot).
    case "sentry": return seg("AI Sentry mode button", look.sentry, SENTRY_SPOTS.map((v) => [v, SENTRY_SPOT_NAMES[v]] as [SentrySpot, string]), (v) => change({ sentry: v }));
    case "watch": return seg("Stopwatch", look.watch, [["off", "Off"], ["small", "Small"], ["big", "Big"]], (v) => change({ watch: v }));
    case "pointer": return (
      <div className="tm-ed-seg slp-seg" role="radiogroup" aria-label="Hide the mouse pointer after">
        {POINTER_STEPS.map((n) => (
          <button key={n} type="button" role="radio" aria-checked={look.pointer === n} className={`dwell${look.pointer === n ? " on" : ""}`}
            onClick={() => { if (look.pointer !== n) { sfx.hover(); change({ pointer: n }); } }}>{n === 0 ? "Never" : `${n} s`}</button>
        ))}
      </div>
    );
  }
}

function LookControls({ look, change }: { look: SleepLook; change: (p: Partial<SleepLook>) => void }) {
  const row = (label: string, k: LookKey, note?: string) => (
    <div className="slp-set-b"><span className="slp-set-l">{label}</span><LookPiece k={k} look={look} change={change} />{note && <span className="slp-set-n">{note}</span>}</div>
  );
  return (
    <div className="slp-set slp-cust-set">
      {row("Clock size", "size")}
      {row("Clock face", "face", look.face === "analogue" ? "Sized by Clock size, in the colours below. The font is for the numbers and the small time." : undefined)}
      {row("Font", "font")}
      {row("Clock", "hours")}
      {row("Weight", "weight", "Usual is the font's own weight. A font without that weight shows its nearest one.")}
      {row("Letter spacing", "spacing")}
      {row("Clock colour", "colour")}
      {row("Other words", "text", "The date, Asleep for, alarms, the countdown, the stopwatch and the panel.")}
      {row("Brightness", "bright")}
      {row("Background", "bg")}
      {row("Clock sits", "pos")}
      {row("Shows", "pieces")}
      {WHERE === "mac" && row("AI Sentry mode button", "sentry", SENTRY_SPOT_LINE)}
      {row("Stopwatch", "watch", "Start, Pause and Reset sit under the clock. It keeps time while the screen is dim.")}
      {WHERE !== "phone" && row("Hide the pointer", "pointer", "On the sleep screen only. It comes back the moment you move the mouse.")}
    </div>
  );
}

/** A colour: the presets, "Same as the clock" (the other words), and the wheel for any colour at all (V1.43). */
function InkPick({ label, value, set, same }: { label: string; value: Ink | "same"; set: (c: Ink | "same") => void; same?: boolean }) {
  const custom = typeof value === "string" && value.startsWith("#");
  const [wheel, setWheel] = useState(custom);
  return (
    <>
      <div className="slp-swatches" role="radiogroup" aria-label={label}>
        {same && <button type="button" role="radio" aria-checked={value === "same"} className={`slp-swatch same${value === "same" ? " on" : ""}`}
          onClick={() => { if (value !== "same") { sfx.hover(); set("same"); setWheel(false); } }}>Same as the clock</button>}
        {(Object.keys(COLORS) as ClockColor[]).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={COLOR_NAMES[c]} title={COLOR_NAMES[c]}
            className={`slp-swatch${value === c ? " on" : ""}`} style={{ background: `rgb(${COLORS[c].join(", ")})` }}
            onClick={() => { if (value !== c) { sfx.hover(); set(c); } }} />
        ))}
        <button type="button" role="radio" aria-checked={custom} aria-label={`${label}: colour wheel`} title="Any colour"
          className={`slp-swatch wheel${custom ? " on" : ""}`} onClick={() => { sfx.click(); setWheel((v) => !v); }} />
      </div>
      {wheel && <ColorWheel label={label} value={value === "same" ? "#e7a35e" : inkHex(value)} onChange={(hex) => set(hex)} />}
    </>
  );
}
/** The background: near black, a dim shade of the clock colour, the PS background, the presets, or the wheel. */
function BgPick({ look, change }: { look: SleepLook; change: (p: Partial<SleepLook>) => void }) {
  const custom = look.bg.startsWith("#") && !BGS.some((b) => b.hex === look.bg);
  const [wheel, setWheel] = useState(custom);
  const pickBg = (bg: string) => { if (look.bg !== bg) { sfx.hover(); change({ bg }); } };
  return (
    <>
      <div className="tm-ed-seg slp-seg" role="radiogroup" aria-label="Background">
        {([["black", "Near black"], ["dim", "Dim colour"], ["ps", "PS app background"]] as const).map(([v, name]) => (
          <button key={v} type="button" role="radio" aria-checked={look.bg === v} className={`dwell${look.bg === v ? " on" : ""}`} onClick={() => pickBg(v)}>{name}</button>
        ))}
      </div>
      <div className="slp-swatches" role="radiogroup" aria-label="Background colour">
        {BGS.map((b) => (
          <button key={b.hex} type="button" role="radio" aria-checked={look.bg === b.hex} aria-label={b.name} title={b.name}
            className={`slp-swatch${look.bg === b.hex ? " on" : ""}`} style={{ background: b.hex }} onClick={() => pickBg(b.hex)} />
        ))}
        <button type="button" role="radio" aria-checked={custom} aria-label="Background: colour wheel" title="Any colour"
          className={`slp-swatch wheel${custom ? " on" : ""}`} onClick={() => { sfx.click(); setWheel((v) => !v); }} />
      </div>
      {wheel && <ColorWheel label="Background" value={bgHex(look)} onChange={(hex) => change({ bg: hex })} />}
    </>
  );
}

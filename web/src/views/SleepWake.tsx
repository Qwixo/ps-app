// Sleep mode's wake up on the page (V1.43, rules in core/sleepwake.ts): the "Wake me up in" picker, the wake styles'
// light and sound on the web sleep screen, a preview of each style, and their settings. The Mac and the phone draw the
// same styles natively (ps-mac SleepScreen.swift, ps-gos Sleep.kt) from the plan.
// Safety: Esc always closes a preview, Stop is big and needs no Touch ID, Strobe flash stays off until it is switched
// on behind its warning, and a page can never turn the device's own volume up (only the Mac and the phone can).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { sfx } from "../ui/sfx";
import type { AlarmSound } from "../core/sleepmode";
import { STROBE_WARN, SUNRISE_STEPS, WAKE_NAMES, WAKE_NOTES, WAKE_SPEC, WAKE_STYLES, WAVE_DEF, durText, hexRgb, inkOn, okWakeIn,
  wakeInAt, wakeInChoices, wakeLight, type RGB, type WakeLight, type WakePrefs, type WakeStyle } from "../core/sleepwake";
import { LEVEL_MIN, OWN_ACCEPT, OWN_MAX_MB, OWN_MAX_SECS, levelLine, okLevel, pct } from "../core/alarmsound";
import { clearAlarmNote, importOwn, pagePlayer, pickOwnOnMac, picksNatively, removeOwn, stopTest, testSound, useAlarmSound, type PageTrack } from "../sleepmode/sound";
import { ColorWheel } from "./ColorWheel";
import { ACCEPT as LIST_ACCEPT, FADES, MAX_MB as LIST_MAX_MB, MAX_TRACKS, PREVIEW_MS, SHARE_MAX_MB, SHARE_NOTE, byPack, dayIn, dayNum, dayStr, lenText, moveTrack, pickFor,
  pickLine, playlistOf, setInPlaylist, setOrder, sizeText, useWholeLibrary, type AlarmList, type DayPick, type Track } from "../core/alarmlist";
import { addFromPack, addFromSquad, clearListNote, importFiles, listDropsNatively, listPicksNatively, loadSquad, loadStarter, pickOnMac, removeFile, shareToSquad, tidyFiles,
  useAlarmList } from "../sleepmode/list";
import { dropPlace, useDropOver } from "../second/dragzone";

/** A preview or the strobe warning is open: the sheet under it leaves Esc to it (one Esc, one layer, in a browser too). */
let overlays = 0;
export const wakeOverlayUp = () => overlays > 0;
function useOverlay() { useEffect(() => { overlays++; return () => { overlays--; }; }, []); }

const hm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const reduced = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

// ---------- the sound in this page (a browser's own sleep screen; sleepmode/sound.ts) ----------
/** One alarm sound at a time: `start(style, level)` rings your own sound or the style's built in one, rising by the
 *  style's curve to the alarm loudness, `stop()` stops. A page never changes the device's own volume. */
export function useWakeSound() {
  const p = useRef<ReturnType<typeof pagePlayer> | null>(null);
  const get = () => (p.current ??= pagePlayer());
  useEffect(() => () => { p.current?.close(); p.current = null; }, []);
  return { start: (style: WakeStyle, level: number, track?: PageTrack | null, builtin = false) => get().play(style, level, false, track, builtin), stop: () => p.current?.stop(), prime: () => get().prime() };
}

// ---------- the light over the screen ----------
/** The style's light, drawn every frame from the rules (no React render per frame). `t0` is the alarm time; before
 *  it only Sunrise lights up. Reduced motion: no pulse, no wave, no flashes (a steady light instead). */
export function WakeLightLayer({ style, t0, dawnMs, wave, ink, onInk }: {
  style: WakeStyle; t0: number; dawnMs: number; wave: string; ink: string; onInk?: (k: "dark" | "light") => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const last = useRef<"dark" | "light" | null>(null);
  useEffect(() => {
    const o = { dawnMs, wave: hexRgb(wave), ink: hexRgb(ink) };
    const calm = reduced();
    let raf = 0;
    const frame = () => {
      const t = Date.now() - t0;
      let l: WakeLight | null = wakeLight(calm && (style === "strobe") ? "white" : style, calm && t >= 0 && (style === "alert" || style === "wave" || style === "light") ? 800 : t, o);
      if (calm && l && t >= 0 && style === "wave") l = { rgb: o.wave, a: 0.8 };
      const d = el.current;
      if (d) { d.style.background = l ? `rgb(${l.rgb.join(", ")})` : "transparent"; d.style.opacity = l ? String(l.a) : "0"; }
      const k = inkOn(l);
      if (k !== last.current) { last.current = k; onInk?.(k); }
      raf = window.requestAnimationFrame(frame);
    };
    frame();
    return () => window.cancelAnimationFrame(raf);
  }, [style, t0, dawnMs, wave, ink]);   // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={el} className="slp-light" aria-hidden="true" />;
}

// ---------- a preview of one style, full screen, a few seconds ----------
const PREVIEW_FOR = 9000, PREVIEW_DAWN = 5000;
/** The style as it really wakes you, for PREVIEW_FOR (a Sunrise squeezed into 5 seconds first). V1.44: its sound plays
 *  at the alarm loudness, through the Mac or the phone like a real alarm (it used to play at a third, which made every
 *  style but Loud sound far too quiet). Stop, a click anywhere or Esc ends it. */
export function WakePreview({ style, wave, ink, level, onClose }: { style: WakeStyle; wave: string; ink: string; level: number; onClose: () => void }) {
  const [t0] = useState(() => Date.now() + (style === "sunrise" ? PREVIEW_DAWN : 0));
  const [dark, setDark] = useState(false);
  useOverlay();
  useEffect(() => {
    const ring = window.setTimeout(() => testSound(style, level), Math.max(0, t0 - Date.now()));
    const end = window.setTimeout(onClose, PREVIEW_FOR + Math.max(0, t0 - Date.now()));
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => { window.clearTimeout(ring); window.clearTimeout(end); window.removeEventListener("keydown", k, true); stopTest(); };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div className={`slp-screen slp-wprev ringing${dark ? " lit-dark" : ""}`} role="dialog" aria-label={`Preview: ${WAKE_NAMES[style]}`} onClick={onClose}>
      <WakeLightLayer style={style} t0={t0} dawnMs={PREVIEW_DAWN} wave={wave} ink={ink} onInk={(k) => setDark(k === "dark")} />
      <div className="slp-face"><div className="slp-clock num">{hm(Date.now())}</div><div className="slp-for">{WAKE_NAMES[style]}</div></div>
      <div className="slp-foot">
        <button type="button" className="slp-stop big" onClick={(e) => { e.stopPropagation(); onClose(); }}>Stop preview</button>
        <span className="slp-honest">{WAKE_SPEC[style].sound === "none" ? "No sound: light only." : `The sound plays at ${pct(WAKE_SPEC[style].loud ? 1 : level)}, as loud as the alarm rings.`}</span>
      </div>
    </div>,
    document.body,
  );
}

// ---------- "Wake me up in" ----------
/** The picker: the sleep cycle suggestions (each with the time it lands on), or your own hours and minutes.
 *  `onPick(mins)` sets it; `onClear` takes it away. */
export function WakeInPicker({ current, onPick, onClear, compact }: { current: number | null; onPick: (mins: number) => void; onClear?: () => void; compact?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(t); }, []);
  const [h, setH] = useState(7), [m, setM] = useState(30);
  const own = okWakeIn(h * 60 + m);
  return (
    <div className={`slp-wi${compact ? " compact" : ""}`}>
      <div className="slp-wi-list" role="listbox" aria-label="Wake me up in">
        {wakeInChoices().map((c) => (
          <button key={c.id} type="button" role="option" aria-selected={current === c.mins} className={`slp-wi-c${current === c.mins ? " on" : ""}`}
            onClick={() => { sfx.hover(); onPick(c.mins); }}>
            <b className="num">{durText(c.sleep)}</b>
            <small>{c.name}, rings after {durText(c.mins)}</small>
            <small className="slp-wi-at">rings at {hm(wakeInAt(now, c.mins))}</small>
          </button>
        ))}
      </div>
      <div className="slp-wi-own">
        <span className="slp-wi-ol">Your own</span>
        <label><input type="number" min={0} max={16} value={h} aria-label="Hours" onChange={(e) => setH(Math.max(0, Math.min(16, Math.round(Number(e.target.value) || 0))))} /> h</label>
        <label><input type="number" min={0} max={59} step={5} value={m} aria-label="Minutes" onChange={(e) => setM(Math.max(0, Math.min(59, Math.round(Number(e.target.value) || 0))))} /> min</label>
        <button type="button" className="tm-pill-btn" disabled={own == null} onClick={() => { if (own != null) { sfx.click(); onPick(own); } }}>
          {own == null ? "5 min to 16 h" : `Set, rings at ${hm(wakeInAt(now, own))}`}
        </button>
        {onClear && current != null && <button type="button" className="tm-pill-btn" onClick={() => { sfx.click(); onClear(); }}>No timer</button>}
      </div>
    </div>
  );
}

// ---------- the wake styles' settings ----------
// V1.47: in pieces, so Sleep mode's own settings (views/SleepSettings.tsx) give each its own row; WakeStylesSettings
// still puts them all together.
type WakeProps = { wake: WakePrefs; set: (w: WakePrefs) => void };
/** Every style with a Preview (Strobe flash asks first, behind its warning). */
export function WakeStyleList({ wake, set, ink }: WakeProps & { ink: string }) {
  const [preview, setPreview] = useState<WakeStyle | null>(null);
  const [warn, setWarn] = useState(false);
  const tryPreview = (s: WakeStyle) => { if (s === "strobe" && !wake.strobe) { setWarn(true); return; } sfx.click(); setPreview(s); };
  return (
    <>
      <ul className="slp-ws-list">
        {WAKE_STYLES.map((s) => (
          <li key={s} className={`slp-ws-i ws-${s}`}>
            <span className="slp-ws-sw" aria-hidden="true" />
            <span className="slp-ws-t"><b>{WAKE_NAMES[s]}</b><small>{WAKE_NOTES[s]}</small>
              {s === "strobe" && <small className="slp-ws-st">{wake.strobe ? "Switched on." : "Off. Its alarms ring as Bright white."}</small>}
            </span>
            <button type="button" className="tm-pill-btn" onClick={() => tryPreview(s)}>{s === "strobe" && !wake.strobe ? "Switch on" : "Preview"}</button>
          </li>
        ))}
      </ul>
      {warn && <StrobeWarning onYes={() => { setWarn(false); set({ ...wake, strobe: true }); }} onNo={() => setWarn(false)} />}
      {preview && <WakePreview style={preview} wave={wake.wave} ink={ink} level={wake.level} onClose={() => setPreview(null)} />}
    </>
  );
}
/** How long before the alarm the sunrise starts. */
export function SunrisePick({ wake, set }: WakeProps) {
  return (
    <div className="tm-ed-seg slp-seg" role="radiogroup" aria-label="Sunrise starts before the alarm">
      {SUNRISE_STEPS.map((n) => <button key={n} type="button" role="radio" aria-checked={wake.sunrise === n} className={`dwell${wake.sunrise === n ? " on" : ""}`}
        onClick={() => { if (wake.sunrise !== n) { sfx.hover(); set({ ...wake, sunrise: n }); } }}>{n} min before</button>)}
    </div>
  );
}
/** Colour wave's colour: the swatch opens the wheel. */
export function WaveColour({ wake, set }: WakeProps) {
  const [wheel, setWheel] = useState(false);
  return (
    <>
      <span className="slp-two">
        <button type="button" className="slp-swatch on" style={{ background: wake.wave }} aria-label="Colour wave's colour" onClick={() => { sfx.click(); setWheel((v) => !v); }} />
        {wake.wave !== WAVE_DEF && <button type="button" className="tm-pill-btn" onClick={() => { sfx.click(); set({ ...wake, wave: WAVE_DEF }); }}>Usual blue</button>}
      </span>
      {wheel && <ColorWheel value={wake.wave} label="Colour wave" onChange={(hex) => set({ ...wake, wave: hex })} />}
    </>
  );
}
/** Strobe flash: On only after its warning. */
export function StrobeSwitch({ wake, set }: WakeProps) {
  const [warn, setWarn] = useState(false);
  return (
    <>
      <div className="tm-ed-seg slp-seg" role="radiogroup" aria-label="Strobe flash">
        <button type="button" role="radio" aria-checked={!wake.strobe} className={`dwell${!wake.strobe ? " on" : ""}`} onClick={() => { if (wake.strobe) { sfx.hover(); set({ ...wake, strobe: false }); } }}>Off</button>
        <button type="button" role="radio" aria-checked={wake.strobe} className={`dwell${wake.strobe ? " on" : ""}`} onClick={() => { if (!wake.strobe) setWarn(true); }}>On</button>
      </div>
      {warn && <StrobeWarning onYes={() => { setWarn(false); set({ ...wake, strobe: true }); }} onNo={() => setWarn(false)} />}
    </>
  );
}
/** What Bright white and Strobe flash do to the screen here, and that every alarm rings through Do Not Disturb. */
export function wakeDeviceLine(where: "mac" | "phone" | "web"): string {
  return (where === "web"
    ? "Bright white cannot raise the screen's brightness in a browser."
    : where === "mac"
      ? "Bright white and Strobe flash also turn the screen's brightness up, then back."
      : "Bright white and Strobe flash also turn the screen to full brightness.")
    + " Every alarm rings through PS app Do Not Disturb. Stop needs no Touch ID.";
}
/** Every style with a Preview, the sunrise's length, Colour wave's colour, Strobe flash behind its warning, the alarm
 *  loudness and your own sound, together (the older layout). */
export function WakeStylesSettings({ wake, set, where, ink }: { wake: WakePrefs; set: (w: WakePrefs) => void; where: "mac" | "phone" | "web"; ink: string }) {
  return (
    <div className="slp-ws">
      <WakeStyleList wake={wake} set={set} ink={ink} />
      <div className="slp-two"><span className="slp-set-n">Sunrise starts</span><SunrisePick wake={wake} set={set} /></div>
      <div className="slp-two"><span className="slp-set-n">Colour wave</span><WaveColour wake={wake} set={set} /></div>
      <div className="slp-two"><span className="slp-set-n">Strobe flash</span><StrobeSwitch wake={wake} set={set} /></div>
      <AlarmLoudness wake={wake} set={set} where={where} />
      <OwnSoundRow wake={wake} />
      <PlaylistSettings wake={wake} set={set} where={where} />
      <span className="slp-set-n">{wakeDeviceLine(where)}</span>
    </div>
  );
}

/** The style Test plays: the one "Wake me up in" rings with, or Soft chime when that one is light only. */
const testStyle = (w: WakePrefs): WakeStyle => (WAKE_SPEC[w.timer]?.sound === "none" ? "chime" : w.timer);

/** While Test plays, Esc stops it (and only that: one Esc, one layer). */
function TestEsc() {
  useOverlay();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stopTest(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, []);
  return null;
}

/** V1.44 Alarm loudness: one level for every alarm, a Test that plays exactly what rings at that level, and a plain
 *  line saying how the device gets there (core/alarmsound.ts levelLine). */
export function AlarmLoudness({ wake, set, where }: { wake: WakePrefs; set: (w: WakePrefs) => void; where: "mac" | "phone" | "web" }) {
  const snd = useAlarmSound();
  const [lv, setLv] = useState(wake.level);
  useEffect(() => { setLv(wake.level); }, [wake.level]);
  const retest = useRef(0);
  useEffect(() => () => { window.clearTimeout(retest.current); stopTest(); }, []);
  const style = testStyle(wake);
  const ls = useAlarmList();
  // V1.47: with the playlist on, Test plays today's file (when this device has it).
  const td = wake.list.on ? pickFor(wake.list, listToday()) : null;
  const track = td && ls.have.has(td.id) ? td : null;
  const commit = () => { const v = okLevel(lv); if (v !== wake.level) set({ ...wake, level: v }); };
  const change = (v: number) => {
    setLv(v);
    // Moving the slider while Test plays: it plays again at the new level (a quarter second after you stop moving).
    if (snd.testing) { window.clearTimeout(retest.current); retest.current = window.setTimeout(() => testSound(snd.testing!, v, snd.testTrack), 250); }
  };
  return (
    <div className="slp-two slp-loud">
      <span className="slp-set-n">Alarm loudness</span>
      <input type="range" min={LEVEL_MIN * 100} max={100} step={5} value={Math.round(okLevel(lv) * 100)} aria-label="Alarm loudness"
        onChange={(e) => change(Number(e.target.value) / 100)} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <b className="num slp-loud-v">{pct(lv)}</b>
      {snd.testing
        ? <button type="button" className="tm-pill-btn on" onClick={() => { sfx.click(); stopTest(); }}>Stop</button>
        : <button type="button" className="tm-pill-btn" onClick={() => { commit(); testSound(style, lv, track?.id); }}>Test{track ? ` (${track.name})` : snd.own ? ` (${snd.own.name})` : ` (${WAKE_NAMES[style]})`}</button>}
      {snd.testing && <TestEsc />}
      <span className="slp-set-n slp-loud-line">{levelLine(where)}</span>
    </div>
  );
}

/** V1.44 Your own sound: a file from this device (it stays on this device), its name, Test, and Remove. */
export function OwnSoundRow({ wake }: { wake: WakePrefs }) {
  const snd = useAlarmSound();
  const file = useRef<HTMLInputElement>(null);
  const pick = () => { sfx.click(); clearAlarmNote(); if (picksNatively()) pickOwnOnMac(); else file.current?.click(); };
  return (
    <div className="slp-two slp-own">
      <span className="slp-set-n">Your own sound</span>
      {snd.own
        ? <>
            <span className="slp-own-n" title={snd.own.name}>{snd.own.name}{snd.own.secs ? <small className="num"> {snd.own.secs < 10 ? snd.own.secs.toFixed(1) : Math.round(snd.own.secs)} s</small> : null}</span>
            {snd.testing
              ? <button type="button" className="tm-pill-btn on" onClick={() => { sfx.click(); stopTest(); }}>Stop</button>
              : <button type="button" className="tm-pill-btn" onClick={() => testSound(testStyle(wake), wake.level)}>Play</button>}
            <button type="button" className="tm-pill-btn" disabled={snd.busy} onClick={pick}>Change</button>
            <button type="button" className="tm-pill-btn" onClick={() => { sfx.click(); removeOwn(); }}>Remove</button>
          </>
        : <button type="button" className="tm-pill-btn" disabled={snd.busy} onClick={pick}>{snd.busy ? "Reading the file..." : "Pick a sound file"}</button>}
      <input ref={file} type="file" accept={OWN_ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importOwn(f); }} />
      {snd.note && <span className="slp-set-n slp-own-err" role="alert">{snd.note}</span>}
      <span className="slp-set-n">{snd.own
        ? "Every alarm on this device that makes a sound plays it instead of the built in sound, at the same level. It stays on this device only."
        : `An mp3, m4a, wav or aiff file up to ${OWN_MAX_MB} MB; the first ${OWN_MAX_SECS} seconds play, over and over, brought to the same level as the built in sounds. It stays on this device only and is never uploaded.`}</span>
    </div>
  );
}

// ---------- V1.47 alarm playlist (core/alarmlist.ts, sleepmode/list.ts) ----------
const localTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
const listToday = (now = Date.now()) => dayIn(now, localTz());
const HERE: Record<"mac" | "phone" | "web", string> = { mac: "this Mac", phone: "this phone", web: "this browser" };
/** The developer, 10 Nov 2026: "add a bunch of audio files so it goes through all these audio files one after another, randomly
 *  or in order, so every day there is a different audio file". Playlist as the alarm's sound: the files (added here,
 *  kept on this device), their order, in order or random, the whole file or a loop, a fade in, and today's file. */
export function PlaylistSettings({ wake, set, where }: { wake: WakePrefs; set: (w: WakePrefs) => void; where: "mac" | "phone" | "web" }) {
  const l = wake.list;
  const ls = useAlarmList();
  const snd = useAlarmSound();
  const file = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(Date.now());
  const [htmlOver, setHtmlOver] = useState(false);
  const [sure, setSure] = useState<string | null>(null);
  const [sharing, setSharing] = useState<Track | null>(null);
  const [libs, setLibs] = useState(false);
  const over = useDropOver() === "alarm" || htmlOver;
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  useEffect(() => { tidyFiles(); }, []);   // files deleted on another device leave this one too
  useEffect(() => { if (!sure) return; const t = window.setTimeout(() => setSure(null), 4000); return () => window.clearTimeout(t); }, [sure]);
  useEffect(() => { if (libs) { void loadStarter(); loadSquad(); } }, [libs]);
  const today = listToday(now), tomorrow = dayStr(dayNum(today) + 1);
  const save = (n: AlarmList) => set({ ...wake, list: n });
  const td = pickFor(l, today), tm = pickFor(l, tomorrow);
  const pl = playlistOf(l);
  const missing = l.tracks.filter((t) => !ls.have.has(t.id)).length;
  const add = () => { sfx.click(); clearListNote(); if (listPicksNatively()) pickOnMac(); else file.current?.click(); };
  const seg = <T extends string | number>(label: string, value: T, opts: [T, string][], pick: (v: T) => void) => (
    <div className="tm-ed-seg slp-seg" role="radiogroup" aria-label={label}>
      {opts.map(([v, w]) => <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={`dwell${value === v ? " on" : ""}`}
        onClick={() => { if (value !== v) { sfx.hover(); pick(v); } }}>{w}</button>)}
    </div>
  );
  const todayLine = (p: DayPick | null, when: string) => (
    <span className={`slp-pl-today${p && !ls.have.has(p.id) ? " away" : ""}`}>{pickLine(p, when)}{p?.secs ? <small className="num"> {lenText(p.secs)}</small> : null}
      {p && !ls.have.has(p.id) && <small> Not on {HERE[where]} yet: it rings your usual sound here.</small>}</span>
  );
  const inLib = (name: string) => l.tracks.some((t) => t.name === name);
  return (
    <div className={`slp-two slp-pl${over ? " over" : ""}`} {...(listDropsNatively() ? dropPlace("alarm", { kind: "alarm" }) : {})}
      onDragOver={(e) => { if (!listDropsNatively() && e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setHtmlOver(true); } }}
      onDragLeave={() => setHtmlOver(false)}
      onDrop={(e) => { if (listDropsNatively()) return; e.preventDefault(); setHtmlOver(false); void importFiles(Array.from(e.dataTransfer.files)); }}>
      <span className="slp-set-n">Alarm sound</span>
      {seg("Alarm sound", l.on ? "list" : "one", [["one", snd.own ? "Your own sound" : "Built in sound"], ["list", "Playlist"]], (v) => save({ ...l, on: v === "list" }))}
      {l.on && <>
        {todayLine(td, "Today")}
        {pl.length > 1 && todayLine(tm, "Tomorrow")}
        <span className="slp-set-n slp-pl-h">Order</span>
        {seg("Order", l.order, [["seq", "A different one each day, in order"], ["random", "Random each day"]], (v) => save(setOrder(l, v, today)))}
        <span className="slp-set-n slp-pl-h">How it plays</span>
        {seg("How it plays", l.end, [["loop", "Loop until I stop it"], ["whole", "Play the whole file"]], (v) => save({ ...l, end: v }))}
        <span className="slp-set-n slp-pl-h">Fade in</span>
        {seg("Fade in", l.fade, FADES.map((f) => [f, f ? `${f} s` : "Off"] as [number, string]), (v) => save({ ...l, fade: v }))}
      </>}
      <span className="slp-set-n slp-pl-h slp-pl-lib">My library <small className="num">{l.tracks.length ? `${pl.length} of ${l.tracks.length} in the playlist` : ""}</small></span>
      {l.tracks.length > pl.length && <button type="button" className="tm-pill-btn" onClick={() => { sfx.click(); save(useWholeLibrary(l, today)); }}>Use the whole library</button>}
      <ol className="slp-pl-list">
        {l.tracks.map((t, i) => {
          const here = ls.have.has(t.id), playing = snd.testing && snd.testTrack === t.id, ticked = !l.skip.includes(t.id);
          return (
            <li key={t.id} className={`${l.on && td?.id === t.id ? "today" : ""}${here ? "" : " away"}${ticked ? "" : " off"}`}>
              <button type="button" role="checkbox" aria-checked={ticked} className={`slp-pl-tick${ticked ? " on" : ""}`} aria-label={`${t.name} in the playlist`}
                onClick={() => { sfx.hover(); save(setInPlaylist(l, t.id, !ticked, today)); }}>{ticked ? "✓" : ""}</button>
              <span className="slp-pl-t" title={t.name}><b>{t.name}</b>
                <small className="num">{t.secs ? lenText(t.secs) : "?"} · {sizeText(t.bytes)}{l.on && td?.id === t.id ? " · today" : ""}{ticked ? "" : " · not in the playlist"}{here ? "" : ` · not on ${HERE[where]} yet`}</small></span>
              <span className="slp-pl-b">
                {here && (playing
                  ? <button type="button" className="tm-pill-btn on" onClick={() => { sfx.click(); stopTest(); }}>Stop</button>
                  : <button type="button" className="tm-pill-btn" onClick={() => testSound(testStyle(wake), wake.level, t.id, PREVIEW_MS)}>Preview</button>)}
                <button type="button" className="tm-pill-btn slp-pl-mv" aria-label={`Move ${t.name} up`} disabled={i === 0} onClick={() => { sfx.hover(); save(moveTrack(l, t.id, -1, today)); }}>↑</button>
                <button type="button" className="tm-pill-btn slp-pl-mv" aria-label={`Move ${t.name} down`} disabled={i === l.tracks.length - 1} onClick={() => { sfx.hover(); save(moveTrack(l, t.id, 1, today)); }}>↓</button>
                {here && ls.squad.can && t.bytes <= SHARE_MAX_MB * 1024 * 1024 && <button type="button" className="tm-pill-btn" onClick={() => { sfx.click(); setSharing(t); }}>Share</button>}
                <button type="button" className={`tm-pill-btn${sure === t.id ? " on" : ""}`} onClick={() => { sfx.click(); if (sure === t.id) { setSure(null); if (playing) stopTest(); removeFile(t.id); } else setSure(t.id); }}>
                  {sure === t.id ? "Delete it?" : "Delete"}</button>
              </span>
            </li>
          );
        })}
      </ol>
      {l.tracks.length < MAX_TRACKS && (
        <button type="button" className="tm-pill-btn" disabled={!!ls.busy} onClick={add}>{ls.busy ?? (l.tracks.length ? "Add more files" : "Add audio files")}</button>
      )}
      <button type="button" className={`tm-pill-btn${libs ? " on" : ""}`} onClick={() => { sfx.click(); setLibs((v) => !v); }}>{libs ? "Close the libraries" : "Libraries to add from"}</button>
      <input ref={file} type="file" accept={LIST_ACCEPT} multiple hidden onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; if (fs.length) void importFiles(fs); }} />
      {ls.note && <span className="slp-set-n slp-own-err" role="status">{ls.note}</span>}
      {sharing && (
        <ShareRow t={sharing} onDone={() => setSharing(null)} />
      )}
      {libs && <div className="slp-pl-libs">
        <span className="slp-set-n slp-pl-h">PS app starter packs</span>
        {ls.starter === null ? <span className="slp-set-n">Looking...</span>
          : !ls.starter.length ? <span className="slp-set-n">None yet. Packs from PS app will show here.</span>
          : ls.starter.map((p) => (
            <div key={p.id} className="slp-pl-pack">
              <span className="slp-pl-t"><b>{p.name}</b><small>{p.files.length} files{p.note ? ` · ${p.note}` : ""}</small></span>
              <button type="button" className="tm-pill-btn" disabled={!!ls.busy} onClick={() => { sfx.click(); void addFromPack(p); }}>Add the whole pack</button>
              <ul className="slp-pl-packfiles">
                {p.files.map((f) => <li key={f.file}><span>{f.name}{f.secs ? <small className="num"> {lenText(f.secs)}</small> : null}</span>
                  {inLib(f.name) ? <small>In your library</small>
                    : <button type="button" className="tm-pill-btn" disabled={!!ls.busy} onClick={() => { sfx.click(); void addFromPack(p, [f.file]); }}>Add</button>}</li>)}
              </ul>
            </div>
          ))}
        <span className="slp-set-n slp-pl-h">From your squad</span>
        {!ls.squad.loaded ? <span className="slp-set-n">Looking...</span>
          : !ls.squad.can ? <span className="slp-set-n">{where === "web" ? "Squad sounds are in PS on the Mac and the phone." : "Squad sounds come with the Soundboard."}</span>
          : !ls.squad.files.length ? <span className="slp-set-n">Nothing shared in your squad yet. Share a file from your library with Share.</span>
          : byPack(ls.squad.files).map((g) => (
            <div key={g.pack} className="slp-pl-pack">
              <span className="slp-pl-t"><b>{g.pack}</b><small>{g.files.length} {g.files.length === 1 ? "file" : "files"}</small></span>
              {g.files.length > 1 && <button type="button" className="tm-pill-btn" disabled={!!ls.busy} onClick={() => { sfx.click(); void addFromSquad(g.files.map((f) => f.id)); }}>Add the whole pack</button>}
              <ul className="slp-pl-packfiles">
                {g.files.map((f) => <li key={f.id}><span>{f.name}<small className="num"> {sizeText(f.size)}{f.by ? ` · ${f.by}` : ""}</small></span>
                  {inLib(f.name) ? <small>In your library</small>
                    : <button type="button" className="tm-pill-btn" disabled={!!ls.busy} onClick={() => { sfx.click(); void addFromSquad([f.id]); }}>Add</button>}</li>)}
              </ul>
            </div>
          ))}
      </div>}
      <span className="slp-set-n">{where === "phone"
        ? "Pick mp3, m4a, wav, aac, flac or ogg files (several at once)."
        : "Drop mp3, m4a, wav, aac, flac or ogg files here, or use Add."}
        {` Up to ${LIST_MAX_MB} MB each and ${MAX_TRACKS} files; a long talk is fine, it plays straight from the file. Tick the files the playlist plays.`}
        {l.on ? " Every alarm on a day plays that day's file, at your alarm loudness, and Stop or Esc ends it." : ""}
        {l.on ? (l.end === "whole" ? " Play the whole file rings until the file ends (at least 10 minutes, at most 3 hours)." : " Loop plays until you stop it.") : ""}</span>
      <span className="slp-set-n">{`The files stay on the device you add them on and are never uploaded, unless you share one with your squad. The library and today's pick are the same on every device, so add the same files on each device you sleep with.${missing ? ` ${missing} of ${l.tracks.length} ${missing === 1 ? "is" : "are"} not on ${HERE[where]} yet.` : ""}`}</span>
    </div>
  );
}

/** Share one library file with the G Squad: a pack name (so others can add it with the rest of that pack), the
 *  copyright line, then the Soundboard's own share seals and uploads it. */
function ShareRow({ t, onDone }: { t: Track; onDone: () => void }) {
  const [pack, setPack] = useState("");
  useOverlay();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onDone(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onDone]);
  return (
    <div className="slp-pl-share" role="group" aria-label={`Share ${t.name}`}>
      <span className="slp-set-n slp-pl-h">Share {t.name} with your squad</span>
      <input type="text" maxLength={60} value={pack} placeholder="Pack name (optional), like Morning fire" aria-label="Pack name" onChange={(e) => setPack(e.target.value)} />
      <span className="slp-set-n">{SHARE_NOTE} It is sealed with your squad's key and leaves after 14 days.</span>
      <button type="button" className="tm-pill-btn" onClick={() => { sfx.click(); void shareToSquad(t, pack); onDone(); }}>Share</button>
      <button type="button" className="tm-pill-btn" onClick={() => { sfx.click(); onDone(); }}>Cancel</button>
    </div>
  );
}

/** The warning before Strobe flash can be switched on. Esc or "Keep it off" leaves it off. */
export function StrobeWarning({ onYes, onNo }: { onYes: () => void; onNo: () => void }) {
  useOverlay();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onNo(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onNo]);
  return createPortal(
    <div className="slp-cust-layer slp-warn-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) onNo(); }}>
      <div className="slp-cust slp-warn" role="alertdialog" aria-label="Strobe flash warning">
        <span className="slp-sheet-t">Photosensitivity warning</span>
        <p className="slp-set-what">{STROBE_WARN}</p>
        <div className="slp-cust-b">
          <button type="button" className="slp-cust-done" onClick={() => { sfx.click(); onNo(); }}>Keep it off</button>
          <button type="button" className="slp-cust-reset" onClick={() => { sfx.click(); onYes(); }}>Switch Strobe flash on</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** V1.47: the sound picker on one alarm (core/sleepmode.ts AlarmSound): the default, the built in sound, your own
 *  sound, the day's playlist file, or any one of the playlist's files. Picking a file you added just works. */
export function SoundPick({ value, onChange, label, wake }: { value: AlarmSound; onChange: (s: AlarmSound) => void; label: string; wake: WakePrefs }) {
  const snd = useAlarmSound();
  const l = wake.list;
  const dflt = l.on && l.tracks.length ? "the playlist" : snd.own ? `your sound, ${snd.own.name}` : "the built in sound";
  return (
    <select className="slp-style slp-sound" value={value} aria-label={label} onChange={(e) => { sfx.hover(); onChange(e.target.value as AlarmSound); }}>
      <option value="auto">Sound: default ({dflt})</option>
      <option value="builtin">Built in sound</option>
      <option value="own">{snd.own ? `Your sound: ${snd.own.name}` : "Your own sound"}</option>
      {l.tracks.length > 0 && <option value="list">Playlist: a different file each day</option>}
      {l.tracks.map((t) => <option key={t.id} value={`t:${t.id}`}>{t.name}</option>)}
    </select>
  );
}

/** The style picker on one alarm (and on "Wake me up in"). */
export function StylePick({ value, onChange, label, strobe }: { value: WakeStyle; onChange: (s: WakeStyle) => void; label: string; strobe: boolean }) {
  return (
    <select className="slp-style" value={value} aria-label={label} onChange={(e) => { sfx.hover(); onChange(e.target.value as WakeStyle); }}>
      {WAKE_STYLES.map((s) => <option key={s} value={s}>{WAKE_NAMES[s]}{s === "strobe" && !strobe ? " (rings as Bright white)" : ""}</option>)}
    </select>
  );
}
export type { RGB };

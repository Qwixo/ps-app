// Tab list, top right (PS only): the volume mixer (the developer, 24 Oct 2026, "like Windows 10's"). One row
// per app making sound: icon, name, a slider from 0 to 150%, Mute and "Keep out of recordings"; a
// master row for the Mac's own volume. Its own gear sets the look, with the rows themselves as the
// live preview. The PS app does the audio (Sources/Mixer.swift) and keeps every level and setting on
// this Mac. Click only, except slider drags.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PS, psPost } from "../ps";
import { sfx } from "../ui/sfx";
import { AirPodsFix } from "./AirPodsFix";
import { HeadphonesSwitch } from "./Headphones";
import { isRedAccount } from "../core/account";
import { vaultStore } from "../core/vault";
import "./mixer.css";
import { appName, macListHint } from "../core/appname";

type Row = { key: string; name: string; icon?: string; instance?: string; playing: boolean; gain: number; muted: boolean; hide: boolean; cant: boolean; adjusted: boolean; meter: number };
type Prefs = { density: "compact" | "roomy"; icons: boolean; slider: "thin" | "thick" | "pill"; color: string; filter: "playing" | "recent"; sort: "name" | "loud"; meters: boolean; opacity: number };
type State = { rows: Row[]; permission: "ok" | "denied" | "unknown"; asked: boolean; prefs: Prefs; hints: string[]; master?: { volume: number; muted: boolean; device: string } };
const DEFAULTS: Prefs = { density: "roomy", icons: true, slider: "thin", color: "#A78BFA", filter: "playing", sort: "name", meters: true, opacity: 0.96 };
const COLORS = ["#A78BFA", "#EC4E86", "#34D399", "#38BDF8", "#FBBF24", "#F4F4F5"];

let state: State | null = null;
const listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  (window as Window & { __psMixer?: unknown }).__psMixer = (m: unknown) => {
    const o = m as Partial<State> | null;
    if (!o || !Array.isArray(o.rows)) return;
    state = { rows: o.rows as Row[], permission: (o.permission as State["permission"]) || "unknown", asked: !!o.asked, prefs: { ...DEFAULTS, ...(o.prefs || {}) }, hints: Array.isArray(o.hints) ? o.hints.filter((h) => typeof h === "string") : [], master: o.master };
    listeners.forEach((l) => l());
  };
}
const send = (m: Record<string, unknown>) => psPost({ type: "mixer", ...m });
function useMixer() { return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state); }
/** macOS's answer for the mixer's permission (the setup menu, views/Welcome.tsx): "ok", "denied", "unknown", or null before PS said. */
export function useMixerPermission() { const st = useMixer(); return st ? st.permission : null; }

function Slider({ value, max, onLive, onDone, label, disabled }: { value: number; max: number; onLive: (v: number) => void; onDone: (v: number) => void; label: string; disabled?: boolean }) {
  const [v, setV] = useState(value);
  const held = useRef(false);
  useEffect(() => { if (!held.current) setV(value); }, [value]);
  return (
    <input type="range" className="mix-range" min={0} max={max} step={1} value={v} aria-label={label} disabled={disabled}
      style={{ ["--pct" as string]: `${(v / max) * 100}%` }}
      onPointerDown={() => { held.current = true; }}
      onChange={(e) => { const n = Number(e.target.value); setV(n); onLive(n); }}
      onPointerUp={(e) => { held.current = false; onDone(Number((e.target as HTMLInputElement).value)); }} />
  );
}

function MixRow({ r, p }: { r: Row; p: Prefs }) {
  const pct = Math.round(r.gain * 100);
  const last = useRef(0);
  const live = (n: number) => { const t = Date.now(); if (t - last.current > 40) { last.current = t; send({ op: "gain", key: r.key, value: n / 100 }); } };
  return (
    <div className={`mix-row${r.playing ? " playing" : ""}${r.muted ? " muted" : ""}`} data-key={r.key}>
      {p.icons && (r.icon ? <img className="mix-ic" src={r.icon} alt="" /> : <span className="mix-ic none" aria-hidden="true">{r.name.slice(0, 1)}</span>)}
      <div className="mix-mid">
        <div className="mix-name"><span className="mix-dot" aria-hidden="true" />{r.name}{r.adjusted && <em>adjusted</em>}</div>
        {r.cant ? (
          <div className="mix-cant">Can't adjust (protected audio). It plays untouched. <button type="button" onClick={() => { sfx.click(); send({ op: "retry", key: r.key }); }}>Try again</button></div>
        ) : (
          <div className="mix-ctl">
            <Slider value={pct} max={150} label={`${r.name} volume`} onLive={live} onDone={(n) => send({ op: "gain", key: r.key, value: n / 100 })} />
            <b className="num mix-v">{pct}%</b>
          </div>
        )}
        {p.meters && r.adjusted && <div className="mix-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round(r.meter * 100))}%` }} /></div>}
      </div>
      <div className="mix-btns">
        <button type="button" className={`mix-b${r.muted ? " on" : ""}`} aria-pressed={r.muted} onClick={() => { sfx.click(); send({ op: "mute", key: r.key, muted: !r.muted }); }}>{r.muted ? "Unmute" : "Mute"}</button>
        <button type="button" className={`mix-b hide${r.hide ? " on" : ""}`} aria-pressed={r.hide} title="You hear it, a recording through a loopback device does not"
          onClick={() => { sfx.click(); send({ op: "hide", key: r.key, hide: !r.hide }); }}>{p.density === "compact" ? "Keep out" : "Keep out of recordings"}</button>
      </div>
    </div>
  );
}

function MixGear({ p, set }: { p: Prefs; set: (x: Partial<Prefs>) => void }) {
  const chip = (on: boolean, label: string, f: () => void) => <button type="button" className={`mix-chip${on ? " on" : ""}`} onClick={() => { sfx.click(); f(); }}>{label}</button>;
  return (
    <div className="mix-gear" role="group" aria-label="Mixer settings">
      <div className="mix-gr"><span>Rows</span>{chip(p.density === "compact", "Compact", () => set({ density: "compact" }))}{chip(p.density === "roomy", "Roomy", () => set({ density: "roomy" }))}</div>
      <div className="mix-gr"><span>Icons</span>{chip(p.icons, "On", () => set({ icons: true }))}{chip(!p.icons, "Off", () => set({ icons: false }))}</div>
      <div className="mix-gr"><span>Slider</span>{chip(p.slider === "thin", "Thin", () => set({ slider: "thin" }))}{chip(p.slider === "thick", "Thick", () => set({ slider: "thick" }))}{chip(p.slider === "pill", "Pill", () => set({ slider: "pill" }))}</div>
      <div className="mix-gr"><span>Colour</span>{COLORS.map((c) => <button key={c} type="button" className={`mix-sw${p.color === c ? " on" : ""}`} style={{ background: c }} aria-label={c} onClick={() => { sfx.click(); set({ color: c }); }} />)}</div>
      <div className="mix-gr"><span>Show</span>{chip(p.filter === "playing", "Playing now", () => set({ filter: "playing" }))}{chip(p.filter === "recent", "All recent", () => set({ filter: "recent" }))}</div>
      <div className="mix-gr"><span>Sort</span>{chip(p.sort === "name", "Name", () => set({ sort: "name" }))}{chip(p.sort === "loud", "Loudness", () => set({ sort: "loud" }))}</div>
      <div className="mix-gr"><span>Meters</span>{chip(p.meters, "On", () => set({ meters: true }))}{chip(!p.meters, "Off", () => set({ meters: false }))}</div>
      <AirPodsFix red={isRedAccount(vaultStore.get())} />
      <div className="mix-gr"><span>See through</span><input type="range" className="mix-range" min={55} max={100} step={1} value={Math.round(p.opacity * 100)} aria-label="Mixer opacity"
        style={{ ["--pct" as string]: `${((p.opacity * 100 - 55) / 45) * 100}%` }} onChange={(e) => set({ opacity: Number(e.target.value) / 100 })} /></div>
    </div>
  );
}

export function MixerButton() {
  const st = useMixer();
  const [open, setOpen] = useState(false);
  const [gear, setGear] = useState(false);
  const [local, setLocal] = useState<Partial<Prefs>>({});
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) { setGear(false); return; }                // it always opens on the rows, its settings closed
    send({ op: "open" });
    const away = (e: MouseEvent) => { if (e.button === 0 && !ref.current?.contains(e.target as Node)) setOpen(false); };
    // V1.41 Esc always backs out (core/escape.ts): the settings first, then the mixer.
    const key = (e: KeyboardEvent) => { if (e.key !== "Escape") return; e.preventDefault(); e.stopImmediatePropagation(); setGear((g) => { if (!g) setOpen(false); return false; }); };
    window.addEventListener("mousedown", away, true);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("mousedown", away, true); window.removeEventListener("keydown", key, true); send({ op: "close" }); };
  }, [open]);
  if (!PS) return null;
  const p: Prefs = { ...DEFAULTS, ...(st?.prefs || {}), ...local };
  const setPrefs = (x: Partial<Prefs>) => { setLocal((o) => ({ ...o, ...x })); send({ op: "prefs", prefs: x }); };
  let rows = (st?.rows || []).filter((r) => p.filter === "recent" || r.playing || r.gain !== 1 || r.muted || r.hide);
  rows = [...rows].sort((a, b) => p.sort === "loud" ? (Number(b.playing) - Number(a.playing)) || (b.meter - a.meter) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
  const needAsk = !!st && st.permission !== "ok" && !st.asked && (st.rows || []).some((r) => r.gain !== 1 || r.muted || r.hide);
  const m = st?.master;
  return (
    <div className={`tm-pop-wrap mix-wrap${open ? " open" : ""}`} ref={ref}>
      <button type="button" className={`tm-pill-btn icon mix-btn${open ? " on" : ""}`} aria-expanded={open} aria-label="Volume mixer" title="Volume mixer"
        onClick={(e) => { if (e.button !== 0) return; sfx.click(); setOpen((x) => !x); }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 4v16M12 4v16M18 4v16" /><circle cx="6" cy="14" r="2.2" fill="currentColor" /><circle cx="12" cy="8" r="2.2" fill="currentColor" /><circle cx="18" cy="16" r="2.2" fill="currentColor" /></svg>
      </button>
      {open && (
        <div className={`tm-pop mix-pop ${p.density} slider-${p.slider}`} role="dialog" aria-label="Volume mixer"
          style={{ ["--mix" as string]: p.color, background: `rgba(28,20,26,${p.opacity})` }}>
          <div className="mix-head"><b>Volume mixer</b>
            <button type="button" className={`mix-gear-btn${gear ? " on" : ""}`} aria-expanded={gear} aria-label="Mixer settings" title="Mixer settings" onClick={() => { sfx.click(); setGear((g) => !g); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
            </button>
          </div>
          {gear && <MixGear p={p} set={setPrefs} />}
          <HeadphonesSwitch />
          {needAsk && (
            <div className="mix-ask" role="alert">
              <b>One question from macOS first</b>
              <span>To turn one app up or down, {appName()} needs macOS's "System Audio Recording" permission. The sound goes straight to your speakers or AirPods: nothing is recorded, saved or sent anywhere.</span>
              <div><button type="button" className="mix-b on" onClick={() => { sfx.click(); send({ op: "allow" }); }}>Continue</button></div>
            </div>
          )}
          {st?.permission === "denied" && st.asked && (
            <div className="mix-ask"><span>macOS said no, so {appName()} can't change app volumes. You can allow {appName()}{macListHint()} in System Settings, Privacy and Security, Screen and System Audio Recording, under System Audio Recording Only.</span></div>
          )}
          {m && (
            <div className="mix-row master">
              {p.icons && <span className="mix-ic none" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 5L6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></svg></span>}
              <div className="mix-mid">
                <div className="mix-name">Mac volume{m.device && <em>{m.device}</em>}</div>
                <div className="mix-ctl">
                  <Slider value={Math.round(m.volume * 100)} max={100} label="Mac volume" onLive={(n) => send({ op: "master", value: n / 100 })} onDone={(n) => send({ op: "master", value: n / 100 })} />
                  <b className="num mix-v">{Math.round(m.volume * 100)}%</b>
                </div>
              </div>
              <div className="mix-btns"><button type="button" className={`mix-b${m.muted ? " on" : ""}`} onClick={() => { sfx.click(); send({ op: "master", muted: !m.muted }); }}>{m.muted ? "Unmute" : "Mute"}</button></div>
            </div>
          )}
          <div className="mix-list">
            {rows.length ? rows.map((r) => <MixRow key={r.key} r={r} p={p} />) : <span className="tm-pop-note">{st ? (p.filter === "playing" ? "No app is playing sound right now." : "No apps have played sound lately.") : "Loading…"}</span>}
          </div>
          {(st?.hints || []).map((h, i) => <span key={i} className="mix-hint">{h}</span>)}
          <span className="tm-pop-note">1Password and Signal are never touched. Nothing is recorded or saved.</span>
        </div>
      )}
    </div>
  );
}

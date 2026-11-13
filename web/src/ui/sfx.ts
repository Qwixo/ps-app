// Small game-menu sounds for the Tab list: a soft tick on hover, a click on press, a chime on
// ticking a task off. Made on the fly with Web Audio (no sound files). Volume comes from
// Settings (tmSound, 0 = off).
import { nativeTickName, tonesOf, type TickSoundId } from "../core/ticksound";
import { noteSampleName, noteSoundTones, type NoteSoundId } from "../core/notelook";
import { ISLAND_TONES } from "../core/islandtimers";
import { EDIT_SOUNDS, editSoundOk, type EditSound, type EditTone } from "../core/editsounds";

let ctx: AudioContext | null = null;
let volume = 0.4;
let lastHover = 0;

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const C = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      ctx = new C({ latencyHint: "interactive" });
    }
    // "suspended" until allowed, "interrupted" after the page was hidden (WebKit): wake it up.
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

/** Wake the audio before the first hover: on Tab, on the PS list showing, on the page becoming
 *  visible. A silent blip unlocks it, so the very first hover tick plays straight away. */
export function primeSfx() {
  // V1.47: on the phone, making the audio engine the first time took the whole tap (the Gym button's pop up waited
  // for it). The phone needs no tap to allow sound (ps-gos WebHost: mediaPlaybackRequiresUserGesture off), so it
  // is made once the page is idle instead, and a tap never waits for it.
  if (!ctx && import.meta.env.MODE === "gos") { idleAudio(); return; }
  primeSfxNow();
}
let idleAsked = false;
function idleAudio() {
  if (idleAsked || ctx) return;
  idleAsked = true;
  const make = () => { if (!ctx) primeSfxNow(); };
  const ric = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(make, { timeout: 3000 }); else window.setTimeout(make, 1200);
}
function primeSfxNow() {
  const a = ac();
  if (!a) return;
  try {
    const b = a.createBuffer(1, 1, 22050), src = a.createBufferSource();
    src.buffer = b; src.connect(a.destination); src.start(0);
  } catch { /* ignore */ }
}
if (typeof document !== "undefined") {
  // The phone: ready a few seconds after start, when nothing else is happening (see primeSfx).
  if (import.meta.env.MODE === "gos") window.setTimeout(idleAudio, 2500);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && ctx) primeSfx(); });
  // Every touch: the phone only needs it when the audio was stopped (no silent blip on every tap there).
  window.addEventListener("pointerdown", () => { if (ctx && (import.meta.env.MODE !== "gos" || ctx.state !== "running")) primeSfx(); }, { capture: true, passive: true });
}
export function setSfxVolume(percent: number) { volume = Math.max(0, Math.min(1, percent / 100)); }
/** V1.56: the shared audio context and the volume, for sounds made elsewhere (ui/phonesfx.ts, the phone editor's zoom). */
export function sfxAudio(): { a: AudioContext | null; v: number } { return { a: volume > 0 ? ac() : null, v: volume }; }

// Inside PS the Mac app plays the sounds itself: a floating window that never takes focus is
// exactly where browser audio refuses to start, so the page just asks the app.
type W = Window & { webkit?: { messageHandlers?: { ps?: { postMessage(m: string): void } } } };
const native = () => (import.meta.env.MODE === "ps" ? (window as W).webkit?.messageHandlers?.ps : undefined);
function viaApp(name: string) {
  const h = native();
  if (!h) return false;
  if (volume > 0) { try { h.postMessage(JSON.stringify({ type: "sfx", name, vol: volume })); } catch { /* ignore */ } }
  return true;
}

function tone(freq: number, dur: number, peak: number, type: OscillatorType, at = 0, slideTo?: number) {
  const a = ac();
  if (!a || volume <= 0) return;
  const t0 = a.currentTime + at;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * volume), t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

// Soft filtered noise (the Edit overview's whooshes, core/editsounds.ts wave 3): a band that slides from f to `to`,
// swelling in over its first third, then fading. One short noise buffer, made once.
let noiseBuf: AudioBuffer | null = null;
function noise(freq: number, dur: number, peak: number, at = 0, slideTo?: number) {
  const a = ac();
  if (!a || volume <= 0) return;
  if (!noiseBuf) {
    noiseBuf = a.createBuffer(1, Math.floor(a.sampleRate * 0.5), a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = a.currentTime + at;
  const src = a.createBufferSource(); src.buffer = noiseBuf;
  const bp = a.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(freq, t0);
  if (slideTo) bp.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * volume * 2.2), t0 + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(a.destination);
  src.start(t0); src.stop(t0 + dur + 0.02);
}
// When the Edit sounds may play (core/editsounds.ts editSoundOk): set by the list each time it draws.
let editCtx = { on: true, dndMutesSounds: false, meetingNow: false };
export function setEditSoundCtx(c: typeof editCtx) { editCtx = c; }
/** Play one (preview: even while the switch is still off, the moment it is being turned on). */
export function editSfx(name: EditSound, preview = false) {
  if (!editSoundOk({ ...editCtx, on: editCtx.on || preview, volume })) return;
  if (viaApp(name)) return;
  for (const t of EDIT_SOUNDS[name] as EditTone[]) {
    if (t.wave === 3) noise(t.f, t.dur, t.peak, t.at, t.to);
    else tone(t.f, t.dur, t.peak, t.wave === 0 ? "sine" : t.wave === 1 ? "triangle" : "square", t.at, t.to);
  }
}

// The tick sound the developer chose (core/ticksound.ts, Settings, To do list), set by the list each time it draws.
let tickSound: TickSoundId = "classic";
export function setTickSound(id: TickSoundId) { tickSound = id; }
function playTick(id: TickSoundId) {
  const name = nativeTickName(id);
  if (!name) return;
  if (viaApp(name)) return;
  for (const t of tonesOf(id)) tone(t.f, t.dur, t.peak, t.wave === 0 ? "sine" : t.wave === 1 ? "triangle" : "square", t.at, t.to);
}

export const sfx = {
  /** Mouse moves onto a new task. */
  hover() {
    const now = performance.now();
    if (now - lastHover < 45) return;
    lastHover = now;
    if (viaApp("hover")) return;
    tone(2400, 0.028, 0.10, "triangle", 0, 1700);
  },
  /** Mouse press on a task. */
  click() {
    if (viaApp("click")) return;
    tone(1300, 0.04, 0.22, "square", 0, 700);
    tone(160, 0.05, 0.25, "sine", 0);
  },
  /** A task ticked off. */
  done() { playTick(tickSound); },
  /** Settings: hear one tick sound (the play button beside each). */
  tickPreview(id: TickSoundId) { primeSfx(); playTick(id); },
  /** Settings, Notifications: hear one card sound (PS plays its own copy by the native name, core/notelook.ts). */
  notePreview(id: NoteSoundId) {
    primeSfx();
    if (viaApp(noteSampleName(id))) return;
    for (const t of noteSoundTones(id)) tone(t.f, t.dur, t.peak, t.wave === 0 ? "sine" : t.wave === 1 ? "triangle" : "square", t.at, t.to);
  },
  /** A dragged task dropped into its new place. */
  drop() { if (viaApp("drop")) return; tone(520, 0.06, 0.2, "triangle", 0, 780); },
  /** A suggestion dropped onto the list: a soft round plop. */
  plop() {
    if (viaApp("plop")) return;
    tone(420, 0.11, 0.32, "sine", 0, 140);
    tone(900, 0.03, 0.08, "triangle", 0.005, 600);
  },
  /** The island timers (V1.58, core/islandtimers.ts): "done" with the green tick, "start" as a takeover begins. PS plays its own copy. */
  island(kind: "done" | "start") {
    primeSfx();
    if (viaApp(`island-${kind}`)) return;
    for (const t of ISLAND_TONES[kind]) tone(t.f, t.dur, t.peak, t.wave === 0 ? "sine" : "triangle", t.at, t.to);
  },
  /** Settings preview. */
  test() { this.hover(); window.setTimeout(() => this.click(), 160); },
};

// ---------- thunder for the lightning backgrounds (website; PS plays its own, see Sfx.swift) ----------
// Filtered noise: a crack (close strikes), a roll, or a far rumble. Never more than one at a time,
// never sudden (it swells in), never louder than the volume the developer set, capped well below full.
let thunderUntil = 0;
export function thunder(name: string, vol: number) {
  const a = ac();
  if (!a || vol <= 0 || a.currentTime < thunderUntil) return;
  const spec = name === "thunder-crack" ? { dur: 2.6, attack: 0.03, lp: 1400, crack: true }
    : name === "thunder-far" ? { dur: 3.6, attack: 0.5, lp: 260, crack: false } : { dur: 3.0, attack: 0.25, lp: 520, crack: false };
  const t0 = a.currentTime + 0.02, len = Math.floor(a.sampleRate * spec.dur);
  const buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6 * (1 + 0.5 * Math.sin(i / a.sampleRate * 9)); }
  const src = a.createBufferSource(); src.buffer = buf;
  const lp = a.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = spec.lp;
  const g = a.createGain(), peak = Math.min(0.6, vol) * 0.7;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + spec.attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.dur);
  src.connect(lp).connect(g).connect(a.destination);
  src.start(t0); src.stop(t0 + spec.dur + 0.05);
  if (spec.crack) {   // a short bright crackle on top
    const c = a.createBufferSource(), cb = a.createBuffer(1, Math.floor(a.sampleRate * 0.25), a.sampleRate), cd = cb.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (a.sampleRate * 0.05));
    c.buffer = cb;
    const hp = a.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1800;
    const cg = a.createGain(); cg.gain.value = peak * 0.5;
    c.connect(hp).connect(cg).connect(a.destination);
    c.start(t0);
  }
  thunderUntil = t0 + spec.dur;
}

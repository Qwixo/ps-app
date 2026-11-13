// The alarm's sound on this device (V1.44; the rules and the maths in core/alarmsound.ts):
//  - Your own sound. On a Mac PS picks and keeps the file itself (ps-mac Sources/SleepSound.swift: "sleep:sound:pick",
//    "sleep:sound:remove"); on the phone and in a browser this page reads the file, makes it one channel at the one
//    level, and keeps the WAV: the phone in its own app folder ("sleep:sound:save", ps-gos Sleep.kt), a browser in
//    this browser's own storage (IndexedDB). It never goes to the vault or anywhere else: it stays on that device.
//  - Test: plays exactly what an alarm plays (your own sound, else the style's built in one) at the level it rings.
//    On a Mac or the phone the shell plays it and sets the device volume like a real alarm, then puts it back
//    ("sleep:test", "sleep:testStop"); in a browser this page plays it. Test stops by itself after TEST_FOR, and Esc
//    and Stop stop it at once.
// The shell's answers come back as {own, testing} (window.__psAlarm on a Mac, {type:"sleep:sound"} on the phone).
import { useSyncExternalStore } from "react";
import { PS, psPost } from "../ps";
import { GOS, gosPost, onShell } from "../gos/bridge";
import { OWN_RATE, RATE, TEST_FOR, builtInSound, checkOwnFile, cleanOwn, okLevel, ownName, ownSound, ringLevel, wavSamples, type BuiltIn, type OwnSound } from "../core/alarmsound";
import { WAKE_SPEC, ringVolume, type WakeStyle } from "../core/sleepwake";
import { fadeAt } from "../core/alarmlist";
import { webFileUrl } from "./list";

const WHERE: "mac" | "phone" | "web" = PS ? "mac" : GOS ? "phone" : "web";
export interface AlarmSoundState {
  own: OwnSound | null;     // your own sound on this device
  testing: WakeStyle | null;   // Test (or a Preview's sound) is playing
  testTrack: string | null;    // V1.47: the playlist file Test or its Preview is playing
  busy: boolean;            // a file is being read
  note: string | null;      // a plain sentence after a pick that did not work
}
let st: AlarmSoundState = { own: null, testing: null, testTrack: null, busy: false, note: null };
const subs = new Set<() => void>();
function set(p: Partial<AlarmSoundState>) { st = { ...st, ...p }; subs.forEach((f) => f()); }
export function useAlarmSound(): AlarmSoundState {
  start();
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);
}
export const alarmSoundNow = () => st;

// ---------- the shell's answers ----------
function fromShell(m: Record<string, unknown>) {
  const p: Partial<AlarmSoundState> = {};
  if ("own" in m) p.own = cleanOwn(m.own);
  if ("testing" in m && !m.testing) { p.testing = null; p.testTrack = null; window.clearTimeout(testEnd); }
  if (typeof m.error === "string") { p.note = m.error.slice(0, 200); p.busy = false; }
  if (m.saved === true || "own" in m) p.busy = false;
  set(p);
}
let started = false;
function start() {
  if (started) return;
  started = true;
  if (WHERE === "mac") {
    (window as Window & { __psAlarm?: (m: Record<string, unknown>) => void }).__psAlarm = (m) => { if (m && typeof m === "object") fromShell(m); };
    psPost({ type: "sleep:sound:get" });
  } else if (WHERE === "phone") {
    onShell((m) => { if (m.type === "sleep:sound") fromShell(m); });
    gosPost({ type: "sleep:sound:get" });
  } else void webLoad();
}

// ---------- your own sound ----------
/** The Mac picks the file itself (PS's own Open panel). Elsewhere the page's file picker hands a File to importOwn. */
export const picksNatively = () => WHERE === "mac";
export function pickOwnOnMac() { set({ note: null, busy: true }); psPost({ type: "sleep:sound:pick" }); window.setTimeout(() => { if (st.busy) set({ busy: false }); }, 120_000); }
/** A file picked on the phone or in a browser: checked, read, made one channel at the one level, kept on this device. */
export async function importOwn(file: File): Promise<void> {
  set({ note: null });
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ok = checkOwnFile(file.name, file.size, head);
  if (!ok.ok) { set({ note: ok.why }); return; }
  set({ busy: true });
  try {
    // Decoded at OWN_RATE (the browser converts the rate), so a minute is under 4 MB.
    const buf = await new OfflineAudioContext(1, 1, OWN_RATE).decodeAudioData(await file.arrayBuffer());
    const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    const s = ownSound(chans, buf.sampleRate);
    if (!s) { set({ busy: false, note: "That file has no sound in it PS app can hear." }); return; }
    const own = { name: ownName(file.name), secs: s.secs };
    if (WHERE === "phone") gosPost({ type: "sleep:sound:save", name: own.name, secs: own.secs, b64: b64(s.wav) });
    else { await webSave(own, s.wav); set({ own, busy: false }); }
  } catch {
    set({ busy: false, note: "PS app could not read that file. Try an mp3, m4a or wav." });
  }
}
export function removeOwn() {
  stopTest();
  if (WHERE === "mac") psPost({ type: "sleep:sound:remove" });
  else if (WHERE === "phone") gosPost({ type: "sleep:sound:remove" });
  else { void webSave(null, null); ownBuf = null; }
  set({ own: null, note: null });
}
export const clearAlarmNote = () => { if (st.note) set({ note: null }); };
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

// A browser keeps it in its own storage (one record), nowhere else.
const DB = "ps-alarm-sound";
function db(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("s"); };
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
let ownBuf: { x: Float32Array; rate: number } | null = null;
async function webSave(own: OwnSound | null, wav: Uint8Array | null) {
  ownBuf = wav ? wavSamples(wav) : null;
  try {
    const d = await db();
    await new Promise<void>((ok, no) => {
      const t = d.transaction("s", "readwrite");
      if (own && wav) t.objectStore("s").put({ own, wav }, "own"); else t.objectStore("s").delete("own");
      t.oncomplete = () => ok(); t.onerror = () => no(t.error);
    });
    d.close();
  } catch { /* private browsing: it lasts while the page is open */ }
}
async function webLoad() {
  try {
    const d = await db();
    const v = await new Promise<unknown>((ok, no) => { const r = d.transaction("s").objectStore("s").get("own"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    d.close();
    const o = v as { own?: unknown; wav?: Uint8Array } | undefined;
    const own = cleanOwn(o?.own);
    if (own && o?.wav instanceof Uint8Array) { ownBuf = wavSamples(o.wav); if (ownBuf) set({ own }); }
  } catch { /* none */ }
}

// ---------- playing in this page (a browser; the Mac and phone shells play their own) ----------
/** One alarm sound at a time in this page: your own sound if this browser has one, else the style's built in one,
 *  looping, at `ringVolume(style) x level` (a test: at the full ring level at once). */
/** V1.47: a playlist file to play instead (this browser's copy of it): fading in over `fade` seconds, looping or once
 *  (`onEnd` when a whole file has played). A browser without the file plays the usual sound. */
export interface PageTrack { id: string; fade: number; loop: boolean; onEnd?: () => void }
export function pagePlayer() {
  let ctx: AudioContext | null = null, gain: GainNode | null = null, src: AudioBufferSourceNode | null = null, rise = 0;
  let el: HTMLAudioElement | null = null, url = "", gen = 0;
  const live = () => {
    if (!ctx || ctx.state === "closed") { ctx = new AudioContext(); gain = ctx.createGain(); gain.connect(ctx.destination); }
    void ctx.resume().catch(() => {});
    return ctx;
  };
  const bufferFor = (c: AudioContext, kind: BuiltIn, builtin = false): AudioBuffer => {
    const s = (builtin ? null : ownBuf) ?? { x: builtInSound(kind, c.sampleRate || RATE), rate: c.sampleRate || RATE };
    const b = c.createBuffer(1, Math.max(1, s.x.length), s.rate);
    b.copyToChannel(s.x as Float32Array<ArrayBuffer>, 0);
    return b;
  };
  const stop = () => {
    gen++;
    window.clearInterval(rise); rise = 0; try { src?.stop(); } catch { /* done */ } src = null;
    if (el) { el.onended = null; el.pause(); el.removeAttribute("src"); el = null; }
    if (url) { URL.revokeObjectURL(url); url = ""; }
  };
  /** V1.47 `builtin`: the built in sound even when this browser has your own (an alarm set to Built in sound). */
  const play = (style: WakeStyle, level: number, test = false, track?: PageTrack | null, builtin = false) => {
    stop();
    const spec = WAKE_SPEC[style] ?? WAKE_SPEC.chime;
    if (spec.sound === "none") return;
    if (track && WHERE === "web") {
      const g = gen;
      void webFileUrl(track.id).then((u) => {
        if (g !== gen) { if (u) URL.revokeObjectURL(u); return; }
        if (!u) { play(style, level, test, null); return; }
        url = u;
        const top = ringLevel(spec.loud, level), t0 = Date.now();
        const v = () => Math.max(0, Math.min(1, (test ? 1 : ringVolume(style, Date.now() - t0) * (spec.loud ? 1 : fadeAt(Date.now() - t0, track.fade))) * top));
        const a = new Audio(u);
        a.loop = track.loop; a.volume = v();
        a.onended = () => { if (g === gen) track.onEnd?.(); };
        el = a;
        void a.play().catch(() => { if (g === gen) play(style, level, test, null); });
        rise = window.setInterval(() => { if (el) el.volume = v(); }, 500);
      });
      return;
    }
    try {
      const c = live();
      const top = ringLevel(spec.loud, level), t0 = Date.now();
      const v = () => (test ? 1 : ringVolume(style, Date.now() - t0)) * top;
      gain!.gain.value = v();
      src = c.createBufferSource(); src.buffer = bufferFor(c, spec.sound as BuiltIn, builtin); src.loop = true; src.connect(gain!); src.start();
      if (!test) rise = window.setInterval(() => { if (gain && ctx) gain.gain.setTargetAtTime(v(), ctx.currentTime, 0.2); }, 1000);
    } catch { /* no sound in this browser */ }
  };
  const prime = () => { try { live(); } catch { /* none */ } };
  const close = () => { stop(); const c = ctx; ctx = null; gain = null; void c?.close().catch(() => {}); };
  return { play, stop, prime, close };
}

// ---------- Test ----------
let page: ReturnType<typeof pagePlayer> | null = null;
let testEnd = 0;
/** Plays what an alarm in `style` plays at the level it rings, for TEST_FOR at most. */
/** V1.47: `track` plays that playlist file instead (Test with a playlist on: today's file; a file's own Preview), for
 *  `ms`. An older shell ignores `track` and plays the usual sound. */
export function testSound(style: WakeStyle, level: number, track?: string | null, ms = TEST_FOR) {
  stopTest();
  if (WAKE_SPEC[style]?.sound === "none") return;
  set({ testing: style, testTrack: track ?? null });
  const lv = okLevel(level);
  const t = track ? { track } : {};
  if (WHERE === "mac") psPost({ type: "sleep:test", style, level: lv, ms, ...t });
  else if (WHERE === "phone") gosPost({ type: "sleep:test", style, level: lv, ms, ...t });
  else { page ??= pagePlayer(); page.play(style, lv, true, track ? { id: track, fade: 0, loop: false, onEnd: stopTest } : null); }
  testEnd = window.setTimeout(stopTest, ms);
}
export function stopTest() {
  window.clearTimeout(testEnd);
  if (!st.testing) return;
  if (WHERE === "mac") psPost({ type: "sleep:testStop" });
  else if (WHERE === "phone") gosPost({ type: "sleep:testStop" });
  else page?.stop();
  set({ testing: null, testTrack: null });
}

// The Annoying 15 min reminders' sounds and Test, on this device (rules in core/remind.ts, sound maths in
// core/alarmsound.ts, the same one level as the V1.44 alarm).
//  - Your own sound, one per reminder, stays on the device that picked it (never in the vault, never synced): a Mac
//    picks and keeps the file itself ("rem:sound:pick", ps-mac Reminders.swift), the phone and a browser read it here
//    and keep the WAV (the phone in its own app folder, "rem:sound:save", ps-gos Remind.kt; a browser in IndexedDB).
//    A device without one plays the soft chime for that reminder.
//  - Test: shows the reminder right now as it will pop up (the Mac's card, the phone's notification, a card in this
//    page on the website) and plays its sound once. Its buttons only close it; Esc, Stop and 15 seconds end it.
// The shell's answers come back as {own, error} (window.__psRemSound on a Mac, {type:"rem:sound"} on the phone).
import { useSyncExternalStore } from "react";
import { PS, psPost } from "./ps";
import { GOS, gosPost, onShell } from "./gos/bridge";
import { OWN_RATE, RATE, builtInSound, checkOwnFile, cleanOwn, ownName, ownSound, wavSamples, type BuiltIn, type OwnSound } from "./core/alarmsound";
import type { PlanItem } from "./core/remind";

const WHERE: "mac" | "phone" | "web" = PS ? "mac" : GOS ? "phone" : "web";
export const TEST_MS = 15_000;
export interface RemSoundState {
  own: Record<string, OwnSound>;   // your own sound per reminder id, on this device
  busy: string | null;             // the reminder whose file is being read
  note: { id: string; text: string } | null;
  testing: PlanItem | null;        // the reminder being tested right now
}
let st: RemSoundState = { own: {}, busy: null, note: null, testing: null };
const subs = new Set<() => void>();
function set(p: Partial<RemSoundState>) { st = { ...st, ...p }; subs.forEach((f) => f()); }
export function useRemSound(): RemSoundState {
  start();
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);
}
export const remSoundWhere = WHERE;

function cleanOwnMap(v: unknown): Record<string, OwnSound> {
  const out: Record<string, OwnSound> = {};
  if (!v || typeof v !== "object") return out;
  for (const [id, o] of Object.entries(v as Record<string, unknown>).slice(0, 40)) { const c = cleanOwn(o); if (c && /^[a-z0-9]{1,16}$/.test(id)) out[id] = c; }
  return out;
}
function fromShell(m: Record<string, unknown>) {
  const p: Partial<RemSoundState> = {};
  if ("own" in m) { p.own = cleanOwnMap(m.own); p.busy = null; }
  if (typeof m.error === "string") p.note = { id: typeof m.id === "string" ? m.id : st.busy ?? "", text: m.error.slice(0, 200) }, p.busy = null;
  set(p);
}
let started = false;
function start() {
  if (started) return;
  started = true;
  if (WHERE === "mac") {
    (window as Window & { __psRemSound?: (m: Record<string, unknown>) => void }).__psRemSound = (m) => { if (m && typeof m === "object") fromShell(m); };
    psPost({ type: "rem:sound:get" });
  } else if (WHERE === "phone") {
    onShell((m) => { if (m.type === "rem:sound") fromShell(m); });
    gosPost({ type: "rem:sound:get" });
  } else void webLoad();
}

// ---------- your own sound ----------
export const picksNatively = () => WHERE === "mac";
export function pickOnMac(id: string) {
  set({ note: null, busy: id });
  psPost({ type: "rem:sound:pick", id });
  window.setTimeout(() => { if (st.busy === id) set({ busy: null }); }, 120_000);
}
/** A file picked on the phone or in a browser: checked, read, made one channel at the one level, kept on this device. */
export async function importOwn(id: string, file: File): Promise<void> {
  set({ note: null });
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ok = checkOwnFile(file.name, file.size, head);
  if (!ok.ok) { set({ note: { id, text: ok.why } }); return; }
  set({ busy: id });
  try {
    const buf = await new OfflineAudioContext(1, 1, OWN_RATE).decodeAudioData(await file.arrayBuffer());
    const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    const s = ownSound(chans, buf.sampleRate);
    if (!s) { set({ busy: null, note: { id, text: "That file has no sound in it PS app can hear." } }); return; }
    const own = { name: ownName(file.name), secs: s.secs };
    if (WHERE === "phone") gosPost({ type: "rem:sound:save", id, name: own.name, secs: own.secs, b64: b64(s.wav) });
    else { await webSave(id, own, s.wav); set({ own: { ...st.own, [id]: own }, busy: null }); }
  } catch {
    set({ busy: null, note: { id, text: "PS app could not read that file. Try an mp3, m4a or wav." } });
  }
}
export function removeOwn(id: string) {
  if (WHERE === "mac") psPost({ type: "rem:sound:remove", id });
  else if (WHERE === "phone") gosPost({ type: "rem:sound:remove", id });
  else { void webSave(id, null, null); webBufs.delete(id); }
  const own = { ...st.own }; delete own[id];
  set({ own, note: null });
}
export const clearNote = () => { if (st.note) set({ note: null }); };
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

// A browser keeps them in its own storage (one record per reminder), nowhere else.
const DB = "ps-rem-sound";
function db(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("s"); };
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
}
const webBufs = new Map<string, { x: Float32Array; rate: number }>();
async function webSave(id: string, own: OwnSound | null, wav: Uint8Array | null) {
  if (wav) { const s = wavSamples(wav); if (s) webBufs.set(id, s); }
  try {
    const d = await db();
    await new Promise<void>((ok, no) => {
      const t = d.transaction("s", "readwrite");
      if (own && wav) t.objectStore("s").put({ own, wav }, id); else t.objectStore("s").delete(id);
      t.oncomplete = () => ok(); t.onerror = () => no(t.error);
    });
    d.close();
  } catch { /* private browsing: it lasts while the page is open */ }
}
async function webLoad() {
  try {
    const d = await db();
    const all = await new Promise<{ k: IDBValidKey; v: unknown }[]>((ok, no) => {
      const out: { k: IDBValidKey; v: unknown }[] = [];
      const r = d.transaction("s").objectStore("s").openCursor();
      r.onsuccess = () => { const c = r.result; if (c) { out.push({ k: c.key, v: c.value }); c.continue(); } else ok(out); };
      r.onerror = () => no(r.error);
    });
    d.close();
    const own: Record<string, OwnSound> = {};
    for (const { k, v } of all) {
      const o = v as { own?: unknown; wav?: Uint8Array } | undefined, c = cleanOwn(o?.own);
      if (typeof k === "string" && c && o?.wav instanceof Uint8Array) { const s = wavSamples(o.wav); if (s) { webBufs.set(k, s); own[k] = c; } }
    }
    set({ own });
  } catch { /* none */ }
}

// ---------- Test ----------
let ctx: AudioContext | null = null, src: AudioBufferSourceNode | null = null, endT = 0;
function pagePlay(item: PlanItem) {
  pageStop();
  if (item.sound === "none") return;
  try {
    if (!ctx || ctx.state === "closed") ctx = new AudioContext();
    void ctx.resume().catch(() => {});
    const own = item.sound === "own" ? webBufs.get(item.id) : undefined;
    const s = own ?? { x: builtInSound((item.sound === "alarm" ? "alarm" : "soft") as BuiltIn, ctx.sampleRate || RATE), rate: ctx.sampleRate || RATE };
    const b = ctx.createBuffer(1, Math.max(1, s.x.length), s.rate);
    b.copyToChannel(s.x as Float32Array<ArrayBuffer>, 0);
    const g = ctx.createGain(); g.gain.value = item.vol; g.connect(ctx.destination);
    src = ctx.createBufferSource(); src.buffer = b; src.connect(g); src.start();
  } catch { /* no sound in this browser */ }
}
function pageStop() { try { src?.stop(); } catch { /* done */ } src = null; }
/** Shows the reminder now and plays its sound once (never saved, its buttons only close it). */
export function testReminder(item: PlanItem) {
  stopTest(true);
  set({ testing: item });
  if (WHERE === "mac") psPost({ type: "rem:test", item });
  else if (WHERE === "phone") gosPost({ type: "rem:test", item });
  else pagePlay(item);
  endT = window.setTimeout(() => stopTest(), TEST_MS);
}
export function stopTest(quiet = false) {
  window.clearTimeout(endT);
  if (!st.testing) return;
  if (WHERE === "mac") psPost({ type: "rem:testStop" });
  else if (WHERE === "phone") gosPost({ type: "rem:testStop" });
  else pageStop();
  if (!quiet) set({ testing: null }); else st = { ...st, testing: null };
}
/** The Mac's test card was closed on the card itself (its buttons or Esc). */
export function testEnded() { window.clearTimeout(endT); if (st.testing) set({ testing: null }); }
if (WHERE === "mac") (window as Window & { __psRemTestEnd?: () => void }).__psRemTestEnd = testEnded;

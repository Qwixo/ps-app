// The Soundboard's player (V1.47): ONE <video> element for audio and video, so a song and a film share the queue and
// moving the preview (top right, the big top middle view, full screen) never restarts what is playing. The screen
// lends it a place (mount); with nowhere to be it waits in a hidden holder. Nothing plays in the background unless
// "Keep playing when the Soundboard is closed" is on (store prefs.keep): closing stops and frees the file.
import { useSyncExternalStore } from "react";
import { current, step, playNow, playList, type Queue } from "../core/soundboard";
import { mediaUrl, sbState, setPrefs, say, loopMaxMs } from "./store";
import type { TimedPlay } from "../core/soundboard";

export interface PlayerState { media: string | null; playing: boolean; time: number; dur: number; loading: boolean; failed: boolean; ring: boolean }
let ps: PlayerState = { media: null, playing: false, time: 0, dur: 0, loading: false, failed: false, ring: false };
const subs = new Set<() => void>();
function set(p: Partial<PlayerState>) { ps = { ...ps, ...p }; subs.forEach((f) => f()); }
export const usePlayer = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => ps);
export const playerState = () => ps;

let el: HTMLVideoElement | null = null;
let holder: HTMLDivElement | null = null;
let lastTick = 0;
function media(): HTMLVideoElement {
  if (el) return el;
  el = document.createElement("video");
  el.className = "sb-media";
  el.playsInline = true;
  el.preload = "metadata";
  el.setAttribute("playsinline", "");
  el.disablePictureInPicture = true;
  el.addEventListener("play", () => set({ playing: true }));
  el.addEventListener("pause", () => set({ playing: false }));
  el.addEventListener("loadedmetadata", () => set({ dur: Number.isFinite(el!.duration) ? el!.duration : 0, loading: false }));
  el.addEventListener("waiting", () => set({ loading: true }));
  el.addEventListener("playing", () => set({ loading: false, failed: false }));
  el.addEventListener("timeupdate", () => { const now = performance.now(); if (now - lastTick > 240) { lastTick = now; set({ time: el!.currentTime }); } });
  el.addEventListener("ended", () => { if (ps.ring) { if (ringLoop) { el!.currentTime = 0; void el!.play().catch(() => {}); } else endRing(); return; } go(1, true); });
  el.addEventListener("error", () => { if (!el!.getAttribute("src")) return; set({ failed: true, loading: false, playing: false }); say("This file cannot play here. It may be a format this device does not play.", true); });
  park();
  applyVolume();
  return el;
}
function park() {
  if (!el) return;
  if (!holder) { holder = document.createElement("div"); holder.className = "sb-holder"; holder.setAttribute("aria-hidden", "true"); document.body.appendChild(holder); }
  if (el.parentElement !== holder) holder.appendChild(el);
}
/** The screen's preview box takes the element; the returned function gives it back. */
export function mount(box: HTMLElement): () => void {
  const v = media();
  box.appendChild(v);
  return () => { if (v.parentElement === box) park(); };
}
export function applyVolume() {
  if (!el || ps.ring) return;
  const { vol, muted } = sbState().prefs;
  el.volume = vol; el.muted = muted;
}

// ---------- the queue ----------
function q(): Queue { return sbState().prefs.queue; }
async function load(autoplay: boolean) {
  const v = media();
  const e = current(q());
  const it = e ? sbState().lib.items.find((i) => i.id === e.media) : null;
  if (!it) { stop(); return; }
  if (ps.media !== it.id || !v.getAttribute("src")) {
    const url = await mediaUrl(it);
    if (!url) { say("That file is not on this device any more.", true); return; }
    set({ media: it.id, time: 0, dur: 0, loading: true, failed: false });
    v.src = url;
  }
  if (autoplay) await v.play().catch(() => set({ playing: false, loading: false }));
}
function setQ(n: Queue) { setPrefs({ queue: n }); }
export function play(id: string) {
  endRing(); setQ(playNow(q(), id));
  if (ps.media === id && el) el.currentTime = 0;   // the same file again: from the start
  void load(true);
}
export function playAll(ids: string[], start = 0) { endRing(); setQ(playList(q(), ids, start)); void load(true); }
/** A tap on a queue row. */
export function jump(index: number) { const n = q(); if (index < 0 || index >= n.items.length) return; setQ({ ...n, at: index }); void load(true); }
export function go(dir: 1 | -1, ended = false) {
  // Previous: more than 3 seconds in, it starts this one again first (every player does that).
  if (dir === -1 && el && el.currentTime > 3) { el.currentTime = 0; return; }
  const r = step(q(), dir, ended);
  if (!r.play) { if (ended) { set({ playing: false }); if (el) el.currentTime = 0; } return; }
  const same = r.q.at === q().at;
  setQ(r.q);
  if (same && el) { el.currentTime = 0; void el.play().catch(() => {}); return; }
  void load(true);
}
export function toggle() {
  const v = media();
  if (!current(q())) return;
  if (!v.getAttribute("src")) { void load(true); return; }
  if (v.paused) void v.play().catch(() => {}); else v.pause();
}
export function seek(t: number) { if (el && Number.isFinite(t)) { el.currentTime = Math.max(0, Math.min(t, ps.dur || t)); set({ time: el.currentTime }); } }
export function nudge(secs: number) { if (el) seek(el.currentTime + secs); }
/** Stops and frees the file (closing the Soundboard without Keep playing, or the last file was removed). */
export function stop() {
  if (!el) return;
  el.pause();
  el.removeAttribute("src");
  el.load();
  set({ media: null, playing: false, time: 0, dur: 0, loading: false });
}
/** Ready the current queue entry without playing (opening the Soundboard shows what was last on). */
export function prime() { if (!ps.media && current(q())) void load(false); }

// ---------- a timed play rung by this page (the website; the Mac and the phone ring natively) ----------
let ringLoop = false, ringT = 0;
window.addEventListener("ps-sb-ring", (e) => {
  const p = (e as CustomEvent<TimedPlay>).detail;
  const it = sbState().lib.items.find((i) => i.id === p.media);
  if (!it) return;
  const v = media();
  void mediaUrl(it).then((url) => {
    if (!url) return;
    ringLoop = p.loop;
    set({ ring: true, media: it.id, time: 0, dur: 0 });
    v.src = url; v.volume = p.vol; v.muted = false;
    void v.play().catch(() => say("The browser blocked the sound. Click anywhere on the page once so it may play.", true));
    window.clearTimeout(ringT);
    ringT = window.setTimeout(endRing, p.loop ? loopMaxMs : 30 * 60_000);
  });
});
window.addEventListener("ps-sb-ring-stop", () => endRing());
function endRing() {
  if (!ps.ring) return;
  window.clearTimeout(ringT);
  set({ ring: false });
  stop();
  applyVolume();
  if (sbState().ring?.by === "page") window.dispatchEvent(new Event("ps-sb-ring-ended"));
}

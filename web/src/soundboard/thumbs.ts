// Lazy tile pictures for the Soundboard (V1.47): a frame for a video, a waveform for an audio file, and each one's
// length. Only for tiles on screen (the grid asks as they scroll in), ONE at a time in the background, kept on this
// device (IndexedDB) so each file is read once. A big audio file (over WAVE_MAX) gets no waveform: decoding it would
// cost too much memory on the phone. Nothing here ever plays a sound (decodeAudioData only reads).
import { useEffect, useState } from "react";
import type { MediaItem } from "../core/soundboard";
import { metaGet, metaPut, thumbUrl } from "./store";

export interface Thumb { pic?: string; wave?: number[]; dur?: number; none?: boolean }
const WAVE_MAX = 12 * 1024 * 1024, BARS = 36;
const mem = new Map<string, Thumb>();
const waiting = new Map<string, Set<(t: Thumb) => void>>();
const queue: MediaItem[] = [];
let busy = false;

export function useThumb(it: MediaItem, seen: boolean): Thumb | null {
  const [t, setT] = useState<Thumb | null>(() => mem.get(it.id) ?? null);
  useEffect(() => {
    if (!seen || mem.has(it.id)) { if (mem.has(it.id)) setT(mem.get(it.id)!); return; }
    const f = (x: Thumb) => setT(x);
    let s = waiting.get(it.id);
    if (!s) { s = new Set(); waiting.set(it.id, s); }
    s.add(f);
    if (!queue.some((x) => x.id === it.id)) { queue.push(it); void pump(); }
    return () => { s!.delete(f); if (!s!.size) { waiting.delete(it.id); const i = queue.findIndex((x) => x.id === it.id); if (i >= 0) queue.splice(i, 1); } };
  }, [it.id, seen]);
  return t;
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const it = queue.shift()!;
      let t = await metaGet<Thumb>(`t:${it.id}`);
      if (!t) {
        t = await make(it).catch(() => ({ none: true }) as Thumb);
        void metaPut(`t:${it.id}`, t);
      }
      mem.set(it.id, t);
      waiting.get(it.id)?.forEach((f) => f(t!));
      waiting.delete(it.id);
      await new Promise((r) => setTimeout(r, 30));   // the page stays smooth between files
    }
  } finally { busy = false; }
}

async function make(it: MediaItem): Promise<Thumb> {
  const src = await thumbUrl(it);
  if (!src) return { none: true };
  try { return it.kind === "video" ? await frame(src.url) : await wave(src.url, it.size); }
  finally { src.free(); }
}
function frame(url: string): Promise<Thumb> {
  return new Promise((res) => {
    const v = document.createElement("video");
    v.muted = true; v.preload = "metadata"; v.playsInline = true;
    let done = false;
    const end = (t: Thumb) => { if (done) return; done = true; window.clearTimeout(timer); v.removeAttribute("src"); v.load(); res(t); };
    const timer = window.setTimeout(() => end({ none: true }), 9000);
    v.addEventListener("loadedmetadata", () => { const d = v.duration; v.currentTime = Number.isFinite(d) ? Math.min(2, d * 0.15) : 0.5; });
    v.addEventListener("seeked", () => {
      try {
        const w = 256, h = Math.round(w * (v.videoHeight / Math.max(1, v.videoWidth))) || 144;
        const c = document.createElement("canvas");
        c.width = w; c.height = Math.min(h, 256);
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
        end({ pic: c.toDataURL("image/jpeg", 0.72), dur: Number.isFinite(v.duration) ? v.duration : undefined });
      } catch { end({ dur: Number.isFinite(v.duration) ? v.duration : undefined }); }
    });
    v.addEventListener("error", () => end({ none: true }));
    v.src = url;
  });
}
async function wave(url: string, size: number): Promise<Thumb> {
  const dur = await new Promise<number | undefined>((res) => {
    const a = document.createElement("audio");
    a.preload = "metadata";
    const t = window.setTimeout(() => res(undefined), 6000);
    a.addEventListener("loadedmetadata", () => { window.clearTimeout(t); res(Number.isFinite(a.duration) ? a.duration : undefined); a.removeAttribute("src"); a.load(); });
    a.addEventListener("error", () => { window.clearTimeout(t); res(undefined); });
    a.src = url;
  });
  if (size > WAVE_MAX || typeof OfflineAudioContext === "undefined") return { dur };
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    const ctx = new OfflineAudioContext(1, 1, 22050);
    const audio = await ctx.decodeAudioData(buf);
    const ch = audio.getChannelData(0), step = Math.max(1, Math.floor(ch.length / BARS));
    const bars: number[] = [];
    let top = 0;
    for (let b = 0; b < BARS; b++) {
      let p = 0;
      for (let i = b * step, end = Math.min(ch.length, i + step); i < end; i += 16) { const a = Math.abs(ch[i]); if (a > p) p = a; }
      bars.push(p); if (p > top) top = p;
    }
    return { wave: bars.map((p) => Math.round((top > 0 ? p / top : 0) * 100) / 100), dur: dur ?? audio.duration };
  } catch { return { dur }; }
}

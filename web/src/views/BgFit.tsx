// The phone's own background and how a video fits the phone (V1.47, core/bgcrop.ts has the rules and the maths).
// Kept out of TaskMap.tsx (like BgBright.tsx) so the list file only gains a few lines:
//  - PhoneBgChoice: Settings, Appearance, Background on a phone: "Same as my Mac" or "Its own".
//  - BgFitControls: Fill or Fit, Zoom, the bars, and "Pick the part to show" (the editor below).
//  - BgClip: what the list draws round the video on a phone (the crop, the bars behind it).
//  - useBgKeeper: keeps the phone's background video playing (core/bgwatch.ts decides, this acts and logs).
// Nothing here runs on the Mac: every part is used only where PHONE_BG is true.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Settings } from "../core/model";
import { bgDesign, isVideoBg } from "../core/prio";
import { ZOOM_MAX, ZOOM_MIN, barColour, bgKey, cropCss, cropFor, cropWindow, defaultCrop, dragFocus, hasBars, phoneBg, phoneOwn, sameCrop, tapFocus, withCrop, type BgBars, type BgCrop, type Size } from "../core/bgcrop";
import { look, newWatch, type Watch } from "../core/bgwatch";
import { useVaultVideos } from "../core/bgvault";
import { gosPost } from "../gos/bridge";
import { sfx } from "../ui/sfx";
import { deviceShown, thisDevId, tickMode } from "../devicebgnow";
import { withPick } from "../core/devicebg";
import { bgDevices } from "../core/select";
import { vaultStore } from "../core/vault";
import { useBgVideos } from "../ps";

/** A phone: PS GOS, or the iPhone web app (src/mobile/boot.ts sets the flag before any of this loads). */
export const PHONE_BG = import.meta.env.MODE === "gos" || (globalThis as { __psMobile?: unknown }).__psMobile === true;
export const isBg = (v: string) => bgDesign(v) === v;

/** The background this device shows (the phone's own once it has one). */
export function shownBg(st: Settings): string | null | undefined {   // PS 1.65: this device's own pick first (core/devicebg.ts), else what it always showed
  return deviceShown(st.tmBgDev, isBg, PHONE_BG ? phoneBg(st, isBg) : st.tmBg);
}
/** A background picked on this device: saved where this device reads it. PS 1.65 (core/devicebg.ts): once the account has a
 *  second device (or a device pick already), a pick is this device's own pick, so the others keep theirs; Settings, Looks
 *  then lets the person tick more devices. Before that, or with the feature off, exactly as before. */
export function bgPatch(st: Settings, id: string): Partial<Settings> {
  const picks = st.tmBgDev;
  if (tickMode(bgDevices(vaultStore.get()).length, picks, isBg)) return { tmBgDev: withPick(picks, thisDevId(), id) };
  return { [bgKey(st, PHONE_BG, isBg)]: id };
}

/** One line in the phone's log (PS GOS writes it to its own log file; the iPhone web app has none). */
export function logBg(text: string) { if (import.meta.env.MODE === "gos") gosPost({ type: "log", text: `bg video: ${text}` }); }

// ---------- the crop the list draws (the saved one, or the automatic one) ----------
/** The crop for a background on this phone, null on the Mac (the Mac draws the video as before). */
export function usePhoneCrop(st: Settings, bg: string): BgCrop | null {
  const { list } = useVaultVideos();
  if (!PHONE_BG || !isVideoBg(bg)) return null;
  const focus = list.find((v) => `video:${v.id}` === bg)?.focus ?? 0.5;
  return cropFor(st.tmBgCrop, bg, focus);
}

function screenSize(): Size { return { w: Math.max(1, window.innerWidth), h: Math.max(1, window.innerHeight) }; }
function useScreen(): Size {
  const [s, setS] = useState(screenSize);
  useEffect(() => { const f = () => setS(screenSize()); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  return s;
}
function mediaOf(el: HTMLVideoElement | null): Size | null {
  return el && el.videoWidth > 0 && el.videoHeight > 0 ? { w: el.videoWidth, h: el.videoHeight } : null;
}

/** Round the video on a phone: clips the zoom, and draws the bars behind a Fit (blurred, black or the video's own
 *  colour). The blurred bars are a tiny canvas (32 px wide) copied from the video four times a second while it plays,
 *  then blurred by the GPU: no second video, no second decoder. */
export function BgClip({ crop, video, on, children, className }: { crop: BgCrop; video: RefObject<HTMLVideoElement | null>; on: boolean; children: ReactNode; className?: string }) {
  const screen = useScreen();
  const [media, setMedia] = useState<Size | null>(null);
  const [colour, setColour] = useState("#000000");
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const got = () => { const m = mediaOf(el); if (m) setMedia((o) => (o && o.w === m.w && o.h === m.h ? o : m)); };
    got();
    el.addEventListener("loadedmetadata", got);
    return () => el.removeEventListener("loadedmetadata", got);
  }, [video]);
  const bars = !!media && hasBars(media, screen, crop) ? crop.bars : null;
  // The video's own colour: one small sample once its first frame is in.
  useEffect(() => {
    const el = video.current;
    if (bars !== "colour" || !el) return;
    const take = () => {
      try {
        const c = document.createElement("canvas"); c.width = 8; c.height = 8;
        const g = c.getContext("2d", { willReadFrequently: true });
        if (!g || el.readyState < 2) return;
        g.drawImage(el, 0, 0, 8, 8);
        setColour(barColour(g.getImageData(0, 0, 8, 8).data));
      } catch { /* a frame that can not be read: black stays */ }
    };
    take();
    el.addEventListener("loadeddata", take);
    return () => el.removeEventListener("loadeddata", take);
  }, [bars, video]);
  // The blurred bars: only while shown and playing.
  useEffect(() => {
    const el = video.current, c = cv.current;
    if (bars !== "blur" || !on || !el || !c || !media) return;
    const w = 32, h = Math.max(1, Math.round((32 * media.h) / media.w));
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    const draw = () => { if (!g || el.paused || el.readyState < 2 || document.visibilityState === "hidden") return; try { g.drawImage(el, 0, 0, w, h); } catch { /* next time */ } };
    draw();
    const t = window.setInterval(draw, 250);
    return () => window.clearInterval(t);
  }, [bars, on, media, video]);
  return (
    <div className={`tm-bgvideo-clip${className ? ` ${className}` : ""}`} aria-hidden="true"
      style={bars === "black" ? { background: "#000" } : bars === "colour" ? { background: colour } : undefined}>
      {bars === "blur" && <canvas ref={cv} className="tm-bgvideo-blur" />}
      {children}
    </div>
  );
}

// ---------- keeping the video going (core/bgwatch.ts) ----------
/** Looks at the video once a second while it should be playing and acts: play() a pause nobody asked for, reload
 *  after an error or a frozen frame, and log each try and the recovery. Off while hidden (nothing runs then). */
export function useBgKeeper(video: RefObject<HTMLVideoElement | null>, o: { on: boolean; ready: boolean; id: string; reload: () => void }) {
  const w = useRef<Watch>(newWatch(Date.now()));
  const reload = useRef(o.reload);
  reload.current = o.reload;
  useEffect(() => {
    const el = video.current;
    if (!o.on || !el) return;
    const onErr = () => { const e = el.error; if (e && el.getAttribute("src")) logBg(`player error ${e.code}${e.message ? ` (${e.message.slice(0, 60)})` : ""} on ${o.id}`); };
    el.addEventListener("error", onErr);
    const tick = () => {
      const wanted = document.visibilityState !== "hidden";
      const r = look(w.current, { wanted, ready: o.ready, paused: el.paused, error: el.error?.code ?? 0, t: el.currentTime }, Date.now());
      w.current = r.w;
      const a = r.act;
      if (a.kind === "play") { logBg(`${a.why} on ${o.id}: play again (try ${r.w.tries})`); void el.play().catch(() => {}); }
      else if (a.kind === "reload") { logBg(`${a.why} on ${o.id}: reloading (try ${r.w.tries})`); reload.current(); }
      else if (a.kind === "recovered") logBg(`recovered on ${o.id} after ${a.why}, ${Math.round(a.ms / 100) / 10} s, ${a.tries} ${a.tries === 1 ? "try" : "tries"}`);
    };
    const t = window.setInterval(tick, 1000);
    return () => { window.clearInterval(t); el.removeEventListener("error", onErr); };
  }, [o.on, o.ready, o.id, video]);
}

// ---------- Settings, Appearance, Background on a phone ----------
function Seg({ on, pick, children, title }: { on: boolean; pick: () => void; children: ReactNode; title?: string }) {
  return <button type="button" role="radio" aria-checked={on} title={title} className={`dwell${on ? " on" : ""}`} onClick={() => { if (!on) { sfx.click(); pick(); } }}>{children}</button>;
}

/** "Same as my Mac" or "Its own": the phone keeps showing the Mac's background until the developer picks its own. */
export function PhoneBgChoice({ st, set }: { st: Settings; set: (p: Partial<Settings>) => void }) {
  if (!PHONE_BG) return null;
  const own = phoneOwn(st, isBg);
  const mac = bgDesign(st.tmBg);
  return (
    <section className="ms-sec ms-storm ms-phonebg" data-set="phone-bg">
      <h3 className="ms-h">This phone</h3>
      <div className="tm-ed-seg ms-seg" role="radiogroup" aria-label="This phone's background">
        <Seg on={!own} pick={() => set({ tmBgPhone: null })} title="Shows whatever your Mac shows">Same as my Mac</Seg>
        <Seg on={own} pick={() => set({ tmBgPhone: mac })} title="Pick below; your Mac keeps its own">Its own</Seg>
      </div>
      <p className="ms-note">{own ? "Pick this phone's background below. Your Macs keep theirs." : "Your phone shows your Mac's background, and a pick below changes both. Pick Its own to choose one just for this phone."}</p>
    </section>
  );
}

/** Fill or Fit, Zoom, the bars and the editor, for the video this phone shows. Saved per video, synced. */
export function BgFitControls({ st, set }: { st: Settings; set: (p: Partial<Settings>) => void }) {
  const bg = bgDesign(shownBg(st));
  const crop = usePhoneCrop(st, bg);
  const { list } = useVaultVideos();
  const here = useBgVideos();   // the videos on this phone (none in the iPhone web app yet)
  const [zoom, setZoom] = useState(crop?.zoom ?? 1);
  const [editing, setEditing] = useState(false);
  useEffect(() => { setZoom(crop?.zoom ?? 1); }, [crop?.zoom]);
  const file = here.find((v) => `video:${v.id}` === bg);
  if (!PHONE_BG || !crop || !isVideoBg(bg) || !file) return null;
  const auto = defaultCrop(list.find((v) => `video:${v.id}` === bg)?.focus ?? 0.5);
  const save = (c: BgCrop | null) => set({ tmBgCrop: withCrop(st.tmBgCrop, bg, c && !sameCrop(c, auto) ? c : null, list.length ? list.map((v) => v.id) : undefined) });
  const put = (p: Partial<BgCrop>) => save({ ...crop, ...p });
  const bars: [BgBars, string][] = [["blur", "Blurred"], ["black", "Black"], ["colour", "Its colour"]];
  return (
    <section className="ms-sec ms-storm ms-bgfit" data-set="phone-fit">
      <h3 className="ms-h">Fit on this phone</h3>
      <p className="ms-changes">How this video fills your phone. Only your phones; your Macs show it as before.</p>
      <div className="tm-ed-seg ms-seg" role="radiogroup" aria-label="How the video fits">
        <Seg on={crop.mode === "fill"} pick={() => put({ mode: "fill" })} title="Crops the sides so it fills the screen">Fill</Seg>
        <Seg on={crop.mode === "fit"} pick={() => put({ mode: "fit" })} title="The whole video, with bars above and below">Fit</Seg>
      </div>
      <div className="tm-pop-row ms-slider"><span className="tm-pop-note tm-look-l">Zoom</span>
        <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.05} value={zoom} className="tm-pop-range" aria-label="Background video zoom"
          onChange={(e) => setZoom(Number(e.target.value))} onPointerUp={() => put({ zoom })} onKeyUp={() => put({ zoom })} />
        <b className="num tm-pop-v">{zoom.toFixed(1)}x</b></div>
      {crop.mode === "fit" && (
        <>
          <h3 className="ms-h ms-h-sub">Bars</h3>
          <div className="tm-ed-seg ms-seg" role="radiogroup" aria-label="The bars beside the video">
            {bars.map(([id, label]) => <Seg key={id} on={crop.bars === id} pick={() => put({ bars: id })}>{label}</Seg>)}
          </div>
        </>
      )}
      <div className="ms-fit-btns">
        <button type="button" className="btn sm" onClick={() => { sfx.click(); setEditing(true); }}>Pick the part to show</button>
        {!sameCrop(crop, auto) && <button type="button" className="btn quiet sm" onClick={() => { sfx.click(); save(null); }}>Automatic</button>}
      </div>
      <p className="ms-note">{crop.mode === "fill" ? "Drag the picture in Pick the part to show to choose what stays on screen." : "The whole video shows; drag it up or down in Pick the part to show."}</p>
      {editing && <BgCropEditor id={file.file ?? file.id} crop={crop} auto={auto} onClose={() => setEditing(false)} onSave={(c) => { save(c); setEditing(false); }} />}
    </section>
  );
}

// ---------- Pick the part to show ----------
/** A full screen editor: the top is the phone's screen in small, at its real shape, playing the video exactly as the
 *  background will (drag it, pinch to zoom); under it the whole video with the part that shows marked (tap or drag
 *  there too). Nothing is saved until Save. One video plays while it is open; the background behind is hidden. */
function BgCropEditor({ id, crop, auto, onClose, onSave }: { id: string; crop: BgCrop; auto: BgCrop; onClose: () => void; onSave: (c: BgCrop) => void }) {
  const [c, setC] = useState(crop);
  const screen = useScreen();
  const v = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLCanvasElement>(null);
  const [media, setMedia] = useState<Size | null>(null);
  // Esc (a keyboard on the phone) closes it like the back gesture (the developer: every pop-up closes on Esc).
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); onClose(); } };
    // The phone's back gesture (src/gos/touch.ts) asks our own layers first: this one closes, the screen behind stays.
    const b = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); onClose(); };
    addEventListener("keydown", k, true);
    addEventListener("gos-back", b, true);
    return () => { removeEventListener("keydown", k, true); removeEventListener("gos-back", b, true); };
  }, [onClose]);
  useEffect(() => {
    const el = v.current;
    if (!el) return;
    const got = () => setMedia(mediaOf(el));
    el.addEventListener("loadedmetadata", got);
    return () => { el.removeEventListener("loadedmetadata", got); el.pause(); el.removeAttribute("src"); el.load(); };
  }, []);
  // The whole video, copied small into the strip a few times a second while the editor is open.
  useEffect(() => {
    const el = v.current, cv = strip.current;
    if (!el || !cv || !media) return;
    cv.width = 160; cv.height = Math.max(1, Math.round((160 * media.h) / media.w));
    const g = cv.getContext("2d");
    const draw = () => { if (g && el.readyState >= 2) try { g.drawImage(el, 0, 0, cv.width, cv.height); } catch { /* next time */ } };
    draw();
    const t = window.setInterval(draw, 120);
    return () => window.clearInterval(t);
  }, [media]);
  // Dragging the preview moves the picture with the finger; two fingers zoom.
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const boxSize = (): Size => { const r = box.current?.getBoundingClientRect(); return { w: r?.width || 1, h: r?.height || 1 }; };
  const down = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2) { const [a, b] = [...pts.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: c.zoom }; }
  };
  const move = (e: React.PointerEvent) => {
    const was = pts.current.get(e.pointerId);
    if (!was || !media) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 2 && pinch.current) {
      const [a, b] = [...pts.current.values()];
      const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinch.current.z * ((Math.hypot(a.x - b.x, a.y - b.y) || 1) / pinch.current.d)));
      setC((o) => ({ ...o, zoom: Math.round(z * 100) / 100 }));
      return;
    }
    const dx = e.clientX - was.x, dy = e.clientY - was.y;
    setC((o) => ({ ...o, ...dragFocus(media, boxSize(), o, dx, dy) }));
  };
  const up = (e: React.PointerEvent) => { pts.current.delete(e.pointerId); if (pts.current.size < 2) pinch.current = null; };
  // A tap or drag on the whole video puts that spot in the middle.
  const onStrip = (e: React.PointerEvent) => {
    if (!media || (e.type === "pointermove" && e.buttons === 0)) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setC((o) => ({ ...o, ...tapFocus(media, screen, o, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height) }));
  };
  const win = media ? cropWindow(media, screen, c) : null;
  const cl = (n: number) => Math.max(0, Math.min(1, n));
  const mark = win ? { left: cl(win.left), top: cl(win.top), right: cl(win.left + win.w), bottom: cl(win.top + win.h) } : null;
  // The preview is the phone's screen in small: its real shape, as tall as fits above the controls.
  const ph = Math.min(screen.h * 0.44, 460), pw = (ph * screen.w) / screen.h;
  return createPortal(
    <div className="bgx-scrim" role="dialog" aria-modal="true" aria-label="Pick the part to show">
      <div className="bgx">
        <div className="bgx-top">
          <button type="button" className="btn quiet sm" onClick={() => { sfx.click(); onClose(); }}>Cancel</button>
          <b className="bgx-title">Pick the part to show</b>
          <button type="button" className="btn sm" onClick={() => { sfx.click(); onSave(c); }}>Save</button>
        </div>
        <div ref={box} className="bgx-phone" style={{ width: pw, height: ph }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <BgClip crop={c} video={v} on className="bgx-clip">
            <video ref={v} className="tm-bgvideo bgx-video" src={`/client/bg/${id}.mp4`} style={cropCss(c)} muted loop playsInline autoPlay preload="auto" />
          </BgClip>
          <span className="bgx-hint" aria-hidden="true">Drag to move, pinch to zoom</span>
        </div>
        <div className="bgx-whole" onPointerDown={onStrip} onPointerMove={onStrip}>
          <canvas ref={strip} className="bgx-strip" />
          {mark && <i className="bgx-mark" style={{ left: `${mark.left * 100}%`, top: `${mark.top * 100}%`, width: `${(mark.right - mark.left) * 100}%`, height: `${(mark.bottom - mark.top) * 100}%` }} />}
        </div>
        <div className="bgx-row">
          <div className="tm-ed-seg ms-seg" role="radiogroup" aria-label="How the video fits">
            <Seg on={c.mode === "fill"} pick={() => setC({ ...c, mode: "fill" })}>Fill</Seg>
            <Seg on={c.mode === "fit"} pick={() => setC({ ...c, mode: "fit" })}>Fit</Seg>
          </div>
          <label className="bgx-zoom"><span>Zoom</span>
            <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.05} value={c.zoom} className="tm-pop-range" aria-label="Zoom"
              onChange={(e) => setC({ ...c, zoom: Number(e.target.value) })} />
            <b className="num">{c.zoom.toFixed(1)}x</b></label>
        </div>
        {c.mode === "fit" && (
          <div className="tm-ed-seg ms-seg bgx-row" role="radiogroup" aria-label="The bars beside the video">
            {([["blur", "Blurred"], ["black", "Black"], ["colour", "Its colour"]] as [BgBars, string][]).map(([b, label]) => <Seg key={b} on={c.bars === b} pick={() => setC({ ...c, bars: b })}>{label}</Seg>)}
          </div>
        )}
        <button type="button" className="btn quiet sm bgx-auto" onClick={() => { sfx.click(); setC(auto); }}>Back to automatic</button>
      </div>
    </div>,
    document.body,
  );
}

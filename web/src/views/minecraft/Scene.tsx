// <McScene/>: the background of Minecraft mode (the developer, 4 Nov 2026). A drawn blocky world (or the developer's own picture under
// a measured dark overlay) with a crew of three electricians who run in on every open and then fix a sparking pole
// forever, grunting now and then. Works with no internet: everything is drawn and synthesized here.
//
// Mount it as the first child of the panel, inside an element that is position: relative (it fills it):
//   <div className="mcm-theme" data-mcm-theme="auto" style={{ position: "relative" }}>
//     <McScene active={open} dnd={st.dnd} events={calendarSnap(s)?.data.events} />
//     ...panel content (keep text above var(--mcs-crew-h) from the bottom, or on an .mcm-panel)...
//   </div>
//
// It stops completely (no animation frames, no audio) when `active` is false, the page is hidden, or the box is
// off screen. It is silent when muted (remembered), while PS Do Not Disturb is on, or while a meeting is live.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import "./mc-theme.css";
import { dndActive, type Dnd } from "../../core/dnd";
import type { CalEvent } from "../../core/model";
import { McPainter, type McEvent, type McTheme } from "./scene-draw.ts";
import { McAudio } from "./mc-audio.ts";
import { meetingLive, mcRunState, readMuted, writeMuted } from "./scene-logic.ts";
import { clearOwnBg, loadOwnBg, measureOverlay, onOwnBgChange, saveOwnBg } from "./own-bg.ts";
import { memoOf, planOpen, pushHistory, readHistory, type OpenPlan } from "./crew-plan.ts";

export interface McSceneProps {
  /** The panel is open and showing. False stops everything. Turning it back on replays the run in. */
  active?: boolean;
  /** "auto" follows the system light or dark setting. */
  theme?: "auto" | McTheme;
  /** PS Do Not Disturb (settings.dnd). While it is on the crew is silent. */
  dnd?: Dnd | null;
  /** The calendar's events (calendarSnap(s)?.data.events). While a timed one is live the crew is silent. */
  events?: CalEvent[] | null;
  /** Override: a meeting is live (when the host knows better than the calendar). */
  meeting?: boolean;
  /** Extra silence for the host's own reasons. */
  quiet?: boolean;
  /** Show the mute and background buttons (bottom left). */
  controls?: boolean;
  className?: string;
  /** Tells the host how tall the crew strip is (CSS px), so it can keep text clear of it. */
  onCrewHeight?: (px: number) => void;
  /** Dev and screenshots only: freeze on this moment (ms after the open), no frames, no sound. */
  freezeAt?: number;
  /** Dev and screenshots only: a fixed seed (the same open every time), and parts of the plan forced. */
  seed?: number;
  force?: Partial<OpenPlan>;
}

const mq = (q: string) => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(q) : null);
function useMedia(q: string): boolean {
  return useSyncExternalStore(
    (f) => { const m = mq(q); m?.addEventListener?.("change", f); return () => m?.removeEventListener?.("change", f); },
    () => !!mq(q)?.matches,
    () => false,
  );
}
function useDocVisible(): boolean {
  return useSyncExternalStore(
    (f) => { document.addEventListener("visibilitychange", f); return () => document.removeEventListener("visibilitychange", f); },
    () => document.visibilityState !== "hidden",
    () => true,
  );
}
const store = () => { try { return window.localStorage; } catch { return null; } };

export function McScene({ active = true, theme = "auto", dnd, events, meeting, quiet, controls = true, className, onCrewHeight, freezeAt, seed, force }: McSceneProps) {
  const root = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const painter = useRef<McPainter | null>(null);
  const audio = useRef<McAudio | null>(null);

  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const sysDark = useMedia("(prefers-color-scheme: dark)");
  const docVisible = useDocVisible();
  const [onScreen, setOnScreen] = useState(true);
  const [muted, setMuted] = useState(() => readMuted(store()));
  const [own, setOwn] = useState<string | null>(null);
  const [ov, setOv] = useState<{ alpha: number; contrast: number }>({ alpha: 0.6, contrast: 0 });
  const [err, setErr] = useState("");
  const [crewH, setCrewH] = useState(0);
  const look: McTheme = theme === "auto" ? (sysDark ? "dark" : "light") : theme;

  // Do Not Disturb and live meetings, from the host's data. Checked again every 30 s while open (a DND end time
  // or a meeting start passes without the host re-rendering).
  const [tick, setTick] = useState(0);
  useEffect(() => { if (!active) return; const i = window.setInterval(() => setTick((n) => n + 1), 30_000); return () => window.clearInterval(i); }, [active]);
  const dndOn = useMemo(() => dndActive(dnd), [dnd, tick]);
  const meetOn = useMemo(() => (typeof meeting === "boolean" ? meeting : meetingLive(events)), [meeting, events, tick]);

  const frozen = typeof freezeAt === "number";
  const run = mcRunState({ active: active && !frozen, docVisible, onScreen, muted, dnd: dndOn, meeting: meetOn, hostQuiet: quiet, reducedMotion: reduced });
  const runRef = useRef(run); runRef.current = run;

  // Make the painter once.
  useEffect(() => {
    if (!cv.current) return;
    painter.current = new McPainter(cv.current);
    audio.current = new McAudio();
    return () => { audio.current?.close(); audio.current = null; painter.current = null; };
  }, []);

  // Size: the pixel canvas follows the box.
  useEffect(() => {
    const el = root.current, p = painter.current;
    if (!el || !p) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      if (!p.resize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1))) return;
      const h = Math.round(p.crewCssHeight());
      setCrewH(h);
      if (!runRef.current.animate) p.frame(0); // a still picture when nothing runs
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    const io = new IntersectionObserver((es) => setOnScreen(es.some((e) => e.isIntersecting)), { threshold: 0 });
    io.observe(el);
    return () => { ro.disconnect(); io.disconnect(); };
  }, []);
  useEffect(() => { onCrewHeight?.(crewH); }, [crewH, onCrewHeight]);

  // Look changes (theme, own background, reduced motion).
  useEffect(() => {
    const p = painter.current; if (!p) return;
    p.setLook(look, !!own, reduced);
    setCrewH(Math.round(p.crewCssHeight()));
    if (!runRef.current.animate) p.frame(0);
  }, [look, own, reduced]);

  // Every open: a fresh plan (who comes first, who trips, which beats, maybe an argument or a surprise), different
  // from the last few opens, which are remembered on this device. Reduced motion: they are already at work.
  const planNow = (): OpenPlan => {
    const sd = typeof seed === "number" ? seed : (Math.random() * 2 ** 32) >>> 0;
    const plan = { ...planOpen(sd, readHistory(store()), reduced), ...(force || {}) };
    if (typeof seed !== "number") pushHistory(store(), memoOf(plan));
    return plan;
  };
  useEffect(() => {
    const p = painter.current; if (!p || frozen || !active) return;
    p.restart(planNow(), reduced);
    if (!runRef.current.animate) p.frame(0);
  }, [active, frozen, reduced]);
  // Screenshots: replay the scene to one moment, frame by frame, then draw that frame once.
  useEffect(() => {
    const p = painter.current; if (!p || !frozen) return;
    p.restart(planNow(), reduced);
    const step = 1000 / 24;
    let t = 0;
    for (; t + step <= freezeAt!; t += step) p.frame(step, false);
    p.frame(Math.max(0.001, freezeAt! - t));
    (window as unknown as { __mcStatus?: unknown }).__mcStatus = p.status(); // dev and screenshots only
  }, [frozen, freezeAt, reduced, look, own, crewH, seed, JSON.stringify(force || null)]);

  // The loop. Only while animating; capped frames a second; dt capped so a stall never jumps the crew.
  useEffect(() => {
    if (!run.animate) { audio.current?.hush(); return; }
    // Paced by a timer, drawn in an animation frame: the page wakes about `fps` times a second, not 60 or 120.
    let raf = 0, timer = 0, last = 0;
    const step = 1000 / run.fps;
    const loop = (now: number) => {
      const began = performance.now();
      const dt = last ? Math.min(now - last, 120) : 0;
      last = now;
      const p = painter.current;
      if (p && dt > 0) {
        const ev = p.frame(dt);
        if (ev.length && runRef.current.audio) play(ev);
      }
      timer = window.setTimeout(() => { raf = requestAnimationFrame(loop); }, Math.max(0, step - (performance.now() - began) - 10)); // only our own work counts; the frame wait adds the rest
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(timer); };
  }, [run.animate, run.fps]);
  useEffect(() => { if (!run.audio) audio.current?.hush(); }, [run.audio]);

  const play = (ev: McEvent[]) => {
    const a = audio.current; if (!a) return;
    for (const e of ev) {
      if (e.type === "hit") { a.clink(e.big ? 1.2 : e.zap ? 1 : 0.8, e.big ? 0.7 : 1); if (e.zap) a.zap(e.big ? 1.3 : 1); }
      else if (e.type === "tap") { if (Math.random() < 0.5) a.clink(0.35, 1.45); }
      else if (e.type === "grunt") a.grunt(e.who, e.kind, e.vol);
      else if (e.type === "spark") a.zap(e.vol);
      else if (e.type === "thud") a.thud(1);
    }
  };

  // Your own background: load it, follow changes, measure the overlay on its real pixels.
  useEffect(() => {
    let url: string | null = null, gone = false;
    const load = async () => {
      const b = await loadOwnBg();
      if (gone) return;
      if (url) URL.revokeObjectURL(url);
      url = b ? URL.createObjectURL(b.blob) : null;
      setOwn(url);
    };
    void load();
    const off = onOwnBgChange(() => void load());
    return () => { gone = true; off(); if (url) URL.revokeObjectURL(url); };
  }, []);
  const measure = () => {
    const el = root.current, im = img.current;
    if (!el || !im || !own || !im.complete || !im.naturalWidth) return;
    const r = el.getBoundingClientRect();
    setOv(measureOverlay(im, r.width, r.height, crewH));
  };
  useEffect(() => { measure(); }, [own, crewH]);

  const toggleMute = () => {
    const m = !muted; setMuted(m); writeMuted(store(), m);
    if (!m) audio.current?.unlock();
  };
  const pick = async (f: File | undefined) => {
    setErr("");
    if (!f) return;
    try { await saveOwnBg(f); } catch (e) { setErr(e instanceof Error ? e.message : "PS app could not use that picture."); }
  };

  const why = run.quietWhy;
  const muteTitle = muted ? "Sound off. Click for the crew's noises"
    : why === "dnd" ? "Quiet: Do Not Disturb is on"
    : why === "meeting" ? "Quiet: a meeting is live"
    : why === "host" ? "Quiet for now"
    : "Sound on. Click to mute";

  return (
    <div ref={root} className={`mcs-root${className ? ` ${className}` : ""}`} data-mcm-theme={look} data-own={own ? "1" : undefined}
      data-run={run.animate ? "on" : "off"} data-audio={run.audio ? "on" : "off"} data-quiet={why || undefined}
      data-contrast={own ? ov.contrast.toFixed(2) : undefined}
      style={{ ["--mcs-crew-h" as string]: `${crewH}px`, ["--mcs-ov-a" as string]: String(ov.alpha) }}
      onPointerDown={() => { if (runRef.current.audio) audio.current?.unlock(); }}>
      {own && <img ref={img} className="mcs-own" src={own} alt="" draggable={false} onLoad={measure} />}
      {own && <div className="mcs-ov" aria-hidden="true" />}
      <canvas ref={cv} className="mcs-canvas" aria-hidden="true" />
      {controls && (
        <div className="mcs-ctl">
          <button type="button" className={`mcm-btn mcm-btn--icon${muted ? "" : " is-on"}`} onClick={toggleMute} title={muteTitle} aria-label={muteTitle} aria-pressed={!muted}>
            <svg viewBox="0 0 8 8" width="16" height="16" shapeRendering="crispEdges" aria-hidden="true">
              <path d="M0 3h2v2H0zM2 2h1v4H2zM3 1h1v6H3z" fill="currentColor" />
              {muted ? <path d="M5 2h1v1H5zM7 2h1v1H7zM6 3h1v2H6zM5 5h1v1H5zM7 5h1v1H7z" fill="currentColor" />
                : <path d="M5 3h1v2H5zM6 1h1v1H6zM7 2h1v4H7zM6 6h1v1H6z" fill="currentColor" opacity={why ? 0.45 : 1} />}
            </svg>
          </button>
          <button type="button" className="mcm-btn mcm-btn--icon" onClick={() => file.current?.click()} title="Use your own background picture" aria-label="Use your own background picture">
            <svg viewBox="0 0 8 8" width="16" height="16" shapeRendering="crispEdges" aria-hidden="true">
              <path d="M0 1h8v6H0zM1 2v4h6V2z" fill="currentColor" /><path d="M2 3h1v1H2zM1 5h2v1H1zM3 4h2v2H3zM5 5h2v1H5z" fill="currentColor" />
            </svg>
          </button>
          {own && (
            <button type="button" className="mcm-btn mcm-btn--icon" onClick={() => void clearOwnBg()} title="Back to the drawn world" aria-label="Back to the drawn world">
              <svg viewBox="0 0 8 8" width="16" height="16" shapeRendering="crispEdges" aria-hidden="true">
                <path d="M1 1h1v1H1zM2 2h1v1H2zM3 3h2v2H3zM5 2h1v1H5zM6 1h1v1H6zM2 5h1v1H2zM1 6h1v1H1zM5 5h1v1H5zM6 6h1v1H6z" fill="currentColor" />
              </svg>
            </button>
          )}
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          {err && <span className="mcs-err" role="status">{err}</span>}
        </div>
      )}
    </div>
  );
}

export default McScene;

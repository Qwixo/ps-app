// Minecraft mode (the developer, 4 Nov 2026): offline translator, torch, power out stopwatch and a blocky scene, for the
// internet and power cuts in the developer's city. Minecraft mode in the gear's Settings (General) opens it as a big pop up
// over the whole screen, the scene behind everything (V1.32: no pickaxe on the main screen). MINIMISE (top left)
// shrinks it to a small floating pickaxe bubble that shows the live power out time while the power is out; a
// click on the bubble brings it back exactly as it was (typed text and all). The bubble can be dragged and
// remembers its spot. While minimised or closed the scene, workers and sounds pause, and the layer is hidden
// and lets every click through (the overlay window itself is tucked by PS when the Tab list goes, ScreenGuard).
// Esc minimises: it never throws away what was typed. CLOSE (next to Minimise) puts it away with no bubble.
// This file is the shell. Its pieces: minecraft/Translator.tsx, minecraft/Scene.tsx (the scene and the theme,
// mc-theme.css), minecraft/PowerClock.tsx (power out stopwatch), minecraft/Torch.tsx (the torch). PS on a Mac only.
// Its own classes start with mcw (mc- is taken by the mail cards).
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { psPost, useOverlayShown } from "../ps";
import { sfx } from "../ui/sfx";
import { PickaxeIcon, Translator, translatorPoll, translatorShown } from "./minecraft/Translator";
import { bubbleSpot, cleanSpot, type Spot } from "../core/mcmode";
import type { CalEvent } from "../core/model";
import type { Dnd } from "../core/dnd";
import { McScene } from "./minecraft/Scene";
import { PowerClock } from "./minecraft/PowerClock";
import { askPower, usePower } from "./minecraft/power-bridge";
import { clock } from "./minecraft/power-format";
import { Torch } from "./minecraft/Torch";
import "./minecraft.css";

// ---------- open, minimised or closed (minimised is remembered, like the Fitness bubble) ----------
export type McView = "closed" | "open" | "min";
const VKEY = "ps.mc.view", SKEY = "ps.mc.bubble";
let view: McView = (() => { try { return localStorage.getItem(VKEY) === "min" ? "min" : "closed"; } catch { return "closed"; } })();
const subs = new Set<() => void>();
function setView(v: McView) {
  if (v === view) return;
  view = v;
  try { if (v === "min") localStorage.setItem(VKEY, "min"); else localStorage.removeItem(VKEY); } catch { /* storage off */ }
  subs.forEach((f) => f());
}
const useView = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => view);
export const minecraft = { open: () => setView("open"), min: () => setView("min"), close: () => setView("closed"), get: () => view };
/** Old name, kept for callers: true opens, false closes. */
export function openMinecraft(v = true) { setView(v ? "open" : "closed"); }

// ---------- the entry in Settings ----------
// The developer, 4 Nov 2026: "I don't want the pickaxe to be anywhere on my main screen. I want that to be in the settings
// icon." So the pickaxe button left the Tab list's top bar (V1.32): Minecraft mode opens from the gear,
// Settings, General. onOpen closes Settings first; the pop up then grows out of the gear.
export function MinecraftEntry({ onOpen }: { onOpen: () => void }) {
  const v = useView();
  return (
    <button type="button" className="mcw-entry" onClick={() => { sfx.click(); onOpen(); window.setTimeout(() => setView("open"), 160); }}
      aria-haspopup="dialog" aria-label="Open Minecraft mode: offline translator, torch and power clock">
      <span className="mcw-entry-ico" aria-hidden="true"><PickaxeIcon size={30} /></span>
      <span className="mcw-entry-t"><b>Minecraft mode</b><em>Works with no internet: translator, torch and power clock</em></span>
      <span className="mcw-entry-go">{v === "min" ? "Bring back" : "Open"}</span>
    </button>
  );
}

// ---------- the window: one big pop up, kept mounted once opened so nothing typed is lost ----------
/** dnd and events come from the Tab list (the scene is silent while Do Not Disturb is on or a meeting is live). */
export function MinecraftWindow({ dnd, events }: { dnd?: Dnd | null; events?: CalEvent[] | null }) {
  const v = useView();
  const shown = useOverlayShown();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(v !== "closed");
  const stage = useRef<HTMLDivElement>(null), full = useRef<HTMLDivElement>(null);
  const [crew, setCrew] = useState(0);
  const was = useRef<McView>(v);
  useEffect(() => { setHost(document.querySelector<HTMLElement>(".tm-overlay")); }, []);
  useEffect(() => {
    const w = window as Window & { __psOpenMinecraft?: () => boolean };
    w.__psOpenMinecraft = () => { setView("open"); return true; };
    return () => { if (w.__psOpenMinecraft) delete w.__psOpenMinecraft; };
  }, []);
  useEffect(() => { if (v !== "closed") setMounted(true); }, [v]);

  // Open: PS pins the list and gives it the keyboard; minimised or closed: back to normal.
  useLayoutEffect(() => {
    const before = was.current;
    was.current = v;
    if (v === "open") {
      psPost({ type: "dimx", open: true });
      translatorShown();
      askPower();
      grow(stage.current, full.current, before === "min" ? bubbleRect() : pickRect(), "in");
    } else if (before === "open") {
      psPost({ type: "dimx", open: false });
      grow(stage.current, full.current, v === "min" ? bubbleRect(bubbleSpot(readSpot(), window.innerWidth, window.innerHeight)) : pickRect(), "out");
    }
  }, [v, host, mounted]);
  // Esc minimises (never destructive). A PS Esc (the list's failsafe) asks here first.
  useEffect(() => {
    if (v !== "open") return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); setView("min"); } };
    const w = window as Window & { __psDimxClose?: () => boolean };
    const esc = () => { setView("min"); return true; };
    window.addEventListener("keydown", key, true);
    w.__psDimxClose = esc;
    return () => { window.removeEventListener("keydown", key, true); if (w.__psDimxClose === esc) delete w.__psDimxClose; };
  }, [v]);
  useEffect(() => {
    if (v !== "open") return;
    const t = window.setInterval(translatorPoll, 2500);
    return () => clearInterval(t);
  }, [v]);

  if (!host || !mounted) return null;
  const active = v === "open" && shown;
  return createPortal(
    <>
      <div ref={full} className={`dx-layer mcw-full mcm-theme${v === "open" ? " mcw-open" : ""}`} data-mcm-theme="auto" data-mcw-view={v} aria-hidden={v !== "open"}
        style={{ ["--mcw-crew" as string]: `${crew}px` }} onMouseDown={(e) => e.stopPropagation()}>
        {/* The blocky scene behind everything (minecraft/Scene.tsx): no frames and no sound unless open and showing. */}
        <div className="mcw-bg"><McScene active={active} dnd={dnd} events={events} onCrewHeight={setCrew} /></div>
        <div className="mcw-topbtns">
        <button type="button" className="mcm-btn mcw-minbtn" onClick={() => { sfx.drop(); setView("min"); }} title="Minimise (Esc): everything stays as it is" aria-label="Minimise Minecraft mode">
          <svg width="16" height="16" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true"><rect x="2" y="11" width="12" height="3" fill="currentColor" /></svg>
          <span>Minimise</span>
        </button>
        {/* Close puts it away completely (no bubble left on the screen); what was typed stays for next time. */}
        <button type="button" className="mcm-btn mcw-closebtn" onClick={() => { sfx.drop(); setView("closed"); }} title="Close: no bubble stays on your screen. Open it again from Settings" aria-label="Close Minecraft mode">
          <svg width="16" height="16" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true"><path d="M3 3h2v2H3zM5 5h2v2H5zM7 7h2v2H7zM9 5h2v2H9zM11 3h2v2h-2zM5 9h2v2H5zM3 11h2v2H3zM9 9h2v2H9zM11 11h2v2h-2z" fill="currentColor" /></svg>
          <span>Close</span>
        </button>
        </div>
        <div ref={stage} className="mcw-stage" role="dialog" aria-modal="true" aria-label="Minecraft mode">
          <header className="mcw-title">
            <span className="mcw-title-ico"><PickaxeIcon size={28} /></span>
            <div><h2>Minecraft mode</h2><p>Works with no internet: translator, torch and power clock</p></div>
          </header>
          <div className="mcw-grid">
            <section className="mcw-panel mcm-panel mcm-panel--grass mcw-tr-panel" aria-label="Offline translator"><Translator /></section>
            <aside className="mcw-side">
              <section className="mcw-panel mcm-panel mcm-panel--grass" aria-label="Power"><PowerClock maxRows={4} /></section>
              <section className="mcw-panel mcm-panel" aria-label="Torch"><Torch /></section>
            </aside>
          </div>
        </div>
      </div>
      {v === "min" && <Bubble />}
    </>, host);
}

/** Grows the stage out of a rect (the pickaxe or the bubble) or shrinks it back into one. Transform and opacity only. */
function grow(stage: HTMLElement | null, full: HTMLElement | null, from: DOMRect | null, dir: "in" | "out") {
  if (!stage || !full) return;
  stage.getAnimations().forEach((a) => a.cancel());
  full.getAnimations().forEach((a) => a.cancel());
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const s = stage.getBoundingClientRect();
  const dx = from && s.width ? from.left + from.width / 2 - (s.left + s.width / 2) : 0;
  const dy = from && s.height ? from.top + from.height / 2 - (s.top + s.height / 2) : 0;
  const k = from && s.width ? Math.max(0.04, from.width / s.width) : 0.9;
  const small = reduced ? { transform: "none", opacity: 0 } : { transform: `translate(${dx}px, ${dy}px) scale(${k})`, opacity: 0 };
  const big = { transform: "none", opacity: 1 };
  const ms = reduced ? 140 : dir === "in" ? 420 : 320;
  const ease = dir === "in" ? "cubic-bezier(.2, .9, .25, 1)" : "cubic-bezier(.5, 0, .75, .3)";
  stage.animate(dir === "in" ? [small, big] : [big, small], { duration: ms, easing: ease, fill: dir === "out" ? "forwards" : "none" });
  full.animate(dir === "in" ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: "ease", fill: dir === "out" ? "forwards" : "none" });
}
/** Where it grows from and shrinks back into when it is not minimised: the gear (Minecraft mode opens from Settings). */
const pickRect = () => document.querySelector<HTMLElement>(".tm-tr button[aria-label=Settings]")?.getBoundingClientRect() ?? null;
const BUBBLE = 58;
function bubbleRect(spot?: Spot) {
  const el = document.querySelector<HTMLElement>(".mcw-bubble");
  if (el) return el.getBoundingClientRect();
  return spot ? new DOMRect(spot.x, spot.y, BUBBLE, BUBBLE) : null;
}
function readSpot(): Spot | null { try { return cleanSpot(JSON.parse(localStorage.getItem(SKEY) || "null")); } catch { return null; } }

// ---------- the bubble: drag it anywhere, click it to come back ----------
function Bubble() {
  const [spot, setSpot] = useState<Spot>(() => bubbleSpot(readSpot(), window.innerWidth, window.innerHeight));
  const power = usePower();
  const [now, setNow] = useState(() => Date.now());
  const out = power.onBattery && power.since ? power.since : null;
  const line = out ? `Power out ${clock(now - out)}` : null;
  const drag = useRef<{ x: number; y: number; sx: number; sy: number; moved: boolean } | null>(null);
  const el = useRef<HTMLButtonElement>(null);
  // The power line ticks once a second, only while the power is out.
  useEffect(() => { askPower(); }, []);
  useEffect(() => {
    if (!out) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [out]);
  useEffect(() => {
    const fit = () => setSpot((s) => bubbleSpot(s, window.innerWidth, window.innerHeight));
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  useLayoutEffect(() => { el.current?.animate([{ transform: "scale(.4)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 260, easing: "cubic-bezier(.2, 1.4, .4, 1)" }); }, []);
  return (
    <div className="dx-layer mcw-bubble-layer">
      <button ref={el} type="button" className={`mcw-bubble${line ? " mcw-bubble-out" : ""}`} style={{ transform: `translate(${spot.x}px, ${spot.y}px)` }}
        aria-label={`Minecraft mode${line ? `, ${line}` : ""}. Click to bring it back`} title="Click to bring Minecraft mode back, drag to move"
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, sx: spot.x, sy: spot.y, moved: false }; }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const mx = e.clientX - d.x, my = e.clientY - d.y;
          if (!d.moved && Math.hypot(mx, my) < 4) return;
          d.moved = true;
          setSpot(bubbleSpot({ x: d.sx + mx, y: d.sy + my }, window.innerWidth, window.innerHeight));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (d?.moved) { try { localStorage.setItem(SKEY, JSON.stringify(spot)); } catch { /* storage off */ } return; }
          sfx.click(); setView("open");
        }}
        onPointerCancel={() => { drag.current = null; }}>
        <span className="mcw-bubble-ico"><PickaxeIcon size={26} /></span>
        {line && <span className="mcw-bubble-t">{line}</span>}
      </button>
    </div>
  );
}

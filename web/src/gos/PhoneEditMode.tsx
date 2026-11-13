// The phone's own Edit mode (V1.56), on PS GOS and the iPhone web app. The developer, 13 Nov 2026: "currently when you click the
// edit panel, you can move stuff around the screen, you can remove stuff, add new stuff in, I want the exact same thing
// on the mobile version as well. So you can basically customize your own mobile app."
//
// - Open it from the menu (Edit layout) or by holding the navbar. The page showing shrinks into the middle and the
//   phone's other pages slide in beside it, with a + New page past each end.
// - Swipe sideways (or tap a page beside) to go from page to page. Drag a page's name to put it somewhere else; tap the
//   name of a page of panels to rename it; its x deletes it ("Delete page?" first).
// - On a page of panels: drag a panel to move it (the others make room) or onto a page beside, drag the white corner to
//   size it in whole cells, x removes it. Add panel opens the gallery (only what this phone can draw).
// - The navbar: drag its grip to the top or the bottom (and to a side), drag a button sideways to reorder it, x takes it
//   out. Navbar and looks opens the same sheet as the Mac's phone canvas: edge, place, every button, and the background
//   and look of this page and of every page.
// - Looks (top left): saved looks and Reset to default (views/PhoneLooks.tsx). Done (or back) zooms into the page you
//   were on.
// It edits the very record the Mac's phone canvas edits (core/phonelayout.ts, actions.ts savePhoneLayout), drawn with the
// very same pieces (views/PhoneEditor.tsx: PhoneScreen, Grid, NavBar, Sheet, PhoneGallery). Sounds: core/editsounds.ts
// through gos/editsfx.ts, quiet on silent.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type PointerEvent as RPE } from "react";
import { createPortal } from "react-dom";
import { useVault } from "../ui/kit";
import { calendarSnap, phoneLayout, settingsData } from "../core/select";
import { savePhoneLayout } from "../core/actions";
import {
  COLS, HOME, addPage, addTile, cellAt, cellBox, cellsFor, defaultPhoneLayout, moveTile, orderPages, removePage, removeTile, renamePage,
  resizeTile, samePhoneLayout, setNavAlign, setNavEdge, setNavItems, tileToPage, toggleNav, type NavAlign, type PhoneKind, type PhoneLayout, type Tile,
} from "../core/phonelayout";
import { editSoundsOn, meetingNow, type EditSound } from "../core/editsounds";
import { dndMutes } from "../core/dnd";
import { PhoneGallery, PhoneScreen, Sheet, pageName, type EditProps, type NavDrag, type TileDrag } from "../views/PhoneEditor";
import { PhoneLooks } from "../views/PhoneLooks";
import { haptic } from "./bridge";
import { usePhoneNow, viewOf } from "./phonepage";
import { editSoundsClose, editSoundsOpen, phoneEditSoundOk, ringerNow, setPhoneEditGate, phoneEditSfx } from "./editsfx";
import { setSfxVolume, primeSfx } from "../ui/sfx";
import { pagerStep, pageAfterSwipe, NAV_HOLD_MS, HOLD_SLOP } from "./phoneedit";
import "./phoneeditmode.css";

const at = () => new Date().toISOString();

// ---------- the top bar's looks slot (left of the page dots) ----------
/** What the slot gets: the layout shown, a way to put a layout on (saved at once), the Edit sounds (quiet on silent), and
 *  a way to say a panel of its own is open (then back and Esc send it "lk-close" instead of leaving Edit mode). */
export type LooksSlotProps = { layout: PhoneLayout; red: boolean; apply: (l: PhoneLayout) => void; sound: (n: EditSound) => void; onOpen: (open: boolean) => void };
const DefaultLooks = (p: LooksSlotProps) => <PhoneLooks {...p} variant="phone" />;
let looksSlot: ComponentType<LooksSlotProps> = DefaultLooks;
/** Put other Save, Looks and Reset buttons in the top bar (null: the usual ones, views/PhoneLooks.tsx). */
export function setPhoneLooksSlot(c: ComponentType<LooksSlotProps> | null) { looksSlot = c ?? DefaultLooks; }
const TM_SOUND_DEFAULT = 40;   // views/TaskMap.tsx (the list's default sound volume)

// ---------- the mount (gos/GosLayer.tsx): how Edit mode opens ----------
// Edit mode survives the phone's home going away for a moment (the app switched away and back: GosLayer draws nothing
// while PS is out of sight): it opens again on the page it was on. Only Done (or back) really closes it.
let stillOpen = false;
let lastPage: string | null = null;
export function PhoneEditMount({ kind, red }: { kind: PhoneKind; red: boolean }) {
  const [open, setOpen0] = useState(stillOpen);
  const setOpen = (v: boolean) => { stillOpen = v; if (!v) lastPage = null; setOpen0(v); };
  // The menu's Edit layout taps this hidden button inside the phone's home (gos/menu.ts, like its other items).
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { const el = document.querySelector<HTMLElement>(".gos-home"); if (el !== host) setHost(el); });
  const openRef = useRef(open);
  openRef.current = open;
  // Holding the navbar opens it too (like holding an iPhone's home screen). The tap that would follow does nothing.
  useEffect(() => {
    let timer = 0, sx = 0, sy = 0, swallow = false;
    const stop = () => { window.clearTimeout(timer); timer = 0; };
    const down = (e: PointerEvent) => {
      if (openRef.current || !(e.target as Element | null)?.closest?.(".gos-dock")) return;
      sx = e.clientX; sy = e.clientY;
      stop();
      timer = window.setTimeout(() => { timer = 0; swallow = true; window.setTimeout(() => { swallow = false; }, 900); haptic("press"); setOpen(true); }, NAV_HOLD_MS);
    };
    const move = (e: PointerEvent) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > HOLD_SLOP) stop(); };
    const click = (e: MouseEvent) => { if (swallow && (e.target as Element | null)?.closest?.(".gos-dock")) { swallow = false; e.preventDefault(); e.stopPropagation(); } };
    const menu = (e: Event) => { if ((e.target as Element | null)?.closest?.(".gos-dock")) e.preventDefault(); };   // no long press menu on the dock
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", stop, true);
    window.addEventListener("pointercancel", stop, true);
    window.addEventListener("click", click, true);
    window.addEventListener("contextmenu", menu, true);
    return () => {
      stop();
      window.removeEventListener("pointerdown", down, true); window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", stop, true); window.removeEventListener("pointercancel", stop, true);
      window.removeEventListener("click", click, true); window.removeEventListener("contextmenu", menu, true);
    };
  }, []);
  return (
    <>
      {host && createPortal(<button type="button" className="pm-edit-open" tabIndex={-1} aria-hidden="true" onClick={() => setOpen(true)} />, host)}
      {open && createPortal(<PhoneEditMode kind={kind} red={red} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

// ---------- the room ----------
type Phase = "in" | "on" | "out";
type PillDrag = { id: string; sx: number; dx: number };
type Swipe = { sx: number; sy: number; dx: number; id: number; axis: "x" | "y" | null; t0: number };

function useScreen() {
  const [v, setV] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => { const f = () => setV({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return v;
}
/** The phone's own top and bottom insets in px (the shell's on PS GOS, the safe area on an iPhone). */
function useInsets() {
  const [ins, setIns] = useState({ top: 0, bottom: 0 });
  useLayoutEffect(() => {
    const p = document.createElement("div");
    p.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding-top:var(--gos-inset-top, env(safe-area-inset-top, 0px));padding-bottom:var(--gos-bottom, env(safe-area-inset-bottom, 0px))";
    document.body.appendChild(p);
    const cs = getComputedStyle(p);
    setIns({ top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 });
    p.remove();
  }, []);
  return ins;
}

export function PhoneEditMode({ kind, red, onClose }: { kind: PhoneKind; red: boolean; onClose: () => void }) {
  const s = useVault();
  const st = s.status === "unlocked" ? settingsData(s) : null;
  const saved = useMemo(() => (s.status === "unlocked" ? phoneLayout(s, kind, red) : defaultPhoneLayout(kind, red)), [s, kind, red]);
  // What was just changed here, until the vault catches up (the same way as the Mac's phone canvas).
  const [pending, setPending] = useState<PhoneLayout | null>(null);
  const timer = useRef(0);
  const latest = useRef<PhoneLayout | null>(null);
  const layout = pending ?? saved;
  useEffect(() => { if (pending && !timer.current && samePhoneLayout(pending, saved, red)) setPending(null); }, [pending, saved, red]);
  const flush = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = 0; } if (latest.current) { const l = latest.current; latest.current = null; void savePhoneLayout(l).catch(() => {}); } };
  const change = (next: PhoneLayout, now = false) => {
    if (next === layout) return;
    latest.current = next;
    setPending(next);
    window.clearTimeout(timer.current);
    if (now) flush(); else timer.current = window.setTimeout(() => { timer.current = 0; flush(); }, 500);
  };
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- sounds: the shared tones, quiet on silent; the list's own clicks too while the phone is silent ----------
  const vol = st ? (st.tmMuted ? 0 : (st.tmSound ?? TM_SOUND_DEFAULT)) / 100 : 0;
  const gate = useMemo(() => {
    const events = s.status === "unlocked" ? calendarSnap(s)?.data.events ?? [] : [];
    const meets = events.filter((e) => e.start && e.end && !e.allDay).map((e) => ({ start: Date.parse(e.start!), end: Date.parse(e.end!) }));
    return { on: editSoundsOn(st), volume: vol, dndMutesSounds: !!st && dndMutes(st.dnd, "sounds", Date.now(), "phone"), meetingNow: meetingNow(meets) };
  }, [s, st, vol]);
  useEffect(() => { setPhoneEditGate(gate); }, [gate]);
  useEffect(() => {
    editSoundsOpen();
    const quiet = () => setSfxVolume(phoneEditSoundOk({ ...gate, on: true }, ringerNow()) ? vol * 100 : 0);
    const t = window.setInterval(quiet, 1000);
    quiet();
    return () => { window.clearInterval(t); editSoundsClose(); setSfxVolume(vol * 100); };
  }, [gate, vol]);
  const sound = (n: EditSound) => phoneEditSfx(n);

  // ---------- where we are ----------
  const phoneNow = usePhoneNow();
  const [cur, setCur] = useState(() => lastPage ?? phoneNow.page?.id ?? HOME);
  useEffect(() => { lastPage = cur; }, [cur]);
  const pages = layout.pages;
  const ci = Math.max(0, pages.findIndex((p) => p.id === cur));
  const page = pages[ci];
  useEffect(() => { if (!pages.some((p) => p.id === cur)) setCur(HOME); }, [pages, cur]);
  const [phase, setPhase] = useState<Phase>("in");
  const [gal, setGal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [sure, setSure] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [tile, setTile] = useState<TileDrag | null>(null);
  const [nav, setNav] = useState<NavDrag | null>(null);
  const [pill, setPill] = useState<PillDrag | null>(null);
  const [swipe, setSwipe] = useState<Swipe | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [looksOpen, setLooksOpen] = useState(false);
  useLayoutEffect(() => {
    primeSfx();
    sound("edit-in"); haptic("press");
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setPhase((p) => (p === "in" ? "on" : p))));
    const t = window.setTimeout(() => setPhase((p) => (p === "in" ? "on" : p)), 60);   // a frame can be held back
    return () => { cancelAnimationFrame(r); window.clearTimeout(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!sure) return; const t = window.setTimeout(() => setSure(null), 3500); return () => window.clearTimeout(t); }, [sure]);
  useEffect(() => { if (!fresh) return; const t = window.setTimeout(() => setFresh(null), 700); return () => window.clearTimeout(t); }, [fresh]);

  const done = () => {
    if (phase === "out") return;
    flush();
    sound("edit-out"); haptic("press");
    setGal(false); setDrawer(false); setSure(null);
    setPhase("out");
    window.setTimeout(() => { phoneNow.go(viewOf(page)); onClose(); }, 380);
  };
  // Back (and Esc): the innermost thing first. The Looks panel closes itself (views/PhoneLooks.tsx).
  const backRef = useRef<() => void>(() => {});
  backRef.current = () => {
    if (renaming) setRenaming(null);
    else if (gal) { setGal(false); }
    else if (drawer) setDrawer(false);
    else if (sure) setSure(null);
    else done();
  };
  const looksRef = useRef(looksOpen);
  looksRef.current = looksOpen;
  useEffect(() => {
    const f = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (looksRef.current) { e.preventDefault(); e.stopImmediatePropagation(); window.dispatchEvent(new Event("lk-close")); return; }   // the Looks panel first
      if (e instanceof KeyboardEvent && (e.target as Element | null)?.closest?.("input")) return;
      e.preventDefault(); e.stopImmediatePropagation();
      backRef.current();
    };
    window.addEventListener("gos-back", f, true);
    window.addEventListener("keydown", f, true);
    return () => { window.removeEventListener("gos-back", f, true); window.removeEventListener("keydown", f, true); };
  }, []);

  // ---------- geometry: the phone's own screen, shrunk into the middle, its pages beside it ----------
  const scr = useScreen();
  const ins = useInsets();
  const W = scr.w, H = scr.h;
  const topBar = ins.top + 66, bottomBar = ins.bottom + 92;
  const galH = Math.round(Math.min(H * 0.46, 380));
  const roomH = H - topBar - (gal ? galH + 16 : bottomBar) - 44;
  const k = phase === "on" ? Math.max(0.3, Math.min(0.66, roomH / H)) : 1;
  const ks = k * 0.8;
  const cx = W / 2, cy = phase === "on" ? topBar + 40 + roomH / 2 : H / 2;
  const step = pagerStep(W, k, ks);
  const posOf = (d: number) => (d === 0 ? 0 : Math.sign(d) * (W * k / 2 + 16 + W * ks / 2 + (Math.abs(d) - 1) * (W * ks + 16)));
  // While a name is dragged: the order it would make.
  const order = pages.map((p) => p.id);
  const shown = pill ? (() => { const o = order.filter((x) => x !== pill.id); const from = order.indexOf(pill.id); const to = Math.max(0, Math.min(order.length - 1, from + Math.round(pill.dx / step))); o.splice(to, 0, pill.id); return o; })() : order;
  const swipeDx = swipe?.axis === "x" ? swipe.dx : 0;
  const lastTick = useRef(0);

  const go = (id: string, how: "tap" | "swipe") => { if (id === cur) return; sound(how === "tap" ? "edit-fly" : "edit-tick"); haptic("tick"); setCur(id); setSure(null); setRenaming(null); };
  const newPage = (index: number) => {
    const r = addPage(layout, index, at());
    if (!r.id) { haptic("reject"); return; }
    sound("edit-page-add"); haptic("press");
    change(r.layout, true);
    setCur(r.id);
    window.setTimeout(() => setGal(true), 320);
  };
  const add = (kindOf: string) => {
    let l = layout, target = page.id;
    if (page.kind !== "panels") {   // a panel goes on a page of panels: a new one right of this page
      const r = addPage(l, ci + 1, at());
      if (!r.id) { haptic("reject"); return; }
      l = r.layout; target = r.id;
    }
    const r = addTile(l, target, kindOf, red, at());
    if (!r.id) { haptic("reject"); return; }
    sound("edit-drop"); haptic("drop");
    change(r.layout, true);
    setCur(target);
    setFresh(r.id);
    setGal(false);
  };

  // ---------- swiping between pages (on the room, not on the page being edited) ----------
  const roomDown = (e: RPE) => {
    if (phase !== "on" || tile || nav || pill) return;
    const t = e.target as Element;
    if (t.closest(".pm-card.cur, button, input, select, .pe-gal, .pm-drawer, .lk-panel, .pm-pill")) return;
    setSwipe({ sx: e.clientX, sy: e.clientY, dx: 0, id: e.pointerId, axis: null, t0: performance.now() });
    lastTick.current = 0;
  };
  const roomMove = (e: RPE) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.sx, dy = e.clientY - swipe.sy;
    let axis = swipe.axis;
    if (!axis && Math.hypot(dx, dy) > 8) { axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y"; if (axis === "x") (e.currentTarget as Element).setPointerCapture?.(e.pointerId); }
    // A tick each time a page passes the middle.
    const passed = Math.round(-dx / step);
    if (axis === "x" && passed !== lastTick.current) { lastTick.current = passed; const j = ci + passed; if (j >= 0 && j < pages.length) { sound("edit-tick"); haptic("tick"); } }
    setSwipe({ ...swipe, dx, axis });
  };
  const roomUp = (e: RPE) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const sw = swipe;
    setSwipe(null);
    if (sw.axis !== "x") {
      // A tap on a page beside: go to it.
      if (!sw.axis) { const id = (e.target as Element).closest<HTMLElement>("[data-pe-page]")?.dataset.pePage; if (id) go(id, "tap"); }
      return;
    }
    const v = sw.dx / Math.max(1, performance.now() - sw.t0);
    const j = pageAfterSwipe(ci, pages.length, sw.dx, v, step);
    if (j !== ci) { setCur(pages[j].id); setSure(null); setRenaming(null); }
  };

  // ---------- dragging a panel (the Mac's way, in the phone's own pixels) ----------
  const tileDown = (e: RPE, id: string, mode: "move" | "size") => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    haptic("drag");
    setTile({ id, mode, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, over: null });
  };
  const tileMove = (e: RPE) => {
    if (!tile) return;
    let over: string | null = null;
    if (tile.mode === "move") for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      const id = (el as HTMLElement).dataset?.pePage;
      if (id && id !== page.id) { over = id; break; }
    }
    if (over !== tile.over && over) haptic("tick");
    setTile({ ...tile, dx: (e.clientX - tile.sx) / k, dy: (e.clientY - tile.sy) / k, over });
  };
  const ghostOf = (t: Tile, d: TileDrag) => {
    const b = cellBox(t, W);
    if (d.mode === "move") return { ...t, ...cellAt(b.left + d.dx, b.top + d.dy, W, t.w, t.h) };
    const sz = cellsFor(b.width + d.dx, b.height + d.dy, W);
    return { ...t, ...sz, c: Math.min(t.c, COLS - sz.w) };
  };
  const tileUp = () => {
    if (!tile) return;
    const t = page.tiles?.find((x) => x.id === tile.id);
    setTile(null);
    if (!t || (Math.abs(tile.dx) < 3 && Math.abs(tile.dy) < 3)) return;
    sound("edit-drop"); haptic("drop");
    if (tile.mode === "move" && tile.over) {
      const dest = pages.find((p) => p.id === tile.over);
      if (dest?.kind === "panels") { change(tileToPage(layout, page.id, t.id, dest.id, at())); setFresh(t.id); return; }
    }
    const g = ghostOf(t, tile);
    change(tile.mode === "move" ? moveTile(layout, page.id, t.id, g.c, g.r, at()) : resizeTile(layout, page.id, t.id, g.w, g.h, at()));
  };

  // ---------- dragging the navbar or one of its buttons ----------
  const navDown = (e: RPE, d: NavDrag) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    haptic("drag");
    setNav(d);
  };
  const navMove = (e: RPE) => {
    if (!nav) return;
    if (nav.kind === "bar") setNav({ ...nav, dx: (e.clientX - nav.sx) / k, dy: (e.clientY - nav.sy) / k });
    else setNav({ ...nav, dx: (e.clientX - nav.sx) / k });
  };
  const items = layout.nav.items;
  const itemW = (() => { const bw = layout.nav.align === "full" ? W - 20 : Math.min(W - 20, items.length * 58 + 14); return Math.max(30, (bw - 14) / Math.max(1, items.length)); })();
  const reorderTo = (d: Extract<NavDrag, { kind: "item" }>) => Math.max(0, Math.min(items.length - 1, items.indexOf(d.id) + Math.round(d.dx / itemW)));
  const barDrop = (d: Extract<NavDrag, { kind: "bar" }>) => {
    const startY = layout.nav.edge === "top" ? 60 : H - 60;
    const edge = startY + d.dy < H / 2 ? "top" : "bottom";
    const bw = layout.nav.align === "full" ? W - 20 : Math.min(W - 20, items.length * 58 + 14);
    const startX = layout.nav.align === "left" ? 10 + bw / 2 : layout.nav.align === "right" ? W - 10 - bw / 2 : W / 2;
    const x = startX + d.dx;
    const align: NavAlign = Math.abs(d.dx) < 24 ? layout.nav.align : x < W * 0.36 ? "left" : x > W * 0.64 ? "right" : layout.nav.align === "full" ? "full" : "center";
    return { edge, align } as const;
  };
  const navUp = () => {
    if (!nav) return;
    const d = nav;
    setNav(null);
    if (d.kind === "bar") {
      if (Math.abs(d.dx) < 3 && Math.abs(d.dy) < 3) return;
      const t = barDrop(d);
      sound("edit-drop"); haptic("drop");
      change(setNavAlign(setNavEdge(layout, t.edge, at()), t.align, at()));
      return;
    }
    if (Math.abs(d.dx) < 3) return;
    const to = reorderTo(d);
    const next = items.filter((x) => x !== d.id);
    next.splice(to, 0, d.id);
    sound("edit-drop"); haptic("drop");
    change(setNavItems(layout, next, red, at()));
  };
  const navShown = (() => {
    if (!nav) return layout.nav;
    if (nav.kind === "bar") return { ...layout.nav, ...barDrop(nav) };
    const next = items.filter((x) => x !== nav.id);
    next.splice(reorderTo(nav), 0, nav.id);
    return { ...layout.nav, items: next };
  })();
  const editProps: EditProps = {
    tile, ghostOf, tileDown, tileMove, tileUp, nav, navShown, navDown, navMove, navUp, fresh,
    removeTile: (id) => { sound("edit-page-remove"); haptic("press"); change(removeTile(layout, page.id, id, at()), true); },
    removeNav: (id) => { sound("edit-page-remove"); haptic("press"); change(toggleNav(layout, id, red, at()), true); },
  };

  // ---------- drawing ----------
  const on = phase === "on";
  const LooksSlot = looksSlot;
  const thisDev = useMemo(() => ({ dev: "thisphone", phone: kind, name: "", w: W, h: H, seen: at() }), [kind, W, H]);
  return (
    <div className={`pm-room ${phase}${gal ? " gal" : ""}${tile || nav ? " dragging" : ""}`} style={{ ["--inv" as string]: 1 / k, ["--k" as string]: k }}
      onPointerDown={roomDown} onPointerMove={roomMove} onPointerUp={roomUp} onPointerCancel={() => setSwipe(null)}
      onScroll={(e) => { e.currentTarget.scrollLeft = 0; e.currentTarget.scrollTop = 0; }}>
      <div className="pm-dim" aria-hidden="true" onClick={() => { if (gal) setGal(false); }} />
      {shown.map((id, i) => {
        const p = pages.find((x) => x.id === id)!;
        const isCur = id === page.id;
        const d = i - shown.indexOf(page.id);
        if (phase === "in" && !isCur) return null;
        const x = cx + posOf(isCur ? 0 : d) + swipeDx + (pill?.id === id ? pill.dx : 0);
        const sc = isCur ? k : ks;
        return (
          <div key={id} className={`pm-card${isCur ? " cur" : ""}${tile?.over === id ? " lit" : ""}`} data-pe-page={id}
            style={{ width: W, height: H, transform: `translate(${x - W / 2}px, ${cy - H / 2}px) scale(${sc})`, ["--d" as string]: Math.abs(d), ["--inv" as string]: 1 / sc }}>
            <PhoneScreen layout={layout} page={p} phone={kind} W={W} H={H} red={red} edit={isCur && on ? editProps : null} />
            {!isCur && <span className="pm-card-hit" aria-hidden="true" />}
          </div>
        );
      })}
      {on && (["left", "right"] as const).map((side) => {
        const d = side === "left" ? -ci - 1 : pages.length - ci;
        const x = cx + posOf(d) + swipeDx;
        const pw = W * ks * 0.8, ph = H * ks * 0.55;
        return (
          <button key={side} type="button" className="pm-plus" aria-label={`New page on the ${side}`} style={{ transform: `translate(${x - pw / 2}px, ${cy - ph / 2}px)`, width: pw, height: ph }}
            onClick={() => newPage(side === "left" ? 0 : pages.length)}>
            <span aria-hidden="true">+</span><em>New page</em>
          </button>
        );
      })}
      {/* Each page's name: drag it sideways to move the page; tap the current page of panels' name to rename it. */}
      {on && shown.map((id, i) => {
        const p = pages.find((x) => x.id === id)!;
        const isCur = id === page.id;
        const d = i - shown.indexOf(page.id);
        if (Math.abs(d) > 2) return null;
        const x = cx + posOf(isCur ? 0 : d) + swipeDx + (pill?.id === id ? pill.dx : 0);
        const top = cy - (H * (isCur ? k : ks)) / 2 - 40;
        const name = pageName(p);
        return (
          <div key={id} className={`pm-pill${isCur ? " cur" : ""}${pill?.id === id ? " lifting" : ""}`} style={{ transform: `translate(calc(${x}px - 50%), ${top}px)` }}
            onPointerDown={(e) => { if ((e.target as Element).closest("button, input")) return; e.stopPropagation(); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); setPill({ id, sx: e.clientX, dx: 0 }); }}
            onPointerMove={(e) => { if (pill?.id === id) { if (Math.abs(e.clientX - pill.sx) > 6 && Math.abs(pill.dx) <= 6) haptic("drag"); setPill({ ...pill, dx: e.clientX - pill.sx }); } }}
            onPointerUp={() => {
              if (pill?.id !== id) return;
              const moved = Math.abs(pill.dx) > 6;
              setPill(null);
              if (moved && shown.join() !== order.join()) { sound("edit-drop"); haptic("drop"); change(orderPages(layout, shown, at()), true); }
              else if (!moved && !isCur) go(id, "tap");
              else if (!moved && isCur && p.kind === "panels") setRenaming(id);
            }}
            onPointerCancel={() => setPill(null)}>
            {renaming === id ? (
              <input className="pm-rename" autoFocus defaultValue={name} maxLength={30} enterKeyHint="done"
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }}
                onBlur={(e) => { const v = e.target.value; setRenaming(null); if (v.trim()) change(renamePage(layout, id, v, at()), true); }} />
            ) : <span>{name}{isCur && p.kind === "panels" && <svg {...sv} width={13} height={13}><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>}</span>}
            {isCur && p.kind === "panels" && renaming !== id && (
              <button type="button" className={`pm-pill-x${sure === id ? " sure" : ""}`} aria-label={`Delete ${name}`}
                onClick={() => {
                  if (sure !== id) { haptic("press"); setSure(id); return; }
                  sound("edit-page-remove"); haptic("press"); setSure(null);
                  change(removePage(layout, id, at()), true);
                  setCur(pages[ci - 1]?.id ?? pages[ci + 1]?.id ?? HOME);
                }}>
                {sure === id ? "Delete page?" : "×"}
              </button>
            )}
          </div>
        );
      })}

      {/* Top: Looks (left), the page dots, Done (right). Bottom: Add panel, Navbar and looks. */}
      <div className="pm-top" style={{ top: ins.top + 10 }}>
        <LooksSlot layout={layout} red={red} sound={sound} onOpen={setLooksOpen} apply={(l) => { change(l, true); setFresh(null); }} />
        <span className="pm-dots" aria-hidden="true">{pages.map((p) => <i key={p.id} className={p.id === page.id ? "on" : ""} />)}</span>
        <button type="button" className="pm-done" onClick={done}>Done</button>
      </div>
      {!gal && (
        <div className="pm-tools" style={{ bottom: ins.bottom + 14 }}>
          <button type="button" className="pm-tool pm-add" onClick={() => { haptic("press"); setDrawer(false); setGal(true); }}>
            <span aria-hidden="true">+</span>Add panel
          </button>
          <button type="button" className="pm-tool" onClick={() => { haptic("press"); setDrawer(true); }}>
            <svg {...sv} width={20} height={20}><rect x="3" y="15" width="18" height="6" rx="2" /><path d="M7 4h10M7 8h10" /></svg>
            Navbar and looks
          </button>
        </div>
      )}
      <p className="pm-hint" aria-live="polite" style={{ bottom: ins.bottom + 78 }}>{page.kind === "panels"
        ? "Drag a panel to move it. The white corner sizes it. Swipe beside the phone for other pages."
        : "This page is the phone's own. Add panel makes a page of panels beside it. Hold and drag the navbar to move it."}</p>
      {gal && (
        <div className="pm-gal" style={{ height: galH + ins.bottom }}>
          <PhoneGallery layout={layout} page={page} red={red} onAdd={add} onClose={() => setGal(false)} focus={false} />
        </div>
      )}
      {drawer && (
        <div className="pm-drawer-wrap">
          <div className="pm-drawer-dim" onClick={() => setDrawer(false)} aria-hidden="true" />
          <div className="pm-drawer" role="dialog" aria-label="Navbar and looks" style={{ paddingBottom: ins.bottom + 14 }}>
            <div className="pm-drawer-head"><b>Navbar and looks</b><button type="button" onClick={() => setDrawer(false)} aria-label="Close">{"×"}</button></div>
            <Sheet layout={layout} page={page} phone={kind} dev={thisDev} devs={[thisDev]} red={red} change={(l, now) => change(l, now)} onSwitch={() => {}} />
          </div>
        </div>
      )}
    </div>
  );
}
const sv = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

// The Dynamic Island's look editor (the developer, 4 Nov 2026: "add another edit button so I can actually change
// the colour and the look of that one", plus better versions of Around the notch). Opens from the Edit
// button beside "Pill below the notch" and "Around the notch" in the island menu (TaskMap.tsx
// views/IslandSettings.tsx since V1.58). A live preview on top, then the looks, the colour (presets, or any colour with the hue
// and shade sliders or a code) and the options. Every choice is saved at once (a slider on let go), synced
// like every other setting, and the real island changes with it. The words always read at WCAG AA: the
// colours come from core/islandlook.ts, the same sums the Mac paints with.
// V1.36 (the developer, 5 Nov 2026: "make it so I can actually edit the colour, like the background colour of it too"):
// the colour picker edits either the Background (fill) or the Accent (color), chosen with the switch above it.
// It opens on Background. Around the notch with a Background, the preview draws the camera notch black,
// blending softly into the colour, as Island.swift does.
// V1.36 (the developer, 6 Nov 2026: "a tiny little grey line ... if you click that I want the dynamic island to disappear for
// let's say five seconds"): the preview shows the grab line at the top centre too (Island.swift IslandGrip, the same
// greys from core/islandlook.ts gripTones), brighter on hover, and a click on it hides the preview island for
// 5 seconds the way the real one goes.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ISLAND_COLORS, NOTCH_DEFAULT, NOTCH_STYLES, PILL_DEFAULT, PILL_STYLES, gripTones, mix, notchTones, pillTones,
  type NotchLook, type NotchStyle, type PillLook, type PillStyle } from "../core/islandlook";
import { colorHue, hueColor, p1Color } from "../core/prio";
import { sfx } from "../ui/sfx";
import "./islandlook.css";

export type LookKind = "pill" | "notch";
type Save = (kind: LookKind, look: PillLook | NotchLook) => void;

/** True on a Mac whose screen has no notch (the shell says so when the list opens; unknown on the web). */
export const noNotch = () => (window as Window & { __psNotch?: boolean }).__psNotch === false;

/** The pencil beside a menu choice. */
export function LookEditButton({ kind, onEdit }: { kind: LookKind; onEdit: (k: LookKind) => void }) {
  return (
    <button type="button" className="il-editbtn" title={kind === "pill" ? "Edit the pill's colour and look" : "Edit the look around the notch"}
      aria-label={kind === "pill" ? "Edit the pill's look" : "Edit the look around the notch"}
      onClick={(e) => { e.stopPropagation(); sfx.click(); onEdit(kind); }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" />
      </svg>
      Edit
    </button>
  );
}

// Shade: the hue's colour (50) toward black (0) or white (100), so deep and pale colours are one slide away.
const shaded = (hue: number, shade: number) => (shade < 50 ? mix(hueColor(hue), "#000000", (50 - shade) / 50 * 0.88) : mix(hueColor(hue), "#ffffff", (shade - 50) / 50 * 0.9));

/** Which colour the picker edits: the Background (the look's fill) or the Accent (tick, icon, edge, glow). */
type Target = "fill" | "color";

export function IslandLookEditor({ kind, pill, notch, onSave, onBack }: { kind: LookKind; pill: PillLook; notch: NotchLook; onSave: Save; onBack: () => void }) {
  const [p, setP] = useState(pill);
  const [n, setN] = useState(notch);
  const [target, setTarget] = useState<Target>("fill");
  const look = kind === "pill" ? p : n;
  const color = look[target];
  const [hue, setHue] = useState(() => colorHue(color ?? "#3d7bff"));
  const [shade, setShade] = useState(50);
  const [hex, setHex] = useState(color ?? "");
  const sliding = useRef(false);
  const latest = useRef({ p, n });
  latest.current = { p, n };

  const put = (x: { style?: string; fill?: string | null; color?: string | null; size?: PillLook["size"]; icon?: boolean }, save = true) => {
    if (kind === "pill") { const v = { ...latest.current.p, ...x } as PillLook; setP(v); latest.current.p = v; if (save) onSave("pill", v); }
    else { const v = { ...latest.current.n, ...x } as NotchLook; setN(v); latest.current.n = v; if (save) onSave("notch", v); }
  };
  const pickColour = (c: string | null) => { sfx.click(); setHex(c ?? ""); if (c) { setHue(colorHue(c)); setShade(50); } put({ [target]: c }); };
  const slideTo = (h: number, s: number) => { sliding.current = true; setHue(h); setShade(s); const c = shaded(h, s); setHex(c); put({ [target]: c }, false); };
  const letGo = () => { if (!sliding.current) return; sliding.current = false; put({ [target]: shaded(hue, shade) }); };
  const typed = (v: string) => { setHex(v); const c = p1Color(v); if (c) { setHue(colorHue(c)); put({ [target]: c }, false); } };
  const enter = () => { const c = p1Color(hex); if (c) { sfx.click(); put({ [target]: c }); } else setHex(color ?? ""); };
  const reset = () => { sfx.click(); const d: { style: string; fill: string | null; color: string | null; icon: boolean; size?: PillLook["size"] } = kind === "pill" ? PILL_DEFAULT : NOTCH_DEFAULT; setHex(""); put({ ...d }); };
  /** Switch what the picker edits; the sliders and the code follow that colour. */
  const aim = (t: Target) => {
    if (t === target) return;
    sfx.click(); setTarget(t);
    const c = (kind === "pill" ? latest.current.p : latest.current.n)[t];
    setHex(c ?? ""); setShade(50); if (c) setHue(colorHue(c));
  };

  const styles = kind === "pill" ? PILL_STYLES : NOTCH_STYLES;
  const isDefault = kind === "pill" ? JSON.stringify(p) === JSON.stringify(PILL_DEFAULT) : JSON.stringify(n) === JSON.stringify(NOTCH_DEFAULT);
  const flat = noNotch();
  const colourHint = target === "fill"
    ? (kind === "notch" ? (n.style === "halo" ? "Fills the island when it opens; the camera notch stays black" : "Fills the drop and wings; the camera notch stays black and blends into it")
      : p.style === "glass" ? "Tints the glass; the words pick their own colour so they always read" : "Fills the pill; the words pick their own colour so they always read")
    : kind === "notch" ? (n.style === "halo" ? "The glow round the notch, the tick and the icon" : "The tick, the icon and a fine rim")
      : p.style === "outline" ? "The edge, the tick and the icon" : p.style === "glow" ? "The glow, the tick and the icon" : "The tick and the icon";
  const autoLabel = target === "color" ? "The look's own accent" : kind === "notch" ? "No background: black like the notch" : "No background: the look's own (Classic is black)";
  return (
    <div className="il-ed" role="group" aria-label={kind === "pill" ? "Pill look" : "Around the notch look"}>
      <div className="il-ed-h">
        <button type="button" className="il-back" onClick={() => { sfx.click(); onBack(); }} aria-label="Back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <span className="il-ed-t">{kind === "pill" ? "Pill look" : "Around the notch"}</span>
        <button type="button" className="il-reset" disabled={isDefault} onClick={reset} title={kind === "pill" ? "Back to the black pill" : "Back to the Drop"}>Reset</button>
      </div>
      <Preview kind={kind} pill={p} notch={n} />
      {kind === "notch" && flat && <p className="il-note">This Mac has no notch, so it shows the pill instead. These choices are for a Mac with one.</p>}
      <div className={`il-styles k-${kind}`} role="radiogroup" aria-label="Looks">
        {styles.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={look.style === s.id} title={s.hint}
            className={`il-style${look.style === s.id ? " sel" : ""}`} onClick={() => { sfx.click(); put({ style: s.id }); }}>
            <i className={`il-sw-${kind} s-${s.id}`} style={chipVars(kind, s.id, look.fill, look.color)} aria-hidden="true"><b /></i>
            <span>{s.label}</span>
          </button>
        ))}
      </div>
      <p className="il-hint">{styles.find((s) => s.id === look.style)?.hint}</p>
      <div className="il-sec">Colour<em>{colourHint}</em></div>
      <div className="il-seg il-tgt" role="radiogroup" aria-label="Which colour">
        {(["fill", "color"] as const).map((t) => (
          <button key={t} type="button" role="radio" aria-checked={target === t} className={target === t ? "sel" : ""} onClick={() => aim(t)}>
            <i className="il-dot" style={{ ["--sw" as string]: look[t] ?? "transparent" }} aria-hidden="true" />{t === "fill" ? "Background" : "Accent"}
          </button>
        ))}
      </div>
      <div className="il-cols" role="radiogroup" aria-label={target === "fill" ? "Background colours" : "Accent colours"}>
        <button type="button" role="radio" aria-checked={color === null} className={`il-auto${color === null ? " sel" : ""}`}
          title={autoLabel} aria-label={autoLabel} onClick={() => pickColour(null)} />
        {ISLAND_COLORS.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={color === c.id} className={color === c.id ? "sel" : ""} title={c.label} aria-label={c.label}
            style={{ ["--sw" as string]: c.id }} onClick={() => pickColour(c.id)} />
        ))}
      </div>
      <div className="il-custom">
        <span className="il-l">Hue</span>
        <input type="range" className="il-range il-hue" min={0} max={359} value={hue} aria-label={`Custom ${target === "fill" ? "background" : "accent"} colour: hue`} style={{ ["--sw" as string]: hueColor(hue) }}
          onChange={(e) => slideTo(Number(e.currentTarget.value), shade)} onPointerUp={letGo} onKeyUp={letGo} onBlur={letGo} />
        <input type="text" className="il-hex" value={hex} maxLength={7} spellCheck={false} placeholder="#hex" aria-label="Colour code"
          onChange={(e) => typed(e.currentTarget.value)} onBlur={enter} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); enter(); } }} />
        <span className="il-l">Shade</span>
        <input type="range" className="il-range il-shade" min={0} max={100} value={shade} aria-label={`Custom ${target === "fill" ? "background" : "accent"} colour: shade`}
          style={{ ["--a" as string]: shaded(hue, 0), ["--b" as string]: shaded(hue, 50), ["--c" as string]: shaded(hue, 100), ["--sw" as string]: shaded(hue, shade) }}
          onChange={(e) => slideTo(hue, Number(e.currentTarget.value))} onPointerUp={letGo} onKeyUp={letGo} onBlur={letGo} />
        <i className="il-now" style={{ ["--sw" as string]: color ?? "transparent" }} aria-hidden="true" />
      </div>
      <div className="il-opts">
        {kind === "pill" && (
          <div className="il-seg" role="radiogroup" aria-label="Size">
            {(["regular", "compact"] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={p.size === s} className={p.size === s ? "sel" : ""}
                onClick={() => { sfx.click(); put({ size: s }); }}>{s === "regular" ? "Regular" : "Compact"}</button>
            ))}
          </div>
        )}
        {!(kind === "notch" && n.style !== "drop") && (
          <button type="button" role="switch" aria-checked={look.icon} className={`il-sw${look.icon ? " on" : ""}`} onClick={() => { sfx.click(); put({ icon: !look.icon }); }}>
            Icon before the task<i aria-hidden="true"><b /></i>
          </button>
        )}
      </div>
    </div>
  );
}

/** The little picture in each look's chip. */
function chipVars(kind: LookKind, style: string, fill: string | null, color: string | null): React.CSSProperties {
  if (kind === "notch") { const t = notchTones({ style: style as NotchStyle, fill, color, icon: false }); return { ["--acc" as string]: t.accent, ["--glow" as string]: t.glow, ["--nfill" as string]: t.fill ?? "#000" }; }
  const t = pillTones({ style: style as PillStyle, fill, color, size: "regular", icon: false });
  return { ["--bg" as string]: t.bg, ["--bg2" as string]: t.bg2, ["--fg" as string]: t.fg, ["--edge" as string]: t.edge ?? "transparent", ["--glassbg" as string]: rgba(t.bg, t.glass) };
}

// ---------- the live preview: a strip of screen with the menu bar, the notch and the island ----------
const S = 0.72;                 // the preview's scale
/** How far the black camera notch fades into a Background around the notch, below it and beside it (Island.swift notchBlend). */
const NOTCH_BLEND = 6;
const NOTCH_W = 208, NOTCH_H = 37;
type Parts = { neckW: number; neckH: number; bodyW: number; bodyH: number; ear: number; radius: number };
/** The same parts as Island.swift notchParts(), for the preview. */
function partsFor(style: NotchStyle, open: boolean): Parts {
  const slim = style === "slim", neck = slim ? NOTCH_W + 68 : NOTCH_W;
  if (open) return { neckW: neck, neckH: NOTCH_H, bodyW: 400, bodyH: 112, ear: slim ? 7 : 0, radius: 24 };
  if (slim) return { neckW: neck, neckH: NOTCH_H, bodyW: neck, bodyH: 0, ear: 7, radius: 11 };
  if (style === "halo") return { neckW: NOTCH_W, neckH: NOTCH_H, bodyW: NOTCH_W, bodyH: 0, ear: 0, radius: 10 };
  return { neckW: NOTCH_W, neckH: NOTCH_H, bodyW: 300, bodyH: 30, ear: 0, radius: 15 };
}
/** The notch shape as an SVG path (Island.swift NotchShape, with quarter circle arcs). */
export function notchPath(p: Parts, w: number): string {
  const cx = w / 2, nl = cx - p.neckW / 2, nr = cx + p.neckW / 2, bl = cx - p.bodyW / 2, br = cx + p.bodyW / 2;
  const yb = p.neckH, ye = yb + Math.max(0, p.bodyH), e = Math.max(0, Math.min(p.ear, p.neckH / 2)), side = (p.bodyW - p.neckW) / 2;
  const A = (r: number, sweep: 0 | 1, x: number, y: number) => (r > 0.3 ? `A${r} ${r} 0 0 ${sweep} ${x} ${y}` : `L${x} ${y}`);
  let d = `M${nl - e} 0 ${A(e, 1, nl, e)}`;
  if (p.bodyH > 0.5 && side > 0.5) {
    const f = Math.min(10, side / 2, p.neckH / 2), sh = Math.max(0, Math.min(10, side - f, p.bodyH / 2)), b = Math.max(0, Math.min(p.radius, p.bodyH / 2, p.bodyW / 2));
    d += `L${nl} ${yb - f} ${A(f, 1, nl - f, yb)} L${bl + sh} ${yb} ${A(sh, 0, bl, yb + sh)} L${bl} ${ye - b} ${A(b, 0, bl + b, ye)} L${br - b} ${ye} ${A(b, 0, br, ye - b)}`
      + ` L${br} ${yb + sh} ${A(sh, 0, br - sh, yb)} L${nr + f} ${yb} ${A(f, 1, nr, yb - f)}`;
  } else {
    const bottom = Math.max(ye, yb), b = Math.max(0, Math.min(p.radius, (bottom - e) / 2, p.neckW / 2));
    d += `L${nl} ${bottom - b} ${A(b, 0, nl + b, bottom)} L${nr - b} ${bottom} ${A(b, 0, nr, bottom - b)}`;
  }
  return `${d} L${nr} ${e} ${A(e, 1, nr + e, 0)} Z`;
}
/** Eases the notch parts to their new values (the web preview's version of the island's spring). */
function useTween(target: Parts): Parts {
  const [cur, setCur] = useState(target);
  const from = useRef(target);
  const curRef = useRef(target);
  curRef.current = cur;
  const key = JSON.stringify(target);
  useEffect(() => {
    from.current = curRef.current;
    // Reduced motion, or a hidden page where frames never come: straight to the end.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || document.hidden) { setCur(target); return; }
    const ms = 420, t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const x = Math.min(1, (now - t0) / ms), k = 1 - Math.pow(1 - x, 3) * Math.cos(x * 2.2);   // eases out with a whisper of overshoot, like the island's spring
      const v = {} as Parts;
      for (const f of Object.keys(target) as (keyof Parts)[]) v[f] = from.current[f] + (target[f] - from.current[f]) * (x >= 1 ? 1 : k);
      setCur(v);
      if (x < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const end = window.setTimeout(() => { cancelAnimationFrame(raf); setCur(target); }, ms + 80);   // frames paused (a hidden window): still lands
    return () => { cancelAnimationFrame(raf); window.clearTimeout(end); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return cur;
}

const rgba = (hex: string, a: number) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")}, ${a})`;
const TASK = "Send Lumi Botanics the homepage draft";
function Mail({ c }: { c: string }) { return <span className="il-b" style={{ color: c }}><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M3 6h18v12H3z" /><path d="M3 6l9 7 9-7" fill="none" stroke="#000" strokeOpacity=".35" strokeWidth="1.6" /></svg>2</span>; }
function Reply({ c }: { c: string }) { return <span className="il-b" style={{ color: c }}><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M10 5L3 12l7 7v-4.2c5 0 8.4 1.5 11 5.2-1-5.5-4-10.4-11-11.3z" /></svg>1</span>; }
function Ring({ c, size }: { c: string; size: number }) { return <i className="il-ring" style={{ width: size, height: size, borderColor: c }} aria-hidden="true" />; }
function Scope({ c }: { c: string }) { return <svg className="il-scope" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke={c} strokeWidth="2.6" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 1v5M12 18v5M1 12h5M18 12h5" /></svg>; }

/** The grab line (Island.swift IslandGrip): a click hides the preview island for 5 seconds, as on the Mac. */
const HIDE_MS = 5000;
function Grip({ tones, top, show, onHide }: { tones: { grip: string; gripHi: string }; top: number; show: boolean; onHide: () => void }) {
  return (
    <button type="button" className={`il-grip${show ? "" : " off"}`} tabIndex={show ? 0 : -1} aria-hidden={!show}
      title="Hide for 5 seconds" aria-label="Hide for 5 seconds"
      style={{ top, ["--grip" as string]: tones.grip, ["--grip-hi" as string]: tones.gripHi }}
      onClick={(e) => { e.stopPropagation(); if (show) { sfx.click(); onHide(); } }} />
  );
}

function Preview({ kind, pill, notch }: { kind: LookKind; pill: PillLook; notch: NotchLook }) {
  const [open, setOpen] = useState(false);
  const [away, setAway] = useState(false);
  const awayT = useRef(0);
  useEffect(() => () => window.clearTimeout(awayT.current), []);
  const hide = () => { setAway(true); window.clearTimeout(awayT.current); awayT.current = window.setTimeout(() => setAway(false), HIDE_MS); };
  const usePill = kind === "pill" || noNotch();
  const pt = useMemo(() => pillTones(pill), [pill]);
  const nt = useMemo(() => notchTones(notch), [notch]);
  const parts = useTween(partsFor(notch.style, open));
  const W = 440;
  const ids = useId().replace(/:/g, "");
  const d = notchPath(parts, W);
  return (
    <div className={`il-stage${open ? " open" : ""}${away ? " away" : ""}`} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      title="Point here to see it open" aria-label="Preview">
      <div className="il-scale" style={{ width: W, transform: `scale(${S})` }}>
        <div className="il-bar" style={{ height: NOTCH_H }}>
          <span className="l">Edit&nbsp;&nbsp; View&nbsp;&nbsp; Window&nbsp;&nbsp; Help</span>
          <span className="r">Wed 4 Nov&nbsp; 21:30</span>
        </div>
        {!usePill && (
          <svg className={`il-notch-svg s-${notch.style}`} width={W} height={NOTCH_H + 130} aria-hidden="true"
            style={{ ["--acc" as string]: nt.accent, ["--glow" as string]: nt.glow }}>
            {nt.fill && (
              <defs>
                <clipPath id={`${ids}c`}><path d={d} /></clipPath>
                <linearGradient id={`${ids}v`} x1="0" y1="0" x2="0" y2="1"><stop offset={(NOTCH_H + 12) / (NOTCH_H + NOTCH_BLEND + 12)} stopColor="#000" /><stop offset="1" stopColor="#000" stopOpacity="0" /></linearGradient>
                <linearGradient id={`${ids}l`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" /></linearGradient>
                <linearGradient id={`${ids}r`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#000" /><stop offset="1" stopColor="#000" stopOpacity="0" /></linearGradient>
              </defs>
            )}
            <path d={d} fill={nt.fill ?? "#000"} style={{ transition: "fill .3s ease" }} />
            {/* The camera notch stays black, fading into the Background below it and beside it (Island.swift NotchBlack). */}
            {nt.fill && (
              <g clipPath={`url(#${ids}c)`}>
                {/* rounded at the bottom like the real notch (Island.swift NotchBlack.corner), so the colour wraps its corners */}
                <rect x={(W - NOTCH_W) / 2} y={-12} width={NOTCH_W} height={NOTCH_H + NOTCH_BLEND + 12} rx={12} fill={`url(#${ids}v)`} />
                <rect x={(W - NOTCH_W) / 2 - NOTCH_BLEND} y={0} width={NOTCH_BLEND} height={NOTCH_H - 12} fill={`url(#${ids}l)`} />
                <rect x={(W + NOTCH_W) / 2} y={0} width={NOTCH_BLEND} height={NOTCH_H - 12} fill={`url(#${ids}r)`} />
              </g>
            )}
            <path d={d} style={{ fill: "none" }} className={`il-np${notch.style === "halo" && !open ? " halo" : ""}${nt.tinted && notch.style !== "halo" ? " rim" : ""}`} />
          </svg>
        )}
        <i className="il-cam" style={{ width: NOTCH_W, height: NOTCH_H }} aria-hidden="true" />
        {usePill ? (
          <div className={`il-pill s-${pt.style}${pt.size === "compact" ? " compact" : ""}${open ? " open" : ""}`}
            style={{ top: NOTCH_H + 6, ["--bg" as string]: pt.bg, ["--bg2" as string]: pt.bg2, ["--fg" as string]: pt.fg, ["--dim" as string]: pt.dim,
              ["--acc" as string]: pt.accent, ["--edge" as string]: pt.edge ?? "transparent", ["--glassbg" as string]: rgba(pt.bg, pt.glass) }}>
            <div className="il-row">
              <Mail c={pt.mail} /><Reply c={pt.lead} />
              {pt.icon && <Scope c={pt.accent} />}
              <span className="il-t">{TASK}</span>
              <span className="il-more" style={{ color: pt.dim }}>+1</span>
              <Ring c={pt.accent} size={pt.size === "compact" ? 17 : 20} />
            </div>
            <OpenRows fg={pt.fg} dim={pt.dim} acc={pt.accent} mail={pt.mail} lead={pt.lead} />
            <Grip tones={gripTones(pt, "pill")} top={pt.size === "compact" ? 3 : 3.5} show onHide={hide} />
          </div>
        ) : (
          <div className={`il-nc s-${notch.style}${open ? " open" : ""}`} style={{ ["--fg" as string]: nt.fg, ["--dim" as string]: nt.dim }}>
            {notch.style === "drop" && !open && (
              <div className="il-drop" style={{ top: NOTCH_H, width: 300 }}>
                {notch.icon && <Scope c={nt.accent} />}
                <span className="il-t">{TASK}</span>
                <Mail c={nt.mail} /><Reply c={nt.lead} /><Ring c={nt.accent} size={18} />
              </div>
            )}
            {notch.style === "slim" && !open && (
              <div className="il-slim" style={{ width: NOTCH_W + 68, height: NOTCH_H }}>
                <Ring c={nt.accent} size={16} /><Mail c={nt.mail} />
              </div>
            )}
            <div className="il-nopen" style={{ top: NOTCH_H, width: 400 }}><OpenRows fg={nt.fg} dim={nt.dim} acc={nt.accent} mail={nt.mail} lead={nt.lead} /></div>
            {/* Just below the camera notch: on the Drop's body, and on Slim and Halo once the island opens (they have no body under the notch until then). */}
            <Grip tones={gripTones(nt, "notch")} top={NOTCH_H + 3.75} show={open || notch.style === "drop"} onHide={hide} />
          </div>
        )}
      </div>
    </div>
  );
}
function OpenRows({ fg, dim, acc, mail, lead }: { fg: string; dim: string; acc: string; mail: string; lead: string }) {
  return (
    <div className="il-open">
      <div className="il-badges"><span style={{ background: `${mail}29` }}><Mail c={mail} /></span><span style={{ background: `${lead}29` }}><Reply c={lead} /></span></div>
      <div className="il-orow"><Ring c={acc} size={22} /><span style={{ color: fg }}>{TASK}</span></div>
      <div className="il-orow"><Ring c={dim} size={22} /><span style={{ color: dim }}><em>NEXT UP</em>Invoice Northwind Silk for October</span></div>
    </div>
  );
}

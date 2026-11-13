// A full colour wheel (V1.43, Sleep mode Customise). The developer, 8 Nov 2026: "more colour options and a colour wheel".
// The ring picks the hue, the distance from the middle picks how strong the colour is, the slider under it picks how
// bright, and the box takes a #rrggbb typed in. Drag, click, or use the arrow keys on the wheel. Nothing leaves the page.
import { useEffect, useRef, useState } from "react";
import { sfx } from "../ui/sfx";

export interface Hsv { h: number; s: number; v: number }   // h 0 to 360, s and v 0 to 1
export function hexToHsv(hex: string): Hsv {
  const n = parseInt(/^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "e7a35e", 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: mx ? d / mx : 0, v: mx };
}
export function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((k) => Math.round((k + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** The wheel. `value` is #rrggbb; `onChange` gets a new #rrggbb as you drag (the caller saves a moment later). */
export function ColorWheel({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [typed, setTyped] = useState(value);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  // A new value from outside (a preset was picked): follow it, unless it is the one this wheel just sent.
  const sent = useRef(value);
  useEffect(() => { if (value !== sent.current) { sent.current = value; setHsv(hexToHsv(value)); } setTyped(value); }, [value]);
  const send = (n: Hsv) => { setHsv(n); const hex = hsvToHex(n); sent.current = hex; setTyped(hex); onChange(hex); };
  const at = (x: number, y: number) => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
    const h = (Math.atan2(dy, dx) * 180 / Math.PI + 450) % 360;   // 0 at the top, clockwise
    const s = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
    send({ h, s, v: hsv.v || 1 });
  };
  const rad = (hsv.h - 90) * Math.PI / 180;
  const dot = { left: `${50 + 50 * hsv.s * Math.cos(rad)}%`, top: `${50 + 50 * hsv.s * Math.sin(rad)}%` };
  const hex = hsvToHex(hsv);
  return (
    <div className="cw">
      <div ref={box} className="cw-wheel" role="slider" tabIndex={0} aria-label={`${label}: colour wheel`} aria-valuetext={hex}
        aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)}
        style={{ filter: `brightness(${Math.max(0.15, hsv.v)})` }}
        onPointerDown={(e) => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); sfx.hover(); at(e.clientX, e.clientY); }}
        onPointerMove={(e) => { if (drag.current) at(e.clientX, e.clientY); }}
        onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}
        onKeyDown={(e) => {
          const k = e.key;
          if (k === "ArrowLeft" || k === "ArrowRight") { e.preventDefault(); send({ ...hsv, h: (hsv.h + (k === "ArrowRight" ? 6 : 354)) % 360 }); }
          if (k === "ArrowUp" || k === "ArrowDown") { e.preventDefault(); send({ ...hsv, s: Math.max(0, Math.min(1, hsv.s + (k === "ArrowUp" ? 0.05 : -0.05))) }); }
        }}>
        <i className="cw-dot" style={{ ...dot, background: hex }} />
      </div>
      <div className="cw-side">
        <span className="cw-now" style={{ background: hex }} aria-hidden="true" />
        <label className="cw-l">Brightness
          <input type="range" min={4} max={100} value={Math.round(hsv.v * 100)} aria-label={`${label}: brightness`}
            onChange={(e) => send({ ...hsv, v: Number(e.target.value) / 100 })} />
        </label>
        <label className="cw-l">Hex
          <input className="cw-hex" value={typed} maxLength={7} spellCheck={false} aria-label={`${label}: hex colour`}
            onChange={(e) => { const t = e.target.value.trim(); setTyped(t); const h = t.startsWith("#") ? t : `#${t}`; if (/^#[0-9a-f]{6}$/i.test(h)) send(hexToHsv(h.toLowerCase())); }} />
        </label>
      </div>
    </div>
  );
}

// The screen time timeline in the Tab list's screen time pop-up: the last N hours as a line that
// rises while the developer is on the Mac, coloured by the app in front, and drops to the floor while he is
// away. Each app stretch shows its time, each break shows how long it lasted. Scroll or pinch to
// zoom on a moment, drag (or scroll sideways) to move, double click to see it all again.
// The same view draws the phone's line (V1.31, from GrapheneOS's usage events), where a break is the
// screen being off, and the other device's line from the vault, where `upTo` marks how far it was sent.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Timeline } from "../core/stline";
import type { ScreenTimeDevice } from "../core/model";
import { fmtDur } from "./ScreenTime";

const COLORS = ["#EC4E86", "#A855F7", "#38BDF8", "#34D399", "#FBBF24", "#F97316", "#F472B6", "#818CF8", "#2DD4BF", "#A3E635", "#FB7185", "#C084FC"];
const H = 190, TOP = 34, BASE = 136, MIN_SPAN = 5 * 60_000;
const hm = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const STEPS = [5, 10, 15, 30, 60, 120, 180, 360].map((m) => m * 60_000);

type Seg = { app: number; s: number; e: number };

export function StTimeline({ tl, icons, reasonOf, onPickAway, device = "mac" }: {
  tl: Timeline; icons: Record<string, string>; reasonOf: (startMs: number) => string | undefined; onPickAway?: (gap: [number, number]) => void; device?: ScreenTimeDevice;
}) {
  const phone = device === "gos";
  const awayWord = phone ? "screen off" : "away";
  // The other device's line ends where it was last sent; the rest up to now is not known yet.
  const later = tl.upTo && tl.upTo < tl.now - 60_000 ? tl.upTo : null;
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [view, setView] = useState<[number, number]>([tl.from, tl.now]);
  const [tip, setTip] = useState<{ x: number; text: string; sub: string } | null>(null);
  // A new range (the gear setting) or a newer snapshot: show the whole window again, unless zoomed in
  // on a moment (the Mac asks for a fresh line every 10 minutes): then that moment stays.
  const lastFull = useRef<[number, number]>([tl.from, tl.now]);
  useEffect(() => {
    const [pf, pn] = lastFull.current;
    lastFull.current = [tl.from, tl.now];
    setView((v) => {
      if (v[0] <= pf + 1000 && v[1] >= pn - 1000) return [tl.from, tl.now];
      const a = Math.max(tl.from, v[0]), b = Math.min(tl.now, v[1]);
      return b - a >= MIN_SPAN ? [a, b] : [tl.from, tl.now];
    });
  }, [tl.from, tl.now]);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Colours: the apps used most get the most distinct colours.
  const { segs, colorOf } = useMemo(() => {
    const segs: Seg[] = tl.segs.map(([a, s, e]) => ({ app: a, s, e }));
    const tot = new Map<number, number>();
    for (const g of segs) tot.set(g.app, (tot.get(g.app) || 0) + (g.e - g.s));
    const order = [...tot].sort((a, b) => b[1] - a[1]).map(([a]) => a);
    const colorOf = (a: number) => COLORS[Math.max(0, order.indexOf(a)) % COLORS.length];
    return { segs, colorOf };
  }, [tl]);

  const [v0, v1] = view;
  const span = v1 - v0;
  const x = (t: number) => ((t - v0) / span) * w;
  const tAt = (px: number) => v0 + (px / w) * span;
  const clamp = (a: number, b: number): [number, number] => {
    let s = Math.max(MIN_SPAN, Math.min(b - a, tl.now - tl.from));
    let start = Math.max(tl.from, Math.min(a, tl.now - s));
    if (start + s > tl.now) start = tl.now - s;
    return [start, start + s];
  };

  // Scroll or pinch zooms around the mouse; sideways scroll moves. Needs a non-passive listener.
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [a, b] = viewRef.current;
      const r = el.getBoundingClientRect();
      const at = a + ((e.clientX - r.left) / r.width) * (b - a);
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) {
        const shift = (e.deltaX / r.width) * (b - a);
        setView(clamp(a + shift, b + shift));
        return;
      }
      const k = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      setView(clamp(at - (at - a) * k, at + (b - at) * k));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tl.from, tl.now]);

  const drag = useRef<{ x: number; a: number; b: number } | null>(null);
  const onDown = (e: React.PointerEvent) => { drag.current = { x: e.clientX, a: v0, b: v1 }; (e.currentTarget as Element).setPointerCapture(e.pointerId); };
  // A click (not a drag) on a break picks it for a reason.
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || Math.abs(e.clientX - d.x) > 4) return;
    const r = wrap.current!.getBoundingClientRect();
    const t = tAt(e.clientX - r.left);
    const away = tl.away.find(([s, e2]) => s <= t && e2 >= t);
    if (away && onPickAway) onPickAway([away[0], away[1]]);
  };
  const onMove = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    if (drag.current) {
      const d = drag.current, shift = -((e.clientX - d.x) / r.width) * (d.b - d.a);
      setView(clamp(d.a + shift, d.b + shift));
      setTip(null);
      return;
    }
    const t = tAt(e.clientX - r.left);
    const g = segs.find((s) => s.s <= t && s.e >= t);
    const away = tl.away.find(([s, e2]) => s <= t && e2 >= t);
    if (g) setTip({ x: e.clientX - r.left, text: `${tl.apps[g.app]?.name}  ${fmtDur((g.e - g.s) / 1000)}`, sub: `${hm(g.s)} to ${hm(g.e)}` });
    else if (away) setTip({ x: e.clientX - r.left, text: `${reasonOf(away[0]) || (phone ? "Screen off" : "Away")} ${fmtDur((away[1] - away[0]) / 1000)}`, sub: `${hm(away[0])} to ${hm(away[1])}${onPickAway ? " · click to add a reason" : ""}` });
    else if (later && t >= later) setTip({ x: e.clientX - r.left, text: "Not sent yet", sub: `The ${phone ? "phone" : "Mac"} last sent its line at ${hm(later)}` });
    else setTip(null);
  };

  // Stretches of being on: segments closer than a minute join into one hill.
  const visible = segs.filter((g) => g.e > v0 && g.s < v1);
  const hills: { s: number; e: number; parts: Seg[] }[] = [];
  for (const g of visible) {
    const last = hills[hills.length - 1];
    if (last && g.s - last.e < 60_000) { last.e = Math.max(last.e, g.e); last.parts.push(g); }
    else hills.push({ s: g.s, e: g.e, parts: [g] });
  }
  const hillPath = (x0: number, x1: number) => {
    const r = Math.min(10, (x1 - x0) / 2);
    return `M${x0},${BASE} L${x0},${TOP + r} Q${x0},${TOP} ${x0 + r},${TOP} L${x1 - r},${TOP} Q${x1},${TOP} ${x1},${TOP + r} L${x1},${BASE} Z`;
  };
  const step = STEPS.find((s) => span / s <= w / 70) ?? STEPS[STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = Math.ceil(v0 / step) * step; t < v1; t += step) ticks.push(t);
  const zoomed = span < tl.now - tl.from - 1000;
  // The zoom slider: 0 = the whole window, 100 = five minutes, around the middle of the view.
  const full = tl.now - tl.from;
  const zoomPct = Math.round((Math.log(full / span) / Math.log(full / MIN_SPAN)) * 100) || 0;
  const setZoom = (p: number) => {
    const s = full / Math.pow(full / MIN_SPAN, p / 100), mid = (v0 + v1) / 2;
    setView(clamp(mid - s / 2, mid + s / 2));
  };

  const inView = new Map<number, number>();
  for (const g of visible) inView.set(g.app, (inView.get(g.app) || 0) + (Math.min(g.e, v1) - Math.max(g.s, v0)));
  const legend = [...inView].sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <div className="stl">
      <div className="stl-head">
        <span className="tm-panel-h">{zoomed ? `${hm(v0)} to ${hm(v1)}` : `Last ${Math.round(full / 3600_000)} hours`}</span>
        {zoomed && <button type="button" className="tm-ed-chip" onClick={() => setView([tl.from, tl.now])}>Show all</button>}
      </div>
      <div className="stl-chart" ref={wrap} onPointerDown={onDown} onPointerMove={onMove}
        onPointerUp={onUp} onPointerLeave={() => { drag.current = null; setTip(null); }}
        onDoubleClick={() => setView([tl.from, tl.now])} role="img" aria-label={`When you were on your ${phone ? "phone" : "Mac"} and which app was in front`}>
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`}>
          <defs>
            {hills.map((h, i) => <clipPath key={i} id={`stl-c${i}`}><path d={hillPath(x(Math.max(h.s, v0)), x(Math.min(h.e, v1)))} /></clipPath>)}
          </defs>
          {ticks.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={TOP - 6} y2={BASE} className="stl-grid" />)}
          <line x1={0} x2={w} y1={BASE} y2={BASE} className="stl-floor" />
          {later && later < v1 && (() => {
            const a = x(Math.max(later, v0)), b = x(v1);
            return (
              <g className="stl-later">
                <rect x={a} y={TOP} width={Math.max(0, b - a)} height={BASE - TOP} className="stl-later-bg" />
                {b - a > 70 && <text x={(a + b) / 2} y={BASE - 10} className="stl-away-t">not sent yet</text>}
              </g>
            );
          })()}
          {/* Away: the line drops to the floor, with how long it lasted. */}
          {tl.away.filter(([s, e]) => e > v0 && s < v1).map(([s, e], i) => {
            const a = x(Math.max(s, v0)), b = x(Math.min(e, v1));
            return (
              <g key={"a" + i}>
                <line x1={a} x2={b} y1={BASE} y2={BASE} className="stl-away" />
                {b - a > 56 && <text x={(a + b) / 2} y={BASE - 10} className="stl-away-t">{reasonOf(s) || awayWord} {fmtDur((e - s) / 1000)}</text>}
              </g>
            );
          })}
          {hills.map((h, i) => (
            <g key={"h" + i} clipPath={`url(#stl-c${i})`}>
              {h.parts.map((g, j) => {
                const a = x(Math.max(g.s, v0)), b = x(Math.min(g.e, v1));
                return <rect key={j} x={a} y={TOP} width={Math.max(0.5, b - a)} height={BASE - TOP} fill={colorOf(g.app)} className="stl-seg" />;
              })}
              <rect x={x(Math.max(h.s, v0))} y={TOP} width={Math.max(0.5, x(Math.min(h.e, v1)) - x(Math.max(h.s, v0)))} height={BASE - TOP} className="stl-shine" />
            </g>
          ))}
          {/* Each app stretch wide enough gets its name and time. */}
          {visible.map((g, i) => {
            const a = x(Math.max(g.s, v0)), b = x(Math.min(g.e, v1)), wd = b - a, mid = (a + b) / 2;
            if (wd < 40) return null;
            const icon = icons[tl.apps[g.app]?.id];
            return (
              <g key={"l" + i} className="stl-label">
                {wd >= 34 && icon && <image href={icon} x={mid - 10} y={TOP + 10} width={20} height={20} />}
                {wd >= 84 && <text x={mid} y={TOP + 50} className="stl-name">{tl.apps[g.app]?.name}</text>}
                <text x={mid} y={TOP + (wd >= 84 ? 70 : 52)} className="stl-dur">{fmtDur((g.e - g.s) / 1000)}</text>
              </g>
            );
          })}
          {ticks.map((t) => <text key={"t" + t} x={x(t)} y={H - 32} className="stl-tick">{hm(t)}</text>)}
          {v1 >= tl.now - 1000 && <line x1={w - 1} x2={w - 1} y1={TOP - 10} y2={BASE} className="stl-now" />}
        </svg>
        {tip && (
          <div className="stl-tip" style={{ left: Math.max(70, Math.min(w - 70, tip.x)) }}>
            <b>{tip.text}</b><span>{tip.sub}</span>
          </div>
        )}
      </div>
      <div className="stl-zoom">
        <span className="tm-pop-note">Zoom</span>
        <input type="range" min={0} max={100} value={zoomPct} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom the timeline" className="tm-pop-range" />
        <span className="tm-pop-note">Scroll or pinch on the line, drag to move</span>
      </div>
      {legend.length > 0 && (
        <ul className="stl-legend">
          {legend.map(([a, ms]) => (
            <li key={a}><i style={{ background: colorOf(a) }} />{tl.apps[a]?.name}<span className="num">{fmtDur(ms / 1000)}</span></li>
          ))}
          {inView.size > legend.length && <li className="muted">and {inView.size - legend.length} more</li>}
        </ul>
      )}
    </div>
  );
}

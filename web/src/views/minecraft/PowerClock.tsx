// Minecraft mode, power out stopwatch (the developer, 4 Nov 2026, the developer's city has frequent power cuts: "under Minecraft
// mode, start a stopwatch of like power has been out for").
// While the Mac runs on its battery: a big ticking "Power has been out for 00:42:13" and the battery level.
// When mains is back: "Power came back after 1 h 12 min" for 10 minutes, then "Power on". Below, the recent
// power cuts. PS does the watching (ps-mac Sources/PowerWatch.swift, IOKit notifications, no polling);
// this only draws what it reports. ONE timer, once a second, and only while the face changes and the panel
// can be seen (the Tab list is up and the page is visible).
// Optional: `internetOutSince` (ms) adds "Internet out for ..." once Last online data is wired in.
import { useEffect, useState, useSyncExternalStore } from "react";
import { PS, onOverlayShown, psInOverlay, psOverlayShown } from "../../ps";
import { askPower, usePower } from "./power-bridge";
import { internetText, needsTick, outageRow, powerView } from "./power-format";
import "./power.css";

function useSeen(): boolean {
  const shown = useSyncExternalStore(onOverlayShown, psOverlayShown);
  const visible = useSyncExternalStore(
    (l) => { document.addEventListener("visibilitychange", l); return () => document.removeEventListener("visibilitychange", l); },
    () => document.visibilityState !== "hidden");
  return visible && (!psInOverlay() || shown);
}

function Bolt() {
  // 8 by 8 pixel lightning bolt.
  const px = [[4, 0], [5, 0], [3, 1], [4, 1], [2, 2], [3, 2], [2, 3], [3, 3], [4, 3], [5, 3], [4, 4], [5, 4], [3, 5], [4, 5], [3, 6], [2, 7]];
  return (
    <svg className="mcp-bolt" viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden="true">
      {px.map(([x, y]) => <rect key={`${x}.${y}`} x={x} y={y} width="1" height="1" />)}
    </svg>
  );
}

function Battery({ pct, charging }: { pct: number; charging: boolean }) {
  const filled = Math.max(pct > 0 ? 1 : 0, Math.ceil(pct / 10));
  const level = pct <= 20 ? "low" : pct <= 50 ? "mid" : "ok";
  return (
    <div className={`mcp-batt ${level}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Battery">
      <div className="mcp-cells">
        {Array.from({ length: 10 }, (_, i) => <i key={i} className={i < filled ? "on" : ""} />)}
        <b className="mcp-nub" aria-hidden="true" />
      </div>
      <span className="mcp-pct num">{pct}%{charging ? " on mains" : ""}</span>
    </div>
  );
}

export function PowerClock({ internetOutSince, maxRows = 6 }: { internetOutSince?: number | null; maxRows?: number }) {
  const s = usePower();
  const seen = useSeen();
  const [now, setNow] = useState(() => Date.now());

  // Ask PS when the panel opens, and each time the Tab list shows it again.
  useEffect(() => { if (seen) askPower(); }, [seen]);
  // Fresh time for every new state and every show (no timer needed for that).
  useEffect(() => { setNow(Date.now()); }, [s, seen]);

  const ticking = seen && needsTick(s, now, internetOutSince);
  useEffect(() => {
    if (!ticking) return;
    let t = 0;
    const step = () => { const n = Date.now(); setNow(n); t = window.setTimeout(step, 1000 - (n % 1000) + 8); };
    t = window.setTimeout(step, 1000 - (Date.now() % 1000) + 8);
    return () => window.clearTimeout(t);
  }, [ticking]);

  const v = powerView(s, now, PS);
  const net = internetText(internetOutSince, now);
  const rows = s.history.slice(0, maxRows).map((o) => outageRow(o, now));

  return (
    <section className={`mcp mcp-${v.mode}`} aria-label="Power">
      <header className="mcp-head"><Bolt /><span>Power</span></header>
      {v.mode === "out" ? (
        <div className="mcp-face">
          <div className="mcp-title">{v.title}</div>
          <div className="mcp-clock num" role="timer" aria-live="off">{v.clock}</div>
          <div className="mcp-sub">{v.sub}</div>
        </div>
      ) : (
        <div className="mcp-face">
          <div className="mcp-title big" aria-live="polite">{v.title}</div>
          {"sub" in v && v.sub && <div className="mcp-sub">{v.sub}</div>}
        </div>
      )}
      {s.hasBattery && s.batteryPct !== null && <Battery pct={s.batteryPct} charging={!s.onBattery} />}
      {net && <div className="mcp-net num">{net}</div>}
      {rows.length > 0 && (
        <div className="mcp-list">
          <div className="mcp-list-h">Recent power cuts</div>
          <ol>
            {rows.map((r) => (
              <li key={r.key}>
                <span className="mcp-day">{r.day}</span>
                <span className="mcp-span num">{r.span}</span>
                <b className="mcp-len num">{r.approx ? "about " : ""}{r.length}</b>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

export default PowerClock;

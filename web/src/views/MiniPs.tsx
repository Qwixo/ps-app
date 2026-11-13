// The welcome tour's preview (G Squad, the developer 7 Nov 2026: "a little window on the right... so you can actually preview
// where the setting you're currently modifying lives in the PS app too. Maybe a little animation as well so you can
// find it yourself"). A small drawing of the Tab list: the top bar buttons in their real order, the clocks, the list
// with example tasks, the side panels. A pointer walks to the button that holds the setting, clicks it, the screen it
// opens slides in (Settings, Security, Do Not Disturb, or macOS's own System Settings for a permission) and the row
// glows. Then it starts again. Only transform and opacity animate; reduced motion shows the end state still.
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import type { Anchor, Where } from "../core/welcome";
import "./minips.css";

/** Where each part of the Tab list sits in the drawing, in percent of its width and height. */
const AT: Record<Anchor, { x: number; y: number; w: number; h: number }> = {
  island: { x: 43, y: 0, w: 14, h: 5 },
  clock: { x: 3, y: 8, w: 17, h: 5 },
  glass: { x: 41, y: 8, w: 18, h: 5 },
  net: { x: 61.5, y: 8, w: 3.6, h: 5 },
  mixer: { x: 65.6, y: 8, w: 3.6, h: 5 },
  gear: { x: 69.7, y: 8, w: 3.6, h: 5 },
  tab: { x: 73.8, y: 8, w: 6.6, h: 5 },
  lock: { x: 80.9, y: 8, w: 5.6, h: 5 },
  padlock: { x: 87, y: 8, w: 3.6, h: 5 },
  squad: { x: 91.1, y: 8, w: 3.6, h: 5 },
  moon: { x: 95.2, y: 8, w: 3.6, h: 5 },
  zones: { x: 3, y: 17, w: 20, h: 13 },
  meetings: { x: 3, y: 33, w: 20, h: 30 },
  dimx: { x: 3.5, y: 88, w: 4, h: 6.4 },
  fitness: { x: 13.5, y: 88, w: 4, h: 6.4 },
  add: { x: 63, y: 16, w: 4, h: 6.4 },
  list: { x: 29, y: 26, w: 39, h: 44 },
  completed: { x: 29, y: 74, w: 39, h: 12 },
  notes: { x: 74, y: 17, w: 22, h: 32 },
  overdue: { x: 74, y: 53, w: 22, h: 26 },
  screen: { x: 0, y: 0, w: 100, h: 100 },
};
const mid = (a: Anchor) => ({ x: AT[a].x + AT[a].w / 2, y: AT[a].y + AT[a].h / 2 });

const TASKS = ["The one thing that matters most", "Click a task to work on it", "Drag me to change my priority", "Right click me", "Tick me off"];

type Phase = "move" | "click" | "sheet" | "row";

export function MiniPs({ where, looks }: { where: Where; looks?: boolean }) {
  const [phase, setPhase] = useState<Phase>("move");
  const [cycle, setCycle] = useState(0);
  const quick = useRef(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const key = JSON.stringify(where);
  // The walk: start at the middle, go to the button, click, the screen opens, go to the row, glow; then again.
  useEffect(() => {
    if (quick.current) { setPhase(where.sheet ? "row" : "click"); return; }
    setPhase("move");
    const t: number[] = [];
    t.push(window.setTimeout(() => setPhase("click"), 1100));
    if (where.sheet) {
      t.push(window.setTimeout(() => setPhase("sheet"), 1500));
      t.push(window.setTimeout(() => setPhase("row"), 2400));
    }
    t.push(window.setTimeout(() => setCycle((c) => c + 1), where.sheet ? 5600 : 4200));
    return () => t.forEach(clearTimeout);
  }, [key, cycle]); // eslint-disable-line react-hooks/exhaustive-deps

  const target = mid(where.at);
  const sheetOpen = !!where.sheet && (phase === "sheet" || phase === "row");
  const rowIdx = where.sheet?.row ?? 0;
  // Where the glowing row sits in each kind of screen (minips.css: its top, its header, the row height).
  const rowAt = where.sheet ? ({ dnd: { x: 75, y: 26 }, macos: { x: 62, y: 31 } } as Record<string, { x: number; y: number }>)[where.sheet.kind] ?? { x: 50, y: 29 } : { x: 50, y: 29 };
  const ptr = sheetOpen && phase === "row" ? { x: rowAt.x, y: rowAt.y + rowIdx * 9.6 } : phase === "move" ? { x: 50, y: 60 } : target;
  const box = AT[where.at];
  return (
    <div className={`mps${looks ? " looks" : ""}`} aria-hidden="true">
      <div className="mps-screen">
        <div className={`mps-island${where.at === "island" ? " hot" : ""}`}><i /></div>
        <div className="mps-bar">
          <span className="mps-clock" style={pos("clock")}>7:20 PM · NY 11:20</span>
          <span className="mps-glass" style={pos("glass")}><i /></span>
          {(["net", "mixer", "gear", "padlock", "squad", "moon"] as Anchor[]).map((a) => <span key={a} className={`mps-btn ${a}`} style={pos(a)}>{ICON[a]}</span>)}
          <span className="mps-pill" style={pos("tab")}>Tab</span>
          <span className="mps-pill" style={pos("lock")}>Lock</span>
        </div>
        <div className="mps-card" style={pos("zones")}><b>Time zones</b><em>You · New York · London</em></div>
        <div className="mps-card" style={pos("meetings")}><b>Coming up</b><em>9:00 Example call</em><em>17:30 Example meeting</em></div>
        <span className="mps-btn round" style={pos("dimx")}>X</span>
        <span className="mps-btn round" style={pos("fitness")}>{ICON.fitness}</span>
        <div className="mps-head"><b>Mission agenda</b></div>
        <span className="mps-btn round add" style={pos("add")}>+</span>
        <div className="mps-list" style={pos("list")}>
          {TASKS.map((t, i) => <div key={t} className={`mps-task${i === 0 ? " p1" : ""}${i === 1 ? " work" : ""}`}><i />{t}</div>)}
        </div>
        <div className="mps-done" style={pos("completed")}><b>Completed</b><div className="mps-task done"><i />A task you ticked</div></div>
        <div className="mps-card" style={pos("notes")}><b>Meeting notes</b><em>Example: ask about the plan</em></div>
        <div className="mps-card warn" style={pos("overdue")}><b>Overdue</b><em>Example: send the file</em></div>
        {where.at !== "screen" && <div key={`ring${cycle}`} className={`mps-ring${phase !== "move" ? " on" : ""}`} style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` }} />}
        {where.sheet && (
          <div className={`mps-sheet ${where.sheet.kind}${sheetOpen ? " on" : ""}`}>
            {where.sheet.kind === "macos"
              ? <div className="mps-mac"><div className="mps-mac-bar"><i /><i /><i /><span>System Settings</span></div>
                <div className="mps-mac-body"><div className="mps-mac-side">{(() => { const gen = /Login Items/.test(where.sheet!.title); return <><em className={gen ? "on" : ""}>General</em><em className={gen ? "" : "on"}>Privacy &amp; Security</em><em>Lock Screen</em></>; })()}</div>
                  <div className="mps-mac-main"><b>{where.sheet.title}</b>{where.sheet.rows.map((r, i) => (
                    <div key={r} className={`mps-row${i === rowIdx && phase === "row" ? " hot" : ""}`}><span>{r}</span><span className={`mps-tog${i === rowIdx && phase === "row" ? " on" : ""}`}><i /></span></div>
                  ))}</div></div></div>
              : <>
                <div className="mps-sheet-h"><b>{where.sheet.title}</b>{where.sheet.tab && <span>{where.sheet.tab}</span>}</div>
                {where.sheet.rows.map((r, i) => <div key={r} className={`mps-row${i === rowIdx && phase === "row" ? " hot" : ""}`}><span>{r}</span></div>)}
              </>}
          </div>
        )}
        <div className={`mps-ptr ${phase}`} style={{ "--x": `${ptr.x}%`, "--y": `${ptr.y}%` } as CSSProperties}>
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 3l14 8-6 2-2 6z" fill="#fff" stroke="#111" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          <i className="mps-tap" key={`tap${cycle}${phase}`} />
        </div>
      </div>
    </div>
  );
}

function pos(a: Anchor): CSSProperties {
  const b = AT[a];
  return { left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` };
}

const sv = (d: string) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const ICON: Partial<Record<Anchor, ReactElement>> = {
  net: sv("M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h0"),
  mixer: sv("M6 4v16M12 4v16M18 4v16M4 9h4M10 15h4M16 7h4"),
  gear: sv("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"),
  padlock: sv("M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3"),
  moon: sv("M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"),
  squad: sv("M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5M5 11.5a2 2 0 1 0 0-.1M19 11.5a2 2 0 1 0 0-.1"),
  fitness: sv("M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"),
};

// Goals timeline: the developer's goals on three lanes that share one time line.
//   Macro: the big ones, across months (the year).   Meso: month by month.   Micro: week by week.
// Click an empty spot in a lane to add a goal there; drag a goal to move it, drag its ends to
// stretch it; click it to rename, recolour or delete. Swipe (or drag the background) to move
// through time, pinch or use the slider to zoom from a few weeks to whole years.
// Opens from the map button in the Tab list's Timelines panel, and in the To-do page's Map.
// "How it works" opens a pop-up with the video the idea came from (GoalsVideo below).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Goal } from "../core/model";
import { GOALS_VIDEO, canEmbedVideo } from "../core/goalsvideo";
import { sfx } from "../ui/sfx";
import "./goals.css";

const DAY = 86400000;
export const GOAL_COLORS = ["#EC4E86", "#A855F7", "#38BDF8", "#34D399", "#FBBF24", "#F97316", "#F472B6", "#818CF8"];
const LANES: { level: Goal["level"]; title: string; sub: string }[] = [
  { level: "macro", title: "Macro", sub: "the big goals" },
  { level: "meso", title: "Meso", sub: "month by month" },
  { level: "micro", title: "Micro", sub: "week by week" },
];
const ROW = 38, LANE_PAD = 10, HEAD = 58;
const iso = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const at = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d).getTime(); };
const days = (a: number, b: number) => Math.round((b - a) / DAY);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Stack goals that overlap into rows, in start order. */
function stack(list: Goal[]) {
  const rows: number[] = [];
  const out = new Map<string, number>();
  for (const g of [...list].sort((a, b) => a.start.localeCompare(b.start))) {
    const s = at(g.start);
    let r = rows.findIndex((end) => end < s);
    if (r < 0) { r = rows.length; rows.push(0); }
    rows[r] = at(g.end);
    out.set(g.id, r);
  }
  return { rowOf: out, rows: Math.max(1, rows.length) };
}

export function GoalsTimeline({ goals, onSave }: { goals: Goal[]; onSave: (list: Goal[]) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const now = Date.now();
  const thisYear = new Date().getFullYear();
  // The canvas: from January last year to December the year after next (more if goals reach further).
  const range = useMemo(() => {
    let a = new Date(thisYear - 1, 0, 1).getTime(), b = new Date(thisYear + 2, 11, 31).getTime();
    for (const g of goals) { a = Math.min(a, at(g.start) - 31 * DAY); b = Math.max(b, at(g.end) + 31 * DAY); }
    return { a, b };
  }, [goals, thisYear]);
  const [ppd, setPpd] = useState(12);            // pixels per day: the zoom
  const [sel, setSel] = useState<string | null>(null);
  const [live, setLive] = useState<Goal[] | null>(null);   // goals while dragging (saved on release)
  const [video, setVideo] = useState(false);
  const list = live ?? goals;
  const xOf = (t: number) => ((t - range.a) / DAY) * ppd;
  const width = days(range.a, range.b) * ppd;

  // Open on October this year (or the current month) to the end of the year, filling the width.
  const first = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !first.current) return;
    first.current = false;
    const start = new Date(thisYear, Math.min(new Date().getMonth(), 9), 1).getTime();
    const end = new Date(thisYear, 11, 31).getTime();
    const fit = Math.max(2, Math.min(60, (el.clientWidth - 40) / days(start, end)));
    setPpd(fit);
    requestAnimationFrame(() => { el.scrollLeft = ((start - range.a) / DAY) * fit - 20; });
  }, [range.a, thisYear]);

  // Zoom keeping a date under a point (the middle, or the mouse when pinching).
  const zoomTo = (next: number, anchorPx?: number) => {
    const el = scroller.current;
    if (!el) return;
    const p = anchorPx ?? el.clientWidth / 2;
    const t = range.a + ((el.scrollLeft + p) / ppd) * DAY;
    const z = Math.max(1.2, Math.min(80, next));
    setPpd(z);
    requestAnimationFrame(() => { el.scrollLeft = ((t - range.a) / DAY) * z - p; });
  };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey) { e.preventDefault(); const r = el.getBoundingClientRect(); zoomTo(ppd * Math.exp(-e.deltaY * 0.01), e.clientX - r.left); return; }
      // An ordinary mouse wheel scrolls through time; trackpad swipes already go sideways.
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); el.scrollLeft += e.deltaY; }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  });
  const jump = (start: number, end: number) => {
    const el = scroller.current;
    if (!el) return;
    const z = Math.max(1.2, Math.min(80, (el.clientWidth - 40) / Math.max(7, days(start, end))));
    setPpd(z);
    requestAnimationFrame(() => el.scrollTo({ left: ((start - range.a) / DAY) * z - 20, behavior: "smooth" }));
  };

  // Header: years and months on top, weeks (or days when zoomed in) below.
  const months: { t: number; label: string; x: number; w: number }[] = [];
  for (let d = new Date(range.a); d.getTime() < range.b; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const t = d.getTime(), next = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    months.push({ t, label: ppd * 30 > 70 ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : MONTHS[d.getMonth()][0], x: xOf(t), w: xOf(next) - xOf(t) });
  }
  const weeks: { t: number; x: number }[] = [];
  if (ppd * 7 >= 26) {
    const mon = new Date(range.a); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
    for (let t = mon.getTime(); t < range.b; t += 7 * DAY) weeks.push({ t, x: xOf(t) });
  }

  // Drag: move a goal, or stretch it from either end. Snaps to whole days.
  const drag = useRef<{ id: string; mode: "move" | "start" | "end"; x: number; g: Goal; moved: boolean } | null>(null);
  const pan = useRef<{ x: number; left: number } | null>(null);
  const panned = useRef(false);   // the background was dragged: that release is not a click to add
  const onGoalDown = (e: React.PointerEvent, g: Goal, mode: "move" | "start" | "end") => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { id: g.id, mode, x: e.clientX, g, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) {
      const dd = Math.round((e.clientX - d.x) / ppd);
      if (dd === 0 && !d.moved) return;
      d.moved = true;
      let s = at(d.g.start), en = at(d.g.end);
      if (d.mode === "move") { s += dd * DAY; en += dd * DAY; }
      else if (d.mode === "start") s = Math.min(en, s + dd * DAY);
      else en = Math.max(s, en + dd * DAY);
      setLive(goals.map((g) => g.id === d.id ? { ...g, start: iso(s), end: iso(en) } : g));
      return;
    }
    if (pan.current && scroller.current) {
      if (Math.abs(e.clientX - pan.current.x) > 4) panned.current = true;
      scroller.current.scrollLeft = pan.current.left - (e.clientX - pan.current.x);
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    pan.current = null;
    if (d && d.moved && live) { onSave(live); sfx.drop(); }
    else if (d) { setSel(d.id); sfx.click(); }
    setLive(null);
  };
  const addAt = (e: React.MouseEvent, level: Goal["level"]) => {
    if (panned.current) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const t = range.a + ((e.clientX - r.left) / ppd) * DAY;
    const d = new Date(t);
    let s: number, en: number;
    if (level === "micro") { const m = new Date(d); m.setDate(d.getDate() - ((d.getDay() + 6) % 7)); s = m.getTime(); en = s + 6 * DAY; }
    else if (level === "meso") { s = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); en = new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime(); }
    else { s = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); en = new Date(d.getFullYear(), d.getMonth() + 3, 0).getTime(); }
    const g: Goal = { id: crypto.randomUUID(), title: "", level, start: iso(s), end: iso(en), color: GOAL_COLORS[goals.length % GOAL_COLORS.length], createdAt: new Date().toISOString() };
    onSave([...goals, g]);
    setSel(g.id);
    sfx.drop();
  };

  const selected = list.find((g) => g.id === sel) || null;
  const zoomPct = Math.round((Math.log(ppd / 1.2) / Math.log(80 / 1.2)) * 100);

  return (
    <div className="gt">
      <div className="gt-bar">
        <div className="gt-jumps">
          <button type="button" onClick={() => jump(new Date(thisYear, 9, 1).getTime(), new Date(thisYear, 11, 31).getTime())}>Oct to Dec</button>
          <button type="button" onClick={() => jump(new Date(thisYear, new Date().getMonth(), 1).getTime(), new Date(thisYear, new Date().getMonth() + 1, 0).getTime())}>This month</button>
          <button type="button" onClick={() => jump(new Date(thisYear, 0, 1).getTime(), new Date(thisYear, 11, 31).getTime())}>{thisYear}</button>
          <button type="button" onClick={() => jump(new Date(thisYear + 1, 0, 1).getTime(), new Date(thisYear + 1, 11, 31).getTime())}>{thisYear + 1}</button>
          <button type="button" onClick={() => jump(range.a, range.b)}>Everything</button>
        </div>
        <button type="button" className="gt-how" onClick={() => { sfx.click(); setVideo(true); }} aria-haspopup="dialog">
          <span className="gt-how-play" aria-hidden="true" />How it works
        </button>
        <label className="gt-zoom">
          <span>Zoom</span>
          <input type="range" min={0} max={100} value={zoomPct} onChange={(e) => zoomTo(1.2 * Math.pow(80 / 1.2, Number(e.target.value) / 100))} aria-label="Zoom the timeline" />
        </label>
      </div>
      <div className="gt-body">
        <div className="gt-lanes-h" style={{ paddingTop: HEAD }}>
          {LANES.map((l) => {
            const rows = stack(list.filter((g) => g.level === l.level)).rows;
            return <div key={l.level} className={`gt-lh ${l.level}`} style={{ height: rows * ROW + LANE_PAD * 2 + 8 }}><b>{l.title}</b><span>{l.sub}</span></div>;
          })}
        </div>
        <div className="gt-scroll" ref={scroller}
          onPointerDown={(e) => { panned.current = false; if (!drag.current) pan.current = { x: e.clientX, left: scroller.current!.scrollLeft }; }}
          onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
          <div className="gt-canvas" style={{ width, ["--wk" as string]: `${ppd * 7}px` }}>
            <div className="gt-head" style={{ height: HEAD }}>
              {months.map((m) => <div key={m.t} className={`gt-month${new Date(m.t).getMonth() === 0 ? " jan" : ""}`} style={{ left: m.x, width: m.w }}><span>{m.label}</span></div>)}
              {weeks.map((w) => <span key={w.t} className="gt-week" style={{ left: w.x }}>{new Date(w.t).getDate()}</span>)}
            </div>
            {months.map((m) => <div key={"g" + m.t} className="gt-mline" style={{ left: m.x }} />)}
            <div className="gt-today" style={{ left: xOf(now) }}><span>Today</span></div>
            {LANES.map((l) => {
              const mine = list.filter((g) => g.level === l.level);
              const { rowOf, rows } = stack(mine);
              return (
                <div key={l.level} className={`gt-lane ${l.level}`} style={{ height: rows * ROW + LANE_PAD * 2 + 8 }}
                  onClick={(e) => { if (e.target === e.currentTarget) addAt(e, l.level); }} title="Click to add a goal here">
                  {mine.map((g) => {
                    const x0 = xOf(at(g.start)), x1 = xOf(at(g.end) + DAY), w = Math.max(10, x1 - x0);
                    return (
                      <div key={g.id} className={`gt-goal${sel === g.id ? " sel" : ""}${g.done ? " done" : ""}${live ? " dragging" : ""}`}
                        style={{ left: x0, width: w, top: LANE_PAD + (rowOf.get(g.id) || 0) * ROW, ["--c" as string]: g.color }}
                        onPointerDown={(e) => onGoalDown(e, g, "move")} title={`${g.title || "Untitled"}: ${g.start} to ${g.end}`}>
                        <span className="gt-h gt-h-l" onPointerDown={(e) => onGoalDown(e, g, "start")} />
                        <span className="gt-t">{g.done ? "✓ " : ""}{g.title || "Untitled goal"}</span>
                        <span className="gt-h gt-h-r" onPointerDown={(e) => onGoalDown(e, g, "end")} />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {selected ? (
        <GoalEditor key={selected.id} g={selected} onChange={(p) => onSave(goals.map((g) => g.id === selected.id ? { ...g, ...p } : g))}
          onDelete={() => { onSave(goals.filter((g) => g.id !== selected.id)); setSel(null); }} onClose={() => setSel(null)} />
      ) : (
        <p className="gt-hint">Click an empty spot in a lane to add a goal. Drag a goal to move it, drag its ends to stretch it, click it to edit. Swipe or drag the background to move through time, pinch or use the slider to zoom.</p>
      )}
      {video && <GoalsVideo onClose={() => setVideo(false)} />}
    </div>
  );
}

function GoalEditor({ g, onChange, onDelete, onClose }: { g: Goal; onChange: (p: Partial<Goal>) => void; onDelete: () => void; onClose: () => void }) {
  const [title, setTitle] = useState(g.title);
  const [note, setNote] = useState(g.note || "");
  const [sure, setSure] = useState(false);
  return (
    <div className="gt-edit" style={{ ["--c" as string]: g.color }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <input className="gt-in gt-title" value={title} autoFocus={!g.title} placeholder="Name this goal" onChange={(e) => setTitle(e.target.value)}
        onBlur={() => { if (title.trim() !== g.title) onChange({ title: title.trim().slice(0, 120) }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      <div className="gt-row">
        <div className="gt-levels" role="radiogroup" aria-label="Lane">
          {LANES.map((l) => <button key={l.level} type="button" className={g.level === l.level ? "on" : ""} onClick={() => onChange({ level: l.level })}>{l.title}</button>)}
        </div>
        <div className="gt-colors" role="radiogroup" aria-label="Colour">
          {GOAL_COLORS.map((c) => <button key={c} type="button" className={g.color === c ? "on" : ""} style={{ background: c }} onClick={() => onChange({ color: c })} aria-label={`Colour ${c}`} />)}
        </div>
        <label className="gt-date">From <input type="date" value={g.start} onChange={(e) => { if (e.target.value) onChange({ start: e.target.value, end: e.target.value > g.end ? e.target.value : g.end }); }} /></label>
        <label className="gt-date">To <input type="date" value={g.end} onChange={(e) => { if (e.target.value) onChange({ end: e.target.value < g.start ? g.start : e.target.value }); }} /></label>
      </div>
      <textarea className="gt-in" rows={2} value={note} placeholder="Notes: what done looks like" onChange={(e) => setNote(e.target.value)}
        onBlur={() => { if (note.trim() !== (g.note || "")) onChange({ note: note.trim().slice(0, 1000) || null }); }} />
      <div className="gt-row">
        <button type="button" className={`gt-btn${g.done ? " on" : ""}`} onClick={() => { sfx.done(); onChange({ done: !g.done }); }}>{g.done ? "Done ✓" : "Mark done"}</button>
        <span style={{ flex: 1 }} />
        <button type="button" className={`gt-btn danger${sure ? " sure" : ""}`} onClick={() => { if (!sure) { setSure(true); return; } onDelete(); }}>{sure ? "Click again to delete" : "Delete"}</button>
        <button type="button" className="gt-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

let videoOpen = false;   // Esc then closes only the video pop-up (GoalsWindow checks it)

/** The video the goal levels come from. The frame only exists while the pop-up is open, so
 *  nothing loads from YouTube before that, and closing it stops the video. */
function GoalsVideo({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const shut = useRef(onClose);
  shut.current = onClose;
  useEffect(() => {
    videoOpen = true;
    close.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); shut.current(); } };
    window.addEventListener("keydown", key, true);
    return () => { videoOpen = false; window.removeEventListener("keydown", key, true); };
  }, []);
  return (
    <div className="gv-scrim" role="dialog" aria-modal="true" aria-labelledby="gv-title"
      onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="gv-card">
        <header className="gv-h">
          <h3 id="gv-title">This is how it works, explained by the idea it came from</h3>
          <button ref={close} type="button" className="gt-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        {canEmbedVideo(location.protocol) ? (
          <div className="gv-frame">
            <iframe src={GOALS_VIDEO.embed} title="This is how it works, explained by the idea it came from"
              allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox" />
          </div>
        ) : (
          <a className="gv-frame gv-out" href={GOALS_VIDEO.watch} target="_blank" rel="noopener noreferrer">
            <span className="gv-out-play" aria-hidden="true" />
            <span>Plays on YouTube in your browser</span>
          </a>
        )}
        <a className="gv-link" href={GOALS_VIDEO.watch} target="_blank" rel="noopener noreferrer">Open on YouTube<span aria-hidden="true"> ↗</span></a>
      </div>
    </div>
  );
}

/** The big window it opens in (Tab list). */
export function GoalsWindow({ goals, onSave, onClose }: { goals: Goal[]; onSave: (list: Goal[]) => void; onClose: () => void }) {
  useEffect(() => {
    // While the video pop-up is open, Esc closes only the pop-up (its own key handler).
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented && !videoOpen) { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
  return (
    <div className="gt-scrim" role="dialog" aria-modal="true" aria-label="Goals timeline" onMouseDown={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="gt-win">
        <header className="gt-win-h">
          <div><span className="gt-eyebrow">Your goals</span><h2>Timeline</h2></div>
          <button type="button" className="gt-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <GoalsTimeline goals={goals} onSave={onSave} />
      </div>
    </div>
  );
}

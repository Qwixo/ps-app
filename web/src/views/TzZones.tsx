// Your time zones (V1.40, every account): the box that adds a clock to the Time zones screen. Type a city,
// a country, a zone's name or its abbreviation ("Dubai", "UK", "Central European", "CET", "GST") and pick
// one; it joins the list straight away and the box stays open for the next. The list itself (taking a clock
// off with Undo, dragging one to move it) lives in TimeZones.tsx; the list logic in core/tzzones.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtTime, gapLabel, homeTz, offsetMin, type Zone } from "../core/tz";
import { TZ_ZONES_MAX, findZoneChoices, zonesOf } from "../core/tzzones";
import { tzZonesDoc } from "../core/select";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";

/** The clocks on your list, in your order (the built in five until you change them). */
export function useZones(): Zone[] {
  const rec = tzZonesDoc(useVault());
  return useMemo(() => zonesOf(rec?.data), [rec]);
}

export const GlobeAdd = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);

export function ZoneAdd({ list, now, onAdd, onClose }: { list: Zone[]; now: number; onAdd: (z: Zone) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => findZoneChoices(q, undefined, 7), [q]);
  useEffect(() => setSel(0), [q]);
  useEffect(() => { input.current?.focus(); }, []);
  const home = homeTz();
  const mine = offsetMin(now, home);
  const full = list.length >= TZ_ZONES_MAX;
  const why = (tz: string) => tz === home ? "Your zone" : list.some((z) => z.id === tz) ? "On your list" : "";
  const pick = (i: number) => {
    const h = hits[i];
    if (!h || why(h.tz) || full) return;
    sfx.click();
    onAdd({ id: h.tz, label: h.label, short: h.short });
    setQ("");
    input.current?.focus();
  };
  return (
    <div className="tz-zadd" onMouseDown={(e) => e.stopPropagation()}>
      <div className="tz-form-h">
        <span className="tm-panel-h">Add a time zone</span>
        <button type="button" className="tz-x" onClick={() => { sfx.hover(); onClose(); }} aria-label="Close" title="Close (Esc)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <label className="tz-find-in">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
        <input ref={input} type="text" value={q} placeholder="City, country or zone" autoComplete="off" spellCheck={false} maxLength={60}
          role="combobox" aria-label="Find a time zone to add" aria-autocomplete="list" aria-expanded={!!q.trim()} aria-controls="tz-zadd-list"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            // Every key here is the box's own: nothing in the Tab list reacts to it.
            if (e.key !== "Tab") e.stopPropagation();
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(hits.length - 1, i + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); pick(sel); }
            else if (e.key === "Escape") { e.preventDefault(); if (q) setQ(""); else { sfx.hover(); onClose(); } }
          }}
          onKeyUp={(e) => { if (e.key !== "Tab") e.stopPropagation(); }} />
      </label>
      {full ? (
        <p className="tz-find-hint">Your list holds {TZ_ZONES_MAX} clocks at most. Take one off to add another.</p>
      ) : !q.trim() ? (
        <p className="tz-find-hint">Type a city like Dubai, a country like UK, or a zone like CET or Central European. Drag a clock to move it.</p>
      ) : (
        <ul className="tz-find-list tz-zadd-list" id="tz-zadd-list" role="listbox" aria-label="Time zones">
          {hits.length ? hits.map((h, i) => {
            const taken = why(h.tz);
            return (
              <li key={h.tz} role="option" aria-selected={i === sel} aria-disabled={!!taken || undefined} style={{ ["--i" as string]: i }}
                className={`${i === sel ? "on" : ""}${taken ? " taken" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); pick(i); }} onMouseEnter={() => setSel(i)}>
                <span className="tz-find-n">
                  <span className="tz-zadd-l"><span>{h.label}</span>{h.short && <i className="tz-short">{h.short}</i>}</span>
                  <small>{taken || h.about}</small>
                </span>
                <span className="tz-find-t">
                  <b className="num">{fmtTime(now, h.tz)}</b>
                  <em>{gapLabel(offsetMin(now, h.tz) - mine)}</em>
                </span>
              </li>
            );
          }) : <li className="tz-find-empty">No zone for “{q.trim()}”. Try a big city nearby.</li>}
        </ul>
      )}
    </div>
  );
}

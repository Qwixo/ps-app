// The Time zones screen's people (V1.39, every account): add anyone (a client, a friend, "Mum") with the zone
// they live in, rename them, move them or take them off (with Undo), and find anyone by name. Real clients come
// from the client vault as before; the people added here are small records of their own (core/tzpeople.ts).
// TimeZones.tsx draws these and plays the find animation.
import { useEffect, useMemo, useRef, useState } from "react";
import { homeTz, offsetMin, fmtTime, validTz, zoneList } from "../core/tz";
import { cityOf, findZones, fold, gapWords, searchPeople, zoneTitle, type PersonEntry } from "../core/tzpeople";
import { addTzPerson, editTzPerson } from "../core/actions";
import { clientViews, tzPeople } from "../core/select";
import type { Snapshot } from "../core/vault";
import { sfx } from "../ui/sfx";

/** Everyone the screen knows: the clients (with or without a zone) and the people added here. A client with no
 *  zone whose name is also an added person shows once, as the person. */
export function peopleOf(s: Snapshot): PersonEntry[] {
  const people: PersonEntry[] = tzPeople(s).map((d) => ({ key: `p:${d.id}`, id: d.id, name: d.data.name, tz: validTz(d.data.tz) ? d.data.tz : null, kind: "person" }));
  const named = new Set(people.map((p) => fold(p.name)));
  const clients: PersonEntry[] = [];
  for (const c of clientViews(s)) {
    const tz = c.client?.data.timezone && validTz(c.client.data.timezone) ? c.client.data.timezone : null;
    if (!tz && named.has(fold(c.name))) continue;
    clients.push({ key: `c:${c.client?.id ?? c.ws}`, id: c.client?.id ?? c.ws, name: c.name, tz, kind: "client" });
  }
  return [...clients, ...people];
}
/** Everyone whose zone runs on the same clock as `zone` right now (Vancouver counts as Pacific). */
export function peopleOnClock(list: PersonEntry[], zone: string, ts: number) {
  const off = offsetMin(ts, zone);
  return list.filter((p) => p.tz && offsetMin(ts, p.tz) === off);
}

/** "Los Angeles · Pacific", "Vancouver", "Tokyo". */
export function zoneLine(tz: string) {
  const z = zoneList().find((x) => x.id === tz);
  return z && z.label !== cityOf(tz) ? `${cityOf(tz)} · ${z.label}` : cityOf(tz);
}

const Mag = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>
);
export const AddIcon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="10" cy="8" r="3.6" /><path d="M3.5 19.5c.8-3.6 3.4-5.5 6.5-5.5 1.2 0 2.3.3 3.2.8" /><path d="M18.5 13v7M15 16.5h7" /></svg>
);
export const SearchIcon = Mag;
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const FIND_KEY = isMac ? "⌘F" : "Ctrl+F";

// ---------- the zone picker ----------
/** The zone for a person: shows the chosen one, and typing a city or zone ("Vancouver", "san fran", "UK")
 *  lists the zones to pick from. */
export function ZonePick({ value, onPick, onFocus, onBlur, now }: { value: string; onPick: (tz: string) => void; onFocus?: () => void; onBlur?: () => void; now: number }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const hits = useMemo(() => findZones(q, undefined, 6), [q]);
  useEffect(() => setSel(0), [q]);
  const mine = offsetMin(now, homeTz());
  const pick = (tz: string) => { sfx.click(); onPick(tz); setQ(""); };
  return (
    <div className="tz-zp">
      <label className="tz-field">
        <span className="tz-field-l">Time zone</span>
        <span className="tz-zp-in">
          <Mag size={13} />
          <input type="text" value={q} placeholder={`${zoneLine(value)} (type a city to change)`} autoComplete="off" spellCheck={false}
            aria-label="Time zone: type a city or zone" aria-autocomplete="list" aria-expanded={!!q.trim()} maxLength={60}
            onFocus={onFocus} onBlur={onBlur}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // An empty box leaves its keys to the form (Enter saves, Esc closes), which keeps them from the Tab list.
              if (!q.trim()) return;
              if (e.key !== "Tab") e.stopPropagation();
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(hits.length - 1, i + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); if (hits[sel]) pick(hits[sel].tz); }
              else if (e.key === "Escape") { e.preventDefault(); setQ(""); }
            }} />
        </span>
      </label>
      <div className="tz-zp-now" key={value}>
        <b>{zoneLine(value)}</b>
        <span className="num">{fmtTime(now, value)}</span>
        <em>{gapWords(offsetMin(now, value) - mine)}</em>
      </div>
      {q.trim() !== "" && (
        <ul className="tz-zp-list" role="listbox">
          {hits.length ? hits.map((h, i) => (
            <li key={h.tz} role="option" aria-selected={i === sel} className={i === sel ? "on" : ""}
              onMouseDown={(e) => { e.preventDefault(); pick(h.tz); }} onMouseEnter={() => setSel(i)}>
              <span className="tz-zp-city">{h.via ? <>{h.via} <i>{cityOf(h.tz)} time</i></> : zoneLine(h.tz)}</span>
              <span className="tz-zp-t num">{fmtTime(now, h.tz)}</span>
            </li>
          )) : <li className="tz-zp-none">No zone for “{q.trim()}”. Try a big city nearby.</li>}
        </ul>
      )}
    </div>
  );
}

// ---------- add, rename, move ----------
export type FormMode = { mode: "add"; tz: string; name?: string } | { mode: "edit"; id: string; name: string; tz: string };
/** The small form: a name and a zone. Enter saves, Esc closes it (and nothing else). */
export function PersonForm({ form, now, onDone, onRemove, onFocusChange, onSaved }: {
  form: FormMode; now: number; onDone: () => void; onRemove?: (id: string) => void;
  onFocusChange?: (focused: boolean) => void; onSaved?: (id: string) => void;
}) {
  const [name, setName] = useState(form.name ?? "");
  const [tz, setTz] = useState(form.tz);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); if (form.mode === "edit") first.current?.select(); }, [form.mode]);
  // Leaving one box for the other is not leaving the form.
  const inside = useRef(0);
  const focus = () => { window.clearTimeout(inside.current); onFocusChange?.(true); };
  const blur = () => { window.clearTimeout(inside.current); inside.current = window.setTimeout(() => onFocusChange?.(false), 0); };
  useEffect(() => () => { window.clearTimeout(inside.current); onFocusChange?.(false); }, [onFocusChange]);
  const save = async () => {
    if (busy) return;
    if (!name.trim()) { setErr("Type a name first."); first.current?.focus(); return; }
    setBusy(true); setErr("");
    try {
      if (form.mode === "add") { const id = await addTzPerson({ name, tz }); onSaved?.(id); }
      else { await editTzPerson(form.id, { name, tz }); onSaved?.(form.id); }
      sfx.click();
      onDone();
    } catch (e) {
      setErr(e instanceof Error && e.message ? e.message : "Could not save. Try again.");
      setBusy(false);
    }
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); void save(); }
    else if (e.key === "Escape") { e.preventDefault(); onDone(); }
  };
  return (
    <div className="tz-form" onKeyDown={keys} onKeyUp={(e) => { if (e.key !== "Tab") e.stopPropagation(); }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="tz-form-h">
        <span className="tm-panel-h">{form.mode === "add" ? "Add a person" : "Edit"}</span>
        <button type="button" className="tz-x" onClick={onDone} aria-label="Close" title="Close (Esc)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <label className="tz-field">
        <span className="tz-field-l">Name</span>
        <input ref={first} type="text" value={name} placeholder="A client, a friend, anyone" maxLength={80} autoComplete="off" spellCheck={false}
          aria-label="Name" onChange={(e) => { setName(e.target.value); setErr(""); }} onFocus={focus} onBlur={blur} />
      </label>
      <ZonePick value={tz} now={now} onPick={setTz} onFocus={focus} onBlur={blur} />
      {err && <p className="tz-err" role="alert">{err}</p>}
      <div className="tz-form-b">
        {form.mode === "edit" && onRemove && (
          <button type="button" className="tz-btn bad" onClick={() => { onRemove(form.id); onDone(); }}>Remove</button>
        )}
        <span className="tz-grow" />
        <button type="button" className="tz-btn" onClick={onDone}>Cancel</button>
        <button type="button" className="tz-btn go" disabled={busy} onClick={() => void save()}>{form.mode === "add" ? "Add" : "Save"}</button>
      </div>
    </div>
  );
}

// ---------- find someone ----------
export type Found = PersonEntry & { score?: number };
/** The search box at the top of the Time zones screen: type a name, pick one (click, or arrows and Enter). */
export function FindBox({ list, now, onPick, onClose, onAdd, picked, onFocusChange }: {
  list: PersonEntry[]; now: number; onPick: (p: Found) => void; onClose: () => void; onAdd: (name: string) => void;
  picked: string | null; onFocusChange?: (focused: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [hide, setHide] = useState(false);   // a pick folds the list away; typing again opens it
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const hits = useMemo(() => searchPeople(q, list, 7), [q, list]);
  useEffect(() => { setSel(0); }, [q]);
  const mine = offsetMin(now, homeTz());
  const choose = (p: Found) => {
    if (!p.tz) { onAdd(p.name); return; }
    setQ(p.name); setHide(true); onPick(p);
  };
  const showList = !hide && q.trim() !== "";
  return (
    <div className="tz-find" onMouseDown={(e) => e.stopPropagation()}>
      <label className="tz-find-in">
        <Mag size={16} />
        <input ref={input} type="text" value={q} placeholder="Find a client or person" autoComplete="off" spellCheck={false} maxLength={80}
          aria-label="Find a client or person by name" role="combobox" aria-expanded={showList} aria-controls="tz-find-list"
          onFocus={() => onFocusChange?.(true)} onBlur={() => onFocusChange?.(false)}
          onChange={(e) => { setQ(e.target.value); setHide(false); }}
          onKeyDown={(e) => {
            if (e.key !== "Tab") e.stopPropagation();
            if (e.key === "Escape") { e.preventDefault(); onClose(); }
            else if (e.key === "ArrowDown" && showList) { e.preventDefault(); setSel((i) => Math.min(hits.length - 1, i + 1)); }
            else if (e.key === "ArrowUp" && showList) { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
            else if (e.key === "Enter") {
              e.preventDefault();
              if (hide) { const p = hits.find((h) => h.key === picked) || hits[0]; if (p) choose(p); }
              else if (hits[sel]) choose(hits[sel]);
              else if (q.trim()) onAdd(q.trim());
            }
          }}
          onKeyUp={(e) => { if (e.key !== "Tab") e.stopPropagation(); }} />
        <kbd className="tz-kbd" aria-hidden="true">esc</kbd>
      </label>
      {showList && (
        <ul id="tz-find-list" className="tz-find-list" role="listbox">
          {hits.map((p, i) => (
            <li key={p.key} role="option" aria-selected={i === sel} className={`${i === sel ? "on" : ""}${p.tz ? "" : " none"}`} style={{ ["--i" as string]: i }}
              onMouseDown={(e) => { e.preventDefault(); choose(p); }} onMouseEnter={() => setSel(i)}>
              <span className={`tz-who ${p.kind}`} aria-hidden="true" />
              <span className="tz-find-n">{p.name}<small>{p.kind === "client" ? "Client" : "Person"}{p.tz ? ` · ${cityOf(p.tz)}` : ""}</small></span>
              {p.tz ? (
                <span className="tz-find-t"><b className="num">{fmtTime(now, p.tz)}</b><em>{gapWords(offsetMin(now, p.tz) - mine).replace(" of you", "").replace(" you", "")}</em></span>
              ) : <span className="tz-find-t"><em>No time zone · add one</em></span>}
            </li>
          ))}
          {!hits.length && (
            <li className="tz-find-empty">
              <span>Nobody called “{q.trim()}”.</span>
              <button type="button" className="tz-btn go sm" onMouseDown={(e) => { e.preventDefault(); onAdd(q.trim()); }}>Add “{q.trim().slice(0, 24)}”</button>
            </li>
          )}
        </ul>
      )}
      {!q.trim() && <p className="tz-find-hint">Clients and people you added. Pick one to see their time.</p>}
    </div>
  );
}

export { zoneTitle };

// Do Not Disturb settings and focus modes (V1.43, the developer 8 Nov 2026: "a little settings cog in a circle above the Do
// Not Disturb button on its top right. When you click it, a little settings menu with all the settings you can turn
// on and off, and add different focus modes, so you can create a new focus mode, like a Do Not Disturb profile.").
// Opened by the cog on the moon, or a long press on the moon (views/Dnd.tsx). Two pages in one card:
//  - the list: every focus mode (the one the moon turns on is ticked, the one on now says On), New focus mode, the
//    switches of the moon's mode, the Are you sure link (PS on a Mac), and what is never touched.
//  - one mode: name, icon, how long a press lasts, its switches, people who always get through (the developer's account:
//    only his account gets email cards), a schedule, Turns on with Sleep mode, Delete.
// Everything is one action on the newest settings (core/dnd.ts dndApply), so it syncs like the moon itself.
// The card lives on document.body like the moon's pop-up. Esc closes it (one Esc, the whole card).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Settings } from "../core/model";
import type { Snapshot } from "../core/vault";
import {
  activeMode, dndActive, dndKindsFor, FOCUS_ICONS, MAX_MODES, MAX_SENDERS, modesOf, modeUntil, moonMode, NAME_MAX, newModeId,
  type DndOp, type FocusLength, type FocusMode, type FocusSchedule,
} from "../core/dnd";
import { isRedAccount } from "../core/account";
import { FocusIcon, ICON_NAMES } from "./FocusIcon";
import { openSecurity } from "./Security";
import { haptic } from "../gos/bridge";
import { sfx } from "../ui/sfx";
import "./dnd.css";

const PHONE = import.meta.env.MODE === "gos";
const PS = import.meta.env.MODE === "ps";
const tap = () => { if (PHONE) haptic("press"); else sfx.click(); };

const LENGTHS: { v: FocusLength; label: string }[] = [
  { v: "hour", label: "1 hour" }, { v: "morning", label: "Until tomorrow" }, { v: "off", label: "Until I turn it off" },
];
const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The line under a mode's name: how long, what gets through, its schedule. */
export function modeLine(m: FocusMode): string {
  const parts: string[] = [];
  parts.push(m.length === "hour" ? "1 hour" : m.length === "morning" ? "Until tomorrow" : "Until you turn it off");
  const through = m.pass.length + (m.senders?.length ? 1 : 0);
  parts.push(through ? `${through} get${through === 1 ? "s" : ""} through` : "Everything muted");
  if (m.schedule?.on && m.schedule.days.length) parts.push(`${daysText(m.schedule.days)} ${m.schedule.from} to ${m.schedule.to}`);
  if (m.sleep) parts.push("With Sleep mode");
  return parts.join(" · ");
}
export function daysText(days: number[]): string {
  const k = [...days].sort().join("");
  if (k === "0123456") return "Every day";
  if (k === "12345") return "Weekdays";
  if (k === "06") return "Weekends";
  return [...days].sort().map((d) => DAY_NAMES[d].slice(0, 3)).join(" ");
}

type Props = {
  st: Partial<Settings>; s: Snapshot; act: (o: DndOp) => Promise<unknown>; homeTz?: string;
  anchor: React.RefObject<HTMLElement | null>; onClose: () => void;
};

export function DndSettings(p: Props) {
  const [edit, setEdit] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);   // a mode just made: its name box gets the focus
  const modes = modesOf(p.st.dnd);
  const editing = edit ? modes.find((m) => m.id === edit) || null : null;
  // Deleted (here or on another device): back to the list. A mode just made is not saved yet for a moment, so it only
  // counts once it was there.
  const seen = useRef<string | null>(null);
  if (editing) seen.current = editing.id;
  useEffect(() => { if (edit && !editing && seen.current === edit) setEdit(null); }, [edit, editing]);
  useEffect(() => {
    if (!edit || editing) return;
    const t = window.setTimeout(() => setEdit(null), 6000);   // never saved (offline, refused): back to the list
    return () => clearTimeout(t);
  }, [edit, editing]);
  const run = (o: DndOp) => { tap(); void p.act(o); };
  const body = edit && !editing
    ? <p className="dnd-note">Making your new mode...</p>
    : editing
    ? <ModePage key={editing.id} {...p} m={editing} count={modes.length} run={run} back={() => setEdit(null)} focusName={fresh === editing.id} />
    : <ListPage {...p} run={run} open={(id) => setEdit(id)} made={(id) => { setFresh(id); setEdit(id); }} />;
  return PHONE ? <Sheet onClose={p.onClose}>{body}</Sheet> : <Drop anchor={p.anchor} onClose={p.onClose}>{body}</Drop>;
}

// ---------- the list of modes ----------
function ListPage({ st, s, homeTz, run, open, made, onClose }: Props & { run: (o: DndOp) => void; open: (id: string) => void; made: (id: string) => void }) {
  const d = st.dnd;
  const modes = modesOf(d);
  const on = dndActive(d);
  const now = activeMode(d);
  const moon = moonMode(d);
  const kinds = dndKindsFor(isRedAccount(s), PHONE);
  const add = () => {
    if (modes.length >= MAX_MODES) return;
    const id = newModeId();
    let n = modes.length + 1, name = `Focus ${n}`;
    while (modes.some((m) => m.name.toLowerCase() === name.toLowerCase())) name = `Focus ${++n}`;
    run({ op: "addMode", id, name, icon: "leaf" });
    made(id);
  };
  return (
    <>
      <div className="dnd-top">
        <span className="dnd-orb" aria-hidden="true"><Cog size={22} /></span>
        <span className="dnd-t">Do Not Disturb settings<em>{on && now ? `${now.name} is on` : `Off. The moon turns on ${moon.name}`}</em></span>
        <CloseX onClose={onClose} />
      </div>
      <span className="dnd-h">Focus modes</span>
      <ul className="dnd-list dnd-modes" role="radiogroup" aria-label="The mode the moon turns on">
        {modes.map((m) => {
          const picked = m.id === moon.id, live = on && now?.id === m.id;
          return (
            <li key={m.id} className={`dnd-mode${picked ? " picked" : ""}${live ? " live" : ""}`}>
              <button type="button" role="radio" aria-checked={picked} className="dnd-row dnd-plain dnd-mode-pick" onClick={() => run({ op: "pick", mode: m.id })}
                data-tip={picked ? `${m.name} is the moon's mode` : `Use ${m.name}`} data-tip-line={picked ? "The moon turns this one on" : "The moon turns this one on from now"}>
                <span className="dnd-mode-ic"><FocusIcon icon={m.icon} size={18} /></span>
                <span className="dnd-l">{m.name}{live && <b className="dnd-on-pill">On</b>}<em>{modeLine(m)}</em></span>
                <i className="dnd-radio" aria-hidden="true" />
              </button>
              <button type="button" className="dnd-mode-edit" onClick={() => { tap(); open(m.id); }} aria-label={`Edit ${m.name}`}
                data-tip={`Edit ${m.name}`} data-tip-line="Name, icon, what gets through, schedule">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
              </button>
            </li>
          );
        })}
      </ul>
      {modes.length < MAX_MODES && (
        <button type="button" className="dnd-add" onClick={add} data-tip="New focus mode" data-tip-line="Make your own Do Not Disturb profile">
          <span aria-hidden="true">+</span> New focus mode
        </button>
      )}
      <div className="dnd-quick">
        {on
          ? <button type="button" className="dnd-off" onClick={() => run({ op: "off" })}>Turn off {now?.name || "Do Not Disturb"}</button>
          : <button type="button" className="dnd-off dnd-go" onClick={() => run({ op: "on", mode: moon.id, until: modeUntil(moon, Date.now(), homeTz) })}>Turn on {moon.name}</button>}
      </div>
      <span className="dnd-h">Muted in {on && now ? now.name : moon.name}</span>
      <Switches m={on && now ? now : moon} kinds={kinds} run={run} />
      {PS && !PHONE && (
        <button type="button" className="dnd-row dnd-link" onClick={() => { tap(); openSecurity(true); onClose(); }}
          data-tip="Are you sure" data-tip-line="Opens Security, where YouTube and Netflix ask first">
          <span className="dnd-l">Are you sure<em>A countdown before YouTube or Netflix. Set it in Security</em></span>
          <span className="dnd-chev" aria-hidden="true">›</span>
        </button>
      )}
      <p className="dnd-note">Muted cards wait and come up when it ends. VPN alarms, meeting notes and gym alarms always come through. PS app never changes your Mac's or phone's own Focus, and never looks at 1Password or Signal.</p>
    </>
  );
}

function Switches({ m, kinds, run }: { m: FocusMode; kinds: ReturnType<typeof dndKindsFor>; run: (o: DndOp) => void }) {
  const pass = new Set(m.pass);
  return (
    <ul className="dnd-list">
      {kinds.map((x) => {
        const muted = !pass.has(x.k);
        return (
          <li key={x.k}>
            <button type="button" role="switch" aria-checked={muted} className={`dnd-row${muted ? " muted" : ""}`}
              onClick={() => run({ op: "pass", kind: x.k, pass: muted, mode: m.id })}>
              <span className="dnd-l">{x.label}<em>{muted ? x.hint : "Coming through"}</em></span>
              <i className="dnd-tog" aria-hidden="true"><b /></i>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- one mode ----------
function ModePage({ s, m, count, run, back, onClose, focusName }: Props & { m: FocusMode; count: number; run: (o: DndOp) => void; back: () => void; focusName: boolean }) {
  const [name, setName] = useState(m.name);
  const [sender, setSender] = useState("");
  const [sure, setSure] = useState(false);
  const nameBox = useRef<HTMLInputElement>(null);
  const red = isRedAccount(s);
  const kinds = dndKindsFor(red, PHONE);
  useEffect(() => { setName(m.name); }, [m.name]);
  useEffect(() => { if (focusName) { nameBox.current?.focus(); nameBox.current?.select(); } }, [focusName]);
  const saveName = () => { const v = name.trim(); if (v && v !== m.name) run({ op: "editMode", mode: m.id, patch: { name: v } }); else setName(m.name); };
  const sch: FocusSchedule = m.schedule || { on: false, days: [1, 2, 3, 4, 5], from: "09:00", to: "12:00" };
  const setSch = (patch: Partial<FocusSchedule>) => run({ op: "editMode", mode: m.id, patch: { schedule: { ...sch, ...patch } } });
  const senders = m.senders || [];
  const addSender = () => {
    const v = sender.trim().toLowerCase();
    if (v.length < 2 || senders.includes(v) || senders.length >= MAX_SENDERS) return;
    run({ op: "senders", mode: m.id, list: [...senders, v] }); setSender("");
  };
  return (
    <>
      <div className="dnd-top">
        <button type="button" className="dnd-back" onClick={() => { tap(); back(); }} aria-label="Back to focus modes" data-tip="Back" data-tip-line="To all your focus modes">‹</button>
        <span className="dnd-orb" aria-hidden="true"><FocusIcon icon={m.icon} size={22} /></span>
        <span className="dnd-t">{m.name}<em>{modeLine(m)}</em></span>
        <CloseX onClose={onClose} />
      </div>
      <label className="dnd-field">
        <span className="dnd-fl">Name</span>
        <input ref={nameBox} value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} onBlur={saveName}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveName(); (e.target as HTMLInputElement).blur(); } }} />
      </label>
      <span className="dnd-h">Icon</span>
      <div className="dnd-icons" role="radiogroup" aria-label="Icon">
        {FOCUS_ICONS.map((ic) => (
          <button key={ic} type="button" role="radio" aria-checked={m.icon === ic} aria-label={ICON_NAMES[ic]} className={m.icon === ic ? "sel" : ""}
            onClick={() => run({ op: "editMode", mode: m.id, patch: { icon: ic } })} data-tip={ICON_NAMES[ic]} data-tip-line="Shows on the moon while this mode is on">
            <FocusIcon icon={ic} size={18} />
          </button>
        ))}
      </div>
      <span className="dnd-h">A press of the moon lasts</span>
      <div className="dnd-chips" role="radiogroup" aria-label="How long">
        {LENGTHS.map((l) => (
          <button key={l.v} type="button" role="radio" aria-checked={(m.length || "off") === l.v} className={(m.length || "off") === l.v ? "sel" : ""}
            onClick={() => run({ op: "editMode", mode: m.id, patch: { length: l.v } })}>{l.label}</button>
        ))}
      </div>
      <span className="dnd-h">Muted while it is on</span>
      <Switches m={m} kinds={kinds} run={run} />
      {red && (
        <>
          <span className="dnd-h">People who always get through</span>
          <div className="dnd-senders">
            {senders.map((x) => (
              <span key={x} className="dnd-chip">{x}
                <button type="button" aria-label={`Remove ${x}`} onClick={() => run({ op: "senders", mode: m.id, list: senders.filter((y) => y !== x) })}
                  data-tip={`Remove ${x}`} data-tip-line="Their emails wait like the rest again">×</button>
              </span>
            ))}
            {senders.length < MAX_SENDERS && (
              <span className="dnd-add-sender">
                <input value={sender} placeholder="Email, @company.com or a name" maxLength={80} onChange={(e) => setSender(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSender(); } }} aria-label="Add someone who always gets through" />
                <button type="button" onClick={addSender} disabled={sender.trim().length < 2} data-tip="Add" data-tip-line="Their client emails come through in this mode">Add</button>
              </span>
            )}
          </div>
          <p className="dnd-note dnd-tight">Their emails pop up even with Client emails muted.</p>
        </>
      )}
      <span className="dnd-h">Schedule</span>
      <ul className="dnd-list">
        <li>
          <button type="button" role="switch" aria-checked={sch.on} className={`dnd-row dnd-plain${sch.on ? " muted" : ""}`} onClick={() => setSch({ on: !sch.on })}>
            <span className="dnd-l">On a schedule<em>{sch.on ? `${daysText(sch.days) || "No days yet"}, ${sch.from} to ${sch.to}` : "Turns on and off by itself"}</em></span>
            <i className="dnd-tog" aria-hidden="true"><b /></i>
          </button>
        </li>
      </ul>
      {sch.on && (
        <div className="dnd-sched">
          <div className="dnd-days" role="group" aria-label="Days">
            {DAYS.map((x, i) => {
              const sel = sch.days.includes(i);
              return <button key={i} type="button" aria-pressed={sel} aria-label={DAY_NAMES[i]} className={sel ? "sel" : ""}
                onClick={() => setSch({ days: sel ? sch.days.filter((d) => d !== i) : [...sch.days, i].sort() })}>{x}</button>;
            })}
          </div>
          <div className="dnd-times">
            <label>From<input type="time" value={sch.from} onChange={(e) => { if (/^\d\d:\d\d$/.test(e.target.value)) setSch({ from: e.target.value }); }} /></label>
            <label>To<input type="time" value={sch.to} onChange={(e) => { if (/^\d\d:\d\d$/.test(e.target.value)) setSch({ to: e.target.value }); }} /></label>
          </div>
          <p className="dnd-note dnd-tight">On your home clock. Turn it off inside the window and it stays off until the next one.</p>
        </div>
      )}
      <ul className="dnd-list">
        <li>
          <button type="button" role="switch" aria-checked={!!m.sleep} className={`dnd-row dnd-plain${m.sleep ? " muted" : ""}`}
            onClick={() => run({ op: "editMode", mode: m.id, patch: { sleep: !m.sleep } })}>
            <span className="dnd-l">Turns on with Sleep mode<em>{m.sleep ? "Off again when you wake up" : "Only one mode can"}</em></span>
            <i className="dnd-tog" aria-hidden="true"><b /></i>
          </button>
        </li>
      </ul>
      {count > 1 && (sure
        ? <div className="dnd-del-ask"><span>Delete {m.name}?</span>
            <button type="button" className="dnd-del-yes" onClick={() => { run({ op: "delMode", mode: m.id }); back(); }}>Delete</button>
            <button type="button" onClick={() => setSure(false)}>Keep</button></div>
        : <button type="button" className="dnd-del" onClick={() => { tap(); setSure(true); }}>Delete this mode</button>)}
    </>
  );
}

// ---------- the frames ----------
function CloseX({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="dnd-x" onClick={() => { tap(); onClose(); }} aria-label="Close" data-tip="Close" data-tip-line="Or press Esc">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  );
}

export function Cog({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function useEsc(onClose: () => void) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
}

/** The Mac and the website: a card that drops from the cog, kept on screen. A click outside or Esc closes it. */
function Drop({ anchor, onClose, children }: { anchor: React.RefObject<HTMLElement | null>; onClose: () => void; children: React.ReactNode }) {
  const card = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    const r = anchor.current?.getBoundingClientRect();
    if (r) setAt({ top: Math.min(r.bottom + 10, window.innerHeight - 200), right: Math.max(8, window.innerWidth - r.right - 4) });
  }, [anchor]);
  useEsc(onClose);
  useEffect(() => {
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!card.current?.contains(t) && !anchor.current?.contains(t)) onClose(); };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [anchor, onClose]);
  if (!at) return null;
  return createPortal(
    <div ref={card} className="dnd-menu dnd-set" role="dialog" aria-label="Do Not Disturb settings" style={{ top: at.top, right: at.right, maxHeight: `calc(100vh - ${at.top + 12}px)` }}
      onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>, document.body);
}

/** The phone: a sheet from the bottom (the moon's own pop-up is one too). Back, the dim or Esc closes it. */
function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const [closing, setClosing] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const close = () => setClosing(true);
  useEsc(close);
  useEffect(() => {
    const back = (e: Event) => { e.preventDefault(); setClosing(true); };
    window.addEventListener("gos-back", back);
    return () => window.removeEventListener("gos-back", back);
  }, []);
  return createPortal(
    <div className={`gos-sheet-wrap dnd-sheet-wrap${closing ? "" : " open"}`} onAnimationEnd={(e) => { if (closing && e.target === sheet.current) onClose(); }}>
      <div className="gos-sheet-dim" onClick={close} aria-hidden="true" />
      <div ref={sheet} className="gos-sheet dnd-sheet dnd-set" role="dialog" aria-label="Do Not Disturb settings">
        <div className="gos-grab" aria-hidden="true"><i /></div>
        <div className="dnd-sheet-body">{children}</div>
      </div>
    </div>, document.body);
}

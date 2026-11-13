// The Overdue card's own look (V1.44, rules and colours in core/overduelook.ts). Three things live here:
// - the colours being tried right now: a pick, or the colour wheel while it is dragged, shows on the real Overdue
//   card and on the sample in Settings at once, and is saved once you stop (only when it really changed);
// - the effect layer drawn inside the card (Pulse, Shimmer, Lightning, Fire, Alarm; Glow is only a shadow);
// - the Settings group: card colour, text colour, effect, a live sample card, See it on screen and Reset to default.
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { Settings } from "../core/model";
import {
  OVERDUE_BGS, OVERDUE_DEFAULT, OVERDUE_FX, OVERDUE_TEXTS, isDefaultOverdue, overdueFxShown, overdueLookOf, overdueSaved,
  overdueSummary, overdueVars, sameOverdue, type OverdueFx, type OverdueLook,
} from "../core/overduelook";
import { settingsData } from "../core/select";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { ColorWheel } from "./ColorWheel";
import { taskMapActions } from "./TaskMap";
import type { Preview } from "./SettingsScreen";
import "./overduelook.css";

// ---------- the look being tried ----------
let tried: OverdueLook | undefined;   // undefined: nothing being tried, the saved look shows
let lastSaved: OverdueLook = OVERDUE_DEFAULT;
let waitTimer = 0;
const subs = new Set<() => void>();
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
function setTried(v: OverdueLook | undefined) { if (v === tried) return; tried = v; subs.forEach((f) => f()); }

function commit(next: OverdueLook) {
  if (sameOverdue(next, lastSaved)) { setTried(undefined); return; }   // nothing changed: nothing is saved or synced
  void taskMapActions.looks({ tmOverdue: overdueSaved(next) } as Partial<Settings>);
  // The save never came back (offline): after a while the card shows the saved look again.
  window.setTimeout(() => { if (tried === next && !waitTimer) setTried(undefined); }, 6000);
}
/** Show `next` on every Overdue card now; save it now, or `wait` ms after the last change (the colour wheel). */
export function tryOverdue(next: OverdueLook, wait = 0) {
  setTried(next);
  window.clearTimeout(waitTimer); waitTimer = 0;
  if (!wait) { commit(next); return; }
  waitTimer = window.setTimeout(() => { waitTimer = 0; commit(next); }, wait);
}
/** The look to paint with: the one being tried, else the saved one. */
export function useOverdueLook(saved: OverdueLook): OverdueLook {
  const t = useSyncExternalStore(sub, () => tried, () => tried);
  useEffect(() => {
    lastSaved = saved;
    if (t && !waitTimer && sameOverdue(t, saved)) setTried(undefined);   // the save came back
  }, [t, saved]);
  return t ?? saved;
}

function useReducedMotion(): boolean {
  const q = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const [on, setOn] = useState(!!q?.matches);
  useEffect(() => {
    if (!q) return;
    const f = () => setOn(q.matches);
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, [q]);
  return on;
}

/** What the card element gets for a look: its classes (after "tm-aware tm-overdue"), its colours and the effect. */
export function useOverdueCard(look: OverdueLook): { className: string; style: CSSProperties; fx: OverdueFx } {
  const fx = overdueFxShown(look.fx, useReducedMotion());
  return {
    className: `${look.bg ? " od-own" : ""}${look.text ? " od-text" : ""}${fx !== "none" ? ` od-fx od-fx-${fx}` : ""}`,
    style: overdueVars(look) as CSSProperties, fx,
  };
}

// Embers for Fire: where each one starts (%), how far it drifts (px), how long it takes and when it starts (s).
const EMBERS = [[8, 6, 2.6, 0], [19, -8, 3.1, 1.2], [31, 10, 2.4, 0.5], [44, -5, 3.4, 2.1], [56, 7, 2.8, 0.9], [67, -10, 3.0, 1.7], [79, 6, 2.5, 0.3], [90, -6, 3.3, 2.4], [50, 3, 2.9, 1.4]];

/** The moving part of an effect, drawn inside the card behind its words. Glow and None draw nothing here. */
export function OverdueFxLayer({ fx }: { fx: OverdueFx }) {
  if (fx === "none" || fx === "glow") return null;
  return (
    <span className="od-layer" aria-hidden="true">
      {fx === "lightning" && (
        // The Priority 1 "Red lightning" outline's bolts (TaskMap.tsx P1Art), across the card.
        <svg className="od-bolts" viewBox="0 0 100 40" preserveAspectRatio="none">
          <path d="M8 0 L14 12 L10 13 L18 28 L13 29 L20 40" /><path d="M52 0 L46 10 L51 11 L44 24 L49 25 L42 40" /><path d="M90 0 L85 14 L90 15 L83 40" />
        </svg>
      )}
      {fx === "fire" && EMBERS.map(([x, dx, d, dl], i) => (
        <i key={i} style={{ left: `${x}%`, ["--dx" as string]: `${dx}px`, animationDuration: `${d}s`, animationDelay: `${dl}s` }} />
      ))}
    </span>
  );
}

// ---------- Settings, Appearance, Overdue card ----------
function Swatches({ label, list, value, auto, onPick, onWheel, wheelOpen }: {
  label: string; list: { id: string; label: string }[]; value: string | null; auto: string;
  onPick: (c: string | null) => void; onWheel: () => void; wheelOpen: boolean;
}) {
  const own = !!value && !list.some((c) => c.id === value);
  return (
    <div className="od-sw" role="radiogroup" aria-label={label}>
      <button type="button" role="radio" aria-checked={!value} className={`od-dot od-auto${!value ? " sel" : ""}`} title={auto} aria-label={auto}
        onClick={() => { if (value) onPick(null); }}>{auto}</button>
      {list.map((c) => (
        <button key={c.id} type="button" role="radio" aria-checked={value === c.id} aria-label={c.label} title={c.label}
          className={`od-dot${value === c.id ? " sel" : ""}`} style={{ ["--sw" as string]: c.id }} onClick={() => { if (value !== c.id) onPick(c.id); }} />
      ))}
      <button type="button" aria-pressed={wheelOpen} className={`od-dot od-wheel${own ? " sel" : ""}${wheelOpen ? " open" : ""}`}
        title="Your own colour" aria-label={`${label}: your own colour`} style={own ? { ["--sw" as string]: value! } : undefined}
        onClick={() => { sfx.click(); onWheel(); }} />
    </div>
  );
}

/** A sample Overdue card that shows the look being tried, live (never clickable). */
function SampleCard({ look }: { look: OverdueLook }) {
  const card = useOverdueCard(look);
  return (
    <div className="od-sample" aria-hidden="true">
      <aside className={`tm-aware tm-overdue${card.className}`} style={card.style}>
        <OverdueFxLayer fx={card.fx} />
        <span className="tm-aware-h">Overdue</span>
        <ul>
          {["Send the invoice", "Call the bank back"].map((t) => (
            <li key={t}><span className="tm-aware-tick" /><span className="tm-aware-t">{t}</span><span /><span className="tm-aware-x">×</span></li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

export function OverdueLookSettings({ preview }: { preview: Preview }) {
  const saved = overdueLookOf(settingsData(useVault()));
  const look = useOverdueLook(saved);
  const [wheel, setWheel] = useState<"bg" | "text" | null>(null);
  const set = (patch: Partial<OverdueLook>, wait = 0) => { if (!wait) sfx.hover(); tryOverdue({ ...look, ...patch }, wait); };
  const fxNote = OVERDUE_FX.find((f) => f.id === look.fx)?.note ?? "";
  const isDefault = isDefaultOverdue(look);
  return (
    <div className="od-set">
      <SampleCard look={look} />
      <div className="od-controls">
        <div className="od-part">
          <h4 className="od-h">Card colour</h4>
          <Swatches label="Card colour" list={OVERDUE_BGS} value={look.bg} auto="The developer, as now" onPick={(c) => set({ bg: c })}
            wheelOpen={wheel === "bg"} onWheel={() => setWheel((w) => (w === "bg" ? null : "bg"))} />
          {wheel === "bg" && <ColorWheel label="Card colour" value={look.bg ?? "#5a0c14"} onChange={(hex) => set({ bg: hex }, 450)} />}
        </div>
        <div className="od-part">
          <h4 className="od-h">Text colour</h4>
          <Swatches label="Text colour" list={OVERDUE_TEXTS} value={look.text} auto="Automatic" onPick={(c) => set({ text: c })}
            wheelOpen={wheel === "text"} onWheel={() => setWheel((w) => (w === "text" ? null : "text"))} />
          {wheel === "text" && <ColorWheel label="Text colour" value={look.text ?? "#ffffff"} onChange={(hex) => set({ text: hex }, 450)} />}
        </div>
        <div className="od-part">
          <h4 className="od-h">Effect</h4>
          <div className="tm-ed-seg od-fxs" role="radiogroup" aria-label="Effect">
            {OVERDUE_FX.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={look.fx === f.id} title={f.note}
                className={`dwell${look.fx === f.id ? " on" : ""}`} onClick={() => { if (look.fx !== f.id) set({ fx: f.id }); }}>{f.label}</button>
            ))}
          </div>
          <p className="od-note">{fxNote} Moving effects stop while the list is hidden and stay still with Reduce motion.</p>
        </div>
        <div className="od-btns">
          <button type="button" className="btn quiet sm" onClick={() => preview("Your Overdue card", () => {}, () => {}, "overdue")}
            title="Shows the real Overdue card for 2 seconds (an example one if nothing is overdue)">See it on screen</button>
          <button type="button" className="btn quiet sm" disabled={isDefault} title={overdueSummary(look)}
            onClick={() => { setWheel(null); sfx.click(); tryOverdue({ ...OVERDUE_DEFAULT }); }}>Reset to default</button>
        </div>
      </div>
    </div>
  );
}

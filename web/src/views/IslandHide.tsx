// How long a click on the Dynamic Island's grey grab line hides it (V1.40, the developer: "Make it 1 minute by default, and
// add a setting in the Settings menu to choose how long it hides"). Ready made times plus a custom one (5 s to
// 1 hour). The choice is a vault setting (settings.island.hide, core/island.ts), so it syncs like the island's other
// settings; Island.swift reads it from the island state. Shown in the island menu and in Mac settings, every account.
import { useEffect, useState } from "react";
import { HIDE_CHOICES, HIDE_MAX, HIDE_MIN, hideLabel, hideTime } from "../core/island";
import "./islandhide.css";

export function IslandHideRow({ value, onPick, disabled }: { value: number; onPick: (sec: number) => void; disabled?: boolean }) {
  const v = hideTime(value);
  const custom = !HIDE_CHOICES.includes(v);
  const [editing, setEditing] = useState(false);
  const [unit, setUnit] = useState<60 | 1>(v % 60 === 0 ? 60 : 1);
  const [text, setText] = useState(String(v % 60 === 0 ? v / 60 : v));
  useEffect(() => {
    if (editing) return;
    setUnit(v % 60 === 0 ? 60 : 1);
    setText(String(v % 60 === 0 ? v / 60 : v));
  }, [v, editing]);
  const n = Number(text.replace(",", "."));
  const sec = Number.isFinite(n) && text.trim() !== "" ? Math.round(n * unit) : NaN;
  const okNow = Number.isFinite(sec) && sec >= HIDE_MIN && sec <= HIDE_MAX;
  const commit = () => {
    if (!okNow) return;
    if (sec !== v) onPick(hideTime(sec));
    setEditing(false);
  };
  return (
    <div className="ih-row" role="group" aria-label="How long a click on the island's top line hides it">
      <span className="ih-l">Click on the top line hides it for<em>Comes back sooner when a new email, lead reply or finished chat arrives</em></span>
      <div className="ih-chips">
        {HIDE_CHOICES.map((c) => (
          <button key={c} type="button" className={`ih-chip${c === v && !editing ? " sel" : ""}`} aria-pressed={c === v && !editing} disabled={disabled}
            onClick={() => { setEditing(false); if (c !== v) onPick(c); }}>{hideLabel(c)}</button>
        ))}
        <button type="button" className={`ih-chip${custom || editing ? " sel" : ""}`} aria-pressed={custom || editing} aria-expanded={editing} disabled={disabled}
          onClick={() => setEditing((e) => !e)}>{custom && !editing ? `Custom: ${hideLabel(v)}` : "Custom"}</button>
      </div>
      {editing && (
        <form className="ih-custom" onSubmit={(e) => { e.preventDefault(); commit(); }}>
          <input type="number" inputMode="decimal" className="ih-num" aria-label="Custom hide time" autoFocus
            min={unit === 60 ? 0.1 : HIDE_MIN} max={unit === 60 ? HIDE_MAX / 60 : HIDE_MAX} step="any" value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setEditing(false); } }} />
          <select className="ih-unit" aria-label="Unit" value={unit} onChange={(e) => setUnit(Number(e.target.value) === 1 ? 1 : 60)}>
            <option value={1}>seconds</option>
            <option value={60}>minutes</option>
          </select>
          <button type="submit" className="ih-chip ih-set" disabled={!okNow}>Set</button>
          {!okNow && text.trim() !== "" && <span className="ih-bad">5 seconds to 1 hour</span>}
        </form>
      )}
    </div>
  );
}

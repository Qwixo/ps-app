// Settings, Looks, Backgrounds per device (PS 1.65, feature "device-backgrounds"; rules and tests: core/devicebg.ts).
// Under the background tiles: "Devices", each device that opened PS signed in, by name, with a tick for the ones that show
// the background this device shows now. Ticking sets that device's own pick, unticking takes it off (it then shows the shared
// background it always did). A device can be renamed in place (Enter saves, Esc cancels). Shown only with the feature on and a
// second device (or a pick already). The switch is Settings, From the squad, "Background for each device".
import { useEffect, useRef, useState } from "react";
import type { Settings } from "../core/model";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { bgDevices } from "../core/select";
import { applyTick, cleanName, hasPicks, pickOf, rows, ticks, withoutPicks, NAME_MAX } from "../core/devicebg";
import { deviceBgOn, thisDevId, tickMode } from "../devicebgnow";
import { isBg, shownBg } from "./BgFit";
import { PS, psInOverlay, psPost } from "../ps";
import { renameDevice } from "../core/actions";
import { taskMapActions } from "./TaskMap";
import "./devicebg.css";

export const DEVICE_WORDS = {
  title: "Devices",
  note: "Tick the devices that show this background. The rest keep their own.",
  shared: "Shows this because it is your shared background. Tick it on another background to change it.",
  rename: "Rename",
  namePh: "Name",
  nameLabel: "Device name",
  reset: "Same background on every device",
} as const;

const save = (picks: Settings["tmBgDev"]) => void taskMapActions.looks({ tmBgDev: picks });
/** The Tab list window has no vault of its own: it asks the main page (src/ps.ts, patch.bgDevRename). */
function doRename(dev: string, name: string) {
  if (PS && psInOverlay()) psPost({ type: "looks", patch: { bgDevRename: { dev, name } } });
  else void renameDevice(dev, name).catch(() => {});
}

export function DeviceBg({ st }: { st: Settings }) {
  const v = useVault();
  const devs = v.status === "unlocked" ? bgDevices(v) : [];
  const me = thisDevId();
  const list = rows(devs, me);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const box = useRef<HTMLInputElement>(null);
  // Esc closes the name box first and nothing else (the newest layer wins, ui/escape.ts).
  useEffect(() => {
    if (!editing) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); setEditing(null); } };
    window.addEventListener("keydown", key, true);
    box.current?.focus();
    return () => window.removeEventListener("keydown", key, true);
  }, [editing]);
  if (!deviceBgOn() || !tickMode(devs.length, st.tmBgDev, isBg) || !list.length) return null;
  const bg = shownBg(st);
  const shown = typeof bg === "string" ? bg : "none";
  // This device shows `shown` by definition; it is ticked, and only follows the shared one when it has no pick of its own.
  const t = ticks(list, st.tmBgDev, shown, st.tmBg, isBg).map((x) => x.here ? { ...x, on: true, shared: pickOf(st.tmBgDev, me, isBg) === null } : x);
  const done = (dev: string) => { const n = cleanName(text); setEditing(null); sfx.click(); doRename(dev, n); };
  return (
    <section className="ms-sec ms-storm dbg" data-set="device-bg">
      <h3 className="ms-h">{DEVICE_WORDS.title}</h3>
      <p className="ms-note">{DEVICE_WORDS.note}</p>
      <ul className="dbg-list">
        {t.map((x) => (
          <li key={x.dev} className="dbg-row">
            <label className="dbg-lab" title={x.shared ? DEVICE_WORDS.shared : undefined}>
              <input type="checkbox" checked={x.on} disabled={x.shared}
                onChange={(e) => { sfx.click(); save(applyTick(st.tmBgDev, x.dev, shown, e.target.checked)); }} />
              {editing === x.dev ? null : <span className="dbg-name">{x.label}</span>}
            </label>
            {editing === x.dev ? (
              <input ref={box} className="dbg-edit" value={text} maxLength={NAME_MAX} placeholder={DEVICE_WORDS.namePh} aria-label={DEVICE_WORDS.nameLabel}
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") done(x.dev); }} onBlur={() => done(x.dev)} />
            ) : (
              <button type="button" className="btn quiet sm" onClick={() => { sfx.click(); setText(devs.find((d) => d.dev === x.dev)?.name ?? ""); setEditing(x.dev); }}>{DEVICE_WORDS.rename}</button>
            )}
          </li>
        ))}
      </ul>
      {hasPicks(st.tmBgDev, isBg) && (
        <div className="ms-fit-btns"><button type="button" className="btn quiet sm" onClick={() => { sfx.click(); save(withoutPicks(st.tmBgDev)); }}>{DEVICE_WORDS.reset}</button></div>
      )}
    </section>
  );
}

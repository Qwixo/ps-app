// Settings > Posture Reminder (PS 1.65, rules in core/posture.ts): on or off, how often, from and to times, Try it now.
// Saved for every device with the other settings (settings.posture). Click only, no typing (the two time boxes are the
// browser's own time pickers). The pop-up itself: the Mac's card (Sources/Posture.swift) or views/PosturePopup.tsx.
import { sfx } from "../ui/sfx";
import { useVault } from "../ui/kit";
import { settingsData } from "../core/select";
import { saveSettings } from "../core/actions";
import { EVERY_CHOICES, POSTURE_WORDS, posturePrefs, type PosturePrefs } from "../core/posture";
import { postureTest } from "../posturewatch";
import { Choice } from "./TaskMap";
import "./pomodoro.css";
import "./posture.css";

export function PostureSetting({ k }: { k: "on" | "every" | "hours" | "test" }) {
  const v = useVault();
  const p = posturePrefs(settingsData(v).posture);
  const ready = v.status === "unlocked";
  const set = (patch: Partial<PosturePrefs>) => void saveSettings({ posture: { ...p, ...patch } }).catch(() => {});
  const seg = (label: string, items: { id: string; text: string; on: boolean; pick: () => void }[]) => (
    <span className={`tm-ed-seg${ready ? "" : " gs-notyet"}`} role="radiogroup" aria-label={label}>
      {items.map((i) => <Choice key={i.id} selected={ready && i.on} onPick={() => { if (ready) { sfx.hover(); i.pick(); } }}>{i.text}</Choice>)}
    </span>
  );
  if (k === "every") {
    return seg(POSTURE_WORDS.every, EVERY_CHOICES.map((m) => ({ id: String(m), text: `${m} min`, on: p.every === m, pick: () => set({ every: m }) })));
  }
  if (k === "hours") {
    return (
      <span className="pf-set-row">
        <input type="time" value={p.from} aria-label="From" disabled={!ready} onChange={(e) => { if (e.target.value) set({ from: e.target.value }); }} />
        <span>to</span>
        <input type="time" value={p.to} aria-label="To" disabled={!ready} onChange={(e) => { if (e.target.value) set({ to: e.target.value }); }} />
      </span>
    );
  }
  if (k === "test") {
    return <button type="button" className="pm-btn pm-try" disabled={!ready || !p.on} onClick={() => { sfx.click(); postureTest(); }}>{POSTURE_WORDS.test}</button>;
  }
  return seg(POSTURE_WORDS.on, [
    { id: "on", text: "On", on: p.on, pick: () => set({ on: true }) },
    { id: "off", text: "Off", on: !p.on, pick: () => set({ on: false }) },
  ]);
}

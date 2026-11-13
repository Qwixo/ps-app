// Settings, G Squad, "From the squad" (V1.58, multiple developers; design: ps-handover-notes/v158-multidev-design.md
// section 3). Every shared feature made by someone else (not this build's own person, not core), each with its name, who
// made it, the version it came in and an On/Off switch. In a person's own build each one starts off until they switch it
// on (the developer's too); in the G Squad build each one starts on. The switch is saved with the other settings in the vault
// (squadFeatures), so it follows the person to every device, and src/featuresync.ts hands the answers to the Mac.
// Shown in every build (public too: every public feature has a visible switch). It sits inside Settings, so Esc closes it
// with Settings (views/SettingsScreen.tsx).
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { settingsData } from "../core/select";
import { cleanSwitches, featureOn, registry, squadList, SQUAD_WORDS, whoFor, type Who } from "../core/features";
import { profile } from "../core/profile";
import { accountOf } from "../featuresync";
import { Choice, taskMapActions } from "./TaskMap";
import "./fromthesquad.css";

export function FromTheSquad() {
  const v = useVault();
  const who: Who = whoFor(profile(), accountOf(v));
  const mine = cleanSwitches(settingsData(v).squadFeatures);
  const list = squadList(registry(), who);
  const ready = v.status === "unlocked";
  const set = (id: string, on: boolean) => {
    if (!ready) return;
    sfx.hover();
    void taskMapActions.looks({ squadFeatures: { ...mine, [id]: on } });
  };
  if (!list.length) return <p className="fts-note">{SQUAD_WORDS.empty}</p>;
  return (
    <div className="fts">
      <p className="fts-note">{who.othersShared === "on" ? SQUAD_WORDS.startsOn : SQUAD_WORDS.startsOff}</p>
      <ul className="fts-list">
        {list.map((f) => {
          const on = featureOn(f, who, mine);
          return (
            <li key={f.id} className="fts-row" data-feature={f.id}>
              <div className="fts-t">
                <b>{f.name}</b>
                <span>{SQUAD_WORDS.by(f)}</span>
              </div>
              <div className={`tm-ed-seg${ready ? "" : " gs-notyet"}`} role="radiogroup" aria-label={f.name}>
                <Choice selected={ready && on} onPick={() => set(f.id, true)}>On</Choice>
                <Choice selected={ready && !on} onPick={() => set(f.id, false)}>Off</Choice>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

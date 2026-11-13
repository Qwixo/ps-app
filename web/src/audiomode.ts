// Headphones mode, the shell half (core/audiomode.ts keeps the preferences, ps-mac Headphones.swift switches).
// The main page tells the Mac the synced preferences (settings.tmAudio) as {type:"hpmode", op:"prefs", prefs}
// whenever they change, also when another device changed them. The Mac keeps the last copy, so it works while
// the vault is locked. Nothing is sent while locked.
import { vaultStore } from "./core/vault";
import { settingsData } from "./core/select";
import { audioPrefs } from "./core/audiomode";

type Post = (m: object) => void;

export function startAudioMode(post: Post) {
  let last = "";
  const sync = () => {
    const s = vaultStore.get();
    if (s.status !== "unlocked" || s.role !== "owner") return;
    const prefs = audioPrefs(settingsData(s).tmAudio);
    const json = JSON.stringify(prefs);
    if (json === last) return;
    last = json;
    post({ type: "hpmode", op: "prefs", prefs });
  };
  let t = 0;
  vaultStore.subscribe(() => { clearTimeout(t); t = window.setTimeout(sync, 150); });
  sync();
}

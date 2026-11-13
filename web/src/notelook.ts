// Notification card colours, the shell half (core/notelook.ts decides). Tells the Mac's card stack (ps-mac
// Toast.swift) the tones of every kind the developer gave a colour, and the Other alerts sound, as {type:"noteLook", look}.
// Sent when it changes and every minute (a restarted shell catches up). While the vault is locked nothing is sent:
// the stack keeps the last look until the vault opens again. PS main window on the Mac only.
import { vaultStore } from "./core/vault";
import { settingsData } from "./core/select";
import { noteLookMsg } from "./core/notelook";

type Post = (m: object) => void;

export function startNoteLook(post: Post) {
  let last = "";
  const sync = (force = false) => {
    const s = vaultStore.get();
    if (s.status !== "unlocked" || s.role !== "owner") return;
    const look = noteLookMsg(settingsData(s));
    const json = JSON.stringify(look);
    if (!force && json === last) return;
    last = json;
    post({ type: "noteLook", look });
  };
  let t = 0;
  vaultStore.subscribe(() => { clearTimeout(t); t = window.setTimeout(() => sync(), 150); });
  window.setInterval(() => sync(true), 60_000);
  sync();
}

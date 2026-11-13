// "Check for updates every" (V1.54, core/updateevery.ts): the one synced setting, read from the vault's settings and
// handed to whoever looks for updates, at once and with no restart. The website's pill reads it here (onUpdateEvery);
// the Mac shell (Updater.swift, {type:"update:every"}) and the phone shell (Updater.kt, the same message) are told
// whenever it changes, and once when the vault opens. Nothing is sent while the vault is locked (the shells keep the
// last value they were given, so a locked PS still looks at the chosen pace).
import { vaultStore } from "./core/vault";
import { settingsData } from "./core/select";
import { cleanUpdateEvery, UPDATE_EVERY_DEFAULT } from "./core/updateevery";
import { PS, psPost } from "./ps";
import { GOS, gosPost } from "./gos/bridge";

let cur = UPDATE_EVERY_DEFAULT, sent = false, started = false;
const subs = new Set<(min: number) => void>();

/** The minutes chosen (5 until the vault has said otherwise). */
export const updateEvery = () => cur;
/** Called when the choice changes; returns the way to stop. */
export function onUpdateEvery(f: (min: number) => void) { subs.add(f); return () => { subs.delete(f); }; }

function apply() {
  const s = vaultStore.get();
  if (s.status !== "unlocked") return;
  const min = cleanUpdateEvery(settingsData(s).updateEvery);
  if (sent && min === cur) return;
  const changed = min !== cur;
  cur = min; sent = true;
  if (PS) psPost({ type: "update:every", min });
  if (GOS) gosPost({ type: "update:every", min });
  if (changed) subs.forEach((f) => f(min));
}

/** main.tsx, once. */
export function startUpdateEvery() {
  if (started) return;
  started = true;
  vaultStore.subscribe(apply);
  apply();
}

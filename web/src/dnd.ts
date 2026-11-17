// Do Not Disturb, the shell half (core/dnd.ts decides). Tells the native side what is muted right now as
// {type:"dnd", state:{on, until, mute}}: the Mac (ps-mac DND.swift: its own cards, sounds and the 2 am
// follow up check) and the phone (ps-gos Notifier.kt: its own call alarms). Sent when it changes, when
// DND ends by its own clock, and every minute so a restarted shell catches up. While the vault is locked
// nothing is sent: each shell keeps the last word (and its own end time) until the vault opens again.
// V1.43: the same clock turns a focus mode on by its schedule, or with Sleep mode, and Sleep mode's one off on
// waking (core/dnd.ts dndAuto). Both shells may do it; the action is the same and remembers its window, so a
// turn off by hand inside a window stays off.
import { vaultStore } from "./core/vault";
import { settingsData } from "./core/select";
import { dndAuto, dndEndsAt, dndNative } from "./core/dnd";
import { setDnd } from "./core/actions";
import { fitnessNow } from "./fitness/store";
import { homeTz } from "./core/tz";
import { lpInterval } from "./core/lowpower.ts";

type Post = (m: object) => void;

export function startDnd(post: Post, device: "mac" | "phone") {
  let last = "", endTimer = 0;
  const sync = (force = false) => {
    const s = vaultStore.get();
    if (s.status !== "unlocked" || s.role !== "owner") return;
    const d = settingsData(s).dnd;
    const now = Date.now();
    const state = dndNative(d, now, device);
    clearTimeout(endTimer);
    const end = dndEndsAt(d, now);
    if (end) endTimer = window.setTimeout(() => sync(), Math.min(Math.max(end - now + 250, 250), 2 ** 31 - 1));
    autoCheck(d, now, s.lastSync);
    const json = JSON.stringify(state);
    if (!force && json === last) return;
    last = json;
    post({ type: "dnd", state });
  };
  let autoBusy = false;
  const autoCheck = (d: Parameters<typeof dndAuto>[0], now: number, synced: unknown) => {
    if (autoBusy || !synced) return;   // never on a copy from before the first download
    let sleep = null;
    try { const o = fitnessNow().prefs.sleepOpen; sleep = o ? { at: o.at, woke: o.woke ?? null, breaks: (o as { breaks?: unknown[] }).breaks ?? null } : null; } catch { /* no Fitness yet */ }
    const op = dndAuto(d, { now, tz: homeTz(), sleep });
    if (!op) return;
    autoBusy = true;
    void setDnd(op).catch(() => {}).finally(() => { autoBusy = false; });
  };
  let t = 0;
  vaultStore.subscribe(() => { clearTimeout(t); t = window.setTimeout(() => sync(), 150); });
  lpInterval("checks", () => sync(true), 60_000);   // PS 1.65: asleep in Low power mode, one catch up on wake (core/lowpower.ts)
  sync();
}

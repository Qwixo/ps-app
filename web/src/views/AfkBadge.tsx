// Tab list, top right: "AFK 14:32" while an AFK timer runs (full card, passive stopwatch or
// invisible), "Watcher 42:10 left" while Watcher mode is on, so the developer never has one going without
// knowing. A click brings the full card back. The PS app sends the state (Sources/Afk.swift).
import { useEffect, useState, useSyncExternalStore } from "react";
import { psPost } from "../ps";
import "./afkbadge.css";

// `on`: this Mac's AFK timer switch (per Mac, kept by PS; the developer 31 Oct 2026: "I can turn the AFK timer on and off").
// PS defaults it to off on the Mac set as the Second Computer's secondary and on elsewhere; the developer's choice then stands.
type AfkStatus = { afk: { start: number; back?: number } | null; watcherUntil: number | null; on?: boolean };
let status: AfkStatus = { afk: null, watcherUntil: null };
const listeners = new Set<() => void>();
let started = false;
function start() {
  if (started) return;
  started = true;
  (window as Window & { __psAfk?: unknown }).__psAfk = (m: unknown) => {
    const o = (m || {}) as { afk?: { start?: unknown; back?: unknown } | null; watcherUntil?: unknown; on?: unknown };
    const a = o.afk && Number.isFinite(o.afk.start) ? { start: o.afk.start as number, ...(Number.isFinite(o.afk.back) ? { back: o.afk.back as number } : {}) } : null;
    status = { afk: a, watcherUntil: Number.isFinite(o.watcherUntil) ? (o.watcherUntil as number) : null, ...(typeof o.on === "boolean" ? { on: o.on } : {}) };
    listeners.forEach((l) => l());
  };
  psPost({ type: "afk:get" });
}
function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`;
}

export function AfkBadge() {
  start();
  const st = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => status);
  const [now, setNow] = useState(Date.now());
  const on = st.on !== false && (!!st.afk || !!st.watcherUntil);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  if (!on) return null;
  const text = st.afk ? `AFK ${fmt(now - st.afk.start)}` : `Watcher ${fmt((st.watcherUntil as number) - now)} left`;
  return (
    <button type="button" className={`afk-badge ${st.afk ? "afk" : "watch"}`} title="Show the AFK card" onClick={() => psPost({ type: "afkShow" })}>
      <i aria-hidden="true" />{text}
    </button>
  );
}

/** The Tab list's settings switch: this Mac's AFK timer on or off (PS stops all AFK tracking when off). */
export function useAfkOn(): boolean | undefined {
  start();
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => status.on);
}
export function setAfkOn(on: boolean) {
  status = { ...status, on, ...(on ? {} : { afk: null }) };
  listeners.forEach((l) => l());
  psPost({ type: "afk", on });
}

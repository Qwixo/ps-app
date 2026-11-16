// Outsource work to your other computer at work (PS 1.65, rules in core/second.ts, engine in core/outsource.ts). Runs in the page that holds the vault.
// It builds the one engine with the real vault, the Mac's bridge (core/secondbridge.ts) and this device's saved data, and keeps it
// fed. Nothing here polls while PS is closed: the only timer runs while the page is open, makes no network call by itself and
// lets the other computer write a small "still here" every 10 minutes. A vault change is looked at once, after a short pause.
import { useSyncExternalStore } from "react";
import { docs as vaultDocs, put, remove, vaultStore, onSecondPoke, pokeSecond, setSecondChannel } from "./core/vault";
import { createEngine, FEATURE_ID, type Engine, type View } from "./core/outsource";
import { feature } from "./core/features";
import { settingsData } from "./core/select";
import { saveSettings } from "./core/actions";
import type { MacToPage } from "./core/secondbridge";
import type { Kind } from "./core/model";

const MAC = import.meta.env.MODE === "ps";
// The phone app (PS GOS) or the iPhone web app: it may only pair to restart the other computer (same test as gos/bridge.ts).
const PHONE = import.meta.env.MODE === "gos" || (globalThis as { __psMobile?: unknown }).__psMobile === true;
const KINDS: Kind[] = ["spair", "sojob", "sores", "sjobst", "sfile", "scmd", "sstat", "sdev"];
let engine: Engine | null = null;
let post: (m: object) => void = () => {};
let lastSig = "", timer = 0, beat = 0, joined = false;

const local = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* private window */ } },
};

export const outsourceFeature = () => feature(FEATURE_ID);
/** The person's own switch (Settings, Outsource work to your other computer). Missing means on. */
export const outsourceOn = () => settingsData(vaultStore.get()).outsource?.on !== false && outsourceFeature();

function sig(): string {
  let n = 0, last = "";
  for (const d of vaultStore.get().docs.values()) if ((KINDS as string[]).includes(d.kind)) { n++; if ((d.updatedAt ?? "") > last) last = d.updatedAt ?? ""; if (d.pending) last += "p"; }
  return `${n}|${last}`;
}
function react() {
  if (!engine) return;
  const s = vaultStore.get();
  if (s.status !== "unlocked") return;
  const on = outsourceOn(), v = engine.view();
  const want = on && (v.paired || !!v.code);
  if (want !== joined) { joined = want; setSecondChannel(want, v.role === "other"); }
  if (!on) return;
  const g = sig();
  if (g === lastSig) return;
  lastSig = g;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void engine?.onVault(), 400);
}

/** One engine per page. Safe to call many times. */
export function startOutsource(p?: (m: object) => void) {
  if (p) post = p;
  if (engine) return engine;
  engine = createEngine({
    store: {
      docs: (kind) => vaultDocs(kind as Kind) as never,
      put: (kind, data, id) => put(kind as Kind, data, { id }),
      remove: (id) => remove(id),
      poke: (k) => { void pokeSecond(k).catch(() => {}); },
    },
    post: (m) => post(m), local, now: () => Date.now(), native: MAC, phone: PHONE,
  });
  vaultStore.subscribe(react);
  engine.subscribe(react);
  onSecondPoke(() => { /* a poke already pulls; the vault subscription above reacts to what changed */ });
  engine.hello();
  // Once a minute while this page is open: no network by itself, only a check whether the other computer's "still here" is due.
  if (MAC) beat = window.setInterval(() => { if (outsourceOn() && vaultStore.get().status === "unlocked") void engine?.tick(); }, 60_000);
  react();
  return engine;
}
void beat;

/** ps.ts: every message from the Mac that is ours. */
export function outsourceMessage(m: { type?: unknown }): boolean {
  if (m.type !== "outsource") return false;
  const e = startOutsource();
  if (outsourceOn()) void e.onMac(m as unknown as MacToPage);
  return true;
}

export async function setOutsourceOn(on: boolean) { await saveSettings({ outsource: { on } }); }
export function useOutsource(): { view: View; engine: Engine; on: boolean } {
  const e = startOutsource();
  const view = useSyncExternalStore((f) => e.subscribe(f), () => snapshot(e));
  const on = useSyncExternalStore((f) => vaultStore.subscribe(f), () => outsourceOn());
  return { view, engine: e, on };
}
let snapKey = "", snapView: View | null = null;
function snapshot(e: Engine): View {
  const v = e.view();
  const k = JSON.stringify(v);
  if (k !== snapKey || !snapView) { snapKey = k; snapView = v; }
  return snapView;
}

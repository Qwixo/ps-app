// Low power mode, the app half (PS 1.65, feature "low-power"; the logic and the API for feeds: core/lowpower.ts).
// - The person's choice is kept per device (localStorage "ps.lowpower"): a Mac on battery and a phone on the charger
//   decide for themselves. Nothing about it goes to the server.
// - On the Mac the main page decides (it holds the keys and runs every feed). It tells the Mac shell
//   ({type:"lowpower"}, LowPower.swift), which hands it to the Tab list in the state (`lp`), so the Tab list's button and
//   Settings there show the same. A click in the Tab list comes back as {type:"looks", patch:{lowPower:{...}}}.
// - macOS Low Power Mode comes from the shell ({type:"lowpowerOs", on}), Android Battery Saver from the phone shell
//   (window.__psLowPowerOs(on), phone MainActivity.kt).
// - Big animations become simple: <html class="lp-simple"> (views/lowpower.css) and matchMedia says reduced motion,
//   so every place that already respects reduced motion goes calm too. The island (Mac, native) keeps its own.
import { useSyncExternalStore } from "react";
import { asleepNames, cleanPrefs, lowPower, type LpPrefs, type LpState } from "./core/lowpower.ts";
import { feature } from "./core/features";
import { vaultStore } from "./core/vault";
// No import of ./ps here (it imports this file): ps.ts hands its post over with bindLowPowerShell.
const PS = import.meta.env.MODE === "ps";
let psPost: (m: object) => void = () => {};
let psInOverlay: () => boolean = () => false;
/** ps.ts, once: how to talk to the Mac shell, and whether this page is the Tab list. */
export function bindLowPowerShell(post: (m: object) => void, inOverlay: () => boolean) { psPost = post; psInOverlay = inOverlay; }

const KEY = "ps.lowpower";
let started: "main" | "mirror" | null = null;

function load(): Partial<LpPrefs> {
  try { const raw = localStorage.getItem(KEY); return raw ? cleanPrefs(JSON.parse(raw)) : {}; } catch { return {}; }
}
function keep(p: LpPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private window: it lasts until the page closes */ }
}

/** Reduced motion while on: every matchMedia("(prefers-reduced-motion: reduce)") says yes. Installed once. */
let mmDone = false;
function calmMotion() {
  if (mmDone || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  mmDone = true;
  const real = window.matchMedia.bind(window);
  window.matchMedia = (q: string) => {
    const m = real(q);
    if (!lowPower.simple() || !/prefers-reduced-motion:\s*reduce/.test(q)) return m;
    return new Proxy(m, { get(t, k) { if (k === "matches") return true; const v = Reflect.get(t, k, t); return typeof v === "function" ? v.bind(t) : v; } });
  };
}
function paint() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("lp-simple", lowPower.simple());
}

/** What the Mac shell and the Tab list get: ids, plain names, why. Small, no keys, nothing private. */
export function lpForShell(st: LpState = lowPower.state()) {
  return { on: st.on, why: st.why, asleep: st.asleep, names: asleepNames(st, lowPower.feeds(), PS), alarms: st.prefs.alarms, prefs: st.prefs };
}

/** The main page, the website and the phone: this page decides. */
export function startLowPower() {
  if (started) return;
  started = "main";
  calmMotion();
  lowPower.setPrefs(load());
  const featureNow = () => lowPower.setFeature(feature("low-power"));
  featureNow();
  vaultStore.subscribe(featureNow);   // the switch in From the squad, or an account just unlocked
  let last = "";
  const tellShell = () => {
    paint();
    keep(lowPower.state().prefs);
    if (!PS) return;
    const json = JSON.stringify(lpForShell());
    if (json !== last) { last = json; psPost({ type: "lowpower", ...lpForShell() }); }
  };
  lowPower.subscribe(tellShell);
  tellShell();
  // Android Battery Saver (the phone shell calls this, with the mode now and on every change).
  const w = window as Window & { __psLowPowerOs?: (on: unknown) => void; __psLowPowerOsNow?: boolean };
  w.__psLowPowerOs = (on) => lowPower.setOs("phone", on === true);
  if (w.__psLowPowerOsNow === true) lowPower.setOs("phone", true);   // it came before this page part started
  if (PS) psPost({ type: "lowpower:get" });   // macOS Low Power Mode right now
}

/** The Tab list on the Mac: the main page decides, this page shows its answer. */
export function startLowPowerMirror() {
  if (started) return;
  started = "mirror";
  calmMotion();
  lowPower.subscribe(paint);
}
/** The main page's answer, from the overlay's state (ps.ts __psOverlay.load). */
export function setLowPowerMirror(v: unknown) {
  if (started !== "mirror" || !v || typeof v !== "object") return;
  const o = v as { on?: unknown; why?: unknown; prefs?: unknown };
  const p = cleanPrefs(o.prefs);
  lowPower.setPrefs(p);
  lowPower.setOs("mac", o.on === true && o.why === "mac");
  lowPower.setOs("phone", o.on === true && o.why === "phone");
}

/** Shell messages for the main page: macOS Low Power Mode. True when handled. */
export function lowPowerShellMessage(m: { type?: string; on?: unknown }): boolean {
  if (m.type !== "lowpowerOs") return false;
  lowPower.setOs("mac", m.on === true);
  return true;
}
/** A change from the Tab list (the looks patch). */
export function lowPowerPatch(v: unknown) {
  if (!v || typeof v !== "object") return;
  const o = v as Record<string, unknown>;
  if (o.wake === true) { lowPower.wakeAll(); return; }
  const p: Partial<LpPrefs> = {};
  for (const k of ["hand", "autoMac", "autoPhone", "alarms"] as const) if (typeof o[k] === "boolean") p[k] = o[k] as boolean;
  lowPower.setPrefs(p);
}

/** Settings, the Tab list's button, Wake everything: on the Mac's Tab list it asks the main page. */
export function setLowPower(p: Partial<LpPrefs> | "wake") {
  if (PS && psInOverlay()) { psPost({ type: "looks", patch: { lowPower: p === "wake" ? { wake: true } : p } }); }
  // The Tab list shows the answer at once; the main page's copy comes back in the next state and agrees.
  if (p === "wake") lowPower.wakeAll(); else lowPower.setPrefs(p);
}

const sub = (l: () => void) => lowPower.subscribe(l);
/** React: the state now (re renders on every change). */
export function useLowPower(): LpState { return useSyncExternalStore(sub, () => lowPower.state(), () => lowPower.state()); }
/** React: is this one feed asleep (re renders only when that answer changes). */
export function useLpAsleep(id: string): boolean { return useSyncExternalStore(sub, () => lowPower.asleep(id), () => false); }

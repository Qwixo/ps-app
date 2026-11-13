// The appearance engine, page side (V1.31): puts a look's tokens (core/looks.ts buildTokens) on <html>, with a smooth
// switch. Runs on every PS page (the Tab list, the Second Computer window, the Fitness test view) and on the phone, so
// the whole app changes at once. The website's own pages (cincee.com/client in a browser) never get a look.
// Also: the preview (More settings shows a look for 2 seconds), and whether a look other than the default is on (for
// parts that have looks of their own, like Fitness, which then follow the app's look).
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { NOTEBOOK_IDS, DEFAULT_LOOK, lookOffered, buildTokens, resolveAppearance, type Appearance, type AppearanceSettings } from "../core/looks";
import "../core/looks-productivity";
import "./looks.css";
import "./working.css";

// ---------- preview ----------
let preview: Partial<Appearance> | null = null;
const subs = new Set<() => void>();
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export function setLookPreview(p: Partial<Appearance> | null) { preview = p; subs.forEach((f) => f()); }
export function useLookPreview() { return useSyncExternalStore(sub, () => preview, () => preview); }
// The dev server only: ?look=legal&accent=%2314B8A6&density=dense&text=112&font=mono shows a look (for pictures).
if (import.meta.env.DEV && typeof location !== "undefined") {
  const q = new URLSearchParams(location.search), p: Partial<Appearance> = {};
  if (q.get("look")) p.look = q.get("look")!;
  if (q.get("accent")) p.accent = q.get("accent")!;
  if (q.get("density")) p.density = q.get("density") as Appearance["density"];
  if (q.get("text")) p.text = Number(q.get("text"));
  if (q.get("font")) p.font = q.get("font");
  if (Object.keys(p).length) preview = p;
}

/** The look to show now: a preview if one is running, else what is saved (with the V1.30 settings as the fallback). */
export function useAppearance(st: AppearanceSettings): Appearance {
  const p = useLookPreview();
  const saved = resolveAppearance(st);
  if (!p) return saved;
  const look = p.look && lookOffered(p.look) ? p.look : saved.look;   // a preview of a look switched off (Notebook, core/features.ts) shows nothing
  const accent = p.accent !== undefined ? p.accent : p.look && p.look !== saved.look ? resolveAppearance({ ...st, look }).accent : saved.accent;
  return { ...saved, ...p, look, accent };
}

// The Working on look being tried (Appearance, Preview): the list shows it for 2 seconds.
let workPrev: string | null = null;
export function setWorkPreview(v: string | null) { workPrev = v; subs.forEach((f) => f()); }
export function useWorkPreview() { return useSyncExternalStore(sub, () => workPrev, () => workPrev); }

// ---------- on the page ----------
let applied: Record<string, string> = {};
let current = "";
let active = false;
const activeSubs = new Set<() => void>();
/** True while a look other than the default dark glass is on this page. */
export function useLookActive() {
  return useSyncExternalStore((f) => { activeSubs.add(f); return () => { activeSubs.delete(f); }; }, () => active, () => active);
}
type VtDoc = Document & { startViewTransition?: (f: () => void) => { finished: Promise<void> } };
let fadeEnd = 0;

function put(a: Appearance | null) {
  const root = document.documentElement;
  const t = a ? buildTokens(a) : {};
  for (const k of Object.keys(applied)) if (!(k in t)) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(t)) root.style.setProperty(k, v);
  applied = t;
  const look = a?.look ?? DEFAULT_LOOK;
  if (a && look !== DEFAULT_LOOK) root.dataset.look = look; else delete root.dataset.look;
  if (a && NOTEBOOK_IDS.has(look)) root.dataset.nb = look; else delete root.dataset.nb;
  root.classList.remove("tm-light-on");   // the V1.30 inverted Light theme is gone: every look is tokens
  if (t["--k-cover"]) root.dataset.solid = ""; else delete root.dataset.solid;
  root.dataset.density = a?.density ?? "comfortable";
  if (a && root.dataset.density === "comfortable") delete root.dataset.density;
  const now = a !== null && look !== DEFAULT_LOOK;
  if (now !== active) { active = now; activeSubs.forEach((f) => f()); }
}

/** Puts the look on the page. A change after the first is animated: a page turn into or out of a notebook, a soft
 *  cross fade between other looks (a view transition where the web view has one), a colour fade where it has not. */
export function applyAppearance(a: Appearance | null, animate: boolean) {
  if (typeof document === "undefined") return;
  const key = a ? JSON.stringify(a) : "";
  if (key === current) return;
  const before = current ? (JSON.parse(current) as Appearance).look : DEFAULT_LOOK;
  current = key;
  const root = document.documentElement;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!animate || reduce) { put(a); return; }
  // V1.58: a list page landing with its own background is already cross fading the whole screen (views/ListPager.tsx):
  // the look joins that fade instead of starting a second one, which would cut the first short.
  if (root.classList.contains("pg-turning")) { put(a); return; }
  const after = a?.look ?? DEFAULT_LOOK;
  const turn = NOTEBOOK_IDS.has(after) !== NOTEBOOK_IDS.has(before) || (NOTEBOOK_IDS.has(after) && after !== before);
  const doc = document as VtDoc;
  window.clearTimeout(fadeEnd);
  const cls = turn ? "nb-turning" : "lk-turning";
  if (doc.startViewTransition && before !== after) {
    root.classList.add(cls);
    try { doc.startViewTransition(() => put(a)).finished.finally(() => root.classList.remove(cls)); }
    catch { root.classList.remove(cls); put(a); }
    return;
  }
  root.classList.add("lk-fading");
  put(a);
  fadeEnd = window.setTimeout(() => root.classList.remove("lk-fading"), 520);
}

/** The engine for a page: call once with the vault settings. enabled false (the website) takes any look off. */
export function useAppearanceEngine(st: AppearanceSettings, enabled: boolean) {
  const a = useAppearance(st);
  const was = useRef(false);   // a look was on before: only a switch between looks animates, never the first paint
  const key = enabled ? JSON.stringify(a) : "";
  useLayoutEffect(() => {
    applyAppearance(enabled ? a : null, was.current && enabled);
    was.current = enabled;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return a;
}

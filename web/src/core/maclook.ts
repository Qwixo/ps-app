// What a saved look holds on a Mac (V1.56, core/looksprofiles.ts kind "mac"): the whole setup of the Tab list's Edit
// overview. Pages (their order, the pages of panels with their names, each page's own background and look), every panel
// and button with its place, size, copies and page (the "tablayout" record), and the appearance of the main page (the
// look, accent, background, rain, outline). Never tasks: a list page that holds tasks is never made or deleted by a look,
// only its order and its own background and look follow the look.
import type { Settings } from "./model";
import { MAIN_PAGE, cleanLayout, resetLayout, type TabLayout } from "./tablayout.ts";
import { cleanPages, type ListPage } from "./lists.ts";

/** The settings that make up the main page's appearance (the same keys Settings, Appearance changes). */
export const LOOK_KEYS = [
  "look", "lookAccent", "lookDensity", "lookText", "lookFont", "tmTheme", "tmNotebook",
  "tmBg", "tmBgIntensity", "tmBgFrequency", "tmBgVideoBright", "tmRain", "tmRainAmount",
  "tmP1Style", "p1Color", "tmWorkStyle", "tmTrail",
] as const satisfies readonly (keyof Settings)[];
type LookKey = (typeof LOOK_KEYS)[number];

export interface MacLook {
  v: 1;
  layout: TabLayout;
  /** Pages of panels in full; list pages only as { id, name, secs: [], bg, look } (their own background and look). */
  pages: ListPage[];
  order: string[];
  look: Partial<Pick<Settings, LookKey>>;
}

/** The Mac's setup right now, as a look. */
export function macSnapshot(st: Partial<Settings>, layout: TabLayout): MacLook {
  const look: Partial<Settings> = {};
  for (const k of LOOK_KEYS) if (st[k] !== undefined && st[k] !== null) (look as Record<string, unknown>)[k] = st[k];
  const pages = (st.tmPages ?? []).map((p) => (p.kind === "panels" ? { ...p } : { id: p.id, name: p.name, secs: [], ...(p.bg ? { bg: p.bg } : {}), ...(p.look ? { look: p.look } : {}) }));
  return { v: 1, layout: cleanLayout(layout), pages, order: [...(st.tmPageOrder ?? [MAIN_PAGE, ...(st.tmPages ?? []).map((p) => p.id)])], look };
}

/** Putting a look on: the settings to save and the layout to save. Lists that exist now stay (with their tasks);
 *  they take the look's background, look and place where the look knows them. Pages of panels become the look's. */
export function applyMacLook(st: Partial<Settings>, l: MacLook, now: string): { patch: Partial<Settings>; layout: TabLayout } {
  const want = new Map(l.pages.map((p) => [p.id, p]));
  const lists = (st.tmPages ?? []).filter((p) => p.kind !== "panels").map((p) => {
    const w = want.get(p.id);
    if (!w) return p;
    const q: ListPage = { ...p };
    delete q.bg; delete q.look;
    if (w.bg) q.bg = w.bg;
    if (w.look) q.look = w.look;
    return q;
  });
  const panels = l.pages.filter((p) => p.kind === "panels").filter((p) => !lists.some((x) => x.id === p.id));
  const tmPages = [...lists, ...panels];
  const ids = new Set([MAIN_PAGE, ...tmPages.map((p) => p.id)]);
  const order = l.order.filter((id) => ids.has(id));
  for (const id of [MAIN_PAGE, ...tmPages.map((p) => p.id)]) if (!order.includes(id)) order.push(id);   // a list made since: at the end
  const patch: Partial<Settings> = { ...l.look, tmPages, tmPageOrder: [...new Set(order)] };
  return { patch, layout: { ...cleanLayout(l.layout), at: now } };
}

/** PS's default layout: every panel at its usual place and size on the main page, no copies, no pages of panels, lists
 *  without a background or look of their own. The main page's look stays (Settings, Appearance has its own resets). */
export function macDefault(st: Partial<Settings>, now: string): { patch: Partial<Settings>; layout: TabLayout } {
  const tmPages = (st.tmPages ?? []).filter((p) => p.kind !== "panels").map((p) => { const q = { ...p }; delete q.bg; delete q.look; return q; });
  const ids = new Set([MAIN_PAGE, ...tmPages.map((p) => p.id)]);
  const order = (st.tmPageOrder ?? [MAIN_PAGE]).filter((id) => ids.has(id));
  for (const id of ids) if (!order.includes(id)) order.push(id);
  return { patch: { tmPages, tmPageOrder: order }, layout: resetLayout(now) };
}

/** A look from the vault, checked (core/looksprofiles.ts cleanLooksStore for kind "mac"). null: not a Mac look. */
const LOOK_MAX_CHARS = 6000;
export function cleanMacLook(v: unknown): MacLook | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1 || !o.layout || typeof o.layout !== "object" || !Array.isArray(o.order)) return null;
  const look: Record<string, unknown> = {};
  if (o.look && typeof o.look === "object") {
    for (const k of LOOK_KEYS) {
      const x = (o.look as Record<string, unknown>)[k];
      if (x === undefined || x === null || typeof x === "function") continue;
      if (typeof x === "object" && JSON.stringify(x).length > 1500) continue;
      look[k] = x;
    }
  }
  if (JSON.stringify(look).length > LOOK_MAX_CHARS) return null;
  const order = [...new Set(o.order.filter((x): x is string => typeof x === "string" && x.length <= 40))].slice(0, 32);
  return { v: 1, layout: cleanLayout(o.layout), pages: cleanPages(o.pages), order, look: look as MacLook["look"] };
}

/** A small picture of a look for its card in the Looks menu: how many pages, which is the main one, the panels moved on
 *  the main page (fractions of the screen) and its background and look names. */
export function macPreview(l: MacLook): { pages: number; main: number; boxes: { x: number; y: number; w: number; h: number }[]; bg: string | null; look: string | null } {
  const boxes = Object.entries(l.layout.pos)
    .filter(([id]) => (l.layout.page?.[id] ?? MAIN_PAGE) === MAIN_PAGE && !l.layout.hidden.includes(id))
    .slice(0, 24)
    .map(([, p]) => ({ x: p.x, y: p.y, w: Math.min(1, p.w / 1440), h: Math.min(1, p.h / 900) }));
  const order = l.order.length ? l.order : [MAIN_PAGE];
  return { pages: order.length, main: Math.max(0, order.indexOf(MAIN_PAGE)), boxes, bg: typeof l.look.tmBg === "string" ? l.look.tmBg : null, look: typeof l.look.look === "string" ? l.look.look : null };
}

/** Every device kind's look data from the vault: the Mac's checked here; the phones' by their own module once they
 *  have one (until then any plain object of a sensible size). */
export function cleanLookData(kind: "mac" | "gos" | "ios", d: unknown): unknown | null {
  if (kind === "mac") return cleanMacLook(d);
  if (!d || typeof d !== "object") return null;
  try { return JSON.stringify(d).length <= 20000 ? d : null; } catch { return null; }
}

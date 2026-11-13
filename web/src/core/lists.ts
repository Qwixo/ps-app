// Several to-do lists as pages (V1.55). The developer, 12 Nov 2026: "If I swipe with two fingers from the left to the right of my
// trackpad, then I want to navigate to a different to-do list and I want to be able to create different to-do lists".
// Then: "kind of like the iOS home screen with the dots at the very bottom", "different backgrounds for every page and
// different appearances for each page", and "use their main page as the centre page and then have a page on the left,
// two pages on the right". The rules, apart from the drawing (views/ListPager.tsx):
//
// - A list is a page of sections. The main list is the home page, as before. Each extra list (settings.tmPages) names
//   the sections it shows: any of Priority 1, Priorities, Every day and the developer's task groups. A section is on one page only;
//   every section no extra list claims stays on the main list, so nothing can ever go missing.
// - settings.tmPageOrder is the pages left to right, "main" among them: lists can sit on both sides of home. Past the
//   first and the last page there is always an empty page with a big + that makes a new list there.
// - the developer's first example is two clicks: right click the Every day header, then Move to list, + New list.
// - A new list starts with one empty task group of its own ("To do"), so tasks can be typed or dropped straight in.
// - A task shows on the page of its section: a task group's page, else Every day's page (repeating), else Priority 1's
//   or Priorities' page.
// - Each page can have its own background and look (unset: the same as the main page, which uses the usual settings).
// - Names: a list's name lives on its page; the main list's name and the built-in section names (Priority 1,
//   Priorities, Every day, Completed) live in settings.tmNames. Unset means the name as before.
// - Settings is one encrypted record, so every change here is one change-only write (Supabase egress rule).
//
// The gesture rule (pageGesture, below). V1.55 removed the V1.34 row swipe (the developer: "No one actually uses it anyway"), so a
// sideways swipe anywhere on the list moves between pages. One gesture has one owner, chosen as it starts:
// - Up or down first, or within 220 ms of a scroll: a scroll, for the whole gesture. A scroll never turns sideways.
// - Clearly sideways first (10 px, well more across than down): a page swipe, on a row, a header or the empty space.
// - Over the side panels, a text box or something that scrolls sideways itself: nothing.
// Pure: no React, no DOM.
import type { Todo } from "./model";
import { accepts, groupKey, groupOf, type TabLists } from "./groups.ts";

export const MAIN = "main";
export const PAGES_MAX = 20;             // extra lists, so 21 pages in all
export const PLUS_LEFT = "+left", PLUS_RIGHT = "+right";   // the empty + pages at each end
export const LIST_NAME_MAX = 40;
export const SEC_NAME_MAX = 40;
const PAGE_ID = /^[a-z0-9]{4,24}$/;
const SEC_KEY = /^(p1|prio|daily|g:[a-z0-9]{4,24})$/;

/** One extra list. bg: its own background (a core/prio.ts BG_DESIGNS id or "video:<id>"), look: its own look (a
 *  core/looks.ts LOOKS id); unset means the same as the main page. Room to grow (see the note): a page that holds
 *  panels instead of tasks would add kind: "panels" and slots: the Edit mode Slot ids it shows. */
export interface ListPage { id: string; name: string; secs: string[]; bg?: string; look?: string; kind?: "panels" }
/** Renamed built-in names. main: the main list. done: the Completed section. */
export type ListNames = Partial<Record<"main" | "p1" | "prio" | "daily" | "done", string>>;
export const NAME_KEYS = ["main", "p1", "prio", "daily", "done"] as const;
export const DEFAULT_NAMES: Record<(typeof NAME_KEYS)[number], string> = {
  main: "Main list", p1: "Priority 1", prio: "Priorities", daily: "Every day", done: "Completed",
};
/** How a two finger trackpad swipe moves the pages. push: fingers to the right go to the list on the right (the developer's
 *  words, the default). drag: the page follows the fingers, like an iPhone (fingers to the right bring the list on
 *  the left). A finger on the phone always drags. */
export type SwipeDir = "push" | "drag";

export function newPageId() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => (x % 36).toString(36)).join("") + Date.now().toString(36).slice(-4);
}
export const tidyName = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Only well formed lists, each id once, each section on one list only, names trimmed (blank reads "List"). */
export function cleanPages(v: unknown): ListPage[] {
  if (!Array.isArray(v)) return [];
  const out: ListPage[] = [], taken = new Set<string>();
  for (const p of v) {
    if (!p || typeof p !== "object") continue;
    const { id, name, secs } = p as { id?: unknown; name?: unknown; secs?: unknown };
    if (typeof id !== "string" || id === MAIN || !PAGE_ID.test(id) || out.some((x) => x.id === id)) continue;
    const keys: string[] = [];
    if (Array.isArray(secs)) for (const k of secs) if (typeof k === "string" && SEC_KEY.test(k) && !taken.has(k)) { taken.add(k); keys.push(k); }
    const page: ListPage = { id, name: tidyName(name, LIST_NAME_MAX) || "List", secs: keys };
    const { bg, look } = p as { bg?: unknown; look?: unknown };
    if (typeof bg === "string" && /^[a-z0-9:#_-]{1,80}$/i.test(bg)) page.bg = bg;
    if (typeof look === "string" && /^[a-z0-9_-]{1,40}$/i.test(look)) page.look = look;
    // V1.55 Edit mode overview: a page made with its + holds panels, not tasks (it never shows "Add a task" prompts).
    if ((p as { kind?: unknown }).kind === "panels") page.kind = "panels";
    out.push(page);
    if (out.length >= PAGES_MAX) break;
  }
  return out;
}
export function cleanNames(v: unknown): ListNames {
  const out: ListNames = {};
  if (!v || typeof v !== "object") return out;
  for (const k of NAME_KEYS) { const n = tidyName((v as Record<string, unknown>)[k], k === "main" ? LIST_NAME_MAX : SEC_NAME_MAX); if (n) out[k] = n; }
  return out;
}
export const cleanSwipeDir = (v: unknown): SwipeDir => (v === "drag" ? "drag" : "push");

/** The name shown for a built-in section or the main list. daily: "Repeating" when not every task is every day. */
export function shownName(names: ListNames | undefined, key: (typeof NAME_KEYS)[number], allEveryDay = true): string {
  const own = names?.[key];
  if (own) return own;
  return key === "daily" && !allEveryDay ? "Repeating" : DEFAULT_NAMES[key];
}

/** The pages left to right, the main list among them: the saved order, each page once, any missing one on the right
 *  (a vault from before tmPageOrder has the main list first). */
export function pageOrder(saved: unknown, pages: ListPage[]): string[] {
  const ids = new Set([MAIN, ...pages.map((p) => p.id)]);
  const out = Array.isArray(saved) ? [...new Set(saved.filter((x): x is string => typeof x === "string" && ids.has(x)))] : [];
  if (!out.includes(MAIN)) out.unshift(MAIN);
  for (const p of pages) if (!out.includes(p.id)) out.push(p.id);
  return out;
}
/** Every page left to right with its name. order: pageOrder (unset: the main list first). */
export function allPages(pages: ListPage[], names?: ListNames, order?: string[]): { id: string; name: string }[] {
  const byId = new Map(pages.map((p) => [p.id, p.name]));
  return (order ?? pageOrder(undefined, pages)).map((id) => ({ id, name: id === MAIN ? shownName(names, "main") : byId.get(id) ?? "List" }));
}
/** The pager's pages: an empty + page at each end, while there is room for another list. */
export function pagerIds(order: string[], pages: ListPage[]): string[] {
  return pages.length < PAGES_MAX ? [PLUS_LEFT, ...order, PLUS_RIGHT] : order;
}
export const isPlus = (id: string) => id === PLUS_LEFT || id === PLUS_RIGHT;
/** A page put at `index` of the order (a new list on the far left is 0, on the far right order.length). */
export function placeAt(order: string[], id: string, index: number): string[] {
  const out = order.filter((x) => x !== id);
  out.splice(Math.max(0, Math.min(out.length, index)), 0, id);
  return out;
}
/** A page moved one place left (-1) or right (+1). */
export function movePage(order: string[], id: string, by: -1 | 1): string[] {
  const i = order.indexOf(id);
  return i < 0 ? order : placeAt(order, id, i + by);
}
export function pageOfSec(pages: ListPage[], key: string): string {
  return pages.find((p) => p.secs.includes(key))?.id ?? MAIN;
}
/** The full section order (core/groups.ts sectionOrder) split by page, each page in that order. */
export function secsByPage(fullOrder: string[], pages: ListPage[]): Map<string, string[]> {
  const out = new Map<string, string[]>([[MAIN, []], ...pages.map((p) => [p.id, []] as [string, string[]])]);
  for (const k of fullOrder) out.get(pageOfSec(pages, k))!.push(k);
  return out;
}
/** Which page shows a task. known: the ids of the task groups that exist. */
export function pageOfTask(t: Pick<Todo, "type" | "group" | "p1">, known: Set<string>, pages: ListPage[]): string {
  if (t.group && known.has(t.group)) return pageOfSec(pages, groupKey(t.group));
  if (t.type === "daily") return pageOfSec(pages, "daily");
  return pageOfSec(pages, t.p1 ? "p1" : "prio");
}

/** A new list after the others (or after `after`), holding `secs` (taken off any list they were on). */
export function addPage(pages: ListPage[], page: ListPage, after?: string): ListPage[] {
  if (pages.length >= PAGES_MAX) return pages;
  const take = new Set(page.secs);
  const rest = pages.map((p) => ({ ...p, secs: p.secs.filter((k) => !take.has(k)) }));
  const found = after ? rest.findIndex((p) => p.id === after) : -1;
  const at = after === MAIN ? 0 : found >= 0 ? found + 1 : rest.length;
  rest.splice(at, 0, { id: page.id, name: tidyName(page.name, LIST_NAME_MAX) || "List", secs: [...take] });
  return rest;
}
/** A section moved to another list (MAIN: back to the main list). */
export function moveSec(pages: ListPage[], key: string, to: string): ListPage[] {
  return pages.map((p) => {
    const secs = p.secs.filter((k) => k !== key);
    if (p.id === to) secs.push(key);
    return { ...p, secs };
  });
}
export function renamePage(pages: ListPage[], id: string, name: string): ListPage[] {
  const n = tidyName(name, LIST_NAME_MAX);
  return n ? pages.map((p) => (p.id === id ? { ...p, name: n } : p)) : pages;
}
/** A list taken away: its sections go back to the main list. (Delete it and its tasks: views/ListPager.tsx deletes the
 *  tasks first, with one Undo.) */
export function removePage(pages: ListPage[], id: string): ListPage[] {
  return pages.filter((p) => p.id !== id);
}
/** Drop sections whose group is gone (a group deleted elsewhere). */
export function prunePages(pages: ListPage[], groupIds: Set<string>): ListPage[] {
  return pages.map((p) => ({ ...p, secs: p.secs.filter((k) => { const g = groupOf(k); return !g || groupIds.has(g); }) }));
}

/** Where tasks moved to a list land: the first section on that page (in order) that takes all of them, at its end.
 *  A list with Priorities puts it there (never Priority 1 by a move); with only Priority 1, there. null: no section there takes
 *  them, so the caller makes a task group on that page first. */
export function listMoveTarget(lists: TabLists, pageSecs: string[], types: Todo["type"][]): { to: string; index: number } | null {
  for (const k of pageSecs) {
    if (!accepts(k, types) || (k === "p1" && pageSecs.includes("prio"))) continue;   // never Priority 1 by a move to a list
    const g = groupOf(k);
    const len = k === "p1" ? lists.p1.length : k === "prio" ? lists.prio.length : k === "daily" ? lists.daily.length : lists.groups.get(g!)?.length;
    if (len === undefined) continue;
    return { to: k, index: len };
  }
  return null;
}
/** A new task typed while a list is shown: the task group it joins so it shows there (null: it needs none, or the
 *  list has none, and it goes where it always went). */
export function addGroupFor(pageSecs: string[], type: Todo["type"], groupIds: Set<string>): string | null {
  if (pageSecs.includes(type === "daily" ? "daily" : "prio") || (type !== "daily" && pageSecs.includes("p1"))) return null;
  for (const k of pageSecs) { const g = groupOf(k); if (g && groupIds.has(g)) return g; }
  return null;
}

// ---------- the gesture rule ----------
export type GestureOver = "list" | "other";
export type GestureOwner = "page" | "scroll" | "none";
export const PAGE_LOCK = 10;          // px sideways before a page swipe starts
export const AFTER_SCROLL_MS = 220;   // the tail of an up or down scroll never starts a page swipe
export const GESTURE_GAP_MS = 140;    // no wheel event for this long: the gesture is over (when the Mac does not say)

/** Who owns a gesture that started over `over`, after a move of dx, dy so far. null: too small to tell yet.
 *  sinceScroll: ms since the last up or down scroll ended (Infinity if none). */
export function pageGesture(over: GestureOver, dx: number, dy: number, sinceScroll = Infinity): GestureOwner | null {
  if (over === "other") return "none";
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ay >= 4 && ay > ax * 0.75) return "scroll";
  if (sinceScroll < AFTER_SCROLL_MS) return "scroll";
  if (ax >= PAGE_LOCK && ax > ay * 1.6) return "page";
  return null;
}
/** A trackpad's wheel delta as the fingers' own move (positive right): with natural scrolling (the Mac's default) the
 *  content moves against the fingers, so deltaX is the other way round. WebKit says which
 *  (webkitDirectionInvertedFromDevice); not told means the Mac default. (From core/swipe.ts, gone with the row swipe.) */
export function fingerDx(deltaX: number, inverted: boolean | undefined): number {
  return inverted === false ? deltaX : -deltaX;
}
/** The pages' own move for a two finger swipe: fx is the fingers' move (fingerDx). */
export function pageDx(fx: number, dir: SwipeDir): number {
  return dir === "drag" ? fx : -fx;
}
/** Settings, Controls, "Invert swipe" (V1.57, the developer 13 Nov 2026: "make an option in settings ... to make it inverted"):
 *  -1 flips every page swipe (the Mac's trackpad, a finger on the phone or a touch screen, the phone's panes and pages
 *  of panels), 1 leaves it as it is. Off (missing) by default. The arrow keys and the dots are not swipes: unchanged. */
export const swipeSign = (invert: unknown): 1 | -1 => (invert === true ? -1 : 1);
/** A page swipe's move after Invert swipe: the same number, or the other way. */
export const swiped = (dx: number, invert: unknown) => dx * swipeSign(invert);

// ---------- the page slide ----------
/** Where the pages sit for a move of dx from page `index`: one to one, and past the first or last page it stretches
 *  like rubber (the iPhone's formula). One page only: nothing moves. */
export function pageOffset(dx: number, width: number, index: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  const past = (index === 0 && dx > 0) || (index === count - 1 && dx < 0);
  if (!past) return Math.max(-width, Math.min(width, dx));
  const ax = Math.abs(dx);
  return Math.sign(dx) * (1 - 1 / ((ax * 0.55) / width + 1)) * width;
}
export const PAGE_FLICK = 0.4;   // px per ms
/** The page a let go lands on: past a third of the width, or a quick flick the same way, goes one page. */
export function settleIndex(index: number, count: number, dx: number, v: number, width: number): number {
  let to = index;
  if (Math.abs(dx) > width / 3 || (Math.abs(dx) > 24 && Math.abs(v) > PAGE_FLICK && Math.sign(v) === Math.sign(dx))) to = index - Math.sign(dx);
  return Math.max(0, Math.min(count - 1, to));
}
/** One step of the spring that carries the pages home: x the position, v its speed (px per s), to the target.
 *  Stiff and a little underdamped, so it lands quickly with a soft settle. */
export const SPRING = { k: 380, c: 32 };
export function springStep(x: number, v: number, to: number, dt: number, s = SPRING): { x: number; v: number } {
  // Small fixed steps (semi-implicit Euler), so a slow frame never makes it jump or explode.
  let px = x, pv = v, left = Math.min(dt, 0.064);
  while (left > 0) {
    const h = Math.min(left, 1 / 240);
    pv += (-s.k * (px - to) - s.c * pv) * h;
    px += pv * h;
    left -= h;
  }
  return { x: px, v: pv };
}
export const springDone = (x: number, v: number, to: number) => Math.abs(x - to) < 0.5 && Math.abs(v) < 8;
/** The speed the spring starts with (px per s) after a swipe let go at v px per ms, `left` px from home: a hard
 *  flick is capped, so the pages never fly past their place (a few px of give at most). */
export function springStart(v: number, left: number): number {
  const m = Math.abs(left) * 5 + 250;
  return Math.max(-m, Math.min(m, v * 1000));
}
/** Next or previous page for a key or a dot, clamped. */
export const stepIndex = (index: number, count: number, by: number) => Math.max(0, Math.min(count - 1, index + by));

/** The lists' settings as they arrive from the Tab list window (ps.ts cleanLooks): only well formed ones. */
export function cleanPagesLooks(p: Record<string, unknown>): { tmPages?: ListPage[]; tmPageOrder?: string[]; tmNames?: ListNames; tmSwipeDir?: SwipeDir } {
  const o: { tmPages?: ListPage[]; tmPageOrder?: string[]; tmNames?: ListNames; tmSwipeDir?: SwipeDir } = {};
  if (Array.isArray(p.tmPages)) o.tmPages = cleanPages(p.tmPages);
  if (Array.isArray(p.tmPageOrder)) o.tmPageOrder = [...new Set(p.tmPageOrder.filter((x): x is string => typeof x === "string" && (x === MAIN || PAGE_ID.test(x))))].slice(0, PAGES_MAX + 1);
  if (p.tmNames && typeof p.tmNames === "object") o.tmNames = cleanNames(p.tmNames);
  if (p.tmSwipeDir === "push" || p.tmSwipeDir === "drag") o.tmSwipeDir = p.tmSwipeDir;
  return o;
}

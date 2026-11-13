// Pin any screen in the Tab list by double clicking its top bar (the developer, 2 Nov 2026). Done once, here,
// for every screen and pop-up (Numerology, Settings, Map, Timelines, the network panel, Second
// Computer, Dimension X... and any added later): nothing in a screen's own code knows about pins.
//
// - A screen is any [role="dialog"], [data-pin-screen], .tm-pop or labelled aside, section or
//   article in the floating list; its top bar is the first header-like element inside it
//   (core/pinrules.ts). A double click there pins it; the bar lights up slightly white. Again unpins.
// - Letting go of Tab or / hides everything as always (PS is told, see ps-mac "pin"). While a pin
//   is held the list is not rebuilt when it hides (PsApp.tsx), so on the next hold the screen is
//   simply still there: no click, no delay, no flash of the list, same scroll and state.
// - Only one pin: pinning another screen replaces it. Closing the pinned screen yourself (its x,
//   Esc inside it, a click outside) unpins it.
// - It survives a PS restart: the pin (which screen, and the button that opened it) is kept in this
//   Mac's local storage, and once the list is back the opening click is replayed while it is hidden.
import { PS, psOverlayShown, psPost } from "../ps";
import { BAR_SEL, DANGER, INTERACTIVE, NOT_SCREEN, SCREEN_SEL, keyOf, launchFrom, parsePin, type Pin, type Launch } from "../core/pinrules";
import "./pin.css";

const STORE = "ps.pinScreen.v1";
let pin: Pin | null = null;
let el: HTMLElement | null = null;          // the pinned screen while it is in the page
let started = false, restoring = false;
const listeners = new Set<() => void>();

/** Is a screen pinned? (PsApp keeps the list as it is when it hides.) */
export function pinHeld(): boolean { return !!pin; }
export function pinnedKey(): string | null { return pin?.key ?? null; }
export function onPinChange(f: () => void) { listeners.add(f); return () => void listeners.delete(f); }

function save() {
  try { if (pin) localStorage.setItem(STORE, JSON.stringify(pin)); else localStorage.removeItem(STORE); } catch { /* private storage off: the pin lasts this session */ }
  psPost({ type: "pin", on: !!pin });
  listeners.forEach((f) => f());
}

export function screenOf(t: Element): HTMLElement | null {
  const root = t.closest<HTMLElement>(SCREEN_SEL);
  if (!root || root.closest(NOT_SCREEN)) return null;
  return root;
}
export function barOf(root: HTMLElement): HTMLElement | null {
  for (const b of root.querySelectorAll<HTMLElement>(BAR_SEL)) {
    if (screenOf(b) === root && b.getClientRects().length) return b;
  }
  return null;
}
function find(key: string): HTMLElement | null {
  if (el?.isConnected && keyOf(el) === key) return el;
  for (const r of document.querySelectorAll<HTMLElement>(SCREEN_SEL)) if (!r.closest(NOT_SCREEN) && keyOf(r) === key) return r;
  return null;
}
function mark(root: HTMLElement | null, on: boolean) {
  if (!root) return;
  const bar = barOf(root);
  if (on) { root.setAttribute("data-ps-pinned-screen", ""); bar?.setAttribute("data-ps-pinned", ""); }
  else { root.removeAttribute("data-ps-pinned-screen"); root.querySelectorAll("[data-ps-pinned]").forEach((b) => b.removeAttribute("data-ps-pinned")); }
}
function flash(root: HTMLElement) {
  barOf(root)?.animate([{ boxShadow: "inset 0 0 0 100vmax rgba(255,255,255,.22), inset 0 0 0 2px rgba(255,255,255,.75), 0 0 34px rgba(255,255,255,.45)" }, { boxShadow: "inset 0 0 0 100vmax rgba(255,255,255,0), inset 0 0 0 1px rgba(255,255,255,0), 0 0 22px -4px rgba(255,255,255,0)" }], { duration: 380, easing: "ease-out" });
}

function setPin(root: HTMLElement) {
  mark(el, false);
  el = root;
  pin = { key: keyOf(root), launch: launches.get(root) ?? launchFrom(recent, performance.now(), describe(root.parentElement)), at: Date.now() };
  mark(root, true);
  flash(root);
  save();
}
function unpin() {
  mark(el, false);
  if (el) flash(el);
  el = null; pin = null;
  save();
}

// ---------- which button opened each screen (so a restart can open it again) ----------
const DYN = /^(on|open|opening|closing|closed|hot|sel|active|show|shown|in|out|peek|big|ready|busy|empty|all|late|done|working|pressing|fresh|plop-in)$/;
/** A short CSS selector for an element, from its own static classes (and its parent's if needed). */
export function describe(n: Element | null): string {
  const one = (x: Element) => {
    const cls = [...x.classList].filter((c) => !DYN.test(c)).slice(0, 3);
    const al = x.getAttribute("aria-label");
    return x.tagName.toLowerCase() + cls.map((c) => "." + CSS.escape(c)).join("") + (!cls.length && al ? `[aria-label^="${CSS.escape(al.split(/[\s:]/)[0])}"]` : "");
  };
  const parts: string[] = [];
  for (let x = n, i = 0; x && x !== document.body && i < 3; x = x.parentElement, i++) {
    parts.unshift(one(x));
    const sel = parts.join(" > ");
    try { if (document.querySelectorAll(sel).length === 1) return sel; } catch { return ""; }
  }
  return parts.join(" > ");
}
const recent: { sel: string; at: number }[] = [];
const launches = new WeakMap<Element, Launch>();
function noteClick(e: MouseEvent) {
  const b = (e.target as Element | null)?.closest?.("button, [role='button'], [role='tab'], a");
  if (!b || b.closest(".tm-list, .mt-panel") || screenOf(b)?.hasAttribute("data-ps-pinned-screen")) return;
  if (DANGER.test(`${b.getAttribute("aria-label") || ""} ${b.textContent || ""}`)) return;
  const sel = describe(b);
  if (!sel) return;
  recent.push({ sel, at: performance.now() });
  if (recent.length > 6) recent.shift();
}
function noteScreens(nodes: Element[]) {
  for (const n of nodes) {
    const found = n.matches(SCREEN_SEL) ? [n] : [];
    n.querySelectorAll(SCREEN_SEL).forEach((x) => found.push(x));
    for (const r of found) if (!launches.has(r) && !r.closest(NOT_SCREEN)) launches.set(r, launchFrom(recent, performance.now(), describe(r.parentElement)));
  }
}

// ---------- keeping the pin alive in the page ----------
function sync() {
  if (!pin) return;
  const r = find(pin.key);
  if (r) {
    if (r !== el) { mark(el, false); el = r; }
    if (!barOf(r)?.hasAttribute("data-ps-pinned") || !r.hasAttribute("data-ps-pinned-screen")) mark(r, true);
    return;
  }
  // Gone while the list is up and still there: the developer closed it himself, so the pin goes too.
  if (el && !restoring && psOverlayShown() && document.querySelector(".tm-overlay:not(.tm-docked)")) { el = null; pin = null; save(); return; }
  el = null;
}
let raf = 0;
function soon() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; sync(); }); }

/** A pop-up that closes when the mouse leaves it (Timelines, screen time) stays while pinned. */
function keepHover(e: MouseEvent) {
  if (!el?.isConnected) return;
  const from = e.target as Node, to = e.relatedTarget as Node | null;
  const vw = innerWidth * innerHeight;
  for (let x: HTMLElement | null = el, i = 0; x && i < 3; x = x.parentElement, i++) {
    if (x === document.body || x.matches(".tm-overlay, .tm-inner, .tm-scroll")) break;
    const b = x.getBoundingClientRect();
    if (b.width * b.height > vw * 0.6) break;
    if (x.contains(from) && !(to && x.contains(to))) { e.stopPropagation(); return; }
  }
}

function dbl(e: MouseEvent) {
  const t = e.target as Element | null;
  if (!t || !(t instanceof Element) || t.closest(INTERACTIVE)) return;
  const root = screenOf(t);
  if (!root) return;
  const bar = barOf(root);
  if (!bar || !bar.contains(t)) return;
  getSelection()?.removeAllRanges();   // a double click also selects the word under it
  if (pin && pin.key === keyOf(root)) unpin(); else setPin(root);
}

// ---------- the list hides and comes back ----------
let scrolls: [Element, number, number][] = [];
/** The list is hiding: remember where the pinned screen is scrolled to. */
export function pinListHidden() {
  scrolls = [];
  if (!el?.isConnected) return;
  for (const x of [el, ...el.querySelectorAll("*")]) if (x.scrollTop || x.scrollLeft) scrolls.push([x, x.scrollTop, x.scrollLeft]);
}
/** The list is back: same scroll as it was (the hidden window shrinks to one pixel in between). */
export function pinListShown() {
  const put = () => { for (const [x, t, l] of scrolls) if (x.isConnected) { if (x.scrollTop !== t) x.scrollTop = t; if (x.scrollLeft !== l) x.scrollLeft = l; } };
  put();
  requestAnimationFrame(put);
}

/** After a restart (or the list being rebuilt) open the pinned screen again, the way it was opened. */
export async function restorePin() {
  if (!pin || restoring) return;
  restoring = true;
  try {
    const p = pin, until = Date.now() + 12_000;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    while (pin === p && !find(p.key) && Date.now() < until) {
      if (p.launch.mode === "hover") {
        const o = p.launch.owner ? document.querySelector(p.launch.owner) : null;
        o?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
      } else {
        for (const sel of p.launch.steps) {
          if (find(p.key)) break;
          const b = document.querySelector<HTMLElement>(sel);
          if (b) { b.click(); await wait(160); }
        }
      }
      await wait(find(p.key) ? 0 : 500);
    }
    sync();
  } finally { restoring = false; }
}

/** PS's floating list only (PsApp.tsx). */
export function startPins() {
  if (!PS || started) return;
  started = true;
  try { pin = parsePin(localStorage.getItem(STORE)); } catch { pin = null; }
  if (pin) psPost({ type: "pin", on: true });
  document.addEventListener("dblclick", dbl, true);
  document.addEventListener("click", noteClick, true);
  window.addEventListener("mouseout", keepHover, true);
  new MutationObserver((muts) => {
    const added: Element[] = [];
    for (const m of muts) m.addedNodes.forEach((n) => { if (n instanceof Element) added.push(n); });
    if (added.length) noteScreens(added);
    soon();
  }).observe(document.body, { childList: true, subtree: true });
}

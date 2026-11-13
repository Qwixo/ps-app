// The page's half of "Esc always backs out of PS" (V1.41; the rules and the developer's words are in core/escape.ts).
// The Mac takes every Esc itself and calls window.__psEscape() on the Tab list page. It answers true when it
// stepped back (closed the top screen, pop-up, menu or edit), false when nothing was open; then PS hides the list.
// If this page never answers (busy, broken, still loading), PS hides the list by itself after a short wait.
//
// One Esc steps back ONE layer, the top one:
//  1. Every screen and pop-up adds its own Esc listener on window when it opens (tests/esc-always.test.ts lists
//     them). The newest one is the top layer, so those listeners are asked newest first, and the first that uses
//     the key (preventDefault or stopping it) ends it. (A browser would ask the oldest first, so a sheet opened over
//     Settings would let Settings close under it.)
//  2. Nobody used it: the same Esc a keyboard sends goes to whatever has the focus (a text box, a menu) and the page.
//     It counts when a handler used it or a screen left the page within a moment.
//  3. A screen that still only takes the Mac's old hand over (window.__psDimxClose).
//  4. A dialog still open with a Close button: that button is pressed.
// On the website (V1.44) it runs too, for the To-do page in web form: startEscape({ web: true }) in escstart.ts.
import { SETTLE_MS, isLayer, knownAtOnce, steppedBack } from "../core/escape";

let probing = false;
/** True while the page's own Esc is being sent (the old "Esc closes the list" listener must not answer it). */
export function escProbing() { return probing; }

// ---------- window keydown listeners, in the order they were added ----------
type Entry = { orig: EventListenerOrEventListenerObject; wrap: EventListener; capture: boolean; seq: number };
const entries: Entry[] = [];
let seq = 0;
let skipCapture = false;      // step 2: the capture listeners were already asked in step 1
const captureOf = (o?: boolean | AddEventListenerOptions | EventListenerOptions) => typeof o === "boolean" ? o : !!o?.capture;
const call = (l: EventListenerOrEventListenerObject, t: unknown, e: Event) => { if (typeof l === "function") l.call(t, e); else l.handleEvent(e); };

const drop = (x: Entry) => { const i = entries.indexOf(x); if (i >= 0) entries.splice(i, 1); };
function track() {
  // The real ones (on EventTarget, so this patch never calls itself).
  const add = (t: string, l: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions) => EventTarget.prototype.addEventListener.call(window, t, l, o);
  const remove = (t: string, l: EventListenerOrEventListenerObject | null, o?: boolean | EventListenerOptions) => EventTarget.prototype.removeEventListener.call(window, t, l, o);
  window.addEventListener = ((type: string, l: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions) => {
    if (type !== "keydown" || !l) return add(type, l, o);
    const capture = captureOf(o);
    if (entries.some((x) => x.orig === l && x.capture === capture)) return;     // the browser ignores a second add too
    const once = typeof o === "object" && !!o?.once;
    const entry: Entry = { orig: l, capture, seq: ++seq, wrap: function (this: unknown, e: Event) { if (capture && skipCapture) return; if (once) drop(entry); call(l, this, e); } };
    entries.push(entry);
    add(type, entry.wrap, o);
  }) as typeof window.addEventListener;
  window.removeEventListener = ((type: string, l: EventListenerOrEventListenerObject | null, o?: boolean | EventListenerOptions) => {
    if (type !== "keydown" || !l) return remove(type, l, o);
    const capture = captureOf(o);
    const x = entries.find((y) => y.orig === l && y.capture === capture);
    if (!x) return remove(type, l, o);
    drop(x);
    remove(type, x.wrap, o);
  }) as typeof window.removeEventListener;
}

function escEvent() {
  const ev = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true });
  let stopped = false;
  Object.defineProperty(ev, "stopPropagation", { value: () => { stopped = true; } });
  Object.defineProperty(ev, "stopImmediatePropagation", { value: () => { stopped = true; } });
  return { ev, used: () => ev.defaultPrevented || stopped };
}

/** Step 1: the window capture listeners, newest first. True when one used the key. */
function newestFirst(): boolean {
  for (const x of [...entries].filter((y) => y.capture).sort((a, b) => b.seq - a.seq)) {
    if (!entries.includes(x)) continue;          // an earlier one closed this screen meanwhile
    const { ev, used } = escEvent();
    probing = true;
    try { call(x.orig, window, ev); } catch { /* a broken screen: the next one */ } finally { probing = false; }
    if (used()) return true;
  }
  return false;
}

function layersIn(n: Node): number {
  if (!(n instanceof HTMLElement)) return 0;
  const cls = typeof n.className === "string" ? n.className : "";
  if (isLayer(cls, n.getAttribute("role"))) return 1;
  let seen = 0;
  for (const el of n.querySelectorAll<HTMLElement>("[role='dialog'], [role='menu'], [class]")) {
    if (++seen > 300) break;
    if (isLayer(typeof el.className === "string" ? el.className : "", el.getAttribute("role"))) return 1;
  }
  return 0;
}

/** The last visible Close button inside an open dialog (the top one: portals are added last). */
function closeButton(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>("[role='dialog'] button, [role='alertdialog'] button, [aria-modal='true'] button");
  for (let i = all.length - 1; i >= 0; i--) {
    const b = all[i];
    const label = (b.getAttribute("aria-label") || b.getAttribute("title") || "").trim();
    if (!/^close\b/i.test(label) || (b as HTMLButtonElement).disabled || !b.getClientRects().length) continue;
    if (b.closest("[aria-hidden='true'], [inert]")) continue;
    return b;
  }
  return null;
}

/** Step 2: the Esc a keyboard sends, to the focus and then the page (the capture listeners skipped). */
function sendEsc(): { prevented: boolean; reached: boolean } {
  let reached = false;
  const probe = () => { reached = true; };
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  add.call(window, "keydown", probe);           // added last on window, untracked: it hears the key only if nobody stopped it
  const t = document.activeElement && document.activeElement !== document.body ? document.activeElement : window;
  const ev = new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true });
  probing = true; skipCapture = true;
  let prevented = false;
  try { prevented = !t.dispatchEvent(ev); }
  catch { /* a handler threw: the key was still sent */ }
  finally { probing = false; skipCapture = false; remove.call(window, "keydown", probe); }
  return { prevented, reached };
}

/** One Esc: true when the page stepped back, false when nothing was open. Never throws. */
export async function psEscape(): Promise<boolean> {
  try {
    if (newestFirst()) return true;
    let gone = 0;
    const mo = new MutationObserver((list) => { for (const r of list) for (const n of r.removedNodes) gone += layersIn(n); });
    mo.observe(document.body, { childList: true, subtree: true });
    const p = sendEsc();
    if (knownAtOnce(p)) { mo.disconnect(); return true; }
    await new Promise((r) => window.setTimeout(r, SETTLE_MS));
    mo.disconnect();
    if (steppedBack({ ...p, layersGone: gone })) return true;
    const w = window as Window & { __psDimxClose?: () => boolean };
    if (typeof w.__psDimxClose === "function") {
      try { if (w.__psDimxClose() === true) return true; } catch { /* a broken screen */ }
    }
    const b = closeButton();
    if (b) { b.click(); return true; }
    return false;
  } catch { return false; }
}

let started = false;
/** Called once by the PS pages (views/PsApp.tsx) when that file loads, before any screen adds its Esc.
 *  `web` (V1.44, the website): there is no Mac to take the key, so the page's first window listener takes a real Esc
 *  itself while the To-do page in web form shows (.tm-web) and steps back one layer exactly as PS does. The website's
 *  other pages keep their keys as they were. */
export function startEscape(o: { web?: boolean } = {}) {
  if (started || typeof window === "undefined") return;
  started = true;
  if (o.web) {
    // Added first and untracked, so it hears a real Esc before any screen's own listener; the Esc psEscape sends on
    // (isTrusted false) passes through it.
    EventTarget.prototype.addEventListener.call(window, "keydown", ((e: KeyboardEvent) => {
      if (e.key !== "Escape" || !e.isTrusted || e.isComposing || !document.querySelector(".tm-web")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void psEscape();
    }) as EventListener, true);
  }
  track();
  (window as Window & { __psEscape?: () => Promise<boolean> }).__psEscape = psEscape;
}

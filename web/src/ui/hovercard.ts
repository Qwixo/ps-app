// The hover card (V1.43, the developer 8 Nov 2026: "whenever you hover over a button, like the little buttons at the top
// right, it comes up with a nice animation with what the button is and a short what it does when you press it").
// One card for the whole page, on document.body, never taking a click (pointer-events none):
//  - which buttons: any element with data-tip (data-tip-line is its second line), else one with a browser title
//    (the title is taken off so the browser's own plain tooltip never shows too; the words come from
//    core/hoverwords.ts or the title split in two), else an icon only button with an aria-label.
//  - when: after the pointer rests SHOW_MS on it, at once (WARM_MS) while moving along from a card just shown, never
//    for touch, never while that button's own pop-up is open (aria-expanded), gone on a press, a scroll, Esc, the
//    window losing focus or the button leaving the page.
//  - where: under the button, above it with no room below, always fully on screen (core/hovercard.ts placeCard).
//  - looks: a dark glass card with white words that reads over every look and background; a quick rise and fade,
//    only a fade with Reduce motion on.
import { cleanTip, HIDE_MS, placeCard, SHOW_MS, splitTitle, WARM_FOR_MS, WARM_MS } from "../core/hovercard";
import { wordsFor } from "../core/hoverwords";
import "./hovercard.css";

const SEL = "[data-tip], [title], button[aria-label], [role='button'][aria-label], [role='switch'][aria-label]";

/** The words for an element, or null (no card). Moves an old title into data-tip-title on the way. */
export function tipOf(el: Element): { name: string; line: string } | null {
  if (el.hasAttribute("data-tip")) {
    const n = el.getAttribute("data-tip");
    if (!n) return null;   // data-tip="" means: no card here
    return cleanTip(n, el.getAttribute("data-tip-line"));
  }
  const t = el.getAttribute("title");
  if (t != null) { el.removeAttribute("title"); if (t) el.setAttribute("data-tip-title", t); }
  const title = t || el.getAttribute("data-tip-title");
  if (title) { const w = wordsFor(title) || splitTitle(title); return cleanTip(w.name, w.line); }
  // An icon only button: its screen reader name is the card.
  const label = el.getAttribute("aria-label");
  if (label && !(el.textContent || "").replace(/\s+/g, "").length) { const w = wordsFor(label) || splitTitle(label); return cleanTip(w.name, w.line); }
  return null;
}

let started = false;
export function startHoverCards() {
  if (started || typeof document === "undefined") return;
  started = true;
  // A title is taken off the moment the pointer reaches it, before the browser could show its own tooltip.
  const card = document.createElement("div");
  card.className = "hc-card";
  card.setAttribute("role", "tooltip");
  card.id = "ps-hover-card";
  card.innerHTML = '<i class="hc-arrow"></i><b class="hc-name"></b><span class="hc-line"></span>';
  const nameEl = card.querySelector(".hc-name") as HTMLElement, lineEl = card.querySelector(".hc-line") as HTMLElement, arrowEl = card.querySelector(".hc-arrow") as HTMLElement;
  let host: Element | null = null, showT = 0, hideT = 0, lastHide = 0, shown = false, watch = 0;

  const hide = (now = false) => {
    clearTimeout(showT);
    if (!shown) { host = null; return; }
    const go = () => {
      shown = false; host = null; lastHide = Date.now();
      card.classList.remove("in");
      cancelAnimationFrame(watch);
    };
    clearTimeout(hideT);
    if (now) go(); else hideT = window.setTimeout(go, HIDE_MS);
  };
  const open = (el: Element) => {
    if (!el.isConnected || el.getAttribute("aria-expanded") === "true" || (el as HTMLButtonElement).disabled === true && !el.hasAttribute("data-tip")) return;
    const w = tipOf(el);
    if (!w) return;
    if (!card.isConnected) document.body.appendChild(card);
    nameEl.textContent = w.name;
    lineEl.textContent = w.line;
    lineEl.hidden = !w.line;
    // Measure where it sits, then place it (card is fixed, so its size does not depend on where it is).
    card.classList.remove("in", "above", "below");
    card.style.left = "0px"; card.style.top = "0px";
    const r = el.getBoundingClientRect();
    // Its own size, not the scaled down one of its opening animation.
    const p = placeCard(r, { w: card.offsetWidth, h: card.offsetHeight }, { w: window.innerWidth, h: window.innerHeight });
    card.style.left = `${p.x}px`; card.style.top = `${p.y}px`;
    arrowEl.style.left = `${p.arrow}px`;
    card.classList.add(p.side);
    void card.offsetWidth;   // start the animation from its first frame
    card.classList.add("in");
    shown = true;
    el.setAttribute("aria-describedby", card.id);
    // The button can go away under the pointer (a screen closing): the card goes with it.
    const check = () => { if (!host || !host.isConnected || host.getAttribute("aria-expanded") === "true") { hide(true); return; } watch = requestAnimationFrame(check); };
    cancelAnimationFrame(watch); watch = requestAnimationFrame(check);
  };
  const target = (e: Event) => {
    const t = e.target as Element | null;
    if (!t || typeof t.closest !== "function") return null;
    const el = t.closest(SEL);
    if (!el || el === card) return null;
    // A whole panel with a title is not a button: only interactive ones, or anything that says data-tip.
    if (!el.hasAttribute("data-tip") && !el.closest("button, a[href], [role='button'], [role='switch'], [role='radio'], [role='tab'], [role='checkbox'], [role='menuitem'], label, input, select, summary")) {
      if (el.hasAttribute("title")) { const v = el.getAttribute("title")!; el.removeAttribute("title"); el.setAttribute("data-tip-title", v); }
      return null;
    }
    return el;
  };

  document.addEventListener("pointerover", (e) => {
    if (e.pointerType && e.pointerType !== "mouse") return;
    const el = target(e);
    if (el === host) { clearTimeout(hideT); return; }
    if (!el) return;
    if (el.hasAttribute("title")) tipOf(el);   // take the browser tooltip away at once
    if (host && host !== el) hide(true);
    host = el;
    clearTimeout(showT); clearTimeout(hideT);
    const warm = shown || Date.now() - lastHide < WARM_FOR_MS;
    showT = window.setTimeout(() => { if (host === el) open(el); }, warm ? WARM_MS : SHOW_MS);
  }, true);
  document.addEventListener("pointerout", (e) => {
    if (!host) return;
    const to = e.relatedTarget as Node | null;
    if (to && host.contains(to)) return;
    hide();
  }, true);
  const now = () => { lastHide = 0; hide(true); };
  document.addEventListener("pointerdown", now, true);
  document.addEventListener("wheel", now, { capture: true, passive: true });
  document.addEventListener("scroll", now, { capture: true, passive: true });
  window.addEventListener("blur", now);
  // Esc closes the card too, and is still left for whatever is under it (the card is never a layer of its own).
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" || e.key === "Tab" || e.key === "Enter" || e.key === " ") now(); }, true);
}

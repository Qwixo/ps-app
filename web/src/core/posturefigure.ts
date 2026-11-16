// The stick figure of the Posture reminder (PS 1.65): one picture, drawn once here and used by both pop-ups (the website's
// views/PosturePopup.tsx, and the Mac's card, which gets these two strings from the page: Sources/Posture.swift).
// It sits at a desk side on, slouches forward, holds it a moment, then sits up straight and stays that way. Plain SVG and
// CSS (transform only), no images, nothing loaded. With reduced motion there is no animation and it is simply straight.
// Pure: two constant strings, checked by tests/posture.test.ts (no scripts, no links, no external anything).
import { FIGURE_MS } from "./posture.ts";

const TOTAL = FIGURE_MS.slouch + FIGURE_MS.hold + FIGURE_MS.up;
const pct = (ms: number) => Math.round((ms / TOTAL) * 1000) / 10;

export const FIGURE_SVG =
  `<svg class="pf" viewBox="1 0 120 150" width="150" height="188" role="img" aria-label="A stick figure slouches, then sits up straight" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">` +
  `<path class="pf-chair" d="M30 112h52M30 112V62M44 112v32M72 112v32" stroke-width="3"/>` +
  `<path class="pf-legs" d="M56 108h32v34"/>` +
  `<g class="pf-torso"><path d="M56 108V58"/><path class="pf-arm" d="M56 68l20 16h16" stroke-width="4"/>` +
  `<g class="pf-head"><circle cx="56" cy="44" r="12" stroke-width="4"/></g></g>` +
  `</svg>`;

export const FIGURE_CSS =
  `.pf{display:block;margin:0 auto;color:var(--ink,#fff)}` +
  `.pf-chair{opacity:.35}` +
  `.pf-torso{transform-origin:56px 108px;animation:pf-torso ${TOTAL}ms linear both}` +
  `.pf-head{transform-origin:56px 58px;animation:pf-head ${TOTAL}ms linear both}` +
  `@keyframes pf-torso{0%{transform:rotate(0);animation-timing-function:cubic-bezier(.45,0,.35,1)}` +
  `${pct(FIGURE_MS.slouch)}%{transform:rotate(26deg)}${pct(FIGURE_MS.slouch + FIGURE_MS.hold)}%{transform:rotate(26deg);animation-timing-function:cubic-bezier(.45,0,.35,1)}100%{transform:rotate(0)}}` +
  `@keyframes pf-head{0%{transform:rotate(0);animation-timing-function:cubic-bezier(.45,0,.35,1)}` +
  `${pct(FIGURE_MS.slouch)}%{transform:rotate(16deg)}${pct(FIGURE_MS.slouch + FIGURE_MS.hold)}%{transform:rotate(16deg);animation-timing-function:cubic-bezier(.45,0,.35,1)}100%{transform:rotate(0)}}` +
  `@media (prefers-reduced-motion:reduce){.pf-torso,.pf-head{animation:none}}`;

/** How long the animation takes before the button may be pressed (the button shows at the end). */
export const FIGURE_TOTAL_MS = TOTAL;

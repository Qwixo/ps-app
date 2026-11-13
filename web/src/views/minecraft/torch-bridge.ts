// Minecraft mode, the torch: the bridge to PS (ps-mac Sources/Torch.swift).
//   page -> shell: {type:"torch:open", color:"#rrggbb", bright}   openTorch(): on, or a new colour while on
//                  {type:"torch:close"}                           closeTorch()
//                  {type:"torch:state", bright?}                   askTorch(): the state now (and keeps the setting)
//   shell -> page: window.__psTorch({open, color, bright, canBright, refused?})
//                  the answer, and again on every change (Esc, sleep, 1Password or Signal in front)
// Installs itself on import (like power-bridge.ts), so ps.ts needs no line for it. Works with no network:
// nothing here is fetched or stored online.
// Outside PS (the website, the phone) the same calls light the page itself: a full screen layer of the
// colour, keeping the screen awake where the browser allows. Only Esc turns it off (the developer, 4 Nov 2026: a
// bumped trackpad or key must never turn it off in the dark); on a touch screen with no keyboard, a
// double tap does, and leaving full screen (the system back gesture) too. A faint "Press Esc to turn
// off" shows at the bottom for 2 s.
import { useSyncExternalStore } from "react";
import { PS, psPost } from "../../ps";
import { cleanColor, cleanTorchState, EMPTY_TORCH, hintInk, TORCH_HINT, type TorchState } from "./torch-logic";

export type { TorchState } from "./torch-logic";

let cur: TorchState = EMPTY_TORCH;
const subs = new Set<() => void>();
function set(s: TorchState) { cur = s; subs.forEach((f) => f()); }

if (PS && typeof window !== "undefined") {
  (window as Window & { __psTorch?: (m: unknown) => void }).__psTorch = (m) => set(cleanTorchState(m));
}

export function useTorch(): TorchState {
  return useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => cur);
}

/** On in this colour (or the new colour while on). `bright`: full brightness while on (PS only). */
export function openTorch(color: string, bright: boolean) {
  const c = cleanColor(color) ?? "#ffffff";
  if (PS) { psPost({ type: "torch:open", color: c, bright }); return; }
  webOpen(c);
}
export function closeTorch() {
  if (PS) { psPost({ type: "torch:close" }); return; }
  webClose();
}
/** Ask PS for the state (the panel does this when it mounts); `bright` also saves the setting there. */
export function askTorch(bright?: boolean) {
  if (PS) psPost(bright === undefined ? { type: "torch:state" } : { type: "torch:state", bright });
}

// ---------- outside PS: the page lights itself ----------

let layer: HTMLDivElement | null = null;
let lock: { release(): Promise<void> } | null = null;
let openedAt = 0;
let lastTap = 0;
const GRACE = 350;


function webOpen(color: string) {
  if (typeof document === "undefined") return;
  if (layer) {
    layer.style.background = color;
    const h = layer.querySelector<HTMLElement>(".torch-web-hint");
    if (h) h.style.color = hintInk(color);
    set({ ...cur, open: true, color });
    return;
  }
  const d = document.createElement("div");
  d.className = "torch-web";
  d.setAttribute("role", "button");
  d.setAttribute("aria-label", "Torch on. Press Esc to turn it off.");
  d.tabIndex = 0;
  d.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:${color};cursor:none;opacity:0;transition:opacity .32s ease-out;touch-action:none`;
  const hint = document.createElement("div");
  hint.className = "torch-web-hint";
  hint.textContent = TORCH_HINT;
  hint.style.cssText = `position:absolute;left:0;right:0;bottom:44px;text-align:center;font:500 15px system-ui,sans-serif;color:${hintInk(color)};transition:opacity .6s;pointer-events:none`;
  d.appendChild(hint);
  setTimeout(() => { hint.style.opacity = "0"; }, 2000);
  document.body.appendChild(d);
  layer = d;
  openedAt = Date.now();
  requestAnimationFrame(() => { if (layer === d) d.style.opacity = "1"; });
  d.focus();
  try { void d.requestFullscreen?.().catch(() => {}); } catch { /* not allowed here: the fixed layer still covers the page */ }
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
    void wl?.request("screen").then((l) => { if (layer === d) lock = l; else void l.release(); }).catch(() => {});
  } catch { /* no wake lock: the screen may dim on its own */ }
  window.addEventListener("keydown", onInput, true);
  window.addEventListener("pointerdown", onInput, true);
  document.addEventListener("fullscreenchange", onFs);
  set({ ...cur, open: true, color, refused: null });
}
function onInput(e: Event) {
  if (!layer) return;
  e.preventDefault(); e.stopPropagation();       // nothing reaches the page behind
  if (e.type === "keydown") { if ((e as KeyboardEvent).key === "Escape") webClose(); return; }
  // Touch only (a phone with no Esc key): a double tap. A mouse click never turns it off.
  if ((e as PointerEvent).pointerType !== "touch" || Date.now() - openedAt < GRACE) return;
  const now = Date.now();
  if (now - lastTap < 400) webClose(); else lastTap = now;
}
function onFs() { if (layer && !document.fullscreenElement && Date.now() - openedAt > GRACE) webClose(); }
function webClose() {
  const d = layer;
  if (!d) return;
  layer = null;
  window.removeEventListener("keydown", onInput, true);
  window.removeEventListener("pointerdown", onInput, true);
  document.removeEventListener("fullscreenchange", onFs);
  try { if (document.fullscreenElement === d) void document.exitFullscreen().catch(() => {}); } catch { /* ignore */ }
  try { void lock?.release(); } catch { /* ignore */ }
  lock = null;
  d.style.transition = "opacity .26s ease-in";
  d.style.opacity = "0";
  setTimeout(() => d.remove(), 280);   // gone from the page, never left behind invisible
  set({ ...cur, open: false });
}

export const torchBridge = {
  /** Previews and tests only: show a state without the shell. */
  _set: (raw: unknown) => set(cleanTorchState(raw)),
  get: () => cur,
};

// PS GOS keyboard. The page is never resized for the on-screen keyboard (resizing relaid out the
// whole Tab list and made it jump). The shell sends the keyboard's height every frame of its slide
// (--gos-kb) and once it has settled (--gos-kb-end); sheets rise with it in CSS, and a field the
// keyboard would cover is scrolled into view inside its own scroll box only.
import { gosPost, haptic, onShell } from "./bridge";

let kb = 0;
export function keyboardHeight() { return kb; }

function scrollBox(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/** Bring the focused field above the keyboard, moving only its nearest scroll box (never the page). */
function reveal() {
  const el = document.activeElement as HTMLElement | null;
  if (!kb || !el || !el.matches("input, textarea, [contenteditable='true']")) return;
  const r = el.getBoundingClientRect(), limit = innerHeight - kb - 16;
  if (r.bottom <= limit && r.top >= 0) return;
  const box = scrollBox(el);
  if (box) box.scrollBy({ top: r.bottom - limit, behavior: "smooth" });
  else window.scrollBy({ top: r.bottom - limit, behavior: "smooth" });
}

let started = false;
export function startKeyboard() {
  if (started) return;
  started = true;
  const root = document.documentElement.style;
  onShell((m) => {
    if (m.type !== "kb") return;
    kb = Math.max(0, Number(m.h) || 0);
    // V1.47: every frame of the slide, only the Add task sheet (the one user of --gos-kb) gets the new height. On
    // the page root it restyled the whole page 60 times a second while the keyboard moved. The root gets it once
    // the keyboard has settled, for a sheet that opens later.
    document.querySelectorAll<HTMLElement>(".tm-add-layer").forEach((el) => el.style.setProperty("--gos-kb", `${kb}px`));
    if (m.settled) { root.setProperty("--gos-kb", `${kb}px`); root.setProperty("--gos-kb-end", `${kb}px`); document.documentElement.classList.toggle("gos-kb-up", kb > 0); requestAnimationFrame(reveal); }
  });
  document.addEventListener("focusin", (e) => {
    if (kb) requestAnimationFrame(reveal);
    // Add task opened from the home screen widget or the notification's Add task: the field is focused with no tap
    // on the page, and GrapheneOS raises no keyboard for that. If none is on its way shortly after, ask the shell
    // (ps-gos MainActivity.showKeyboard; an older shell ignores the message).
    const t = e.target as Element | null;
    if (t?.matches?.(".tm-add-title")) window.setTimeout(() => { if (!kb && document.activeElement === t) gosPost({ type: "kb:show" }); }, 180);
  });
  // Adding a task: Enter (or the Add button) gives a short tick; an empty title a reject buzz. A held Enter adds once.
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLInputElement | null;
    if (e.key === "Enter" && !e.repeat && !e.shiftKey && t?.matches?.(".tm-add-title")) haptic(t.value.trim() ? "tick" : "reject");
  }, true);
  window.addEventListener("click", (e) => {
    const t = e.target as Element | null;
    if (!t?.closest?.(".tm-add-go")) return;
    const v = (document.querySelector(".tm-add-title") as HTMLInputElement | null)?.value.trim();
    haptic(v ? "tick" : "reject");
  }, true);
}

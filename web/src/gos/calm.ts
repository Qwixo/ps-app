// PS GOS: no frames for animations nobody can see (the 1 Nov 2026 freeze, "PS isn't responding" on
// the Inbox pane with Screen time open).
//
// The WebView draws on PS's own render thread, and Android's main thread waits for it on every
// frame. The pulses, glows and sheens that loop forever (Coming up, meeting notes, New tasks, Be
// aware...) made the page draw a new frame 60 times a second even with nothing moving on screen:
// in the panes slid off to the side and under the Screen time sheet too. On the emulator that kept
// the main thread busy 100% of the time; on the phone, with apps being installed in the background
// and 650 MB in use, one frame took over 5 seconds and Android gave up on a tap.
//
// So: every endless CSS animation whose element is not on screen (another pane, scrolled away, or
// under a sheet, pop-up or window) is paused, and plays again the moment it can be seen. The ones on
// screen play while the developer is using the phone and rest once it has been left alone for REST_MS (a phone
// left open on the New tasks pop-up kept repainting its moving stripe forever); the next touch wakes
// them. Animations that end by themselves (a card sliding in) are never touched. The Mac and the
// website never run this.
const COVERS = [
  ".tm-tr .hover-pop.open", ".gos-sheet-wrap.open", ".gos-menu.open", ".dx-layer", ".nu-layer", ".cs-layer", ".ms-layer",
  ".tm-add-layer", ".nt-pop", ".bf-layer", ".tm-pop-wrap.open", ".fit-pop-layer",
].join(", ");
const REST_MS = 12_000;
// Progress that must keep moving while nobody touches the phone (an update downloading).
const NEVER_REST = ".gos-upd-orb, .gos-upd-bar i";
const paused = new WeakSet<Animation>();
let touchedAt = Date.now();

function onScreen(el: Element, cover: Element | null) {
  if (document.visibilityState !== "visible") return false;
  if (cover && !cover.contains(el)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
}

/** One pass over the running and paused endless animations. Cheap: a handful of animations, one layout read each. */
export function calmPass() {
  const covers = document.querySelectorAll(COVERS);
  const cover = covers.length ? covers[covers.length - 1] : null;   // the top one: later in the page draws on top
  const resting = Date.now() - touchedAt > REST_MS;
  // V1.47: the page's own copy of the app under the phone layer (#root, hidden by gos.css while .gos-home is up) is
  // never on screen. Measuring an element in it made the browser restyle and lay out that whole hidden copy (about
  // 420 elements) on every pass, so its loops are simply paused without a look.
  const hidden = document.querySelector(".gos-home") ? document.getElementById("root") : null;
  for (const a of document.getAnimations()) {
    const fx = a.effect as KeyframeEffect | null;
    if (!fx?.target || fx.getTiming().iterations !== Infinity) continue;
    const t = fx.target instanceof Element ? fx.target : null;
    if (!t) continue;
    const show = !hidden?.contains(t) && (!resting || t.matches(NEVER_REST)) && onScreen(t, cover);
    if (show && paused.has(a)) { paused.delete(a); a.play(); }
    else if (!show && a.playState === "running") { paused.add(a); a.pause(); }
  }
}

let started = false;
export function startCalm() {
  if (started) return;
  started = true;
  let t = 0;
  const soon = () => { window.clearTimeout(t); t = window.setTimeout(calmPass, 120); };
  const touched = () => { touchedAt = Date.now(); soon(); };
  // A touch, a pane change, a sheet or pop-up opening or closing, a scroll that settles, the app coming back.
  addEventListener("pointerdown", touched, { capture: true, passive: true });
  addEventListener("keydown", touched, { capture: true, passive: true });
  addEventListener("scroll", touched, { capture: true, passive: true });
  addEventListener("click", soon, { capture: true, passive: true });
  addEventListener("transitionend", soon, { capture: true, passive: true });
  addEventListener("animationstart", soon, { capture: true, passive: true });
  document.addEventListener("visibilitychange", touched);
  // New elements with an endless animation show up without any of the above (a meeting starts).
  window.setInterval(calmPass, 1500);
  soon();
}

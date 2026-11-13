// The mobile web app: the on-screen keyboard's height, from the browser's visual viewport, fed to the same
// handler PS GOS uses (src/gos/keyboard.ts gets it from its shell), so sheets rise with the keyboard there too.
import { shellSays } from "../gos/bridge";

export function startWebKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  let last = -1, t = 0;
  const read = () => {
    const h = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    const kb = h > 80 ? h : 0;   // a browser bar sliding in or out is not a keyboard
    if (kb === last) return;
    last = kb;
    shellSays({ type: "kb", h: kb, settled: false });
    window.clearTimeout(t);
    t = window.setTimeout(() => shellSays({ type: "kb", h: kb, settled: true }), 160);
  };
  vv.addEventListener("resize", read);
  vv.addEventListener("scroll", read);
}

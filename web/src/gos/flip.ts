// Glide instead of snap (V1.56, the developer: "it basically can just automatically understand where I left off with my macOS
// ... All seamlessly with fancy animations"). When the phone layout changes (on the Mac, or on this phone), the navbar's
// buttons slide from where they were to where they are now, a new one pops in, and nothing jumps. FLIP: remember each
// child's place after every draw, and when they move, play the difference back to zero.
import { useLayoutEffect, useRef, type RefObject } from "react";

export function useFlip(ref: RefObject<HTMLElement | null>, key: string, sel = "[data-flip]") {
  const last = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const now = new Map<string, DOMRect>();
    for (const el of root.querySelectorAll<HTMLElement>(sel)) {
      const id = el.dataset.flip!;
      const r = el.getBoundingClientRect();
      now.set(id, r);
      const was = last.current.get(id);
      if (reduce || !el.animate || !last.current.size) continue;
      if (!was) { el.animate([{ transform: "scale(.6)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: "cubic-bezier(.34, 1.36, .5, 1)" }); continue; }
      const dx = was.left - r.left, dy = was.top - r.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 480, easing: "cubic-bezier(.22, 1, .36, 1)" });
    }
    last.current = now;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

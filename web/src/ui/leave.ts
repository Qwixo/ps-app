// A pop-up that leaves softly (PS 1.65 quality pass): keeps the last open value on screen for a short fade after it closed, the same
// way the Mac's cards fade out (Sources/Posture.swift, Reminders.swift), instead of vanishing in one frame. Reduced motion: gone at once.
import { useEffect, useState } from "react";

/** The value to draw, and whether it is on its way out. `value` null means closed. */
export function useLeave<T>(value: T | null, ms = 180): { shown: T | null; out: boolean } {
  const [last, setLast] = useState<T | null>(value);
  const [out, setOut] = useState(false);
  useEffect(() => {
    if (value !== null) { setLast(value); setOut(false); return; }
    if (last === null) return;
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) { setLast(null); return; }
    setOut(true);
    const t = window.setTimeout(() => { setLast(null); setOut(false); }, ms);
    return () => window.clearTimeout(t);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return { shown: value ?? last, out: value === null && last !== null };
}

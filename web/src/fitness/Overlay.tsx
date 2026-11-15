// PS Fitness: a panel that slides up over the screen (and back down). Escape and the phone's Back close it. Moved out of Gym.tsx in V1.60
// so the Scan sheet can open from any exercise search (Scan.tsx ScanSearch).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { picCardOpen } from "./ExPic";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------- a panel that slides up over the screen (and back down) ----------
export function Overlay({ label, kind, onClose, children }: { label: string; kind?: string; onClose: () => void; children: (close: () => void) => ReactNode }) {
  const [out, setOut] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const gone = useRef(false);
  const close = () => { if (gone.current) return; gone.current = true; setOut(true); window.setTimeout(() => closeRef.current(), 240); };
  const closeFn = useRef(close);
  closeFn.current = close;
  useEffect(() => {
    // The phone's back button and Escape close the panel first (capture: before the sheets' own handling).
    const back = (e: Event) => { if (picCardOpen()) return; e.preventDefault(); e.stopImmediatePropagation(); closeFn.current(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); closeFn.current(); } };
    window.addEventListener("gos-back", back, true);
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("gos-back", back, true); window.removeEventListener("keydown", key); };
  }, []);
  return (
    <div className={cx("fg-ov", out && "out", kind && `fg-ov-${kind}`)} role="dialog" aria-modal="true" aria-label={label}>
      <div className="fg-ov-bg" onClick={close} />
      <div className="fg-sheet">{children(close)}</div>
    </div>
  );
}


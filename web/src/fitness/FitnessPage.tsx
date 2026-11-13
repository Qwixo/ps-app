// PS Fitness on the website (#/fitness) and in PS's main window: the side by side layout on a wide
// screen, the phone layout on a narrow one (the website on a phone).
import { useEffect, useSyncExternalStore } from "react";
import { useVault } from "../ui/kit";
import { FitnessApp } from "./FitnessApp";

const WIDE = "(min-width: 760px)";
const wide = () => typeof matchMedia === "function" && matchMedia(WIDE).matches;
const sub = (f: () => void) => { const m = matchMedia(WIDE); m.addEventListener("change", f); return () => m.removeEventListener("change", f); };

export function FitnessPage({ onBack }: { onBack?: () => void }) {
  const desk = useSyncExternalStore(sub, wide, () => true);
  return <div className={`fit-page${desk ? " wide" : ""}`}><FitnessApp desk={desk} onBack={onBack} /></div>;
}

/** PS self test only (ps://app/client/fitview): the Fitness screens over the fictional data the test hands in
 *  (window.__psOverlay.load, no keys, nothing saved). ?tab= picks the screen, the test's own page size the layout. */
export function FitnessTestView() {
  const s = useVault();
  useEffect(() => { document.documentElement.classList.add("fit-test"); }, []);
  if (s.status !== "unlocked") return <div className="fit-test-wait">Waiting for test data</div>;
  return <FitnessPage />;
}

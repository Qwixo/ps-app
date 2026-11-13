// Open Fitness on one of its tabs from outside it (V1.43: Settings' search finds Fitness settings and opens them).
// The Tab list's and the website's Fitness screens (FitnessButton.tsx) listen for "ps-fitness-open"; the phone opens its
// pop up (pop.ts). FitnessApp starts on the asked tab, or switches to it while it is open.
import { fitPop } from "./pop";

export type FitAskTab = "gym" | "plan" | "history" | "sleep" | "squad" | "settings";
let wanted: FitAskTab | null = null;
const subs = new Set<(t: FitAskTab) => void>();

/** Opens Fitness on `tab`. `docked`: the website's To-do page (its own Fitness button), else the Tab list. */
export function askFitness(tab: FitAskTab, o: { docked?: boolean; phone?: boolean } = {}) {
  wanted = tab;
  subs.forEach((f) => f(tab));
  if (o.phone) fitPop.open();
  else window.dispatchEvent(new CustomEvent("ps-fitness-open", { detail: { docked: !!o.docked } }));
}
/** The tab asked for, once (FitnessApp's first tab). */
export function takeFitTab(): FitAskTab | null { const t = wanted; wanted = null; return t; }
/** While Fitness is open: switch when asked again. */
export function onFitAsk(f: (t: FitAskTab) => void) { subs.add(f); return () => { subs.delete(f); }; }

// G Squad window (V1.43), the developer 8 Nov 2026: "I want a Fitness tab within the G Squad button in the Tab overlay".
// The Fitness section IS Fitness's own squad screen (fitness/Squad.tsx SquadScreen): the gym boards, the squad's
// personal bests with reactions and comments, challenges and the per exercise compare. Nothing is copied: the same
// component, the same plain view (squad/gymclient.ts, no keys here) and the same ops. Wrapped in Fitness's root class
// so its tokens (--f-*) come from the current PS look, with smaller targets for a mouse (views/gswin.css .gsf).
import { useFitness } from "../fitness/store";
import { SquadScreen } from "../fitness/Squad";
import { registerSquadTab, TAB_ORDER } from "../squad/tabs";
import "../fitness/fitness.css";

function FitnessSection() {
  const fit = useFitness();
  return <div className="fit fit-desk gsf"><SquadScreen v={fit} desk /></div>;
}
registerSquadTab({ id: "fitness", title: "Fitness", order: TAB_ORDER.fitness, Panel: FitnessSection });

// The setup menu's last step (V1.62, the developer 15 Nov 2026): "when you go through the setup process, right at the very end, it's a
// requirement before you get to use the app to pick a colour background and also click on a rain effect as well, just to
// customize it a bit", then: "obviously there's an option to click on more as well so you can see other backgrounds and other
// effects, but I just want it to be a requirement to pick a colour or another effect. Just click a background colour that isn't
// just blank basically."
//
// Pure rules, no DOM (tests/setuplooks.test.ts): the words, and when Done may be pressed. The step is views/SetupLooks.tsx, shown
// by views/Welcome.tsx after Create, only inside the setup menu (a new account, or anyone who opens it after an update or from
// Settings). It never opens by itself for someone who finished setup before. The picks are the same settings Settings, Looks
// uses (tmBg, or the phone's own background; tmRain; tmTrail), saved and synced the moment they are clicked.

import { bgDesign } from "./prio.ts";
import { rainKind } from "./rain.ts";
import { trailKind } from "./trail.ts";

/** The developer's approved words (15 Nov 2026). */
export const SETUP_LOOKS_WORDS = {
  title: "Make PS yours",
  line: "Pick a background colour and a rain effect. You can change both any time in Settings, Looks.",
  bg: "Background colour",
  fx: "Rain effect",
  more: "More",
  done: "Done",
} as const;

/** A background that is not the plain blank one: a colour, your own colour, a scene, lightning or a video. "None" is not. */
export function bgPicked(shown: string | null | undefined): boolean {
  return bgDesign(shown) !== "none";
}

/** At least one effect switched on: a rain style, or another effect from More (a mouse trail). "No rain" alone does not count,
 *  and nor do the mouse trail's Off and Glow (Glow is the soft light every list has until something else is picked). */
export function effectPicked(st: { tmRain?: unknown; tmTrail?: unknown }): boolean {
  if (rainKind(st.tmRain) !== "off") return true;
  const t = trailKind(st.tmTrail);
  return t !== "off" && t !== "glow";
}

/** Done can be pressed only when both are met. */
export function setupLooksDone(o: { bg: string | null | undefined; st: { tmRain?: unknown; tmTrail?: unknown } }): boolean {
  return bgPicked(o.bg) && effectPicked(o.st);
}

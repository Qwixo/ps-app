// G Squad on the phone (V1.47), the developer 10 Nov 2026: "It isn't in the GOS app; put it in the hamburger menu." PS GOS and
// the iPhone web app hold the vault in this very page, so G Squad runs here and the screens read it directly (like the
// website, squad/webhost.ts). PS GOS already starts the core and Fitness when it opens (gos/bridge.ts); this adds the
// Leaderboard and the chat, and on the iPhone web app starts all of it. Each start runs once; a second call does nothing.
// Egress is the engine's own: a working beat every 3 minutes only while you are in a squad, pulls only while the
// G Squad screen is open (squad/engine.ts).
import { startSquad } from "./engine";
import { startSquadBoard } from "./board";
import { startChat } from "./chatengine";
import { startGymSquad } from "./gym";

/** PS GOS or the iPhone web app (both draw the phone home, gos/GosLayer.tsx). */
export function isPhoneBuild(): boolean {
  const mode = import.meta.env.MODE;
  return mode === "gos" || (mode !== "ps" && (globalThis as { __psMobile?: unknown }).__psMobile === true);
}
let started = false;
export function startPhoneSquad() {
  if (started || !isPhoneBuild()) return;
  started = true;
  startSquad();
  startSquadBoard();
  startChat(null);
  startGymSquad();
}

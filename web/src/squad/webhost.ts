// G Squad on the website (V1.44): the To-do page in web form (views/WebTodo.tsx) has the G Squad button and window
// like PS's Tab list. On a Mac the engine runs on PS's main page and the Tab list gets a copy; on the website there is
// one page, so the engine runs here and the screens read it directly (squad/mirror.ts, squad/chatmirror.ts,
// squad/gymclient.ts). The same engine the phone app runs: the hub only ever holds sealed data, and every pull is the
// small one described in squad/engine.ts. Started once, when the To-do page first shows, never on the Mac or phone
// builds (they start their own).
import { startSquad } from "./engine";
import { startSquadBoard } from "./board";
import { startChat } from "./chatengine";
import { startGymSquad } from "./gym";
import { webSquadAllowed } from "../core/webtodo";

let started = false;
export function startWebSquad(mobileWeb: boolean) {
  if (started || !webSquadAllowed({ mode: import.meta.env.MODE, mobileWeb })) return;
  started = true;
  startSquad();
  startSquadBoard();
  startChat(null);
  startGymSquad();
}

// G Squad pieces (PS 1.65): one "chat open" for every screen that shows the chat. The window and each chat piece call hold() while
// on screen; the main page hears open once when the first screen appears and close only when the last one is gone
// (core/squadpieces.ts openCounter), so closing one piece never stops the chat under the window or another piece.
import { openCounter } from "../core/squadpieces";
import { chatOp } from "./chatmirror";

const counter = openCounter((on) => chatOp({ op: "open", on }));
/** Say "the chat is on screen"; returns the function that says it is not any more (use it as a useEffect cleanup). */
export function holdChatOpen(): () => void {
  counter.add();
  let done = false;
  return () => { if (!done) { done = true; counter.drop(); } };
}
/** How many screens hold the chat open right now (a conversation click uses it: with a chat piece on a page it only switches). */
export const chatHolders = (): number => counter.n();

let pieces = 0;
/** A chat PIECE is on a page (not the window): the conversation list then only switches the conversation, it does not open the window. */
export function holdChatPiece(): () => void {
  pieces += 1;
  const release = holdChatOpen();
  let done = false;
  return () => { if (!done) { done = true; pieces -= 1; release(); } };
}
export const chatPiecesShown = (): boolean => pieces > 0;

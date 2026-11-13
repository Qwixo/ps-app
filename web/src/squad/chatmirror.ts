// G Squad chat (V1.40) for screens. In PS's Tab list: the plain view the main page sent (no keys here) and the one
// way back (a `sqChatOp` through PS's looks patch). On the website: the engine runs in this very page, so the screen
// reads it and calls it directly.
import { useSyncExternalStore } from "react";
import { cleanChatView, EMPTY_CHAT, type ChatOp, type ChatView } from "./chatview";
import { chatStore, runChatOp } from "./chatengine";

const PS = import.meta.env.MODE === "ps";
let mirror: ChatView = EMPTY_CHAT;
let mirrorJson = "";
const subs = new Set<() => void>();
const sub = (l: () => void) => { subs.add(l); return () => { subs.delete(l); }; };

/** From the state PS hands the Tab list (null while locked). */
export function setChatMirror(v: unknown) {
  const next = v ? cleanChatView(v) : EMPTY_CHAT;
  const json = JSON.stringify(next);
  if (json === mirrorJson) return;
  mirror = next; mirrorJson = json;
  subs.forEach((l) => l());
}
export function useChat(): ChatView {
  return useSyncExternalStore(PS ? sub : chatStore.subscribe, PS ? () => mirror : chatStore.get);
}
export function chatNow(): ChatView { return PS ? mirror : chatStore.get(); }

type W = Window & { webkit?: { messageHandlers?: { ps?: { postMessage(m: string): void } } } };
/** A button in the chat: in PS to the main page (which checks it again, squad/chatview.ts cleanChatOp, and runs it);
 *  on the website straight to the engine. */
export function chatOp(o: ChatOp) {
  if (!PS) { void runChatOp(o); return; }
  try { (window as W).webkit?.messageHandlers?.ps?.postMessage(JSON.stringify({ type: "looks", patch: { sqChatOp: o } })); } catch { /* not inside PS */ }
}

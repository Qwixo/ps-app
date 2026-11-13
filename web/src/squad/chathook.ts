// G Squad (V1.40): the call point between Fitness and the squad chat. The Fitness screens call messageAbout() from a
// "Message" button on someone's gym log. It goes to the chat's own hook, src/squad/chatopen.ts (built in the chat's
// branch, claude/gsquad-chat-4f45fc): chatCan("squad") says whether the button may show, openSquadChat opens the G Squad
// pop-up on its Chat tab with the draft and a "Gym log" chip, and nothing is sent until the person presses Send.
// Until that file is in this build (the two branches merge after gsquad-core) the Message button is not drawn, so
// nothing half works. The developer has not decided between the squad chat and a private message: mode "squad" for now.
// setChatOpener stays for the dev page and tests (a fictional opener).
import { useSyncExternalStore } from "react";

/** What the message is about, in the chat's ChatAbout shape: kind, label, whose (member id). */
export interface ChatAboutReq {
  to: string;                                    // the member the message is about (their member id)
  name: string;                                  // their name
  about: { k: "gym"; l: string; w: string };     // eg { k: "gym", l: "Incline bench press 45 kg x 8, 5 Nov", w: <member id> }
  draft: string;                                 // the starting words, eg "What are you doing?"
}
type ChatOpen = {
  chatCan(mode?: "squad" | "private"): boolean;
  openSquadChat(o: { mode?: "squad" | "private"; to?: string; about?: { kind: string; label: string; whose?: string }; draft?: string }): { ok: boolean };
};
// The chat's module when it is in this build, else nothing (Vite fills this in at build time; plain node has no glob).
let found: Record<string, ChatOpen> = {};
try { found = import.meta.glob<ChatOpen>("./chatopen.ts", { eager: true }); } catch { /* not built by Vite (node tests) */ }
const chat: ChatOpen | null = Object.values(found)[0] ?? null;

type Opener = (r: ChatAboutReq) => void;
let opener: Opener | null = null;
const subs = new Set<() => void>();
/** A stand in opener (the dev page's fictional one); the real chat needs none. */
export function setChatOpener(fn: Opener | null) { opener = fn; subs.forEach((l) => l()); }
export function chatOpenerReady(): boolean {
  if (opener) return true;
  try { return !!chat && chat.chatCan("squad"); } catch { return false; }
}
export function useChatOpener(): boolean {
  return useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, chatOpenerReady);
}
export function messageAbout(r: ChatAboutReq) {
  if (opener) { opener(r); return; }
  chat?.openSquadChat({ mode: "squad", to: r.to, about: { kind: "gym", label: r.about.l.slice(0, 140), whose: r.about.w }, draft: r.draft });
}
export const MESSAGE_DRAFT = "What are you doing?";

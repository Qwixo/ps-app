// G Squad chat (V1.40): THE HOOK for other parts of PS to open the chat with a message about something.
// The gym boards chat adds a "Message" button on someone's gym log ("What are you doing?"):
//
//   import { chatCan, openSquadChat } from "../squad/chatopen";
//   if (chatCan("squad")) openSquadChat({ about: { kind: "gym", label: "Incline bench press, 80 kg x 8", whose: memberId }, draft: "What are you doing? " });
//
// It opens the G Squad pop-up on its Chat tab (in PS), or the chat pop-up (website), with the draft in the box and a
// small "About" chip above it. The chip travels inside the sealed message (core/squadchat.ts ChatAbout), so the
// others see what it was about; the hub sees nothing of it. Nothing is sent until the person presses Send.
//
// Squad chat or private message: the developer has not decided. The hook takes both:
//   mode "squad"    (default) the squad chat, built now.
//   mode "private"  a message only `to` can read. NOT built yet: chatCan("private") is false and openSquadChat
//                   returns { ok: false, why: "private-not-built" }, so a caller shows its button only when it can.
//                   What it would take: a pair key from the two members' box keys (ECDH, no key handed round, no
//                   vote needed), a to_member column on chat_messages that the hub reads only for those two, and a
//                   thread list in the Chat tab. About 3 to 4 hours with tests.
import type { ChatAbout } from "../core/squadchat";
import { cleanAbout, cleanText } from "../core/squadchat";
import { chatNow } from "./chatmirror";

export type ChatMode = "squad" | "private";
export interface OpenChat { mode?: ChatMode; to?: string; about?: { kind: string; label: string; whose?: string }; draft?: string }
export type OpenChatResult = { ok: true } | { ok: false; why: "private-not-built" | "not-in-squad" };

/** Whether a "Message" button for this mode can work here. */
export function chatCan(mode: ChatMode = "squad"): boolean {
  return mode === "squad" && chatNow().in;
}

export interface Compose { n: number; about: ChatAbout | null; draft: string }
let compose: Compose = { n: 0, about: null, draft: "" };
const subs = new Set<() => void>();
export const composeStore = {
  subscribe(l: () => void) { subs.add(l); return () => { subs.delete(l); }; },
  get: () => compose,
};

export function openSquadChat(o: OpenChat = {}): OpenChatResult {
  if ((o.mode ?? "squad") === "private") return { ok: false, why: "private-not-built" };
  if (!chatNow().in) return { ok: false, why: "not-in-squad" };
  const about = o.about ? cleanAbout({ k: o.about.kind, l: o.about.label, w: o.about.whose }) ?? null : null;
  compose = { n: compose.n + 1, about, draft: cleanText(o.draft ?? "") };
  subs.forEach((l) => l());
  return { ok: true };
}

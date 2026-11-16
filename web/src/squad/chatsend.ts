// G Squad chat (PR 11): what one send is, checked in one place so every caller (the chat composer, and the pop up
// Reply that comes later) builds the same request. No screen code. views/GSquadComposer.tsx sends it.
import { MAX_TEXT, type ChatAbout, type ChatReply } from "../core/squadchat.ts";
import type { ChatOp } from "./chatview.ts";

/** The request for a send or an edit, or null when there is nothing to send (blank text). Text is trimmed and cut to the limit. */
export function buildSend(text: string, opts: { about?: ChatAbout | null; editId?: string | null; reply?: ChatReply | null } = {}): ChatOp | null {
  const t = text.trim().slice(0, MAX_TEXT);
  if (!t) return null;
  if (opts.editId) return { op: "edit", id: opts.editId, text: t };
  return { op: "send", text: t, ...(opts.about ? { a: opts.about } : {}), ...(opts.reply ? { q: opts.reply } : {}) };
}

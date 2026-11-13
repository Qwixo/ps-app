// AI chat finished cards from this Mac (V1.53, the developer 12 Nov 2026: friends get the "Claude finished" card too, and
// other AI tools). PS on the Mac (ps-mac Sources/AiDone.swift) hears a chat finish through the small hook it put into
// Claude Code, Codex, Gemini CLI or Cursor, and hands it here as {type:"aiDone", items:[{key, tool, id, chat, at}]}.
// This page keeps each one in settings.chatDone exactly like a chatDone package from the developer's own hook (core/chatdone.ts),
// so the card shows in the Mac's stack and reaches the phone with the rest of the (encrypted) settings. No server
// ever sees it. Only while the vault is open: otherwise nothing is taken and PS on the Mac keeps the items until it
// is. Taken items go back as {type:"aiDone:taken", keys}, and the Mac deletes them.
import { psPost } from "./ps";
import { vaultStore } from "./core/vault";
import { settingsData } from "./core/select";
import { saveSettings } from "./core/actions";
import { addChatDone, aiDoneItems } from "./core/chatdone";

let busy = Promise.resolve();
/** From PS on the Mac. True when the message was this one. */
export function aiDoneMessage(m: { type?: string; items?: unknown }): boolean {
  if (m.type !== "aiDone") return false;
  const { keys, done } = aiDoneItems(m.items);
  busy = busy.then(async () => {
    const s = vaultStore.get();
    if (s.status !== "unlocked" || s.role !== "owner") return;   // kept on the Mac until the vault is open
    if (done.length) {
      const cur = settingsData(s);
      let list = cur.chatDone;
      for (const d of done) list = addChatDone(list, d, Date.now(), cur.dnd);
      await saveSettings({ chatDone: list });
    }
    if (keys.length) psPost({ type: "aiDone:taken", keys });
  }).catch(() => psPost({ type: "log", text: "ai done: a finished chat could not be saved, PS keeps it for later" }));
  return true;
}

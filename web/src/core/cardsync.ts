// A Dismiss never comes back (the developer, 3 Nov 2026: dismissed Instantly and chat cards kept returning on the Mac
// and the phone). Lead and chat Dismisses live in the ONE settings record and client email Dismisses on each
// reply record, and the vault used to send a device's whole copy as it was: the phone (or a background check,
// or an unsent change kept from before a restart) still holding the copy from before the Mac's Dismiss wrote it
// back over the server's, and the card returned on both devices. These mergers join the two copies instead
// (core/vault.ts setMerger: before an unsent change goes up, the server's newer copy is merged into it).
// Everything else in the settings stays as this device has it, the same as before.
import type { Settings } from "./model";
import { mergeLeadState } from "./leadcards.ts";
import { mergeChatDone } from "./chatdone.ts";
import { mergeAiMsgs } from "./aimessage.ts";
import { mergeMailRules } from "./mailrules.ts";
import { mergeMailReply } from "./mailreply.ts";
import { mergePicks } from "./devicebg.ts";

export function mergeSettings(local: Settings, remote: Settings): Settings {
  const out: Settings = { ...local };
  const lead = mergeLeadState(local.leadCards, remote.leadCards);
  if (lead) out.leadCards = lead;
  const chat = mergeChatDone(local.chatDone, remote.chatDone);
  if (chat) out.chatDone = chat;
  const msgs = mergeAiMsgs(local.aiMsgs, remote.aiMsgs);   // V1.58: messages from AIs, a Dismiss on either device holds
  if (msgs) out.aiMsgs = msgs;
  const rules = mergeMailRules(local.mailRules, remote.mailRules);   // Always notify me and Muted, entry by entry
  if (rules) out.mailRules = rules;
  const reply = mergeMailReply(local.mailReply, remote.mailReply);   // signatures and saved responses: the newer change
  if (reply) out.mailReply = reply;
  const picks = mergePicks(local.tmBgDev, remote.tmBgDev);   // a background for each device (PS 1.65): per device, the later pick wins
  if (picks) out.tmBgDev = picks;
  return out;
}

/** What one page run remembers of the cards the developer dismissed on it (src/mailcards.ts), so a Dismiss lost on the way
 *  (a race with the other device, a save that never left) is written again instead of the card coming back.
 *  A client email or a chat counts only for the email or the finish it was on; a lead card is one email. */
export type Dismissed = Map<string, { at: string; t: number }>;
export const DISMISS_HOLD_MS = 24 * 3600_000;

export function heldDismissed(d: Dismissed, id: string, at: string, now: number): boolean {
  const x = d.get(id);
  if (!x || now - x.t > DISMISS_HOLD_MS) return false;
  return id.startsWith("n:") || (!!x.at && x.at === at);
}

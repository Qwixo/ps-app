// Each client email notifies exactly once on every device (PS 1.60, item 6).
//
// Why the same email used to come back (found in the 1.59 code):
//  1. Two devices (the Mac and the website, say) opened the same sealed email before either one synced, and each made its
//     OWN reply record for the thread (random ids). Two records meant two cards with two ids: a Dismiss on one left the
//     other, and the phone and the Mac saw a "new" card id and chimed again.
//  2. A card's identity was the record id, never the email itself, so anything that changed the record (a rebuilt copy, a
//     restored vault) gave the same email a new identity.
//  3. The Mac chimed for every card it had not shown "in this run of the page", so a restart or a sign in chimed again.
// The fix, all here and pure so it is unit tested:
//  * the identity of an email is its Message-ID header (messageKey), the same on every device and every fetch;
//  * a thread's reply record gets ONE id worked out from account and thread (replyIdFor), so two devices write the same
//    record and the vault's reply merger joins them instead of making two;
//  * records already doubled are folded into one card (groupReplies), the later Dismiss and the later Remind win;
//  * every device keeps a small list of the emails it has already announced (the ledger), so a restart, a sign in or a
//    resent card never chimes twice. The phone's own NoteLedger keys on the card id and the card's rev, and the rev is
//    now the Message-ID, so it follows the same rule.

export { messageKey } from "./mail.ts";

/** One id for the reply record of a thread, worked out from the account and the thread id (a version 5 style UUID),
 *  so two devices that both see the thread first write the SAME record. */
export async function replyIdFor(account: string, threadId: string): Promise<string> {
  const data = new TextEncoder().encode(`ps-mail-reply|${account.toLowerCase()}|${threadId}`);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export { groupReplies, type ReplyGroup } from "./mailcards.ts";

// ---------- the per device ledger of announced emails ----------
export type Ledger = Record<string, number>;
export const LEDGER_MAX = 400;
export const LEDGER_KEEP_MS = 45 * 86_400_000;

/** Should this email (or this Remind coming due) chime and notify now? Fresh at most once per key. */
export function ledgerDecide(ledger: Ledger, key: string, now: number): { fresh: boolean; ledger: Ledger } {
  if (!key) return { fresh: false, ledger };
  if (Object.prototype.hasOwnProperty.call(ledger, key)) return { fresh: false, ledger };
  const next: Ledger = { ...ledger, [key]: now };
  return { fresh: true, ledger: pruneLedger(next, now) };
}
export function pruneLedger(l: Ledger, now: number): Ledger {
  const live = Object.entries(l).filter(([, at]) => at >= now - LEDGER_KEEP_MS).sort((a, b) => b[1] - a[1]).slice(0, LEDGER_MAX);
  return Object.fromEntries(live);
}
/** What a card announces: the email's key, plus when a "Remind me in" came due (a reminder announces once more). */
export const noteKey = (key: string, remindAt?: string | null) => (remindAt ? `${key}|${remindAt}` : key);
/** Read a saved ledger without trusting it. */
export function cleanLedger(v: unknown): Ledger {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Ledger = {};
  for (const [k, at] of Object.entries(v as Record<string, unknown>)) if (typeof at === "number" && isFinite(at) && k.length <= 260) out[k] = at;
  return out;
}

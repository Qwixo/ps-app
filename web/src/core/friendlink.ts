// Add friend (V1.44): the link inside the QR code, made and read here. Pure: no DOM, no network.
//
// Two kinds, both on the website's address so any phone camera opens PS in the browser:
//   join  https://cincee.com/client/#add=<invite id>.<secret>
//         Shown by the squad's admin: showing it IS the admin's yes. The secret is a one time G Squad invite
//         (squadcrypto.ts squadInviteMaterial): 32 random bytes the hub never sees; it keeps only sha256 of a token
//         made from them, plus the squad key wrapped under another key made from them. Used once, gone in 24 hours.
//   ask   https://cincee.com/client/#ask=<squad id>.<runs out, base 36 seconds>
//         Shown by anyone else in the listed squad (The G Squad): scanning it sends an Ask to join, and the admin
//         approves it as before (V1.42 directory). It carries no key at all: the squad id is already on the public
//         list, so the link gives nothing a stranger could not ask for anyway. Only the admin's Approve lets them in.
// Browsers never send the part after the # to any server, so the secret stays on the two phones.
// An old style invite (cincee.com/client/gsquad#<id>.<secret>) is read as a join link too.
import { b64url } from "./crypto.ts";
import { parseSquadInvite } from "./squadcrypto.ts";

/** How long a shown code works (the developer: 24 hours). */
export const FRIEND_TTL_MS = 24 * 60 * 60_000;
/** The website PS opens in (the web app). */
export const FRIEND_BASE = "https://cincee.com/client/";
/** "Get the Mac app" and "Get the phone app" (the Mac landing page and the phone web app). */
export const GET_MAC_URL = "https://cincee.com/ps-app-mac/";
export const GET_PHONE_URL = "https://cincee.com/todolist-mobile/";

export type FriendLink =
  | { kind: "join"; inviteId: string; secret: Uint8Array<ArrayBuffer> }
  | { kind: "ask"; squadId: string; expiresAt: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const base = (b: string) => (b.endsWith("/") ? b : `${b}/`);

export function friendJoinLink(inviteId: string, secret: Uint8Array, at = FRIEND_BASE): string {
  if (!UUID.test(inviteId) || secret.length !== 32) throw new Error("bad invite");
  return `${base(at)}#add=${inviteId.toLowerCase()}.${b64url(secret)}`;
}
export function friendAskLink(squadId: string, expiresAt: number, at = FRIEND_BASE): string {
  if (!UUID.test(squadId) || !Number.isFinite(expiresAt)) throw new Error("bad squad");
  return `${base(at)}#ask=${squadId.toLowerCase()}.${Math.floor(expiresAt / 1000).toString(36)}`;
}

/** Reads a link (the whole address, or just what follows the #). Anything else is null. */
export function parseFriendLink(text: string): FriendLink | null {
  const s = String(text || "").trim().slice(0, 600);
  const ask = /#ask=([0-9a-f-]{36})\.([0-9a-z]{1,10})$/i.exec(s) ?? /^ask=([0-9a-f-]{36})\.([0-9a-z]{1,10})$/i.exec(s);
  if (ask) {
    if (!UUID.test(ask[1])) return null;
    const sec = parseInt(ask[2], 36);
    return Number.isFinite(sec) && sec > 0 ? { kind: "ask", squadId: ask[1].toLowerCase(), expiresAt: sec * 1000 } : null;
  }
  const inv = parseSquadInvite(s);
  return inv ? { kind: "join", inviteId: inv.inviteId, secret: inv.secret } : null;
}
/** An ask link that ran out (a join link's time is kept by the hub, which refuses it after 24 hours). */
export const friendExpired = (l: FriendLink, now = Date.now()) => l.kind === "ask" && l.expiresAt <= now;
/** Only the part after the #, for the address bar to drop (the key should not sit in the history). */
export const isFriendHash = (hash: string) => /^#(add|ask)=/.test(hash) || (/^#[0-9a-f]{8}-/i.test(hash) && !!parseSquadInvite(hash));

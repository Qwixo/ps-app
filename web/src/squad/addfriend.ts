// Add friend (V1.44, the developer: "on the mobile app, in Settings, an Add friend tab; click it and a QR comes up. The QR
// sends them to the website to get the app, but also automatically adds them into the G Squad").
//
// THE ENTRY POINT for every page that can hold a scanned link (the website, the web app, the local first start):
//
//   import { takeFriendLink, acceptFriendLink } from "../squad/engine";
//   const link = takeFriendLink();               // read once at load: the link after the # (the address bar drops it)
//   const r = await acceptFriendLink(name);      // once the vault is open as owner: joins, or asks to join
//   r.state: "in" | "asked" | "already" | "expired" | "none" | "error" (r.message says it in plain words)
//
// The steps live here with no vault and no screen, so the unit tests run them against a fake hub and the live
// check against the real one. Which kind of code (core/friendlink.ts):
//   V1.57 invite only: every member's code is a one time invite (showing it is that member's yes), so scanning it
//   joins at once. An ask code (made by PS V1.49 to V1.56 for anyone but the admin) still works as an Ask to join:
//   PS joins by itself, waits, and the admin lets them in (squad/direngine.ts).
// Every code is made fresh each time the Add friend page opens, works once, and runs out in 24 hours.
import * as S from "../core/squadcrypto.ts";
import { b64url } from "../core/crypto.ts";
import { currentKey, type SquadRec } from "../core/squadrec.ts";
import { FRIEND_BASE, FRIEND_TTL_MS, friendAskLink, friendExpired, friendJoinLink, parseFriendLink, type FriendLink } from "../core/friendlink.ts";
import { apiFor } from "./flows.ts";

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export interface FriendCode { kind: "join" | "ask"; url: string; expiresAt: string; /** join only: the hub's id, to call it off */ inviteId?: string }
export type FriendCodeResult = FriendCode | { kind: "none"; why: "private" | "no-squad" };

/** The code to show. `admin`: you are the squad's admin (created_by on the hub). `listed`: your squad is on the list. */
export async function makeFriendCode(rec: SquadRec | null, o: { admin: boolean; listed: boolean; base?: string; now?: number; fetcher?: Fetcher }): Promise<FriendCodeResult> {
  if (!rec) return { kind: "none", why: "no-squad" };
  const now = o.now ?? Date.now(), exp = now + FRIEND_TTL_MS;
  if (o.admin) {
    const secret = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const id = S.newUuid(), key = currentKey(rec);
    const m = await S.squadInviteMaterial(secret);
    const wrapped = await S.wrapForInvite(m.wrap, key.raw, S.sqAad.invite(rec.squadId, id, key.gen));
    await apiFor(rec, o.fetcher).invite({ id, hash: m.tokenHash, wrapped, gen: key.gen, days: 1 });   // the hub: one time, 24 hours
    return { kind: "join", url: friendJoinLink(id, secret, o.base ?? FRIEND_BASE), expiresAt: new Date(exp).toISOString(), inviteId: id };
  }
  if (o.listed) return { kind: "ask", url: friendAskLink(rec.squadId, exp, o.base ?? FRIEND_BASE), expiresAt: new Date(exp).toISOString() };
  return { kind: "none", why: "private" };
}

/** The code closed: a join invite nobody used is deleted on the hub at once (a used one is already spent). Best
 *  effort: if this fails, the hub still refuses it after 24 hours. */
export async function callOffFriendCode(rec: SquadRec | null, code: FriendCodeResult | null, fetcher?: Fetcher): Promise<void> {
  if (!rec || !code || code.kind !== "join" || !code.inviteId) return;
  try { await apiFor(rec, fetcher).uninvite(code.inviteId); } catch { /* runs out by itself */ }
}

export type FriendResult =
  | { state: "in"; squad: string }        // joined (a join code)
  | { state: "asked"; squad: string }     // the request waits for the admin (an ask code)
  | { state: "already" }                  // this PS is in a squad already: nothing changed
  | { state: "expired" }                  // an ask code past its 24 hours
  | { state: "none" }                     // no link, or not one of ours
  | { state: "error"; message: string };

/** What accepting needs from the page that holds the vault (squad/engine.ts gives the real ones, tests give fakes). */
export interface FriendDeps {
  inSquad(): boolean;
  /** Joins with a one time invite and saves your squad record. Throws HubError 403 "invite" if it is used, gone or wrong. */
  join(link: string, me: string): Promise<string>;
  /** Asks to join the listed squad with this id. Returns the squad name, or null if it is not on the list. */
  ask(squadId: string, me: string): Promise<string | null>;
  say(e: unknown): string;
  now?: () => number;
}
/** Accepts a scanned link (already read by parseFriendLink). Never joins twice, never asks when you are in a squad. */
export async function acceptFriend(link: FriendLink | null, me: string, d: FriendDeps): Promise<FriendResult> {
  if (!link) return { state: "none" };
  if (d.inSquad()) return { state: "already" };
  if (friendExpired(link, d.now?.() ?? Date.now())) return { state: "expired" };
  try {
    if (link.kind === "join") return { state: "in", squad: await d.join(`${link.inviteId}.${b64url(link.secret)}`, me) };
    const name = await d.ask(link.squadId, me);
    return name ? { state: "asked", squad: name } : { state: "error", message: "That squad is not open to join right now." };
  } catch (e) {
    return { state: "error", message: d.say(e) };
  }
}

// ---------- the link waiting on this page ----------
let pending: FriendLink | null = null;
/** Reads the link after the # once (call it before anything else touches the address), keeps it in memory and in
 *  this tab's session (so a sign in on the way does not lose it), and takes the key out of the address bar. */
export function captureFriendLink(loc: { hash: string; href: string } | null = typeof location === "undefined" ? null : location): FriendLink | null {
  if (pending) return pending;
  const fromHash = loc ? parseFriendLink(loc.hash) : null;
  if (fromHash && loc) {
    pending = fromHash;
    try { sessionStorage.setItem(SESSION_KEY, loc.hash.slice(1)); } catch { /* private mode: memory only */ }
    try { history.replaceState(null, "", loc.href.replace(/#.*$/, "")); } catch { /* not a browser */ }
    return pending;
  }
  try { const s = sessionStorage.getItem(SESSION_KEY); if (s) pending = parseFriendLink(s); } catch { /* none */ }
  return pending;
}
/** The link waiting here, if any (without taking it). */
export const pendingFriendLink = () => pending;
/** Done with it (joined, asked, or the person said no): gone from memory and the session. */
export function dropFriendLink() {
  pending = null;
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* none */ }
}
const SESSION_KEY = "ps.friendLink";

// ---------- no PS yet: the local first start (another branch) plugs in here ----------
type Starter = (name: string) => Promise<void>;
let starter: Starter | null = null;
/** The local first start registers how to make an account with just a name (the vault must be open as owner when
 *  the promise ends). With none registered, the landing page offers Sign in and the Get the app buttons only. */
export function setFriendStarter(fn: Starter | null) { starter = fn; }
export const friendStarter = () => starter;

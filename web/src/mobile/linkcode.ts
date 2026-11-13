// Link your iPhone by scan: the text inside the QR code PS shows on a Mac, and the reader on the phone. Pure: no DOM,
// no network, no storage (tests/phonelink.test.ts).
//
//   https://cincee.com/todolist-mobile/#link=1&u=<20 letter project ref>&k=<publishable key>[&s=ps][&a=p | &n=<username>]
//
// a=p: a passphrase only account (the passphrase alone signs in). n=<username>: an account made with a username, so the
// phone can sign in with the passphrase alone too. Neither (an older code): the phone behaves as before.
// Everything after the # stays on the two devices: browsers never send it to any server. It holds only what the paste
// screen already asks for, both public by design (core/project.ts): the project address and the publishable key. The
// secret key is refused on both ends (isSecretKey), so a code can never carry one.
import { projectRef, type DbSchema } from "../core/project.ts";
import type { ProjectLike } from "../core/accountid.ts";
import { cleanName, isSecretKey, parseConnect, type AccountHint, type Linked } from "./link.ts";
import { isProjectHandle } from "../core/accountid.ts";
import { readOffer, type Offer } from "../core/phonepair.ts";

/** The phone web app the QR code opens (any phone camera opens it in the browser). */
export const PHONE_LINK_BASE = "https://cincee.com/todolist-mobile/";
const MARK = "link=1";

/** The text for the QR code, from the project this Mac uses. Either the link, or what is wrong in plain words. */
export function phoneLinkUrl(url: string, key: string, schema: DbSchema = "public", base: string = PHONE_LINK_BASE, account: string | null = null, project: ProjectLike | null = null): { ok: string } | { error: string } {
  if (isSecretKey(key)) return { error: "PS will not make a code from a secret key. Only the publishable key can go on a phone." };
  const c = parseConnect(url, key, schema);
  if ("error" in c) return { error: "PS could not make a code from this project's address and key." };
  const ref = projectRef(c.ok.url);
  if (!ref) return { error: "A phone can only link a Supabase project on supabase.co." };
  const at = base.endsWith("/") ? base : `${base}/`;
  const s = c.ok.schema === "ps" ? "&s=ps" : "";
  return { ok: `${at}#${MARK}&u=${ref}&k=${encodeURIComponent(c.ok.key)}${s}${accountPart(account, project)}` };
}

/** The account kind for the code: the signed in username of this Mac (null: unknown, leave it out). The project's own
 *  hidden handle means a passphrase only account; any other name is a username account. */
function accountPart(account: string | null, project: ProjectLike | null): string {
  const a = typeof account === "string" ? account.trim() : "";
  if (!a) return "";
  if (isProjectHandle(a, project)) return "&a=p";
  const n = cleanName(a);
  return n ? `&n=${encodeURIComponent(n)}` : "";
}

/** Whether this address or text is one of these links (it carries a #link=1 part), without checking what is in it. */
export function hasLinkFragment(text: string): boolean {
  const h = fragmentOf(text);
  return h !== null && h.split("&")[0] === MARK;
}

/** What follows the first # (or the whole text when it is just the fragment), or null. */
function fragmentOf(text: string): string | null {
  const s = String(text ?? "").trim().slice(0, 1200);
  const i = s.indexOf("#");
  if (i >= 0) return s.slice(i + 1);
  return s.startsWith(`${MARK}&`) ? s : null;
}

/** Reads a scanned code, an address with the fragment, or `location.hash`. Null: not one of ours at all. Otherwise
 *  the project to save, or what is wrong in plain words. */
export function readLinkText(text: string): { ok: Linked; account: AccountHint; offer: Offer | null } | { error: string } | null {
  if (!hasLinkFragment(text)) return null;
  const raw = String(text ?? "").trim();
  // A full address must be ours (https on cincee.com, or this computer while testing); the page you are on needs no check.
  const i = raw.indexOf("#");
  if (i > 0 && !/^https:\/\/(www\.)?cincee\.com\/|^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}\//i.test(raw.slice(0, i + 1))) return null;
  const q = new URLSearchParams(fragmentOf(raw) ?? "");
  const u = q.get("u") ?? "", k = q.get("k") ?? "";
  if (!u || !k) return { error: "That code is cut short. Show it again on your Mac and scan it once more." };
  if (isSecretKey(k)) return { error: "That code holds a secret key. Never use it. Show a new code from PS on your Mac." };
  const r = parseConnect(u, k, q.get("s") === "ps" ? "ps" : "public");
  if ("error" in r) return { error: "That is not a PS code. Show the code from PS on your Mac and scan that one." };
  // The account kind. A username that is not usable is ignored (the phone then asks), never an error.
  const name = cleanName(q.get("n") ?? "");
  const account: AccountHint = name ? { kind: "name", name } : q.get("a") === "p" ? { kind: "project" } : null;
  // V1.55: a one time sign in offer from the Mac (core/phonepair.ts). Only the in-app scanner uses it; none or a bad one
  // just links the project, as before.
  return { ok: r.ok, account, offer: readOffer(q) };
}

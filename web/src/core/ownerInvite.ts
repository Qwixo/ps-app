// Owner invite links (27 Oct 2026): /client/join-owner#<invite id>.<secret>
// The secret is 32 random bytes in base64url (43 characters). It lives in the link fragment, which browsers
// never send with a page request; the new owner's browser sends it once to vault-auth (never logged), and the
// database keeps only sha256 of it (owner_invites.token_hash). Pure helpers, no keys, so they can be unit tested in node.

export const PUBLIC_BASE = "https://cincee.com/client/";
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Where links point: this site when it is served over http(s), else (PS, PS GOS) cincee.com/client. */
export function publicBase(origin: string, base: string): string {
  return /^https?:\/\//.test(origin) ? origin + base : PUBLIC_BASE;
}

export function ownerInviteLink(origin: string, base: string, id: string, token: string): string {
  if (!ID_RE.test(id) || !TOKEN_RE.test(token)) throw new Error("Bad invite.");
  return `${publicBase(origin, base)}join-owner#${id}.${token}`;
}

/** "#<id>.<token>" (or without the #) -> parts, or null when it is not exactly that shape. */
export function parseOwnerInvite(hash: string): { id: string; token: string } | null {
  const h = hash.replace(/^#/, "").trim();
  const dot = h.indexOf(".");
  if (dot < 0) return null;
  const id = h.slice(0, dot).toLowerCase();
  const token = h.slice(dot + 1);
  if (!ID_RE.test(id) || !TOKEN_RE.test(token)) return null;
  return { id, token };
}

export type OwnerInviteRow = { id: string; created_at: string; expires_at: string; used_at: string | null; revoked_at: string | null };
export type OwnerInviteState = "open" | "used" | "revoked" | "expired";

export function ownerInviteState(r: OwnerInviteRow, now = Date.now()): OwnerInviteState {
  if (r.used_at) return "used";
  if (r.revoked_at) return "revoked";
  if (Date.parse(r.expires_at) <= now) return "expired";
  return "open";
}

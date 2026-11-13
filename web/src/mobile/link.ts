// The mobile web app (cincee.com/todolist-mobile): which Supabase project this phone talks to.
// G Squad friends each have their own project (made by PS on their Mac, "Connect your own Supabase"). The phone
// needs its address and publishable key once; both are public by design (core/project.ts). They are kept in this
// browser only (localStorage), never sent anywhere but to that project. A secret key is refused outright.
import { cleanInjected, normUrl, type DbSchema } from "../core/project.ts";

export const LINK_KEY = "psm.project";
export type Linked = { url: string; key: string; schema: DbSchema };
/** Which kind of account the Mac's code said this project has: a passphrase only one, one made with a username (the
 *  username is only the salt of the key and a pseudonymous id, not a secret), or nothing (an older code). */
export type AccountHint = { kind: "project" } | { kind: "name"; name: string } | null;
export const ACCOUNT_KEY = "psm.account";

/** What a person typed as the project address: the full URL, the host, or just the 20 letter project ref. */
export function tidyProjectUrl(raw: string): string {
  let s = String(raw ?? "").trim().replace(/\s+/g, "");
  if (/^[a-z0-9]{20}$/.test(s)) return `https://${s}.supabase.co`;
  if (/^[a-z0-9]{20}\.supabase\.co\/?$/i.test(s)) s = `https://${s}`;
  s = s.replace(/^http:\/\/([a-z0-9]{20}\.supabase\.co)/i, "https://$1");
  // Copied from the dashboard with a path on the end (/rest/v1/, /auth/v1): just the project.
  const m = /^(https:\/\/[a-z0-9]{20}\.supabase\.co)(\/.*)?$/i.exec(s);
  return normUrl(m ? m[1].toLowerCase() : s);
}

/** A key that must never be pasted anywhere: the secret key, or any JWT whose role is not exactly "anon" (an allowlist,
 *  so no secret role name has to be written here). Publishable keys (sb_publishable_) are fine. */
export function isSecretKey(raw: string): boolean {
  const k = String(raw ?? "").trim();
  if (/^sb_secret_/i.test(k)) return true;
  const part = k.split(".")[1];
  if (!k.startsWith("eyJ") || !part) return false;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    return (JSON.parse(json) as { role?: unknown } | null)?.role !== "anon";
  } catch { return true; }
}

/** Checks the two fields. Either the project to save, or what is wrong in plain words. */
export function parseConnect(urlRaw: string, keyRaw: string, schema: DbSchema = "public"): { ok: Linked } | { error: string } {
  const key = String(keyRaw ?? "").trim();
  if (!String(urlRaw ?? "").trim()) return { error: "Paste your Project URL first." };
  if (!key) return { error: "Paste your publishable key too." };
  if (isSecretKey(key)) return { error: "That is a secret key. Never paste it anywhere, and do not use it here. Copy the publishable key instead." };
  const url = tidyProjectUrl(urlRaw);
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) return { error: "That does not look like a Supabase Project URL. It looks like https://abcdefghijklmnopqrst.supabase.co" };
  const c = cleanInjected({ url, key, schema });
  if (!c) return { error: "That does not look like a publishable key. It starts with sb_publishable_ (or, for older projects, with eyJ)." };
  return { ok: { url: c.url, key: c.key, schema: c.schema } };
}

/** The project this phone linked, checked again on every read (anything off reads as none). */
export function readLinked(store: Pick<Storage, "getItem"> | null = safeStorage()): Linked | null {
  try {
    const o = JSON.parse(store?.getItem(LINK_KEY) || "null");
    const c = cleanInjected(o);
    return c && /^https:\/\//.test(c.url) ? { url: c.url, key: c.key, schema: c.schema } : null;
  } catch { return null; }
}
export function saveLinked(l: Linked, store: Pick<Storage, "setItem"> | null = safeStorage()) {
  store?.setItem(LINK_KEY, JSON.stringify({ url: l.url, key: l.key, schema: l.schema }));
}
/** Remember the account kind next to the link it came with. A passphrase only code clears any username; an older code
 *  (no hint) leaves what is there, and a hint is only used for the project it was saved with (readAccountName). */
export function saveAccountHint(url: string, a: AccountHint, store: Pick<Storage, "setItem" | "removeItem"> | null = safeStorage()) {
  if (!a) return;
  try {
    if (a.kind === "name") store?.setItem(ACCOUNT_KEY, JSON.stringify({ url, name: a.name }));
    else store?.removeItem(ACCOUNT_KEY);
  } catch { /* storage off: the sign in falls back to asking */ }
}
/** The username the scanned code carried for this project, or "" (passphrase only, an older code, or another project). */
export function readAccountName(url: string, store: Pick<Storage, "getItem"> | null = safeStorage()): string {
  try {
    const o = JSON.parse(store?.getItem(ACCOUNT_KEY) || "null");
    return o && o.url === url && typeof o.name === "string" ? cleanName(o.name) : "";
  } catch { return ""; }
}
/** A username as the code carries it: one short line, nothing odd. "" when it is not usable. */
export function cleanName(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  return v && v.length <= 64 && !/[\u0000-\u001f\u007f]/.test(v) ? v : "";
}
export function forgetLinked(store: Pick<Storage, "removeItem"> | null = safeStorage()) {
  store?.removeItem(LINK_KEY);
}
/** A short name for the project to show: its host. */
export function projectHost(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

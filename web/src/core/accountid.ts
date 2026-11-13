// Which account a sign in means (V1.49, the developer 12 Nov 2026: "eliminate the full name and username part of the PS app
// setup process ... all it needs is the passphrase really").
//
// Accounts made in PS on a Supabase project of the person's own from V1.49 on have no username. Inside the app
// they are carried by a fixed handle, "ps-project:<project ref>", wherever a username used to go (the last
// username on this device, Remember me in the Keychain, the unlocked state). The handle is never shown and never
// typed. Only that exact handle, and only on that same linked project, turns into the project derivation
// (crypto.ts deriveForProject / projectLoginEmail). Anything else, on any project, is a username exactly as before,
// so every account made with a username (the developer's own "admin", invited owners, clients, friends on their own project
// since V1.36) derives the same login id and keys as it always did.
import * as C from "./crypto.ts";

export const PROJECT_HANDLE_PREFIX = "ps-project:";

/** What this needs to know about the linked project (core/project.ts ProjectChoice). */
export interface ProjectLike { custom: boolean; ref: string | null; url: string }

/** The project's id for a passphrase only account: its ref (a local test server: its address). Only a project of the
 *  person's own; the developer's project and the build's own project hold many accounts, so they never get one. */
export function projectAccountId(p: ProjectLike | null): string | null {
  if (!p || !p.custom) return null;
  try { return C.cleanProjectId(p.ref ?? p.url.trim().replace(/\/+$/, "")); } catch { return null; }
}

/** The hidden handle that stands in for a username on this project, or null where usernames are still needed. */
export function projectHandle(p: ProjectLike | null): string | null {
  const id = projectAccountId(p);
  return id ? PROJECT_HANDLE_PREFIX + id : null;
}

/** True only for this project's own handle. */
export function isProjectHandle(username: string, p: ProjectLike | null): boolean {
  const h = projectHandle(p);
  return !!h && username === h;
}

/** The pseudonymous login id Supabase sees for this username (or this project's handle). */
export async function accountLogin(username: string, p: ProjectLike | null): Promise<string> {
  return isProjectHandle(username, p) ? C.projectLoginEmail(projectAccountId(p)!) : C.loginEmail(username);
}

/** The login password and KEK for this passphrase, with the same PBKDF2-SHA256 600k and HKDF as always. */
export async function accountDerive(passphrase: string, username: string, p: ProjectLike | null, iters?: number, extractableKek = false): Promise<C.Derived> {
  return isProjectHandle(username, p)
    ? C.deriveForProject(passphrase, projectAccountId(p)!, iters, extractableKek)
    : C.deriveFromPassphrase(passphrase, username, iters, extractableKek);
}

/** What a failed sign in says. A passphrase only attempt (no username field showing) on a project of the person's own that
 *  came back "wrong username or passphrase" may be an account made with a username: the field opens at once and the
 *  words say so. Anything else says what it said. */
export function failedSignIn(o: { handle: string | null; typed: boolean; setup: boolean; message: string }): { openName: boolean; text: string } {
  const maybeName = !o.typed && !!o.handle && !o.setup && /wrong username or passphrase/i.test(o.message);
  return maybeName ? { openName: true, text: "That did not open it. Check your passphrase. Signed up with a username? Type it here." } : { openName: false, text: o.message };
}

/** The username a sign in uses (views/Lock.tsx). No handle (the developer's project, the website, the phone app): what was
 *  typed, as before. On a project of the person's own: what they typed behind "Signed up with a username?", else the
 *  username this device remembers from an account made with one, else the project's hidden handle. */
export function signInUsername(o: { handle: string | null; typed: boolean; typedName: string; remembered: string }): string {
  if (!o.handle || o.typed) return o.typedName;
  return o.remembered && o.remembered !== o.handle ? o.remembered : o.handle;
}

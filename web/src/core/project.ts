// Which Supabase project this copy of PS talks to (5 Nov 2026, "Connect your own Supabase").
// The developer's own vault project is the default for every build (website, phone, Mac). Only the Mac app can
// point somewhere else: someone the developer gives PS to links a Supabase project of their own in PS's setup
// window (ps-mac Sources/ProjectSetup.swift), and the shell hands its address and public key to the page
// before any of the page's code runs, as window.__psProject (ps-mac Sources/Project.swift).
// Nothing secret travels here: the URL and the anon (publishable) key are public by design; the
// one time setup code only lets the very first account be created in an empty project.
// The developer's personal features stay on the developer's project only: onRedProject() is false until the page knows
// it talks to the developer's project, so an empty or unknown answer can never switch them on (fails closed).

export const RED_PROJECT_REF = "mxusokxekkecebwqgeru";
export const RED_PROJECT_URL = `https://${RED_PROJECT_REF}.supabase.co`;

export interface ProjectChoice {
  url: string;
  key: string;
  /** Not the build's own project: a project this Mac was linked to. */
  custom: boolean;
  /** The developer's vault project (his personal features may switch on there, never anywhere else). */
  red: boolean;
  /** The project ref (the part before .supabase.co), null for a local test server. */
  ref: string | null;
  /** One time code for the first account of an empty project (owner_setup), null otherwise. */
  setupCode: string | null;
  /** The database schema PS's tables are in: "public", or "ps" in a project shared with someone's own app. */
  schema: DbSchema;
}
export type DbSchema = "public" | "ps";

const HOSTED = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/;
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;   // a local Supabase for tests (supabase start)
const KEY = /^(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|sb_publishable_[A-Za-z0-9_-]{10,200})$/;
const CODE = /^[A-Za-z0-9-]{16,64}$/;

export function normUrl(u: unknown): string {
  return typeof u === "string" ? u.trim().replace(/\/+$/, "") : "";
}
export function projectRef(url: string): string | null {
  return HOSTED.exec(normUrl(url))?.[1] ?? null;
}
export function isRedProjectUrl(url: unknown): boolean {
  return normUrl(url) === RED_PROJECT_URL;
}
/** A project address PS may talk to: a hosted Supabase project, or a local one on this computer (tests). */
export function validProjectUrl(url: unknown): boolean {
  const u = normUrl(url);
  return HOSTED.test(u) || LOCAL.test(u);
}

/** What the Mac shell handed in, checked field by field. Anything off: null (the build's own project). */
export function cleanInjected(v: unknown): { url: string; key: string; setupCode: string | null; schema: DbSchema } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const url = normUrl(o.url);
  if (!validProjectUrl(url) || typeof o.key !== "string" || !KEY.test(o.key)) return null;
  const setupCode = typeof o.setupCode === "string" && CODE.test(o.setupCode) ? o.setupCode : null;
  return { url, key: o.key, setupCode, schema: o.schema === "ps" ? "ps" : "public" };
}

/** The project for this page: the Mac app's own choice (only in the PS build), or the one a phone linked in the
 *  mobile web app (cincee.com/todolist-mobile, `mobile` true only there, src/mobile/boot.ts), else the build's. */
export function chooseProject(mode: string, injected: unknown, envUrl: unknown, envKey: unknown, mobile = false): ProjectChoice {
  const inj = mode === "ps" || (mobile && mode !== "gos") ? cleanInjected(injected) : null;
  const url = inj ? inj.url : normUrl(envUrl);
  const key = inj ? inj.key : typeof envKey === "string" ? envKey : "";
  const red = isRedProjectUrl(url);
  return { url, key, custom: !!inj && url !== normUrl(envUrl), red, ref: projectRef(url), setupCode: red || mode !== "ps" ? null : inj?.setupCode ?? null,
    schema: red ? "public" : inj?.schema ?? "public" };
}

// The page's one answer, set once by core/vault.ts before anything signs in. Unset means "not the developer's".
let active: ProjectChoice | null = null;
export function setActiveProject(p: ProjectChoice | null) { active = p; }
export function activeProject(): ProjectChoice | null { return active; }
/** True only while this page talks to the developer's own vault project. */
export function onRedProject(): boolean { return !!active && active.red && isRedProjectUrl(active.url); }
/** The local database name for the offline copy: the developer's project keeps the old name, others get their own. */
export function localDbName(p: ProjectChoice | null): string {
  if (!p || p.red) return "cincee-vault";
  return `cincee-vault-${(p.ref || p.url.replace(/[^a-z0-9]/gi, "")).slice(0, 40)}`;
}

/** The mobile web app (cincee.com/todolist-mobile): true only on its own address, never on the website. */
export function isMobilePath(path: string): boolean {
  return /^\/(client\/)?todolist-mobile(\/|$)/.test(path);
}
/** Where the browser keeps its Supabase sign in: the developer's project keeps the old key, any other project its own, so a
 *  friend's project on the phone and the website on the same address never share or overwrite a sign in. */
export function authStorageKey(p: ProjectChoice | null): string {
  if (!p || p.red) return "cincee-vault-auth";
  return `cincee-vault-auth-${(p.ref || p.url.replace(/[^a-z0-9]/gi, "")).slice(0, 40)}`;
}

// Proton Mail through Proton Mail Bridge (PS 1.65). Pure rules (no DOM, no vault writes, no network), so tests/protonmail.test.ts runs them.
//
// Proton Mail Bridge is Proton's own Mac app. It runs a mail server on the person's own Mac, and PS on that Mac reads the unread
// mail from it (Sources/ProtonBridge.swift, tested in ProtonBridgeCore.swift) and hands this page plain rows. Nothing about it goes
// into the vault or to any server: the rows live in memory on this device, the Bridge password lives only in the Mac's Keychain
// (typed into a small PS window, never into this page), and a click on Done is remembered by PS on that Mac.
//
// The email panel shows a Proton email like a Gmail one (same row, marked Proton) when its sender is one of the person's clients
// or on their Always notify me list, and not muted (the same rules as Gmail, core/mailrules.ts). Reply goes only on the person's click.
import type { ClientRec, Doc } from "./model";
import { buildMatcher, replierName } from "./mail.ts";
import { mailVerdict, type MailRules } from "./mailrules.ts";
import type { MailRow } from "./overlaymail.ts";

export const PROTON_FEATURE = "proton-bridge";
export const BRIDGE_DOWNLOAD = "https://proton.me/mail/bridge";
export const PROTON_INBOX = "https://mail.proton.me/u/0/inbox";
export const BRIDGE_DEFAULT_HOST = "127.0.0.1";
export const BRIDGE_DEFAULT_PORT = 1143;

/** One unread email as PS on the Mac sends it. */
export interface ProtonIn { key: string; from: string; fromName: string | null; subject: string; snippet: string; date: string }

const str = (x: unknown, n: number) => (typeof x === "string" ? x.slice(0, n) : "");
const EMAIL = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/;

/** The rows from PS, checked: anything odd is dropped, never trusted. At most 60. */
export function cleanProtonRows(v: unknown): ProtonIn[] {
  if (!Array.isArray(v)) return [];
  const out: ProtonIn[] = [];
  const seen = new Set<string>();
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const key = str(o.key, 24), from = str(o.from, 254).toLowerCase(), date = str(o.date, 40);
    if (!/^[\w-]{1,24}$/.test(key) || seen.has(key) || !EMAIL.test(from) || !Number.isFinite(Date.parse(date))) continue;
    seen.add(key);
    out.push({ key, from, fromName: str(o.fromName, 120).trim() || null, subject: str(o.subject, 300).trim(), snippet: str(o.snippet, 600).trim(), date });
    if (out.length >= 60) break;
  }
  return out;
}

/** What PS says about the link (never a password, never a fingerprint). */
export interface ProtonStatus {
  linked: boolean;
  host: string | null; port: number | null; user: string | null;
  /** A problem with the link or the last check, as a code (PROTON_PROBLEMS). */
  problem: string | null;
  /** The last try to link failed, as a code. */
  linkProblem: string | null;
  lastOk: number | null;
  unread: number;
  checking: boolean;
}
export const NO_STATUS: ProtonStatus = { linked: false, host: null, port: null, user: null, problem: null, linkProblem: null, lastOk: null, unread: 0, checking: false };
export function cleanProtonStatus(v: unknown): ProtonStatus {
  if (!v || typeof v !== "object") return NO_STATUS;
  const o = v as Record<string, unknown>;
  const code = (x: unknown) => { const s = str(x, 20); return s && /^[A-Za-z]+$/.test(s) ? s : null; };
  const num = (x: unknown, max: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= max ? x : null);
  const linked = o.linked === true;
  return {
    linked,
    host: linked && typeof o.host === "string" ? o.host.slice(0, 45) : null,
    port: linked ? num(o.port, 65535) : null,
    user: linked && typeof o.user === "string" ? o.user.slice(0, 254) : null,
    problem: linked ? code(o.problem) : null,
    linkProblem: code(o.linkProblem),
    lastOk: linked ? num(o.lastOk, 1e14) : null,
    unread: num(o.unread, 100000) ?? 0,
    checking: o.checking === true,
  };
}

/** The words for a problem code. `certChanged` is the only one that asks the person to decide. */
export const PROTON_PROBLEMS: Record<string, string> = {
  bridgeDown: "Proton Mail Bridge is not running. Open the Bridge app on this Mac, then PS tries again by itself.",
  badPassword: "Bridge did not accept the password. Copy the password shown in the Bridge app, not your Proton login password.",
  certChanged: "Bridge's security certificate is not the one PS saw when you linked it. This happens after reinstalling Bridge. If you did that, choose Trust the new one. If not, do not.",
  notLoopback: "That address is not this Mac. Proton Bridge always runs on 127.0.0.1.",
  badInput: "Check the address, the port and the username, then try again.",
  timeout: "Bridge did not answer in time. PS tries again by itself.",
  protocol: "Bridge answered something PS did not expect. PS tries again by itself.",
  keychain: "The Mac would not keep the password in the Keychain. Try again.",
  noLink: "Proton Mail is not linked.",
  maybeSent: "Bridge took the reply but its answer never came. It may have gone. Check the Sent folder in Proton before you send it again.",
  gone: "That email is no longer in the inbox.",
};
export const protonProblemWords = (code: string | null | undefined): string => (code && PROTON_PROBLEMS[code]) || "";

/** Every new on screen word of this feature, in one place (the owner approves this list). */
export const PROTON_WORDS = {
  title: "Proton Mail",
  line: "Read your clients' Proton Mail in the email panel, through Proton Mail Bridge. Everything stays on this Mac.",
  link: "Link Proton Mail (Proton Bridge)",
  steps: [
    "Install Proton Mail Bridge on this Mac, open it and sign in to your Proton account.",
    "In the Bridge app, open your account. It shows an address, a port, a username and a password for your mail app.",
    "Type the address, the port and the username here. The password goes into a small PS window and then into this Mac's Keychain.",
  ],
  download: "Get Proton Mail Bridge",
  address: "Bridge address", port: "Bridge port", user: "Username",
  addressHint: "Almost always 127.0.0.1", userHint: "The username Bridge shows, your Proton address",
  button: "Link", linking: "Linking",
  linked: "Linked", problem: "Problem", unlink: "Unlink", unlinkSure: "Unlink and forget the password?", refresh: "Check now",
  trust: "Trust the new one",
  keychain: "The password is kept only in this Mac's Keychain. PS only ever talks to 127.0.0.1, the Bridge app on this Mac.",
  macOnly: "Proton Mail is read by PS on your Mac.",
  working: "Reading your Proton inbox", never: "PS only reads. It never marks anything as read.",
  badge: "Proton",
  sentOk: "Sent through Proton", sendFail: "Not sent",
  intro: { headline: "New: read your Proton Mail here", ask: "Did you know PS can show your clients' Proton Mail, through Proton Mail Bridge?", show: "Show me", later: "Later", settings: "Settings, Client emails, Link Proton Mail" },
  introSteps: [
    "Install Proton Mail Bridge on your Mac and sign in.",
    "Open Settings, Client emails, Link Proton Mail.",
    "Type the address, port and username Bridge shows. The password goes into the Mac's Keychain.",
  ],
} as const;

/** "Linked, last check 3 minutes ago" style line. */
export function protonAgo(ms: number | null, now = Date.now()): string {
  if (!ms) return "";
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

/** The pop up card id and the panel row id of a Proton email ("p:" and its key). Not the Gmail "m:" or Instantly "n:" ids. */
export const protonCardId = (key: string) => `p:${key}`.slice(0, 40);
export const protonKeyOf = (cardId: string): string | null => (/^p:[\w-]{1,24}$/.test(cardId) ? cardId.slice(2) : null);

type ClientDoc = Pick<Doc<ClientRec>, "id" | "data">;
/**
 * The panel rows for the unread Proton mail: only senders who are a client or on the Always notify me list, and not muted
 * (core/mailrules.ts mailVerdict, the same answer Gmail gets). `own`: addresses that are the person's own (their Proton address too),
 * so their own mail never makes a row. Newest first.
 */
export function protonMailRows(rows: readonly ProtonIn[], clients: readonly ClientDoc[], rules: MailRules | undefined, own: Set<string>): MailRow[] {
  const match = buildMatcher(clients as { id: string; data: ClientRec }[]);
  const byId = new Map(clients.map((c) => [c.id, c]));
  const out: MailRow[] = [];
  for (const r of rows) {
    const clientId = match(r.from);
    if (!mailVerdict(r.from, clientId, rules, own).pop) continue;
    const c = clientId ? byId.get(clientId) : undefined;
    const who = replierName(c?.data, { fromName: r.fromName, from: r.from });
    out.push({
      cardId: protonCardId(r.key), via: "proton", who,
      company: c && c.data.name.toLowerCase() !== who.toLowerCase() ? c.data.name : null,
      subject: r.subject, preview: r.snippet, at: r.date, url: PROTON_INBOX, count: 1,
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// ---------- what this device holds (memory only) ----------
export interface ProtonSent { ok: boolean; error: string | null }
interface Mirror { rows: ProtonIn[]; status: ProtonStatus; sent: Record<string, ProtonSent> }
let mirror: Mirror = { rows: [], status: NO_STATUS, sent: {} };
const subs = new Set<() => void>();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** A message from PS. True when it was ours. */
export function protonShellMessage(m: { type?: string; [k: string]: unknown }): boolean {
  if (typeof m?.type !== "string" || !m.type.startsWith("proton:")) return false;
  if (m.type === "proton:rows") {
    const rows = cleanProtonRows(m.rows), status = cleanProtonStatus(m.status);
    if (same(rows, mirror.rows) && same(status, mirror.status)) return true;
    mirror = { ...mirror, rows, status };
    subs.forEach((f) => f());
  } else if (m.type === "proton:sent") {
    const key = str(m.key, 24);
    if (!/^[\w-]{1,24}$/.test(key)) return true;
    const err = typeof m.error === "string" && /^[A-Za-z]{1,20}$/.test(m.error) ? m.error : null;
    mirror = { ...mirror, sent: { ...mirror.sent, [key]: { ok: m.ok === true, error: m.ok === true ? null : err || "protocol" } } };
    subs.forEach((f) => f());
  }
  return true;
}
export const protonMirror = {
  get: (): Mirror => mirror,
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  /** Test helper: forget everything. */
  reset() { mirror = { rows: [], status: NO_STATUS, sent: {} }; subs.forEach((f) => f()); },
};
/** A reply went wrong or went: shown on its row for a while, then forgotten when the person tries again. */
export function clearProtonSent(key: string) {
  if (!(key in mirror.sent)) return;
  const sent = { ...mirror.sent }; delete sent[key];
  mirror = { ...mirror, sent };
  subs.forEach((f) => f());
}

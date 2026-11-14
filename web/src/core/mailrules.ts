// Who may pop up from Gmail (the developer, 4 Nov 2026: "even if people aren't clients sometimes I'd still want the
// notification that they emailed me. So I can decide for myself and see the emails coming through").
// Client emails pop up as before. On top of that the developer keeps two lists in Settings, Gmail replies:
//   Always notify me: an address or a whole domain that pops up like a client email, without being a client.
//   Muted: never pops up, even a client's (the email still lands on the client's page).
// The developer's own Gmail accounts never pop up. The lists live in the settings record (settings.mailRules), each entry
// with the time it was set, so two devices' copies join entry by entry (core/cardsync.ts) and a removal sticks.
// "Who emails me" reads one small record per sender (kind "msender"), written only when a new email from that
// sender comes in: sender, account, time, subject and the last 30 days of message ids. Never a body.
import type { Doc, Reply } from "./model";
import { FREE_DOMAINS, domainOf, parseAddress, parseMatchEntry, type GmailInbound } from "./mail.ts";

export type RuleList = "notify" | "mute" | "off";
/** settings.mailRules: entry (an address, or a domain without the @) -> which list, and when it was set. */
export interface MailRules { e?: Record<string, { l: RuleList; at: string }> }

export type Why = "client" | "notify" | "muted" | "own" | "none";
export interface Verdict { pop: boolean; why: Why }

const DAY = 864e5;
export const SENDER_DAYS = 30;
const MAX_IDS = 60;
const OFF_KEEP_DAYS = 90;
const MAX_ENTRIES = 300;

/** An entry as the developer typed it ("Jane@company.example", "@company.example", "company.example"), or an error. */
export function cleanRuleEntry(raw: string): { v: string; domain: boolean } | { error: string } {
  const e = parseMatchEntry(raw);
  if (!e) return { error: "That is not an email address or a domain." };
  if (e.type === "domain" && FREE_DOMAINS.has(e.v)) return { error: `${e.v} is shared by everyone, add the full address instead.` };
  return { v: e.v, domain: e.type === "domain" };
}

/** Which list this sender is on: an exact address beats a domain, the longest domain wins, subdomains count. */
export function ruleFor(rules: MailRules | undefined, email: string | null | undefined): "notify" | "mute" | null {
  if (!email || !rules?.e) return null;
  const e = email.toLowerCase();
  const exact = rules.e[e];
  if (exact && exact.l !== "off") return exact.l;
  const d = domainOf(e);
  let best: { len: number; l: "notify" | "mute" } | null = null;
  for (const [k, x] of Object.entries(rules.e)) {
    if (x.l === "off" || k.includes("@")) continue;
    if ((d === k || d.endsWith("." + k)) && (!best || k.length > best.len)) best = { len: k.length, l: x.l };
  }
  return best?.l ?? null;
}

/** Does an email from this sender pop up, and why. Own accounts first, then Mute (it beats everything), client, list. */
export function mailVerdict(email: string | null | undefined, clientId: string | null | undefined, rules: MailRules | undefined, own: Set<string>): Verdict {
  const e = (email || "").toLowerCase();
  if (!e) return { pop: false, why: "none" };
  if (own.has(e)) return { pop: false, why: "own" };
  const r = ruleFor(rules, e);
  if (r === "mute") return { pop: false, why: "muted" };
  if (clientId) return { pop: true, why: "client" };
  if (r === "notify") return { pop: true, why: "notify" };
  return { pop: false, why: "none" };
}

/** Put an entry on a list ("off" takes it off). Old "off" marks are dropped after 90 days. */
export function setRule(rules: MailRules | undefined, entry: string, l: RuleList, now = Date.now()): MailRules {
  const at = new Date(now).toISOString();
  const e: NonNullable<MailRules["e"]> = {};
  for (const [k, x] of Object.entries(rules?.e || {})) if (x.l !== "off" || Date.parse(x.at) > now - OFF_KEEP_DAYS * DAY) e[k] = x;
  e[entry] = { l, at };
  const keys = Object.keys(e);
  if (keys.length > MAX_ENTRIES) keys.sort((a, b) => e[a].at.localeCompare(e[b].at)).slice(0, keys.length - MAX_ENTRIES).forEach((k) => delete e[k]);
  return { e };
}

/** Two devices' copies of the lists joined: per entry, the one set later wins (a removal too). */
export function mergeMailRules(a: MailRules | undefined, b: MailRules | undefined): MailRules | undefined {
  if (!a?.e && !b?.e) return a ?? b;
  const e: NonNullable<MailRules["e"]> = { ...(a?.e || {}) };
  for (const [k, x] of Object.entries(b?.e || {})) if (!e[k] || x.at > e[k].at) e[k] = x;
  return { e };
}

/** The entries on one list, a to z. */
export const ruleList = (rules: MailRules | undefined, l: "notify" | "mute") =>
  Object.entries(rules?.e || {}).filter(([, x]) => x.l === l).map(([k]) => k).sort();

/** The developer's own Gmail accounts: every account mail came to (reply records and sender records know them). */
export function ownAccounts(docs: Iterable<Doc<unknown>>, extra: Iterable<string> = []): Set<string> {
  const out = new Set<string>([...extra].map((a) => a.toLowerCase()));
  for (const d of docs) {
    if (d.kind === "reply") out.add((d.data as Reply).account.toLowerCase());
    else if ((d.kind as string) === "msender") for (const a of (d.data as MailSender).accounts || []) out.add(a.toLowerCase());
  }
  return out;
}

// ---------- the sender records ("Who emails me") ----------
export interface MailSender {
  email: string;
  name?: string | null;
  accounts: string[];          // the Gmail accounts their mail came to, the latest last
  last: string;                // their newest email
  subject?: string | null;     // its subject (cut to 120 characters)
  ids: [string, string][];     // [Gmail message id, date] of the last 30 days, oldest first (at most 60)
}

/** Fold one inbound message into the sender's record. null when nothing changes (the message is known or too old). */
export function logInbound(ex: MailSender | undefined, m: Pick<GmailInbound, "account" | "id" | "date" | "from" | "subject">, now = Date.now()): MailSender | null {
  const { name, email } = parseAddress(m.from);
  if (!email || !m.date) return null;
  const cut = new Date(now - SENDER_DAYS * DAY).toISOString();
  if (m.date < cut) return null;
  if (ex?.ids.some(([id]) => id === m.id)) return null;
  const account = m.account.toLowerCase();
  const ids = [...(ex?.ids || []).filter(([, d]) => d >= cut), [m.id, m.date] as [string, string]].sort((a, b) => a[1].localeCompare(b[1])).slice(-MAX_IDS);
  const newer = !ex || m.date >= ex.last;
  return {
    email,
    name: newer ? (name || ex?.name || null) : (ex?.name || name || null),
    accounts: newer ? [...(ex?.accounts || []).filter((a) => a !== account), account] : (ex?.accounts.includes(account) ? ex.accounts : [account, ...(ex?.accounts || [])]),
    last: newer ? m.date : ex!.last,
    subject: newer ? (m.subject || "").trim().slice(0, 120) || null : ex!.subject ?? null,
    ids,
  };
}

/** Two copies of one sender (two devices, or two records made at once) joined. */
export function mergeSender(a: MailSender, b: MailSender): MailSender {
  const [old, neu] = (b.last || "") > (a.last || "") ? [a, b] : [b, a];
  const ids = new Map<string, string>();
  for (const [id, d] of [...old.ids, ...neu.ids]) ids.set(id, d);
  const accounts = [...old.accounts.filter((x) => !neu.accounts.includes(x)), ...neu.accounts];
  return { email: neu.email, name: neu.name || old.name || null, accounts, last: neu.last, subject: neu.subject ?? old.subject ?? null,
    ids: [...ids].sort((x, y) => x[1].localeCompare(y[1])).slice(-MAX_IDS) };
}

export interface SenderRow {
  email: string; name: string | null; account: string; accounts: number; last: string; subject: string | null;
  count: number;               // emails in the last 30 days
  verdict: Verdict; clientId: string | null;
}

/** "Who emails me": one row per sender, newest first, with whether they would pop up and why. */
export function senderRows(docs: Iterable<Doc<unknown>>, match: (email: string | null) => string | null, rules: MailRules | undefined,
  own: Set<string>, now = Date.now()): SenderRow[] {
  const cut = new Date(now - SENDER_DAYS * DAY).toISOString();
  const by = new Map<string, MailSender>();
  for (const d of docs) {
    if ((d.kind as string) !== "msender") continue;
    const s = d.data as MailSender;
    if (!s?.email) continue;
    const ex = by.get(s.email);
    by.set(s.email, ex ? mergeSender(ex, s) : s);
  }
  const rows: SenderRow[] = [];
  for (const s of by.values()) {
    if (s.last < cut) continue;
    const clientId = match(s.email);
    rows.push({ email: s.email, name: s.name || null, account: s.accounts[s.accounts.length - 1] || "", accounts: s.accounts.length, last: s.last,
      subject: s.subject ?? null, count: s.ids.filter(([, d]) => d >= cut).length, verdict: mailVerdict(s.email, clientId, rules, own), clientId });
  }
  return rows.sort((a, b) => b.last.localeCompare(a.last));
}

/** A search over the rows: name, address, subject or account. */
export function searchRows(rows: SenderRow[], q: string): SenderRow[] {
  const t = q.trim().toLowerCase();
  if (!t) return rows;
  return rows.filter((r) => [r.name, r.email, r.subject, r.account].some((x) => (x || "").toLowerCase().includes(t)));
}

/** Sender records gone quiet for 30 days: removed (the list only ever covers the last 30 days). */
export function staleSenders(docs: Iterable<Doc<unknown>>, now = Date.now()): string[] {
  const cut = new Date(now - SENDER_DAYS * DAY).toISOString();
  const out: string[] = [];
  for (const d of docs) if ((d.kind as string) === "msender" && ((d.data as MailSender).last || "") < cut) out.push(d.id);
  return out;
}

/** A button press from the Tab list's Mac settings window (it holds no keys; the main page saves). */
export function cleanMailRuleOp(v: unknown): { entry: string; list: RuleList; clientId?: string } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { entry?: unknown; list?: unknown; clientId?: unknown };
  if (typeof o.entry !== "string" || o.entry.length > 200) return null;
  const e = cleanRuleEntry(o.entry);
  if ("error" in e) return null;
  if (typeof o.clientId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(o.clientId)) return { entry: e.v, list: "off", clientId: o.clientId };
  if (o.list !== "notify" && o.list !== "mute" && o.list !== "off") return null;
  return { entry: e.v, list: o.list };
}

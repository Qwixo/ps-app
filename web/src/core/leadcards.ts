// Instantly reply cards (the developer, 30 Oct 2026: "notify me of any reply", then "filter out auto replies to
// focus on human replies"). One card per Instantly thread whose newest reply from a lead the developer has not
// dismissed yet, in the same top right stack as client emails (tone "lead"), with Open in Instantly,
// Remind me in, Dismiss and swipe. READ ONLY: nothing here answers, labels or changes anything in Instantly.
// Source: the "irep" record (instantly-replies feed and the webhook, about every minute), which also holds
// promos and newsletters landing in the sending inboxes: only replies to a campaign, or in a thread the developer
// wrote in by hand, count. Auto replies (out of office, "this is an automated response", bounces, ticket
// systems, "no longer with the company") never raise a card.
// Dismissed and reminded are kept in settings.leadCards (encrypted with the rest of the settings), so a
// Dismiss on the Mac clears the phone too. Only replies after leadCards.since count, so old ones never flood in.
// The card id is the Instantly EMAIL id (2 Nov 2026): the same reply first comes by webhook, often without its
// thread id, and a minute later from the feed with it. Keyed by thread, the card changed id in between, so
// the phone took the first notification away and posted a second one for the same email. Dismissed and
// reminded stay keyed by thread (one card per thread) and are also honoured under the email id.
import type { LeadCardState } from "./model";
import { firstSentences } from "./mail.ts";

export interface IRep {
  id?: string; threadId?: string | null; lead?: string; from?: string; fromName?: string | null; account?: string;
  at?: string | null; subject?: string | null; opening?: string | null; campaignId?: string | null; url?: string | null; type?: string;
}
export interface LeadCard { id: string; key: string; email: string; rev: string; title: string; sub: string; body: string; url: string; at: string; fresh: boolean;
  /** For the Tab list's email panel (core/overlaymail.ts): the first name, the company domain and the subject on their own. */
  name?: string; company?: string; subject?: string }

/** The remind picker on a lead card: as client emails, 15 minutes, 5 per wheel step, 5 minutes to 4 hours. */
export const LEAD_REMIND = { start: 15, step: 5, min: 5, max: 240 } as const;
const UNIBOX = "https://app.instantly.ai/app/unibox";
const FREE = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|pm|gmx|mail|yandex|zoho)\./i;

// Auto replies. The subject is only read before any "Re:" (the part after it is the developer's own subject).
const AUTO_SUBJECT = [
  /\bauto(matic|mated)?[\s-]*(reply|response|answer)\b/i, /\bout of (the )?office\b/i, /\bOOO\b/, /\bundeliverable\b/i,
  /\bdelivery (status notification|failure|has failed)\b/i, /\bmail delivery (failed|subsystem)\b/i, /\breturned mail\b/i,
  /\bthank(s| you) for (your (e-?mail|message|inquiry|enquiry)|contacting|reaching out|getting in touch|writing)\b/i,
  /\b(away|on (vacation|holiday|leave|annual leave|pto))\b/i, /\b(ticket|request|case) (#|no\.?|number)?\s*\w*\s*(has been )?(received|created|opened)\b/i,
];
const AUTO_BODY = [
  /\bthis is an? (automated|automatic|auto-generated|auto)[\s-]*(response|reply|message|e-?mail|notification)?\b/i,
  /\bauto(matic|mated)?[\s-]*(reply|response)\b/i,
  /\bout of (the )?office\b/i,
  /\bon (annual|maternity|paternity|parental|medical|sick) leave\b/i,
  /\blimited (access to|availability (on|via)) (my )?e-?mail\b/i,
  /\b(i('m| am| will be|'ll be) (currently )?(away|travel?ling|on (vacation|holiday|leave|pto))).{0,80}\b(until|return|back|limited)\b/is,
  /\b(will|i'll|i will) (be )?(back|return(ing)?) (in the office |to the office )?(on|from|after)\b/i,
  /\bno longer (with|at|employed|working (at|for|with))\b/i, /\bhas left (the company|the business|the team|us|[A-Z][\w&.-]*)\b/,
  /\bthis (mailbox|inbox|e-?mail( address)?|account) is (no longer|not) (monitored|in use|active|checked)\b/i,
  /\b(we('ve| have)|your (e-?mail|message|request) (has been|was)) received\b/i, /\bwe('ve| have) received your\b/i,
  /\b(get back to you|respond to you|reply to you|be in touch|respond to your (e-?mail|message|inquiry))\b.{0,40}\b(as soon as (possible|we can)|within \d+|shortly|asap|in the order)\b/is,
  /\b(do not|don't|please don't) reply to this (e-?mail|message)\b/i,
  /\b(ticket|case|request) \(?(#|number|no\.?|id)\s*:?\s*[\w-]*\d/i, /\b(has been|was) received and (is|will be)\b/i,
  /\bdelivery (to the following recipient|has failed)|\baddress (couldn't|could not) be found\b|\bmessage (wasn't|was not) delivered\b/i,
];
const AUTO_FROM = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|donotreply|bounce[s]?|auto-?reply|notifications?)@/i;

/** An auto reply, not a person: out of office, automated acknowledgements, bounces, ticket systems. */
export function isAutoReply(r: IRep): boolean {
  if (r.type && /auto/i.test(r.type)) return true;   // the webhook's own "auto_reply_received"
  if (AUTO_FROM.test((r.from || r.lead || "").trim())) return true;
  const subject = (r.subject || "").split(/\b(re|aw|fwd?|sv|antw)\s*:/i)[0] || "";
  if (subject && AUTO_SUBJECT.some((x) => x.test(subject))) return true;
  const body = (r.opening || "").slice(0, 600);
  return AUTO_BODY.some((x) => x.test(body));
}

/** A real reply: to one of the developer's campaigns, or in a thread he wrote in by hand (not a promo to a sending inbox). */
export function isLeadReply(r: IRep, handThreads: Set<string>): boolean {
  return !!r.id && !!r.at && !Number.isNaN(Date.parse(r.at)) && (!!r.campaignId || (!!r.threadId && handThreads.has(r.threadId)));
}

const clean = (s: string) => s.replace(/[^\w-]/g, "").slice(0, 36);
/** One card per thread: the thread when Instantly gave one, else the email. */
const cardKey = (r: IRep) => clean(r.threadId || r.id || "");
/** The email itself: the same from the webhook and from the minute feed. */
const emailKey = (r: IRep) => clean(r.id || "");
/** A remind for this reply: under the thread for this very reply, or under the email (any time: one email, one reply). */
const remindOf = (st: LeadCardState | undefined, key: string, email: string, at: string) => {
  const m = st?.remind?.[key];
  if (m && m.for === at) return m;
  const e = email && email !== key ? st?.remind?.[email] : undefined;
  return e || undefined;
};
const reminding = (st: LeadCardState | undefined, key: string, email: string, at: string, now: number) => {
  const m = remindOf(st, key, email, at);
  return !!m && Date.parse(m.at) > now;
};
/** a is the same time as b or later. By the clock, not the text: the webhook writes "...00Z" where the feed
 *  writes "...00.000Z" for the same second, and as text the first sorts after the second. */
const notBefore = (a: string, b: string) => { const x = Date.parse(a), y = Date.parse(b); return Number.isNaN(x) || Number.isNaN(y) ? a >= b : x >= y; };
/** Dismissed: this email (one email, one card, whatever time its copy carries), or the thread up to this reply. */
const dismissed = (st: LeadCardState | undefined, key: string, email: string, at: string) =>
  !!(email && st?.seen?.[email]) || !!(st?.seen?.[key] && notBefore(st.seen[key], at));

function nameOf(r: IRep) {
  const n = (r.fromName || "").replace(/["']/g, "").trim();
  if (n && !n.includes("@")) return n.split(/\s+/)[0];
  const local = (r.from || r.lead || "").split("@")[0] || "A lead";
  return local.charAt(0).toUpperCase() + local.slice(1);
}
function companyOf(r: IRep) {
  const d = (r.from || r.lead || "").split("@")[1] || "";
  return d && !FREE.test(d) ? d.toLowerCase() : "";
}

/** Newest human reply per thread, after `since`, not dismissed or reminded for later. Newest first. */
export function leadCards(feed: { replies?: IRep[]; sent?: IRep[] } | null | undefined, st: LeadCardState | undefined, now = Date.now(), max = 20): LeadCard[] {
  if (!feed || !st?.since) return [];
  const hand = new Set((feed.sent || []).map((s) => s.threadId).filter((t): t is string => !!t));
  // One email can be in the feed twice (the webhook's copy without a thread, the feed's with one): keep one,
  // the one with the thread, so it never makes two cards with the same id.
  const byEmail = new Map<string, IRep>();
  for (const r of feed.replies || []) {
    if (!isLeadReply(r, hand) || isAutoReply(r) || r.at! <= st.since) continue;
    const e = emailKey(r), was = byEmail.get(e);
    if (!was || (!was.threadId && !!r.threadId) || (!was.threadId === !r.threadId && r.at! > was.at!)) byEmail.set(e, r);
  }
  const newest = new Map<string, IRep>();
  for (const r of byEmail.values()) {
    const k = cardKey(r);
    const was = newest.get(k);
    if (k && (!was || r.at! > was.at!)) newest.set(k, r);
  }
  return [...newest.entries()]
    .filter(([k, r]) => !dismissed(st, k, emailKey(r), r.at!) && !reminding(st, k, emailKey(r), r.at!, now))
    .sort((a, b) => b[1].at!.localeCompare(a[1].at!))
    .slice(0, max)
    .map(([k, r]) => {
      const e = emailKey(r);
      const m = remindOf(st, k, e, r.at!);
      const shownAt = Math.max(Date.parse(r.at!), m ? Date.parse(m.at) || 0 : 0);
      return {
        // rev: the phone shows each revision once (ps-gos NoteLedger.kt). Not the reply time: the webhook's
        // and the feed's can differ for the same email. Only a remind coming due makes a new one.
        id: `n:${e || k}`.slice(0, 40), key: k, email: e, rev: m ? m.at : "", title: `${nameOf(r)} replied in Instantly`,
        sub: [companyOf(r), (r.subject || "").trim()].filter(Boolean).join(" · ").slice(0, 200),
        body: firstSentences(r.opening || "", 4).slice(0, 600),
        url: r.url && /^https:\/\/app\.instantly\.ai\//.test(r.url) ? r.url : UNIBOX, at: r.at!,
        fresh: now - shownAt < 180_000,
        name: nameOf(r), company: companyOf(r), subject: (r.subject || "").trim().slice(0, 200),
      };
    });
}

/** Dismiss, or Remind me in N minutes, on one card. Returns the new state, or null when nothing changes. */
export function leadAnswer(st: LeadCardState, cards: LeadCard[], id: string, action: "dismiss" | number, now = Date.now()): LeadCardState | null {
  // Not in the list (the feed moved on since the card was drawn): a Dismiss still holds, under the email id the card carries.
  const c = cards.find((x) => x.id === id) || (action === "dismiss" && /^n:[\w-]+$/.test(id) ? { key: id.slice(2), email: id.slice(2), at: new Date(now).toISOString() } : null);
  if (!c) return null;
  if (action === "dismiss" && dismissed(st, c.key, c.email, c.at)) return null;   // already gone: nothing to save (egress)
  // Old marks go (the feed only holds the newest replies): dismissed over 30 days ago, reminds a day past due.
  const seen = Object.fromEntries(Object.entries(st.seen || {}).filter(([, at]) => Date.parse(at) > now - 30 * 864e5));
  const remind = Object.fromEntries(Object.entries(st.remind || {}).filter(([, v]) => Date.parse(v.at) > now - 864e5));
  // Under the thread and under the email too: the webhook's and the feed's reply time can differ for the same email.
  const keys = [c.key, ...(c.email && c.email !== c.key ? [c.email] : [])];
  if (action === "dismiss") for (const k of keys) { seen[k] = c.at; delete remind[k]; }
  else {
    const m = { at: new Date(now + Math.max(LEAD_REMIND.min, Math.min(LEAD_REMIND.max, Math.round(action))) * 60_000).toISOString(), for: c.at };
    for (const k of keys) remind[k] = m;
  }
  return { ...st, seen, remind };
}

/** Two devices' copies of the state joined (the vault's settings merger, core/cardsync.ts): a Dismiss on either
 *  holds (the later time per key), the later remind per key, and a remind for a reply already dismissed goes. */
export function mergeLeadState(a: LeadCardState | undefined, b: LeadCardState | undefined): LeadCardState | undefined {
  if (!a || !b) return a || b;
  const seen: Record<string, string> = { ...(b.seen || {}) };
  for (const [k, at] of Object.entries(a.seen || {})) if (!seen[k] || notBefore(at, seen[k])) seen[k] = at;
  const remind: Record<string, { at: string; for: string }> = { ...(b.remind || {}) };
  for (const [k, m] of Object.entries(a.remind || {})) if (!remind[k] || notBefore(m.at, remind[k].at)) remind[k] = m;
  for (const [k, m] of Object.entries(remind)) if (seen[k] && (!m.for || notBefore(seen[k], m.for))) delete remind[k];
  return { ...b, ...a, seen, remind };
}

/** When the next reminded lead card comes back (ms since 1970), or 0. */
export function nextLeadRemind(st: LeadCardState | undefined, now = Date.now()): number {
  let next = 0;
  for (const v of Object.values(st?.remind || {})) { const at = Date.parse(v.at); if (at > now && (!next || at < next)) next = at; }
  return next;
}

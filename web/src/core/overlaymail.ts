// Reply from the Tab overlay (the developer, 10 Nov 2026: "I still don't see the ability to reply to emails in the tab overlay").
// Until now the only ways into the reply panel were the Reply button on the email pop up cards (top right) and
// Settings, Reply from PS. Once a card was dismissed, the Tab list's email panel had Open (Gmail) and Done only.
// This file holds the rules for that panel, kept apart from the views so they can be tested:
//  - the rows: client emails not dealt with yet (Gmail "reply" records) plus open lead replies (Instantly), newest first;
//  - when the Reply button shows (PS on the Mac, the developer's account, an email PS can answer);
//  - the card id a Reply or a lead's Done carries to the main page (the same ids the pop up cards use).
// Nothing here sends. Reply only opens the panel; the developer writes the words and presses Send himself (hard rule 7).
import type { LeadCard } from "./leadcards";

/** One email in the Tab list's email panel. */
export interface MailRow {
  /** The pop up card id for the same email: "m:<reply record id>" (Gmail) or "n:<Instantly email id>". */
  cardId: string;
  via: "gmail" | "instantly" | "proton";
  /** Gmail: the reply record, for Done (marks it handled). */
  replyId?: string;
  who: string;
  company: string | null;
  subject: string;
  preview: string;
  at: string;
  /** Open: the Gmail thread, or the email in Instantly's Unibox. */
  url: string;
  count: number;
}

/** A lead reply as the overlay mirror carries it (small: no feed, no other replies). */
export type LeadRow = Omit<MailRow, "via" | "replyId" | "count">;

/** The ids a card can have; anything else from the overlay is ignored. */
const CARD_ID = /^[mnp]:[\w-]{1,38}$/;
export function cleanReplyCardId(v: unknown): string | null {
  return typeof v === "string" && CARD_ID.test(v) ? v : null;
}
/** The card id for a Gmail reply record, exactly as the pop up card makes it (core/mailcards.ts). */
export const gmailCardId = (replyId: string) => `m:${replyId}`.slice(0, 40);

/** Where the Reply button shows: only PS on the Mac (it sends from the Mac's Keychain sign ins), only with Client emails on
 *  (core/mailswitch.ts), and only for an email PS can answer. The website and the phone keep Open. */
export function replyButtonShows(o: { mode: string; mail: boolean; cardId: string | null | undefined }): boolean {
  return o.mode === "ps" && o.mail && !!cleanReplyCardId(o.cardId);
}

/**
 * What a Reply click on a panel row does (PS 1.65, the developer, 17 Nov 2026: "I want that same interface to pop up when you
 * click Reply on a client email in the client emails panel"). On the Mac, Reply opens the SAME reply window the email pop up
 * cards open (a Gmail, Instantly or Proton row, from the main page or the Tab list). Nothing is sent by the click: the window
 * sends only on Send, with Undo. On the website and the phone there is no reply window, so the small box inside the row stays.
 *  "window": ask the main page to open the reply window with this email.
 *  "box": the small reply box in the row.  "none": no Reply button.
 */
export function replyRoute(o: { mode: string; mail: boolean; cardId: string | null | undefined; boxOn: boolean; protonOn: boolean }): "window" | "box" | "none" {
  const id = cleanReplyCardId(o.cardId);
  if (!id) return "none";
  const proton = id.startsWith("p:");
  if (proton && !o.protonOn) return "none";
  if (o.mode === "ps" && (o.mail || proton)) return "window";
  return o.boxOn && !proton ? "box" : "none";
}

/** Lead reply cards (core/leadcards.ts) as rows: the first name, the company domain, the subject, the opening. */
export function leadRows(cards: LeadCard[], max = 6): LeadRow[] {
  return cards.slice(0, max).map((c) => ({
    cardId: c.id,
    who: c.name || c.title.replace(/ replied in Instantly$/, ""),
    company: c.company || null,
    subject: c.subject ?? "",
    preview: c.body,
    at: c.at,
    url: c.url,
  }));
}

/** The overlay mirror's lead rows, checked (the main page sends them; anything odd is dropped). */
export function cleanLeadRows(v: unknown, max = 6): LeadRow[] {
  if (!Array.isArray(v)) return [];
  const str = (x: unknown, n: number) => (typeof x === "string" ? x.slice(0, n) : "");
  const out: LeadRow[] = [];
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const cardId = cleanReplyCardId(o.cardId);
    const url = str(o.url, 400);
    if (!cardId || !cardId.startsWith("n:") || !/^https:\/\/app\.instantly\.ai\//.test(url) || !str(o.at, 40)) continue;
    out.push({ cardId, who: str(o.who, 80) || "A lead", company: str(o.company, 120) || null, subject: str(o.subject, 200), preview: str(o.preview, 600), at: str(o.at, 40), url });
    if (out.length >= max) break;
  }
  return out;
}

/** Client emails and lead replies together, newest first. */
export function mailRows(gmail: MailRow[], leads: LeadRow[], max = 6): MailRow[] {
  const all: MailRow[] = [...gmail, ...leads.map((l): MailRow => ({ ...l, via: "instantly", count: 1 }))];
  return all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, max);
}

// The Tab overlay holds no Instantly feed: the main page sends the open lead rows with the overlay's state
// ({type:"state"} field "leads", the developer only), and this keeps them for the email panel.
let mirror: LeadRow[] = [];
const subs = new Set<() => void>();
export function setLeadMirror(v: unknown) {
  const next = cleanLeadRows(v);
  if (JSON.stringify(next) === JSON.stringify(mirror)) return;
  mirror = next;
  subs.forEach((f) => f());
}
export const leadMirror = {
  get: (): LeadRow[] => mirror,
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};

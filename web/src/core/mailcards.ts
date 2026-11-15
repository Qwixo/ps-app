// Client email cards that stay until the developer clicks Dismiss (the developer, 20 Oct 2026: "so I will absolutely see
// it"). One card per client email thread whose newest email he has not dismissed yet. Dismissed is
// kept in the vault on the reply record itself (Reply.seenAt = the date of the email he dismissed),
// encrypted like everything else, so PS (the pop-up stack) and the website (the stack in the corner)
// show the same cards and a Dismiss on either clears both. A newer email in the thread shows a card
// again. Only mail after settings.mailCardsSince counts, so old mail never floods in.
// "Remind me in 15 mins" (the developer, 27 Oct 2026): the card goes away and comes back at that time, still
// waiting for a Dismiss. The time is kept on the same reply record (Reply.remindAt, for the email in
// Reply.remindFor), so a remind set on the Mac hides the card on the phone too and both bring it back.
// A newer email in the thread shows the card at once; a Dismiss always wins.
// Beside client emails, the developer's own lists decide too (core/mailrules.ts, 4 Nov 2026): "Always notify me" senders get a card
// with no client name, a muted sender never gets one, and his own Gmail accounts never do.
import type { ClientRec, Doc, Reply, Settings } from "./model";
import { firstSentences, gmailThreadLink, replierName } from "./mail.ts";
import { mailVerdict, ownAccounts, type MailRules } from "./mailrules.ts";

export interface MailCard {
  id: string;           // "m:" + the reply record id (at most 40 characters)
  replyId: string;
  title: string;        // "Alex just sent an email"
  sub: string;          // company · subject
  body: string;         // the first 4 sentences
  url: string;          // the thread in the right Gmail account
  at: string;           // when the newest email came
  rev: string;          // the newest email's Message-ID (its date for older records), and when its "Remind me in" came due: the phone shows each revision once
  client: boolean;      // a client's email (false: a sender on the developer's "Always notify me" list)
  from?: string;        // V1.43: the sender, so a focus mode's "always gets through" people can come through
  fromName?: string | null;
}

/** The lists in the settings record that came with these records (the newest settings copy if there are two). */
function rulesIn(all: Doc<unknown>[]): MailRules | undefined {
  const st = all.filter((d) => d.kind === "settings").sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))[0];
  return (st?.data as Settings | undefined)?.mailRules;
}
/** Would this reply record pop up under the developer's lists (client, notify list, not muted, not his own account)? */
function pops(r: Reply, rules: MailRules | undefined, own: Set<string>) {
  return mailVerdict(r.from, r.clientId || null, rules, own).pop;
}

export const isUnseen = (r: Reply, since: string | null | undefined) =>
  !!r.date && (!since || r.date > since) && (!r.seenAt || r.seenAt < r.date);

/** The remind picker: 15 minutes to start, 5 minutes per wheel notch or drag step, 5 minutes to 4 hours. */
export const REMIND = { start: 15, step: 5, min: 5, max: 240 } as const;
export const stepRemind = (mins: number, dir: number) =>
  Math.max(REMIND.min, Math.min(REMIND.max, Math.round(mins / REMIND.step) * REMIND.step + Math.sign(dir) * REMIND.step));
/** "15 mins", then hours and minutes past 60 ("1h", "1h 25m"), so the button keeps one width. */
export const remindText = (mins: number) => mins < 60 ? `${mins} mins` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}`;
/** The fields a remind writes on the reply record. */
export const remindPatch = (r: Reply, mins: number, now = Date.now()) =>
  ({ remindAt: new Date(now + Math.max(REMIND.min, Math.min(REMIND.max, mins)) * 60_000).toISOString(), remindFor: r.date });
/** Hidden for now by "Remind me in": only for the email it was set on, only until the time comes. */
export const isReminding = (r: Reply, now = Date.now()) =>
  !!r.remindAt && r.remindFor === r.date && Date.parse(r.remindAt) > now;
/** When the next reminded card comes back (ms since 1970), or 0 when none is waiting. */
export function nextRemind(docs: Iterable<Doc<unknown>>, since: string | null | undefined, now = Date.now()): number {
  let next = 0;
  const all = [...docs], rules = rulesIn(all), own = ownAccounts(all);
  for (const g of groupReplies(all)) {
    const r = g.merged;
    if (!isUnseen(r, since) || !isReminding(r, now) || !pops(r, rules, own)) continue;
    const at = Date.parse(r.remindAt!);
    if (!next || at < next) next = at;
  }
  return next;
}

/** Two devices' copies of one reply record joined (the vault's reply merger, core/cardsync.ts): the copy with the
 *  newer email, a Dismiss on either (the later seenAt) and the later remind. Without it a device still holding the
 *  old copy (a Gmail package opened on the phone while the Mac dismissed) wrote it back and the card returned. */
export function mergeReply(a: Reply, b: Reply): Reply {
  const base = (b.date || "") > (a.date || "") ? b : a;
  const seenAt = [a.seenAt, b.seenAt].filter((v): v is string => !!v).sort().pop();
  const rem = [a, b].filter((r) => r.remindAt && r.remindFor).sort((x, y) => x.remindAt!.localeCompare(y.remindAt!)).pop();
  const out: Reply = { ...base };
  if (seenAt) out.seenAt = seenAt;
  if (rem) { out.remindAt = rem.remindAt; out.remindFor = rem.remindFor; }
  return out;
}

/** Records of one thread folded into one: the winner (the newest email, then the smallest id, so it never flips) and the
 *  joined copy (a Dismiss on any copy, the latest Remind). */
export interface ReplyGroup { id: string; ids: string[]; merged: Reply }
export function groupReplies(docs: Iterable<Doc<unknown>>): ReplyGroup[] {
  const by = new Map<string, Doc<Reply>[]>();
  for (const d of docs) {
    if (d.kind !== "reply") continue;
    const r = d.data as Reply;
    const k = r.threadId ? `${(r.account || "").toLowerCase()}|${r.threadId}` : `solo|${d.id}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(d as Doc<Reply>);
  }
  const out: ReplyGroup[] = [];
  for (const list of by.values()) {
    list.sort((a, b) => (b.data.date || "").localeCompare(a.data.date || "") || a.id.localeCompare(b.id));
    let merged = list[0].data;
    for (const d of list.slice(1)) merged = mergeReply(merged, d.data);
    out.push({ id: list[0].id, ids: list.map((d) => d.id), merged });
  }
  return out;
}

/** The cards still waiting for a Dismiss and not reminded for later, newest first (at most `max`). */
export function mailCards(docs: Iterable<Doc<unknown>>, since: string | null | undefined, max = 20, now = Date.now()): MailCard[] {
  const all = [...docs];
  const clients = new Map(all.filter((d) => d.kind === "client").map((d) => [d.id, d as Doc<ClientRec>]));
  const rules = rulesIn(all), own = ownAccounts(all);
  // One card per thread, however many records it has (core/maildedupe.ts): the winner's id, the joined Dismiss and Remind.
  return groupReplies(all)
    .filter((g) => isUnseen(g.merged, since) && !isReminding(g.merged, now) && pops(g.merged, rules, own))
    .map((g) => ({ id: g.id, data: g.merged }))
    .sort((a, b) => b.data.date.localeCompare(a.data.date))
    .slice(0, max)
    .map((r) => {
      const c = clients.get(r.data.clientId);
      const name = replierName(c?.data, r.data);
      const company = c && c.data.name.toLowerCase() !== name.toLowerCase() ? c.data.name : null;
      return {
        id: `m:${r.id}`.slice(0, 40), replyId: r.id, title: `${name} just sent an email`,
        sub: [company, r.data.subject].filter(Boolean).join(" · "),
        body: firstSentences(r.data.opening || r.data.snippet, 4),
        url: gmailThreadLink(r.data.account, r.data.threadId), at: r.data.date,
        rev: `${r.data.lastKey || r.data.date}|${r.data.remindAt && r.data.remindFor === r.data.date ? r.data.remindAt : ""}`,   // the email's Message-ID, never a time of its own
        client: !!r.data.clientId,
        from: r.data.from, fromName: r.data.fromName ?? null,
      };
    });
}

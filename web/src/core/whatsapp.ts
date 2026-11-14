// WhatsApp replies in PS (PS 1.60, pull request 9). A carbon copy of the client email cards for WhatsApp messages.
// The server (supabase/functions/whatsapp-webhook) seals each message to the owner's key and puts it in the inbox;
// the vault opens it here and folds it into ONE "wachat" record per sender (id worked out from their number, so two
// devices write the same record and the merger joins them). Pure: no DOM, no network, so every rule is unit tested.
//  * Dismiss and Remind live on the chat record (seenAt, remindAt), so a Dismiss on one device clears it on all of them.
//  * Each message notifies once per device, keyed by its WhatsApp message id (the same ledger as client emails).
//  * The 24 hour customer service window: a free text reply is allowed for 24 hours after the person's last message;
//    after that PS shows "Send a template" instead (the server enforces the same rule).
//  * Photos, voice notes and files show as "Photo", "Voice note" or "File" with Open in WhatsApp. Text replies only.
//  * PS never sends by itself: a reply leaves only after the person's Send click and the 10 second Undo.
import type { ClientRec, Doc, Settings } from "./model.ts";
import { firstSentences } from "./mail.ts";

// ---------- records ----------
export type WaKind = "text" | "photo" | "voice" | "audio" | "video" | "file" | "sticker" | "location" | "contact" | "reaction" | "button" | "unsupported" | "other";
export type WaTicks = "sending" | "sent" | "delivered" | "read" | "failed";
export interface WaMsg { id: string; at: string; dir: "in" | "out"; kind: WaKind; text: string; ticks?: WaTicks; error?: string; fileName?: string }
export interface WaChat {
  v: 1;
  wa: string;                    // the sender's number, digits only (international format); "" when they only have a username
  userId?: string | null;        // Meta's business scoped id, when that is all there is
  name: string | null;           // the profile name they chose
  clientId: string | null;       // matched by phone number (core/whatsapp.ts matchClient)
  lastInAt: string;              // their newest message: the 24 hour window starts here
  lastKey: string;               // the newest incoming message id: what a notification is keyed by
  msgs: WaMsg[];                 // the last 30
  seenAt?: string | null;        // lastInAt of the message whose card was dismissed
  remindAt?: string | null;
  remindFor?: string | null;
}
export interface WaPrefs {
  on?: boolean;                  // WhatsApp messages on or off (default on once linked)
  notify?: boolean;              // cards and notifications (default on)
  sound?: boolean;               // the chime (default on)
  markRead?: boolean;            // mark as read when I reply (default on)
  muted?: string[];              // numbers that never notify
  always?: string[];             // numbers that always notify
  country?: string;              // calling code for numbers typed without one, digits only ("421")
  templates?: { name: string; language: string; text: string }[];   // approved templates with nothing to fill in (not secret), so the Tab list can offer them
  templatesAt?: string | null;
  since?: string | null;         // cards only for messages after this (set the first time WhatsApp is on)
  linkedAt?: string | null;      // when the first message landed after linking
}
export const MSG_KEEP = 30;
export const WINDOW_MS = 24 * 3600_000;
export const prefsOf = (st: Pick<Settings, "wa"> | null | undefined): WaPrefs => (st?.wa ?? {}) as WaPrefs;

// ---------- phone numbers ----------
/** International format, digits only. "+1 (650) 555-1234", "001 650 555 1234" and "16505551234" are one number. A number
 *  typed with a leading 0 (national form) needs the person's own calling code (`country`); without one it is not guessed. */
export function normalizePhone(input: unknown, country?: string | null): string | null {
  if (typeof input !== "string") return null;
  // An extension is not part of the number; "tel:" is a link prefix; "+44 (0)7700 ..." writes the dropped trunk 0 in brackets, it is not dialled from abroad.
  const raw = input.trim().replace(/^tel:/i, "").replace(/\s*(?:ext\.?|x)\s*\d+$/i, "").replace(/(^\+\s*\d{1,3}\s*)\(0\)/, "$1");
  if (!raw || /[a-z]/i.test(raw)) return null;
  const plus = raw.startsWith("+");
  let d = raw.replace(/\D/g, "");
  if (!plus && d.startsWith("00")) d = d.slice(2);
  else if (!plus && d.startsWith("0")) {
    const cc = (country || "").replace(/\D/g, "");
    if (!cc) return null;
    d = cc + d.replace(/^0+/, "");
  }
  return d.length >= 7 && d.length <= 15 ? d : null;
}
/** Two numbers for the same phone: equal in international form. */
export const samePhone = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a === b;
/** A readable form for the card when there is no name: "+16505551234". */
export const showPhone = (wa: string) => (wa ? `+${wa}` : "an unknown number");

/** The client whose phone is this number. Exact match first; one client only (two clients with one number match nobody,
 *  so a card never carries the wrong name). Mexican and Argentine numbers WhatsApp writes with an extra digit
 *  (52 1..., 54 9...) also match the plain form. */
export function matchClient(clients: Doc<ClientRec>[], wa: string | null | undefined, country?: string | null): string | null {
  if (!wa) return null;
  const hits = new Set<string>();
  const alt = (n: string) => n.replace(/^(52)1(\d{10})$/, "$1$2").replace(/^(54)9(\d{10})$/, "$1$2");
  for (const c of clients) {
    if (c.data.archived) continue;
    for (const p of [c.data.phone, ...(c.data.phones || [])]) {
      const n = normalizePhone(p ?? "", country);
      if (n && (n === wa || alt(n) === alt(wa))) hits.add(c.id);
    }
  }
  return hits.size === 1 ? [...hits][0] : null;
}

// ---------- what a message says ----------
const LABEL: Record<WaKind, string> = {
  text: "", photo: "Photo", voice: "Voice note", audio: "Audio", video: "Video", file: "File", sticker: "Sticker", location: "Location",
  contact: "Contact", reaction: "Reaction", button: "", unsupported: "Message", other: "Message",
};
/** What the card and the row show for one message: the words, or "Photo", "Voice note", "File" (with a caption after it). */
export function showMsg(m: Pick<WaMsg, "kind" | "text" | "fileName">): string {
  const label = LABEL[m.kind];
  if (!label) return m.text.trim();
  if (m.kind === "reaction") return `Reacted ${m.text}`.trim();
  if (m.kind === "unsupported") return "A message WhatsApp could not show here";
  const extra = m.kind === "file" && m.fileName ? ` ${m.fileName}` : "";
  return m.text.trim() ? `${label}${extra}: ${m.text.trim()}` : `${label}${extra}`;
}
export const isMedia = (k: WaKind) => ["photo", "voice", "audio", "video", "file", "sticker"].includes(k);

// ---------- the chat record ----------
/** One id for the chat record of a number (a version 5 style UUID), so two devices write the SAME record. */
export async function waChatIdFor(key: string): Promise<string> {
  const data = new TextEncoder().encode(`ps-whatsapp-chat|${key}`);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
export const chatKey = (e: { from?: string | null; userId?: string | null }) => e.from || (e.userId ? `u:${e.userId}` : "");

/** What the webhook sealed for one incoming message (supabase/functions/whatsapp-webhook/lib.ts WaIn). */
export interface WaEvent { id: string; at: string; from: string | null; userId?: string | null; name: string | null; kind: WaKind; text: string; mediaId?: string; fileName?: string; replyTo?: string }
export interface WaStatusEvent { id: string; status: "sent" | "delivered" | "read" | "failed" | "played"; at: string; recipient: string | null; error?: string }

const RANK: Record<WaTicks, number> = { sending: 0, sent: 1, delivered: 2, read: 3, failed: 4 };
/** Ticks only move forward. A failure counts only while the message has not been delivered. */
function better(a: WaTicks | undefined, b: WaTicks | undefined): WaTicks | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a === "failed") return RANK[b] >= 2 ? b : a;
  if (b === "failed") return RANK[a] >= 2 ? a : b;
  return RANK[a] >= RANK[b] ? a : b;
}
const trim = (msgs: WaMsg[]) => [...msgs].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)).slice(-MSG_KEEP);

/** An incoming message folded into the chat. The same message id twice changes nothing (returns null). */
export function applyInbound(ex: WaChat | undefined, e: WaEvent, clientId: string | null): WaChat | null {
  if (ex?.msgs.some((m) => m.id === e.id)) return null;
  if (e.kind === "reaction" && !ex) return null;   // a reaction alone starts no chat and opens no window
  const msg: WaMsg = { id: e.id, at: e.at, dir: "in", kind: e.kind, text: e.text.slice(0, 4096), ...(e.fileName ? { fileName: e.fileName } : {}) };
  const newest = !ex || (e.kind !== "reaction" && e.at >= ex.lastInAt);
  return {
    v: 1, wa: e.from || ex?.wa || "", userId: e.userId ?? ex?.userId ?? null, name: e.name || ex?.name || null, clientId: clientId ?? ex?.clientId ?? null,
    lastInAt: newest ? e.at : ex!.lastInAt, lastKey: newest ? e.id : ex!.lastKey, msgs: trim([...(ex?.msgs || []), msg]),
    seenAt: ex?.seenAt ?? null, remindAt: ex?.remindAt ?? null, remindFor: ex?.remindFor ?? null,
  };
}
/** A delivery status for a message the person sent: the ticks only move forward (sent, delivered, read), a failure shows why. */
export function applyStatus(chat: WaChat, s: WaStatusEvent): WaChat | null {
  const i = chat.msgs.findIndex((m) => m.id === s.id && m.dir === "out");
  if (i < 0) return null;
  const to: WaTicks = s.status === "played" ? "read" : s.status;
  const cur = chat.msgs[i];
  const next = better(cur.ticks, to);
  if (next === cur.ticks && !(next === "failed" && !cur.error)) return null;
  const msgs = chat.msgs.slice();
  msgs[i] = { ...cur, ticks: next, ...(to === "failed" && next === "failed" ? { error: (s.error || "WhatsApp could not deliver it.").slice(0, 200) } : {}) };
  return { ...chat, msgs };
}
/** The person's own reply, added once the server accepted it (id = the WhatsApp message id it returned). */
export function applyOutbound(chat: WaChat, o: { id: string; text: string; at: string }): WaChat {
  if (chat.msgs.some((m) => m.id === o.id)) return chat;
  return { ...chat, msgs: trim([...chat.msgs, { id: o.id, at: o.at, dir: "out", kind: "text", text: o.text.slice(0, 4096), ticks: "sent" }]) };
}
/** Two devices' copies joined: every message once (the further ticks win), a Dismiss on either (the later seenAt), the later remind. */
export function mergeChat(a: WaChat, b: WaChat): WaChat {
  const by = new Map<string, WaMsg>();
  for (const m of [...a.msgs, ...b.msgs]) { const o = by.get(m.id); by.set(m.id, o ? { ...o, ticks: better(o.ticks, m.ticks), ...(o.error || m.error ? { error: o.error || m.error } : {}) } : m); }
  const base = b.lastInAt > a.lastInAt ? b : a;
  const seenAt = [a.seenAt, b.seenAt].filter((v): v is string => !!v).sort().pop() ?? null;
  const rem = [a, b].filter((c) => c.remindAt && c.remindFor).sort((x, y) => x.remindAt!.localeCompare(y.remindAt!)).pop();
  return { ...base, name: base.name || a.name || b.name, clientId: base.clientId || a.clientId || b.clientId, msgs: trim([...by.values()]), seenAt, remindAt: rem?.remindAt ?? null, remindFor: rem?.remindFor ?? null };
}

// ---------- the 24 hour window ----------
export interface WaWindow { open: boolean; msLeft: number; text: string }
export function windowOf(chat: Pick<WaChat, "lastInAt"> | null | undefined, now = Date.now()): WaWindow {
  const t = chat?.lastInAt ? Date.parse(chat.lastInAt) : NaN;
  const left = Number.isFinite(t) ? t + WINDOW_MS - now : 0;
  if (left <= 0) return { open: false, msLeft: 0, text: "The 24 hour window is closed." };
  const mins = Math.floor(left / 60_000), h = Math.floor(mins / 60);
  return { open: true, msLeft: left, text: h >= 1 ? `You can reply for ${h} more hour${h === 1 ? "" : "s"}` : `You can reply for ${Math.max(1, mins)} more minute${mins <= 1 ? "" : "s"}` };
}
/** What Send does for this chat now: a free text reply, or the template list (outside the window), or nothing (no number to answer). */
export function replyPlan(chat: WaChat, now = Date.now()): "text" | "template" | "none" {
  if (!chat.wa) return "none";
  return windowOf(chat, now).open ? "text" : "template";
}

// ---------- who gets through ----------
/** Does this chat pop up under the person's lists? Muted never, "always" even when notifications are off, else the switches. */
export function waPops(chat: Pick<WaChat, "wa">, p: WaPrefs): boolean {
  if (p.on === false) return false;
  if (chat.wa && (p.muted || []).includes(chat.wa)) return false;
  if (chat.wa && (p.always || []).includes(chat.wa)) return true;
  return p.notify !== false;
}
/** Add or remove a number in the muted or always list (a number is in at most one). */
export function setListed(p: WaPrefs, list: "muted" | "always", phone: unknown, add: boolean): WaPrefs {
  const n = normalizePhone(phone, p.country);
  if (!n) return p;
  const other = list === "muted" ? "always" : "muted";
  const cur = (p[list] || []).filter((x) => x !== n);
  return { ...p, [list]: add ? [...cur, n].slice(-100) : cur, [other]: (p[other] || []).filter((x) => x !== n) };
}

// ---------- cards ----------
/** The client of a chat: the one saved on it, else matched now by phone number (so a number added to a client later still shows). */
export function clientOfChat(chat: WaChat, clients: Doc<ClientRec>[], country?: string | null): string | null {
  return chat.clientId ?? matchClient(clients, chat.wa, country);
}

export interface WaCard {
  id: string; chatId: string; title: string; sub: string; body: string; url: string; at: string;
  rev: string;            // the newest incoming message id (and when its Remind came due): each revision notifies once
  client: boolean; wa: string; name: string | null;
}
export const waCardId = (chatId: string) => `w:${chatId}`.slice(0, 40);
export const isWaCard = (id: unknown): boolean => typeof id === "string" && /^w:[\w-]{1,38}$/.test(id);
/** Open this chat in the WhatsApp app (or WhatsApp Web on the website): wa.me needs the number, digits only. */
export const waOpenUrl = (wa: string) => wa ? `https://wa.me/${wa}` : "https://web.whatsapp.com/";

export const isUnseenChat = (c: WaChat, since: string | null | undefined) =>
  !!c.lastInAt && (!since || c.lastInAt > since) && (!c.seenAt || c.seenAt < c.lastInAt);
export const isRemindingChat = (c: WaChat, now = Date.now()) => !!c.remindAt && c.remindFor === c.lastInAt && Date.parse(c.remindAt) > now;
export const waRemindPatch = (c: WaChat, mins: number, now = Date.now()) =>
  ({ remindAt: new Date(now + Math.max(5, Math.min(240, mins)) * 60_000).toISOString(), remindFor: c.lastInAt });

/** One chat record per number, however many devices wrote one: joined, newest message first. */
export function groupChats(docs: Iterable<Doc<unknown>>): { id: string; ids: string[]; chat: WaChat }[] {
  const by = new Map<string, Doc<WaChat>[]>();
  for (const d of docs) {
    if (d.kind !== "wachat") continue;
    const c = d.data as WaChat;
    const k = c.wa || `u:${c.userId || d.id}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(d as Doc<WaChat>);
  }
  const out: { id: string; ids: string[]; chat: WaChat }[] = [];
  for (const list of by.values()) {
    list.sort((a, b) => b.data.lastInAt.localeCompare(a.data.lastInAt) || a.id.localeCompare(b.id));
    let chat = list[0].data;
    for (const d of list.slice(1)) chat = mergeChat(chat, d.data);
    out.push({ id: list[0].id, ids: list.map((d) => d.id), chat });
  }
  return out;
}

export function waCards(docs: Iterable<Doc<unknown>>, since: string | null | undefined, p: WaPrefs, max = 20, now = Date.now()): WaCard[] {
  const all = [...docs];
  const clientList = all.filter((d) => d.kind === "client") as Doc<ClientRec>[];
  const clients = new Map(clientList.map((d) => [d.id, d]));
  return groupChats(all)
    .filter((g) => isUnseenChat(g.chat, since) && !isRemindingChat(g.chat, now) && waPops(g.chat, p))
    .sort((a, b) => b.chat.lastInAt.localeCompare(a.chat.lastInAt))
    .slice(0, max)
    .map((g) => {
      const c = g.chat, cid = clientOfChat(c, clientList, p.country), cl = cid ? clients.get(cid) : undefined;
      const name = (cl?.data.contactName || c.name || cl?.data.name || showPhone(c.wa)).trim();
      const last = [...c.msgs].filter((m) => m.dir === "in" && m.kind !== "reaction").pop();
      return {
        id: waCardId(g.id), chatId: g.id, title: `${name} sent a WhatsApp message`,
        sub: [cl && cl.data.name.toLowerCase() !== name.toLowerCase() ? cl.data.name : null, c.name && !cl ? showPhone(c.wa) : null].filter(Boolean).join(" · "),
        body: last ? firstSentences(showMsg(last), 4) : "", url: waOpenUrl(c.wa), at: c.lastInAt,
        rev: `${c.lastKey}|${c.remindAt && c.remindFor === c.lastInAt ? c.remindAt : ""}`, client: !!cl, wa: c.wa, name: c.name,
      };
    });
}

// ---------- the panel (Tab overlay, Inbox tab, phone Inbox page) ----------
export interface WaRow { clientId: string | null; out: WaMsg | null; cardId: string; chatId: string; who: string; company: string | null; preview: string; at: string; url: string; count: number; wa: string; window: WaWindow; plan: "text" | "template" | "none" }
/** Chats not dealt with yet (a Dismiss or Done clears them), newest first. Not hidden by Remind (the panel shows everything open). */
export function waRows(docs: Iterable<Doc<unknown>>, since: string | null | undefined, p: WaPrefs, max = 30, now = Date.now()): WaRow[] {
  const all = [...docs];
  const clientList = all.filter((d) => d.kind === "client") as Doc<ClientRec>[];
  const clients = new Map(clientList.map((d) => [d.id, d]));
  return groupChats(all)
    .filter((g) => isUnseenChat(g.chat, since) && p.on !== false && !(g.chat.wa && (p.muted || []).includes(g.chat.wa)))
    .sort((a, b) => b.chat.lastInAt.localeCompare(a.chat.lastInAt)).slice(0, max)
    .map((g) => {
      const c = g.chat, cid = clientOfChat(c, clientList, p.country), cl = cid ? clients.get(cid) : undefined;
      const who = (cl?.data.contactName || c.name || cl?.data.name || showPhone(c.wa)).trim();
      const last = [...c.msgs].filter((m) => m.dir === "in" && m.kind !== "reaction").pop();
      const lastOut = [...c.msgs].filter((m) => m.dir === "out").pop() ?? null;
      return { out: lastOut && lastOut.at >= c.lastInAt ? lastOut : null, cardId: waCardId(g.id), chatId: g.id, who, company: cl && cl.data.name.toLowerCase() !== who.toLowerCase() ? cl.data.name : null,
        preview: last ? showMsg(last) : "", at: c.lastInAt, url: waOpenUrl(c.wa), count: c.msgs.filter((m) => m.dir === "in" && m.at > (c.seenAt || "")).length || 1,
        wa: c.wa, clientId: cid, window: windowOf(c, now), plan: replyPlan(c, now) };
    });
}
/** A client's page: every chat matched to this client, with its messages (the same records, newest message last). */
export function chatsForClient(docs: Iterable<Doc<unknown>>, clientId: string, country?: string | null): { id: string; chat: WaChat }[] {
  const all = [...docs], clientList = all.filter((d) => d.kind === "client") as Doc<ClientRec>[];
  return groupChats(all).filter((g) => clientOfChat(g.chat, clientList, country) === clientId).map(({ id, chat }) => ({ id, chat })).sort((a, b) => b.chat.lastInAt.localeCompare(a.chat.lastInAt));
}
/** The next reminded chat comes back at this time (ms), or 0. */
export function nextWaRemind(docs: Iterable<Doc<unknown>>, since: string | null | undefined, p: WaPrefs, now = Date.now()): number {
  let next = 0;
  for (const g of groupChats(docs)) {
    const c = g.chat;
    if (!isUnseenChat(c, since) || !isRemindingChat(c, now) || !waPops(c, p)) continue;
    const at = Date.parse(c.remindAt!);
    if (!next || at < next) next = at;
  }
  return next;
}
/** Dismiss patch: the chat stays quiet until a newer message. A Dismiss always wins over a Remind. */
export const waSeenPatch = (c: WaChat) => ({ seenAt: c.lastInAt });

// ---------- quick replies ----------
// WhatsApp and email share ONE list (the one from the email panel, settings.mailReply.responses). Signatures stay email only:
// nothing here adds one. The same {first name} {name} {company} placeholders are filled in.
export { fillPlaceholders, responsesFor, responsesOf, type SavedResponse } from "./mailreply.ts";
export const firstOf = (name: string | null | undefined) => (name || "").trim().split(/\s+/)[0] || "";

// ---------- sending ----------
export const SEND_ERR = {
  closed: "The 24 hour window is closed. Send a template instead.",
  noNumber: "This person hides their number, so PS cannot answer. Reply in WhatsApp.",
  notLinked: "WhatsApp is not linked. Link it in Settings, WhatsApp settings.",
  failed: "Not sent. Try again.",
} as const;
/** What the page shows when whatsapp-send answered: Sent with the message id, or the reason in plain words. */
export function sendOutcome(r: { ok?: boolean; id?: string; error?: string } | null | undefined): { ok: true; id: string } | { ok: false; error: string; closed: boolean } {
  if (r?.ok && typeof r.id === "string") return { ok: true, id: r.id };
  if (r?.error === "window_closed") return { ok: false, error: SEND_ERR.closed, closed: true };
  if (r?.error === "not_linked") return { ok: false, error: SEND_ERR.notLinked, closed: false };
  return { ok: false, error: typeof r?.error === "string" && r.error ? r.error.slice(0, 200) : SEND_ERR.failed, closed: false };
}
export const TICK_TEXT: Record<WaTicks, string> = { sending: "Sending", sent: "Sent", delivered: "Delivered", read: "Read", failed: "Not sent" };

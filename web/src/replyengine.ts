// Reply from PS, the main page's half (core/mailreply.ts has the rules). PS Mac app only.
//  - A card's Reply button (ps-mac Toast.swift, cardAction "reply"), or Reply in the Tab list's email panel
//    (views/TaskMap.tsx ClientMail, a "looks" patch replyOpen, 10 Nov 2026), comes here: the email it is for becomes a
//    ReplyCtx and goes to the Mac with the signatures and saved responses ({type:"reply:open"}); the Mac opens the
//    compose window (ps-mac ReplyWindow.swift). Nothing is sent from here and nothing here can send.
//  - Signature and response changes (from the compose window or Settings) come as a "looks" patch mailReplyOp and
//    are saved in settings.mailReply, encrypted like the rest of the settings.
//  - When the Mac has really sent a reply ({type:"reply:sent", cardId}), that card is dismissed on every device.
//  - The prefs go to the Mac again whenever they change, so an open compose window shows a response just saved.
import { vaultStore } from "./core/vault";
import { settingsData } from "./core/select";
import { saveSettings } from "./core/actions";
import { applyMailReplyOp, cleanMailReplyOp, clientsForSender, ctxFromGmail, ctxFromLead, responsesOf, sendModeOf, type MailReplyOp, type ReplyCtx } from "./core/mailreply";
import { ownAccounts } from "./core/mailrules";
import type { ClientRec, Doc, Reply } from "./core/model";
import { irepFeed, mailCardMessage } from "./mailcards";
import { put, remove, sync } from "./core/vault";
import { mailOnSnap } from "./core/mailsnap";
import { setReplyHandled } from "./core/actions";
import { CLAIM_WAIT_MS, canSendFrom, claim, claimWon, cleanOut, failedOut, fromQueue, handed, inlineJob, markStale, newOut, relayPicks, staleOnes, sweepIds, type ReplyOut, type SendStatus } from "./core/inlinereply";

type Post = (m: object) => void;
let post: Post = () => {};
let lastPrefs = "";

const owner = () => { const s = vaultStore.get(); return s.status === "unlocked" && s.role === "owner" ? s : null; };

/** The prefs the compose window and Settings show (the starters until the developer saves his own). */
export function replyPrefs() {
  const s = owner();
  if (!s) return null;
  const p = settingsData(s).mailReply;
  // The clients to tick a quick reply for (names only), and the accounts that get email (signatures per account).
  const clients = clientList(s).map((c) => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  const accounts = [...ownAccounts(s.docs.values())].filter((a) => a.includes("@")).sort();
  return { sig: p?.sig || "", sigs: p?.sigs || {}, responses: responsesOf(p, settingsData(s).ownerName || ""), send: sendModeOf(p), clients, accounts };
}
type Owner = NonNullable<ReturnType<typeof owner>>;
const clientList = (s: Owner) => [...s.docs.values()].filter((d) => d.kind === "client" && !(d.data as ClientRec).archived)
  .map((d) => ({ id: d.id, name: (d.data as ClientRec).name || "Client", email: (d.data as ClientRec).email, matchAddrs: (d.data as ClientRec).matchAddrs }));
/** The clients this email is from: the reply record's own client, and every client the sender's address or domain matches. */
function withClients(s: Owner, c: ReplyCtx | null): ReplyCtx | null {
  if (!c) return null;
  return { ...c, clientIds: [...new Set([...c.clientIds, ...clientsForSender(c.to, clientList(s))])] };
}

/** The email a card is for, as the compose screen needs it. Null: not a card PS can answer. */
export function ctxForCard(cardId: string): ReplyCtx | null {
  const s = owner();
  if (!s) return null;
  if (cardId.startsWith("m:")) {
    const d = [...s.docs.values()].find((x) => x.kind === "reply" && `m:${x.id}`.slice(0, 40) === cardId) as Doc<Reply> | undefined;
    if (!d) return null;
    const c = d.data.clientId ? s.docs.get(d.data.clientId) as Doc<ClientRec> | undefined : undefined;
    return withClients(s, ctxFromGmail(cardId, d.data, c?.kind === "client" ? c.data : undefined));
  }
  if (cardId.startsWith("n:")) {
    const key = cardId.slice(2);
    const all = (irepFeed(s)?.replies || []).filter((r) => (r.id || "").replace(/[^\w-]/g, "").slice(0, 36) === key || (r.threadId || "").replace(/[^\w-]/g, "").slice(0, 36) === key);
    // The same email can be there twice (webhook and feed): the copy with the thread, else the newest.
    const r = all.sort((a, b) => Number(!!b.threadId) - Number(!!a.threadId) || (b.at || "").localeCompare(a.at || ""))[0];
    return r ? withClients(s, ctxFromLead(cardId, r)) : null;
  }
  return null;
}

/** Opens the reply panel with this email loaded: a pop up card's Reply, or the Reply button in the Tab list's email
 *  panel (core/overlaymail.ts, a "looks" patch replyOpen). The panel itself says what to set up when sending is not
 *  ready yet (Connect Gmail for sending, Add Instantly key). Never sends anything. */
export function openReplyFor(cardId: string) {
  const ctx = ctxForCard(cardId), prefs = replyPrefs();
  if (ctx && prefs) post({ type: "reply:open", ctx, prefs });
  else post({ type: "reply:cannot", via: cardId.startsWith("n:") ? "instantly" : "gmail" });   // the Mac says so on a small card
}

/** Settings' "Reply from PS" row: the same panel with no email in it (quick replies, signature, send behaviour, accounts). */
export function openReplySetup() {
  const prefs = replyPrefs();
  if (prefs) post({ type: "reply:open", ctx: null, prefs });
}

/** One signature or response change, on the newest settings. */
export async function runMailReplyOp(op: MailReplyOp) {
  const s = owner();
  if (!s) return;
  await saveSettings({ mailReply: applyMailReplyOp(settingsData(s).mailReply, op, settingsData(s).ownerName || "") });
}
export const cleanReplyPatch = cleanMailReplyOp;

function sendPrefs(force = false) {
  const p = replyPrefs();
  if (!p) return;
  const json = JSON.stringify(p);
  if (!force && json === lastPrefs) return;
  lastPrefs = json;
  post({ type: "reply:prefs", prefs: p });
}

/** Messages from the Mac for this half. True when handled. */
export function replyMessage(m: { type?: string; id?: unknown; action?: unknown; cardId?: unknown }): boolean {
  if (m.type === "cardAction" && m.action === "reply" && typeof m.id === "string" && m.id.startsWith("w:")) return true;   // a WhatsApp card's Reply: the Mac opens the Tab list's reply box (waReply), never the email compose window
  if (m.type === "cardAction" && m.action === "reply" && typeof m.id === "string") { openReplyFor(m.id); return true; }
  if (m.type === "reply:sent" && typeof m.cardId === "string") {
    // Really sent (the Mac says so only after Gmail or Instantly accepted it): the card is dealt with.
    if (/^[mn]:[\w-]{1,38}$/.test(m.cardId)) {
      mailCardMessage({ type: "cardAction", id: m.cardId, action: "dismiss" });
      // V1.59: and it leaves the email panel's open list, like Done (it shows "Replied" at the bottom for a while).
      if (m.cardId.startsWith("m:")) { const r = replyDocFor(m.cardId); if (r) void setReplyHandled(r.id, true).catch(() => {}); }
    }
    return true;
  }
  // V1.59: the Mac's queue (every change): how the email panel's replies went, written to their vault records.
  if (m.type === "reply:rows") { queueRows((m as { rows?: unknown }).rows); return true; }
  if (m.type === "reply:prefsGet") { sendPrefs(true); return true; }
  return false;
}

/** PS main window only. `sendStatus`: which accounts this Mac can send from (ps-mac MailSend.swift, in the Mac settings). */
export function startReplyEngine(p: Post, sendStatus: () => SendStatus | null = () => null) {
  post = p;
  getStatus = sendStatus;
  let t = 0, r = 0;
  vaultStore.subscribe(() => {
    clearTimeout(t); t = window.setTimeout(() => sendPrefs(), 500);
    clearTimeout(r); r = window.setTimeout(() => void relay(), 800);
  });
  window.setInterval(() => void relay(), 30_000);   // a phone's reply when no vault change woke this, and the stale ones
  sendPrefs();
}

// ---------- Reply in the email panel (V1.59, core/inlinereply.ts) ----------
// The box's Send, once its Undo ran out, comes here: from this window's own panel (TaskMap.tsx), or from the Tab list
// as a "looks" patch replyInline (ps.ts). The reply is built here (this window has the vault, the Instantly feed and
// the signatures), written to the vault as a "rout" record, and handed to this Mac's queue when this Mac can send
// from that account. Otherwise it waits in the vault for a Mac that can (relay below).
let getStatus: () => SendStatus | null = () => null;
const ME_KEY = "ps-reply-relay-id";
let meId = "";
/** A random id for this Mac (which Mac claimed a reply). Never a name or anything about the Mac. */
function me(): string {
  if (meId) return meId;
  try { meId = localStorage.getItem(ME_KEY) || ""; } catch { /* no storage: a new id for this run */ }
  if (!meId) { meId = crypto.randomUUID().replace(/-/g, "").slice(0, 16); try { localStorage.setItem(ME_KEY, meId); } catch { /* fine */ } }
  return meId;
}
const replyDocFor = (cardId: string) => { const s = owner(); return s ? [...s.docs.values()].find((x) => x.kind === "reply" && `m:${x.id}`.slice(0, 40) === cardId) as Doc<Reply> | undefined : undefined; };
// Client emails off (no switch, not the first owner, or locked): nothing is built, claimed or handed to the Mac queue (fails closed).
const mailOwner = () => { const s = owner(); return s && mailOnSnap(s) ? s : null; };
const outs = () => { const s = owner(); return s ? [...s.docs.values()].filter((d) => d.kind === "rout").map((d) => ({ id: d.id, out: cleanOut(d.data) })).filter((x): x is { id: string; out: ReplyOut } => !!x.out) : []; };
const outById = (id: string) => outs().find((x) => x.id === id)?.out ?? null;
/** Hand a job to this Mac's queue. Its record says "handed" (and is saved) first, so it is never handed over twice. */
async function handOver(id: string, o: ReplyOut) {
  if (!o.job || !mailOwner()) return;
  await put("rout", handed(o, me(), Date.now()), { id, ws: null });
  post({ type: "reply:queue", job: { ...o.job, id, sendAt: Date.now() }, undo: false });
}

/** Builds the reply for one email and sends it on its way. Throws a plain sentence the box shows. */
export async function sendInline(cardId: string, message: string, id: string, from: ReplyOut["from"]): Promise<void> {
  const s = mailOwner();
  if (!s) throw new Error("Client emails is off. Switch it on in Settings first.");
  const ctx = ctxForCard(cardId);
  if (!ctx) throw new Error("PS app cannot answer this email from here. Use Open.");
  const job = inlineJob(ctx, message, settingsData(s).mailReply, id, Date.now());
  const out = newOut(job, ctx.toName || ctx.first || ctx.to, ctx.subject, from, Date.now());
  if (from === "mac" && canSendFrom(getStatus(), job.via, job.account)) { await handOver(id, out); return; }
  await put("rout", out, { id, ws: null });   // a Mac that can send from this account picks it up (relay)
}
/** The same, and when it cannot even be built, a record that says why (the box shows "Not sent" and the reason). */
export async function sendInlineOrSay(cardId: string, message: string, id: string, from: ReplyOut["from"]): Promise<void> {
  try { await sendInline(cardId, message, id, from); }
  catch (e) { await put("rout", failedOut(cardId, e instanceof Error ? e.message : "Not sent.", from, Date.now()), { id, ws: null }).catch(() => {}); throw e; }
}

let relaying = false;
/** A Mac's part for replies typed elsewhere: claim the waiting ones this Mac can send, wait, read again, and send only
 *  when this Mac's claim still stands. Too old: "Not sent". Finished ones are removed after two days. */
async function relay() {
  const s = mailOwner();
  if (!s || relaying) return;
  relaying = true;
  try {
    const now = Date.now(), list = outs();
    for (const id of staleOnes(list, now)) { const o = outById(id); if (o) await put("rout", markStale(o, now), { id, ws: null }); }
    for (const id of sweepIds(list, now)) await remove(id).catch(() => {});
    const picks = relayPicks(list, me(), (via, account) => canSendFrom(getStatus(), via, account), now);
    if (!picks.length) return;
    for (const id of picks) { const o = outById(id); if (o) await put("rout", claim(o, me(), Date.now()), { id, ws: null }); }
    await sync().catch(() => {});                         // the claims on the server
    await new Promise((r) => setTimeout(r, CLAIM_WAIT_MS));
    await sync().catch(() => {});                         // and anyone else's, read fresh
    for (const id of picks) { const o = outById(id); if (claimWon(o, me())) await handOver(id, o!); }
  } finally { relaying = false; }
}

/** The Mac queue's rows: a reply this Mac handed over that has now gone, or failed. */
function queueRows(v: unknown) {
  if (!Array.isArray(v)) return;
  const mine = new Map(outs().filter((x) => x.out.state === "handed" && x.out.by === me()).map((x) => [x.id, x.out]));
  if (!mine.size) return;
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const row = r as { id?: unknown; state?: unknown; error?: unknown };
    const o = typeof row.id === "string" ? mine.get(row.id) : undefined;
    if (!o || typeof row.state !== "string") continue;
    const next = fromQueue(o, { state: row.state, error: typeof row.error === "string" ? row.error : undefined }, Date.now());
    if (next) void put("rout", next, { id: row.id as string, ws: null }).catch(() => {});
  }
}

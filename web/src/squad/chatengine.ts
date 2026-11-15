// G Squad chat (V1.40) on the page that holds the vault: PS's main page on the Mac, and the website's own page (where
// the vault is unlocked in the page itself). The Tab list holds no keys: it gets chatView() in the state PS already
// sends it and sends its buttons back as a `sqChatOp` (squad/chatview.ts). The website calls runChatOp directly.
// Not on the phone yet: the phone has no G Squad screen (gos/GosLayer.tsx), so it would have nowhere to show it.
//
// Egress (the hub is on Supabase's free plan): only changes are read.
//   closed   one tick every 2 minutes (on the website only while the tab is visible): about 250 bytes back
//            (period, unread count, newest change time, votes that concern you). It pulls nothing else unless a new
//            period is due, history is to be handed over, or a vote needs names.
//   open     one pull every 5 seconds with a cursor: only rows changed since the last one (usually none, ~300 bytes).
//   keys     the period keys are opened from the hub on each start (a few hundred bytes each) and kept in memory only.
// Sound: none by default (the developer). The chat's own switch turns on a short sound for new messages, on the Mac only.
import { docs, vaultStore } from "../core/vault";
import { saveSettings } from "../core/actions";
import { settingsData } from "../core/select";
import { cleanSquadRec, type SquadRec } from "../core/squadrec";
import { joinerLine, voteCardDue, voteWords } from "../core/squadchat";
import { homeTz } from "../core/tz";
import { dndMutes } from "../core/dnd";
import { feature } from "../core/features";
import { GIF_FEATURE } from "./signal";
import { NOTIFY_FEATURE, cleanNoteLedger, isNoteCard, laterSeen, noteCard, noteMuted, noteOn, noteSound, planNotes, staleNotes, type NoteCard, type NoteMsg } from "../core/squadnotify";
import { buildSend } from "./chatsend";
import { ChatSession, type ChatMsg } from "./chatflows";
import { HubError } from "./hub";
import { gifApi, type GifApi } from "./gifhub";
import { foldReactions } from "./chatreact";
import { gifMemory } from "./chatgif";
import { EMPTY_CHAT, EMPTY_GIF, type GifView, type ChatLine, type ChatOp, type ChatView, type ChatVoteView } from "./chatview";

const TICK_MS = 2 * 60_000, OPEN_PULL_MS = 5_000, PAGE = 150;
const PS_PAGE = import.meta.env.MODE === "ps";
const SEEN = "ps.sqChatAgainSeen";
type Post = (m: object) => void;

let post: Post | null = null;
let s: ChatSession | null = null;
let who = "";                                   // squad:member of the session now
let view: ChatView = { ...EMPTY_CHAT };
let open = false, limit = PAGE, error: string | null = null;
let tickTimer: number | undefined, pullTimer: number | undefined;
let ticking = false, pulling = false;
const pending = new Map<string, { t: string; a?: ChatMsg["a"]; failed: boolean; at: string }>();
const cards = new Map<string, string>();       // vote cards on screen (Mac): card id to its JSON
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const chatStore = {
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  get: () => view,
};
/** The plain view for the Tab list (no keys). */
export function chatView(): ChatView { return view; }

const settings = () => settingsData(vaultStore.get());
const seenAgain = (): string[] => { try { const v = JSON.parse(localStorage.getItem(SEEN) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
const markSeenAgain = (id: string) => { try { localStorage.setItem(SEEN, JSON.stringify([...seenAgain().filter((x) => x !== id), id].slice(-40))); } catch { /* storage off */ } };
const say = (e: unknown) => (e instanceof HubError
  ? e.status === 401 && /clock/.test(e.message) ? "This device's clock is off. Set the date and time to automatic and try again."
  : e.status === 429 ? "Slow down a little: that was a lot of messages in one minute."
  : "G Squad could not be reached. Try again in a moment."
  : "Something went wrong. Try again.");

// ---------- GIFs (PS 1.63, squad/gifhub.ts) ----------
// Whether the hub's `gif` function is deployed and has its key is asked ONCE per session and remembered on this device
// (a yes for a week, a no for 6 hours); until it says yes the GIF button stays hidden, and any trouble is a quiet no.
const GIF_MEM = "ps.sqGifOn";
let gifOn: boolean | null = null, gifApiNow: GifApi | null = null, gifState: GifView = EMPTY_GIF, gifAsk = 0;
const gifView = (): GifView => ({ ...gifState, on: gifOn });
function gifSetup(cur: ChatSession) {
  gifApiNow = gifApi({ member: cur.rec.memberId, priv: cur.rec.sign.priv });
  let mem: string | null = null;
  try { mem = localStorage.getItem(GIF_MEM); } catch { /* storage off: ask */ }
  gifOn = feature(GIF_FEATURE) ? gifMemory(mem, Date.now()) : false;   // the feature off means no GIF calls at all
  if (gifOn !== null || !feature(GIF_FEATURE)) return;
  const api = gifApiNow;
  void api.status().then((on) => {
    if (gifApiNow !== api) return;
    gifOn = on;
    try { localStorage.setItem(GIF_MEM, JSON.stringify({ on, at: Date.now() })); } catch { /* storage off: asked again next time */ }
    rebuild();
  });
}
async function gifSearch(q: string, more: boolean) {
  const api = gifApiNow;
  if (!api || gifOn !== true) return;
  const ask = ++gifAsk;
  gifState = { ...gifState, q, busy: true, failed: false, ...(more ? {} : { items: [], next: null }) };
  rebuild();
  try {
    const r = await api.search(q, more ? gifState.next ?? 0 : 0);
    if (ask !== gifAsk) return;
    const seen = new Set(more ? gifState.items.map((g) => g.id) : []);
    gifState = { ...gifState, busy: false, items: [...(more ? gifState.items : []), ...r.items.filter((g) => !seen.has(g.id))].slice(0, 120), next: r.next };
  } catch (e) {
    if (ask !== gifAsk) return;
    gifState = { ...gifState, busy: false, failed: true };
    if (e instanceof HubError && e.status === 404) { gifOn = false; try { localStorage.setItem(GIF_MEM, JSON.stringify({ on: false, at: Date.now() })); } catch { /* ignore */ } }
  }
  rebuild();
}

// ---------- the view ----------
function lines(): ChatLine[] {
  if (!s) return [];
  const me = s.rec.memberId;
  const msgs = s.list(limit);
  const shown = new Set(msgs.map((m) => m.id));
  const pills = foldReactions([...s.reacts.values()], (id) => shown.has(id), me, (id) => s!.people.get(id)?.name ?? "Someone");
  const out: ChatLine[] = msgs.map((m) => {
    const p = s!.people.get(m.from);
    return { id: m.id, from: m.from, name: m.from === me ? "You" : p?.name ?? "Someone", mine: m.from === me, t: m.t,
      ...(m.a ? { a: m.a } : {}), at: m.at, edited: m.edited, left: !!p?.left, ...(pills.get(m.id) ? { r: pills.get(m.id) } : {}) };
  });
  for (const [id, p] of pending) if (!s.msgs.has(id)) out.push({ id, from: me, name: "You", mine: true, t: p.t, ...(p.a ? { a: p.a } : {}), at: p.at, edited: false, left: false, ...(p.failed ? { failed: true } : { sending: true }) });
  return out;
}
function votes(): ChatVoteView[] {
  if (!s) return [];
  const seen = new Set(seenAgain()), tz = homeTz();
  return s.votes.filter((v) => v.voter && !v.res).map((v) => {
    const stage = voteCardDue(v, (id) => seen.has(id));
    const name = s!.people.get(v.j)?.name ?? "Someone new";
    const w = voteWords(name, v, stage ?? (v.again ? "again" : "ask"), tz);
    return { id: v.id, joiner: v.j, name, stage, mine: v.mine, n: v.n, k: v.k, ...w };
  });
}
function rebuild() {
  const st = s?.status;
  const mine = s?.myVote();
  view = {
    in: !!s, ready: !!s && !!st && !st.rot && s.keys.has(st.epoch), open, unread: open ? 0 : st?.u ?? 0,
    lines: open ? lines() : [], more: !!s?.more, votes: votes(), note: s ? joinerLine(mine, s.hasHistory()) : null,
    sound: settings().squadChatSound === true, notify: feature(NOTIFY_FEATURE), notifyOn: settings().squadNotify !== false, noteSound: settings().squadNotifySound !== false, sending: [...pending.values()].filter((p) => !p.failed).length, error, loaded: !!s?.loaded, gif: gifView(),
  };
  emit();
  showCards();
}

// ---------- the history vote pop-up on the Mac (a PS card, top right, with Yes and No; it stays until answered) ----------
function showCards() {
  if (!post || !PS_PAGE) return;
  const want = new Map<string, string>();
  for (const v of view.votes) {
    if (!v.stage) continue;
    const id = `sqv:${v.id}`;
    want.set(id, JSON.stringify({ id, sticky: true, title: v.title, sub: v.sub, body: v.body, actions: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] }));
  }
  for (const [id, json] of want) if (cards.get(id) !== json) { cards.set(id, json); post({ type: "cardShow", card: JSON.parse(json) }); }
  for (const id of [...cards.keys()]) if (!want.has(id)) { cards.delete(id); post({ type: "cardHide", id }); }
}
/** The card's buttons (Mac): Yes, No. */
export function chatCardMessage(m: { type?: string; id?: string; action?: string; text?: string }): boolean {
  if (m.type === "cardAction" && isNoteCard(m.id)) { noteAction(m.id, String(m.action || ""), typeof m.text === "string" ? m.text : undefined); return true; }
  if (m.type !== "cardAction" || typeof m.id !== "string" || !m.id.startsWith("sqv:")) return false;
  const id = m.id.slice(4);
  if (m.action === "yes" || m.action === "no") void runChatOp({ op: "vote", id, yes: m.action === "yes" });
  return true;
}

// ---------- message notifications (PS 1.60, PR 10, core/squadnotify.ts has the rules) ----------
// A new message from someone else becomes a card: the Mac's top right stack (cardShow path "meetCard", tone "squad"), the
// website's corner (noteStore, drawn by views/SquadNoteCards.tsx) or the phone's notification (notePost, gos/bridge.ts).
// Reply goes through the same send request as the chat's box (squad/chatsend.ts buildSend).
const LEDGER_KEY = "ps-gsquad-announced", SINCE_KEY = "ps-gsquad-notify-since";
let notePost: Post | null = null;
let noteLedger: Record<string, number> | null = null;
const noteShown = new Map<string, NoteCard>();     // cards on screen on this device: card id to its card
const noteSubs = new Set<() => void>();
let noteList: NoteCard[] = [];
export const noteStore = {
  subscribe(l: () => void) { noteSubs.add(l); return () => { noteSubs.delete(l); }; },
  get: () => noteList,
};
/** The dev page only (?fake&gsquad&note): a made up card on the website's corner, never real data. */
export function devShowNote(c: NoteCard) { noteShown.set(c.id, c); publishNotes(); }
/** The phone's page: where its notifications go (gos/bridge.ts hands its card poster). */
export function setNotePost(p: Post | null) { notePost = p; }
const noteDevice = (): "mac" | "phone" | "web" => (PS_PAGE ? "mac" : notePost ? "phone" : "web");
// Read from storage each time, so two tabs of the website share one list.
const readLedger = () => { try { noteLedger = cleanNoteLedger(JSON.parse(localStorage.getItem(LEDGER_KEY) || "{}")); } catch { noteLedger = noteLedger ?? {}; } return noteLedger!; };
const writeLedger = (l: Record<string, number>) => { noteLedger = l; try { localStorage.setItem(LEDGER_KEY, JSON.stringify(l)); } catch { /* storage blocked: this run's list still holds */ } };
const getSince = (): string | null => { try { return localStorage.getItem(SINCE_KEY) || null; } catch { return null; } };
const setSince = (v: string | null) => { try { if (v) localStorage.setItem(SINCE_KEY, v); else localStorage.removeItem(SINCE_KEY); } catch { /* storage blocked */ } };
const noteEnabled = () => noteOn(feature(NOTIFY_FEATURE), settings());
const putNote = (c: NoteCard) => {
  noteShown.set(c.id, c);
  if (PS_PAGE && post) post({ type: "meetCard", card: c });
  else if (notePost) notePost({ type: "meetCard", card: c });
};
const dropNote = (id: string) => {
  if (!noteShown.delete(id)) return;
  if (PS_PAGE && post) post({ type: "cardHide", id });
  else if (notePost) notePost({ type: "cardHide", id });
};
function publishNotes() {
  noteList = [...noteShown.values()].sort((a, b) => a.at.localeCompare(b.at));
  noteSubs.forEach((l) => l());
}
/** Look at the messages this device has: new ones become cards, cards that are no longer wanted go. Cheap, runs after
 *  every pull and every settings change. Does nothing and clears every card while the feature or the switch is off. */
function refreshNotes(announce = true) {
  const cur = s;
  const st = settings();
  const now = Date.now();
  if (!cur || !noteEnabled()) {
    if (noteShown.size) { for (const id of [...noteShown.keys()]) dropNote(id); publishNotes(); }
    if (getSince()) setSince(null);   // switched off: when it comes back on, only newer messages count
    return;
  }
  if (!getSince()) { setSince(new Date(now).toISOString()); return; }
  const muted = noteMuted(st, now, noteDevice());
  const read = cur.status?.read ?? null, seen = st.squadNoteSeen ?? null;
  const stale = staleNotes([...noteShown.values()], { read, seen, chatOpen: open, muted, enabled: true });
  for (const id of stale) dropNote(id);
  let changed = stale.length > 0;
  if (announce && cur.loaded) {
    const msgs: NoteMsg[] = cur.list(60).map((m) => ({ id: m.id, from: m.from, name: cur.people.get(m.from)?.name ?? "Someone", t: m.t, at: m.at }));
    const plan = planNotes(msgs, { me: cur.rec.memberId, since: getSince(), read, seen, chatOpen: open, muted, now, ledger: readLedger() });
    writeLedger(plan.ledger);
    for (const m of plan.show) { putNote(noteCard(m)); changed = true; }
    if (plan.show.length && noteSound(st, now, noteDevice()) && post && PS_PAGE) post({ type: "sfx", name: "note-drop", vol: Math.max(0.3, (st.tmSound ?? 40) / 100), card: true });
  }
  if (changed) publishNotes();
}
/** One note is finished with (Dismiss, Open, a sent Reply): it goes from this device, and "seen up to here" is saved so
 *  the other devices drop it too (their cards leave when the settings reach them). */
function finishNote(id: string) {
  const c = noteShown.get(id);
  dropNote(id);
  publishNotes();
  if (c) void saveSettings({ squadNoteSeen: laterSeen(settings().squadNoteSeen, c.at) });
}
/** A card's button, from the Mac's stack or the phone (ids "g:<message id>"). */
export function noteAction(id: string, action: string, text?: string): void {
  if (!isNoteCard(id)) return;
  if (action === "dismiss") { finishNote(id); return; }
  if (action === "open") {
    finishNote(id);
    // The Mac shell brings the Tab list up on the chat by itself (ps-mac main.swift, "squadOpen" to the Tab list, ps.ts).
    if (!PS_PAGE) void import("./chatopen").then((m) => m.openSquadChat({}));
    return;
  }
  if (action === "reply" && typeof text === "string") {
    const op = buildSend(text);
    if (op) void runChatOp(op);
    finishNote(id);
  }
}

// ---------- the hub ----------
async function tick() {
  if (!s || ticking || !navigator.onLine) return;
  if (!PS_PAGE && document.visibilityState === "hidden") return;
  ticking = true;
  const cur = s;
  try {
    const before = cur.status;
    const st = await cur.tick();
    if (st.rot) await cur.rotateIfDue();
    if (st.give.length) await cur.giveIfDue();
    const needNames = cur.votes.some((v) => !cur.people.has(v.j));
    if (!cur.loaded && (needNames || open)) await cur.pull();
    else if (open && st.last && st.last !== before?.last) await cur.pull();
    else if (needNames) await cur.pull();
    else if (!open && st.u > 0 && st.last && st.last !== before?.last && noteEnabled() && getSince()) await cur.pull();   // a new message: read it to show the card
    if (before && !open && st.u > before.u && !noteEnabled()) chime();   // with notifications on the card has its own sound
    if (cur === s) { error = null; rebuild(); refreshNotes(); }
  } catch (e) { if (!gone(e) && cur === s) { error = say(e); rebuild(); } }
  finally { ticking = false; }
}
async function pull() {
  if (!s || pulling || !navigator.onLine) return;
  pulling = true;
  const cur = s;
  try {
    await cur.pull();
    if (cur.status?.rot) await cur.rotateIfDue();
    if (cur.status?.give.length) await cur.giveIfDue();
    if (open && (PS_PAGE || document.visibilityState === "visible")) await cur.markRead();
    if (cur === s) { error = null; rebuild(); }
  } catch (e) { if (!gone(e) && cur === s) { error = say(e); rebuild(); } }
  finally { pulling = false; }
}
function chime() {
  const st = settings();
  if (st.squadChatSound !== true || !post || !PS_PAGE || st.tmMuted || dndMutes(st.dnd, "sounds", Date.now(), "mac") || dndMutes(st.dnd, "gsquad", Date.now(), "mac")) return;
  post({ type: "sfx", name: "note-drop", vol: Math.max(0.3, (st.tmSound ?? 40) / 100), card: true });   // card: silent in private mode (V1.57)
}
/** The hub no longer knows you: the core's engine drops your squad record; the chat just stops. */
function gone(e: unknown) {
  if (e instanceof HubError && e.status === 403) { stop(); return true; }
  return false;
}

function setOpen(on: boolean) {
  if (open === on) { if (on) void pull(); return; }
  open = on;
  if (pullTimer !== undefined) { window.clearInterval(pullTimer); pullTimer = undefined; }
  if (on) {
    void pull();
    pullTimer = window.setInterval(() => { if (PS_PAGE || document.visibilityState === "visible") void pull(); }, OPEN_PULL_MS);
  } else limit = PAGE;
  rebuild();
  refreshNotes(false);   // the chat opened: its cards are done with
}

// ---------- what the chat asks for ----------
export async function runChatOp(o: ChatOp): Promise<void> {
  const st = vaultStore.get();
  if (st.status !== "unlocked" || st.role !== "owner") return;
  if (o.op === "sound") { await saveSettings({ squadChatSound: o.on }); rebuild(); return; }
  if (o.op === "notify") { await saveSettings({ squadNotify: o.on }); rebuild(); refreshNotes(); return; }
  if (o.op === "noteSound") { await saveSettings({ squadNotifySound: o.on }); rebuild(); return; }
  if (o.op === "open") { setOpen(o.on); return; }
  if (o.op === "gifclear") { gifAsk++; gifState = EMPTY_GIF; rebuild(); return; }
  if (o.op === "gifs") { await gifSearch(o.q, o.more === true); return; }
  const cur = s;
  if (!cur) return;
  try {
    switch (o.op) {
      case "send": {
        const id = globalThis.crypto.randomUUID();
        pending.set(id, { t: o.text, ...(o.a ? { a: o.a } : {}), failed: false, at: new Date().toISOString() });
        rebuild();
        await send(cur, id);
        return;
      }
      case "retry":
        for (const id of [...pending.keys()]) { const p = pending.get(id)!; if (p.failed) { pending.set(id, { ...p, failed: false }); rebuild(); await send(cur, id); } }
        return;
      case "react": await cur.react(o.to, o.e, rebuild); break;
      case "edit": await cur.edit(o.id, o.text); break;
      case "del": await cur.del(o.id); break;
      case "older": limit += PAGE; if (cur.list(limit).length < limit && cur.more) await cur.older(); break;
      case "vote": {
        await cur.vote(o.id, o.yes);
        markSeenAgain(o.id);
        void tick();
        break;
      }
    }
    error = null;
  } catch (e) { if (!gone(e)) error = say(e); }
  rebuild();
}
async function send(cur: ChatSession, id: string) {
  const p = pending.get(id);
  if (!p) return;
  try {
    await cur.send({ t: p.t, ...(p.a ? { a: p.a } : {}) }, id);
    pending.delete(id);
    error = null;
  } catch (e) {
    // A send whose answer was lost may have landed: look before calling it failed.
    try { await cur.pull(); } catch { /* offline */ }
    if (cur.msgs.has(id)) pending.delete(id);
    else { pending.set(id, { ...p, failed: true }); if (!gone(e)) error = e instanceof Error && /key is not here/.test(e.message) ? "The chat is getting its new key. Try again in a moment." : say(e); }
  }
  rebuild();
}

// ---------- start ----------
function readRec(): SquadRec | null {
  const list = docs<SquadRec>("squad").map((d) => cleanSquadRec(d.data)).filter((r): r is SquadRec => !!r).sort((a, b) => b.joinedAt.localeCompare(a.joinedAt));
  return list[0] ?? null;
}
function stop() {
  s = null; who = ""; pending.clear(); error = null;
  gifOn = null; gifApiNow = null; gifState = EMPTY_GIF; gifAsk++;
  if (tickTimer !== undefined) window.clearInterval(tickTimer);
  if (pullTimer !== undefined) window.clearInterval(pullTimer);
  tickTimer = pullTimer = undefined; open = false;
  view = { ...EMPTY_CHAT };
  for (const id of [...noteShown.keys()]) dropNote(id);
  publishNotes();
  emit();
  showCards();
}
function sync() {
  const st = vaultStore.get();
  if (st.status !== "unlocked" || st.role !== "owner" || st.userId === "ps-overlay" || st.userId === "dev") { if (s) stop(); return; }
  const rec = readRec();
  const next = rec ? `${rec.squadId}:${rec.memberId}` : "";
  if (next === who) { if (s && (view.sound !== (settings().squadChatSound === true) || view.notifyOn !== (settings().squadNotify !== false) || view.noteSound !== (settings().squadNotifySound !== false))) rebuild(); refreshNotes(); return; }
  if (s) stop();
  if (!rec) return;
  s = new ChatSession(rec); who = next;
  gifSetup(s);
  rebuild();
  tickTimer = window.setInterval(() => void tick(), TICK_MS);
  void tick();
}

let started = false;
/** PS's main page (post = PS's message to the shell, for the vote card and the sound) and the website (null). */
export function startChat(p: Post | null) {
  if (started) return;
  started = true;
  post = p;
  vaultStore.subscribe(sync);
  sync();
  window.addEventListener("online", () => void tick());
  if (!PS_PAGE) document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void tick(); });
}

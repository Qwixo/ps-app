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
import { ChatSession, type ChatMsg } from "./chatflows";
import { HubError } from "./hub";
import { EMPTY_CHAT, type ChatLine, type ChatOp, type ChatView, type ChatVoteView } from "./chatview";

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

// ---------- the view ----------
function lines(): ChatLine[] {
  if (!s) return [];
  const me = s.rec.memberId;
  const out: ChatLine[] = s.list(limit).map((m) => {
    const p = s!.people.get(m.from);
    return { id: m.id, from: m.from, name: m.from === me ? "You" : p?.name ?? "Someone", mine: m.from === me, t: m.t,
      ...(m.a ? { a: m.a } : {}), at: m.at, edited: m.edited, left: !!p?.left };
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
    sound: settings().squadChatSound === true, sending: [...pending.values()].filter((p) => !p.failed).length, error, loaded: !!s?.loaded,
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
export function chatCardMessage(m: { type?: string; id?: string; action?: string }): boolean {
  if (m.type !== "cardAction" || typeof m.id !== "string" || !m.id.startsWith("sqv:")) return false;
  const id = m.id.slice(4);
  if (m.action === "yes" || m.action === "no") void runChatOp({ op: "vote", id, yes: m.action === "yes" });
  return true;
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
    if (before && !open && st.u > before.u) chime();
    if (cur === s) { error = null; rebuild(); }
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
}

// ---------- what the chat asks for ----------
export async function runChatOp(o: ChatOp): Promise<void> {
  const st = vaultStore.get();
  if (st.status !== "unlocked" || st.role !== "owner") return;
  if (o.op === "sound") { await saveSettings({ squadChatSound: o.on }); rebuild(); return; }
  if (o.op === "open") { setOpen(o.on); return; }
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
  if (tickTimer !== undefined) window.clearInterval(tickTimer);
  if (pullTimer !== undefined) window.clearInterval(pullTimer);
  tickTimer = pullTimer = undefined; open = false;
  view = { ...EMPTY_CHAT };
  emit();
  showCards();
}
function sync() {
  const st = vaultStore.get();
  if (st.status !== "unlocked" || st.role !== "owner" || st.userId === "ps-overlay" || st.userId === "dev") { if (s) stop(); return; }
  const rec = readRec();
  const next = rec ? `${rec.squadId}:${rec.memberId}` : "";
  if (next === who) { if (s && view.sound !== (settings().squadChatSound === true)) rebuild(); return; }
  if (s) stop();
  if (!rec) return;
  s = new ChatSession(rec); who = next;
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

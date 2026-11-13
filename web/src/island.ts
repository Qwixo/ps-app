// PS Dynamic Island, the main window half (core/island.ts says what it shows; ps-mac Island.swift draws
// it). Posts {type:"island", state} whenever what it shows changes, and again every minute so a restarted
// native side catches up. A tick on the island comes back as {type:"islandAction", action:"tick"|"untick",
// id} and ticks the task exactly as the Tab list does (toggleTodo: streaks, mini tasks, the day log).
// Signed out or locked: the island is told "off", so it never shows a title the vault is not open for.
// Private mode: the island shows a mask and "Private mode" with Show instead of the hidden title; a click there comes
// back as {type:"islandAction", action:"privateOff"} and turns private mode off, and the real task is sent at once.
import { vaultStore, type Snapshot } from "./core/vault";
import { settingsData, todos } from "./core/select";
import { saveSettings, toggleTodo } from "./core/actions";
import { workingIdsOf, type Doc, type Reply, type Todo } from "./core/model";
import { mailCards } from "./core/mailcards";
import { leadCards } from "./core/leadcards";
import { chatDoneCards } from "./core/chatdone";
import { irepFeed } from "./mailcards";
import { ISLAND_EVENT_MS, ISLAND_FRESH_MS, canPrivateOff, canTick, canUndo, islandState, pickEvent, type IslandCard, type IslandEvent, type IslandState, type IslandTick } from "./core/island";
import { todayISO } from "./ui/kit";

type Post = (m: object) => void;
let post: Post = () => {};
let last = "";
let event: IslandEvent | null = null;
let eventTimer = 0;
/** Cards this page run has already seen: each pops the island once, and a restart pops none that are old. */
const seen = new Set<string>();
/** The last tick from the island, so its Undo also puts the task back in progress. */
let lastTick: IslandTick | null = null;
/** What the island was last told it shows: a tick may only reach one of these tasks (V1.44 #10). */
let shown: IslandState | null = null;

/** Client emails, Instantly replies and finished chats, each with whether it just arrived. */
function cardsNow(s: Snapshot, now: number): { mail: number; leads: number; cards: IslandCard[] } {
  const st = settingsData(s);
  const mail = mailCards(s.docs.values(), st.mailCardsSince, 20, now);
  const leads = leadCards(irepFeed(s), st.leadCards, now);
  const chats = chatDoneCards(st.chatDone, now, st.dnd);
  const cards: IslandCard[] = [];
  for (const c of mail) {
    // Fresh: the email just came, or its "Remind me in" just ran out.
    const r = s.docs.get(c.replyId)?.data as Reply | undefined;
    const back = r?.remindAt && r.remindFor === r.date ? Date.parse(r.remindAt) : 0;
    const at = Math.max(Date.parse(c.at) || 0, back || 0);
    cards.push({ id: c.id, kind: "mail", title: c.title, sub: c.sub, url: c.url, at, fresh: now - at < ISLAND_FRESH_MS });
  }
  for (const c of leads) cards.push({ id: c.id, kind: "lead", title: c.title, sub: c.sub, url: c.url, at: Date.parse(c.at) || 0, fresh: c.fresh });
  for (const c of chats) cards.push({ id: c.id, kind: "chat", title: c.chat, sub: c.sub, url: "", at: Date.parse(c.at) || 0, fresh: c.fresh });
  return { mail: mail.length, leads: leads.length, cards };
}

function sync(force = false) {
  const s = vaultStore.get();
  if (s.status !== "unlocked" || s.role !== "owner") { shown = null; lastTick = null; return send({ mode: "off", private: false, task: null, more: 0, tasks: [], mail: 0, leads: 0, event: null }, force); }
  const now = Date.now();
  const { mail, leads, cards } = cardsNow(s, now);
  const fresh = pickEvent(cards, seen);
  if (fresh) {
    event = fresh;
    clearTimeout(eventTimer);
    eventTimer = window.setTimeout(() => { event = null; sync(); }, ISLAND_EVENT_MS);
  }
  const st = settingsData(s);
  shown = islandState({ todos: todos(s) as Doc<Todo>[], settings: st, today: todayISO(), mail, leads, event, now });
  send(shown, force);
}
function send(state: object, force: boolean) {
  const json = JSON.stringify(state);
  if (!force && json === last) return;
  last = json;
  post({ type: "island", state });
}

/** A tick or an Undo on the island. Only for a task that exists and is in the right state. */
export function islandMessage(m: { type?: string; action?: string; id?: string }): boolean {
  if (m.type !== "islandAction") return false;
  const s = vaultStore.get();
  if (s.status !== "unlocked" || s.role !== "owner") return true;
  if (m.action === "privateOff") {
    if (canPrivateOff(shown, settingsData(s).privateMode)) void saveSettings({ privateMode: false }).then(() => sync(true));
    return true;
  }
  if (typeof m.id !== "string") return true;
  const d = s.docs.get(m.id) as Doc<Todo> | undefined;
  if (!d || d.kind !== "todo") return true;
  // Only a task the island shows, open and still in the list; Undo only for the island's own last tick (V1.44 #10).
  if (m.action === "tick" && canTick(shown, d.id, d.data)) {
    lastTick = { id: d.id, at: Date.now(), working: workingIdsOf(settingsData(s)) };
    void toggleTodo(d.id);
  } else if (m.action === "untick" && canUndo(lastTick, d.id, d.data, Date.now())) {
    const back = lastTick?.working ?? null;
    lastTick = null;
    void toggleTodo(d.id).then(() => { if (back?.includes(d.id)) void saveSettings({ workingIds: back, workingOn: back[0] ?? null }); });
  }
  return true;
}

/** PS main window only. */
export function startIsland(p: Post) {
  post = p;
  let t = 0;
  vaultStore.subscribe(() => { clearTimeout(t); t = window.setTimeout(() => sync(), 300); });
  window.setInterval(() => sync(true), 60_000);   // a restarted island catches up within a minute
  // Back from sleep, a lock or the network: send at once rather than up to a minute later (V1.44 #10).
  const now = () => sync(true);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") now(); });
  window.addEventListener("online", now);
  window.addEventListener("focus", now);
  sync();
}

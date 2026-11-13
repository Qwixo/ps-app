// Meeting notes pop-up in PS (main window only, where the vault is open). Runs core/notescard.ts
// every 15 s and on every vault change, and hands the card to the native top left window
// (Sources/NotesCard.swift) through the pop-up bridge: {type:"meetCard"} with tone "notes" shows
// it, {type:"cardHide"} takes it away. Its buttons come back as cardAction "nc:...":
//   tick:<item id>  saved in the vault exactly like a tick in the Tab list's live checklist
//   snooze:<min>    hidden that long (this Mac only, in localStorage, kept 2 days)
//   quiet           "Don't remind me": gone for that meeting (this Mac only)
import { vaultStore } from "./core/vault";
import { settingsData } from "./core/select";
import { visibleEvents } from "./core/meethide";
import { saveSettings } from "./core/actions";
import type { CalendarSnap, MeetingNote, Settings } from "./core/model";
import { NOTES_DEFAULTS, notesCard, pruneLocal, type NotesLocal, type NotesPrefs } from "./core/notescard";

const LOCAL = "ps.notesCard";
type Post = (m: object) => void;
let post: Post = () => {};
let shown: { id: string; json: string } | null = null;
let current: { key: string; title: string; start: string } | null = null;

/** Gear menu > Meeting alerts > Meeting notes pop-up (settings.meetAlerts.notes*). */
export function notesPrefs(st: Settings): NotesPrefs & { blur: boolean } {
  const m = (st.meetAlerts || {}) as Record<string, unknown>;
  const snooze = Array.isArray(m.notesSnooze) ? (m.notesSnooze as unknown[]).filter((x): x is number => typeof x === "number") : NOTES_DEFAULTS.snooze;
  return {
    on: m.notes !== false,
    after: typeof m.notesAfter === "number" ? m.notesAfter : NOTES_DEFAULTS.after,
    snooze: snooze.length ? snooze : NOTES_DEFAULTS.snooze,
    blur: m.notesBlur !== false,
  };
}
function readLocal(): NotesLocal { try { return JSON.parse(localStorage.getItem(LOCAL) || "{}") as NotesLocal; } catch { return {}; } }
function writeLocal(l: NotesLocal) { try { localStorage.setItem(LOCAL, JSON.stringify(pruneLocal(l, Date.now()))); } catch { /* storage off */ } }

function events(): CalendarSnap["events"] {
  const s = vaultStore.get();
  const cal = [...s.docs.values()].filter((d) => d.kind === "calendar").sort((a, b) => ((b.data as CalendarSnap).at || "").localeCompare((a.data as CalendarSnap).at || ""))[0];
  return visibleEvents(cal ? (cal.data as CalendarSnap).events : [], settingsData(s).meetHidden);   // not the meetings the developer took off the panel
}

function sync() {
  const s = vaultStore.get();
  if (s.status !== "unlocked" || s.role !== "owner") { hide(); return; }
  const st = settingsData(s);
  const prefs = notesPrefs(st);
  const evs = events();
  const card = notesCard(Date.now(), evs, st.meetingNotes || [], st.standingNotes || [], readLocal(), prefs);
  if (!card) { hide(); return; }
  const ev = evs.find((e) => e.id + e.start === card.key);
  current = { key: card.key, title: card.title, start: ev?.start || "" };
  const msg = { id: card.id, tone: "notes", title: card.title, end: card.end, items: card.items, snooze: card.snooze, blur: prefs.blur };
  const json = JSON.stringify(msg);
  if (shown?.json === json) return;
  if (shown && shown.id !== card.id) post({ type: "cardHide", id: shown.id });
  shown = { id: card.id, json };
  post({ type: "meetCard", card: msg });
}
function hide() { if (shown) { post({ type: "cardHide", id: shown.id }); shown = null; } current = null; }

/** One tick from the card: saved like the Tab list's live checklist (every call items go in doneStanding). */
async function tick(itemId: string) {
  const c = current;
  if (!c) return;
  const st = settingsData(vaultStore.get());
  const notes = st.meetingNotes || [];
  const own = notes.find((n) => n.key === c.key);
  const isEvery = (st.standingNotes || []).some((sn) => sn.items.some((x) => x.id === itemId));
  const next: MeetingNote = own
    ? { ...own, items: own.items.map((x) => (x.id === itemId ? { ...x, done: true } : x)), doneStanding: isEvery ? [...new Set([...(own.doneStanding || []), itemId])] : own.doneStanding || [] }
    : { key: c.key, title: c.title, start: c.start, items: [], doneStanding: isEvery ? [itemId] : [] };
  await saveSettings({ meetingNotes: [...notes.filter((n) => n.key !== c.key), next] });
}

/** The card's buttons (through the pop-up bridge). */
export function notesCardMessage(m: { type?: string; id?: string; action?: string }) {
  if (m.type !== "cardAction" || typeof m.id !== "string" || !m.id.startsWith("nc:")) return false;
  const a = m.action || "", c = current;
  if (a.startsWith("tick:")) void tick(a.slice(5));
  else if (c && (a.startsWith("snooze:") || a === "quiet" || a === "dismiss")) {
    const l = readLocal();
    const mins = Number(a.slice(7)) || 15;
    l[c.key] = a.startsWith("snooze:") ? { snoozeUntil: Date.now() + Math.max(5, Math.min(60, mins)) * 60_000, at: Date.now() } : { quiet: true, at: Date.now() };
    writeLocal(l);
    shown = null;   // the native card already went; a later sync shows it again when the snooze is up
  }
  return true;
}

/** PS main window only. */
export function startNotesCard(p: Post) {
  post = p;
  let t = 0;
  vaultStore.subscribe(() => { clearTimeout(t); t = window.setTimeout(sync, 400); });
  window.setInterval(sync, 15_000);
  sync();
}

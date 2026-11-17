// Checklist reminder (PS 1.65, request from the developer's AI, 17 Nov 2026): "If no task was ticked in that time and the
// person is not in a meeting, a pop-up in the same 15 minute reminder look says DO YOUR CHECKLIST, with three choices."
//
// What is here (all pure: no vault, no clock of its own, no DOM; tests/chkremind.test.ts checks every rule):
//  - the saved setting (on or off, how often: 30 minutes to 12 hours, 2 hours when nothing is saved),
//  - when the pop-up may come (chkStep): no task ticked for the whole interval, and not while the person is in a meeting,
//    in Sleep mode, behind the Sentry cover, under Do Not Disturb, away from the keyboard, or has 1Password or Signal in front,
//  - the words (CHK_WORDS, every one for the developer's approval),
//  - the "Rethink to do list" counter (Delete 2/4 tasks) and the task lists the screens work on.
// The pop-up itself is the Annoying 15 minute reminder's card (Mac: Sources/Reminders.swift, the website: views/ChecklistReminder.tsx);
// the screens after it are views/ChecklistReminder.tsx (ChecklistScreens), mounted in the Tab list.
import type { Doc, DimxItem, DimxZone, Todo } from "./model.ts";

export const CHK_FEATURE = "checklist-reminder";

/** Luc life lesson: the most tasks a day's checklist should hold. */
export const CHK_MAX_TASKS = 5;

export const CHK_EVERY_MIN = 30, CHK_EVERY_MAX = 720, CHK_EVERY_DEF = 120;   // minutes
/** What the "How often" menu offers. Any saved number from 30 to 720 is kept as it is. */
export const CHK_EVERY_CHOICES = [30, 45, 60, 90, 120, 180, 240, 360, 480, 720] as const;

export interface ChkSettings { on: boolean; every: number; sound: boolean }
/** On by default for everyone, every 2 hours. */
export const CHK_DEFAULT: ChkSettings = { on: true, every: CHK_EVERY_DEF, sound: true };

/** The saved setting, cleaned: anything odd falls back to the default, the interval is held between 30 minutes and 12 hours. */
export function cleanChk(v: unknown): ChkSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const every = typeof o.every === "number" && Number.isFinite(o.every) ? Math.min(CHK_EVERY_MAX, Math.max(CHK_EVERY_MIN, Math.round(o.every))) : CHK_EVERY_DEF;
  return { on: o.on !== false, every, sound: o.sound !== false };
}

/** "30 minutes", "1 hour", "1 hour 30 minutes", "2 hours", "12 hours". */
export function everyLabel(min: number): string {
  const m = cleanChk({ every: min }).every, h = Math.floor(m / 60), r = m % 60;
  const hs = h === 1 ? "1 hour" : `${h} hours`, ms = `${r} minutes`;
  return h === 0 ? ms : r === 0 ? hs : `${hs} ${ms}`;
}

// ---------- the words ----------
export const CHK_WORDS = {
  pill: "Checklist",
  headline: "DO YOUR CHECKLIST",
  rethink: "Rethink to do list",
  sure: "I know what I'm doing, I'm getting tasks done",
  forgot: "I forgot",
  rethinkHeadline: "Luc life lesson recommends max 5 tasks on your checklist in a day. You can send the rest to Dimension X.",
  areYouSure: "Are you sure?",
  typeYes: "Type yes and press Enter to confirm",
  yesWord: "yes",
  onlyYes: "Only yes closes this.",
  pickTitle: "Pick one task to do now",
  islandAsk: "Add it to the Dynamic Island?",
  yes: "Yes",
  no: "No",
  del: "Delete",
  send: "Send to Dimension X",
  done: "Done",
  undo: "Undo",
  deleted: "Deleted",
  sent: "Sent to Dimension X",
  empty: "No tasks left on your checklist.",
  settingsOn: "Checklist reminder",
  settingsEvery: "How often",
  settingsSound: "Soft chime",
  settingsLine: "Says DO YOUR CHECKLIST when you have not ticked a task for a while.",
  settingsRule: "It stays away while you are in a meeting, in Sleep mode, away from the keyboard or under Do Not Disturb.",
  test: "Show it now",
  tabLabel: "Checklist Reminder",
  tabLine: "A nudge when you have not ticked a task for a while",
} as const;

/** The pop-up's three choices, in order. */
export const CHK_CHOICES = [CHK_WORDS.rethink, CHK_WORDS.sure, CHK_WORDS.forgot] as const;
export type ChkChoice = 0 | 1 | 2;
/** Which screen a choice opens in the Tab list (the second one is the typed "yes" on the card itself). */
export type ChkScreen = "rethink" | "forgot";
export const screenOf = (c: ChkChoice): ChkScreen | null => (c === 0 ? "rethink" : c === 2 ? "forgot" : null);
export const isScreen = (v: unknown): v is ChkScreen => v === "rethink" || v === "forgot";

/** What is typed for "Are you sure?": yes, in any case, with spaces round it. */
export const sureOk = (typed: unknown): boolean => typeof typed === "string" && typed.trim().toLowerCase() === CHK_WORDS.yesWord;

// ---------- when it comes ----------
/** What keeps it away, first one wins. */
export type ChkBlock = "locked" | "protected" | "meeting" | "sleep" | "sentry" | "dnd" | "away" | "setup";
export interface ChkFacts {
  now: number;                 // ms
  /** The feature is on for this person and the switch in Settings is on. */
  enabled: boolean;
  /** The vault is open and the first download has arrived (never decide from a half loaded list). */
  ready: boolean;
  everyMin: number;
  /** The newest tick of any task, ms (0 = none known). */
  lastTickAt: number;
  openTasks: number;
  /** A pop-up of this reminder is up now. */
  cardOpen: boolean;
  block: ChkBlock | null;
  /** Another PS pop-up sits where this card would go (the website's Posture reminder): it waits, without restarting the count. */
  held?: boolean;
}
/** The clock: when counting began. It starts when PS opens and starts again after every pop-up, answer and quiet spell. */
export interface ChkClock { since: number }
export const chkStart = (now: number): ChkClock => ({ since: now });

/** The first thing in the way, or null. Meetings, Sleep mode, the Sentry cover, Do Not Disturb and being away all count. */
export function chkBlock(f: { locked: boolean; protectedFront: boolean; inMeeting: boolean; sleepMode: boolean; sentry: boolean; dnd: boolean; away: boolean; setup: boolean }): ChkBlock | null {
  if (f.locked) return "locked";
  if (f.protectedFront) return "protected";
  if (f.inMeeting) return "meeting";
  if (f.sleepMode) return "sleep";
  if (f.sentry) return "sentry";
  if (f.dnd) return "dnd";
  if (f.away) return "away";
  if (f.setup) return "setup";
  return null;
}

/** One look at the clock (every few seconds). `fire` true means: show the pop-up now.
 *  Rules: no task ticked for the whole interval; any quiet spell (meeting, Sleep mode, away...) restarts the count, so
 *  the pop-up never lands the moment a meeting ends; nothing to do (no open task) restarts it too; a pop-up already up
 *  never stacks another; a clock that went backwards (a changed Mac clock) starts again. */
export function chkStep(c: ChkClock, f: ChkFacts): { clock: ChkClock; fire: boolean } {
  const reset = { clock: { since: f.now }, fire: false };
  if (!f.enabled || !f.ready || f.cardOpen || f.block || f.openTasks < 1) return reset;
  if (c.since > f.now) return reset;
  const ref = Math.max(c.since, Math.min(f.lastTickAt, f.now));   // a tick stamped by a clock that runs ahead counts as now, never as none
  if (f.now - ref < f.everyMin * 60_000 || f.held) return { clock: c, fire: false };
  return { clock: { since: f.now }, fire: true };
}

/** The newest tick among tasks (doneAt of every finished one), ms; 0 when none. */
export function lastTickOf(todos: { data: Pick<Todo, "done" | "doneAt"> }[]): number {
  let best = 0;
  for (const t of todos) {
    if (!t.data.done || !t.data.doneAt) continue;
    const ms = Date.parse(t.data.doneAt);
    if (Number.isFinite(ms) && ms > best) best = ms;
  }
  return best;
}

// ---------- the checklist ----------
/** The tasks that are on the checklist now: every task still to do on a list (Priority 1, priorities, the repeating ones that are
 *  due, a group's), in the order of the lists. The AI Inbox is not on a list, so it is not counted. */
export function checklistTasks(lists: { p1: Doc<Todo>[]; prio: Doc<Todo>[]; daily: Doc<Todo>[]; groups: Map<string, Doc<Todo>[]> }): Doc<Todo>[] {
  const seen = new Set<string>();
  const out: Doc<Todo>[] = [];
  for (const d of [...lists.p1, ...lists.prio, ...lists.daily, ...[...lists.groups.values()].flat()]) {
    if (d.data.done || seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

/** How many tasks are over the limit (9 tasks: 4). */
export const overBy = (total: number): number => Math.max(0, Math.floor(total) - CHK_MAX_TASKS);

/** The Rethink counter: tasks removed so far out of the ones over the limit when the screen opened.
 *  `need` 0 means the list was already short enough: no counter. */
export interface ChkCounter { need: number; gone: number; shown: number; label: string; reached: boolean }
export function counter(totalAtOpen: number, gone: number): ChkCounter {
  const need = overBy(totalAtOpen), g = Math.max(0, Math.floor(gone)), shown = Math.min(need, g);
  return { need, gone: g, shown, label: `${CHK_WORDS.del} ${shown}/${need} tasks`, reached: need > 0 && g >= need };
}

/** Dimension X bands a task can be sent to, in the order Dimension X shows them. */
export const CHK_BANDS: { zone: DimxZone; title: string }[] = [
  { zone: "act", title: "Actionables" },
  { zone: "soon", title: "The Upside Down" },
  { zone: "x", title: "Dimension X" },
];

/** A Dimension X card for a task (text only, as Dimension X makes it when a task is dragged out of the list). */
export function dimxCard(task: { id: string; title: string }, zone: DimxZone, createdAt: string): DimxItem {
  return { id: task.id, text: (task.title || "").trim().slice(0, 500) || "Untitled task", zone, createdAt };
}
/** The band list with the card added at the top of its band (a card with the same id is replaced, never doubled). */
export function withCard(list: DimxItem[], card: DimxItem): DimxItem[] {
  const rest = list.filter((x) => x.id !== card.id);
  const at = rest.findIndex((x) => x.zone === card.zone);
  return at < 0 ? [...rest, card] : [...rest.slice(0, at), card, ...rest.slice(at)];
}
/** Undo of a send: the card leaves the list again. */
export const withoutCard = (list: DimxItem[], id: string): DimxItem[] => list.filter((x) => x.id !== id);

/** Writes to Dimension X and the task list, one after the other. Dimension X is saved as a whole list, so each write is built from the list
 *  this queue wrote last (`live` can still be one write behind: the Tab list window gets the state back through the main page), never
 *  from a stale copy. A send saves its card FIRST and deletes the task only after that write went through, so a task is never gone
 *  without its card. Every job answers true when it all worked, false when something threw (nothing after the failing step ran). */
export function dimxQueue(live: () => DimxItem[], write: (list: DimxItem[]) => Promise<unknown> | unknown, remove: (id: string) => Promise<unknown> | unknown) {
  let mine: DimxItem[] | null = null, busy = 0, chain: Promise<unknown> = Promise.resolve();
  const run = (job: () => Promise<unknown> | unknown): Promise<boolean> => {
    busy++;
    const p = chain.then(job).then(() => true, () => false).finally(() => { busy--; });
    chain = p;
    return p;
  };
  const put = async (f: (cur: DimxItem[]) => DimxItem[]) => { const next = f(mine ?? live()); mine = next; await write(next); };
  return {
    run,
    /** Save the card, then delete the task. */
    send: (card: DimxItem) => run(async () => { await put((c) => withCard(c, card)); await remove(card.id); }),
    /** Take the card back out (after the task was restored by `restore`). */
    unsend: (id: string, restore: () => Promise<unknown> | unknown) => run(async () => { await restore(); await put((c) => withoutCard(c, id)); }),
    /** The page's own list came back: trust it again once nothing is being written. */
    fresh: () => { if (busy === 0) mine = null; },
  };
}

/** "Add it to the Dynamic Island" only when the task is not already one of the tasks the island shows. */
export const needsIslandPin = (working: readonly string[], id: string): boolean => !working.includes(id);

// ---------- the card the Mac shows ----------
/** The same pink card as the Annoying 15 minute reminder (core/remind.ts REM_COLOURS "pink"). */
export const CHK_BG = "#28121e", CHK_ACCENT = "#ec4e86";
/** What the page hands the Mac for its pop-up (Sources/Reminders.swift, "rem:chk" and the Settings test): the words worked out, three
 *  choices, the second one the typed yes. */
export function chkCardItem(cfg: ChkSettings): Record<string, unknown> {
  return {
    id: "chk", on: true, pill: CHK_WORDS.pill, text: CHK_WORDS.headline, choices: [...CHK_CHOICES], sure: 1,
    ask: `${CHK_WORDS.areYouSure} ${CHK_WORDS.typeYes}`, word: CHK_WORDS.yesWord, click: false,
    bg: CHK_BG, accent: CHK_ACCENT, sound: cfg.sound ? "soft" : "none", vol: 0.8,
  };
}

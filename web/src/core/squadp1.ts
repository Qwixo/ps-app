// G Squad Priority 1 (PS 1.63, feature "squad-p1"; the developer's friend, 15 Nov 2026: "Priority one tasks are shared by default ...
// you have 24 hours to complete a P1 task; if you don't, each person in the G Squad gets a message saying who did not complete
// their task"). Pure rules only, no screen, no network, no clock of its own, so tests/squadp1.test.ts checks every one.
//
// What leaves the device (the privacy story): nothing, unless the person said yes to "Priority 1 tasks" (the P1 share piece, off
// until they answered; core/squadshare.ts). A P1 that is shared goes through the same gate as every squad copy: sealed with the
// squad key by sealForSquad (which refuses an opted out piece before it touches the key), the same neutral "Client task" title
// rule when it names a client, the same hub rows. A task marked Hide from the squad (Todo.sqOff) is never sealed. The copy holds the
// title, the date, done, and one extra field: `s`, the moment the task became Priority 1 (the 24 hour clock starts there).
//
// The "did not complete" message is never sent by PS to anyone (rule 9: PS never messages another person by itself). Every viewer's
// own PS works it out from the shared copies it already holds and shows a card on its own screen, once per task per device.

import type { Doc, Todo } from "./model.ts";
import type { TaskCopy } from "./squadshare.ts";
import { clientTerms, squadTitle, type ClientTerm } from "./squadanon.ts";
import { ledgerDecide, type Ledger } from "./maildedupe.ts";

export const P1_FEATURE = "squad-p1";
/** The clock: a P1 task has this long from the moment it became Priority 1. */
export const P1_WINDOW_MS = 24 * 3_600_000;
/** The person's own gentle reminder comes this long before their own deadline. */
export const P1_REMIND_BEFORE_MS = 2 * 3_600_000;
/** A task that just became P1 is not sealed for this long, so the right click menu's "Hide from the squad" is always in time. */
export const P1_GRACE_MS = 10 * 60_000;
/** A done P1 stays on the squad's panel (with its tick) this long after it was done. */
export const P1_DONE_SHOW_MS = 6 * 3_600_000;
/** A missed P1 stays on the panel this long after its deadline, and its alert is never raised later than this. */
export const P1_MISSED_SHOW_MS = 24 * 3_600_000;
export const P1_ROWS_MAX = 8;
export const P1_SHARE_MAX = 40;

const ms = (iso: unknown): number => (typeof iso === "string" ? Date.parse(iso) : NaN);
/** A usable ISO time, or null. Nothing from the future past a minute of clock difference is believed. */
export function cleanStart(iso: unknown, now: number): string | null {
  const t = ms(iso);
  if (!Number.isFinite(t) || t < Date.UTC(2020, 0, 1)) return null;
  if (t > now + 60_000) return null;
  return new Date(t).toISOString();
}
export const p1Deadline = (startIso: string): number => ms(startIso) + P1_WINDOW_MS;

// ---------- the person's own settings ----------
/** Has the person answered the Priority 1 notice (keep or turn off)? Until then their P1s are shared (the default) and the notice shows once. */
export const p1Answered = (opts: { p1?: unknown } | null | undefined): boolean => typeof opts?.p1 === "boolean";
/** Does the person see the squad's P1 tasks in the side panel? (missing = on) */
export const p1PanelOn = (featureOn: boolean, st: { squadP1Show?: boolean } | null | undefined): boolean => featureOn && st?.squadP1Show !== false;

/** Is Priority 1 sharing on for this person? On unless they turned it off (shared by default, opt out, PS 1.63). */
export const p1On = (opts: { p1?: unknown } | null | undefined): boolean => opts?.p1 !== false;
/** What to do about the P1 notice for this person. Everyone (new or existing) gets the same one notice, once they are in a squad.
 *  keep: they already answered. tell: show the notice now (Keep it on / Turn off). wait: not in a squad yet, nothing shown.
 *  Sharing is on by default either way; Turn off (the card, or the switch in G Squad settings) saves p1 = false for good. */
export function p1Default(inSquad: boolean, opts: { p1?: unknown } | null | undefined): "keep" | "tell" | "wait" {
  if (p1Answered(opts)) return "keep";
  return inSquad ? "tell" : "wait";
}

// ---------- the 24 hour clock on your own tasks ----------
const live = (d: Doc<Todo>) => d.kind === "todo" && !!d.data && !d.data.clearedAt && (d.data as { example?: boolean }).example !== true;
/** A task that may carry a P1 clock at all: a one off P1, not an example, not hidden from the squad. */
export function p1Clockable(t: Pick<Todo, "p1" | "type" | "sqOff" | "aiInbox">): boolean {
  return t.p1 === true && t.type !== "daily" && t.sqOff !== true && t.aiInbox !== true;
}
/** What to write on your tasks so every P1 has its start time and no other task does:
 *  - a P1 you share with no start yet gets `now` (a task that was already P1 when this came in starts now, never in the past);
 *  - a start on a task that is no longer P1 (or is now hidden, daily or cleared) is taken off, whatever the settings say,
 *    so a later P1 never inherits an old clock;
 *  - a P1 that was done and then reopened starts a fresh clock (its done time is later than its start);
 *  - while the person does not want P1 shared (`opted` false: the switch or the feature is off, or they left the squad) every
 *    start is taken off, so switching it on again starts a fresh 24 hours and never an instant Missed for time spent opted out.
 *  active: this person shares P1 now (opted, and in a squad); without it nothing is ever started.
 *  opted: defaults to active. Pass opted true with active false for "wants it, squad not loaded yet": nothing is started or cleared. */
export function p1Stamps(todos: Doc<Todo>[], o: { active: boolean; now: number; opted?: boolean }): { id: string; p1At: string | null }[] {
  const out: { id: string; p1At: string | null }[] = [];
  const nowIso = new Date(o.now).toISOString();
  const opted = o.opted ?? o.active;
  for (const d of todos) {
    if (d.kind !== "todo" || !d.data) continue;
    const t = d.data;
    const start = cleanStart(t.p1At, o.now);
    const keeps = live(d) && p1Clockable(t);
    if (!keeps || !opted) { if (t.p1At) out.push({ id: d.id, p1At: null }); continue; }
    if (start && !t.done) {
      const doneAt = ms(t.doneAt);
      if (Number.isFinite(doneAt) && doneAt >= ms(start) && o.active) out.push({ id: d.id, p1At: nowIso });   // reopened
      continue;
    }
    if (!start && o.active && !t.p1At) out.push({ id: d.id, p1At: nowIso });
    else if (!start && t.p1At) out.push({ id: d.id, p1At: o.active ? nowIso : null });   // a start from the future or nonsense is replaced
  }
  return out;
}

// ---------- what you share ----------
/** The squad copies of your P1 tasks (before sealing). Nothing once the P1 switch is off. A task needs its start time and
 *  must be older than the grace time; hidden (Not shared), daily, example and cleared tasks never appear. Done stays a day. */
export function p1Copies(todos: Doc<Todo>[], opts: { p1?: unknown } | null | undefined, clients: Parameters<typeof clientTerms>[0], now: number): { todoId: string; copy: TaskCopy }[] {
  if (!p1On(opts)) return [];
  const terms: ClientTerm[] = clientTerms(clients);
  const out: { todoId: string; copy: TaskCopy; at: number }[] = [];
  for (const d of todos) {
    if (!live(d) || !p1Clockable(d.data)) continue;
    const t = d.data;
    const s = cleanStart(t.p1At, now);
    if (!s || now - ms(s) < P1_GRACE_MS) continue;
    if (t.done) {
      const doneAt = ms(t.doneAt);
      if (!Number.isFinite(doneAt) || now - doneAt > 24 * 3_600_000) continue;
    }
    const name = squadTitle(t, terms);
    const copy: TaskCopy = { t: name.title, p: 1, d: typeof t.due === "string" ? t.due.slice(0, 10) : null, x: !!t.done, s };
    if (t.done && t.doneAt) copy.xa = t.doneAt;
    if (name.anon) copy.a = true;
    out.push({ todoId: d.id, copy, at: ms(s) });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, P1_SHARE_MAX).map(({ todoId, copy }) => ({ todoId, copy }));
}

/** The right click menu line for one of your tasks: Hide from the squad (or show it again). Only on a one off P1, only while the
 *  feature and your P1 switch are on. Hiding sets Not shared (Todo.sqOff): the task is never sealed, and a copy already on the hub is taken off. */
export function p1HideItem(t: Pick<Todo, "p1" | "type" | "sqOff" | "done">, o: { featureOn: boolean; shareP1: boolean }): { label: string; sqOff: boolean } | null {
  if (!o.featureOn || !o.shareP1 || t.p1 !== true || t.type === "daily" || t.done) return null;
  return t.sqOff === true ? { label: "Show to the squad again", sqOff: false } : { label: "Hide from the squad", sqOff: true };
}

// ---------- what you see ----------
export interface P1Row { id: string; member: string; t: string; s: string; x: boolean; xa?: string }
const firstWord = (v: string) => v.replace(/\s+/g, " ").trim().split(" ")[0] || "";
/** "Kit Doe" becomes "Kit". Never empty. */
export const firstName = (name: string | null | undefined): string => firstWord(String(name ?? "")).slice(0, 30) || "Someone";

/** The squad's P1 rows from the copies this device holds: only other people's, only copies with a start time, and only while they
 *  are worth showing (open, missed up to a day, done up to a few hours). Open ones first by time left, then missed, then done. */
export function p1Rows(copies: { id: string; member: string; t: string; x: boolean; xa?: string | null; s?: string | null; e?: boolean }[], o: { me: string; live: ReadonlySet<string>; now: number }): P1Row[] {
  const rows: P1Row[] = [];
  for (const c of copies) {
    if (c.member === o.me || !o.live.has(c.member) || c.e) continue;
    const s = cleanStart(c.s, o.now);
    if (!s || typeof c.t !== "string" || !c.t.trim()) continue;
    const dl = p1Deadline(s);
    const row: P1Row = { id: c.id, member: c.member, t: c.t.slice(0, 300), s, x: c.x === true };
    if (row.x) {
      const at = ms(c.xa);
      if (Number.isFinite(at) && o.now - at > P1_DONE_SHOW_MS) continue;
      if (typeof c.xa === "string") row.xa = c.xa;
    } else if (o.now - dl > P1_MISSED_SHOW_MS) continue;
    rows.push(row);
  }
  const rank = (r: P1Row, now: number) => (r.x ? 2 : now >= p1Deadline(r.s) ? 1 : 0);
  return rows.sort((a, b) => rank(a, o.now) - rank(b, o.now) || p1Deadline(a.s) - p1Deadline(b.s) || a.id.localeCompare(b.id));
}
/** The side panel shows the first few of all the rows. Alerts are always planned from ALL rows (p1Rows), never from this list. */
export const p1Panel = (rows: P1Row[]): P1Row[] => rows.slice(0, P1_ROWS_MAX);

export type P1State = { kind: "done" } | { kind: "open"; left: number } | { kind: "missed"; late: number };
export function p1State(r: Pick<P1Row, "s" | "x">, now: number): P1State {
  if (r.x) return { kind: "done" };
  const left = p1Deadline(r.s) - now;
  return left > 0 ? { kind: "open", left } : { kind: "missed", late: Math.max(0, -left) + 0 };
}
/** "23h", "2h 10m", "35m", "Under 1m". */
export function leftText(leftMs: number): string {
  if (!(leftMs >= 60_000)) return "Under 1m";
  const m = Math.ceil(leftMs / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return h >= 6 || r === 0 ? `${h}h` : `${h}h ${r}m`;
}
/** What the row's right end says. */
export function stateText(st: P1State): string {
  return st.kind === "done" ? "Done" : st.kind === "missed" ? "Missed" : leftText(st.left);
}

// ---------- the alerts, worked out on each person's own PS ----------
export const ALERT_PREFIX = "sp:";
export const alertKey = (member: string, id: string) => `p1:${member}:${id}`;
export const remindKey = (todoId: string, start: string) => `p1r:${todoId}:${start}`;
export const cardId = (key: string) => `${ALERT_PREFIX}${hash(key)}`;
/** A short stable id for a card (a card id is at most 40 characters). */
function hash(s: string): string {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) { a = Math.imul(a ^ s.charCodeAt(i), 0x01000193) >>> 0; b = (Math.imul(b ^ s.charCodeAt(i), 0x85ebca6b) + a) >>> 0; }
  return a.toString(36) + b.toString(36);
}

export type AlertWhy = "own" | "done" | "early" | "old" | "before" | "again" | "capped";
export interface AlertInput {
  me: string;
  /** Who is in the squad now, id to name. */
  names: ReadonlyMap<string, string>;
  now: number;
  /** When this device started watching (ISO). A deadline that passed before it never alerts (nothing fires at once after an update). */
  since: string | null;
  ledger: Ledger;
  /** Do Not Disturb, Sleep mode or Sentry mode is on: nothing is shown and nothing is used up, it comes when it ends. */
  held: boolean;
}
export interface AlertCard { key: string; id: string; member: string; title: string; body: string; at: string }
export interface AlertPlan { show: AlertCard[]; ledger: Ledger; skipped: { id: string; why: AlertWhy }[] }
export const ALERT_SHOW_MAX = 3;

/** Which missed P1s of other people alert now. A task alerts once per device, never your own, never while held. */
export function planMissedAlerts(rows: P1Row[], inp: AlertInput): AlertPlan {
  const skipped: AlertPlan["skipped"] = [];
  let ledger = inp.ledger;
  const fresh: AlertCard[] = [];
  const since = ms(inp.since);
  for (const r of [...rows].sort((a, b) => p1Deadline(a.s) - p1Deadline(b.s) || a.id.localeCompare(b.id))) {
    const skip = (why: AlertWhy) => skipped.push({ id: r.id, why });
    const dl = p1Deadline(r.s);
    if (r.member === inp.me) { skip("own"); continue; }
    if (r.x) { skip("done"); continue; }
    if (inp.now < dl) { skip("early"); continue; }
    if (inp.now - dl > P1_MISSED_SHOW_MS) { skip("old"); continue; }
    if (!Number.isFinite(since) || dl <= since) { skip("before"); continue; }
    const key = alertKey(r.member, r.id);
    if (Object.prototype.hasOwnProperty.call(ledger, key)) { skip("again"); continue; }
    if (inp.held) continue;   // not used up: it comes when the quiet time ends
    ledger = ledgerDecide(ledger, key, inp.now).ledger;
    fresh.push({ key, id: cardId(key), member: r.member, title: `${firstName(inp.names.get(r.member))} did not complete their task`, body: r.t.slice(0, 160), at: new Date(dl).toISOString() });
  }
  const show = fresh.slice(-ALERT_SHOW_MAX);
  for (const c of fresh.slice(0, Math.max(0, fresh.length - ALERT_SHOW_MAX))) skipped.push({ id: c.id, why: "capped" });
  return { show, ledger, skipped };
}

/** Your own gentle reminder: a P1 you share, not done, with under two hours left. Once per task and start time per device. */
export function planOwnReminders(todos: Doc<Todo>[], o: { shared: boolean; now: number; ledger: Ledger; held: boolean }): { show: AlertCard[]; ledger: Ledger } {
  if (!o.shared) return { show: [], ledger: o.ledger };
  let ledger = o.ledger;
  const show: AlertCard[] = [];
  for (const d of todos) {
    if (!live(d) || !p1Clockable(d.data) || d.data.done) continue;
    const s = cleanStart(d.data.p1At, o.now);
    if (!s) continue;
    const dl = p1Deadline(s);
    if (o.now < dl - P1_REMIND_BEFORE_MS || o.now >= dl) continue;
    const key = remindKey(d.id, s);
    if (Object.prototype.hasOwnProperty.call(ledger, key)) continue;
    if (o.held) continue;
    ledger = ledgerDecide(ledger, key, o.now).ledger;
    show.push({ key, id: cardId(key), member: "", title: `Your Priority 1 task is due in ${leftText(dl - o.now)}`, body: String(d.data.title || "").trim().slice(0, 160), at: new Date(dl).toISOString() });
  }
  return { show: show.slice(0, ALERT_SHOW_MAX), ledger };
}

/** The card both kinds use (the Mac's top right stack, the phone's notification). Tone squad: the Mac holds it back by itself while
 *  Sentry mode or Sleep mode covers the screen. The id never starts with "g:" (that is a chat message card, with Open and Reply). */
export function alertCard(c: AlertCard, own: boolean) {
  return {
    id: c.id.slice(0, 40), rev: c.key.slice(0, 80), tone: "squad", icon: "chat", title: c.title.slice(0, 160), sub: own ? "Priority 1" : "G Squad", body: c.body, at: c.at,
    discreetText: own ? "A Priority 1 task is due soon" : "A G Squad task was missed",
  };
}

// A fuller task history (PS 1.65, the developer's friend, 17 Nov 2026: "as much data as possible on what tasks are done every day,
// and when someone fails a task that must be recorded too"). Pure rules, tested in tests/taskhist.test.ts.
//
// Where it lives: inside the same day log record Reset already writes (kind "daylog", core/daylog.ts), so it is the same owner only
// record, sealed with the vault key, synced to the person's own Supabase like every vault record. Nothing here goes to the G Squad,
// the hub, or anyone else. A log from an older PS has none of the new fields and reads exactly as before.
//
// Per work day: done (the ticks, as before), missed (open at Reset and due that day, or Priority 1, or a repeating task not
// ticked), added, deleted, moved to Dimension X, and the totals. Small on purpose: at most 60 of each list per day, titles cut to 80.
import type { Doc, Todo } from "./model.ts";
import { isEveryDay, isRepeating } from "./repeat.ts";

export const TH = { max: 60, title: 80, p1WindowMs: 24 * 3_600_000 };

/** One task that was not done. p1: it was Priority 1. rep: a repeating task. due: its date. c: client id. age: whole days it had been open.
 *  s: when it became Priority 1, only when its 24 hours (G Squad Priority 1, core/squadp1.ts) had run out. */
export interface MissedItem { id: string; t: string; p1?: 1; rep?: 1; due?: string; c?: string; age?: number; s?: string }
/** One thing that happened to a task: added, deleted, or moved to Dimension X. */
export interface EvItem { id: string; t: string; at: string; p1?: 1; c?: string }
export interface DayTotals { done: number; missed: number; p1Done: number; p1Missed: number; added: number; deleted: number; dimx: number }
export type EvKind = "added" | "deleted" | "dimx";

/** The switch (Settings, Privacy and sharing, "Fuller task history", settings.taskHistory): missing = on. Off stops new missed, added, deleted
 *  and Dimension X notes and hides them; what was already kept is not touched. */
export const historyOn = (st: { taskHistory?: unknown } | null | undefined): boolean => st?.taskHistory !== false;

const trim = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, TH.title);
const ms = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);

/** Everything still open for `day` when a Reset runs at `nowMs`. Examples, cleared, done and deleted tasks never count. */
export function planMissed(list: Doc<Todo>[], o: { day: string; nowMs: number; dayOf?: (ms: number) => string }): MissedItem[] {
  // dayOf: which Reset day a moment belongs to, the same rule that picked `day` (core/resetplan.ts). Without it, the UTC date.
  const dayOf = o.dayOf ?? ((ms: number) => new Date(ms).toISOString().slice(0, 10));
  const out: MissedItem[] = [];
  for (const d of list) {
    const t = d.data;
    if (!t || d.kind !== "todo" || t.example || t.clearedAt || t.done || t.aiInbox) continue;
    const rep = isRepeating(t);
    const dueDay = typeof t.due === "string" ? t.due.slice(0, 10) : "";
    // Every day tasks: not ticked is missed. A longer repeat only on its due day. A one off only on its due day. Priority 1: missed
    // once, on the day its own 24 hours (core/squadp1.ts, from p1At) ran out without it being done. No start time: like a one off.
    const start = ms(t.p1At);
    const p1Late = t.p1 === true && Number.isFinite(start) && start + TH.p1WindowMs <= o.nowMs && dayOf(start + TH.p1WindowMs) === o.day;
    const hit = rep ? (isEveryDay(t) || dueDay === o.day) : (p1Late || dueDay === o.day);
    if (!hit) continue;
    const m: MissedItem = { id: d.id, t: trim(t.title) };
    if (t.p1) m.p1 = 1;
    if (rep) m.rep = 1;
    if (dueDay) m.due = dueDay;
    if (t.clientId) m.c = String(t.clientId);
    const made = ms(t.createdAt);
    if (Number.isFinite(made) && o.nowMs >= made) m.age = Math.floor((o.nowMs - made) / 864e5);
    if (t.p1 && Number.isFinite(start) && o.nowMs - start > TH.p1WindowMs) m.s = new Date(start).toISOString();
    out.push(m);
  }
  return out.sort((a, b) => Number(!!b.p1) - Number(!!a.p1) || (b.age ?? 0) - (a.age ?? 0) || a.id.localeCompare(b.id));
}
export const capMissed = (l: MissedItem[]) => l.slice(0, TH.max);

/** The totals of one day. The counts of things that were cut off by the cap (missed) or happened (added, deleted, Dimension X) are
 *  kept in totals, so they stay right past 60 items. */
export function totalsOf(log: { items: { p1?: boolean; parentId?: string; todoId: string }[]; totals?: DayTotals; missed?: MissedItem[] }, set: Partial<DayTotals> = {}): DayTotals {
  const ticks = log.items.filter((i) => !i.parentId && !i.todoId.includes("/"));
  const prev = log.totals;
  return {
    done: ticks.length,
    p1Done: ticks.filter((i) => i.p1).length,
    missed: set.missed ?? prev?.missed ?? log.missed?.length ?? 0,
    p1Missed: set.p1Missed ?? prev?.p1Missed ?? (log.missed || []).filter((m) => m.p1).length,
    added: set.added ?? prev?.added ?? 0,
    deleted: set.deleted ?? prev?.deleted ?? 0,
    dimx: set.dimx ?? prev?.dimx ?? 0,
  };
}

/** Note one add, delete or move to Dimension X on its day's log. Once per task per kind per day. Null when nothing changed. */
export function addEvent(existing: { date: string; items: any[]; updatedAt: string; [k: string]: any } | undefined, date: string, kind: EvKind,
  ev: { id: string; title: string; p1?: boolean; clientId?: string | null }, at: string): any | null {
  const log = existing ? structuredClone(existing) : { date, items: [], updatedAt: at };
  const list: EvItem[] = log[kind] || [];
  if (list.some((x) => x.id === ev.id)) return null;
  const e: EvItem = { id: ev.id, t: trim(ev.title), at };
  if (ev.p1) e.p1 = 1;
  if (ev.clientId) e.c = String(ev.clientId);
  if (list.length < TH.max) log[kind] = [...list, e];
  const base = totalsOf(log);
  log.totals = { ...base, [kind]: base[kind] + 1 };
  log.updatedAt = at;
  return log;
}

/** Done and Priority 1 done come from the ticks themselves (an older PS adds ticks without touching the totals). */
const doneOf = (items: unknown, stored: number, p1 = false): number => {
  if (!Array.isArray(items)) return stored;
  return items.filter((i) => i && typeof i === "object" && !i.parentId && typeof i.todoId === "string" && !i.todoId.includes("/") && (!p1 || i.p1)).length;
};

/** Read any stored day log safely: the new fields are cleaned, a log from an older PS comes back with empty lists. */
export function readDay(log: unknown): { missed: MissedItem[]; added: EvItem[]; deleted: EvItem[]; dimx: EvItem[]; totals: DayTotals | null } {
  const o = (log && typeof log === "object" ? log : {}) as Record<string, unknown>;
  const arr = <T,>(v: unknown, ok: (x: any) => boolean): T[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object" && ok(x)) as T[] : []);
  const idt = (x: any) => typeof x.id === "string" && typeof x.t === "string";
  const tt = o.totals && typeof o.totals === "object" ? o.totals as Record<string, unknown> : null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return { missed: arr<MissedItem>(o.missed, idt), added: arr<EvItem>(o.added, idt), deleted: arr<EvItem>(o.deleted, idt), dimx: arr<EvItem>(o.dimx, idt),
    totals: tt ? { done: doneOf(o.items, n(tt.done)), missed: n(tt.missed), p1Done: doneOf(o.items, n(tt.p1Done), true), p1Missed: n(tt.p1Missed), added: n(tt.added), deleted: n(tt.deleted), dimx: n(tt.dimx) } : null };
}

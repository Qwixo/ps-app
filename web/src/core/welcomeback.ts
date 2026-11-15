// Welcome back on the Mac island (PS 1.60, item 26). After the Mac was left for a while, the island grows into a panel
// with the tasks the person was working on as a tick list. The rules for "left for a while" and the Mac's triggers are
// in ps-mac WelcomeBackCore.swift; this file holds the person's setting and which tasks count as "working on".
// Pure: no vault, no clock.
import type { Doc, Settings, Todo } from "./model";
import { PRIVATE_TITLE } from "./island.ts";

export interface WelcomePrefs { on: boolean; minutes: number }
export const WELCOME_DEFAULT: WelcomePrefs = { on: true, minutes: 15 };
export const WELCOME_LIMITS = [1, 720] as const;
/** Most tasks in the tick list (the island panel stays a small panel). */
export const WELCOME_MAX_TASKS = 6;

export const WELCOME_WORDS = {
  settingOn: "Welcome back on the island",
  settingMinutes: "Show it after being away this long",
  hint: "After you were away from the Mac for a while, the island says Welcome back and lists the tasks you were working on, so you can tick the ones you finished.",
  title: "Welcome back",
  sub: "Tick any tasks you've done",
  done: "Done",
} as const;

export function welcomePrefs(v: unknown): WelcomePrefs {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : {};
  const n = typeof o.minutes === "number" ? o.minutes : typeof o.minutes === "string" && o.minutes.trim() !== "" ? Number(o.minutes) : NaN;
  return {
    on: o.on !== false,
    minutes: Number.isFinite(n) ? Math.min(WELCOME_LIMITS[1], Math.max(WELCOME_LIMITS[0], Math.round(n))) : WELCOME_DEFAULT.minutes,
  };
}

export interface WelcomeTask { id: string; title: string }
export interface WelcomeIn { on: boolean; minutes: number; tasks: WelcomeTask[] }

const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 120);

/** The tasks the person was working on: the ones marked "working on" (in the order they were marked) that are still open,
 *  in the list and not cleared by a reset, up to six. Nothing marked: no list, so no Welcome back (nothing to tick).
 *  Private mode: the names stay hidden (the same label as the island's). */
export function welcomeTasks(todos: Doc<Todo>[], settings: Partial<Settings>, priv: boolean): WelcomeTask[] {
  const byId = new Map(todos.map((d) => [d.id, d]));
  const ids = settings.workingIds ?? (settings.workingOn ? [settings.workingOn] : []);
  const out: WelcomeTask[] = [], seen = new Set<string>();
  for (const id of ids) {
    const d = byId.get(id);
    if (!d || seen.has(id) || d.data.done || d.data.clearedAt) continue;
    seen.add(id);
    out.push({ id, title: priv ? PRIVATE_TITLE : clip(d.data.title || "") || "Untitled task" });
    if (out.length >= WELCOME_MAX_TASKS) break;
  }
  return out;
}

/** What the island is told about Welcome back. */
export function welcomeIsland(todos: Doc<Todo>[], settings: Partial<Settings>, priv: boolean): WelcomeIn {
  const p = welcomePrefs(settings.welcomeBack);
  return { on: p.on, minutes: p.minutes, tasks: p.on ? welcomeTasks(todos, settings, priv) : [] };
}

/** Done on the panel: the ids ticked there, as the Mac sent them (a JSON list). Only tasks the island was told about and
 *  that are still open can be ticked, each once; anything else is ignored. */
export function welcomeDoneIds(raw: unknown, told: WelcomeTask[], todos: Map<string, Doc<Todo>>): string[] {
  let list: unknown;
  try { list = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return []; }
  if (!Array.isArray(list)) return [];
  const allowed = new Set(told.map((t) => t.id));
  const out: string[] = [];
  for (const id of list.slice(0, WELCOME_MAX_TASKS)) {
    if (typeof id !== "string" || !allowed.has(id) || out.includes(id)) continue;
    const d = todos.get(id);
    if (!d || d.data.done || d.data.clearedAt) continue;
    out.push(id);
  }
  return out;
}

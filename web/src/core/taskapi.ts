// The Task API (the developer's friend: "api so that my claude code can add tasks into the ps app"; the developer: "make the API have a
// dedicated tab in settings and set up the scope with everything changeable via API").
//
// How it runs: PS on the Mac (ps-mac TaskApi.swift) listens on 127.0.0.1 only, while PS is open. It checks the key,
// the Host and that no browser sent the request, keeps a rate limit, then hands the request to the main page as
// {type:"api:req"} with this Mac's switches. The main page (src/taskapi.ts) runs handleApi below against the open
// vault, through the same actions the Tab list uses, and answers {type:"api:res"}. The vault stays end to end
// encrypted: the request never leaves this Mac and nothing new is sent to a server in the clear.
//
// This file is the rules: the switches (scopes), every endpoint, what it checks, what it answers. Pure: the vault is
// behind the ApiStore interface, so the unit tests (tests/taskapi.test.ts) run every endpoint against a fake one.
// Never log a task's text (the shell logs the method, the path and the status only).
import type { Doc, Settings, Todo } from "./model";
import { GROUP_NAME_MAX, cleanGroups, groupKey, groupOf, tabLists, type TabLists } from "./groups.ts";
import { DEFAULT_NAMES, LIST_NAME_MAX, MAIN, SEC_NAME_MAX, allPages, cleanNames, listMoveTarget, pageOfSec, pageOrder, renamePage, shownName, tidyName } from "./lists.ts";
import { INBOX, INBOX_MAX, INBOX_NAME, inInbox, intoSection, listsCtx, sectionTakes } from "./aiinbox.ts";
import { API_GYM_FIELDS, API_GYM_YES, API_NO_YES, apiGym, apiGymPatch, gymPrefs } from "./gym.ts";
import { REM_TEXT_MAX, okTz, addTaskReminder, freshId, minutesOf, newTaskReminder, oneLine, patchReminder, reminderOfTask, remindOrDefault, removeReminder, type RemindRec } from "./remind.ts";

export const API_PORT = 47836;
export const API_VERSION = 1;
export const BATCH_MAX = 50;
export const TITLE_MAX = 500, NOTES_MAX = 2000;
export const LIST_LIMIT_DEF = 200, LIST_LIMIT_MAX = 500;

// ---------- the switches ----------
export type ScopeId = "inbox" | "lists" | "rename" | "read" | "add" | "edit" | "done" | "delete" | "remind" | "sentry" | "gym" | "settings";
export interface ScopeDef { id: ScopeId; group: "where" | "what"; label: string; line: string; def: boolean }
/** One switch per thing an AI may do (Settings, AI task API). Off unless switched on, except add, read and the inbox. */
export const SCOPES: ScopeDef[] = [
  { id: "inbox", group: "where", label: "AI Inbox", line: "Tasks in the AI Inbox, its own section in Dimension X.", def: true },
  { id: "lists", group: "where", label: "All lists and pages", line: "Every list, page and section you have, not just the AI Inbox.", def: false },
  { id: "rename", group: "where", label: "Rename lists and sections", line: "Change the names of your lists and sections.", def: false },
  { id: "read", group: "what", label: "Read tasks", line: "See tasks, lists and sections it can reach.", def: true },
  { id: "add", group: "what", label: "Add tasks", line: "Add new tasks (into the AI Inbox unless All lists is on).", def: true },
  { id: "edit", group: "what", label: "Edit and move tasks", line: "Change a task's name, notes, date or priority, or move it.", def: false },
  { id: "done", group: "what", label: "Tick tasks done", line: "Tick a task done or open it again.", def: false },
  { id: "delete", group: "what", label: "Delete tasks", line: "Delete tasks for good.", def: false },
  { id: "remind", group: "what", label: "Set reminders", line: "Put a reminder on a task, change it or take it off.", def: false },
  // The developer, 13 Nov 2026: "tell Claude Code to deploy Sentry Mode and it will get the PS app to deploy Sentry mode too". Start only.
  { id: "sentry", group: "what", label: "Start Sentry mode", line: "Lock this Mac and keep it awake for AI jobs. An AI can never turn it off.", def: false },
  // The developer, 13 Nov 2026 (V1.57): "a new switch "gym" ... (off by default) ... The API can never answer Yes for me."
  { id: "gym", group: "what", label: "Gym reminder", line: "Read and change your gym reminder times. An AI can never say Yes for you.", def: false },
  // The developer, 13 Nov 2026 (V1.57): Invert swipe "accessible via the API as well, so you can just tell your Claude to do it".
  { id: "settings", group: "what", label: "Change settings", line: "Read and change the settings listed for AI, for now Invert swipe.", def: false },
];
export type Scopes = Record<ScopeId, boolean>;
export const DEFAULT_SCOPES: Scopes = Object.fromEntries(SCOPES.map((s) => [s.id, s.def])) as Scopes;
export const scopeLabel = (id: ScopeId) => SCOPES.find((s) => s.id === id)?.label ?? id;
/** Known switches only; a missing one takes its default. */
export function cleanScopes(v: unknown): Scopes {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_SCOPES };
  for (const s of SCOPES) if (typeof o[s.id] === "boolean") out[s.id] = o[s.id] as boolean;
  return out;
}

// ---------- the request, the answer and the vault ----------
export interface ApiReq { method: string; path: string; query?: Record<string, string>; body?: unknown }
export interface ApiRes { status: number; body: unknown }
/** What the endpoints need from the vault (src/taskapi.ts gives the real one). */
export interface ApiStore {
  /** ok: the vault is open. locked: PS is open but signed out or locked. */
  state(): "ok" | "locked";
  todos(): Doc<Todo>[];               // every task not cleared by a reset
  settings(): Partial<Settings>;
  remind(): RemindRec | null;
  today(): string;                    // YYYY-MM-DD in the user's day
  now(): number;
  deviceTz(): string;
  red(): boolean;
  version(): string;
  add(t: Partial<Todo> & { title: string }): Promise<string>;
  update(id: string, patch: Partial<Todo>): Promise<void>;
  setDone(id: string, done: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  saveRemind(change: (rec: RemindRec | null) => RemindRec | null): Promise<void>;
  newGroupId(): string;
  /** Sentry mode, started exactly as the AI button starts it (views/Sentry.tsx startSentryForApi). There is no stop. */
  startSentry(): Promise<SentryStartResult>;
}
/** What starting Sentry mode came to (the same shape as views/Sentry.tsx SentryStart). */
export type SentryStartResult = { result: "engaged" | "already"; phase: "covered" | "locked" } | { result: "blocked"; title: string; lines: string[] }
  | { result: "refused"; note: string } | { result: "notStarted" } | { result: "noAnswer" } | { result: "unavailable" };

export type ErrCode = "bad_request" | "bad_field" | "unknown_field" | "not_found" | "method_not_allowed" | "scope_off" | "locked"
  | "wrong_section" | "not_a_task_list" | "inbox_full" | "too_many" | "internal" | "sentry_checks" | "sentry_refused" | "not_ready";
export const fail = (status: number, code: ErrCode, message: string, extra: Record<string, unknown> = {}): ApiRes =>
  ({ status, body: { error: { code, message, ...extra } } });
const ok = (body: unknown, status = 200): ApiRes => ({ status, body });
const scopeOff = (id: ScopeId): ApiRes => fail(403, "scope_off", `The "${scopeLabel(id)}" switch is off in PS (Settings, AI task API). Ask the person to switch it on if they want this.`, { scope: id });

// ---------- the task as the API shows it ----------
export interface ApiTask {
  id: string; title: string; notes: string | null; kind: "once" | "daily"; done: boolean; doneAt: string | null; due: string | null;
  p1: boolean; list: string; listName: string; section: string; sectionName: string; addedByAi: boolean; inInbox: boolean;
  createdAt: string | null; subtasks: { title: string; done: boolean }[];
  reminder: { date: string | null; time: string; until: string; on: boolean; message: string | null } | null;
}
type Ctx = ReturnType<typeof makeCtx>;
function makeCtx(store: ApiStore) {
  const st = store.settings();
  const { groups, pages, full, byPage } = listsCtx(st);
  const names = cleanNames(st.tmNames);
  const order = pageOrder(st.tmPageOrder, pages);
  const all = store.todos();
  const lists = tabLists(all, groups, store.today());
  const known = new Set(groups.map((g) => g.id));
  return { st, groups, pages, full, byPage, names, order, all, lists, known, rem: store.remind() };
}
const secName = (c: Ctx, key: string): string => {
  if (key === INBOX) return INBOX_NAME;
  const g = groupOf(key);
  if (g) return c.groups.find((x) => x.id === g)?.name ?? "Group";
  return shownName(c.names, key as "p1" | "prio" | "daily");
};
const listName = (c: Ctx, id: string): string => (id === INBOX ? INBOX_NAME : allPages(c.pages, c.names, c.order).find((p) => p.id === id)?.name ?? "List");
/** The section a task shows in (inbox: the AI Inbox). */
export function sectionOf(t: Todo, known: Set<string>): string {
  if (inInbox(t)) return INBOX;
  if (t.group && known.has(t.group)) return groupKey(t.group);
  if (t.type === "daily") return "daily";
  return t.p1 ? "p1" : "prio";
}
function view(d: Doc<Todo>, c: Ctx): ApiTask {
  const t = d.data;
  const section = sectionOf(t, c.known);
  const list = section === INBOX ? INBOX : pageOfSec(c.pages, section);
  const r = reminderOfTask(c.rem, d.id);
  return {
    id: d.id, title: t.title, notes: t.notes ?? null, kind: t.type === "daily" ? "daily" : "once", done: !!t.done, doneAt: t.doneAt ?? null,
    due: t.due ?? null, p1: t.type !== "daily" && !!t.p1, list, listName: listName(c, list), section, sectionName: secName(c, section),
    addedByAi: t.ai === true, inInbox: inInbox(t), createdAt: t.createdAt ?? null,
    subtasks: (t.subtasks ?? []).map((s) => ({ title: s.title, done: !!s.done })),
    reminder: r ? { date: r.date ?? null, time: r.at, until: r.until, on: r.on, message: r.text || null } : null,
  };
}
/** Can this AI reach this task with its switches. */
const reach = (t: Todo, sc: Scopes) => (inInbox(t) ? sc.inbox : sc.lists);
const reachOff = (t: Todo): ScopeId => (inInbox(t) ? "inbox" : "lists");

// ---------- checking what was sent ----------
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const okDay = (v: string) => DAY_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
type Body = Record<string, unknown>;
const isObj = (v: unknown): v is Body => !!v && typeof v === "object" && !Array.isArray(v);
function unknownField(b: Body, allowed: string[]): ApiRes | null {
  const bad = Object.keys(b).find((k) => !allowed.includes(k));
  return bad ? fail(400, "unknown_field", `Unknown field "${bad}". Allowed here: ${allowed.join(", ")}.`, { field: bad }) : null;
}
const badField = (field: string, message: string) => fail(400, "bad_field", message, { field });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "");

/** Where a task should go: a list page and/or a section, as sent. */
type Dest = { inbox: true } | { inbox: false; key: string | null; page: string };
function destOf(b: Body, c: Ctx): Dest | ApiRes {
  const list = b.list === undefined || b.list === null ? null : b.list, section = b.section === undefined || b.section === null ? null : b.section;
  if (list !== null && typeof list !== "string") return badField("list", "list must be a list id from GET /v1/lists, or \"inbox\".");
  if (section !== null && typeof section !== "string") return badField("section", "section must be a section key from GET /v1/lists.");
  if ((list === null || list === INBOX) && (section === null || section === INBOX)) return { inbox: true };
  if (list === INBOX || section === INBOX) return badField(list === INBOX ? "section" : "list", "The AI Inbox is its own list and section: send list \"inbox\" alone.");
  let page = list;
  if (page !== null && !c.order.includes(page)) return fail(404, "not_found", `No list "${page}". GET /v1/lists shows the lists.`, { field: "list" });
  if (section !== null) {
    const exists = ["p1", "prio", "daily"].includes(section) || (groupOf(section) !== null && c.known.has(groupOf(section)!));
    if (!exists) return fail(404, "not_found", `No section "${section}". GET /v1/lists shows each list's sections.`, { field: "section" });
    const on = pageOfSec(c.pages, section);
    if (page !== null && on !== page) return badField("section", `Section "${section}" is on list "${on}", not "${page}".`);
    page = on;
  }
  if (page !== MAIN && c.pages.find((p) => p.id === page)?.kind === "panels") return fail(409, "not_a_task_list", `"${listName(c, page!)}" is a page of panels, not a to-do list.`, { field: "list" });
  return { inbox: false, key: section, page: page! };
}
/** The fields that put a task of this kind at the end of the destination, plus a settings change when the list needs
 *  a new "To do" group first. */
async function placeIn(dest: Dest & { inbox: false }, type: Todo["type"], c: Ctx, store: ApiStore): Promise<Partial<Todo> | ApiRes> {
  let key = dest.key;
  if (key === null) {
    const t = listMoveTarget(c.lists, c.byPage.get(dest.page) ?? [], [type]);
    key = t?.to ?? null;
  }
  if (key !== null) {
    if (!sectionTakes(key, type)) return fail(409, "wrong_section", type === "daily"
      ? `"${secName(c, key)}" holds one-off tasks. A repeating (daily) task can go to "daily" or a task group.`
      : `"${secName(c, key)}" holds repeating tasks only. Send kind "daily", or pick another section.`, { field: "section" });
    return intoSection(key, c.lists);
  }
  // No section on that list takes it: a new "To do" group there, as the Tab list's Move to list does.
  if (c.groups.length >= 30) return fail(409, "too_many", "That list has no section for this task and there are already 30 task groups.");
  const gid = store.newGroupId();
  const gk = groupKey(gid);
  const tmPages = dest.page === MAIN ? undefined : c.pages.map((p) => ({ ...p, secs: p.id === dest.page ? [...p.secs, gk] : p.secs.filter((k) => k !== gk) }));
  await store.saveSettings({ tmGroups: [...c.groups, { id: gid, name: "To do" }], tmSecOrder: [...c.full, gk], ...(tmPages ? { tmPages } : {}) });
  c.groups.push({ id: gid, name: "To do" }); c.known.add(gid); c.full.push(gk);
  if (tmPages) { c.pages.splice(0, c.pages.length, ...tmPages); }
  c.byPage.set(dest.page, [...(c.byPage.get(dest.page) ?? []), gk]);
  c.lists.groups.set(gid, []);
  return { group: gid, order: 0 };
}

// ---------- the endpoints ----------
const ENDPOINTS = [
  "GET /v1", "GET /v1/lists", "PATCH /v1/lists/{id}", "PATCH /v1/sections/{key}",
  "GET /v1/tasks", "POST /v1/tasks", "GET /v1/tasks/{id}", "PATCH /v1/tasks/{id}", "DELETE /v1/tasks/{id}",
  "POST /v1/tasks/{id}/complete", "POST /v1/tasks/{id}/reopen", "PUT /v1/tasks/{id}/reminder", "DELETE /v1/tasks/{id}/reminder",
  "POST /v1/sentry/start",
  "GET /v1/gym", "PATCH /v1/gym",
  "GET /v1/settings", "PATCH /v1/settings",
];
/** The settings an AI may read and change (GET and PATCH /v1/settings): the API name, the settings record's field. */
export const API_SETTINGS = { invertSwipe: "swipeInvert" } as const;
/** Said whenever anything but POST /v1/sentry/start is asked of Sentry mode. */
export const SENTRY_NO_STOP = "Sentry mode can only be started through the API, never stopped, paused or changed. Leaving it needs the person's Mac password or Touch ID.";

/** One request, start to end. Never throws: a broken write answers 500 with no task text in it. */
export async function handleApi(req: ApiReq, scopesIn: unknown, store: ApiStore): Promise<ApiRes> {
  try { return await route(req, cleanScopes(scopesIn), store); }
  catch { return fail(500, "internal", "PS could not do that just now. Nothing was half done on purpose; read the task again before retrying."); }
}

async function route(req: ApiReq, sc: Scopes, store: ApiStore): Promise<ApiRes> {
  const method = String(req.method || "").toUpperCase();
  const path = String(req.path || "").split("?")[0].replace(/\/+$/, "") || "/";
  let seg: string[];
  try { seg = path.split("/").filter(Boolean).map(decodeURIComponent); } catch { return fail(400, "bad_request", "The path is not valid."); }
  if (seg[0] !== "v1") return fail(404, "not_found", "Every endpoint starts with /v1. GET /v1 lists them.");
  const q = req.query ?? {};
  const body = req.body;
  const allow = (...m: string[]) => (m.includes(method) ? null : fail(405, "method_not_allowed", `${method} is not used here. This path takes: ${m.join(", ")}.`, { allow: m }));
  const needBody = (): Body | ApiRes => (isObj(body) ? body : fail(400, "bad_request", "Send a JSON object as the body, with Content-Type: application/json."));

  // GET /v1: who is here, which switches are on. Answers even while the vault is locked.
  if (seg.length === 1) {
    const no = allow("GET"); if (no) return no;
    return ok({ app: "PS", api: API_VERSION, version: store.version(), vault: store.state() === "ok" ? "open" : "locked", scopes: sc, inbox: { id: INBOX, name: INBOX_NAME }, endpoints: ENDPOINTS });
  }
  if (store.state() !== "ok") return fail(423, "locked", "PS is open but signed out or locked, so it cannot read or change tasks. Ask the person to unlock PS, then try again.");

  // /v1/lists
  if (seg[1] === "lists" && seg.length === 2) {
    const no = allow("GET"); if (no) return no;
    if (!sc.read) return scopeOff("read");
    if (!sc.inbox && !sc.lists) return scopeOff("lists");
    const c = makeCtx(store);
    const out: unknown[] = [];
    if (sc.inbox) {
      const n = c.all.filter((d) => inInbox(d.data) && !d.data.done).length;
      out.push({ id: INBOX, name: INBOX_NAME, kind: "inbox", openTasks: n, sections: [{ key: INBOX, name: INBOX_NAME, takes: "any", openTasks: n }] });
    }
    if (sc.lists) {
      c.order.forEach((id, position) => {
        const page = c.pages.find((p) => p.id === id);
        const kind = page?.kind === "panels" ? "panels" : "list";
        const secs = kind === "panels" ? [] : (c.byPage.get(id) ?? []).map((key) => ({ key, name: secName(c, key), takes: key === "daily" ? "daily" : groupOf(key) ? "any" : "once", openTasks: openIn(c.lists, key) }));
        out.push({ id, name: listName(c, id), kind, position, home: id === MAIN, openTasks: secs.reduce((n, s) => n + s.openTasks, 0), sections: secs });
      });
    }
    return ok({ lists: out });
  }
  // PATCH /v1/lists/{id}: rename a list
  if (seg[1] === "lists" && seg.length === 3) {
    const no = allow("PATCH"); if (no) return no;
    if (!sc.rename) return scopeOff("rename");
    if (!sc.lists) return scopeOff("lists");
    const b = needBody(); if (!isObj(b)) return b;
    const u = unknownField(b, ["name"]); if (u) return u;
    const c = makeCtx(store);
    const id = seg[2];
    if (id === INBOX) return badField("name", "The AI Inbox keeps its name.");
    if (!c.order.includes(id)) return fail(404, "not_found", `No list "${id}". GET /v1/lists shows the lists.`);
    const name = tidyName(b.name, LIST_NAME_MAX);
    if (id === MAIN) {
      const names = { ...c.names };
      if (name && name !== DEFAULT_NAMES.main) names.main = name; else delete names.main;
      await store.saveSettings({ tmNames: names });
      return ok({ list: { id, name: name || DEFAULT_NAMES.main } });
    }
    if (!name) return badField("name", `name must be 1 to ${LIST_NAME_MAX} characters.`);
    await store.saveSettings({ tmPages: renamePage(c.pages, id, name) });
    return ok({ list: { id, name } });
  }
  // PATCH /v1/sections/{key}: rename a section
  if (seg[1] === "sections" && seg.length === 3) {
    const no = allow("PATCH"); if (no) return no;
    if (!sc.rename) return scopeOff("rename");
    if (!sc.lists) return scopeOff("lists");
    const b = needBody(); if (!isObj(b)) return b;
    const u = unknownField(b, ["name"]); if (u) return u;
    const c = makeCtx(store);
    const key = seg[2];
    const g = groupOf(key);
    if (g) {
      if (!c.known.has(g)) return fail(404, "not_found", `No section "${key}". GET /v1/lists shows the sections.`);
      const name = tidyName(b.name, GROUP_NAME_MAX);
      if (!name) return badField("name", `name must be 1 to ${GROUP_NAME_MAX} characters.`);
      await store.saveSettings({ tmGroups: cleanGroups(c.groups.map((x) => (x.id === g ? { ...x, name } : x))) });
      return ok({ section: { key, name } });
    }
    if (!["p1", "prio", "daily", "done"].includes(key)) return fail(404, "not_found", `No section "${key}". GET /v1/lists shows the sections.`);
    const k = key as "p1" | "prio" | "daily" | "done";
    const name = tidyName(b.name, SEC_NAME_MAX);
    const names = { ...c.names };
    if (name && name !== DEFAULT_NAMES[k]) names[k] = name; else delete names[k];
    await store.saveSettings({ tmNames: names });
    return ok({ section: { key, name: name || DEFAULT_NAMES[k] } });
  }

  // POST /v1/sentry/start: the one and only Sentry mode endpoint. Start only, no fields, no query: nothing can stop,
  // pause or weaken it from here (tests/taskapi.test.ts proves every other path and method is refused untouched).
  if (seg[1] === "sentry") {
    if (seg.length !== 3 || seg[2] !== "start") return fail(404, "not_found", `The only Sentry mode endpoint is POST /v1/sentry/start. ${SENTRY_NO_STOP}`);
    const no = allow("POST"); if (no) return fail(405, "method_not_allowed", `Use POST. ${SENTRY_NO_STOP}`, { allow: ["POST"] });
    if (!sc.sentry) return scopeOff("sentry");
    if (Object.keys(q).length) return fail(400, "unknown_field", `Sentry mode takes no settings through the API: it starts with the person's own Sentry settings. ${SENTRY_NO_STOP}`, { field: Object.keys(q)[0] });
    if (body !== undefined && body !== null && !(isObj(body) && !Object.keys(body).length))
      return fail(400, "unknown_field", `Sentry mode takes no settings through the API: send no body. ${SENTRY_NO_STOP}`, { field: isObj(body) ? Object.keys(body)[0] : "body" });
    const r = await store.startSentry();
    if (r.result === "engaged") return ok({ sentry: { started: true, phase: r.phase, note: SENTRY_NO_STOP } });
    if (r.result === "already") return ok({ sentry: { started: false, alreadyOn: true, phase: r.phase, note: SENTRY_NO_STOP } });
    if (r.result === "blocked") return fail(409, "sentry_checks", `PS did not start Sentry mode. ${r.title}: ${r.lines.join(" ")} Ask the person to fix this (PS Settings, Sentry mode, or Security), or to start Sentry mode in PS themselves.`, { title: r.title, lines: r.lines });
    if (r.result === "refused") return fail(409, "sentry_refused", r.note);
    if (r.result === "notStarted") return fail(409, "sentry_refused", "PS did not start Sentry mode just now (Sleep mode may be up). Ask the person.");
    return fail(503, "not_ready", r.result === "unavailable" ? "Sentry mode runs only in the PS app on a Mac." : "PS did not say whether Sentry mode started. Ask the person to look at the Mac before trying again.");
  }

  // GET and PATCH /v1/gym (V1.57): the gym reminder's times. Never a Yes: no field, path or method says Yes for the person.
  if (seg[1] === "gym") {
    if (seg.length !== 2) return fail(404, "not_found", `The gym endpoints are GET /v1/gym and PATCH /v1/gym. ${API_NO_YES}`);
    const no = allow("GET", "PATCH"); if (no) return no;
    if (!sc.gym) return scopeOff("gym");
    const st = store.settings();
    const tz = okTz(st.tmHomeTz) || store.deviceTz();
    const p = gymPrefs(st.gym, store.red());
    const acked = st.gymAck ?? [];
    if (method === "GET") return ok({ gym: apiGym(p, acked, store.now(), tz) });
    const b = needBody(); if (!isObj(b)) return b;
    const yes = Object.keys(b).find((k) => API_GYM_YES.includes(k));
    if (yes) return fail(400, "unknown_field", API_NO_YES, { field: yes });
    const u = unknownField(b, [...API_GYM_FIELDS]); if (u) return u;
    const r = apiGymPatch(p, b);
    if ("field" in r) return badField(r.field, r.message);
    await store.saveSettings({ gym: r.prefs });
    return ok({ gym: apiGym(r.prefs, acked, store.now(), tz) });
  }

  // GET and PATCH /v1/settings (V1.57): only the settings in API_SETTINGS, nothing else in the settings record.
  if (seg[1] === "settings") {
    if (seg.length !== 2) return fail(404, "not_found", "The settings endpoints are GET /v1/settings and PATCH /v1/settings.");
    const no = allow("GET", "PATCH"); if (no) return no;
    if (!sc.settings) return scopeOff("settings");
    const view = (st: Partial<Settings>) => ({ invertSwipe: st.swipeInvert === true });
    if (method === "GET") return ok({ settings: view(store.settings()) });
    const b = needBody(); if (!isObj(b)) return b;
    const u = unknownField(b, Object.keys(API_SETTINGS)); if (u) return u;
    if (!Object.keys(b).length) return fail(400, "bad_request", `Send at least one of: ${Object.keys(API_SETTINGS).join(", ")}.`);
    if ("invertSwipe" in b && typeof b.invertSwipe !== "boolean") return badField("invertSwipe", "invertSwipe must be true or false.");
    const patch: Partial<Settings> = {};
    if (typeof b.invertSwipe === "boolean") patch.swipeInvert = b.invertSwipe;
    await store.saveSettings(patch);
    return ok({ settings: view({ ...store.settings(), ...patch }) });
  }

  if (seg[1] !== "tasks" || seg.length > 4) return fail(404, "not_found", "No such endpoint. GET /v1 lists them.");

  // /v1/tasks
  if (seg.length === 2) {
    const no = allow("GET", "POST"); if (no) return no;
    return method === "GET" ? listTasks(q, sc, store) : addTasks(body, sc, store);
  }
  const id = seg[2];
  if (seg.length === 4 && !["complete", "reopen", "reminder"].includes(seg[3])) return fail(404, "not_found", "No such endpoint. GET /v1 lists them.");
  if (!ID_RE.test(id)) return fail(404, "not_found", "No task with that id.");
  const c = makeCtx(store);
  const d = c.all.find((x) => x.id === id);
  if (!d) return fail(404, "not_found", "No task with that id (it may have been deleted or cleared by a reset).");
  if (!reach(d.data, sc)) return scopeOff(reachOff(d.data));

  if (seg.length === 3) {
    const no = allow("GET", "PATCH", "DELETE"); if (no) return no;
    if (method === "GET") { if (!sc.read) return scopeOff("read"); return ok({ task: view(d, c) }); }
    if (method === "DELETE") {
      if (!sc.delete) return scopeOff("delete");
      await store.remove(id);
      if (reminderOfTask(c.rem, id)) await store.saveRemind((rec) => { const r = rec && reminderOfTask(rec, id); return rec && r ? removeReminder(rec, r.id, store.now()) : null; });
      return ok({ deleted: id });
    }
    return editTask(d, body, sc, store, c);
  }
  // /v1/tasks/{id}/complete, /reopen, /reminder
  const act = seg[3];
  if (act === "complete" || act === "reopen") {
    const no = allow("POST"); if (no) return no;
    if (!sc.done) return scopeOff("done");
    await store.setDone(id, act === "complete");
    return ok({ task: fresh(id, store, d, { done: act === "complete" }) });
  }
  if (act === "reminder") {
    const no = allow("PUT", "DELETE"); if (no) return no;
    if (!sc.remind) return scopeOff("remind");
    return reminder(d, method, body, store, c);
  }
  return fail(404, "not_found", "No such endpoint. GET /v1 lists them.");
}

const openIn = (l: TabLists, key: string) => {
  const g = groupOf(key);
  if (g) return (l.groups.get(g) ?? []).filter((d) => !d.data.done).length;
  return key === "p1" ? l.p1.length : key === "prio" ? l.prio.length : key === "daily" ? l.daily.filter((d) => !d.data.done).length : 0;
};
/** The task as saved now (a fake or slow store: what we sent, put on top of the copy we had). */
function fresh(id: string, store: ApiStore, before: Doc<Todo>, patch: Partial<Todo>): ApiTask {
  const c = makeCtx(store);
  const d = c.all.find((x) => x.id === id) ?? { ...before, data: { ...before.data, ...patch } };
  return view(d, c);
}

// GET /v1/tasks
function listTasks(q: Record<string, string>, sc: Scopes, store: ApiStore): ApiRes {
  if (!sc.read) return scopeOff("read");
  const known = ["list", "section", "status", "q", "limit"];
  const bad = Object.keys(q).find((k) => !known.includes(k));
  if (bad) return fail(400, "unknown_field", `Unknown query "${bad}". Allowed: ${known.join(", ")}.`, { field: bad });
  const c = makeCtx(store);
  const list = q.list || null, section = q.section || null;
  if (list === INBOX || section === INBOX) { if (!sc.inbox) return scopeOff("inbox"); }
  else if (list || section) { if (!sc.lists) return scopeOff("lists"); }
  if (!sc.inbox && !sc.lists) return scopeOff("inbox");
  if (list && list !== INBOX && !c.order.includes(list)) return fail(404, "not_found", `No list "${list}". GET /v1/lists shows the lists.`);
  const status = q.status || "open";
  if (!["open", "done", "all"].includes(status)) return badField("status", "status is open (default), done or all.");
  const limit = q.limit ? Number(q.limit) : LIST_LIMIT_DEF;
  if (!Number.isInteger(limit) || limit < 1 || limit > LIST_LIMIT_MAX) return badField("limit", `limit is 1 to ${LIST_LIMIT_MAX}.`);
  const words = (q.q || "").toLowerCase().trim();
  const pageIx = new Map(c.order.map((id, i) => [id, i + 1]));
  const secIx = new Map(c.full.map((k, i) => [k, i]));
  const byId = new Map(c.all.map((d) => [d.id, d.data]));
  const rows = c.all.filter((d) => reach(d.data, sc)).map((d) => view(d, c)).filter((t) => {
    if (list && t.list !== list) return false;
    if (section && t.section !== section) return false;
    if (status === "open" ? t.done : status === "done" ? !t.done : false) return false;
    if (words && !`${t.title} ${t.notes ?? ""}`.toLowerCase().includes(words)) return false;
    return true;
  });
  rows.sort((a, b) => (pageIx.get(a.list) ?? 0) - (pageIx.get(b.list) ?? 0) || (secIx.get(a.section) ?? -1) - (secIx.get(b.section) ?? -1)
    || (a.p1 === b.p1 ? 0 : a.p1 ? -1 : 1) || (byId.get(a.id)?.order ?? 0) - (byId.get(b.id)?.order ?? 0));
  return ok({ tasks: rows.slice(0, limit), count: rows.length, more: rows.length > limit });
}

// POST /v1/tasks: one task, or {"tasks": [...]} for up to BATCH_MAX at once
const ADD_FIELDS = ["title", "notes", "due", "kind", "p1", "list", "section"];
type NewTask = { t: Partial<Todo> & { title: string }; dest: Dest };
function checkNew(b: unknown, c: Ctx, at: string): NewTask | ApiRes {
  if (!isObj(b)) return fail(400, "bad_request", `${at}: each task is a JSON object with at least a title.`);
  const u = unknownField(b, ADD_FIELDS); if (u) return u;
  const title = text(b.title, TITLE_MAX);
  if (!title) return badField("title", `${at}: title is required (1 to ${TITLE_MAX} characters).`);
  const t: Partial<Todo> & { title: string } = { title };
  if (b.notes !== undefined && b.notes !== null) { if (typeof b.notes !== "string") return badField("notes", `${at}: notes is text.`); const n = b.notes.trim().slice(0, NOTES_MAX); if (n) t.notes = n; }
  const kind = b.kind ?? "once";
  if (kind !== "once" && kind !== "daily") return badField("kind", `${at}: kind is "once" (default) or "daily" (repeats every day).`);
  t.type = kind;
  if (b.due !== undefined && b.due !== null) {
    if (typeof b.due !== "string" || !okDay(b.due)) return badField("due", `${at}: due is a date like 2026-11-20.`);
    if (kind === "daily") return badField("due", `${at}: a daily task repeats every day, so it has no due date.`);
    t.due = b.due;
  }
  if (b.p1 !== undefined) { if (typeof b.p1 !== "boolean") return badField("p1", `${at}: p1 is true or false.`); if (b.p1 && kind === "daily") return badField("p1", `${at}: a daily task cannot be Priority 1.`); if (b.p1) t.p1 = true; }
  const dest = destOf(b, c);
  if ("status" in dest) return dest;
  return { t, dest };
}
async function addTasks(body: unknown, sc: Scopes, store: ApiStore): Promise<ApiRes> {
  if (!sc.add) return scopeOff("add");
  if (!isObj(body)) return fail(400, "bad_request", "Send a JSON object as the body: {\"title\": \"...\"}, or {\"tasks\": [{...}, ...]} for several.");
  const batch = Array.isArray(body.tasks);
  if (batch) { const u = unknownField(body, ["tasks"]); if (u) return u; }
  const items = batch ? body.tasks as unknown[] : [body];
  if (!items.length) return badField("tasks", "tasks is empty.");
  if (items.length > BATCH_MAX) return fail(400, "too_many", `At most ${BATCH_MAX} tasks in one request.`);
  const c = makeCtx(store);
  // Everything is checked before anything is added, so a bad one never leaves half a batch behind.
  const list: NewTask[] = [];
  for (let i = 0; i < items.length; i++) {
    const r = checkNew(items[i], c, batch ? `tasks[${i}]` : "task");
    if ("status" in r) return r;
    if (r.dest.inbox ? !sc.inbox : !sc.lists) return scopeOff(r.dest.inbox ? "inbox" : "lists");
    list.push(r);
  }
  const inboxNow = c.all.filter((d) => inInbox(d.data) && !d.data.done).length;
  if (inboxNow + list.filter((x) => x.dest.inbox).length > INBOX_MAX) return fail(409, "inbox_full", `The AI Inbox holds at most ${INBOX_MAX} open tasks. Ask the person to sort it first.`);
  const made: ApiTask[] = [];
  for (const { t, dest } of list) {
    let place: Partial<Todo> = { aiInbox: true };
    if (!dest.inbox) {
      const p = await placeIn(dest, t.type ?? "once", c, store);
      if ("status" in p) return made.length ? { ...p, body: { ...(p.body as object), added: made } } : p;
      place = p;
      if (t.p1 && (place.group || t.type === "daily")) delete t.p1;   // Priority 1 is a section of its own
      if (t.p1) place.p1 = true;
    }
    const data: Partial<Todo> & { title: string } = { ...t, ...place, ai: true, source: "manual" };
    const id = await store.add(data);
    const doc: Doc<Todo> = { id, ws: null, kind: "todo", author: null, updatedAt: null, data: { done: false, order: 0, type: "once", ...data } as Todo };
    // Placed after the last one, so a batch keeps its order.
    if (!dest.inbox && place.order !== undefined) { const key = sectionOf(doc.data, c.known); placeAfter(c, key, doc); }
    made.push(fresh(id, store, doc, {}));
  }
  return batch ? ok({ tasks: made, count: made.length }, 201) : ok({ task: made[0] }, 201);
}
function placeAfter(c: Ctx, key: string, d: Doc<Todo>) {
  const g = groupOf(key);
  if (g) (c.lists.groups.get(g) ?? c.lists.groups.set(g, []).get(g)!).push(d);
  else if (key === "daily") c.lists.daily.push(d);
  else { c.lists.ranked.push(d); (key === "p1" ? c.lists.p1 : c.lists.prio).push(d); }
}

// PATCH /v1/tasks/{id}
const EDIT_FIELDS = ["title", "notes", "due", "p1", "list", "section", "done"];
async function editTask(d: Doc<Todo>, body: unknown, sc: Scopes, store: ApiStore, c: Ctx): Promise<ApiRes> {
  if (!isObj(body)) return fail(400, "bad_request", "Send a JSON object with the fields to change.");
  const u = unknownField(body, EDIT_FIELDS); if (u) return u;
  if (!Object.keys(body).length) return fail(400, "bad_request", `Nothing to change. Fields: ${EDIT_FIELDS.join(", ")}.`);
  const t = d.data, patch: Partial<Todo> = {};
  const edits = ["title", "notes", "due", "p1", "list", "section"].some((k) => k in body);
  if (edits && !sc.edit) return scopeOff("edit");
  if ("done" in body && !sc.done) return scopeOff("done");
  if ("title" in body) { const v = text(body.title, TITLE_MAX); if (!v) return badField("title", `title is 1 to ${TITLE_MAX} characters.`); patch.title = v; }
  if ("notes" in body) { if (body.notes !== null && typeof body.notes !== "string") return badField("notes", "notes is text, or null to clear."); patch.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, NOTES_MAX) : null; }
  if ("due" in body) {
    if (body.due !== null && (typeof body.due !== "string" || !okDay(body.due))) return badField("due", "due is a date like 2026-11-20, or null to clear.");
    if (body.due && t.type === "daily") return badField("due", "A daily task repeats every day, so it has no due date.");
    patch.due = (body.due as string | null) || null;
  }
  if ("done" in body && typeof body.done !== "boolean") return badField("done", "done is true or false.");
  if ("list" in body || "section" in body) {
    const dest = destOf(body, c);
    if ("status" in dest) return dest;
    if (dest.inbox) { if (!sc.inbox) return scopeOff("inbox"); if (!inInbox(t)) Object.assign(patch, { aiInbox: true }); }
    else {
      if (!sc.lists) return scopeOff("lists");
      const here = sectionOf(t, c.known);
      const same = !inInbox(t) && (dest.key ? dest.key === here : pageOfSec(c.pages, here) === dest.page);
      if (!same) { const p = await placeIn(dest, t.type, c, store); if ("status" in p) return p; Object.assign(patch, p, { aiInbox: false }); }
    }
  }
  if ("p1" in body) {
    if (typeof body.p1 !== "boolean") return badField("p1", "p1 is true or false.");
    if (body.p1 && t.type === "daily") return badField("p1", "A daily task cannot be Priority 1.");
    const where = patch.group !== undefined ? patch.group : t.group;
    if (body.p1 && where && c.known.has(where)) return fail(409, "wrong_section", "This task is in a task group. Move it to section \"p1\" (or \"prio\") instead.", { field: "p1" });
    patch.p1 = body.p1;
    if (body.p1) patch.unranked = false;
  }
  if (Object.keys(patch).length) await store.update(d.id, patch);
  if (typeof body.done === "boolean") await store.setDone(d.id, body.done);
  return ok({ task: fresh(d.id, store, d, typeof body.done === "boolean" ? { ...patch, done: body.done } : patch) });
}

// PUT and DELETE /v1/tasks/{id}/reminder
async function reminder(d: Doc<Todo>, method: string, body: unknown, store: ApiStore, c: Ctx): Promise<ApiRes> {
  const now = store.now();
  if (method === "DELETE") {
    const had = reminderOfTask(c.rem, d.id);
    if (!had) return fail(404, "not_found", "This task has no reminder.");
    await store.saveRemind((rec) => { const r = rec && reminderOfTask(rec, d.id); return rec && r ? removeReminder(rec, r.id, now) : null; });
    return ok({ task: fresh(d.id, store, d, {}) });
  }
  if (!isObj(body)) return fail(400, "bad_request", "Send {\"time\": \"HH:MM\"} and optionally date, until and message.");
  const u = unknownField(body, ["time", "date", "until", "message"]); if (u) return u;
  if (typeof body.time !== "string" || !HM_RE.test(body.time)) return badField("time", "time is when it starts popping up, 24 hour HH:MM like 09:30.");
  const date = body.date ?? store.today();
  if (typeof date !== "string" || !okDay(date)) return badField("date", "date is a day like 2026-11-20 (default today).");
  if (date < store.today()) return badField("date", "date is today or later.");
  let until = body.until;
  if (until === undefined || until === null) until = hm(minutesOf(body.time) + 180);
  if (typeof until !== "string" || !HM_RE.test(until) || until === body.time) return badField("until", "until is when it stops popping up, HH:MM, not the same as time (default 3 hours after).");
  if (body.message !== undefined && body.message !== null && typeof body.message !== "string") return badField("message", "message is text (default: the task's name).");
  const message = oneLine(body.message, REM_TEXT_MAX);
  const set = { at: body.time, until, date, text: message, on: true };
  let full = false;
  await store.saveRemind((rec) => {
    const base = remindOrDefault(rec, store.red());
    const have = reminderOfTask(base, d.id);
    if (have) return patchReminder(base, have.id, set, now);
    const next = addTaskReminder(base, { ...newTaskReminder(freshId(base), d.id, now, store.deviceTz()), ...set }, now);
    if (next === base) { full = true; return null; }
    return next;
  });
  if (full) return fail(409, "too_many", "PS holds at most 60 reminders on tasks. Ask the person to clear some first.");
  return ok({ task: fresh(d.id, store, d, {}) });
}
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

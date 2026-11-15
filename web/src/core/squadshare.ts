// G Squad (V1.40): what you share, and the one gate everything shared goes through.
//
// Each piece has its own switch (settings.squadShare, synced in your vault; missing = on). Tasks are the exception
// since V1.43 (the developer, 8 Nov 2026: "you have to go out of your way to make your tasks shared"): the Tasks switch is OFF
// unless it was switched on (only an explicit true counts, so a never set value is off), and even then a task is
// shared only when you marked it "Share with G Squad" (Todo.sqOn, in the Add task box or the right click menu).
// The switch is enforced where the squad key is used: sealForSquad refuses an opted out
// piece BEFORE it touches the key, and the hub writer (squad/hub.ts) only takes what sealForSquad made. So an opted
// out piece is never encrypted with the squad key and never sent, whatever a screen or a later chat gets wrong.
// No "Private mode" name anywhere (the developer).
import type { ClientRec, Doc, Settings, Todo } from "./model.ts";
import { prioNumbers, sortPrio } from "./prio.ts";
import { clientTerms, squadTitle, type ClientTerm } from "./squadanon.ts";
import { copyFp, seal, sqAad, taskSquadId } from "./squadcrypto.ts";
import { p1Copies } from "./squadp1.ts";

export type SharePiece = "tasks" | "p1" | "working" | "money" | "screen" | "fitness" | "sleep";
export type ShareOpts = Partial<Record<SharePiece, boolean>>;

/** Every switch, in the order the Sharing list shows them. `ready: false` = the switch works (and is saved) but
 *  nothing of that piece is built yet; later V1.40 chats fill them in. */
export const SHARE_PIECES: { id: SharePiece; label: string; line: string; ready: boolean }[] = [
  { id: "tasks", label: "Tasks", line: "Only the tasks you mark Share with G Squad: title, priority, date and done.", ready: true },
  { id: "p1", label: "Priority 1 tasks", line: "Your Priority 1 tasks: title, date, done and the 24 hour clock. Hide any one from the squad.", ready: true },
  { id: "working", label: "Working status", line: "Whether PS app is running on your Mac or phone right now.", ready: true },
  { id: "money", label: "Money", line: "What you made each month, for the leaderboard.", ready: true },
  { id: "screen", label: "Screen time", line: "Your daily total only, never which apps.", ready: true },
  { id: "fitness", label: "Fitness", line: "Gym days, personal bests, challenges, and your best and recent sets per exercise.", ready: true },
  { id: "sleep", label: "Sleep", line: "Hours slept and your streak.", ready: true },
];
export const isPiece = (v: unknown): v is SharePiece => SHARE_PIECES.some((p) => p.id === v);

export function shareOn(opts: ShareOpts | null | undefined, piece: SharePiece): boolean {
  if (piece === "tasks") return opts?.tasks === true;   // V1.43: off unless switched on (never set = off)
  if (piece === "p1") return opts?.p1 !== false;        // PS 1.63: on unless the person turned it off (the developer's friend asked for shared by default, opt out). One notice tells them.
  return !opts || opts[piece] !== false;
}
/** One task the squad may see (with the Tasks switch on): you marked it Share with G Squad, and not Not shared.
 *  A task from before V1.43 has no mark, so it stays yours alone until you share it. */
export function taskShared(t: Pick<Todo, "sqOn" | "sqOff"> | null | undefined): boolean {
  return !!t && t.sqOn === true && t.sqOff !== true;
}
export function cleanShareOpts(v: unknown): ShareOpts {
  const o: ShareOpts = {};
  if (!v || typeof v !== "object") return o;
  for (const p of SHARE_PIECES) { const x = (v as Record<string, unknown>)[p.id]; if (typeof x === "boolean") o[p.id] = x; }
  return o;
}

// ---------- the gate ----------
declare const sealedBrand: unique symbol;
/** Only sealForSquad makes one, so the hub writer can never be handed plaintext or an opted out piece. */
export type Sealed = { readonly ct: string; readonly gen: number; readonly piece: SharePiece; readonly [sealedBrand]: true };
/** Seals one value for the squad, or returns null (without touching the key) when that piece is switched off. */
export async function sealForSquad(opts: ShareOpts | null | undefined, piece: SharePiece, key: { raw: string; gen: number }, value: unknown, aad: string): Promise<Sealed | null> {
  if (!shareOn(opts, piece)) return null;
  const ct = await seal(key.raw, value, aad);
  return { ct, gen: key.gen, piece } as Sealed;
}

// ---------- shared tasks ----------
/** The squad copy of one task: title (or the neutral one), priority, date, done. Nothing else ever leaves. */
export interface TaskCopy { t: string; p: number | null; d: string | null; x: boolean; xa?: string | null; e?: boolean; a?: boolean; s?: string }

const DONE_DAYS = 7, MAX_SHARED = 150;
/** Which of your tasks the squad sees, and how, before anything is sealed. Nothing while Tasks is switched off (or
 *  was never switched on); only tasks marked Share with G Squad, and none cleared away or done over a week ago. */
export function taskCopies(todos: Doc<Todo>[], settings: Pick<Settings, "squadShare"> | null | undefined, clients: Pick<ClientRec, "name" | "contactName" | "greetingName" | "archived">[], now = Date.now()): { todoId: string; copy: TaskCopy }[] {
  if (!shareOn(settings?.squadShare, "tasks")) return [];
  const terms: ClientTerm[] = clientTerms(clients);
  const cutoff = now - DONE_DAYS * 864e5;
  const live = todos.filter((d) => d.kind === "todo" && d.data && !d.data.clearedAt && taskShared(d.data)
    && (d.data as { example?: boolean }).example !== true
    && (!d.data.done || (d.data.doneAt ? Date.parse(d.data.doneAt) >= cutoff : false)));
  const once = sortPrio(live.filter((d) => d.data.type !== "daily" && !d.data.group));
  const nums = prioNumbers(once.map((d) => ({ id: d.id, p1: d.data.p1 === true, unranked: d.data.unranked === true })));
  const out: { todoId: string; copy: TaskCopy }[] = [];
  for (const d of live) {
    const t = d.data;
    const name = squadTitle(t, terms);
    const copy: TaskCopy = { t: name.title, p: nums.get(d.id) ?? null, d: typeof t.due === "string" ? t.due.slice(0, 10) : null, x: !!t.done };
    if (t.done && t.doneAt) copy.xa = t.doneAt;
    if (t.type === "daily") copy.e = true;
    if (name.anon) copy.a = true;
    out.push({ todoId: d.id, copy });
  }
  out.sort((a, b) => Number(a.copy.x) - Number(b.copy.x));
  return out.slice(0, MAX_SHARED);
}

export interface SquadKeyRef { raw: string; gen: number }
export interface TaskRow { id: string; ct: string; gen: number; fp: string }
/** What to send to the hub so it holds exactly your shared tasks: sealed puts for new or changed copies, and the
 *  ids to take away (switched off, Not shared, deleted). `have` is what the hub holds now (id to fingerprint). */
export async function planTaskSync(input: {
  todos: Doc<Todo>[]; settings: Pick<Settings, "squadShare"> | null | undefined; clients: Pick<ClientRec, "name" | "contactName" | "greetingName" | "archived">[];
  squad: string; member: string; secret: string; key: SquadKeyRef; have: Map<string, string>; now?: number;
}): Promise<{ put: TaskRow[]; del: string[] }> {
  const opts = input.settings?.squadShare;
  // One map of what the squad holds: an ordinary shared task (Tasks piece) and a Priority 1 task (P1 piece). A task that is both
  // is one row, sealed as a task (that switch is on and the task was shared on purpose) with the P1 start time added.
  const want = new Map<string, { copy: TaskCopy; piece: SharePiece }>();
  const p1 = new Map<string, TaskCopy>();
  for (const c of p1Copies(input.todos, opts, input.clients, input.now ?? Date.now())) p1.set(await taskSquadId(input.secret, c.todoId), c.copy);
  for (const c of taskCopies(input.todos, input.settings, input.clients, input.now)) {
    const id = await taskSquadId(input.secret, c.todoId);
    const extra = p1.get(id);
    want.set(id, { copy: extra?.s ? { ...c.copy, s: extra.s } : c.copy, piece: "tasks" });
    p1.delete(id);
  }
  for (const [id, copy] of p1) want.set(id, { copy, piece: "p1" });
  const put: TaskRow[] = [];
  for (const [id, { copy, piece }] of want) {
    const fp = await copyFp(input.secret, copy, input.key.gen);
    if (input.have.get(id) === fp) continue;
    const s = await sealForSquad(opts, piece, input.key, copy, sqAad.task(input.squad, input.member, id, input.key.gen));
    if (!s) continue;
    put.push({ id, ct: s.ct, gen: s.gen, fp });
  }
  const del = [...input.have.keys()].filter((id) => !want.has(id));
  return { put, del };
}

// Example tasks for a brand new account (G Squad, the developer 7 Nov 2026: "My friend didn't really know what he was doing
// because there's nothing actually set up... make everything filled out with example information just so someone
// can see what it looks like... a button that says delete all example tasks").
//
// A new account in PS starts with a few clearly made up tasks (each one also teaches a move: drag, tick, right
// click), a person on the time zone clocks, an Urgent note and a countdown, so the list, the welcome tour's
// Appearance step and every screen look alive. Each record is FOUND AGAIN BY ITS ID, never by its words: the ids
// are kept in the settings (settings.examples.ids, .aware, .timelines) and every example task also carries
// `example: true`. "Delete all example tasks" removes exactly those (with Undo) and nothing the person made.
// Pure: tests/examples.test.ts runs it. The writes are core/actions.ts seedExamples / deleteExamples.

export interface ExampleState {
  /** When they were added (ISO). */
  at: string;
  /** Vault records: the tasks and the time zone person. */
  ids: string[];
  /** Ids inside settings lists: Urgent notes and Timelines countdowns. */
  aware?: string[];
  timelines?: string[];
  /** When they were deleted (ISO), so they are never added again. */
  gone?: string | null;
}

export type ExampleTodo = { title: string; type: "once" | "daily"; p1?: boolean; done?: boolean; subtasks?: string[] };

/** The words, every one shown to other people (Rule Zero: the developer approves them, gsquad-welcome-copy.md). */
export const EXAMPLE_TODOS: readonly ExampleTodo[] = [
  { title: "Example: the one thing that matters most today", type: "once", p1: true },
  { title: "Example: click a task to work on it, and it glows", type: "once" },
  { title: "Example: drag me up or down to change my priority", type: "once", subtasks: ["Example: a mini task", "Example: another mini task"] },
  { title: "Example: right click me to edit, move or delete me", type: "once" },
  { title: "Example: tick me off and I slide down to Completed", type: "once" },
  { title: "Example: a task you already ticked off", type: "once", done: true },
  { title: "Example: drink a glass of water", type: "daily" },
  { title: "Example: a 10 minute walk", type: "daily" },
];
export const EXAMPLE_PERSON = { name: "Example: Alex in New York", tz: "America/New_York" } as const;
export const EXAMPLE_AWARE = "Example: something urgent shows here, in red";
export const EXAMPLE_TIMELINE = "Example: a date you are counting down to";
export const EXAMPLE_WORDS = {
  deleteAll: "Delete all example tasks",
  keep: "Keep them for now",
  deleted: "Example tasks deleted",
  undo: "Undo",
  settingsTitle: "Example tasks",
  settingsNote: "Made up tasks that show how the list works. Your own tasks are never touched.",
} as const;

/** Add the examples? Only to a brand new owner account in PS: nothing on the list, never had examples, and no
 *  record older than this build (an account that ran an earlier version is never new). Never the developer's. */
export function shouldSeed(o: { ps: boolean; owner: boolean; red: boolean; synced: boolean; todoCount: number; examples: unknown; accountOlder: boolean }): boolean {
  return o.ps && o.owner && !o.red && o.synced && o.todoCount === 0 && !o.examples && !o.accountOlder;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

/** Everything to write, with the ids it will have (`id` makes them, so the state can list them first). */
export function buildExamples(nowMs: number, id: () => string) {
  const at = new Date(nowMs).toISOString();
  let order = 0;
  const todos = EXAMPLE_TODOS.map((t) => ({
    id: id(),
    data: {
      title: t.title, type: t.type, done: !!t.done, ...(t.done ? { doneAt: at } : {}), order: order++, createdAt: at, source: "manual" as const,
      ...(t.p1 ? { p1: true } : {}),
      ...(t.subtasks ? { subtasks: t.subtasks.map((s) => ({ id: id(), title: s, done: false })) } : {}),
      example: true,
    },
  }));
  const person = { id: id(), data: { name: EXAMPLE_PERSON.name, tz: EXAMPLE_PERSON.tz, at } };
  const aware = { id: id(), text: EXAMPLE_AWARE, createdAt: at };
  const timeline = { id: id(), title: EXAMPLE_TIMELINE, date: ymd(nowMs + 30 * 86400_000), createdAt: at };
  const state: ExampleState = { at, ids: [...todos.map((t) => t.id), person.id], aware: [aware.id], timelines: [timeline.id], gone: null };
  return { todos, person, aware, timeline, state };
}

/** The example records still there: listed ids that still exist, plus any task flagged `example`. */
export function examplesLeft(state: ExampleState | null | undefined, docs: Iterable<{ id: string; kind: string; data: unknown }>): string[] {
  const listed = new Set(state?.ids ?? []);
  const out: string[] = [];
  for (const d of docs) {
    const flagged = d.kind === "todo" && !!d.data && typeof d.data === "object" && (d.data as { example?: unknown }).example === true;
    if (listed.has(d.id) || flagged) out.push(d.id);
  }
  return out;
}

/** Any example left anywhere (records, Urgent notes, countdowns)? Drives the Settings button. */
export function hasExamples(state: ExampleState | null | undefined, docs: Iterable<{ id: string; kind: string; data: unknown }>,
  aware: { id: string }[] | null | undefined, timelines: { id: string }[] | null | undefined): boolean {
  if (examplesLeft(state, docs).length) return true;
  const a = new Set(state?.aware ?? []), t = new Set(state?.timelines ?? []);
  return (aware ?? []).some((x) => a.has(x.id)) || (timelines ?? []).some((x) => t.has(x.id));
}

/** The settings lists without the examples (Urgent, Timelines). */
export function withoutExamples<T extends { id: string }>(list: T[] | null | undefined, ids: string[] | undefined): T[] {
  const s = new Set(ids ?? []);
  return (list ?? []).filter((x) => !s.has(x.id));
}

/** Every sentence the examples show (the approval list and the no-dash test read this). */
export function examplesCopy(): string[] {
  return [...EXAMPLE_TODOS.flatMap((t) => [t.title, ...(t.subtasks ?? [])]), EXAMPLE_PERSON.name, EXAMPLE_AWARE, EXAMPLE_TIMELINE, ...Object.values(EXAMPLE_WORDS)];
}

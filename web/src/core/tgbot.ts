// Add Telegram Bot (V1.47, the developer 10 Nov 2026: "make it so you can add your own Telegram bot ... with all the different
// task rules in the way I send it, like letters at the start of a message meaning add a task. Make it so other people
// can add a Telegram bot as well. Add that in the Settings menu as a tab called Add Telegram Bot.")
//
// Anyone makes their own bot with Telegram's BotFather, gives PS its key (the bot token) and links their own Telegram
// chat. PS on their Mac or phone then reads the bot's messages itself (Telegram's getUpdates, src/tgbot.ts and
// core/tgpoll.ts), with no server in between, and puts each task on their list. The token lives only in that device's
// Keychain (Mac) or Keystore (phone); this code never sees it.
//
// The rules are the developer's own AT rules (supabase/functions/telegram-inbox/lib.ts, the bot he has used since 17 Oct 2026),
// with the start word editable, plus the typed P1, P2, P3 of the add box (core/typedprio.ts) and today or tomorrow at
// the end. The developer's own Daily report bot is NOT this: it goes through his telegram-inbox function into New tasks, unchanged.
// Pure: no DOM, no network, so the tests run it as is.
import { parsePrio, type PrioNum } from "./typedprio.ts";

export type TgZone = "act" | "soon" | "x";
export type TgDue = "today" | "tomorrow";
/** One task from a message. `urgent`: goes on Urgent. `zone`: goes to that Dimension X band. Otherwise it joins the
 *  list, at `prio` when one was typed, due `due` when today or tomorrow ended it. */
export interface BotTask { text: string; urgent: boolean; zone: TgZone | null; prio: PrioNum | null; due: TgDue | null }

/** What PS keeps in the synced settings (never the token): the start word and the linked chat. */
export interface TgBotPrefs {
  prefix: string;          // the word that starts a task message; "" = every message is a task
  chatId: number | null;   // the one Telegram chat whose messages count (a private chat's id is the person's own id)
  who: string | null;      // a name to show for that chat ("The developer, @red_byps")
}
export const DEFAULT_PREFIX = "AT";
export const PREFIX_MAX = 12;
export const MAX_TASKS = 20;
export const TASK_MAX = 300;

/** A start word as typed in Settings: trimmed, no spaces or line breaks inside, at most 12 characters, never a
 *  slash first (Telegram's /commands). Case is kept: like the developer's AT, it has to be typed the same way. */
export function cleanPrefix(v: unknown): string {
  if (typeof v !== "string") return DEFAULT_PREFIX;
  const t = v.trim();
  if (!t) return "";
  if (/\s/.test(t) || t.startsWith("/") || t.length > PREFIX_MAX) return DEFAULT_PREFIX;
  return t;
}
const okChat = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v !== 0;
export function cleanTgPrefs(v: unknown): TgBotPrefs {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    prefix: o.prefix === undefined ? DEFAULT_PREFIX : cleanPrefix(o.prefix),
    chatId: okChat(o.chatId) ? o.chatId : null,
    who: typeof o.who === "string" && o.who.trim() ? o.who.replace(/[\r\n\t]+/g, " ").trim().slice(0, 80) : null,
  };
}

// ---------- the rules (the developer's AT rules, lib.ts, kept word for word) ----------
type Mark = TgZone | "urgent" | "asap";
const PREFIXES: [RegExp, Mark][] = [
  [/^(?:dimension\s*x|dim\s*x|dx)(?![a-z0-9])/i, "x"],
  [/^(?:(?:the\s+)?upside[\s-]*down|ud)(?![a-z0-9])/i, "soon"],
  [/^(?:actionables?|act|ac)(?![a-z0-9])/i, "act"],
  [/^urgent(?![a-z0-9])/i, "urgent"],
  [/^asap(?![a-z0-9])[!.]*/i, "asap"],
];
const tidy = (t: string) => t.replace(/\s+/g, " ").replace(/^[\s:\-,.]+|[\s:\-,]+$/g, "").trim();
type Where = { zone: TgZone | null; asap: boolean };
function prefixes(text: string, base: Where): { where: Where; rest: string } {
  const where = { ...base };
  let rest = tidy(text);
  for (let guard = 0; guard < 4; guard++) {
    const hit = PREFIXES.map(([re, mark]) => ({ m: rest.match(re), mark })).find((x) => x.m);
    if (!hit) break;
    if (hit.mark === "urgent") { where.asap = true; where.zone = null; }
    else if (hit.mark === "asap") where.asap = true;
    else where.zone = hit.mark;
    rest = tidy(rest.slice(hit.m![0].length));
  }
  return { where, rest };
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The start word's match: what follows it, or null when the message does not start with it. With no start word,
 *  every message counts except a /command. */
function body(raw: string, prefix: string): string | null {
  if (!prefix) return /^\s*\//.test(raw) ? null : raw;
  const m = raw.match(new RegExp(`^\\s*${escapeRe(prefix)}(?:[\\s:\\-.,]+)([\\s\\S]*)$`));
  return m ? m[1] : null;
}

/** "tomorrow" (or "tmrw") or "today" as the last word of a task: its due day, taken out of the text. */
function dueOf(text: string): { due: TgDue | null; rest: string } {
  const m = text.match(/(?:^|\s)(today|tomorrow|tmrw|tmr)[.!]*$/i);
  if (!m) return { due: null, rest: text };
  const rest = tidy(text.slice(0, m.index));
  if (!rest) return { due: null, rest: text };   // "AT tomorrow" stays a task called tomorrow
  return { due: /^today$/i.test(m[1]) ? "today" : "tomorrow", rest };
}

/**
 * The tasks in one message, or null when it is not a task message.
 * the developer's rules: the start word (AT by default) first, then a space, colon or dash. ",," splits one message into
 * several tasks (up to 20, 300 characters each). A place at the start of a task: Dimension X (DX), Upside Down (UD),
 * Actionables (Act), Urgent; ASAP anywhere makes it urgent. A place right after the start word counts for every task.
 * Added for everyone's bot: P1, P2 or P3 anywhere sets the priority, and today or tomorrow at the end the due day.
 */
export function parseBotMessage(raw: string | null | undefined, prefix: string = DEFAULT_PREFIX): BotTask[] | null {
  const b = body(raw || "", prefix);
  if (b === null) return null;
  const pieces = b.split(/\s*,\s*,[\s,]*/);
  const head = prefixes(pieces[0] ?? "", { zone: null, asap: false });
  pieces[0] = head.rest;
  const out: BotTask[] = [];
  for (const piece of pieces) {
    if (out.length >= MAX_TASKS) break;
    const { where, rest } = prefixes(piece, head.where);
    const urgent = where.asap || /\bASAP\b/i.test(rest);
    let text = tidy(rest.replace(/\bASAP\b[!.:,]*/gi, " "));
    const p = parsePrio(text);
    if (p && p.title) text = p.title;
    const d = dueOf(text);
    text = d.rest.slice(0, TASK_MAX);
    if (text) out.push({ text, urgent, zone: urgent ? null : where.zone, prio: p && p.title ? p.prio : null, due: d.due });
  }
  return out.length ? out : null;
}

// ---------- the bot's replies ----------
const PLACE: Record<TgZone, string> = { act: "Actionables", soon: "Upside Down", x: "Dimension X" };
/** "Email QLA, P1", "Call the bank, Upside Down", "Pay rent, Urgent", "Buy milk, P2, tomorrow". */
export function taskLine(t: BotTask): string {
  const bits = [t.text];
  if (t.urgent) bits.push("Urgent");
  else if (t.zone) bits.push(PLACE[t.zone]);
  else {
    if (t.prio) bits.push(`P${t.prio}`);
    if (t.due) bits.push(t.due);
  }
  return bits.join(", ");
}
/** The bot's answer to a task message. */
export function addedText(tasks: BotTask[]): string {
  if (tasks.length === 1) return `Added: ${taskLine(tasks[0])}`;
  return `Added ${tasks.length} tasks:\n${tasks.map((t) => `- ${taskLine(t)}`).join("\n")}`;
}
export function undoneText(titles: string[]): string {
  if (!titles.length) return "Nothing to undo. It was already gone.";
  return titles.length === 1 ? `Undone: ${titles[0]}` : `Undone ${titles.length} tasks.`;
}
/** A message that is not a task: how to make one. */
export function notTaskText(prefix: string): string {
  return prefix ? `Not added. Start a task with ${prefix}, like: ${prefix} Email QLA P1` : "Not added.";
}
export const LINKED_TEXT = "Linked to PS app. Send me a task, like: ";
export const TEST_TEXT = "PS app test: your bot works. Tasks you send here go on your PS app list.";

/** The short cheat sheet in Settings and the bot's /help. */
export function cheatSheet(prefix: string): { say: string; does: string }[] {
  const p = prefix ? `${prefix} ` : "";
  return [
    { say: `${p}Email QLA`, does: prefix ? `${prefix} at the very start (same capitals) adds a task` : "Every message adds a task" },
    { say: `${p}Email QLA P1`, does: "P1, P2 or P3 anywhere sets the priority" },
    { say: `${p}Buy milk tomorrow`, does: "today or tomorrow at the end sets the day" },
    { say: `${p}Buy milk,, Call mum`, does: "two commas split one message into several tasks" },
    { say: `${p}ASAP pay rent`, does: "ASAP or Urgent anywhere puts it on Urgent" },
    { say: `${p}DX podcast idea`, does: "DX or Dimension X at the start: Dimension X" },
    { say: `${p}UD redo the site`, does: "UD or Upside Down at the start: the Upside Down" },
    { say: `${p}Act send the invoice`, does: "Act or Actionables at the start: Actionables" },
  ];
}
export function helpText(prefix: string): string {
  return ["How to add tasks:", ...cheatSheet(prefix).map((r) => `${r.say}: ${r.does}`), "Every task gets an Undo button."].join("\n");
}

// ---------- linking and the chat lock ----------
/** A six digit code for "Link my Telegram" (the person sends /start CODE, or taps the t.me link that sends it). */
export function newLinkCode(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const b = rand(4);
  const n = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  return String(100000 + (n % 900000));
}
/** The code in a link message: "/start 123456" (the t.me link sends this), "/start@MyBot 123456" or just "123456". */
export function linkCodeIn(text: string | null | undefined): string | null {
  const m = (text || "").trim().match(/^(?:\/start(?:@\w+)?\s+)?(\d{6})$/);
  return m ? m[1] : null;
}

export interface TgUser { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean }
export interface TgChat { id: number; type?: string; first_name?: string; username?: string }
export interface TgMessage { message_id: number; date?: number; chat: TgChat; from?: TgUser; text?: string; caption?: string }
export interface TgCallback { id: string; from: TgUser; data?: string; message?: TgMessage }
export interface TgUpdate { update_id: number; message?: TgMessage; edited_message?: TgMessage; callback_query?: TgCallback }

/** Only the linked person, in their own private chat with the bot. Groups, channels and anyone else never count. */
export function fromLinked(m: TgMessage | undefined, chatId: number | null): boolean {
  if (!m || chatId === null || !okChat(chatId)) return false;
  if (m.chat?.type !== "private") return false;
  if (m.chat.id !== chatId) return false;
  if (m.from && (m.from.id !== chatId || m.from.is_bot)) return false;
  return true;
}
/** An Undo press: from the linked person, on a message in their chat. */
export function callbackFromLinked(c: TgCallback | undefined, chatId: number | null): boolean {
  if (!c || chatId === null || c.from?.id !== chatId || c.from.is_bot) return false;
  return !c.message || c.message.chat?.id === chatId;
}
/** "The developer (@red_byps)". */
export function whoOf(u: TgUser | TgChat | undefined): string | null {
  if (!u) return null;
  const name = [u.first_name, (u as TgUser).last_name].filter(Boolean).join(" ").trim();
  const at = u.username ? `@${u.username}` : "";
  const s = name && at ? `${name} (${at})` : name || at;
  return s ? s.slice(0, 80) : null;
}

// ---------- never a token in a log line ----------
const TOKEN_RE = /\d{5,}:[A-Za-z0-9_-]{20,}/g;
/** Anything that looks like a bot token taken out of a line before it is logged or shown. */
export function redact(s: string): string { return String(s).replace(TOKEN_RE, "[token]"); }
/** A bot token as BotFather gives it: digits, a colon, then 30 or more letters, digits, - or _. */
export function looksLikeToken(s: string): boolean { return /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/.test(s.trim()); }

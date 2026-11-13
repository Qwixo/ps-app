// The reader for Add Telegram Bot (core/tgbot.ts says what it is). While PS runs, it asks Telegram for the bot's new
// messages (getUpdates long polling: one request waits up to 25 seconds for a message), turns task messages into tasks,
// answers with a short confirmation and an Undo button, and asks again. No server: the person's own Mac or phone does
// it. The token is never here: `api.call` is the native shell (src/tgbot.ts), which adds it from the Keychain or
// Keystore and makes the request off the main thread through the system's network.
//
// Rules it keeps:
//  - Only the linked chat counts (fromLinked). Anything else is ignored and logged without its text or who sent it.
//  - Before linking, only a message carrying the six digit code PS is showing links a chat.
//  - Errors back off: 2 s, 4 s, 8 s ... up to 5 minutes, and back to normal after one good answer. Telegram's own
//    "retry after" is honoured. A webhook on the bot (another app or server reads it), a wrong token or another
//    device reading the same bot stop or slow it, with a plain reason for Settings.
//  - A line is logged only through redact(), so a token can never reach a log even if an error carried one.
// Pure apart from the injected parts, so the tests drive it with a fake Telegram.
import {
  addedText, callbackFromLinked, fromLinked, helpText, LINKED_TEXT, linkCodeIn, notTaskText, parseBotMessage, redact,
  undoneText, whoOf, type BotTask, type TgUpdate,
} from "./tgbot.ts";

export interface TgReply { ok: boolean; result?: unknown; error_code?: number; description?: string; parameters?: { retry_after?: number } }
/** The native shell's relay. Throws when the request never got an answer (offline, timed out). */
export interface TgApi { call(method: string, params: Record<string, unknown>): Promise<TgReply> }

export type TgState = "off" | "running" | "offline" | "webhook" | "badToken" | "conflict" | "noKey";
export interface TgStatus { state: TgState; problem: string | null; lastOk: number | null }

export interface PollDeps {
  api: TgApi;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(line: string): void;
  /** The linked chat (synced settings), or null. */
  chatId(): number | null;
  /** The start word (synced settings). */
  prefix(): string;
  /** The code "Link my Telegram" is showing, or null when not linking. */
  linkCode(): string | null;
  /** A chat sent the right code: save it as the linked chat. */
  onLinked(chat: { id: number; who: string | null }): Promise<void>;
  /** Put these tasks on the list. Returns the titles added (an empty list: all of them were already there). */
  onTasks(key: string, tasks: BotTask[]): Promise<string[]>;
  /** Undo the tasks added for this key. Returns the titles removed. */
  onUndo(key: string): Promise<string[]>;
  /** The next update id to ask for (kept on this device). */
  offset: { get(): number; set(n: number): void };
  status(s: TgStatus): void;
}

export const LONG_POLL_S = 25;
export const BACKOFF_MIN_MS = 2_000;
export const BACKOFF_MAX_MS = 300_000;
export const CONFLICT_MS = 60_000;
/** The wait after `failures` errors in a row: 2 s, 4 s, 8 s ... 5 minutes at most. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.min(failures - 1, 20));
}

/** What a failed answer means. */
export function classify(r: TgReply): { state: TgState; wait: number | null; problem: string } {
  const d = (r.description || "").toLowerCase();
  if (r.error_code === 409 && d.includes("webhook"))
    return { state: "webhook", wait: null, problem: "This bot already sends its messages somewhere else (a webhook), so PS app cannot read them. Make a new bot for PS app with BotFather." };
  if (r.error_code === 409)
    return { state: "conflict", wait: CONFLICT_MS, problem: "Another device or app is reading this bot right now. PS app tries again in a minute." };
  if (r.error_code === 401 || r.error_code === 404)
    return { state: "badToken", wait: null, problem: "Telegram did not accept this bot key. Paste it again from BotFather." };
  if (r.error_code === 429)
    return { state: "running", wait: Math.max(1, Math.min(600, r.parameters?.retry_after ?? 5)) * 1000, problem: "Telegram asked PS app to slow down for a moment." };
  return { state: "offline", wait: null, problem: "Telegram did not answer. PS app tries again soon." };
}

export class TgPoller {
  private running = false;
  private failures = 0;
  private lastOk: number | null = null;
  private loop: Promise<void> | null = null;
  private d: PollDeps;
  constructor(d: PollDeps) { this.d = d; }

  get active() { return this.running; }

  start() {
    if (this.running) return;
    this.running = true;
    this.failures = 0;
    this.loop = this.run().finally(() => { this.running = false; this.loop = null; });
  }
  /** Stops after the request in flight (at most one long poll). */
  stop() { this.running = false; }
  /** Resolves once the loop has ended (tests). */
  done() { return this.loop ?? Promise.resolve(); }

  private say(state: TgState, problem: string | null) { this.d.status({ state, problem, lastOk: this.lastOk }); }
  private log(s: string) { this.d.log(redact(`telegram bot: ${s}`).slice(0, 200)); }

  private async run() {
    this.say("running", null);
    while (this.running) {
      let r: TgReply;
      try {
        r = await this.d.api.call("getUpdates", { offset: this.d.offset.get(), timeout: LONG_POLL_S, allowed_updates: ["message", "callback_query"] });
      } catch (e) {
        if (!this.running) break;
        this.failures++;
        const msg = e instanceof Error ? e.message : String(e);
        if (/no key/i.test(msg)) { this.say("noKey", null); this.log("no bot key on this device, stopped"); this.running = false; break; }
        this.log(`no answer (${msg.slice(0, 80)}), waiting ${backoffMs(this.failures) / 1000} s`);
        this.say("offline", "Telegram did not answer. PS app tries again soon.");
        await this.d.sleep(backoffMs(this.failures));
        continue;
      }
      if (!this.running) break;
      if (!r.ok) {
        const c = classify(r);
        this.log(`getUpdates refused (${r.error_code ?? "?"}): ${c.state}`);
        this.say(c.state, c.problem);
        if (c.wait === null && (c.state === "webhook" || c.state === "badToken")) { this.running = false; break; }
        if (c.state === "offline") this.failures++;
        await this.d.sleep(c.wait ?? backoffMs(Math.max(1, this.failures)));
        continue;
      }
      if (this.failures || this.lastOk === null) this.log("reading messages");
      this.failures = 0;
      this.lastOk = this.d.now();
      this.say("running", null);
      const list = Array.isArray(r.result) ? (r.result as TgUpdate[]) : [];
      for (const u of list) {
        if (!u || typeof u.update_id !== "number") continue;
        // Moved past first: one message that breaks something is never read again and again.
        this.d.offset.set(Math.max(this.d.offset.get(), u.update_id + 1));
        try { await this.handle(u); } catch (e) { this.log(`one message failed (${e instanceof Error ? e.message.slice(0, 80) : "error"})`); }
      }
    }
    this.say("off", null);
  }

  private async send(chatId: number, text: string, undoKey?: string) {
    const params: Record<string, unknown> = { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true };
    if (undoKey) params.reply_markup = { inline_keyboard: [[{ text: "Undo", callback_data: `u:${undoKey}` }]] };
    const r = await this.d.api.call("sendMessage", params).catch(() => null);
    if (r && !r.ok) this.log(`reply refused (${r.error_code ?? "?"})`);
  }

  /** One update. Exposed for the tests. */
  async handle(u: TgUpdate) {
    const chatId = this.d.chatId();
    if (u.callback_query) {
      const c = u.callback_query;
      if (!callbackFromLinked(c, chatId)) { this.log("ignored a button press from a chat that is not linked"); return; }
      await this.d.api.call("answerCallbackQuery", { callback_query_id: c.id }).catch(() => null);
      const key = /^u:([A-Za-z0-9_-]{1,60})$/.exec(c.data || "")?.[1];
      if (!key) return;
      const titles = await this.d.onUndo(key);
      if (c.message) {
        await this.d.api.call("editMessageText", { chat_id: chatId, message_id: c.message.message_id, text: undoneText(titles) }).catch(() => null);
      } else await this.send(chatId!, undoneText(titles));
      this.log(`undo: ${titles.length} removed`);
      return;
    }
    const m = u.message;
    if (!m) { if (u.edited_message) this.log("ignored an edited message"); return; }
    const text = m.text ?? m.caption ?? "";
    // Linking: only the code PS is showing, only in a private chat.
    const code = this.d.linkCode();
    if (code && m.chat?.type === "private" && linkCodeIn(text) === code && (!m.from || (m.from.id === m.chat.id && !m.from.is_bot))) {
      const who = whoOf(m.from ?? m.chat);
      await this.d.onLinked({ id: m.chat.id, who });
      this.log("linked a chat");
      const p = this.d.prefix();
      await this.send(m.chat.id, `${LINKED_TEXT}${p ? `${p} ` : ""}Email QLA P1`);
      return;
    }
    if (!fromLinked(m, chatId)) {
      this.log(chatId === null ? "ignored a message (no chat linked yet)" : "ignored a message from a chat that is not linked");
      return;
    }
    if (/^\/(start|help)(?:@\w+)?\b/i.test(text.trim())) { await this.send(chatId!, helpText(this.d.prefix())); return; }
    const prefix = this.d.prefix();
    const tasks = parseBotMessage(text, prefix);
    if (!tasks) {
      // A message that is not a task: a short hint (a quiet one for a bare /command).
      if (!/^\//.test(text.trim())) await this.send(chatId!, notTaskText(prefix));
      this.log("a message that is not a task");
      return;
    }
    const key = String(u.update_id);
    const added = await this.d.onTasks(key, tasks);
    this.log(`added ${added.length} of ${tasks.length}`);
    if (!added.length) { await this.send(chatId!, "Already on your list."); return; }
    await this.send(chatId!, addedText(tasks), key);
  }
}

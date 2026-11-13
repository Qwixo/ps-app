// Claude Code chats that just finished (the developer, 28 Oct 2026: "auto sends completion notifications to my
// PS app ... saving me having to say to a chat to message me on Telegram"). A Stop hook on the Mac
// (~/.claude/hooks/ps-chat-done.mts) seals {op:"chatDone"} to the developer's vault key, the same way as every
// other Claude package, so the server never sees a chat's name. Whichever device opens the package
// keeps it in settings.chatDone (encrypted with the rest of the settings); PS on the Mac shows a card
// in the top right stack and the phone a notification (src/mailcards.ts sends both). The chat's name
// only, never what it did (the developer's choice). One card per chat: the same chat finishing again replaces
// its card. A Dismiss on either device clears both; a card goes by itself after CHAT_DONE.stay.
// "Remind me in 2 mins" (the developer, 30 Oct 2026): the card goes away on every device and comes back then
// (ChatDone.remindAt), one minute per wheel step, or a time he types. It chimes again when it does.
// Every PS user and other AI tools too (V1.53, the developer 12 Nov 2026: "my friends ... the Claude Code notification feature
// or any AI, like ChatGPT as well"): Settings, AI chat finished cards puts a small hook into Claude Code, Codex,
// Gemini CLI or Cursor on the Mac (ps-mac Sources/AiDone.swift). It never goes through a server: PS on the Mac hands
// the finished chat to this page ({type:"aiDone"}, src/aidone.ts), which keeps it here like a package from the developer's own
// hook. ChatDone.tool says which tool finished, so the card reads "Codex finished"; none means Claude Code.
import type { AiTool, ChatDone } from "./model";
import { dndHeldMs, type Dnd } from "./dnd.ts";

export const CHAT_DONE = { keep: 20, stay: 3 * 3600_000 } as const;
/** The AI tools PS can hear from, with the name each card shows. */
export const AI_TOOLS: Record<AiTool, string> = { claude: "Claude", codex: "Codex", gemini: "Gemini", cursor: "Cursor" };
const aiTool = (v: unknown): AiTool | undefined => typeof v === "string" && v !== "claude" && Object.hasOwn(AI_TOOLS, v) ? v as AiTool : undefined;
/** The card's small line: "Claude finished", "Codex finished". */
export const chatDoneSub = (x: { tool?: AiTool }) => `${AI_TOOLS[x.tool || "claude"] || AI_TOOLS.claude} finished`;
/** The remind picker on a chat card: 2 minutes to start, 1 minute per wheel step, 1 minute to 4 hours. */
export const CHAT_REMIND = { start: 2, step: 1, min: 1, max: 240 } as const;
/** V1.55 (the developer, 12 Nov 2026: "with the AI chat card notification things, I also want you to add the option to make it
 *  disappearing as well by default ... by default it takes fifteen seconds"): how long a chat card stays on the Mac's
 *  screen before it goes by itself, a line under it running down meanwhile (ps-mac Toast.swift). 0 is Off: it stays
 *  until dismissed, as before. Going by itself only takes it off that Mac's screen: it is no Dismiss, so the phone's
 *  notification and the card's 3 hours stay as they are. Settings > Notifications > AI chat finished cards. */
export const CHAT_FADE_DEFAULT = 10;   // V1.56 (the developer): 10 s by default (V1.55: 15)
// V1.56 (the developer, 13 Nov 2026: "group more than 1 notification into the same one notification"): the Mac's card page
// (ps-mac Toast.swift) shows every finished chat as a row of ONE bubble, each row with its own circle that shrinks
// over this time and "X secs ago"; the phone bundles them under one summary (ps-gos ChatGroup.kt). Each chat is
// still its own card here and in Swift, so Dismiss, Remind me in and the 3 hours stay per chat.
export const CHAT_FADE_CHOICES = [5, 10, 15, 30, 60] as const;
export function chatFade(v: unknown): number {
  if (v === 0) return 0;
  return typeof v === "number" && (CHAT_FADE_CHOICES as readonly number[]).includes(v) ? v : CHAT_FADE_DEFAULT;
}
/** The card's own time for the Mac (its "life"), or nothing when Off. */
export const chatLife = (v: unknown): { life?: number } => { const n = chatFade(v); return n > 0 ? { life: n } : {}; };
/** When the card last came up: its finish, or the end of a remind. CHAT_DONE.stay counts from here. */
const shownFrom = (x: ChatDone) => Math.max(Date.parse(x.at), x.remindAt ? Date.parse(x.remindAt) || 0 : 0);
const reminding = (x: ChatDone, now: number) => !!x.remindAt && Date.parse(x.remindAt) > now;
/** How long the card has been up: Do Not Disturb holds it, so its quiet stretch does not count (core/dnd.ts). */
const upFor = (x: ChatDone, now: number, dnd?: Dnd) => now - shownFrom(x) - dndHeldMs(dnd, "chats", shownFrom(x), now);

/** The op as Claude drops it. Anything malformed is ignored (returns null). */
export function chatDoneFrom(o: { id?: unknown; chat?: unknown; at?: unknown; tool?: unknown }): ChatDone | null {
  const id = typeof o.id === "string" ? o.id.replace(/[^\w-]/g, "").slice(0, 36) : "";
  const chat = typeof o.chat === "string" ? o.chat.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const at = typeof o.at === "string" && !Number.isNaN(Date.parse(o.at)) ? new Date(o.at).toISOString() : "";
  const tool = aiTool(o.tool);
  // Another tool's chat never shares a card with a Claude chat that happens to have the same id.
  return id && chat && at ? { id: tool ? `${tool}-${id}`.slice(0, 36) : id, chat, at, ...(tool ? { tool } : {}) } : null;
}

/** The list with one more finished chat: newest first, one per chat, old ones dropped. */
export function addChatDone(list: ChatDone[] | undefined, d: ChatDone, now = Date.now(), dnd?: Dnd): ChatDone[] {
  // The same package opened twice (it is kept until applied everywhere) keeps its Dismiss.
  const same = (list || []).find((x) => x.id === d.id && x.at === d.at);
  return [same || d, ...(list || []).filter((x) => x.id !== d.id)]
    .filter((x) => upFor(x, now, dnd) < CHAT_DONE.stay)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, CHAT_DONE.keep);
}

/** The cards to show now: not dismissed, not reminded for later, not older than CHAT_DONE.stay.
 *  fresh: it finished, or came back from a remind, in the last 3 minutes (so PS chimes for it). */
export function chatDoneCards(list: ChatDone[] | undefined, now = Date.now(), dnd?: Dnd) {
  return (list || []).filter((x) => !x.seen && !reminding(x, now) && upFor(x, now, dnd) < CHAT_DONE.stay)
    // rev: the phone shows a card once per revision (ps-gos NoteLedger.kt); a remind coming due is a new one.
    .map((x) => ({ id: chatCardId(x), chat: x.chat, sub: chatDoneSub(x), tool: x.tool || "claude" as AiTool, at: x.at, rev: `${x.at}|${x.remindAt || ""}`, fresh: upFor(x, now, dnd) < 180_000 }));
}
export const chatCardId = (x: ChatDone) => `c:${x.id}`.slice(0, 40);

/** The list with one card dismissed, or reminded for `mins` minutes (clamped to CHAT_REMIND). */
export function chatDoneAnswer(list: ChatDone[] | undefined, id: string, action: "dismiss" | number, now = Date.now()): ChatDone[] | null {
  const l = list || [];
  if (!l.some((x) => chatCardId(x) === id && !x.seen)) return null;
  return l.map((x) => chatCardId(x) !== id ? x : action === "dismiss" ? { ...x, seen: true }
    : { ...x, remindAt: new Date(now + Math.max(CHAT_REMIND.min, Math.min(CHAT_REMIND.max, Math.round(action))) * 60_000).toISOString() });
}

/** Two devices' copies of the list joined (the vault's settings merger, core/cardsync.ts). One entry per chat:
 *  the newer finish wins; for the same finish a Dismiss on either holds, and the later remind. */
export function mergeChatDone(a: ChatDone[] | undefined, b: ChatDone[] | undefined): ChatDone[] | undefined {
  if (!a || !b) return a || b;
  const by = new Map<string, ChatDone>();
  for (const x of [...b, ...a]) {
    const was = by.get(x.id);
    if (!was || x.at > was.at) { by.set(x.id, x); continue; }
    if (x.at < was.at) continue;
    const remindAt = [was.remindAt, x.remindAt].filter((v): v is string => !!v).sort().pop();
    by.set(x.id, { ...was, ...x, seen: !!(was.seen || x.seen) || undefined, remindAt });
  }
  return [...by.values()].map((x) => { const y = { ...x }; if (!y.seen) delete y.seen; if (!y.remindAt) delete y.remindAt; return y; })
    .sort((p, q) => q.at.localeCompare(p.at)).slice(0, CHAT_DONE.keep);
}

/** When the next reminded chat card comes back (ms since 1970), or 0 when none is waiting. */
export function nextChatRemind(list: ChatDone[] | undefined, now = Date.now()): number {
  let next = 0;
  for (const x of list || []) if (!x.seen && reminding(x, now)) { const at = Date.parse(x.remindAt!); if (!next || at < next) next = at; }
  return next;
}

/** The items PS on the Mac sends (src/aidone.ts, ps-mac Sources/AiDone.swift); anything malformed is dropped, but still
 *  taken, so it never comes back. */
export function aiDoneItems(v: unknown): { keys: string[]; done: ChatDone[] } {
  const keys: string[] = [], done: ChatDone[] = [];
  for (const it of Array.isArray(v) ? v.slice(0, 50) : []) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    if (typeof o.key !== "string" || !/^[\w.-]{1,120}$/.test(o.key)) continue;
    keys.push(o.key);
    const d = chatDoneFrom(o);
    if (d) done.push(d);
  }
  return { keys, done };
}

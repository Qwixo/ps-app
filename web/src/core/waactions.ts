// WhatsApp actions that touch the vault and the server (core/whatsapp.ts holds the rules). The server (whatsapp-send)
// does the sending, so the Mac, the website and the phone can all reply with no Mac involved. Every send here starts from
// the person's own Send click (after the 10 second Undo in the panel): nothing in this file runs by itself.
import type { Doc, Settings } from "./model";
import { doc, docs, put, setMerger, sb } from "./vault";
import { settings } from "./select";
import { vaultStore } from "./vault";
import { saveSettings } from "./actions";
import { applyOutbound, groupChats, mergeChat, prefsOf, replyPlan, sendOutcome, SEND_ERR, waRemindPatch, waSeenPatch, type WaChat, type WaPrefs, type WaTicks } from "./whatsapp";

setMerger("wachat", (a, b) => mergeChat(a as WaChat, b as WaChat));
const now = () => new Date().toISOString();
const prefs = (): WaPrefs => prefsOf(settings(vaultStore.get())?.data as Settings | undefined);

export async function waInvoke(body: Record<string, unknown>): Promise<any> {
  const r = await sb.functions.invoke("whatsapp-send", { body });
  if (!r.error) return r.data;
  // A 4xx still carries the plain answer ({ error: "window_closed" }): read it.
  try { const ctx = (r.error as { context?: Response }).context; if (ctx && typeof ctx.json === "function") return await ctx.json(); } catch { /* fall through */ }
  return { ok: false, error: SEND_ERR.failed };
}

const groupOf = (chatId: string) => groupChats(docs("wachat")).find((g) => g.id === chatId || g.ids.includes(chatId));

/** Dismiss (Done): the chat stays quiet until a newer message, on every device (the record itself says so). */
export async function setWaSeen(chatId: string) {
  const g = groupOf(chatId);
  if (!g) return;
  for (const id of g.ids) { const d = doc<WaChat>(id); if (d && (!d.data.seenAt || d.data.seenAt < g.chat.lastInAt)) await put("wachat", { ...d.data, ...waSeenPatch({ ...d.data, lastInAt: g.chat.lastInAt }) }, { id, ws: null }); }
}
/** Remind me in N mins: off every device until then. A Dismiss always wins. */
export async function setWaRemind(chatId: string, mins: number, at = Date.now()) {
  const g = groupOf(chatId);
  if (!g || (g.chat.seenAt && g.chat.seenAt >= g.chat.lastInAt)) return;
  for (const id of g.ids) { const d = doc<WaChat>(id); if (d) await put("wachat", { ...d.data, ...waRemindPatch({ ...d.data, lastInAt: g.chat.lastInAt }, mins, at) }, { id, ws: null }); }
}

/** Put the outcome on the chat: the reply with Sent (its id from WhatsApp), or a "Not sent" line with the reason. */
async function record(chatId: string, f: (c: WaChat) => WaChat) {
  const g = groupOf(chatId);
  if (!g) return;
  await put("wachat", f(g.chat), { id: g.id, ws: null });
}
const failed = (c: WaChat, text: string, error: string): WaChat => ({ ...c, msgs: [...c.msgs.filter((m) => !m.id.startsWith("local-")), { id: `local-${Date.now()}`, at: now(), dir: "out" as const, kind: "text" as const, text: text.slice(0, 4096), ticks: "failed" as WaTicks, error }].slice(-30) });

/** The panel's Send, once the Undo has run out. Returns the plain outcome; it is also written on the chat, so a device that only
 *  watches the vault (the Tab list) shows Sent or Not sent too. */
export async function sendWaReply(chatId: string, text: string, replyTo?: string | null): Promise<{ ok: boolean; error?: string; closed?: boolean }> {
  const g = groupOf(chatId);
  if (!g) return { ok: false, error: SEND_ERR.failed };
  const plan = replyPlan(g.chat);
  if (plan === "none") { await record(chatId, (c) => failed(c, text, SEND_ERR.noNumber)); return { ok: false, error: SEND_ERR.noNumber }; }
  if (plan === "template") { await record(chatId, (c) => failed(c, text, SEND_ERR.closed)); return { ok: false, error: SEND_ERR.closed, closed: true }; }
  const out = sendOutcome(await waInvoke({ op: "send", to: g.chat.wa, text, ...(replyTo ? { replyTo } : {}) }));
  if (!out.ok) { await record(chatId, (c) => failed(c, text, out.error)); return { ok: false, error: out.error, closed: out.closed }; }
  await record(chatId, (c) => applyOutbound({ ...c, msgs: c.msgs.filter((m) => !m.id.startsWith("local-")) }, { id: out.id, text, at: now() }));
  await setWaSeen(chatId);   // answering clears the card, like answering in Gmail
  const last = [...g.chat.msgs].filter((m) => m.dir === "in").pop();
  if (prefs().markRead !== false && last) void waInvoke({ op: "read", messageId: last.id }).catch(() => {});
  return { ok: true };
}
/** A template after the window closed (an approved one the person picked). */
export async function sendWaTemplate(chatId: string, name: string, language: string): Promise<{ ok: boolean; error?: string }> {
  const g = groupOf(chatId);
  if (!g?.chat.wa) return { ok: false, error: SEND_ERR.noNumber };
  const out = sendOutcome(await waInvoke({ op: "send-template", to: g.chat.wa, name, language }));
  if (!out.ok) { await record(chatId, (c) => failed(c, `Template ${name}`, out.error)); return { ok: false, error: out.error }; }
  await record(chatId, (c) => applyOutbound({ ...c, msgs: c.msgs.filter((m) => !m.id.startsWith("local-")) }, { id: out.id, text: `Template: ${name}`, at: now() }));
  return { ok: true };
}

/** Approved templates, saved in the WhatsApp settings (not secret) so the Tab list can show them too. */
export async function refreshWaTemplates(): Promise<{ ok: boolean; count?: number; error?: string }> {
  const r = await waInvoke({ op: "templates" });
  if (!r?.ok || !Array.isArray(r.templates)) return { ok: false, error: typeof r?.error === "string" ? r.error : SEND_ERR.failed };
  await saveWaPrefs({ templates: r.templates.slice(0, 50), templatesAt: now() });
  return { ok: true, count: r.templates.length };
}
export function saveWaPrefs(patch: Partial<WaPrefs>): Promise<void> {
  return saveSettings({ wa: { ...prefs(), ...patch } });
}
export type { Doc };

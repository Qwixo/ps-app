// Add Telegram Bot (V1.47): the part that runs. Rules in core/tgbot.ts, the reading loop in core/tgpoll.ts, the
// Settings tab in views/TelegramBot.tsx.
//
// Where it runs: only inside PS, on the page that holds the vault keys (the Mac's main page, the phone's page), while
// PS runs, the vault is open and this device has a bot key. The website and the iPhone web app only show the tab.
// The token: only the native shell has it (Mac: Keychain, pasted into a small PS window, ps-mac TelegramBot.swift;
// phone: sealed with the Android Keystore, ps-gos TgBot.kt). This page asks the shell to call Telegram for it
// ({type:"tg:call"}), the shell adds the token and makes the request off the main thread through the system's network,
// and answers {type:"tg:res"} with Telegram's reply. The token never enters this page or a log.
// What is kept where: the start word and the linked chat in the synced settings (settings.tgBot, never the token);
// how far it has read and the Undo list on this device (localStorage).
import { useSyncExternalStore } from "react";
import { PS, psPost } from "./ps";
import { GOS, gosPost, onShell } from "./gos/bridge";
import { vaultStore } from "./core/vault";
import { settingsData } from "./core/select";
import { addBotTasks, removeBotTasks, saveSettings, type BotRef } from "./core/actions";
import { cleanTgPrefs, newLinkCode, redact, TEST_TEXT, type TgBotPrefs } from "./core/tgbot";
import { TgPoller, type TgApi, type TgReply, type TgState } from "./core/tgpoll";

export type TgBotInfo = { id: number; username: string; name: string };
/** What Settings shows. On the Mac the main page sends it to PS, which hands it to the Tab list (psSettings.tgBot). */
export interface TgView {
  saved: boolean | null;          // a bot key on this device (null: not known yet)
  bot: TgBotInfo | null;
  state: TgState;
  problem: string | null;
  linkCode: string | null;        // "Link my Telegram" is waiting for this code
  test: "idle" | "busy" | "ok" | "fail";
  testText: string | null;
}
const LINK_MS = 10 * 60_000;
const OFFSET_KEY = "ps.tgbot.offset";
const UNDO_KEY = "ps.tgbot.undo";

let where: "mac" | "phone" | null = null;
let view: TgView = { saved: null, bot: null, state: "off", problem: null, linkCode: null, test: "idle", testText: null };
const subs = new Set<() => void>();
let lastSent = "";
function set(p: Partial<TgView>) {
  const next = { ...view, ...p };
  // Every good long poll says "running" again: only a real change redraws or goes to PS.
  if (JSON.stringify(next) === JSON.stringify(view)) return;
  view = next;
  subs.forEach((f) => f());
  if (where === "mac") {
    const s = JSON.stringify(macStatus());
    if (s !== lastSent) { lastSent = s; psPost({ type: "tg:status", status: macStatus() }); }
  }
}
const macStatus = () => ({ bot: view.bot, state: view.state, problem: view.problem, linkCode: view.linkCode, test: view.test, testText: view.testText });
/** The phone's tab reads this; the Mac's Tab list reads psSettings.tgBot. */
export function useTgView(): TgView {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => view);
}

// ---------- the shell relay ----------
const pending = new Map<string, { ok: (r: TgReply) => void; no: (e: Error) => void; t: ReturnType<typeof setTimeout> }>();
let seq = 0;
const post = (m: object) => (where === "mac" ? psPost(m) : gosPost(m));
const api: TgApi = {
  call(method, params) {
    return new Promise<TgReply>((ok, no) => {
      const id = `t${Date.now().toString(36)}${(seq++).toString(36)}`;
      const t = setTimeout(() => { pending.delete(id); no(new Error("timed out")); }, method === "getUpdates" ? 45_000 : 20_000);
      pending.set(id, { ok, no, t });
      post({ type: "tg:call", id, method, params });
    });
  },
};

/** A message from the shell. True when it was ours. */
export function tgShellMessage(m: { type?: string; [k: string]: unknown }): boolean {
  if (typeof m?.type !== "string" || !m.type.startsWith("tg:")) return false;
  if (m.type === "tg:res") {
    const p = pending.get(String(m.id));
    if (!p) return true;
    pending.delete(String(m.id)); clearTimeout(p.t);
    if (m.noKey === true) p.no(new Error("no key"));
    else if (typeof m.body !== "string") p.no(new Error(typeof m.error === "string" ? redact(m.error).slice(0, 80) : "no answer"));
    else { try { p.ok(JSON.parse(m.body) as TgReply); } catch { p.no(new Error("not an answer from Telegram")); } }
    return true;
  }
  if (m.type === "tg:changed") {
    const saved = m.saved === true;
    if (saved !== view.saved || m.fresh === true) { stopPoll(); set({ saved, bot: null, state: saved ? "off" : "noKey", problem: null, test: "idle", testText: null }); }
    void reconsider();
    return true;
  }
  if (m.type === "tg:op") { void tgOp(String(m.op), m); return true; }
  return false;
}

// ---------- this device's bookkeeping ----------
const ls = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* full or blocked: only Undo and the offset are lost */ } },
};
const offsetKey = () => `${OFFSET_KEY}.${view.bot?.id ?? 0}`;
type UndoRec = { at: number; refs: BotRef[] };
function undoAll(): Record<string, UndoRec> {
  try { const o = JSON.parse(ls.get(UNDO_KEY) || "{}"); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}
function undoSave(o: Record<string, UndoRec>) {
  const cut = Date.now() - 48 * 3600_000;
  const keep = Object.entries(o).filter(([, v]) => v && v.at > cut).sort((a, b) => b[1].at - a[1].at).slice(0, 40);
  ls.set(UNDO_KEY, JSON.stringify(Object.fromEntries(keep)));
}
/** A fixed id per bot, message and task, so the same message read twice adds nothing (vault ids are uuids). */
async function idFor(key: string, i: number): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ps-tgbot:${view.bot?.id ?? 0}:${key}:${i}`)));
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const prefs = (): TgBotPrefs => cleanTgPrefs(settingsData(vaultStore.get())?.tgBot);
async function savePrefs(p: Partial<TgBotPrefs>) { await saveSettings({ tgBot: { ...prefs(), ...p } }); }

// ---------- the reader ----------
let poller: TgPoller | null = null;
let linkTimer: ReturnType<typeof setTimeout> | null = null;
function stopPoll() { poller?.stop(); poller = null; }
const vaultOpen = () => { const v = vaultStore.get(); return v.status === "unlocked" && v.role === "owner"; };

let checking = false;
async function reconsider() {
  if (!where || checking) return;
  const want = view.saved === true && vaultOpen() && (prefs().chatId !== null || view.linkCode !== null)
    && view.state !== "badToken" && view.state !== "webhook";
  if (!want) { if (poller) { stopPoll(); if (view.state === "running" || view.state === "offline" || view.state === "conflict") set({ state: "off", problem: null }); } return; }
  if (poller?.active) return;
  checking = true;
  try {
    if (!view.bot) {
      const me = await api.call("getMe", {}).catch((e: Error) => (/no key/i.test(e.message) ? "nokey" : null));
      if (me === "nokey") { set({ saved: false, state: "noKey" }); return; }
      if (!me) { set({ state: "offline", problem: "Telegram did not answer. PS app tries again soon." }); setTimeout(() => void reconsider(), 30_000); return; }
      if (!me.ok) {
        const bad = me.error_code === 401 || me.error_code === 404;
        set({ state: bad ? "badToken" : "offline", problem: bad ? "Telegram did not accept this bot key. Paste it again from BotFather." : "Telegram did not answer. PS app tries again soon." });
        if (!bad) setTimeout(() => void reconsider(), 30_000);
        return;
      }
      const r = me.result as { id?: number; username?: string; first_name?: string };
      set({ bot: { id: Number(r.id) || 0, username: String(r.username || "").slice(0, 64), name: String(r.first_name || "").slice(0, 64) } });
    }
    poller = new TgPoller({
      api,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      log: (line) => post({ type: "log", text: line }),
      chatId: () => prefs().chatId,
      prefix: () => prefs().prefix,
      linkCode: () => view.linkCode,
      onLinked: async (c) => { await savePrefs({ chatId: c.id, who: c.who }); endLink(); },
      onTasks: async (key, tasks) => {
        const list = await Promise.all(tasks.map(async (t, i) => ({ id: await idFor(key, i), text: t.text, urgent: t.urgent, zone: t.zone, prio: t.prio, due: t.due })));
        const refs = await addBotTasks(list);
        if (refs.length) { const o = undoAll(); o[`${view.bot?.id ?? 0}:${key}`] = { at: Date.now(), refs }; undoSave(o); }
        return refs.map((r) => r.title);
      },
      onUndo: async (key) => {
        const o = undoAll(), k = `${view.bot?.id ?? 0}:${key}`, rec = o[k];
        if (!rec) return [];
        delete o[k]; undoSave(o);
        return removeBotTasks(rec.refs);
      },
      offset: { get: () => Number(ls.get(offsetKey())) || 0, set: (n) => ls.set(offsetKey(), String(n)) },
      // A stop for a reason (webhook, wrong key, no key) keeps that reason on screen rather than a plain "off".
      status: (s) => { if (s.state === "off" && (!poller || ["webhook", "badToken", "noKey"].includes(view.state))) return; set({ state: s.state, problem: s.problem }); },
    });
    poller.start();
  } finally { checking = false; }
}
function endLink() {
  if (linkTimer) { clearTimeout(linkTimer); linkTimer = null; }
  if (view.linkCode) set({ linkCode: null });
  void reconsider();
}

/** Settings' buttons (on the Mac they come from the Tab list through PS as {type:"tg:op"}). */
export async function tgOp(op: string, m: Record<string, unknown> = {}) {
  if (!where) return;
  if (op === "link") {
    if (linkTimer) clearTimeout(linkTimer);
    set({ linkCode: newLinkCode() });
    linkTimer = setTimeout(endLink, LINK_MS);
    void reconsider();
  } else if (op === "cancelLink") endLink();
  else if (op === "unlink") { await savePrefs({ chatId: null, who: null }); endLink(); }
  else if (op === "retry") { set({ state: "off", problem: null, bot: null }); void reconsider(); }
  else if (op === "test") {
    set({ test: "busy", testText: null });
    const chatId = prefs().chatId;
    const r = await api.call(chatId !== null ? "sendMessage" : "getMe", chatId !== null ? { chat_id: chatId, text: TEST_TEXT } : {}).catch(() => null);
    if (!r) set({ test: "fail", testText: "Telegram did not answer. Check the internet and try again." });
    else if (!r.ok) set({ test: "fail", testText: r.error_code === 401 || r.error_code === 404 ? "Telegram did not accept this bot key." : r.error_code === 403 ? "Telegram says you blocked the bot or never started it. Open it and press Start." : "Telegram said no. Try again in a moment." });
    else set({ test: "ok", testText: chatId !== null ? "Sent. Look in Telegram." : "Your bot key works. Link your Telegram next." });
  } else if (op === "remove") {
    // The key goes from this device (the shell answers tg:changed); the linked chat goes everywhere.
    stopPoll(); endLink();
    await savePrefs({ chatId: null, who: null });
    if (where === "phone") gosPost({ type: "tg:remove" });
  } else if (op === "save" && where === "phone" && typeof m.token === "string") {
    gosPost({ type: "tg:save", token: m.token });
  }
}

let started = false;
/** Main page (Mac) or the phone's page, once. */
export function startTgBot() {
  if (started) return;
  if (PS) where = "mac"; else if (GOS) where = "phone"; else return;
  started = true;
  if (where === "phone") onShell((m) => { tgShellMessage(m as { type?: string }); });
  let last = "";
  vaultStore.subscribe(() => {
    const v = vaultStore.get(), p = prefs();
    const k = `${v.status}:${v.role}:${p.chatId}:${p.prefix}`;
    if (k !== last) { last = k; void reconsider(); }
  });
  post({ type: "tg:get" });
}

// The Settings assistant's state and its talk with the Mac (PS 1.65). One small store the card (views/Assistant.tsx), the bot button, the
// spotlight and the Mac's island all read. The rules are in core/assist.ts (tools, re-check, simple version, island words), core/assistwalk.ts
// (the walk) and core/featreq.ts (feature requests); this file only wires them to the page: the bridge to the Mac (window.__psAssist and the
// assist:* messages), Settings (openSettings), the vault (saveSettings), the sounds and the squad. Until the Mac has said an AI is ready (and
// on the website and phone) the simple version runs, so the assistant works everywhere.
//
// The bridge (both sides are in this pull request; mac/Sources/AssistProviders.swift is the other end):
//   page to Mac:  assist:ask {id, text, tools, settings}   assist:cancel {id}   assist:status {}   assist:provider {pick, how?}
//                 assist:test {pick}   assist:key:set {pick, key}   assist:key:remove {pick}
//                 assist:island {show, state, line?, buttons?, vol, reduce}   (core/assist.ts islandMsg)
//   Mac to page:  assist:answer {id, plan, via, note?}   assist:status {providers, pick, tested?}   assist:error {id, line}
//                 assist:typed {text} (typed on the island)   assist:action {do} (a button on the island)   assist:closed {}
import { useSyncExternalStore } from "react";
import { PS, psPost } from "./ps";
import { openSettings, settingsWanted } from "./views/SettingsScreen";
import { saveSettings } from "./core/actions";
import { vaultStore } from "./core/vault";
import { settingsData } from "./core/select";
import { feature } from "./core/features";
import { squadRecNow } from "./squad/engine";
import { sendRequest, deleteRequest } from "./squad/featreqhub";
import { assistSound } from "./ui/sfx";
import { ASSIST_FEATURE, ASSIST_WORDS, PAGE_WAIT_MS, walkModeFor, CHANGEABLE, PICKS, TOOLS, asksForSecret, assistPrefs, cleanSay, closestFor, confirmButtons, digest, islandMsg, outsideGuideFor, recheck, simplePlan, type AiPick, type IslandState, type Match, type Plan, type Via } from "./core/assist";
import { buildWalk, nextTimeLine, startWalk, walkSay, walkStep, type Effect, type Mode, type WalkState } from "./core/assistwalk";
import { afterSend, buildRequest, canUndo, cleanEntries, due, hold, retryable, undo, UNDO_MS, type FrEntry } from "./core/featreq";
import { settingById, type Ctx } from "./core/settingsindex";

export type Phase = "idle" | "thinking" | "confirm" | "walk" | "result";
export interface ProviderStatus { ready: boolean; how?: string; why?: string }
export interface AssistStatus { providers: Partial<Record<AiPick, ProviderStatus>>; pick: AiPick; tested?: { pick: AiPick; ok: boolean; line: string } }
export interface AState {
  phase: Phase; text: string; plan: Plan | null; via: Via | null; note: string; matches: Match[];
  walk: WalkState | null; mode: Mode; nextTime: { path: string; id: string } | null; request: FrEntry | null; status: AssistStatus | null; reqId: string; guide: number;
  /** The row that glows after a change (views/Assistant.tsx AssistSpot). */
  glow: string | null;
}
const FRESH: AState = { phase: "idle", text: "", plan: null, via: null, note: "", matches: [], walk: null, mode: "do", nextTime: null, request: null, status: null, reqId: "", guide: 0, glow: null };
let st: AState = FRESH;
const subs = new Set<() => void>();
const set = (p: Partial<AState>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const assistState = () => st;
export function useAssist(): AState { return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st); }

let ctxNow: Ctx = { red: false, where: "web" };
/** Settings tells the assistant who is looking (which settings this person sees here). */
export const assistCtx = (c: Ctx) => { ctxNow = c; };
export const assistOn = (): boolean => feature(ASSIST_FEATURE) && assistPrefs(settingsData(vaultStore.get()).assistant).on;
const narrowNow = () => typeof matchMedia === "function" && matchMedia("(max-width: 720px)").matches;
const reduceNow = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
/** PS's own sound settings: the volume (Settings, Your list) and the Tab list's mute button. */
const soundVol = (): number => (settingsData(vaultStore.get()).tmMuted ? 0 : 1);
const cue = (k: "chime" | "happy") => { if (!islandShown) assistSound(k, soundVol() > 0); };

// ---------- the island (Mac only: the page says what the island card shows; the Mac draws it, plays its sounds and keeps Esc) ----------
let islandShown = false;
function island(state: IslandState, line?: string, show = true) {
  if (!PS) return;
  if (show && !islandHere()) return;
  islandShown = show;
  psPost(islandMsg({ show, state, line, buttons: state === "confirm" && st.plan ? confirmButtons(st.plan) : undefined, vol: soundVol(), reduce: reduceNow() }));
}
/** True on a Mac where the island card can show (the island is not switched off): then the card in Settings stays small. */
export const islandHere = (): boolean => PS && islandMode() !== "off";
const islandMode = (): string => { const i = settingsData(vaultStore.get()).island as { mode?: string } | undefined; return i?.mode ?? "notch"; };

// ---------- asking ----------
let askTimer = 0;
const aiReady = (): boolean => !!PS && !!st.status && st.status.providers[st.status.pick]?.ready === true;
function plainAnswer(text: string, note = "") {
  const r = simplePlan(text, ctxNow);
  finish(r.plan, "simple", r.matches, note);
}
export function ask(text: string) {
  const t = cleanSay(text, 200);
  if (!t || !assistOn()) return;
  endWalk();
  window.clearTimeout(askTimer);
  const id = Math.random().toString(36).slice(2, 10);
  set({ text: t, plan: null, matches: [], note: "", nextTime: null, request: null, reqId: id, glow: null, guide: 0 });
  // Someone pasting a password or a key: it never goes anywhere, not to an AI and not into a feature request.
  if (asksForSecret(t)) { set({ phase: "result", plan: { kind: "none", say: ASSIST_WORDS.guideNote }, via: "simple" }); island("answer", ASSIST_WORDS.guideNote); return; }
  if (!aiReady()) { plainAnswer(t); return; }
  set({ phase: "thinking" });
  island("thinking", ASSIST_WORDS.thinking);
  psPost({ type: "assist:ask", id, text: t, tools: TOOLS, settings: digest(ctxNow) });
  // The Mac has its own timeouts and falls back by itself; this only covers a Mac that never answers at all.
  askTimer = window.setTimeout(() => {
    if (st.reqId !== id || st.phase !== "thinking") return;
    psPost({ type: "assist:cancel", id });
    plainAnswer(t, ASSIST_WORDS.slow);
  }, PAGE_WAIT_MS);
}
function finish(plan: Plan, via: Via, matches: Match[], note = "") {
  window.clearTimeout(askTimer);
  const phase: Phase = plan.kind === "none" ? "result" : "confirm";
  set({ plan, via, matches, note: cleanSay(note, 160), phase, guide: 0 });
  if (plan.kind === "none") {
    const sent = featureRequest(plan, matches);
    const c = st.plan?.closest ? settingById(st.plan.closest.settingId) : undefined;
    island("answer", sent ? `${ASSIST_WORDS.frSent} ${c ? `${ASSIST_WORDS.frCant} ${c.name}.` : ASSIST_WORDS.frNoClosest}` : plan.say);
  }
  else island(plan.kind === "guide" ? "answer" : "confirm", plan.say);
  cue("chime");
}
/** Everything the Mac sends. Every answer goes through the re-check first: the page never trusts the AI. */
export function fromMac(raw: unknown) {
  if (!raw || typeof raw !== "object") return;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case "assist:answer": {
      if (m.id !== st.reqId || st.phase !== "thinking") return;   // an old or cancelled answer
      const note = typeof m.note === "string" ? m.note : "";
      // "simple": the Mac had no AI that could answer, so the page's own simple version does it (with the Mac's one line why).
      if (m.via !== "apple" && m.via !== "claude" && m.via !== "chatgpt") { plainAnswer(st.text, note); return; }
      const { plan } = recheck(m.plan, ctxNow);
      const matches = plan.kind === "none" ? simplePlan(st.text, ctxNow).matches : [];
      finish(plan, m.via, matches, note);
      break;
    }
    case "assist:error": if (m.id === st.reqId && st.phase === "thinking") plainAnswer(st.text, ASSIST_WORDS.aiFailed); break;
    case "assist:status": {
      const prov: AssistStatus["providers"] = {};
      const p = (m.providers && typeof m.providers === "object" ? m.providers : {}) as Record<string, unknown>;
      for (const k of PICKS) {
        const v = (p[k] && typeof p[k] === "object" ? p[k] : null) as Record<string, unknown> | null;
        if (v) prov[k] = { ready: v.ready === true, ...(typeof v.how === "string" ? { how: cleanSay(v.how, 10) } : {}), ...(typeof v.why === "string" ? { why: cleanSay(v.why, 160) } : {}) };
      }
      const t = (m.tested && typeof m.tested === "object" ? m.tested : null) as Record<string, unknown> | null;
      const tested = t && PICKS.includes(t.pick as AiPick) && typeof t.line === "string" ? { pick: t.pick as AiPick, ok: t.ok === true, line: cleanSay(t.line, 160) } : undefined;
      const pick = PICKS.includes(m.pick as AiPick) ? (m.pick as AiPick) : "apple";
      set({ status: { providers: Object.keys(prov).length ? prov : st.status?.providers ?? {}, pick, ...(tested ? { tested } : {}) } });
      break;
    }
    case "assist:typed": if (typeof m.text === "string") ask(m.text); break;   // typed in the island's box
    case "assist:action":   // a button on the island
      if (m.do === "doit") confirm("do"); else if (m.do === "show") confirm("show"); else if (m.do === "next") guideNext(); else if (m.do === "cancel") cancel();
      break;
    case "assist:closed": islandShown = false; if (st.phase === "walk") assistEsc(); else if (st.phase !== "idle") cancel(false); break;   // Esc or the x on the island
  }
}
/** Back to the empty card. `tellIsland` false when the island itself closed. */
export function cancel(tellIsland = true) {
  if (st.phase === "thinking") psPost({ type: "assist:cancel", id: st.reqId });
  window.clearTimeout(askTimer);
  endWalk();
  set({ ...FRESH, status: st.status, request: st.request && canUndo(st.request) ? st.request : null });
  if (tellIsland && islandShown) island("done", undefined, false);
}

// ---------- the confirm step ----------
export function confirm(how: "do" | "show") {
  const p = st.plan;
  if (!p || st.phase !== "confirm" || !p.settingId || p.kind === "guide") return;
  const mode = walkModeFor(p, how);
  const w = buildWalk(p.settingId, ctxNow, narrowNow());
  if (!w) return;
  const { state, effects } = startWalk(w, mode, reduceNow());
  set({ phase: "walk", walk: state, mode, glow: null });
  show(state);
  run(effects);
  schedule();
}
/** In PS's first setup the walk would leave the setup menu, so the card does it in place: Do it changes the setting right there,
 *  Show me how says the path. Both end with the Next time link, and the setup carries on. */
export async function confirmHere(how: "do" | "show") {
  const p = st.plan;
  if (!p || st.phase !== "confirm" || !p.settingId || p.kind === "guide") return;
  const mode = walkModeFor(p, how);
  set({ mode, note: "" });
  if (mode === "do") await apply();
  const failed = st.note === ASSIST_WORDS.notSaved;
  const say = mode === "do" ? (failed ? st.note : st.note === ASSIST_WORDS.wasAlready ? ASSIST_WORDS.wasAlready : ASSIST_WORDS.done1) : showLineFor(p.settingId);
  set({ phase: "result", plan: { kind: "none", say }, nextTime: nextOf(p.settingId), note: "" });
  if (!failed) cue("happy");
}
const showLineFor = (id: string) => recheck({ kind: "show", settingId: id }, ctxNow).plan.say;
/** The next outside step of a guide (WhatsApp), or the end. */
export function guideNext() {
  const p = st.plan;
  if (!p || p.kind !== "guide" || !p.settingId) return;
  const g = outsideGuideFor(p.settingId);
  if (!g) return;
  if (st.guide + 1 >= g.steps.length) {
    set({ phase: "result", plan: { kind: "none", say: ASSIST_WORDS.guideDone }, nextTime: nextOf(p.settingId) });
    island("done", ASSIST_WORDS.done1); cue("happy");
    return;
  }
  set({ guide: st.guide + 1 });
  island("answer", g.steps[st.guide].line);
}
const nextOf = (id: string): { path: string; id: string } | null => { const w = buildWalk(id, ctxNow); return w ? { path: w.path, id } : null; };
let tick = 0;
function schedule() {
  window.clearInterval(tick);
  const w = st.walk;
  if (!w || w.phase === "waiting" || w.phase === "done") return;
  tick = window.setInterval(() => { if (st.walk) { const r = walkStep(st.walk, "tick"); take(r.state, r.effects); } }, 1000);
}
function take(next: WalkState, effects: Effect[]) {
  set({ walk: next });
  if (next.phase !== "done") show(next);
  run(effects);
  if (next.phase === "waiting" || next.phase === "done") window.clearInterval(tick);
}
/** Settings moves to where the step points, and the island says the path. */
function show(s: WalkState) {
  const step = s.walk.steps[Math.min(s.i, s.walk.steps.length - 1)];
  island("walk", s.phase === "waiting" ? `${walkSay(s)}. ${ASSIST_WORDS.waitClick}` : walkSay(s));
  if (step.kind === "tab") openSettings(step.group, { home: narrowNow() });
  else if (step.kind === "section" || step.kind === "more") openSettings(step.group);
  else if (step.settingId) openSettings(step.group, { jump: step.settingId });
}
function run(effects: Effect[]) {
  for (const ef of effects) {
    if (ef === "apply") void apply();
    else if (ef === "end") finishWalk();
  }
}
/** Do it: the real setting changes, so its real control moves by itself; then the row glows. */
async function apply() {
  const p = st.plan;
  if (!p || p.kind !== "change" || !p.settingId || p.value === undefined) return;
  const sp = CHANGEABLE[p.settingId];
  const cur = settingsData(vaultStore.get());
  if (!sp) return;
  if (sp.read(cur) === p.value) { set({ note: ASSIST_WORDS.wasAlready, glow: p.settingId }); return; }
  try { await saveSettings(sp.patch(cur, p.value)); set({ glow: p.settingId }); }
  catch { st = { ...st, note: ASSIST_WORDS.notSaved }; }   // said once, at the end of the walk
}
function finishWalk() {
  window.clearInterval(tick);
  const p = st.plan, w = st.walk;
  const sid = w?.walk.settingId ?? p?.settingId;
  const failed = st.note === ASSIST_WORDS.notSaved;
  const changed = st.mode === "do" && p?.kind === "change";
  const say = failed ? ASSIST_WORDS.notSaved : changed ? (st.note === ASSIST_WORDS.wasAlready ? ASSIST_WORDS.wasAlready : ASSIST_WORDS.done1) : ASSIST_WORDS.shown;
  const next = sid ? nextOf(sid) : null;
  set({ phase: "result", walk: null, nextTime: next, plan: { kind: "none", say }, note: "", matches: [] });
  island("done", next ? `${say} ${nextTimeLine(next.path)}` : say);
  if (!failed) cue("happy");
}
function endWalk() {
  window.clearInterval(tick);
  if (st.phase === "walk") set({ phase: "idle", walk: null });
}
/** Esc (and the phone's Back): one step back. True when the assistant used the key: a walk ends first, then the answer clears. */
export function assistEsc(): boolean {
  if (st.phase === "walk" && st.walk) { window.clearInterval(tick); set({ ...FRESH, status: st.status }); if (islandShown) island("done", undefined, false); return true; }
  if (st.phase !== "idle") { cancel(); return true; }
  return false;
}
/** In Show me how, a click on the glowing control finishes the walk. */
export function controlClicked(target: Element | null): boolean {
  const w = st.walk;
  if (!w || w.phase !== "waiting" || !target) return false;
  const step = w.walk.steps[w.walk.steps.length - 1];
  if (!step.settingId || !target.closest(step.selector)) return false;
  const r = walkStep(w, "click");
  take(r.state, r.effects);
  return true;
}
/** A match or the closest thing, clicked: the same confirm step (a change when the words already said on, off or a number). */
export function pickMatch(id: string) {
  if (!settingById(id)) return;
  const r = simplePlan(st.text, ctxNow, undefined, id);
  set({ plan: r.plan, phase: "confirm", matches: [], note: "" });
  island("confirm", r.plan.say);
}

// ---------- feature requests ----------
const KEY = "ps.assist.requests";
const readBox = (): FrEntry[] => { try { return cleanEntries(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch { return []; } };
const writeBox = (l: FrEntry[]) => { try { localStorage.setItem(KEY, JSON.stringify(l.slice(-50))); } catch { /* private window */ } };
export const requestList = (): FrEntry[] => readBox();
const frTimers = new Map<string, number>();
/** True when a request was made (held for Undo, then sealed and sent). */
function featureRequest(plan: Plan, matches: Match[]): boolean {
  const closest = closestFor(plan, matches, ctxNow);
  const req = buildRequest(st.text, settingsWanted(), new Date(), globalThis.crypto.randomUUID());
  set({ plan: { ...plan, ...(closest ? { closest } : {}) } });
  if (!req) return false;
  const entry = hold(req, Date.now());
  writeBox([...readBox(), entry]);
  set({ request: entry });
  frTimers.set(req.id, window.setTimeout(() => void flush(req.id), UNDO_MS));
  return true;
}
async function flush(id: string) {
  frTimers.delete(id);
  const box = readBox(), e = box.find((x) => x.req.id === id);
  if (!e || !due(e, Date.now() + 1)) return;
  const rec = squadRecNow();
  let res: "sent" | "missing" | "nosquad" = "nosquad";
  if (rec) { try { res = await sendRequest(rec, e.req); } catch { res = "missing"; } }
  const now = readBox(), cur = now.find((x) => x.req.id === id);
  if (!cur) return;
  const next = afterSend(cur, res);
  writeBox(now.map((x) => (x.req.id === id ? next : x)));
  if (st.request?.req.id === id) set({ request: next });
  // Earlier ones that had to wait go out now too (no timer: only riding along with a real send, a few at a time).
  if (res === "sent" && rec) {
    for (const w of readBox().filter(retryable).slice(0, 5)) {
      let r2: "sent" | "missing" = "missing";
      try { r2 = await sendRequest(rec, w.req); } catch { break; }
      if (r2 !== "sent") break;
      writeBox(readBox().map((x) => (x.req.id === w.req.id ? { ...x, state: "sent" as const } : x)));
    }
  }
}
/** Undo, for a few seconds: a held request never leaves, a sent one is deleted at the hub. */
export async function undoRequest(id: string) {
  const box = readBox(), e = box.find((x) => x.req.id === id);
  if (!e || !canUndo(e)) return;
  window.clearTimeout(frTimers.get(id)); frTimers.delete(id);
  const was = e.state;
  const next = undo(e);
  writeBox(box.map((x) => (x.req.id === id ? next : x)));
  if (st.request?.req.id === id) set({ request: next });
  const rec = squadRecNow();
  if (was === "sent" && rec) { try { await deleteRequest(rec, id); } catch { /* it is gone on this device either way */ } }
}

// ---------- the AI choice, keys (Mac only) ----------
export const askStatus = () => { if (PS) psPost({ type: "assist:status" }); };
export const setProvider = (pick: AiPick, how?: "cli" | "key") => psPost({ type: "assist:provider", pick, ...(how ? { how } : {}) });
export const testProvider = (pick: AiPick) => psPost({ type: "assist:test", pick });
/** The key goes straight to the Mac's Keychain. This page never keeps it: the caller passes it in and clears its box at once. */
export const setKey = (pick: "claude" | "chatgpt", key: string) => { psPost({ type: "assist:key:set", pick, key }); };
export const removeKey = (pick: "claude" | "chatgpt") => psPost({ type: "assist:key:remove", pick });

// ---------- Settings opens or closes ----------
let opened = false;
/** Called when Settings opens (true) or closes (false) on this screen. */
export function settingsOpened(open: boolean) {
  if (open === opened) return;
  opened = open;
  if (open) {
    askStatus();
    if (PS && assistOn() && assistPrefs(settingsData(vaultStore.get()).assistant).pop) island("ask", ASSIST_WORDS.ask);
  } else {
    // A walk moves Settings itself, so only a real close ends things.
    if (st.phase !== "idle") cancel();
    else if (islandShown) island("done", undefined, false);
  }
}
/** Installs window.__psAssist (the Mac's way in) and returns how to take it out. */
export function installBridge(): () => void {
  const g = window as Window & { __psAssist?: (m: unknown) => void };
  const f = (m: unknown) => fromMac(m);
  g.__psAssist = f;
  return () => { if (g.__psAssist === f) delete g.__psAssist; };
}
/** The bot button in Settings: on a Mac with an island it brings the island card back, and the card's box takes the focus. */
export function botButton() {
  if (PS && islandHere()) island(st.phase === "idle" ? "ask" : st.phase === "confirm" ? "confirm" : "answer", st.phase === "idle" ? ASSIST_WORDS.ask : st.plan?.say ?? ASSIST_WORDS.ask);
  document.querySelector<HTMLInputElement>(".as-in")?.focus();
}
export const resetAssist = () => { window.clearInterval(tick); window.clearTimeout(askTimer); st = FRESH; islandShown = false; opened = false; subs.forEach((f) => f()); };
export { nextTimeLine };

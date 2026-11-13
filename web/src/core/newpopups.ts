// "New in this version" pop-ups (V1.56, the developer 13 Nov 2026): after a person closes What's new, three small pop-ups, one
// at a time, in this order:
//   1. api      the AI task API ("Turn on and copy for AI")                       Mac only
//   2. approve  PS can approve your AI permission prompts (Auto approve)           Mac only
//   3. source   PS is open source, ask your own AI to check it                     every platform, only once the repo is live
// Rules (all pure, no DOM, no vault, no clock: tests/newpopups.test.ts runs them; views/NewPopups.tsx draws them):
//  - each shows at most once per person (settings.popupsSeen, synced, merged across devices);
//  - each is skipped if the person already found the feature: the API switched on, any Auto approve switch on or its row
//    opened (Settings, Sentry mode), the open source link opened. A feature found by themselves counts as seen, silently;
//  - the wait between two pop-ups is one minute of PS being open (not wall clock time: it is saved and counted only
//    while PS runs); the first one comes at once, as soon as it is calm;
//  - "Show first use tips" Off (Settings, About and updates) silences them too;
//  - never two at once (a first use tip showing blocks them, and the tips wait for a pop-up), and never over a modal,
//    a meeting, Sleep mode, Sentry mode, Do Not Disturb, typing or What's new (the same blockers as the first use tips);
//  - they start after What's new has been closed on this device. A brand new install has no What's new, so it waits
//    until the first use tips have finished (never on top of them);
//  - the open source one never shows while OPEN_SOURCE_URL is null (core/opensource.ts).
// The words are in core/newpopupwords.ts.
import { TIP_ORDER, TIPS_NOT_ON_PHONE, isSeen as tipSeen, type Blocker, type TipsSeen } from "./tips.ts";

export type PopupId = "api" | "approve" | "source";
/** The order they come in. */
export const POPUP_ORDER: readonly PopupId[] = ["api", "approve", "source"];
/** The two that need the Mac app (the API and Auto approve run in PS on the Mac). */
export const POPUPS_MAC_ONLY: readonly PopupId[] = ["api", "approve"];

export const POPUPS = {
  /** One minute of PS being open between one pop-up and the next. */
  waitMs: 60_000,
  /** A pop-up counts as seen once it has been up this long (or any button or Esc was used). Taken away sooner (a meeting
   *  starts, a menu opens) it comes back another time. */
  seenAfterMs: 10_000,
  /** The wait clock never counts more than this per look (a sleeping Mac or a stopped page does not count as open time). */
  maxStepMs: 5_000,
  /** The wait never needs more than this saved. */
  capMs: 10 * 60_000,
} as const;

export const isPopupId = (v: unknown): v is PopupId => typeof v === "string" && (POPUP_ORDER as readonly string[]).includes(v);

// ---------- what is saved (synced) ----------
/** settings.popupsSeen: when each pop-up was shown or found (ISO). */
export interface PopupsSeen { at: Partial<Record<PopupId, string>> }
const ISO = /^\d{4}-\d\d-\d\dT[\d:.]+Z$/;
const okIso = (v: unknown): v is string => typeof v === "string" && v.length <= 32 && ISO.test(v) && Number.isFinite(Date.parse(v));

export function cleanPopupsSeen(v: unknown): PopupsSeen {
  const o = (v && typeof v === "object" ? v : {}) as { at?: unknown };
  const at: PopupsSeen["at"] = {};
  if (o.at && typeof o.at === "object") for (const id of POPUP_ORDER) { const t = (o.at as Record<string, unknown>)[id]; if (okIso(t)) at[id] = t; }
  return { at };
}
export const popupSeen = (s: PopupsSeen | null | undefined, id: PopupId): boolean => !!s?.at?.[id];
/** Mark one seen (the earlier time stays if it already was). */
export function markPopupSeen(cur: PopupsSeen | null | undefined, id: PopupId, now: number): PopupsSeen {
  const c = cleanPopupsSeen(cur);
  return { at: { ...c.at, [id]: c.at[id] ?? new Date(now).toISOString() } };
}
/** Two devices' copies: every pop-up seen on either counts, so a second device never repeats one. */
export function mergePopupsSeen(a: unknown, b: unknown): PopupsSeen {
  const x = cleanPopupsSeen(a), y = cleanPopupsSeen(b);
  const at: PopupsSeen["at"] = {};
  for (const id of POPUP_ORDER) { const c = [x.at[id], y.at[id]].filter((t): t is string => !!t).sort()[0]; if (c) at[id] = c; }
  return { at };
}

// ---------- the one minute (kept on this device, counts only while PS is open) ----------
/** `armed`: a pop-up has been shown on this device, so the next waits a minute. `ms`: open time counted since. */
export interface PopupWait { armed: boolean; ms: number }
export const NO_WAIT: PopupWait = { armed: false, ms: 0 };
export function cleanWait(v: unknown): PopupWait {
  const o = (v && typeof v === "object" ? v : {}) as { armed?: unknown; ms?: unknown };
  const ms = typeof o.ms === "number" && Number.isFinite(o.ms) ? Math.max(0, Math.min(POPUPS.capMs, Math.round(o.ms))) : 0;
  return { armed: o.armed === true, ms };
}
/** Open time that passed since the last look: never negative, never more than maxStepMs (sleep and stopped pages do not count). */
export const openStep = (lastMs: number, nowMs: number): number => (lastMs > 0 ? Math.max(0, Math.min(POPUPS.maxStepMs, nowMs - lastMs)) : 0);
/** Add open time. Only counts once a pop-up has been shown (before that there is nothing to wait for). */
export const addWait = (w: PopupWait, stepMs: number): PopupWait => (w.armed ? { armed: true, ms: Math.min(POPUPS.capMs, w.ms + Math.max(0, stepMs)) } : w);
/** A pop-up was shown: the next one waits a full minute from now. */
export const afterShown = (): PopupWait => ({ armed: true, ms: 0 });
/** Has the wait passed? The first pop-up on a device never waits. */
export const waitDone = (w: PopupWait): boolean => !w.armed || w.ms >= POPUPS.waitMs;

// ---------- when the pop-ups may start ----------
/** The first use tips are finished: every one seen, except the ones that cannot show here (the reminder tip when a reminder
 *  exists already, the Mac only tips on a phone). */
export function tipsFinished(seen: TipsSeen | null | undefined, o: { hasReminder: boolean; phone: boolean }): boolean {
  return TIP_ORDER.every((id) => tipSeen(seen, id) || (id === "remind" && o.hasReminder) || (o.phone && TIPS_NOT_ON_PHONE.includes(id)));
}
/** The pop-ups may start once What's new was closed on this device (an update), or, with no What's new (a brand new
 *  install), once the first use tips have finished. */
export const gateOpen = (whatsNewClosed: boolean, tipsDone: boolean): boolean => whatsNewClosed || tipsDone;

// ---------- which one now ----------
export interface PopupFacts {
  seen: PopupsSeen | null | undefined;
  /** The synced settings have arrived (never decide from the copy before the first download). */
  synced: boolean;
  owner: boolean;
  now: number;
  /** The first thing in the way (core/tips.ts blocker), or null. */
  block: Blocker | null;
  /** A first use tip is showing. */
  tipShowing: boolean;
  /** Settings, About and updates, "Show first use tips" is not Off (core/offswitches.ts): Off silences the pop-ups too. */
  enabled: boolean;
  gateOpen: boolean;
  wait: PopupWait;
  /** This is the Mac app (PS). The API and Auto approve exist only there. */
  mac: boolean;
  /** "unknown": PS has not told the page yet (an older PS app never does): that pop-up is skipped. */
  api: "unknown" | "on" | "off";
  approve: "unknown" | "on" | "off";
  /** The Auto approve row was opened in Settings. */
  approveRowOpened: boolean;
  /** The repo's address (core/opensource.ts), or null while it is not live. */
  sourceUrl: string | null;
  /** The open source link was opened already. */
  sourceOpened: boolean;
}

/** Has the person found this feature already (so its pop-up has nothing to teach)? */
export function found(f: PopupFacts, id: PopupId): boolean {
  if (id === "api") return f.api === "on";
  if (id === "approve") return f.approve === "on" || f.approveRowOpened;
  return f.sourceOpened;
}
/** Can this pop-up show on this device at all? (Mac only ones need the Mac and PS's answer; the open source one needs a live link.) */
export function applies(f: PopupFacts, id: PopupId): boolean {
  if (id === "api") return f.mac && f.api !== "unknown";
  if (id === "approve") return f.mac && f.approve !== "unknown";
  return !!f.sourceUrl;
}
/** Pop-ups to mark seen silently right now: found by the person themselves (and not already seen). */
export function foundNow(f: PopupFacts): PopupId[] {
  return POPUP_ORDER.filter((id) => !popupSeen(f.seen, id) && applies(f, id) && found(f, id));
}

/** The pop-up to show now, or null. Only the next one in the order is ever considered, so they never skip ahead of a
 *  pop-up that is only waiting for a calm moment. */
export function nextPopup(f: PopupFacts): PopupId | null {
  if (!f.synced || !f.owner || !f.enabled || f.block || f.tipShowing || !f.gateOpen) return null;
  if (!waitDone(f.wait)) return null;
  for (const id of POPUP_ORDER) {
    if (popupSeen(f.seen, id) || !applies(f, id) || found(f, id)) continue;
    return id;
  }
  return null;
}

// ---------- the card's place ----------
/** The words with the app's name in. */
export const fill = (s: string, app: string): string => s.replace(/\{app\}/g, app);

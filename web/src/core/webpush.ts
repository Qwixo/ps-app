// Reminders on the iPhone web app while it is closed (1.60, Web Push, iOS 16.4 and later). Pure: no browser, no network.
// tests/webpush.test.ts checks it. The browser side is src/remweb.ts, the sender is supabase/functions/rem-push.
//
// What goes to the server: the phone's push address and keys, and for each reminder only its ID and the moments it should
// buzz. The reminder's words stay in the vault; the phone keeps a small copy of them (words only) for the notification.
import { openWindow, remNextRing, remRingTimes, remStatus, type PlanItem, type Reminder, type RemState } from "./remind.ts";

export const PUSH_HORIZON_MS = 36 * 3_600_000;
export const PUSH_MAX = 200;
export const PUSH_PER_REMINDER = 12;

/** The words of the button and its states (every on screen word of this feature is here). */
export const PUSH_WORDS = {
  button: "Allow reminders on this iPhone",
  on: "Reminders are on for this iPhone",
  turnOff: "Turn off",
  needHome: "On an iPhone, reminders reach you when PS is added to your Home Screen. Tap Share, then Add to Home Screen, then open PS from there.",
  old: "Reminders on the iPhone need iOS 16.4 or newer.",
  blocked: "This iPhone said no to notifications. Switch them on for PS in Settings, Notifications.",
  noServer: "Your project is not set up to send reminders yet. Reminders still show while PS is open.",
  failed: "Could not switch reminders on. Try again.",
  help: "PS sends a quiet nudge at each reminder time while it is closed. It stores only which reminder and when, never its words.",
  titleFallback: "Reminder",
} as const;

export type PushState = "feature-off" | "unsupported" | "old-ios" | "needs-home-screen" | "ask" | "blocked" | "on";
export interface PushEnv { feature: boolean; hasApi: boolean; ua: string; standalone: boolean; permission: "default" | "granted" | "denied" | "none"; subscribed: boolean }

/** iOS 16.4 or newer (or not an iPhone at all: then true). */
export function iosOk(ua: string): boolean {
  if (!/iPhone|iPad|iPod/i.test(ua)) return true;
  const m = /OS (\d+)[_.](\d+)/.exec(ua);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a > 16 || (a === 16 && b >= 4);
}
export const isIphone = (ua: string) => /iPhone|iPad|iPod/i.test(ua);

/** What the Settings button should do now. The permission can only be asked from a tap, so "ask" is a button. */
export function pushState(e: PushEnv): PushState {
  if (!e.feature) return "feature-off";
  if (isIphone(e.ua) && !iosOk(e.ua)) return "old-ios";
  if (isIphone(e.ua) && !e.standalone) return "needs-home-screen";
  if (!e.hasApi) return "unsupported";
  if (e.permission === "denied") return "blocked";
  if (e.permission === "granted" && e.subscribed) return "on";
  return "ask";
}

export interface PushTime { id: string; at: number }
/** The schedule to hand the server: every reminder's ring moments from `now`, soonest first, at most PUSH_MAX. Alarms are the
 *  gym ring's business (phone only) and are left out; so is anything off, done or past. */
export function pushTimes(items: PlanItem[], now: number, deviceTz: string): PushTime[] {
  const all: PushTime[] = [];
  for (const i of items) {
    if (!/^[a-z0-9]{1,16}$/.test(i.id)) continue;
    const st: RemState | undefined = i.done || i.snoozeUntil ? { done: i.done || undefined, snoozeUntil: i.snoozeUntil || undefined, at: i.stateAt } : undefined;
    const r = { on: i.on, at: i.at, until: i.until, tz: i.tz, days: i.days, snooze: i.snooze, date: i.date || undefined };
    for (const at of remRingTimes(r, st, now, PUSH_HORIZON_MS, deviceTz, PUSH_PER_REMINDER)) all.push({ id: i.id, at });
  }
  return all.sort((a, b) => a.at - b.at).slice(0, PUSH_MAX);
}
/** Same schedule, so nothing is sent to the server again (a few hundred bytes, but only when it changed). */
export const sameTimes = (a: PushTime[], b: PushTime[]) => JSON.stringify(a) === JSON.stringify(b);

/** The words the notification shows (kept on the phone only): the reminder's pill and question, a tidy one line each. */
export interface PushWord { pill: string; text: string }
export function wordsOf(items: Pick<PlanItem, "id" | "pill" | "text">[]): Record<string, PushWord> {
  const o: Record<string, PushWord> = {};
  for (const i of items.slice(0, 80)) if (/^[a-z0-9]{1,16}$/.test(i.id)) o[i.id] = { pill: i.pill.slice(0, 60), text: i.text.slice(0, 120) };
  return o;
}
/** A push body from the sender: only the kind, the reminder id and the time. Anything else is ignored. */
export function parsePush(raw: string | null | undefined): { id: string; at: number } | null {
  try {
    const o = JSON.parse(raw || "");
    return o && o.t === "rem" && typeof o.id === "string" && /^[a-z0-9]{1,16}$/.test(o.id) ? { id: o.id, at: typeof o.at === "number" ? o.at : 0 } : null;
  } catch { return null; }
}
/** What the browser's PushSubscription JSON holds, checked: the three strings the server keeps. */
export function cleanSub(j: unknown): { endpoint: string; p256dh: string; auth: string } | null {
  const o = (j && typeof j === "object" ? j : {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const k = o.keys || {};
  if (typeof o.endpoint !== "string" || !o.endpoint.startsWith("https://") || o.endpoint.length > 1000) return null;
  if (typeof k.p256dh !== "string" || typeof k.auth !== "string" || !k.p256dh || !k.auth || k.p256dh.length > 200 || k.auth.length > 100) return null;   // gitleaks:allow (length checks, not a key)
  return { endpoint: o.endpoint, p256dh: k.p256dh, auth: k.auth };
}
/** The public key as the bytes subscribe() wants. */
export function keyBytes(b64url: string): Uint8Array {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const s = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const stateOf = (i: PlanItem): RemState | undefined => (i.done || i.snoozeUntil ? { done: i.done || undefined, snoozeUntil: i.snoozeUntil || undefined, at: i.stateAt } : undefined);
/** Which reminder should be on screen now: the first that is due to ring, none while one is already up. `lastRang`: when each
 *  last rang on this page (so it comes back every snooze length until answered). */
export function dueCard(list: PlanItem[], now: number, tz: string, lastRang: Map<string, number>, open: PlanItem | null): PlanItem | null {
  if (open) return null;
  for (const i of list) {
    const r = i as unknown as Reminder;
    const t = remNextRing(r, stateOf(i), now, tz, lastRang.get(i.id) ?? 0);
    if (t > 0 && t <= now && remStatus(r, stateOf(i), now, tz) === "show") return i;
  }
  return null;
}

/** Done on any device: the arguments for push_clear. Pushes waiting for that reminder up to the end of the window it is in
 *  are dropped; the next day's stay (never "the next 24 hours", which would eat tomorrow's daily ring). */
export function pushClearArgs(r: Reminder | null, now: number, deviceTz: string): { p_rem_id: string; p_until: number } {
  if (!r) return { p_rem_id: "", p_until: now };
  const w = openWindow(r, now, deviceTz);
  return { p_rem_id: r.id, p_until: Math.max(now, w ? w.end : now) };
}

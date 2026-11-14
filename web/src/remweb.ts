// The Annoying 15 min reminders on the iPhone web app (cincee.com/todolist-mobile added to the Home Screen), 1.60.
//  - While the app is open: a full screen card (views in src/mobile/RemCard.tsx) when a reminder rings, with the same words
//    and buttons as the Mac card. Done or the reminder's own snooze is saved like every other device's (remwatch remAnswer),
//    so one Done clears it everywhere.
//  - While it is closed: Web Push (iOS 16.4 and later), at each ring moment. The person taps "Allow reminders on this iPhone"
//    once (iOS only asks after a tap). The server keeps the reminder id and the time, never its words (core/webpush.ts);
//    the words for the notification come from a small copy kept on this phone (IndexedDB) and are shown by the service worker.
// Not tried against a real push service or a real iPhone: tests/webpush.test.ts and tests/remweb.test.ts use fakes.
import { useSyncExternalStore } from "react";
import { remAnswer } from "./remwatch";
import { sb, vaultStore } from "./core/vault";
import { feature } from "./core/features";
import { DEVICE_TZ } from "./core/tz";
import { doneAct, remStatus, snoozeAct, type PlanItem, type Reminder, type RemState } from "./core/remind";
import { cleanSub, dueCard, keyBytes, pushState, pushTimes, sameTimes, wordsOf, PUSH_WORDS, type PushState, type PushTime } from "./core/webpush";

export const FEATURE = "remind-push";
let items: PlanItem[] = [];
let card: PlanItem | null = null;
const last = new Map<string, number>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let timer = 0, lastSent: PushTime[] = [], pushNow: PushState = "ask", started = false;

const asReminder = (i: PlanItem) => i as unknown as Reminder;
const stateOf = (i: PlanItem): RemState | undefined => (i.done || i.snoozeUntil ? { done: i.done || undefined, snoozeUntil: i.snoozeUntil || undefined, at: i.stateAt } : undefined);

function look() {
  const now = Date.now();
  if (card) {   // answered on another device (a new plan): it goes
    const still = items.find((i) => i.id === card!.id);
    if (!still || remStatus(asReminder(still), stateOf(still), now, DEVICE_TZ) !== "show") { card = null; emit(); }
    return;
  }
  const d = dueCard(items, now, DEVICE_TZ, last, card);
  if (d && document.visibilityState !== "hidden") { card = d; last.set(d.id, now); emit(); }
}
/** The plan from remwatch (every reminder with its words worked out). */
export function webRemPlan(plan: { items?: PlanItem[] }) {
  items = plan.items ?? [];
  if (!started) { started = true; timer = window.setInterval(look, 10_000); document.addEventListener("visibilitychange", look); }
  look();
  void keepWords();
  void syncSchedule();
}
export function remCardNow() { return card; }
export function useRemCard(): PlanItem | null { return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, remCardNow, remCardNow); }
export function closeCard() { card = null; emit(); }   // Esc or Back: away until it rings again in its own time
export function answerCard(act: "done" | "snooze") {
  const c = card; if (!c) return;
  const now = Date.now(), r = asReminder(c);
  remAnswer(act === "done" ? doneAct(r, now, DEVICE_TZ, "web") : snoozeAct(r, now, "web"));
  card = null; emit();
  // pushes still waiting for a Done reminder are cleared by remAnswer (remwatch.ts), from every device
}

// ---------- the small copy of the words for the notification (this phone only) ----------
function idb(): Promise<IDBDatabase> {
  return new Promise((ok, no) => { const q = indexedDB.open("psm-rem", 1); q.onupgradeneeded = () => q.result.createObjectStore("kv"); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
}
async function keepWords() {
  try { const d = await idb(); d.transaction("kv", "readwrite").objectStore("kv").put(wordsOf(items), "words"); d.close(); } catch { /* storage off: the notification then says "Reminder" */ }
}

// ---------- Web Push ----------
const env = () => ({
  feature: feature(FEATURE), hasApi: "serviceWorker" in navigator && "PushManager" in window && "Notification" in window, ua: navigator.userAgent,
  standalone: (navigator as { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches,
  permission: ("Notification" in window ? Notification.permission : "none") as "default" | "granted" | "denied" | "none", subscribed: pushNow === "on",
});
async function current(): Promise<PushSubscription | null> {
  try { const reg = await navigator.serviceWorker.getRegistration(); return (await reg?.pushManager.getSubscription()) ?? null; } catch { return null; }
}
/** What the Settings button shows now. */
export async function pushStatus(): Promise<PushState> {
  const e = env();
  const sub = e.hasApi ? await current() : null;
  pushNow = pushState({ ...e, subscribed: !!sub });
  return pushNow;
}
/** The tap on "Allow reminders on this iPhone": asks iOS, subscribes, tells the server. Returns the state and a words key. */
export async function enablePush(): Promise<{ state: PushState; note?: string }> {
  const st = await pushStatus();
  if (st !== "ask") return { state: st };
  try {
    const perm = await Notification.requestPermission();   // only works from a tap
    if (perm !== "granted") return { state: await pushStatus() };
    const { data: key } = await sb.rpc("push_vapid");
    if (typeof key !== "string" || !key) return { state: "ask", note: PUSH_WORDS.noServer };
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource }));
    const c = cleanSub(sub.toJSON());
    if (!c) return { state: "ask", note: PUSH_WORDS.failed };
    const { error } = await sb.rpc("push_register", { p_endpoint: c.endpoint, p_p256dh: c.p256dh, p_auth: c.auth });
    if (error) return { state: "ask", note: PUSH_WORDS.failed };
    lastSent = [];
    await keepWords(); await syncSchedule(true);
    return { state: await pushStatus() };
  } catch { return { state: "ask", note: PUSH_WORDS.failed }; }
}
export async function disablePush(): Promise<PushState> {
  try { const s = await current(); if (s) { await sb.rpc("push_unregister", { p_endpoint: s.endpoint }); await s.unsubscribe(); } } catch { /* nothing to undo */ }
  lastSent = [];
  return pushStatus();
}
/** The ring moments to the server, only when they changed and only while this phone is subscribed. */
async function syncSchedule(force = false) {
  if (vaultStore.get().status !== "unlocked" || !feature(FEATURE)) return;
  const s = await current(); if (!s) return;
  const times = pushTimes(items, Date.now(), DEVICE_TZ);
  if (!force && sameTimes(times, lastSent)) return;
  const { error } = await sb.rpc("push_set_schedule", { p_endpoint: s.endpoint, p_times: times });
  if (!error) lastSent = times;
}

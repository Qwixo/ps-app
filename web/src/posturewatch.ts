// The Posture reminder at work (PS 1.65, rules in core/posture.ts). Runs in the page that holds the vault.
//  - On a Mac (PS main page): tells the Mac to show its own card ({type:"posture:show"}), and the Mac tells back how long
//    the keyboard and mouse have been still and whether Sleep mode or Sentry mode covers the screen ({type:"postureEnv"}),
//    and when the card was answered ({type:"postureAct"}). The Mac only reads the time since the last input, never keys.
//  - On the website: the page draws the pop-up itself (views/PosturePopup.tsx) and works out "away" from its own clicks,
//    key presses and mouse moves (only WHEN, never which key) and from the tab being hidden.
//  - Not on the phone. Nothing here polls while PS is closed, nothing is saved (a slot already dealt with is kept in
//    memory only) and nothing is sent anywhere.
import { vaultStore } from "./core/vault";
import { settingsData } from "./core/select";
import { feature } from "./core/features";
import { posturePrefs, postureStep, POSTURE_WORDS, AWAY_MS, latestSlot, type PostureEnv } from "./core/posture";
import { FIGURE_SVG, FIGURE_CSS } from "./core/posturefigure";
import { meetingEvents } from "./core/calpick";
import { visibleEvents } from "./core/meethide";
import { isMeeting } from "./core/notescard";
import type { CalendarSnap } from "./core/model";

export const POSTURE_FEATURE = "posture-reminder";
type Post = (m: object) => void;
const MAC = import.meta.env.MODE === "ps";
const PHONE = import.meta.env.MODE === "gos";
const TICK_MS = 15_000;
/** The Mac's last word on idle time and cover is trusted this long. After that the person counts as away (never a pop-up on a guess). */
const ENV_FRESH_MS = 45_000;

let post: Post = () => {};
let started = false;
let handled = 0;
let lastTick = 0;
let shown = false;
let testing = false;
let macEnv: { at: number; idleMs: number; covered: boolean } | null = null;
let lastInput = Date.now();
let macOn: boolean | null = null;
let primed = false;
/** Sleep mode or Sentry mode on this page. Loaded after start (a plain import would make a loop with ps.ts). */
let pageCovered: () => boolean = () => false;

// ---------- what the website draws ----------
export interface PostureView { open: boolean; test: boolean; key: number }
let view: PostureView = { open: false, test: false, key: 0 };
const listeners = new Set<() => void>();
export const postureView = () => view;
export const subscribePosture = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
function setView(next: PostureView) { view = next; listeners.forEach((f) => f()); }

function inMeeting(now: number): boolean {
  const s = vaultStore.get();
  if (s.status !== "unlocked") return false;
  const st = settingsData(s);
  const docs = [...s.docs.values()].filter((d) => d.kind === "calendar").sort((a, b) => ((b.data as CalendarSnap).at || "").localeCompare((a.data as CalendarSnap).at || ""));
  const cal = docs[0];
  if (!cal) return false;
  const evs = meetingEvents(visibleEvents((cal.data as CalendarSnap).events, st.meetHidden), st.calChoices);
  return evs.some((e) => isMeeting(e) && Date.parse(e.start!) <= now && Date.parse(e.end!) > now);
}

function envNow(now: number): PostureEnv {
  let idleMs: number, covered: boolean;
  if (MAC) {
    const fresh = macEnv && now - macEnv.at <= ENV_FRESH_MS;
    idleMs = fresh ? macEnv!.idleMs : AWAY_MS;
    covered = !!macEnv?.covered || pageCovered();
  } else {
    idleMs = document.hidden ? Math.max(AWAY_MS, now - lastInput) : Math.max(0, now - lastInput);
    covered = pageCovered();
  }
  return { now, idleMs, meeting: inMeeting(now), covered, shown, lastTick };
}

function open(test: boolean) {
  shown = true; testing = test;
  if (MAC) post({ type: "posture:show", svg: FIGURE_SVG, css: FIGURE_CSS, pill: POSTURE_WORDS.pill, title: POSTURE_WORDS.title, button: POSTURE_WORDS.button, test });
  else setView({ open: true, test, key: view.key + 1 });
}
function close() {
  if (!shown) return;
  shown = false; testing = false;
  if (MAC) post({ type: "posture:hide" });
  else setView({ open: false, test: false, key: view.key });
}

function enabled(): boolean {
  const s = vaultStore.get();
  return s.status === "unlocked" && feature(POSTURE_FEATURE) && posturePrefs(settingsData(s).posture).on;
}

function tick() {
  const now = Date.now();
  const s = vaultStore.get();
  const prefs = posturePrefs(s.status === "unlocked" ? settingsData(s).posture : undefined);
  const on = enabled();
  // The Mac runs its sensor only while the reminder is on (nothing reads the idle time otherwise).
  if (MAC && macOn !== on) { macOn = on; post({ type: "posture:plan", on }); }
  if (!on) { if (shown && !testing) close(); lastTick = now; return; }
  // A first look after the page opened: today's slot that is already running is never shown late on launch.
  if (!primed) { primed = true; const l = latestSlot(prefs, now); if (l) handled = l; }
  const out = postureStep(prefs, handled, envNow(now));
  handled = out.handled;
  lastTick = now;
  if (out.show) open(false);
}

/** The Mac's card was answered: "done" is the button, "esc" is Esc. Either way it is over until the next slot. */
export function postureShellMessage(m: { type?: unknown }): boolean {
  const o = m as Record<string, unknown>;
  if (o.type === "postureEnv") {
    const idle = typeof o.idle === "number" && o.idle >= 0 && o.idle < 1e7 ? o.idle * 1000 : AWAY_MS;
    macEnv = { at: Date.now(), idleMs: idle, covered: o.covered === true };
    return true;
  }
  if (o.type === "postureAct") { shown = false; testing = false; return true; }
  return false;
}

/** The website's pop-up was answered (button or Esc). */
export function postureClose() { close(); }

/** Settings, Try it now: the pop-up right now, whatever the hours say. Nothing saved. */
export function postureTest() {
  if (PHONE || !feature(POSTURE_FEATURE)) return;
  if (shown) close();
  open(true);
}

export function startPostureWatch(p: Post) {
  if (started || PHONE) return;
  started = true; post = p;
  void Promise.all([import("./sleepmode/engine"), import("./views/Sentry")]).then(([a, b]) => { pageCovered = () => a.sleepState().here || b.sentryUp(); }).catch(() => {});
  if (!MAC) {
    const seen = () => { lastInput = Date.now(); };
    for (const ev of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) window.addEventListener(ev, seen, { passive: true, capture: true });
    document.addEventListener("visibilitychange", seen);
  }
  window.setInterval(tick, TICK_MS);
  vaultStore.subscribe(() => { if (!primed) tick(); });
  tick();
}

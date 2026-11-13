// The gym reminder at work (core/gym.ts has the rules). Runs in the page that holds the vault.
//   Mac PS: ONE card ({type:"cardShow"}, id "gym") at 2 h, 1 h, 30 min and 10 min before; each step replaces
//           the words and chimes once. Acknowledge saves the day in the vault (settings.gymAck), so the phone
//           stops ringing and the day stays quiet; Later puts the card away for 5 minutes, then it comes back
//           with its chime (a new step brings it back at once). Quiet under PS Do Not Disturb. The steps
//           this Mac really showed are kept in localStorage (ids like "2026-11-03:60", no words), so after a
//           restart the card comes back quietly, and a step slept through is never shown late.
//   Phone:  the plan ({type:"gymPlan"}: times only) for the shell, which notifies and rings by itself while
//           PS sleeps (ps-gos Gym.kt): 10 minutes a ring, Later rings again in 5, through DND (an alarm).
//           The shell's Acknowledge comes back as {type:"gymAck", day}.
import { vaultStore } from "./core/vault";
import { settingsData } from "./core/select";
import { saveSettings } from "./core/actions";
import { ackGym, gymCard, gymCardText, gymDue, gymLater, gymNextWake, gymPlan, gymPrefs, gymQuiet, gymSnoozed, pruneFired, type GymSnooze } from "./core/gym";
import { homeTz, setHomeTz } from "./core/tz";
import { dndMutes } from "./core/dnd";

type Post = (m: object) => void;
const PHONE = import.meta.env.MODE === "gos";
const FIRED = "ps.gymFired", SNOOZE = "ps.gymSnooze";
let post: Post = () => {};
let shown = "";            // the card on screen now (its JSON), this run of the page
let shownDay = "";
let lastPlan = "";
let timer = 0;
let waiting: string[] = [];   // acknowledgements that came while the vault was still locked
const words = new Map<string, { title: string; sub: string }>();   // the card's words per step, fixed when first shown

const load = (k: string): string[] => { try { const v = JSON.parse(localStorage.getItem(k) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };
const keep = (k: string, v: string[]) => { try { localStorage.setItem(k, JSON.stringify(v.slice(-40))); } catch { /* storage off */ } };
const loadSnooze = (): GymSnooze | null => { try { const v = JSON.parse(localStorage.getItem(SNOOZE) || "null"); return v && typeof v.day === "string" && typeof v.until === "number" ? v : null; } catch { return null; } };
const keepSnooze = (v: GymSnooze | null) => { try { if (v) localStorage.setItem(SNOOZE, JSON.stringify(v)); else localStorage.removeItem(SNOOZE); } catch { /* storage off */ } };
// Every owner's since 7 Nov 2026 (its settings were always shown in Fitness); off until switched on for anyone but the developer.
const unlocked = () => { const s = vaultStore.get(); return s.status === "unlocked" && s.role === "owner"; };
const prefsOf = (st: { gym?: unknown }) => gymPrefs(st.gym, !!vaultStore.get().red);

/** Acknowledge that day's gym: on every device (the vault), from the Mac card or the phone. */
export function ackGymDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
  if (!unlocked()) { if (!waiting.includes(day)) waiting.push(day); return; }
  const st = settingsData(vaultStore.get());
  if ((st.gymAck || []).includes(day)) return;
  void saveSettings({ gymAck: ackGym(st.gymAck, day, Date.now(), homeTz()) });
}

function hide() { if (shown) { post({ type: "cardHide", id: "gym" }); shown = ""; shownDay = ""; } }

function run() {
  clearTimeout(timer);
  const s = vaultStore.get();
  if (!unlocked()) { if (!PHONE) hide(); return; }
  if (waiting.length) { const w = waiting; waiting = []; w.forEach(ackGymDay); }
  const st = settingsData(s);
  setHomeTz(st.tmHomeTz);
  const tz = homeTz(), now = Date.now(), p = prefsOf(st), acked = st.gymAck || [];
  if (PHONE) {
    const plan = gymPlan(p, now, tz, acked);
    const json = JSON.stringify(plan);
    if (json !== lastPlan) { lastPlan = json; post({ type: "gymPlan", plan }); }
    timer = window.setTimeout(run, 30 * 60_000);   // the plan rolls on (8 days ahead), even with nothing changing
    return;
  }
  let fired = load(FIRED);
  const due = gymDue(p, now, tz, acked, fired);
  let chime = false, snooze = loadSnooze();
  if (due) { fired = pruneFired([...fired, due.id], now, tz); keep(FIRED, fired); chime = true; }
  const card = gymCard(p, now, tz, acked, fired);
  const step = card ? `${card.day}:${card.mins}` : "";
  // Later is over (or a new step came): the card is back, chiming once.
  if (snooze && (due || !card || !gymSnoozed(snooze, card.day, now))) { if (card && snooze.day === card.day) chime = true; snooze = null; keepSnooze(null); }
  if (!card || gymSnoozed(snooze, card.day, now) || gymQuiet("card", st.dnd, now)) hide();
  else {
    if (!words.has(step)) words.set(step, gymCardText(card, now, tz, p.time));
    const w = words.get(step)!;
    const c = { id: "gym", sticky: true, title: w.title, sub: w.sub, body: "Acknowledge here or on your phone stops the 16 minute ring. Later: back in 5 minutes.",
      actions: [{ id: "ack", label: "Acknowledge" }, { id: "later", label: "Later" }] };
    const json = JSON.stringify(c);
    if (json !== shown || chime) {
      shown = json; shownDay = card.day;
      post({ type: "cardShow", card: c });
      if (chime && !st.tmMuted && !dndMutes(st.dnd, "sounds", now, "mac")) post({ type: "sfx", name: "meet-soon", vol: Math.max(0.5, (st.tmSound ?? 40) / 100) });
    }
  }
  const next = gymNextWake(p, now, tz, acked, fired, snooze);
  // At most a minute between looks: a Mac that slept wakes into a fresh check, never a pile of old timers.
  timer = window.setTimeout(run, next ? Math.max(500, Math.min(next - now + 250, 60_000)) : 60_000);
}

/** The card's buttons (Mac): Acknowledge, Later. */
export function gymCardMessage(m: { type?: string; id?: string; action?: string }) {
  if (m.type !== "cardAction" || m.id !== "gym") return false;
  const day = shownDay;
  if (m.action === "ack" && day) { ackGymDay(day); hide(); }
  else if (m.action === "later") {
    const s = vaultStore.get(), st = settingsData(s), tz = homeTz();
    const c = gymCard(prefsOf(st), Date.now(), tz, st.gymAck || [], load(FIRED));
    if (c) keepSnooze(gymLater(c.day, Date.now()));
    hide();
    run();   // arms the look for when Later is over
  }
  return true;
}
/** The phone shell: Acknowledge on the ring or a notification. */
export function gymShellMessage(m: { type?: unknown; day?: unknown }) {
  if (m.type !== "gymAck" || typeof m.day !== "string") return false;
  ackGymDay(m.day);
  return true;
}

let started = false;
export function startGymWatch(p: Post) {
  if (started) return;
  started = true;
  post = p;
  let t = 0;
  vaultStore.subscribe(() => { clearTimeout(t); t = window.setTimeout(run, 400); });
  if (!PHONE) window.addEventListener("focus", () => run());
  run();
}
/** Woken (the Mac's "wake", a phone background check): look now. */
export function gymWake() { if (started) run(); }

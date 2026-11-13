// Pomodoro, the page's half (V1.58; the rules are core/pomodoro.ts). The page that holds the vault runs the buttons
// (PS: the main window, sent from the Tab list as a "looks" patch { pomoOp }; the website: its own page) and saves the
// run each time a phase ends, so the saved run always matches what showed (a restart reads it back as it was).
import { vaultStore } from "./core/vault";
import { settingsData } from "./core/select";
import { saveSettings } from "./core/actions";
import { applyOp, cleanRun, pomoPrefs, resolve, type PomoOp, type PomoRun } from "./core/pomodoro";

const same = (a: PomoRun | null, b: PomoRun | null) => JSON.stringify(a) === JSON.stringify(b);
const canWrite = () => { const s = vaultStore.get(); return s.status === "unlocked" && s.role === "owner"; };

/** A Pomodoro button, on the newest settings and the time now. */
export async function runPomoOp(op: PomoOp): Promise<void> {
  if (!canWrite()) return;
  const st = settingsData(vaultStore.get());
  const prefs = pomoPrefs(st.pomodoro);
  if (!prefs.on && op !== "stop") return;
  const was = cleanRun(st.pomoRun);
  const next = applyOp(was, op, prefs, Date.now());
  if (!same(was, next) || (st.pomoRun ?? null) !== null && next === null) await saveSettings({ pomoRun: next });
}

/** Saves the run when a phase ends (and after a sleep, a restart or a settings change), so the next phase is on record.
 *  One timer, to the next end; the minute check and waking up catch anything a sleeping timer missed. */
let started = false;
let timer = 0;
let busy = false;
export function startPomodoro(onChange?: () => void) {
  if (started) return;
  started = true;
  const check = async () => {
    window.clearTimeout(timer);
    if (!canWrite() || busy) return;
    const st = settingsData(vaultStore.get());
    const prefs = pomoPrefs(st.pomodoro);
    const was = cleanRun(st.pomoRun);
    const now = Date.now();
    const next = prefs.on ? resolve(was, prefs, now) : null;
    if (!same(was, next)) {
      busy = true;
      try { await saveSettings({ pomoRun: next }); } catch { /* the next check tries again */ } finally { busy = false; }
      onChange?.();
    }
    if (next && next.left === null) timer = window.setTimeout(() => void check(), Math.max(200, next.endsAt - Date.now() + 120));
  };
  let t = 0;
  vaultStore.subscribe(() => { window.clearTimeout(t); t = window.setTimeout(() => void check(), 250); });
  window.setInterval(() => void check(), 30_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void check(); });
  window.addEventListener("focus", () => void check());
  window.addEventListener("online", () => void check());
  void check();
}

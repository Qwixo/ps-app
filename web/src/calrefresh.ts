// The Meetings panel's refresh (the developer, 2 Nov 2026; made live 4 Nov 2026). The server reads Google Calendar every
// minute (calendar-inbox cron) and stores a new sealed copy only when an event changed; the vault's Realtime inbox
// INSERT and vault_probe bring that copy here, so new, moved and cancelled meetings land within about a minute.
// This page also asks: when the refresh icon is pressed (always, straight to Google), every 2 minutes while PS
// runs (Mac) or is on screen (phone), when the Tab list opens or the Mac wakes on data over a minute old, and
// right after unlocking. Every answer goes into calStatus (src/core/calstatus.ts): "Updated X ago", "Google not
// linked", the spin. A read that finds nothing new moves a few hundred bytes. Never on the main thread's way:
// all of it is async fetches in the web page.
import { linkCalendar, refreshCalendar, vaultStore } from "./core/vault";
import { calStatus, calStatusFrom } from "./core/calstatus";
import { appName } from "./core/appname";
import { settingsData } from "./core/select";
import { calMayAsk, calMode } from "./core/localcal";

export const CAL_REFRESH = { every: 2 * 60_000, staleOnOpen: 60_000, minGap: 15_000, pressGap: 3_000 } as const;
let askedAt = 0;
let inFlight: Promise<unknown> | null = null;

// Never from the fictional dev page (/dev): only the developer's real, unlocked vault asks the server.
const allowed = () => { const s = vaultStore.get(); return s.status === "unlocked" && s.role === "owner" && !!s.red && s.userId !== "dev"; };

// Everyone else (the public PS, 7 Nov 2026): the meetings come from the Calendar app on their Mac (ps-mac
// LocalCalendar.swift through ps.ts), never from the developer's server. Only PS on a Mac sets a reader; the website and the
// phone show the copy the Mac keeps in the vault. `ask`: macOS may ask for Calendar access (once per Mac), only
// when the panel is about to show (Tab held) or the refresh icon was pressed.
let localReader: ((ask: boolean) => void) | null = null;
export function setLocalCalReader(f: (ask: boolean) => void) { localReader = f; }
const localAllowed = () => { const s = vaultStore.get(); return !!localReader && s.status === "unlocked" && s.role === "owner" && !s.red && s.userId !== "dev" && localMode() !== "off"; };
/** This account's Calendar switch (core/localcal.ts calMode): off never reads, only a click while on may ask macOS. */
const localMode = () => { const s = vaultStore.get(); return calMode(s.status === "unlocked" ? settingsData(s).macCalendar : undefined); };

/** Read the calendar now. `pressed` (the refresh icon): straight to Google unless a read started in the last
 *  3 seconds; otherwise at most every 15 seconds. One read at a time; a press during one waits for it. */
export function calRefreshNow(pressed = false, ask = pressed): Promise<unknown> {
  if (localAllowed()) {
    if (!pressed && Date.now() - askedAt < CAL_REFRESH.minGap) return Promise.resolve();
    askedAt = Date.now();
    if (pressed) calStatus.set({ busy: true });   // the Mac's answer (ps.ts "localCal") stops the spin
    localReader!(calMayAsk(localMode(), ask));
    return Promise.resolve();
  }
  if (inFlight) { if (pressed) calStatus.set({ busy: true }); return inFlight; }
  if (!allowed()) { if (pressed) calStatus.set({ doneAt: Date.now() }); return Promise.resolve(); }
  if (Date.now() - askedAt < (pressed ? CAL_REFRESH.pressGap : CAL_REFRESH.minGap)) {
    if (pressed) calStatus.set({ doneAt: Date.now() });   // read seconds ago: the icon can stop
    return Promise.resolve();
  }
  askedAt = Date.now();
  // Only a press spins the icon (a background read would resend the Tab list's state twice for nothing).
  if (pressed) calStatus.set({ busy: true });
  inFlight = refreshCalendar()
    .then((r) => calStatus.set(calStatusFrom(r, Date.now())))
    .catch(() => calStatus.set(calStatusFrom({ error: "network" }, Date.now())))
    .finally(() => { inFlight = null; });
  return inFlight;
}
/** Read it only when this device has not for `age` ms (the list opening, a wake: a minute). */
export function calRefreshIfStale(age: number = CAL_REFRESH.staleOnOpen, ask = false) {
  if (Date.now() - askedAt >= age) void calRefreshNow(false, ask);
}

/** The developer pasted his calendar's secret iCal address (the Meetings panel's "Link Google"). */
export async function calLinkNow(url: string, feed?: string): Promise<{ ok: boolean; error?: string }> {
  if (!allowed()) return { ok: false, error: `Unlock ${appName()} first` };
  // V1.55: one more calendar for one Meetings panel (core/calfeeds.ts). It never touches the usual calendar's status.
  if (feed) { const r = await linkCalendar(url, feed); return r.ok ? { ok: true } : { ok: false, error: r.error || "Could not link" }; }
  calStatus.set({ busy: true });
  askedAt = Date.now();
  const r = await linkCalendar(url);
  calStatus.set({ ...calStatusFrom(r, Date.now()), ...(r.ok ? {} : { connected: calStatus.get().connected, error: r.error || "Could not link" }) });
  return r.ok ? { ok: true } : { ok: false, error: r.error || "Could not link" };
}

let started = false;
/** Every 2 minutes while `active()` (the phone: only while PS is on screen). */
export function startCalRefresh(active: () => boolean = () => true) {
  if (started) return;
  started = true;
  window.setInterval(() => { if (active()) calRefreshIfStale(CAL_REFRESH.every); }, 30_000);
  let was = false;
  vaultStore.subscribe(() => {
    const now = allowed() || localAllowed();
    if (now && !was && active()) calRefreshIfStale(CAL_REFRESH.staleOnOpen);
    if (!now && was) calStatus.set({ connected: null, checkedAt: null, error: null, busy: false });   // signed out: forget it
    was = now;
  });
  // A page that was hidden (a sleeping Mac, a backgrounded phone) catches up as soon as it is seen again.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && active()) calRefreshIfStale(); });
}

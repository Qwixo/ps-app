// What the "PS is active" pop-up shows (ps-mac Popup.swift), worked out from the vault by the hidden
// engine page (src/psstatus.ts). V1.23: PS has no main window any more, so this little pop-up is how
// The developer sees that PS is running, synced and what is next. Pure: no vault, no React, tested in
// tests/psstatus.test.ts.
// Only what the pop-up needs: never a task, an email or a client. The next meeting's title is left
// out while private mode is on (the mask on the Meetings panel).
import type { CalEvent } from "./model";

export interface PsStatusIn {
  open: boolean;                   // the vault is unlocked as the owner
  online: boolean;
  lastSync: string | null;
  pending: number;
  syncError: string | null;
  events: CalEvent[];
  privateMode: boolean;
  now: number;
}
export interface PsNext { start: string; end: string | null; title: string | null; now: boolean }
export interface PsStatus {
  open: boolean;
  online: boolean;
  lastSync: string | null;
  pending: number;
  error: boolean;
  next: PsNext | null;
  private: boolean;
}

/** How far ahead the pop-up looks for the next meeting. */
export const NEXT_WITHIN_MS = 24 * 3600_000;

/** The meeting on now (if any), else the next one to start within a day. All day events never count. */
export function nextMeeting(events: CalEvent[], now: number, priv: boolean): PsNext | null {
  let best: { e: CalEvent; s: number; on: boolean } | null = null;
  for (const e of events) {
    if (!e || e.allDay || !e.start) continue;
    const s = Date.parse(e.start), end = e.end ? Date.parse(e.end) : NaN;
    if (!Number.isFinite(s)) continue;
    const on = s <= now && Number.isFinite(end) && end > now;
    if (!on && (s <= now || s - now > NEXT_WITHIN_MS)) continue;
    // A meeting on now wins; otherwise the soonest start.
    if (!best || (on && !best.on) || (on === best.on && s < best.s)) best = { e, s, on };
  }
  if (!best) return null;
  const title = (best.e.title || "").replace(/\s+/g, " ").trim().slice(0, 80);
  return { start: new Date(best.s).toISOString(), end: best.e.end ?? null, title: priv || !title ? null : title, now: best.on };
}

export function psStatus(i: PsStatusIn): PsStatus {
  if (!i.open) return { open: false, online: i.online, lastSync: null, pending: 0, error: false, next: null, private: false };
  return {
    open: true,
    online: i.online,
    lastSync: i.lastSync,
    pending: Math.max(0, Math.min(999, Math.round(i.pending || 0))),
    error: !!i.syncError,
    next: nextMeeting(i.events, i.now, i.privateMode),
    private: i.privateMode,
  };
}

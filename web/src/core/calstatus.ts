// What the Meetings panel says about its calendar (4 Nov 2026, the developer: "it's very behind ... even when I clicked the
// refresh icon just now it didn't actually refresh it"). The refresh used to spin until any vault sync landed and
// never said that the server could not read Google at all. Now the page that holds the vault keeps this small
// status from every calendar-inbox answer: is Google linked, when Google was last read, the last error, and
// whether a read is running. The Tab list gets a copy with the rest of its state. Pure: no imports.

export interface CalStatus {
  /** null until the server has answered once; false = no Google link yet (only Claude's daily copy). */
  connected: boolean | null;
  /** When the server last read Google Calendar (ISO), even when nothing had changed. */
  checkedAt: string | null;
  /** The last read's problem, in plain words, or null. */
  error: string | null;
  /** A read is running right now (the refresh icon spins). */
  busy: boolean;
  /** When the last read finished, ms since 1970 (0 = never): the refresh icon stops on a newer one. */
  doneAt: number;
}

export const CAL_IDLE: CalStatus = { connected: null, checkedAt: null, error: null, busy: false, doneAt: 0 };

let cur: CalStatus = CAL_IDLE;
const subs = new Set<() => void>();
export const calStatus = {
  get: () => cur,
  set(p: Partial<CalStatus>) {
    const next = { ...cur, ...p };
    if (JSON.stringify(next) === JSON.stringify(cur)) return;
    cur = next;
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};

/** A copy that came over the bridge from the main page: only well formed fields are taken. */
export function cleanCalStatus(v: unknown): CalStatus {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const iso = (x: unknown) => (typeof x === "string" && x.length <= 40 && !Number.isNaN(Date.parse(x)) ? x : null);
  return {
    connected: o.connected === true ? true : o.connected === false ? false : null,
    checkedAt: iso(o.checkedAt),
    error: typeof o.error === "string" ? o.error.slice(0, 200) : null,
    busy: o.busy === true,
    doneAt: typeof o.doneAt === "number" && Number.isFinite(o.doneAt) ? o.doneAt : 0,
  };
}

/** One calendar-inbox answer (or a failure) turned into the next status. */
export function calStatusFrom(r: { ok?: boolean; connected?: boolean; lastOk?: string | null; error?: string | null }, now: number): Partial<CalStatus> {
  const connected = r.connected === false ? false : r.connected === true || r.ok === true || !!r.lastOk ? true : null;
  return {
    connected: connected ?? cur.connected,
    checkedAt: r.lastOk || cur.checkedAt,
    error: connected === false ? null : r.error ? plainError(r.error) : null,
    busy: false,
    doneAt: now,
  };
}

function plainError(e: string): string {
  if (/offline|network|failed to fetch|load failed/i.test(e)) return "Offline";
  if (/feed 40[134]/.test(e)) return "Google refused the calendar link";
  if (/unauthorized|401/.test(e)) return "Sign in again";
  return "Could not reach Google Calendar";
}

/** "just now", "4 min ago", "2 h ago", "3 days ago". */
export function agoText(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

/** The small line under the Meetings heading. `copyAt` is when the calendar copy PS holds was made (the snapshot's
 *  own time), which is all there is while Google is not linked. */
export function calLine(st: CalStatus, copyAt: string | null, now: number): { text: string; tone: "ok" | "warn" | "bad" } {
  if (st.busy) return { text: "Updating...", tone: "ok" };
  if (st.connected === false) return { text: copyAt ? `Google not linked · copy from ${agoText(copyAt, now)}` : "Google not linked", tone: "bad" };
  const at = [st.checkedAt, copyAt].filter((x): x is string => !!x).sort().pop() ?? null;
  if (st.error) return { text: `${st.error}${at ? ` · updated ${agoText(at, now)}` : ""}`, tone: "warn" };
  if (!at) return { text: "Not updated yet", tone: "warn" };
  // Google is read every minute: anything over 10 minutes old means PS has not heard from it.
  return { text: `Updated ${agoText(at, now)}`, tone: now - Date.parse(at) > 10 * 60_000 ? "warn" : "ok" };
}

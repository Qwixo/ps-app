// Minecraft mode, power out stopwatch: the pure part (no React, no PS), so tests/power.test.ts can run it.
// The state comes from PS (ps-mac Sources/PowerWatch.swift) through power-bridge.ts. Times are ms since 1970.

export type Outage = { start: number; end: number; duration: number; approx?: boolean };
export type PowerState = {
  known: boolean;              // PS has read the power source at least once
  hasBattery: boolean;
  onBattery: boolean;          // mains is out
  since: number | null;        // when mains went (only while onBattery)
  batteryPct: number | null;
  minutesLeft: number | null;
  lastOutage: Outage | null;
  history: Outage[];           // newest first, at most 50
};

export const EMPTY_POWER: PowerState = { known: false, hasBattery: false, onBattery: false, since: null, batteryPct: null, minutesLeft: null, lastOutage: null, history: [] };

/** How long "Power came back after ..." stays before it says "Power on". */
export const BACK_FOR_MS = 10 * 60_000;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const MAX_TIME = 8.64e15;
const time = (v: unknown) => { const n = num(v); return n !== null && n > 0 && n < MAX_TIME ? Math.round(n) : null; };

function cleanOutage(v: unknown): Outage | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const start = time(o.start), end = time(o.end);
  if (start === null || end === null || end < start) return null;
  const out: Outage = { start, end, duration: end - start };
  if (o.approx === true) out.approx = true;
  return out;
}

/** Only known fields with sane values reach the panel. */
export function cleanPower(raw: unknown): PowerState {
  if (!raw || typeof raw !== "object") return EMPTY_POWER;
  const m = raw as Record<string, unknown>;
  if (m.type !== undefined && m.type !== "power:state") return EMPTY_POWER;
  const onBattery = m.onBattery === true;
  const pct = num(m.batteryPct);
  const left = num(m.minutesLeft);
  const history = (Array.isArray(m.history) ? m.history : []).map(cleanOutage).filter((o): o is Outage => !!o).slice(0, 50);
  return {
    known: m.known !== false,
    hasBattery: m.hasBattery === true,
    onBattery,
    since: onBattery ? time(m.since) : null,
    batteryPct: pct === null ? null : Math.max(0, Math.min(100, Math.round(pct))),
    minutesLeft: onBattery && left !== null && left >= 0 ? Math.min(Math.round(left), 100 * 60) : null,
    lastOutage: cleanOutage(m.lastOutage) ?? history[0] ?? null,
    history,
  };
}

const two = (n: number) => String(n).padStart(2, "0");

/** The stopwatch face: 00:42:13 (hours carry on past 24: 26:05:09). */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
}

/** A length in words: 45 s, 42 min, 1 h 12 min, 2 h, 1 d 4 h. */
export function human(ms: number): string {
  const s = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 24) return mm ? `${h} h ${mm} min` : `${h} h`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d} d ${hh} h` : `${d} d`;
}

/** Battery time left: "3 h 34 min left", null when macOS has not worked it out. */
export function leftText(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) return null;
  return `${human(minutes * 60_000)} left`;
}

/** 24 hour clock time in this Mac's time zone. */
export function hm(t: number): string { const d = new Date(t); return `${two(d.getHours())}:${two(d.getMinutes())}`; }

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayStart(t: number) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

/** "Today", "Yesterday" or "Mon 3 Nov". */
export function dayLabel(t: number, now: number): string {
  const days = Math.round((dayStart(now) - dayStart(t)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const d = new Date(t);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export type OutageRow = { key: string; day: string; span: string; length: string; approx: boolean };
/** One line of the recent outages list: "Today", "14:02 to 15:14", "1 h 12 min". */
export function outageRow(o: Outage, now: number): OutageRow {
  return { key: `${o.start}`, day: dayLabel(o.start, now), span: `${hm(o.start)} to ${hm(o.end)}`, length: human(o.duration), approx: o.approx === true };
}

export type PowerView =
  | { mode: "waiting"; title: string }
  | { mode: "nobattery"; title: string; sub: string }
  | { mode: "out"; title: string; clock: string; sub: string }
  | { mode: "back"; title: string; sub: string }
  | { mode: "on"; title: string; sub: string | null };

/** What the big panel says right now. */
export function powerView(s: PowerState, now: number, ps = true): PowerView {
  if (!ps) return { mode: "waiting", title: "Only in PS app on the Mac" };
  if (!s.known) return { mode: "waiting", title: "Waiting for PS app..." };
  if (s.onBattery && s.since !== null) {
    const parts = [`Since ${hm(s.since)}`];
    if (s.batteryPct !== null) parts.push(`battery ${s.batteryPct}%`);
    const left = leftText(s.minutesLeft);
    if (left) parts.push(left);
    return { mode: "out", title: "Power has been out for", clock: clock(now - s.since), sub: parts.join(", ") };
  }
  if (!s.hasBattery) return { mode: "nobattery", title: "No battery on this Mac", sub: "The stopwatch needs a battery or a UPS to keep the Mac on while the power is out." };
  const lo = s.lastOutage;
  if (lo && now - lo.end >= 0 && now - lo.end < BACK_FOR_MS) {
    return { mode: "back", title: `Power came back after ${lo.approx ? "about " : ""}${human(lo.duration)}`, sub: `Out from ${hm(lo.start)} to ${hm(lo.end)}` };
  }
  if (!lo) return { mode: "on", title: "Power on", sub: null };
  const day = dayLabel(lo.end, now);
  return { mode: "on", title: "Power on", sub: `Last cut ${day === "Today" || day === "Yesterday" ? day.toLowerCase() : day}, ${human(lo.duration)}` };
}

/** "Internet out for 00:12:03" next to the power clock, when Last online data is passed in. */
export function internetText(outSince: number | null | undefined, now: number): string | null {
  if (outSince === null || outSince === undefined || !Number.isFinite(outSince) || outSince > now) return null;
  return `Internet out for ${clock(now - outSince)}`;
}

/** Whether the face changes every second (the panel only runs its timer then). */
export function needsTick(s: PowerState, now: number, internetOutSince?: number | null): boolean {
  if (s.onBattery && s.since !== null) return true;
  if (internetOutSince !== null && internetOutSince !== undefined) return true;
  return !!s.lastOutage && now - s.lastOutage.end < BACK_FOR_MS;
}

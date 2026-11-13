// The screen time timeline across devices (V1.31). Each device draws its own "last hours" line from
// what it counts itself (PS on the Mac, PS GOS on the phone from GrapheneOS's usage events). To show
// the OTHER device's line too, each device saves its line in the vault cut into whole hours: one small
// encrypted record per hour, 24 slots per device (slot = the hour's number mod 24), each slot
// overwritten a day later. So the vault never holds more than 48 of them, and a save moves only the
// hours that changed (usually the current one): Supabase free plan egress stays tiny.
// Pure helpers so cutting, saving, joining and the golden rule can be tested without a vault.
import type { Doc, ScreenTimeDevice, StLine } from "./model";
import { isProtectedApp } from "./protected.ts";

/** Which app was in front and when (ms), plus the breaks. The Mac's PS sends this shape (ps-mac
 *  ScreenTime.swift timelineJSON), the phone's shell the same (ps-gos Watch.kt ScreenTime). `upTo`:
 *  how far the line was counted, when it came from the other device. */
export type Timeline = { now: number; from: number; apps: { id: string; name: string }[]; segs: [number, number, number][]; away: [number, number][]; upTo?: number };

export const HOUR = 3600_000;
/** The vault keeps the last day; the pop-up shows the hours set in the gear (1 to 24). */
export const LINE_HOURS = 24;
const MAX_SEGS = 6000, MAX_APPS = 400;

const isPhoneId = (id: string) => id.startsWith("gos:");
/** An app a device's line may hold: never 1Password or Signal, never the other device's. */
const fits = (device: ScreenTimeDevice, a: { id: string; name: string }) =>
  !isProtectedApp(a.id) && !isProtectedApp(a.name) && isPhoneId(a.id) === (device === "gos");

/**
 * A timeline from PS or the phone's shell, checked (it crossed a bridge): numbers only where numbers
 * belong, sizes capped, 1Password and Signal dropped at the first read. `prefix` is put in front of
 * every app id ("gos:" for the phone, like its day records). Null if it is not a timeline.
 */
export function cleanTimeline(raw: unknown, prefix = ""): Timeline | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const now = Number(r.now), from = Number(r.from);
  if (!Number.isFinite(now) || !Number.isFinite(from) || from >= now || !Array.isArray(r.apps) || !Array.isArray(r.segs)) return null;
  const apps: { id: string; name: string }[] = [];
  const map = new Map<number, number>();
  (r.apps as unknown[]).slice(0, MAX_APPS).forEach((a, i) => {
    const o = (a && typeof a === "object" ? a : {}) as { id?: unknown; name?: unknown };
    if (typeof o.id !== "string" || !o.id) return;
    const id = (prefix && !o.id.startsWith(prefix) ? prefix + o.id : o.id).slice(0, 200);
    const name = String(o.name || o.id).slice(0, 100);
    if (isProtectedApp(id) || isProtectedApp(name)) return;
    map.set(i, apps.length);
    apps.push({ id, name });
  });
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const segs: [number, number, number][] = [];
  for (const g of (r.segs as unknown[]).slice(0, MAX_SEGS)) {
    if (!Array.isArray(g) || !num(g[0]) || !num(g[1]) || !num(g[2])) continue;
    const a = map.get(g[0] as number);
    const s = Math.max(from, g[1] as number), e = Math.min(now, g[2] as number);
    if (a === undefined || e <= s) continue;
    segs.push([a, s, e]);
  }
  const away: [number, number][] = [];
  for (const g of (Array.isArray(r.away) ? r.away as unknown[] : []).slice(0, MAX_SEGS)) {
    if (!Array.isArray(g) || !num(g[0]) || !num(g[1])) continue;
    const s = Math.max(from, g[0] as number), e = Math.min(now, g[1] as number);
    if (e > s) away.push([s, e]);
  }
  segs.sort((x, y) => x[1] - y[1]);
  away.sort((x, y) => x[0] - y[0]);
  return { now, from, apps, segs, away };
}

/** Only the last `hours` of a timeline (the pop-up's own range; the saved line covers a day). */
export function clipTimeline(tl: Timeline, hours: number): Timeline {
  const from = Math.max(tl.from, tl.now - Math.max(1, hours) * HOUR);
  if (from === tl.from) return tl;
  return {
    ...tl, from,
    segs: tl.segs.filter(([, , e]) => e > from).map(([a, s, e]) => [a, Math.max(s, from), e] as [number, number, number]),
    away: tl.away.filter(([, e]) => e > from).map(([s, e]) => [Math.max(s, from), e] as [number, number]),
  };
}

/** A device's line cut into whole hours (only the hours with something in them), ready to save. */
export function toHours(tl: Timeline, device: ScreenTimeDevice, at: string): StLine[] {
  const from = Math.max(tl.from, tl.now - LINE_HOURS * HOUR);
  const hours = new Map<number, { apps: { id: string; name: string }[]; idx: Map<string, number>; segs: [number, number, number][]; away: [number, number][] }>();
  const bucket = (h: number) => {
    let b = hours.get(h);
    if (!b) { b = { apps: [], idx: new Map(), segs: [], away: [] }; hours.set(h, b); }
    return b;
  };
  // Seconds from the hour's start; a piece shorter than a second after rounding is dropped.
  const pieces = (s: number, e: number, put: (h: number, a: number, b: number) => void) => {
    const a = Math.max(s, from), b = Math.min(e, tl.now);
    for (let h = Math.floor(a / HOUR) * HOUR; h < b; h += HOUR) {
      const x = Math.round((Math.max(a, h) - h) / 1000), y = Math.round((Math.min(b, h + HOUR) - h) / 1000);
      if (y > x) put(h, x, y);
    }
  };
  for (const [ai, s, e] of tl.segs) {
    const app = tl.apps[ai];
    if (!app || !fits(device, app)) continue;
    pieces(s, e, (h, x, y) => {
      const b = bucket(h);
      let i = b.idx.get(app.id);
      if (i === undefined) { i = b.apps.length; b.idx.set(app.id, i); b.apps.push({ id: app.id, name: app.name }); }
      b.segs.push([i, x, y]);
    });
  }
  for (const [s, e] of tl.away) pieces(s, e, (h, x, y) => bucket(h).away.push([x, y]));
  return [...hours].sort((p, q) => p[0] - q[0]).map(([h, b]) => ({
    device, hour: h, slot: Math.round(h / HOUR) % 24, upTo: Math.min(h + HOUR, tl.now),
    apps: b.apps, segs: b.segs, away: b.away, updatedAt: at,
  }));
}

const sameLine = (a: StLine, b: StLine) => a.hour === b.hour && a.upTo === b.upTo
  && JSON.stringify([a.apps, a.segs, a.away]) === JSON.stringify([b.apps, b.segs, b.away]);

/**
 * Which hour records to write: an hour goes into its device's slot, replacing what the slot held a
 * day ago, and only when something in it changed. A slot already holding a newer hour is never
 * overwritten by an older one. Never touches the other device's records.
 */
export function planLines(docs: Doc<StLine>[], hours: StLine[]): { id?: string; data: StLine }[] {
  const out: { id?: string; data: StLine }[] = [];
  for (const h of hours) {
    const held = docs.filter((d) => d.data.device === h.device && d.data.slot === h.slot).sort((x, y) => y.data.hour - x.data.hour)[0];
    if (held && (held.data.hour > h.hour || sameLine(held.data, h))) continue;
    out.push({ id: held?.id, data: h });
  }
  return out;
}

/**
 * One device's saved hours put back together as a timeline for [from, now]: the stretches an hour
 * boundary cut are joined again, 1Password and Signal never show (even if an old record held them),
 * and `upTo` says how far that device had counted. Null when nothing was saved for those hours.
 */
export function joinLines(docs: Doc<StLine>[], device: ScreenTimeDevice, from: number, now: number): Timeline | null {
  const byHour = new Map<number, StLine>();
  for (const d of docs) {
    const l = d.data;
    if (!l || l.device !== device || !Number.isFinite(l.hour) || l.hour + HOUR <= from || l.hour >= now) continue;
    const was = byHour.get(l.hour);
    if (!was || l.upTo > was.upTo) byHour.set(l.hour, l);
  }
  if (!byHour.size) return null;
  const apps: { id: string; name: string }[] = [];
  const idx = new Map<string, number>();
  const segs: [number, number, number][] = [];
  const away: [number, number][] = [];
  let upTo = 0;
  for (const l of [...byHour.values()].sort((a, b) => a.hour - b.hour)) {
    upTo = Math.max(upTo, Math.min(l.upTo, now));
    for (const [ai, x, y] of l.segs || []) {
      const app = l.apps?.[ai];
      if (!app || !fits(device, app)) continue;
      let i = idx.get(app.id);
      if (i === undefined) { i = apps.length; idx.set(app.id, i); apps.push({ id: app.id, name: app.name }); }
      const s = Math.max(from, l.hour + x * 1000), e = Math.min(now, l.hour + y * 1000);
      if (e <= s) continue;
      const last = segs[segs.length - 1];
      if (last && last[0] === i && s - last[2] <= 1000) last[2] = Math.max(last[2], e);
      else segs.push([i, s, e]);
    }
    for (const [x, y] of l.away || []) {
      const s = Math.max(from, l.hour + x * 1000), e = Math.min(now, l.hour + y * 1000);
      if (e <= s) continue;
      const last = away[away.length - 1];
      if (last && s - last[1] <= 1000) last[1] = Math.max(last[1], e);
      else away.push([s, e]);
    }
  }
  if (!segs.length && !away.length) return null;
  return { now, from, apps, segs, away, upTo };
}

import { appName } from "./appname.ts";
import { mailAllowed } from "./mailflag.ts";
// PS Do Not Disturb (the developer, 30 Oct 2026: "Add a do not disturb icon top right of my tab overlay. When I
// click on it it activates immediately but when I click on it again when it's activated then it comes up
// in like a pop-up and comes up with a list of the different distractions I can toggle on and off. Add
// on mobile too."). PS only: it never touches macOS Focus, Android's own Do Not Disturb or any system
// setting. The state lives in the encrypted settings (settings.dnd), so turning it on at the Mac also
// quiets the phone and the reverse.
//
// Muted things are HELD, never lost: a muted card stays in its list and comes up when DND ends (or that
// toggle is let through). Every toggle is muted unless the developer lets it through (settings.dnd.pass).
// Who honours it: src/mailcards.ts (mail, chats, leads, the chime), src/meetwatch.ts (meeting cards and
// their sounds), src/island.ts (the island lights up instead of popping), App.tsx (vault notices),
// src/dnd.ts (tells the Mac and phone shells), ps-mac Toast.swift / Sfx.swift / FollowUp.swift and
// ps-gos Notifier.kt (their own cards). VPN alarms, the private mode question and meeting notes always
// come through (security and calls, not distractions).

export type DndKind = "chats" | "mail" | "leads" | "meetings" | "gsquad" | "island" | "sounds" | "vault" | "system" | "followup" | "phone";

export interface Dnd {
  on: boolean;
  /** When this stretch began (ISO). */
  since?: string;
  /** When it ends by itself (ISO); null or missing: until the developer turns it off. */
  until?: string | null;
  /** When it was last turned off by hand (ISO), so a held chat card's clock skips the quiet stretch. */
  offAt?: string;
  /** The distractions the developer lets through. Everything else is muted while DND is on. Always the live copy of the
   *  focus mode that is on (or the one the moon turns on), so every older reader keeps working. */
  pass?: DndKind[];
  /** V1.43 focus modes (the developer, 8 Nov 2026: "add different focus modes, so you can create a new focus mode, like a Do
   *  Not Disturb profile"). Missing: the built in four (defaultModes). */
  modes?: FocusMode[];
  /** The mode the moon turns on (its id). */
  mode?: string;
  /** The mode on right now (its id), while on. */
  active?: string;
  /** Who turned it on: by hand, a mode's schedule, or Sleep mode. Only Sleep mode turns off what Sleep mode turned on. */
  by?: "hand" | "schedule" | "sleep";
  /** The last schedule window or sleep that turned it on, so a turn off by hand inside it is never undone. */
  auto?: string;
}

// ---------- focus modes (V1.43) ----------
export type FocusIcon = "moon" | "brain" | "phone" | "bed" | "book" | "head" | "leaf" | "bolt" | "car" | "heart";
export const FOCUS_ICONS: FocusIcon[] = ["moon", "brain", "phone", "bed", "book", "head", "leaf", "bolt", "car", "heart"];
export type FocusLength = "hour" | "morning" | "off";
export interface FocusSchedule {
  on: boolean;
  /** Days it starts on, 0 Sunday to 6 Saturday. */
  days: number[];
  /** HH:MM on the developer's home clock. An end at or before the start runs past midnight. */
  from: string;
  to: string;
}
export interface FocusMode {
  id: string;
  name: string;
  icon: FocusIcon;
  /** What gets through while it is on. */
  pass: DndKind[];
  /** People whose emails always get through (an address, or part of a name), even with client emails muted. */
  senders?: string[];
  /** How long a press of the moon keeps it on. Default: until you turn it off. */
  length?: FocusLength;
  schedule?: FocusSchedule | null;
  /** Turns on by itself when Sleep mode starts, and off when you wake up. */
  sleep?: boolean;
}
export const MAX_MODES = 8, MAX_SENDERS = 20, NAME_MAX = 24;

/** The four every account starts with. Do Not Disturb keeps the switches set before V1.43. */
export function defaultModes(pass: DndKind[] = []): FocusMode[] {
  return [
    { id: "dnd", name: "Do Not Disturb", icon: "moon", pass: [...pass] },
    { id: "deep", name: "Deep work", icon: "brain", pass: [], length: "hour" },
    { id: "calls", name: "Calls", icon: "phone", pass: ["meetings", "mail"] },
    { id: "sleep", name: "Sleep", icon: "bed", pass: [], length: "morning" },
  ];
}
export function modesOf(d: Dnd | undefined | null): FocusMode[] {
  const m = Array.isArray(d?.modes) ? d!.modes.map(cleanMode).filter((x): x is FocusMode => !!x) : [];
  return m.length ? m : defaultModes(d?.pass || []);
}
/** The mode the moon turns on (falls back to the first). */
export function moonMode(d: Dnd | undefined | null): FocusMode {
  const m = modesOf(d);
  return m.find((x) => x.id === d?.mode) || m[0];
}
/** The mode on right now, or null when Do Not Disturb is off. */
export function activeMode(d: Dnd | undefined | null, now = Date.now()): FocusMode | null {
  if (!dndActive(d, now)) return null;
  const m = modesOf(d);
  return m.find((x) => x.id === d!.active) || m.find((x) => x.id === d!.mode) || m[0];
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const isIcon = (v: unknown): v is FocusIcon => typeof v === "string" && (FOCUS_ICONS as string[]).includes(v);
const cleanName = (v: unknown) => typeof v === "string" ? v.replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";
const cleanKinds = (v: unknown): DndKind[] => Array.isArray(v) ? DND_KINDS.map((x) => x.k).filter((k) => v.includes(k)) : [];
export function cleanSenders(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const t = x.trim().toLowerCase().slice(0, 80);
    if (t.length >= 2 && !out.includes(t)) out.push(t);
    if (out.length >= MAX_SENDERS) break;
  }
  return out;
}
export function cleanSchedule(v: unknown): FocusSchedule | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.from !== "string" || !HHMM.test(o.from) || typeof o.to !== "string" || !HHMM.test(o.to)) return null;
  const days = Array.isArray(o.days) ? [0, 1, 2, 3, 4, 5, 6].filter((n) => (o.days as unknown[]).includes(n)) : [];
  return { on: o.on === true, days, from: o.from, to: o.to };
}
export function cleanMode(v: unknown): FocusMode | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = typeof o.id === "string" && /^[a-z0-9]{1,16}$/.test(o.id) ? o.id : "";
  const name = cleanName(o.name);
  if (!id || !name) return null;
  const m: FocusMode = { id, name, icon: isIcon(o.icon) ? o.icon : "moon", pass: cleanKinds(o.pass) };
  const senders = cleanSenders(o.senders);
  if (senders.length) m.senders = senders;
  if (o.length === "hour" || o.length === "morning" || o.length === "off") m.length = o.length;
  const sch = cleanSchedule(o.schedule);
  if (sch) m.schedule = sch;
  if (o.sleep === true) m.sleep = true;
  return m;
}

/** Does this email's sender get through the mode on now? (an address or a piece of the name, any case) */
export function dndLetsSender(d: Dnd | undefined | null, from: string | null | undefined, fromName?: string | null, now = Date.now()): boolean {
  const m = activeMode(d, now);
  if (!m?.senders?.length) return false;
  const a = (from || "").toLowerCase(), n = (fromName || "").toLowerCase();
  return m.senders.some((s) => (a && (a === s || (s.startsWith("@") && a.endsWith(s)) || (s.includes("@") ? false : a.includes(s)))) || (n && !s.includes("@") && n.includes(s)));
}

/** Every distraction PS can raise, in the order the pop-up lists them. `where` says which device it is about. */
export const DND_KINDS: { k: DndKind; label: string; hint: string; where: "both" | "mac" | "phone" }[] = [
  { k: "chats", label: "Claude chat done", hint: "Claude finished cards", where: "both" },
  { k: "mail", label: "Client emails", hint: "Email cards", where: "both" },
  { k: "leads", label: "Instantly replies", hint: "Lead reply cards", where: "both" },
  { k: "meetings", label: "Meeting cards", hint: "Booked, can't make it, 10 minutes before", where: "both" },
  { k: "gsquad", label: "G Squad", hint: "Squad nudges and chat sounds", where: "mac" },
  { k: "island", label: "Dynamic Island pop", hint: "It only lights up; the counts still update", where: "mac" },
  { k: "sounds", label: "Card sounds", hint: "The chime, meeting and away sounds", where: "mac" },
  { k: "vault", label: "Vault notices", hint: "Claude updated your vault, Telegram tasks", where: "mac" },
  { k: "system", get label() { return `${appName()} cards`; }, hint: "AirPods, network changes", where: "mac" },
  { k: "followup", label: "Daily reminder", hint: "The card you answer by typing Yes", where: "mac" },
  { k: "phone", label: "Phone notifications", hint: "Everything it shows on your phone", where: "phone" },
];
/** Switches for the developer's own feeds (Claude chats, client emails, Instantly, vault notices): any other account never
 *  gets those cards, so its Do Not Disturb pop-up leaves them out (7 Nov 2026). The daily reminder is everyone's. */
export const DND_RED_ONLY: ReadonlySet<DndKind> = new Set<DndKind>(["chats", "mail", "leads", "vault"]);
/** The switches the pop-up shows, in order (the phone puts its own first). */
export function dndKindsFor(red: boolean, phone: boolean): typeof DND_KINDS {
  const mail = mailAllowed();   // Client emails switched on (core/mailswitch.ts): the client email and lead reply switches show
  const mine = DND_KINDS.filter((x) => red || !DND_RED_ONLY.has(x.k) || (mail && (x.k === "mail" || x.k === "leads")));
  return phone ? [...mine.filter((x) => x.k === "phone"), ...mine.filter((x) => x.k !== "phone")] : mine;
}
const KINDS = new Set<DndKind>(DND_KINDS.map((x) => x.k));
export const isDndKind = (v: unknown): v is DndKind => typeof v === "string" && KINDS.has(v as DndKind);

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

/** Is DND on right now (on, and its end time, if any, still ahead)? */
export function dndActive(d: Dnd | undefined | null, now = Date.now()): boolean {
  if (!d?.on) return false;
  const u = ms(d.until);
  return !(u <= now);
}

/** Is this distraction muted right now? On the phone the "Phone notifications" toggle also mutes everything. */
export function dndMutes(d: Dnd | undefined | null, kind: DndKind, now = Date.now(), device: "mac" | "phone" | "web" = "mac"): boolean {
  if (!dndActive(d, now)) return false;
  const pass = d!.pass || [];
  if (device === "phone" && !pass.includes("phone")) return true;
  return !pass.includes(kind);
}

/** When the current stretch ends by itself (ms), or 0 (off, or until the developer turns it off). */
export function dndEndsAt(d: Dnd | undefined | null, now = Date.now()): number {
  if (!dndActive(d, now)) return 0;
  const u = ms(d!.until);
  return Number.isFinite(u) ? u : 0;
}

/** The pop-up's actions. V1.43 adds the focus modes: `mode` on "on" and "pass" picks which one (default: the one on
 *  now, else the one the moon turns on). */
export type ModePatch = Partial<Pick<FocusMode, "name" | "icon" | "length" | "sleep">> & { schedule?: FocusSchedule | null };
export type DndOp =
  | { op: "on"; mode?: string; until?: string | null }
  | { op: "off" }
  | { op: "pass"; kind: DndKind; pass: boolean; mode?: string }
  | { op: "until"; until: string | null }
  | { op: "pick"; mode: string }
  | { op: "addMode"; id: string; name: string; icon: FocusIcon }
  | { op: "editMode"; mode: string; patch: ModePatch }
  | { op: "delMode"; mode: string }
  | { op: "senders"; mode: string; list: string[] }
  | { op: "auto"; mode: string; key: string; by: "schedule" | "sleep"; until: string | null };

const futureIso = (v: string | null | undefined, now: number) => {
  const u = v ? Date.parse(v) : NaN;
  return Number.isFinite(u) && u > now ? new Date(u).toISOString() : null;
};

/** The settings value after one action. Turning it on keeps the developer's let-through choices from last time. */
export function dndApply(d: Dnd | undefined | null, o: DndOp, now = Date.now()): Dnd {
  const cur: Dnd = d ? { ...d } : { on: false };
  const at = new Date(now).toISOString();
  const modes = modesOf(cur);
  const live = dndActive(cur, now);
  // The mode whose switches the live `pass` copies: the one on, else the one the moon turns on.
  const liveId = (live ? activeMode(cur, now)! : moonMode(cur)).id;
  const withModes = (list: FocusMode[], extra: Partial<Dnd> = {}): Dnd => {
    const out: Dnd = { ...cur, modes: list, ...extra };
    if (!list.some((x) => x.id === out.mode)) out.mode = list[0].id;
    if (live && !list.some((x) => x.id === out.active)) out.active = out.mode;
    const lid = live ? out.active! : out.mode!;
    out.pass = [...(list.find((x) => x.id === lid)?.pass || [])];
    return out;
  };
  const turnOn = (m: FocusMode, until: string | null, by: Dnd["by"], extra: Partial<Dnd> = {}): Dnd =>
    ({ ...cur, ...extra, modes, on: true, since: live ? cur.since : at, until, active: m.id, by, pass: [...m.pass] });
  switch (o.op) {
    case "on": {
      const m = modes.find((x) => x.id === o.mode) || moonMode(cur);
      if (live && activeMode(cur, now)?.id === m.id) return cur;
      return turnOn(m, futureIso(o.until, now), "hand");
    }
    case "auto": {
      const m = modes.find((x) => x.id === o.mode);
      if (!m) return cur;
      return turnOn(m, futureIso(o.until, now), o.by, { auto: o.key });
    }
    case "off":
      if (!cur.on) return cur;
      // Ended by its own clock already: the stretch ended then, not now.
      return { ...cur, on: false, offAt: live ? at : new Date(ms(cur.until)).toISOString() };
    case "pass": {
      const id = o.mode && modes.some((x) => x.id === o.mode) ? o.mode : liveId;
      const list = modes.map((m) => {
        if (m.id !== id) return m;
        const pass = new Set(m.pass);
        if (o.pass) pass.add(o.kind); else pass.delete(o.kind);
        return { ...m, pass: DND_KINDS.map((x) => x.k).filter((k) => pass.has(k)) };
      });
      return withModes(list);
    }
    case "until": {
      if (!live) return cur;
      return { ...cur, until: o.until === null ? null : futureIso(o.until, now) };
    }
    case "pick": {
      const m = modes.find((x) => x.id === o.mode);
      if (!m) return cur;
      // On already: the new mode takes over at once (its switches, the same end time).
      return live ? { ...turnOn(m, cur.until ?? null, cur.by || "hand"), mode: m.id } : withModes(modes, { mode: m.id });
    }
    case "addMode": {
      const name = cleanName(o.name);
      if (!name || modes.length >= MAX_MODES || modes.some((x) => x.id === o.id) || !/^[a-z0-9]{1,16}$/.test(o.id)) return cur;
      return withModes([...modes, { id: o.id, name, icon: isIcon(o.icon) ? o.icon : "moon", pass: [] }]);
    }
    case "editMode": {
      const list = modes.map((m) => {
        if (m.id !== o.mode) return m;
        const n: FocusMode = { ...m };
        const p = o.patch;
        if (p.name !== undefined) { const v = cleanName(p.name); if (v) n.name = v; }
        if (p.icon !== undefined && isIcon(p.icon)) n.icon = p.icon;
        if (p.length !== undefined) { if (p.length === "hour" || p.length === "morning" || p.length === "off") n.length = p.length; }
        if (p.sleep !== undefined) { if (p.sleep) n.sleep = true; else delete n.sleep; }
        if (p.schedule !== undefined) { const sch = cleanSchedule(p.schedule); if (sch) n.schedule = sch; else delete n.schedule; }
        return n;
      });
      // Only one mode turns on with Sleep mode.
      const sleeper = o.patch.sleep === true ? o.mode : null;
      return withModes(sleeper ? list.map((m) => m.id === sleeper || !m.sleep ? m : (({ sleep: _s, ...r }) => r)(m)) : list);
    }
    case "delMode": {
      if (modes.length <= 1 || !modes.some((x) => x.id === o.mode)) return cur;
      const list = modes.filter((x) => x.id !== o.mode);
      const wasOn = live && activeMode(cur, now)?.id === o.mode;
      const out = withModes(list, cur.mode === o.mode ? { mode: list[0].id } : {});
      // The mode on now was deleted: Do Not Disturb stays on with the moon's mode.
      if (wasOn) { const m = moonMode(out); return { ...out, active: m.id, pass: [...m.pass] }; }
      return out;
    }
    case "senders": {
      const list = modes.map((m) => {
        if (m.id !== o.mode) return m;
        const senders = cleanSenders(o.list);
        const n: FocusMode = { ...m };
        if (senders.length) n.senders = senders; else delete n.senders;
        return n;
      });
      return withModes(list);
    }
  }
}

/** A tidy copy of whatever came in (the overlay window, a sealed package, an old vault): never trusted as is. */
export function cleanDndOp(v: unknown): DndOp | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = (x: unknown) => typeof x === "string" && /^[a-z0-9]{1,16}$/.test(x) ? x : null;
  const isoOrNull = (x: unknown) => x === null || x === undefined ? null : typeof x === "string" && !Number.isNaN(Date.parse(x)) ? x : undefined;
  if (o.op === "on") {
    const until = isoOrNull(o.until);
    if (until === undefined) return null;
    const mode = id(o.mode);
    return { op: "on", ...(mode ? { mode } : {}), ...(until ? { until } : {}) };
  }
  if (o.op === "off") return { op: "off" };
  if (o.op === "pass" && isDndKind(o.kind) && typeof o.pass === "boolean") { const mode = id(o.mode); return { op: "pass", kind: o.kind, pass: o.pass, ...(mode ? { mode } : {}) }; }
  if (o.op === "until" && (o.until === null || (typeof o.until === "string" && !Number.isNaN(Date.parse(o.until))))) return { op: "until", until: o.until as string | null };
  if (o.op === "pick" && id(o.mode)) return { op: "pick", mode: o.mode as string };
  if (o.op === "addMode" && id(o.id) && cleanName(o.name)) return { op: "addMode", id: o.id as string, name: cleanName(o.name), icon: isIcon(o.icon) ? o.icon : "moon" };
  if (o.op === "delMode" && id(o.mode)) return { op: "delMode", mode: o.mode as string };
  if (o.op === "senders" && id(o.mode) && Array.isArray(o.list)) return { op: "senders", mode: o.mode as string, list: cleanSenders(o.list) };
  if (o.op === "editMode" && id(o.mode) && o.patch && typeof o.patch === "object") {
    const p = o.patch as Record<string, unknown>, out: ModePatch = {};
    if (p.name !== undefined && cleanName(p.name)) out.name = cleanName(p.name);
    if (isIcon(p.icon)) out.icon = p.icon;
    if (p.length === "hour" || p.length === "morning" || p.length === "off") out.length = p.length;
    if (typeof p.sleep === "boolean") out.sleep = p.sleep;
    if (p.schedule === null) out.schedule = null; else if (p.schedule !== undefined) { const sch = cleanSchedule(p.schedule); if (sch) out.schedule = sch; }
    return Object.keys(out).length ? { op: "editMode", mode: o.mode as string, patch: out } : null;
  }
  // "auto" is never taken from the overlay: only this page's own clock (dndAuto) makes it.
  return null;
}

/** A fresh id for a new mode (lower case letters and digits). */
export const newModeId = (rand = Math.random) => "m" + Math.floor(rand() * 36 ** 6).toString(36).padStart(6, "0");

// ---------- schedules and Sleep mode (V1.43) ----------
/** A wall clock time in a time zone, as ms since 1970 (the zone's offset at that moment, so clock changes count). */
export function wallMs(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const off = (t: number) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(t / 1000) * 1000;
  };
  const wall = Date.UTC(y, mo - 1, d, h, mi, 0);
  const guess = wall - off(wall);
  return wall - off(guess);
}
function dayParts(t: number, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(t));
  const g = (k: string) => p.find((x) => x.type === k)?.value || "";
  return { y: Number(g("year")), mo: Number(g("month")), d: Number(g("day")), wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")) };
}
/** The schedule's window around `now` ({start, end} ms), or null when now is outside every window. */
export function scheduleWindow(s: FocusSchedule | null | undefined, now: number, tz: string): { start: number; end: number } | null {
  if (!s?.on || !s.days.length || !HHMM.test(s.from) || !HHMM.test(s.to)) return null;
  const [fh, fm] = s.from.split(":").map(Number), [th, tm] = s.to.split(":").map(Number);
  const over = th * 60 + tm <= fh * 60 + fm;   // runs past midnight
  // Today's window, and yesterday's when it runs past midnight.
  for (const back of [0, 1]) {
    const day = dayParts(now - back * 86400_000, tz);
    if (!s.days.includes(day.wd)) continue;
    const start = wallMs(day.y, day.mo, day.d, fh, fm, tz);
    const end = wallMs(day.y, day.mo, day.d + (over ? 1 : 0), th, tm, tz);
    if (now >= start && now < end) return { start, end };
  }
  return null;
}
/** The open sleep Sleep mode knows about (fitness prefs sleepOpen), cut down to what matters here. */
export interface SleepNow { at: string; woke?: string | null; breaks?: unknown[] | null }
/** What the clock should do now: a mode's schedule or Sleep mode turning Do Not Disturb on, or Sleep mode turning
 *  off what it turned on. null: nothing. A turn off by hand inside a window is kept (d.auto remembers the window). */
export function dndAuto(d: Dnd | undefined | null, ctx: { now: number; tz: string; sleep: SleepNow | null }): DndOp | null {
  const { now, tz, sleep } = ctx;
  const modes = modesOf(d);
  const live = dndActive(d, now);
  const sleeper = modes.find((m) => m.sleep);
  const asleep = !!sleep && !sleep.woke && Number.isFinite(Date.parse(sleep.at));
  if (sleeper && asleep) {
    const key = `sleep:${sleep!.at}:${sleep!.breaks?.length || 0}`.slice(0, 80);
    if (d?.auto !== key && !(live && d?.by === "hand")) return { op: "auto", mode: sleeper.id, key, by: "sleep", until: null };
    return null;
  }
  if (live && d?.by === "sleep" && !asleep) return { op: "off" };
  if (live) return null;   // on by hand or by a schedule already: leave it
  for (const m of modes) {
    const w = scheduleWindow(m.schedule, now, tz);
    if (!w) continue;
    const key = `sched:${m.id}:${w.start}`;
    if (d?.auto === key) continue;
    return { op: "auto", mode: m.id, key, by: "schedule", until: new Date(w.end).toISOString() };
  }
  return null;
}

/** When a mode pressed now would end by itself (ISO), from its length. */
export function modeUntil(m: FocusMode, now = Date.now(), tz?: string): string | null {
  if (m.length === "hour") return inAnHour(now);
  if (m.length === "morning") return tomorrowMorning(now, tz);
  return null;
}

/** One hour from now. */
export const inAnHour = (now = Date.now()) => new Date(now + 3600_000).toISOString();

/** Tomorrow at 8 in the morning in the developer's home time zone (falls back to the device's own). */
export function tomorrowMorning(now = Date.now(), tz?: string, hour = 8): string {
  const zone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  // The wall clock in that zone right now, and how far it is from UTC.
  const parts = (t: number) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
    return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour"), mi: g("minute"), s: g("second") };
  };
  const offsetAt = (t: number) => { const w = parts(t); return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000; };
  const w = parts(now);
  // Before 4 in the morning "tomorrow" still means this coming morning (the developer works nights).
  const addDays = w.h < 4 ? 0 : 1;
  const wall = Date.UTC(w.y, w.mo - 1, w.d + addDays, hour, 0, 0);
  // The zone's offset at that morning, not now: the clocks may change overnight.
  const guess = wall - offsetAt(now);
  return new Date(wall - offsetAt(guess)).toISOString();
}

/** How long a muted kind has been held between `from` and `now` (ms): the overlap with the last quiet stretch.
 *  A chat card's "gone by itself after 3 hours" clock skips this, so a long DND never loses one. */
export function dndHeldMs(d: Dnd | undefined | null, kind: DndKind, from: number, now = Date.now()): number {
  if (!d?.since || (d.pass || []).includes(kind)) return 0;
  const a = ms(d.since);
  let b = d.on ? now : ms(d.offAt);
  const u = ms(d.until);
  if (Number.isFinite(u)) b = Math.min(b, u);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.min(b, now) - Math.max(a, from));
}

/** Which distraction a pop-up card is, from its id and tone. null: never muted (VPN alarms, private mode, notes). */
export function cardKind(id: string, tone?: string): DndKind | null {
  if (id.startsWith("m:")) return "mail";
  if (id.startsWith("c:")) return "chats";
  if (id.startsWith("n:")) return "leads";
  if (id.startsWith("g:")) return "gsquad";   // a G Squad message card (core/squadnotify.ts)
  if (id === "private-ask" || tone === "notes" || id === "net-vpn" || id.startsWith("nl:")) return null;
  if (id.startsWith("eod") || id.startsWith("ar:") || id.startsWith("net-")) return "system";
  // Meeting alerts (core/meetalerts.ts): booked, accepted, declined, a lead's message, 10 minutes before.
  if (/^m[abdms]:/.test(id)) return "meetings";
  return null;
}

/** What a native shell needs (ps-mac DND.swift, ps-gos Notifier.kt): on, until when (ms, 0 = until turned off),
 *  and which distractions are muted on that device right now. */
export function dndNative(d: Dnd | undefined | null, now = Date.now(), device: "mac" | "phone" = "mac") {
  const on = dndActive(d, now);
  const mute: Partial<Record<DndKind, boolean>> = {};
  for (const x of DND_KINDS) mute[x.k] = on && dndMutes(d, x.k, now, device);
  return { on, until: dndEndsAt(d, now), mute };
}

/** The line under the pop-up's title: "On until 15:30", "On until tomorrow 08:00", "On until you turn it off". */
export function dndUntilText(d: Dnd | undefined | null, now = Date.now(), locale?: string): string {
  const end = dndEndsAt(d, now);
  if (!end) return "Until you turn it off";
  const t = new Date(end).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const sameDay = new Date(end).toDateString() === new Date(now).toDateString();
  return sameDay ? `Until ${t}` : `Until tomorrow ${t}`;
}

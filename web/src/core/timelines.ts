// Timelines (V1.43): the countdowns in the Tab list. Everything here is plain logic with no React and no
// imports, so the Mac, the website and the phone count the same way and the unit tests can run it
// (tests/timelines.test.ts). The panel itself is views/Timelines.tsx.
//
// A timeline has a kind (Event, Birthday, Anniversary, Wedding, Trip, Deadline, Holiday, Custom). Birthdays and
// anniversaries come back every year by themselves and count the age or the years ("Mum turns 60"). Old
// timelines from before V1.43 have no kind: they are Events, and keep working exactly as before.
import type { TimelineItem, TimelineKind } from "./model";

export const DAY = 86400000;
export const MAX_TIMELINES = 100;

export type KindInfo = {
  id: TimelineKind; label: string; hint: string; colour: string; repeat: boolean;
  nameLabel: string; namePh: string; dateLabel: string;
};
/** The kinds, in the order the picker shows them. colour is the card's own colour. */
export const KINDS: KindInfo[] = [
  { id: "event", label: "Event", hint: "A concert, a party, a launch", colour: "#7C8CFF", repeat: false, nameLabel: "What is happening?", namePh: "Concert", dateLabel: "Date" },
  { id: "birthday", label: "Birthday", hint: "Every year, with the age", colour: "#FF6FAE", repeat: true, nameLabel: "Whose birthday?", namePh: "Mum", dateLabel: "Date of birth" },
  { id: "anniversary", label: "Anniversary", hint: "Every year, counts the years", colour: "#FF5A6E", repeat: true, nameLabel: "What are you celebrating?", namePh: "Our wedding", dateLabel: "The day it started" },
  { id: "wedding", label: "Wedding", hint: "Someone's big day", colour: "#E8C468", repeat: false, nameLabel: "Whose wedding?", namePh: "Sam and Alex", dateLabel: "Wedding day" },
  { id: "trip", label: "Trip", hint: "A holiday or a journey", colour: "#33C3E6", repeat: false, nameLabel: "Where to?", namePh: "Tokyo", dateLabel: "You leave on" },
  { id: "deadline", label: "Deadline", hint: "Something that is due", colour: "#FF8A3D", repeat: false, nameLabel: "What is due?", namePh: "Tax return", dateLabel: "Due on" },
  { id: "holiday", label: "Holiday", hint: "Christmas, Diwali, Eid", colour: "#4CD07D", repeat: true, nameLabel: "Which holiday?", namePh: "Christmas", dateLabel: "Date" },
  { id: "custom", label: "Custom", hint: "Anything else", colour: "#B07CFF", repeat: false, nameLabel: "Name it", namePh: "First day at the gym", dateLabel: "Date" },
];
const KIND_IDS = new Set<string>(KINDS.map((k) => k.id));
export const kindInfo = (k: TimelineKind): KindInfo => KINDS.find((x) => x.id === k) ?? KINDS[0];
/** No kind (a timeline from before V1.43) or one this build does not know: an Event. */
export const kindOf = (i: Pick<TimelineItem, "kind">): TimelineKind => (i.kind && KIND_IDS.has(i.kind) ? i.kind : "event");
/** Comes back every year: what you chose, or the kind's own default (birthdays and anniversaries do). */
export const repeatsOf = (i: Pick<TimelineItem, "kind" | "repeat">): boolean => (typeof i.repeat === "boolean" ? i.repeat : kindInfo(kindOf(i)).repeat);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const okDate = (s: unknown): s is string => typeof s === "string" && ISO.test(s) && !Number.isNaN(Date.parse(s));
export const okTime = (s: unknown): s is string => typeof s === "string" && HM.test(s);
export const isoOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const startOf = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m, d, h, mi).getTime();   // local time
export const dayStart = (t: number) => { const d = new Date(t); return startOf(d.getFullYear(), d.getMonth(), d.getDate()); };
const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The moment one date (and time) happens in year y. 29 Feb falls on 28 Feb in other years. */
function inYear(month: number, day: number, y: number, time?: string) {
  const d = month === 2 && day === 29 && !leap(y) ? 28 : day;
  const [h, mi] = okTime(time) ? time.split(":").map(Number) : [0, 0];
  return startOf(y, month - 1, d, h, mi);
}

/** Where a timeline is now: the moment it counts to (at), where its bar starts (from, or null), and for a yearly one
 *  how many years it will be (n: the age a birthday turns, the anniversary's number; 0 or less means none). */
export type When = { at: number; from: number | null; n: number; repeat: boolean };
export function whenOf(i: Pick<TimelineItem, "date" | "time" | "kind" | "repeat" | "createdAt">, now: number): When | null {
  if (!okDate(i.date)) return null;
  const [y0, m, d] = i.date.split("-").map(Number);
  const time = okTime(i.time) ? i.time : undefined;
  if (!repeatsOf(i)) {
    const at = inYear(m, d, y0, time);
    const made = Date.parse(i.createdAt);
    return { at, from: Number.isFinite(made) && made < at ? made : null, n: 0, repeat: false };
  }
  // Yearly: this year's, or next year's once this year's day is over. Never before the first one.
  let y = Math.max(y0, new Date(now).getFullYear());
  if (dayStart(inYear(m, d, y, time)) + DAY <= now) y += 1;
  const at = inYear(m, d, y, time);
  return { at, from: y > y0 ? inYear(m, d, y - 1, time) : null, n: y - y0, repeat: true };
}

/** upcoming: still to come. today: its moment has come and its day is not over yet. past: a one off that is over. */
export type Phase = "upcoming" | "today" | "past";
export function phaseOf(at: number, now: number): Phase {
  if (at > now) return "upcoming";
  return now < dayStart(at) + DAY ? "today" : "past";
}

export const ordinal = (n: number) => {
  const t = n % 100, o = n % 10;
  return `${n}${t >= 11 && t <= 13 ? "th" : o === 1 ? "st" : o === 2 ? "nd" : o === 3 ? "rd" : "th"}`;
};
const possessive = (name: string) => (/^(you|me)$/i.test(name) ? "Your" : `${name}'s`);
const has = (name: string, word: string) => new RegExp(`\\b${word}`, "i").test(name);

/** The words on a card: the title, and the line under the countdown (the age, the years). */
export function wordsOf(kind: TimelineKind, name: string, n: number): { title: string; sub: string | null; short: string } {
  const you = /^(you|me)$/i.test(name);
  switch (kind) {
    case "birthday": {
      const title = has(name, "birthday") ? name : `${possessive(name)} birthday`;
      const sub = n > 0 ? (you ? `You turn ${n}` : `Turns ${n}`) : null;
      return { title, sub, short: n > 0 ? (you ? `You turn ${n}` : `${name} turns ${n}`) : title };
    }
    case "anniversary": {
      const title = has(name, "anniversary") ? name : /^(our|my)\b/i.test(name) || /wedding$/i.test(name) ? `${name} anniversary` : `${possessive(name)} anniversary`;
      const sub = n > 0 ? `${ordinal(n)} anniversary` : null;
      return { title, sub, short: n > 0 ? `${title}, ${ordinal(n)}` : title };
    }
    case "wedding": {
      const title = has(name, "wedding") ? name : `${possessive(name)} wedding`;
      return { title, sub: null, short: title };
    }
    case "trip": {
      const title = has(name, "trip") || /^(to|flight)\b/i.test(name) ? name : `Trip to ${name}`;
      return { title, sub: null, short: title };
    }
    default:
      return { title: name, sub: null, short: name };
  }
}

/** One countdown on the panel: your own (custom) or built in (month end, your birthday, New Year, holidays). */
export type Line = {
  id: string; kind: TimelineKind; name: string; title: string; sub: string | null; short: string;
  at: number; from: number | null; n: number; repeat: boolean; time?: string; custom: boolean; note?: string;
};

function lineOf(i: TimelineItem, now: number): Line | null {
  const w = whenOf(i, now);
  if (!w) return null;
  const kind = kindOf(i);
  const name = i.title.trim() || kindInfo(kind).label;
  return { id: i.id, kind, name, ...wordsOf(kind, name, w.n), at: w.at, from: w.from, n: w.n, repeat: w.repeat, time: okTime(i.time) ? i.time : undefined, custom: true };
}

// ---------- built in: kept to the month end, your birthday, New Year, Halloween and Thanksgiving ----------
const nthDow = (y: number, m: number, dow: number, n: number) => { const first = new Date(y, m, 1).getDay(); return 1 + ((dow - first + 7) % 7) + (n - 1) * 7; };
const HOLIDAYS: { id: string; title: string; tag: string; on: (y: number) => [number, number] }[] = [
  { id: "h-halloween", title: "Halloween", tag: "US and UK", on: () => [9, 31] },
  { id: "h-thanksgiving", title: "Thanksgiving", tag: "US", on: (y) => [10, nthDow(y, 10, 4, 4)] },
];
export function builtIns(now: number, birthday?: string | null): Line[] {
  const d = new Date(now);
  const y = d.getFullYear(), m = d.getMonth();
  const base = (id: string, kind: TimelineKind, title: string, at: number, from: number | null, note?: string): Line =>
    ({ id, kind, name: title, title, sub: null, short: title, at, from, n: 0, repeat: kind === "holiday", custom: false, note });
  const out: Line[] = [
    base("month", "deadline", `End of ${d.toLocaleDateString("en-GB", { month: "long" })}`, startOf(y, m + 1, 1), startOf(y, m, 1), "Midnight, the last day"),
    base("year", "holiday", `New Year ${y + 1}`, startOf(y + 1, 0, 1), startOf(y, 0, 1)),
    ...HOLIDAYS.map((h) => {
      const at0 = (yy: number) => { const [hm, hd] = h.on(yy); return startOf(yy, hm, hd); };
      const yy = at0(y) + DAY <= now ? y + 1 : y;
      return base(h.id, "holiday", h.title, at0(yy), at0(yy - 1), h.tag);
    }),
  ];
  if (okDate(birthday)) {
    const w = whenOf({ date: birthday, kind: "birthday", createdAt: "" }, now);
    if (w) out.splice(1, 0, { id: "birthday", kind: "birthday", name: "You", ...wordsOf("birthday", "You", w.n), at: w.at, from: w.from, n: w.n, repeat: true, custom: false });
  }
  return out;
}

/** Every countdown to show: the built in ones you have not removed, then yours. */
export function allLines(items: TimelineItem[], now: number, birthday?: string | null, hidden?: string[]): Line[] {
  const gone = new Set(hidden || []);
  const mine = items.map((i) => lineOf(i, now)).filter((l): l is Line => !!l);
  return [...builtIns(now, birthday).filter((l) => !gone.has(l.id)), ...mine];
}

/** The order on the panel. No order of your own (you never dragged, or chose Soonest): the soonest first, today's at
 *  the very top, then the ones that are over (the latest first). Your order (from dragging): yours first, anything
 *  new joins after it, soonest first. */
export function sortLines(lines: Line[], now: number, order?: string[] | null): Line[] {
  const soon = (a: Line, b: Line) => {
    const pa = phaseOf(a.at, now), pb = phaseOf(b.at, now);
    const rank = (p: Phase) => (p === "today" ? 0 : p === "upcoming" ? 1 : 2);
    if (rank(pa) !== rank(pb)) return rank(pa) - rank(pb);
    return pa === "past" ? b.at - a.at : a.at - b.at;
  };
  const bySoon = [...lines].sort(soon);
  if (!order?.length) return bySoon;
  const r = new Map(order.map((id, i) => [id, i]));
  return [...bySoon].sort((a, b) => (r.get(a.id) ?? 1e6 + bySoon.indexOf(a)) - (r.get(b.id) ?? 1e6 + bySoon.indexOf(b)));
}

/** The next one still to come (or today's): the small Timelines pill shows it. */
export const nextLine = (lines: Line[], now: number) => sortLines(lines, now).find((l) => phaseOf(l.at, now) !== "past") ?? null;

/** The countdown in words: big number and its unit ("18 days"), or hours and minutes on the last day. */
export function countOf(at: number, now: number): { big: string; unit: string; hms: string } {
  const s = Math.max(0, Math.floor((at - now) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p2 = (x: number) => String(x).padStart(2, "0");
  const hms = `${p2(h)}:${p2(m)}:${p2(sec)}`;
  if (d >= 1) return { big: String(d), unit: d === 1 ? "day" : "days", hms };
  if (h >= 1) return { big: String(h), unit: h === 1 ? "hour" : "hours", hms };
  return { big: String(Math.max(1, Math.ceil(s / 60))), unit: "min", hms };
}
/** The pill: "Mum turns 60 in 12d", "Halloween today". */
export function pillText(l: Line, now: number): string {
  const ph = phaseOf(l.at, now);
  if (ph === "today") return `${l.title} today`;
  const s = Math.max(0, l.at - now), d = Math.floor(s / DAY), h = Math.floor(s / 3600000);
  return `${l.short} in ${d >= 1 ? `${d}d` : h >= 1 ? `${h}h` : `${Math.max(1, Math.ceil(s / 60000))}m`}`;
}
/** How far along: 0 to 100 from where the bar starts to the day, or null when there is no start. */
export function progressOf(l: Pick<Line, "at" | "from">, now: number): number | null {
  if (l.from == null || l.at <= l.from) return null;
  return Math.min(100, Math.max(0, ((now - l.from) / (l.at - l.from)) * 100));
}

/** A list from another device or an older build, checked: bad rows dropped, known fields kept, at most 100. */
export function cleanTimelines(list: unknown): TimelineItem[] {
  if (!Array.isArray(list)) return [];
  const out: TimelineItem[] = [];
  for (const raw of list) {
    const i = raw as Partial<TimelineItem> | null;
    if (!i || typeof i.id !== "string" || typeof i.title !== "string" || !okDate(i.date)) continue;
    const t: TimelineItem = { id: i.id.slice(0, 80), title: i.title.slice(0, 80), date: i.date, createdAt: typeof i.createdAt === "string" && i.createdAt ? i.createdAt.slice(0, 40) : new Date().toISOString() };
    if (typeof i.kind === "string" && KIND_IDS.has(i.kind)) t.kind = i.kind;
    if (okTime(i.time)) t.time = i.time;
    if (typeof i.repeat === "boolean") t.repeat = i.repeat;
    out.push(t);
    if (out.length >= MAX_TIMELINES) break;
  }
  return out;
}

/** Your own copy of a built in countdown (edit one: the copy takes its place and the built in one is hidden). */
export function copyOfBuiltIn(l: Line, birthday: string | null | undefined, id: string, nowIso: string): TimelineItem {
  if (l.id === "birthday" && okDate(birthday)) return { id, title: "You", date: birthday, createdAt: nowIso, kind: "birthday", repeat: true };
  return { id, title: l.title, date: isoOf(l.at), createdAt: nowIso, kind: l.kind, repeat: l.kind === "holiday" && l.id !== "h-thanksgiving" };
}

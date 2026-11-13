// Meeting alerts (the developer, 18 Oct 2026): pop-up cards in PS about calls with leads.
//   BOOKED   a lead booked a call, or accepted (or declined) the invite.
//   MESSAGE  a lead wrote (Instantly or Gmail) while a call with them is coming up in the next
//            few hours or has just started. The developer: no-shows "usually email me like twenty minutes or
//            an hour beforehand to say I can't make the call today or they need to reschedule".
//            Messages that read as a cancel or reschedule get the strongest look.
//   SOON     the call starts in 10 minutes, with the invite state (flagged if never accepted).
// Only follow-up leads count (matched by address), plus the people invited to a lead call, so
// newsletters and other mail never raise one.
//
// Pure: no vault, no clock, no storage. ps.ts (the PS main window) feeds it the calendar snapshot,
// the leads and the messages, keeps the small "already told" state on this Mac and hands the cards
// to the native pop-up. Read only: nothing here sends, answers or changes anything (Rule Zero).
import type { CalEvent } from "./model";

export interface Lead { name: string; company?: string | null; emails: string[]; tz?: string | null }
export interface LeadMsg {
  id: string; from: string; fromName?: string | null; at: string; channel: "instantly" | "gmail";
  subject?: string | null; text: string; url?: string | null;
}
/** privacy: when a meeting starts, ask "Start private mode?" (src/meetwatch.ts). Before 29 Oct 2026 it hid card details during every meeting. */
export interface MeetPrefs { booked: boolean; msg: boolean; soon: boolean; privacy: boolean }
export const MEET_DEFAULTS: MeetPrefs = { booked: true, msg: true, soon: true, privacy: true };

/** What PS keeps on this Mac between runs: ids and dates only, never names or text. */
export interface MeetSeen {
  started: boolean;                              // false until the first run has taken its baseline
  events: Record<string, Record<string, string>>; // event id -> attendee address -> invite state
  soon: string[];                                // event ids already reminded
  msgs: string[];                                // message ids already handled
  msgAt: string;                                 // only messages newer than this count
}
export const emptySeen = (now: Date): MeetSeen => ({ started: false, events: {}, soon: [], msgs: [], msgAt: now.toISOString() });

export type Tone = "booked" | "declined" | "msg" | "cancel" | "soon" | "soon-warn";
export interface MeetCard {
  id: string;                     // at most 40 characters, one card per id
  tone: Tone;
  title: string;                  // "Jane Doe just booked a call"
  sub: string;                    // "Tue 21 Oct, 4:00 PM Dubai · 8:00 AM ET for them"
  body?: string;                  // their first lines, or the call title and company
  callAt?: string | null;         // the call's start (the card counts down to it)
  url?: string | null;            // open the thread (Gmail or Instantly)
  join?: string | null;           // the call's link
  discreet: boolean;              // private mode is on: one plain line, no names or text, until clicked
  discreetText: string;           // "Message from a lead about this call"
  sound: "booked" | "alert" | "soon";
}

const LEAD_TITLES = /shopify redesign|content creation/i;
/** "can't make it", "reschedule", "running late", "something came up"... */
export const CANCEL_WORDS = /\b(can'?t|cannot|can not|won'?t|unable to|not able to)\b[^.!?\n]{0,40}\b(make|attend|join|do|come)\b|\bre-?schedul|\bpostpone|\bpush (it|this|the call|our call|back)|\bmove (it|the call|our call|this)|\brunning (late|behind)\b|\bsomething (has )?came? up\b|\bcancel|\bdelay|\banother time\b|\bdifferent time\b|\bnot today\b|\bemergency\b|\bsick\b|\bunwell\b/i;

const lc = (s?: string | null) => (s || "").trim().toLowerCase();
const isLeadCall = (e: CalEvent, leadAddrs: Set<string>) =>
  !e.allDay && !!e.start && (LEAD_TITLES.test(e.title || "") || e.attendees.some((a) => !a.self && leadAddrs.has(lc(a.email))));
/** Everyone invited except the developer himself. */
const guests = (e: CalEvent) => e.attendees.filter((a) => !a.self);
/** The developer made the event (his own invite to the prospect), not the prospect or Calendly. */
const redMadeIt = (e: CalEvent) => e.attendees.some((a) => a.self && a.organizer);

/** 32 bit FNV-1a, so long event ids still fit the 40 character card id. */
export function shortHash(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions) {
  const k = tz + JSON.stringify(opts);
  let f = fmtCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, ...opts }); fmtCache.set(k, f); }
  return f;
}
const US: Record<string, string> = { EST: "ET", EDT: "ET", CST: "CT", CDT: "CT", MST: "MT", MDT: "MT", PST: "PT", PDT: "PT", AKST: "AKT", AKDT: "AKT", HST: "HT", HDT: "HT" };
function zoneShort(tz: string, at: Date) {
  const z = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value || "";
  return US[z] || z;
}
const clock = (at: Date, tz: string) => fmt(tz, { hour: "numeric", minute: "2-digit", hour12: true }).format(at).replace(/\s?(am|pm)$/i, (m) => " " + m.trim().toUpperCase());
function dayWord(at: Date, now: Date, tz: string) {
  const d = (x: Date) => fmt(tz, { year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
  if (d(at) === d(now)) return "Today";
  if (d(at) === d(new Date(now.getTime() + 864e5))) return "Tomorrow";
  return fmt(tz, { weekday: "short", day: "numeric", month: "short" }).format(at);
}
/** "Today 4:00 PM Dubai · 8:00 AM ET for them". */
export function whenLine(at: Date, now: Date, homeTz: string, homeName: string, theirTz?: string | null) {
  let s = `${dayWord(at, now, homeTz)} ${clock(at, homeTz)} ${homeName}`;
  if (theirTz && theirTz !== homeTz) {
    const theirDay = dayWord(at, now, theirTz), mine = dayWord(at, now, homeTz);
    s += ` · ${theirDay !== mine ? theirDay + " " : ""}${clock(at, theirTz)} ${zoneShort(theirTz, at)} for them`;
  }
  return s;
}
/** "in 42 min", "in 2 h 5 min", "started 6 min ago". */
export function untilText(at: Date, now: Date) {
  const m = Math.round((at.getTime() - now.getTime()) / 60000);
  if (m < 0) return `started ${-m} min ago`;
  if (m < 1) return "starting now";
  if (m < 60) return `in ${m} min`;
  return `in ${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}
/** The first few sentences, without quoted history or signatures. */
export function firstLines(text: string, n = 3) {
  const cut = (text || "").split(/\n\s*(>|On .{5,80}wrote:|-{2,}\s*Original|From:|Sent from my)/)[0];
  const t = cut.replace(/\s+/g, " ").trim();
  const parts = t.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || [t];
  return parts.slice(0, n).join("").trim().slice(0, 400);
}
const titleCase = (s: string) => s.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** A remembered call that is no longer in the snapshot: kept for 2 days, then forgotten. */
const forgotten = new Map<string, number>();
function keepUntil(id: string, events: CalEvent[], t: number) {
  if (events.some((e) => e.id === id)) return true;
  if (!forgotten.has(id)) forgotten.set(id, t);
  return t - forgotten.get(id)! < 2 * 864e5;
}

export interface MeetInput {
  now: Date; events: CalEvent[]; leads: Lead[]; msgs: LeadMsg[]; seen: MeetSeen; prefs: MeetPrefs;
  homeTz: string; homeName: string;
  /** The developer's private mode (settings.privateMode, the mask on the Meetings panel): cards arrive discreet. */
  privateMode?: boolean;
}

/** One run: the cards to show now and the new "already told" state. */
export function meetAlerts(inp: MeetInput): { cards: MeetCard[]; seen: MeetSeen; inMeeting: boolean } {
  const { now, events, leads, msgs, prefs, homeTz, homeName } = inp;
  const seen: MeetSeen = { ...inp.seen, events: { ...inp.seen.events }, soon: [...inp.seen.soon], msgs: [...inp.seen.msgs] };
  const t = now.getTime();
  const byAddr = new Map<string, Lead>();
  for (const l of leads) for (const e of l.emails) if (lc(e)) byAddr.set(lc(e), l);
  const leadAddrs = new Set(byAddr.keys());
  const calls = events.filter((e) => isLeadCall(e, leadAddrs));
  // Any timed meeting going on right now (screen sharing risk).
  const inMeeting = events.some((e) => !e.allDay && e.start && e.end && Date.parse(e.start) <= t && Date.parse(e.end) > t);
  const cards: MeetCard[] = [];
  const person = (e: CalEvent) => {
    const g = guests(e);
    const lead = g.map((a) => byAddr.get(lc(a.email))).find(Boolean) || null;
    const a = g.find((x) => byAddr.has(lc(x.email))) || g[0];
    const name = lead?.name || a?.name || (a ? titleCase(a.email.split("@")[0]) : "A lead");
    return { lead, attendee: a, name };
  };
  // Private mode only: a meeting alone no longer hides anything (the developer, 29 Oct 2026: many calls never share a screen).
  const card = (c: Omit<MeetCard, "discreet" | "discreetText"> & { discreetText: string }): MeetCard => ({ ...c, discreet: !!inp.privateMode });

  // BOOKED, accepted or declined.
  const nextEvents: MeetSeen["events"] = {};
  for (const e of calls) {
    const rs: Record<string, string> = {};
    for (const a of guests(e)) rs[lc(a.email)] = a.rsvp || "needsAction";
    nextEvents[e.id] = rs;
    const start = Date.parse(e.start!);
    if (!seen.started || start < t) continue;
    const before = seen.events[e.id];
    const p = person(e);
    const sub = whenLine(new Date(start), now, homeTz, homeName, p.lead?.tz);
    const body = [e.title, p.lead?.company].filter(Boolean).join(" · ");
    const base = { sub, body, callAt: e.start, join: e.link || null, url: null };
    if (!before) {
      // The developer's own invite is not a booking: the card comes when they accept it.
      if (prefs.booked && !redMadeIt(e)) cards.push(card({ ...base, id: `mb:${shortHash(e.id)}`, tone: "booked", title: `${p.name} just booked a call`, sound: "booked", discreetText: "A lead booked a call" }));
      continue;
    }
    for (const [addr, state] of Object.entries(rs)) {
      const was = before[addr];
      if (was === state) continue;
      const who = byAddr.get(addr)?.name || p.name;
      if (state === "accepted" && prefs.booked)
        cards.push(card({ ...base, id: `ma:${shortHash(e.id + addr)}`, tone: "booked", title: `${who} accepted your call`, sound: "booked", discreetText: "A lead accepted a call" }));
      else if (state === "declined" && prefs.msg)
        cards.push(card({ ...base, id: `md:${shortHash(e.id + addr)}`, tone: "declined", title: `${who} declined the call`, sound: "alert", discreetText: "A lead declined a call" }));
    }
  }
  // Calls that left the snapshot stay remembered until their day is over, so an empty or partial
  // calendar refresh never makes old calls look newly booked.
  if (events.length) {
    const keep: MeetSeen["events"] = {};
    for (const [id, v] of Object.entries(seen.events)) if (!nextEvents[id] && (calls.length === 0 || keepUntil(id, events, t))) keep[id] = v;
    seen.events = { ...keep, ...nextEvents };
  }

  // MESSAGE from a lead about a call coming up (next 6 hours) or just started (45 min).
  const msgAt = Date.parse(seen.msgAt) || 0;
  let newest = msgAt;
  for (const m of [...msgs].sort((a, b) => a.at.localeCompare(b.at))) {
    const at = Date.parse(m.at) || 0;
    if (at <= msgAt || seen.msgs.includes(m.id)) continue;
    newest = Math.max(newest, at);
    seen.msgs.push(m.id);
    if (!prefs.msg || !seen.started) continue;
    const from = lc(m.from);
    const lead = byAddr.get(from) || null;
    const mine = new Set(lead ? lead.emails.map(lc) : [from]);
    const call = calls
      .filter((e) => e.attendees.some((a) => mine.has(lc(a.email))) && Date.parse(e.start!) > t - 45 * 60000 && Date.parse(e.start!) < t + 6 * 3600000)
      .sort((a, b) => Date.parse(a.start!) - Date.parse(b.start!))[0];
    if (!call || (!lead && !call.attendees.some((a) => lc(a.email) === from))) continue;   // only leads, only about a call
    const start = new Date(Date.parse(call.start!));
    const name = lead?.name || m.fromName || titleCase(from.split("@")[0]);
    const cancel = CANCEL_WORDS.test(`${m.subject || ""}\n${m.text}`);
    cards.push(card({
      id: `mm:${shortHash(m.id)}`, tone: cancel ? "cancel" : "msg", sound: "alert",
      title: cancel ? `${name} may not make today's ${clock(start, homeTz)} call` : `${name} messaged about the ${clock(start, homeTz)} call`,
      sub: `${m.channel === "instantly" ? "Instantly" : "Gmail"}${lead?.company ? ` · ${lead.company}` : ""}`,   // the countdown is its own chip
      body: firstLines(m.text) || m.subject || "", callAt: call.start, url: m.url || null, join: call.link || null,
      discreetText: "Message from a lead about this call",
    }));
  }
  seen.msgAt = new Date(newest || msgAt || t).toISOString();
  seen.msgs = seen.msgs.slice(-300);

  // SOON: 10 minutes before, with the invite state.
  for (const e of calls) {
    const start = Date.parse(e.start!);
    if (start - t > 10 * 60000 || start - t < -2 * 60000 || seen.soon.includes(e.id)) continue;
    seen.soon.push(e.id);
    if (!prefs.soon || !seen.started) continue;
    const p = person(e);
    const state = p.attendee?.rsvp || "needsAction";
    const warn = state !== "accepted";
    cards.push(card({
      id: `ms:${shortHash(e.id)}`, tone: warn ? "soon-warn" : "soon", sound: "soon",
      title: `Call with ${p.name} ${untilText(new Date(start), now)}`,
      sub: whenLine(new Date(start), now, homeTz, homeName, p.lead?.tz),
      body: `${state === "accepted" ? "They accepted the invite" : state === "declined" ? "They DECLINED the invite" : state === "tentative" ? "They said maybe" : "They never accepted the invite"}${e.title ? ` · ${e.title}` : ""}`,
      callAt: e.start, join: e.link || null, url: null, discreetText: "A call starts soon",
    }));
  }
  seen.soon = seen.soon.slice(-200);
  seen.started = true;
  return { cards, seen, inMeeting };
}

/** "Start private mode?" (the developer, 29 Oct 2026): the real meeting on right now (people or a video link)
 *  that PS has not asked about yet, or null. Never while private mode is on or the question is off. */
export function privateAskFor(events: CalEvent[], now: number, privateMode: boolean, enabled: boolean, asked: string[]): string | null {
  if (privateMode || !enabled) return null;
  const live = events.find((e) => !e.allDay && !!e.start && !!e.end && (!!e.link || e.attendees.some((a) => !a.self))
    && Date.parse(e.start) <= now && Date.parse(e.end) > now && !asked.includes(e.id + e.start));
  return live ? live.id + live.start : null;
}

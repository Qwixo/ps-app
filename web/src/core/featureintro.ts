// Feature intros (PS 1.60, the developer 14 Nov 2026: "every future release introduces its big new features from the island").
// A small LIST of intros (INTROS below) and the rules for when one may show. Pure rules only (no React, no DOM, no clock of its
// own), so tests/featureintro.test.ts checks every rule. The one piece that draws them is views/FeatureIntro.tsx; the Mac's
// island part (the squeeze and the chime) is Sources/IslandIntroCore.swift and SetupIsland.intro.
//
// ADD THE NEXT INTRO = add one entry to INTROS. Nothing else (docs/feature-intros.md says how).
//
import { cleanAnchor, type IslandAnchor } from "./whatsnew.ts";
import { SR_INTRO } from "./screenrecmeet.ts";

// The rules (all in nextIntro):
//  - Not right after an update: only after about 1 minute of ACTIVE use of the to do list on this version (idle time does not
//    count, see addActive).
//  - Only when nothing else is on the island, and never in Sleep mode, Sentry mode, Do Not Disturb, while sharing the screen or
//    over a full screen app. When it cannot show it waits for the next free moment (the answer says why).
//  - Only to people the intro still applies to (for WhatsApp: not linked yet). Once they did it, never again.
//  - "Later" (or Esc) asks once more 3 days later, then never. "Show me" is the end of it: the guide stays in Settings.
//  - One intro at a time, at least one day after the last one.

/** One feature intro: its words, its mark, and what "Show me" opens. */
export interface IntroDef {
  /** Never reused or renamed (the saved record is keyed by it). */
  id: string;
  /** The first line the island says. */
  headline: string;
  /** The question, with the two buttons. */
  ask: string;
  show: string;
  later: string;
  /** Which picture swoops in (views/FeatureIntro.tsx MARKS). */
  mark: "whatsapp" | "spark" | "record";
  /** What "Show me" opens (views/FeatureIntro.tsx GUIDES). Without one, `steps` are shown in a small generic guide. */
  guide?: "wa-link";
  /** A few plain steps for the generic guide (one short sentence each). */
  steps?: string[];
  /** A link to a demo or a page about it (opened from the generic guide). */
  demo?: string;
  /** Where the guide stays reachable for good. */
  settings: string;
}

export const INTROS: IntroDef[] = [
  {
    id: "whatsapp",
    headline: "WhatsApp messages now supported",
    ask: "Did you know you can link WhatsApp?",
    show: "Show me",
    later: "Later",
    mark: "whatsapp",
    guide: "wa-link",
    settings: "Settings, WhatsApp settings, Link WhatsApp",
  },
  {
    // PS 1.60 (pull request 12b). Only for people who said No or have not answered (views/FeatureIntro.tsx DONE_PROBES, core/screenrecmeet.ts introAudience).
    id: "screenrec",
    headline: SR_INTRO.headline,
    ask: SR_INTRO.ask,
    show: "Show me",
    later: "Later",
    mark: "record",
    steps: [...SR_INTRO.steps],
    settings: SR_INTRO.settings,
  },
];

/** The widths of the intro card and the guide grown out of the island (points). */
export const CARD_W = 340, GUIDE_W = 640;
export const ACTIVE_NEEDED_MS = 60_000;
/** Input older than this is idle: the clock stops. */
export const IDLE_MS = 30_000;
/** One clock tick never adds more than this (a Mac that slept or a stalled page must not count as use). */
export const TICK_CAP_MS = 10_000;
export const LATER_AFTER_MS = 3 * 86_400_000;
export const GAP_MS = 86_400_000;

export interface IntroRec { n: number; at: number; later?: boolean; closed?: boolean }
export interface IntroState { ver: string; activeMs: number; lastAt: number; recs: Record<string, IntroRec> }
export const emptyState = (): IntroState => ({ ver: "", activeMs: 0, lastAt: 0, recs: {} });

const num = (v: unknown, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? v : 0);
/** What was saved, cleaned (anything odd is forgotten, never trusted). */
export function cleanState(v: unknown): IntroState {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const recs: Record<string, IntroRec> = {};
  const r = (o.recs && typeof o.recs === "object" ? o.recs : {}) as Record<string, unknown>;
  for (const id of Object.keys(r).slice(0, 50)) {
    const x = (r[id] && typeof r[id] === "object" ? r[id] : {}) as Record<string, unknown>;
    const n = Math.min(5, Math.floor(num(x.n, 1000)));
    if (n < 1) continue;
    recs[id] = { n, at: num(x.at, 1e14), ...(x.later === true ? { later: true } : {}), ...(x.closed === true ? { closed: true } : {}) };
  }
  return { ver: typeof o.ver === "string" ? o.ver.slice(0, 20) : "", activeMs: num(o.activeMs, 1e9), lastAt: num(o.lastAt, 1e14), recs };
}

/** Counts a little active use. `idleMs`: how long since the last key, click or scroll. Only counts when the to do list is on
 *  screen (`listShown`) and the person is not idle. A new version starts the count again: "after an update". */
export function addActive(s: IntroState, a: { version: string; deltaMs: number; idleMs: number; listShown: boolean }): IntroState {
  const fresh = a.version !== s.ver;
  const base = fresh ? { ...s, ver: a.version, activeMs: 0 } : s;
  if (!a.listShown || a.idleMs > IDLE_MS || !(a.deltaMs > 0)) return base;
  return { ...base, activeMs: Math.min(base.activeMs + Math.min(a.deltaMs, TICK_CAP_MS), ACTIVE_NEEDED_MS * 100) };
}

export interface IntroFacts {
  now: number;
  /** Intros the person already did (WhatsApp linked) or that cannot apply to them (no own project to link). */
  notForThem: ReadonlySet<string> | readonly string[];
  /** Another island card (meeting, reminder, stand up, What's new, Welcome back, update, any other) is on it or waiting. */
  islandBusy: boolean;
  sleep: boolean;
  sentry: boolean;
  dnd: boolean;
  sharing: boolean;
  fullScreen: boolean;
  /** The feature switch (features.json "feature-intros") is off. */
  off: boolean;
}

export type Wait = "off" | "notActive" | "gap" | "busy" | "sleep" | "sentry" | "dnd" | "sharing" | "fullScreen";
export type Choice = { show: IntroDef } | { wait: Wait } | null;

const has = (s: IntroFacts["notForThem"], id: string) => Array.isArray(s) ? s.includes(id) : (s as ReadonlySet<string>).has(id);

/** Could this intro still be shown to this person (ignoring the clock and the island)? Never after done, closed, or a second Later. */
export function eligible(d: IntroDef, s: IntroState, f: Pick<IntroFacts, "notForThem">, now: number): boolean {
  if (has(f.notForThem, d.id)) return false;
  const r = s.recs[d.id];
  if (!r) return true;
  if (r.closed || r.n >= 2) return false;
  // shown once and answered Later (or closed by Esc, or the page went away): asks once more after 3 days
  return now - r.at >= LATER_AFTER_MS;
}

/** The one intro to show now, or why not yet, or null when nothing is left to show (ever). */
export function nextIntro(s: IntroState, f: IntroFacts, defs: IntroDef[] = INTROS): Choice {
  const d = defs.find((x) => eligible(x, s, f, f.now));
  if (!d) return null;
  if (f.off) return { wait: "off" };
  if (s.activeMs < ACTIVE_NEEDED_MS) return { wait: "notActive" };
  if (s.lastAt && f.now - s.lastAt < GAP_MS) return { wait: "gap" };
  // the places an intro must never come: the person is asleep, away, in a call or watching something
  if (f.sleep) return { wait: "sleep" };
  if (f.sentry) return { wait: "sentry" };
  if (f.dnd) return { wait: "dnd" };
  if (f.sharing) return { wait: "sharing" };
  if (f.fullScreen) return { wait: "fullScreen" };
  if (f.islandBusy) return { wait: "busy" };
  return { show: d };
}

/** It was drawn. Counts at once and starts as "Later", so a page that goes away mid intro still asks only once more. */
export function markShown(s: IntroState, id: string, now: number): IntroState {
  const r = s.recs[id];
  return { ...s, lastAt: now, recs: { ...s.recs, [id]: { n: Math.min(5, (r?.n ?? 0) + 1), at: now, later: true } } };
}
/** The answer. "show": the end of it for good. "later": the second time it is the end too (never a third). */
export function answer(s: IntroState, id: string, a: "show" | "later"): IntroState {
  const r = s.recs[id];
  if (!r) return s;
  const closed = a === "show" || r.n >= 2;
  return { ...s, recs: { ...s.recs, [id]: { n: r.n, at: r.at, ...(closed ? { closed: true } : { later: true }) } } };
}

/** How long to wait before looking again, by reason (ms). A blocked moment is checked again soon, a clock reason later. */
export function recheckMs(w: Wait): number {
  switch (w) {
    case "notActive": return 15_000;
    case "gap": return 30 * 60_000;
    case "off": return 10 * 60_000;
    default: return 60_000;
  }
}

/** Reasons the Mac's island may answer with instead of "go" (Sources/IslandIntroCore.swift). */
export function macBlocked(v: unknown): Wait | null {
  return v === "sleep" || v === "sentry" || v === "sharing" || v === "fullScreen" || v === "off" || v === "busy" ? v : null;
}

/** The person did the thing (WhatsApp is linked): this intro never shows again, whatever the clock says. */
export function retire(s: IntroState, id: string, now: number): IntroState {
  const r = s.recs[id];
  if (r?.closed) return s;
  return { ...s, recs: { ...s.recs, [id]: { n: r?.n ?? 1, at: r?.at ?? now, closed: true } } };
}

/** The Mac's answer to "island:intro": queued behind another card, go (with where the island is, or none when the island
 *  cannot do it and the card is drawn plainly), or blocked with the reason (it asks again at the next free moment). */
export type IntroReply = { phase: "queued" } | { phase: "go"; anchor: IslandAnchor | null } | { phase: "blocked"; why: Wait } | null;
export function introReply(m: unknown): IntroReply {
  const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
  if (o.state === "queued") return { phase: "queued" };
  if (o.state === "go") return { phase: "go", anchor: cleanAnchor(o.rect) };
  if (o.state === "blocked") { const why = macBlocked(o.why); return why ? { phase: "blocked", why } : null; }
  return null;
}

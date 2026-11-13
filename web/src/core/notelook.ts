// Notification cards: a colour and a sound for each kind (V1.36, the developer 5 Nov 2026: "edit like the colour of the
// notifications if they have sound or not and I want to be able to change the sound as well in the settings").
// Settings, Notifications (PS on a Mac): five kinds, each with a card colour (presets or your own), sound on or off,
// and which sound. settings.noteLook, synced like every setting, cleaned here on read and in ps.ts cleanLooks on save.
// Unset is exactly the look and the sounds from before, so nothing changes until the developer picks.
// Where it lands: src/notelook.ts sends the colours to the Mac's card stack ({type:"noteLook"}, ps-mac Toast.swift
// paints them); src/mailcards.ts and src/meetwatch.ts pick the sound for chats, emails, leads and meetings; Toast.swift
// plays the Other alerts sound itself (those cards are made on the Mac). Every sound is made in code, no sound files:
// the same tones play in Settings on the website (ui/sfx.ts) and in PS (ps-mac Sfx.swift, by the native name).
// Colours: one pick makes the whole card (border, the dark gradient, the icon, the line under the title and the
// Remind me in button) the way the built in kinds look, and every text on it is checked for WCAG AA (4.5:1).
import type { Settings } from "./model";
import { contrast, hexRgb, mix, rgbHex, type Rgb } from "./looks.ts";
import { p1Color } from "./prio.ts";
import type { Tone } from "./ticksound.ts";

export type NoteKind = "done" | "mail" | "lead" | "meet" | "other";
export type NoteSoundId = "glass" | "rise" | "bell" | "knock" | "harp" | "ding" | "marimba" | "drop" | "twinkle" | "kind";

/** The kinds, in the order Settings shows them. def: today's colour (what the preview shows unpicked); byKind: today
 *  these cards have a colour per meaning (green booked, amber, red) until one colour is picked. */
export const NOTE_KINDS: { id: NoteKind; label: string; hint: string; def: string; byKind?: boolean; sample: { title: string; sub: string; body?: string } }[] = [
  { id: "done", label: "AI chats finished", hint: "When a Claude Code, Codex, Gemini or Cursor chat finishes.", def: "#d97757",
    sample: { title: "Homepage copy", sub: "Claude finished" } },
  { id: "mail", label: "Client emails", hint: "A client wrote to you.", def: "#ec4e86",
    sample: { title: "Jane just sent an email", sub: "Northwind Silk · Homepage draft", body: "Loved the draft! Can we move the banner up a little?" } },
  { id: "lead", label: "Lead replies", hint: "A lead replied in Instantly.", def: "#60a5fa",
    sample: { title: "Lena replied in Instantly", sub: "example.com · Quick question", body: "Sounds interesting, can you send more details?" } },
  { id: "meet", label: "Meetings", hint: "Booked and 10 minutes before. A cancelled call or a message before a call keeps its red or amber, so it always stands out.",
    def: "#34d399", byKind: true, sample: { title: "Call booked: Sam", sub: "Example Co · 30 min", body: "Tomorrow at 15:00 your time." } },
  { id: "other", label: "Other alerts", hint: "Network, vault updates and the rest. A warning or a VPN alarm keeps its amber or red.",
    def: "#ec4e86", byKind: true, sample: { title: "Calendar refreshed", sub: "12 events" } },
];
const KIND_IDS = new Set<string>(NOTE_KINDS.map((k) => k.id));

/** The colours Settings offers (plus "As now" and your own). */
export const NOTE_COLORS: { id: string; label: string }[] = [
  { id: "#d97757", label: "Coral" }, { id: "#ec4e86", label: "Pink" }, { id: "#a78bfa", label: "Violet" }, { id: "#60a5fa", label: "Blue" },
  { id: "#38bdf8", label: "Sky" }, { id: "#2dd4bf", label: "Teal" }, { id: "#34d399", label: "Mint" }, { id: "#fbbf24", label: "Gold" },
  { id: "#cbd5e1", label: "Silver" },
];

/** The sounds. native: the name PS on the Mac plays it by (ps-mac Sfx.swift). The first four are the sounds PS
 *  already made (the chat and lead chime, and the meeting sounds); "kind" is the meetings' own sound per meaning. */
export const NOTE_SOUNDS: { id: Exclude<NoteSoundId, "kind">; label: string; native: string; tones: Tone[] }[] = [
  { id: "glass", label: "Glass", native: "chime", tones: [{ f: 1318.5, dur: 0.55, peak: 0.13, wave: 0, at: 0 }, { f: 1661.2, dur: 0.6, peak: 0.11, wave: 0, at: 0.075 },
    { f: 1975.5, dur: 0.9, peak: 0.12, wave: 0, at: 0.15 }, { f: 659.3, dur: 0.5, peak: 0.05, wave: 0, at: 0 }] },
  { id: "harp", label: "Harp", native: "note-harp", tones: [{ f: 1046.5, dur: 0.5, peak: 0.12, wave: 0, at: 0 }, { f: 1318.5, dur: 0.5, peak: 0.11, wave: 0, at: 0.06 },
    { f: 1568, dur: 0.55, peak: 0.1, wave: 0, at: 0.12 }, { f: 2093, dur: 0.8, peak: 0.1, wave: 0, at: 0.18 }] },
  { id: "ding", label: "Ding", native: "note-ding", tones: [{ f: 1568, dur: 1.1, peak: 0.13, wave: 0, at: 0 }, { f: 4327.7, dur: 0.35, peak: 0.03, wave: 0, at: 0 },
    { f: 784, dur: 0.8, peak: 0.05, wave: 0, at: 0 }] },
  { id: "marimba", label: "Marimba", native: "note-marimba", tones: [{ f: 783.99, dur: 0.3, peak: 0.26, wave: 0, at: 0 }, { f: 3136, dur: 0.04, peak: 0.05, wave: 0, at: 0 },
    { f: 1046.5, dur: 0.38, peak: 0.24, wave: 0, at: 0.12 }, { f: 4186, dur: 0.04, peak: 0.04, wave: 0, at: 0.12 }] },
  { id: "drop", label: "Droplet", native: "note-drop", tones: [{ f: 900, to: 1900, dur: 0.09, peak: 0.2, wave: 0, at: 0 }, { f: 1400, to: 2500, dur: 0.08, peak: 0.12, wave: 0, at: 0.14 }] },
  { id: "twinkle", label: "Twinkle", native: "note-twinkle", tones: [{ f: 2637, dur: 0.16, peak: 0.08, wave: 0, at: 0 }, { f: 3136, dur: 0.16, peak: 0.08, wave: 0, at: 0.07 },
    { f: 3951, dur: 0.18, peak: 0.07, wave: 0, at: 0.14 }, { f: 3520, dur: 0.4, peak: 0.07, wave: 0, at: 0.21 }] },
  { id: "rise", label: "Rise", native: "meet-booked", tones: [{ f: 660, dur: 0.12, peak: 0.2, wave: 1, at: 0 }, { f: 990, dur: 0.2, peak: 0.2, wave: 1, at: 0.1 }] },
  { id: "bell", label: "Soft bell", native: "meet-soon", tones: [{ f: 1180, dur: 0.35, peak: 0.12, wave: 0, at: 0 }] },
  { id: "knock", label: "Knock", native: "meet-alert", tones: [{ f: 740, to: 700, dur: 0.12, peak: 0.3, wave: 1, at: 0 }, { f: 740, to: 700, dur: 0.12, peak: 0.3, wave: 1, at: 0.18 },
    { f: 180, dur: 0.1, peak: 0.25, wave: 0, at: 0 }] },
];
const SOUND_IDS = new Set<string>([...NOTE_SOUNDS.map((s) => s.id), "kind"]);
/** Every native name a card sound may use (ps-mac DND.swift mutes these under Do Not Disturb). */
export const NOTE_NATIVE = NOTE_SOUNDS.map((s) => s.native);

/** One kind's saved choice. color: "#rrggbb" or null (as now); on: sound on; sound: which one (kept while off). */
export type NotePref = { color?: string | null; on?: boolean; sound?: NoteSoundId };
export type NoteLookPrefs = Partial<Record<NoteKind, NotePref>>;
/** What a kind does, every field filled in. */
export type NoteResolved = { color: string | null; on: boolean; sound: NoteSoundId };

/** Today's behaviour: chats and leads chime (Glass), client emails and other alerts make no sound, meetings use
 *  their own sound per meaning (and their own switches in Meeting alerts). */
export const NOTE_DEFAULTS: Record<NoteKind, NoteResolved> = {
  done: { color: null, on: true, sound: "glass" },
  mail: { color: null, on: false, sound: "glass" },
  lead: { color: null, on: true, sound: "glass" },
  meet: { color: null, on: true, sound: "kind" },
  other: { color: null, on: false, sound: "glass" },
};

const soundOk = (k: NoteKind, v: unknown): v is NoteSoundId => typeof v === "string" && SOUND_IDS.has(v) && (v !== "kind" || k === "meet");

/** One kind as it is now: the saved choice where it reads, the default everywhere else. */
export function notePref(st: Pick<Settings, "noteLook"> | null | undefined, k: NoteKind): NoteResolved {
  const raw = (st?.noteLook && typeof st.noteLook === "object" ? (st.noteLook as Record<string, unknown>)[k] : null) as Record<string, unknown> | null;
  const d = NOTE_DEFAULTS[k];
  if (!raw || typeof raw !== "object") return { ...d };
  return {
    color: p1Color(raw.color) ?? null,
    on: typeof raw.on === "boolean" ? raw.on : d.on,
    sound: soundOk(k, raw.sound) ? raw.sound : d.sound,
  };
}
export function notePrefs(st: Pick<Settings, "noteLook"> | null | undefined): Record<NoteKind, NoteResolved> {
  return Object.fromEntries(NOTE_KINDS.map((k) => [k.id, notePref(st, k.id)])) as Record<NoteKind, NoteResolved>;
}

/** The Notifications part of a settings patch, checked. Only the five kinds and their three fields; null for a
 *  kind puts it back to the default. The whole map is saved (Settings sends the full next map). */
export function cleanNoteLook(p: Record<string, unknown>): Partial<Settings> {
  const v = p.noteLook;
  if (v === null) return { noteLook: null };
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: NoteLookPrefs = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!KIND_IDS.has(k) || !x || typeof x !== "object" || Array.isArray(x)) continue;
    const kind = k as NoteKind, r = x as Record<string, unknown>, o: NotePref = {};
    if (r.color === null) o.color = null; else if (p1Color(r.color)) o.color = p1Color(r.color);
    if (typeof r.on === "boolean") o.on = r.on;
    if (soundOk(kind, r.sound)) o.sound = r.sound;
    if (Object.keys(o).length) out[kind] = o;
  }
  return { noteLook: out };
}

/** The next saved map after one change to one kind (a colour equal to today's default counts as "as now"). */
export function withNotePref(st: Pick<Settings, "noteLook"> | null | undefined, k: NoteKind, patch: NotePref): NoteLookPrefs {
  const cur = notePref(st, k), next = { ...cur, ...patch };
  const kind = NOTE_KINDS.find((x) => x.id === k)!;
  if (next.color && !kind.byKind && next.color === kind.def) next.color = null;
  const all: NoteLookPrefs = {};
  for (const x of NOTE_KINDS) {
    const r = x.id === k ? next : notePref(st, x.id), d = NOTE_DEFAULTS[x.id];
    if (r.color !== d.color || r.on !== d.on || r.sound !== d.sound) all[x.id] = { color: r.color, on: r.on, sound: r.sound };
  }
  return all;
}

// ---------- sounds ----------
/** The native sound name for a card of this kind, or null when it makes no sound. byKind: the meeting's own sound
 *  (meet-booked, meet-alert or meet-soon), used when meetings are left on "By kind". */
export function noteSoundName(p: NoteResolved, byKind?: string): string | null {
  if (!p.on) return null;
  if (p.sound === "kind") return byKind ?? null;
  return NOTE_SOUNDS.find((s) => s.id === p.sound)?.native ?? "chime";
}
/** The tones of a sound, for the website (ui/sfx.ts). "By kind" plays the booked sound as its sample. */
export function noteSoundTones(id: NoteSoundId): Tone[] {
  return NOTE_SOUNDS.find((s) => s.id === (id === "kind" ? "rise" : id))?.tones ?? [];
}
/** The native name a Settings play button asks PS for ("By kind" plays the booked sound). */
export function noteSampleName(id: NoteSoundId): string {
  return NOTE_SOUNDS.find((s) => s.id === (id === "kind" ? "rise" : id))?.native ?? "chime";
}
/** Several new cards at once: one sound only, the newest card's. */
export function pickChime(list: { at: string; name: string | null }[]): string | null {
  let best: { t: number; name: string } | null = null;
  for (const c of list) {
    if (!c.name) continue;
    const t = Date.parse(c.at) || 0;
    if (!best || t > best.t) best = { t, name: c.name };
  }
  return best?.name ?? null;
}

// ---------- colours ----------
/** The card's tones, all "#RRGGBB". c: the pick; top and bot: the gradient (bot at 60%); icBg and ic: the icon tile and
 *  its mark; sub: the line under the title; rem and remHi: Remind me in (and on hover); line: its border; btn and ink: a
 *  main button on a plain card and its text. */
export type NoteTones = { c: string; top: string; bot: string; icBg: string; ic: string; sub: string; rem: string; remHi: string; line: string; btn: string; ink: string };
const WHITE = "#FFFFFF", INK = "#17121A";

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return [h, s, l];
}
function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}
/** Mixed toward white (keeping the hue) until it reads at `min` on every background. */
function lighten(color: string, bgs: string[], min: number): string {
  for (let t = 0; t <= 1.0001; t += 0.04) { const c = mix(WHITE, color, t); if (bgs.every((b) => contrast(c, b) >= min)) return c; }
  return WHITE;
}
/** The colour over the dark top at an alpha, as few steps less as needed for white text to stay at 4.5:1. */
function fill(c: string, top: string, alpha: number): string {
  for (let a = alpha; a > 0; a -= 0.02) { const f = mix(c, top, a); if (contrast(WHITE, f) >= 4.5) return f; }
  return top;
}

/** One colour to the whole card, like the built in kinds (the coral chats card: top #5C2816, its icon and sub
 *  #F2B49B). White title and words stay at 7:1 or better on the gradient (so the 86% body text still clears 4.5),
 *  the sub line and the icon at 4.5:1. */
export function cardTones(hex: string): NoteTones {
  const c = (p1Color(hex) ?? "#ec4e86").toUpperCase();
  const [h, s] = toHsl(hexRgb(c)!);
  let l = 0.24, top = fromHsl(h, Math.min(s, 0.7), l);
  while (contrast(WHITE, top) < 7 && l > 0.06) { l -= 0.02; top = fromHsl(h, Math.min(s, 0.7), l); }
  const bot = fromHsl(h, Math.min(s, 0.32), 0.085);
  const icBg = fill(c, top, 0.24);   // dark enough that its light mark (and white) reads on it
  const sub = lighten(mix(WHITE, c, 0.45), [top, bot], 4.5);
  const ic = lighten(mix(WHITE, c, 0.35), [icBg], 4.5);
  const rem = fill(c, top, 0.3), remHi = fill(c, top, 0.44);
  const line = mix(WHITE, c, 0.45);
  // A main button on a plain card: the colour itself with white or near black words, whichever reads better; a middle
  // grey that reaches 4.5:1 with neither is moved a little toward white (dark words) or black (white words).
  const ink = contrast(c, WHITE) >= contrast(c, INK) ? WHITE : INK;
  let btn = c;
  for (let t = 0.04; contrast(ink, btn) < 4.5 && t <= 1.0001; t += 0.04) btn = mix(ink === INK ? WHITE : "#000000", c, t);
  return { c, top, bot, icBg, ic, sub, rem, remHi, line, btn, ink };
}

/** The tones of each kind as it is today, for the Settings preview while it is left "as now" (the values in
 *  ps-mac Toast.swift's page, over its dark base). */
const now = (c: string, top: string, bot: string, ic: string, sub: string, line: string, remA = 0.3): NoteTones =>
  ({ c, top, bot, icBg: mix(c, top, 0.24), ic, sub, rem: mix(c, top, remA), remHi: mix(c, top, remA + 0.14), line, btn: c, ink: WHITE });
export const NOTE_NOW: Record<NoteKind, NoteTones> = {
  done: now("#D97757", "#5C2816", "#1A120F", "#F2B49B", "#F2B49B", "#F2B49B"),
  mail: now("#EC4E86", "#6E163C", "#1A0E14", "#F9A8C9", "#F9A8C9", "#F9A8C9"),
  lead: now("#60A5FA", "#1D3A8A", "#0F1420", "#93C5FD", "#BFDBFE", "#93C5FD", 0.28),
  meet: now("#34D399", "#064E3B", "#121816", "#6EE7B7", "#A7F3D0", "#A7F3D0"),
  other: now("#EC4E86", "#181015", "#181015", "#F49BBE", "#F49BBE", "#F9A8C9"),
};

/** What the Mac's card stack is told ({type:"noteLook"}): tones for each kind with a colour picked (null keeps that
 *  kind's own look), and the Other alerts sound (those cards are made on the Mac, so it plays them itself). */
export type NoteLookMsg = Record<NoteKind, NoteTones | null> & { otherSound: string | null };
export function noteLookMsg(st: Pick<Settings, "noteLook"> | null | undefined): NoteLookMsg {
  const p = notePrefs(st);
  const out = { otherSound: noteSoundName(p.other) } as NoteLookMsg;
  for (const k of NOTE_KINDS) out[k.id] = p[k.id].color ? cardTones(p[k.id].color!) : null;
  return out;
}

// Sleep mode's wake up (V1.43): "Wake me up in" with suggested sleep cycles, and the wake styles. Pure rules here
// (tests/sleepmode.test.ts); core/sleepmode.ts puts them in the plan, and every screen (the web page, ps-mac
// SleepScreen.swift, ps-gos Sleep.kt) draws them from the plan with the same numbers.
// The developer, 8 Nov 2026: a "Wake me up in" timer on the sleep screen with suggested sleep cycles, and creative wake up
// options (red or coloured light, a really loud sound, the screen going white and flashing). "Be creative and come
// up with a few different examples."
import { LEVEL_DEF, okLevel } from "./alarmsound.ts";
import { LIST_DEF, cleanList, type AlarmList } from "./alarmlist.ts";
// Safety, always: Esc leaves, Stop is big and needs no Touch ID, Strobe flash stays off until switched on behind a
// clear warning and never flashes faster than STROBE_HZ (under the 3 a second limit for flashing content).

// ---------- "Wake me up in": the suggestions ----------
// One small table so the numbers are easy to change, from the research note (ps-handover-notes/
// research-sleep-cycles.md, 8 Nov 2026): sleep runs in loops of roughly 90 minutes (a rough guide, different for
// everyone), and falling asleep takes a while, so 15 minutes are added to a main sleep and 5 to a nap. Naps of 10 and
// 20 minutes are the quick picks (30 to 60 are the most likely to end in deep sleep, so they are left to "Your own"),
// 90 is one whole loop. 7 h 30 is picked first; 4 h 30 and 6 h are labelled short sleep.
export const SLEEP_CYCLES = { naps: [10, 20, 90], napBuffer: 5, sleeps: [270, 360, 450, 540], mainBuffer: 15, short: [270, 360], pick: 450 };
export interface WakeInChoice { id: string; name: string; sleep: number; mins: number }   // sleep: minutes asleep; mins: the timer
export function wakeInChoices(t = SLEEP_CYCLES): WakeInChoice[] {
  return [
    ...t.naps.map((m) => ({ id: `n${m}`, name: "Nap", sleep: m, mins: m + t.napBuffer })),
    ...t.sleeps.map((m) => ({ id: `s${m}`, name: t.short.includes(m) ? "Short sleep" : `${Math.round(m / 90)} sleep loops`, sleep: m, mins: m + t.mainBuffer })),
  ];
}
/** The suggestion picked first (7 h 30 of sleep, rings after 7 h 45). */
export const wakeInPick = (t = SLEEP_CYCLES) => t.pick + t.mainBuffer;
export const WAKE_IN_MIN = 5, WAKE_IN_MAX = 16 * 60;
/** The timer's minutes, checked (5 minutes to 16 hours, whole minutes). Null for anything else. */
export function okWakeIn(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= WAKE_IN_MIN && n <= WAKE_IN_MAX ? Math.round(n) : null;
}
/** When "Wake me up in `mins`" rings, from `now`, on a whole minute (so the clock and the alarm agree). */
export function wakeInAt(now: number, mins: number): number { return Math.round((now + mins * 60_000) / 60_000) * 60_000; }
/** "20 min", "1 h 45", "7 h". */
export function durText(mins: number): string {
  const m = Math.max(0, Math.round(mins)), h = Math.floor(m / 60), r = m % 60;
  return h === 0 ? `${r} min` : r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, "0")}`;
}
/** The countdown under the clock: "Wakes you in 6 h 12", "Wakes you in 4 min", "Waking you now". */
export function countdownLine(at: number, now: number): string {
  const m = Math.ceil((at - now) / 60_000);
  return m <= 0 ? "Waking you now" : `Wakes you in ${durText(m)}`;
}
/** The timer kept on the open sleep (fitness prefs sleepOpen.timer, synced, so every device rings it). */
export interface SleepTimer { at: string; mins: number; style: WakeStyle }
export function cleanTimer(v: unknown): SleepTimer | null {
  const o = (v && typeof v === "object" ? v : null) as Record<string, unknown> | null;
  if (!o || typeof o.at !== "string" || !Number.isFinite(Date.parse(o.at))) return null;
  const mins = okWakeIn(o.mins);
  if (mins == null) return null;
  return { at: new Date(Date.parse(o.at)).toISOString(), mins, style: pickStyle(o.style) };
}

// ---------- the wake styles ----------
export type WakeStyle = "chime" | "sunrise" | "alert" | "wave" | "white" | "strobe" | "light" | "loud";
export const WAKE_STYLES: WakeStyle[] = ["chime", "sunrise", "alert", "wave", "white", "strobe", "light", "loud"];
export const WAKE_NAMES: Record<WakeStyle, string> = {
  chime: "Soft chime", sunrise: "Sunrise", alert: "Red alert", wave: "Colour wave", white: "Bright white", strobe: "Strobe flash", light: "Silent light", loud: "Loud",
};
export const WAKE_NOTES: Record<WakeStyle, string> = {
  chime: "A soft chime that starts at half and is at full in 20 seconds, and the clock glows.",
  sunrise: "Before the alarm the screen slowly warms from dark red to bright warm white, then a soft chime, at full in 30 seconds.",
  alert: "A pulsing red light and an alarm, at full in 10 seconds.",
  wave: "Slow waves of a colour you pick, and a soft chime, at full in 20 seconds.",
  white: "The screen goes full white at full brightness, with an alarm at full in 5 seconds.",
  strobe: "White flashes, 2 a second at most, with an alarm. Off until you switch it on.",
  light: "Light only, no sound: the screen glows and slowly breathes.",
  loud: "The alarm at full at once, at 100% volume whatever your alarm loudness is. Your volume goes back after.",
};
export const STROBE_WARN = "Strobe flash makes the screen flash white, up to 2 times a second. Flashing light can cause seizures in people with photosensitive epilepsy. Only switch it on if that is safe for you and for anyone who may see the screen.";
const pickStyle = (v: unknown): WakeStyle => (WAKE_STYLES as unknown[]).includes(v) ? v as WakeStyle : "chime";
export const okStyle = (v: unknown): v is WakeStyle => (WAKE_STYLES as unknown[]).includes(v);

/** The wake settings (vault settings sleepMode.wake, synced). */
export interface WakePrefs {
  timer: WakeStyle;   // the style "Wake me up in" rings with
  sunrise: number;    // minutes the sunrise takes before the alarm (SUNRISE_STEPS)
  wave: string;       // Colour wave's colour, #rrggbb
  strobe: boolean;    // Strobe flash switched on behind its warning (default off: a strobe alarm rings as Bright white)
  level: number;      // V1.44: the alarm loudness, 0.1 to 1 (core/alarmsound.ts okLevel); Loud always rings at 1
  list: AlarmList;    // V1.47: the alarm playlist (core/alarmlist.ts): a different file each day
}
export const SUNRISE_STEPS = [10, 20, 30];
export const WAVE_DEF = "#4f7cff";
export const WAKE_DEF: WakePrefs = { timer: "chime", sunrise: 20, wave: WAVE_DEF, strobe: false, level: LEVEL_DEF, list: LIST_DEF };
const okHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
export function cleanWake(v: unknown): WakePrefs {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    timer: pickStyle(o.timer),
    sunrise: SUNRISE_STEPS.includes(Number(o.sunrise)) ? Number(o.sunrise) : WAKE_DEF.sunrise,
    wave: okHex(o.wave) ? o.wave.toLowerCase() : WAKE_DEF.wave,
    strobe: o.strobe === true,
    level: okLevel(o.level),
    list: cleanList(o.list),
  };
}
/** The style that really rings: Strobe flash only once it is switched on (else Bright white, never a flash). */
export const styleOf = (s: unknown, w: Pick<WakePrefs, "strobe">): WakeStyle => { const v = pickStyle(s); return v === "strobe" && !w.strobe ? "white" : v; };

// The sound for each style: how loud it starts (0 to 1) and how long it takes to reach full volume. Every style that
// makes a sound sets this device's volume to the alarm loudness while it rings (Loud: to 100%), where the device
// allows it, and puts it back after (core/alarmsound.ts).
// V1.44 (a G Squad friend: "only one of them is loud, the last one, the other ones are super quiet"): in V1.43 the
// soft styles started at 12 to 15% and took up to 2 minutes to be full, and a Preview played at a third of that, so
// a Soft chime preview was at about 5% of Loud. Now every style starts at half or more and is full within 30 s.
export type SoundKind = "none" | "soft" | "alarm";
export interface WakeSpec { sound: SoundKind; start: number; rise: number; loud: boolean; bright: boolean }
export const WAKE_SPEC: Record<WakeStyle, WakeSpec> = {
  chime:   { sound: "soft",  start: 0.5, rise: 20_000, loud: false, bright: false },
  sunrise: { sound: "soft",  start: 0.5, rise: 30_000, loud: false, bright: false },
  alert:   { sound: "alarm", start: 0.7, rise: 10_000, loud: false, bright: false },
  wave:    { sound: "soft",  start: 0.5, rise: 20_000, loud: false, bright: false },
  white:   { sound: "alarm", start: 0.8, rise: 5_000, loud: false, bright: true },
  strobe:  { sound: "alarm", start: 0.8, rise: 5_000, loud: false, bright: true },
  light:   { sound: "none",  start: 0,    rise: 0, loud: false, bright: false },
  loud:    { sound: "alarm", start: 1,    rise: 0, loud: true, bright: false },
};
/** How loud the alarm is `ms` after it started ringing: it rises from the style's start to full, Loud is full at
 *  once, Silent light is silent. */
export function ringVolume(style: WakeStyle, ms: number): number {
  const s = WAKE_SPEC[style] ?? WAKE_SPEC.chime;
  if (s.sound === "none") return 0;
  if (s.rise <= 0) return 1;
  return Math.min(1, Math.max(s.start, s.start + (1 - s.start) * Math.max(0, ms) / s.rise));
}

// The light: a colour laid over the whole screen, `a` 0 to 1 (0: the usual clock shows through).
export type RGB = [number, number, number];
export interface WakeLight { rgb: RGB; a: number }
export const STROBE_HZ = 2, STROBE_MAX_HZ = 3;   // flashes a second: never over the 3 a second limit
export const PULSE_MS = 2000, WAVE_MS = 6000, BREATHE_MS = 4000;   // no pulse faster than one every 2 seconds (research note)
const WARM: RGB = [255, 238, 212];
/** The sunrise, dark red to bright warm white: [how far through, colour]. */
export const SUNRISE_RAMP: [number, RGB][] = [[0, [36, 2, 0]], [0.3, [120, 14, 4]], [0.6, [230, 92, 30]], [0.85, [255, 182, 110]], [1, WARM]];
const mix = (a: RGB, b: RGB, k: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * k)) as RGB;
export function sunriseAt(p: number): WakeLight {
  const q = Math.max(0, Math.min(1, p));
  let i = 0;
  while (i < SUNRISE_RAMP.length - 2 && q > SUNRISE_RAMP[i + 1][0]) i++;
  const [p0, c0] = SUNRISE_RAMP[i], [p1, c1] = SUNRISE_RAMP[i + 1];
  return { rgb: mix(c0, c1, p1 > p0 ? (q - p0) / (p1 - p0) : 1), a: 0.25 + 0.75 * q };
}
const wave01 = (t: number, period: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / period);
/** Is the strobe white at `t` ms into the ring (half a period on, half off)? */
export const strobeOn = (t: number, hz = STROBE_HZ) => Math.floor((Math.max(0, t) * 2 * Math.min(hz, STROBE_MAX_HZ)) / 1000) % 2 === 0;
/** The light at `t` ms after the alarm time (negative: before it, only Sunrise lights up then, over `dawnMs`).
 *  `wave` is Colour wave's colour, `ink` the clock's. Null: no light over the screen. */
export function wakeLight(style: WakeStyle, t: number, o: { dawnMs: number; wave: RGB; ink: RGB }): WakeLight | null {
  if (t < 0) return style === "sunrise" && o.dawnMs > 0 && -t <= o.dawnMs ? sunriseAt(1 + t / o.dawnMs) : null;
  switch (style) {
    case "sunrise": return { rgb: WARM, a: 1 };
    case "alert": return { rgb: [255, 26, 16], a: 0.25 + 0.75 * wave01(t, PULSE_MS) };
    case "wave": return { rgb: o.wave, a: 0.3 + 0.7 * wave01(t, WAVE_MS) };
    case "white": return { rgb: [255, 255, 255], a: 1 };
    case "strobe": return strobeOn(t) ? { rgb: [255, 255, 255], a: 1 } : { rgb: [0, 0, 0], a: 1 };
    case "light": return { rgb: mix(o.ink, WARM, 0.35), a: 0.35 + 0.5 * wave01(t, BREATHE_MS) };
    default: return null;   // chime and loud: the clock's own glow
  }
}
export const hexRgb = (h: string): RGB => { const n = parseInt(/^#[0-9a-f]{6}$/i.test(h) ? h.slice(1) : "e7a35e", 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** Black or white text, whichever reads on the light (the Stop button on Bright white stays readable). */
export const inkOn = (l: WakeLight | null): "dark" | "light" => !l ? "light" : (0.2126 * l.rgb[0] + 0.7152 * l.rgb[1] + 0.0722 * l.rgb[2]) * l.a > 140 ? "dark" : "light";

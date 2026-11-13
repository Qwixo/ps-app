// The tick sound (V1.34, the developer 5 Nov 2026: "add different sound effects of the tasks ticking up as well in the
// settings"). Settings, General, To do list: the sound a task makes when it is ticked, anywhere (the list, Overdue,
// the right click menu), or Off. Every sound is made in code (Web Audio on the website and the phone; PS on
// the Mac plays the same tones itself, ps-mac Sources/Sfx.swift "done-<id>"), no sound files. settings.tmTickSound,
// synced like every setting, cleaned here on read and in ps.ts cleanLooks on save. Classic is the sound from before.
import type { Settings } from "./model";

/** One tone: start and end frequency, length and loudness, wave (0 sine, 1 triangle, 2 square), when it starts. */
export type Tone = { f: number; to?: number; dur: number; peak: number; wave: 0 | 1 | 2; at: number };
export type TickSoundId = "classic" | "pop" | "sparkle" | "marimba" | "rise" | "bell" | "off";

export const TICK_SOUNDS: { id: Exclude<TickSoundId, "off">; label: string; tones: Tone[] }[] = [
  { id: "classic", label: "Classic", tones: [{ f: 880, dur: 0.09, peak: 0.18, wave: 1, at: 0 }, { f: 1320, dur: 0.14, peak: 0.18, wave: 1, at: 0.07 }] },
  { id: "pop", label: "Pop", tones: [{ f: 520, to: 1250, dur: 0.06, peak: 0.32, wave: 0, at: 0 }, { f: 1900, to: 1500, dur: 0.025, peak: 0.08, wave: 1, at: 0.045 }] },
  { id: "sparkle", label: "Sparkle", tones: [{ f: 1568, dur: 0.08, peak: 0.12, wave: 0, at: 0 }, { f: 2093, dur: 0.09, peak: 0.12, wave: 0, at: 0.05 },
    { f: 2637, dur: 0.22, peak: 0.12, wave: 0, at: 0.1 }] },
  { id: "marimba", label: "Marimba", tones: [{ f: 523.25, dur: 0.28, peak: 0.3, wave: 0, at: 0 }, { f: 2093, dur: 0.05, peak: 0.07, wave: 0, at: 0 },
    { f: 784, dur: 0.3, peak: 0.24, wave: 0, at: 0.09 }] },
  { id: "rise", label: "Rise", tones: [{ f: 330, to: 990, dur: 0.12, peak: 0.16, wave: 1, at: 0 }, { f: 1480, dur: 0.16, peak: 0.12, wave: 0, at: 0.11 }] },
  { id: "bell", label: "Bell", tones: [{ f: 1760, dur: 0.7, peak: 0.12, wave: 0, at: 0 }, { f: 2640, dur: 0.45, peak: 0.05, wave: 0, at: 0 },
    { f: 880, dur: 0.6, peak: 0.06, wave: 0, at: 0 }] },
];
const IDS = new Set<string>([...TICK_SOUNDS.map((s) => s.id), "off"]);
const isId = (v: unknown): v is TickSoundId => typeof v === "string" && IDS.has(v);

/** The chosen tick sound, Classic when unset or unreadable. */
export function tickSoundOf(s: Pick<Settings, "tmTickSound"> | null | undefined): TickSoundId {
  return isId(s?.tmTickSound) ? s!.tmTickSound as TickSoundId : "classic";
}
/** The tick sound part of a settings patch, checked (ps.ts cleanLooks). */
export function cleanTickSoundLooks(p: Record<string, unknown>): Partial<Settings> {
  return isId(p.tmTickSound) ? { tmTickSound: p.tmTickSound } : {};
}
/** The name PS on the Mac plays it by (ps-mac Sfx.swift): Classic keeps the old name, "done". */
export function nativeTickName(id: TickSoundId): string | null {
  return id === "off" ? null : id === "classic" ? "done" : `done-${id}`;
}
export function tonesOf(id: TickSoundId): Tone[] {
  return TICK_SOUNDS.find((s) => s.id === id)?.tones ?? [];
}

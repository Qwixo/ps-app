// The Edit overview's sounds (V1.56). The developer, 13 Nov 2026: "Obviously add cool sound effects in too." Short (all under
// 0.4 s), soft, made here from plain tones and filtered noise (no recordings of anyone's sounds), and quiet enough for
// all day use. One list of tones, shared: the website and the phones play them with Web Audio (src/ui/sfx.ts sfx.edit),
// PS on a Mac plays its own copy by the same name (ps-mac Sources/Sfx.swift, the same numbers). The phones' Edit modes
// use this module unchanged.
//
// When they play (editSoundOk): "Edit mode sounds" on (settings.editSounds, missing = on), the sound volume above 0 and
// not muted, Do Not Disturb not muting sounds, and no meeting going on right now.

/** One tone. wave: 0 sine, 1 triangle, 2 square, 3 soft noise (a whoosh: its pitch band slides from f to `to`). Noise
 *  swells in over the first third; the rest start at once. Times in seconds, peak 0 to 1 before the volume. */
export interface EditTone { f: number; to?: number; dur: number; peak: number; wave: 0 | 1 | 2 | 3; at: number }

export const EDIT_SOUNDS = {
  /** Into the overview: the page shrinks away (a falling whoosh with a soft low note). */
  "edit-in": [{ f: 1800, to: 520, dur: 0.32, peak: 0.07, wave: 3, at: 0 }, { f: 520, to: 340, dur: 0.22, peak: 0.05, wave: 0, at: 0.04 }],
  /** Out of the overview (Done, Esc): the page grows back (a rising whoosh). */
  "edit-out": [{ f: 520, to: 1900, dur: 0.3, peak: 0.07, wave: 3, at: 0 }, { f: 340, to: 560, dur: 0.2, peak: 0.05, wave: 0, at: 0.06 }],
  /** Flying into a page (a click on it): a longer rise that lands on a light note. */
  "edit-fly": [{ f: 420, to: 2600, dur: 0.34, peak: 0.08, wave: 3, at: 0 }, { f: 660, to: 990, dur: 0.14, peak: 0.05, wave: 1, at: 0.2 }],
  /** Sliding past a page: a tiny soft tick. */
  "edit-tick": [{ f: 1900, to: 1500, dur: 0.018, peak: 0.045, wave: 1, at: 0 }],
  /** A panel set down. */
  "edit-drop": [{ f: 300, to: 180, dur: 0.09, peak: 0.16, wave: 0, at: 0 }, { f: 1200, to: 900, dur: 0.03, peak: 0.04, wave: 1, at: 0 }],
  /** A page added. */
  "edit-page-add": [{ f: 520, to: 880, dur: 0.12, peak: 0.12, wave: 0, at: 0 }, { f: 1320, dur: 0.14, peak: 0.06, wave: 0, at: 0.08 }],
  /** A page deleted. */
  "edit-page-remove": [{ f: 700, to: 300, dur: 0.16, peak: 0.1, wave: 0, at: 0 }, { f: 1200, to: 400, dur: 0.14, peak: 0.03, wave: 3, at: 0 }],
  /** A look saved: two soft notes up. */
  "edit-save": [{ f: 784, dur: 0.18, peak: 0.09, wave: 0, at: 0 }, { f: 1175, dur: 0.22, peak: 0.08, wave: 0, at: 0.07 }],
  /** Switching to a saved look: a short shimmer and two notes. */
  "edit-switch": [{ f: 900, to: 1600, dur: 0.25, peak: 0.05, wave: 3, at: 0 }, { f: 660, dur: 0.16, peak: 0.07, wave: 0, at: 0.1 }, { f: 990, dur: 0.2, peak: 0.06, wave: 0, at: 0.16 }],
  /** Back to the default layout: a gentle fall. */
  "edit-reset": [{ f: 880, to: 440, dur: 0.3, peak: 0.08, wave: 0, at: 0 }, { f: 1500, to: 300, dur: 0.28, peak: 0.04, wave: 3, at: 0 }],
} satisfies Record<string, EditTone[]>;
export type EditSound = keyof typeof EDIT_SOUNDS;
export const EDIT_SOUND_NAMES = Object.keys(EDIT_SOUNDS) as EditSound[];
export const isEditSound = (v: unknown): v is EditSound => typeof v === "string" && v in EDIT_SOUNDS;

/** The longest any of them may last (seconds). */
export const EDIT_SOUND_MAX = 0.4;
/** How long one lasts. */
export const soundLength = (name: EditSound) => Math.max(...(EDIT_SOUNDS[name] as EditTone[]).map((t) => t.at + t.dur));

/** "Edit mode sounds" (Settings, Your list, next to Sounds). Missing = on. */
export const editSoundsOn = (st: { editSounds?: boolean } | null | undefined) => st?.editSounds !== false;

/** Whether an Edit sound plays now. */
export function editSoundOk(g: { on: boolean; volume: number; dndMutesSounds: boolean; meetingNow: boolean }): boolean {
  return g.on && g.volume > 0 && !g.dndMutesSounds && !g.meetingNow;
}
/** A meeting going on right now (its start passed, its end not yet), from the meetings the list knows. */
export function meetingNow(meets: readonly { start: Date | number; end: Date | number }[], now = Date.now()): boolean {
  return meets.some((m) => +m.start <= now && now < +m.end);
}

/** Sliding past pages: a tick each time the middle passes from one page to the next (half way between two), never
 *  more often than every 70 ms. Returns the tick to play (or not) and the page now in the middle. */
export const TICK_GAP_MS = 70;
export function passTick(lastPage: number, cam: number, lastAt: number, now: number): { tick: boolean; page: number; at: number } {
  const page = Math.round(cam);
  if (page === lastPage) return { tick: false, page, at: lastAt };
  if (now - lastAt < TICK_GAP_MS) return { tick: false, page, at: lastAt };
  return { tick: true, page, at: now };
}

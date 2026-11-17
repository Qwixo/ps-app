// Sleep mode's own settings (V1.47). The developer, 10 Nov 2026: "Simplify the settings menu in the Sleep button. It's very
// confusing to navigate. Add a dedicated settings menu to the Sleep button. Also in the main Settings, add a tab called
// Sleep mode. Like the Security settings ... it brings you to the actual Sleep settings, which open full screen.
// Redesign it to be very simple, the same way the general Settings were redesigned."
// The groups, the settings in each, their one plain line and the words people type for them. The screen is
// views/SleepSettings.tsx; Settings (core/settingsindex.ts) lists these too, so its search finds them and opens them
// here. Pure: no React, no DOM.
import { norm, scoreOne, tokensOf } from "./searchscore.ts";

export type SleepWhere = "mac" | "web" | "phone";
export type SleepGroupId = "clock" | "alarms" | "styles" | "screen" | "watch" | "leave" | "log" | "device";
export interface SleepGroup { id: SleepGroupId; label: string; line: string; icon: string }
export interface SleepEntry {
  id: string;
  group: SleepGroupId;
  name: string;
  line: string;
  /** Under the group's small "More" (rarely changed). */
  more?: true;
  /** Only where this runs (the pointer: not on a phone). */
  on?: SleepWhere[];
  words?: string[];
}

// V1.47 (the developer's friend: "It's all super complex ... make it more obvious"): the things people set come first, alarms
// first of all; each page keeps a few rows and the rest under More.
export const SLEEP_GROUPS: SleepGroup[] = [
  { id: "alarms", label: "Wake me up and alarms", line: "Alarms, the Wake me up in timer, the alarm sound", icon: "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2 2M5 3L2 6M19 3l3 3" },
  { id: "clock", label: "Clock and look", line: "Digital or a clock face, fonts, colours, brightness", icon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" },
  { id: "screen", label: "What shows on screen", line: "Asleep for, the date, a countdown, the panel, your tasks", icon: "M3 5h18v12H3zM8 21h8M12 17v4" },
  { id: "log", label: "Breaks and Sleep log", line: "After Wake up, short breaks, your sleep goal", icon: "M4 19V5M4 19h16M8 15l3-4 3 2 4-6" },
  { id: "styles", label: "Wake styles", line: "Sunrise, red alert, bright white and more, with previews", icon: "M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" },
  { id: "watch", label: "Stopwatch and pointer", line: "A stopwatch under the clock, the mouse pointer hiding", icon: "M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 10v4M10 2h4M12 2v4" },
  { id: "leave", label: "Security and leaving", line: "Touch ID to leave, and Esc", icon: "M6 11V8a6 6 0 1 1 12 0v3M5 11h14v10H5zM12 15v2" },
  { id: "device", label: "This device", line: "The Sleep button, and what Sleep mode does here", icon: "M7 3h10v18H7zM11 18h2" },
];

const NOT_PHONE: SleepWhere[] = ["mac", "web"];
export const SLEEP_ENTRIES: SleepEntry[] = [
  // ---------- Clock and look (with a live preview of the sleep screen) ----------
  { id: "face", group: "clock", name: "Clock face", line: "Digital numbers, or an analogue face with hands.", words: ["analogue", "analog", "digital", "clock face", "hands", "dial", "roman", "numbers", "ticks", "second hand", "sweep", "face"] },
  { id: "size", group: "clock", name: "Clock size", line: "How big the clock is. It never runs off the screen.", words: ["size", "bigger", "smaller", "large", "big", "small", "scale"] },
  { id: "font", group: "clock", name: "Font", line: "Twelve fonts, all built into PS app.", words: ["font", "typeface", "letters", "thin", "bold", "rounded", "mono", "serif", "typewriter", "pixel", "handwritten", "marker", "chalk", "digital"] },
  { id: "colour", group: "clock", name: "Clock colour", line: "A preset, or any colour on the colour wheel.", words: ["colour", "color", "wheel", "amber", "red", "night red", "hue", "tint"] },
  { id: "text", group: "clock", name: "Colour of the other words", line: "The date, Asleep for, the alarms and the panel. Same as the clock, or its own.", more: true, words: ["text", "words", "colour", "color", "date colour"] },
  { id: "bright", group: "clock", name: "Brightness", line: "How bright the clock glows. Keep it low in a dark room.", words: ["brightness", "dim", "dark", "glow", "bright"] },
  { id: "bg", group: "clock", name: "Background", line: "Near black, a dim shade of the clock colour, the PS app background or any colour.", more: true, words: ["background", "black", "backdrop", "wallpaper"] },
  { id: "weight", group: "clock", name: "Weight", line: "How thick the numbers are. Usual is the font's own.", more: true, words: ["weight", "bold", "thin", "light", "heavy", "thick"] },
  { id: "spacing", group: "clock", name: "Letter spacing", line: "More or less room between the numbers.", more: true, words: ["spacing", "letter spacing", "kerning", "tracking", "gap"] },
  { id: "hours", group: "clock", name: "12 or 24 hour, and seconds", line: "7:05 PM or 19:05, with or without seconds.", more: true, words: ["12 hour", "24 hour", "am", "pm", "seconds", "time format"] },
  { id: "pos", group: "clock", name: "Where the clock sits", line: "Top, middle or bottom of the screen.", more: true, words: ["position", "top", "middle", "bottom", "place"] },
  { id: "reset", group: "clock", name: "Back to the usual look", line: "Puts every look setting back as it came.", more: true, words: ["reset", "default", "usual", "undo", "original"] },

  // ---------- Wake me up and alarms ----------
  { id: "alarms", group: "alarms", name: "Alarms", line: "Up to five wake times, each with its own sound and wake style.", words: ["alarm", "alarms", "wake up", "ring", "morning", "time", "add alarm"] },
  // PS 1.65 (the developer's friend, 17 Nov 2026): the next morning only, moved or skipped, behind Touch ID (core/alarmonce.ts).
  // The control itself sits in the Alarms row ("the same in Settings, Sleep mode, the alarm row"); this row is its switch.
  { id: "once", group: "alarms", more: true, name: "Just tomorrow", line: "Skip tomorrow's alarm or set it later, for that one morning, under your alarms. It asks for Touch ID first.", words: ["just tomorrow", "tomorrow only", "skip", "skip tomorrow", "later", "snooze", "sleep in", "lie in", "one time", "once", "next alarm", "only tomorrow", "went to bed late", "change alarm"] },
  { id: "ring-always", group: "alarms", name: "Alarms ring even when Sleep mode is off", line: "On: your alarms ring at their time on your Mac and phone, whether or not you pressed Sleep.", words: ["ring", "always", "without sleep mode", "sleep mode off", "alarm clock", "every day", "no matter what"] },
  { id: "wake-in", group: "alarms", name: "Wake me up in", line: "A timer from the sleep cycles: sleep now and it rings after a nap or a full night.", words: ["timer", "nap", "power nap", "sleep cycle", "cycles", "sleep now", "rings after", "wake me up in"] },
  // The alarm sound's place: V1.47 alarm playlists and libraries put their picker here.
  { id: "sound", group: "alarms", name: "Alarm sound", line: "The built in sound, your own file, or a playlist with a different file each day.", words: ["sound", "own sound", "custom sound", "audio", "file", "mp3", "m4a", "wav", "ringtone", "song", "music", "playlist", "library", "alarm sound", "alarm playlist", "different every day", "each day", "random", "in order", "motivational", "speaker", "talk", "podcast", "fade in", "whole file", "loop", "aac"] },
  { id: "loudness", group: "alarms", name: "Alarm loudness", line: "How loud every alarm rings, with a Test that plays it at that level.", more: true, words: ["loudness", "volume", "loud", "quiet", "test", "how loud", "level"] },

  // ---------- Wake styles ----------
  { id: "styles", group: "styles", name: "Wake styles", line: "Pick one for each alarm. Preview shows each one for a few seconds.", words: ["wake style", "sunrise", "light", "red alert", "colour wave", "color wave", "bright white", "loud", "silent", "chime", "preview"] },
  { id: "sunrise", group: "styles", name: "Sunrise starts", line: "How long before the alarm the screen starts to warm up.", more: true, words: ["sunrise", "dawn", "minutes before", "warm"] },
  { id: "wave", group: "styles", name: "Colour wave colour", line: "The colour Colour wave fades in and out.", more: true, words: ["colour wave", "color wave", "wave", "colour", "color"] },
  { id: "strobe", group: "styles", name: "Strobe flash", line: "Off until you switch it on behind a warning. 2 flashes a second at most.", more: true, words: ["strobe", "flash", "flashing", "epilepsy", "photosensitive", "warning"] },

  // ---------- What shows on screen ----------
  { id: "pieces", group: "screen", name: "What shows", line: "Asleep for, alarms, the date, a countdown, the wake time panel, today's tasks and G Squad.", words: ["show", "hide", "asleep for", "date", "countdown", "panel", "tasks", "g squad", "pieces", "what shows"] },
  // V1.52 (the developer): the AI Sentry mode button on the Mac's sleep screen (core/sentry.ts SentrySpot).
  { id: "sentry", group: "screen", name: "AI Sentry mode button", line: "Where the AI Sentry mode button sits on your Mac's sleep screen, or Hidden.", on: ["mac"], words: ["ai", "protect", "protected", "shield", "guard", "ai button", "sleep screen"] },
  { id: "sentry-auto", group: "screen", more: true, name: "Start AI mode with Sleep mode", line: "AI Sentry mode turns on with Sleep mode. It stops at 20 percent battery and never restarts your Mac.", on: ["mac"], words: ["ai", "automatic", "by itself", "default", "opt out", "auto start", "protect"] },
  { id: "sentry-restart", group: "screen", more: true, name: "Restart if not unlocked during Sleep mode", line: "With AI Sentry mode on under Sleep mode, a Mac left locked this long restarts by itself. 18 h by default.", on: ["mac"], words: ["restart", "reboot", "bfu", "stolen", "theft", "timer", "hours", "auto restart", "unlock"] },
  { id: "details", group: "screen", name: "Task titles", line: "Counts only, or your task titles too, where anyone near can read them.", more: true, words: ["privacy", "titles", "details", "counts", "full details", "task names"] },
  { id: "panel", group: "screen", name: "The panel rises", line: "How many minutes before your first alarm the panel comes up.", more: true, words: ["panel", "minutes", "rises", "before"] },

  // ---------- Stopwatch and pointer ----------
  { id: "watch", group: "watch", name: "Stopwatch", line: "Off, small or big, under the clock. It keeps time while the screen is dim.", words: ["stopwatch", "timer", "start", "pause", "reset"] },
  { id: "pointer", group: "watch", name: "Hide the pointer", line: "The mouse pointer hides on the sleep screen after a few seconds still.", more: true, on: NOT_PHONE, words: ["pointer", "cursor", "mouse", "hide"] },

  // ---------- Security and leaving ----------
  { id: "lock", group: "leave", name: "Ask for Touch ID to leave", line: "Wake up and Customise ask for Touch ID or your password (a phone: its own unlock).", words: ["touch id", "password", "lock", "fingerprint", "unlock", "leave"] },
  { id: "esc", group: "leave", name: "Esc always leaves", line: "Esc leaves Sleep mode at once and locks PS app, so your list asks for Touch ID again.", words: ["esc", "escape", "leave", "stuck", "exit", "get out"] },

  // ---------- Breaks and Sleep log ----------
  { id: "ask", group: "log", name: "After Wake up", line: "Ask before logging last night, or log it straight away.", words: ["log", "sleep log", "wake", "ask", "straight away", "save"] },
  { id: "breaks", group: "log", name: "Short breaks", line: "After Wake up, Back to sleep in 5 to 120 minutes keeps the night going. Breaks are left out of your sleep.", words: ["break", "breaks", "back to sleep", "checking something", "up for the day"] },
  { id: "goal", group: "log", name: "Sleep log and goal", line: "Your sleep goal and the log, in Fitness settings.", more: true, words: ["sleep log", "goal", "hours", "bedtime", "fitness", "streak"] },

  // ---------- This device ----------
  { id: "button", group: "device", name: "Sleep button", line: "Show or hide the Sleep button. Hidden, Sleep mode is off on every device.", words: ["button", "hide", "show", "sleep button", "off"] },
  { id: "here", group: "device", name: "What Sleep mode does here", line: "How this Mac, phone or browser keeps the clock up and rings.", more: true, words: ["mac", "phone", "browser", "battery", "plug in", "lock screen", "how it works"] },
];

const BY_ID = new Map(SLEEP_ENTRIES.map((e) => [e.id, e]));
export const sleepEntry = (id: string): SleepEntry | undefined => BY_ID.get(id);
export const sleepGroup = (id: SleepGroupId): SleepGroup => SLEEP_GROUPS.find((g) => g.id === id) ?? SLEEP_GROUPS[0];
export const sleepSees = (e: SleepEntry, where: SleepWhere) => !e.on || e.on.includes(where);
/** One group's rows here: the usual ones, and the ones under its small "More". */
export function sleepRowsOf(group: SleepGroupId, where: SleepWhere): { main: SleepEntry[]; more: SleepEntry[] } {
  const rows = SLEEP_ENTRIES.filter((e) => e.group === group && sleepSees(e, where));
  return { main: rows.filter((e) => !e.more), more: rows.filter((e) => e.more) };
}
/** Every Sleep setting seen here that matches every typed word, best first (the same matching as Settings). */
export function searchSleep(q: string, where: SleepWhere): SleepEntry[] {
  const toks = tokensOf(q);
  if (!toks.length) return [];
  const whole = norm(q);
  const out: { e: SleepEntry; s: number }[] = [];
  for (const e of SLEEP_ENTRIES) {
    if (!sleepSees(e, where)) continue;
    const s = scoreOne(toks, whole, { name: norm(e.name), line: norm(e.line), words: (e.words ?? []).map(norm), group: norm(sleepGroup(e.group).label) });
    if (s > 0) out.push({ e, s });
  }
  const order = (e: SleepEntry) => SLEEP_GROUPS.findIndex((g) => g.id === e.group) * 1000 + SLEEP_ENTRIES.indexOf(e);
  return out.sort((a, b) => b.s - a.s || order(a.e) - order(b.e)).map((x) => x.e);
}

/** Where every setting of the old Sleep mode sheet (and Customise) lives now: nothing was dropped. */
export const MOVED: { old: string; now: string }[] = [
  { old: "Alarms (times, on or off, the style of each)", now: "alarms" },
  { old: "Wake me up in, and Rings with", now: "wake-in" },
  { old: "Your own sound", now: "sound" },
  { old: "Alarm loudness and Test", now: "loudness" },
  { old: "Wake styles and their previews", now: "styles" },
  { old: "Sunrise starts", now: "sunrise" },
  { old: "Colour wave", now: "wave" },
  { old: "Strobe flash", now: "strobe" },
  { old: "Customise: Clock face, the face's marks, second hand, time under it, face, hands and ticks colours", now: "face" },
  { old: "Customise: Clock size", now: "size" },
  { old: "Customise: Font", now: "font" },
  { old: "Customise: Clock colour", now: "colour" },
  { old: "Customise: Other words", now: "text" },
  { old: "Customise: Brightness", now: "bright" },
  { old: "Customise: Background", now: "bg" },
  { old: "Customise: Weight", now: "weight" },
  { old: "Customise: Letter spacing", now: "spacing" },
  { old: "Customise: 12 or 24 hour, Seconds", now: "hours" },
  { old: "Customise: Clock sits", now: "pos" },
  { old: "Customise: Back to the usual look", now: "reset" },
  { old: "Customise: Shows (Asleep for, alarms, date, countdown, panel, tasks, G Squad)", now: "pieces" },
  { old: "What the screen shows (Counts only or Full details)", now: "details" },
  { old: "The panel rises", now: "panel" },
  { old: "Customise: Stopwatch", now: "watch" },
  { old: "Customise: Hide the pointer", now: "pointer" },
  { old: "Ask for Touch ID to leave Sleep mode", now: "lock" },
  { old: "After Wake up", now: "ask" },
  { old: "Sleep log (Settings, Sleep)", now: "goal" },
  { old: "Sleep button", now: "button" },
  { old: "What this device does (the note at the foot)", now: "here" },
];

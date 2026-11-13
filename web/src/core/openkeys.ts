// Tab overlay shortcuts (V1.47, the developer, 10 Nov 2026: "In the Settings menu, a tab called Tab overlay shortcuts. Add new
// shortcuts or change shortcuts, if someone doesn't want the Tab button to open the overlay. People with keyboards in
// different languages won't have the same keys in the same place, so I want to be able to pick different keys. Also
// hold down a key and then press another key, for example hold P then press O and the overlay pops up. Make it so you
// can create your own rhythm for how you open PS.")
//
// The page's half: the same rules as ps-mac Sources/OpenKeysCore.swift (which checks the list again before it saves
// it and is the one that matches keys), the names of keys, and the recorder that turns the keys someone presses into
// a shortcut. Every shortcut is kept by macOS key code (the physical key), so any keyboard layout works; the label is
// what that key types on the layout in use, sent by the Mac (PsSettings.shortcuts.labels). Pure: no React, no DOM.

export type OpenKind = "hold" | "combo" | "chord";
export type ModName = "cmd" | "ctrl" | "opt" | "shift";
export interface OpenShortcut {
  kind: OpenKind;
  /** hold: the key held. combo: the key pressed with the modifiers. chord: the key pressed second. */
  key: number;
  /** chord only: the key held first. */
  first?: number;
  /** combo only. */
  mods?: ModName[];
}

export const TAB = 48, SPACE = 49, ESC = 53, RETURN = 36, ENTER = 76, DELETE = 51, FWD_DELETE = 117, CAPS = 57;
export const SLASH = 44, DOT = 47, RIGHT_OPTION = 61, FN = 63;
const ARROWS = new Set([123, 124, 125, 126]);
export const F_KEYS = new Set([122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90]);
export const MODIFIER_FAMILY: Record<number, "cmd" | "shift" | "opt" | "ctrl" | "fn"> = {
  55: "cmd", 54: "cmd", 56: "shift", 60: "shift", 58: "opt", 61: "opt", 59: "ctrl", 62: "ctrl", 63: "fn",
};
const KEYPAD_TYPING = new Set([65, 67, 69, 75, 78, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92]);

export const isModifier = (c: number) => c in MODIFIER_FAMILY || c === CAPS;
export const isTyping = (c: number) => KEYPAD_TYPING.has(c) || (c >= 0 && c <= 50 && c !== RETURN && c !== TAB && c !== DELETE);
const isLeftModifier = (c: number) => c === 55 || c === 56 || c === 58 || c === 59;

/** What someone who never opened the tab has: hold Tab (or Right Option), and / then . while that is on. */
export function legacyList(triggerKey: string | undefined, slashOn: boolean | undefined): OpenShortcut[] {
  const l: OpenShortcut[] = [{ kind: "hold", key: triggerKey === "rightOption" ? RIGHT_OPTION : TAB }];
  if (slashOn ?? true) l.push({ kind: "chord", key: DOT, first: SLASH });
  return l;
}
export const DEFAULT_LIST: OpenShortcut[] = legacyList("tab", true);

// ---------- KeyboardEvent.code to macOS key code (the recorder) ----------
const CODE: Record<string, number> = {
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7, KeyC: 8, KeyV: 9, IntlBackslash: 10, KeyB: 11,
  KeyQ: 12, KeyW: 13, KeyE: 14, KeyR: 15, KeyY: 16, KeyT: 17, Digit1: 18, Digit2: 19, Digit3: 20, Digit4: 21, Digit6: 22,
  Digit5: 23, Equal: 24, Digit9: 25, Digit7: 26, Minus: 27, Digit8: 28, Digit0: 29, BracketRight: 30, KeyO: 31, KeyU: 32,
  BracketLeft: 33, KeyI: 34, KeyP: 35, Enter: 36, KeyL: 37, KeyJ: 38, Quote: 39, KeyK: 40, Semicolon: 41, Backslash: 42,
  Comma: 43, Slash: 44, KeyN: 45, KeyM: 46, Period: 47, Tab: 48, Space: 49, Backquote: 50, Backspace: 51, Escape: 53,
  MetaRight: 54, MetaLeft: 55, OSRight: 54, OSLeft: 55, ShiftLeft: 56, CapsLock: 57, AltLeft: 58, ControlLeft: 59,
  ShiftRight: 60, AltRight: 61, ControlRight: 62, Fn: 63, F17: 64, NumpadDecimal: 65, NumpadMultiply: 67, NumpadAdd: 69,
  NumLock: 71, NumpadDivide: 75, NumpadEnter: 76, NumpadSubtract: 78, F18: 79, F19: 80, NumpadEqual: 81, Numpad0: 82,
  Numpad1: 83, Numpad2: 84, Numpad3: 85, Numpad4: 86, Numpad5: 87, Numpad6: 88, Numpad7: 89, F20: 90, Numpad8: 91,
  Numpad9: 92, IntlYen: 93, IntlRo: 94, F5: 96, F6: 97, F7: 98, F3: 99, F8: 100, F9: 101, F11: 103, F13: 105, F16: 106,
  F14: 107, F10: 109, ContextMenu: 110, F12: 111, F15: 113, Insert: 114, Help: 114, Home: 115, PageUp: 116, Delete: 117,
  F4: 118, End: 119, F2: 120, PageDown: 121, F1: 122, ArrowLeft: 123, ArrowRight: 124, ArrowDown: 125, ArrowUp: 126,
};
/** The Mac key code of a KeyboardEvent.code (the physical key), or undefined for a key PS cannot use. */
export const macKeyCode = (code: string): number | undefined => CODE[code];

// ---------- names ----------
const FIXED: Record<number, string> = {
  48: "Tab", 49: "Space", 36: "Return", 76: "Enter", 51: "Delete", 117: "Forward Delete", 53: "Esc", 57: "Caps Lock",
  55: "Left Command", 54: "Right Command", 56: "Left Shift", 60: "Right Shift", 58: "Left Option", 61: "Right Option",
  59: "Left Control", 62: "Right Control", 63: "fn", 123: "Left Arrow", 124: "Right Arrow", 125: "Down Arrow", 126: "Up Arrow",
  115: "Home", 119: "End", 116: "Page Up", 121: "Page Down", 122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6",
  98: "F7", 100: "F8", 101: "F9", 109: "F10", 103: "F11", 111: "F12", 105: "F13", 107: "F14", 113: "F15", 106: "F16",
  64: "F17", 79: "F18", 80: "F19", 90: "F20",
};
/** US English names, only used until the Mac has sent the labels for its own layout. */
const US: Record<number, string> = {
  0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X", 8: "C", 9: "V", 10: "§", 11: "B", 12: "Q", 13: "W", 14: "E",
  15: "R", 16: "Y", 17: "T", 18: "1", 19: "2", 20: "3", 21: "4", 22: "6", 23: "5", 24: "=", 25: "9", 26: "7", 27: "-", 28: "8",
  29: "0", 30: "]", 31: "O", 32: "U", 33: "[", 34: "I", 35: "P", 37: "L", 38: "J", 39: "'", 40: "K", 41: ";", 42: "\\", 43: ",",
  44: "/", 45: "N", 46: "M", 47: ".", 50: "`",
};
export type Labels = Record<string, string> | undefined;
/** What a key is called on this Mac's keyboard layout. */
export function keyLabel(code: number, labels?: Labels): string {
  return FIXED[code] ?? labels?.[String(code)] ?? US[code] ?? `Key ${code}`;
}
const MOD_ORDER: ModName[] = ["ctrl", "opt", "shift", "cmd"];
const MOD_NAME: Record<ModName, string> = { ctrl: "Control", opt: "Option", shift: "Shift", cmd: "Command" };
/** The keys of a shortcut in order, for keycaps. */
export function keysOf(s: OpenShortcut, labels?: Labels): string[] {
  if (s.kind === "hold") return [keyLabel(s.key, labels)];
  if (s.kind === "chord") return [keyLabel(s.first ?? 0, labels), keyLabel(s.key, labels)];
  return [...MOD_ORDER.filter((m) => s.mods?.includes(m)).map((m) => MOD_NAME[m]), keyLabel(s.key, labels)];
}
/** One plain line: "Hold Tab", "Hold P, then press O", "Press Control Option Space". */
export function describe(s: OpenShortcut, labels?: Labels): string {
  const k = keysOf(s, labels);
  if (s.kind === "hold") return `Hold ${k[0]}`;
  if (s.kind === "chord") return `Hold ${k[0]}, then press ${k[1]}`;
  return `Press ${k.join(" ")}`;
}
export const KIND_NAME: Record<OpenKind, string> = { hold: "Hold a key", combo: "Tap a key combo", chord: "Hold one key, then press another" };

// ---------- checks (the same as OpenKeysCore.swift) ----------
export function refusal(s: OpenShortcut): string | null {
  const k = s.key;
  if (!Number.isInteger(k) || k < 0 || k > 127) return "That key cannot be used.";
  if (k === ESC || s.first === ESC) return "Esc always closes PS app, so it cannot open it.";
  if (k === CAPS || s.first === CAPS) return "Caps Lock cannot be used.";
  const repeats = (c: number) => c === RETURN || c === ENTER || c === DELETE || c === FWD_DELETE || ARROWS.has(c);
  if (s.kind === "hold") return repeats(k) ? "You hold this key to repeat it, so it cannot be a hold key." : null;
  if (s.kind === "combo") {
    if (isModifier(k)) return "A combo needs a key that is not Command, Control, Option, Shift or fn.";
    const m = s.mods ?? [];
    if (m.some((x) => !["cmd", "ctrl", "opt", "shift"].includes(x))) return "That modifier cannot be used.";
    if (!F_KEYS.has(k) && !m.some((x) => x !== "shift")) return "Add Command, Control or Option, or the combo would stop you typing that key.";
    return null;
  }
  const f = s.first;
  if (f === undefined) return "Pick the key you hold first.";
  if (f === k) return "The two keys must be different.";
  if (isModifier(f) || isModifier(k)) return "For a modifier with a key, use Tap a key combo instead.";
  if (repeats(f)) return "You hold this key to repeat it, so it cannot start a chord.";
  return null;
}

const sameMods = (a?: ModName[], b?: ModName[]) => { const x = new Set(a ?? []), y = new Set(b ?? []); return x.size === y.size && [...x].every((m) => y.has(m)); };
/** Two shortcuts the Mac could not tell apart, or the same one twice. */
export function clash(a: OpenShortcut, b: OpenShortcut): boolean {
  if (a.kind === "combo" && b.kind === "combo") return a.key === b.key && sameMods(a.mods, b.mods);
  if (a.kind === "combo" || b.kind === "combo") return false;
  const ka = a.kind === "hold" ? a.key : a.first ?? -1, kb = b.kind === "hold" ? b.key : b.first ?? -1;
  if (a.kind === "hold" && b.kind === "hold") return ka === kb;
  if (a.kind === "chord" && b.kind === "chord") return ka === kb && a.key === b.key;
  return ka === kb;
}
const same = (a: OpenShortcut, b: OpenShortcut) => a.kind === b.kind && a.key === b.key && a.first === b.first && sameMods(a.mods, b.mods);

const SYSTEM: [ModName[], number, string][] = [
  [["cmd"], SPACE, "Spotlight"], [["ctrl"], SPACE, "switching keyboard language"], [["ctrl", "opt"], SPACE, "switching keyboard language"],
  [["cmd", "opt"], SPACE, "Finder search"], [["ctrl", "cmd"], SPACE, "the emoji picker"], [["cmd"], TAB, "switching apps"],
  [["cmd", "shift"], TAB, "switching apps"], [["cmd"], 12, "Quit"], [["cmd"], 13, "Close window"], [["cmd"], 4, "Hide"],
  [["cmd"], 46, "Minimise"], [["cmd"], 8, "Copy"], [["cmd"], 9, "Paste"], [["cmd"], 7, "Cut"], [["cmd"], 6, "Undo"],
  [["cmd"], 0, "Select all"], [["cmd"], 1, "Save"], [["cmd"], 3, "Find"], [["cmd"], 45, "New"], [["cmd"], 31, "Open"],
  [["cmd"], 35, "Print"], [["cmd"], 50, "switching windows"], [["cmd"], 43, "Settings in most apps"],
  [["cmd", "shift"], 20, "screenshots"], [["cmd", "shift"], 21, "screenshots"], [["cmd", "shift"], 23, "screenshots"],
  [["ctrl", "cmd"], 12, "Lock Screen"], [["cmd", "opt"], ESC, "Force Quit"], [["ctrl"], 126, "Mission Control"],
  [["ctrl"], 125, "App windows"], [["ctrl"], 123, "moving between Spaces"], [["ctrl"], 124, "moving between Spaces"],
  [["ctrl", "cmd"], 3, "full screen"],
];
/** A macOS shortcut this would take over (the common ones; one another app holds is found when the Mac tries it). */
export function systemClash(s: OpenShortcut): string | null {
  if (s.kind === "hold" && s.key === FN) return "macOS uses holding fn (Globe) for dictation or emoji.";
  if (s.kind !== "combo") return null;
  const hit = SYSTEM.find(([m, k]) => k === s.key && sameMods(m, s.mods));
  return hit ? `macOS uses this for ${hit[2]}.` : null;
}

export function warning(s: OpenShortcut): string | null {
  const sys = systemClash(s);
  if (sys) return sys;
  if (s.kind === "hold" && isTyping(s.key))
    return "Holding a letter or other typing key slows typing a little: PS app waits a moment to see if you are holding it. Quick taps still type it. A modifier like Right Option, or a key you rarely use (F13 to F19), works better.";
  if (s.kind === "hold" && isLeftModifier(s.key))
    return "You hold this key for other shortcuts, so the list may pop up when you only meant a shortcut. The right side keys are safer.";
  if (s.kind === "chord" && isTyping(s.first ?? -1))
    return "Starts on a typing key: hold it a moment before pressing the second key. Typing fast stays typing.";
  return null;
}

export interface Problem { index: number; error: boolean; text: string }
/** Everything wrong with a list. Errors stop it being saved; warnings are shown and allowed. */
export function problems(list: OpenShortcut[]): Problem[] {
  const out: Problem[] = [];
  if (list.length === 0) out.push({ index: -1, error: true, text: "Keep at least one shortcut." });
  if (list.length > 12) out.push({ index: -1, error: true, text: "Twelve shortcuts at most." });
  list.forEach((s, i) => {
    const r = refusal(s);
    if (r) { out.push({ index: i, error: true, text: r }); return; }
    const j = list.findIndex((o, n) => n < i && !refusal(o) && clash(o, s));
    if (j >= 0) {
      out.push({ index: i, error: true, text: same(list[j], s) ? "This shortcut is already in the list." : `This clashes with shortcut ${j + 1}: PS app could not tell which you meant.` });
      return;
    }
    const w = warning(s);
    if (w) out.push({ index: i, error: false, text: w });
  });
  return out;
}
export const canSave = (list: OpenShortcut[]) => !problems(list).some((p) => p.error);

/** Whether macOS itself can match it (a hotkey), so it works over 1Password and Signal, where PS reads no key at all.
 *  Holds only for Tab and the F keys: a hotkey on a key that types would take that key from the app. */
export function worksOverProtected(s: OpenShortcut): boolean {
  if (refusal(s)) return false;
  if (s.kind === "combo") return true;
  if (s.kind === "hold") return s.key === TAB || F_KEYS.has(s.key);
  return false;
}

/** The list with one shortcut put in (index -1: added at the end) or taken out (shortcut null). */
export function edit(list: OpenShortcut[], index: number, s: OpenShortcut | null): OpenShortcut[] {
  if (s === null) return list.filter((_, i) => i !== index);
  if (index < 0 || index >= list.length) return [...list, s];
  return list.map((x, i) => (i === index ? s : x));
}
/** A shortcut cleaned for saving (only the fields its kind uses, modifiers in one order). */
export function tidy(s: OpenShortcut): OpenShortcut {
  if (s.kind === "hold") return { kind: "hold", key: s.key };
  if (s.kind === "chord") return { kind: "chord", key: s.key, first: s.first };
  return { kind: "combo", key: s.key, mods: MOD_ORDER.filter((m) => s.mods?.includes(m)) };
}

// ---------- the recorder ----------
export interface RecKey { type: "down" | "up"; code: number; repeat?: boolean; mods: { cmd: boolean; ctrl: boolean; opt: boolean; shift: boolean } }
export interface RecState { kind: OpenKind; first?: number; soloMod?: number; hint?: string }
export interface RecStep { st: RecState; done?: OpenShortcut; hint?: string }
const heldMods = (k: RecKey): ModName[] => MOD_ORDER.filter((m) => k.mods[m]);
/** One key event while recording. A key down of Esc is never here (it cancels, and Esc always closes). */
export function recStep(st: RecState, k: RecKey): RecStep {
  const mod = isModifier(k.code);
  if (st.kind === "hold") {
    if (k.type === "down" && mod && k.code !== CAPS) return { st: { kind: "hold", soloMod: k.code } };
    if (k.type === "up" && mod && st.soloMod === k.code) return { st: { kind: "hold" }, done: { kind: "hold", key: k.code } };
    if (k.type === "down" && !mod && !k.repeat) {
      if (heldMods(k).length) return { st: { kind: "hold" }, hint: "Hold one key on its own. For a key with modifiers, pick Tap a key combo." };
      return { st: { kind: "hold" }, done: { kind: "hold", key: k.code } };
    }
    return { st };
  }
  if (st.kind === "combo") {
    if (k.type === "down" && !mod && !k.repeat) {
      const mods = heldMods(k);
      return { st: { kind: "combo" }, done: tidy({ kind: "combo", key: k.code, mods }) };
    }
    return { st };
  }
  // chord
  if (k.type === "down" && !k.repeat && !mod) {
    if (heldMods(k).length) return { st: { kind: "chord" }, hint: "No modifiers here: hold one plain key, then press another." };
    if (st.first === undefined) return { st: { kind: "chord", first: k.code } };
    if (k.code !== st.first) return { st: { kind: "chord" }, done: { kind: "chord", first: st.first, key: k.code } };
  }
  if (k.type === "up" && st.first === k.code) return { st: { kind: "chord" }, hint: "Keep holding the first key while you press the second." };
  return { st };
}
/** What the recorder says while it listens. */
export function recPrompt(st: RecState, labels?: Labels): string {
  if (st.kind === "hold") return st.soloMod !== undefined ? `Let go of ${keyLabel(st.soloMod, labels)} to use it on its own` : "Press the key you want to hold";
  if (st.kind === "combo") return "Press the combo, for example Control Option Space";
  return st.first === undefined ? "Hold the first key down" : `Keep holding ${keyLabel(st.first, labels)} and press the second key`;
}

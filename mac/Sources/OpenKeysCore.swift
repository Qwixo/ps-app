import Foundation

// Tab overlay shortcuts (V1.47, the developer, 10 Nov 2026: "In the Settings menu, a tab called Tab overlay shortcuts. Add new
// shortcuts or change shortcuts, if someone doesn't want the Tab button to open the overlay. People with keyboards in
// different languages won't have the same keys in the same place, so I want to be able to pick different keys. Also
// hold down a key and then press another key, for example hold P then press O and the overlay pops up. Make it so you
// can create your own rhythm for how you open PS.")
//
// The rules only, plain values, so tests/openkeys-test.swift checks every case without macOS. The keyboard tap
// (TabWatch in main.swift) and SafePeek ask the Plan made here what a key means.
//
// Three kinds, each saved by macOS key code (the physical key, so any keyboard layout works; the label shown is
// what that key types on the layout in use, KeyLayout.label):
//  - hold:  hold one key (today's hold Tab, or a modifier alone like Right Option). A quick tap still types the key.
//  - combo: tap a key with modifiers (Control Option Space). macOS matches it (a Carbon hotkey), so PS reads no key.
//  - chord: hold one key, then press another (today's / then . , or P then O). Letting go of the first without the
//           second types it as normal.
// Never saved: no list at all. Until someone changes the list, the old two settings (hold Tab or Right Option, and
// the / then . switch) ARE the list (legacy), so nobody's keys change on updating.
enum OpenKeysCore {
  enum Kind: String, Codable, Equatable { case hold, combo, chord }

  struct Shortcut: Codable, Equatable {
    var kind: Kind
    /// hold: the key held. combo: the key pressed with the modifiers. chord: the key pressed second.
    var key: Int
    /// chord only: the key held first.
    var first: Int? = nil
    /// combo only: any of "cmd", "ctrl", "opt", "shift".
    var mods: [String]? = nil
  }

  // ---------- macOS key codes ----------
  static let TAB = 48, SPACE = 49, ESC = 53, RETURN = 36, ENTER = 76, DELETE = 51, FWD_DELETE = 117, CAPS = 57
  static let SLASH = 44, DOT = 47, RIGHT_OPTION = 61, FN = 63
  static let arrows: Set<Int> = [123, 124, 125, 126]
  /// F1 to F20.
  static let fKeys: Set<Int> = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111, 105, 107, 113, 106, 64, 79, 80, 90]
  /// Modifier keys and the family each belongs to.
  static let modifierFamily: [Int: String] = [55: "cmd", 54: "cmd", 56: "shift", 60: "shift", 58: "opt", 61: "opt",
                                              59: "ctrl", 62: "ctrl", 63: "fn"]
  static let keypadTyping: Set<Int> = [65, 67, 69, 75, 78, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92]

  static func isModifier(_ code: Int) -> Bool { modifierFamily[code] != nil || code == CAPS }
  /// A key that types a character (letters, digits, punctuation, Space, the keypad digits) on any layout.
  static func isTyping(_ code: Int) -> Bool {
    if keypadTyping.contains(code) { return true }
    return code >= 0 && code <= 50 && code != RETURN && code != TAB && code != DELETE
  }
  /// Right side modifiers are rarely held for other shortcuts; the left ones are.
  static func isLeftModifier(_ code: Int) -> Bool { [55, 56, 58, 59].contains(code) }

  // ---------- how long a hold is ----------
  /// Today's hold time for Tab (HOLD_SECONDS in main.swift is the same number).
  static let baseHold = 0.18
  /// A key that types needs a longer hold, so a slow keystroke stays a letter. Typing never waits longer than it does
  /// for Tab today: the key goes out the moment it is let go or another key is pressed.
  static let typingHold = 0.30
  static func holdSeconds(_ code: Int) -> Double { isTyping(code) ? typingHold : baseHold }
  /// A chord that starts on a typing key needs its first key down this long before the second counts, so fast typing
  /// that rolls from P onto O ("pop") stays typing. A chord starting on / keeps no gap: the / then . chord has worked
  /// that way since 20 Oct 2026, so it stays exactly as it is, saved or not.
  static let typingChordGap = 0.12
  static func chordGap(_ first: Int, legacy: Bool = false) -> Double { !legacy && first != SLASH && isTyping(first) ? typingChordGap : 0 }

  // ---------- the old settings as a list ----------
  /// What someone who never opened the new tab has: hold Tab (or Right Option), plus / then . while it is on.
  static func legacy(triggerKey: String, slashOn: Bool) -> [Shortcut] {
    var l = [Shortcut(kind: .hold, key: triggerKey == "rightOption" ? RIGHT_OPTION : TAB)]
    if slashOn { l.append(Shortcut(kind: .chord, key: DOT, first: SLASH)) }
    return l
  }
  /// The default list ("Reset to Tab").
  static var defaults: [Shortcut] { legacy(triggerKey: "tab", slashOn: true) }

  // ---------- what the keyboard tap uses ----------
  struct Plan: Equatable {
    /// Non modifier keys held to open the list, with their hold time.
    var holdKeys: [Int64: Double] = [:]
    /// Modifier keys held alone (Right Option): flagsChanged.
    var modHolds: Set<Int64> = []
    /// Chords: first key to the keys that finish it.
    var chords: [Int64: Set<Int64>] = [:]
    /// Chords: how long the first key must be down before the second counts.
    var chordGaps: [Int64: Double] = [:]
    /// Combos (matched by macOS, never by the tap).
    var combos: [Shortcut] = []

    init() {}
    init(_ list: [Shortcut], legacy: Bool = false) {
      for s in list where OpenKeysCore.refusal(s) == nil {
        switch s.kind {
        case .hold:
          if OpenKeysCore.isModifier(s.key) { modHolds.insert(Int64(s.key)) }
          else { holdKeys[Int64(s.key)] = legacy ? OpenKeysCore.baseHold : OpenKeysCore.holdSeconds(s.key) }
        case .chord:
          guard let f = s.first else { continue }
          chords[Int64(f), default: []].insert(Int64(s.key))
          chordGaps[Int64(f)] = OpenKeysCore.chordGap(f, legacy: legacy)
        case .combo:
          combos.append(s)
        }
      }
    }
    /// The hold time for a held key, or nil when that key does not open the list.
    func hold(_ code: Int64) -> Double? { holdKeys[code] }
    /// Whether this key down starts a chord.
    func startsChord(_ code: Int64) -> Bool { chords[code] != nil }
    /// Whether `code` pressed `heldFor` seconds after `first` went down finishes a chord (plain keys, no repeat: the
    /// tap checks those). Too soon after a typing key: it was typing.
    func finishesChord(first: Int64, code: Int64, heldFor: Double) -> Bool {
      guard chords[first]?.contains(code) == true else { return false }
      return heldFor >= (chordGaps[first] ?? 0)
    }
  }

  /// What one event means while the tap is idle (no key held back): the decision the tap acts on.
  enum Start: Equatable { case none, hold(Double), chord, modHold }
  static func start(_ plan: Plan, code: Int64, down: Bool, plain: Bool, repeating: Bool, flagsChanged: Bool) -> Start {
    if flagsChanged { return plan.modHolds.contains(code) ? .modHold : .none }
    guard down, plain, !repeating else { return .none }
    if plan.startsChord(code) { return .chord }        // checked first, as the tap does (a key is never both)
    if let s = plan.hold(code) { return .hold(s) }
    return .none
  }
  /// A key that was held back (a hold or a chord's first key) is let go: before its hold time it was a tap, so the
  /// key goes on to the app as typed. After it, the list was up.
  static func release(heldFor: Double, holdTime: Double) -> Bool { heldFor < holdTime }   // true: send the key on

  // ---------- macOS hotkeys (combos everywhere; over 1Password and Signal the only way in) ----------
  /// Carbon modifier bits (cmdKey, shiftKey, optionKey, controlKey in Carbon.HIToolbox).
  static func carbonMods(_ mods: [String]) -> UInt32 {
    var m: UInt32 = 0
    for x in mods {
      switch x { case "cmd": m |= 256; case "shift": m |= 512; case "opt": m |= 2048; case "ctrl": m |= 4096; default: break }
    }
    return m
  }
  /// A key PS may grab with a hotkey while it is held: grabbing takes that key from the app in front for as long as
  /// the hotkey is armed, so never a key that types (that would eat letters typed in 1Password or Signal) or one held
  /// to repeat. Tab (today's accepted cost) and the F keys only.
  static func grabSafe(_ code: Int) -> Bool { code == TAB || fKeys.contains(code) }
  /// Whether macOS can match this shortcut by itself (a Carbon hotkey), so it works with the keyboard tap off:
  /// over 1Password and Signal, and while macOS Secure Input is stuck on. Chords and modifier holds need the tap.
  static func hotkeyable(_ s: Shortcut) -> Bool {
    guard refusal(s) == nil else { return false }
    switch s.kind {
    case .combo: return true
    case .hold: return grabSafe(s.key)
    case .chord: return false
    }
  }
  /// Hold keys SafePeek arms while the tap is blind. Legacy keeps today's rule: plain Tab, whichever key is chosen.
  static func blindHolds(_ list: [Shortcut], legacy: Bool) -> [Int] {
    if legacy { return [TAB] }
    var out: [Int] = []
    for s in list where s.kind == .hold && hotkeyable(s) && !out.contains(s.key) { out.append(s.key) }
    return out
  }

  // ---------- checks ----------
  /// A shortcut PS will not save, and why. nil: fine.
  static func refusal(_ s: Shortcut) -> String? {
    let k = s.key
    if k < 0 || k > 127 { return "That key cannot be used." }
    if k == ESC || s.first == ESC { return "Esc always closes PS app, so it cannot open it." }
    if k == CAPS || s.first == CAPS { return "Caps Lock cannot be used." }
    switch s.kind {
    case .hold:
      if k == RETURN || k == ENTER || k == DELETE || k == FWD_DELETE || arrows.contains(k) {
        return "You hold this key to repeat it, so it cannot be a hold key."
      }
      return nil
    case .combo:
      if isModifier(k) { return "A combo needs a key that is not Command, Control, Option, Shift or fn." }
      let m = s.mods ?? []
      if m.contains(where: { !["cmd", "ctrl", "opt", "shift"].contains($0) }) { return "That modifier cannot be used." }
      if !fKeys.contains(k) && !m.contains(where: { $0 != "shift" }) {
        return "Add Command, Control or Option, or the combo would stop you typing that key."
      }
      return nil
    case .chord:
      guard let f = s.first else { return "Pick the key you hold first." }
      if f == k { return "The two keys must be different." }
      if isModifier(f) || isModifier(k) { return "For a modifier with a key, use Tap a key combo instead." }
      if f == RETURN || f == ENTER || f == DELETE || f == FWD_DELETE || arrows.contains(f) {
        return "You hold this key to repeat it, so it cannot start a chord."
      }
      return nil
    }
  }

  /// Two shortcuts the tap could not tell apart, or the same one twice.
  static func clash(_ a: Shortcut, _ b: Shortcut) -> Bool {
    if a.kind == .combo && b.kind == .combo { return a.key == b.key && Set(a.mods ?? []) == Set(b.mods ?? []) }
    if a.kind == .combo || b.kind == .combo { return false }
    let ka = a.kind == .hold ? a.key : a.first ?? -1   // the key that goes down first
    let kb = b.kind == .hold ? b.key : b.first ?? -1
    if a.kind == .hold && b.kind == .hold { return ka == kb }
    if a.kind == .chord && b.kind == .chord { return ka == kb && a.key == b.key }
    return ka == kb   // a hold key that also starts a chord: no way to know which you meant
  }

  /// macOS's own shortcuts a combo would take over (the common ones; a hotkey another app holds is found when PS
  /// tries to register it). nil: none known.
  static func systemClash(_ s: Shortcut) -> String? {
    if s.kind == .hold && s.key == FN { return "macOS uses holding fn (Globe) for dictation or emoji." }
    guard s.kind == .combo else { return nil }
    let m = Set(s.mods ?? [])
    let known: [(Set<String>, Int, String)] = [
      (["cmd"], SPACE, "Spotlight"), (["ctrl"], SPACE, "switching keyboard language"),
      (["ctrl", "opt"], SPACE, "switching keyboard language"), (["cmd", "opt"], SPACE, "Finder search"),
      (["ctrl", "cmd"], SPACE, "the emoji picker"), (["cmd"], TAB, "switching apps"), (["cmd", "shift"], TAB, "switching apps"),
      (["cmd"], 12, "Quit"), (["cmd"], 13, "Close window"), (["cmd"], 4, "Hide"), (["cmd"], 46, "Minimise"),
      (["cmd"], 8, "Copy"), (["cmd"], 9, "Paste"), (["cmd"], 7, "Cut"), (["cmd"], 6, "Undo"), (["cmd"], 0, "Select all"),
      (["cmd"], 1, "Save"), (["cmd"], 3, "Find"), (["cmd"], 45, "New"), (["cmd"], 31, "Open"), (["cmd"], 35, "Print"),
      (["cmd"], 50, "switching windows"), (["cmd"], 43, "Settings in most apps"),
      (["cmd", "shift"], 20, "screenshots"), (["cmd", "shift"], 21, "screenshots"), (["cmd", "shift"], 23, "screenshots"),
      (["ctrl", "cmd"], 12, "Lock Screen"), (["cmd", "opt"], ESC, "Force Quit"),
      (["ctrl"], 126, "Mission Control"), (["ctrl"], 125, "App windows"), (["ctrl"], 123, "moving between Spaces"),
      (["ctrl"], 124, "moving between Spaces"), (["ctrl", "cmd"], 3, "full screen"),
    ]
    for (km, kk, what) in known where km == m && kk == s.key { return "macOS uses this for \(what)." }
    return nil
  }

  /// A plain warning PS shows but still allows.
  static func warning(_ s: Shortcut) -> String? {
    if let sys = systemClash(s) { return sys }
    switch s.kind {
    case .hold where isTyping(s.key):
      return "Holding a letter or other typing key slows typing a little: PS app waits a moment to see if you are holding it. Quick taps still type it. A modifier like Right Option, or a key you rarely use (F13 to F19), works better."
    case .hold where isLeftModifier(s.key):
      return "You hold this key for other shortcuts, so the list may pop up when you only meant a shortcut. The right side keys are safer."
    case .chord where isTyping(s.first ?? -1):
      return "Starts on a typing key: hold it a moment before pressing the second key. Typing fast stays typing."
    default:
      return nil
    }
  }

  struct Problem: Equatable {
    var index: Int      // -1: the list as a whole
    var error: Bool     // true: not saved
    var text: String
  }
  /// Everything wrong with a list. Errors stop it being saved; warnings are shown and allowed.
  static func problems(_ list: [Shortcut]) -> [Problem] {
    var out: [Problem] = []
    if list.isEmpty { out.append(Problem(index: -1, error: true, text: "Keep at least one shortcut.")) }
    if list.count > 12 { out.append(Problem(index: -1, error: true, text: "Twelve shortcuts at most.")) }
    for (i, s) in list.enumerated() {
      if let r = refusal(s) { out.append(Problem(index: i, error: true, text: r)); continue }
      if let j = list.indices.first(where: { $0 < i && refusal(list[$0]) == nil && clash(list[$0], s) }) {
        out.append(Problem(index: i, error: true, text: list[j] == s ? "This shortcut is already in the list." : "This clashes with shortcut \(j + 1): PS app could not tell which you meant."))
        continue
      }
      if let w = warning(s) { out.append(Problem(index: i, error: false, text: w)) }
    }
    return out
  }
  static func canSave(_ list: [Shortcut]) -> Bool { !problems(list).contains { $0.error } }

  // ---------- saving ----------
  static func decode(_ json: String?) -> [Shortcut]? {
    guard let d = json?.data(using: .utf8), let l = try? JSONDecoder().decode([Shortcut].self, from: d), !l.isEmpty else { return nil }
    return l
  }
  static func encode(_ list: [Shortcut]) -> String {
    (try? JSONEncoder().encode(list)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
  }

  /// A short name for the pop-up's "Hold ... to open your list". `label` says what a key code types on this layout.
  static func describe(_ s: Shortcut, label: (Int) -> String) -> String {
    switch s.kind {
    case .hold: return label(s.key)
    case .chord: return "\(label(s.first ?? 0)) and press \(label(s.key))"
    case .combo:
      let order = ["ctrl", "opt", "shift", "cmd"], names = ["ctrl": "Control", "opt": "Option", "shift": "Shift", "cmd": "Command"]
      let m = order.filter { (s.mods ?? []).contains($0) }.compactMap { names[$0] }
      return (m + [label(s.key)]).joined(separator: " ")
    }
  }
  /// Names for keys whose label is not a character (used when the layout gives nothing printable).
  static func fixedName(_ code: Int) -> String? {
    let names: [Int: String] = [48: "Tab", 49: "Space", 36: "Return", 76: "Enter", 51: "Delete", 117: "Forward Delete", 53: "Esc",
      57: "Caps Lock", 55: "Left Command", 54: "Right Command", 56: "Left Shift", 60: "Right Shift", 58: "Left Option",
      61: "Right Option", 59: "Left Control", 62: "Right Control", 63: "fn",
      123: "Left Arrow", 124: "Right Arrow", 125: "Down Arrow", 126: "Up Arrow", 115: "Home", 119: "End", 116: "Page Up", 121: "Page Down",
      122: "F1", 120: "F2", 99: "F3", 118: "F4", 96: "F5", 97: "F6", 98: "F7", 100: "F8", 101: "F9", 109: "F10",
      103: "F11", 111: "F12", 105: "F13", 107: "F14", 113: "F15", 106: "F16", 64: "F17", 79: "F18", 80: "F19", 90: "F20"]
    return names[code]
  }
}

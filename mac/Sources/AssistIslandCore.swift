// The Settings assistant's island card (PS 1.65), the rules only: which look for which state, how big, when a sound plays, and the
// one that matters most: when the card may take the keyboard. No windows and no sounds here (tests/assist-test.sh checks it).
import Foundation

enum AssistLook: String, Equatable { case hidden, ask, thinking, answer, confirm, walk, done, error }

/// A button on the confirm card. Only these three, and only the ones the page sent (the page decides: a change has Do it).
enum AssistButton: String, Equatable, CaseIterable { case doit, show, cancel
  var word: String { switch self { case .doit: return AssistWords.doIt; case .show: return AssistWords.showHow; case .cancel: return AssistWords.cancel } }
}

enum AssistIslandCore {
  /// The page's state word to a look; anything else is ignored.
  static func look(forState s: String?) -> AssistLook? {
    switch s { case "ask": return .ask; case "thinking": return .thinking; case "answer": return .answer
    case "confirm": return .confirm; case "walk": return .walk
    case "done": return .done; case "error": return .error; default: return nil }
  }
  /// The page's buttons, in its order, known ones only, each once. A confirm card with none gets Cancel, so it can always be closed.
  static func buttons(_ v: Any?, for l: AssistLook) -> [AssistButton] {
    guard l == .confirm else { return [] }
    var out: [AssistButton] = []
    for x in (v as? [Any]) ?? [] { if let b = (x as? String).flatMap(AssistButton.init), !out.contains(b) { out.append(b) } }
    return out.isEmpty ? [.cancel] : out
  }
  /// The page's volume (0 to 1; 0 is silent, PS's own sound setting), anything else is silent.
  static func volume(_ v: Any?) -> Double { guard let n = v as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return 0 }; return max(0, min(1, n.doubleValue)) }

  static let cardWidth: Double = 430

  /// How big the card is for a look. Answer lines grow it (about 44 letters to a line, at most 5 lines).
  static func size(_ l: AssistLook, line: String) -> (w: Double, h: Double) {
    switch l {
    case .hidden: return (330, 34)
    case .ask: return (cardWidth, 112)
    case .thinking: return (230, 58)
    case .done: return line.count <= 40 ? (min(cardWidth, 150 + Double(line.count) * 6.5), 58) : (cardWidth, 78)   // "Done. Next time: <path>" takes two lines
    case .answer, .error, .walk:
      let lines = min(5, max(1, (line.count + 43) / 44))
      return (cardWidth, 54 + Double(lines) * 18)
    case .confirm:
      let lines = min(4, max(1, (line.count + 43) / 44))
      return (cardWidth, 54 + Double(lines) * 18 + 40)
    }
  }
  /// Corner roundness: a pill while it is short, a soft card when it is tall.
  static func radius(_ h: Double) -> Double { min(h / 2, 30) }

  /// The one rule for the keyboard. Never over another app's typing: the field takes keys only after the person CLICKED it, or when
  /// PS itself is already the front app. Never over 1Password or Signal, never in a test copy.
  static func mayTakeKeyboard(clickedField: Bool, psIsFront: Bool, protectedFront: Bool, test: Bool) -> Bool {
    if test || protectedFront { return false }
    return clickedField || psIsFront
  }

  enum Cue: String { case pop, chime, happy }
  /// The sound for a change of look: a soft pop when the card comes out, a gentle chime on an answer, a tiny happy sound when done.
  /// Nothing when sounds are off (PS's own switch, Do Not Disturb).
  static func cue(from old: AssistLook, to new: AssistLook, soundsOn: Bool, dndMutes: Bool) -> Cue? {
    guard soundsOn, !dndMutes, old != new else { return nil }
    if old == .hidden && new != .hidden { return .pop }
    switch new { case .answer, .confirm: return old == .thinking || old == .ask ? .chime : nil; case .done: return .happy; default: return nil }
  }

  /// Big motion (swoop, squeeze, blink, bounce) is off under Reduce Motion.
  static func bigMotion(reduceMotion: Bool) -> Bool { !reduceMotion }

  enum EscAction: Equatable { case closeCard, nothing }
  static func escape(visible: Bool) -> EscAction { visible ? .closeCard : .nothing }

  /// Whether the card may show at all.
  static func mayShow(featureOn: Bool, islandOff: Bool, protectedFront: Bool, test: Bool) -> Bool {
    featureOn && !islandOff && !protectedFront && !test
  }
}

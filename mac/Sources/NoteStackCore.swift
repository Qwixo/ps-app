// Stacked notifications (PS 1.65, the developer 17 Nov 2026: "instead of just bombarding the user, it gives you one notification
// and a little plus four symbol ... if you hover over that with your mouse then it will expand out with the other
// notifications, still from the Dynamic Island ... and change the scrolling behaviour when you have multiple notifications
// to go down the whole screen, don't just stop halfway up the screen").
//
// Pure Foundation: no window, no page, no clock. tests/notestack-test.sh runs it on any Mac. The part that decides WHEN the
// list is open (hover, the grace after the pointer leaves, a click that keeps it open, Esc) lives in the card page
// (Toast.swift, between its ">>> stack model" lines) because the page owns the cards; tests/notestack-test.mjs runs that block
// with the same cases. This file holds what Swift itself decides: the switch, how tall the stack may be, what the badge says.
import Foundation

enum NoteStackCore {
  /// The feature id (features.json). On by default; off gives exactly the old list: every card at once, 45% of the screen.
  static let feature = "notif-stack"
  /// Kept clear at the screen's visible edge (the visible frame already stops above the Dock and below the menu bar).
  static let edgeMargin: CGFloat = 16
  /// The old cap: 45% of the screen, about two and a half cards on a small laptop.
  static let oldShare: CGFloat = 0.45

  /// The tallest the stack may be. Switch on: the whole visible height (down to just above the Dock), so every card that
  /// fits shows and the rest scrolls. Switch off: 45% as it always was.
  static func cap(visibleHeight: CGFloat, on: Bool) -> CGFloat {
    guard visibleHeight.isFinite, visibleHeight > 0 else { return 0 }
    return on ? max(0, visibleHeight - edgeMargin) : (visibleHeight * oldShare).rounded()
  }

  /// How many MORE cards wait behind the newest one: the number on the badge. Never 0 or less (no badge then).
  static func badge(count: Int) -> Int { count > 1 ? count - 1 : 0 }
  /// The badge's words, nil when there is nothing behind the newest card.
  static func badgeText(count: Int) -> String? {
    let n = badge(count: count)
    return n > 0 ? "+\(n)" : nil
  }
  /// What a card shows right now: the one newest card with a badge, or all of them (an open list, a single card, switch off).
  enum Shape: Equatable { case none, single, collapsed(more: Int), open }
  static func shape(count: Int, on: Bool, open: Bool) -> Shape {
    if count <= 0 { return .none }
    if count == 1 { return .single }
    if !on { return .open }   // switch off: every card at once, as before
    return open ? .open : .collapsed(more: badge(count: count))
  }
  /// The page tells Swift whether a click is keeping the list open: {type:"stack", pinned:Bool}.
  static func pinned(from msg: [String: Any]) -> Bool { (msg["pinned"] as? Bool) == true }
  /// The same message says whether the list is open at all (a click, or only the pointer, keeps it open): {open:Bool}.
  static func open(from msg: [String: Any]) -> Bool { (msg["open"] as? Bool) == true }

  /// Which stacks (the corner one and the one under the island) have their list open right now. The keyboard tap runs on its own
  /// thread and asks `anyOpen` before it passes Esc on (the panel never takes focus, so the key never reaches it by itself).
  final class OpenWatch {
    private let lock = NSLock()
    private var open: [ObjectIdentifier: Bool] = [:]
    init() {}
    func set(_ id: ObjectIdentifier, _ on: Bool) { lock.lock(); open[id] = on ? true : nil; lock.unlock() }
    var anyOpen: Bool { lock.lock(); defer { lock.unlock() }; return !open.isEmpty }
  }
  static let watch = OpenWatch()
}

// G Squad messages on the Dynamic Island (PS 1.63, feature "gsquad-island-reply"; the developer's friend, 15 Nov 2026: "make it
// so you can reply to G Squad from the Dynamic Island ... it pops out with the message and then you can click Reply, kind of
// like the Apple Watch reply"). Pure rules, no window, no sound, no clock of its own: tests/squad-island-test.sh checks them.
// SquadIsland.swift draws them.
//
// What this file decides:
//  - which card the island takes and which one stays the old top right card (`decide`);
//  - the queue: one chat at a time, a burst from one chat collapses into "3 new messages" with the newest shown;
//  - how long the card stays before it shrinks back by itself (never while hovered or while the person is typing);
//  - the reply steps (closed, card, composing, undo, sending, sent, failed with a retry): a reply is only ever handed over after
//    the person's own click or Return AND the short Undo ran out, and Esc always steps back;
//  - the words: first name, the three line message with "more", the quick replies, the sizes.
// A message is never sent here: the state machine only says "deliver" and the caller hands it to the page (the same path as the
// card in the top right corner, SquadMessageCore.replyJSON), which sends it through the chat composer.
import Foundation
import CoreGraphics

/// One message as the island needs it (from the card the page sends, src/core/squadnotify.ts noteCard).
struct SquadMsg: Equatable {
  var id: String          // the card id, "g:" and the message id
  var chat: String        // which chat it came from (one chat today, the group's id later)
  var name: String        // the sender's name as the page knows it
  var group: String?      // the group's name when it is a group
  var text: String
  var at: String          // ISO time, the page's "seen up to here" mark uses it
}

/// What is in the way right now (the island's own rules for its cards, as the Welcome back panel and the stand-up question use).
struct SquadGate: Equatable {
  var feature = true          // Features.on("gsquad-island-reply")
  var cardWantsIsland = true  // the page's switch (Squad settings, Notifications, "Show messages on the island") travelled on the card
  var islandOnScreen = true   // the island is up, not away, not hidden
  var sleepMode = false
  var sentry = false
  var screenSharing = false
  var fullScreen = false
  var screenLocked = false
  var privateMode = false     // private mode or a meeting privacy: the old card knows how to be discreet, the island does not
  var protectedFront = false  // 1Password or Signal is in front
  var islandOverProtected = false
}

enum SquadIslandPlace: Equatable {
  case island   // the island takes it
  case old      // the card in the top right takes it, exactly as before
  case hold     // nothing is shown (Sleep mode and Sentry mode cover the screen)
}

enum SquadIslandCore {
  static let feature = "gsquad-island-reply"
  static let prefix = "g:"
  /// How long the card stays out before it shrinks back (seconds), unless hovered or the person is typing.
  static let showFor: TimeInterval = 8
  /// A little longer when there is more to read.
  static let showForLong: TimeInterval = 12
  /// The Undo after Send (the same as the corner card's, SquadMessageCard.swift UNDO, web core/squadnotify.ts REPLY_UNDO_MS).
  static let undoFor: TimeInterval = 5
  /// How long "Sent" stays before the island shrinks back.
  static let sentFor: TimeInterval = 1.3
  /// A reply the page never answered for this long is called failed (so the island never waits for ever).
  static let answerWithin: TimeInterval = 12
  /// A failed reply stays this long, then the island shrinks back (the message is still in the chat).
  static let failedFor: TimeInterval = 15
  /// The most lines of a message on the card.
  static let maxLines = 3
  static let charsPerLine = 40
  static let replyMax = 2000
  static let quickReplies = ["On it", "Thanks", "\u{1F44D}"]
  /// More waiting than this and the oldest are dropped (a flood never builds a pile).
  static let maxWaiting = 12

  // ---------- from the page ----------
  /// The page's card, checked. Nil for anything that is not a G Squad message card.
  static func parse(_ c: [String: Any]) -> SquadMsg? {
    guard let id = c["id"] as? String, id.hasPrefix(prefix), id.count > prefix.count, id.count <= 40,
          (c["tone"] as? String) == "squad" else { return nil }
    func clean(_ v: Any?, _ n: Int) -> String {
      String(((v as? String) ?? "").replacingOccurrences(of: "\r", with: "").prefix(n)).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    let name = clean(c["title"], 60)
    let text = clean(c["body"], 600)
    let group = clean(c["group"], 40)
    let chat = clean(c["chat"], 40)
    return SquadMsg(id: id, chat: chat.isEmpty ? "g" : chat, name: name.isEmpty ? "Someone" : name, group: group.isEmpty ? nil : group,
                    text: text, at: clean(c["at"], 40))
  }
  /// The page said this card is meant for the island (the person's switch is on).
  static func wantsIsland(_ c: [String: Any]) -> Bool { (c["island"] as? Bool) == true }

  // ---------- which place ----------
  static func decide(_ g: SquadGate) -> SquadIslandPlace {
    if g.sleepMode || g.sentry { return .hold }            // as the corner card: nothing over Sleep mode or Sentry mode
    if !g.feature || !g.cardWantsIsland || !g.islandOnScreen { return .old }
    if g.screenSharing || g.fullScreen || g.screenLocked || g.privateMode { return .old }   // the old card has its own discreet rules
    if g.protectedFront && !g.islandOverProtected { return .old }   // the island is not shown over 1Password or Signal here
    return .island
  }
  /// Typing needs the keyboard: never while 1Password or Signal is in front (rule 7), the Reply pill opens the chat then.
  static func canCompose(protectedFront: Bool) -> Bool { !protectedFront }

  // ---------- the words ----------
  static func firstName(_ name: String) -> String {
    let t = name.trimmingCharacters(in: .whitespacesAndNewlines)
    let f = t.split(whereSeparator: { $0 == " " || $0 == "\u{00A0}" }).first.map(String.init) ?? t
    return f.isEmpty ? "Someone" : f
  }
  static func initial(_ name: String) -> String {
    guard let ch = firstName(name).first(where: { $0.isLetter || $0.isNumber }) else { return "?" }
    return String(ch).uppercased()
  }
  /// A steady hue (0...1) for a name, so a person keeps their colour.
  static func hue(_ name: String) -> Double {
    var h: UInt32 = 5381
    for u in firstName(name).lowercased().unicodeScalars { h = (h &* 33) &+ u.value }
    return Double(h % 360) / 360
  }
  /// How many lines the words take on the card (an estimate, capped): a line break starts a new line, a long line wraps.
  static func lines(_ text: String, perLine: Int = charsPerLine) -> Int {
    var n = 0
    for part in text.components(separatedBy: "\n") { n += max(1, Int((Double(part.count) / Double(perLine)).rounded(.up))) }
    return max(1, min(maxLines, n))
  }
  /// True when the message is longer than the three lines (the card says "more").
  static func hasMore(_ text: String, perLine: Int = charsPerLine) -> Bool {
    var n = 0
    for part in text.components(separatedBy: "\n") { n += max(1, Int((Double(part.count) / Double(perLine)).rounded(.up))) }
    return n > maxLines
  }
  /// Words for a message that has none (a picture, a GIF, a reaction from the new chat look): never an empty card.
  static func shownText(_ text: String) -> String { text.isEmpty ? "Sent something" : text }

  /// The title line of the card: the sender's first name, or "3 new messages" when a burst collapsed.
  static func title(_ item: SquadItem) -> String {
    item.count > 1 ? "\(item.count) new messages" : firstName(item.newest.name)
  }
  /// The small line: the group's name, or "G Squad".
  static func sub(_ item: SquadItem) -> String { item.newest.group ?? "G Squad" }
  /// The words shown: the newest message; in a burst, with who wrote it.
  static func body(_ item: SquadItem) -> String {
    let t = shownText(item.newest.text)
    return item.count > 1 ? "\(firstName(item.newest.name)): \(t)" : t
  }

  /// The reply text from the box, trimmed and cut. Nil for nothing to send.
  static func cleanReply(_ text: String) -> String? {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return t.isEmpty ? nil : String(t.prefix(replyMax))
  }

  // ---------- the size ----------
  static let cardW: CGFloat = 372
  static let pad: CGFloat = 16
  /// The body of the shape under the island (the island's own height is added by the window).
  static func bodyHeight(_ s: SquadReplyState, item: SquadItem) -> CGFloat {
    let head: CGFloat = 46
    switch s {
    case .closed: return 0
    case .card:
      let l = CGFloat(lines(body(item)))
      return pad + head + 8 + l * 17 + (hasMore(body(item)) ? 16 : 0) + 12 + 32 + pad
    case .composing: return pad + head + 8 + 38 + 8 + 28 + pad
    case .undo, .sending: return pad + head + 8 + 38 + pad
    case .sent: return pad + 40 + pad
    case .failed: return pad + head + 8 + 20 + 12 + 32 + pad
    }
  }
}

// ---------- the queue ----------
/// One card's worth: a chat with its new messages (the newest last).
struct SquadItem: Equatable {
  var chat: String
  var msgs: [SquadMsg]
  var count: Int { msgs.count }
  var newest: SquadMsg { msgs[msgs.count - 1] }
}

/// What is on the island and what waits. One chat per card; a second message from the chat that is waiting joins it, and one from
/// the chat that is showing (and only being read) joins it too: the count goes up and the newest words show.
struct SquadIslandQueue: Equatable {
  private(set) var active: SquadItem?
  private(set) var waiting: [SquadItem] = []
  /// Ids already taken (shown or waiting or just done), so the same card sent twice is one message.
  private var seen: [String] = []
  private static let seenMax = 80

  enum Added: Equatable { case new, joinedActive, joinedWaiting, again }

  /// A message arrives. `reading`: the active card is only being read (not typed on), so a new message may join it.
  mutating func receive(_ m: SquadMsg, reading: Bool) -> Added {
    if seen.contains(m.id) { return .again }
    seen.append(m.id)
    if seen.count > SquadIslandQueue.seenMax { seen.removeFirst(seen.count - SquadIslandQueue.seenMax) }
    if var a = active, a.chat == m.chat, reading {
      a.msgs.append(m); active = a
      return .joinedActive
    }
    if let i = waiting.firstIndex(where: { $0.chat == m.chat }) {
      waiting[i].msgs.append(m)
      return .joinedWaiting
    }
    waiting.append(SquadItem(chat: m.chat, msgs: [m]))
    if waiting.count > SquadIslandCore.maxWaiting { waiting.removeFirst() }
    return .new
  }
  /// The next card is wanted: it becomes the active one.
  mutating func promote() -> SquadItem? {
    guard active == nil, !waiting.isEmpty else { return nil }
    active = waiting.removeFirst()
    return active
  }
  /// The active card is finished (shrunk back, answered).
  mutating func finishActive() { active = nil }
  var hasWaiting: Bool { !waiting.isEmpty }
  /// A message was read somewhere else, or dismissed on another device: it leaves wherever it is. A reply in progress keeps its
  /// card (the person's own words wait out their Undo). Returns true when the active card is now empty and should close.
  mutating func retract(_ id: String, keepActive: Bool) -> Bool {
    for i in waiting.indices.reversed() {
      waiting[i].msgs.removeAll { $0.id == id }
      if waiting[i].msgs.isEmpty { waiting.remove(at: i) }
    }
    guard var a = active, a.msgs.contains(where: { $0.id == id }), !keepActive else { return false }
    a.msgs.removeAll { $0.id == id }
    if a.msgs.isEmpty { active = nil; return true }
    active = a
    return false
  }
}

// ---------- how long the card stays ----------
/// The clock that shrinks the card back: counts only while nothing holds it. Hover and typing stop it, and it starts again full
/// when the pointer leaves (so a person reading is never cut off), a new message in the burst gives it a fresh start.
struct SquadShowClock: Equatable {
  private(set) var left: TimeInterval
  init(for total: TimeInterval = SquadIslandCore.showFor) { left = total }
  mutating func restart(for total: TimeInterval = SquadIslandCore.showFor) { left = total }
  /// `dt` seconds went by. True when the time is up.
  mutating func tick(_ dt: TimeInterval, hovered: Bool, focused: Bool) -> Bool {
    if hovered || focused { return false }
    left -= dt
    return left <= 0
  }
  static func total(for text: String) -> TimeInterval {
    SquadIslandCore.hasMore(text) || text.count > 90 ? SquadIslandCore.showForLong : SquadIslandCore.showFor
  }
}

// ---------- the reply steps ----------
enum SquadReplyState: Equatable {
  case closed
  case card                                              // the message and two pills
  case composing(String)                                 // the box, the quick replies
  case undo(text: String, until: Date)                   // sent by the person, waiting out the short Undo
  case sending(text: String, since: Date)                // handed to the page, waiting for its answer
  case sent                                              // the small tick
  case failed(text: String, why: String)                 // could not send: Retry
}

enum SquadReplyEvent: Equatable {
  case show
  case openReply                // the Reply pill
  case type(String)
  case send                     // the Send button or Return, the person's own
  case quick(Int)               // a quick reply chip (a click: it goes to the Undo like a typed one)
  case undo                     // the Undo button
  case tick                     // time moved on
  case answer(ok: Bool, why: String?)   // the page said whether it sent
  case retry
  case dismiss                  // the Dismiss pill
  case esc                      // Esc
  case timeout                  // the card's own time ran out (the clock above)
  case open                     // the card's own Open (a click on the words)
}

enum SquadReplyEffect: Equatable {
  case deliver(String)          // hand the words to the page (the same path as the corner card)
  case retryDelivery            // ask the page to send the failed reply again (it still holds it)
  case dismissAction            // tell the page: seen up to here
  case openChat                 // bring the Tab list up on the chat
  case close                    // shrink back into the island, nothing else
  case sentTick                 // the tick (a soft sound if sounds are on)
}

struct SquadReplyStep: Equatable {
  var state: SquadReplyState
  var effect: SquadReplyEffect?
}

enum SquadReply {
  /// One step of the reply box. Nothing goes without `send` or `quick` (a click or Return) and the Undo running out (`tick`).
  static func step(_ s: SquadReplyState, _ ev: SquadReplyEvent, now: Date) -> SquadReplyStep {
    func stay(_ x: SquadReplyState, _ e: SquadReplyEffect? = nil) -> SquadReplyStep { SquadReplyStep(state: x, effect: e) }
    switch (s, ev) {
    case (.closed, .show): return stay(.card)
    case (.closed, _): return stay(.closed)

    case (.card, .openReply): return stay(.composing(""))
    case (.card, .dismiss): return stay(.closed, .dismissAction)
    case (.card, .open): return stay(.closed, .openChat)
    case (.card, .esc), (.card, .timeout): return stay(.closed, .close)

    case (.composing, .type(let t)): return stay(.composing(String(t.prefix(SquadIslandCore.replyMax))))
    case (.composing(let t), .send):
      guard let c = SquadIslandCore.cleanReply(t) else { return stay(s) }
      return stay(.undo(text: c, until: now.addingTimeInterval(SquadIslandCore.undoFor)))
    case (.composing, .quick(let i)):
      guard SquadIslandCore.quickReplies.indices.contains(i) else { return stay(s) }
      return stay(.undo(text: SquadIslandCore.quickReplies[i], until: now.addingTimeInterval(SquadIslandCore.undoFor)))
    case (.composing, .esc): return stay(.card)     // Esc cancels the typing, the card stays
    case (.composing, .dismiss): return stay(.closed, .dismissAction)

    case (.undo(let t, _), .undo): return stay(.composing(t))
    case (.undo(_, _), .esc): return stay(.card)    // Esc in the Undo stretch: nothing goes
    case (.undo(let t, let until), .tick):
      if now < until { return stay(s) }
      return stay(.sending(text: t, since: now), .deliver(t))

    case (.sending(let t, let since), .answer(let ok, let why)):
      _ = since
      return ok ? stay(.sent, .sentTick) : stay(.failed(text: t, why: why ?? "Could not send"))
    case (.sending(let t, let since), .tick):
      if now.timeIntervalSince(since) > SquadIslandCore.answerWithin { return stay(.failed(text: t, why: "Could not confirm it was sent")) }
      return stay(s)
    case (.sending, .esc): return stay(s)           // it already went: Esc must not pretend to cancel it

    case (.sent, .tick), (.sent, .esc), (.sent, .timeout): return stay(.closed, .close)

    case (.failed(let t, _), .retry): return stay(.sending(text: t, since: now), .retryDelivery)
    case (.failed, .esc), (.failed, .timeout), (.failed, .dismiss): return stay(.closed, .close)
    case (.failed, .open): return stay(.closed, .openChat)

    default: return stay(s)
    }
  }
  /// The card holds still while the person is typing, waiting out the Undo or waiting for the answer (no auto shrink).
  static func holdsFocus(_ s: SquadReplyState) -> Bool {
    switch s {
    case .composing, .undo, .sending: return true
    default: return false
    }
  }
  /// The keyboard is wanted only while the box is open.
  static func wantsKeyboard(_ s: SquadReplyState) -> Bool {
    if case .composing = s { return true }
    return false
  }
  /// Seconds left in the Undo, rounded up (for "Sending in 4").
  static func undoLeft(_ s: SquadReplyState, now: Date) -> Int {
    if case .undo(_, let until) = s { return max(0, Int(until.timeIntervalSince(now).rounded(.up))) }
    return 0
  }
}

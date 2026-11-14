import Foundation

/// A WhatsApp card on the Mac (V1.60, ids "w:..."): Reply brings the Tab list up on the chat's reply box. Plain rules, no UI.
enum WhatsAppCardCore {
  /// True when this card action is a WhatsApp card's Reply (card ids from the page are "w:" and 1 to 38 word characters or dashes).
  static func opensReply(id: String, action: String) -> Bool {
    guard action == "reply", id.hasPrefix("w:") else { return false }
    let rest = id.dropFirst(2)
    return (1...38).contains(rest.count) && rest.allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }
  }
}

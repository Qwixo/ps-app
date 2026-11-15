// G Squad message cards on the Mac (PS 1.60, PR 10, feature "gsquad-notify"): the plain rules, no window and no page, so
// mac/tests/squad-message-test.sh checks them. The web page decides which message gets a card (src/core/squadnotify.ts) and
// sends it as a card of tone "squad"; SquadMessageCard.swift draws the buttons and the reply box inside Toast's page.
import Foundation

enum SquadMessageCore {
  static let tone = "squad"
  static let icon = "chat"
  /// A card id: "g:" and the message id (the page makes it, at most 40 characters).
  static let prefix = "g:"
  /// The longest reply (the chat's own limit, web core/squadchat.ts MAX_TEXT).
  static let replyMax = 2000

  /// While Sentry mode or Sleep mode covers the screen no message card comes out (nothing is shown over them).
  /// Do Not Disturb is the page's rule: it never sends the card.
  static func held(sentry: Bool, sleep: Bool) -> Bool { sentry || sleep }

  static func isCardId(_ id: String) -> Bool { id.hasPrefix(prefix) && id.count > prefix.count && id.count <= 40 }

  /// The reply from a card's box, trimmed and cut to the chat's limit. Nil for nothing to send.
  static func cleanReply(_ text: String) -> String? {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return t.isEmpty ? nil : String(t.prefix(replyMax))
  }

  /// What goes to the page for a reply typed on a card: {type:"cardAction", id, action:"reply", text}. Nil when the id is not
  /// a message card or there are no words. The page sends it through the chat composer's request, never on its own.
  static func replyJSON(id: String, text: String) -> String? {
    guard isCardId(id), let t = cleanReply(text),
          let d = try? JSONSerialization.data(withJSONObject: ["type": "cardAction", "id": id, "action": "reply", "text": t]),
          let s = String(data: d, encoding: .utf8) else { return nil }
    return s
  }

  /// Open on a message card brings the Tab list up on the chat: true when the action is that.
  static func opensChat(id: String, action: String) -> Bool { isCardId(id) && action == "open" }
}

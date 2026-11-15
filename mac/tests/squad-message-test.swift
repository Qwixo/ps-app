// Unit tests for the G Squad message card's plain rules (Sources/SquadMessageCore.swift, PS 1.60). No window, no page, nothing
// is sent. Made up ids and words only. Run: bash tests/squad-message-test.sh
import Foundation

var passed = 0
func ok(_ name: String, _ cond: Bool, _ more: String = "") {
  if cond { passed += 1; print("ok - \(name)") } else { print("FAIL - \(name) \(more)"); exit(1) }
}
let id = "g:11111111-2222-4333-8444-555555555555"

ok("a message card id is g: and a message id, at most 40 characters", SquadMessageCore.isCardId(id) && id.count <= 40)
ok("other cards are not message cards", !SquadMessageCore.isCardId("m:abc") && !SquadMessageCore.isCardId("c:abc") && !SquadMessageCore.isCardId("n:abc") && !SquadMessageCore.isCardId("sqv:abc"))
ok("g: alone is not a card id", !SquadMessageCore.isCardId("g:"))
ok("an id over 40 characters is refused", !SquadMessageCore.isCardId("g:" + String(repeating: "a", count: 60)))
ok("held while Sentry mode covers the screen", SquadMessageCore.held(sentry: true, sleep: false))
ok("held while Sleep mode is up", SquadMessageCore.held(sentry: false, sleep: true))
ok("not held otherwise", !SquadMessageCore.held(sentry: false, sleep: false))
ok("a reply is trimmed", SquadMessageCore.cleanReply("  on my way \n") == "on my way")
ok("a blank reply is nothing", SquadMessageCore.cleanReply("  \n ") == nil && SquadMessageCore.cleanReply("") == nil)
ok("a long reply is cut to the chat's limit", SquadMessageCore.cleanReply(String(repeating: "y", count: 5000))?.count == SquadMessageCore.replyMax)
let json = SquadMessageCore.replyJSON(id: id, text: " ok then ")
let obj = json.flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: String] }
ok("the reply for the page is a cardAction with the id and the words", obj?["type"] == "cardAction" && obj?["id"] == id && obj?["action"] == "reply" && obj?["text"] == "ok then")
ok("no reply for a card that is not a message card", SquadMessageCore.replyJSON(id: "m:abc", text: "hi") == nil)
ok("no reply without words", SquadMessageCore.replyJSON(id: id, text: "  ") == nil)
ok("words with quotes and line breaks stay whole", {
  let j = SquadMessageCore.replyJSON(id: id, text: "say \"hi\"\nthen go")
  let o = j.flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: String] }
  return o?["text"] == "say \"hi\"\nthen go"
}())
ok("Open on a message card opens the chat", SquadMessageCore.opensChat(id: id, action: "open"))
ok("Dismiss and other cards do not", !SquadMessageCore.opensChat(id: id, action: "dismiss") && !SquadMessageCore.opensChat(id: "m:abc", action: "open"))
print("\n\(passed) checks passed")

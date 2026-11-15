import Foundation
var fails = 0
func check(_ n: String, _ ok: Bool) { print(ok ? "ok -" : "FAIL -", n); if !ok { fails += 1 } }
check("Reply on a WhatsApp card opens the reply box", WhatsAppCardCore.opensReply(id: "w:abc123", action: "reply"))
check("Dismiss does not", !WhatsAppCardCore.opensReply(id: "w:abc123", action: "dismiss"))
check("Remind does not", !WhatsAppCardCore.opensReply(id: "w:abc123", action: "remind:15"))
check("an email card's Reply is not ours", !WhatsAppCardCore.opensReply(id: "m:abc123", action: "reply"))
check("a G Squad card is not ours", !WhatsAppCardCore.opensReply(id: "g:abc", action: "reply"))
check("empty id refused", !WhatsAppCardCore.opensReply(id: "w:", action: "reply"))
check("odd characters refused", !WhatsAppCardCore.opensReply(id: "w:a b;c", action: "reply"))
check("too long refused", !WhatsAppCardCore.opensReply(id: "w:" + String(repeating: "a", count: 39), action: "reply"))
let main = (try? String(contentsOfFile: CommandLine.arguments[1])) ?? ""
let toast = (try? String(contentsOfFile: CommandLine.arguments[2])) ?? ""
check("main.swift sends waReply to the Tab list", main.contains("WhatsAppCardCore.opensReply") && main.contains("\"waReply\""))
check("the card may carry a Reply button (mail tone)", toast.contains("(tone == \"mail\" || tone == \"lead\") { card[\"reply\"] = true }"))
exit(fails == 0 ? 0 : 1)

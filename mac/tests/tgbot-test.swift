// Offline test for Sources/TelegramBotCore.swift (Add Telegram Bot, V1.47): the key check, the method allowlist, the
// request PS builds and the answer the page gets. A MADE UP key only; nothing here touches the network or the Keychain.
//   bash tests/tgbot-test.sh
import Foundation

var fails = 0, count = 0
func check(_ name: String, _ ok: Bool, _ info: String = "") { count += 1; print("\(name)=\(ok ? "ok" : "FAIL")\(info.isEmpty || ok ? "" : " (\(info))")"); if !ok { fails += 1 } }
let fake = "1234567890:AAFakeFakeFakeFakeFakeFakeFakeFake12"   // made up

check("token-ok", TgCore.validToken(fake))
check("token-bad", !TgCore.validToken("hello") && !TgCore.validToken("123:abc") && !TgCore.validToken(fake + "/../x") && !TgCore.validToken(" " + fake))
check("id", TgCore.validId("t1abc") && !TgCore.validId("a b") && !TgCore.validId(""))
check("methods-only-these", TgCore.request(token: fake, method: "deleteWebhook", params: [:]) == nil && TgCore.request(token: fake, method: "setWebhook", params: [:]) == nil
  && TgCore.request(token: fake, method: "getMe", params: [:]) != nil)
check("bad-token-no-request", TgCore.request(token: "x", method: "getMe", params: [:]) == nil)
let r = TgCore.request(token: fake, method: "getUpdates", params: ["offset": 5, "timeout": 300, "allowed_updates": ["message"]])!
check("host", r.url?.host == "api.telegram.org" && r.url?.scheme == "https" && r.url?.path == "/bot\(fake)/getUpdates")
check("post-json", r.httpMethod == "POST" && r.value(forHTTPHeaderField: "Content-Type") == "application/json")
let body = (try? JSONSerialization.jsonObject(with: r.httpBody ?? Data())) as? [String: Any] ?? [:]
check("long-poll-capped", (body["timeout"] as? Int) == 30 && (body["offset"] as? Int) == 5, "\(body)")
check("long-poll-timeout", r.timeoutInterval == 45)
let a = TgCore.answer(id: "t1", status: 409, data: Data(#"{"ok":false,"error_code":409}"#.utf8), error: nil)
check("answer-body", (a["body"] as? String)?.contains("409") == true && a["type"] as? String == "tg:res")
let e = TgCore.answer(id: "t1", status: 0, data: nil, error: "network -1009")
let all = String(describing: e) + String(describing: a) + String(describing: TgCore.noKey("t2"))
check("answer-never-has-key", !all.contains(fake) && !all.contains("AAFake"))
check("no-key", TgCore.noKey("t2")["noKey"] as? Bool == true)
let st = TgCore.cleanStatus(["state": "running", "problem": String(repeating: "x", count: 900), "linkCode": "12345x", "bot": ["id": 7, "username": "ann_bot"], "token": fake])
check("status-clean", st["state"] as? String == "running" && (st["problem"] as? String)?.count == 300 && st["linkCode"] == nil && st["token"] == nil
  && (st["bot"] as? [String: Any])?["username"] as? String == "ann_bot", "\(st)")
check("ops", TgCore.ops == ["link", "cancelLink", "unlink", "test", "retry"])
print("\(count - fails)/\(count) passed")
exit(fails == 0 ? 0 : 1)

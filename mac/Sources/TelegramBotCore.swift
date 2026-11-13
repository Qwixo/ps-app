// Add Telegram Bot (V1.47), the parts with no AppKit, no Keychain and no network of their own, so
// tests/tgbot-test.swift runs them as is. The app's half is TelegramBot.swift; the page's half is web
// src/tgbot.ts (the reader) and src/views/TelegramBot.tsx (Settings, Add Telegram Bot).
//
// The page never holds the bot's key. It asks PS to call one of a few Telegram methods for it; PS checks the method
// and the request, adds the key from the Keychain and makes the call. Only these methods, only api.telegram.org, only
// POST with a JSON body, and the key only ever in the URL PS builds here (never logged, never in an answer).
import Foundation

enum TgCore {
  /// What the reader and Settings need: read messages, answer, the Undo button, check the key. Nothing that changes
  /// the bot itself (no setWebhook or deleteWebhook: a bot someone already uses elsewhere is never touched).
  static let methods: Set<String> = ["getMe", "getUpdates", "sendMessage", "answerCallbackQuery", "editMessageText"]
  static let host = "api.telegram.org"
  static let maxBody = 1_000_000

  /// A key as BotFather gives it: the bot's number, a colon, then 30 to 60 letters, digits, - or _.
  static func validToken(_ s: String) -> Bool {
    s.range(of: #"^[0-9]{5,15}:[A-Za-z0-9_-]{30,60}$"#, options: .regularExpression) != nil
  }
  /// The page's request id.
  static func validId(_ s: String) -> Bool { s.range(of: #"^[A-Za-z0-9]{1,40}$"#, options: .regularExpression) != nil }

  /// The request for one call, or nil when the method, the key or the body is not acceptable.
  static func request(token: String, method: String, params: [String: Any]) -> URLRequest? {
    guard validToken(token), methods.contains(method), JSONSerialization.isValidJSONObject(params) else { return nil }
    var p = params
    if method == "getUpdates" {
      // A long poll waits at most 30 seconds at Telegram; the request itself a little longer.
      let t = (p["timeout"] as? NSNumber)?.intValue ?? 0
      p["timeout"] = max(0, min(30, t))
    }
    guard let body = try? JSONSerialization.data(withJSONObject: p), body.count <= 64_000,
          let url = URL(string: "https://\(host)/bot\(token)/\(method)") else { return nil }
    var r = URLRequest(url: url)
    r.httpMethod = "POST"
    r.setValue("application/json", forHTTPHeaderField: "Content-Type")
    r.httpBody = body
    r.timeoutInterval = method == "getUpdates" ? 45 : 20
    r.cachePolicy = .reloadIgnoringLocalCacheData
    return r
  }

  /// The answer for the page: Telegram's reply as text, or why there is none. Never the key or the URL.
  static func answer(id: String, status: Int, data: Data?, error: String?) -> [String: Any] {
    var o: [String: Any] = ["type": "tg:res", "id": id, "status": status]
    if let data, data.count <= maxBody, let s = String(data: data, encoding: .utf8) { o["body"] = s }
    else { o["error"] = error ?? (data == nil ? "no answer" : "answer too big") }
    return o
  }
  static func noKey(_ id: String) -> [String: Any] { ["type": "tg:res", "id": id, "status": 0, "noKey": true] }

  /// What the main page says about its reader, kept for the Tab list's Settings: only these fields, short.
  static func cleanStatus(_ v: Any?) -> [String: Any] {
    guard let s = v as? [String: Any] else { return [:] }
    var o: [String: Any] = [:]
    func str(_ k: String, _ max: Int) { if let x = s[k] as? String { o[k] = String(x.prefix(max)) } }
    for k in ["state", "test"] { if let x = s[k] as? String, x.range(of: #"^[A-Za-z]{1,16}$"#, options: .regularExpression) != nil { o[k] = x } }
    str("problem", 300); str("testText", 200)
    if let c = s["linkCode"] as? String, c.range(of: #"^[0-9]{6}$"#, options: .regularExpression) != nil { o["linkCode"] = c }
    if let b = s["bot"] as? [String: Any], let u = b["username"] as? String, u.range(of: #"^[A-Za-z0-9_]{1,64}$"#, options: .regularExpression) != nil {
      o["bot"] = ["id": (b["id"] as? NSNumber)?.int64Value ?? 0, "username": u, "name": String((b["name"] as? String ?? "").prefix(64))]
    }
    return o
  }
  /// The Tab list's buttons that the main page carries out.
  static let ops: Set<String> = ["link", "cancelLink", "unlink", "test", "retry"]
}

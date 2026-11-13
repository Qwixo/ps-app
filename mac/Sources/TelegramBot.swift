// Add Telegram Bot (V1.47, the developer 10 Nov 2026: "Make it so other people can add a Telegram bot as well. Add that in the
// Settings menu as a tab called Add Telegram Bot."). For everyone, the public PS too. The Mac's half:
//  - The bot's key (the token BotFather gives): pasted into a small PS window (TelegramKeyWindow below, like the
//    Instantly key), kept in this Mac's Keychain only (this device, never synced), handed to the next build on an
//    update (UpdateHandoff.swift), never logged, never shown again, never in a page or the vault.
//  - The relay: the main page (web src/tgbot.ts) reads the bot with getUpdates long polling and answers
//    messages; for each call it sends {type:"tg:call"}, PS adds the key (TelegramBotCore.swift checks the method and
//    builds the request), makes it on its own queue with an ephemeral URLSession through the system's network (no
//    interface is ever chosen, so VPN rules apply as for everything else) and answers {type:"tg:res"}.
//  - Status: the main page says how its reader is doing ({type:"tg:status"}); it goes into PS > Settings (sendSettings
//    tgBot) so the Tab list's Settings shows it. The Tab list's buttons come as {type:"tg:op"} and go to the main page.
// Nothing runs without a key, and nothing runs while PS is not running. Test copies never touch the Keychain or the
// network. Keychain and network work never runs on the main thread.
import AppKit
import Foundation
import Security

/// This build's Keychain item (named after the build like the sign in; the update hands it over).
enum TgKeychain {
  static let service = "com.cincee.ps.tgbot"
  static var account: String { "token-\(Remember.account)" }
  private static var base: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }
  static func read() -> String? {
    var q = base; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard KeychainQuiet.run({ SecItemCopyMatching(q as CFDictionary, &out) }) == errSecSuccess, let d = out as? Data,
          let s = String(data: d, encoding: .utf8), TgCore.validToken(s) else { return nil }
    return s
  }
  @discardableResult static func write(_ token: String) -> Bool {
    guard TgCore.validToken(token) else { return false }
    let d = Data(token.utf8)
    if KeychainQuiet.run({ SecItemUpdate(base as CFDictionary, [kSecValueData as String: d] as CFDictionary) }) == errSecSuccess { return true }
    var q = base
    q[kSecValueData as String] = d
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    q[kSecAttrSynchronizable as String] = false
    q[kSecAttrLabel as String] = "PS Telegram bot key (this Mac only)"
    return KeychainQuiet.run { SecItemAdd(q as CFDictionary, nil) } == errSecSuccess
  }
  static func delete() { KeychainQuiet.run { _ = SecItemDelete(base as CFDictionary) } }
}

final class TelegramBot {
  static let shared = TelegramBot()
  weak var app: App?

  private let q = DispatchQueue(label: "ps.tgbot", qos: .utility)
  private let test = IS_TEST_COPY
  // q only.
  private var token: String?
  private var loaded = false
  // Main thread.
  private(set) var saved = false
  private var page: [String: Any] = [:]
  private lazy var session: URLSession = {
    let c = URLSessionConfiguration.ephemeral
    c.timeoutIntervalForRequest = 45; c.timeoutIntervalForResource = 60
    c.httpCookieStorage = nil; c.urlCache = nil; c.httpShouldSetCookies = false
    c.waitsForConnectivity = false
    return URLSession(configuration: c)
  }()

  private func loadIfNeeded() { if !loaded { loaded = true; token = test ? nil : TgKeychain.read() } }

  func start() {
    q.async { [self] in
      loadIfNeeded()
      let s = token != nil
      DispatchQueue.main.async { [self] in saved = s; tellMain(["type": "tg:changed", "saved": s]); app?.sendSettings() }
    }
  }

  /// A page message starting with "tg:". True when it was one of ours (handled or not allowed from that page).
  func handle(_ type: String, _ msg: [String: Any], fromMain: Bool, fromOverlay: Bool) -> Bool {
    guard type.hasPrefix("tg:") else { return false }
    switch type {
    case "tg:get" where fromMain:
      q.async { [self] in
        loadIfNeeded()
        let s = token != nil
        DispatchQueue.main.async { [self] in saved = s; tellMain(["type": "tg:changed", "saved": s]); app?.sendSettings() }
      }
    case "tg:call" where fromMain: call(msg)
    case "tg:status" where fromMain:
      page = TgCore.cleanStatus(msg["status"])
      app?.sendSettings()
    case "tg:key" where fromMain || fromOverlay:
      TelegramKeyWindow.shared.ask { [weak self] t in if let t { self?.save(t) } }
    case "tg:remove" where fromMain || fromOverlay: remove()
    case "tg:op" where fromOverlay:
      if let op = msg["op"] as? String, TgCore.ops.contains(op) { tellMain(["type": "tg:op", "op": op]) }
    default: break
    }
    return true
  }

  private func save(_ t: String) {
    guard TgCore.validToken(t) else { NSSound.beep(); return }
    q.async { [self] in
      let ok = test ? false : TgKeychain.write(t)
      token = test ? nil : t
      loaded = true
      psLog("PS telegram bot: key \(ok ? "saved in the Keychain" : "kept for this run only (the Keychain said no)")")
      DispatchQueue.main.async { [self] in
        saved = token != nil; page = [:]
        tellMain(["type": "tg:changed", "saved": saved, "fresh": true]); app?.sendSettings()
      }
    }
  }
  private func remove() {
    q.async { [self] in
      if !test { TgKeychain.delete() }
      token = nil; loaded = true
      psLog("PS telegram bot: key removed")
      DispatchQueue.main.async { [self] in
        saved = false; page = [:]
        tellMain(["type": "tg:op", "op": "remove"])
        tellMain(["type": "tg:changed", "saved": false, "fresh": true]); app?.sendSettings()
      }
    }
  }

  private func call(_ msg: [String: Any]) {
    guard let id = msg["id"] as? String, TgCore.validId(id), let method = msg["method"] as? String else { return }
    let params = msg["params"] as? [String: Any] ?? [:]
    q.async { [self] in
      loadIfNeeded()
      guard let tok = token else { reply(TgCore.noKey(id)); return }
      guard let req = TgCore.request(token: tok, method: method, params: params) else {
        reply(TgCore.answer(id: id, status: 0, data: nil, error: "not allowed")); return
      }
      session.dataTask(with: req) { [weak self] d, r, e in
        // Only the error's number: its text and user info can carry the URL, and the URL carries the key.
        let err = e.map { "network \(($0 as NSError).code)" }
        self?.reply(TgCore.answer(id: id, status: (r as? HTTPURLResponse)?.statusCode ?? 0, data: e == nil ? d : nil, error: err))
      }.resume()
    }
  }
  private func reply(_ o: [String: Any]) { DispatchQueue.main.async { [self] in tellMain(o) } }
  private func tellMain(_ o: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: o), let json = String(data: d, encoding: .utf8) else { return }
    app?.sendToMain(json)
  }

  /// PS > Settings (main.swift sendSettings): whether a key is kept here and what the reader says. Never the key.
  func settingsJSON() -> [String: Any] { var d = page; d["saved"] = saved; return d }

  // MARK: the update hands the key to the new build (UpdateHandoff.swift)
  static func handoffCollect() -> String? { TgKeychain.read() }
  @discardableResult static func handoffSave(_ t: String?) -> Bool { guard let t, TgCore.validToken(t) else { return false }; return TgKeychain.write(t) }
}

/// A small PS window where the bot key is pasted (a secure field: never shown, never in a page). Esc closes it
/// (EscAlways.swift: a titled, closable window).
final class TelegramKeyWindow: NSObject, NSWindowDelegate {
  static let shared = TelegramKeyWindow()
  private var win: NSWindow?
  private var field: NSSecureTextField?
  private var done: ((String?) -> Void)?

  func ask(_ cb: @escaping (String?) -> Void) {
    if Protected.front { return }   // never takes the keyboard over 1Password or Signal
    done = cb
    if win == nil {
      let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 180), styleMask: [.titled, .closable], backing: .buffered, defer: false)
      w.title = "Telegram bot key"; w.isReleasedWhenClosed = false; w.delegate = self
      let v = NSView(frame: w.contentView!.bounds)
      let label = NSTextField(wrappingLabelWithString: "Paste the key BotFather sent you (it looks like 123456789:AAH...). PS app keeps it in this Mac's Keychain and never shows it again.")
      label.frame = NSRect(x: 20, y: 100, width: 420, height: 60)
      let f = NSSecureTextField(frame: NSRect(x: 20, y: 64, width: 420, height: 24))
      f.placeholderString = "Bot key"
      let save = NSButton(title: "Save", target: self, action: #selector(saveTapped)); save.frame = NSRect(x: 350, y: 16, width: 90, height: 30); save.keyEquivalent = "\r"
      let cancel = NSButton(title: "Cancel", target: self, action: #selector(cancelTapped)); cancel.frame = NSRect(x: 256, y: 16, width: 90, height: 30)
      for x in [label, f, save, cancel] as [NSView] { v.addSubview(x) }
      w.contentView = v
      win = w; field = f
    }
    field?.stringValue = ""
    win?.center()
    win?.makeKeyAndOrderFront(nil)
    if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
    win?.makeFirstResponder(field)
  }
  @objc private func saveTapped() {
    let k = (field?.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard TgCore.validToken(k) else { NSSound.beep(); return }
    field?.stringValue = ""
    let cb = done; done = nil
    win?.orderOut(nil)
    cb?(k)
  }
  @objc private func cancelTapped() { field?.stringValue = ""; win?.orderOut(nil); let cb = done; done = nil; cb?(nil) }
  func windowShouldClose(_ sender: NSWindow) -> Bool { cancelTapped(); return false }
}

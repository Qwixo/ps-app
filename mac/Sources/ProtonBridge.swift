// Proton Mail through Proton Mail Bridge (PS 1.65), the Mac's half. The logic (the loopback guard, the pinned certificate,
// IMAP and SMTP) is ProtonBridgeCore.swift and is tested there. This file holds what touches the system:
//  - The link (the Bridge address, ports, the username Bridge shows and its Bridge password, plus the pinned certificate's
//    fingerprint) lives in this Mac's Keychain only (this device, never synced), handed to the next build on an update
//    (UpdateHandoff.swift). The password is typed into a small PS window (a secure field), never into a web page, and
//    never in a log, the vault, the page's storage or any network call. The only network ever used is 127.0.0.1 (or ::1).
//  - A check of the INBOX once a minute while PS is running and a link exists (a longer wait while Bridge is down, none at all
//    while the password or certificate is wrong). Nothing runs while PS is closed. Reading is read only (EXAMINE, BODY.PEEK).
//  - The unread mail goes to the pages as plain rows ({type:"proton:rows"}); the page picks the clients' mail from them.
//    Replies go out only when the page sends {type:"proton:reply"} after the person's own click on Send.
// Test copies (PS_SELFTEST) never touch the Keychain or any socket. Keychain and socket work never runs on the main thread.
import AppKit
import Foundation
import Security

enum ProtonKeychain {
  static let service = "com.cincee.ps.proton"
  static var account: String { "link-\(Remember.account)" }
  private static var base: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }
  static func read() -> ProtonConfig? {
    var q = base; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard KeychainQuiet.run({ SecItemCopyMatching(q as CFDictionary, &out) }) == errSecSuccess, let d = out as? Data,
          let c = try? JSONDecoder().decode(ProtonConfig.self, from: d), ProtonGuard.loopback(c.host) != nil else { return nil }
    return c
  }
  @discardableResult static func write(_ c: ProtonConfig) -> Bool {
    guard ProtonGuard.loopback(c.host) != nil, let d = try? JSONEncoder().encode(c) else { return false }
    if KeychainQuiet.run({ SecItemUpdate(base as CFDictionary, [kSecValueData as String: d] as CFDictionary) }) == errSecSuccess { return true }
    var q = base
    q[kSecValueData as String] = d
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    q[kSecAttrSynchronizable as String] = false
    q[kSecAttrLabel as String] = "PS Proton Bridge link (this Mac only)"
    return KeychainQuiet.run { SecItemAdd(q as CFDictionary, nil) } == errSecSuccess
  }
  static func delete() { KeychainQuiet.run { _ = SecItemDelete(base as CFDictionary) } }
}

final class ProtonBridge: NSObject {
  static let shared = ProtonBridge()
  weak var app: App?

  private let q = DispatchQueue(label: "ps.proton", qos: .utility)
  private let test = IS_TEST_COPY
  // q only.
  private var config: ProtonConfig?
  private var loaded = false
  private var rows: [ProtonRow] = []
  private var dismissed = ProtonDismissed()
  private var failure: ProtonError?
  private var failures = 0
  private var lastOk: Double = 0
  private var checking = false
  private var generation = 0          // a new link or an unlink makes an older timer do nothing
  private var linking: String?        // the last problem of a link attempt, in words' code
  private var started = false
  private var replying = Set<String>()

  private func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }
  private var featureOn: Bool { Features.on("proton-bridge") }

  private func loadIfNeeded() {
    guard !loaded else { return }
    loaded = true
    if test { return }
    config = ProtonKeychain.read()
    if let d = UserDefaults.standard.data(forKey: "proton.dismissed"), let x = try? JSONDecoder().decode(ProtonDismissed.self, from: d) { dismissed = x }
  }
  private func saveDismissed() { if !test, let d = try? JSONEncoder().encode(dismissed) { UserDefaults.standard.set(d, forKey: "proton.dismissed") } }

  // MARK: start

  func start() {
    q.async { [self] in
      guard !started else { return }
      started = true
      loadIfNeeded()
      publish()
      if config != nil { schedule(after: 5) }
    }
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: nil) { [weak self] _ in
      self?.q.asyncAfter(deadline: .now() + 5) { self?.checkNow() }   // the network and Bridge need a moment after a wake
    }
  }

  // MARK: page messages

  /// A page message starting with "proton:". True when it was one of ours (handled or not allowed from that page).
  func handle(_ type: String, _ msg: [String: Any], fromMain: Bool, fromOverlay: Bool) -> Bool {
    guard type.hasPrefix("proton:") else { return false }
    guard fromMain || fromOverlay else { return true }
    switch type {
    case "proton:get": q.async { [self] in loadIfNeeded(); publish() }
    case "proton:refresh": q.async { [self] in loadIfNeeded(); checkNow() }
    case "proton:link": link(msg)
    case "proton:unlink": unlink()
    case "proton:repin": repin()
    case "proton:done":
      if let k = msg["key"] as? String { q.async { [self] in dismissed.add(k); saveDismissed(); publish() } }
    case "proton:reply": reply(msg)
    default: break
    }
    return true
  }

  // MARK: the link

  private func link(_ msg: [String: Any]) {
    if test { return }
    guard featureOn else { return }
    guard let host = msg["host"] as? String, let user = msg["user"] as? String else { return }
    // The address and the username are checked before the password window opens: a remote address never gets that far.
    guard ProtonConfig.make(host: host, port: msg["port"], user: user, password: "x") != nil else {
      let why = ProtonGuard.loopback(host) == nil ? "notLoopback" : "badInput"
      q.async { [self] in linking = why; publish() }
      return
    }
    ProtonPasswordWindow.shared.ask { [weak self] pw in
      guard let self, let pw, let cfg = ProtonConfig.make(host: host, port: msg["port"], user: user, password: pw) else { return }
      self.q.async { self.tryLink(cfg) }
    }
  }
  /// Checks the new link once (the certificate is pinned here) and keeps it in the Keychain only when it worked.
  private func tryLink(_ c: ProtonConfig) {
    loadIfNeeded()
    var cfg = c
    do {
      let r = try ProtonImap.unread(try LoopbackTransport(host: c.host, port: c.port), config: c)
      cfg.fingerprint = r.pinned
      let ok = ProtonKeychain.write(cfg)
      psLog("PS proton: linked (Keychain \(ok ? "saved" : "said no"), \(r.rows.count) unread)")
      guard ok else { linking = "keychain"; publish(); return }
      config = cfg; rows = r.rows; failure = nil; failures = 0; lastOk = nowMs(); linking = nil
      generation += 1
      publish()
      schedule(after: ProtonSchedule.next(after: nil, failures: 0))
    } catch let e as ProtonError {
      psLog("PS proton: link failed (\(e.code))")
      linking = e.code; publish()
    } catch { linking = "protocol"; publish() }
  }
  private func unlink() {
    q.async { [self] in
      if !test { ProtonKeychain.delete() }
      config = nil; loaded = true; rows = []; failure = nil; failures = 0; linking = nil; generation += 1
      dismissed = ProtonDismissed(); saveDismissed()
      psLog("PS proton: unlinked, the Keychain item removed")
      publish()
    }
  }
  /// After a "certificate changed" warning the person says it is fine (Bridge was reinstalled): the next check pins the new one.
  private func repin() {
    q.async { [self] in
      loadIfNeeded()
      guard var c = config, case .certChanged? = failure else { return }
      c.fingerprint = nil
      if !test { ProtonKeychain.write(c) }
      config = c; failure = nil; failures = 0; generation += 1
      psLog("PS proton: the person accepted Bridge's new certificate")
      publish(); checkNow()
    }
  }

  // MARK: the checks

  private func schedule(after s: TimeInterval) {
    guard s > 0 else { return }
    let g = generation
    q.asyncAfter(deadline: .now() + s) { [self] in
      guard g == generation else { return }
      checkNow()
    }
  }
  /// One check, on q. Never two at once.
  private func checkNow() {
    guard !test, let c = config, !checking else { return }
    guard featureOn else { publish(); schedule(after: 300); return }   // switched off: nothing runs, look again later in case it is switched on
    if case .certChanged? = failure { return }
    if case .badPassword? = failure { return }
    checking = true
    let g = generation
    do {
      let r = try ProtonImap.unread(try LoopbackTransport(host: c.host, port: c.port), config: c)
      guard g == generation else { checking = false; return }
      if let p = r.pinned, var n = config { n.fingerprint = p; config = n; ProtonKeychain.write(n) }
      rows = r.rows; failure = nil; failures = 0; lastOk = nowMs()
    } catch let e as ProtonError {
      failure = e; failures += 1
      psLog("PS proton: check failed (\(e.code))")
    } catch { failure = .protocolError("x"); failures += 1 }
    checking = false
    publish()
    schedule(after: ProtonSchedule.next(after: failure, failures: failures))
  }

  // MARK: a reply, only from the person's own click

  private func reply(_ msg: [String: Any]) {
    guard let key = msg["key"] as? String, key.count <= 40, let text = msg["text"] as? String else { return }
    q.async { [self] in
      loadIfNeeded()
      // Who it goes to, the subject and the thread come from this Mac's own copy of the email, never from the page.
      guard !test, featureOn, let c = config, !replying.contains(key) else { tell(["type": "proton:sent", "key": key, "ok": false, "error": "noLink"]); return }
      guard let row = rows.first(where: { $0.key == key }),
            let r = ProtonReply.from(["to": row.from, "subject": row.subject, "text": text, "inReplyTo": row.msgId ?? "", "references": row.refs ?? ""]) else {
        tell(["type": "proton:sent", "key": key, "ok": false, "error": "gone"]); return
      }
      replying.insert(key); defer { replying.remove(key) }
      do {
        _ = try ProtonSmtp.send(try LoopbackTransport(host: c.host, port: c.smtpPort), config: c, reply: r)
        psLog("PS proton: a reply went through Bridge")
        tell(["type": "proton:sent", "key": key, "ok": true])
      } catch let e as ProtonError {
        psLog("PS proton: a reply did not go (\(e.code))")
        if case .certChanged = e { failure = e; publish() }
        tell(["type": "proton:sent", "key": key, "ok": false, "error": e.code])
      } catch { tell(["type": "proton:sent", "key": key, "ok": false, "error": "protocol"]) }
    }
  }

  // MARK: what the pages see

  /// The status the Settings page shows. Never the password, the fingerprint or the address of anything but this Mac.
  private func statusJSON() -> [String: Any] {
    var s: [String: Any] = ["linked": config != nil, "unread": dismissed.filter(rows).count]
    if let c = config { s["host"] = c.host; s["port"] = c.port; s["user"] = c.user; s["pinned"] = c.fingerprint != nil }
    if let f = failure { s["problem"] = f.code }
    if let l = linking { s["linkProblem"] = l }
    if lastOk > 0 { s["lastOk"] = lastOk.rounded() }
    s["checking"] = checking
    return s
  }
  private var cachedStatus: [String: Any] = ["linked": false]
  /// Main thread copy for PS > Settings (main.swift sendSettings proton).
  func settingsJSON() -> [String: Any] { cachedStatus }

  private func publish() {
    let st = statusJSON()
    let rs = dismissed.filter(rows).prefix(60).map { $0.json }
    DispatchQueue.main.async { [self] in
      cachedStatus = st
      tellNow(["type": "proton:rows", "rows": Array(rs), "status": st])
      app?.sendSettings()
    }
  }
  private func tell(_ o: [String: Any]) { DispatchQueue.main.async { [self] in tellNow(o) } }
  private func tellNow(_ o: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: o), let json = String(data: d, encoding: .utf8) else { return }
    app?.sendToMain(json)
    app?.sendToOverlay(json)
  }

  // MARK: the update hands the link to the new build (UpdateHandoff.swift)
  static func handoffCollect() -> String? { ProtonKeychain.read().flatMap { try? JSONEncoder().encode($0) }.flatMap { String(data: $0, encoding: .utf8) } }
  @discardableResult static func handoffSave(_ s: String?) -> Bool {
    guard let s, let c = try? JSONDecoder().decode(ProtonConfig.self, from: Data(s.utf8)), ProtonGuard.loopback(c.host) != nil else { return false }
    return ProtonKeychain.write(c)
  }
}

/// A small PS window where the Bridge password is typed (a secure field: never shown, never in a page). Esc closes it.
final class ProtonPasswordWindow: NSObject, NSWindowDelegate {
  static let shared = ProtonPasswordWindow()
  private var win: NSWindow?
  private var field: NSSecureTextField?
  private var done: ((String?) -> Void)?

  func ask(_ cb: @escaping (String?) -> Void) {
    if Protected.front { return }   // never takes the keyboard over 1Password or Signal
    done = cb
    if win == nil {
      let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 190), styleMask: [.titled, .closable], backing: .buffered, defer: false)
      w.title = "Proton Bridge password"; w.isReleasedWhenClosed = false; w.delegate = self
      let v = NSView(frame: w.contentView!.bounds)
      let label = NSTextField(wrappingLabelWithString: "Type the password Proton Mail Bridge shows for your account. It is not your Proton login password. PS app keeps it in this Mac's Keychain and never shows it again.")
      label.frame = NSRect(x: 20, y: 100, width: 420, height: 70)
      let f = NSSecureTextField(frame: NSRect(x: 20, y: 64, width: 420, height: 24))
      f.placeholderString = "Bridge password"
      let save = NSButton(title: "Link", target: self, action: #selector(saveTapped)); save.frame = NSRect(x: 350, y: 16, width: 90, height: 30); save.keyEquivalent = "\r"
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
    let k = field?.stringValue ?? ""
    guard !k.isEmpty else { NSSound.beep(); return }
    field?.stringValue = ""
    let cb = done; done = nil
    win?.orderOut(nil)
    cb?(k)
  }
  @objc private func cancelTapped() { field?.stringValue = ""; win?.orderOut(nil); let cb = done; done = nil; cb?(nil) }
  func windowShouldClose(_ sender: NSWindow) -> Bool { cancelTapped(); return false }
}

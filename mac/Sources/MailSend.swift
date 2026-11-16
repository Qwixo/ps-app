// Reply from PS (V1.44): the Mac's half. The developer's permission (8 Nov 2026): "I give PS permission to send emails for me",
// ONLY for replies he types and sends or schedules himself in PS. PS never sends by itself: a job exists only because
// the compose window (ReplyWindow.swift, page /reply-window) handed one over after his click on Send or Schedule.
//
//  - Sign ins: Gmail through Google's own consent page in the developer's browser (loopback and PKCE, with the Google Cloud OAuth
//    client file the developer picks for that account), scopes gmail.send and gmail.metadata (the thread's headers, to answer in
//    the same thread) plus his name and email. The Instantly API key is typed by the developer into a small PS window. All of it
//    lives in this Mac's Keychain only (this device, never synced), is handed to the next build on an update like the
//    sign in (UpdateHandoff.swift), and is never logged, never shown, never in a page or the vault.
//  - The queue (MailSendCore.swift Outbox) is in the Keychain too, so a scheduled reply survives a quit, a restart or
//    an update. A send that may have gone half way is never sent again by itself.
//  - Asleep: macOS wakes PS late, so a reply due while the Mac slept goes on wake (up to 6 hours late; later than that
//    it waits for the developer). While a reply is due within 45 minutes and the Mac is plugged in, PS keeps it from idle sleep.
//  - Each send is logged (time, account, to, subject; never the words) in ~/Library/Logs/PS/ps.log.
//  - Test copies (PS_SELFTEST) never touch the Keychain, the browser or the network: a fake answers.
// Keychain and network work never runs on the main thread.
import AppKit
import CryptoKit
import Foundation
import IOKit.ps
import IOKit.pwr_mgt
import Security
import UniformTypeIdentifiers

/// The live client: an ephemeral URLSession (no cookies, no cache), off the main thread.
final class URLSessionHTTP: MailHTTP {
  private let session: URLSession = {
    let c = URLSessionConfiguration.ephemeral
    c.timeoutIntervalForRequest = 30; c.timeoutIntervalForResource = 60
    c.httpCookieStorage = nil; c.urlCache = nil; c.httpShouldSetCookies = false
    return URLSession(configuration: c)
  }()
  func send(_ req: URLRequest, _ done: @escaping (Int, Data?, String?) -> Void) {
    session.dataTask(with: req) { d, r, e in
      if let e = e as NSError? {
        // Before the request left the Mac (no network, no name, no route): safe to try again by itself.
        let unsent = [NSURLErrorNotConnectedToInternet, NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorDNSLookupFailed,
                      NSURLErrorDataNotAllowed, NSURLErrorInternationalRoamingOff, NSURLErrorSecureConnectionFailed].contains(e.code)
        done(0, nil, unsent ? "offline: no network" : "network: the answer never came (\(e.code)). It may have gone, look in Sent.")
        return
      }
      done((r as? HTTPURLResponse)?.statusCode ?? 0, d, nil)
    }.resume()
  }
}

/// Test copies: nothing leaves the Mac. Every request is answered as if it worked and written down for the self test.
final class TestMailHTTP: MailHTTP {
  private(set) var asked: [String] = []
  func send(_ req: URLRequest, _ done: @escaping (Int, Data?, String?) -> Void) {
    asked.append("\(req.httpMethod ?? "GET") \(req.url?.host ?? "")\(req.url?.path ?? "")")
    let isThread = req.url?.path.contains("/threads/") == true
    let body: [String: Any] = isThread ? ["messages": [["payload": ["headers": [["name": "Message-ID", "value": "<test@example.com>"], ["name": "From", "value": "test@example.com"]]]]]] : ["id": "test"]
    done(200, try? JSONSerialization.data(withJSONObject: body), nil)
  }
}

/// This build's Keychain items (named after the build, like the sign in, so a newer build never asks for the Mac
/// password to read an older build's item; the update hands them over instead).
enum MailKeychain {
  static let service = "com.cincee.ps.mail"
  static func account(_ kind: String) -> String { "\(kind)-\(Remember.account)" }
  private static func base(_ kind: String) -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account(kind)] }
  @discardableResult private static func quietly<T>(_ body: () -> T) -> T {
    KeychainQuiet.run(body)   // one lock for the whole app (KeychainQuiet.swift)
  }
  static func read(_ kind: String) -> Data? {
    var q = base(kind); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    return quietly { SecItemCopyMatching(q as CFDictionary, &out) } == errSecSuccess ? out as? Data : nil
  }
  @discardableResult static func write(_ kind: String, _ data: Data) -> Bool {
    if quietly({ SecItemUpdate(base(kind) as CFDictionary, [kSecValueData as String: data] as CFDictionary) }) == errSecSuccess { return true }
    var q = base(kind)
    q[kSecValueData as String] = data
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly   // a scheduled reply still goes while the screen is locked
    q[kSecAttrSynchronizable as String] = false
    q[kSecAttrLabel as String] = kind == "secrets" ? "PS reply sign ins (this Mac only)" : "PS replies waiting to send (this Mac only)"
    return quietly { SecItemAdd(q as CFDictionary, nil) } == errSecSuccess
  }
  static func delete(_ kind: String) { quietly { SecItemDelete(base(kind) as CFDictionary) } }
}

final class MailSend {
  static let shared = MailSend()
  weak var app: App?
  /// Status or queue changed (main thread): Settings and the compose window are told.
  var onChange: (() -> Void)?
  /// A reply really went (main thread): the main page dismisses its card.
  var onSent: ((String) -> Void)?

  private let q = DispatchQueue(label: "ps.mailsend", qos: .userInitiated)
  private let test = IS_TEST_COPY
  private lazy var http: MailHTTP = test ? TestMailHTTP() : URLSessionHTTP()
  // Everything below is touched on q only.
  private var secrets = MailSecrets()
  private var box = Outbox()
  private var problems: [String: String] = [:]          // account (or "instantly") -> the last plain reason
  private var access: [String: (token: String, until: Date)] = [:]
  private var timer: DispatchSourceTimer?
  private var assertion: IOPMAssertionID = 0
  private var started = false
  // Main thread copies for the pages.
  private(set) var status: [String: Any] = ["gmail": [Any](), "instantly": ["saved": false], "waiting": 0]
  private(set) var rows: [[String: Any]] = []
  private var oauthBusy = Set<String>()

  private func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

  // MARK: start, store

  func start() {
    q.async { [self] in
      guard !started else { return }
      started = true
      if !test {
        if let d = MailKeychain.read("secrets"), let s = try? JSONDecoder().decode(MailSecrets.self, from: d) { secrets = s }
        if let d = MailKeychain.read("outbox"), let b = try? JSONDecoder().decode(Outbox.self, from: d) { box = b }
      }
      box.afterRestart(now: nowMs())
      box.prune(now: nowMs())
      saveBox()
      psLog("PS reply: ready (gmail accounts \(secrets.gmail.count), instantly key \(secrets.instantly == nil ? 0 : 1), waiting \(box.waiting))")
      tick()
    }
    for name in [NSWorkspace.didWakeNotification, NSWorkspace.screensDidWakeNotification] {
      NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: nil) { [weak self] _ in
        // The network needs a moment after a wake; a send that finds none yet is tried again by itself.
        self?.q.asyncAfter(deadline: .now() + 4) { self?.tick() }
      }
    }
  }
  private func saveSecrets() { if !test, let d = try? JSONEncoder().encode(secrets) { MailKeychain.write("secrets", d) } }
  private func saveBox() { if !test, let d = try? JSONEncoder().encode(box) { MailKeychain.write("outbox", d) } }

  /// The update hands these to the new build (UpdateHandoff.swift). Old build: read, off the main thread.
  static func handoffCollect() -> [String: String] {
    var o: [String: String] = [:]
    for k in ["secrets", "outbox"] { if let d = MailKeychain.read(k) { o[k] = d.base64EncodedString() } }
    return o
  }
  /// New build: saved as its own. Only known items, sane sizes. Returns how many.
  @discardableResult static func handoffSave(_ o: [String: String]) -> Int {
    var n = 0
    for k in ["secrets", "outbox"] {
      guard let d = o[k].flatMap({ Data(base64Encoded: $0) }), !d.isEmpty, d.count <= 2_000_000 else { continue }
      if k == "secrets" && (try? JSONDecoder().decode(MailSecrets.self, from: d)) == nil { continue }
      if k == "outbox" && (try? JSONDecoder().decode(Outbox.self, from: d)) == nil { continue }
      if MailKeychain.write(k, d) { n += 1 }
    }
    return n
  }

  // MARK: what the pages see (never a token or the key)

  private func publish() {
    var gm: [[String: Any]] = []
    var accts = Set(secrets.gmail.keys)
    for k in problems.keys where k.contains("@") { accts.insert(k) }
    for a in accts.sorted() {
      var g: [String: Any] = ["account": a, "connected": secrets.gmail[a] != nil]
      if let p = problems[a] { g["problem"] = p }
      gm.append(g)
    }
    var inst: [String: Any] = ["saved": secrets.instantly != nil]
    if let p = problems["instantly"] { inst["problem"] = p }
    let st: [String: Any] = ["gmail": gm, "instantly": inst, "waiting": box.waiting]
    let rs = box.rows
    DispatchQueue.main.async { [self] in status = st; rows = rs; onChange?() }
  }
  /// Mac settings (main.swift sendSettings): mailSend.
  func settingsJSON() -> [String: Any] { status }

  // MARK: the queue (from the compose window, main thread)

  /// Send (undo true: the 10 second window) or Schedule. False when the job does not check out.
  func queue(_ o: [String: Any], undo: Bool) {
    q.async { [self] in
      guard let j = OutJob.from(o, undo: undo, now: nowMs()) else { psLog("PS reply: a job from the compose window did not check out, not queued"); return }
      guard box.add(j) else { psLog("PS reply: not queued (already sent, or too many waiting)"); return }
      saveBox()
      psLog("PS reply: \(undo ? "send in 10 s" : "scheduled for \(MailMime.hhmm(j.sendAt))") \(j.logLine)")
      tick()
    }
  }
  /// Undo or Edit: off the schedule, and the job back for the compose window (nil: too late, it has gone).
  func takeBack(_ id: String, why: String, _ done: @escaping ([String: Any]?) -> Void) {
    q.async { [self] in
      let j = box.takeBack(id, now: nowMs())
      if j != nil { saveBox(); psLog("PS reply: \(why), not sent \(j!.logLine)") }
      tick()
      let p = j?.page
      DispatchQueue.main.async { done(p) }
    }
  }
  func cancel(_ id: String) { takeBack(id, why: "cancelled") { _ in } }
  func sendNow(_ id: String) { q.async { [self] in if box.sendNow(id, now: nowMs()) { saveBox(); psLog("PS reply: send now"); tick() } } }
  func dismiss(_ id: String) { q.async { [self] in box.dismiss(id); saveBox(); publish() } }

  // MARK: sending (q)

  private func tick() {
    let now = nowMs()
    let due = box.due(now: now)
    var changed = !due.isEmpty
    for j in due where box.markSending(j.id) {
      saveBox()   // saved as "sending" before anything leaves
      psLog("PS reply: sending \(j.logLine)")
      send(j)
    }
    let before = box.rows.count
    box.prune(now: now)
    if box.rows.count != before { changed = true }
    if changed { saveBox() }
    schedule()
    keepAwake()
    publish()
  }
  private func send(_ j: OutJob) {
    let finish: (SendResult) -> Void = { [weak self] r in self?.q.async { self?.finished(j, r) } }
    if j.via == "proton" {
      // Proton (PS 1.65): through Bridge on this Mac. Anything that goes wrong waits for the person (never sent again by itself).
      ProtonBridge.shared.sendReply(key: String(j.cardId.dropFirst(2)), text: j.text) { code in
        finish(code == nil ? .sent(nil) : .failed("Proton: \(code!)", retry: false))
      }
    } else if j.via == "gmail" {
      GmailSender(http: http, fromName: { [weak self] a in self?.secrets.gmail[a]?.name }, token: { [weak self] a, d in
        guard let self else { return }
        self.q.async { self.accessToken(a, d) }
      }).send(j, finish)
    } else {
      let key = secrets.instantly
      InstantlySender(http: http, key: { key }).send(j, finish)
    }
  }
  private func finished(_ j: OutJob, _ r: SendResult) {
    switch r {
    case .sent:
      box.markSent(j.id, now: nowMs())
      if j.via != "proton" { problems[j.via == "gmail" ? j.account : "instantly"] = nil }
      psLog("PS reply: SENT \(j.logLine)")
      let card = j.cardId
      DispatchQueue.main.async { [weak self] in self?.onSent?(card) }
    case .failed(let why, let retry):
      box.markFailed(j.id, error: why, retry: retry, now: nowMs())
      psLog("PS reply: not sent (\(retry ? "tries again later" : "waits for you")): \(why.prefix(160)) \(j.logLine)")
    }
    saveBox()
    tick()
  }
  private func schedule() {
    timer?.cancel(); timer = nil
    guard let next = box.nextAt else { return }
    // At the time, and at least once a minute while something waits (power, a late wake).
    let wait = max(0.2, min((next - nowMs()) / 1000, 60))
    let t = DispatchSource.makeTimerSource(queue: q)
    t.schedule(deadline: .now() + wait, leeway: .milliseconds(200))
    t.setEventHandler { [weak self] in self?.tick() }
    t.resume()
    timer = t
  }
  /// Plugged in and a reply due within 45 minutes: no idle sleep until it has gone. On battery the Mac may sleep;
  /// the reply then goes on wake.
  private func keepAwake() {
    let soon = box.nextAt.map { $0 - nowMs() < 45 * 60_000 } ?? false
    let want = soon && !test && onAC()
    if want && assertion == 0 {
      var id: IOPMAssertionID = 0
      if IOPMAssertionCreateWithName(kIOPMAssertionTypePreventUserIdleSystemSleep as CFString, IOPMAssertionLevel(kIOPMAssertionLevelOn), "PS sends a scheduled reply" as CFString, &id) == kIOReturnSuccess {
        assertion = id; psLog("PS reply: keeping the Mac awake for a scheduled reply (plugged in)")
      }
    } else if !want && assertion != 0 {
      IOPMAssertionRelease(assertion); assertion = 0
    }
  }
  private func onAC() -> Bool {
    guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue() else { return true }
    return (IOPSGetProvidingPowerSourceType(info)?.takeUnretainedValue() as String?) != kIOPSBatteryPowerValue
  }

  // MARK: Google tokens (q)

  private func accessToken(_ account: String, _ done: @escaping (Result<String, MailTokenError>) -> Void) {
    if let a = access[account], a.until > Date().addingTimeInterval(60) { done(.success(a.token)); return }
    guard let c = secrets.gmail[account] else { done(.failure(MailTokenError(text: "Connect \(account) for sending first (Settings, Reply from PS app).", retry: false))); return }
    if test { done(.success("test")); return }
    var r = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
    r.httpMethod = "POST"; r.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    r.httpBody = form(["client_id": c.clientId, "client_secret": c.clientSecret, "refresh_token": c.refresh, "grant_type": "refresh_token"])
    http.send(r) { [weak self] st, body, err in
      self?.q.async {
        guard let self else { return }
        if let err { done(.failure(MailTokenError(text: err, retry: true))); return }
        let j = body.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
        if st == 200, let t = j?["access_token"] as? String {
          self.access[account] = (t, Date().addingTimeInterval(Double(j?["expires_in"] as? Int ?? 3000)))
          done(.success(t)); return
        }
        if (j?["error"] as? String) == "invalid_grant" {
          // Google signed PS out (password change, access removed, a test app's 7 day limit): ask the developer to connect again.
          self.secrets.gmail[account] = nil; self.saveSecrets()
          self.problems[account] = "Google signed PS app out of this account. Connect it again."
          self.publish()
          done(.failure(MailTokenError(text: "Google signed PS app out of \(account). Connect it again in Settings, Reply from PS app.", retry: false))); return
        }
        done(.failure(MailTokenError(text: "Google did not give PS app a sign in (\(st)).", retry: st >= 500 || st == 429)))
      }
    }
  }
  private func form(_ f: [String: String]) -> Data {
    var allowed = CharacterSet.alphanumerics; allowed.insert(charactersIn: "-._~")
    return Data(f.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }.joined(separator: "&").utf8)
  }

  // MARK: connecting (the developer's clicks, main thread)

  /// Gmail: the developer picks that account's Google OAuth client file once, then signs in on Google's own page in his browser.
  func connectGmail(_ account: String) {
    let a = account.lowercased()
    guard MailMime.validEmail(a), !oauthBusy.contains(a) else { return }
    if test { psLog("PS reply: (test copy) would connect \(a)"); return }
    q.async { [self] in
      let have = secrets.clients[a]
      DispatchQueue.main.async { [self] in
        if let c = have, let id = c["id"], let sec = c["secret"] { startOAuth(a, id, sec); return }
        let p = NSOpenPanel()
        p.title = "Google sign in for \(a)"
        p.message = "Pick the Google Cloud OAuth client file (a .json, Desktop app type) for \(a). PS app keeps it in this Mac's Keychain."
        p.allowedContentTypes = [.json]; p.allowsMultipleSelection = false; p.canChooseDirectories = false
        if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
        p.begin { [weak self] r in
          guard r == .OK, let url = p.url, let self else { return }
          self.q.async {
            guard let d = try? Data(contentsOf: url), d.count < 100_000, let c = GmailOAuth.client(fromFile: d) else {
              self.problems[a] = "That file is not a Google OAuth client file."; self.publish(); return
            }
            self.secrets.clients[a] = ["id": c.id, "secret": c.secret]; self.saveSecrets()
            DispatchQueue.main.async { self.startOAuth(a, c.id, c.secret) }
          }
        }
      }
    }
  }

  private func startOAuth(_ account: String, _ clientId: String, _ secret: String) {
    oauthBusy.insert(account)
    let verifier = MailMime.base64url(Data((0..<32).map { _ in UInt8.random(in: 0...255) }))
    let challenge = MailMime.base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    let state = MailMime.base64url(Data((0..<16).map { _ in UInt8.random(in: 0...255) }))
    guard let srv = LoopbackOnce.start(state: state, account: account) else { oauthBusy.remove(account); fail(account, "PS app could not open its sign in listener."); return }
    let redirect = "http://127.0.0.1:\(srv.port)/cb"
    guard let url = GmailOAuth.authURL(clientId: clientId, redirect: redirect, challenge: challenge, state: state, account: account) else { oauthBusy.remove(account); return }
    psLog("PS reply: Google sign in opened in the browser for \(account)")
    NSWorkspace.shared.open(url)
    srv.wait { [weak self] code, err in
      guard let self else { return }
      guard let code else { DispatchQueue.main.async { self.oauthBusy.remove(account) }; self.fail(account, err ?? "The sign in did not finish."); return }
      var r = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
      r.httpMethod = "POST"; r.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
      r.httpBody = self.form(["code": code, "client_id": clientId, "client_secret": secret, "redirect_uri": redirect, "grant_type": "authorization_code", "code_verifier": verifier])
      self.http.send(r) { st, body, e in
        self.q.async {
          DispatchQueue.main.async { self.oauthBusy.remove(account) }
          let j = body.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
          guard e == nil, st == 200, let refresh = j?["refresh_token"] as? String, let idt = j?["id_token"] as? String, let who = GmailOAuth.identity(idToken: idt) else {
            self.fail(account, e ?? "Google did not finish the sign in (\(st))."); return
          }
          guard who.email == account else {
            self.fail(account, "You signed in as \(who.email). This email came to \(account): sign in with that account."); return
          }
          let scope = j?["scope"] as? String ?? ""
          guard scope.contains("gmail.send") else { self.fail(account, "Google did not give PS app the right to send. Tick it on Google's page."); return }
          self.secrets.gmail[account] = GmailCred(clientId: clientId, clientSecret: secret, refresh: refresh, name: who.name)
          if let t = j?["access_token"] as? String { self.access[account] = (t, Date().addingTimeInterval(Double(j?["expires_in"] as? Int ?? 3000))) }
          self.problems[account] = nil
          self.saveSecrets()
          psLog("PS reply: Gmail connected for sending: \(account)")
          self.publish()
        }
      }
    }
  }
  private func fail(_ account: String, _ why: String) {
    q.async { [self] in problems[account] = why; psLog("PS reply: connect \(account): \(why.prefix(160))"); publish() }
  }

  /// Instantly: the developer types the key into a small PS window (never into a page).
  func connectInstantly() {
    if test { psLog("PS reply: (test copy) would ask for the Instantly key"); return }
    InstantlyKeyWindow.shared.ask { [weak self] key in
      guard let self, let key else { return }
      self.q.async {
        self.secrets.instantly = key; self.problems["instantly"] = nil
        self.saveSecrets(); psLog("PS reply: Instantly key saved"); self.publish()
      }
    }
  }
  func forget(_ via: String, _ account: String?) {
    q.async { [self] in
      if via == "instantly" { secrets.instantly = nil; problems["instantly"] = nil; psLog("PS reply: Instantly key removed") }
      else if let a = account?.lowercased() { secrets.gmail[a] = nil; access[a] = nil; problems[a] = nil; psLog("PS reply: Gmail sign in forgotten for \(a)") }
      saveSecrets(); publish()
    }
  }
}

/// The one redirect Google sends back after the developer's sign in: a listener on 127.0.0.1 for 5 minutes, one request, then gone.
final class LoopbackOnce {
  let fd: Int32, port: UInt16, state: String, account: String
  /// What the page in the browser says when it worked (Gmail: "Connected for sending: <account>"); the screen recorder's cloud sign in sets its own.
  var doneText: String?
  /// How the error words name the page the person answered on ("Google's page" for Gmail; the cloud sign in sets its own).
  var pageName = "Google's"
  private init(fd: Int32, port: UInt16, state: String, account: String) { self.fd = fd; self.port = port; self.state = state; self.account = account }
  /// `port` 0 picks any free port (Gmail, Google, Microsoft); a number asks for exactly that one (Dropbox matches the redirect address exactly).
  static func start(state: String, account: String, port: UInt16 = 0) -> LoopbackOnce? {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return nil }
    var addr = sockaddr_in(); addr.sin_family = sa_family_t(AF_INET); addr.sin_port = port.bigEndian; addr.sin_addr.s_addr = inet_addr("127.0.0.1")
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    let ok = withUnsafePointer(to: &addr) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } } == 0
    guard ok, listen(fd, 4) == 0 else { close(fd); return nil }
    var got = sockaddr_in(); var len = socklen_t(MemoryLayout<sockaddr_in>.size)
    _ = withUnsafeMutablePointer(to: &got) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) } }
    return LoopbackOnce(fd: fd, port: UInt16(bigEndian: got.sin_port), state: state, account: account)
  }
  /// Waits on its own thread. done(code, nil) or done(nil, why).
  func wait(_ done: @escaping (String?, String?) -> Void) {
    Thread.detachNewThread { [self] in
      defer { close(fd) }
      let until = Date().addingTimeInterval(300)
      while Date() < until {
        var p = pollfd(fd: fd, events: Int16(POLLIN), revents: 0)
        let r = poll(&p, 1, 500)
        if r < 0 { done(nil, "The sign in listener stopped."); return }
        if r == 0 { continue }
        let c = accept(fd, nil, nil)
        if c < 0 { continue }
        var buf = [UInt8](repeating: 0, count: 8192)
        var tv = timeval(tv_sec: 5, tv_usec: 0)
        setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        let n = read(c, &buf, buf.count)
        let req = n > 0 ? String(decoding: buf.prefix(n), as: UTF8.self) : ""
        let line = req.split(separator: "\r\n").first.map(String.init) ?? ""
        let parts = line.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET", let u = URLComponents(string: "http://127.0.0.1" + parts[1]), u.path == "/cb" else {
          _ = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".withCString { write(c, $0, strlen($0)) }; close(c); continue
        }
        let qi = u.queryItems ?? []
        let code = qi.first { $0.name == "code" }?.value, st = qi.first { $0.name == "state" }?.value, err = qi.first { $0.name == "error" }?.value
        let good = code != nil && st == state
        let msg = good ? (doneText ?? "Connected for sending: \(account)") : err == "access_denied" ? "Not connected: the sign in was cancelled" : "Not connected"
        let html = "<!doctype html><meta charset=utf-8><body style=\"font:16px -apple-system,system-ui;padding:40px;color:#1B1A1D\"><h2 style=\"color:#C8366B\">\(msg)</h2><p>You can close this tab and go back to PS app.</p></body>"
        let resp = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(html.utf8.count)\r\nConnection: close\r\n\r\n" + html
        _ = resp.withCString { write(c, $0, strlen($0)) }
        close(c)
        if good { done(code, nil) } else { done(nil, err == "access_denied" ? "The sign in was cancelled on \(pageName) page." : "\(pageName) answer did not match this sign in.") }
        return
      }
      done(nil, "The sign in timed out after 5 minutes.")
    }
  }
}

/// A small PS window where the developer pastes his Instantly API key (a secure field: never shown, never in a page).
/// Esc closes it (EscAlways.swift: a titled, closable window).
final class InstantlyKeyWindow: NSObject, NSWindowDelegate {
  static let shared = InstantlyKeyWindow()
  private var win: NSWindow?
  private var field: NSSecureTextField?
  private var done: ((String?) -> Void)?

  func ask(_ cb: @escaping (String?) -> Void) {
    if Protected.front { return }   // never takes the keyboard over 1Password or Signal
    done = cb
    if win == nil {
      let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 440, height: 170), styleMask: [.titled, .closable], backing: .buffered, defer: false)
      w.title = "Instantly API key"; w.isReleasedWhenClosed = false; w.delegate = self
      let v = NSView(frame: w.contentView!.bounds)
      let label = NSTextField(wrappingLabelWithString: "Paste your Instantly API key (Instantly, Settings, Integrations, API keys; it needs the right to send replies). PS app keeps it in this Mac's Keychain and never shows it again.")
      label.frame = NSRect(x: 20, y: 92, width: 400, height: 58)
      let f = NSSecureTextField(frame: NSRect(x: 20, y: 58, width: 400, height: 24))
      f.placeholderString = "API key"
      let save = NSButton(title: "Save", target: self, action: #selector(saveTapped)); save.frame = NSRect(x: 330, y: 14, width: 90, height: 30); save.keyEquivalent = "\r"
      let cancel = NSButton(title: "Cancel", target: self, action: #selector(cancelTapped)); cancel.frame = NSRect(x: 236, y: 14, width: 90, height: 30)
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
    field?.stringValue = ""
    guard k.count >= 10, k.count <= 400, !k.contains(" ") else { NSSound.beep(); return }
    let cb = done; done = nil
    win?.orderOut(nil)
    cb?(k)
  }
  @objc private func cancelTapped() { field?.stringValue = ""; win?.orderOut(nil); let cb = done; done = nil; cb?(nil) }
  func windowShouldClose(_ sender: NSWindow) -> Bool { cancelTapped(); return false }
}

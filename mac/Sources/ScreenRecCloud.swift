import AppKit
import SwiftUI
import AVFoundation
import Network
import CryptoKit
import IOKit.ps

// Screen recorder, cloud upload, the recordings list and PS's own player (PS 1.60, pull request 12c). The rules and the providers are
// in ScreenRecCloudCore.swift and ScreenRecCloudProviders.swift (tested with a fake cloud); this file only touches the real world:
// the network, the Keychain, the browser sign in, the island ring, the player window.
//
// OFF means off: while the person has not said yes (or the feature is off in this build) sync() stops every timer and the network
// watch, nothing is read from disk, no request is made and every op below answers nothing.
//
// Logins: each person brings their own app registration (their own Google Cloud OAuth desktop client file, Dropbox app key,
// Microsoft app registration) like the Gmail sign in of PR 8: PKCE, a loopback redirect, the refresh token in this Mac's Keychain
// only, never on anyone else's server. Test copies (PS_SELFTEST) never touch the Keychain, the browser or the network.

// ---------- Keychain (this Mac only) ----------
enum SRCloudKeychain {
  static let test = ProcessInfo.processInfo.environment["PS_SELFTEST"] != nil
  private static var mem: [String: Data] = [:]
  private static let lock = NSLock()
  static let kinds = ["login-googleDrive", "login-dropbox", "login-oneDrive", "seal"]
  static func read(_ k: String) -> Data? { if test { lock.lock(); defer { lock.unlock() }; return mem[k] }; return MailKeychain.read("srcloud-" + k) }
  @discardableResult static func write(_ k: String, _ d: Data) -> Bool { if test { lock.lock(); defer { lock.unlock() }; mem[k] = d; return true }; return MailKeychain.write("srcloud-" + k, d) }
  static func delete(_ k: String) { if test { lock.lock(); mem[k] = nil; lock.unlock() } else { MailKeychain.delete("srcloud-" + k) } }
  /// The key that seals uploads. Made once, kept in this Mac's Keychain, handed to the next build on an update.
  static func sealKey(create: Bool) -> Data? {
    if let d = read("seal"), d.count == 32 { return d }
    guard create else { return nil }
    let k = Data((0..<32).map { _ in UInt8.random(in: 0...255) })
    return write("seal", k) ? k : nil
  }
}
struct SRLogin: Codable, Equatable {
  var clientId: String
  var clientSecret: String?
  var refresh: String?
  var label: String?
}

// ---------- real HTTP: one blocking request, off the main thread ----------
final class SRURLSessionHTTP: SRCloudHTTP {
  private let session: URLSession = {
    let c = URLSessionConfiguration.ephemeral
    c.timeoutIntervalForRequest = 60; c.timeoutIntervalForResource = 900
    c.httpCookieStorage = nil; c.urlCache = nil; c.httpShouldSetCookies = false
    return URLSession(configuration: c)
  }()
  func send(_ r: SRReq) -> SRResp {
    if SRCloudKeychain.test { return SRResp(status: 0, netError: "test copy: nothing leaves the Mac") }
    var req = URLRequest(url: r.url); req.httpMethod = r.method; req.httpBody = r.body
    for (k, v) in r.headers { req.setValue(v, forHTTPHeaderField: k) }
    let sem = DispatchSemaphore(value: 0)
    var out = SRResp(status: 0, netError: "network: no answer")
    session.dataTask(with: req) { d, resp, e in
      if let e = e as NSError? { out = SRResp(status: 0, netError: "network: \(e.localizedDescription)") }
      else if let h = resp as? HTTPURLResponse {
        var hs: [String: String] = [:]
        for (k, v) in h.allHeaderFields { hs["\(k)"] = "\(v)" }
        out = SRResp(status: h.statusCode, headers: hs, body: d ?? Data())
      }
      sem.signal()
    }.resume()
    sem.wait()
    return out
  }
}

// ---------- sign in (PKCE, loopback, the person's own app registration) ----------
final class SRCloudAuth {
  let http: SRCloudHTTP
  private var access: [SRCloudProvider: (token: String, until: Date)] = [:]
  private let lock = NSLock()
  init(http: SRCloudHTTP) { self.http = http }

  static func keyName(_ p: SRCloudProvider) -> String { "login-\(p.rawValue)" }
  func login(_ p: SRCloudProvider) -> SRLogin? { SRCloudKeychain.read(Self.keyName(p)).flatMap { try? JSONDecoder().decode(SRLogin.self, from: $0) } }
  func save(_ p: SRCloudProvider, _ l: SRLogin) { if let d = try? JSONEncoder().encode(l) { SRCloudKeychain.write(Self.keyName(p), d) } }
  func signOut(_ p: SRCloudProvider) { SRCloudKeychain.delete(Self.keyName(p)); lock.lock(); access[p] = nil; lock.unlock() }

  static func form(_ f: [String: String]) -> Data {
    var allowed = CharacterSet.alphanumerics; allowed.insert(charactersIn: "-._~")
    return Data(f.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }.joined(separator: "&").utf8)
  }
  static func tokenURL(_ p: SRCloudProvider) -> URL {
    switch p {
    case .dropbox: return URL(string: "https://api.dropboxapi.com/oauth2/token")!
    case .oneDrive: return URL(string: "https://login.microsoftonline.com/common/oauth2/v2.0/token")!
    default: return URL(string: "https://oauth2.googleapis.com/token")!
    }
  }
  static let signedOutWords: [SRCloudProvider: String] = [
    .googleDrive: "Google signed PS out of Drive. Sign in again. If your Google project is in Testing mode, Google does this every 7 days: publish the project to stop it.",
    .dropbox: "Dropbox signed PS out. Sign in again.",
    .oneDrive: "Microsoft signed PS out of OneDrive. Sign in again.",
  ]

  /// A fresh access token (blocking). A refresh token that no longer works clears itself and asks for a new sign in.
  func token(_ p: SRCloudProvider, force: Bool) throws -> String {
    lock.lock()
    if !force, let a = access[p], a.until > Date().addingTimeInterval(60) { lock.unlock(); return a.token }
    lock.unlock()
    guard var l = login(p), let refresh = l.refresh else { throw SRUpError.authLost("Sign in to \(p.label) first.") }
    var f = ["client_id": l.clientId, "grant_type": "refresh_token", "refresh_token": refresh]
    if let s = l.clientSecret, !s.isEmpty { f["client_secret"] = s }
    if p == .oneDrive { f["scope"] = "Files.ReadWrite offline_access" }
    var r = SRReq(method: "POST", url: Self.tokenURL(p), headers: ["Content-Type": "application/x-www-form-urlencoded"], body: Self.form(f))
    r.headers["Accept"] = "application/json"
    let resp = http.send(r)
    if let e = resp.netError { throw SRUpError.transient(e) }
    let j = resp.json
    if resp.status == 200, let t = j?["access_token"] as? String {
      if let nr = j?["refresh_token"] as? String, nr != refresh { l.refresh = nr; save(p, l) }
      lock.lock(); access[p] = (t, Date().addingTimeInterval(Double(j?["expires_in"] as? Int ?? 3000))); lock.unlock()
      return t
    }
    if (j?["error"] as? String) == "invalid_grant" {
      l.refresh = nil; save(p, l); lock.lock(); access[p] = nil; lock.unlock()
      throw SRUpError.authLost(Self.signedOutWords[p] ?? "Sign in again.")
    }
    if resp.status >= 500 || resp.status == 429 { throw SRUpError.transient("\(p.label) said \(resp.status).") }
    throw SRUpError.authLost("\(p.label) did not give PS a sign in (\(resp.status)).")
  }

  static func authURL(_ p: SRCloudProvider, clientId: String, redirect: String, challenge: String, state: String) -> URL? {
    var c: URLComponents
    var q: [URLQueryItem] = [.init(name: "client_id", value: clientId), .init(name: "redirect_uri", value: redirect), .init(name: "response_type", value: "code"),
                             .init(name: "code_challenge", value: challenge), .init(name: "code_challenge_method", value: "S256"), .init(name: "state", value: state)]
    switch p {
    case .googleDrive:
      c = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
      q += [.init(name: "scope", value: "openid email https://www.googleapis.com/auth/drive.file"), .init(name: "access_type", value: "offline"), .init(name: "prompt", value: "consent")]
    case .dropbox:
      c = URLComponents(string: "https://www.dropbox.com/oauth2/authorize")!
      q += [.init(name: "token_access_type", value: "offline"), .init(name: "scope", value: "files.content.write files.content.read files.metadata.read")]
    default:
      c = URLComponents(string: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize")!
      q += [.init(name: "scope", value: "Files.ReadWrite offline_access openid email"), .init(name: "prompt", value: "select_account")]
    }
    c.queryItems = q
    return c.url
  }

  /// The person's click: opens the provider's own page in the browser and waits for the redirect (5 minutes). done(nil) or done(why).
  func signIn(_ p: SRCloudProvider, done: @escaping (String?) -> Void) {
    guard !SRCloudKeychain.test else { done("This is a test copy: nothing is signed in."); return }
    guard p.usesAPI, var l = login(p) else { done("Add your app details for \(p.label) first."); return }
    let verifier = MailMime.base64url(Data((0..<32).map { _ in UInt8.random(in: 0...255) }))
    let challenge = MailMime.base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    let state = MailMime.base64url(Data((0..<16).map { _ in UInt8.random(in: 0...255) }))
    guard let srv = LoopbackOnce.start(state: state, account: p.label) else { done("PS could not open its sign in listener."); return }
    srv.doneText = "Connected: \(p.label). PS can upload your recordings there."
    let host = p == .oneDrive ? "localhost" : "127.0.0.1"
    let redirect = "http://\(host):\(srv.port)/cb"
    guard let url = Self.authURL(p, clientId: l.clientId, redirect: redirect, challenge: challenge, state: state) else { done("The sign in address could not be made."); return }
    NSWorkspace.shared.open(url)
    srv.wait { [weak self] code, err in
      guard let self else { return }
      guard let code else { done(err ?? "The sign in did not finish."); return }
      var f = ["client_id": l.clientId, "code": code, "redirect_uri": redirect, "grant_type": "authorization_code", "code_verifier": verifier]
      if let s = l.clientSecret, !s.isEmpty { f["client_secret"] = s }
      if p == .oneDrive { f["scope"] = "Files.ReadWrite offline_access openid email" }
      let resp = self.http.send(SRReq(method: "POST", url: Self.tokenURL(p), headers: ["Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"], body: Self.form(f)))
      let j = resp.json
      guard resp.status == 200, let refresh = j?["refresh_token"] as? String else { done(resp.netError ?? "\(p.label) did not finish the sign in (\(resp.status)).\(p == .dropbox ? " Check that the redirect address is added in your Dropbox app." : "")"); return }
      if p == .googleDrive, !((j?["scope"] as? String) ?? "").contains("drive.file") { done("Google did not give PS the Drive file permission. Tick it on Google's page."); return }
      l.refresh = refresh
      if let idt = j?["id_token"] as? String, let who = GmailOAuth.identity(idToken: idt) { l.label = who.email }
      self.save(p, l)
      if let t = j?["access_token"] as? String { self.lock.lock(); self.access[p] = (t, Date().addingTimeInterval(Double(j?["expires_in"] as? Int ?? 3000))); self.lock.unlock() }
      done(nil)
    }
  }
}

// ---------- what the Mac is doing (read only) ----------
final class SRNetWatch {
  private let m = NWPathMonitor()
  private let lock = NSLock()
  private var _online = true, _constrained = false, _expensive = false
  private var running = false
  var online: Bool { lock.lock(); defer { lock.unlock() }; return _online }
  var constrained: Bool { lock.lock(); defer { lock.unlock() }; return _constrained }
  var expensive: Bool { lock.lock(); defer { lock.unlock() }; return _expensive }
  func start() {
    guard !running, !SRCloudKeychain.test else { return }
    running = true
    m.pathUpdateHandler = { [weak self] p in
      guard let self else { return }
      self.lock.lock(); self._online = p.status == .satisfied; self._constrained = p.isConstrained; self._expensive = p.isExpensive; self.lock.unlock()
    }
    m.start(queue: DispatchQueue(label: "ps.screenrec.net"))
  }
  func stop() { guard running else { return }; running = false; m.cancel() }
}
struct SRRealUbiquity: SRUbiquity {
  func uploaded(_ url: URL) -> Bool? {
    guard let v = try? url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemIsUploadedKey]), v.isUbiquitousItem == true, let up = v.ubiquitousItemIsUploaded else { return nil }
    return up
  }
}

// ---------- the host ----------
final class ScreenRecCloud {
  static let shared = ScreenRecCloud()
  /// `q`: the page's messages, the library and the settings (never held up by an upload). `work`: the upload engine, one job at a time,
  /// which can take hours. The two share only what is behind `mu`: settings, library, a copy of the jobs, the problem and wait words, the gate.
  private let q = DispatchQueue(label: "ps.screenrec.cloud")
  private let work = DispatchQueue(label: "ps.screenrec.cloud.work")
  private let mu = NSLock()
  private let defaults = UserDefaults.standard
  private let key = "screenrec.cloud", folderKey = "screenrec.cloud.folder"
  private let http: SRCloudHTTP = SRURLSessionHTTP()
  private lazy var auth = SRCloudAuth(http: http)
  private let net = SRNetWatch()
  private let engine = SRUploadEngine()
  private var _settings = SRCloudSettings(), _library = SRLibrary(), _jobs: [SRJob] = [], _problem: String?, _wait: String?, _gate = false
  private var settings: SRCloudSettings { get { mu.lock(); defer { mu.unlock() }; return _settings } set { mu.lock(); _settings = newValue; mu.unlock() } }
  private var library: SRLibrary { get { mu.lock(); defer { mu.unlock() }; return _library } set { mu.lock(); _library = newValue; mu.unlock() } }
  private var jobs: [SRJob] { get { mu.lock(); defer { mu.unlock() }; return _jobs } set { mu.lock(); _jobs = newValue; mu.unlock() } }
  private var problem: String? { get { mu.lock(); defer { mu.unlock() }; return _problem } set { mu.lock(); _problem = newValue; mu.unlock() } }
  private var waitWords: String? { get { mu.lock(); defer { mu.unlock() }; return _wait } set { mu.lock(); _wait = newValue; mu.unlock() } }
  private var gateNow: Bool { mu.lock(); defer { mu.unlock() }; return _gate }
  private static let activeStates: Set<SRJobState> = [.waiting, .uploading, .verifying]
  private var loaded = false
  private var timer: Timer?
  private var busy = false
  private var lastSweep = Date.distantPast
  private var recordingFlag = false
  private let flagLock = NSLock()
  private var lastPush = Date.distantPast
  private var startedAttendees: [String] = []
  private var startedMeeting: String?
  private var startedAt: Date?
  let ring = UpRingModel()
  private let player = SRPlayerHost()

  static var supportDir: URL {
    let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("PS/screenrec", isDirectory: true)
    try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
    return d
  }
  private var gateOpen: Bool { ScreenRec.shared.controller?.gateOpen == true }

  // ----- on and off -----
  /// Called whenever the recorder's switches change. Closed gate: everything stops and nothing is read.
  func sync() {
    let open = gateOpen
    mu.lock(); _gate = open; mu.unlock()
    guard open else {
      timer?.invalidate(); timer = nil; net.stop(); ring.hide()
      return
    }
    q.async { [self] in
      loadIfNeeded()
      DispatchQueue.main.async { [self] in
        let active = settings.provider != .none || jobs.contains { Self.activeStates.contains($0.state) }
        if active, timer == nil {
          let t = Timer(timeInterval: 30, repeats: true) { [weak self] _ in self?.kick() }
          t.tolerance = 10; RunLoop.main.add(t, forMode: .common); timer = t
          net.start()
        } else if !active { timer?.invalidate(); timer = nil; net.stop() }
      }
      kick()
    }
  }
  private func loadIfNeeded() {
    guard !loaded else { return }
    loaded = true
    if let d = defaults.data(forKey: key), let s = try? JSONDecoder().decode(SRCloudSettings.self, from: d) { settings = s }
    let dir = Self.supportDir
    if let d = try? Data(contentsOf: dir.appendingPathComponent("library.json")), let l = try? JSONDecoder().decode(SRLibrary.self, from: d) { library = l }
    if let d = try? Data(contentsOf: dir.appendingPathComponent("queue.json")), let qq = try? JSONDecoder().decode(SRQueue.self, from: d) { engine.queue = qq; jobs = qq.jobs }
    engine.settings = { [weak self] in self?.settings ?? SRCloudSettings() }
    engine.env = { [weak self] in self?.currentEnv() ?? SREnv() }
    engine.uploader = { [weak self] p in self?.makeUploader(p) }
    engine.master = { if let k = SRCloudKeychain.sealKey(create: true) { return k }; throw SRSealError.wrongKey }
    engine.tempDir = FileManager.default.temporaryDirectory
    engine.save = { [weak self] qq in self?.jobs = qq.jobs; self?.saveQueue(qq) }
    engine.onProgress = { [weak self] j in self?.progressed(j) }
    engine.onVerified = { [weak self] j in self?.q.async { self?.verified(j) } }
    engine.onLocalRemoved = { [weak self] j in self?.q.async { self?.localRemoved(j) } }
    engine.onFailed = { [weak self] _ in self?.pushAll() }
    // a recording that is gone from the disk is not a recording
    var lib = library
    for r in lib.items where r.path != nil && !FileManager.default.fileExists(atPath: r.path!) { lib.finishDelete(r.id, localGone: true, cloudGone: false) }
    library = lib
    saveLibrary()
  }
  private func saveSettings() { if let d = try? JSONEncoder().encode(settings) { defaults.set(d, forKey: key) } }
  private func saveLibrary() { if let d = try? JSONEncoder().encode(library) { try? d.write(to: Self.supportDir.appendingPathComponent("library.json"), options: .atomic) } }
  private func saveQueue(_ qq: SRQueue) { if let d = try? JSONEncoder().encode(qq) { try? d.write(to: Self.supportDir.appendingPathComponent("queue.json"), options: .atomic) } }

  // ----- the recorder tells us -----
  /// The recorder's state changed (called from ScreenRecIsland.recorderChanged, main thread).
  func recorderChanged(state: SRRunState, meeting: String?, attendees: [String]) {
    flagLock.lock(); recordingFlag = [.starting, .recording, .paused, .stopping].contains(state); flagLock.unlock()
    if state == .recording, startedAt == nil { startedAt = Date(); startedMeeting = meeting; startedAttendees = attendees }
    guard state == .idle, startedAt != nil || ScreenRec.shared.lastFileURL != nil else { return }
    let at = startedAt ?? Date(), name = startedMeeting, who = startedAttendees
    startedAt = nil; startedMeeting = nil; startedAttendees = []
    guard gateOpen, let url = ScreenRec.shared.lastFileURL else { return }
    recorded(url: url, startedAt: at, meeting: name, attendees: who)
  }
  /// A recording just ended: it goes into the list, then (after metadata is read) into the upload queue. Never while recording.
  func recorded(url: URL, startedAt: Date, meeting: String?, attendees: [String]) {
    guard gateOpen, FileManager.default.fileExists(atPath: url.path) else { return }
    let audioOnly = url.pathExtension.lowercased() == "m4a"
    q.async { [self] in
      loadIfNeeded()
      guard !library.items.contains(where: { $0.path == url.path }) else { return }
      let size = ((try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int64) ?? nil) ?? 0
      let asset = AVURLAsset(url: url)
      let dur = max(0, asset.duration.seconds.isFinite ? asset.duration.seconds : 0)
      let id = UUID().uuidString.lowercased()
      let base = url.deletingPathExtension().lastPathComponent
      let title = meeting.map { SRLibrary.cleanTitle($0) } ?? (base.count > 11 ? String(base.dropFirst(11)) : base)
      var r = SRRec(id: id, title: title.isEmpty ? "Recording" : title, fileName: url.lastPathComponent, path: url.path, startedAt: startedAt, duration: dur, meeting: meeting,
                    attendees: Array(attendees.prefix(20)), audioOnly: audioOnly, size: size, sizeAtUpload: size, thumb: audioOnly ? nil : Self.thumb(asset), cloud: nil,
                    lowered: ScreenRec.shared.controller?.snapshot.lowered ?? [])
      r.title = SRLibrary.cleanTitle(r.title)
      var lib = library; lib.add(r); library = lib; saveLibrary()
      if settings.provider != .none { enqueueLater(id, url.path, url.lastPathComponent, size) }
      pushAll()
    }
  }
  /// A small picture from the first seconds, as a data address (kept small: it is the only picture that ever syncs).
  static func thumb(_ asset: AVURLAsset) -> String? {
    let g = AVAssetImageGenerator(asset: asset); g.appliesPreferredTrackTransform = true; g.maximumSize = CGSize(width: 160, height: 90)
    for t in [1.0, 0.0] {
      guard let cg = try? g.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) else { continue }
      let rep = NSBitmapImageRep(cgImage: cg)
      if let d = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.5]), d.count < 12_000 { return "data:image/jpeg;base64," + d.base64EncodedString() }
    }
    return nil
  }

  // ----- the runner -----
  private func currentEnv() -> SREnv {
    var e = SREnv()
    flagLock.lock(); e.recording = recordingFlag; flagLock.unlock()
    let th = ProcessInfo.processInfo.thermalState
    e.thermalHigh = th == .serious || th == .critical
    let p = PowerWatch.readNow()
    e.onBattery = p.onBattery; e.batteryPct = p.pct ?? 100
    e.lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
    e.constrained = net.constrained; e.expensive = net.expensive; e.online = net.online
    return e
  }
  private func kick() { work.async { [self] in kickNow() } }
  private func enqueueLater(_ id: String, _ path: String, _ name: String, _ size: Int64) {
    let st = settings
    work.async { [self] in _ = engine.enqueue(id: id, path: path, name: name, size: size, provider: st.provider, encrypt: st.encrypt); kickNow() }
  }
  /// On the work queue: runs due jobs one after another until nothing is due or the Mac says wait.
  private func kickNow() {
    guard gateNow, !busy else { return }
    busy = true
    defer { busy = false }
    var steps = 0
    while steps < 200 {
      steps += 1
      let r = engine.tick()
      if case .waiting(let w) = r { waitWords = w.words; break }
      waitWords = nil
      if r == .idle { break }
    }
    if SRWait.reason(currentEnv()) == nil, Date().timeIntervalSince(lastSweep) > 3600 {
      lastSweep = Date()
      let removed = engine.sweep(library)
      if !removed.isEmpty { q.async { [self] in var lib = library; for id in removed { lib.finishDelete(id, localGone: true, cloudGone: false) }; library = lib; saveLibrary(); pushAll() } }
    }
    engine.queue.prune(); jobs = engine.queue.jobs; pushAll(); syncRing()
  }

  private func destFolder(_ p: SRCloudProvider) -> URL? {
    if let d = defaults.data(forKey: folderKey) {
      var stale = false
      if let u = try? URL(resolvingBookmarkData: d, options: [.withSecurityScope], relativeTo: nil, bookmarkDataIsStale: &stale) { _ = u.startAccessingSecurityScopedResource(); return u }
    }
    if p == .iCloud {
      let u = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs", isDirectory: true)
      if FileManager.default.fileExists(atPath: u.path) { return u.appendingPathComponent("PS Recordings", isDirectory: true) }
    }
    return nil
  }
  private func makeUploader(_ p: SRCloudProvider) -> SRUploader? {
    switch p {
    case .googleDrive, .dropbox, .oneDrive:
      guard auth.login(p)?.refresh != nil else { return nil }
      let a = SRAuthed(http: http, token: { [weak self] force in
        guard let self else { throw SRUpError.fatal("PS is closing.") }
        return try self.auth.token(p, force: force)
      })
      switch p {
      case .googleDrive: return SRGoogleDrive(a)
      case .dropbox: return SRDropbox(a)
      default: return SROneDrive(a)
      }
    case .iCloud, .folder:
      guard let d = destFolder(p) else { return nil }
      return SRFolderUploader(provider: p, dest: d, ubiquity: p == .iCloud ? SRRealUbiquity() : nil)
    case .none: return nil
    }
  }

  // ----- engine callbacks (cloud queue) -----
  private func progressed(_ j: SRJob) {
    mu.lock(); if let i = _jobs.firstIndex(where: { $0.id == j.id }) { _jobs[i] = j }; mu.unlock()
    guard Date().timeIntervalSince(lastPush) > 0.8 else { return }
    lastPush = Date(); syncRing()
  }
  private func verified(_ j: SRJob) {
    var lib = library
    guard var r = lib.rec(j.id), let rem = j.remote else { return }
    let kind = j.provider.hashKind
    r.cloud = SRCloudRef(provider: j.provider, remoteId: rem.id, remoteName: rem.name, size: rem.size ?? j.uploadSize, hashKind: kind,
                         hash: kind.flatMap { j.hashes?.value(j.provider == .googleDrive ? .sha256 : $0) }, encrypted: j.encrypt, verified: true, verifiedAt: j.verifiedAt, webURL: rem.webURL)
    r.sizeAtUpload = j.size
    lib.add(r); library = lib; saveLibrary()
    let title = r.title
    DispatchQueue.main.async { ScreenRecIsland.shared.brain?.uploaded(fileName: title) }
    pushAll(); syncRing()
  }
  private func localRemoved(_ j: SRJob) {
    var lib = library; lib.finishDelete(j.id, localGone: true, cloudGone: false); library = lib; saveLibrary(); pushAll()
  }

  // ----- the island ring: only while uploading, never beside a recording, nothing in private mode -----
  func syncRing() {
    let lib = library
    let active = jobs.filter { Self.activeStates.contains($0.state) }.map { (name: lib.rec($0.id)?.title ?? $0.name, fraction: $0.fraction) }
    flagLock.lock(); let rec = recordingFlag; flagLock.unlock()
    DispatchQueue.main.async { [self] in
      guard gateOpen else { ring.hide(); return }
      let sign = SRUploadSigns.ring(active: active, privateOn: PrivateHold.shared.on, recording: rec)
      if let s = sign, let a = Island.shared.timerAnchor() { ring.show(s, anchor: a, reduceMotion: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion) } else { ring.hide() }
    }
  }

  // ----- what the pages see (never a token, a key or a path) -----
  private func cloudJSON() -> [String: Any] {
    var logins: [String: Any] = [:]
    for p in [SRCloudProvider.googleDrive, .dropbox, .oneDrive] {
      let l = auth.login(p)
      logins[p.rawValue] = ["clientSet": l != nil, "signedIn": l?.refresh != nil, "label": l?.label as Any]
    }
    let lib = library, st = settings, pr = problem, wt = waitWords
    let queue: [[String: Any]] = jobs.suffix(12).map { j in
      ["id": j.id, "name": lib.rec(j.id)?.title ?? j.name, "state": j.state.rawValue, "fraction": j.fraction, "note": (j.lastError ?? j.keep) as Any]
    }
    let icloud = FileManager.default.fileExists(atPath: FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs").path)
    return ["type": "screenrecCloud", "enabled": true, "provider": st.provider.rawValue, "removeAfter": st.removeAfter, "keepDays": st.keepDays,
            "encrypt": st.encrypt, "folderName": st.folderName as Any, "logins": logins, "queue": queue, "wait": wt as Any, "problem": pr as Any,
            "iCloudFound": icloud, "providers": SRCloudProvider.allCases.map { ["id": $0.rawValue, "label": $0.label] }]
  }
  /// A random id for this Mac, so rows that sync through the vault say which Mac wrote them (one Mac never removes another Mac's rows).
  private var deviceId: String {
    if let d = defaults.string(forKey: "screenrec.device"), d.count >= 8 { return d }
    let d = UUID().uuidString.lowercased(); defaults.set(d, forKey: "screenrec.device"); return d
  }
  private func libJSON() -> [String: Any] {
    let lib = library, js = jobs
    let items: [[String: Any]] = lib.sorted().map { r in
      var o: [String: Any] = ["id": r.id, "title": r.title, "startedAt": r.startedAt.timeIntervalSince1970 * 1000, "duration": r.duration, "audioOnly": r.audioOnly,
                              "size": r.size, "mac": r.path != nil, "attendees": r.attendees, "lowered": r.lowered]
      if let m = r.meeting { o["meeting"] = m }
      if let t = r.thumb { o["thumb"] = t }
      if let c = r.cloud {
        var cj: [String: Any] = ["provider": c.provider.rawValue, "encrypted": c.encrypted, "verified": c.verified]
        if let u = c.webURL, u.hasPrefix("https://") { cj["openUrl"] = u }
        o["cloud"] = cj
      }
      if let j = js.first(where: { $0.id == r.id }), !j.finished || j.state != .done { o["upload"] = ["state": j.state.rawValue, "fraction": j.fraction, "note": (j.lastError ?? j.keep) as Any] }
      return o
    }
    return ["type": "screenrecLib", "device": deviceId, "items": items]
  }
  private func send(_ o: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) else { return }
    DispatchQueue.main.async { ScreenRec.shared.deliver?(s) }
  }
  private func pushAll() { guard gateNow else { return }; send(cloudJSON()); send(libJSON()) }

  // ----- the page's messages (ScreenRec.handle routes "cloud..." and "rec..." here) -----
  func handle(_ op: String, _ m: [String: Any]) {
    guard gateOpen else { if op == "cloudGet" { send(["type": "screenrecCloud", "enabled": false]) }; return }
    q.async { [self] in
      loadIfNeeded()
      switch op {
      case "cloudGet", "recList": pushAll()
      case "cloudSet": patch(m["patch"] as? [String: Any] ?? [:])
      case "cloudClient": setClient(m)
      case "cloudGoogleFile": DispatchQueue.main.async { self.pickGoogleFile() }
      case "cloudSignIn":
        guard let p = (m["provider"] as? String).flatMap(SRCloudProvider.init(rawValue:)), p.usesAPI else { return }
        problem = nil
        DispatchQueue.main.async { [self] in
          auth.signIn(p) { [weak self] why in
            self?.q.async {
              guard let self else { return }
              self.problem = why
              if why == nil { self.work.async { self.engine.signedIn(); self.kickNow() } }
              self.pushAll()
            }
          }
        }
      case "cloudSignOut":
        if let p = (m["provider"] as? String).flatMap(SRCloudProvider.init(rawValue:)), p.usesAPI { auth.signOut(p) }
        pushAll()
      case "cloudFolder": DispatchQueue.main.async { self.pickFolder() }
      case "cloudRetry": if let id = m["id"] as? String { let k = String(id.prefix(64)); work.async { [self] in engine.retry(k); kickNow() } }
      case "recPlay": if let r = rec(m) { play(r) }
      case "recRename": if let r = rec(m), let t = m["title"] as? String { var lib = library; if lib.rename(r.id, to: t) { library = lib; saveLibrary(); pushAll() } }
      case "recDelete": if let r = rec(m) { delete(r, confirmed: m["confirm"] as? Bool == true, cloudAlso: m["alsoCloud"] as? Bool == true) }
      case "recReveal": if let r = rec(m), let p = r.path { DispatchQueue.main.async { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: p)]) } }
      case "recOpenCloud": if let r = rec(m) { openCloud(r) }
      case "recUpload":
        if let r = rec(m), r.cloud == nil, let p = r.path, settings.provider != .none {
          enqueueLater(r.id, p, r.fileName, r.size)
        }
      default: break
      }
    }
  }
  private func rec(_ m: [String: Any]) -> SRRec? { (m["id"] as? String).flatMap { library.rec(String($0.prefix(64))) } }

  private func patch(_ f: [String: Any]) {
    var s = settings
    if let v = f["provider"] as? String, let p = SRCloudProvider(rawValue: v) { s.provider = p }
    if let v = f["removeAfter"] as? Bool { s.removeAfter = v }
    if let v = f["keepDays"] as? Int { s.keepDays = max(0, min(365, v)) }
    if let v = f["encrypt"] as? Bool { s.encrypt = v }
    settings = s; saveSettings(); pushAll()
    DispatchQueue.main.async { self.sync() }
  }
  private func setClient(_ m: [String: Any]) {
    guard let p = (m["provider"] as? String).flatMap(SRCloudProvider.init(rawValue:)), p == .dropbox || p == .oneDrive,
          let id = (m["id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !id.isEmpty, id.count <= 120,
          id.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil else { problem = "That does not look like an app key. It has only letters, numbers, dots and dashes."; pushAll(); return }
    var l = auth.login(p) ?? SRLogin(clientId: id)
    l.clientId = id; l.refresh = nil
    auth.save(p, l); problem = nil; pushAll()
  }
  private func pickGoogleFile() {
    let p = NSOpenPanel()
    p.title = "Google sign in for Drive"
    p.message = "Pick the Google Cloud OAuth client file (a .json, Desktop app type). PS app keeps it in this Mac's Keychain."
    p.allowedContentTypes = [.json]; p.allowsMultipleSelection = false; p.canChooseDirectories = false
    NSApp.activate(ignoringOtherApps: true)
    p.begin { [weak self] r in
      guard r == .OK, let url = p.url, let self else { return }
      self.q.async {
        guard let d = try? Data(contentsOf: url), d.count < 100_000, let c = GmailOAuth.client(fromFile: d) else { self.problem = "That file is not a Google OAuth client file."; self.pushAll(); return }
        self.auth.save(.googleDrive, SRLogin(clientId: c.id, clientSecret: c.secret, refresh: nil, label: nil)); self.problem = nil; self.pushAll()
      }
    }
  }
  private func pickFolder() {
    let p = NSOpenPanel()
    p.title = "Where should recordings go?"; p.canChooseFiles = false; p.canChooseDirectories = true; p.canCreateDirectories = true; p.allowsMultipleSelection = false
    NSApp.activate(ignoringOtherApps: true)
    p.begin { [weak self] r in
      guard r == .OK, let u = p.url, let self, let data = try? u.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil) else { return }
      self.defaults.set(data, forKey: self.folderKey)
      self.q.async { var st = self.settings; st.folderName = u.lastPathComponent; self.settings = st; self.saveSettings(); self.pushAll(); self.work.async { self.engine.signedIn(); self.kickNow() } }
    }
  }

  // ----- delete asks first; the Mac is the one that enforces it -----
  private func delete(_ r: SRRec, confirmed: Bool, cloudAlso: Bool) {
    switch library.deleteRequest(r.id, confirmed: confirmed, cloudAlso: cloudAlso) {
    case .unknown: break
    case .asks(let plan):
      let both = SRLibrary.plan(for: r, cloudAlso: true), only = SRLibrary.plan(for: r, cloudAlso: false)
      send(["type": "screenrecAsk", "id": r.id, "question": only.question, "hasLocal": r.path != nil, "hasCloud": r.cloud != nil,
            "cloudQuestion": both.question, "provider": r.cloud?.provider.label as Any, "default": plan.question])
    case .done(let local, let cloud):
      var cloudGone = false
      if cloud, let c = r.cloud {
        guard let up = makeUploader(c.provider) else { problem = "Sign in to \(c.provider.label) to delete the copy there. Nothing was deleted."; pushAll(); return }
        do { try up.remove(SRRemote(id: c.remoteId, name: c.remoteName, webURL: c.webURL, size: c.size)); cloudGone = true }
        catch { problem = "The copy in \(c.provider.label) could not be deleted, so nothing was deleted."; pushAll(); return }
      }
      var localGone = false
      if local, let p = r.path { do { try FileManager.default.removeItem(atPath: p); localGone = true } catch { localGone = !FileManager.default.fileExists(atPath: p) } }
      var lib = library; lib.finishDelete(r.id, localGone: localGone, cloudGone: cloudGone); library = lib; saveLibrary()
      let rid = r.id; work.async { [self] in engine.forget(rid) }
      problem = nil; pushAll()
    }
  }
  private func openCloud(_ r: SRRec) {
    guard let c = r.cloud else { return }
    if c.provider.usesFolder { if let u = URL(string: "file://" + c.remoteId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)!) { DispatchQueue.main.async { NSWorkspace.shared.activateFileViewerSelecting([u]) } }; return }
    guard !SRCloudKeychain.test, let s = c.webURL, let u = URL(string: s), u.scheme == "https", let h = u.host?.lowercased(),
          ["google.com", "dropbox.com", "live.com", "office.com", "sharepoint.com", "1drv.ms", "microsoft.com", "onedrive.com"].contains(where: { h == $0 || h.hasSuffix("." + $0) }) else { return }
    DispatchQueue.main.async { NSWorkspace.shared.open(u) }
  }

  // ----- play in PS -----
  /// "Play" on the Saved or Uploaded card: the last recording.
  func playLast() {
    q.async { [self] in
      loadIfNeeded()
      if let u = ScreenRec.shared.lastFileURL, let r = library.items.first(where: { $0.path == u.path }) { play(r) }
      else if let r = library.sorted().first { play(r) }
      else if let u = ScreenRec.shared.lastFileURL { DispatchQueue.main.async { NSWorkspace.shared.open(u) } }
    }
  }
  private func play(_ r: SRRec) {
    guard gateOpen else { return }
    let local = r.path.map { FileManager.default.fileExists(atPath: $0) } ?? false
    let how = SRPlayPlan.how(localExists: local, provider: r.cloud?.provider ?? .none, encrypted: r.cloud?.encrypted ?? false)
    var stream: SRStream?
    var err: String?
    if how == .streamWithToken || how == .temporaryLink || how == .directLink || how == .downloadThenOpen, let c = r.cloud, let up = makeUploader(c.provider), c.provider.usesAPI {
      do { stream = try up.stream(SRRemote(id: c.remoteId, name: c.remoteName, webURL: c.webURL, size: c.size)) } catch { err = "Sign in to \(c.provider.label) to play this from there." }
    } else if how != .local, r.cloud?.provider.usesAPI == true { err = "Sign in to \(r.cloud!.provider.label) to play this from there." }
    let key = SRCloudKeychain.sealKey(create: false)
    DispatchQueue.main.async { [self] in player.open(rec: r, how: how, stream: stream, error: err, sealKey: key) }
  }

  // ----- the update hands the logins and the sealing key to the next build -----
  static func handoffCollect() -> [String: String] {
    var o: [String: String] = [:]
    for k in SRCloudKeychain.kinds { if let d = SRCloudKeychain.read(k) { o[k] = d.base64EncodedString() } }
    return o
  }
  @discardableResult static func handoffSave(_ o: [String: String]) -> Int {
    var n = 0
    for k in SRCloudKeychain.kinds {
      guard let d = o[k].flatMap({ Data(base64Encoded: $0) }), !d.isEmpty, d.count <= 20_000 else { continue }
      if k == "seal" { guard d.count == 32 else { continue } } else if (try? JSONDecoder().decode(SRLogin.self, from: d)) == nil { continue }
      if SRCloudKeychain.write(k, d) { n += 1 }
    }
    return n
  }
}

// ---------- the island ring (a small black capsule beside the island, like the recording part) ----------
final class UpRingModel: ObservableObject {
  @Published var shown = false
  @Published var fraction = 0.0
  @Published var name = "Uploading"
  @Published var count = 1
  @Published var width: CGFloat = 150
  private var win: IslandPanel?
  private var hideWork: DispatchWorkItem?
  static let h: CGFloat = 24, gap: CGFloat = 6, margin: CGFloat = 2

  func show(_ s: SRUploadSign, anchor a: (shape: NSRect, bubbleY: CGFloat, screen: CGRect, panel: NSWindow), reduceMotion calm: Bool) {
    hideWork?.cancel(); hideWork = nil
    fraction = s.fraction; count = s.count
    name = SRUploadSigns.uploading + (s.count > 1 ? " \(s.count)" : "")
    let f11 = NSFont.systemFont(ofSize: 11.5, weight: .semibold)
    let w = ceil(10 + 16 + 6 + ((name + "  100%") as NSString).size(withAttributes: [.font: f11]).width + 12)
    width = w
    let win = window(level: a.panel.level)
    // under the island, centred, so it never fights the recording part for the sides
    let f = CGRect(x: max(a.screen.minX + 4, min(a.shape.midX - w / 2, a.screen.maxX - 4 - w)), y: a.shape.minY - Self.gap - Self.h, width: w, height: Self.h)
    let full = f.insetBy(dx: -Self.margin, dy: -Self.margin).integral
    if win.frame != full { win.setFrame(full, display: true) }
    let anim: Animation = calm ? .easeInOut(duration: 0.2) : .spring(response: 0.42, dampingFraction: 0.62)
    if !win.isVisible { shown = false; win.orderFrontRegardless(); DispatchQueue.main.async { [weak self] in withAnimation(anim) { self?.shown = true } } }
    else if !shown { withAnimation(anim) { shown = true } }
  }
  func hide() {
    guard let w = win, w.isVisible, hideWork == nil else { return }
    let calm = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    withAnimation(calm ? .easeOut(duration: 0.15) : .spring(response: 0.3, dampingFraction: 0.86)) { shown = false }
    let work = DispatchWorkItem { [weak self] in self?.hideWork = nil; if self?.shown == false { self?.win?.orderOut(nil) } }
    hideWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.32, execute: work)
  }
  private func window(level: NSWindow.Level) -> IslandPanel {
    if let w = win { if w.level != level { w.level = level }; return w }
    let p = IslandPanel(contentRect: NSRect(x: 0, y: 0, width: 160, height: 28), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    p.isOpaque = false; p.backgroundColor = .clear; p.hasShadow = false; p.level = level
    p.hidesOnDeactivate = false; p.isReleasedWhenClosed = false; p.collectionBehavior = IslandPlace.spaces; p.ignoresMouseEvents = true
    p.contentView = IslandHost(rootView: UpRingView(m: self))
    if ProcessInfo.processInfo.environment["PS_SELFTEST"] != nil { p.alphaValue = 0 }
    win = p
    return p
  }
}
struct UpRingView: View {
  @ObservedObject var m: UpRingModel
  var body: some View {
    let calm = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    ZStack {
      if m.shown {
        HStack(spacing: 6) {
          ZStack {
            Circle().stroke(Color.white.opacity(0.2), lineWidth: 2.2)
            Circle().trim(from: 0, to: max(0.02, m.fraction)).stroke(Color.white, style: StrokeStyle(lineWidth: 2.2, lineCap: .round)).rotationEffect(.degrees(-90))
          }.frame(width: 14, height: 14)
          Text(m.name).font(.system(size: 11.5, weight: .semibold)).foregroundColor(Color.white.opacity(0.85)).lineLimit(1)
          Text(SRUploadSigns.percent(m.fraction)).font(.system(size: 12, weight: .heavy)).monospacedDigit().foregroundColor(.white).fixedSize()
        }
        .padding(.horizontal, 10)
        .frame(width: m.width, height: UpRingModel.h)
        .background(Capsule().fill(Color.black))
        .overlay(Capsule().stroke(Color.white.opacity(0.14), lineWidth: 0.8))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Uploading a recording, \(SRUploadSigns.percent(m.fraction))")
        .transition(calm ? .opacity : .scale(scale: 0.2, anchor: .top).combined(with: .opacity))
      }
    }
    .frame(width: m.width + 2 * UpRingModel.margin, height: UpRingModel.h + 2 * UpRingModel.margin)
    .environment(\.colorScheme, .dark)
  }
}

// ---------- PS's own player ----------
final class SRPlayerModel: ObservableObject {
  @Published var pb = SRPlayback()
  @Published var status: String?
  @Published var title = ""
  let player = AVPlayer()
  private var obs: Any?
  private var endObs: NSObjectProtocol?
  private var statusObs: NSKeyValueObservation?
  var temps: [URL] = []
  var scrubbing = false
  var onFailed: (() -> Void)?

  func load(_ asset: AVURLAsset) {
    let item = AVPlayerItem(asset: asset)
    player.replaceCurrentItem(with: item)
    statusObs = item.observe(\.status, options: [.new]) { [weak self] it, _ in
      DispatchQueue.main.async {
        guard let self else { return }
        if it.status == .readyToPlay {
          self.status = nil
          self.pb.duration = it.duration.seconds.isFinite ? it.duration.seconds : 0
          self.pb.audioTracks = max(1, asset.tracks(withMediaType: .audio).count)
          self.applyMix()
        } else if it.status == .failed { self.onFailed?() }
      }
    }
    if obs == nil {
      obs = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main) { [weak self] t in
        guard let self, !self.scrubbing, t.seconds.isFinite else { return }
        self.pb.position = t.seconds
      }
    }
    endObs = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in self?.pb.playing = false }
  }
  func applyMix() {
    guard let item = player.currentItem else { return }
    let tracks = item.asset.tracks(withMediaType: .audio)
    let vols = pb.trackVolumes()
    let mix = AVMutableAudioMix()
    mix.inputParameters = tracks.enumerated().map { i, t in
      let p = AVMutableAudioMixInputParameters(track: t); p.setVolume(Float(i < vols.count ? vols[i] : 1), at: .zero); return p
    }
    item.audioMix = mix
  }
  func toggle() { pb.toggle(); if pb.playing { if pb.position >= pb.duration - 0.2, pb.duration > 0 { seek(0) }; player.rate = Float(pb.rate) } else { player.pause() } }
  func skip(_ s: Double) { pb.skip(s); seek(pb.position) }
  func seek(_ t: TimeInterval) { pb.seek(t); player.seek(to: CMTime(seconds: pb.position, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) }
  func cycleRate() { pb.nextRate(); if pb.playing { player.rate = Float(pb.rate) } }
  func volume(_ v: SRVoice, _ x: Double) { pb.setVolume(v, x); applyMix() }
  func close() {
    player.pause()
    if let o = obs { player.removeTimeObserver(o); obs = nil }
    if let e = endObs { NotificationCenter.default.removeObserver(e); endObs = nil }
    statusObs = nil
    player.replaceCurrentItem(with: nil)
    for t in temps { try? FileManager.default.removeItem(at: t) }
    temps = []
  }
}

struct SRVideoLayer: NSViewRepresentable {
  let player: AVPlayer
  func makeNSView(context: Context) -> NSView {
    let v = NSView(); v.wantsLayer = true
    let l = AVPlayerLayer(player: player); l.videoGravity = .resizeAspect; l.backgroundColor = NSColor.black.cgColor
    v.layer = l
    return v
  }
  func updateNSView(_ v: NSView, context: Context) { (v.layer as? AVPlayerLayer)?.player = player }
}

struct SRPlayerView: View {
  @ObservedObject var m: SRPlayerModel
  var audioOnly: Bool
  var fullScreen: () -> Void
  var close: () -> Void
  private func time(_ t: Double) -> String { SRSnapshot.timerText(max(0, t)) }
  var body: some View {
    VStack(spacing: 0) {
      ZStack {
        if audioOnly { Color.black; Image(systemName: "waveform").font(.system(size: 54)).foregroundColor(.white.opacity(0.5)) } else { SRVideoLayer(player: m.player) }
        if let s = m.status { Text(s).font(.system(size: 14, weight: .semibold)).foregroundColor(.white).padding(10).background(Capsule().fill(Color.black.opacity(0.7))) }
      }.frame(minHeight: 240)
      VStack(spacing: 8) {
        HStack(spacing: 8) {
          Text(time(m.pb.position)).font(.system(size: 11)).monospacedDigit().frame(width: 52, alignment: .trailing)
          Slider(value: Binding(get: { m.pb.position }, set: { m.pb.seek($0) }), in: 0...max(m.pb.duration, 1)) { editing in
            m.scrubbing = editing
            if !editing { m.seek(m.pb.position) }
          }.accessibilityLabel("Position")
          Text(time(m.pb.duration)).font(.system(size: 11)).monospacedDigit().frame(width: 52, alignment: .leading)
        }
        HStack(spacing: 14) {
          Button { m.skip(-SRPlayback.skipSeconds) } label: { Image(systemName: "gobackward.15") }.accessibilityLabel("Back 15 seconds").help("Back 15 seconds")
          Button { m.toggle() } label: { Image(systemName: m.pb.playing ? "pause.fill" : "play.fill").frame(width: 22) }.accessibilityLabel(m.pb.playing ? "Pause" : "Play").help(m.pb.playing ? "Pause" : "Play")
          Button { m.skip(SRPlayback.skipSeconds) } label: { Image(systemName: "goforward.15") }.accessibilityLabel("Forward 15 seconds").help("Forward 15 seconds")
          Button { m.cycleRate() } label: { Text(SRPlayback.rateLabel(m.pb.rate)).font(.system(size: 12, weight: .semibold)).frame(width: 44) }.accessibilityLabel("Speed").help("Speed")
          Spacer()
          if m.pb.hasTwoTracks {
            Text("Me").font(.system(size: 11))
            Slider(value: Binding(get: { m.pb.me }, set: { m.volume(.me, $0) }), in: 0...1).frame(width: 80).accessibilityLabel("Me volume")
            Text("Them").font(.system(size: 11))
            Slider(value: Binding(get: { m.pb.them }, set: { m.volume(.them, $0) }), in: 0...1).frame(width: 80).accessibilityLabel("Them volume")
          }
          Button { fullScreen() } label: { Image(systemName: "arrow.up.left.and.arrow.down.right") }.accessibilityLabel("Full screen").help("Full screen")
        }
        .buttonStyle(.plain).font(.system(size: 16))
      }
      .padding(12)
    }
    .frame(minWidth: 520, minHeight: 380)
  }
}

/// One player window at a time. A titled, closable window: Esc closes it (EscAlways).
final class SRPlayerHost: NSObject, NSWindowDelegate {
  private var win: NSWindow?
  private var model: SRPlayerModel?
  private var downloading: URLSessionDownloadTask?

  func open(rec r: SRRec, how: SRPlayHow, stream: SRStream?, error: String?, sealKey: Data?) {
    guard !SRCloudKeychain.test else { return }
    closeNow()
    let m = SRPlayerModel(); m.title = r.title; model = m
    let audioOnly = r.audioOnly
    let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: audioOnly ? 560 : 860, height: audioOnly ? 220 : 560), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
    w.title = r.title; w.isReleasedWhenClosed = false; w.delegate = self; w.collectionBehavior = [.fullScreenPrimary]
    w.contentView = NSHostingView(rootView: SRPlayerView(m: m, audioOnly: audioOnly, fullScreen: { [weak w] in w?.toggleFullScreen(nil) }, close: { [weak w] in w?.close() }))
    w.center(); NSApp.activate(ignoringOtherApps: true); w.makeKeyAndOrderFront(nil)
    win = w
    if let error { m.status = error; return }
    let cloudName = r.cloud?.provider.short ?? "the cloud"
    switch how {
    case .local: if let p = r.path { m.load(AVURLAsset(url: URL(fileURLWithPath: p))) }
    case .streamWithToken, .temporaryLink, .directLink:
      guard let s = stream else { m.status = "This cannot be played from \(cloudName) right now."; return }
      m.status = "Opening from \(cloudName)"
      m.onFailed = { [weak self, weak m] in   // streaming did not work: get the whole file first
        m?.onFailed = nil; m?.status = "Downloading from \(cloudName)"; self?.download(s, rec: r, sealKey: nil)
      }
      m.load(AVURLAsset(url: s.url, options: s.headers.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey": s.headers]))
    case .downloadFirst:
      guard let c = r.cloud else { return }
      let u = URL(fileURLWithPath: c.remoteId)
      m.status = "Getting it from \(cloudName)"
      try? FileManager.default.startDownloadingUbiquitousItem(at: u)
      waitForFile(u, tries: 60) { [weak m] ok in if ok { m?.load(AVURLAsset(url: u)) } else { m?.status = "It is not on this Mac yet. Open it in \(cloudName) first." } }
    case .downloadThenOpen:
      guard let s = stream, sealKey != nil else { m.status = "Sealed recordings play only on the Mac that sealed them, with its key."; return }
      m.status = "Downloading from \(cloudName)"
      download(s, rec: r, sealKey: sealKey)
    }
  }
  private func waitForFile(_ u: URL, tries: Int, _ done: @escaping (Bool) -> Void) {
    let st = try? u.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]).ubiquitousItemDownloadingStatus
    if FileManager.default.fileExists(atPath: u.path), st == nil || st == .current { done(true); return }
    if tries <= 0 { done(false); return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.waitForFile(u, tries: tries - 1, done) }
  }
  private func download(_ s: SRStream, rec r: SRRec, sealKey: Data?) {
    guard let m = model else { return }
    var req = URLRequest(url: s.url)
    for (k, v) in s.headers { req.setValue(v, forHTTPHeaderField: k) }
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("ps-screenrec-play-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    m.temps.append(dir)
    let encrypted = r.cloud?.encrypted ?? false
    let ext = r.audioOnly ? "m4a" : "mov"
    let t = URLSession(configuration: .ephemeral).downloadTask(with: req) { [weak self, weak m] tmp, resp, e in
      DispatchQueue.main.async {
        guard let self, let m, self.model === m else { return }
        guard let tmp, e == nil, (resp as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true else { m.status = "The download did not work. Try again later."; return }
        let got = dir.appendingPathComponent("download")
        try? FileManager.default.moveItem(at: tmp, to: got)
        if encrypted {
          guard let key = sealKey else { m.status = "PS cannot reach the key for this recording."; return }
          let out = dir.appendingPathComponent("play.\(ext)")
          do { try SRSeal.open(got, to: out, master: key) } catch { m.status = "This recording could not be opened with this Mac's key."; return }
          try? FileManager.default.removeItem(at: got)
          m.load(AVURLAsset(url: out))
        } else {
          let out = dir.appendingPathComponent("play.\(ext)"); try? FileManager.default.moveItem(at: got, to: out); m.load(AVURLAsset(url: out))
        }
      }
    }
    downloading = t; t.resume()
  }
  private func closeNow() { downloading?.cancel(); downloading = nil; model?.close(); model = nil; if let w = win { w.delegate = nil; w.close() }; win = nil }
  func windowWillClose(_ notification: Notification) { downloading?.cancel(); downloading = nil; model?.close(); model = nil; win = nil }
}

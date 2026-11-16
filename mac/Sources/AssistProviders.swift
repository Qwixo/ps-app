// The Settings assistant (PS 1.65), the real world: this Mac's Keychain, the person's own claude and codex programs, the
// network for an API key, Apple's on device model, and the bridge to the page. The rules are in AssistCore.swift and
// AssistProvidersCore.swift (tested with fakes). Nothing here ever runs on the main thread except taking a message and
// handing the answer back; every provider has a timeout; a test copy (PS_SELFTEST) never touches the Keychain, a program
// or the network.
//
// Keys: only this Mac's Keychain (service below, one item per provider), saved and removed here, never read back to the page,
// never in a log (every log line goes through AssistRedact), handed over to the next build like the AI task API key.
// Only the person's words and the settings list ever leave the Mac, and only to the provider they picked.
import Foundation
import Security
import WebKit
#if canImport(FoundationModels)
import FoundationModels
#endif

// MARK: - Keychain

final class AssistKeychain: AssistKeyStore {
  static let service = "com.cincee.ps.assist"
  private func base(_ p: AssistPick) -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: Self.service, kSecAttrAccount as String: "\(p.rawValue)-\(Remember.account)"]
  }
  func read(_ pick: AssistPick) -> String? {
    var q = base(pick); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard KeychainQuiet.run({ SecItemCopyMatching(q as CFDictionary, &out) }) == errSecSuccess, let d = out as? Data,
          let s = String(data: d, encoding: .utf8) else { return nil }
    return AssistKey.clean(s)
  }
  @discardableResult func write(_ pick: AssistPick, _ key: String) -> Bool {
    guard let k = AssistKey.clean(key), let d = k.data(using: .utf8) else { return false }
    if KeychainQuiet.run({ SecItemUpdate(base(pick) as CFDictionary, [kSecValueData as String: d] as CFDictionary) }) == errSecSuccess { return true }
    var q = base(pick)
    q[kSecValueData as String] = d
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    q[kSecAttrSynchronizable as String] = false
    q[kSecAttrLabel as String] = "PS Settings assistant key (this Mac only)"
    return KeychainQuiet.run { SecItemAdd(q as CFDictionary, nil) } == errSecSuccess
  }
  func remove(_ pick: AssistPick) { _ = KeychainQuiet.run { SecItemDelete(base(pick) as CFDictionary) } }
}

// MARK: - the network

struct AssistURLSession: AssistHTTP {
  func post(_ r: AssistHTTPRequest, timeout: TimeInterval) throws -> (status: Int, data: Data) {
    var req = URLRequest(url: r.url, timeoutInterval: timeout)
    req.httpMethod = "POST"
    req.httpBody = r.body
    for (k, v) in r.headers { req.setValue(v, forHTTPHeaderField: k) }
    let c = URLSessionConfiguration.ephemeral
    c.timeoutIntervalForRequest = timeout; c.timeoutIntervalForResource = timeout + 2
    c.httpCookieStorage = nil; c.urlCache = nil
    let s = URLSession(configuration: c)
    defer { s.finishTasksAndInvalidate() }
    let sem = DispatchSemaphore(value: 0)
    var out: (Int, Data)?
    var failed = false
    let t = s.dataTask(with: req) { d, resp, e in
      if let d, let h = resp as? HTTPURLResponse, e == nil { out = (h.statusCode, d) } else { failed = true }
      sem.signal()
    }
    t.resume()
    if sem.wait(timeout: .now() + timeout + 3) == .timedOut { t.cancel(); throw AssistFailure.timedOut }
    guard !failed, let o = out else { throw AssistFailure.failed }
    return (o.0, o.1)
  }
}

// MARK: - the person's own programs

final class AssistProcess: AssistExec {
  private let lock = NSLock()
  private var cache: [String: String?] = [:]
  private static let dirs: [String] = {
    let h = NSHomeDirectory()
    return ["\(h)/.local/bin", "\(h)/.claude/local", "\(h)/.npm-global/bin", "\(h)/.bun/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
  }()

  /// Known places first, then the person's own shell once (a Mac app has a bare PATH; node tools often sit in nvm or volta).
  func find(_ name: String) -> String? {
    lock.lock(); if let c = cache[name] { lock.unlock(); return c }; lock.unlock()
    var found: String?
    for d in Self.dirs where FileManager.default.isExecutableFile(atPath: d + "/" + name) { found = d + "/" + name; break }
    if found == nil, name == "claude" || name == "codex" {
      let r = try? run("/bin/zsh", args: ["-ilc", "command -v \(name)"], stdin: Data(), timeout: 6, cancel: AssistCancel())
      if let r, r.status == 0, let s = String(data: r.out, encoding: .utf8) {
        let last = s.split(separator: "\n").last.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
        if last.hasPrefix("/"), FileManager.default.isExecutableFile(atPath: last) { found = last }
      }
    }
    lock.lock(); cache[name] = found; lock.unlock()
    return found
  }
  /// Forget what was found (the person may have installed it since).
  func forget() { lock.lock(); cache = [:]; lock.unlock() }

  func run(_ exe: String, args: [String], stdin: Data, timeout: TimeInterval, cancel: AssistCancel) throws -> AssistExecResult {
    let work = FileManager.default.temporaryDirectory.appendingPathComponent("ps-assist-" + UUID().uuidString)
    try? FileManager.default.createDirectory(at: work, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: work) }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: exe)
    p.arguments = args
    p.currentDirectoryURL = work
    var env = ProcessInfo.processInfo.environment
    let extra = ([(exe as NSString).deletingLastPathComponent] + Self.dirs + ["/bin", "/usr/sbin", "/sbin"]).joined(separator: ":")
    env["PATH"] = extra + ":" + (env["PATH"] ?? "")
    env["NO_COLOR"] = "1"
    p.environment = env
    let inPipe = Pipe(), outPipe = Pipe()
    p.standardInput = inPipe; p.standardOutput = outPipe; p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { throw AssistFailure.unavailable("") }
    cancel.onCancel { if p.isRunning { p.terminate() } }
    DispatchQueue.global(qos: .utility).async { inPipe.fileHandleForWriting.write(stdin); try? inPipe.fileHandleForWriting.close() }
    let kill = DispatchWorkItem { if p.isRunning { p.terminate() } }
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout, execute: kill)
    var data = Data()
    while true {
      let chunk = outPipe.fileHandleForReading.availableData
      if chunk.isEmpty { break }
      if data.count < 1_000_000 { data.append(chunk) }
    }
    p.waitUntilExit()
    kill.cancel()
    return AssistExecResult(status: p.terminationStatus, out: data)
  }
}

// MARK: - Apple's on device model (macOS 26 and newer; PS still runs on macOS 13)

#if canImport(FoundationModels)
@available(macOS 26.0, *)
struct AssistFindArgs: Generable {
  var query: String
  static var generationSchema: GenerationSchema {
    GenerationSchema(type: AssistFindArgs.self, description: "What the person wants, in a few words",
                     properties: [GenerationSchema.Property(name: "query", description: "A few words to look for", type: String.self)])
  }
  var generatedContent: GeneratedContent { GeneratedContent(properties: ["query": query]) }
  init(_ content: GeneratedContent) throws { query = try content.value(String.self, forProperty: "query") }
}
@available(macOS 26.0, *)
struct AssistIdArgs: Generable {
  var settingId: String
  static var generationSchema: GenerationSchema {
    GenerationSchema(type: AssistIdArgs.self, description: "One setting id from findSettings",
                     properties: [GenerationSchema.Property(name: "settingId", description: "The id exactly as findSettings gave it", type: String.self)])
  }
  var generatedContent: GeneratedContent { GeneratedContent(properties: ["settingId": settingId]) }
  init(_ content: GeneratedContent) throws { settingId = try content.value(String.self, forProperty: "settingId") }
}
@available(macOS 26.0, *)
struct AssistFindTool: Tool {
  typealias Arguments = AssistFindArgs
  let name = "findSettings"
  let description = "Looks up PS settings that match some words. Returns up to six lines: id, where, name, what it does, allowed values."
  let request: AssistRequest
  func call(arguments: AssistFindArgs) async throws -> String { AssistApple.toolFind(arguments.query, request) }
}
@available(macOS 26.0, *)
struct AssistDetailsTool: Tool {
  typealias Arguments = AssistIdArgs
  let name = "settingDetails"
  let description = "Gives the allowed values of one setting by its id."
  let request: AssistRequest
  func call(arguments: AssistIdArgs) async throws -> String { AssistApple.toolDetails(arguments.settingId, request) }
}
#endif

struct AssistAppleProvider: AssistProvider {
  var via: AssistVia { .apple }
  var budget: TimeInterval { AssistBudget.apple }

  /// nil when ready, else the plain line why not. Quick; safe off the main thread.
  static func whyNot() -> String? {
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
      switch SystemLanguageModel.default.availability {
      case .available: return nil
      case .unavailable(let r):
        switch r {
        case .deviceNotEligible: return AssistApple.whyNot("deviceNotEligible")
        case .appleIntelligenceNotEnabled: return AssistApple.whyNot("appleIntelligenceNotEnabled")
        case .modelNotReady: return AssistApple.whyNot("modelNotReady")
        @unknown default: return AssistApple.whyNot(nil)
        }
      }
    }
    #endif
    return AssistApple.whyNot("oldMac")
  }

  func complete(_ r: AssistRequest, prompt: String, cancel: AssistCancel) throws -> String {
    if let why = Self.whyNot() { throw AssistFailure.unavailable(why) }
    #if canImport(FoundationModels)
    if #available(macOS 26.0, *) {
      let sem = DispatchSemaphore(value: 0)
      var text: String?
      let task = Task.detached {
        do {
          let session = LanguageModelSession(model: SystemLanguageModel.default,
                                             tools: [AssistFindTool(request: r), AssistDetailsTool(request: r)],
                                             instructions: AssistCore.appleInstructions)
          text = try await session.respond(to: AssistCore.applePrompt(r)).content
        } catch { text = nil }
        sem.signal()
      }
      cancel.onCancel { task.cancel(); sem.signal() }
      sem.wait()
      if cancel.isCancelled { throw AssistFailure.cancelled }
      guard let t = text else { throw AssistFailure.failed }
      return t
    }
    #endif
    throw AssistFailure.unavailable(AssistApple.whyNot("oldMac"))
  }
}

// MARK: - the service: messages in, answers out

final class AssistService {
  static let shared = AssistService()
  private let test = ProcessInfo.processInfo.environment["PS_SELFTEST"] != nil
  private let keys = AssistKeychain()
  private let proc = AssistProcess()
  private let http = AssistURLSession()
  private let work = DispatchQueue(label: "ps.assist.service", qos: .userInitiated)
  private let lock = NSLock()
  private var running: [String: AssistCancel] = [:]
  private struct WeakWeb { weak var web: WKWebView? }
  private var pages: [WeakWeb] = []
  private var lastTest: (AssistPick, Bool, String)?

  private static let pickKey = "assist.pick"
  private static func howKey(_ p: AssistPick) -> String { "assist.how." + p.rawValue }
  var pick: AssistPick { AssistPick(rawValue: UserDefaults.standard.string(forKey: Self.pickKey) ?? "") ?? .apple }
  private func how(_ p: AssistPick) -> AssistHow? { UserDefaults.standard.string(forKey: Self.howKey(p)).flatMap(AssistHow.init) }

  /// From main.swift's message switch. True when the message was the assistant's.
  @discardableResult func handle(_ type: String, _ msg: [String: Any], from web: WKWebView?) -> Bool {
    guard type.hasPrefix("assist:") else { return false }
    if let web, !pages.contains(where: { $0.web === web }) { pages.append(WeakWeb(web: web)) }
    pages.removeAll { $0.web == nil }
    switch type {
    case "assist:ask": ask(msg)
    case "assist:cancel":
      if let id = msg["id"] as? String { lock.lock(); let c = running.removeValue(forKey: id); lock.unlock(); c?.cancel() }
    case "assist:provider":
      guard let p = (msg["pick"] as? String).flatMap(AssistPick.init) else { return true }
      UserDefaults.standard.set(p.rawValue, forKey: Self.pickKey)
      if let h = (msg["how"] as? String).flatMap(AssistHow.init), p != .apple { UserDefaults.standard.set(h.rawValue, forKey: Self.howKey(p)) }
      psLog("PS assistant: provider \(p.rawValue)")
      sendStatus()
    case "assist:status":   // Settings opened: what is ready now
      sendStatus()
    case "assist:test":
      if let p = (msg["pick"] as? String).flatMap(AssistPick.init) { runTest(p) } else { sendStatus() }
    case "assist:key:set":
      keySet(msg)
    case "assist:key:remove":
      if let p = (msg["pick"] as? String).flatMap(AssistPick.init), p != .apple, !test { keys.remove(p); psLog("PS assistant: key removed (\(p.rawValue))") }
      sendStatus()
    case "assist:island":
      AssistIsland.shared.fromPage(msg)
    default: return false
    }
    return true
  }

  // MARK: keys (never echoed, never logged)

  private func keySet(_ msg: [String: Any]) {
    guard let p = (msg["pick"] as? String).flatMap(AssistPick.init), p != .apple else { return }
    guard let raw = msg["key"] as? String, let k = AssistKey.clean(raw) else { send(["type": "assist:status", "providers": [:], "pick": pick.rawValue, "tested": ["pick": p.rawValue, "ok": false, "line": AssistWords.badKey]]); return }
    work.async { [self] in
      let ok = !test && keys.write(p, k)
      psLog("PS assistant: key \(ok ? "saved" : "not saved") (\(p.rawValue))")
      lock.lock(); lastTest = (p, ok, ok ? AssistWords.keySaved : AssistWords.badKey); lock.unlock()
      sendStatus()
    }
  }

  // MARK: ask

  private func providers(for p: AssistPick) -> AssistProvider {
    switch p {
    case .apple: return AssistAppleProvider()
    case .claude:
      let cli = AssistClaudeCLIProvider(exec: proc), key = AssistKeyProvider(pick: .claude, keys: keys, http: http)
      return AssistChain(parts: how(.claude) == .key ? [key, cli] : [cli, key])
    case .chatgpt:
      let cli = AssistCodexCLIProvider(exec: proc, scratch: Self.scratch), key = AssistKeyProvider(pick: .chatgpt, keys: keys, http: http)
      return AssistChain(parts: how(.chatgpt) == .key ? [key, cli] : [cli, key])
    }
  }
  private static func scratch() -> (path: String, read: () -> Data?, cleanup: () -> Void) {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("ps-assist-out-" + UUID().uuidString)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let f = dir.appendingPathComponent("answer.txt")
    return (f.path, { try? Data(contentsOf: f) }, { try? FileManager.default.removeItem(at: dir) })
  }

  private func ask(_ msg: [String: Any]) {
    guard let r = AssistCore.parseAsk(msg) else {
      if let id = msg["id"] as? String { send(AssistCore.errorJSON(id: id, line: AssistWords.noReply)) }
      return
    }
    if test { send(AssistCore.answerJSON(id: r.id, AssistCore.simpleOutcome(note: nil))); return }
    let cancel = AssistCancel()
    lock.lock(); let old = running.updateValue(cancel, forKey: r.id); lock.unlock()
    old?.cancel()
    let p = pick
    var provs: [AssistPick: AssistProvider] = [.apple: AssistAppleProvider()]
    if p != .apple { provs[p] = providers(for: p) }
    psLog("PS assistant: ask via \(p.rawValue) (\(r.settings.count) settings)")   // never the person's words
    AssistRunner().run(r, pick: p, providers: provs, cancel: cancel) { [weak self] out in
      guard let self else { return }
      self.lock.lock(); let mine = self.running[r.id] === cancel; if mine { self.running[r.id] = nil }; self.lock.unlock()
      guard mine else { return }
      psLog("PS assistant: answered via \(out.via.rawValue)")
      self.send(AssistCore.answerJSON(id: r.id, out))
    }
  }

  // MARK: status and Test

  private func statuses() -> [AssistPick: AssistProviderStatus] {
    let apple = AssistAppleProvider.whyNot()
    var s: [AssistPick: AssistProviderStatus] = [.apple: AssistProviderStatus(ready: apple == nil, how: nil, why: apple)]
    s[.claude] = AssistStatus.claudeOrChatGPT(.claude, prefer: how(.claude), cliFound: proc.find("claude") != nil, keySaved: !test && keys.read(.claude) != nil)
    s[.chatgpt] = AssistStatus.claudeOrChatGPT(.chatgpt, prefer: how(.chatgpt), cliFound: proc.find("codex") != nil, keySaved: !test && keys.read(.chatgpt) != nil)
    return s
  }
  func sendStatus() {
    work.async { [self] in
      if test { send(AssistStatus.json([.apple: AssistProviderStatus(ready: false, how: nil, why: AssistWords.appleUnknown)], pick: pick)); return }
      proc.forget()
      lock.lock(); let t = lastTest; lastTest = nil; lock.unlock()
      send(AssistStatus.json(statuses(), pick: pick, tested: t))
    }
  }
  /// Test: one tiny made up question through the provider (a few words of the person's own account for Claude or ChatGPT).
  private func runTest(_ p: AssistPick) {
    guard !test else { sendStatus(); return }
    let r = AssistRequest(id: "test", text: "turn the test setting on", settings: [AssistSetting(id: "test", group: "Test", name: "Test setting", line: "Only for checking that the assistant works.", words: ["test"], allowed: ["true", "false"], can: .toggle)])
    let cancel = AssistCancel()
    let prov = providers(for: p)
    AssistRunner.attempt(prov, r, timeout: prov.budget, cancel: cancel) { [weak self] res in
      guard let self else { return }
      var line = AssistWords.testOK, ok = true
      if case .failure(let f) = res {
        ok = false
        switch f {
        case .unavailable(let l): line = l.isEmpty ? AssistWords.appleUnknown : l
        case .timedOut: line = AssistWords.tooSlow
        default: line = AssistWords.noReply
        }
      }
      self.lock.lock(); self.lastTest = (p, ok, line); self.lock.unlock()
      psLog("PS assistant: test \(p.rawValue) \(ok ? "ok" : "failed")")
      self.sendStatus()
    }
  }

  // MARK: to the page

  /// Anything for the page ("assist:answer", "assist:status", "assist:error", "assist:typed", "assist:action", "assist:closed"); main thread hop inside.
  func send(_ m: [String: Any]) {
    guard let d = try? JSONSerialization.data(withJSONObject: m), var s = String(data: d, encoding: .utf8) else { return }
    s = s.replacingOccurrences(of: "\u{2028}", with: "\\u2028").replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    let js = "window.__psAssist && window.__psAssist(\(s))"
    DispatchQueue.main.async { [self] in
      pages.removeAll { $0.web == nil }
      for p in pages { p.web?.evaluateJavaScript(js, completionHandler: nil) }
    }
  }

  // MARK: carried over to the next build (like the AI task API key)

  static func handoffCollect() -> [String: String]? {
    var o: [String: String] = [:]
    for p in [AssistPick.claude, .chatgpt] { if let k = shared.keys.read(p) { o[p.rawValue] = k } }
    return o.isEmpty ? nil : o
  }
  static func handoffSave(_ o: [String: String]?) {
    guard let o else { return }
    for p in [AssistPick.claude, .chatgpt] { if let k = o[p.rawValue].flatMap(AssistKey.clean) { shared.keys.write(p, k) } }
  }
}

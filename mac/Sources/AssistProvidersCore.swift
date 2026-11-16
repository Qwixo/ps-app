// The Settings assistant's providers, the logic that needs no real world (PS 1.65). The real Keychain, the real processes, the real
// network and Apple's model are in AssistProviders.swift and are handed in through the small protocols below, so
// tests/assist-test.sh runs every path with fakes: no real model, no real API, no Keychain.
//
// Claude: the person's own `claude` command (headless, no tools) or an Anthropic key. ChatGPT: the person's own `codex`
// command or an OpenAI key. Only the prompt (the person's words and the settings list) is ever sent.
import Foundation

// MARK: - keys

protocol AssistKeyStore: AnyObject {
  func read(_ pick: AssistPick) -> String?
  @discardableResult func write(_ pick: AssistPick, _ key: String) -> Bool
  func remove(_ pick: AssistPick)
}

enum AssistKey {
  /// A pasted key, cleaned (spaces and line ends around it go). Nil when it cannot be a key: too short or long, spaces
  /// inside, anything that is not plain printable letters, digits and the usual - _ . : characters.
  static func clean(_ raw: String) -> String? {
    let k = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard k.count >= 20, k.count <= 400 else { return nil }
    let ok = k.unicodeScalars.allSatisfy { ($0.value >= 48 && $0.value <= 57) || ($0.value >= 65 && $0.value <= 90) || ($0.value >= 97 && $0.value <= 122) || "-_.:".unicodeScalars.contains($0) }
    return ok ? k : nil
  }
}

// MARK: - the network (an API key)

struct AssistHTTPRequest: Equatable {
  var url: URL
  var headers: [String: String]
  var body: Data
}
protocol AssistHTTP {
  /// One blocking request. Throws on no network or a timeout.
  func post(_ r: AssistHTTPRequest, timeout: TimeInterval) throws -> (status: Int, data: Data)
}

enum AssistAPI {
  static let anthropicModel = "claude-haiku-4-5"
  static let openAIModel = "gpt-5-mini"
  static let system = "You turn a request into a JSON answer. Reply with the JSON object only."

  static func request(_ pick: AssistPick, key: String, prompt: String) -> AssistHTTPRequest? {
    switch pick {
    case .claude:
      let body: [String: Any] = ["model": anthropicModel, "max_tokens": 700, "system": system,
                                 "messages": [["role": "user", "content": prompt]]]
      guard let d = try? JSONSerialization.data(withJSONObject: body), let u = URL(string: "https://api.anthropic.com/v1/messages") else { return nil }
      return AssistHTTPRequest(url: u, headers: ["x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"], body: d)
    case .chatgpt:
      let body: [String: Any] = ["model": openAIModel, "response_format": ["type": "json_object"],
                                 "messages": [["role": "system", "content": system], ["role": "user", "content": prompt]]]
      guard let d = try? JSONSerialization.data(withJSONObject: body), let u = URL(string: "https://api.openai.com/v1/chat/completions") else { return nil }
      return AssistHTTPRequest(url: u, headers: ["authorization": "Bearer " + key, "content-type": "application/json"], body: d)
    case .apple: return nil
    }
  }
}

/// Claude (Anthropic key) or ChatGPT (OpenAI key).
struct AssistKeyProvider: AssistProvider {
  var pick: AssistPick
  var keys: AssistKeyStore
  var http: AssistHTTP
  var timeout: TimeInterval = 22
  var budget: TimeInterval { timeout + 3 }
  var via: AssistVia { pick == .claude ? .claude : .chatgpt }

  func complete(_ r: AssistRequest, prompt: String, cancel: AssistCancel) throws -> String {
    guard let key = keys.read(pick) else { throw AssistFailure.unavailable(AssistWords.noKey) }
    guard let req = AssistAPI.request(pick, key: key, prompt: prompt) else { throw AssistFailure.failed }
    let res: (status: Int, data: Data)
    do { res = try http.post(req, timeout: timeout) } catch { throw AssistFailure.unavailable(AssistWords.offline) }
    if cancel.isCancelled { throw AssistFailure.cancelled }
    if res.status == 401 || res.status == 403 { throw AssistFailure.unavailable(AssistWords.keyRejected) }
    guard (200..<300).contains(res.status) else { throw AssistFailure.failed }
    let text = pick == .claude ? AssistCore.anthropicText(res.data) : AssistCore.openAIText(res.data)
    guard let t = text else { throw AssistFailure.failed }
    return t
  }
}

// MARK: - the person's own command line tools

struct AssistExecResult: Equatable { var status: Int32; var out: Data }
protocol AssistExec {
  /// Runs a program with the prompt on its standard input, in an empty folder, killing it at the timeout or on cancel.
  func run(_ exe: String, args: [String], stdin: Data, timeout: TimeInterval, cancel: AssistCancel) throws -> AssistExecResult
  /// Where a command lives on this Mac ("claude", "codex"), or nil.
  func find(_ name: String) -> String?
}

enum AssistCLI {
  /// Headless, one answer, no tools, no MCP, no saved session, no skills, a small fast model, our own short system prompt in place of
  /// Claude Code's (which would add the folder and the machine), and only the settings of the empty folder it runs in (so no project
  /// or personal setup is read). The prompt goes in on stdin (never on the command line, where other programs could see it).
  static let claudeArgs = ["-p", "--output-format", "json", "--model", "haiku", "--system-prompt", AssistAPI.system, "--setting-sources", "local",
                           "--tools", "", "--no-session-persistence", "--disable-slash-commands", "--strict-mcp-config"]
  /// Non interactive, read only, nothing saved; the last message goes to a file we read back. The prompt comes in on stdin ("-").
  static func codexArgs(out: String) -> [String] {
    ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "--color", "never", "--output-last-message", out, "-"]
  }
}

struct AssistClaudeCLIProvider: AssistProvider {
  var exec: AssistExec
  var timeout: TimeInterval = 40
  var budget: TimeInterval { timeout + 5 }
  var via: AssistVia { .claude }
  func complete(_ r: AssistRequest, prompt: String, cancel: AssistCancel) throws -> String {
    guard let exe = exec.find("claude") else { throw AssistFailure.unavailable(AssistWords.cliMissingClaude) }
    let res = try exec.run(exe, args: AssistCLI.claudeArgs, stdin: Data(prompt.utf8), timeout: timeout, cancel: cancel)
    if cancel.isCancelled { throw AssistFailure.cancelled }
    guard res.status == 0, let t = AssistCore.claudeCLIText(res.out) else { throw AssistFailure.failed }
    return t
  }
}

struct AssistCodexCLIProvider: AssistProvider {
  var exec: AssistExec
  /// A fresh file in a private folder for the answer, and a way to read and delete it (a fake in tests).
  var scratch: () -> (path: String, read: () -> Data?, cleanup: () -> Void)
  var timeout: TimeInterval = 40
  var budget: TimeInterval { timeout + 5 }
  var via: AssistVia { .chatgpt }
  func complete(_ r: AssistRequest, prompt: String, cancel: AssistCancel) throws -> String {
    guard let exe = exec.find("codex") else { throw AssistFailure.unavailable(AssistWords.cliMissingCodex) }
    let s = scratch()
    defer { s.cleanup() }
    let res = try exec.run(exe, args: AssistCLI.codexArgs(out: s.path), stdin: Data(prompt.utf8), timeout: timeout, cancel: cancel)
    if cancel.isCancelled { throw AssistFailure.cancelled }
    guard res.status == 0 else { throw AssistFailure.failed }
    if let d = s.read(), let t = String(data: d, encoding: .utf8), !t.isEmpty { return t }
    if let t = String(data: res.out, encoding: .utf8), AssistCore.firstJSONObject(t) != nil { return t }
    throw AssistFailure.failed
  }
}

// MARK: - Apple's on device model: the tools it may call, and the words for "not available"

enum AssistApple {
  /// Why the model cannot run, as the three words FoundationModels uses, to one plain line.
  static func whyNot(_ reason: String?) -> String {
    switch reason {
    case "oldMac": return AssistWords.appleOldMac
    case "deviceNotEligible": return AssistWords.appleNotEligible
    case "appleIntelligenceNotEnabled": return AssistWords.appleOff
    case "modelNotReady": return AssistWords.appleNotReady
    default: return AssistWords.appleUnknown
    }
  }
  /// What a tool call hands back to the model: only entries from the page's list. Nothing else is ever returned.
  static func toolFind(_ query: String, _ r: AssistRequest) -> String {
    let hits = AssistCore.find(query, in: r)
    return hits.isEmpty ? "No setting matches." : hits.map { AssistCore.describe($0) }.joined(separator: "\n")
  }
  static func toolDetails(_ id: String, _ r: AssistRequest) -> String {
    guard let s = r.settings.first(where: { $0.id == id }) else { return "No such setting." }
    return AssistCore.describe(s)
  }
}

// MARK: - what the page sees about each provider (never a key)

struct AssistProviderStatus: Equatable {
  var ready: Bool
  var how: AssistHow?
  var why: String?
}

enum AssistStatus {
  /// {apple:{ready,why?}, claude:{ready,how?,why?}, chatgpt:{...}}. A key counts as ready when one is saved; the person's
  /// own command when it is found. `prefer` is the saved way ("cli" or "key"); the other way is the backup.
  static func claudeOrChatGPT(_ pick: AssistPick, prefer: AssistHow?, cliFound: Bool, keySaved: Bool) -> AssistProviderStatus {
    let order: [AssistHow] = prefer == .key ? [.key, .cli] : [.cli, .key]
    for h in order { if (h == .cli && cliFound) || (h == .key && keySaved) { return AssistProviderStatus(ready: true, how: h, why: nil) } }
    let why = pick == .claude ? AssistWords.cliMissingClaude : AssistWords.cliMissingCodex
    return AssistProviderStatus(ready: false, how: prefer, why: why + " Or save a key.")
  }
  static func json(_ s: [AssistPick: AssistProviderStatus], pick: AssistPick, tested: (AssistPick, Bool, String)? = nil) -> [String: Any] {
    var provs: [String: Any] = [:]
    for (p, v) in s {
      var d: [String: Any] = ["ready": v.ready]
      if let h = v.how { d["how"] = h.rawValue }
      if let w = v.why { d["why"] = w }
      provs[p.rawValue] = d
    }
    var m: [String: Any] = ["type": "assist:status", "providers": provs, "pick": pick.rawValue]
    if let t = tested { m["tested"] = ["pick": t.0.rawValue, "ok": t.1, "line": t.2] }
    return m
  }
}

/// Tries each way in turn; a way that is not there (no key, no command, offline) hands over to the next, a way that ran
/// and failed or ran out of time does not (the run's fallback takes over).
struct AssistChain: AssistProvider {
  var parts: [AssistProvider]
  var via: AssistVia { parts.first?.via ?? .simple }
  /// Only a way that is not there hands over, and that is quick, so the longest part sets the time.
  var budget: TimeInterval { parts.map(\.budget).max() ?? 25 }
  func complete(_ r: AssistRequest, prompt: String, cancel: AssistCancel) throws -> String {
    var first: AssistFailure = .failed
    for (i, p) in parts.enumerated() {
      do { return try p.complete(r, prompt: prompt, cancel: cancel) }
      catch let f as AssistFailure {
        if case .unavailable = f { if i == 0 { first = f }; continue }
        throw f
      }
    }
    throw first
  }
}

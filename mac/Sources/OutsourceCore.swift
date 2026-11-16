// Outsource work to your other computer (PS 1.65), the rules that need no app: what a job may be, the AI tool's own
// allow and deny flags, secrets stripped from logs, the pre-push hook, the command line's wire format and the pieces
// a bundle is sent in. Foundation only, so mac/tests/outsource-test.sh compiles this file alone.
// The page (web core/second.ts) already checked signatures and expiry. Everything here is a second look, never the first.
import Foundation

/// A job as the page hands it over (web core/secondbridge.ts PlainJob).
struct OutJob: Equatable {
  var id: String
  var title: String
  var repo: String
  var base: String
  var prompt: String
  var bundle: Bool
  var report: Bool
  var screenshots: Bool
  var minutes: Int
  var tool: String          // "claude" or "codex"
  var createdAt: Double     // epoch ms
  var expiresAt: Double     // epoch ms

  static let maxPrompt = 60_000
  static let maxMinutes = 120

  /// Why the job is refused, or nil when it may run. `now` is epoch ms.
  static func parse(_ o: [String: Any], now: Double) -> (OutJob?, String?) {
    func s(_ k: String) -> String { (o[k] as? String) ?? "" }
    let id = s("id"), title = s("title"), repo = s("repo"), base = s("base"), prompt = s("prompt")
    guard OutSafe.idOk(id) else { return (nil, "bad id") }
    guard !title.isEmpty, title.count <= 200 else { return (nil, "bad title") }
    guard OutSafe.repoOk(repo) else { return (nil, "bad repo") }
    guard OutSafe.baseOk(base) else { return (nil, "bad base") }
    guard !prompt.isEmpty, prompt.utf8.count <= maxPrompt else { return (nil, "bad prompt") }
    if OutSecrets.looksSecret(prompt) || OutSecrets.looksSecret(title) { return (nil, "secret in job") }
    let tool = s("tool")
    guard tool == "claude" || tool == "codex" else { return (nil, "bad tool") }
    let exp = (o["expiresAt"] as? NSNumber)?.doubleValue ?? 0
    guard exp > now else { return (nil, "expired") }
    let ret = o["returns"] as? [String: Any] ?? [:]
    let mins = min(maxMinutes, max(1, (o["minutes"] as? NSNumber)?.intValue ?? 20))
    return (OutJob(id: id, title: title, repo: repo, base: base, prompt: prompt,
                   bundle: (ret["bundle"] as? Bool) ?? true, report: (ret["report"] as? Bool) ?? true,
                   screenshots: (ret["screenshots"] as? Bool) ?? false, minutes: mins, tool: tool,
                   createdAt: (o["createdAt"] as? NSNumber)?.doubleValue ?? 0, expiresAt: exp), nil)
  }
}

enum OutSafe {
  /// Letters, digits, dash, underscore, 4 to 64. The id becomes a folder and a branch name.
  static func idOk(_ s: String) -> Bool {
    s.count >= 4 && s.count <= 64 && s.unicodeScalars.allSatisfy { ($0.value < 128) && (CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_") }
  }
  /// A folder name (no slash, no dots only) or a git URL without credentials. Never file:// or ext:: (git runs commands for ext::).
  static func repoOk(_ s: String) -> Bool {
    guard !s.isEmpty, s.count <= 300, !s.contains(" "), !s.contains("\n"), s.unicodeScalars.allSatisfy({ $0.value > 32 && $0.value < 127 }) else { return false }
    if folderName(s) { return true }
    if s.hasPrefix("https://") {
      guard let u = URL(string: s), let h = u.host, !h.isEmpty, u.user == nil, u.password == nil, u.query == nil else { return false }
      return !s.contains("@")
    }
    if s.hasPrefix("ssh://git@") { return !s.dropFirst(10).contains("@") }
    if s.hasPrefix("git@") { return s.dropFirst(4).contains(":") && !s.dropFirst(4).contains("@") && !s.contains("::") }
    return false
  }
  static func folderName(_ s: String) -> Bool {
    !s.isEmpty && s.count <= 100 && !s.hasPrefix(".") && !s.hasPrefix("-") && !s.contains("..") &&
      s.unicodeScalars.allSatisfy { $0.value < 128 && (CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" || $0 == ".") }
  }
  /// A commit hash (4 to 40 hex) or a branch name of safe characters. Never starts with a dash.
  static func baseOk(_ s: String) -> Bool {
    guard !s.isEmpty, s.count <= 100, !s.hasPrefix("-"), !s.hasPrefix("/"), !s.contains(".."), !s.hasSuffix("/"), !s.hasSuffix(".lock") else { return false }
    return s.unicodeScalars.allSatisfy { $0.value < 128 && (CharacterSet.alphanumerics.contains($0) || "-_./".unicodeScalars.contains($0)) }
  }
  /// The folder name a repo gets under the PS folder.
  static func cloneName(_ repo: String) -> String {
    if folderName(repo) { return repo }
    var last = repo.split(whereSeparator: { $0 == "/" || $0 == ":" }).last.map(String.init) ?? "repo"
    if last.hasSuffix(".git") { last.removeLast(4) }
    let clean = String(last.unicodeScalars.filter { $0.value < 128 && (CharacterSet.alphanumerics.contains($0) || $0 == "-" || $0 == "_" || $0 == ".") }.map(Character.init))
    var h: UInt32 = 5381
    for b in repo.utf8 { h = (h &* 33) &+ UInt32(b) }   // two repos with one last name stay apart
    return (clean.isEmpty || clean.hasPrefix(".") ? "repo" : clean) + "-" + String(h, radix: 16)
  }
}

enum OutSecrets {
  private static let patterns: [String] = [
    #"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)"#,
    #"\bsk-[A-Za-z0-9_-]{16,}"#, #"\bsb_secret_[A-Za-z0-9_-]{8,}"#, #"\bghp_[A-Za-z0-9]{20,}"#, #"\bgithub_pat_[A-Za-z0-9_]{20,}"#,
    #"\bgh[osu]_[A-Za-z0-9]{20,}"#, #"\bAKIA[0-9A-Z]{12,}"#, #"\bxox[abprs]-[A-Za-z0-9-]{10,}"#,
    #"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\.?[A-Za-z0-9_-]*"#,
    #"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{16,}"#,
    #"(?i)\b[A-Za-z0-9_]*(password|passwd|secret|token|api[_-]?key|apikey|auth)[A-Za-z0-9_]*\s*[=:]\s*["']?[^\s"',;]{6,}"#,
    #"(?i)https?://[^\s/:@]+:[^\s/@]+@"#,
  ]
  private static let regexes: [NSRegularExpression] = patterns.compactMap { try? NSRegularExpression(pattern: $0) }

  static func looksSecret(_ s: String) -> Bool {
    let r = NSRange(s.startIndex..., in: s)
    return regexes.contains { $0.firstMatch(in: s, range: r) != nil }
  }
  /// Every secret looking piece replaced; the rest stays. Also the home folder name, so a log never carries a person's name.
  static func strip(_ s: String, home: String? = NSHomeDirectory()) -> String {
    var out = s
    for re in regexes {
      out = re.stringByReplacingMatches(in: out, range: NSRange(out.startIndex..., in: out), withTemplate: "[removed]")
    }
    if let h = home, h.count > 3 { out = out.replacingOccurrences(of: h, with: "~") }
    return out
  }
  /// The last `n` characters, cut at a line start, then stripped. Logs are never longer than this in a report.
  static func tail(_ s: String, _ n: Int = 6000) -> String {
    var t = s
    if t.count > n {
      t = String(t.suffix(n))
      if let i = t.firstIndex(of: "\n") { t = String(t[t.index(after: i)...]) }
    }
    return strip(t)
  }
}

/// What the AI tool may and may not do. The flags are each CLI's own; the pre-push hook, a push URL that goes nowhere
/// and a PATH with refusing stand ins are the second and third wall.
enum OutPolicy {
  static let denyBash = ["git push", "git remote", "gh", "hub", "vercel", "netlify", "wrangler", "firebase", "fly", "flyctl", "heroku",
                         "railway", "supabase", "aws", "gcloud", "az", "kubectl", "terraform", "pulumi", "scp", "rsync", "sftp",
                         "curl", "wget", "ssh", "sudo", "npm publish", "pnpm publish", "yarn publish", "twine", "docker push",
                         "security", "osascript", "open"]
  /// Names a refusing stand in is made for (they sit first on the PATH the AI runs with).
  static let shimmed = ["gh", "hub", "vercel", "netlify", "wrangler", "firebase", "fly", "flyctl", "heroku", "railway", "supabase",
                        "aws", "gcloud", "kubectl", "terraform", "pulumi", "scp", "sftp", "ssh", "sudo", "security", "osascript", "twine"]
  static let envDrop = ["GH_TOKEN", "GITHUB_TOKEN", "GITHUB_PAT", "NPM_TOKEN", "NODE_AUTH_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY",
                        "AWS_SESSION_TOKEN", "VERCEL_TOKEN", "NETLIFY_AUTH_TOKEN", "CLOUDFLARE_API_TOKEN", "FLY_API_TOKEN", "SSH_AUTH_SOCK",
                        "SUPABASE_ACCESS_TOKEN", "GOOGLE_APPLICATION_CREDENTIALS", "HEROKU_API_KEY", "DOCKER_CONFIG", "GIT_ASKPASS", "SSH_ASKPASS"]

  static func claudeArgs(prompt: String) -> [String] {
    var a = ["-p", prompt, "--permission-mode", "acceptEdits", "--output-format", "text",
             "--allowedTools", "Read", "Edit", "Write", "Glob", "Grep", "Bash"]
    a.append("--disallowedTools")
    for d in denyBash { a.append("Bash(\(d):*)") }
    a += ["WebFetch", "WebSearch"]
    return a
  }
  /// Codex: workspace-write keeps the network off and the writes inside the folder; never asks, never the full access mode.
  static func codexArgs(prompt: String, dir: String, lastMessage: String) -> [String] {
    ["exec", "-C", dir, "-s", "workspace-write", "-o", lastMessage, prompt]
  }
  static let prePushHook = "#!/bin/sh\necho \"PS: pushing is refused on this computer (outsourced work never pushes).\" >&2\nexit 1\n"
  static func shim(_ name: String) -> String { "#!/bin/sh\necho \"PS: \(name) is refused on this computer (outsourced work only edits and tests).\" >&2\nexit 126\n" }
  static let noPushURL = "refused://this-computer-never-pushes"

  /// The environment the AI runs with: this computer's own, minus tokens, with the stand ins first on PATH.
  static func env(base: [String: String], shimDir: String, hooksDir: String, home: String) -> [String: String] {
    var e = base
    for k in envDrop { e.removeValue(forKey: k) }
    for k in e.keys where k.hasPrefix("GIT_CONFIG") || k == "GIT_DIR" || k == "GIT_WORK_TREE" { e.removeValue(forKey: k) }
    let path = e["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
    e["PATH"] = shimDir + ":" + path
    e["HOME"] = home
    e["GIT_TERMINAL_PROMPT"] = "0"
    e["GIT_CONFIG_COUNT"] = "2"
    e["GIT_CONFIG_KEY_0"] = "core.hooksPath"; e["GIT_CONFIG_VALUE_0"] = hooksDir
    e["GIT_CONFIG_KEY_1"] = "push.default"; e["GIT_CONFIG_VALUE_1"] = "nothing"
    e["CI"] = "1"
    return e
  }

  /// The prompt the tool gets: the job's own, then the house rules (it cannot push) and where to put screenshots.
  static func fullPrompt(_ j: OutJob) -> String {
    var p = j.prompt + "\n\n---\nRules of this computer: work only inside this folder, commit your work on the current branch with clear messages, never push, deploy or send anything, and finish with a short summary of what you changed and which tests you ran."
    if j.screenshots { p += " Save any screenshots as PNG files in .ps-outsource/shots/." }
    return p
  }
}

/// The report the page seals and sends back.
struct OutReport {
  var id: String
  var title: String
  var state: String          // done, failed, cancelled, timeout
  var tool: String
  var branch: String
  var base: String
  var head: String
  var commits: Int
  var files: [String]        // "path | 3 +-" lines from git diff --stat, short
  var summary: String        // the AI's own words, stripped
  var log: String            // the tail of what it printed, stripped
  var exit: Int32
  var seconds: Int
  var note: String
  func json() -> String {
    let d: [String: Any] = ["id": id, "title": title, "state": state, "tool": tool, "branch": branch, "base": base, "head": head,
                            "commits": commits, "files": files, "summary": summary, "log": log, "exit": Int(exit), "seconds": seconds, "note": note]
    let data = (try? JSONSerialization.data(withJSONObject: d, options: [.sortedKeys])) ?? Data("{}".utf8)
    return String(data: data, encoding: .utf8) ?? "{}"
  }
}

/// The command line's wire format: one JSON line in, one JSON line out, over a socket only this person can open.
enum OutCli {
  static let maxLine = 200_000
  static let cmds = ["status", "send", "list", "result", "cancel", "restart"]
  /// A request line to the cmd the page expects (web CliRequest), or nil.
  static func parse(_ line: String) -> [String: Any]? {
    guard line.utf8.count <= maxLine, let d = line.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
          let cmd = o["cmd"] as? String, cmds.contains(cmd) else { return nil }
    var out: [String: Any] = ["cmd": cmd]
    func str(_ k: String, max: Int) -> Bool { guard let v = o[k] as? String, !v.isEmpty, v.utf8.count <= max else { return false }; out[k] = v; return true }
    switch cmd {
    case "send":
      guard str("title", max: 200), str("repo", max: 300), str("base", max: 100), str("prompt", max: OutJob.maxPrompt) else { return nil }
      guard OutSafe.repoOk(out["repo"] as! String), OutSafe.baseOk(out["base"] as! String) else { return nil }
      if let b = o["bundle"] as? Bool { out["bundle"] = b }
      if let b = o["screenshots"] as? Bool { out["screenshots"] = b }
      if let m = o["minutes"] as? Int { guard m >= 1 && m <= OutJob.maxMinutes else { return nil }; out["minutes"] = m }
      if let t = o["tool"] as? String { guard t == "claude" || t == "codex" else { return nil }; out["tool"] = t }
    case "result", "cancel":
      guard str("id", max: 64), OutSafe.idOk(out["id"] as! String) else { return nil }
    default: break
    }
    return out
  }
  static func answer(ok: Bool, text: String, id: String?) -> String {
    var d: [String: Any] = ["ok": ok, "text": String(text.prefix(20_000))]
    if let id { d["id"] = id }
    return String(data: (try? JSONSerialization.data(withJSONObject: d)) ?? Data("{}".utf8), encoding: .utf8) ?? "{}"
  }
}

enum OutChunks {
  static let size = 192 * 1024   // web BRIDGE_CHUNK
  static func count(_ bytes: Int) -> Int { max(1, (bytes + size - 1) / size) }
}

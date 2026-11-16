// Auto approve, the pure part (the developer's friend, 12 Nov 2026: "whenever there is anything asking for permission in
// terminal, the ai mode should auto enable this ... when it asks questions though, it shouldnt auto select answers").
// Foundation only, no AppKit, so tests/autoapprove-test.sh can build it alone. AutoApprove.swift runs it.
//
// When it is on (ApproveCore.active): in AI mode (Sentry mode) with its switch on, in Sleep mode with its switch on, or
// always with "Always auto approve" on. PS 1.65 (the developer's friend, 17 Nov 2026): "In AI mode" and "In Sleep mode" start ON
// for a person who never chose them, "Always" stays off; a saved choice (on or off) is never changed (ApproveCore.resolve).
//
// Two routes, in this order:
// 1. The AI tool's own hook, no keys pressed. While any switch is on, PS keeps one line in ~/.claude/settings.json
//    (hooks.PermissionRequest) and, when Codex is on this Mac, in ~/.codex/hooks.json, that runs
//    ~/Library/PS/auto-approve/hook.sh. The script answers "allow" only while PS holds a fresh lease
//    (~/Library/PS/auto-approve/active, an end time PS moves on every 30 seconds while Auto approve is on). No lease,
//    or an old one (the mode ended, PS closed or crashed): the script says nothing and the prompt shows as usual.
//    Claude Code reads hook edits live, and (read in Claude Code 2.1.278's own code) runs PermissionRequest hooks for
//    every prompt that reaches its permission dialog, including one raised by another hook's "ask" (the friend's
//    "Hook tool.check requires confirmation" prompt). Questions (AskUserQuestion) and plan approvals (ExitPlanMode)
//    are never answered: the script lets them through to the person, and Claude Code itself ignores an allow for a
//    tool that needs the person.
// 2. Keys, for prompts the hook cannot reach (a chat started before the line was added, another tool): PS reads the
//    text of terminal windows, and only when it is clearly a yes or no permission prompt with Yes selected, presses
//    Return in that window (classify below). A question, a free text answer, or text PS cannot read: nothing.
// Off (every switch off) takes out exactly the lines PS added (found by the script's path), the script and the lease.
// Before every change a copy of the file as it was is kept beside it (<file>.ps-auto-approve-backup), the write is
// atomic, and a file PS cannot read (comments, a typo) is never rewritten.
import Foundation

/// Where everything lives, from one home folder (a temp folder in the tests).
struct ApprovePaths {
  let home: URL
  var dir: URL { home.appendingPathComponent("Library/PS/auto-approve") }
  var hook: URL { dir.appendingPathComponent("hook.sh") }
  var lease: URL { dir.appendingPathComponent("active") }
  var inbox: URL { dir.appendingPathComponent("inbox") }
  var state: URL { dir.appendingPathComponent("state.json") }
  var claudeSettings: URL { home.appendingPathComponent(".claude/settings.json") }
  var codexHooks: URL { home.appendingPathComponent(".codex/hooks.json") }
  var claudeDir: URL { home.appendingPathComponent(".claude") }
  var codexDir: URL { home.appendingPathComponent(".codex") }
  /// The command line that runs the script for a tool (the path quoted for the shell the tools run it with).
  func command(_ tool: String) -> String { "/bin/sh '\(hook.path.replacingOccurrences(of: "'", with: "'\\''"))' \(tool)" }
}

enum ApproveCore {
  /// What marks a line PS added: the script's place, which nothing else uses (AI chat cards use ai-done/hook.sh).
  static let marker = "/Library/PS/auto-approve/hook.sh"
  static let backupSuffix = ".ps-auto-approve-backup"
  static let event = "PermissionRequest"

  // MARK: - when it is on

  /// The three switches in Settings. PS 1.65: AI mode and Sleep mode are on until the person chooses, Always is off.
  struct Switches: Equatable {
    var ai = false, sleep = false, always = false
    var any: Bool { ai || sleep || always }
  }
  /// The defaults for a switch the person never chose (never both "Always" and nothing: it stays off).
  static let defaultAi = true, defaultSleep = true, defaultAlways = false
  /// What is saved on this Mac for each switch (nil: never chosen). A saved on or off always wins.
  struct Saved: Equatable { var ai: Bool?, sleep: Bool?, always: Bool? }
  /// `defaults` false is the feature switch "auto-approve-defaults" off: an unset switch is off, as before 1.65.
  static func resolve(_ s: Saved, defaults: Bool = true) -> Switches {
    Switches(ai: s.ai ?? (defaults && defaultAi), sleep: s.sleep ?? (defaults && defaultSleep), always: s.always ?? defaultAlways)
  }
  /// A default is still standing for AI mode or Sleep mode (the 1.65 notice asks about these once).
  static func defaulted(_ s: Saved) -> Bool { s.ai == nil || s.sleep == nil }
  /// What the Mac is doing now.
  struct Modes: Equatable { var ai = false, sleep = false }

  /// Why Auto approve is on right now, or nil when it is off.
  static func why(_ s: Switches, _ m: Modes) -> String? {
    if s.always { return "Always" }
    if s.ai && m.ai { return "AI mode" }
    if s.sleep && m.sleep { return "Sleep mode" }
    return nil
  }
  static func active(_ s: Switches, _ m: Modes) -> Bool { why(s, m) != nil }
  /// The hook line stays in the tools' settings while any switch is on, so a chat started now is covered the moment a
  /// mode begins (the lease, not the line, says yes or no).
  static func armed(_ s: Switches) -> Bool { s.any }

  /// How long a lease lasts, and how often PS moves it on while Auto approve is on.
  static let leaseSeconds: TimeInterval = 120
  static let leaseEvery: TimeInterval = 30
  static func leaseText(now: Date) -> String { "\(Int(now.timeIntervalSince1970 + leaseSeconds))\n" }
  /// The script's own test, in Swift: digits only, and now before that end time.
  static func leaseLive(_ text: String?, now: Date) -> Bool {
    guard let text else { return false }
    let digits = String(text.filter(\.isNumber).prefix(12))
    guard let until = Double(digits) else { return false }
    return now.timeIntervalSince1970 < until
  }

  // MARK: - the script

  /// Tools that never get an answer from the script: they ask the person something.
  static let questionTools = ["AskUserQuestion", "ExitPlanMode"]

  /// The hook script. POSIX sh and macOS's own plutil only (a friend's Mac may have no node or python).
  static func hookScript() -> String {
    #"""
    #!/bin/sh
    # Added by PS (Settings, Sentry mode, Auto approve). Answers Yes to an AI tool's permission prompt, only while
    # PS says Auto approve is on (a fresh time in ~/Library/PS/auto-approve/active). Otherwise it says nothing and
    # the prompt shows as usual. Questions and plan approvals are never answered: they wait for you.
    # For PS's log it keeps the tool's name and the command or file, in a file only you can read, which PS shortens
    # and deletes. Nothing is sent anywhere. Switching every Auto approve setting off in PS removes this file and the
    # line that runs it.
    tool="$1"
    case "$tool" in claude|codex) ;; *) exit 0 ;; esac
    d="$HOME/Library/PS/auto-approve"
    [ -f "$d/active" ] || exit 0
    until="$(tr -cd '0-9' < "$d/active" | head -c 12)"
    [ -n "$until" ] || exit 0
    [ "$(date +%s)" -lt "$until" ] || exit 0
    raw="$(cat)"
    get() { printf '%s' "$raw" | /usr/bin/plutil -extract "$1" raw -o - - 2>/dev/null | tr -d '\r\n' | head -c 400; }
    [ "$(get hook_event_name)" = PermissionRequest ] || exit 0
    name="$(get tool_name)"
    case "$name" in ""|AskUserQuestion|ExitPlanMode|*Question*|*question*) exit 0 ;; esac
    if [ -d "$d/inbox" ]; then
      umask 077
      now="$(date +%s)"; f="$d/inbox/.$tool.$$.tmp"
      { printf 'tool=%s\n' "$tool"; printf 'name=%s\n' "$name"
        printf 'what=%s\n' "$(get tool_input.command)$(get tool_input.file_path)$(get tool_input.url)"
        printf 'cwd=%s\n' "$(get cwd)"; printf 'at=%s\n' "$now"; } > "$f" \
        && mv -f "$f" "$d/inbox/$tool.$now.$$.drop"
    fi
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'
    exit 0

    """#
  }

  // MARK: - JSON settings (Claude Code settings.json, Codex hooks.json)

  static func entry(_ tool: String, _ p: ApprovePaths) -> [String: Any] { ["type": "command", "command": p.command(tool), "timeout": 10] }
  static func isOurs(_ v: Any) -> Bool { ((v as? [String: Any])?["command"] as? String)?.contains(marker) == true }

  /// Parses a settings file: nil text (no file) is an empty object; anything that is not a JSON object is nil
  /// (comments, a typo): PS then leaves the file alone.
  static func parseObject(_ text: String?) -> [String: Any]? {
    guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [:] }
    return (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any]
  }
  static func render(_ o: [String: Any]) -> String {
    let d = (try? JSONSerialization.data(withJSONObject: o, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])) ?? Data("{}".utf8)
    return String(decoding: d, as: UTF8.self) + "\n"
  }

  /// True when the settings already run PS's script on PermissionRequest.
  static func hasOurs(_ o: [String: Any]) -> Bool {
    let hooks = o["hooks"] as? [String: Any] ?? [:]
    return (hooks[event] as? [Any] ?? []).contains { (($0 as? [String: Any])?["hooks"] as? [Any] ?? []).contains(where: isOurs) }
  }

  /// The settings with PS's line added at the end of PermissionRequest's list (no matcher: every tool, the script
  /// itself skips the questions). Everything else stays as it was.
  static func adding(_ o: [String: Any], tool: String, _ p: ApprovePaths) -> [String: Any] {
    if hasOurs(o) { return o }
    var o = o
    var hooks = o["hooks"] as? [String: Any] ?? [:]
    var list = hooks[event] as? [Any] ?? []
    list.append(["hooks": [entry(tool, p)]])
    hooks[event] = list
    o["hooks"] = hooks
    return o
  }

  /// The settings with every line PS's Auto approve added taken out (only those, in any event). A group or event list
  /// left empty by that goes too, and "hooks" when nothing is left in it.
  static func removing(_ o: [String: Any]) -> [String: Any] {
    guard var hooks = o["hooks"] as? [String: Any] else { return o }
    var changed = false
    for (ev, v) in hooks {
      guard let list = v as? [Any] else { continue }
      var out: [Any] = []
      var touched = false
      for item in list {
        if isOurs(item) { touched = true; continue }
        if var g = item as? [String: Any], let inner = g["hooks"] as? [Any], inner.contains(where: isOurs) {
          touched = true
          let kept = inner.filter { !isOurs($0) }
          if kept.isEmpty { continue }
          g["hooks"] = kept
          out.append(g)
          continue
        }
        out.append(item)
      }
      guard touched else { continue }
      changed = true
      if out.isEmpty { hooks.removeValue(forKey: ev) } else { hooks[ev] = out }
    }
    guard changed else { return o }
    var o = o
    if hooks.isEmpty { o.removeValue(forKey: "hooks") } else { o["hooks"] = hooks }
    return o
  }

  // MARK: - what the script left for the log

  struct Drop: Equatable { var tool: String; var name: String; var what: String; var cwd: String; var at: Date }
  static func parseDrop(_ text: String) -> Drop? {
    var f: [String: String] = [:]
    for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
      guard let eq = line.firstIndex(of: "=") else { continue }
      f[String(line[..<eq])] = String(line[line.index(after: eq)...])
    }
    guard let tool = f["tool"], tool == "claude" || tool == "codex", let name = f["name"], !name.isEmpty,
          let at = f["at"].flatMap(Double.init) else { return nil }
    return Drop(tool: tool, name: name, what: f["what"] ?? "", cwd: f["cwd"] ?? "", at: Date(timeIntervalSince1970: at))
  }

  /// A log line: which tool asked, what for (shortened, secrets taken out), and the folder's name only.
  static func logLine(_ d: Drop) -> [String: Any] {
    let app = d.tool == "codex" ? "Codex" : "Claude Code"
    let what = d.what.isEmpty ? d.name : "\(d.name): \(redact(d.what))"
    return ["at": d.at.timeIntervalSince1970, "app": app, "how": "hook", "what": what, "where": folderName(d.cwd)]
  }
  static func folderName(_ cwd: String) -> String {
    let parts = cwd.split(separator: "/").map(String.init)
    return String((parts.last ?? "").prefix(40))
  }

  /// A command or path made safe for a log a person reads: secrets out, at most 90 characters on one line.
  static func redact(_ s: String, max: Int = 90) -> String {
    var t = s.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\t", with: " ")
    let rules: [(String, String)] = [
      (#"(?i)\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}"#, "$1 …"),                                   // Authorization: Bearer xyz
      (#"(?i)([A-Za-z0-9_.-]*(?:key|token|secret|passw(?:or)?d|pwd|auth|credential|cookie|session)[A-Za-z0-9_.-]*)(\s*[=:]\s*|\s+)("[^"]*"|'[^']*'|[^\s"']+)"#, "$1$2…"),
      (#"(?i)(-{1,2}(?:p|password|token|key|secret|auth|api-key|apikey))(=|\s+)("[^"]*"|'[^']*'|[^\s"']+)"#, "$1$2…"),
      (#"://[^/\s:@]+:[^/\s@]+@"#, "://…@"),                                                                 // user:pass@host
      (#"\b[A-Z][A-Z0-9_]{2,}=("[^"]*"|'[^']*'|[^\s"']+)"#, "…="),                                           // ENV=value
      (#"\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abpr]|AKIA|eyJ)[A-Za-z0-9_\-]{6,}[A-Za-z0-9_\-.]*"#, "…"),  // known key shapes
      (#"[A-Za-z0-9+/_\-]{32,}={0,2}"#, "…"),                                                               // anything long and random
      (#"\?[^\s"']+"#, "?…"),                                                                                 // query strings
    ]
    for (pat, rep) in rules {
      guard let re = try? NSRegularExpression(pattern: pat) else { continue }
      t = re.stringByReplacingMatches(in: t, range: NSRange(t.startIndex..., in: t), withTemplate: rep)
    }
    t = t.split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
    if t.count > max { t = String(t.prefix(max - 1)) + "…" }
    return t
  }

  // MARK: - the key route: is this window showing a permission prompt?

  enum Verdict: Equatable {
    /// A yes or no permission prompt with Yes (option 1) selected: Return approves it. `key` identifies this prompt
    /// (its question and options) so the same one is pressed once; `what` is a short, safe line for the log.
    case approve(key: String, what: String)
    /// A menu that asks the person something (AskUserQuestion, a plan, a trust prompt, any other choice): wait.
    case question
    /// Looks like a permission prompt, but PS is not sure enough to press anything (say why, for the log).
    case unsure(String)
    case none
  }

  /// Selection marks the tools draw in front of the chosen option.
  static let marks: Set<Character> = ["❯", "›", ">", "●", "▶", "➤", "→", "▸", "»"]
  /// Characters that only draw boxes round a prompt.
  static let boxChars = CharacterSet(charactersIn: "│┃║|╭╮╰╯┌┐└┘─━═╌╍┄┅┈┉ ")

  /// A line with the box drawing at its ends taken off.
  static func clean(_ line: Substring) -> String {
    var s = String(line).trimmingCharacters(in: .whitespaces)
    while let f = s.unicodeScalars.first, boxChars.contains(f), s.count > 0 { s.removeFirst(); s = s.trimmingCharacters(in: .whitespaces) }
    while let l = s.unicodeScalars.last, boxChars.contains(l), s.count > 0 { s.removeLast(); s = s.trimmingCharacters(in: .whitespaces) }
    return s
  }

  struct Option: Equatable { var n: Int; var label: String; var selected: Bool }
  /// "❯ 1. Yes" -> (1, "Yes", selected). Nil when the line is not a numbered option.
  static func option(_ s: String) -> Option? {
    var t = Substring(s)
    var selected = false
    if let f = t.first, marks.contains(f) { selected = true; t = t.dropFirst().drop(while: { $0 == " " }) }
    let digits = t.prefix(while: \.isNumber)
    guard (1...2).contains(digits.count), let n = Int(digits) else { return nil }
    t = t.dropFirst(digits.count)
    guard let p = t.first, p == "." || p == ")" else { return nil }
    t = t.dropFirst()
    guard t.first == " " else { return nil }
    let label = t.trimmingCharacters(in: .whitespaces)
    guard !label.isEmpty else { return nil }
    return Option(n: n, label: label, selected: selected)
  }

  /// Lines a tool prints under its options that are not part of the choice.
  static func isHint(_ s: String) -> Bool {
    let l = s.lowercased()
    if s.isEmpty { return true }
    return l.hasPrefix("esc to") || l.hasPrefix("press ") || l.contains("to cancel") || l.contains("tab to amend") || l.contains("to navigate")
      || l.contains("enter to") || l.contains("ctrl+") || l.contains("shift+tab") || l.hasPrefix("(") || l.hasPrefix("…")
      || l.contains("automatically deny this request")
  }

  static let yesWords = ["yes", "allow", "approve", "proceed", "accept", "run", "ok"]
  static let noWords = ["no", "deny", "don't", "do not", "reject", "cancel", "decline", "skip"]
  static func isYes(_ label: String) -> Bool { let l = label.lowercased(); return yesWords.contains { l == $0 || l.hasPrefix($0 + ",") || l.hasPrefix($0 + " ") || l.hasPrefix($0 + "(") } }
  static func isNo(_ label: String) -> Bool { let l = label.lowercased(); return noWords.contains { l == $0 || l.hasPrefix($0 + ",") || l.hasPrefix($0 + " ") || l.hasPrefix($0 + "(") } }

  /// The questions a permission prompt asks. Anything else that offers numbered options is a question for the person.
  static let permissionAsk = try! NSRegularExpression(pattern:
    #"(?i)(do you want to (proceed|make this edit|make these edits|create|allow|run|delete|overwrite|fetch|execute|use|write|apply|edit|read|access|continue)|would you like to (run|make|apply|allow|proceed|execute|edit)|allow (execution|this|command|the|it)|requires? (confirmation|approval|permission)|apply this change|permission (to|required)|run this command)"#)
  /// Words that make it a question even when it looks like a permission prompt.
  static let questionMarks = try! NSRegularExpression(pattern:
    #"(?i)(plan|trust (the files|this folder|this project|the folder)|type something|submit answer|chat about this|other\b|which |what should|choose |select (one|an?|the))"#)

  /// The window's text (its visible lines, bottom last) -> what to do. Only the last 40 lines count, and the options
  /// must be the last thing on the screen (only hint lines and box borders under them).
  static func classify(_ text: String) -> Verdict {
    var lines = text.split(separator: "\n", omittingEmptySubsequences: false).suffix(40).map(clean)
    while let l = lines.last, isHint(l) { lines.removeLast() }
    guard !lines.isEmpty else { return .none }
    // The options block, from the bottom up: the last line must be an option.
    var opts: [Option] = []
    var i = lines.count - 1
    while i >= 0 {
      let s = lines[i]
      if let o = option(s) { opts.insert(o, at: 0); i -= 1; continue }
      if opts.isEmpty { break }
      if s.isEmpty { i -= 1; continue }
      // A wrapped option label: a plain line with another option straight above it belongs to that option.
      if i > 0, option(lines[i - 1]) != nil, !s.hasSuffix("?") { i -= 1; continue }
      break
    }
    guard opts.count >= 2 else { return .none }
    guard opts.map(\.n) == Array(1...opts.count) else { return .unsure("the options are not numbered 1, 2, 3") }
    // The question: the nearest line ending in "?" (or saying it needs confirmation) above the options, within 12.
    var qi = i
    var found = false
    while qi >= 0 && qi >= i - 12 {
      let l = lines[qi].lowercased()
      if l.hasSuffix("?") || l.contains("requires confirmation") || l.contains("requires approval") { found = true; break }
      qi -= 1
    }
    guard found else { return .question }
    let question = lines[qi]
    let labels = opts.map(\.label).joined(separator: "\n")
    func has(_ re: NSRegularExpression, _ s: String) -> Bool { re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil }
    // A permission prompt says so in its question, or in the few lines just above it ("Hook X requires confirmation").
    guard lines[max(0, qi - 3)...qi].contains(where: { has(permissionAsk, $0) }) else { return .question }
    guard !has(questionMarks, labels + "\n" + question) else { return .question }
    guard isYes(opts[0].label) else { return .question }
    guard opts.allSatisfy({ isYes($0.label) || isNo($0.label) }) else { return .question }
    guard opts.contains(where: { isNo($0.label) }) else { return .question }
    let sel = opts.filter(\.selected)
    guard sel.count == 1 else { return .unsure("no option is marked as chosen") }
    guard sel[0].n == 1 else { return .unsure("an option other than Yes is chosen") }
    // What it is for: the lines between the question and the options (Codex), else the nearest content lines
    // above the question (Claude Code's command or file), made safe for the log.
    let solid: (String) -> Bool = { s in !s.isEmpty && !s.unicodeScalars.allSatisfy { boxChars.contains($0) } }
    var what = qi + 1 <= i ? lines[(qi + 1)...i].filter(solid).prefix(2).map { $0 } : []
    if what.isEmpty {
      var k = qi - 1
      while k >= 0 && k >= qi - 8 && what.count < 2 {
        if solid(lines[k]) && !has(permissionAsk, lines[k]) { what.insert(lines[k], at: 0) }
        k -= 1
      }
    }
    let key = ([question] + what + opts.map(\.label)).joined(separator: "|")
    return .approve(key: key, what: redact(what.isEmpty ? question : what.joined(separator: " "), max: 90))
  }

  // MARK: - reading Terminal and iTerm2

  /// The script's output, one piece per window or session.
  static func split(_ out: String, nonce: String) -> [(target: String, text: String)] {
    let head = "<<PS-\(nonce) "
    var res: [(String, String)] = []
    var cur: String?
    var buf: [Substring] = []
    for line in out.split(separator: "\n", omittingEmptySubsequences: false) {
      if line.hasPrefix(head), line.hasSuffix(">>") {
        if let c = cur { res.append((c, buf.joined(separator: "\n"))) }
        cur = String(line.dropFirst(head.count).dropLast(2)); buf = []
      } else { buf.append(line) }
    }
    if let c = cur { res.append((c, buf.joined(separator: "\n"))) }
    return res
  }
}

/// Puts PS's line into the tools' settings and takes it out again. Every change keeps a backup and is atomic.
struct ApproveInstaller {
  let p: ApprovePaths
  private var fm: FileManager { .default }

  /// What PS made itself (a file that was not there), so Off can take it away again. Kept in state.json.
  private func state() -> [String: Any] { (try? JSONSerialization.jsonObject(with: Data(contentsOf: p.state))) as? [String: Any] ?? [:] }
  private func saveState(_ s: [String: Any]) {
    if s.isEmpty { try? fm.removeItem(at: p.state); return }
    try? fm.createDirectory(at: p.dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try? Data(ApproveCore.render(s).utf8).write(to: p.state, options: .atomic)
  }
  private func created(_ url: URL) -> Bool { (state()["created"] as? [String] ?? []).contains(url.path) }
  private func setCreated(_ url: URL, _ on: Bool) {
    var s = state()
    var list = (s["created"] as? [String] ?? []).filter { $0 != url.path }
    if on { list.append(url.path) }
    s["created"] = list.isEmpty ? nil : list
    saveState(s)
  }

  func read(_ url: URL) -> String? { try? String(contentsOf: url, encoding: .utf8) }
  /// Writes a settings file: a copy of it as it was first (<file>.ps-auto-approve-backup), then the new text in one
  /// atomic step, with the same permissions as before.
  private func write(_ text: String, to url: URL) throws {
    if fm.fileExists(atPath: url.path) {
      let bak = URL(fileURLWithPath: url.path + ApproveCore.backupSuffix)
      try? fm.removeItem(at: bak)
      try fm.copyItem(at: url, to: bak)
      let perms = (try? fm.attributesOfItem(atPath: url.path))?[.posixPermissions]
      try Data(text.utf8).write(to: url, options: .atomic)
      if let perms { try? fm.setAttributes([.posixPermissions: perms], ofItemAtPath: url.path) }
    } else {
      try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try Data(text.utf8).write(to: url, options: .atomic)
      setCreated(url, true)
    }
  }

  func claudeFound() -> Bool { isDir(p.claudeDir) }
  func codexFound() -> Bool { isDir(p.codexDir) }
  private func isDir(_ u: URL) -> Bool { var d: ObjCBool = false; return fm.fileExists(atPath: u.path, isDirectory: &d) && d.boolValue }

  func claudeOn() -> Bool { ApproveCore.parseObject(read(p.claudeSettings)).map(ApproveCore.hasOurs) ?? false }
  func codexOn() -> Bool { ApproveCore.parseObject(read(p.codexHooks)).map(ApproveCore.hasOurs) ?? false }

  /// The script and its inbox, written fresh every time (a newer PS may have a newer script).
  func ensureScript() throws {
    try fm.createDirectory(at: p.inbox, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: p.dir.path)
    try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: p.inbox.path)
    let text = ApproveCore.hookScript()
    if read(p.hook) != text { try Data(text.utf8).write(to: p.hook, options: .atomic) }
    try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: p.hook.path)
  }

  enum Outcome: Equatable { case done, missing, refused(String) }

  /// On: the script, then one line in Claude Code's settings and (when Codex is on this Mac) Codex's hooks.
  func install() -> (claude: Outcome, codex: Outcome) {
    do { try ensureScript() } catch { return (.refused("PS could not write its hook script."), .refused("PS could not write its hook script.")) }
    return (add(p.claudeSettings, tool: "claude", found: claudeFound()), add(p.codexHooks, tool: "codex", found: codexFound()))
  }
  private func add(_ url: URL, tool: String, found: Bool) -> Outcome {
    guard found else { return .missing }
    guard let o = ApproveCore.parseObject(read(url)) else { return .refused("PS could not read \(display(url)), so it left it alone.") }
    if ApproveCore.hasOurs(o) { return .done }
    do { try write(ApproveCore.render(ApproveCore.adding(o, tool: tool, p)), to: url); return .done }
    catch { return .refused("PS could not change \(display(url)). Nothing was changed.") }
  }

  /// Off: exactly the lines PS added, a file PS made that is empty again, the script, the lease and the inbox.
  @discardableResult func uninstall() -> [String] {
    var notes: [String] = []
    for url in [p.claudeSettings, p.codexHooks] {
      guard let text = read(url) else { continue }
      guard let o = ApproveCore.parseObject(text) else { notes.append("PS could not read \(display(url)), so it left it alone."); continue }
      let out = ApproveCore.removing(o)
      guard !NSDictionary(dictionary: out).isEqual(to: o) else { continue }
      if created(url) && out.isEmpty { try? fm.removeItem(at: url); setCreated(url, false) }
      else { do { try write(ApproveCore.render(out), to: url) } catch { notes.append("PS could not change \(display(url)).") } }
    }
    try? fm.removeItem(at: p.lease)
    try? fm.removeItem(at: p.hook)
    if ((try? fm.contentsOfDirectory(atPath: p.inbox.path)) ?? []).isEmpty { try? fm.removeItem(at: p.inbox) }
    if (state()["created"] as? [String] ?? []).isEmpty { try? fm.removeItem(at: p.state) }
    if ((try? fm.contentsOfDirectory(atPath: p.dir.path)) ?? ["x"]).isEmpty { try? fm.removeItem(at: p.dir) }
    let ps = p.dir.deletingLastPathComponent()
    if ((try? fm.contentsOfDirectory(atPath: ps.path)) ?? ["x"]).isEmpty { try? fm.removeItem(at: ps) }
    return notes
  }

  /// The lease: written (moved on) while Auto approve is on, removed when it goes off.
  func setLease(_ on: Bool, now: Date = Date()) {
    if on {
      try? fm.createDirectory(at: p.dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      try? Data(ApproveCore.leaseText(now: now).utf8).write(to: p.lease, options: .atomic)
    } else { try? fm.removeItem(at: p.lease) }
  }

  /// A path as a person reads it (~/.claude/settings.json).
  func display(_ url: URL) -> String { url.path.hasPrefix(p.home.path + "/") ? "~" + url.path.dropFirst(p.home.path.count) : url.lastPathComponent }
}

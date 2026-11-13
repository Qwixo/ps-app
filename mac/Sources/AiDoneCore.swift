// AI chat finished cards, the pure part (V1.53, the developer 12 Nov 2026: every PS user gets the "Claude finished" card, and
// other AI tools too). Foundation only, no AppKit, so tests/aidone-test.sh can build it alone. AiDone.swift runs it.
//
// How a card gets to PS without any server or key:
// 1. Settings, AI chat finished cards, On for a tool: PS writes a small shell script (hookScript) to
//    ~/Library/PS/ai-done/hook.sh and adds one line that runs it to that tool's own settings. Everything already in
//    those settings stays; a copy of the file as it was is kept beside it (<file>.ps-backup) before every change.
// 2. The tool finishes a chat and runs the script. The script keeps only which tool, the chat's id, its folder and,
//    for Claude Code, where its transcript is, in a file in ~/Library/PS/ai-done/inbox that only this user can read.
//    Never the prompt or the answer: the script picks those few fields out of what the tool passes (plutil) and
//    throws the rest away. It sends nothing anywhere.
// 3. PS on the Mac picks the file up (AiDone.swift), works out the chat's name and, for Claude Code, whether the chat
//    is really finished (the hold rules of the developer's own hook, ~/.claude/hooks/ps-chat-done.mts, ported in
//    claudeTranscript below), and hands the page {tool, id, chat, at}. The page keeps it in the encrypted settings
//    like any finished chat (web src/aidone.ts); the file is deleted once the page has it.
// Off takes out exactly the lines PS added (found by the script's path), and the script and its folder when no tool
// uses them. A settings file PS made itself (there was none) is removed again when nothing else is in it.
//
// Which tools (checked 12 Nov 2026 against each tool's own documentation):
// - Claude Code (the terminal and the Claude app's Code tab): ~/.claude/settings.json, hooks.Stop.
// - OpenAI Codex CLI: ~/.codex/config.toml top level `notify` (runs on agent-turn-complete, no trust step). When the
//   person already has their own notify program, PS leaves it alone and uses ~/.codex/hooks.json, hooks.Stop
//   instead, which Codex runs only once the person trusts it in Codex (/hooks).
// - Gemini CLI: ~/.gemini/settings.json, hooks.AfterAgent (timeout in milliseconds).
// - Cursor (its agent, and cursor-agent): ~/.cursor/hooks.json, version 1, hooks.stop, only when status is completed.
// - The ChatGPT app and the Claude app's own chats have no hook or any other way to say a reply finished, so PS
//   cannot show a card for them (and never watches their windows to guess).
// The developer's Mac: his own Claude Code hook (ps-chat-done.mts, a sealed package to his vault) is found and left alone, so
// Claude Code shows "On through your own hook" and nothing is doubled.
import Foundation

enum AiTool: String, CaseIterable {
  case claude, codex, gemini, cursor
  var name: String {
    switch self { case .claude: return "Claude Code"; case .codex: return "Codex"; case .gemini: return "Gemini CLI"; case .cursor: return "Cursor" }
  }
}

/// Where everything lives, from one home folder (a temp folder in the tests).
struct AiPaths {
  let home: URL
  var dir: URL { home.appendingPathComponent("Library/PS/ai-done") }
  var hook: URL { dir.appendingPathComponent("hook.sh") }
  var inbox: URL { dir.appendingPathComponent("inbox") }
  var state: URL { dir.appendingPathComponent("state.json") }
  var claudeSettings: URL { home.appendingPathComponent(".claude/settings.json") }
  var codexConfig: URL { home.appendingPathComponent(".codex/config.toml") }
  var codexHooks: URL { home.appendingPathComponent(".codex/hooks.json") }
  var geminiSettings: URL { home.appendingPathComponent(".gemini/settings.json") }
  var cursorHooks: URL { home.appendingPathComponent(".cursor/hooks.json") }
  /// The folder each tool keeps its settings in: the tool counts as on this Mac when it is there.
  func toolDir(_ t: AiTool) -> URL {
    switch t { case .claude: return home.appendingPathComponent(".claude"); case .codex: return home.appendingPathComponent(".codex")
    case .gemini: return home.appendingPathComponent(".gemini"); case .cursor: return home.appendingPathComponent(".cursor") }
  }
  /// The command line that runs the script for a tool (the path quoted for the shell the tools run it with).
  func command(_ t: AiTool) -> String { "/bin/sh '\(hook.path.replacingOccurrences(of: "'", with: "'\\''"))' \(t.rawValue)" }
}

enum AiDoneCore {
  /// What marks a line PS added: the script's place, which nothing else uses.
  static let marker = "/Library/PS/ai-done/hook.sh"
  /// The developer's own Claude Code hook (a sealed package straight to his vault): found, never touched.
  static let ownHookMark = "ps-chat-done"
  static let codexComment = "# Added by PS: AI chat finished cards. Switch it off in PS Settings to remove it."

  // MARK: - the script

  /// The hook script. POSIX sh and macOS's own plutil only (a friend's Mac may have no node or python).
  static func hookScript() -> String {
    #"""
    #!/bin/sh
    # Added by PS (Settings, AI chat finished cards). Tells PS on this Mac that an AI chat finished.
    # It keeps only which tool, the chat's id, its folder and (Claude Code) where its transcript is, in a file only
    # you can read, for PS to pick up. Never the prompt or the answer. Nothing is sent anywhere.
    # Switching the setting off in PS removes this file and the line that runs it.
    tool="$1"
    case "$tool" in claude|codex|gemini|cursor) ;; *) exit 0 ;; esac
    dir="$HOME/Library/PS/ai-done/inbox"
    if [ -d "$dir" ]; then
      if [ "$tool" = codex ] && [ -n "$2" ]; then raw="$2"; else raw="$(cat)"; fi
      get() { printf '%s' "$raw" | /usr/bin/plutil -extract "$1" raw -o - - 2>/dev/null | tr -d '\r\n' | head -c 600; }
      ok=1; id=""; cwd=""; tp=""
      case "$tool" in
        claude) [ "$(get hook_event_name)" = Stop ] || ok=0; [ "$(get stop_hook_active)" = true ] && ok=0
                id="$(get session_id)"; cwd="$(get cwd)"; tp="$(get transcript_path)" ;;
        codex)  if [ "$(get type)" = agent-turn-complete ]; then id="$(get thread-id)"
                elif [ "$(get hook_event_name)" = Stop ]; then [ "$(get stop_hook_active)" = true ] && ok=0; id="$(get session_id)"
                else ok=0; fi
                cwd="$(get cwd)" ;;
        gemini) [ "$(get hook_event_name)" = AfterAgent ] || ok=0; [ "$(get stop_hook_active)" = true ] && ok=0
                id="$(get session_id)"; cwd="$(get cwd)" ;;
        cursor) [ "$(get status)" = completed ] || ok=0
                id="$(get conversation_id)"; cwd="$(get workspace_roots.0)" ;;
      esac
      if [ "$ok" = 1 ] && [ -n "$id" ]; then
        umask 077
        now="$(date +%s)"; f="$dir/.$tool.$$.tmp"
        { printf 'tool=%s\n' "$tool"; printf 'id=%s\n' "$id"; printf 'cwd=%s\n' "$cwd"; printf 'transcript=%s\n' "$tp"; printf 'at=%s\n' "$now"; } > "$f" \
          && mv -f "$f" "$dir/$tool.$now.$$.drop"
      fi
    fi
    [ "$tool" = codex ] && [ -n "$2" ] || printf '{}\n'
    exit 0

    """#
  }

  // MARK: - JSON settings (Claude Code, Codex hooks.json, Gemini CLI, Cursor)

  enum Shape { case grouped(event: String, matcher: String?, entry: [String: Any]), flat(event: String, entry: [String: Any]) }

  /// What PS adds to a tool's JSON settings, by tool.
  static func shape(_ t: AiTool, codexHooks: Bool = false, paths: AiPaths) -> Shape {
    let cmd = paths.command(t)
    switch t {
    case .claude: return .grouped(event: "Stop", matcher: nil, entry: ["type": "command", "command": cmd, "timeout": 10])
    case .codex: return .grouped(event: "Stop", matcher: nil, entry: ["type": "command", "command": cmd, "timeout": 10])
    case .gemini: return .grouped(event: "AfterAgent", matcher: "*", entry: ["name": "ps-ai-done", "type": "command", "command": cmd, "timeout": 5000])
    case .cursor: return .flat(event: "stop", entry: ["command": cmd, "timeout": 5])
    }
  }

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

  /// True when the settings already run PS's script for this shape's event.
  static func hasOurs(_ o: [String: Any], _ s: Shape) -> Bool {
    let hooks = o["hooks"] as? [String: Any] ?? [:]
    switch s {
    case .grouped(let ev, _, _): return (hooks[ev] as? [Any] ?? []).contains { (($0 as? [String: Any])?["hooks"] as? [Any] ?? []).contains(where: isOurs) }
    case .flat(let ev, _): return (hooks[ev] as? [Any] ?? []).contains(where: isOurs)
    }
  }

  /// The developer's own Claude Code hook in these settings.
  static func hasOwnHook(_ o: [String: Any]) -> Bool {
    let hooks = o["hooks"] as? [String: Any] ?? [:]
    return (hooks["Stop"] as? [Any] ?? []).contains { (($0 as? [String: Any])?["hooks"] as? [Any] ?? []).contains {
      ((($0 as? [String: Any])?["command"] as? String) ?? "").contains(ownHookMark) } }
  }

  /// The settings with PS's line added at the end of that event's list. Everything else stays as it was.
  static func adding(_ o: [String: Any], _ s: Shape, cursorVersion: Bool = false) -> [String: Any] {
    if hasOurs(o, s) { return o }
    var o = o
    var hooks = o["hooks"] as? [String: Any] ?? [:]
    switch s {
    case .grouped(let ev, let matcher, let entry):
      var list = hooks[ev] as? [Any] ?? []
      var group: [String: Any] = ["hooks": [entry]]
      if let matcher { group["matcher"] = matcher }
      list.append(group)
      hooks[ev] = list
    case .flat(let ev, let entry):
      var list = hooks[ev] as? [Any] ?? []
      list.append(entry)
      hooks[ev] = list
    }
    o["hooks"] = hooks
    if cursorVersion && o["version"] == nil { o["version"] = 1 }
    return o
  }

  /// The settings with every line PS added taken out (only those). A group or event list left empty by that goes too.
  static func removing(_ o: [String: Any]) -> [String: Any] {
    guard var hooks = o["hooks"] as? [String: Any] else { return o }
    var changed = false
    for (ev, v) in hooks {
      guard let list = v as? [Any] else { continue }
      var out: [Any] = []
      var touched = false
      for item in list {
        if isOurs(item) { touched = true; continue }                       // flat (Cursor)
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

  /// Nothing left but what PS put there itself (Cursor's version number): a file PS made can go again.
  static func isEmptyAfterRemove(_ o: [String: Any], cursor: Bool) -> Bool {
    o.isEmpty || (cursor && o.count == 1 && o["version"] != nil)
  }

  // MARK: - Codex config.toml, the top level notify

  static func tomlString(_ s: String) -> String { "\"" + s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\"" }
  static func codexNotifyLine(_ p: AiPaths) -> String { "notify = [\(tomlString("/bin/sh")), \(tomlString(p.hook.path)), \(tomlString("codex"))]" }

  /// The top level `notify` in a config.toml: none, PS's own, or the person's own (left alone).
  enum CodexNotify: Equatable { case none, ours, theirs }
  static func codexNotify(_ toml: String) -> CodexNotify {
    for line in toml.components(separatedBy: "\n") {
      let t = line.trimmingCharacters(in: .whitespaces)
      if t.hasPrefix("[") { break }                                          // the first table: no longer top level
      if t.range(of: #"^notify\s*="#, options: .regularExpression) != nil { return t.contains(marker) ? .ours : .theirs }
    }
    return .none
  }
  /// PS's notify put at the very top of the file (always top level), with a comment saying who added it.
  static func addingNotify(_ toml: String, _ p: AiPaths) -> String {
    let head = codexComment + "\n" + codexNotifyLine(p) + "\n"
    return toml.isEmpty ? head : head + (toml.hasPrefix("\n") ? "" : "\n") + toml
  }
  /// The file with exactly the lines PS added taken out (its notify, its comment and the blank line it left).
  static func removingNotify(_ toml: String) -> String {
    var lines = toml.components(separatedBy: "\n")
    guard let i = lines.firstIndex(where: { let t = $0.trimmingCharacters(in: .whitespaces); return t.hasPrefix("notify") && t.contains(marker) }) else { return toml }
    lines.remove(at: i)
    var at = i
    if i > 0 && lines[i - 1] == codexComment { lines.remove(at: i - 1); at = i - 1 }
    if at == 0 && lines.first == "" && lines.count > 1 { lines.removeFirst() }   // the blank line PS put after its two
    return lines.joined(separator: "\n")
  }

  // MARK: - a file the script left

  struct Drop: Equatable { var tool: AiTool; var id: String; var cwd: String; var transcript: String; var at: Date }
  static func parseDrop(_ text: String) -> Drop? {
    var f: [String: String] = [:]
    for line in text.split(separator: "\n") {
      guard let eq = line.firstIndex(of: "=") else { continue }
      f[String(line[..<eq])] = String(line[line.index(after: eq)...])
    }
    guard let tool = f["tool"].flatMap(AiTool.init(rawValue:)) else { return nil }
    let id = String((f["id"] ?? "").filter { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }.prefix(36))
    guard !id.isEmpty else { return nil }
    let at = Double(f["at"] ?? "").map { Date(timeIntervalSince1970: $0) } ?? Date()
    return Drop(tool: tool, id: id, cwd: f["cwd"] ?? "", transcript: f["transcript"] ?? "", at: at)
  }

  /// A folder's last part: the chat's name for tools that have no names of their own.
  static func folderName(_ cwd: String) -> String {
    let n = (cwd as NSString).lastPathComponent
    return n.isEmpty || n == "/" ? "" : n
  }

  // MARK: - a chat's name, never a raw id (V1.56)
  // The developer, 13 Nov 2026: friends' cards showed "a random looking id" where the chat's name should be. Two causes, both
  // fixed here. Claude Code no longer writes the prompt's words into its "last-prompt" records (only an id), so a chat
  // with no title record fell straight through to its folder; and in the Claude app's Code tab that folder is a
  // worktree with a made up name and a hex tail ("dazzling-taussig-91586f"). The developer never saw it: his own hook names his
  // chats, and nearly every chat on his Mac has a title record. The order now: the chat's title (the transcript's
  // newest, else the Claude app's own, else the tool's own index), its first prompt shortened, the folder, and never
  // an id: a worktree gives its project's folder, a folder that is only an id or a scratch space gives nothing, and
  // the card then says "A Claude chat".

  /// The first `words` words of a prompt, on one line.
  static func shortPrompt(_ s: String, words: Int = 8) -> String {
    s.split(whereSeparator: { $0.isWhitespace }).prefix(words).joined(separator: " ")
  }
  /// A prompt as the person typed it: the app's and the tool's own tags (<system-reminder>, <ide_opened_file>,
  /// <command-name> and the like, with what is inside them) taken out. Empty when nothing of theirs is left.
  static func promptText(_ s: String) -> String {
    var t = s
    if let re = try? NSRegularExpression(pattern: #"<([A-Za-z][\w:-]*)(?:\s[^>]*)?>[\s\S]*?</\1>"#) {
      t = re.stringByReplacingMatches(in: t, range: NSRange(t.startIndex..., in: t), withTemplate: " ")
    }
    if let re = try? NSRegularExpression(pattern: #"</?[A-Za-z][\w:-]*(?:\s[^>]*)?/?>"#) {
      t = re.stringByReplacingMatches(in: t, range: NSRange(t.startIndex..., in: t), withTemplate: " ")
    }
    t = t.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.hasPrefix("# AGENTS.md") || t.hasPrefix("Caveat: ") || t.contains(subMark) { return "" }
    return t
  }
  /// Looks like an id rather than a name (the developer, 13 Nov 2026: friends saw "a long jumble of letters and numbers"):
  /// a UUID anywhere; only hex digits and dashes (8 or more); an id with its kind in front ("session_01Prc...",
  /// "local_50ec...", "msg_..."); or one long word of letters and numbers that keeps switching between them. A name
  /// with a space in it is a name ("Fix the login page", "V1.48 Sentry mode").
  static func idLike(_ s: String) -> Bool {
    let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.range(of: #"[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}"#, options: .regularExpression) != nil { return true }
    if t.contains(where: { $0.isWhitespace }) { return false }
    if t.count >= 8 && t.range(of: #"^[0-9a-fA-F_-]+$"#, options: .regularExpression) != nil && t.contains(where: { $0.isNumber }) { return true }
    if t.range(of: #"^(?i:session|sess|local|msg|toolu|req|agent|task|thread|chat|conv|conversation|run|cse|bridge)[_-][A-Za-z0-9_-]{8,}$"#, options: .regularExpression) != nil { return true }
    guard t.count >= 14, t.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil else { return false }
    let digits = t.filter { $0.isNumber }.count
    var flips = 0, last: Bool?
    for ch in t where ch.isLetter || ch.isNumber { let n = ch.isNumber; if let l = last, l != n { flips += 1 }; last = n }
    let upperInside = t.dropFirst().filter { $0.isUppercase }.count
    return digits >= 3 && (flips >= 4 || (upperInside >= 3 && flips >= 2))
  }
  /// The folder a card may show for a chat: a worktree gives its project's folder ("web", not
  /// "dazzling-taussig-91586f"), the Claude app's scratch spaces and folders that are only an id give "".
  static func chatFolder(_ cwd: String) -> String {
    var path = cwd
    while path.count > 1 && path.hasSuffix("/") { path.removeLast() }
    for mark in ["/.claude/worktrees/", "/.codex/worktrees/", "/.cursor/worktrees/"] {
      if let r = path.range(of: mark) { path = String(path[..<r.lowerBound]); break }
    }
    if path.contains("/Library/Application Support/") || path.contains("/scratch-workspaces/") { return "" }
    let n = folderName(path)
    if n.isEmpty || n.hasPrefix(".") || idLike(n) || n.range(of: #"^scratch-\d{4}-\d{2}-\d{2}"#, options: .regularExpression) != nil { return "" }
    if n == (NSHomeDirectory() as NSString).lastPathComponent && path == NSHomeDirectory() { return "" }   // the home folder is no name
    return n
  }
  /// A name a card may show: one line, at most 120 characters, never an id.
  static func usable(_ s: String?) -> String? {
    guard let s else { return nil }
    let t = s.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    return t.isEmpty || idLike(t) ? nil : String(t.prefix(120))
  }

  /// The Claude app's own title for a Code tab chat (what its sidebar shows): its session files under
  /// ~/Library/Application Support/Claude/claude-code-sessions name the Claude Code session they run. Only files
  /// touched in the last two days are read, and only one that mentions the session is parsed.
  static func claudeAppTitle(sessionId: String, appSupport: URL, now: Date = Date()) -> String? {
    guard !sessionId.isEmpty else { return nil }
    let root = appSupport.appendingPathComponent("Claude/claude-code-sessions")
    let fm = FileManager.default
    guard let e = fm.enumerator(at: root, includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey], options: [.skipsHiddenFiles]) else { return nil }
    var recent: [(URL, Date)] = []
    for case let u as URL in e {
      if e.level > 3 { e.skipDescendants(); continue }
      guard u.pathExtension == "json", u.lastPathComponent.hasPrefix("local_"),
            let v = try? u.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey]), v.isRegularFile == true,
            let m = v.contentModificationDate, now.timeIntervalSince(m) < 2 * 86400 else { continue }
      recent.append((u, m))
    }
    let needle = Data("\"\(sessionId)\"".utf8)
    for (u, _) in recent.sorted(by: { $0.1 > $1.1 }).prefix(400) {
      guard let d = try? Data(contentsOf: u, options: .mappedIfSafe), d.count < 20_000_000, d.range(of: needle) != nil,
            let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { continue }
      if o["cliSessionId"] as? String == sessionId || o["lastAssistantCliSessionId"] as? String == sessionId, let t = usable(o["title"] as? String) { return t }
    }
    return nil
  }

  /// Codex's own name for a thread (~/.codex/session_index.jsonl, the newest line for it), else its first prompt
  /// shortened, from the thread's rollout file under ~/.codex/sessions.
  static func codexName(threadId: String, home: URL) -> String? {
    guard !threadId.isEmpty else { return nil }
    let codex = home.appendingPathComponent(".codex")
    if let text = try? String(contentsOf: codex.appendingPathComponent("session_index.jsonl"), encoding: .utf8) {
      var name: String?
      for line in text.split(separator: "\n") where line.contains(threadId) {
        if let o = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any], o["id"] as? String == threadId,
           let n = usable(o["thread_name"] as? String) { name = n }
      }
      if let name { return name }
    }
    let fm = FileManager.default
    guard let e = fm.enumerator(at: codex.appendingPathComponent("sessions"), includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) else { return nil }
    for case let u as URL in e where u.pathExtension == "jsonl" && u.lastPathComponent.hasSuffix("\(threadId).jsonl") {
      guard let text = try? String(contentsOf: u, encoding: .utf8) else { return nil }
      return codexFirstPrompt(text.split(separator: "\n"))
    }
    return nil
  }
  /// A Codex rollout's first prompt from the person, shortened (the instructions and context Codex adds are skipped).
  static func codexFirstPrompt<S: Sequence>(_ lines: S) -> String? where S.Element: StringProtocol {
    for raw in lines {
      let line = String(raw)
      guard line.contains("\"user_message\"") || (line.contains("\"role\":\"user\"") && line.contains("\"input_text\"")),
            let d = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any], let p = d["payload"] as? [String: Any] else { continue }
      var text = ""
      if p["type"] as? String == "user_message" { text = p["message"] as? String ?? "" }
      else if p["type"] as? String == "message", p["role"] as? String == "user", let c = p["content"] as? [Any] {
        text = c.compactMap { ($0 as? [String: Any])?["text"] as? String }.joined(separator: "\n")
      }
      if let n = usable(shortPrompt(promptText(text))) { return n }
    }
    return nil
  }

  /// Gemini CLI's saved chat (~/.gemini/tmp/<project>/chats/*.json) for this session: its first prompt, shortened.
  static func geminiName(sessionId: String, home: URL, now: Date = Date()) -> String? {
    guard !sessionId.isEmpty else { return nil }
    let fm = FileManager.default
    guard let e = fm.enumerator(at: home.appendingPathComponent(".gemini/tmp"), includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles]) else { return nil }
    let needle = Data(sessionId.utf8)
    for case let u as URL in e where u.pathExtension == "json" && u.deletingLastPathComponent().lastPathComponent == "chats" {
      guard let m = (try? u.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate, now.timeIntervalSince(m) < 2 * 86400,
            let d = try? Data(contentsOf: u), d.count < 50_000_000, d.range(of: needle) != nil,
            let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any], o["sessionId"] as? String == sessionId,
            let msgs = o["messages"] as? [[String: Any]] else { continue }
      for msg in msgs where msg["type"] as? String == "user" {
        let c = msg["content"]
        let text = (c as? String) ?? ((c as? [Any])?.compactMap { ($0 as? [String: Any])?["text"] as? String }.joined(separator: "\n") ?? "")
        if let n = usable(shortPrompt(promptText(text))) { return n }
      }
      return nil
    }
    return nil
  }

  // MARK: - Claude Code's transcript: the chat's name, and whether work it started is still running
  // A port of readTranscript in the developer's ~/.claude/hooks/ps-chat-done.mts (30 and 31 Oct 2026). Same rules: a turn that
  // ends while background agents, background Bash commands or workflows it started are still running shows nothing;
  // the later turn that ends once they are done shows the card. Work over 4 hours old with no end no longer holds.
  // A chat another session started (a sub chat) shows nothing.

  static let staleSeconds: TimeInterval = 4 * 3600
  static let tools = ["Agent", "Task", "Bash", "Workflow", "SendMessage", "TaskStop"]
  static let subMark = "You are a session started from another session"

  struct ClaudeInfo: Equatable { var chat: String; var running: Int; var stale: Int; var sub: Bool }

  static func textOf(_ c: Any?) -> String {
    if let s = c as? String { return s }
    if let a = c as? [Any] { return a.map { (($0 as? [String: Any])?["text"] as? String) ?? "" }.joined(separator: "\n") }
    return ""
  }
  static func first(_ pattern: String, _ s: String) -> String? {
    guard let re = try? NSRegularExpression(pattern: pattern), let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
          m.numberOfRanges > 1, let r = Range(m.range(at: 1), in: s) else { return nil }
    return String(s[r])
  }
  static func date(_ v: Any?) -> Date? {
    guard let s = v as? String else { return nil }
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: s) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: s)
  }

  static func claudeTranscript<S: Sequence>(_ lines: S, cwd: String, now: Date = Date(), appTitle: String? = nil, sessionId: String = "") -> ClaudeInfo where S.Element: StringProtocol {
    var title = "", aiTitle = "", agent = "", prompt = "", firstAsk = "", sub = false
    var live: [String: Date] = [:]
    var calls: [String: String] = [:]
    for raw in lines {
      let line = String(raw)
      let named = line.contains("\"custom-title\"") || line.contains("\"agent-name\"") || line.contains("\"last-prompt\"") || line.contains("\"ai-title\"")
      let jobs = line.contains("<task-notification>") || line.contains("in background") || line.contains("moved to the background")
        || line.contains("Async agent launched") || line.contains("async_launched") || line.contains("backgroundTaskId") || line.contains("resumedAgentId")
        || line.contains("Successfully stopped task")
        || (line.contains("\"tool_use\"") && tools.contains { line.contains("\"name\":\"\($0)\"") })
      let marked = !sub && line.contains(subMark)
      // The person's first prompt (V1.56): the name when there is no title, now that "last-prompt" holds no words.
      let asks = firstAsk.isEmpty && line.contains("\"type\":\"user\"") && !line.contains("\"tool_result\"")
      if !named && !jobs && !marked && !asks { continue }
      guard let d = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any] else { continue }   // a line still being written
      let type = d["type"] as? String ?? ""
      let side = d["isSidechain"] as? Bool == true
      let msg = d["message"] as? [String: Any]
      let content = msg?["content"]
      if marked && !side {
        let toolResult = (content as? [Any])?.contains { ($0 as? [String: Any])?["type"] as? String == "tool_result" } == true
        if type == "attachment" || type == "queue-operation" || (type == "user" && !toolResult) { sub = true }
      }
      if asks && type == "user" && !side && d["isMeta"] as? Bool != true && msg?["role"] as? String == "user" {
        firstAsk = shortPrompt(promptText(textOf(content)))
      }
      if type == "ai-title", let t = d["aiTitle"] as? String, !t.isEmpty { aiTitle = t }   // Claude Code's own title (V1.56): terminal chats too
      if type == "custom-title", let t = d["customTitle"] as? String, !t.isEmpty { title = t }
      else if type == "agent-name", let t = d["agentName"] as? String, !t.isEmpty { agent = t }
      else if type == "last-prompt", let t = d["lastPrompt"] as? String, !t.isEmpty, prompt.isEmpty { prompt = t }
      if !jobs || side { continue }
      let at = date(d["timestamp"]) ?? now
      // A job finishing: the notification Claude Code queues and then hands to the chat. Only these records count.
      let att = d["attachment"] as? [String: Any]
      let note: String = type == "queue-operation" ? (d["content"] as? String ?? "")
        : type == "attachment" && att?["type"] as? String == "queued_command" ? (att?["prompt"] as? String ?? "")
        : type == "user" && msg?["role"] as? String == "user" ? textOf(content) : ""
      if note.hasPrefix("<task-notification>"), let id = first(#"<task-id>([\w-]+)</task-id>"#, note),
         let status = first(#"<status>(\w+)</status>"#, note), status != "running" { live.removeValue(forKey: id) }
      guard let blocks = content as? [Any] else { continue }
      if type == "assistant" {
        for b in blocks { if let b = b as? [String: Any], b["type"] as? String == "tool_use", let name = b["name"] as? String, tools.contains(name), let id = b["id"] as? String { calls[id] = name } }
      }
      if type != "user" { continue }
      let results = blocks.compactMap { $0 as? [String: Any] }.filter { $0["type"] as? String == "tool_result" }
      for b in results {
        guard let useId = b["tool_use_id"] as? String, let tool = calls[useId] else { continue }
        let r = results.count == 1 ? d["toolUseResult"] as? [String: Any] : nil
        let t = textOf(b["content"])
        var j = r
        if tool == "SendMessage" || tool == "TaskStop", let parsed = try? JSONSerialization.jsonObject(with: Data(t.utf8), options: [.fragmentsAllowed]) {
          j = parsed as? [String: Any]
        }
        var id: String?
        switch tool {
        case "Agent", "Task": id = r != nil ? (r?["status"] as? String == "async_launched" ? r?["agentId"] as? String : nil) : first(#"^Async agent launched successfully[\s\S]*?agentId: (\w+)"#, t)
        case "Bash": id = r != nil ? r?["backgroundTaskId"] as? String : first(#"^Command (?:running in background with ID: |was moved to the background \(ID: )(\w+)"#, t)
        case "Workflow": id = r != nil ? (r?["status"] as? String == "async_launched" ? r?["taskId"] as? String : nil) : first(#"^Workflow launched in background\. Task ID: (\w+)"#, t)
        case "SendMessage": id = j?["resumedAgentId"] as? String
        default: id = nil
        }
        if let id, !id.isEmpty { live[id] = at }
        if tool == "TaskStop", let m = j?["message"] as? String, let stopped = first(#"^Successfully stopped task: (\w+)"#, m) { live.removeValue(forKey: stopped) }
      }
    }
    let ages = live.values.map { now.timeIntervalSince($0) }
    // The person renamed it, Claude Code titled it, the Claude app's sidebar, the agent name, the first prompt, then the
    // folder. Nothing that is, or holds, the chat's own id.
    let names: [String?] = [title, aiTitle, appTitle, agent, firstAsk, shortPrompt(promptText(prompt)), chatFolder(cwd)]
    let own = sessionId.count >= 6 ? sessionId : nil
    let name = names.lazy.compactMap { usable($0) }.first { n in own.map { !n.contains($0) } ?? true } ?? "A Claude chat"
    return ClaudeInfo(chat: name, running: ages.filter { $0 < staleSeconds }.count, stale: ages.filter { $0 >= staleSeconds }.count, sub: sub)
  }

  // MARK: - what a file becomes

  enum Verdict: Equatable { case card(tool: AiTool, id: String, chat: String, at: Date), held(Int), skipped(String) }

  /// A file the script left, turned into a card (or why not). `lines` reads a Claude Code transcript; `named` is the
  /// tool's own name for the chat when it keeps one (the Claude app's title, Codex's thread name, Gemini's first prompt).
  static func verdict(_ d: Drop, now: Date = Date(), lines: (String) -> [Substring]?, named: (Drop) -> String? = { _ in nil }) -> Verdict {
    if now.timeIntervalSince(d.at) > 3 * 3600 { return .skipped("too old") }   // the card would have gone by now
    if d.tool == .claude {
      let info = claudeTranscript(d.transcript.isEmpty ? [] : (lines(d.transcript) ?? []), cwd: d.cwd, now: now, appTitle: named(d), sessionId: d.id)
      if info.sub { return .skipped("a sub chat") }
      if info.running > 0 { return .held(info.running) }
      return .card(tool: .claude, id: d.id, chat: info.chat, at: d.at)
    }
    let mine = { (n: String?) -> String? in usable(n).flatMap { d.id.count >= 6 && $0.contains(d.id) ? nil : $0 } }
    let name = mine(named(d)) ?? mine(chatFolder(d.cwd)) ?? "A \(d.tool.name) chat"
    return .card(tool: d.tool, id: d.id, chat: name, at: d.at)
  }
  /// The tool's own name for a chat, from this Mac's files (AiDone.swift; the tests pass temp folders).
  static func toolName(_ d: Drop, home: URL, appSupport: URL, now: Date = Date()) -> String? {
    switch d.tool {
    case .claude: return claudeAppTitle(sessionId: d.id, appSupport: appSupport, now: now)
    case .codex: return codexName(threadId: d.id, home: home)
    case .gemini: return geminiName(sessionId: d.id, home: home, now: now)
    case .cursor: return nil   // Cursor keeps its chats in a database of its own: the workspace folder names them
    }
  }
}

// MARK: - switching a tool on and off (file work only, run from AiDone.swift on its own queue; the tests use temp folders)

struct AiInstaller {
  let p: AiPaths
  private var fm: FileManager { .default }

  /// What PS made itself (a file that was not there), so Off can take it away again. Kept in state.json.
  private func state() -> [String: Any] { (try? JSONSerialization.jsonObject(with: Data(contentsOf: p.state))) as? [String: Any] ?? [:] }
  private func saveState(_ s: [String: Any]) {
    if s.isEmpty { try? fm.removeItem(at: p.state); return }
    try? Data(AiDoneCore.render(s).utf8).write(to: p.state, options: .atomic)
  }
  private func created(_ url: URL) -> Bool { (state()["created"] as? [String] ?? []).contains(url.path) }
  private func setCreated(_ url: URL, _ on: Bool) {
    var s = state()
    var list = (s["created"] as? [String] ?? []).filter { $0 != url.path }
    if on { list.append(url.path) }
    s["created"] = list.isEmpty ? nil : list
    saveState(s)
  }

  private func read(_ url: URL) -> String? { try? String(contentsOf: url, encoding: .utf8) }
  /// Writes a tool's settings file: a copy of it as it was first (<file>.ps-backup), the same permissions after.
  private func write(_ text: String, to url: URL) throws {
    if fm.fileExists(atPath: url.path) {
      let bak = URL(fileURLWithPath: url.path + ".ps-backup")
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

  func found(_ t: AiTool) -> Bool {
    var dir: ObjCBool = false
    return fm.fileExists(atPath: p.toolDir(t).path, isDirectory: &dir) && dir.boolValue
  }

  /// The developer's own Claude Code hook is there (PS leaves Claude Code alone).
  func ownClaudeHook() -> Bool { AiDoneCore.parseObject(read(p.claudeSettings)).map(AiDoneCore.hasOwnHook) ?? false }

  /// Where a tool runs PS's script now, if anywhere. Codex: "notify" or "hooks".
  func how(_ t: AiTool) -> String? {
    switch t {
    case .claude: return AiDoneCore.parseObject(read(p.claudeSettings)).map { AiDoneCore.hasOurs($0, AiDoneCore.shape(.claude, paths: p)) } == true ? "hook" : nil
    case .gemini: return AiDoneCore.parseObject(read(p.geminiSettings)).map { AiDoneCore.hasOurs($0, AiDoneCore.shape(.gemini, paths: p)) } == true ? "hook" : nil
    case .cursor: return AiDoneCore.parseObject(read(p.cursorHooks)).map { AiDoneCore.hasOurs($0, AiDoneCore.shape(.cursor, paths: p)) } == true ? "hook" : nil
    case .codex:
      if AiDoneCore.codexNotify(read(p.codexConfig) ?? "") == .ours { return "notify" }
      return AiDoneCore.parseObject(read(p.codexHooks)).map { AiDoneCore.hasOurs($0, AiDoneCore.shape(.codex, paths: p)) } == true ? "hooks" : nil
    }
  }

  /// The script and its inbox, written fresh every time (a newer PS may have a newer script).
  func ensureScript() throws {
    try fm.createDirectory(at: p.inbox, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: p.dir.path)
    try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: p.inbox.path)
    let text = AiDoneCore.hookScript()
    if read(p.hook) != text { try Data(text.utf8).write(to: p.hook, options: .atomic) }
    try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: p.hook.path)
  }

  enum Outcome: Equatable { case done(String?), refused(String) }

  /// On: the script, then one line in the tool's settings. Returns a line for Settings when there is one to say.
  func install(_ t: AiTool) -> Outcome {
    if t == .claude && ownClaudeHook() { return .refused("On through your own hook. PS leaves it alone.") }
    do {
      try ensureScript()
      switch t {
      case .claude, .gemini, .cursor:
        let url = t == .claude ? p.claudeSettings : t == .gemini ? p.geminiSettings : p.cursorHooks
        let text = read(url)
        guard let o = AiDoneCore.parseObject(text) else { return .refused("PS could not read \(display(url)), so it left it alone.") }
        let s = AiDoneCore.shape(t, paths: p)
        if !AiDoneCore.hasOurs(o, s) { try write(AiDoneCore.render(AiDoneCore.adding(o, s, cursorVersion: t == .cursor)), to: url) }
        return .done(nil)
      case .codex:
        let toml = read(p.codexConfig) ?? ""
        switch AiDoneCore.codexNotify(toml) {
        case .ours: return .done(nil)
        case .none:
          try write(AiDoneCore.addingNotify(toml, p), to: p.codexConfig)
          return .done(nil)
        case .theirs:
          // Their own notify program stays; Codex's hooks need the person to trust them once.
          let text = read(p.codexHooks)
          guard let o = AiDoneCore.parseObject(text) else { return .refused("PS could not read \(display(p.codexHooks)), so it left it alone.") }
          let s = AiDoneCore.shape(.codex, paths: p)
          if !AiDoneCore.hasOurs(o, s) { try write(AiDoneCore.render(AiDoneCore.adding(o, s)), to: p.codexHooks) }
          return .done(AiDoneCore.codexTrustNote)
        }
      }
    } catch {
      return .refused("PS could not change \(t.name)'s settings. Nothing was changed.")
    }
  }

  /// Off: exactly the lines PS added, a file PS made that is empty again, and the script when no tool uses it.
  func uninstall(_ t: AiTool) -> Outcome {
    var bad: URL?
    func strip(_ url: URL, cursor: Bool = false) {
      guard let text = read(url) else { return }
      guard let o = AiDoneCore.parseObject(text) else { bad = url; return }
      let out = AiDoneCore.removing(o)
      guard !(NSDictionary(dictionary: out).isEqual(to: o)) else { return }
      if created(url) && AiDoneCore.isEmptyAfterRemove(out, cursor: cursor) {
        try? fm.removeItem(at: url); setCreated(url, false)
      } else { try? write(AiDoneCore.render(out), to: url) }
    }
    switch t {
    case .claude: strip(p.claudeSettings)
    case .gemini: strip(p.geminiSettings)
    case .cursor: strip(p.cursorHooks, cursor: true)
    case .codex:
      if let toml = read(p.codexConfig), AiDoneCore.codexNotify(toml) == .ours {
        let out = AiDoneCore.removingNotify(toml)
        if created(p.codexConfig) && out.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { try? fm.removeItem(at: p.codexConfig); setCreated(p.codexConfig, false) }
        else { try? write(out, to: p.codexConfig) }
      }
      strip(p.codexHooks)
    }
    tidy()
    if let bad { return .refused("PS could not read \(display(bad)), so it left it alone.") }
    return .done(nil)
  }

  /// No tool runs the script any more: the script, the empty inbox and PS's folders go too.
  func tidy() {
    guard AiTool.allCases.allSatisfy({ how($0) == nil }) else { return }
    try? fm.removeItem(at: p.hook)
    if ((try? fm.contentsOfDirectory(atPath: p.inbox.path)) ?? []).isEmpty { try? fm.removeItem(at: p.inbox) }
    if (state()["created"] as? [String] ?? []).isEmpty { try? fm.removeItem(at: p.state) }
    for d in [p.dir, p.dir.deletingLastPathComponent()] where ((try? fm.contentsOfDirectory(atPath: d.path)) ?? ["x"]).isEmpty { try? fm.removeItem(at: d) }
  }

  /// A path as a person reads it (~/.gemini/settings.json).
  func display(_ url: URL) -> String { url.path.hasPrefix(p.home.path + "/") ? "~" + url.path.dropFirst(p.home.path.count) : url.lastPathComponent }
}

extension AiDoneCore {
  static let codexTrustNote = "On. You already have a notify program in Codex, so PS used a Codex hook instead: type /hooks in Codex once and trust it."
}

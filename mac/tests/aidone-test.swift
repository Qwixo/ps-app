// Unit tests for AI chat finished cards (Sources/AiDoneCore.swift, V1.53). Everything happens in temp folders that
// stand in for a home folder: the real ~/.claude, ~/.codex, ~/.gemini and ~/.cursor are never read or written.
// Fictional chats only. Run: bash tests/aidone-test.sh
import Foundation

var passed = 0
func ok(_ name: String, _ cond: Bool, _ more: String = "") {
  if cond { passed += 1; print("ok - \(name)") } else { print("FAIL - \(name) \(more)"); exit(1) }
}
let fm = FileManager.default
func tempHome() -> AiPaths {
  let u = fm.temporaryDirectory.appendingPathComponent("aidone-test-\(UUID().uuidString)")
  try! fm.createDirectory(at: u, withIntermediateDirectories: true)
  return AiPaths(home: u)
}
func put(_ url: URL, _ text: String) { try! fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true); try! text.write(to: url, atomically: true, encoding: .utf8) }
func get(_ url: URL) -> String? { try? String(contentsOf: url, encoding: .utf8) }
func obj(_ url: URL) -> NSDictionary? { (try? JSONSerialization.jsonObject(with: Data(contentsOf: url))) as? NSDictionary }
func same(_ a: NSDictionary?, _ b: NSDictionary?) -> Bool { a != nil && b != nil && a!.isEqual(to: b! as! [AnyHashable: Any]) }

// ---------- Claude Code: settings with hooks of the person's own ----------
let claudeOwn = """
{
  "model": "opus",
  "permissions": { "allow": ["Bash(ls)"] },
  "hooks": {
    "Stop": [ { "hooks": [ { "type": "command", "command": "/usr/local/bin/my-own-stop", "timeout": 3 } ] } ],
    "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "/usr/local/bin/guard" } ] } ]
  },
  "skipSomething": true
}
"""
do {
  let p = tempHome(), i = AiInstaller(p: p)
  put(p.claudeSettings, claudeOwn)
  let before = obj(p.claudeSettings)
  ok("Claude Code counts as found when ~/.claude is there", i.found(.claude))
  ok("Codex is not found when ~/.codex is missing", !i.found(.codex))
  ok("Claude Code switches on", i.install(.claude) == .done(nil))
  let after = obj(p.claudeSettings)!
  let stop = (after["hooks"] as! NSDictionary)["Stop"] as! [NSDictionary]
  ok("their own Stop hook is still first, PS's is added after it", stop.count == 2 && ((stop[0]["hooks"] as! [NSDictionary])[0]["command"] as! String) == "/usr/local/bin/my-own-stop")
  ok("PS's line runs the script with the tool's name", ((stop[1]["hooks"] as! [NSDictionary])[0]["command"] as! String).hasSuffix("/Library/PS/ai-done/hook.sh' claude"))
  ok("everything else in the settings is kept", after["model"] as? String == "opus" && after["skipSomething"] as? Bool == true
     && same(after["permissions"] as? NSDictionary, before!["permissions"] as? NSDictionary)
     && same((after["hooks"] as! NSDictionary)["PreToolUse"].map { ["x": $0] as NSDictionary }, (before!["hooks"] as! NSDictionary)["PreToolUse"].map { ["x": $0] as NSDictionary }))
  ok("a backup of the file as it was sits beside it", get(URL(fileURLWithPath: p.claudeSettings.path + ".ps-backup")) == claudeOwn)
  ok("Settings sees it on", i.how(.claude) == "hook")
  ok("the script is there and only this user can run it", fm.isExecutableFile(atPath: p.hook.path)
     && ((try? fm.attributesOfItem(atPath: p.hook.path))?[.posixPermissions] as? Int) == 0o700)
  ok("the inbox is private to this user", ((try? fm.attributesOfItem(atPath: p.inbox.path))?[.posixPermissions] as? Int) == 0o700)
  _ = i.install(.claude)
  ok("switching on twice adds nothing twice", (((obj(p.claudeSettings)!["hooks"] as! NSDictionary)["Stop"]) as! [Any]).count == 2)
  ok("Off works", i.uninstall(.claude) == .done(nil))
  ok("Off takes out exactly what PS added: the settings are as they were", same(obj(p.claudeSettings), before))
  ok("Off with no tool left removes the script, the inbox and PS's folders", !fm.fileExists(atPath: p.hook.path) && !fm.fileExists(atPath: p.dir.path)
     && !fm.fileExists(atPath: p.home.appendingPathComponent("Library/PS").path))
  ok("the person's own files are still there", fm.fileExists(atPath: p.claudeSettings.path))
}

do {
  let p = tempHome(), i = AiInstaller(p: p)
  try! fm.createDirectory(at: p.toolDir(.claude), withIntermediateDirectories: true)
  ok("no settings file yet: PS makes one", i.install(.claude) == .done(nil) && fm.fileExists(atPath: p.claudeSettings.path))
  ok("no backup of a file that was not there", !fm.fileExists(atPath: p.claudeSettings.path + ".ps-backup"))
  _ = i.uninstall(.claude)
  ok("Off removes the file PS made, as it was empty again", !fm.fileExists(atPath: p.claudeSettings.path))
}

do {
  let p = tempHome(), i = AiInstaller(p: p)
  try! fm.createDirectory(at: p.toolDir(.claude), withIntermediateDirectories: true)
  _ = i.install(.claude)
  // The person adds a setting of their own after PS made the file.
  var o = obj(p.claudeSettings) as! [String: Any]; o["theme"] = "dark"
  put(p.claudeSettings, AiDoneCore.render(o))
  _ = i.uninstall(.claude)
  ok("a file PS made but the person has since added to is kept, without PS's line", (obj(p.claudeSettings)?["theme"] as? String) == "dark" && obj(p.claudeSettings)?["hooks"] == nil)
}

do {
  let p = tempHome(), i = AiInstaller(p: p)
  let own = """
  { "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "/opt/homebrew/bin/node /Users/someone/.claude/hooks/ps-chat-done.mts", "timeout": 10 } ] } ] } }
  """
  put(p.claudeSettings, own)
  ok("a Mac with its own chat done hook: Claude Code is left alone", i.ownClaudeHook() && i.install(.claude) == .refused("On through your own hook. PS leaves it alone."))
  ok("its settings are not touched at all, and no backup is made", get(p.claudeSettings) == own && !fm.fileExists(atPath: p.claudeSettings.path + ".ps-backup"))
  ok("nothing of PS's is left behind", !fm.fileExists(atPath: p.dir.path) || !fm.fileExists(atPath: p.hook.path) || i.how(.claude) == nil)
  i.tidy()
  ok("and no script stays after tidying", !fm.fileExists(atPath: p.hook.path))
}

// ---------- Gemini CLI: a file with comments is never rewritten ----------
do {
  let p = tempHome(), i = AiInstaller(p: p)
  let commented = "{\n  // my theme\n  \"theme\": \"dark\"\n}\n"
  put(p.geminiSettings, commented)
  if case .refused(let why) = i.install(.gemini) { ok("Gemini settings PS cannot read are refused with a plain line", why == "PS could not read ~/.gemini/settings.json, so it left it alone.", why) } else { ok("refused", false) }
  ok("and left exactly as they were", get(p.geminiSettings) == commented)
  put(p.geminiSettings, "{ \"theme\": \"dark\", \"hooks\": { \"AfterAgent\": [ { \"matcher\": \"*\", \"hooks\": [ { \"type\": \"command\", \"command\": \"say done\" } ] } ] } }")
  let before = obj(p.geminiSettings)
  ok("Gemini CLI switches on", i.install(.gemini) == .done(nil) && i.how(.gemini) == "hook")
  let ag = ((obj(p.geminiSettings)!["hooks"] as! NSDictionary)["AfterAgent"] as! [NSDictionary])
  let mine = (ag[1]["hooks"] as! [NSDictionary])[0]
  ok("Gemini gets an AfterAgent hook with a name and a timeout in milliseconds", ag.count == 2 && ag[1]["matcher"] as? String == "*" && mine["name"] as? String == "ps-ai-done" && mine["timeout"] as? Int == 5000)
  _ = i.uninstall(.gemini)
  ok("Gemini Off leaves their own hook and theme exactly", same(obj(p.geminiSettings), before))
}

// ---------- Cursor: a flat list under version 1 ----------
do {
  let p = tempHome(), i = AiInstaller(p: p)
  try! fm.createDirectory(at: p.toolDir(.cursor), withIntermediateDirectories: true)
  ok("Cursor switches on with no hooks.json yet", i.install(.cursor) == .done(nil))
  let h = obj(p.cursorHooks)!
  ok("Cursor's file says version 1 and has a stop hook", h["version"] as? Int == 1 && (((h["hooks"] as! NSDictionary)["stop"] as! [NSDictionary])[0]["command"] as! String).hasSuffix("hook.sh' cursor"))
  _ = i.uninstall(.cursor)
  ok("Cursor Off removes the hooks.json PS made", !fm.fileExists(atPath: p.cursorHooks.path))
  put(p.cursorHooks, "{ \"version\": 1, \"hooks\": { \"stop\": [ { \"command\": \"./hooks/audit.sh\" } ], \"afterFileEdit\": [ { \"command\": \"./f.sh\" } ] } }")
  let before = obj(p.cursorHooks)
  _ = i.install(.cursor)
  ok("their own stop hook stays first", ((((obj(p.cursorHooks)!["hooks"] as! NSDictionary)["stop"]) as! [NSDictionary])[0]["command"] as? String) == "./hooks/audit.sh")
  _ = i.uninstall(.cursor)
  ok("Cursor Off leaves their file exactly as it was", same(obj(p.cursorHooks), before))
}

// ---------- Codex: notify, or a hook when notify is theirs ----------
do {
  let p = tempHome(), i = AiInstaller(p: p)
  let toml = "model = \"gpt-5\"\n\n[profiles.fast]\nnotify = [\"x\"]\nmodel = \"mini\"\n"
  put(p.codexConfig, toml)
  ok("a notify inside a table is not the top level one", AiDoneCore.codexNotify(toml) == .none)
  ok("Codex switches on through notify", i.install(.codex) == .done(nil) && i.how(.codex) == "notify")
  let now = get(p.codexConfig)!
  ok("notify goes at the very top, above every table, with a comment saying PS added it", now.hasPrefix(AiDoneCore.codexComment + "\nnotify = [\"/bin/sh\", \"") && now.hasSuffix(toml))
  ok("a backup of config.toml sits beside it", get(URL(fileURLWithPath: p.codexConfig.path + ".ps-backup")) == toml)
  _ = i.uninstall(.codex)
  ok("Codex Off gives back config.toml character for character", get(p.codexConfig) == toml)
}
do {
  let p = tempHome(), i = AiInstaller(p: p)
  let toml = "# mine\nnotify = [\"terminal-notifier\", \"-title\", \"Codex\"]\n[tui]\nnotifications = true\n"
  put(p.codexConfig, toml)
  if case .done(let note) = i.install(.codex) { ok("their own notify program: PS uses a Codex hook and says to trust it", note == AiDoneCore.codexTrustNote) } else { ok("codex hooks", false) }
  ok("their config.toml is not touched", get(p.codexConfig) == toml && !fm.fileExists(atPath: p.codexConfig.path + ".ps-backup"))
  ok("the hook is a Stop hook in hooks.json", i.how(.codex) == "hooks")
  _ = i.uninstall(.codex)
  ok("Off removes the hooks.json PS made, config.toml still untouched", !fm.fileExists(atPath: p.codexHooks.path) && get(p.codexConfig) == toml)
}
do {
  let p = tempHome(), i = AiInstaller(p: p)
  try! fm.createDirectory(at: p.toolDir(.codex), withIntermediateDirectories: true)
  _ = i.install(.codex)
  _ = i.uninstall(.codex)
  ok("Codex with no config.toml: Off removes the one PS made", !fm.fileExists(atPath: p.codexConfig.path))
}

// ---------- several tools: Off for one leaves the others ----------
do {
  let p = tempHome(), i = AiInstaller(p: p)
  for t in [AiTool.claude, .gemini] { try! fm.createDirectory(at: p.toolDir(t), withIntermediateDirectories: true); _ = i.install(t) }
  _ = i.uninstall(.claude)
  ok("Off for Claude Code keeps Gemini and the script it needs", i.how(.gemini) == "hook" && fm.fileExists(atPath: p.hook.path))
  _ = i.uninstall(.gemini)
  ok("the last Off removes the script", !fm.fileExists(atPath: p.hook.path))
}

// ---------- the script itself, run for real in a temp home ----------
func runHook(_ p: AiPaths, _ tool: String, stdin: String, arg: String? = nil) -> (out: String, drops: [String]) {
  let pr = Process()
  pr.executableURL = URL(fileURLWithPath: "/bin/sh")
  pr.arguments = [p.hook.path, tool] + (arg.map { [$0] } ?? [])
  pr.environment = ["HOME": p.home.path, "PATH": "/usr/bin:/bin"]
  let i = Pipe(), o = Pipe()
  pr.standardInput = i; pr.standardOutput = o
  try! pr.run()
  i.fileHandleForWriting.write(Data(stdin.utf8)); try? i.fileHandleForWriting.close()
  pr.waitUntilExit()
  let out = String(decoding: o.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
  let drops = ((try? fm.contentsOfDirectory(atPath: p.inbox.path)) ?? []).filter { $0.hasSuffix(".drop") }.sorted()
  return (out, drops.map { get(p.inbox.appendingPathComponent($0)) ?? "" })
}
do {
  let p = tempHome(), i = AiInstaller(p: p)
  try! i.ensureScript()
  let secret = "SECRET-PROMPT-WORDS"
  var r = runHook(p, "claude", stdin: #"{"session_id":"11111111-2222-3333-4444-555555555555","transcript_path":"/tmp/t.jsonl","cwd":"/Users/x/Fictional app","hook_event_name":"Stop","stop_hook_active":false}"#)
  ok("Claude Code: the script answers {} and leaves one file", r.out == "{}\n" && r.drops.count == 1)
  let d = AiDoneCore.parseDrop(r.drops[0])
  ok("the file holds the tool, the id, the folder and the transcript's place", d?.tool == .claude && d?.id == "11111111-2222-3333-4444-555555555555" && d?.cwd == "/Users/x/Fictional app" && d?.transcript == "/tmp/t.jsonl")
  for f in (try? fm.contentsOfDirectory(atPath: p.inbox.path)) ?? [] {
    ok("only this user can read it", ((try? fm.attributesOfItem(atPath: p.inbox.appendingPathComponent(f).path))?[.posixPermissions] as? Int) == 0o600)
    try? fm.removeItem(at: p.inbox.appendingPathComponent(f))
  }
  r = runHook(p, "claude", stdin: #"{"session_id":"a","hook_event_name":"Stop","stop_hook_active":true}"#)
  ok("Claude Code: a Stop that is already a retry leaves nothing", r.drops.isEmpty)
  r = runHook(p, "claude", stdin: #"{"session_id":"a","hook_event_name":"SubagentStop"}"#)
  ok("Claude Code: another event leaves nothing", r.drops.isEmpty)
  r = runHook(p, "gemini", stdin: #"{"session_id":"g1","cwd":"/w/Fictional","hook_event_name":"AfterAgent","prompt":"\#(secret)","prompt_response":"\#(secret) answer","stop_hook_active":false}"#)
  ok("Gemini CLI: one file, {} on stdout", r.out == "{}\n" && r.drops.count == 1 && AiDoneCore.parseDrop(r.drops[0])?.id == "g1")
  ok("the prompt and the answer never reach the disk", !r.drops[0].contains(secret))
  for f in (try? fm.contentsOfDirectory(atPath: p.inbox.path)) ?? [] { try? fm.removeItem(at: p.inbox.appendingPathComponent(f)) }
  r = runHook(p, "codex", stdin: "", arg: #"{"type":"agent-turn-complete","thread-id":"th-9","turn-id":"1","cwd":"/w/Fictional codex","input-messages":["\#(secret)"],"last-assistant-message":"\#(secret)"}"#)
  ok("Codex notify: the JSON comes as an argument, nothing printed, one file", r.out.isEmpty && r.drops.count == 1 && AiDoneCore.parseDrop(r.drops[0])?.id == "th-9" && !r.drops[0].contains(secret))
  for f in (try? fm.contentsOfDirectory(atPath: p.inbox.path)) ?? [] { try? fm.removeItem(at: p.inbox.appendingPathComponent(f)) }
  r = runHook(p, "codex", stdin: #"{"session_id":"cx-1","cwd":"/w/x","hook_event_name":"Stop","stop_hook_active":false,"last_assistant_message":"\#(secret)"}"#)
  ok("Codex Stop hook: from stdin", r.drops.count == 1 && AiDoneCore.parseDrop(r.drops[0])?.id == "cx-1" && !r.drops[0].contains(secret))
  for f in (try? fm.contentsOfDirectory(atPath: p.inbox.path)) ?? [] { try? fm.removeItem(at: p.inbox.appendingPathComponent(f)) }
  r = runHook(p, "cursor", stdin: #"{"conversation_id":"cu-1","workspace_roots":["/w/Fictional cursor"],"status":"aborted","hook_event_name":"stop"}"#)
  ok("Cursor: a stopped run leaves nothing", r.drops.isEmpty)
  r = runHook(p, "cursor", stdin: #"{"conversation_id":"cu-1","workspace_roots":["/w/Fictional cursor"],"status":"completed","hook_event_name":"stop","user_email":"someone@example.com"}"#)
  ok("Cursor: a completed run leaves one file with its folder, and no email", r.drops.count == 1 && AiDoneCore.parseDrop(r.drops[0])?.cwd == "/w/Fictional cursor" && !r.drops[0].contains("example.com"))
  for f in (try? fm.contentsOfDirectory(atPath: p.inbox.path)) ?? [] { try? fm.removeItem(at: p.inbox.appendingPathComponent(f)) }
  r = runHook(p, "evil", stdin: "{}")
  ok("an unknown tool name does nothing", r.drops.isEmpty)
  try? fm.removeItem(at: p.inbox)
  r = runHook(p, "claude", stdin: #"{"session_id":"a","hook_event_name":"Stop"}"#)
  ok("with PS switched off (no inbox) the script still answers and leaves nothing", r.out == "{}\n" && !fm.fileExists(atPath: p.inbox.path))
}

// ---------- a file becomes a card ----------
do {
  let now = Date()
  let codex = AiDoneCore.Drop(tool: .codex, id: "th-9", cwd: "/w/Fictional codex", transcript: "", at: now)
  ok("Codex: the card's name is the chat's folder", AiDoneCore.verdict(codex, now: now) { _ in nil } == .card(tool: .codex, id: "th-9", chat: "Fictional codex", at: now))
  var nofolder = codex; nofolder.cwd = ""
  ok("no folder: a plain name", AiDoneCore.verdict(nofolder, now: now) { _ in nil } == .card(tool: .codex, id: "th-9", chat: "A Codex chat", at: now))
  var old = codex; old.at = now.addingTimeInterval(-4 * 3600)
  ok("a file from over 3 hours ago is dropped (its card would have gone)", AiDoneCore.verdict(old, now: now) { _ in nil } == .skipped("too old"))
  ok("an id is cleaned to letters, digits, - and _", AiDoneCore.parseDrop("tool=gemini\nid=ab/../c d;e\nat=1\n")?.id == "ab..cde".replacingOccurrences(of: ".", with: ""))
  ok("a file with no tool or id is nothing", AiDoneCore.parseDrop("id=x\n") == nil && AiDoneCore.parseDrop("tool=claude\nid=\n") == nil)
}

// ---------- Claude Code's hold rules (the cases of ~/.claude/hooks/ps-chat-done.test.mts) ----------
let now = Date()
let iso: (Double) -> String = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f.string(from: now.addingTimeInterval(-$0 * 60)) }
var call = 0
var structured = true
func j(_ o: Any) -> String { String(decoding: try! JSONSerialization.data(withJSONObject: o), as: UTF8.self) }
func result(_ tool: String, _ content: Any, _ minAgo: Double = 5, _ x: [String: Any] = [:], _ r: [String: Any]? = nil) -> [String] {
  call += 1
  let id = "toolu_\(call)"
  var a: [String: Any] = ["type": "assistant", "timestamp": iso(minAgo), "message": ["role": "assistant", "content": [["type": "tool_use", "id": id, "name": tool, "input": [:] as [String: Any]]]]]
  var u: [String: Any] = ["type": "user", "timestamp": iso(minAgo), "message": ["role": "user", "content": [["type": "tool_result", "tool_use_id": id, "content": content]]]]
  for (k, v) in x { a[k] = v; u[k] = v }
  if structured, let r { u["toolUseResult"] = r }
  return [j(a), j(u)]
}
func agent(_ id: String, _ minAgo: Double = 5) -> [String] { result("Agent", [["type": "text", "text": "Async agent launched successfully. (internal)\nagentId: \(id) (internal ID)\nThe agent is working in the background."]], minAgo, [:], ["isAsync": true, "status": "async_launched", "agentId": id]) }
func bash(_ id: String, _ x: [String: Any] = [:]) -> [String] { result("Bash", "Command running in background with ID: \(id). Output is being written to: /tmp/x/\(id).output", 5, x, ["stdout": "", "backgroundTaskId": id]) }
func moved(_ id: String) -> [String] { result("Bash", "Command was moved to the background (ID: \(id)) so that a message can reach you; it was not interrupted.", 5, [:], ["stdout": "", "backgroundTaskId": id, "backgroundedToDeliverMessage": true]) }
func workflow(_ id: String) -> [String] { result("Workflow", "Workflow launched in background. Task ID: \(id)\nSummary: Fictional work", 5, [:], ["status": "async_launched", "taskId": id, "taskType": "local_workflow"]) }
func taskStop(_ id: String) -> [String] { result("TaskStop", j(["message": "Successfully stopped task: \(id) (Fictional work)", "task_id": id]), 2) }
func resumed(_ id: String) -> [String] { result("SendMessage", [["type": "text", "text": j(["success": true, "message": "Agent \"\(id)\" was stopped (completed); resumed it in the background with your message.", "resumedAgentId": id] as [String: Any])]], 2) }
func bashOut(_ text: String) -> [String] { result("Bash", text, 1, [:], ["stdout": text, "stderr": ""]) }
func notice(_ id: String, _ status: String) -> String { "<task-notification>\n<task-id>\(id)</task-id>\n<tool-use-id>toolu_x</tool-use-id>\n<status>\(status)</status>\n<summary>Agent \"Fictional\" \(status)</summary>\n</task-notification>" }
func queued(_ id: String, _ s: String) -> [String] { [j(["type": "queue-operation", "operation": "enqueue", "timestamp": iso(1), "content": notice(id, s)])] }
func attached(_ id: String, _ s: String) -> [String] { [j(["type": "attachment", "timestamp": iso(1), "attachment": ["type": "queued_command", "prompt": notice(id, s)]])] }
func delivered(_ id: String, _ s: String) -> [String] { [j(["type": "user", "timestamp": iso(1), "message": ["role": "user", "content": notice(id, s)]])] }
let titleLine = j(["type": "custom-title", "customTitle": "Fictional chat"])
func info(_ lines: [[String]]) -> AiDoneCore.ClaudeInfo { AiDoneCore.claudeTranscript([titleLine] + lines.flatMap { $0 }, cwd: "/w/x", now: now) }
func sends(_ name: String, _ lines: [[String]], stale: Int = 0) { let r = info(lines); ok("sends: \(name)", r.running == 0 && r.stale == stale && r.chat == "Fictional chat" && !r.sub, "\(r)") }
func holds(_ name: String, _ lines: [[String]], _ count: Int) { let r = info(lines); ok("holds: \(name)", r.running == count, "\(r)") }

for mode in [true, false] {
  structured = mode
  print(mode ? "# with Claude Code's structured results" : "# text only (older transcripts)")
  sends("a chat with no background work", [])
  holds("one agent still running", [agent("a1")], 1)
  sends("one agent that completed", [agent("a1"), queued("a1", "completed")])
  sends("a stopped agent", [agent("a1"), queued("a1", "stopped")])
  sends("a failed agent", [agent("a1"), delivered("a1", "failed")])
  sends("a killed agent", [agent("a1"), attached("a1", "killed")])
  holds("several agents, two of three done", [agent("a1"), agent("a2"), agent("a3"), queued("a1", "completed"), queued("a3", "failed")], 1)
  sends("several agents, all done", [agent("a1"), agent("a2"), agent("a3"), queued("a1", "completed"), delivered("a2", "stopped"), attached("a3", "failed")])
  holds("a running status is not an end", [agent("a1"), queued("a1", "running")], 1)
  holds("a background Bash command still running", [bash("b1")], 1)
  sends("a background Bash command that finished", [bash("b1"), queued("b1", "completed")])
  holds("a command moved to the background", [moved("b2")], 1)
  holds("a workflow still running", [workflow("w1")], 1)
  sends("a workflow stopped with TaskStop", [workflow("w1"), taskStop("w1")])
  sends("a workflow that completed", [workflow("w1"), delivered("w1", "completed")])
  holds("a finished agent resumed by a message", [agent("a1"), queued("a1", "completed"), resumed("a1")], 1)
  sends("a resumed agent that finished again", [agent("a1"), queued("a1", "completed"), resumed("a1"), queued("a1", "completed")])
  holds("a notification quoted inside a tool's output is not an end", [agent("a1"), bashOut("some log\n\(notice("a1", "completed"))")], 1)
  sends("a resume quoted inside a command's output is not a resume", [agent("a1"), queued("a1", "completed"), bashOut(j(["success": true, "resumedAgentId": "a1"] as [String: Any]))])
  holds("a TaskStop quoted inside a command's output is not a stop", [workflow("w1"), bashOut("{\"message\":\"Successfully stopped task: w1\"}")], 1)
  if structured { sends("a launch line printed by a command is not a launch", [bashOut("Async agent launched successfully.\nagentId: a7 (internal)"), bashOut("Command running in background with ID: b7.")]) }
  holds("a mix: an agent, a command and a workflow, only the command done", [agent("a1"), bash("b1"), workflow("w1"), queued("b1", "completed")], 2)
  sends("work started over 4 hours ago with no end no longer holds", [agent("a1", 5 * 60)], stale: 1)
  sends("a subagent's own background work (sidechain) does not hold the chat", [bash("b9", ["isSidechain": true])])
}
structured = true

do {
  let sub = [j(["type": "user", "timestamp": iso(9), "message": ["role": "user", "content": "## You are a session started from another session\nFictional task"]])]
  ok("a chat another session started is a sub chat", info([sub]).sub)
  let quoted = result("Bash", "You are a session started from another session", 1, [:], ["stdout": "x"])
  ok("the words quoted in a tool's output do not make it one", !info([quoted]).sub)
  let named = AiDoneCore.claudeTranscript([j(["type": "last-prompt", "lastPrompt": "please  fix the fictional  login page and then the footer too"])], cwd: "/w/Fictional", now: now)
  ok("no title: the first 8 words of the prompt, as the hook does", named.chat == "please fix the fictional login page and then")
  ok("nothing at all: the folder", AiDoneCore.claudeTranscript([String](), cwd: "/w/Fictional", now: now).chat == "Fictional")
  let d = AiDoneCore.Drop(tool: .claude, id: "s1", cwd: "/w/x", transcript: "/t", at: now)
  ok("verdict: held while an agent runs", AiDoneCore.verdict(d, now: now) { _ in (agent("a1") + [titleLine]).map { Substring($0) } } == .held(1))
  ok("verdict: a sub chat is skipped", AiDoneCore.verdict(d, now: now) { _ in sub.map { Substring($0) } } == .skipped("a sub chat"))
  ok("verdict: a finished chat is a card with its title", AiDoneCore.verdict(d, now: now) { _ in [Substring(titleLine)] } == .card(tool: .claude, id: "s1", chat: "Fictional chat", at: now))
}

// ---------- V1.56: a chat's name, never a raw id (friends saw a worktree's random name) ----------
do {
  func user(_ text: Any, _ extra: [String: Any] = [:]) -> String { j(["type": "user", "timestamp": iso(9), "message": ["role": "user", "content": text]].merging(extra) { $1 }) }
  let leaf = j(["type": "last-prompt", "leafUuid": "0b1c2d3e-0000-4000-8000-000000000001", "sessionId": "0b1c2d3e-0000-4000-8000-000000000002"])
  let wt = "/Users/x/Projects/fictional-shop/.claude/worktrees/dazzling-taussig-91586f"
  func name(_ lines: [String], cwd: String = wt, app: String? = nil) -> String { AiDoneCore.claudeTranscript(lines, cwd: cwd, now: now, appTitle: app).chat }
  ok("no title and a last-prompt with no words: the first prompt's 8 words", name([leaf, user("Make  the fictional checkout page load faster on phones please")]) == "Make the fictional checkout page load faster on")
  ok("the app's tags are taken out of the first prompt", name([user("<ide_opened_file>The user opened /x/a.ts</ide_opened_file>\nfix the fictional footer")]) == "fix the fictional footer")
  ok("text blocks count as the prompt", name([user([["type": "text", "text": "rename the fictional button"]])]) == "rename the fictional button")
  ok("a meta line (local command caveat) is not the prompt", name([user("Caveat: The messages below were generated", ["isMeta": true]), user("tidy the fictional list")]) == "tidy the fictional list")
  ok("a subagent's prompt (sidechain) is not the chat's", name([user("fictional sub task words", ["isSidechain": true]), user("the real fictional ask")]) == "the real fictional ask")
  ok("only tags: the next prompt", name([user("<command-name>/clear</command-name>"), user("second fictional ask")]) == "second fictional ask")
  ok("the Claude app's own title beats the prompt", name([user("some fictional ask")], app: "Fictional app title") == "Fictional app title")
  ok("the transcript's title beats the app's", name([titleLine, user("x")], app: "Older fictional title") == "Fictional chat")
  ok("a title that is only an id is never shown", name([j(["type": "custom-title", "customTitle": "3743204d-0f4a-4d3b-b95e-d5dbb064bc00"]), user("fictional words here")]) == "fictional words here")
  ok("nothing but a Claude app worktree: its project's folder, not the random name", name([leaf]) == "fictional-shop")
  ok("a folder that is only an id: A Claude chat", name([leaf], cwd: "/Users/x/3743204d-0f4a-4d3b-b95e-d5dbb064bc00") == "A Claude chat")
  ok("the Claude app's scratch space: A Claude chat", name([], cwd: "/Users/x/Library/Application Support/Claude/scratch-workspaces/b916a722/9d3ccb49/scratch-2026-10-13-0b2a7d") == "A Claude chat")
  ok("a plain project folder stays the name", AiDoneCore.chatFolder("/Users/x/Projects/fictional-app/") == "fictional-app")
  ok("hex only folder is an id", AiDoneCore.idLike("0b2a7d91586f") && !AiDoneCore.idLike("fictional-app") && !AiDoneCore.idLike("cafe"))

  // The Claude app's session files (a temp Application Support folder).
  let sup = fm.temporaryDirectory.appendingPathComponent("aidone-sup-\(UUID().uuidString)")
  let dir = sup.appendingPathComponent("Claude/claude-code-sessions/acct-1/org-1")
  put(dir.appendingPathComponent("local_aaa.json"), j(["sessionId": "local_aaa", "cliSessionId": "11111111-2222-4333-8444-555555555555", "title": "Fictional sidebar title", "cwd": wt]))
  put(dir.appendingPathComponent("local_bbb.json"), j(["sessionId": "local_bbb", "cliSessionId": "99999999-2222-4333-8444-555555555555", "title": "Another fictional chat"]))
  put(dir.appendingPathComponent("local_old.json"), j(["sessionId": "local_old", "cliSessionId": "77777777-2222-4333-8444-555555555555", "title": "Old fictional chat"]))
  try! fm.setAttributes([.modificationDate: Date().addingTimeInterval(-5 * 86400)], ofItemAtPath: dir.appendingPathComponent("local_old.json").path)
  ok("the app's title found by the Claude Code session id", AiDoneCore.claudeAppTitle(sessionId: "11111111-2222-4333-8444-555555555555", appSupport: sup) == "Fictional sidebar title")
  ok("an unknown session: no app title", AiDoneCore.claudeAppTitle(sessionId: "12345678-2222-4333-8444-555555555555", appSupport: sup) == nil)
  ok("files older than two days are not read", AiDoneCore.claudeAppTitle(sessionId: "77777777-2222-4333-8444-555555555555", appSupport: sup) == nil)
  ok("no app folder at all: nothing", AiDoneCore.claudeAppTitle(sessionId: "x1", appSupport: sup.appendingPathComponent("nope")) == nil)
  let cd = AiDoneCore.Drop(tool: .claude, id: "11111111-2222-4333-8444-555555555555", cwd: wt, transcript: "/t", at: now)
  ok("verdict: a Code tab chat with no title record gets the app's title", AiDoneCore.verdict(cd, now: now, lines: { _ in [Substring(leaf)] }, named: { AiDoneCore.toolName($0, home: sup, appSupport: sup) })
     == .card(tool: .claude, id: cd.id, chat: "Fictional sidebar title", at: now))
  ok("verdict: a transcript PS cannot read still never shows the random worktree name", AiDoneCore.verdict(cd, now: now, lines: { _ in nil }) == .card(tool: .claude, id: cd.id, chat: "fictional-shop", at: now))

  // Codex: its thread index, else the rollout's first prompt.
  let h = tempHome().home
  put(h.appendingPathComponent(".codex/session_index.jsonl"), j(["id": "01a1c0c6-a565-7a93-a1e6-000000000001", "thread_name": "Old fictional name"]) + "\n" + j(["id": "01a1c0c6-a565-7a93-a1e6-000000000001", "thread_name": "Fictional Codex thread"]) + "\n")
  ok("Codex: the newest thread name", AiDoneCore.codexName(threadId: "01a1c0c6-a565-7a93-a1e6-000000000001", home: h) == "Fictional Codex thread")
  let roll = [j(["type": "session_meta", "payload": ["id": "01a1c0c6-a565-7a93-a1e6-000000000002"]]),
              j(["type": "response_item", "payload": ["type": "message", "role": "user", "content": [["type": "input_text", "text": "# AGENTS.md instructions\n\n<INSTRUCTIONS>x</INSTRUCTIONS>"]]]]),
              j(["type": "response_item", "payload": ["type": "message", "role": "user", "content": [["type": "input_text", "text": "<environment_context>cwd</environment_context>"]]]]),
              j(["type": "response_item", "payload": ["type": "message", "role": "user", "content": [["type": "input_text", "text": "add a fictional dark mode to the settings page now"]]]])]
  put(h.appendingPathComponent(".codex/sessions/2026/11/13/rollout-2026-11-13T10-00-00-01a1c0c6-a565-7a93-a1e6-000000000002.jsonl"), roll.joined(separator: "\n"))
  ok("Codex: no thread name, the first prompt (Codex's own instructions skipped)", AiDoneCore.codexName(threadId: "01a1c0c6-a565-7a93-a1e6-000000000002", home: h) == "add a fictional dark mode to the settings")
  ok("Codex: the user_message form too", AiDoneCore.codexFirstPrompt([j(["type": "event_msg", "payload": ["type": "user_message", "message": "fix the fictional tests"]])]) == "fix the fictional tests")
  let cx = AiDoneCore.Drop(tool: .codex, id: "01a1c0c6-a565-7a93-a1e6-000000000001", cwd: "/w/Fictional codex", transcript: "", at: now)
  ok("verdict: Codex uses its thread name", AiDoneCore.verdict(cx, now: now, lines: { _ in nil }, named: { AiDoneCore.toolName($0, home: h, appSupport: h) }) == .card(tool: .codex, id: cx.id, chat: "Fictional Codex thread", at: now))
  let cxid = AiDoneCore.Drop(tool: .codex, id: "zz", cwd: "/w/0b2a7d91586f", transcript: "", at: now)
  ok("verdict: no name and an id for a folder: A Codex chat", AiDoneCore.verdict(cxid, now: now, lines: { _ in nil }) == .card(tool: .codex, id: "zz", chat: "A Codex chat", at: now))

  // Gemini CLI: its saved chat's first prompt.
  put(h.appendingPathComponent(".gemini/tmp/abc123/chats/session-2026-11-13T10-00-aaaa.json"), j(["sessionId": "gem-fictional-1", "messages": [["type": "user", "content": "<context>x</context>"], ["type": "user", "content": "explain the fictional build script"], ["type": "gemini", "content": "Sure"]]]))
  ok("Gemini: the first prompt of its saved chat", AiDoneCore.geminiName(sessionId: "gem-fictional-1", home: h) == "explain the fictional build script")
  ok("Gemini: another session: nothing", AiDoneCore.geminiName(sessionId: "gem-fictional-2", home: h) == nil)
  try? fm.removeItem(at: sup)
}

// ---------- V1.56: the developer's answer, "a long jumble of letters and numbers" (a session id), on the app and the terminal ----------
do {
  let sid = "4f8a2c1e-9b3d-4e5f-8a7b-6c5d4e3f2a1b"
  func user(_ text: String) -> String { j(["type": "user", "timestamp": iso(9), "message": ["role": "user", "content": text]]) }
  func nm(_ lines: [String], cwd: String = "/Users/x/Projects/fictional-shop", app: String? = nil) -> String { AiDoneCore.claudeTranscript(lines, cwd: cwd, now: now, appTitle: app, sessionId: sid).chat }
  for id in ["session_01PrcxMEVnxwCasRvFMDexVz", "01JD8XK2M3N4P5Q6R7S8T9V0W1", "aB3dE5fG7hJ9kL1mQ2", "local_50ecc6d2-d676-4c4f-8ad5-b4d8ba42be3d", "32e9f95ee0f94c23bfa91e10eff12f38", "msg_01AbCdEf23GhIj"] {
    ok("an id is never a name: \(id)", AiDoneCore.idLike(id))
  }
  for name in ["iPhone15ProMax", "gpt5-turbo-2024", "web", "V1.48 Sentry mode (AI button)", "project2024-final", "MyApp3000", "Fix the login page"] {
    ok("a name stays a name: \(name)", !AiDoneCore.idLike(name))
  }
  // The terminal: Claude Code titles a chat itself ("ai-title"), a moment after the first prompt.
  ok("terminal: Claude Code's own title", nm([user("fix the fictional cart"), j(["type": "ai-title", "aiTitle": "Fix fictional cart totals"])]) == "Fix fictional cart totals")
  ok("terminal: a rename beats Claude Code's title", nm([j(["type": "ai-title", "aiTitle": "Auto title"]), j(["type": "custom-title", "customTitle": "My fictional name"])]) == "My fictional name")
  ok("terminal: before the title is written, the first prompt", nm([user("make the fictional header sticky on scroll please")]) == "make the fictional header sticky on scroll please")
  ok("terminal: an agent name that is an id is skipped", nm([j(["type": "agent-name", "agentName": "session_01PrcxMEVnxwCasRvFMDexVz"]), user("rename the fictional page")]) == "rename the fictional page")
  ok("a title that is the chat's own id is skipped", nm([j(["type": "custom-title", "customTitle": sid]), user("tidy fictional code")]) == "tidy fictional code")
  ok("a title holding the chat's own id is skipped", nm([j(["type": "custom-title", "customTitle": "chat \(sid)"]), user("tidy fictional code")]) == "tidy fictional code")
  ok("terminal: no title, no prompt, a folder named by an id: A Claude chat", nm([], cwd: "/Users/x/runs/session_01PrcxMEVnxwCasRvFMDexVz") == "A Claude chat")
  ok("terminal: no title, no prompt: the project folder", nm([]) == "fictional-shop")
  // The Claude app: its sidebar title when the transcript has none, even with an id for an agent name.
  ok("app: the sidebar title beats an id agent name", nm([j(["type": "agent-name", "agentName": "local_50ecc6d2-d676-4c4f-8ad5-b4d8ba42be3d"])], app: "Fictional sidebar title") == "Fictional sidebar title")
  ok("app: a sidebar title that is an id is skipped", nm([user("the fictional ask")], app: "local_50ecc6d2-d676-4c4f-8ad5-b4d8ba42be3d") == "the fictional ask")
  let d = AiDoneCore.Drop(tool: .claude, id: sid, cwd: "/Users/x/\(sid)", transcript: "/t", at: now)
  ok("verdict: unreadable transcript, folder named by the chat's id: never the id", AiDoneCore.verdict(d, now: now, lines: { _ in nil }) == .card(tool: .claude, id: sid, chat: "A Claude chat", at: now))
  let cx = AiDoneCore.Drop(tool: .codex, id: "th-0001-fictional", cwd: "/w/th-0001-fictional", transcript: "", at: now)
  ok("verdict: another tool's folder that is its own id: never the id", AiDoneCore.verdict(cx, now: now, lines: { _ in nil }) == .card(tool: .codex, id: cx.id, chat: "A Codex chat", at: now))
}

print("\n\(passed) AI chat finished checks passed")

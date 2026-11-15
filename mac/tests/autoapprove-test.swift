// Unit tests for Auto approve (Sources/AutoApproveCore.swift). Everything happens in temp folders that stand in for a
// home folder: the real ~/.claude and ~/.codex are never read or written, no window is read, no key is pressed.
// Run: bash tests/autoapprove-test.sh
import Foundation

var passed = 0
func ok(_ name: String, _ cond: Bool, _ more: String = "") {
  if cond { passed += 1; print("ok - \(name)") } else { print("FAIL - \(name) \(more)"); exit(1) }
}
let fm = FileManager.default
func tempHome() -> ApprovePaths {
  let u = fm.temporaryDirectory.appendingPathComponent("autoapprove-test-\(UUID().uuidString)")
  try! fm.createDirectory(at: u, withIntermediateDirectories: true)
  return ApprovePaths(home: u)
}
func put(_ url: URL, _ text: String) { try! fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true); try! text.write(to: url, atomically: true, encoding: .utf8) }
func get(_ url: URL) -> String? { try? String(contentsOf: url, encoding: .utf8) }
func obj(_ url: URL) -> NSDictionary? { (try? JSONSerialization.jsonObject(with: Data(contentsOf: url))) as? NSDictionary }
func same(_ a: NSDictionary?, _ b: NSDictionary?) -> Bool { a != nil && b != nil && a!.isEqual(to: b! as! [AnyHashable: Any]) }
func isApprove(_ v: ApproveCore.Verdict) -> Bool { if case .approve = v { return true }; return false }
func isUnsure(_ v: ApproveCore.Verdict) -> Bool { if case .unsure = v { return true }; return false }
func whatOf(_ v: ApproveCore.Verdict) -> String { if case .approve(_, let w) = v { return w }; return "" }

// ---------- the mode logic ----------
do {
  typealias S = ApproveCore.Switches; typealias M = ApproveCore.Modes
  ok("everything off by default", S() == S(ai: false, sleep: false, always: false) && !ApproveCore.armed(S()))
  ok("off with no switch on, whatever the Mac is doing", !ApproveCore.active(S(), M(ai: true, sleep: true)))
  ok("AI mode switch: on only in AI mode", ApproveCore.why(S(ai: true), M(ai: true)) == "AI mode" && !ApproveCore.active(S(ai: true), M(sleep: true)) && !ApproveCore.active(S(ai: true), M()))
  ok("Sleep mode switch: on only in Sleep mode", ApproveCore.why(S(sleep: true), M(sleep: true)) == "Sleep mode" && !ApproveCore.active(S(sleep: true), M(ai: true)))
  ok("Always: on with no mode", ApproveCore.why(S(always: true), M()) == "Always")
  ok("AI mode under Sleep mode counts for either switch", ApproveCore.active(S(ai: true), M(ai: true, sleep: true)) && ApproveCore.active(S(sleep: true), M(ai: true, sleep: true)))
  ok("the hook line stays while any switch is on", ApproveCore.armed(S(sleep: true)) && ApproveCore.armed(S(ai: true)) && ApproveCore.armed(S(always: true)))
  let now = Date(timeIntervalSince1970: 1_800_000_000)
  let lease = ApproveCore.leaseText(now: now)
  ok("a fresh lease is live", ApproveCore.leaseLive(lease, now: now) && ApproveCore.leaseLive(lease, now: now.addingTimeInterval(119)))
  ok("an old lease is not", !ApproveCore.leaseLive(lease, now: now.addingTimeInterval(121)))
  ok("no lease or junk is not live", !ApproveCore.leaseLive(nil, now: now) && !ApproveCore.leaseLive("soon", now: now) && !ApproveCore.leaseLive("", now: now))
  ok("the lease is moved on well inside its life", ApproveCore.leaseEvery * 3 < ApproveCore.leaseSeconds)
}

// ---------- the classifier: permission prompts ----------
let claudeBash = """
  ~/projects/shop $ claude
  ⏺ Running the tests now.
╭──────────────────────────────────────────────────────────────╮
│ Bash command                                                 │
│                                                              │
│   npm test -- --watch=false                                  │
│   Run the unit tests                                         │
│                                                              │
│ Do you want to proceed?                                      │
│ ❯ 1. Yes                                                     │
│   2. Yes, and don't ask again for npm test commands in /shop │
│   3. No, and tell Claude what to do differently (esc)        │
╰──────────────────────────────────────────────────────────────╯
"""
let v1 = ApproveCore.classify(claudeBash)
ok("Claude Code's Bash prompt is a permission prompt", isApprove(v1), "\(v1)")
ok("its log line is the command", whatOf(v1).contains("npm test"), whatOf(v1))

let friendHook = """
 Bash command

   rm -rf build && make release

 Hook tool.check requires confirmation for this command: matches a risky pattern
 Do you want to proceed?
 ❯ 1. Yes
   2. No

 Esc to cancel · Tab to amend · ctrl+e to explain
"""
ok("the friend's hook confirmation prompt is a permission prompt", isApprove(ApproveCore.classify(friendHook)))

let claudeEdit = """
 Edit file
 src/app.ts
 ...
 Do you want to make this edit to app.ts?
 ❯ 1. Yes
   2. Yes, allow all edits during this session (shift+tab)
   3. No, and tell Claude what to do differently (esc)
"""
ok("Claude Code's edit prompt is a permission prompt", isApprove(ApproveCore.classify(claudeEdit)))

let claudeCreate = """
 Create file
 notes/todo.md
 Do you want to create todo.md?
 ❯ 1. Yes
   2. Yes, allow all edits during this session (shift+tab)
   3. No, and tell Claude what to do differently (esc)
"""
ok("Claude Code's create prompt is a permission prompt", isApprove(ApproveCore.classify(claudeCreate)))

let codex = """
▌ build it
• Running cargo build
Would you like to run the following command?
  $ cargo build --release
› 1. Yes, proceed (y)
  2. Yes, and don't ask again for this command (a)
  3. No, and tell Codex what to do differently (esc)
Press enter to confirm or esc to cancel
"""
let vc = ApproveCore.classify(codex)
ok("Codex's command prompt is a permission prompt", isApprove(vc), "\(vc)")
ok("Codex's log line is the command under the question", whatOf(vc).contains("cargo build"), whatOf(vc))

let gemini = """
 Shell npm install
 Allow execution of: 'npm'?
 ● 1. Yes, allow once
   2. Yes, allow always
   3. No, suggest changes (esc)
"""
ok("Gemini CLI's prompt is a permission prompt", isApprove(ApproveCore.classify(gemini)))

let wrapped = """
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for npm run build:prod commands
      in /Users/someone/projects/a-very-long-folder-name
   3. No, and tell Claude what to do differently (esc)
"""
ok("a wrapped option label is still one option", isApprove(ApproveCore.classify(wrapped)))

// ---------- the classifier: never pressed ----------
let ask = """
 ☐ Database
 Which database should we use for the cache?
 ❯ 1. Postgres
      Reliable and already running
   2. SQLite
      No server needed
   3. Type something.
 Enter to select · Tab/Arrow keys to navigate · Esc to cancel
"""
ok("AskUserQuestion is a question", ApproveCore.classify(ask) == .question)

let askYes = """
 Should I also delete the old backups?
 ❯ 1. Yes
   2. No
"""
ok("a yes or no question that is not about permission is a question", ApproveCore.classify(askYes) == .question)

let plan = """
 Here is Claude's plan:
 1. Add the table
 2. Migrate
 Would you like to proceed?
 ❯ 1. Yes, and auto-accept edits
   2. Yes, and manually approve edits
   3. No, keep planning
"""
ok("a plan approval is a question", ApproveCore.classify(plan) == .question)

let trust = """
 Do you trust the files in this folder?
 /Users/someone/projects/new
 ❯ 1. Yes, proceed
   2. No, exit
"""
ok("the trust folder prompt is a question", ApproveCore.classify(trust) == .question)

let onNo = """
 Do you want to proceed?
   1. Yes
 ❯ 2. No
"""
ok("Yes not chosen: unsure, nothing pressed", isUnsure(ApproveCore.classify(onNo)))

let noMark = """
 Do you want to proceed?
   1. Yes
   2. No
"""
ok("no chosen mark visible: unsure, nothing pressed", isUnsure(ApproveCore.classify(noMark)))

let after = claudeBash + "\n  ⏺ Done. All 40 tests passed.\n  > \n"
ok("a prompt that is no longer at the bottom is nothing", ApproveCore.classify(after) == .none)
ok("a plain shell is nothing", ApproveCore.classify("~ $ ls\nfile1  file2\n~ $ ") == .none)
ok("an empty window is nothing", ApproveCore.classify("") == .none)

let typeAnswer = """
 Do you want to proceed?
 ❯ 1. Yes
   2. Tell me more first
"""
ok("an option that is neither yes nor no makes it a question", ApproveCore.classify(typeAnswer) == .question)

let gaps = """
 Do you want to proceed?
 ❯ 1. Yes
   3. No
"""
ok("options not numbered 1, 2: unsure", isUnsure(ApproveCore.classify(gaps)))

// ---------- the classifier: the same prompt has the same key, another prompt another ----------
do {
  guard case .approve(let k1, _) = ApproveCore.classify(claudeBash), case .approve(let k2, _) = ApproveCore.classify(claudeBash),
        case .approve(let k3, _) = ApproveCore.classify(claudeBash.replacingOccurrences(of: "npm test", with: "npm run lint")) else { ok("keys", false); exit(1) }
  ok("the same prompt gives the same key", k1 == k2)
  ok("another command gives another key", k1 != k3)
}

// ---------- the log: secrets out ----------
do {
  let r = ApproveCore.redact(#"curl -H "Authorization: Bearer sk-abc123def456ghi789jkl" "https://api.example.com/v1/x?token=abc&user=me""#)
  ok("bearer tokens and query strings are taken out", !r.contains("sk-abc123") && !r.contains("token=abc") && r.contains("curl"), r)
  let e = ApproveCore.redact("OPENAI_API_KEY=sk-proj-aaaaaaaaaaaaaaaaaaaa npm run deploy --password hunter22")
  ok("env values and password flags are taken out", !e.contains("sk-proj") && !e.contains("hunter22") && e.contains("npm run deploy"), e)
  let u = ApproveCore.redact("git clone https://someone:person17@github.com/x/y.git")
  ok("user:password in a URL is taken out", !u.contains("person17"), u)
  let long = ApproveCore.redact(String(repeating: "echo hi && ", count: 30))
  ok("the log line is at most 90 characters on one line", long.count <= 90 && !long.contains("\n"))
  let d = ApproveCore.parseDrop("tool=claude\nname=Bash\nwhat=export GITHUB_TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaa && gh pr list\ncwd=/Users/someone/projects/shop\nat=1800000000\n")!
  let line = ApproveCore.logLine(d)
  ok("a hook drop becomes a log line with the folder's name only", (line["where"] as? String) == "shop" && (line["app"] as? String) == "Claude Code")
  ok("a hook drop's token never reaches the log", !((line["what"] as? String) ?? "").contains("ghp_"), "\(line)")
  ok("a drop from another tool is refused", ApproveCore.parseDrop("tool=other\nname=x\nat=1\n") == nil)
}

// ---------- settings.json: add and take out ----------
let claudeOwn = """
{
  "model": "opus",
  "permissions": { "allow": ["Bash(ls)"], "defaultMode": "bypassPermissions" },
  "hooks": {
    "Stop": [ { "hooks": [ { "type": "command", "command": "/bin/sh '/Users/x/Library/PS/ai-done/hook.sh' claude", "timeout": 10 } ] } ],
    "PermissionRequest": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "/usr/local/bin/my-own-check" } ] } ],
    "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "/usr/local/bin/guard" } ] } ]
  },
  "skipDangerousModePermissionPrompt": true
}
"""
do {
  let p = tempHome(), i = ApproveInstaller(p: p)
  put(p.claudeSettings, claudeOwn)
  let before = obj(p.claudeSettings)
  let r = i.install()
  ok("Claude Code gets the line", r.claude == .done && i.claudeOn())
  ok("Codex is skipped when it is not on this Mac", r.codex == .missing && !fm.fileExists(atPath: p.codexHooks.path))
  let after = obj(p.claudeSettings)!
  let pr = (after["hooks"] as! NSDictionary)["PermissionRequest"] as! NSArray
  ok("the person's own PermissionRequest hook stays first, PS's is added after it", pr.count == 2 && ((((pr[0] as! NSDictionary)["hooks"] as! NSArray)[0] as! NSDictionary)["command"] as! String) == "/usr/local/bin/my-own-check")
  ok("PS's line runs the script for claude", ((((pr[1] as! NSDictionary)["hooks"] as! NSArray)[0] as! NSDictionary)["command"] as! String).hasSuffix("auto-approve/hook.sh' claude"))
  ok("PS's line has no matcher (every tool; the script skips questions)", (pr[1] as! NSDictionary)["matcher"] == nil)
  ok("everything else is untouched", (after["model"] as? String) == "opus" && (after["skipDangerousModePermissionPrompt"] as? Bool) == true
     && same((after["hooks"] as! NSDictionary)["Stop"].map { ["x": $0] as NSDictionary }, (before!["hooks"] as! NSDictionary)["Stop"].map { ["x": $0] as NSDictionary }))
  ok("a backup of the file as it was is kept", same(obj(URL(fileURLWithPath: p.claudeSettings.path + ApproveCore.backupSuffix)), before))
  ok("on twice adds nothing", { _ = i.install(); return same(obj(p.claudeSettings), after) }())
  ok("the script is there and only this user can run it", (try? fm.attributesOfItem(atPath: p.hook.path))?[.posixPermissions] as? Int == 0o700)
  i.setLease(true)
  ok("the lease is written", ApproveCore.leaseLive(get(p.lease), now: Date()))
  i.uninstall()
  ok("off gives the file back exactly as it was", same(obj(p.claudeSettings), before))
  ok("off keeps AI chat finished cards' line", (obj(p.claudeSettings)?["hooks"] as? NSDictionary)?["Stop"] != nil)
  ok("off removes the script, the lease and PS's folder", !fm.fileExists(atPath: p.hook.path) && !fm.fileExists(atPath: p.lease.path) && !fm.fileExists(atPath: p.dir.path))
}
do {
  let p = tempHome(), i = ApproveInstaller(p: p)
  try! fm.createDirectory(at: p.claudeDir, withIntermediateDirectories: true)
  try! fm.createDirectory(at: p.codexDir, withIntermediateDirectories: true)
  let r = i.install()
  ok("no settings file yet: PS makes one with only its line", r.claude == .done && (obj(p.claudeSettings)?.allKeys.count == 1))
  ok("Codex on this Mac gets its line in hooks.json", r.codex == .done && i.codexOn())
  ok("Codex's line runs the script for codex", (get(p.codexHooks) ?? "").contains("hook.sh' codex"))
  i.uninstall()
  ok("off removes files PS made itself", !fm.fileExists(atPath: p.claudeSettings.path) && !fm.fileExists(atPath: p.codexHooks.path))
  ok("off leaves the tools' own folders", fm.fileExists(atPath: p.claudeDir.path) && fm.fileExists(atPath: p.codexDir.path))
}
do {
  let p = tempHome(), i = ApproveInstaller(p: p)
  let broken = "{\n  // my comment\n  \"model\": \"opus\",\n}\n"
  put(p.claudeSettings, broken)
  let r = i.install()
  if case .refused = r.claude { ok("a file PS cannot read is refused", true) } else { ok("a file PS cannot read is refused", false, "\(r)") }
  ok("and left exactly as it was, with no backup", get(p.claudeSettings) == broken && !fm.fileExists(atPath: p.claudeSettings.path + ApproveCore.backupSuffix))
  i.uninstall()
  ok("off leaves it alone too", get(p.claudeSettings) == broken)
}
do {
  // Off with nothing of PS's in the file: the file is not even rewritten.
  let p = tempHome(), i = ApproveInstaller(p: p)
  put(p.claudeSettings, claudeOwn)
  i.uninstall()
  ok("off never rewrites a file with no PS line", get(p.claudeSettings) == claudeOwn && !fm.fileExists(atPath: p.claudeSettings.path + ApproveCore.backupSuffix))
}
do {
  // Removing works on PS's line wherever it ended up, and only on PS's.
  let o: [String: Any] = ["hooks": ["PermissionRequest": [["hooks": [["type": "command", "command": "/bin/sh '/h/Library/PS/auto-approve/hook.sh' claude"], ["type": "command", "command": "/x/theirs"]]]],
                                    "Stop": [["hooks": [["type": "command", "command": "/bin/sh '/h/Library/PS/ai-done/hook.sh' claude"]]]]]]
  let out = ApproveCore.removing(o)
  let pr = ((out["hooks"] as! [String: Any])["PermissionRequest"] as! [[String: Any]])[0]["hooks"] as! [[String: Any]]
  ok("a group shared with the person's own hook keeps theirs", pr.count == 1 && (pr[0]["command"] as? String) == "/x/theirs")
  ok("AI chat cards' Stop line is not PS Auto approve's", (out["hooks"] as! [String: Any])["Stop"] != nil)
}

// ---------- the real script, in a temp home ----------
func runHook(_ p: ApprovePaths, _ input: String, tool: String = "claude") -> String {
  let proc = Process()
  proc.executableURL = URL(fileURLWithPath: "/bin/sh")
  proc.arguments = [p.hook.path, tool]
  var env = ProcessInfo.processInfo.environment; env["HOME"] = p.home.path
  proc.environment = env
  let inp = Pipe(), out = Pipe()
  proc.standardInput = inp; proc.standardOutput = out; proc.standardError = FileHandle.nullDevice
  try! proc.run()
  inp.fileHandleForWriting.write(Data(input.utf8)); try? inp.fileHandleForWriting.close()
  proc.waitUntilExit()
  return String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
}
do {
  let p = tempHome(), i = ApproveInstaller(p: p)
  try! fm.createDirectory(at: p.claudeDir, withIntermediateDirectories: true)
  _ = i.install()
  let bash = #"{"session_id":"s1","cwd":"/Users/someone/projects/shop","hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"npm test","description":"Run tests"},"permission_suggestions":[]}"#
  ok("no lease: the script says nothing (the prompt shows as usual)", runHook(p, bash).isEmpty)
  i.setLease(true)
  let o = runHook(p, bash)
  let j = (try? JSONSerialization.jsonObject(with: Data(o.utf8))) as? [String: Any]
  let hs = j?["hookSpecificOutput"] as? [String: Any]
  ok("a live lease: the script allows", (hs?["hookEventName"] as? String) == "PermissionRequest" && ((hs?["decision"] as? [String: Any])?["behavior"] as? String) == "allow", o)
  let drops = (try? fm.contentsOfDirectory(atPath: p.inbox.path))?.filter { $0.hasSuffix(".drop") } ?? []
  ok("it leaves one drop for the log", drops.count == 1)
  if let f = drops.first {
    let u = p.inbox.appendingPathComponent(f)
    ok("the drop is readable by this user only", ((try? fm.attributesOfItem(atPath: u.path))?[.posixPermissions] as? Int) == 0o600)
    let d = ApproveCore.parseDrop(get(u) ?? "")
    ok("the drop says which tool and command", d?.name == "Bash" && d?.what == "npm test" && d?.cwd == "/Users/someone/projects/shop")
  }
  let askIn = #"{"hook_event_name":"PermissionRequest","tool_name":"AskUserQuestion","tool_input":{"questions":[]}}"#
  ok("AskUserQuestion: the script says nothing", runHook(p, askIn).isEmpty)
  ok("ExitPlanMode: the script says nothing", runHook(p, #"{"hook_event_name":"PermissionRequest","tool_name":"ExitPlanMode","tool_input":{}}"#).isEmpty)
  ok("another event: the script says nothing", runHook(p, #"{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{}}"#).isEmpty)
  ok("garbage in: the script says nothing", runHook(p, "not json").isEmpty)
  ok("an unknown tool name argument: nothing", runHook(p, bash, tool: "other").isEmpty)
  ok("Codex: the script allows too", runHook(p, bash, tool: "codex").contains("\"allow\""))
  try! "\(Int(Date().timeIntervalSince1970) - 5)\n".write(to: p.lease, atomically: true, encoding: .utf8)
  ok("an old lease (PS closed or crashed): the script says nothing", runHook(p, bash).isEmpty)
  i.setLease(false)
  ok("lease removed: nothing", runHook(p, bash).isEmpty)
  i.uninstall()
}

// ---------- splitting what Terminal and iTerm2 return ----------
do {
  let out = "<<PS-ab12 101 1>>\nline one\nDo you want to proceed?\n<<PS-ab12 101 2>>\n~ $ ls\n<<PS-zz99 fake>>\n"
  let parts = ApproveCore.split(out, nonce: "ab12")
  ok("one piece per tab, in order", parts.count == 2 && parts[0].target == "101 1" && parts[1].target == "101 2")
  ok("a line that only looks like a marker (another nonce) stays text", parts[1].text.contains("<<PS-zz99 fake>>"))
  ok("the text of a tab is kept", parts[0].text.contains("Do you want to proceed?"))
  ok("nothing back: nothing", ApproveCore.split("", nonce: "ab12").isEmpty)
}

print("\(passed) passed")
